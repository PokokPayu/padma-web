/**
 * Server action `perbaruiProfil` — pembungkus RPC `perbarui_profil_klien`.
 *
 * Pembagian tugas antara action dan RPC bukan selera:
 *   - RPC memutuskan APA yang boleh berubah (tiga kolom, koordinat hangus bila
 *     alamat berubah). Ia dijaga basis data dan berlaku juga bagi pemanggil
 *     yang melewati layar sama sekali;
 *   - action memutuskan apa yang boleh MASUK (validasi) dan mengisi koordinat
 *     sesudahnya lewat service role — jalur yang tidak bisa disentuh klien.
 *
 * Yang diuji di sini adalah bagian kedua, termasuk satu invarian yang mudah
 * hilang saat orang merapikan kode: Nominatim tidak boleh ditembak bila alamat
 * TIDAK berubah. Melanggarnya bukan cuma boros — ia menghanguskan koordinat
 * yang sudah dibenarkan manusia dan menggantinya dengan tebakan OSM.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { signInAs } from "./helpers/as-user";

const ANANDA = "44444444-4444-4444-4444-444444444401";
const ALAMAT_A = "Jl. Besar Ijen No. 77, Kota Malang";
const ALAMAT_B = "Jl. Veteran No. 8, Kota Malang";

const admin = createAdminSupabase();

// Lapisan passport memakai sesi pengguna (createServerSupabase). Di vitest
// tidak ada cookie, jadi klien ber-sesi sungguhan disuntikkan — RLS dan hak
// EXECUTE tetap yang menjadi penjaga, persis seperti di produksi.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

// `revalidatePath` melempar di luar konteks request Next ("static generation
// store missing"), jadi ia di-mock — dan jejaknya sekalian dipakai sebagai
// asersi: formulir pengajuan jadwal mengisi alamatnya dari profil ini, jadi
// lupa merevalidasi berarti klien disodori alamat lamanya sendiri.
const jejak = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejak.revalidate.push(p);
  },
}));

// `vi.stubGlobal` MENIMPA `globalThis.fetch` sepenuhnya — stub penuh akan ikut
// menjatuhkan panggilan Supabase lokal yang dipakai action ini sendiri. Pola
// sama dengan tests/admin-klien.test.ts: hanya URL Nominatim yang dijawab
// palsu, sisanya diteruskan ke fetch asli.
function stubNominatim(jawab: () => Promise<Response> | Response) {
  const asli = globalThis.fetch;
  const palsu = vi.fn(() => jawab());
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu() : asli(...args);
  });
  return palsu;
}

function jawabanNominatim(lat: string, lon: string) {
  return new Response(JSON.stringify([{ lat, lon }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

async function bacaAnanda() {
  const { data } = await admin
    .from("clients")
    .select("nama, no_hp, alamat, alamat_lat, alamat_lon")
    .eq("id", ANANDA)
    .single<{
      nama: string;
      no_hp: string;
      alamat: string;
      alamat_lat: number | null;
      alamat_lon: number | null;
    }>();
  return data!;
}

let semula: Awaited<ReturnType<typeof bacaAnanda>>;

beforeAll(async () => {
  ref.klien = await signInAs("ananda@padma.test");
  semula = await bacaAnanda();
});

beforeEach(async () => {
  jejak.revalidate.length = 0;
  // Cache geocoding menjawab SEBELUM Nominatim disentuh, termasuk menjawab
  // "gagal" untuk baris yang lat-nya NULL. Tanpa pembersihan ini, uji yang
  // menghitung tembakan Nominatim lulus/gagal tergantung uji mana yang jalan
  // lebih dulu — dan itu ketergantungan urutan yang tak terlihat.
  for (const a of [ALAMAT_A, ALAMAT_B]) {
    await admin.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(a));
  }
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await admin
    .from("clients")
    .update({
      nama: semula.nama,
      no_hp: semula.no_hp,
      alamat: semula.alamat,
      alamat_lat: semula.alamat_lat,
      alamat_lon: semula.alamat_lon,
    })
    .eq("id", ANANDA);
});

async function perbaruiProfil(fd: FormData) {
  const { perbaruiProfil } = await import("@/lib/passport/aksi-profil");
  return perbaruiProfil(fd);
}

describe("perbaruiProfil — jalur sukses", () => {
  it("menyimpan ketiga medan dan mengisi koordinat dari geocoding", async () => {
    const nominatim = stubNominatim(() => jawabanNominatim("-7.9666", "112.6326"));

    const hasil = await perbaruiProfil(
      formulir({ nama: "Ananda Putri", no_hp: "0812-0000-1111", alamat: ALAMAT_A }),
    );

    expect(hasil.ok).toBe(true);
    expect(nominatim).toHaveBeenCalledTimes(1);

    const kini = await bacaAnanda();
    expect(kini.nama).toBe("Ananda Putri");
    expect(kini.no_hp).toBe("0812-0000-1111");
    expect(kini.alamat).toBe(ALAMAT_A);
    expect(kini.alamat_lat).toBeCloseTo(-7.9666, 4);
    expect(kini.alamat_lon).toBeCloseTo(112.6326, 4);
  });

  it("merevalidasi halaman pengajuan jadwal, yang mengisi alamatnya dari profil", async () => {
    stubNominatim(() => jawabanNominatim("-7.9666", "112.6326"));

    await perbaruiProfil(
      formulir({ nama: "Ananda Putri", no_hp: "0812-0000-1111", alamat: ALAMAT_A }),
    );

    expect(jejak.revalidate).toContain("/passport/profil");
    expect(jejak.revalidate).toContain("/passport/ajukan");
  });

  it("tetap menyimpan alamat meski geocoding gagal (katup pengaman T6)", async () => {
    stubNominatim(async () => {
      throw new Error("jaringan mati");
    });

    const hasil = await perbaruiProfil(
      formulir({ nama: "Ananda Putri", no_hp: "0812-0000-1111", alamat: ALAMAT_B }),
    );

    expect(hasil.ok).toBe(true);
    const kini = await bacaAnanda();
    expect(kini.alamat).toBe(ALAMAT_B);
    expect(kini.alamat_lat).toBeNull();
  });
});

describe("perbaruiProfil — kapan Nominatim TIDAK boleh ditembak", () => {
  it("tidak menggeocode bila teks alamat tidak berubah", async () => {
    await admin
      .from("clients")
      .update({ alamat: ALAMAT_A, alamat_lat: -7.1, alamat_lon: 112.1 })
      .eq("id", ANANDA);
    const nominatim = stubNominatim(() => jawabanNominatim("-7.9666", "112.6326"));

    const hasil = await perbaruiProfil(
      formulir({ nama: "Nama Berubah", no_hp: "0812-0000-1111", alamat: ALAMAT_A }),
    );

    expect(hasil.ok).toBe(true);
    expect(nominatim).not.toHaveBeenCalled();

    // Koordinat yang sudah ada — kelak hasil pin admin — harus selamat.
    const kini = await bacaAnanda();
    expect(kini.nama).toBe("Nama Berubah");
    expect(kini.alamat_lat).toBe(-7.1);
    expect(kini.alamat_lon).toBe(112.1);
  });

  it("tidak menggeocode alamat kosong", async () => {
    const nominatim = stubNominatim(() => jawabanNominatim("-7.9666", "112.6326"));

    const hasil = await perbaruiProfil(
      formulir({ nama: "Ananda Putri", no_hp: "0812-0000-1111", alamat: "" }),
    );

    expect(hasil.ok).toBe(true);
    expect(nominatim).not.toHaveBeenCalled();
    const kini = await bacaAnanda();
    expect(kini.alamat).toBe("");
    expect(kini.alamat_lat).toBeNull();
  });
});

describe("perbaruiProfil — validasi", () => {
  it("menolak nama yang terlalu pendek tanpa menulis apa pun", async () => {
    const nominatim = stubNominatim(() => jawabanNominatim("-7.9666", "112.6326"));

    const hasil = await perbaruiProfil(
      formulir({ nama: "A", no_hp: "0812-0000-1111", alamat: ALAMAT_A }),
    );

    expect(hasil).toEqual({ ok: false, pesan: expect.stringContaining("Nama") });
    expect(nominatim).not.toHaveBeenCalled();
    const kini = await bacaAnanda();
    expect(kini.nama).toBe(semula.nama);
  });

  it("menolak alamat yang diisi tetapi terlalu pendek untuk dituju mitra", async () => {
    const hasil = await perbaruiProfil(
      formulir({ nama: "Ananda Putri", no_hp: "0812-0000-1111", alamat: "Jl. A" }),
    );

    expect(hasil.ok).toBe(false);
    const kini = await bacaAnanda();
    expect(kini.alamat).toBe(semula.alamat);
  });
});
