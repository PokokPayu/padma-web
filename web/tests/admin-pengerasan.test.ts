import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { varianBaku } from "./helpers/varian";
import { MATERI_VIDEO_TERBUKA, MATERI_VIDEO_TERKUNCI } from "./helpers/materi-video-fixture";

/**
 * PENGERASAN SEBELUM PANEL ADMIN.
 *
 * Panel admin (Plan 3A) membuka medan tulis ke hampir seluruh tabel
 * operasional. Sebelum medan itu ada, tiga hak berbahaya dicabut dan tiga
 * cacat ditutup — semuanya diverifikasi lewat PERILAKU NYATA (REST sebagai
 * admin sungguhan) plus katalog sistem, bukan pembacaan policy:
 *
 *   1. `authenticated` — yaitu SETIAP pengguna login, termasuk klien —
 *      memegang TRUNCATE pada 17 tabel. TRUNCATE tidak pernah difilter RLS,
 *      jadi untuk operasi itu tidak ada lapisan pertahanan sama sekali.
 *   2. Satu DELETE admin menghapus rekam medis: admin memegang DELETE pada
 *      `sessions`, dan menghapus satu baris `clients` menyapu
 *      sessions/client_packages/booking_requests/client_invites lewat cascade.
 *   3. `partner_publik` menyaring `aktif = true`, sehingga menonaktifkan
 *      seorang bidan menghapus namanya dari riwayat sesi SELURUH klien —
 *      berganti "Tim PADMA" tanpa error apa pun.
 */

const admin = createAdminSupabase();

const MITRA_SRI = "33333333-3333-3333-3333-333333333301";
const SESI_SEED = "66666666-6666-6666-6666-666666666601";
const KLIEN_ANANDA = "44444444-4444-4444-4444-444444444401";
const KLIEN_RINA = "44444444-4444-4444-4444-444444444402";

/**
 * Sesi milik test ini sendiri.
 *
 * Uji `updated_at` harus MENULIS ke sebuah baris sesi. Menulisnya ke baris seed
 * (66…601) merusak `tests/passport-seed-demo.test.ts`, yang meng-assert catatan
 * bidan seed panjang & pantas dibaca — terbukti merah sekali. Karena itu baris
 * uji dibuat sendiri, dipasang pada Rina (klien yang tidak dipakai assertion
 * jumlah stempel passport Ananda), dan dibersihkan di afterAll.
 */
const SESI_UJI = "66666666-6666-6666-6666-6666666666a1";

beforeAll(async () => {
  const svcUji = "11111111-1111-1111-1111-111111111101";
  await admin.from("sessions").upsert(
    {
      id: SESI_UJI,
      client_id: KLIEN_RINA,
      service_id: svcUji,
      variant_id: await varianBaku(admin, svcUji),
      partner_id: MITRA_SRI,
      tanggal: "2026-12-29",
      status: "terjadwal",
      catatan: "PAD-UJI-pengerasan",
      rekomendasi: "",
      status_bayar: "belum",
      jam_mulai: "09:00",
    },
    { onConflict: "id" },
  );
});

afterAll(async () => {
  await admin.from("sessions").delete().eq("id", SESI_UJI);
  // Mitra selalu dikembalikan aktif: passport-beranda & passport-sesi
  // meng-assert nama bidan muncul pada riwayat seed.
  await admin.from("partners").update({ aktif: true }).eq("id", MITRA_SRI);
});

