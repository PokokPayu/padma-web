-- ============================================================================
-- C2 (1/2): NILAI ENUM PEMBAYARAN
-- ============================================================================
-- Berkas ini HANYA menambah anggota enum. Alasannya sudah diprobe langsung di
-- basis data lokal (8 Sep 2026): nilai yang BARU ditambahkan tidak boleh
-- DIPAKAI di transaksi yang sama (`55P04 unsafe use of new value`), dan
-- Supabase CLI menjalankan tiap berkas migrasi dalam transaksinya sendiri.
-- Penambahannya sendiri boleh di dalam transaksi — aturan "tidak boleh di dalam
-- transaksi" adalah Postgres SEBELUM v12.
--
-- `menunggu_bayar` disisipkan tepat di antara `mitra_siap` dan `dikonfirmasi`,
-- persis seperti yang direncanakan spec C1 J1. Nilainya sengaja TIDAK dibuat di
-- C1: nilai enum yang belum dipakai adalah keadaan mati yang tidak satu pun
-- kode tahu cara keluar darinya. Sekarang jalan masuk dan jalan keluarnya lahir
-- bersamaan.
alter type booking_status add value 'menunggu_bayar' after 'mitra_siap';

-- `dibatalkan_tenggat` BUKAN menumpang `dibatalkan_klien`, dan itu keputusan
-- (spec C2 P5). Nilai status adalah CATATAN TENTANG SIAPA — sama seperti alasan
-- `batal` diganti `dibatalkan_padma` di C1. Klien yang lupa membayar tidak sama
-- dengan klien yang memutuskan membatalkan; menumpangkannya membuat setiap
-- layar dan setiap laporan salah menyebut apa yang terjadi.
alter type booking_status add value 'dibatalkan_tenggat';
