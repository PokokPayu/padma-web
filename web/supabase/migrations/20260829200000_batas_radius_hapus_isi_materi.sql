-- ============================================================================
-- BATAS RADIUS PENGHAPUSAN ISI MATERI — memperbaiki PREMIS, bukan daftar tabel
-- ============================================================================
-- Migration sebelumnya (`cabut_hak_hapus_berlebih`, 20260829190000) bagian (2)
-- SENGAJA mempertahankan DELETE pada `material_chapters` & `material_videos`,
-- dan menuliskan alasannya:
--
--   "Yang membedakannya dari `materials`: blast radius satu permintaan.
--    Menghapus materi menyapu seluruh isinya sekaligus lewat cascade;
--    menghapus satu bab menghapus satu bab."
--
-- Kalimat terakhir itu SALAH. Kekeliruannya bukan pada pendataan tabel
-- melainkan pada satu asumsi yang tidak pernah diuji lewat PostgREST: filter
-- pada URL adalah PILIHAN PEMANGGIL, bukan pembatas baris. Direproduksi
-- sebagai admin sungguhan (anon key + JWT admin, BUKAN service role), bukan
-- dibaca dari policy:
--
--   sebelum: chapters=5 videos=3
--   DELETE /rest/v1/material_chapters?urutan=gte.0
--   Authorization: Bearer <JWT admin>
--   -> HTTP 204
--   sesudah: chapters=0 videos=3      <-- SATU permintaan, seluruh bab klinik
--
--   DELETE /rest/v1/material_videos?material_id=not.is.null   -> videos=0
--
-- Jadi radius nyata tabel isi justru LEBIH BESAR daripada radius `materials`
-- yang dilarang bagian (1a) dengan alasan radius: menghapus satu `materials`
-- hanya menyapu isi SATU materi, sedangkan satu permintaan di sini menyapu isi
-- SELURUH materi klinik sekaligus.
--
-- Satu-satunya pagar yang pernah ada adalah penolakan PostgREST terhadap
-- DELETE tanpa query string sama sekali:
--   DELETE /rest/v1/material_videos  -> 400 {"code":"21000",
--                                            "message":"DELETE requires a WHERE clause"}
-- dan ia dilewati hanya dengan menambahkan satu filter yang selalu benar. Ia
-- pagar terhadap kekeliruan jari, bukan terhadap penyalahgunaan.
--
-- ===== YANG DIPERBAIKI DI SINI, DAN YANG SENGAJA TIDAK =====
-- Penyuntingan bab TETAP pekerjaan sah — premis bagian (2) benar pada bagian
-- ITU, dan `revoke delete` polos akan membunuh kemampuan yang memang
-- dibutuhkan (`material_videos` berelasi 1:1 dengan materi dan tidak punya
-- kolom `aktif`; satu-satunya cara melepas video dari materi adalah menghapus
-- barisnya). Karena itu yang ditutup adalah JALUR MASSALNYA, bukan
-- penyuntingannya: verba DELETE dicabut dari peran API, dan pekerjaannya
-- dipindah ke fungsi berparameter TUNGGAL — pola yang sudah dipakai
-- `klaim_sudah_bayar` untuk klaim klien. Satu panggilan = satu baris, sehingga
-- radius yang selama ini hanya DIKLAIM kini benar-benar DITEGAKKAN oleh basis
-- data.
--
-- Trigger `before delete ... for each statement` yang menolak bila lebih dari
-- satu baris akan terhapus sempat dipertimbangkan dan tidak dipilih: ia lebih
-- murah, tetapi menyimpan batasnya di tempat yang tidak terlihat pemanggil dan
-- tetap membiarkan `authenticated` memegang verba DELETE — hak yang kemudian
-- ikut mewarisi setiap kekeliruan filter berikutnya. Fungsi berparameter
-- tunggal menjadikan batas itu bagian dari ANTARMUKA.
--
-- `service_role` TIDAK tersentuh di mana pun: itulah jalur seed
-- (`supabase/seed.sql`, `scripts/seed-users.ts`) dan pembersihan `afterAll`
-- seluruh suite test, dan ia memang boleh menghapus banyak baris sekaligus
-- karena tidak pernah datang dari browser.

-- ---------------------------------------------------------------------------
-- (1) CABUT VERBA DELETE — hanya DELETE
-- ---------------------------------------------------------------------------
-- Mengikuti pelajaran yang sudah tiga kali dibayar di repo ini
-- (materials.video_url, client_invites.token_hash, client_packages): hak KOLOM
-- dan `revoke all` mematahkan `select *` serta payload baris utuh, sedangkan
-- `revoke delete on <tabel>` tidak menyentuh select/insert/update sama sekali.
-- Panel materi Plan 3B tetap bisa menambah bab, mengubah judul/urutan/isi, dan
-- mengganti URL video seperti hari ini.
revoke delete on public.material_chapters from authenticated;
revoke delete on public.material_videos   from authenticated;

