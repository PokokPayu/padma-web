-- ===========================================================================
-- HARGA PRODUK DIGITAL — riwayat, bukan satu baris yang ditimpa
-- ===========================================================================
-- Polanya disalin UTUH dari `variant_rates`: append-only untuk peran API,
-- UPDATE ditolak seluruhnya, DELETE dicabut. Alasannya sama persis — nota
-- yang sudah terbit tidak boleh berubah karena harga hari ini berubah.
create table public.digital_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.digital_products(id) on delete cascade,

  -- 0 = produk gratis. Bukan NULL: NULL berarti "belum ditetapkan", dan dua
  -- keadaan itu tidak boleh dikira satu.
  harga int not null check (harga >= 0),

  -- Angka PEMASARAN: harga sebelum diskon, dipajang tercoret. Opsional.
  harga_coret int check (harga_coret is null or harga_coret > harga),

  berlaku_sejak date not null default (now() at time zone 'Asia/Jakarta')::date,
  created_at timestamptz not null default now(),
  unique (product_id, berlaku_sejak)
);

comment on table public.digital_product_prices is
  'Riwayat harga produk digital. APPEND-ONLY untuk peran API: UPDATE ditolak '
  'seluruhnya, DELETE dicabut. harga = 0 berarti GRATIS, bukan belum '
  'ditetapkan. Dipajang publik lewat harga_produk_publik; daftar kolomnya '
  'dikunci di tests/produk-harga-publik.test.ts.';

alter table public.digital_product_prices enable row level security;

-- Hanya OWNER yang boleh menetapkan harga — pola yang sama dengan
-- `variant_rates`. Admin melihat lewat view `produk_harga_staf`, tidak pernah
-- menyentuh tabel ini.
create policy "harga produk: owner sisip" on public.digital_product_prices for insert
  to authenticated
  with check (public.user_role() = 'owner');

create policy "harga produk: owner baca" on public.digital_product_prices for select
  to authenticated
  using (public.user_role() = 'owner');

-- TIDAK ADA policy update maupun delete. Ketiadaan policy ITULAH pagarnya:
-- RLS menolak verba yang tidak punya policy, dan penolakannya senyap (0 baris),
-- bukan galat — karena itu uji memeriksa JUMLAH BARIS terdampak, bukan error.

-- SELURUH hak tabel dicabut lebih dulu dari KEDUA peran API — titik nol yang
-- disengaja. Supabase memberi hak PENUH bawaan atas setiap tabel baru di skema
-- public kepada `anon` maupun `authenticated`; tanpa baris `revoke` ini, UPDATE
-- dan DELETE menempel diam-diam dan seluruh janji append-only di atas hanya
-- berlaku di atas kertas.
--
-- Yang dibuka kembali sesudahnya ditulis di migration lain, bukan di sini:
-- `20260921140000_produk_harga_grant.sql` memberi `select, insert` kepada
-- `authenticated` saat panel owner penetapan harga lahir — dengan alasan yang
-- SAMA PERSIS dengan `variant_rates`: owner menulis lewat sesinya sendiri, dan
-- RLS ("harga produk: owner sisip"/"owner baca") yang menjadi pagar perannya,
-- bukan hak tabel. Kedua policy owner di atas karena itu bukan hiasan — sejak
-- migration itu, merekalah satu-satunya yang membedakan owner dari admin dan
-- klien, yang bertiga sama-sama peran SQL `authenticated`.
--
-- Sejak grant itu, klien yang menyentuh tabel ini berhenti di RLS (0 baris untuk
-- SELECT, 42501 "row-level security policy" untuk INSERT), BUKAN lagi di 42501
-- tingkat GRANT. Keduanya tetap dua kegagalan yang berbeda dan tetap ditagih
-- terpisah — lihat "klien TETAP dijawab 0 baris oleh RLS bahkan lewat REST
-- langsung" dan "klien yang menyisipkan harga langsung lewat REST ditolak RLS"
-- di tests/produk-harga-publik.test.ts, yang memeriksa PESAN galatnya, bukan
-- cuma kodenya.
--
-- UPDATE dan DELETE tidak pernah dibuka oleh migration mana pun: harga lama
-- tidak berubah dan tidak hilang.
revoke all on public.digital_product_prices from anon, authenticated;

-- ===== VIEW PUBLIK =====
-- `security_invoker = off` disengaja: view INILAH batas kolomnya, dan anon
-- memang tidak punya hak baca atas tabel dasarnya.
--
-- Bentuk di bawah adalah bentuk AWALNYA. Saringan "hanya produk yang tayang"
-- ditambahkan `20260921170000_harga_produk_publik_hanya_tayang.sql`: tanpa itu
-- view ini membocorkan harga & tanggal peluncuran produk yang sengaja belum
-- ditampilkan. Baca migration itu sebelum menyunting definisi di bawah.
create view public.harga_produk_publik with (security_invoker = off) as
  select distinct on (product_id)
         product_id, harga, harga_coret, berlaku_sejak
    from public.digital_product_prices
   where berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date
   order by product_id, berlaku_sejak desc;

-- DICABUT DULU dari ketiga peran, baru diberi hak yang tepat. Supabase
-- memberi hak PENUH bawaan atas setiap objek baru di skema public — termasuk
-- VIEW — kepada anon maupun authenticated; `grant` di bawah MENAMBAH, bukan
-- MENGGANTIKAN, jadi verba tulis bawaannya tetap menempel bila tidak dicabut
-- lebih dulu. `public` ikut dicabut karena view sederhana meneruskan tulisan
-- ke tabel dasarnya.
revoke all on public.harga_produk_publik from public, anon, authenticated;
grant select on public.harga_produk_publik to anon, authenticated;

comment on view public.harga_produk_publik is
  'Harga berlaku per produk untuk etalase & landing. Empat kolom, dikunci '
  'sebagai assertion di tests/produk-harga-publik.test.ts. Tidak ada honor '
  'mitra di sini — produk digital memang tidak punya.';

-- ===== VIEW STAF =====
-- Predikat peran ADA DI DALAM view, bukan hanya di GRANT: admin, owner, dan
-- klien login sebagai SATU peran SQL yang sama (`authenticated`), jadi grant
-- saja bukan batas peran. `user_role()` tetap membaca identitas PEMANGGIL
-- walau view berjalan dengan hak pemilik — `security_invoker = off`
-- membebaskan AKSES TABEL, bukan identitas sesi.
create view public.produk_harga_staf with (security_invoker = off) as
  select distinct on (product_id)
         product_id, harga, harga_coret, berlaku_sejak
    from public.digital_product_prices
   where public.user_role() in ('admin','owner')
   order by product_id, berlaku_sejak desc;

revoke all on public.produk_harga_staf from public, anon, authenticated;
grant select on public.produk_harga_staf to authenticated;

comment on view public.produk_harga_staf is
  'Harga TERAKHIR per produk untuk panel staf — termasuk yang belum berlaku, '
  'supaya admin melihat harga yang sudah dijadwalkan owner. Predikat '
  'user_role() di dalam view adalah pagar perannya.';
