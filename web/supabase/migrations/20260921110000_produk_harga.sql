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

-- Berbeda dari `variant_rates`: di sana `select, insert` sengaja DIBERIKAN ke
-- `authenticated` karena admin & klien memang perlu lolos ke lapis RLS supaya
-- 0-baris-nya teramati (lihat tests/owner-pengerasan.test.ts). Di sini BELUM
-- ada alur produk yang membaca/menulis tabel ini lewat sesi `authenticated`
-- milik owner sendiri — service role yang menulis (lihat seluruh test), dan
-- staf membaca lewat `produk_harga_staf`. Maka SELURUH hak tabel dicabut dari
-- `authenticated`, bukan cuma update/delete.
--
-- "0 baris karena RLS menyaring" dan "ditolak karena tidak punya hak tabel"
-- adalah DUA KEGAGALAN YANG BERBEDA, dan uji
-- tests/produk-harga-publik.test.ts ("klien login juga tidak bisa menyentuh
-- tabel harga langsung") sengaja menagih yang KEDUA: klien mencoba SELECT
-- harus berhenti di 42501 tingkat GRANT, bukan lolos lewat grant lalu pulang
-- 0 baris dari RLS yang — dari sisi klien — terlihat sama persis dengan
-- "memang tidak ada data untuk produk ini". Kedua policy owner di atas
-- sengaja tetap ada sebagai pagar LAPIS KEDUA yang sudah siap kalau kelak ada
-- tugas yang memberi `authenticated` hak SELECT/INSERT langsung untuk UI
-- owner menetapkan harga — saat itu tiba, firewall RLS-nya sudah berdiri,
-- tinggal hak tabelnya yang dibuka.
revoke all on public.digital_product_prices from anon, authenticated;

-- ===== VIEW PUBLIK =====
-- `security_invoker = off` disengaja: view INILAH batas kolomnya, dan anon
-- memang tidak punya hak baca atas tabel dasarnya.
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
