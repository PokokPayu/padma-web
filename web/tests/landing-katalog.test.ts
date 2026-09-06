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

// Tarif VARIAN_60 dipaku ke angka HARFIAH (bukan sekadar "non-null vs null")
// supaya diperiksa dua hal sekaligus: (1) pemilihan baris ber-`berlaku_sejak`
// TERBESAR benar-benar bekerja saat satu varian punya BANYAK baris tarif
// (keadaan NORMAL untuk `variant_rates` yang append-only, bukan tepi) — dan
// (2) `bacaKatalog()` memetakan kolom dengan benar (harga_klien harfiah
// beda dari honor_mitra harfiah, jadi keduanya tertukar akan tertangkap).
const HARGA_60 = 350_000;
const CORET_60 = 425_000;
const HARGA_60_LAMA = 200_000; // tarif LAMPAU — harus KALAH oleh yang baru

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
    { variant_id: VARIAN_60, harga_klien: HARGA_60, harga_coret: CORET_60, honor_mitra: 150_000 },
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

  // Baris tarif KEDUA untuk VARIAN_60, bertanggal LAMPAU — `variant_rates`
  // append-only berarti "satu varian, banyak baris" adalah keadaan NORMAL,
  // bukan tepi, dan tanpa baris ini cabang
  // `h.berlaku_sejak > ada.berlaku_sejak` di `bacaKatalog()` tidak pernah
  // benar-benar dievaluasi (fixture lain di berkas ini semuanya satu baris
  // per varian). Lewat SERVICE ROLE: `guard_tarif_varian_maju` hanya
  // menyasar peran API (anon/authenticated/authenticator), jadi penyisipan
  // tanggal mundur ini diterima — persis pola yang sama dipakai
  // `tests/owner-tarif.test.ts` untuk menyemai tarif pekan lalu.
  const { error: errorTarifLama } = await admin.from("variant_rates").insert({
    variant_id: VARIAN_60,
    harga_klien: HARGA_60_LAMA,
    harga_coret: null,
    honor_mitra: 60_000,
    berlaku_sejak: "2020-01-01",
  });
  if (errorTarifLama) throw errorTarifLama;
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

  it("harga berlaku dipilih dari berlaku_sejak TERBESAR, bukan tarif lampau", async () => {
    const layanan = (await bacaKatalog())
      .flatMap((f) => f.layanan)
      .find((l) => l.id === LAYANAN_BERVARIAN)!;
    const v60 = layanan.varian.find((v) => v.label === "60 menit")!;
    // VARIAN_60 punya DUA baris tarif (lampau 2020-01-01 & hari ini). Bila
    // pemilihannya salah — baris PERTAMA yang dikembalikan PostgREST, atau
    // yang paling AWAL alih-alih paling BARU — nilai di sini jatuh ke tarif
    // lampau (200.000, tanpa harga_coret) alih-alih tarif berlaku (350.000
    // dicoret dari 425.000). Nilainya dipaku harfiah, bukan sekadar
    // "beda dari null", supaya kolom yang tertukar (mis. honor_mitra masuk
    // ke hargaKlien) ikut tertangkap.
    expect(v60.hargaKlien).toBe(HARGA_60);
    expect(v60.hargaCoret).toBe(CORET_60);
    expect(v60.hargaKlien).not.toBe(HARGA_60_LAMA);
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

/**
 * `supabase/config.toml` menyetel `max_rows = 1000`: PostgREST memotong SETIAP
 * bacaan tanpa `.limit()` di baris itu, SENYAP — tanpa error, tanpa kolom
 * "terpotong". `variant_rates` bersifat APPEND-ONLY SELAMANYA (satu perubahan
 * harga = satu baris baru yang tidak pernah dihapus), jadi ini bukan skenario
 * eksotis: satu keputusan seperti "akhiri soft launch" menambah puluhan baris
 * sekaligus, dan proyek ini akan melewati 1000 baris riwayat harga dalam
 * hitungan tahun, bukan dekade.
 *
 * Fixture di bawah menyemai >1000 baris SUNGGUHAN (bukan mengira-ngira dari
 * kode) untuk membuktikan bacaKatalog() tetap benar pada skala nyata, bukan
 * hanya lolos pada dua baris seperti fixture VARIAN_60 di atas. Penyisipannya
 * cepat (satu INSERT bertumpuk, terukur <1 detik pada mesin ini) jadi TIDAK
 * ada alasan mengecilkan cakupan uji ini ke sampel kecil.
 */
describe("katalog publik pada skala >1000 baris variant_rates (max_rows PostgREST)", () => {
  const LAYANAN_BANJIR = "11111111-1111-1111-1111-1111111119f1";
  const VARIAN_BANJIR = "11111111-1111-1111-1111-1111111119f2";
  // Lebih dari max_rows (1000) sendirian — tidak bergantung pada berapa baris
  // yang kebetulan ada di tabel dari fixture lain saat uji ini berjalan.
  const JUMLAH_BARIS = 1050;

  async function bersihkan() {
    await admin.from("variant_rates").delete().eq("variant_id", VARIAN_BANJIR);
    await admin.from("service_variants").delete().eq("id", VARIAN_BANJIR);
    await admin.from("services").delete().eq("id", LAYANAN_BANJIR);
  }

  it("bacaKatalog memulangkan harga TERBARU walau variant_rates varian ini sendiri melebihi max_rows", async () => {
    await bersihkan();
    try {
      await admin.from("services").insert({
        id: LAYANAN_BANJIR,
        phase_id: "kehamilan",
        nama: "PAD-UJI Layanan Banjir Tarif",
        aktif: true,
      });
      const { error: errorVarian } = await admin.from("service_variants").insert({
        id: VARIAN_BANJIR,
        service_id: LAYANAN_BANJIR,
        label: "",
        urutan: 0,
        aktif: true,
      });
      if (errorVarian) throw errorVarian;

      // `berlaku_sejak` unik per (variant_id, tanggal) — JUMLAH_BARIS tanggal
      // BERBEDA, terurut MENAIK (lampau -> kemarin), disisipkan dalam SATU
      // pernyataan INSERT sehingga baris ber-`berlaku_sejak` TERBARU adalah
      // baris FISIK TERAKHIR yang ditulis. Tanpa `.order()` di sisi baca,
      // PostgREST/Postgres tidak berjanji apa pun soal urutan pengembalian —
      // tetapi pada heap yang baru ditulis begini, baris terakhir itulah yang
      // pertama tersingkir saat dipotong ke 1000 baris pertama. Itu sudah
      // diverifikasi manual di luar suite ini (lihat laporan gelombang
      // perbaikan): TANPA `.order()`, harga yang lolos ke `bacaKatalog()`
      // adalah harga dari ~2 bulan lalu, BUKAN harga kemarin.
      const kemarin = new Date(Date.now() - 86_400_000);
      const baris = Array.from({ length: JUMLAH_BARIS }, (_, i) => {
        const tanggal = new Date(kemarin.getTime() - (JUMLAH_BARIS - 1 - i) * 86_400_000);
        return {
          variant_id: VARIAN_BANJIR,
          harga_klien: 100_000 + i,
          harga_coret: null,
          honor_mitra: 50_000,
          berlaku_sejak: tanggal.toISOString().slice(0, 10),
        };
      });
      const hargaTerbaruSeharusnya = baris[baris.length - 1].harga_klien;

      const { error: errorTarif } = await admin.from("variant_rates").insert(baris);
      if (errorTarif) throw errorTarif;

      const katalog = await bacaKatalog();
      const varian = katalog
        .flatMap((f) => f.layanan)
        .find((l) => l.id === LAYANAN_BANJIR)?.varian[0];

      // Bila ini gagal dengan "varian === undefined": harga TERBARU varian ini
      // jatuh di luar 1000 baris pertama yang dikembalikan PostgREST, dan
      // `bacaKatalog()` menyaringnya sebagai "tak bertarif" — persis TEMUAN 1(a).
      expect(varian).toBeDefined();
      expect(varian!.hargaKlien).toBe(hargaTerbaruSeharusnya);
    } finally {
      await bersihkan();
    }
  });
});
