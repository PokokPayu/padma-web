-- ============================================================================
-- TARIF DASAR UNTUK `di_atas_20` — PELAPISAN, BUKAN PEMBALIKAN RULING 6
-- ============================================================================
-- CHECK `transport_rates_bukan_per_kasus` lahir dari review red-team yang
-- membuktikan doktrin ">20 km bukan tarif" tidak menghalangi apa pun selama ia
-- hanya hidup sebagai komentar tabel. Doktrin itu benar untuk masalah yang
-- dilihatnya, dan SALAH untuk masalah yang belum terlihat waktu itu:
--
--   pengajuan >20 km
--     -> tarifnya milik owner per kasus, disimpan per SESI (transport_khusus)
--     -> sesi baru lahir SESUDAH lunas (konfirmasi_permintaan menuntut 'lunas')
--     -> untuk lunas, tagihannya harus terbit
--     -> untuk terbit, tarifnya harus ada
--     -> tarifnya baru bisa ditetapkan kalau sesinya ada
--
-- Lingkaran tertutup: SETIAP klien yang tinggal lebih dari 20 km dari bidannya
-- tidak akan pernah bisa memesan. Itu bukan pagar uang, itu fitur yang mati.
--
-- Yang diputuskan karena itu BUKAN "di_atas_20 sama seperti jenjang lain",
-- melainkan DUA LAPIS:
--
--   1. `transport_rates` memuat tarif DASAR `di_atas_20` — supaya tagihan
--      selalu bisa terbit dan klien selalu tahu berapa yang harus dibayar;
--   2. `transport_khusus` TETAP HIDUP dan TETAP MENANG bila ada — supaya 80 km
--      tidak pernah tertagih sama dengan 25 km.
--
-- Kekhawatiran Ruling 6 ("dua sumber kebenaran untuk nominal yang sama") tidak
-- kembali, karena urutannya ditetapkan dan hanya ada satu: penimpa dulu, baru
-- tarif dasar. Aturan itu hidup di `hitungTagihanPengajuan()`
-- (src/lib/tagihan/pengajuan.ts) sebagai SATU cabang, bukan tersebar.
--
-- Tabel ini tetap append-only berjenjang. Migrasi ini SENGAJA tidak menyisipkan
-- satu baris tarif pun: nominal adalah keputusan owner, dan migrasi yang
-- membawa angka uang menjadikan angka itu bagian dari SKEMA — tidak bisa
-- diubah tanpa migrasi berikutnya, dan tercatat di riwayat git alih-alih di
-- `berlaku_sejak`. Barisnya masuk lewat `seed.sql` untuk pengembangan dan lewat
-- panel owner /owner/transport untuk produksi.

alter table public.transport_rates
  drop constraint transport_rates_bukan_per_kasus;

comment on table public.transport_rates is
  'Rate card transport per jenjang jarak, append-only berjenjang. Termasuk '
  '`di_atas_20` sebagai tarif DASAR sejak migrasi tarif_dasar_di_atas_20 — '
  'lihat komentar di berkas migrasi itu untuk alasannya. Owner menimpanya per '
  'kasus lewat `transport_khusus`, dan penimpa selalu menang.';

comment on table public.transport_khusus is
  'PENIMPA per kasus atas tarif dasar `di_atas_20` di `transport_rates`, '
  'ditetapkan owner per SESI. Sebelum migrasi tarif_dasar_di_atas_20 tabel ini '
  'adalah SATU-SATUNYA sumber nominal >20 km, dan itulah yang membuat pengajuan '
  '>20 km tidak pernah bisa ditagih. Sekarang ia opsional: ketiadaannya berarti '
  'tarif dasar yang berlaku, bukan tagihan yang tertahan.';