-- ---------------------------------------------------------------------------
-- (2) SATU PANGGILAN = SATU BARIS
-- ---------------------------------------------------------------------------
-- `security definer` karena verba DELETE-nya baru saja dicabut dari
-- `authenticated`. Konsekuensinya `current_user` di dalam fungsi menjadi
-- `postgres` — pemilik tabel, yang MELEWATI RLS — jadi identitas pemanggil
-- TIDAK boleh diambil dari `current_user`. Ia diambil dari `user_role()`, yang
-- membaca GUC klaim JWT request dan tidak terpengaruh security definer; itulah
-- satu-satunya gerbang wewenang di sini, dan karena itu ia ditulis sebagai
-- baris pertama fungsi.
--
-- Radiusnya ditegakkan oleh BENTUK fungsinya, bukan oleh disiplin pemanggil:
-- satu argumen, dan argumen itu PRIMARY KEY. Tidak ada bentuk pemanggilan yang
-- bisa menyentuh baris kedua.
create or replace function public.hapus_bab_materi(bab_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  terhapus uuid;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh menghapus bab materi'
      using errcode = '42501';
  end if;

  delete from public.material_chapters c
   where c.id = bab_id
  returning c.id into terhapus;

  -- NULL berarti "tidak ada yang cocok", bukan error: bab yang sudah lebih
  -- dulu dihapus rekan sekerja tidak perlu memunculkan layar merah.
  return terhapus;
end;
$$;

-- `material_videos.material_id` adalah PRIMARY KEY (relasi 1:1 dengan materi),
-- jadi argumen tunggalnya pun mengunci tepat satu baris. Dinamai "lepas"
-- karena itulah arti operasinya bagi produk: materi tetap ada, videonya yang
-- dilepas — dan penggantinya dipasang lewat INSERT/UPSERT biasa, yang tidak
-- ikut dicabut.
create or replace function public.lepas_video_materi(materi_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  terhapus uuid;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh melepas video materi'
      using errcode = '42501';
  end if;

  delete from public.material_videos v
   where v.material_id = materi_id
  returning v.material_id into terhapus;

  return terhapus;
end;
$$;

-- Aturan [F] migration `fail_closed_sequence_fungsi`: setiap fungsi/RPC baru
-- menyatakan haknya EKSPLISIT. Barisnya tetap ditulis meski default privileges
-- sudah menanganinya — baris `pg_default_acl` milik `supabase_admin` tidak bisa
-- kita ubah, jadi hak fungsi tidak boleh bergantung pada siapa yang kebetulan
-- menjalankan migration. PostgREST mengekspos setiap fungsi `public` sebagai
-- RPC, dan anon key tertanam di bundel browser.
revoke execute on function public.hapus_bab_materi(uuid)    from public, anon;
revoke execute on function public.lepas_video_materi(uuid)  from public, anon;
grant  execute on function public.hapus_bab_materi(uuid)    to authenticated;
grant  execute on function public.lepas_video_materi(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- (3) INVARIAN DITULIS DI SKEMA
-- ---------------------------------------------------------------------------
-- Komentar tabel adalah tempat kedua orang berikutnya melihat sebelum menulis
-- `grant delete` lagi — dan di sinilah premis yang keliru itu diluruskan agar
-- tidak diwarisi tabel isi berikutnya di Plan 3B. Keberadaannya diuji
-- regression test supaya tidak hilang tanpa sadar.
comment on table public.material_chapters is
  'Bab materi. Penyuntingan (insert/update) TETAP pekerjaan sah staf, tetapi '
  'verba DELETE dicabut dari peran API: filter PostgREST adalah pilihan '
  'pemanggil, bukan pembatas baris, sehingga satu permintaan '
  '`DELETE ...?urutan=gte.0` menyapu seluruh bab seluruh materi. Penghapusan '
  'satu bab lewat public.hapus_bab_materi(bab_id) — satu panggilan, satu '
  'baris. Penghapusan massal hanya lewat service role.';

comment on table public.material_videos is
  'Video materi, satu baris per materi (material_id = primary key). '
  'Penyuntingan lewat insert/upsert/update TETAP terbuka untuk staf; verba '
  'DELETE dicabut dari peran API karena satu permintaan berfilter tautologis '
  'melepas video SELURUH materi sekaligus. Pelepasan satu video lewat '
  'public.lepas_video_materi(materi_id). Penghapusan massal hanya lewat '
  'service role.';
