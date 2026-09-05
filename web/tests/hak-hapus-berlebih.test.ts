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
 * ===== PREMIS YANG SEMPAT KELIRU DI BERKAS INI SENDIRI =====
 * `material_chapters` & `material_videos` semula DIPERTAHANKAN dengan alasan
 * "menghapus satu bab menghapus satu bab". Salah: filter PostgREST adalah
 * pilihan pemanggil, bukan pembatas baris, dan satu permintaan admin dengan
 * filter tautologis menyapu seluruh bab seluruh materi. Lihat describe
 * "radius satu permintaan" — kelompok assertion ketiga berkas ini, yang
 * menghitung BARIS, bukan hak dan bukan kode HTTP.
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
const VARIAN_UJI = "11111111-1111-1111-1111-1111111119a2";
const PAKET_UJI = "22222222-2222-2222-2222-2222222229a1";
const MITRA_UJI = "33333333-3333-3333-3333-3333333339a1";
const MATERI_UJI = "77777777-7777-7777-7777-7777777779a1";
const TARIF_UJI = "99999999-9999-9999-9999-9999999999a1";
const HONOR_UJI = "99999999-9999-9999-9999-9999999999b1";

// Bentuk kunci objek R2 sah (Task 6, constraint `material_videos_bentuk_objek`
// — diikat pada MATERI_UJI sendiri, bukan URL sembarang). Nilainya dulu URL
// Vimeo sebelum medan URL video dibongkar Task 6; test-test di berkas ini
// hanya butuh SATU nilai konsisten untuk dipasang & dipulihkan, bentuknya
// tidak relevan bagi apa yang benar-benar diuji (hak akses, bukan isi).
const OBJEK_VIDEO_UJI = `${MATERI_UJI}/pad-uji-hak-hapus.mp4`;

/** Jauh di depan supaya tidak bertabrakan dengan tanggal test lain. */
const TGL_PERMINTAAN = "2027-03-11";
const PEKAN_HONOR = "2027-03-08";
/**
 * Senin yang SUDAH LEWAT, untuk tanda bayar yang disisipkan lewat peran API.
 *
 * `PEKAN_HONOR` di atas tetap dipakai fixture service role — jalur seed memang
 * boleh menyemai pekan mana pun. Tetapi sejak migration `pengerasan_tabel_uang`,
 * peran API tidak lagi bisa menandai pekan yang belum berjalan: menyatakan
 * honor yang belum dikerjakan sudah dibayar adalah kebohongan PERMANEN, karena
 * DELETE `honor_marks` sudah dicabut. Aturannya sama persis dengan
 * `periksaPekan()` di src/app/owner/rekap/status.ts.
 */
const PEKAN_LEWAT = "2026-01-12"; // Senin

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
  await svc.from("service_variants").upsert(
    { id: VARIAN_UJI, service_id: LAYANAN_UJI, label: "PAD-UJI Varian", aktif: true },
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
      judul: "PAD-UJI Materi",
      tipe: "ebook",
      deskripsi: "fixture",
      aktif: true,
    },
    { onConflict: "id" },
  );
  await svc.from("material_services").upsert(
    { material_id: MATERI_UJI, service_id: LAYANAN_UJI },
    { onConflict: "material_id,service_id" },
  );
  await svc.from("material_videos").upsert(
    { material_id: MATERI_UJI, objek: OBJEK_VIDEO_UJI },
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
  await svc.from("material_pages").delete().eq("material_id", MATERI_UJI);
  await svc.from("material_services").delete().eq("material_id", MATERI_UJI);
  await svc.from("materials").delete().eq("id", MATERI_UJI);
  await svc.from("partners").delete().eq("id", MITRA_UJI);
  await svc.from("packages").delete().eq("id", PAKET_UJI);
  // Varian sebelum layanannya: FK `service_variants.service_id -> services.id`
  // tidak ber-cascade (varian yang pernah dipakai sesi adalah riwayat).
  await svc.from("service_variants").delete().eq("id", VARIAN_UJI);
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
    // bukan kode errornya, melainkan tautan layanan & video yang tidak ikut
    // tersapu.
    const { data: materi } = await svc
      .from("materials")
      .select("id")
      .eq("id", MATERI_UJI)
      .maybeSingle();
    expect(materi).not.toBeNull();

    const { data: tautan } = await svc
      .from("material_services")
      .select("service_id")
      .eq("material_id", MATERI_UJI);
    expect(tautan).toHaveLength(1);

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

  it("KONTROL: penyuntingan video materi tetap hidup — tanpa verba DELETE", async () => {
    // URL video adalah ISI yang ditulis klinik sendiri: tidak ada riwayat
    // klien, tidak ada bukti, dan semuanya bisa ditulis ulang.
    //
    // (Bab teks & `material_chapters` sudah dibongkar total di Task 11 —
    // padanan test ini untuk halaman e-book, "RPC adalah SATU-SATUNYA jalur
    // tulis", sudah hidup di tests/materi-halaman.test.ts sejak Task 3, jadi
    // tidak diulang di sini.)
    //
    // Yang BERUBAH sejak migration `batas_radius_hapus_isi_materi`: jalur
    // penghapusan video bukan lagi verba DELETE peran API, melainkan RPC
    // berparameter tunggal. Assertion di bawah karena itu lebih KETAT, bukan
    // lebih longgar: DELETE langsung wajib ditolak, DAN penyuntingannya wajib
    // tetap bisa dikerjakan.
    const a = await signInAs("admin@padma.test");

    // Video: DELETE langsung ditolak, penggantian objek lewat upsert tetap
    // jalan (nilai penggantinya WAJIB berbentuk kunci objek sah milik
    // MATERI_UJI sendiri sejak constraint `material_videos_bentuk_objek`,
    // Task 6 — ini test hak akses/RLS, bukan test bentuk, jadi nilainya
    // sengaja dibuat sah supaya tidak ikut ditolak CHECK constraint),
    // pelepasan lewat RPC tetap jalan.
    const { error: eVideo } = await a
      .from("material_videos")
      .delete()
      .eq("material_id", MATERI_UJI);
    expect(eVideo?.code).toBe("42501");

    const { error: eGanti } = await a
      .from("material_videos")
      .update({ objek: `${MATERI_UJI}/pad-uji-ganti.mp4` })
      .eq("material_id", MATERI_UJI)
      .select("material_id");
    expect(eGanti).toBeNull();

    const { data: lepas, error: eLepas } = await a.rpc("lepas_video_materi", {
      materi_id: MATERI_UJI,
    });
    expect(eLepas).toBeNull();
    expect(lepas).toBe(MATERI_UJI);

    await svc
      .from("material_videos")
      .upsert(
        { material_id: MATERI_UJI, objek: OBJEK_VIDEO_UJI },
        { onConflict: "material_id" },
      );
  });
});

