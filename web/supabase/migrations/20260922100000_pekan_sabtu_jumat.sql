-- ===========================================================================
-- PEKAN HONOR BERGESER: Senin–Minggu  ->  SABTU–JUMAT
-- ===========================================================================
-- Umpan balik klien 21 Sep 2026, butir 4, dikutip utuh di
-- documents/umpan-balik-klien/2026-09-21-hasil-tes.md:
--
--   "Waktu sesi tolong diganti sabtu- jumat, bukan senin- sabtu, karena
--    paymentnya di hari sabtu"
--
-- KENAPA INI BUKAN SOAL SELERA. Gajian PADMA jatuh hari Sabtu. Di bawah pekan
-- Senin–Minggu, Sabtu duduk di TENGAH pekannya sendiri: honor dibayarkan
-- sementara pekannya masih berjalan, lalu sesi hari Minggu mendarat di pekan
-- yang tandanya SUDAH terpasang — dan tanda itu tidak bisa dicabut (DELETE
-- atas honor_marks sudah dicabut di cabut_hak_hapus_berlebih; owner pun
-- dijawab 42501). Sesi Minggu karena itu hanya bisa ditagih lewat jalur
-- "sesi susulan di bawah tanda", bukan lewat honor pekan itu sendiri.
--
-- Dengan Sabtu–Jumat, pekan TUTUP hari Jumat dan dibayar Sabtu esoknya. Tidak
-- ada lagi hari kerja yang jatuh sesudah tanda bayarnya.
--
-- Butir 3 klien ("sesi sdh selesai di board owner ga muncul") adalah gejala
-- LAIN dari batas pekan yang sama: board owner hanya menampilkan pekan
-- berjalan, jadi setiap Senin pagi sesi Sabtu & Minggu yang baru diselesaikan
-- melompat ke ember pekan sebelumnya dan lenyap dari layar. Terukur di basis
-- data produksi 22 Sep 2026: sesi selesai bertanggal 19, 20, dan 21 Sep;
-- klien membukanya Senin 21 Sep dan hanya melihat satu.
--
-- Pasangannya di TypeScript adalah `AWAL_PEKAN_ISO` di src/lib/owner/pekan.ts
-- dan `periksaPekan()` di src/app/owner/rekap/status.ts. Ketiganya harus
-- bergerak bersama: menggeser salah satu saja membuat setiap tanda bayar
-- ditolak 23514, atau — jauh lebih buruk — diterima pada hari yang tidak
-- pernah cocok dengan ember rekap mana pun.

-- ---------------------------------------------------------------------------
-- (1) TANDA BAYAR LAMA — berhenti, jangan tafsirkan ulang
-- ---------------------------------------------------------------------------
-- Sebuah tanda ber-week_start Senin TIDAK punya padanan yang jujur di bawah
-- skema baru. Menggesernya dua hari mundur ("Senin 14 -> Sabtu 12") mengubah
-- pekan yang dicakupnya: sesi Sabtu 12 & Minggu 13 tiba-tiba masuk ke tanda
-- yang dipasang untuk pekan 14–20, sementara Sabtu 19 & Minggu 20 keluar.
-- Itu menulis ulang BUKTI pembayaran, dan bukti yang ditulis ulang tidak lagi
-- jadi bukti.
--
-- Karena itu migrasi ini BERHENTI, dengan kalimat yang bisa dibaca manusia,
-- alih-alih menebak. Diukur 22 Sep 2026: produksi punya NOL baris honor_marks,
-- jadi jalur ini memang tidak akan pernah menyala di sana. Ia ada untuk basis
-- data lain — dan untuk masa depan, ketika nol itu sudah tidak benar lagi.
do $$
declare
  n bigint;
begin
  select count(*) into n
  from public.honor_marks
  where extract(isodow from week_start) <> 6;

  if n > 0 then
    raise exception using
      errcode = 'data_exception',
      message = format('%s tanda bayar honor masih ber-week_start bukan-Sabtu', n),
      detail  = 'Pekan honor bergeser dari Senin–Minggu ke Sabtu–Jumat. Tanda '
                'lama tidak bisa dipetakan ulang tanpa mengubah pekan yang '
                'dicakupnya, dan itu berarti menulis ulang bukti pembayaran.',
      hint    = 'Putuskan per baris bersama pemilik klinik sebelum menjalankan '
                'migrasi ini: arsipkan tandanya, atau catat pembayarannya '
                'sebagai fakta baru di pekan Sabtu yang tepat.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- (2) CHECK: hari awal pekan
-- ---------------------------------------------------------------------------
-- Tetap CHECK dan bukan trigger bergerbang peran, alasan yang SAMA seperti
-- ketika ia lahir di pengerasan_tabel_uang: bentuk `week_start` bukan soal
-- KEWENANGAN melainkan soal data yang tidak punya arti. Tanda yatim yang
-- disemai service role sama yatimnya dengan yang disemai owner.
--
-- Namanya ikut berganti. Sebuah constraint bernama `..._senin` yang menuntut
-- Sabtu adalah persis jenis kebohongan diam yang akan dipercaya pembaca
-- berikutnya — dan nama constraint muncul apa adanya di pesan galat Postgres
-- yang dibaca saat sesuatu rusak.
alter table public.honor_marks
  drop constraint if exists honor_marks_awal_pekan_senin;

alter table public.honor_marks
  add constraint honor_marks_awal_pekan_sabtu
  check (extract(isodow from week_start) = 6);

-- ---------------------------------------------------------------------------
-- (3) KOMENTAR yang jadi salah
-- ---------------------------------------------------------------------------
-- Komentar tabel menyebut "week_start wajib Senin (CHECK
-- honor_marks_awal_pekan_senin)". Dua-duanya sudah tidak benar. Komentar basi
-- pada tabel uang bukan kerapian yang tertunda: ia dasar tertulis yang membuat
-- kode salah terlihat benar (Ruling 26).
comment on table public.honor_marks is
  'BUKTI bahwa seorang mitra sudah dibayar untuk satu pekan (unik per '
  'partner_id, week_start). APPEND-ONLY untuk peran API: week_start wajib '
  'SABTU (CHECK honor_marks_awal_pekan_sabtu, berlaku untuk SEMUA peran karena '
  'tanda yatim tidak punya arti bagi siapa pun), ditandai_oleh & dibayar_pada '
  'direbut dari payload (trigger trg_jaga_tanda_honor), UPDATE ditolak '
  'seluruhnya (trigger trg_kunci_tanda_honor), DELETE sudah dicabut '
  '(cabut_hak_hapus_berlebih). Pembatalan yang sah adalah fakta baru — sebuah '
  'kolom pembatalan berjejak — bukan penghapusan atau penulisan ulang fakta lama. '
  'Pekan berjalan MASIH boleh ditandai, dan sesudah pergeseran ke Sabtu–Jumat '
  'itu berarti membayar di muka (Sabtu kini hari PERTAMA pekannya, bukan hari '
  'keenam) — kelonggaran yang sengaja dipertahankan, bukan kelalaian.';
