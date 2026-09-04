import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

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
  await admin.from("sessions").upsert(
    {
      id: SESI_UJI,
      client_id: KLIEN_RINA,
      service_id: "11111111-1111-1111-1111-111111111101",
      partner_id: MITRA_SRI,
      tanggal: "2026-12-29",
      status: "terjadwal",
      catatan: "PAD-UJI-pengerasan",
      rekomendasi: "",
      status_bayar: "belum",
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
        partner_id: MITRA_SRI,
        tanggal: "2026-12-30",
        status: "terjadwal",
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

  // Dua test di sini dulu membuktikan constraint DB
  // `material_videos_host_terproteksi` (allowlist host Vimeo/CloudflareStream
  // pada kolom `url`). Migration `materi_video_r2` (Task 1, migrasi objek-R2)
  // MENCABUT constraint itu SEMENTARA: ia menuntut `objek ~ '^https://...'`,
  // yang mustahil dipenuhi bersamaan dengan tuntutan skema baru bahwa `objek`
  // adalah KUNCI OBJEK R2, bukan URL (lihat komentar penyimpangan di migration
  // itu untuk penjelasan lengkap kenapa keduanya tidak bisa hidup berdampingan).
  // Task 6 mengembalikannya sebagai check BENTUK KUNCI OBJEK, bukan host URL.
  //
  // Ancaman yang dulu dicegahnya LEBIH LUAS daripada "lewat formulir admin":
  // `periksaUrlVideo()` (src/app/admin/materi/aksi.ts) hanya menjaga jalur
  // server action. Grant `material_videos` bersifat TINGKAT TABEL dan policy
  // "video: staf" memberi admin/owner INSERT/UPDATE — jadi admin yang sudah
  // login bisa PATCH `objek` BEBAS langsung lewat PostgREST, tanpa pernah
  // menyentuh `aksi.ts`. Jalur ini bukan teoretis: `tests/hak-hapus-
  // berlebih.test.ts` dan `tests/rls-materi.test.ts` sendiri memakainya
  // (update `objek` lewat sesi admin biasa).
  //
  // SENGAJA tidak ada test di sini yang menuntut `insert`/`update` dengan
  // `objek` sembarang berhasil: satu-satunya perubahan kode yang bisa
  // memerahkan asersi semacam itu adalah MENGEMBALIKAN constraint-nya —
  // yaitu tepat perbaikan yang ditunggu, bukan regresi. Test begitu hanya
  // akan menggoda orang mencabut constraint pengganti Task 6 supaya suite
  // hijau lagi.
  //
  // TODO(Task 6): kembalikan sebagai check bentuk kunci objek.
});