// ---------------------------------------------------------------------------
// (A2) RADIUS SATU PERMINTAAN — yang dijaga adalah JUMLAH BARIS, bukan haknya
// ---------------------------------------------------------------------------
/**
 * Premis yang dibantah di sini adalah premis berkas ini sendiri.
 *
 * Migration `cabut_hak_hapus_berlebih` bagian (2) mempertahankan DELETE pada
 * `material_chapters` & `material_videos` dengan alasan tertulis: "Yang
 * membedakannya dari `materials`: blast radius satu permintaan. Menghapus
 * materi menyapu seluruh isinya sekaligus lewat cascade; menghapus satu bab
 * menghapus satu bab."
 *
 * Kalimat terakhir itu SALAH, dan salahnya bukan pada pendataan tabel
 * melainkan pada asumsi yang tidak pernah diuji lewat PostgREST: filter pada
 * URL adalah PILIHAN PEMANGGIL, bukan pembatas baris. Direproduksi sebagai
 * admin sungguhan (anon key + JWT admin, BUKAN service role):
 *
 *   DELETE /rest/v1/material_chapters?urutan=gte.0   -> HTTP 204
 *   -- SELURUH bab SELURUH materi klinik lenyap dalam satu permintaan.
 *
 * Radiusnya justru LEBIH BESAR daripada menghapus satu `materials` (yang hanya
 * menyapu isi satu materi) — padahal itulah yang dilarang di bagian (1a)
 * dengan alasan radius. Satu-satunya pagar yang ada hanyalah penolakan
 * PostgREST terhadap DELETE tanpa query string sama sekali (21000 "DELETE
 * requires a WHERE clause"), dan ia dilewati hanya dengan menambahkan filter
 * yang selalu benar.
 *
 * Karena itu assertion di bawah TIDAK berhenti pada kode error: yang diperiksa
 * adalah JUMLAH BARIS sesudahnya. 204 bukan bukti terhapus, dan 42501 bukan
 * bukti selamat — hanya hitungan baris yang membuktikan keduanya.
 *
 * `material_chapters` sendiri sudah dibongkar total di Task 11. Empat test
 * yang dulu membuktikan radius ini khusus untuknya ("satu filter tautologis
 * TIDAK menyapu seluruh bab", padanan "owner", "KONTROL: penyuntingan isi
 * TETAP hidup", "klien tidak bisa memanggil RPC hapus_bab_materi") DIHAPUS,
 * bukan diadaptasi ke `material_pages`: kelas bug PERSIS yang sama (satu
 * filter tautologis `?halaman=gte.0` menyapu SELURUH halaman SELURUH materi)
 * sudah diprobe nyata dan ditutup di migration `materi_halaman_pdf`, dan
 * dibuktikan di tests/materi-halaman.test.ts describe "penutupan radius: RPC
 * adalah SATU-SATUNYA jalur tulis" — termasuk padanan admin/klien/owner yang
 * sama persis, lewat sesi JWT sungguhan, bukan service role. Mengulanginya di
 * sini hanya akan menjadi dua tempat yang harus disepakatkan setiap kali
 * radiusnya berubah. Yang tersisa di describe ini murni video, yang TIDAK
 * disentuh Task 11 sama sekali.
 */
