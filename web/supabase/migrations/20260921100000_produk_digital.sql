-- ===========================================================================
-- PRODUK DIGITAL — katalog yang DIJUAL, bukan materi yang DITUGASKAN
-- ===========================================================================
-- Tabel ini sengaja BUKAN kolom baru pada `materials`. Akses materi digerbang
-- "punya sesi selesai pada layanan ini"; akses produk digerbang "sudah
-- membeli". Dua sumbu izin dalam satu tabel memaksa setiap policy materi yang
-- sudah ada dipikirkan ulang, dan membuka jalan materi kursus tak sengaja
-- terpajang di etalase publik.
create type public.product_type as enum ('video', 'pdf');

create table public.digital_products (
  id uuid primary key default gen_random_uuid(),
  judul text not null,

  -- Alamat publik `/produk/<slug>`. UNIQUE karena dua produk yang berbagi
  -- slug membuat "produk mana yang dibuka" jadi pertanyaan tanpa jawaban.
  slug text not null unique,
  deskripsi text not null default '',
  jenis public.product_type not null,

  -- Default TERTUTUP, dibuka sadar. Unduhan adalah satu-satunya jalur di
  -- PADMA yang melepas berkas utuh ke tangan pembaca; ia tidak boleh menyala
  -- karena seseorang lupa mematikannya.
  boleh_unduh boolean not null default false,

  sampul_objek text,

  -- Produk baru TIDAK langsung terpajang: judul dan berkasnya diisi bertahap,
  -- dan produk setengah jadi di etalase lebih buruk daripada produk yang
  -- belum ada.
  aktif boolean not null default false,

  urutan int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.digital_products is
  'Katalog produk digital yang dijual. TANPA kolom nominal — harga hidup di '
  'digital_product_prices, di balik money firewall. `aktif` dan `boleh_unduh` '
  'keduanya default false: yang terpajang dan yang bisa diunduh adalah '
  'keputusan sadar, bukan keadaan bawaan.';

create index digital_products_etalase_idx
  on public.digital_products (aktif, urutan, created_at desc);

-- ===== BERKAS =====
create table public.digital_product_files (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.digital_products(id) on delete cascade,

  -- Kunci objek: R2 untuk video, bucket `produk-berkas` untuk PDF utuh.
  -- Ditentukan server, tidak pernah dikirim browser — browser yang memilih
  -- path adalah browser yang bisa menimpa berkas produk lain.
  objek text not null,
  mime text not null,
  byte bigint not null,
  created_at timestamptz not null default now(),
  unique (product_id)
);

-- ===== HALAMAN PDF TERASTERISASI (pola material_pages) =====
create table public.digital_product_pages (
  product_id uuid not null references public.digital_products(id) on delete cascade,
  halaman int not null,
  objek text not null,
  primary key (product_id, halaman)
);

-- ===== RLS =====
alter table public.digital_products enable row level security;
alter table public.digital_product_files enable row level security;
alter table public.digital_product_pages enable row level security;

-- Staf: penuh. `to authenticated` DITULIS SENGAJA, bukan kosmetik: migration
-- `fail_closed_sequence_fungsi` mencabut EXECUTE atas `user_role()` dari
-- `anon`. Policy `for all` tanpa target lahir `to public`, dan `public`
-- MENCAKUP `anon` — setiap SELECT anon atas tabel ini ikut mengevaluasi
-- policy staf (Postgres OR semua policy permisif yang berlaku), memanggil
-- `user_role()`, dan gagal dengan "permission denied for function user_role"
-- alih-alih memulangkan baris kosong. `to authenticated` membuat anon tidak
-- pernah dievaluasi terhadap policy ini sama sekali.
create policy "produk: staf" on public.digital_products for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Publik: hanya yang AKTIF, dan hanya BACA. Berlaku untuk anon maupun
-- authenticated — etalase adalah halaman yang sama untuk keduanya.
create policy "produk: baca publik yang aktif" on public.digital_products for select
  using (aktif);

-- Migration `cabut_grant_anon_berlebih` mencabut SEMUA hak tabel dari `anon`
-- secara default; katalog publik (phases/services/packages/service_variants)
-- masing-masing mendapat `grant select` eksplisit di baliknya. Tabel ini
-- ikut pola yang sama — tanpa baris ini RLS tidak pernah sampai dievaluasi,
-- anon berhenti di "permission denied for table" duluan.
grant select on public.digital_products to anon;

create policy "berkas produk: staf" on public.digital_product_files for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

create policy "halaman produk: staf" on public.digital_product_pages for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Policy BACA untuk pemilik entitlement ditambahkan di migration Task 3,
-- sesudah tabel `digital_entitlements` lahir. Sampai saat itu, berkas dan
-- halaman hanya terbaca staf — fail-closed, bukan fail-open.

-- ===== BUCKET =====
insert into storage.buckets (id, name, public)
values ('produk-halaman', 'produk-halaman', false),
       ('produk-berkas', 'produk-berkas', false),
       ('produk-sampul', 'produk-sampul', true)
on conflict (id) do nothing;

-- `produk-halaman` & `produk-berkas` sengaja TANPA satu pun policy: tidak ada
-- peran API yang boleh menyentuhnya langsung. Seluruh akses lewat route
-- handler yang memakai service role SESUDAH basis data memulangkan barisnya —
-- pola yang sama dengan bucket `bukti-bayar` dan `materi-halaman`.

create policy "sampul produk: baca publik" on storage.objects for select
  using (bucket_id = 'produk-sampul');

create policy "sampul produk: tulis staf" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'produk-sampul' and public.user_role() in ('admin','owner'));
