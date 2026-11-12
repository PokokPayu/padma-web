-- ===========================================================================
-- PRODUK BERBAB — Produk → Bab → Materi (spec 2026-10-16)
-- ===========================================================================
-- Satu produk kini berisi banyak materi (video/PDF campur) yang dikelompokkan
-- per bab. Isi lama (satu berkas per produk) DIBUANG tanpa migrasi data:
-- tabel produk belum pernah sampai ke produksi, dan pemilik repo menyetujui
-- penghapusan data uji lokal (spec, tabel Keputusan).
--
-- Tabel isi DIBUAT ULANG, bukan di-ALTER: kunci, policy, dan RPC-nya berubah
-- seluruhnya, dan tabel kosong yang dibuat ulang lebih mudah dibaca daripada
-- deretan drop constraint/drop column yang urutannya rapuh.

drop function if exists public.ganti_halaman_produk(uuid, jsonb);
drop function if exists public.lepas_berkas_produk(uuid);
drop table if exists public.digital_product_pages;
drop table if exists public.digital_product_files;

alter table public.digital_products
  drop column jenis,
  drop column boleh_unduh;
drop type public.product_type;

-- ===== MASA BERLAKU =====
-- NULL = selamanya. Satuan tunggal BULAN: "N tahun" di form disimpan N*12,
-- supaya tidak ada kolom satuan yang bisa berselisih dengan angkanya.
alter table public.digital_products
  add column masa_berlaku_bulan int
    check (masa_berlaku_bulan is null or masa_berlaku_bulan between 1 and 120);

comment on column public.digital_products.masa_berlaku_bulan is
  'Masa akses sesudah dibeli, dalam bulan. NULL = selamanya. Hanya OWNER yang '
  'boleh mengubahnya (trigger jaga_masa_berlaku_produk). Dibekukan di '
  'order_items.masa_berlaku_bulan_beku saat checkout.';

-- Policy "produk: staf" memberi admin DAN owner hak tulis seluruh baris; syarat
-- jual (harga, masa berlaku) hanya milik owner. Pagar kolom lewat trigger,
-- bukan dengan memecah GRANT per kolom: memecah GRANT UPDATE berarti setiap
-- kolom baru kelak harus diingat untuk di-grant, dan lupa melakukannya gagal
-- diam di panel admin.
create or replace function public.jaga_masa_berlaku_produk()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Service role (auth.uid() NULL) dikecualikan: pola yang sama dengan
  -- ganti_halaman_produk lama — service role tidak punya baris profil dan
  -- akan jatuh ke 'klien'.
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.masa_berlaku_bulan is not null)
     or (tg_op = 'UPDATE' and new.masa_berlaku_bulan is distinct from old.masa_berlaku_bulan) then
    if public.user_role() <> 'owner' then
      raise exception 'Masa berlaku hanya bisa diatur owner.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.jaga_masa_berlaku_produk() from public, anon, authenticated;

create trigger produk_masa_berlaku_owner
  before insert or update of masa_berlaku_bulan on public.digital_products
  for each row execute function public.jaga_masa_berlaku_produk();

-- ===== BAB =====
create table public.digital_product_sections (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.digital_products(id) on delete cascade,
  judul text not null check (char_length(btrim(judul)) between 1 and 120),
  urutan int not null default 0,
  created_at timestamptz not null default now(),
  -- Sasaran FK komposit materi di bawah.
  unique (id, product_id)
);

create index digital_product_sections_produk_idx
  on public.digital_product_sections (product_id, urutan, created_at);

-- ===== MATERI =====
create type public.material_kind as enum ('video', 'pdf');