describe("radius satu permintaan: isi materi tidak bisa disapu massal", () => {
  /**
   * Jaring pengaman. Bila pagar radiusnya BELUM ada (jalur MERAH), permintaan
   * di bawah benar-benar menghapus seluruh video klinik — dan seluruh suite
   * lain (passport-materi, rls-materi, passport-seed-demo) ikut mati karena
   * keadaan basis data rusak, bukan karena bugnya sendiri. Snapshot diambil
   * lewat service role sebelum percobaan dan dipulihkan apa pun hasilnya.
   */
  async function denganPemulihanIsiMateri(fn: () => Promise<void>) {
    const { data: videoAwal } = await svc.from("material_videos").select("*");
    try {
      await fn();
    } finally {
      if (videoAwal?.length) {
        await svc.from("material_videos").upsert(videoAwal, { onConflict: "material_id" });
      }
    }
  }

  it("admin: satu filter tautologis TIDAK menyapu seluruh video", async () => {
    await denganPemulihanIsiMateri(async () => {
      const { data: sebelum } = await svc.from("material_videos").select("material_id");
      expect(sebelum!.length).toBeGreaterThan(0);

      const a = await signInAs("admin@padma.test");
      await a.from("material_videos").delete().not("material_id", "is", null);

      const { data: sesudah } = await svc.from("material_videos").select("material_id");
      expect(sesudah!.length).toBe(sebelum!.length);
    });
  });

  it("KONTROL: video TETAP bisa dilepas dari materinya, tepat satu baris", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: sebelum } = await svc.from("material_videos").select("material_id");

    const { data: lepas, error } = await a.rpc("lepas_video_materi", { materi_id: MATERI_UJI });
    expect(error).toBeNull();
    expect(lepas).toBe(MATERI_UJI);

    const { data: sesudah } = await svc.from("material_videos").select("material_id");
    expect(sesudah!.length).toBe(sebelum!.length - 1);

    await svc
      .from("material_videos")
      .upsert(
        { material_id: MATERI_UJI, objek: OBJEK_VIDEO_UJI },
        { onConflict: "material_id" },
      );
  });

  // "klien tidak bisa memanggil RPC penghapus isi materi" (dulu di sini, lewat
  // `hapus_bab_materi`) DIHAPUS bersama material_chapters. Padanannya untuk
  // halaman e-book — "klien tidak bisa memanggil RPC ganti_halaman_materi" —
  // sudah hidup di tests/materi-halaman.test.ts, memakai pola yang sama
  // (sesi JWT klien sungguhan, bukan service role).

  it("anon tidak memegang EXECUTE atas RPC penghapus/pengganti isi materi", async () => {
    const baris = await querySql<{ n: string }>(`
      select count(*)::text as n
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('lepas_video_materi','ganti_halaman_materi')
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('public', p.oid, 'EXECUTE'))`);
    expect(Number(baris[0].n)).toBe(0);
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

  it("varian layanan: ditolak, dan barisnya masih ada", async () => {
    // Sama seperti layanan & paket di atas: varian yang pernah dipakai sesi
    // adalah riwayat harga, bukan draft yang boleh lenyap.
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("service_variants").delete().eq("id", VARIAN_UJI);
    expect(error?.code).toBe("42501");
    const { data } = await svc
      .from("service_variants")
      .select("id")
      .eq("id", VARIAN_UJI)
      .maybeSingle();
    expect(data).not.toBeNull();
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
    //
    // KUNCINYA BUKAN KARANGAN, dan itu bukan gaya penulisan. Sejak migration
    // `registri_kunci_pengaturan`, `app_settings.key` ber-FK ke daftar putih
    // `app_setting_keys`: kunci uji seperti "PAD-UJI-kunci" ditolak 23503, dan
    // service role TIDAK dikecualikan — constraint integritas berlaku untuk
    // setiap peran. Karena itu fixture di sini memakai kunci terdaftar
    // sungguhan, dan `finally` MENGEMBALIKAN NILAINYA alih-alih menghapus
    // barisnya: baris `nomor_wa` berasal dari seed dan dibutuhkan landing,
    // wizard skrining, & passport.
    const KUNCI_UJI = "nomor_wa";
    const { data: awal } = await svc
      .from("app_settings")
      .select("value")
      .eq("key", KUNCI_UJI)
      .single();
    expect(awal, "fixture: baris nomor_wa dari seed harus ada").not.toBeNull();
    try {
      const a = await signInAs("admin@padma.test");
      const { error } = await a.from("app_settings").delete().eq("key", KUNCI_UJI);
      expect(error?.code).toBe("42501");
      const { data } = await svc
        .from("app_settings")
        .select("key, value")
        .eq("key", KUNCI_UJI)
        .maybeSingle();
      expect(data).not.toBeNull();
      // 42501 saja tidak membuktikan barisnya utuh: yang dijaga adalah NILAI
      // yang masih dipakai seluruh CTA WhatsApp, bukan kode HTTP-nya.
      expect(data!.value).toBe(awal!.value);

      // PASANGANNYA — assertion di atas menguji VERBA, dan verba bukan efek.
      // Red team menembusnya lewat pintu sebelah: PATCH pada KOLOM KUNCI
      // memindahkan baris `nomor_wa` ke kunci lain, sehingga `nomor_wa`
      // LENYAP persis seperti DELETE yang sudah dicabut, dan seluruh CTA
      // WhatsApp diam-diam jatuh ke NOMOR_WA_BAWAAN yang ditulis keras di
      // src/lib/pengaturan/bentuk.ts. Ditutup trigger trg_jaga_identitas_setelan.
      const { data: pindah, error: ePindah } = await a
        .from("app_settings")
        .update({ key: "alamat_klinik" })
        .eq("key", KUNCI_UJI)
        .select("key");
      expect(ePindah?.code, "kunci setelan tidak boleh bisa ditulis ulang").toBe("42501");
      expect(pindah ?? []).toHaveLength(0);

      const { data: sesudah } = await svc
        .from("app_settings")
        .select("key, value")
        .eq("key", KUNCI_UJI)
        .maybeSingle();
      expect(sesudah, "baris nomor_wa harus MASIH ADA sesudah percobaan pindah").not.toBeNull();
      expect(sesudah!.value).toBe(awal!.value);
    } finally {
      await svc
        .from("app_settings")
        .upsert({ key: KUNCI_UJI, value: awal!.value }, { onConflict: "key" });
    }
  });

  it("KONTROL: pensiun lewat `aktif = false` TETAP bekerja untuk mitra, layanan, paket, & varian", async () => {
    const a = await signInAs("admin@padma.test");

    for (const [tabel, id] of [
      ["partners", MITRA_UJI],
      ["services", LAYANAN_UJI],
      ["packages", PAKET_UJI],
      ["service_variants", VARIAN_UJI],
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

    // Kunci TERDAFTAR yang seed sengaja tidak isi: membuktikan admin masih
    // bisa MELAHIRKAN baris setelan (bukan sekadar menimpa yang sudah ada),
    // tanpa memakai kunci karangan yang kini ditolak FK 23503. Baris ini bukan
    // milik seed, jadi ia boleh — dan wajib — dibersihkan di bawah.
    const KUNCI_TULIS = "jam_operasional";
    const { error: eSetelan } = await a
      .from("app_settings")
      .upsert({ key: KUNCI_TULIS, value: "Senin–Sabtu 08.00–20.00" }, { onConflict: "key" });
    expect(eSetelan).toBeNull();

    // Kontrol negatif di baris yang sama: hak tulis admin TIDAK berarti admin
    // boleh mengarang kunci. Inilah yang menutup money firewall lewat BARIS
    // (lihat tests/pengaturan-kunci.test.ts).
    const { error: eKarangan } = await a
      .from("app_settings")
      .upsert({ key: "PAD-UJI-tulis", value: "425000" }, { onConflict: "key" });
    expect(eKarangan?.code).toBe("23503");

    // Service role tetap memegang DELETE — pembersihan fixture bergantung
    // padanya, dan itulah yang membuat pencabutan di atas tidak melumpuhkan
    // suite ini sendiri.
    const { error: eBersih } = await svc.from("partners").delete().eq("id", mitraBaru!.id);
    expect(eBersih).toBeNull();
    await svc.from("app_settings").delete().eq("key", KUNCI_TULIS);
  });
});

// ---------------------------------------------------------------------------
// (C2) KOLOM IDENTITAS — pencabutan DELETE menjaga VERBA, bukan EFEK
// ---------------------------------------------------------------------------
// Temuan red team, direproduksi sebagai admin sungguhan lewat PostgREST:
//
//   DELETE /rest/v1/app_settings?key=eq.nomor_wa   -> 403 42501   (pagar bekerja)
//   PATCH  /rest/v1/app_settings?key=eq.nomor_wa  {"key":"alamat_klinik"}
//                                                  -> 200, baris nomor_wa LENYAP
//   CTA landing sesudahnya -> https://wa.me/6287778400200 (NOMOR_WA_BAWAAN),
//   bukan nomor yang disetel klinik. Tanpa error, tanpa test merah.
//
// Efeknya identik DELETE. Yang membedakan `app_settings` dari master data
// lain: kuncinya adalah IDENTITAS MENURUT MAKNA — kode mencarinya dengan
// literal `where key = 'nomor_wa'`, jadi memindahkan kuncinya sama saja
// dengan menghapus barisnya. Kelompok assertion di bawah karena itu menghitung
// KEBERADAAN BARIS SETELAH PERCOBAAN, bukan kode HTTP-nya saja.
describe("kolom identitas tidak bisa ditulis ulang (efek = DELETE)", () => {
  it("admin tidak bisa memindahkan setelan ke kunci lain", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: awal } = await svc
      .from("app_settings")
      .select("value")
      .eq("key", "nomor_wa")
      .single();

    for (const tujuan of ["alamat_klinik", "jam_operasional"]) {
      const { data, error } = await a
        .from("app_settings")
        .update({ key: tujuan })
        .eq("key", "nomor_wa")
        .select("key");
      expect(error?.code, `pindah ke ${tujuan} harus ditolak`).toBe("42501");
      expect(data ?? []).toHaveLength(0);
    }

    // Yang dijaga bukan kode HTTP-nya, melainkan barisnya: `nomor_wa` masih
    // ada DENGAN NILAI SEMULA, sehingga CTA WhatsApp tidak jatuh ke bawaan.
    const { data: sesudah } = await svc
      .from("app_settings")
      .select("key, value")
      .eq("key", "nomor_wa")
      .maybeSingle();
    expect(sesudah).not.toBeNull();
    expect(sesudah!.value).toBe(awal!.value);
  });

  it("owner pun ditolak — ini bukan soal tingkat peran", async () => {
    const o = await signInAs("owner@padma.test");
    const { error } = await o
      .from("app_settings")
      .update({ key: "alamat_klinik" })
      .eq("key", "nomor_wa")
      .select("key");
    expect(error?.code).toBe("42501");
    const { data } = await svc.from("app_settings").select("key").eq("key", "nomor_wa");
    expect(data ?? []).toHaveLength(1);
  });

  it("KONTROL: menyimpan NILAI setelan TETAP bekerja (upsert & update)", async () => {
    // Assertion ini menahan perbaikan yang TERLIHAT benar tetapi melumpuhkan
    // jalur sah: `revoke update on app_settings; grant update (value)`.
    // Diukur, bukan diperkirakan (29 Agu 2026) — dengan hak kolom itu terpasang,
    // upsert PostgREST milik `simpanSetelan` mati 42501, karena PostgREST
    // menerbitkan `on conflict (key) do update set key = excluded.key, ...`
    // sehingga kolom `key` ikut menuntut hak UPDATE. Lihat describe (F).
    const a = await signInAs("admin@padma.test");
    const { data: awal } = await svc
      .from("app_settings")
      .select("value")
      .eq("key", "nomor_wa")
      .single();
    try {
      const { data: viaUpsert, error: eUpsert } = await a
        .from("app_settings")
        .upsert({ key: "nomor_wa", value: "6281111111111" }, { onConflict: "key" })
        .select("key");
      expect(eUpsert, "jalur simpanSetelan (upsert) harus tetap hidup").toBeNull();
      expect(viaUpsert ?? []).toHaveLength(1);

      const { data: viaUpdate, error: eUpdate } = await a
        .from("app_settings")
        .update({ value: "6282222222222" })
        .eq("key", "nomor_wa")
        .select("key");
      expect(eUpdate).toBeNull();
      expect(viaUpdate ?? []).toHaveLength(1);

      // Baris utuh dengan kunci BERNILAI SAMA juga harus lolos: trigger
      // mengikat PERUBAHAN nilai, bukan kehadiran kolom di payload.
      const { error: eUtuh } = await a
        .from("app_settings")
        .update({ key: "nomor_wa", value: awal!.value })
        .eq("key", "nomor_wa")
        .select("key");
      expect(eUtuh, "payload baris utuh harus tetap lolos").toBeNull();
    } finally {
      await svc
        .from("app_settings")
        .upsert({ key: "nomor_wa", value: awal!.value }, { onConflict: "key" });
    }
  });

  it("admin tidak bisa menulis ulang id fase, tetapi TETAP boleh menyunting namanya", async () => {
    // `phases.id` adalah taksonomi yang DITULIS KERAS di produk
    // (`FASE_SKRINING_KE_PHASE` di src/app/admin/skrining/status.ts memetakan
    // 'prekonsepsi' dst. satu per satu). Menulis ulangnya memutus pemetaan itu
    // tanpa satu pun error di layar — efek yang sama dengan DELETE yang sudah
    // dicabut. Hari ini foreign key `services_phase_id_fkey` KEBETULAN
    // menahannya (kelima fase seed dirujuk layanan), tetapi itu perlindungan
    // yang bergantung pada isi data, bukan invarian.
    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("phases")
      .update({ id: "PAD-UJI-fase" })
      .eq("id", "menopause")
      .select("id");
    expect(error?.code).toBe("42501");

    const { data: fase } = await svc.from("phases").select("id").order("urutan");
    expect((fase ?? []).map((f) => f.id)).toEqual([
      "prekonsepsi",
      "kehamilan",
      "nifas",
      "menopause",
      "newborn",
    ]);

    // KONTROL: penyuntingan taksonomi yang wajar tidak ikut terkunci.
    const { data: namaAwal } = await svc
      .from("phases")
      .select("nama")
      .eq("id", "menopause")
      .single();
    try {
      const { data, error: eNama } = await a
        .from("phases")
        .update({ nama: "PAD-UJI Menopause" })
        .eq("id", "menopause")
        .select("id");
      expect(eNama).toBeNull();
      expect(data ?? []).toHaveLength(1);
    } finally {
      await svc.from("phases").update({ nama: namaAwal!.nama }).eq("id", "menopause");
    }
  });

  it("STRUKTURAL: triggernya benar-benar terpasang (red team menemukan pg_trigger kosong)", async () => {
    const baris = await querySql<{ tabel: string; trigger: string }>(`
      select c.relname as tabel, t.tgname as trigger
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and not t.tgisinternal
         and c.relname in ('app_settings','phases')
       order by 1, 2`);
    expect(baris.map((b) => `${b.tabel}.${b.trigger}`)).toEqual([
      "app_settings.trg_jaga_identitas_setelan",
      "phases.trg_jaga_identitas_fase",
    ]);
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

  /**
   * >>> ASSERTION DIPERKUAT, BUKAN DILONGGARKAN (30 Agu 2026) <<<
   *
   * Kedua KONTROL di bawah semula juga menuntut owner BISA meng-UPDATE baris
   * tabel uang, dan itu memang keadaan repo saat migration
   * `cabut_hak_hapus_berlebih` ditulis. Red team membuktikan bahwa kemampuan
   * itu sendiri adalah lubangnya, lewat REST sebagai owner sungguhan:
   *
   *   PATCH service_rates?id=eq.<baris seed lama> {harga_klien:1,honor_mitra:1}
   *     -> 200. Rekap pekan yang honornya SUDAH dibayarkan ikut bergeser,
   *        tanpa satu pun INSERT — melanggar spec bagian 5.
   *   PATCH service_rates?honor_mitra=gt.0 {honor_mitra:7}
   *     -> 204, 13 baris. SELURUH rate card klinik tertimpa satu permintaan.
   *   PATCH honor_marks?id=eq.<tanda lama> {dibayar_pada:'1999-01-01',
   *                                         ditandai_oleh:<uid ADMIN>}
   *     -> 200. "Bukti pembayaran" yang bisa ditulis ulang bukan bukti, dan
   *        DELETE-nya sudah dicabut sehingga pemalsuannya permanen.
   *
   * Migration `pengerasan_tabel_uang` (20260830150000) menutupnya dengan
   * TRIGGER, bukan `revoke update` — justru supaya bantahan berkas ini tetap
   * berdiri: hak tabelnya TIDAK boleh dicabut, karena owner login sebagai peran
   * `authenticated` yang sama, dan probe di bawah ("mencabutnya BENAR-BENAR
   * melumpuhkan owner") membuktikannya. Peta hak non-DELETE tabel uang tetap
   * dikunci apa adanya, dan yang berubah hanya KEMAMPUANNYA.
   *
   * Karena itu keduanya kini menuntut penolakan `42501` PLUS baris yang utuh
   * sesudahnya, dan kontrol positif yang sebenarnya — owner tetap MEMBACA dan
   * MENAMBAH — dipertahankan penuh.
   */
  it("KONTROL: owner TETAP bisa membaca & menambah tarif; MENIMPA baris lama ditolak", async () => {
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

    try {
      const { error: eUbah } = await o
        .from("service_rates")
        .update({ harga_klien: 333000 })
        .eq("id", tambah!.id)
        .select("harga_klien");
      expect(eUbah?.code).toBe("42501");

      const { data: sesudah } = await svc
        .from("service_rates")
        .select("harga_klien, honor_mitra")
        .eq("id", tambah!.id)
        .single();
      expect(sesudah!.harga_klien).toBe(222000);
      expect(sesudah!.honor_mitra).toBe(90000);
    } finally {
      await svc.from("service_rates").delete().eq("id", tambah!.id);
    }
  });

  it("KONTROL: owner TETAP bisa membaca & menandai honor; MENIMPA tanda ditolak", async () => {
    const o = await signInAs("owner@padma.test");

    const { data: baca, error: eBaca } = await o.from("honor_marks").select("id, week_start");
    expect(eBaca).toBeNull();
    expect(baca!.map((h) => h.id)).toContain(HONOR_UJI);

    const { data: tanda, error: eTanda } = await o
      .from("honor_marks")
      .insert({ partner_id: MITRA_SEED, week_start: PEKAN_LEWAT })
      .select("id, dibayar_pada")
      .single();
    expect(eTanda).toBeNull();

    try {
      const { error: eUbah } = await o
        .from("honor_marks")
        .update({ dibayar_pada: "2027-03-09T00:00:00Z" })
        .eq("id", tanda!.id)
        .select("id");
      expect(eUbah?.code).toBe("42501");

      const { data: sesudah } = await svc
        .from("honor_marks")
        .select("dibayar_pada")
        .eq("id", tanda!.id)
        .single();
      expect(sesudah!.dibayar_pada).toBe(tanda!.dibayar_pada);
    } finally {
      await svc.from("honor_marks").delete().eq("id", tanda!.id);
    }
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
  /**
   * Pernah kosong, dan itu keputusan yang sudah dibayar sekali.
   *
   * Daftar ini pernah berisi `material_chapters` & `material_videos` dengan
   * alasan "menghapus satu bab menghapus satu bab". Alasannya SALAH: filter
   * PostgREST adalah pilihan pemanggil, dan satu permintaan admin berfilter
   * tautologis menyapu seluruh bab seluruh materi (lihat describe "radius satu
   * permintaan"). Penyuntingannya tidak dilarang — ia dipindah ke RPC
   * berparameter tunggal `hapus_bab_materi` / `lepas_video_materi`.
   *
   * Sebelum menambahkan nama ke daftar ini: hak tabel TIDAK pernah membatasi
   * JUMLAH baris yang bisa hilang dalam satu permintaan. Bila radius itu yang
   * dipedulikan, hak tabel bukan alatnya.
   *
   * `material_assignments` (Task 2, migration `materi_penugasan`) ditambahkan
   * SADAR, bukan warisan default privileges — bentuk risikonya sama persis
   * dengan chapters/videos dulu: DELETE tanpa filter atau berfilter tautologis
   * bisa menyapu SELURUH penugasan, bukan satu pasangan materi-klien. Yang
   * membedakannya: barisnya bukan konten tulisan tangan maupun bukti finansial
   * (bandingkan honor_marks) — ia murni TAUTAN admin<->klien. Itu TIDAK berarti
   * penyapuan itu tanpa ongkos: tidak ada tabel riwayat/audit di belakangnya,
   * jadi "pulih" berarti admin menulis ulang penugasan dari ingatannya sendiri
   * atau catatan eksternal — bukan jaring pengaman basis data. Yang membuatnya
   * tetap beda kelas dari chapters/videos hanyalah SIFAT kehilangannya: status
   * akses yang bisa (walau merepotkan) disusun ulang manusia, bukan teks
   * karangan atau bukti bayar yang lenyap permanen begitu barisnya hilang.
   * Panel admin penugasan belum ada di Task 2 (baru tabel & RLS-nya), jadi
   * jalur RPC berparameter tunggal senada `hapus_bab_materi`/`lepas_video_materi`
   * belum dibangun; itu jadi kandidat kuat begitu panel admin-nya ditulis, bila
   * radius satu permintaan ini ternyata jadi perhatian nyata di pemakaian.
   *
   * `material_pages` (Task 3, migration `materi_halaman_pdf`) SEMPAT masuk
   * daftar ini saat draft pertama RPC-nya (`ganti_halaman_materi`) memakai
   * `security invoker` — itu memaksa tabel memberi `authenticated` hak DELETE
   * langsung, dan diprobe nyata SEBELUM dikirim untuk review: admin sungguhan
   * memanggil `DELETE material_pages?halaman=gte.0` menyapu SELURUH halaman
   * SELURUH materi dalam satu permintaan, karena policy "halaman: staf
   * kelola" tidak menyempit ke satu materi — kelas bug persis `?urutan=gte.0`
   * yang menjadi alasan daftar ini ada sama sekali. Ditutup dengan pola yang
   * sama seperti chapters/videos, BUKAN dengan menuliskan alasannya di sini:
   * `ganti_halaman_materi` menjadi `security definer` dan memeriksa
   * `user_role()` sendiri, hak tabel insert/update/delete dicabut TOTAL dari
   * `authenticated`, dan nama ini keluar dari daftar. Ditinggalkan sebagai
   * catatan sejarah: bila radius per-materi pada tabel ini ATAU
   * `material_assignments` di atas pernah butuh dibuka lagi lewat hak tabel
   * langsung (bukan RPC), inilah preseden persis mengapa itu ditolak.
   *
   * `material_services` (Task 11, migration `materi_hapus_bab_teks`)
   * ditambahkan DENGAN SADAR, bentuk risikonya SEPADAN dengan
   * `material_assignments` di atas — bukan diwariskan default privileges:
   * DELETE tanpa filter atau berfilter tautologis bisa menyapu SELURUH tautan
   * materi<->layanan, bukan satu pasang. Yang membedakannya dari
   * chapters/videos/pages: `gantiLayananMateri`
   * (src/app/admin/materi/aksi.ts) TIDAK memanggil RPC — ia memanggil
   * `.delete().eq("material_id", materiId)` LANGSUNG lewat sesi pengguna, dan
   * itu sengaja: radiusnya sudah terkunci di kode aplikasi pada SATU
   * parameter wajib (bukan filter yang bisa dibuat tautologis dari luar),
   * policy "materi-layanan: staf kelola" membatasi PERANNYA, dan baris yang
   * hilang murni TAUTAN admin<->layanan — bukan konten tulisan tangan
   * (chapters/pages) maupun bukti finansial (videos ditinjau lewat harga
   * yang sama). "Pulih" berarti admin mencentang ulang layanan dari memori
   * atau catatan eksternal, persis seperti `material_assignments`.
   */
  const BOLEH_DELETE: string[] = ["material_assignments", "material_services"];

  it("tidak ada satu tabel pun yang masih memberi DELETE ke authenticated", async () => {
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

  it("tabel isi materi membawa PENGGANTINYA di komentar, bukan sekadar larangan", async () => {
    // Larangan tanpa pengganti akan dibatalkan orang berikutnya begitu ia
    // butuh menghapus satu bab. Karena itu komentar tabel wajib menyebut nama
    // RPC penggantinya — di situlah pembaca berikutnya melihat sebelum menulis
    // `grant delete` lagi.
    const baris = await querySql<{ tabel: string; komentar: string | null }>(`
      select c.relname as tabel, obj_description(c.oid, 'pg_class') as komentar
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('material_pages','material_videos')
       order by 1`);
    expect(baris.map((b) => b.tabel)).toEqual(["material_pages", "material_videos"]);
    expect(baris[0].komentar).toContain("ganti_halaman_materi");
    expect(baris[1].komentar).toContain("lepas_video_materi");
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

  /**
   * Saran auditor #3 (red team, 29 Agu 2026): "tutup PATCH kolom kunci
   * app_settings dengan hak kolom —
   *     revoke update on public.app_settings from authenticated;
   *     grant  update (value) on public.app_settings to authenticated;
   *   `simpanSetelan` tetap bekerja apa adanya — ia hanya menulis `value`."
   *
   * TEMUANNYA BENAR (dan sudah ditutup, lihat describe (C2)); PERBAIKANNYA
   * YANG KELIRU. Premis "ia hanya menulis `value`" tidak berlaku untuk UPSERT:
   * PostgREST menerbitkan
   *     insert into app_settings (key, value) values (...)
   *       on conflict (key) do update set key = excluded.key, value = excluded.value
   * sehingga cabang DO UPDATE menuntut hak UPDATE pada kolom `key` juga —
   * meskipun nilainya tidak berubah. Diukur lewat REST sebagai admin sungguhan
   * dengan hak kolom itu terpasang hidup di basis data lokal:
   *     UPSERT  -> 42501 "permission denied for table app_settings"   <-- MATI
   *     UPD val -> [{"key":"nomor_wa"}]
   *     UPD key -> 42501                                              <-- tertutup
   * Artinya sarannya menutup celahnya SEKALIGUS mematikan satu-satunya jalur
   * simpan panel pengaturan. Penggantinya adalah trigger — pola yang sama
   * dengan `guard_client_link` di atas dan dengan alasan yang sama: hak kolom
   * mengikat KEHADIRAN kolom di payload, trigger mengikat PERUBAHAN NILAI.
   */
  it("app_settings.key TETAP ter-grant UPDATE — pencabutannya mematikan upsert panel", async () => {
    const baris = await querySql<{ column_name: string }>(`
      select column_name from information_schema.column_privileges
       where table_schema='public' and table_name='app_settings'
         and grantee='authenticated' and privilege_type='UPDATE'
       order by 1`);
    expect(baris.map((b) => b.column_name)).toEqual(["key", "value"]);
  });

  it("hak kolom itu BENAR-BENAR mematahkan upsert (dibuktikan, bukan diasumsikan)", async () => {
    const { data: pengguna } = await svc.auth.admin.listUsers();
    const uidAdmin = pengguna.users.find((u) => u.email === "admin@padma.test")!.id;

    const hasil = await dalamTransaksiRollback(async (jalankan) => {
      await jalankan(`revoke update on public.app_settings from authenticated`);
      await jalankan(`grant update (value) on public.app_settings to authenticated`);
      await jalankan(`set local role authenticated`);
      await jalankan(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [uidAdmin],
      );

      // (a) Bentuk SQL yang benar-benar diterbitkan PostgREST untuk upsert.
      let pesanUpsert = "";
      try {
        await jalankan(
          `insert into public.app_settings (key, value) values ('nomor_wa', '6280000000000')
             on conflict (key) do update set key = excluded.key, value = excluded.value`,
        );
      } catch (e) {
        pesanUpsert = (e as Error).message;
      }
      return [{ pesanUpsert }];
    });

    expect(
      hasil[0].pesanUpsert,
      "hak kolom `value` saja mematikan upsert panel pengaturan",
    ).toContain("permission denied for table app_settings");
  });
});
