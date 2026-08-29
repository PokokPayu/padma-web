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
const MATERI_EBOOK = "77777777-7777-7777-7777-777777777702";

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
  // Bila CHECK allowlist belum ada (jalur MERAH), baris uji benar-benar
  // tersimpan — jangan tinggalkan URL sampah pada materi seed.
  await admin.from("material_videos").delete().eq("material_id", MATERI_EBOOK);
});

describe("hak berbahaya dicabut", () => {
  it("authenticated TIDAK memegang TRUNCATE pada tabel mana pun", async () => {
    const baris = await querySql<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where table_schema='public' and privilege_type='TRUNCATE' and grantee='authenticated'
      order by table_name`);
    expect(baris.map((b) => b.table_name)).toEqual([]);
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

  it("URL video hanya boleh dari host penyedia terproteksi", async () => {
    const { error: buruk } = await admin.from("material_videos").insert({
      material_id: MATERI_EBOOK,
      url: "javascript:alert(1)",
    });
    expect(buruk).not.toBeNull();

    const { error: buruk2 } = await admin.from("material_videos").insert({
      material_id: MATERI_EBOOK,
      url: "https://situs-sembarangan.example/video",
    });
    expect(buruk2).not.toBeNull();
  });

  it("URL video dari host terproteksi TETAP diterima (seed & alur sah tidak rusak)", async () => {
    const { error } = await admin.from("material_videos").insert({
      material_id: MATERI_EBOOK,
      url: "https://player.vimeo.com/video/123456789",
    });
    expect(error).toBeNull();
    await admin.from("material_videos").delete().eq("material_id", MATERI_EBOOK);
  });
});
