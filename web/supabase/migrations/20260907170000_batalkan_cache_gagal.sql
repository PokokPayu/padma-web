-- ============================================================================
-- MEMBATALKAN KEGAGALAN GEOCODING YANG DICATAT STRATEGI LAMA — utang #2
-- ============================================================================
-- `geocode_cache` mencatat kegagalan TANPA masa kedaluwarsa, dan itu keputusan
-- yang benar: tanpanya, alamat yang tidak dikenal OSM ditanyakan ulang setiap
-- kali formulirnya dibuka — pelanggaran batas laju yang lahir dari niat baik.
--
-- Tetapi setiap baris berlat/lon NULL yang ada hari ini adalah jawaban atas
-- pertanyaan yang SUDAH TIDAK KITA AJUKAN LAGI. Ia dicatat ketika
-- `geocodeAlamat()` bertanya SEKALI, dengan alamat apa adanya. Sejak ladder
-- ada, fungsi itu bertanya sampai tiga kali dan mengupas alamatnya — dan
-- pengukuran 7 September 2026 menunjukkan bentuk "jalan + kota" berhasil pada
-- 23 dari 32 alamat berbentuk Malang, terhadap 6 dari 32 pada bentuk aslinya.
--
-- Membiarkan baris-baris itu berarti ladder TIDAK PERNAH berlaku bagi alamat
-- yang sudah terlanjur gagal — justru alamat yang paling membutuhkannya, dan
-- kegagalannya akan terlihat permanen tanpa ada yang tahu kenapa.
--
-- Yang dihapus HANYA baris kegagalan. Baris berhasil tidak disentuh: koordinat
-- yang sudah benar tidak menjadi lebih benar dengan ditanyakan ulang, dan
-- menghapusnya berarti membakar jatah Nominatim tanpa alasan.
--
-- Ini pembatalan SEKALI JALAN, bukan TTL. Kegagalan yang dicatat SESUDAH
-- migrasi ini berarti ketiga tingkat ladder sudah dicoba dan semuanya kosong —
-- bukti yang jauh lebih kuat daripada sebelumnya, dan memang layak permanen.
-- Coba-ulang berkala tetap terbuka sebagai pekerjaan tersendiri.

delete from public.geocode_cache where lat is null or lon is null;

comment on table public.geocode_cache is
  'Hasil geocoding per alamat kanonik. Baris ber-lat/lon NULL berarti KETIGA '
  'tingkat ladder (alamat penuh, tanpa nomor rumah, jalan + kota) sudah dicoba '
  'dan semuanya kosong — bukan sekadar satu pertanyaan yang gagal.';
