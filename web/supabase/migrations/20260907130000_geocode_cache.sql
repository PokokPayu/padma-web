-- ============================================================================
-- CACHE GEOCODING — termasuk mencatat KEGAGALAN
-- ============================================================================
-- Nominatim gratis dengan syarat wajar: maksimal 1 permintaan per detik dan
-- User-Agent yang mengidentifikasi aplikasi. PADMA menyimpan alamat beberapa
-- kali sehari, jauh di bawah batas itu — SELAMA alamat yang sama tidak
-- ditanyakan berulang.
--
-- Baris ber-lat/lon NULL adalah KEGAGALAN YANG TERCATAT, dan itu disengaja.
-- Tanpa mencatat kegagalan, alamat yang tidak dikenali OSM akan ditanyakan
-- ulang setiap kali formulirnya dibuka — pelanggaran batas laju yang lahir
-- justru dari niat baik.

create table public.geocode_cache (
  alamat_normal text primary key,
  lat           double precision null,
  lon           double precision null,
  sumber        text not null default 'nominatim',
  dicoba_pada   timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;

create policy "geocode_cache: staf" on public.geocode_cache
  for all to authenticated
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

revoke all on public.geocode_cache from anon;
grant select, insert, update on public.geocode_cache to authenticated;
revoke delete on public.geocode_cache from authenticated;

comment on table public.geocode_cache is
  'Hasil geocoding per alamat kanonik. Baris ber-lat/lon NULL berarti alamat '
  'itu SUDAH pernah dicoba dan gagal — mencatatnya mencegah Nominatim '
  'ditanyakan ulang setiap kali formulirnya dibuka.';
