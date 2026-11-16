-- P3/B7 (spec §6.8, §7): pembatalan otomatis karena tenggat dipensiunkan.
-- Cron `/api/cron/tenggat` tidak pernah dijadwalkan dan kini sudah dihapus;
-- tenggat bayar sesi kini dipegang pesanan (`orders.kedaluwarsa_pada`) dan
-- pembersihnya `/api/cron/pesanan`. Fungsi ini satu-satunya pemanggil lamanya.
drop function public.batalkan_lewat_tenggat();
