-- ===========================================================================
-- P4 (1/7) — pesanan_item_staf memikul product_id
-- ===========================================================================
-- Rekap penjualan mengelompokkan per PRODUK. Tanpa kolom ini satu-satunya
-- kunci yang tersedia adalah `judul_beku` — dan judul beku memang BEKU per
-- baris nota. Akibatnya satu produk yang pernah diganti namanya pecah menjadi
-- dua baris laporan, keduanya terlihat masuk akal, tanpa satu pun galat.
--
-- `create or replace view`, BUKAN drop + create. Dua alasan:
--   * ia mengizinkan penambahan kolom DI UJUNG daftar tanpa menjatuhkan hak;
--   * `drop view` menjatuhkan `grant select ... to authenticated` dan memaksa
--     baris itu ditulis ulang. Satu baris yang mudah terlupa — dan yang kalau
--     terlupa membuat layar staf kosong TANPA galat, karena hak yang hilang
--     di PostgREST berujung nol baris, bukan 42501, saat view-nya sendiri
--     masih ada.
--
-- `product_id` BUKAN kolom nominal: ia tidak cocok dengan satu pun pola di
-- `POLA_NOMINAL` (tests/money-firewall-struktural.test.ts). Karena itu
-- `KOLOM_UANG_VIEW_DIIZINKAN` TIDAK perlu disunting, dan bila uji money
-- firewall merah sesudah migrasi ini, itu tanda ada yang salah — bukan tanda
-- daftarnya perlu ditambah.
--
-- Nol perubahan pada `order_items`, nol perubahan pada hak, nol kolom baru di
-- tabel mana pun.
create or replace view public.pesanan_item_staf with (security_invoker = off) as
  select i.pesanan_id,
         o.kode,
         i.jenis,
         i.judul_beku,
         i.harga_beku,
         i.urutan,
         i.product_id
    from public.order_items i
    join public.orders o on o.id = i.pesanan_id
   where public.user_role() in ('admin', 'owner');

comment on view public.pesanan_item_staf is
  'Item pesanan BERNOMINAL untuk /admin/pesanan dan /admin/penjualan — tujuh '
  'kolom, predikat user_role() di dalam badannya. Anon tidak pernah. Inilah '
  'satu-satunya jalan harga beku keluar dari order_items. product_id ada demi '
  'pengelompokan per produk yang tidak pecah saat produk diganti nama.';
