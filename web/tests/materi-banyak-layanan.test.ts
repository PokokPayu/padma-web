// tests/materi-banyak-layanan.test.ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

describe("material_services — materi boleh milik banyak layanan", () => {
  // Test "setiap materi lama termigrasi menjadi tepat satu baris" (yang pernah
  // hidup di sini) DIHAPUS, bukan diadaptasi: ia membuktikan backfill satu kali
  // milik migration `materi_banyak_layanan` (menyalin `materials.service_id`
  // lama ke `material_services`) benar-benar berjalan. Task 11 menghapus
  // KOLOM `materials.service_id` itu sendiri — tidak ada lagi sisi sumber untuk
  // dibandingkan, dan sejak Task 11 setiap materi BARU lahir langsung lewat
  // `material_services` (nol baris pun sah), jadi tidak ada lagi "materi lama"
  // yang perlu dibuktikan bermigrasi. Perilaku yang tersisa & masih relevan
  // (RLS, grant, materi boleh menempel banyak layanan) diuji di describe ini
  // dan di tests/admin-materi.test.ts ("satu materi boleh muncul di bawah
  // LEBIH dari satu kelompok layanan").

  it("RLS menyala", async () => {
    // Tabel baru lahir TANPA RLS. Ini pemeriksaan yang sudah pernah menyelamatkan
    // repo ini, jadi ia ditulis untuk setiap tabel baru.
    const baris = await querySql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'material_services'`,
    );
    expect(baris[0].relrowsecurity).toBe(true);
  });

  it("authenticated memegang SELECT, INSERT & DELETE — TIDAK UPDATE", async () => {
    // Sampai Task 10, hanya SELECT: aplikasi masih menulis lewat kolom tunggal
    // `materials.service_id`, jadi tidak ada jalur pengguna yang menulis tabel
    // ini sama sekali. Task 11 memindahkan penulisan tautan materi<->layanan
    // ke sini (`gantiLayananMateri`, hapus-lalu-sisip berlingkup material_id,
    // lewat SESI PENGGUNA — bukan service role), dan Postgres menuntut hak
    // tabel di samping policy RLS-nya. UPDATE sengaja TIDAK diberikan:
    // `gantiLayananMateri` hanya pernah delete lalu insert, primary key
    // gabungan (material_id, service_id) membuat "ubah baris yang ada" tidak
    // pernah dipakai.
    const baris = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_services'
         and grantee = 'authenticated'
       order by privilege_type`);
    expect(baris.map((b) => b.privilege_type)).toEqual(["DELETE", "INSERT", "SELECT"]);
  });

  it("anon tidak memegang hak apa pun", async () => {
    const baris = await querySql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_services'
         and grantee = 'anon'`);
    expect(baris).toEqual([]);
  });
});
