-- ============================================================================
-- MENANAM LIMA FASE SEBAGAI DATA ACUAN
-- ============================================================================
-- `supabase db push` TIDAK menjalankan `seed.sql`; ia hanya menerapkan migrasi.
-- Sementara itu `seed.sql` mencampur dua jenis data yang sifatnya berbeda:
-- katalog DUMMY yang memang harus lahir kosong di produksi (layanan, materi,
-- paket, mitra), dan `phases` — yang bukan katalog sama sekali.
--
-- `phases` adalah DATA ACUAN: id teksnya ('prekonsepsi', 'kehamilan', 'nifas',
-- 'menopause', 'newborn') dirujuk langsung oleh kode, dan di seluruh repo
-- tabel ini HANYA DIBACA — tidak ada satu pun insert atau upsert, sehingga
-- tidak ada jalan mengisinya lewat panel. Tanpa migrasi ini produksi lahir
-- dengan katalog yang tidak menampilkan apa pun, dan sejak spec 8 September
-- juga dengan `clients.phase_id` yang melanggar foreign key pada klien pertama
-- yang fasenya diisi dari skrining.
--
-- Tidak ada test yang menangkap ini, karena test selalu berjalan di atas
-- `db reset` yang menjalankan `seed.sql`. Itulah sebabnya ia sampai ke sini
-- sebagai temuan spec deploy, bukan sebagai suite yang merah.
--
-- `on conflict do nothing` membuatnya idempoten: aman bagi basis data lokal
-- yang barisnya sudah ada dari seed, dan aman dijalankan ulang.
--
-- Baris `phases` DIHAPUS dari `seed.sql` pada commit yang sama supaya tidak ada
-- dua sumber kebenaran yang bisa berpisah diam-diam.

insert into public.phases (id, nama_sanskrit, nama, urutan) values
  ('prekonsepsi', 'Sankalpa', 'Prekonsepsi / Promil', 1),
  ('kehamilan',   'Garbha',   'Kehamilan',            2),
  ('nifas',       'Purnama',  'Nifas & Menyusui',     3),
  ('menopause',   'Sandhya',  'Menopause',            4),
  ('newborn',     'Shishu',   'Newborn Care',         5)
on conflict (id) do nothing;