create table public.digital_product_materials (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null,
  -- Disimpan GANDA (bisa diturunkan dari bab) supaya predikat akses menjawab
  -- "materi ini milik produk apa" tanpa join. Konsistensinya dijaga FK
  -- komposit di bawah, bukan oleh aplikasi.
  product_id uuid not null references public.digital_products(id) on delete cascade,
  judul text not null check (char_length(btrim(judul)) between 2 and 120),
  keterangan text not null default '' check (char_length(keterangan) <= 500),
  jenis public.material_kind not null,
  sampul_objek text,
  -- Default TERTUTUP untuk keduanya: pratinjau membuka isi bagi non-pembeli,
  -- unduhan melepas berkas utuh. Keduanya dibuka sadar, tidak pernah karena
  -- lupa dimatikan.
  pratinjau boolean not null default false,
  boleh_unduh boolean not null default false,
  urutan int not null default 0,
  created_at timestamptz not null default now(),
  -- NO ACTION (bawaan), BUKAN restrict: dicek di akhir pernyataan. Menghapus
  -- produk men-cascade bab DAN materi dalam satu pernyataan; restrict akan
  -- menolak bab sebelum cascade materinya sempat berjalan. Menghapus bab
  -- yang masih berisi tetap ditolak.
  constraint materi_bab_sejalan foreign key (section_id, product_id)
    references public.digital_product_sections (id, product_id)
);

create index digital_product_materials_bab_idx
  on public.digital_product_materials (section_id, urutan, created_at);
create index digital_product_materials_produk_idx
  on public.digital_product_materials (product_id);

-- ===== ISI PER MATERI =====
create table public.digital_product_files (
  id uuid primary key default gen_random_uuid(),
  -- Kunci objek: R2 untuk video, bucket `produk-berkas` untuk PDF utuh.
  -- Ditentukan server, tidak pernah dikirim browser.
  material_id uuid not null unique
    references public.digital_product_materials(id) on delete cascade,
  objek text not null,
  mime text not null,
  byte bigint not null,
  created_at timestamptz not null default now()
);

create table public.digital_product_pages (
  material_id uuid not null references public.digital_product_materials(id) on delete cascade,
  halaman int not null,
  objek text not null,
  primary key (material_id, halaman)
);

-- ===== RLS =====
alter table public.digital_product_sections enable row level security;
alter table public.digital_product_materials enable row level security;
alter table public.digital_product_files enable row level security;
alter table public.digital_product_pages enable row level security;

-- Staf: penuh. `to authenticated` SENGAJA — lihat 20260921100000_produk_digital.sql.
create policy "bab produk: staf" on public.digital_product_sections for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));
create policy "materi produk: staf" on public.digital_product_materials for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));
create policy "berkas materi: staf" on public.digital_product_files for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));
create policy "halaman materi: staf" on public.digital_product_pages for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Publik: daftar isi produk TAYANG (judul, keterangan, jenis, sampul,
-- pratinjau) adalah bagian etalase, seperti di referensi klien. ISInya tidak:
-- files/pages tidak punya policy publik dan tidak di-grant ke anon.
-- Subkueri ke digital_products ikut tunduk RLS-nya sendiri — anon hanya
-- melihat produk aktif, jadi syarat `p.aktif` di sini tertulis demi yang
-- membaca, bukan karena RLS membutuhkannya.
create policy "bab produk: baca publik produk tayang" on public.digital_product_sections for select
  using (exists (select 1 from public.digital_products p where p.id = product_id and p.aktif));
create policy "materi produk: baca publik produk tayang" on public.digital_product_materials for select
  using (exists (select 1 from public.digital_products p where p.id = product_id and p.aktif));

grant select on public.digital_product_sections to anon;
grant select on public.digital_product_materials to anon;

-- Policy BACA isi untuk pembeli & pratinjau lahir di migrasi berikutnya
-- (`produk_akses_masa_berlaku`), bersama predikatnya. Sampai saat itu isi
-- hanya terbaca staf — fail-closed.

-- Hak tulis: pola 20260921130000_produk_hapus_isi.sql, kini per materi.
-- Halaman selalu diganti sebagai SATU SET → seluruh hak tabel dicabut, SELECT
-- dikembalikan. Berkas disunting lewat upsert → hanya DELETE yang (memang
-- sudah) tidak ada.
revoke all on public.digital_product_pages from authenticated;
grant select on public.digital_product_pages to authenticated;
revoke delete on public.digital_product_files from authenticated;

