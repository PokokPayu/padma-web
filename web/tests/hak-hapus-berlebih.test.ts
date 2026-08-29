import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * HAK DELETE BERLEBIH — sisa yang tidak ikut tercabut di Plan 3A.
 *
 * Migration `pengerasan_admin` mencabut DELETE dari `sessions`, `clients`,
 * `client_packages`, dan `screenings`. Yang TIDAK ikut tercabut — dan
 * direproduksi lewat REST sebagai admin sungguhan, bukan dibaca dari policy:
 *
 *   A. `materials`. DELETE -> HTTP 204, barisnya benar-benar hilang, dan
 *      `material_chapters` + `material_videos` ikut tersapu ON DELETE CASCADE.
 *      Satu permintaan menghapus seluruh isi sebuah materi.
 *   B. `booking_requests`. DELETE -> barisnya lenyap tanpa jejak apa pun.
 *   C. `service_rates` & `honor_marks` masih memberi DELETE kepada
 *      `authenticated`.
 *   D. `partners`, `services`, `packages`, `phases`, `app_settings` — master
 *      data yang seluruhnya sudah punya bentuk pensiun sendiri.
 *
 * ===== PRINSIP YANG DIPAKAI MEMUTUSKAN =====
 * Klinik ini tidak punya alur bisnis "hapus rekam medis"; penonaktifan
 * diwakili kolom `aktif` atau status `batal`/`ditolak`. Karena itu DELETE
 * dicabut bila penghapusan MENGHANCURKAN RIWAYAT atau BUKTI, atau bila ia
 * tidak pernah menjadi pekerjaan sah admin — dan DIPERTAHANKAN bila ia memang
 * penyuntingan isi yang wajar dan tidak menghancurkan apa pun.
 *
 * Karena itu berkas ini memuat DUA jenis assertion yang sama pentingnya:
 * "harus ditolak" DAN "harus tetap boleh". Pencabutan yang membabi buta akan
 * membuat kelompok kedua merah.
 *
 * ===== DUA SARAN AUDITOR YANG SENGAJA TIDAK DIJALANKAN =====
 * Keduanya dijaga di sini sebagai regression guard supaya tidak "diperbaiki"
 * oleh pembaca berikutnya — lihat describe terakhir. Ringkasnya: owner login
 * sebagai peran SQL `authenticated` yang SAMA dengan admin dan klien, jadi
 * mencabut hak tabel `authenticated` dari tabel uang melumpuhkan satu-satunya
 * orang yang berhak melihatnya; dan hak KOLOM mengikat KEHADIRAN kolom di
 * payload, sedangkan trigger mengikat PERUBAHAN NILAI — hanya yang kedua yang
 * membiarkan panel admin mengirim baris utuh.
 */

const svc = createAdminSupabase();

const LAYANAN_SEED = "11111111-1111-1111-1111-111111111101";
const MITRA_SEED = "33333333-3333-3333-3333-333333333301";
const KLIEN_RINA = "44444444-4444-4444-4444-444444444402";

/** Fixture milik berkas ini sendiri; semuanya berawalan PAD-UJI. */
const LAYANAN_UJI = "11111111-1111-1111-1111-1111111119a1";
const PAKET_UJI = "22222222-2222-2222-2222-2222222229a1";
const MITRA_UJI = "33333333-3333-3333-3333-3333333339a1";
const MATERI_UJI = "77777777-7777-7777-7777-7777777779a1";
const BAB_UJI = "88888888-8888-8888-8888-8888888889a1";
const TARIF_UJI = "99999999-9999-9999-9999-9999999999a1";
const HONOR_UJI = "99999999-9999-9999-9999-9999999999b1";

/** Jauh di depan supaya tidak bertabrakan dengan tanggal test lain. */
const TGL_PERMINTAAN = "2027-03-11";
const PEKAN_HONOR = "2027-03-08";

let permintaanUji: string;

