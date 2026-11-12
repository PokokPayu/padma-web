-- ===========================================================================
-- PERSETUJUAN S&K + KEBIJAKAN PRIVASI
-- ===========================================================================
-- Spec: docs/superpowers/specs/2026-10-06-padma-syarat-ketentuan-privasi-design.md
--
-- Dua tempat, satu nomor versi (`VERSI_DOKUMEN`, src/lib/persetujuan/versi.ts):
--   1. persetujuan_akun — log append-only per akun, per versi.
--   2. screenings.persetujuan_* — persetujuan eksplisit atas DATA KESEHATAN
--      yang diisi di skrining; skrining bisa diisi tanpa akun sama sekali.
--
-- Cap waktu 120000, BUKAN 100000: `feat/p4-rekap-penjualan` sudah memakai
-- 20261006100000_pesanan_item_produk_id.sql.

create table public.persetujuan_akun (
  -- Tanpa FK ke auth.users, seperti tabel jejak_*: ini BUKTI persetujuan dan
  -- harus tetap ada apa pun yang terjadi pada akunnya.
  user_id        uuid        not null,
  versi          text        not null check (versi ~ '^\d{4}-\d{2}-\d{2}$'),
  jalur          text        not null check (jalur in ('daftar', 'gerbang')),
  disetujui_pada timestamptz not null default now(),
  primary key (user_id, versi)
);

comment on table public.persetujuan_akun is
  'Persetujuan S&K + Kebijakan Privasi per akun per versi. Append-only: klien '
  'hanya menyisipkan & membaca miliknya sendiri, dan tidak bisa mengisi '
  'disetujui_pada. jalur: daftar = centang di /daftar (dicatat /setelah-masuk); '
  'gerbang = layar /persetujuan.';

alter table public.persetujuan_akun enable row level security;

revoke all on public.persetujuan_akun from anon;
revoke all on public.persetujuan_akun from authenticated;
grant select on public.persetujuan_akun to authenticated;
-- Hak insert TINGKAT KOLOM: `disetujui_pada` selalu dari default now(), jadi
-- klien tidak bisa menanggali mundur persetujuannya sendiri.
grant insert (user_id, versi, jalur) on public.persetujuan_akun to authenticated;

-- Tanpa policy staf: tidak ada layar staf yang membacanya (spec: di luar
-- cakupan), dan owner membaca lewat service role bila perlu.
create policy "persetujuan: klien baca miliknya" on public.persetujuan_akun
  for select to authenticated
  using (user_id = auth.uid());

create policy "persetujuan: klien catat miliknya" on public.persetujuan_akun
  for insert to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- screenings: dua kolom, nullable, TANPA trigger (spec revisi 1).
-- Baris lama tetap null — jujur: datanya terkumpul sebelum kebijakan ada.
-- Baris baru dicap oleh capPersetujuanSkrining() di kedua rute skrining.
-- ---------------------------------------------------------------------------
alter table public.screenings
  add column persetujuan_versi text check (persetujuan_versi ~ '^\d{4}-\d{2}-\d{2}$'),
  add column persetujuan_pada  timestamptz;

comment on column public.screenings.persetujuan_versi is
  'VERSI_DOKUMEN Kebijakan Privasi yang disetujui saat skrining dikirim. Null = '
  'skrining sebelum 2026-10-06.';
comment on column public.screenings.persetujuan_pada is
  'Waktu server saat persetujuan skrining dicap.';
