-- Dua kejadian penyalur sesi (tugas B3, spec §6.4). Berdiri di migrasi
-- sendiri karena nilai enum yang baru ditambahkan belum bisa dipakai di
-- transaksi yang sama; pemakaiannya di 20261113140300_salurkan_sesi.sql.
-- Urutannya mengikat: KEJADIAN_PESANAN_SAH (src/lib/pesanan/status.ts)
-- diadu dengan pg_enum menurut enumsortorder.
alter type public.order_event add value 'sesi_terkonfirmasi';
alter type public.order_event add value 'sesi_tertahan';
