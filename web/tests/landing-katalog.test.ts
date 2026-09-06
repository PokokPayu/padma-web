import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { anonClient } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { bacaKatalog } from "@/lib/katalog";
import { bacaPengaturan } from "@/lib/settings";

const admin = createAdminSupabase();

// --- Fixture Task 8: varian bertingkat -----------------------------------
// Layanan PAD-UJI dengan TIGA varian aktif (60/90/120 menit, tarif berbeda,
// satu di antaranya ber-harga_coret) plus SATU varian NONAKTIF — supaya uji
// filter `aktif = true` punya sesuatu yang harus disingkirkan, bukan sekadar
// kebetulan tidak ada barisnya.
const LAYANAN_BERVARIAN = "11111111-1111-1111-1111-1111111118e1";
const LABEL_VARIAN_NONAKTIF = "PAD-UJI Varian Off-Season";

// Diinsert TIDAK berurutan (120, lalu 60, lalu 90) supaya uji "terurut
// menurut kolom urutan" benar-benar membuktikan sortir eksplisit, bukan
// kebetulan mengikuti urutan penyisipan/PostgREST.
const VARIAN_120 = "11111111-1111-1111-1111-2111111118e1"; // urutan 2
const VARIAN_60 = "11111111-1111-1111-1111-2111111118e2"; // urutan 0
const VARIAN_90 = "11111111-1111-1111-1111-2111111118e3"; // urutan 1
const VARIAN_OFF = "11111111-1111-1111-1111-2111111118e4"; // aktif = false

async function bersihkanFixtureVarian() {
  await admin
    .from("variant_rates")
    .delete()
    .in("variant_id", [VARIAN_120, VARIAN_60, VARIAN_90, VARIAN_OFF]);
  await admin.from("service_variants").delete().eq("service_id", LAYANAN_BERVARIAN);
  await admin.from("services").delete().eq("id", LAYANAN_BERVARIAN);
}

beforeAll(async () => {
  await bersihkanFixtureVarian();
  await admin.from("services").insert({
    id: LAYANAN_BERVARIAN,
    phase_id: "kehamilan",
    nama: "PAD-UJI Layanan Bervarian",
    aktif: true,
  });
  // Trigger `trg_terbitkan_varian_baku` menerbitkan satu varian baku otomatis
  // begitu baris `services` di atas disisipkan (id acak, tanpa tarif) — ia
  // dibiarkan hidup: tanpa harga di `harga_publik`, `bacaKatalog()` tidak
  // memulangkannya, persis seperti layanan lain yang belum bertarif.
  await admin.from("service_variants").insert([
    { id: VARIAN_120, service_id: LAYANAN_BERVARIAN, label: "", durasi_menit: 120, urutan: 2, aktif: true },
    { id: VARIAN_60, service_id: LAYANAN_BERVARIAN, label: "", durasi_menit: 60, urutan: 0, aktif: true },
    { id: VARIAN_90, service_id: LAYANAN_BERVARIAN, label: "", durasi_menit: 90, urutan: 1, aktif: true },
    {
      id: VARIAN_OFF,
      service_id: LAYANAN_BERVARIAN,
      label: LABEL_VARIAN_NONAKTIF,
      urutan: 3,
      aktif: false,
    },
  ]);
  const { error: errorTarif } = await admin.from("variant_rates").insert([
    { variant_id: VARIAN_60, harga_klien: 350_000, harga_coret: 425_000, honor_mitra: 150_000 },
    { variant_id: VARIAN_90, harga_klien: 450_000, harga_coret: null, honor_mitra: 180_000 },
    { variant_id: VARIAN_120, harga_klien: 550_000, harga_coret: null, honor_mitra: 220_000 },
    // Varian nonaktif TETAP diberi tarif — memastikan kegagalan uji "tidak
    // muncul" memang karena filter `aktif`, bukan kebetulan tak bertarif.
    { variant_id: VARIAN_OFF, harga_klien: 999_999, harga_coret: null, honor_mitra: 400_000 },
  ]);
  // Kegagalan fixture yang tidak diperiksa lolos sebagai "hijau" palsu: uji
  // di bawah akan gagal dengan pesan yang menyesatkan (array kosong) alih-alih
  // menunjuk akar masalahnya (mis. kolom NOT NULL yang lupa diisi).
  if (errorTarif) throw errorTarif;
});

afterAll(async () => {
  await bersihkanFixtureVarian();
});

