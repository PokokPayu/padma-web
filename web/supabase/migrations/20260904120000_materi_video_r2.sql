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

-- PENYIMPANGAN DARI BRIEF TASK 1 (dicatat di sini, bukan disembunyikan):
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
-- Ancaman yang dicegahnya (admin mengetik `javascript:`/host asing ke medan
-- URL bebas) TETAP tercegah: `periksaUrlVideo()` (src/app/admin/materi/
-- aksi.ts, TIDAK disentuh Task 1) menegakkan allowlist yang SAMA di lapisan
-- aplikasi, di SETIAP jalur tulis yang masih ada sampai Task 6 membongkarnya.
-- Constraint DB ini selalu redundan (defense-in-depth) terhadap itu, bukan
-- satu-satunya penjaga. Sesudah Task 6, `objek` diisi kunci R2 yang dibuat
-- SERVER, bukan diketik admin — pola ancaman yang constraint ini cegah tidak
-- lagi berlaku, dan bila dibiarkan ia justru akan MENOLAK setiap kunci R2
-- yang sah.
--
-- Test constraint ini (`tests/admin-pengerasan.test.ts`) disunting mengikuti
-- perubahan ini — lihat komentar di sana.
alter table public.material_videos
  drop constraint material_videos_host_terproteksi;