comment on table public.digital_product_pages is
  'Halaman PDF materi terasterisasi. SELURUH hak tabel dicabut dari '
  'authenticated; satu-satunya jalur tulis: ganti_halaman_materi_produk(p_material_id, '
  'p_halaman). Filter PostgREST adalah pilihan pemanggil, bukan pembatas baris.';
comment on table public.digital_product_files is
  'Berkas isi materi (video ATAU PDF utuh), satu baris per materi. Upsert '
  'terbuka untuk staf; DELETE hanya lewat lepas_berkas_materi / '
  'hapus_materi_produk.';

-- ===== RPC TULIS (radius terkunci parameter) =====
-- Guard `auth.uid() is not null and user_role() not in (...)`: service role
-- tidak punya baris profil dan akan jatuh ke 'klien' tanpa syarat pertama.
create or replace function public.ganti_halaman_materi_produk(
  p_material_id uuid,
  p_halaman     jsonb
) returns table(objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh mengganti halaman materi';
  end if;

  return query
    delete from public.digital_product_pages
     where material_id = p_material_id
    returning digital_product_pages.objek;

  insert into public.digital_product_pages (material_id, halaman, objek)
  select p_material_id, (x->>'halaman')::int, x->>'objek'
    from jsonb_array_elements(p_halaman) as x;
end $$;

create or replace function public.lepas_berkas_materi(p_material_id uuid)
returns table(objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh melepas berkas materi';
  end if;

  return query
    delete from public.digital_product_files
     where material_id = p_material_id
    returning digital_product_files.objek;
end $$;

create or replace function public.hapus_bab_produk(p_section_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_section_id is null then
    raise exception 'p_section_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh menghapus bab';
  end if;
  -- Diperiksa DI SINI dengan kalimat manusia, alih-alih menunggu FK menolak
  -- dengan 23503 telanjang.
  if exists (select 1 from public.digital_product_materials m where m.section_id = p_section_id) then
    raise exception 'Bab masih berisi materi — hapus materinya dulu.' using errcode = 'P0001';
  end if;
  delete from public.digital_product_sections where id = p_section_id;
end $$;

-- Memulangkan SETIAP objek storage milik materi SEBELUM barisnya terhapus —
-- satu pernyataan atomik per sumber, bukan SELECT terpisah yang balapan.
-- `asal` memberi tahu pemanggil bucket mana: 'video' → R2, 'pdf' →
-- produk-berkas, 'halaman' → produk-halaman, 'sampul' → produk-sampul.
create or replace function public.hapus_materi_produk(p_material_id uuid)
returns table(asal text, objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh menghapus materi';
  end if;

  return query
    select m.jenis::text, f.objek
      from public.digital_product_files f
      join public.digital_product_materials m on m.id = f.material_id
     where f.material_id = p_material_id;
  return query
    select 'halaman'::text, h.objek
      from public.digital_product_pages h
     where h.material_id = p_material_id;
  return query
    select 'sampul'::text, m.sampul_objek
      from public.digital_product_materials m
     where m.id = p_material_id and m.sampul_objek is not null;

  -- Cascade membawa files & pages.
  delete from public.digital_product_materials where id = p_material_id;
end $$;

revoke all on function public.ganti_halaman_materi_produk(uuid, jsonb) from public, anon;
revoke all on function public.lepas_berkas_materi(uuid) from public, anon;
revoke all on function public.hapus_bab_produk(uuid) from public, anon;
revoke all on function public.hapus_materi_produk(uuid) from public, anon;
grant execute on function public.ganti_halaman_materi_produk(uuid, jsonb) to authenticated;
grant execute on function public.lepas_berkas_materi(uuid) to authenticated;
grant execute on function public.hapus_bab_produk(uuid) to authenticated;
grant execute on function public.hapus_materi_produk(uuid) to authenticated;

-- Sampul (produk & materi) di bucket publik `produk-sampul`. Nama objek unik
-- per unggahan, sehingga mengganti sampul = objek baru + hapus yang lama
-- lewat service role. Policy UPDATE/DELETE staf sengaja TIDAK ditambahkan.