describe("katalog publik", () => {
  it("pengunjung anonim bisa membaca phases (policy baca publik)", async () => {
    const { data, error } = await anonClient().from("phases").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBe(5);
  });

  it("pengunjung anonim bisa membaca services aktif", async () => {
    const { data, error } = await anonClient().from("services").select("id, nama");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });

  it("anon TETAP tidak bisa membaca data pasien", async () => {
    const { error } = await anonClient().from("clients").select("*");
    expect(error?.code).toBe("42501");
  });

  it("bacaKatalog mengembalikan 5 fase berurutan dengan layanannya", async () => {
    const katalog = await bacaKatalog();
    expect(katalog).toHaveLength(5);
    expect(katalog[0].namaSanskrit).toBe("Sankalpa");
    expect(katalog[0].urutan).toBe(1);
    expect(katalog[0].layanan.length).toBeGreaterThan(0);
  });

  it("bacaPengaturan mengembalikan nomor WA dua bentuk", async () => {
    const s = await bacaPengaturan();
    expect(s.nomorWaLink).toMatch(/^\d{10,15}$/); // internasional tanpa +
    expect(s.nomorWaTampilan).toMatch(/^0[\d-]+$/); // format lokal
  });

  it("varian nonaktif tidak muncul di katalog publik", async () => {
    const katalog = await bacaKatalog();
    const semua = katalog.flatMap((f) => f.layanan).flatMap((l) => l.varian);
    expect(semua.some((v) => v.label === LABEL_VARIAN_NONAKTIF)).toBe(false);
  });

  it("harga coret terbawa apa adanya; NULL berarti tanpa badge", async () => {
    const katalog = await bacaKatalog();
    const varian = katalog.flatMap((f) => f.layanan).flatMap((l) => l.varian);
    expect(varian.some((v) => v.hargaCoret !== null)).toBe(true);
    expect(varian.some((v) => v.hargaCoret === null)).toBe(true);
  });

  it("varian terurut menurut kolom urutan", async () => {
    const layanan = (await bacaKatalog())
      .flatMap((f) => f.layanan)
      .find((l) => l.id === LAYANAN_BERVARIAN)!;
    expect(layanan.varian.map((v) => v.label)).toEqual(["60 menit", "90 menit", "120 menit"]);
  });
});

/**
 * Policy baca publik membuka BARIS, bukan operasi. Batas itu diuji terpisah
 * supaya "landing bisa tampil" tidak pelan-pelan berubah menjadi "pengunjung
 * bisa menyunting katalog", dan supaya filter `aktif = true` tidak hilang
 * diam-diam (layanan yang sudah dinonaktifkan admin akan muncul kembali).
 */
describe("batas policy baca publik", () => {
  it("anon TIDAK bisa menulis katalog meski boleh membacanya", async () => {
    const anon = anonClient();

    const tambahFase = await anon
      .from("phases")
      .insert({ id: "palsu", nama_sanskrit: "X", nama: "X", urutan: 9 });
    expect(tambahFase.error?.code).toBe("42501");

    // uuid sentinel yang pasti tidak ada — filternya harus valid supaya yang
    // ditolak benar-benar HAK TABEL (42501), bukan sintaks uuid (22P02).
    const TAK_ADA = "00000000-0000-0000-0000-000000000000";

    const ubahLayanan = await anon
      .from("services")
      .update({ nama: "Disusupi" })
      .neq("id", TAK_ADA);
    expect(ubahLayanan.error?.code).toBe("42501");

    const hapusPaket = await anon.from("packages").delete().neq("id", TAK_ADA);
    expect(hapusPaket.error?.code).toBe("42501");
  });

  it("layanan yang dinonaktifkan hilang dari katalog publik, tetap terlihat server", async () => {
    const admin = createAdminSupabase();
    const { data: sebelum } = await anonClient().from("services").select("id");
    const target = sebelum![0].id as string;

    await admin.from("services").update({ aktif: false }).eq("id", target);
    try {
      const { data: sesudah, error } = await anonClient().from("services").select("id");
      expect(error).toBeNull();
      expect(sesudah!.length).toBe(sebelum!.length - 1);
      expect(sesudah!.map((s) => s.id)).not.toContain(target);

      // Barisnya tidak hilang — hanya tidak lagi dipublikasikan.
      const { data: internal } = await admin.from("services").select("id").eq("id", target);
      expect(internal).toHaveLength(1);

      const katalog = await bacaKatalog();
      expect(katalog.flatMap((f) => f.layanan)).toHaveLength(sebelum!.length - 1);
    } finally {
      await admin.from("services").update({ aktif: true }).eq("id", target);
    }
  });

  it("fase newborn ADA di katalog landing (5 fase) — pembatasan 4 fase hanya di skrining", async () => {
    const katalog = await bacaKatalog();
    expect(katalog.map((f) => f.id)).toEqual([
      "prekonsepsi",
      "kehamilan",
      "nifas",
      "menopause",
      "newborn",
    ]);
  });
});
