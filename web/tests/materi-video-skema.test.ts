import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

describe("skema material_videos sesudah pindah ke R2", () => {
  it("punya kolom objek & mime, dan TIDAK punya url lagi", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='material_videos'`,
    );
    const nama = kolom.map((k) => k.column_name);
    expect(nama).toContain("objek");
    expect(nama).toContain("mime");
    // `url` adalah nama yang BERBOHONG sesudah isinya jadi kunci objek —
    // membiarkannya hidup mengundang kode baru menuliskan URL ke sana lagi.
    expect(nama).not.toContain("url");
  });

  it("mime hanya menerima dua tipe yang benar-benar didukung <video>", async () => {
    const cek = await querySql<{ ada: boolean }>(
      `select count(*) > 0 as ada from pg_constraint
        where conrelid = 'public.material_videos'::regclass
          and contype = 'c' and pg_get_constraintdef(oid) ilike '%video/mp4%'
          and pg_get_constraintdef(oid) ilike '%video/webm%'`,
    );
    expect(cek[0].ada).toBe(true);
  });

  it("grant tetap TINGKAT TABEL, sehingga kolom mime ikut terbaca", async () => {
    // Repo ini pernah patah tiga kali karena grant kolom: mencabutnya membuat
    // `select *` gagal 42501, bukan menyembunyikan kolom. Asersi ini menjaga
    // agar penambahan `mime` tidak diam-diam mengubah bentuk grant.
    const g = await querySql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name='material_videos' and grantee='authenticated'
        order by privilege_type`,
    );
    const hak = g.map((x) => x.privilege_type);
    expect(hak).toContain("SELECT");
    expect(hak).toContain("INSERT");
    expect(hak).toContain("UPDATE");
    // DELETE sengaja TIDAK diberikan: pelepasan video hanya lewat RPC
    // `lepas_video_materi`, supaya radius ledakannya satu baris.
    expect(hak).not.toContain("DELETE");
  });

  it("kedua policy lama masih ada dengan NAMA yang sama", async () => {
    // Policy bernama baru akan BERDAMPINGAN dengan yang lama (RLS meng-OR
    // policy permisif), sehingga celah lama tetap terbuka tanpa satu pun error.
    const p = await querySql<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname='public' and tablename='material_videos'`,
    );
    const nama = p.map((x) => x.policyname);
    expect(nama).toContain("video: staf");
    expect(nama).toContain("video: klien dgn sesi selesai");
  });

  it("tidak menyisakan baris URL penyedia dari sebelum migrasi", async () => {
    // Baris lama memuat URL Vimeo/Cloudflare Stream, bukan kunci objek R2.
    // Membiarkannya berarti `punyaIsi` menjawab "berisi" untuk materi yang
    // objeknya tidak pernah ada — pasien mendapat pemutar yang tidak akan
    // pernah jalan sementara panel admin menyatakan materi itu siap.
    const sisa = await querySql<{ n: number }>(
      `select count(*)::int as n from public.material_videos
        where objek like 'http%'`,
    );
    expect(sisa[0].n).toBe(0);
  });
});
