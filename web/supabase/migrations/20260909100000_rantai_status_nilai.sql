-- ============================================================================
-- RANTAI STATUS C1 (1/2): NILAI ENUM
-- ============================================================================
-- Berkas ini HANYA memindahkan nama dan menambah anggota enum. Tidak ada satu
-- pun indeks, fungsi, atau CHECK di sini — semuanya di berkas berikutnya.
--
-- Alasannya bukan kerapian melainkan batasan Postgres yang sudah DIPROBE
-- langsung di basis data lokal (8 Sep 2026):
--
--   begin;
--   alter type booking_status add value 'coba';
--   select 'coba'::booking_status;
--   -- ERROR: 55P04 unsafe use of new value "coba" of enum type booking_status
--
-- Nilai yang BARU ditambahkan tidak boleh DIPAKAI di transaksi yang sama —
-- penambahannya sendiri boleh (aturan "tidak boleh di dalam transaksi" adalah
-- Postgres sebelum v12). Supabase CLI menjalankan tiap berkas migrasi dalam
-- transaksinya sendiri, jadi predikat indeks atau CHECK yang menyebut
-- 'mencari_mitra' di sini akan menggagalkan seluruh migrasi. RENAME tidak punya
-- batasan itu (juga diprobe: rename lalu pakai di transaksi yang sama
-- BERHASIL) — tetapi nilai yang DITAMBAH tetap tidak boleh, jadi pemisahannya
-- tetap wajib.
--
-- Rantai yang dipasang (spec C1 J1), berbahasa Indonesia karena SELURUH enum
-- repo ini berbahasa Indonesia; yang diadopsi dari usulan klien adalah
-- modelnya, bukan ejaannya:
--
--   booking_requests: diminta -> mencari_mitra -> mitra_siap -> dikonfirmasi
--                     (dan dibatalkan_klien dari ketiga keadaan pertama)
--   sessions:         terjadwal -> berjalan -> selesai
--                     (dan tidak_hadir / dibatalkan_padma)
--
-- `menunggu_bayar` SENGAJA TIDAK ADA. Ia milik C2, disisipkan antara
-- `mitra_siap` dan `dikonfirmasi`. Nilai enum yang belum dipakai adalah keadaan
-- mati di dalam basis data yang tidak satu pun kode tahu cara keluar darinya.

-- ===== PERMINTAAN =====
-- RENAME, bukan ADD + backfill + DROP: baris permintaan yang sudah ada tetap
-- berarti hal yang sama persis. 'menunggu' dan 'diminta' adalah nama untuk
-- keadaan yang identik.
alter type booking_status rename value 'menunggu' to 'diminta';

alter type booking_status add value 'mencari_mitra' after 'diminta';
alter type booking_status add value 'mitra_siap' after 'mencari_mitra';
alter type booking_status add value 'dibatalkan_klien';

-- 'ditolak' TIDAK disentuh (spec J8): nilainya dipertahankan supaya permintaan
-- lama yang pernah ditolak tetap terbaca, hanya tidak lagi terjangkau dari
-- layar mana pun.

-- ===== SESI =====
-- 'batal' berganti nama: sesudah C3 ada DUA pihak yang bisa membatalkan sesi,
-- dan "batal" tidak menyebut siapa. Nama yang tidak menyebut pelakunya adalah
-- nama yang akan salah dibaca begitu pihak kedua muncul.
alter type session_status rename value 'batal' to 'dibatalkan_padma';

alter type session_status add value 'berjalan' after 'terjadwal';
alter type session_status add value 'tidak_hadir' after 'selesai';
