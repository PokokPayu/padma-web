-- Kapan email tagihan terakhir BERHASIL terkirim untuk pengajuan ini.
--
-- Kenapa disimpan dan bukan sekadar nilai balik server action: admin yang
-- memuat ulang halaman kehilangan nilai balik itu, dan yang tersisa adalah
-- layar yang tidak bisa membedakan "email sudah sampai" dari "email tidak
-- pernah terkirim". Di atas tenggat 24 jam, perbedaan itu menentukan apakah
-- kliennya kehilangan slot.
--
-- NULL berarti belum pernah berhasil — termasuk ketika RESEND_API_KEY belum
-- terpasang. Bukan kolom nominal: money firewall memindai nama kolom terhadap
-- pola uang (harga/honor/tarif/biaya/bayar/total/…), dan tidak satu pun cocok.
alter table public.booking_requests
  add column email_tagihan_pada timestamptz null;

comment on column public.booking_requests.email_tagihan_pada is
  'Kapan email tagihan terakhir BERHASIL terkirim. NULL = belum pernah.';
