-- ===========================================================================
-- P2 KERANJANG (1/2) — cart_items, tiga pintu klien, trigger pembersihan
-- ===========================================================================
-- Keranjang mengingat APA yang ingin dibeli, bukan BERAPA harganya: nol kolom
-- harga. Harga dibaca dari `harga_produk_publik` saat ditampilkan dan
-- dibekukan `buat_pesanan_keranjang` saat checkout (migrasi berikutnya).
--
-- Hak mengikuti P1: tabelnya hanya bisa DIBACA pemiliknya; setiap penulisan
-- lewat fungsi `security definer` yang memilih client_id-nya sendiri dari
-- auth.uid(). Grant insert/delete langsung berarti klien bisa menaruh produk
-- yang sudah ia miliki ke keranjangnya lewat satu `curl`.

create table public.cart_items (
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.digital_products(id) on delete cascade,
  ditambahkan_pada timestamptz not null default now(),
  primary key (client_id, product_id)
);

comment on table public.cart_items is
  'Keranjang produk digital per klien. Tanpa harga — harga dibekukan saat '
  'checkout. Ditulis HANYA lewat tambah_ke_keranjang/hapus_dari_keranjang dan '
  'dibersihkan trigger saat akses produknya terbit.';

alter table public.cart_items enable row level security;

revoke all on public.cart_items from anon;
revoke all on public.cart_items from authenticated;
grant select on public.cart_items to authenticated;

-- SATU policy, tanpa policy staf: tidak ada layar staf yang membaca keranjang,
-- dan policy staf membuat `select` tanpa filter di peramban staf-yang-juga-
-- klien menarik keranjang seluruh klien.
create policy "keranjang: klien baca miliknya" on public.cart_items for select
  to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = cart_items.client_id and c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- tambah_ke_keranjang
-- ---------------------------------------------------------------------------
-- Gerbangnya sengaja LEBIH SEMPIT dari buat_pesanan_keranjang: tayang,
-- berharga, bukan gratis, belum dimiliki. Pesanan beruang tidak diperiksa di
-- sini — keranjang bukan uang, dan checkout yang menolaknya.
create or replace function public.tambah_ke_keranjang(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga integer;
  v_isi integer;
begin
  select c.id into v_client_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  select h.harga into v_harga
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;
  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;
  if v_harga = 0 then
    raise exception 'Produk ini gratis — ambil lewat tombolnya.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.digital_entitlements e
     where e.client_id = v_client_id
       and e.product_id = p_product_id
       and e.dicabut_pada is null
  ) then
    raise exception 'Anda sudah memiliki produk ini.' using errcode = 'P0001';
  end if;

  -- Sudah di keranjang: diam, bukan galat. Diperiksa SEBELUM batas, supaya
  -- keranjang penuh tidak menolak produk yang memang sudah ada di dalamnya.
  if exists (
    select 1 from public.cart_items k
     where k.client_id = v_client_id and k.product_id = p_product_id
  ) then
    return;
  end if;

  select count(*) into v_isi from public.cart_items k where k.client_id = v_client_id;
  if v_isi >= 20 then
    raise exception 'Keranjang penuh — paling banyak 20 produk.' using errcode = 'P0001';
  end if;

  insert into public.cart_items (client_id, product_id)
  values (v_client_id, p_product_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.tambah_ke_keranjang(uuid) from public, anon;
grant execute on function public.tambah_ke_keranjang(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- hapus_dari_keranjang
-- ---------------------------------------------------------------------------
create or replace function public.hapus_dari_keranjang(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select c.id into v_client_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  delete from public.cart_items k
   where k.client_id = v_client_id and k.product_id = p_product_id;
end;
$$;

revoke all on function public.hapus_dari_keranjang(uuid) from public, anon;
grant execute on function public.hapus_dari_keranjang(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- baca_keranjang
-- ---------------------------------------------------------------------------
-- Satu panggilan untuk seluruh layar keranjang. `security definer` karena
-- `diproses` butuh `order_items`, yang nol grant bagi authenticated.
--
-- `diproses` MEMANGGIL punya_pesanan_menunggu(), TIDAK menyalin himpunan
-- statusnya. Fungsi itu sudah wajib cermin gerbang beruang buat_pesanan;
-- salinan ketiga adalah satu tempat lagi yang bisa berbeda diam-diam
-- (pelajaran Temuan 1 P1-A).
create or replace function public.baca_keranjang()
returns table (
  product_id uuid,
  judul text,
  slug text,
  harga integer,
  keadaan text,
  ditambahkan_pada timestamptz
)
language sql stable security definer set search_path = public
as $$
  select k.product_id,
         p.judul,
         p.slug,
         h.harga,
         case
           when not p.aktif or h.harga is null then 'tidak_tersedia'
           when h.harga = 0 then 'gratis'
           when exists (
             select 1 from public.digital_entitlements e
              where e.client_id = k.client_id
                and e.product_id = k.product_id
                and e.dicabut_pada is null
           ) then 'sudah_dimiliki'
           when public.punya_pesanan_menunggu(k.product_id) then 'diproses'
           else 'siap'
         end,
         k.ditambahkan_pada
    from public.cart_items k
    join public.clients c on c.id = k.client_id
    join public.digital_products p on p.id = k.product_id
    left join public.harga_produk_publik h on h.product_id = k.product_id
   where c.user_id = auth.uid()
   order by k.ditambahkan_pada, k.product_id;
$$;

revoke all on function public.baca_keranjang() from public, anon;
grant execute on function public.baca_keranjang() to authenticated;

-- ---------------------------------------------------------------------------
-- Pembersihan otomatis saat akses terbit
-- ---------------------------------------------------------------------------
-- SATU tempat menutup semua jalur akses — beli (webhook → terbitkan_akses_item),
-- ambil gratis, pemberian staf — tanpa menyentuh satu baris pun mesin P1.
create or replace function public.bersihkan_keranjang_saat_akses()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.dicabut_pada is null then
    delete from public.cart_items k
     where k.client_id = new.client_id and k.product_id = new.product_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bersihkan_keranjang_saat_akses() from public, anon, authenticated;

create trigger keranjang_bersih_saat_akses
  after insert or update of dicabut_pada on public.digital_entitlements
  for each row execute function public.bersihkan_keranjang_saat_akses();
