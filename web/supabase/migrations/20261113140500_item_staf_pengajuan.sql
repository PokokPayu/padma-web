-- ===========================================================================
-- P3/B5 — pesanan_item_staf memikul booking_request_id
-- ===========================================================================
-- Email tagihan sesi menampilkan angka BEKU pesanan terbuka milik satu
-- pengajuan. Tanpa kolom ini satu-satunya jalan dari pengajuan ke item
-- uangnya adalah lewat `orders` lalu `kode`, dua bacaan yang bisa berselisih.
--
-- `create or replace view` hanya boleh MENAMBAH kolom di ujung daftar, dan
-- tidak menjatuhkan `grant select ... to authenticated` (lihat dokblok
-- 20261006100000). `booking_request_id` BUKAN kolom nominal: ia tidak cocok
-- satu pun pola di `POLA_NOMINAL`, jadi allowlist money firewall
-- (`harga_beku` satu-satunya kolom uang) tidak berubah.
create or replace view public.pesanan_item_staf with (security_invoker = off) as
  select i.pesanan_id,
         o.kode,
         i.jenis,
         i.judul_beku,
         i.harga_beku,
         i.urutan,
         i.product_id,
         i.booking_request_id
    from public.order_items i
    join public.orders o on o.id = i.pesanan_id
   where public.user_role() in ('admin', 'owner');

comment on view public.pesanan_item_staf is
  'Item pesanan BERNOMINAL untuk /admin/pesanan, /admin/penjualan dan email '
  'tagihan sesi — delapan kolom, predikat user_role() di dalam badannya. Anon '
  'tidak pernah. Inilah satu-satunya jalan harga beku keluar dari order_items. '
  'product_id demi pengelompokan per produk; booking_request_id demi menautkan '
  'item pesanan sesi ke pengajuannya.';