beforeAll(async () => {
  await svc.from("services").upsert(
    {
      id: LAYANAN_UJI,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Hak Hapus",
      deskripsi: "fixture",
      aktif: true,
    },
    { onConflict: "id" },
  );
  await svc.from("packages").upsert(
    { id: PAKET_UJI, service_id: LAYANAN_UJI, nama: "PAD-UJI Paket", jumlah_sesi: 3, aktif: true },
    { onConflict: "id" },
  );
  await svc.from("partners").upsert(
    { id: MITRA_UJI, nama: "PAD-UJI Bidan", no_hp: "0800-0000-0000", aktif: true },
    { onConflict: "id" },
  );

  // Materi digantung pada LAYANAN_UJI, bukan layanan seed: tidak ada klien
  // yang punya sesi `selesai` di sana, jadi daftar materi passport tidak
  // berubah sedikit pun selama berkas ini berjalan.
  await svc.from("materials").upsert(
    {
      id: MATERI_UJI,
      service_id: LAYANAN_UJI,
      judul: "PAD-UJI Materi",
      tipe: "ebook",
      deskripsi: "fixture",
      aktif: true,
    },
    { onConflict: "id" },
  );
  await svc.from("material_chapters").upsert(
    { id: BAB_UJI, material_id: MATERI_UJI, urutan: 1, judul: "PAD-UJI Bab", isi: "isi" },
    { onConflict: "id" },
  );
  await svc.from("material_videos").upsert(
    { material_id: MATERI_UJI, url: "https://vimeo.com/pad-uji-hak-hapus" },
    { onConflict: "material_id" },
  );

  await svc.from("service_rates").upsert(
    { id: TARIF_UJI, service_id: LAYANAN_UJI, harga_klien: 111000, honor_mitra: 55000 },
    { onConflict: "id" },
  );
  await svc.from("honor_marks").upsert(
    { id: HONOR_UJI, partner_id: MITRA_UJI, week_start: PEKAN_HONOR },
    { onConflict: "id" },
  );

  await svc
    .from("booking_requests")
    .delete()
    .eq("client_id", KLIEN_RINA)
    .eq("tanggal", TGL_PERMINTAAN);
  const { data, error } = await svc
    .from("booking_requests")
    .insert({
      client_id: KLIEN_RINA,
      service_id: LAYANAN_SEED,
      tanggal: TGL_PERMINTAAN,
      preferensi_waktu: "pagi",
      catatan: "PAD-UJI permintaan",
      status: "menunggu",
    })
    .select("id")
    .single();
  if (error) throw new Error(`fixture permintaan gagal: ${error.message}`);
  permintaanUji = data!.id;
});

afterAll(async () => {
  // Sekaligus KONTROL POSITIF: pembersihan fixture memakai service role, jadi
  // seluruh pencabutan di migration ini tidak boleh menyentuhnya. Bila DELETE
  // service role ikut tercabut, berkas ini meninggalkan sampah dan test lain
  // yang menghitung baris akan merah — persis sinyal yang diinginkan.
  await svc
    .from("booking_requests")
    .delete()
    .eq("client_id", KLIEN_RINA)
    .eq("tanggal", TGL_PERMINTAAN);
  await svc.from("honor_marks").delete().eq("id", HONOR_UJI);
  await svc.from("service_rates").delete().eq("id", TARIF_UJI);
  await svc.from("material_videos").delete().eq("material_id", MATERI_UJI);
  await svc.from("material_chapters").delete().eq("material_id", MATERI_UJI);
  await svc.from("materials").delete().eq("id", MATERI_UJI);
  await svc.from("partners").delete().eq("id", MITRA_UJI);
  await svc.from("packages").delete().eq("id", PAKET_UJI);
  await svc.from("services").delete().eq("id", LAYANAN_UJI);
});

