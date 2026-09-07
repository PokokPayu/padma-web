/**
 * Pin yang dijatuhkan manusia mengalahkan geocoding — dan MENGHAPUS
 * panggilannya, bukan sekadar mengabaikan hasilnya.
 *
 * Menanyakan alamat yang jawabannya sudah pasti dibuang membakar kuota gratis
 * milik pihak lain, dan pada volume nyata itulah yang memicu pemblokiran.
 *
 * Catatan untuk pembaca berikutnya: assertion jumlah panggilan di sini TIDAK
 * bergantung pada apakah `geocodeAlamat` bertingkat atau tidak. Setiap stub di
 * berkas ini menjawab KETEMU pada panggilan pertama, dan tingkat berikutnya
 * hanya dicoba ketika tingkat sebelumnya kosong. Melonggarkannya menjadi
 * `toHaveBeenCalled()` membuang justru yang dijaganya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

// Lapisan action memakai sesi pengguna; di vitest tidak ada cookie, jadi klien
// ber-sesi sungguhan disuntikkan — RLS dan requireRole tetap berjalan apa
// adanya. Pola ini disalin dari tests/admin-mitra.test.ts.
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

const { simpanMitra } = await import("@/app/admin/mitra/aksi");

const NAMA_PIN = "PAD-UJI Mitra Berpin";
const NAMA_TANPA_PIN = "PAD-UJI Mitra Tanpa Pin";
const ALAMAT = "PAD-UJI Jl. Pin Menang No. 1, Malang";

/**
 * Menghitung panggilan Nominatim TANPA membajak panggilan Supabase lokal.
 * `vi.stubGlobal` menimpa `globalThis.fetch` sepenuhnya, jadi mock yang
 * menjawab apa saja akan ikut membajak select/upsert `geocode_cache`.
 */
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

let sesiAdmin: SupabaseClient;

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  // Cache yang terisi membuat geocoding TIDAK memanggil fetch — uji "tanpa
  // pin" akan lulus karena alasan yang salah. Dibersihkan setiap kali.
  await admin.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(ALAMAT));
  await admin.from("partners").delete().in("nama", [NAMA_PIN, NAMA_TANPA_PIN]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await admin.from("partners").delete().in("nama", [NAMA_PIN, NAMA_TANPA_PIN]);
  await admin.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(ALAMAT));
});

function formulir(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

describe("pin menang atas geocoding", () => {
  it("pin di FormData tersimpan apa adanya, dan Nominatim TIDAK dipanggil", async () => {
    const nominatim = stubNominatim();

    const hasil = await simpanMitra(
      formulir({ nama: NAMA_PIN, no_hp: "0812", alamat: ALAMAT, lat: "-7.9666", lon: "112.6326" }),
    );
    expect(hasil.ok).toBe(true);
    expect(nominatim).not.toHaveBeenCalled();

    const { data } = await admin.from("partners").select("lat, lon").eq("nama", NAMA_PIN).single();
    // Nilai pin, BUKAN -7.1111/112.1111 yang dijawab Nominatim palsu di atas.
    expect(data!.lat).toBeCloseTo(-7.9666, 6);
    expect(data!.lon).toBeCloseTo(112.6326, 6);
  });

  it("tanpa pin, jalur geocoding lama tetap berjalan utuh", async () => {
    const nominatim = stubNominatim();

    const hasil = await simpanMitra(
      formulir({ nama: NAMA_TANPA_PIN, no_hp: "0812", alamat: ALAMAT }),
    );
    expect(hasil.ok).toBe(true);
    expect(nominatim).toHaveBeenCalledTimes(1);

    const { data } = await admin
      .from("partners")
      .select("lat, lon")
      .eq("nama", NAMA_TANPA_PIN)
      .single();
    expect(data!.lat).toBeCloseTo(-7.1111, 6);
    expect(data!.lon).toBeCloseTo(112.1111, 6);
  });

  it("pin kosong TIDAK menggagalkan penyimpanan alamat (Ruling 9 tetap hidup)", async () => {
    const nominatim = stubNominatim();
    // Nominatim menjawab "tidak ketemu" — alamat tetap harus tersimpan.
    nominatim.mockImplementation(
      async () =>
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const hasil = await simpanMitra(
      formulir({ nama: NAMA_TANPA_PIN, no_hp: "0812", alamat: ALAMAT, lat: "", lon: "" }),
    );
    expect(hasil.ok).toBe(true);

    const { data } = await admin
      .from("partners")
      .select("alamat, lat, lon")
      .eq("nama", NAMA_TANPA_PIN)
      .single();
    expect(data!.alamat).toBe(ALAMAT);
    expect(data!.lat).toBeNull();
    expect(data!.lon).toBeNull();
  });
});
