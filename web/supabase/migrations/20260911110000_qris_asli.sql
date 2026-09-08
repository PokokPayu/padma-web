-- ============================================================================
-- QRIS ASLI MENGGANTIKAN QR PALSU (spec C1 J12)
-- ============================================================================
-- `src/app/passport/_komponen/qris.tsx` membangkitkan pola QR DEKORATIF, dan
-- halamannya menulis apa adanya "Contoh QR — bukan untuk dipindai". Klien sudah
-- menyerahkan QRIS sungguhan (statis, NMID ID1026557963836, atas nama
-- "PADMA WOMEN'S WELLNESS HOMEC, KESEHATAN & OLAHRAGA").
--
-- Ketiganya hidup di `app_settings`, bukan ditanam di kode: kode QRIS bisa
-- berganti — merchant pindah akun, atau QRIS-nya diterbitkan ulang — dan
-- penggantiannya tidak boleh menuntut deploy.
--
-- NAMA MERCHANT & NMID ditampilkan di sebelah kodenya, dan itu bukan hiasan:
-- klien perlu bisa melihat bahwa yang ia pindai memang PADMA. QRIS statis tidak
-- menyebut nominal, jadi satu-satunya yang bisa diperiksa mata sebelum
-- mengirim uang adalah nama penerimanya.
insert into public.app_setting_keys (key, keterangan, bentuk) values
  ('qris_gambar',
   'Alamat gambar QRIS yang ditampilkan di halaman Bayar (mis. /qris-padma.jpeg)',
   'teks_polos'),
  ('qris_merchant',
   'Nama merchant persis seperti tertera pada QRIS — ditampilkan di sebelah kodenya',
   'teks_polos'),
  ('qris_nmid',
   'NMID pada QRIS — ditampilkan supaya klien bisa memastikan yang ia pindai memang PADMA',
   'teks_polos');

-- Nilai bawaan ditanam supaya halaman Bayar tidak pernah terbit tanpa QRIS.
-- `on conflict do nothing`: klinik yang sudah menetapkan miliknya sendiri tidak
-- boleh dikembalikan ke bawaan oleh sebuah migrasi.
insert into public.app_settings (key, value) values
  ('qris_gambar', '/qris-padma.jpeg'),
  ('qris_merchant', 'PADMA WOMEN''S WELLNESS HOMEC, KESEHATAN & OLAHRAGA'),
  ('qris_nmid', 'ID1026557963836')
on conflict (key) do nothing;
