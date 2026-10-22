-- ===========================================================================
-- AKSES BERMASA BERLAKU (spec 2026-10-16)
-- ===========================================================================
-- Spec 20 September menetapkan "akses selamanya"; keputusan itu DIBALIK.
-- "Punya produk" kini berarti: ada entitlement milik pemanggil, belum
-- dicabut, DAN belum kedaluwarsa.

alter table public.digital_entitlements
  add column berlaku_sampai timestamptz;

comment on column public.digital_entitlements.berlaku_sampai is
  'Batas akses. NULL = selamanya. DIBEKUKAN saat akses terbit (durasi beku '
  'pesanan, atau durasi produk untuk ambil gratis) — mengubah durasi produk '
  'tidak menyentuh pembeli lama. Kedaluwarsa BUKAN pencabutan: beli ulang '
  'memperbarui kolom ini, sedangkan dicabut_pada tidak pernah hidup lagi '
  'karena pembelian.';

-- ===== PREDIKAT =====
-- SATU kalimat "akses aktif", dipakai setiap fungsi yang menolak pembelian
-- ganda (Task 3) dan oleh punya_produk di bawah. Internal: dipanggil dengan
-- client_id sembarang, jadi tidak boleh terbuka bagi pemegang sesi.
create or replace function public.akses_aktif(p_client_id uuid, p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.digital_entitlements e
     where e.client_id = p_client_id
       and e.product_id = p_product_id
       and e.dicabut_pada is null
       and (e.berlaku_sampai is null or e.berlaku_sampai > now())
  );
$$;

revoke all on function public.akses_aktif(uuid, uuid) from public, anon, authenticated;

create or replace function public.punya_produk(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.akses_aktif(
      (select c.id from public.clients c where c.user_id = auth.uid()),
      p_product_id),
    false);
$$;

comment on function public.punya_produk(uuid) is
  'Satu definisi "boleh akses isi produk ini": entitlement milik pemanggil, '
  'belum dicabut, belum kedaluwarsa. Dipakai gerbang isi (lewat '
  'boleh_buka_materi), rute unduh, dan peramban.';

-- Metadata (judul, slug, daftar materi) tetap terbaca oleh pemilik yang
-- aksesnya kedaluwarsa. Tanpa ini, produk NONAKTIF yang aksesnya habis
-- memulangkan `null` di embed `produkSaya` dan hilang diam-diam dari
-- "Pembelian Saya" — padahal seharusnya tampil "Masa berlaku habis".
create or replace function public.pernah_punya_produk(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.digital_entitlements e
      join public.clients c on c.id = e.client_id
     where e.product_id = p_product_id
       and c.user_id = auth.uid()
       and e.dicabut_pada is null
  );
$$;

-- Pratinjau hanya untuk produk TAYANG: produk yang dinonaktifkan berhenti
-- dijual, dan pratinjaunya adalah bagian dari penjualan itu. Pemilik tetap
-- membuka semuanya lewat punya_produk.
create or replace function public.boleh_buka_materi(p_material_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.digital_product_materials m
      join public.digital_products p on p.id = m.product_id
     where m.id = p_material_id
       and (public.punya_produk(m.product_id) or (m.pratinjau and p.aktif))
  );
$$;

revoke all on function public.pernah_punya_produk(uuid) from public, anon;
revoke all on function public.boleh_buka_materi(uuid) from public, anon;
grant execute on function public.pernah_punya_produk(uuid) to authenticated;
grant execute on function public.boleh_buka_materi(uuid) to authenticated;
-- punya_produk: haknya ditetapkan di 20260921120000 dan tidak berubah oleh
-- CREATE OR REPLACE; ditulis ulang di sini supaya niatnya terbaca.
revoke all on function public.punya_produk(uuid) from public, anon;
grant execute on function public.punya_produk(uuid) to authenticated;

-- ===== POLICY =====
drop policy if exists "produk: pemilik entitlement baca" on public.digital_products;
create policy "produk: pemilik entitlement baca" on public.digital_products for select
  to authenticated
  using (public.pernah_punya_produk(id));

create policy "bab produk: pemilik baca" on public.digital_product_sections for select
  to authenticated
  using (public.pernah_punya_produk(product_id));
create policy "materi produk: pemilik baca" on public.digital_product_materials for select
  to authenticated
  using (public.pernah_punya_produk(product_id));

create policy "berkas materi: boleh buka" on public.digital_product_files for select
  to authenticated
  using (public.boleh_buka_materi(material_id));
create policy "halaman materi: boleh buka" on public.digital_product_pages for select
  to authenticated
  using (public.boleh_buka_materi(material_id));
