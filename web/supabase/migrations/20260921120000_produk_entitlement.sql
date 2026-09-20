-- ===========================================================================
-- ENTITLEMENT — satu-satunya sumber kebenaran "boleh akses"
-- ===========================================================================
-- Setiap gerbang isi (tonton, baca, unduh) membaca TABEL INI, dan tidak
-- pernah membaca pesanan. Pesanan menjawab "apa yang terjadi"; entitlement
-- menjawab "apa yang boleh dibuka" — dan gerbang hanya butuh yang kedua.
-- Tahap 2 (Midtrans) akan MENULIS ke tabel ini; tidak satu pun gerbang perlu
-- berubah saat itu.
create type public.entitlement_source as enum ('beli', 'gratis', 'pemberian_admin');

create table public.digital_entitlements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.digital_products(id) on delete cascade,
  sumber public.entitlement_source not null,
  diberikan_pada timestamptz not null default now(),

  -- PENCABUTAN, bukan penghapusan: barisnya tetap berdiri sebagai jejak bahwa
  -- akses ini pernah ada dan siapa yang pernah memegangnya.
  dicabut_pada timestamptz,

  -- Inilah yang kelak membuat webhook Midtrans idempoten tanpa kode tambahan:
  -- notifikasi kembar tidak bisa menggandakan apa pun.
  unique (client_id, product_id)
);

comment on table public.digital_entitlements is
  'Kepemilikan produk digital. SATU-SATUNYA sumber kebenaran akses — setiap '
  'gerbang isi membaca tabel ini, tidak pernah membaca pesanan. Pencabutan '
  'ditulis sebagai dicabut_pada, bukan penghapusan baris.';

create index digital_entitlements_klien_idx
  on public.digital_entitlements (client_id, diberikan_pada desc);

alter table public.digital_entitlements enable row level security;

-- `to authenticated` DITULIS SENGAJA — pola yang sama seperti
-- `20260921100000_produk_digital.sql`: policy `for all` tanpa target lahir
-- `to public`, dan `public` MENCAKUP `anon`. Tanpa target eksplisit, setiap
-- SELECT anon atas tabel ini ikut mengevaluasi policy staf, memanggil
-- `user_role()` yang EXECUTE-nya sudah dicabut dari anon
-- (`fail_closed_sequence_fungsi`), dan gagal 42501 alih-alih memulangkan
-- baris kosong.
create policy "entitlement: staf" on public.digital_entitlements for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Klien hanya MEMBACA miliknya. Tidak ada policy tulis untuk klien: akses
-- bukan sesuatu yang diterbitkan sendiri oleh penerimanya. Jalur gratis
-- menulis lewat RPC security definer di bawah, yang memilih client_id-nya
-- SENDIRI dari auth.uid() alih-alih memercayai payload.
create policy "entitlement: klien baca miliknya" on public.digital_entitlements for select
  to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = digital_entitlements.client_id and c.user_id = auth.uid()
  ));

-- Migration `cabut_grant_anon_berlebih` mencabut SEMUA hak tabel dari `anon`
-- secara default. Tabel ini TIDAK mendapat `grant select ... to anon` —
-- berbeda dari `digital_products`, entitlement bukan katalog publik dan anon
-- memang tidak pernah punya alasan menyentuhnya.

-- ===== PREDIKAT BERSAMA =====
-- Satu definisi "boleh akses", dipakai policy isi di bawah. Ditulis sebagai
-- fungsi supaya kalimatnya hidup di SATU tempat: tiga policy yang menyalin
-- predikat yang sama adalah tiga tempat yang bisa berbeda saat salah satunya
-- disunting.
create or replace function public.punya_produk(p_product_id uuid)
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

comment on function public.punya_produk(uuid) is
  'Satu definisi "boleh akses produk ini": ada entitlement milik pemanggil '
  'yang belum dicabut. Dipakai policy isi produk.';

-- Diverifikasi empiris (bukan diasumsikan) di database lokal: baris
-- `pg_default_acl` untuk peran `postgres` di schema `public` SUDAH
-- memberi `authenticated` EXECUTE bawaan atas fungsi baru — migration
-- `fail_closed_sequence_fungsi` hanya mencabut dari `public` dan `anon`,
-- baris itu tidak disentuh untuk `authenticated`. Jadi tanpa dua baris di
-- bawah pun `punya_produk` SUDAH bisa dipanggil `authenticated` hari ini.
--
-- Baris `revoke`/`grant` berikut tetap DITULIS, bukan basa-basi berlebih:
-- ia membuat niatnya TERBACA alih-alih bergantung diam-diam pada default
-- ACL yang bisa berubah oleh migration lain di masa depan (mis. seseorang
-- mencabut ulang lewat `alter default privileges for role postgres in
-- schema public ...`). Mengikuti aturan [F] pada migration itu: setiap
-- fungsi baru menyatakan haknya sendiri, tidak menumpang pada warisan.
revoke execute on function public.punya_produk(uuid) from public, anon;
grant execute on function public.punya_produk(uuid) to authenticated;

-- ===== POLICY ISI, kini bisa ditulis =====
create policy "berkas produk: pemilik baca" on public.digital_product_files for select
  to authenticated
  using (public.punya_produk(product_id));

create policy "halaman produk: pemilik baca" on public.digital_product_pages for select
  to authenticated
  using (public.punya_produk(product_id));
