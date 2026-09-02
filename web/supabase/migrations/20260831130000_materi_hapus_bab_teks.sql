-- supabase/migrations/20260831130000_materi_hapus_bab_teks.sql
-- ============================================================================
-- BAB TEKS DIBONGKAR; ISI E-BOOK KINI GAMBAR HALAMAN
-- ============================================================================
-- Bab teks di database lahir KARENA belum ada penyimpanan berkas. Sejak
-- material_pages ada, ia tidak punya alasan hidup lagi, dan mempertahankannya
-- berarti dua jalur gating serta dua reader yang setiap pagarnya harus
-- ditegakkan dua kali.
--
-- ISI bab yang ada HILANG. Itu konsekuensi keputusan M1 yang disepakati; konten
-- demo diganti PDF dummy di seed.

drop function if exists public.hapus_bab_materi(uuid);
drop table if exists public.material_chapters;

-- `materials.service_id` digantikan material_services. Dihapus paling akhir
-- supaya seluruh task sebelumnya berjalan dengan aplikasi yang masih hidup.
alter table public.materials drop column service_id;

-- ---------------------------------------------------------------------------
-- material_services butuh hak tulis TABEL, bukan cuma policy
-- ---------------------------------------------------------------------------
-- Migration `materi_banyak_layanan` hanya memberi `grant select` — pada saat
-- itu APLIKASI masih menulis lewat `materials.service_id` tunggal, jadi tidak
-- ada jalur yang butuh menulis `material_services` lewat sesi pengguna.
-- Task 11 memindahkan tulisan itu ke sini (`gantiLayananMateri`, hapus-lalu-
-- sisip berlingkup `material_id`), dan Postgres menuntut KEDUANYA — hak tabel
-- DAN policy RLS — sebelum satu verba pun lolos; policy "materi-layanan: staf
-- kelola" sudah ada sejak awal, tetapi tanpa grant di bawah setiap percobaan
-- tulis staf sungguhan gagal 42501 "permission denied for table
-- material_services" walau policy-nya benar. DIBUKTIKAN LANGSUNG saat menulis
-- migration ini: `simpanMateri` tanpa satu pun layanan gagal persis dengan
-- pesan itu sebelum baris di bawah ditambahkan.
--
-- Bukan `grant all`: `gantiLayananMateri` hanya pernah men-delete lalu
-- insert, tidak pernah update baris yang ada (primary key gabungan membuat
-- "ubah service_id" tidak bermakna — itu selalu hapus satu tautan, sisip
-- tautan lain).
grant insert, delete on public.material_services to authenticated;

-- `comment on table` MENGGANTI komentar lama, bukan menambahkannya — jadi isi
-- pentingnya (kenapa DELETE dicabut, apa bentuk pensiunnya) DIPERTAHANKAN di
-- sini persis dari komentar sebelumnya (migration cabut_hak_hapus_berlebih;
-- tests/hak-hapus-berlebih.test.ts memeriksanya), sambil memperbarui bagian
-- yang sudah usang: `material_chapters` sudah dibongkar, dan tautan layanan
-- kini banyak-ke-banyak lewat material_services (boleh kosong).
comment on table public.materials is
  'Metadata materi. TIDAK PERNAH dihapus lewat peran API: penghapusannya '
  'menyapu material_services, material_pages & material_videos lewat ON '
  'DELETE CASCADE dalam satu permintaan. Bentuk pensiunnya adalah '
  '`aktif = false`, yang sudah disaring passport klien. DELETE hanya lewat '
  'service role. Isi e-book hidup di material_pages (gambar halaman), isi '
  'video di material_videos. Keterkaitan dengan layanan ada di '
  'material_services dan BOLEH KOSONG — materi tanpa layanan hanya terbuka '
  'lewat material_assignments, dan panel admin wajib menandainya.';

-- `material_chapters` membawa komentar tabel yang menyebut penggantinya
-- (`hapus_bab_materi`) sebelum dibongkar di atas. `material_pages` —
-- penggantinya sebagai tabel ISI materi bertipe ebook — lahir di migration
-- `materi_halaman_pdf` HANYA dengan komentar KOLOM pada `objek`, tanpa
-- komentar TABEL yang menyebut RPC penggantinya
-- (`ganti_halaman_materi`). Ditambahkan di sini, bukan diedit di migration
-- lama (migrasi lama tidak boleh disunting): pola yang sama dipertahankan —
-- larangan DELETE tanpa pengganti yang disebut eksplisit akan dibatalkan
-- orang berikutnya begitu ia butuh mengganti satu halaman.
comment on table public.material_pages is
  'Isi e-book (gambar halaman). DELETE dicabut total dari authenticated — '
  'satu-satunya jalur tulis adalah RPC ganti_halaman_materi(p_material_id, '
  'p_halaman), yang mengganti SELURUH halaman satu materi sekaligus dengan '
  'radius terkunci parameter, bukan filter PostgREST yang bisa dibuat '
  'tautologis.';
