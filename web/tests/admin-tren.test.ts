/**
 * Tren sesi selesai per pekan (`src/lib/admin/tren.ts`).
 *
 * Tiga kelas regresi yang tidak menghasilkan error:
 *
 *  1. Pekan kosong hilang. `hitungRekap` owner mengelompokkan sesi dan
 *     menghasilkan ember hanya untuk pekan yang PUNYA sesi. Bila tren admin
 *     meniru pola itu, delapan pekan akan tampil sebagai enam batang dan
 *     trennya berbohong tanpa satu pun angka yang salah.
 *  2. Service role. Di bawahnya `user_role()` mengembalikan 'klien' dan RLS
 *     tidak ikut diperiksa — angkanya tetap keluar, untuk siapa pun.
 *  3. Money firewall. Berkas ini tidak boleh menyentuh tabel uang sama sekali.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { awalPekan, geserHari } from "@/lib/owner/pekan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const admin = createAdminSupabase();

const KLIEN_UJI = "44444444-4444-4444-4444-4444444444f7";
const PADMA_ID_UJI = "PAD-UJI-0007";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const SESI = {
  pekanIni: "66666666-6666-6666-6666-6666666671f7",
  pekanIniDua: "66666666-6666-6666-6666-6666666672f7",
  duaPekanLalu: "66666666-6666-6666-6666-6666666673f7",
  terjadwal: "66666666-6666-6666-6666-6666666674f7",
  jauhLampau: "66666666-6666-6666-6666-6666666675f7",
};

const HARI_INI = hariIniJakarta();
const SENIN = awalPekan(HARI_INI);
const SENIN_DUA_LALU = geserHari(SENIN, -14);
// Di luar jendela 8 pekan — tidak boleh ikut terhitung.
const JAUH_LAMPAU = geserHari(SENIN, -70);

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("sessions").delete().eq("id", id);
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
}

const { trenSesiSelesai } = await import("@/lib/admin/tren");

type Titik = Awaited<ReturnType<typeof trenSesiSelesai>>[number];

let dasar: Titik[];
let sesudah: Titik[];

beforeAll(async () => {
  await bersihkan();
  ref.sesi = await signInAs("admin@padma.test");
  dasar = await trenSesiSelesai(HARI_INI);

  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Tren",
    email: "uji-tren@padma.test",
    phase_id: "prekonsepsi",
  });

  const dasarSesi = {
    client_id: KLIEN_UJI,
    service_id: SVC,
    variant_id: await varianBaku(admin, SVC),
    partner_id: MITRA,
    status_bayar: "belum" as const,
    catatan: "",
    rekomendasi: "",
  };
  await admin.from("sessions").insert([
    { ...dasarSesi, id: SESI.pekanIni, tanggal: SENIN, status: "selesai" },
    { ...dasarSesi, id: SESI.pekanIniDua, tanggal: SENIN, status: "selesai" },
    { ...dasarSesi, id: SESI.duaPekanLalu, tanggal: SENIN_DUA_LALU, status: "selesai" },
    // Terjadwal, bukan selesai — tidak boleh ikut terhitung.
    { ...dasarSesi, id: SESI.terjadwal, tanggal: SENIN, status: "terjadwal" },
    { ...dasarSesi, id: SESI.jauhLampau, tanggal: JAUH_LAMPAU, status: "selesai" },
  ]);

  sesudah = await trenSesiSelesai(HARI_INI);
});

afterAll(bersihkan);

describe("trenSesiSelesai", () => {
  it("selalu memulangkan delapan pekan berurutan, termasuk yang kosong", () => {
    expect(sesudah).toHaveLength(8);
    for (let i = 1; i < sesudah.length; i++) {
      expect(sesudah[i].senin).toBe(geserHari(sesudah[i - 1].senin, 7));
    }
  });

  it("pekan berjalan adalah titik TERAKHIR, bukan pertama", () => {
    // Sumbu waktu membaca kiri ke kanan; pekan terbaru di kiri akan membuat
    // setiap tren terlihat terbalik.
    expect(sesudah[sesudah.length - 1].senin).toBe(SENIN);
  });

  it("menghitung hanya sesi berstatus selesai", () => {
    const iKini = sesudah.length - 1;
    expect(sesudah[iKini].jumlah).toBe(dasar[iKini].jumlah + 2);
  });

  it("menempatkan sesi pada pekannya sendiri", () => {
    const i = sesudah.findIndex((t) => t.senin === SENIN_DUA_LALU);
    expect(i).toBeGreaterThanOrEqual(0);
    const iDasar = dasar.findIndex((t) => t.senin === SENIN_DUA_LALU);
    expect(sesudah[i].jumlah).toBe(dasar[iDasar].jumlah + 1);
  });

  it("sesi di luar jendela tidak ikut terhitung", () => {
    expect(sesudah.some((t) => t.senin === JAUH_LAMPAU)).toBe(false);
    const total = sesudah.reduce((a, t) => a + t.jumlah, 0);
    const totalDasar = dasar.reduce((a, t) => a + t.jumlah, 0);
    // Tiga sesi selesai disisipkan, tetapi hanya tiga di dalam jendela...
    // dua pekan ini + satu dua pekan lalu = 3; yang jauh lampau di luar.
    expect(total).toBe(totalDasar + 3);
  });

  it("membawa label rentang pekan yang bisa dibaca manusia", () => {
    // Bukan sekadar "mengandung angka": tanggal Senin mentah (mis.
    // "2026-08-24") juga lolos /\d/ walau rentangPekan() tidak pernah
    // dipanggil. rentangPekan() selalu menyisipkan tanda hubung "–" di antara
    // dua ujung pekan (lihat src/lib/owner/pekan.ts), jadi memeriksa itu dan
    // memastikan hasilnya BUKAN sekadar salinan `senin` menutup celah itu.
    expect(sesudah[0].rentang).toMatch(/\d/);
    expect(sesudah[0].rentang).toContain("–");
    expect(sesudah[0].rentang).not.toBe(sesudah[0].senin);
  });

  it("jumlah pekan bisa diatur", async () => {
    expect(await trenSesiSelesai(HARI_INI, 4)).toHaveLength(4);
  });

  it("dihitung lewat sesi pengguna: klien tidak melihat tren siapa pun", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("ananda@padma.test");
    const milikKlien = await trenSesiSelesai(HARI_INI);
    ref.sesi = sebelumnya;
    // Klien hanya melihat sesinya sendiri; ia TIDAK boleh melihat sesi klien
    // uji di atas. Totalnya karena itu tidak boleh ikut bertambah tiga.
    const total = milikKlien.reduce((a, t) => a + t.jumlah, 0);
    const totalStaf = sesudah.reduce((a, t) => a + t.jumlah, 0);
    expect(total).toBeLessThan(totalStaf);
  });

  it("tidak ada service role, dan tidak menyentuh tabel uang", () => {
    const sumber = baca("src/lib/admin/tren.ts");
    expect(sumber).toContain("createServerSupabase");
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
    expect(sumber).not.toContain("service_rates");
    expect(sumber).not.toContain("variant_rates");
    expect(sumber).not.toContain("honor_marks");
    expect(sumber).not.toMatch(/Rp\s?\d|formatRupiah/);
  });
});
