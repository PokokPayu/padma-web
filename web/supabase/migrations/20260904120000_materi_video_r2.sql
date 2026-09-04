-- Video pindah dari URL penyedia ke objek di bucket R2 privat.
--
-- Kenapa barisnya DIHAPUS lebih dulu, bukan dibiarkan: isinya URL Vimeo /
-- Cloudflare Stream, dan sesudah rename ia akan terbaca sebagai "kunci objek"
-- yang tidak pernah ada di R2. Akibatnya `punyaIsi()` menjawab "berisi",
-- panel admin menyatakan materi siap terbit, dan pasien mendapat pemutar yang
-- tidak akan pernah jalan — kegagalan yang tidak memerahkan apa pun. Produksi
-- belum punya satu baris pun, jadi yang terhapus hanyalah baris demo lokal.
delete from public.material_videos;

alter table public.material_videos rename column url to objek;

-- `mime` disimpan karena tanpa transkode berkas datang apa adanya: peramban
-- perlu diberi tahu tipenya. `check` menjaga agar hanya dua tipe yang
-- benar-benar didukung elemen <video> bisa masuk.
--
-- Grant `material_videos` bersifat TINGKAT TABEL (diverifikasi lewat
-- role_table_grants), sehingga kolom ini mewarisi haknya sendiri. JANGAN
-- menambahkan grant kolom di sini: di repo ini grant kolom sudah tiga kali
-- membuat `select *` gagal 42501 alih-alih menyembunyikan kolom.
alter table public.material_videos
  add column mime text not null default 'video/mp4'
  check (mime in ('video/mp4', 'video/webm'));

comment on column public.material_videos.objek is
  'Kunci objek di bucket R2 privat, BUKAN URL. Bentuk: {material_id}/{acak}.{ext}';

-- PENYIMPANGAN DARI BRIEF TASK 1 (dicatat di sini, bukan disembunyikan) —
-- PENCABUTAN INI SEMENTARA, DIKONFIRMASI KOORDINATOR:
-- `material_videos_host_terproteksi` (migration `pengerasan_admin`) menuntut
-- `objek ~ '^https://.../vimeo.com/...'` dkk. — kontrak yang BENAR untuk
-- `url`, tapi mustahil untuk `objek`: TIDAK ADA string yang sekaligus cocok
-- regex "^https://..." itu DAN gagal `like 'http%'`. Karena test 5 di
-- `tests/materi-video-skema.test.ts` (diberikan verbatim, tidak diubah)
-- menuntut TIDAK ADA baris `objek like 'http%'` yang tersisa, dan beberapa
-- test regresi lain (RLS kebocoran, gating passport, invarian "materi aktif
-- tidak boleh tanpa isi" di admin-materi.test.ts) menuntut baris video
-- SUNGGUHAN tetap ada untuk materi demo — constraint lama ini membuat KEDUA
-- tuntutan itu sekaligus mustahil dipenuhi.
--
-- Cakupan ancaman yang hilang bersama constraint ini LEBIH LUAS daripada
-- "admin mengetik javascript:/host asing lewat formulir": `periksaUrlVideo()`
-- (src/app/admin/materi/aksi.ts, TIDAK disentuh Task 1) hanya menjaga jalur
-- lewat server action. Grant `material_videos` bersifat TINGKAT TABEL —
-- `authenticated` memegang INSERT/UPDATE, dan policy "video: staf" memberinya
-- ke admin/owner — sehingga admin yang sudah login bisa `PATCH
-- /rest/v1/material_videos?material_id=eq.…` dengan `objek` BEBAS langsung
-- lewat PostgREST, tanpa pernah menyentuh `aksi.ts` sama sekali. Jalur ini
-- BUKAN teoretis: `tests/hak-hapus-berlebih.test.ts` dan
-- `tests/rls-materi.test.ts` sendiri memakainya (update `objek` lewat sesi
-- admin biasa). Task 6 memindahkan cara `objek` diisi (kunci dibuat server
-- lewat presigned upload) TIDAK menutup jalur PATCH langsung ini — itu
-- alasan pagar DB perlu kembali, bukan alasan ia boleh dilupakan.
--
-- Task 6 mengembalikan pagar ini dalam BENTUK BARU: check yang memvalidasi
-- BENTUK KUNCI OBJEK (mis. `{material_id}/{acak}.{ext}`), bukan host URL —
-- brief Task 6 sudah ditugaskan mengerjakan ini. Sampai saat itu,
-- `POLA_URL_VIDEO` (src/app/admin/materi/status.ts) adalah SATU-SATUNYA
-- penjaga, dan HANYA berlaku untuk jalur lewat `aksi.ts`.
--
-- Test constraint ini (`tests/admin-pengerasan.test.ts`) disunting mengikuti
-- perubahan ini — lihat komentar di sana.
alter table public.material_videos
  drop constraint material_videos_host_terproteksi;
