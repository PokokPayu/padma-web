-- Mencabut fungsi Midtrans. Penggantinya `terapkan_notifikasi_gateway`
-- (20261113130100); salinan sementaranya di 20261113130000 tidak lagi dipanggil
-- rute, rekonsiliasi, maupun uji mana pun.
drop function public.terapkan_notifikasi_midtrans(text, text, text, text, text, numeric, text, text);