describe("hak berbahaya dicabut", () => {
  it("authenticated TIDAK memegang TRUNCATE pada tabel mana pun", async () => {
    const baris = await querySql<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where table_schema='public' and privilege_type='TRUNCATE' and grantee='authenticated'
      order by table_name`);
    expect(baris.map((b) => b.table_name)).toEqual([]);
  });

  /**
   * VIEW adalah objek dengan haknya SENDIRI, dan ia mewarisi default
   * privileges Supabase persis seperti tabel. `partner_publik` terbukti
   * tembus: `authenticated` memegang INSERT/UPDATE/DELETE atasnya, view-nya
   * auto-updatable, dan `security_invoker = off` membuat RLS `partners`
   * diperiksa sebagai PEMILIK view (postgres) — sehingga setiap pengguna
   * login bisa menulis `partners` tanpa satu policy pun ikut diperiksa.
   *
   * Invarian ini sengaja berlaku untuk SELURUH view di schema `public`,
   * termasuk view yang belum lahir: itulah yang menangkap kekambuhannya di
   * Plan 3B, bukan test per-view.
   */
  it("anon & authenticated TIDAK memegang verba tulis pada VIEW mana pun", async () => {
    const baris = await querySql<{ table_name: string; grantee: string; privilege_type: string }>(`
      select g.table_name, g.grantee, g.privilege_type
        from information_schema.role_table_grants g
        join information_schema.views v
          on v.table_schema = g.table_schema and v.table_name = g.table_name
       where g.table_schema = 'public'
         and g.grantee in ('anon','authenticated')
         and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
       order by 1, 2, 3`);
    expect(
      baris.map((b) => `${b.table_name}:${b.grantee}:${b.privilege_type}`),
    ).toEqual([]);
  });

  it("admin TIDAK bisa menghapus sesi (rekam medis)", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("sessions").delete().eq("id", SESI_SEED);
    expect(error?.code).toBe("42501");

    const { data } = await admin
      .from("sessions")
      .select("id")
      .eq("id", SESI_SEED)
      .maybeSingle();
    expect(data).not.toBeNull(); // benar-benar masih ada
  });

  it("admin TIDAK bisa menghapus klien (cascade menyapu segalanya)", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("clients").delete().eq("id", KLIEN_ANANDA);
    expect(error?.code).toBe("42501");

    const { data } = await admin
      .from("clients")
      .select("id")
      .eq("id", KLIEN_ANANDA)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it("admin TETAP bisa membuat & mengubah sesi (alur sah tidak rusak)", async () => {
    const a = await signInAs("admin@padma.test");
    const { data, error } = await a
      .from("sessions")
      .insert({
        client_id: KLIEN_ANANDA,
        service_id: "11111111-1111-1111-1111-111111111101",
        variant_id: await varianBaku(admin, "11111111-1111-1111-1111-111111111101"),
        partner_id: MITRA_SRI,
        tanggal: "2026-12-30",
        status: "terjadwal",
        jam_mulai: "09:00",
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const { data: ubah } = await a
      .from("sessions")
      .update({ catatan: "uji" })
      .eq("id", data!.id)
      .select();
    expect(ubah).toHaveLength(1);

    // Service role tetap boleh menghapus — pembersihan test bergantung padanya.
    const { error: eHapus } = await admin
      .from("sessions")
      .delete()
      .eq("id", data!.id);
    expect(eHapus).toBeNull();
    const { data: sisa } = await admin
      .from("sessions")
      .select("id")
      .eq("id", data!.id)
      .maybeSingle();
    expect(sisa).toBeNull();
  });
});

describe("partner_publik tidak menyembunyikan riwayat", () => {
  it("nama mitra nonaktif TETAP terbaca (riwayat sesi lama tidak boleh kehilangan nama)", async () => {
    await admin.from("partners").update({ aktif: false }).eq("id", MITRA_SRI);

    const k = await signInAs("ananda@padma.test");
    const { data } = await k
      .from("partner_publik")
      .select("id, nama")
      .eq("id", MITRA_SRI);
    expect(data).toHaveLength(1);
    expect(data![0].nama).toBe("Bidan Sri Wahyuni");

    await admin.from("partners").update({ aktif: true }).eq("id", MITRA_SRI);
  });

  it("partner_publik tetap tidak membocorkan no_hp", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("partner_publik").select("*").limit(1);
    expect(Object.keys(data![0])).not.toContain("no_hp");
    expect(Object.keys(data![0]).sort()).toEqual(["id", "nama"]);
  });
});

describe("jejak waktu & validasi", () => {
  it("sessions.updated_at ikut berubah saat baris diperbarui", async () => {
    const { data: awal } = await admin
      .from("sessions")
      .select("updated_at")
      .eq("id", SESI_UJI)
      .single();

    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("sessions")
      .update({ catatan: "PAD-UJI-sentuh " + Date.now() })
      .eq("id", SESI_UJI);
    expect(error).toBeNull();

    const { data: akhir } = await admin
      .from("sessions")
      .select("updated_at")
      .eq("id", SESI_UJI)
      .single();
    expect(new Date(akhir!.updated_at).getTime()).toBeGreaterThan(
      new Date(awal!.updated_at).getTime(),
    );
  });

  // Dua test yang dulu ada di sini membuktikan constraint DB
  // `material_videos_host_terproteksi` (allowlist host Vimeo/CloudflareStream
  // pada kolom lama `url`). Migration `materi_video_r2` (Task 1, migrasi
  // objek-R2) MENCABUT constraint itu SEMENTARA — lihat komentar penyimpangan
  // di migration itu untuk kenapa. Penggantinya, `material_videos_bentuk_objek`
  // (Task 6, migration `20260905120000`), diuji di describe terpisah di bawah.
});

/**
 * `material_videos_bentuk_objek` (migration `20260905120000`) — pagar DB atas
 * BENTUK kunci objek, kebalikan dari describe di atas: dulu SENGAJA tidak ada
 * test yang menuntut `insert`/`update` sembarang GAGAL, karena satu-satunya
 * perbaikan kode yang bisa membuatnya hijau adalah mengembalikan
 * constraint-nya — dan constraint itu sekarang sudah kembali. Jadi yang
 * dijaga di sini adalah kebalikannya: bentuk yang SALAH benar-benar DITOLAK
 * di lapisan basis data (kode 23514), lewat service role (RLS dilewati)
 * supaya yang terbukti murni CHECK constraint, bukan hak akses.
 */
describe("material_videos_bentuk_objek — CHECK menjaga bentuk & kepemilikan objek", () => {
  const MATERI_CEK = "77777777-7777-7777-7777-7777777779c1";
  const MATERI_LAIN = "77777777-7777-7777-7777-7777777779c2";

  beforeAll(async () => {
    await admin.from("materials").insert([
      {
        id: MATERI_CEK,
        judul: "PAD-UJI Constraint Objek",
        tipe: "video",
        deskripsi: "",
        aktif: false,
      },
      {
        id: MATERI_LAIN,
        judul: "PAD-UJI Constraint Objek Lain",
        tipe: "video",
        deskripsi: "",
        aktif: false,
      },
    ]);
  });

  afterAll(async () => {
    await admin.from("material_videos").delete().in("material_id", [MATERI_CEK, MATERI_LAIN]);
    await admin.from("materials").delete().in("id", [MATERI_CEK, MATERI_LAIN]);
  });

  it("KONTROL: kunci objek berbentuk benar tetap diterima", async () => {
    const { error } = await admin
      .from("material_videos")
      .insert({ material_id: MATERI_CEK, objek: `${MATERI_CEK}/pad-uji.mp4`, mime: "video/mp4" });
    expect(error).toBeNull();
    await admin.from("material_videos").delete().eq("material_id", MATERI_CEK);
  });

  it("menolak skema asing (javascript:) — bukan lagi lubang terbuka", async () => {
    const { error } = await admin
      .from("material_videos")
      .insert({ material_id: MATERI_CEK, objek: "javascript:alert(1)", mime: "video/mp4" });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("menolak kunci milik materi LAIN, walau bentuknya sendiri sah", async () => {
    // Inilah pagar yang tidak bisa diberikan `objekVideoSah()` (aplikasi)
    // sendirian: constraint ini dievaluasi PER BARIS terhadap `material_id`
    // baris itu, menutup jalur PATCH langsung PostgREST yang tetap terbuka
    // bagi admin (lihat `tests/hak-hapus-berlebih.test.ts` &
    // `tests/rls-materi.test.ts`).
    const { error } = await admin
      .from("material_videos")
      .insert({ material_id: MATERI_CEK, objek: `${MATERI_LAIN}/pad-uji.mp4`, mime: "video/mp4" });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("menolak ekstensi yang tidak cocok dengan mime", async () => {
    const { error } = await admin
      .from("material_videos")
      .insert({ material_id: MATERI_CEK, objek: `${MATERI_CEK}/pad-uji.webm`, mime: "video/mp4" });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("kedua baris fixture demo (tests/global-setup.ts) tetap lolos constraint ini", async () => {
    // Bagian acaknya BUKAN UUID ("fixture-demo"/"fixture-rahasia") — constraint
    // ini sengaja tidak menuntut UUID (lihat komentar di migration) justru
    // supaya baris ini lolos tanpa perlu dilonggarkan.
    const { data } = await admin
      .from("material_videos")
      .select("material_id")
      .in("material_id", [MATERI_VIDEO_TERBUKA, MATERI_VIDEO_TERKUNCI]);
    expect((data ?? []).map((r) => r.material_id).sort()).toEqual(
      [MATERI_VIDEO_TERBUKA, MATERI_VIDEO_TERKUNCI].sort(),
    );
  });
});