// ---------------------------------------------------------------------------
// (A) MATERI — cascade menyapu bab & video
// ---------------------------------------------------------------------------
describe("materi tidak bisa dihapus staf (cascade menyapu bab & video)", () => {
  it("admin ditolak menghapus materi, dan isinya utuh sesudahnya", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("materials").delete().eq("id", MATERI_UJI);
    expect(error?.code).toBe("42501");

    // 42501 tanpa pembacaan ulang tidak membuktikan apa pun: yang dijaga
    // bukan kode errornya, melainkan bab & video yang tidak ikut tersapu.
    const { data: materi } = await svc
      .from("materials")
      .select("id")
      .eq("id", MATERI_UJI)
      .maybeSingle();
    expect(materi).not.toBeNull();

    const { data: bab } = await svc
      .from("material_chapters")
      .select("id")
      .eq("material_id", MATERI_UJI);
    expect(bab).toHaveLength(1);

    const { data: video } = await svc
      .from("material_videos")
      .select("material_id")
      .eq("material_id", MATERI_UJI);
    expect(video).toHaveLength(1);
  });

  it("owner pun ditolak (peran SQL-nya sama; ini bukan pagar khusus admin)", async () => {
    const o = await signInAs("owner@padma.test");
    const { error } = await o.from("materials").delete().eq("id", MATERI_UJI);
    expect(error?.code).toBe("42501");
  });

  it("KONTROL: admin TETAP bisa menonaktifkan & menyunting materi", async () => {
    const a = await signInAs("admin@padma.test");

    const { data: mati, error: eMati } = await a
      .from("materials")
      .update({ aktif: false })
      .eq("id", MATERI_UJI)
      .select("id, aktif");
    expect(eMati).toBeNull();
    expect(mati).toHaveLength(1);
    expect(mati![0].aktif).toBe(false);

    const { data: ubah, error: eUbah } = await a
      .from("materials")
      .update({ judul: "PAD-UJI Materi (disunting)", aktif: true })
      .eq("id", MATERI_UJI)
      .select("id, judul, aktif");
    expect(eUbah).toBeNull();
    expect(ubah![0].judul).toBe("PAD-UJI Materi (disunting)");
    expect(ubah![0].aktif).toBe(true);
  });

  it("KONTROL: penyuntingan ISI materi tetap hidup — bab & video masih boleh dihapus", async () => {
    // Keputusan yang disengaja, bukan kelalaian. Bab dan URL video adalah ISI
    // yang ditulis klinik sendiri: tidak ada riwayat klien, tidak ada bukti,
    // dan semuanya bisa ditulis ulang. Menghapus satu bab yang keliru adalah
    // penyuntingan wajar, dan `material_videos` yang berelasi 1:1 hanya bisa
    // "dilepas dari materi" dengan menghapus barisnya.
    const a = await signInAs("admin@padma.test");

    const { data: babBaru } = await svc
      .from("material_chapters")
      .insert({ material_id: MATERI_UJI, urutan: 9, judul: "PAD-UJI Bab Keliru", isi: "x" })
      .select("id")
      .single();

    const { error: eBab } = await a
      .from("material_chapters")
      .delete()
      .eq("id", babBaru!.id);
    expect(eBab).toBeNull();
    const { data: sisaBab } = await svc
      .from("material_chapters")
      .select("id")
      .eq("id", babBaru!.id)
      .maybeSingle();
    expect(sisaBab).toBeNull();

    const { error: eVideo } = await a
      .from("material_videos")
      .delete()
      .eq("material_id", MATERI_UJI);
    expect(eVideo).toBeNull();

    await svc
      .from("material_videos")
      .upsert(
        { material_id: MATERI_UJI, url: "https://vimeo.com/pad-uji-hak-hapus" },
        { onConflict: "material_id" },
      );
  });
});

