-- ===========================================================================
-- HARGA PUBLIK HANYA UNTUK PRODUK YANG SUDAH TAYANG
-- ===========================================================================
-- `harga_produk_publik` dibuat di migration `produk_harga` dengan satu saringan
-- saja — `berlaku_sejak <= hari ini` — lalu diberikan kepada `anon`. Karena
-- view itu tidak menyinggung `digital_products` sama sekali, satu permintaan
-- polos:
--
--   GET /rest/v1/harga_produk_publik
--
-- memulangkan id, harga, harga coret, dan tanggal berlaku SELURUH produk,
-- termasuk yang belum ditayangkan — sementara `digital_products` sendiri
-- menyembunyikannya rapat dari anon lewat policy "produk: baca publik yang
-- aktif". Yang bocor bukan cuma angka: jumlah produk yang sedang disiapkan dan
-- tanggal peluncurannya ikut terbaca.
--
-- KENAPA PRESEDEN `harga_publik` TIDAK BERLAKU DI SINI. View itu (tarif varian
-- layanan) memang tanpa saringan publikasi, dan itu benar untuknya: tabel
-- `variant_rates` menggantung pada `service_variants` yang TIDAK punya sumbu
-- "belum ditampilkan" sama sekali — tidak ada keadaan yang bisa bocor.
-- `digital_products` PUNYA sumbu itu (`aktif`), jadi presedennya berhenti di
-- situ; yang disalin dari `harga_publik` adalah bentuk view-nya, bukan
-- ketiadaan saringannya.
--
-- `produk_harga_staf` SENGAJA TIDAK DISENTUH: panel staf justru harus melihat
-- harga produk yang belum tayang dan harga yang baru berlaku besok — itulah
-- gunanya view kedua yang terpisah, dan pagarnya adalah predikat
-- `user_role() in ('admin','owner')` di dalamnya.
--
-- `create or replace` mempertahankan GRANT yang sudah menempel (anon &
-- authenticated select); daftar kolomnya tidak berubah, jadi assertion "empat
-- kolom" di tests/produk-harga-publik.test.ts tetap menjadi pagar yang sama.
-- Join-nya aman menembus RLS `digital_products` karena view ini
-- `security_invoker = off` — ia memang batas kolom DAN batas barisnya sendiri.
create or replace view public.harga_produk_publik with (security_invoker = off) as
  select distinct on (h.product_id)
         h.product_id, h.harga, h.harga_coret, h.berlaku_sejak
    from public.digital_product_prices h
    join public.digital_products p on p.id = h.product_id
   where p.aktif
     and h.berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date
   order by h.product_id, h.berlaku_sejak desc;

comment on view public.harga_produk_publik is
  'Harga berlaku per produk TAYANG untuk etalase & landing. Empat kolom, '
  'dikunci sebagai assertion di tests/produk-harga-publik.test.ts. Produk yang '
  'belum aktif tidak muncul sama sekali — harganya, jumlahnya, maupun tanggal '
  'berlakunya bukan kabar untuk publik. Tidak ada honor mitra di sini — produk '
  'digital memang tidak punya.';
