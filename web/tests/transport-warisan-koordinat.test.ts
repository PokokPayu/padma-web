/**
 * Pengajuan klien mewarisi koordinat profil BILA alamatnya identik.
 *
 * Batas ketegangannya dengan spec T6 diuji di sini secara langsung: begitu
 * teks alamatnya BERBEDA, pewarisan harus berhenti — karena klien boleh
 * memesan untuk alamat lain, dan mengirim mitra ke rumahnya adalah persis
 * bahaya yang T6 cegah.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { ajukanJadwal } = await import("@/lib/passport/aksi");

const ANANDA = "44444444-4444-4444-4444-444444444401";
const ALAMAT_PROFIL = "PAD-UJI Jl. Warisan No. 7, Malang";
const ALAMAT_LAIN = "PAD-UJI Jl. Bukan Rumahnya No. 9, Malang";
const LAT_PIN = -7.9666;
const LON_PIN = 112.6326;

function stubNominatim() {
  const asli = globalThis.fetch;
  const palsu = vi.fn(
    async () =>
      new Response(JSON.stringify([{ lat: "-7.1111", lon: "112.1111" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu() : asli(...args);
  });
  return palsu;
}

let sesiKlien: SupabaseClient;
let serviceId: string;
let variantId: string;
let profilAsli: { alamat: string; lat: number | null; lon: number | null };

beforeAll(async () => {
  sesiKlien = await signInAs("ananda@padma.test");

  const { data: layanan } = await admin
    .from("services")
    .select("id")
    .eq("aktif", true)
    .limit(1)
    .single();
  serviceId = layanan!.id as string;

  const { data: varian } = await admin
    .from("service_variants")
    .select("id")
    .eq("service_id", serviceId)
    .eq("aktif", true)
    .limit(1)
    .single();
  variantId = varian!.id as string;

  const { data: klien } = await admin
    .from("clients")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("id", ANANDA)
    .single();
  profilAsli = {
    alamat: (klien!.alamat as string) ?? "",
    lat: klien!.alamat_lat as number | null,
    lon: klien!.alamat_lon as number | null,
  };
});

beforeEach(async () => {
  ref.sesi = sesiKlien;
  // Profil Ananda diberi alamat + pin yang sudah "dibenarkan admin".
  await admin
    .from("clients")
    .update({ alamat: ALAMAT_PROFIL, alamat_lat: LAT_PIN, alamat_lon: LON_PIN })
    .eq("id", ANANDA);
  await admin.from("booking_requests").delete().eq("client_id", ANANDA).eq("status", "menunggu");
  await admin
    .from("geocode_cache")
    .delete()
    .in("alamat_normal", [normalkanAlamat(ALAMAT_PROFIL), normalkanAlamat(ALAMAT_LAIN)]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await admin.from("booking_requests").delete().eq("client_id", ANANDA).eq("status", "menunggu");
  await admin
    .from("clients")
    .update({ alamat: profilAsli.alamat, alamat_lat: profilAsli.lat, alamat_lon: profilAsli.lon })
    .eq("id", ANANDA);
  await admin
    .from("geocode_cache")
    .delete()
    .in("alamat_normal", [normalkanAlamat(ALAMAT_PROFIL), normalkanAlamat(ALAMAT_LAIN)]);
});

function pengajuan(alamat: string): FormData {
  const f = new FormData();
  f.set("layanan", serviceId);
  f.set("varian", variantId);
  f.set("tanggal", hariIniJakarta());
  f.set("waktu", "pagi");
  f.set("alamat", alamat);
  return f;
}

describe("pewarisan koordinat pada pengajuan klien", () => {
  it("alamat IDENTIK dengan profil mewarisi pin, tanpa menembak Nominatim", async () => {
    const nominatim = stubNominatim();

    const hasil = await ajukanJadwal(pengajuan(ALAMAT_PROFIL));
    expect(hasil.ok).toBe(true);
    expect(nominatim).not.toHaveBeenCalled();

    const { data } = await admin
      .from("booking_requests")
      .select("alamat_lat, alamat_lon")
      .eq("client_id", ANANDA)
      .eq("status", "menunggu")
      .single();
    expect(data!.alamat_lat).toBeCloseTo(LAT_PIN, 6);
    expect(data!.alamat_lon).toBeCloseTo(LON_PIN, 6);
  });

  it("beda huruf besar & spasi TETAP mewarisi", async () => {
    const nominatim = stubNominatim();
    const hasil = await ajukanJadwal(pengajuan(`  ${ALAMAT_PROFIL.toUpperCase()}  `));
    expect(hasil.ok).toBe(true);
    expect(nominatim).not.toHaveBeenCalled();
  });

  it("alamat BERBEDA jatuh kembali ke geocoding — batas spec T6", async () => {
    const nominatim = stubNominatim();

    const hasil = await ajukanJadwal(pengajuan(ALAMAT_LAIN));
    expect(hasil.ok).toBe(true);
    expect(nominatim).toHaveBeenCalledTimes(1);

    const { data } = await admin
      .from("booking_requests")
      .select("alamat_lat, alamat_lon")
      .eq("client_id", ANANDA)
      .eq("status", "menunggu")
      .single();
    // Hasil geocoding, BUKAN pin profil — mitra tidak boleh dikirim ke rumahnya
    // untuk sesi yang dipesan di alamat lain.
    expect(data!.alamat_lat).toBeCloseTo(-7.1111, 6);
    expect(data!.alamat_lon).toBeCloseTo(112.1111, 6);
  });

  it("profil TANPA pin tetap menggeocode walau alamatnya identik", async () => {
    await admin.from("clients").update({ alamat_lat: null, alamat_lon: null }).eq("id", ANANDA);
    const nominatim = stubNominatim();

    const hasil = await ajukanJadwal(pengajuan(ALAMAT_PROFIL));
    expect(hasil.ok).toBe(true);
    expect(nominatim).toHaveBeenCalledTimes(1);
  });
});