// ---------------------------------------------------------------------------
// (B) PERMINTAAN JADWAL — antrean adalah bukti klien
// ---------------------------------------------------------------------------
describe("permintaan jadwal tidak bisa dihapus staf", () => {
  /**
   * Migration `pengerasan_admin` sengaja MEMPERTAHANKAN DELETE di sini dengan
   * alasan "ia antrean, bukan rekam medis". Keputusan itu dibalik, dan
   * alasannya bukan selera:
   *
   *  1. Baris ini terbaca KLIEN (policy "booking: klien baca miliknya"). Ia
   *     satu-satunya bukti bahwa klien pernah meminta tanggal tertentu;
   *     menghapusnya membuat permintaan lenyap dari passport pemiliknya
   *     sendiri, tanpa satu pun notifikasi.
   *  2. Bentuk penolakan SUDAH ADA: status 'ditolak'. Ia mengosongkan antrean
   *     admin, melepaskan index `booking_requests_antrean_unik` (parsial pada
   *     status='menunggu'), dan mengembalikan kuota klien — persis efek yang
   *     dikejar DELETE, tetapi dengan barisnya tetap ada.
   *  3. FK `sessions.booking_request_id` sudah menahan penghapusan permintaan
   *     yang SUDAH menjadi sesi (23503). Artinya yang tersisa bisa dihapus
   *     justru hanya permintaan yang BELUM dijawab — kelompok yang paling
   *     mungkin disengketakan.
   */
  it("admin ditolak menghapus permintaan, dan barisnya masih ada", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("booking_requests").delete().eq("id", permintaanUji);
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("booking_requests")
      .select("id, status")
      .eq("id", permintaanUji)
      .maybeSingle();
    expect(data).not.toBeNull();
    expect(data!.status).toBe("menunggu");
  });

  it("klien pun tidak bisa menghapus permintaannya sendiri", async () => {
    // Bukan sekadar kelengkapan: bila klien boleh menghapus, ia bisa
    // mengosongkan kuota antreannya sendiri berulang kali dan membanjiri
    // admin — persis yang ditutup migration `pembatas_permintaan_jadwal`.
    const k = await signInAs("ananda@padma.test");
    const { error } = await k.from("booking_requests").delete().eq("id", permintaanUji);
    expect(error?.code).toBe("42501");
  });

  it("KONTROL: admin TETAP bisa MENOLAK permintaan, dan penolakan melepas antrean", async () => {
    const a = await signInAs("admin@padma.test");
    const { data, error } = await a
      .from("booking_requests")
      .update({ status: "ditolak" })
      .eq("id", permintaanUji)
      .select("id, status");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe("ditolak");

    // Index antrean unik bersifat parsial (status='menunggu'), jadi penolakan
    // benar-benar membebaskan slot yang sama untuk diajukan ulang — inilah
    // yang membuat DELETE tidak pernah dibutuhkan.
    const { error: eUlang } = await svc.from("booking_requests").insert({
      client_id: KLIEN_RINA,
      service_id: LAYANAN_SEED,
      tanggal: TGL_PERMINTAAN,
      preferensi_waktu: "pagi",
      catatan: "PAD-UJI permintaan ulang",
      status: "menunggu",
    });
    expect(eUlang).toBeNull();

    // Barisnya yang ditolak TETAP ada — itu intinya.
    const { data: jejak } = await svc
      .from("booking_requests")
      .select("id")
      .eq("id", permintaanUji)
      .maybeSingle();
    expect(jejak).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (C) MASTER DATA — semuanya sudah punya bentuk pensiun sendiri
// ---------------------------------------------------------------------------
describe("master data tidak bisa dihapus staf", () => {
  it("mitra: ditolak, dan barisnya masih ada", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("partners").delete().eq("id", MITRA_UJI);
    expect(error?.code).toBe("42501");
    const { data } = await svc.from("partners").select("id").eq("id", MITRA_UJI).maybeSingle();
    expect(data).not.toBeNull();
  });

  it("layanan & paket: ditolak, dan barisnya masih ada", async () => {
    const a = await signInAs("admin@padma.test");

    const { error: ePaket } = await a.from("packages").delete().eq("id", PAKET_UJI);
    expect(ePaket?.code).toBe("42501");
    const { data: paket } = await svc
      .from("packages")
      .select("id")
      .eq("id", PAKET_UJI)
      .maybeSingle();
    expect(paket).not.toBeNull();

    const { error: eLayanan } = await a.from("services").delete().eq("id", LAYANAN_UJI);
    expect(eLayanan?.code).toBe("42501");
    const { data: layanan } = await svc
      .from("services")
      .select("id")
      .eq("id", LAYANAN_UJI)
      .maybeSingle();
    expect(layanan).not.toBeNull();
  });

  it("fase: ditolak, dan barisnya masih ada", async () => {
    // Baris fase dibuat & dibereskan DI DALAM test ini: `phases` diperiksa
    // berjumlah tepat 5 oleh tests/landing-katalog.test.ts, jadi ia tidak
    // boleh menggantung sampai afterAll.
    const FASE_UJI = "pad-uji-fase";
    await svc
      .from("phases")
      .upsert(
        { id: FASE_UJI, nama_sanskrit: "PAD-UJI", nama: "PAD-UJI Fase", urutan: 99 },
        { onConflict: "id" },
      );
    try {
      const a = await signInAs("admin@padma.test");
      const { error } = await a.from("phases").delete().eq("id", FASE_UJI);
      expect(error?.code).toBe("42501");
      const { data } = await svc.from("phases").select("id").eq("id", FASE_UJI).maybeSingle();
      expect(data).not.toBeNull();
    } finally {
      await svc.from("phases").delete().eq("id", FASE_UJI);
    }
  });

  it("setelan aplikasi: ditolak, dan barisnya masih ada", async () => {
    // `nomor_wa` menggerakkan seluruh CTA WhatsApp di landing & wizard
    // skrining. Menghapusnya mematikan CTA itu tanpa satu pun error di layar;
    // tidak ada alur produk yang pernah menghapus setelan — hanya menimpanya.
    const KUNCI_UJI = "PAD-UJI-kunci";
    await svc.from("app_settings").upsert({ key: KUNCI_UJI, value: "x" }, { onConflict: "key" });
    try {
      const a = await signInAs("admin@padma.test");
      const { error } = await a.from("app_settings").delete().eq("key", KUNCI_UJI);
      expect(error?.code).toBe("42501");
      const { data } = await svc
        .from("app_settings")
        .select("key")
        .eq("key", KUNCI_UJI)
        .maybeSingle();
      expect(data).not.toBeNull();
    } finally {
      await svc.from("app_settings").delete().eq("key", KUNCI_UJI);
    }
  });

  it("KONTROL: pensiun lewat `aktif = false` TETAP bekerja untuk mitra, layanan, & paket", async () => {
    const a = await signInAs("admin@padma.test");

    for (const [tabel, id] of [
      ["partners", MITRA_UJI],
      ["services", LAYANAN_UJI],
      ["packages", PAKET_UJI],
    ] as const) {
      const { data, error } = await a
        .from(tabel)
        .update({ aktif: false })
        .eq("id", id)
        .select("id, aktif");
      expect(error, `${tabel} harus tetap bisa dinonaktifkan`).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].aktif).toBe(false);

      const { data: nyala } = await a
        .from(tabel)
        .update({ aktif: true })
        .eq("id", id)
        .select("aktif");
      expect(nyala![0].aktif).toBe(true);
    }
  });

  it("KONTROL: admin TETAP bisa membuat & menimpa master data (INSERT/UPDATE utuh)", async () => {
    const a = await signInAs("admin@padma.test");

    const { data: mitraBaru, error: eMitra } = await a
      .from("partners")
      .insert({ nama: "PAD-UJI Bidan Baru", no_hp: "0800-0000-0001" })
      .select("id")
      .single();
    expect(eMitra).toBeNull();
    expect(mitraBaru).not.toBeNull();

    const { error: eSetelan } = await a
      .from("app_settings")
      .upsert({ key: "PAD-UJI-tulis", value: "1" }, { onConflict: "key" });
    expect(eSetelan).toBeNull();

    // Service role tetap memegang DELETE — pembersihan fixture bergantung
    // padanya, dan itulah yang membuat pencabutan di atas tidak melumpuhkan
    // suite ini sendiri.
    const { error: eBersih } = await svc.from("partners").delete().eq("id", mitraBaru!.id);
    expect(eBersih).toBeNull();
    await svc.from("app_settings").delete().eq("key", "PAD-UJI-tulis");
  });
});

