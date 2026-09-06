-- ============================================================================
-- VARIAN LAYANAN — satu layanan, banyak harga
-- ============================================================================
-- Pricelist PADMA tidak muat di skema lama: Garbha Relief punya tiga harga
-- (60/90/120 menit), Garbha Partner Lab punya dua (Private/Circle), dan
-- `services` tidak punya satu pun kolom untuk membedakannya. Lapisan ini yang
-- menampungnya.
--
-- `label` sengaja teks bebas: pola di pricelist TIDAK seragam. Ia menampung
-- "Basic", "Couple", maupun "2 modul" tanpa memaksa dimensi yang tidak ada.
-- Tampilan dirangkai dari label + durasi + format, bukan disimpan jadi.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260905120000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

create type varian_format as enum ('private','circle');

create table public.service_variants (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid not null references public.services(id),
  label        text not null default '',
  durasi_menit int null check (durasi_menit is null or durasi_menit > 0),
  format       varian_format null,
  urutan       int not null default 0,
  aktif        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Penopang foreign key gabungan di Task 2. Urutan kolomnya sengaja SAMA
  -- dengan klausa REFERENCES di sana, supaya pasangannya terbaca sekali lihat.
  constraint service_variants_pasangan_layanan unique (service_id, id)
);
create index service_variants_service_idx on public.service_variants(service_id, urutan);

-- V3: setiap layanan wajib punya minimal satu varian. Layanan yang sudah ada
-- memperoleh varian BAKU — label kosong, durasi & format NULL — sehingga
-- Task 2 punya sasaran backfill dan Task 3 punya sasaran pemindahan tarif.
--
-- Pada `db reset` lokal, pernyataan ini berjalan SEBELUM `supabase/seed.sql`
-- mengisi `services`, sehingga di sini ia menyalin NOL baris untuk katalog
-- dummy — bukan cacat, hanya bukan sasarannya. `seed.sql` membawa pernyataan
-- CERMIN yang sama sesudah baris layanannya ada; lihat komentar di sana.
insert into public.service_variants (service_id, label)
  select id, '' from public.services;

-- Stempel waktu. `sentuh_updated_at()` sudah ada sejak pengerasan_admin.
create trigger trg_service_variants_updated_at
  before update on public.service_variants
  for each row execute function public.sentuh_updated_at();

-- ===== PENGERASAN =====
alter table public.service_variants enable row level security;

-- Hak bawaan Supabase atas tabel baru di skema public diberikan PENUH kepada
-- anon & authenticated (lihat cabut_grant_anon_berlebih). Dicabut lebih dulu,
-- baru diberikan yang tepat: hak yang tidak pernah dicabut adalah pintu yang
-- tidak pernah diketahui ada.
revoke all on public.service_variants from anon, authenticated;

-- Katalog: baca publik hanya untuk varian AKTIF, menyusul policy `services`.
-- Sengaja `to anon` (bukan `to public`) — policy yang menyasar `public` ikut
-- dievaluasi peran authenticated dan menabrak invarian hak-default-sequence.
create policy "service_variants: baca publik" on public.service_variants
  for select to anon using (aktif = true);

create policy "service_variants: baca terautentikasi" on public.service_variants
  for select to authenticated using (true);

create policy "service_variants: staf kelola" on public.service_variants
  for all to authenticated
  using (user_role() in ('admin','owner'))
  with check (user_role() in ('admin','owner'));

grant select on public.service_variants to anon;
grant select, insert, update on public.service_variants to authenticated;
revoke delete on public.service_variants from authenticated;

comment on table public.service_variants is
  'Varian satu layanan: durasi, format (Private/Circle), atau program bernama '
  '(Basic/Couple/2 modul). Harga menempel di sini, bukan di services. '
  'Setiap layanan wajib punya minimal satu varian — layanan tanpa varian '
  'membuat setiap perhitungan harga bercabang dua selamanya. '
  'DELETE dicabut: varian yang pernah dipakai sesi adalah riwayat.';