// ---------------------------------------------------------------------------
// (D) TABEL UANG — hanya verba DELETE yang dicabut
// ---------------------------------------------------------------------------
describe("tabel uang: DELETE dicabut, sisanya UTUH untuk owner", () => {
  it("owner ditolak menghapus tarif, dan barisnya masih ada", async () => {
    // `berlaku_sejak` membuat `service_rates` sebuah RIWAYAT harga yang
    // ditumpuk, bukan satu baris yang ditimpa: tarif lama adalah dasar honor
    // yang sudah terlanjur dibayarkan. Menghapusnya menulis ulang sejarah uang.
    const o = await signInAs("owner@padma.test");
    const { error } = await o.from("service_rates").delete().eq("id", TARIF_UJI);
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("service_rates")
      .select("id")
      .eq("id", TARIF_UJI)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it("owner ditolak menghapus tanda honor, dan barisnya masih ada", async () => {
    // `honor_marks` adalah BUKTI bahwa seorang mitra sudah dibayar untuk satu
    // pekan. Menghapusnya menghapus bukti pembayaran itu sendiri — sengketa
    // "pekan itu sudah dibayar atau belum" menjadi tidak bisa dijawab.
    const o = await signInAs("owner@padma.test");
    const { error } = await o.from("honor_marks").delete().eq("id", HONOR_UJI);
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("honor_marks")
      .select("id")
      .eq("id", HONOR_UJI)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it("KONTROL: owner TETAP bisa membaca, menambah, & mengubah rate card", async () => {
    const o = await signInAs("owner@padma.test");

    const { data: baca, error: eBaca } = await o
      .from("service_rates")
      .select("id, harga_klien, honor_mitra");
    expect(eBaca).toBeNull();
    expect(baca!.length).toBeGreaterThanOrEqual(10);

    const { data: tambah, error: eTambah } = await o
      .from("service_rates")
      .insert({
        service_id: LAYANAN_UJI,
        harga_klien: 222000,
        honor_mitra: 90000,
        berlaku_sejak: "2027-01-01",
      })
      .select("id")
      .single();
    expect(eTambah).toBeNull();

    const { data: ubah, error: eUbah } = await o
      .from("service_rates")
      .update({ harga_klien: 333000 })
      .eq("id", tambah!.id)
      .select("harga_klien");
    expect(eUbah).toBeNull();
    expect(ubah![0].harga_klien).toBe(333000);

    await svc.from("service_rates").delete().eq("id", tambah!.id);
  });

  it("KONTROL: owner TETAP bisa membaca, menandai, & mengubah honor", async () => {
    const o = await signInAs("owner@padma.test");

    const { data: baca, error: eBaca } = await o.from("honor_marks").select("id, week_start");
    expect(eBaca).toBeNull();
    expect(baca!.map((h) => h.id)).toContain(HONOR_UJI);

    const { data: tanda, error: eTanda } = await o
      .from("honor_marks")
      .insert({ partner_id: MITRA_SEED, week_start: PEKAN_HONOR })
      .select("id")
      .single();
    expect(eTanda).toBeNull();

    const { error: eUbah } = await o
      .from("honor_marks")
      .update({ dibayar_pada: "2027-03-09T00:00:00Z" })
      .eq("id", tanda!.id)
      .select("id");
    expect(eUbah).toBeNull();

    await svc.from("honor_marks").delete().eq("id", tanda!.id);
  });

  it("admin TETAP buta terhadap tabel uang (money firewall tidak ikut bergeser)", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: tarif } = await a.from("service_rates").select("harga_klien");
    expect(tarif ?? []).toHaveLength(0);
    const { data: honor } = await a.from("honor_marks").select("id");
    expect(honor ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (E) INVARIAN STRUKTURAL
// ---------------------------------------------------------------------------
describe("peta hak DELETE — struktural, bukan perilaku", () => {
  /**
   * Test perilaku hanya menjaga pintu yang sudah kita tahu ada. Daftar
   * EKSPLISIT di bawah menangkap pintu yang belum lahir: menambahkan DELETE
   * pada tabel apa pun akan merah di sini, dan pembacanya dipaksa menuliskan
   * alasannya di daftar ini — bukan diam-diam mewarisinya dari Supabase.
   */
  const BOLEH_DELETE = ["material_chapters", "material_videos"];

  it("hanya tabel penyuntingan ISI yang masih memberi DELETE ke authenticated", async () => {
    const baris = await querySql<{ table_name: string }>(`
      select g.table_name
        from information_schema.role_table_grants g
        join information_schema.tables t
          on t.table_schema = g.table_schema and t.table_name = g.table_name
       where g.table_schema = 'public'
         and g.grantee = 'authenticated'
         and g.privilege_type = 'DELETE'
         and t.table_type = 'BASE TABLE'
       order by 1`);
    expect(
      baris.map((b) => b.table_name),
      "Tabel baru mewarisi DELETE dari default privileges Supabase. Bila tabel " +
        "di daftar ini memang butuh DELETE oleh staf, tuliskan alasannya di " +
        "BOLEH_DELETE; bila tidak, cabut haknya di migration.",
    ).toEqual(BOLEH_DELETE);
  });

  it("anon tidak memegang DELETE di mana pun (tidak ikut bergeser)", async () => {
    const baris = await querySql<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
       where table_schema='public' and grantee='anon' and privilege_type='DELETE'
       order by 1`);
    expect(baris.map((b) => b.table_name)).toEqual([]);
  });

  it("service_role TETAP memegang DELETE (jalur seed & pembersihan test)", async () => {
    const baris = await querySql<{ n: string }>(`
      select count(*)::text as n from information_schema.role_table_grants
       where table_schema='public' and grantee='service_role' and privilege_type='DELETE'`);
    expect(Number(baris[0].n)).toBeGreaterThanOrEqual(15);
  });

  it("tabel BARU lahir TANPA DELETE untuk authenticated (sumbernya ikut ditutup)", async () => {
    // Tanpa ini temuan yang sama kambuh otomatis: setiap tabel Plan 3B lahir
    // dengan DELETE penuh karena Supabase memasang `alter default privileges
    // ... grant all on tables to authenticated`. Sengaja fail-closed dan
    // berisik — tabel yang memang butuh DELETE harus menyatakannya eksplisit.
    const hasil = await dalamTransaksiRollback(async (jalankan) => {
      await jalankan(`create table public.zz_probe_hapus(id uuid primary key, x text)`);
      return jalankan(
        `select has_table_privilege('authenticated', 'public.zz_probe_hapus', 'DELETE') as authenticated_bisa,
                has_table_privilege('authenticated', 'public.zz_probe_hapus', 'SELECT') as authenticated_baca,
                has_table_privilege('service_role',  'public.zz_probe_hapus', 'DELETE') as service_bisa`,
      );
    });
    expect(hasil[0].authenticated_bisa).toBe(false);
    // Verba lain TIDAK ikut tercabut: mencabutnya akan melumpuhkan staf
    // (lihat describe terakhir).
    expect(hasil[0].authenticated_baca).toBe(true);
    expect(hasil[0].service_bisa).toBe(true);
  });

  it("alasan pencabutan tertulis di skema, bukan hanya di migration", async () => {
    // Dua keputusan yang paling mungkin dibalik orang berikutnya — materi
    // (cascade) dan permintaan jadwal (membalik keputusan Plan 3A) — wajib
    // membawa alasannya di komentar tabel, tempat kedua yang dilihat sebelum
    // seseorang menuliskan `grant delete` lagi.
    const baris = await querySql<{ tabel: string; komentar: string | null }>(`
      select c.relname as tabel, obj_description(c.oid, 'pg_class') as komentar
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('materials','booking_requests')
       order by 1`);
    expect(baris.map((b) => b.tabel)).toEqual(["booking_requests", "materials"]);
    for (const b of baris) {
      expect(b.komentar, `tabel ${b.tabel} wajib punya komentar invarian`).toBeTruthy();
      expect(b.komentar!.toLowerCase()).toContain("service role");
    }
    expect(baris.find((b) => b.tabel === "materials")!.komentar).toContain("aktif = false");
    expect(baris.find((b) => b.tabel === "booking_requests")!.komentar).toContain("ditolak");
  });

  it("TRUNCATE tetap tercabut (pencabutan lama tidak tertimpa migration ini)", async () => {
    const baris = await querySql<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
       where table_schema='public' and privilege_type='TRUNCATE' and grantee='authenticated'
       order by 1`);
    expect(baris.map((b) => b.table_name)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (F) DUA SARAN AUDITOR YANG SENGAJA TIDAK DIJALANKAN
// ---------------------------------------------------------------------------
describe("premis yang dibantah — jangan 'diperbaiki' tanpa membaca ini", () => {
  /**
   * Saran auditor #1: "cabut hak tabel `authenticated` dari service_rates &
   * honor_marks demi pertahanan berlapis, seperti yang dilakukan pada
   * profiles."
   *
   * KELIRU, dan diuji langsung sebelum ditolak. Owner, admin, dan klien login
   * sebagai peran SQL yang SAMA: `authenticated`. Pada `profiles` polanya
   * bekerja karena staf hanya perlu satu kolom (`nama`), sehingga hak tabel
   * bisa dicabut lalu satu kolom di-grant ulang. Di tabel uang tidak ada
   * himpunan sempit seperti itu — owner butuh SELURUH kolom dan SELURUH verba
   * baca/tulis. Mencabut hak tabelnya melumpuhkan satu-satunya peran yang
   * memang berhak.
   *
   * Diprobe sebagai peran `authenticated` sungguhan dengan JWT owner:
   *   begin;
   *     revoke all on public.service_rates from authenticated;
   *     set local role authenticated;
   *     select set_config('request.jwt.claims', <klaim owner>, true);
   *     select count(*) from public.service_rates;
   *   -- ERROR: permission denied for table service_rates
   *   rollback;
   */
  it("hak tabel non-DELETE tabel uang WAJIB tetap dipegang authenticated", async () => {
    const baris = await querySql<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type
        from information_schema.role_table_grants
       where table_schema='public'
         and grantee='authenticated'
         and table_name in ('service_rates','honor_marks')
         and privilege_type in ('SELECT','INSERT','UPDATE')
       order by 1, 2`);
    expect(baris.map((b) => `${b.table_name}:${b.privilege_type}`)).toEqual([
      "honor_marks:INSERT",
      "honor_marks:SELECT",
      "honor_marks:UPDATE",
      "service_rates:INSERT",
      "service_rates:SELECT",
      "service_rates:UPDATE",
    ]);
  });

  it("mencabutnya BENAR-BENAR melumpuhkan owner (dibuktikan, bukan diasumsikan)", async () => {
    const { data: pengguna } = await svc.auth.admin.listUsers();
    const uidOwner = pengguna.users.find((u) => u.email === "owner@padma.test")!.id;

    const hasil = await dalamTransaksiRollback(async (jalankan) => {
      // Kontrol: sebelum dicabut, owner memang membaca rate card.
      await jalankan(`set local role authenticated`);
      await jalankan(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [uidOwner],
      );
      const sebelum = await jalankan(`select count(*)::int as n from public.service_rates`);

      // Lalu jalankan saran auditor di dalam transaksi yang sama.
      await jalankan(`reset role`);
      await jalankan(`revoke all on public.service_rates from authenticated`);
      await jalankan(`set local role authenticated`);
      await jalankan(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [uidOwner],
      );
      let pesan = "";
      try {
        await jalankan(`select count(*) from public.service_rates`);
      } catch (e) {
        pesan = (e as Error).message;
      }
      return [{ sebelum: sebelum[0].n, pesan }];
    });

    expect(hasil[0].sebelum as number).toBeGreaterThanOrEqual(10);
    expect(hasil[0].pesan).toContain("permission denied for table service_rates");
  });

  it("owner membaca rate card lewat REST (bukti perilaku, bukan katalog saja)", async () => {
    const o = await signInAs("owner@padma.test");
    const { data, error } = await o.from("service_rates").select("harga_klien, honor_mitra");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });

  /**
   * Saran auditor #2: "cabut hak kolom UPDATE `clients.user_id` dari
   * `authenticated`; penahan penautan liar jangan hanya trigger."
   *
   * KELIRU juga, dan kekeliruannya justru TERBALIK dari yang dikira: trigger
   * `guard_client_link` di sini LEBIH kuat daripada hak kolom, bukan lebih
   * lemah. Hak kolom mengikat KEHADIRAN kolom di payload; trigger mengikat
   * PERUBAHAN NILAI. Panel admin yang mengirim baris utuh dengan `user_id`
   * bernilai SAMA adalah alur sah — dan hanya trigger yang meloloskannya.
   *
   * Dicoba sungguhan pada basis data lokal (bukan diperkirakan):
   *   revoke update on public.clients from authenticated;
   *   grant update (padma_id, nama, email, no_hp, phase_id, created_at)
   *     on public.clients to authenticated;
   * lalu `npx vitest run tests/penautan-kolom-terkunci.test.ts` →
   *   "admin tetap bisa mengelola kolom operasional klien" MERAH,
   *   42501 "permission denied for table clients" pada PATCH baris utuh.
   * Hak kolomnya dikembalikan; sarannya tidak dijalankan.
   */
  it("clients.user_id TETAP ter-grant UPDATE — pencabutannya mematahkan alur sah", async () => {
    const baris = await querySql<{ column_name: string }>(`
      select column_name from information_schema.column_privileges
       where table_schema='public' and table_name='clients'
         and grantee='authenticated' and privilege_type='UPDATE'
         and column_name in ('user_id','linked_at')
       order by 1`);
    expect(baris.map((b) => b.column_name)).toEqual(["linked_at", "user_id"]);
  });

  it("penautan liar TETAP ditolak, dan payload baris utuh TETAP lolos", async () => {
    const a = await signInAs("admin@padma.test");

    const { data: pengguna } = await svc.auth.admin.listUsers();
    const uidAdmin = pengguna.users.find((u) => u.email === "admin@padma.test")!.id;

    // (a) Penautan liar: ditolak trigger, bukan hak kolom.
    const { error: eLiar } = await a
      .from("clients")
      .update({ user_id: uidAdmin })
      .eq("id", KLIEN_RINA)
      .select("id");
    expect(eLiar?.code).toBe("42501");
    const { data: rina } = await svc
      .from("clients")
      .select("user_id")
      .eq("id", KLIEN_RINA)
      .single();
    expect(rina!.user_id).toBeNull();

    // (b) Baris utuh dengan nilai penautan yang SAMA: harus tetap lolos.
    //     Inilah yang akan mati bila hak kolomnya dicabut.
    const { error: eUtuh } = await a
      .from("clients")
      .update({ no_hp: "0857-0000-1111", user_id: null, linked_at: null })
      .eq("id", KLIEN_RINA)
      .select("id");
    expect(eUtuh).toBeNull();
  });
});
