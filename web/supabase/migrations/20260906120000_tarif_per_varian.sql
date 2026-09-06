-- ============================================================================
-- TARIF PER VARIAN — pemindahan service_rates, PAGARNYA IKUT
-- ============================================================================
-- Yang dipindah bukan sekadar baris. Empat pagar di pengerasan_tabel_uang.sql
-- lahir dari sembilan operasi yang semuanya HTTP 200 sebelum pagar itu ada —
-- termasuk satu PATCH berfilter yang menimpa 13 baris rate card sekaligus.
-- Tabel baru tanpa pagar itu adalah kemunduran ke keadaan yang sudah dibayar.
--
-- `service_rates` SENGAJA masih hidup sesudah berkas ini. Ia baru dijatuhkan
-- setelah kode owner pindah, supaya pohon tidak pernah berada dalam keadaan
-- "tabel sudah hilang tapi kodenya masih membacanya".
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260906110000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

create table public.variant_rates (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references public.service_variants(id),
  harga_klien   int not null,
  harga_coret   int null,
  honor_mitra   int not null,
  berlaku_sejak date not null default current_date,

  -- Tanpa ini `tarifPadaTanggal()` memilih salah satu baris kembar
  -- sewenang-wenang: honor yang dibayarkan bergantung pada urutan baris yang
  -- dikembalikan Postgres hari itu.
  constraint variant_rates_unik_per_tanggal unique (variant_id, berlaku_sejak),

  -- `<=`, bukan `<`: layanan bermargin NOL adalah keputusan bisnis yang sah.
  -- Honor yang MELEBIHI harga berarti PADMA membayar mitra lebih banyak
  -- daripada yang diterimanya, dan rekap menampilkannya sebagai margin negatif
  -- tanpa satu pun peringatan.
  --
  -- `harga_coret >= harga_klien`: harga coret yang lebih murah dari harga jual
  -- bukan promo — ia salah ketik yang tampil ke pengunjung sebagai KENAIKAN.
  constraint variant_rates_nilai_wajar check (
    harga_klien >= 0
    and honor_mitra >= 0
    and honor_mitra <= harga_klien
    and (harga_coret is null or harga_coret >= harga_klien)
  )
);
create index variant_rates_lookup_idx on public.variant_rates(variant_id, berlaku_sejak desc);

-- ===== SALIN RIWAYAT TARIF =====
-- `berlaku_sejak` dipertahankan APA ADANYA: riwayat tarif adalah bukti berapa
-- honor yang seharusnya dibayarkan pekan lalu, dan rekap membacanya menurut
-- tanggal sesi. Membulatkannya ke hari migrasi menggeser rekap yang sudah
-- dibayarkan. `harga_coret` NULL — harga coret adalah angka pemasaran baru,
-- bukan sesuatu yang pernah berlaku di masa lalu.
--
-- Berjalan sebagai `postgres`, jadi guard_tarif_varian_maju melewatkannya —
-- gerbang peran yang sudah ada, bukan pengecualian baru.
--
-- Pada `db reset` bersih, migrasi ini berjalan SEBELUM `seed.sql`: pernyataan
-- di bawah menyalin NOL baris di sini, karena `service_rates` masih kosong.
-- Blok CERMIN di `seed.sql`, tepat sesudah `service_rates` diisi, mengulang
-- pernyataan yang SAMA supaya `variant_rates` tetap terisi pada basis data
-- yang baru di-reset. Task 5 nanti meleburkan kedua blok itu menjadi satu
-- insert langsung, sesudah `service_rates` dijatuhkan.
insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
  select v.id, r.harga_klien, r.honor_mitra, r.berlaku_sejak
    from public.service_rates r
    join public.service_variants v on v.service_id = r.service_id;

-- ===== PAGAR (4) TARIF RETROAKTIF =====
-- BUKAN `security definer`: `current_user` harus tetap peran PEMANGGIL, karena
-- justru itu yang membedakan jalur sah dari jalur terlarang.
create or replace function public.guard_tarif_varian_maju()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  terakhir date;
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  select max(berlaku_sejak) into terakhir
    from public.variant_rates
   where variant_id = new.variant_id
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception
      'tarif baru harus berlaku sesudah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_tarif_varian_maju() is
  'Menolak variant_rates ber-berlaku_sejak <= tarif terakhir varian yang sama, '
  'dari peran API (anon, authenticated, authenticator) — owner sekalipun. '
  'Tarif retroaktif berefek SAMA PERSIS dengan menimpa baris lama. '
  'Service role sengaja dilewatkan: seed & fixture test menyemai tanggal lampau.';

revoke all on function public.guard_tarif_varian_maju() from public, anon, authenticated;

create trigger trg_guard_tarif_varian_maju
  before insert or update on public.variant_rates
  for each row execute function public.guard_tarif_varian_maju();

-- ===== PAGAR (5) BARIS LAMA TIDAK BISA DITULIS ULANG =====
-- Yang di atas menjaga TANGGAL; yang ini menjaga NOMINAL. Filter pada URL
-- adalah PILIHAN PEMANGGIL, bukan pembatas baris: satu PATCH berfilter
-- terbukti menimpa seluruh rate card klinik.
create or replace function public.kunci_riwayat_tarif_varian()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'rate card bersifat append-only: tetapkan tarif baru sebagai BARIS BARU, jangan menimpa yang lama'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.kunci_riwayat_tarif_varian() is
  'Menolak SETIAP UPDATE variant_rates dari peran API — owner sekalipun. '
  'Verba UPDATE sengaja TIDAK dicabut dari authenticated (owner login sebagai '
  'peran itu); yang dimatikan kemampuannya, bukan haknya. Service role tetap '
  'bebas sebagai jalur pemulihan data.';

revoke all on function public.kunci_riwayat_tarif_varian() from public, anon, authenticated;

create trigger trg_kunci_riwayat_tarif_varian
  before update on public.variant_rates
  for each row execute function public.kunci_riwayat_tarif_varian();

-- ===== HAK & RLS =====
alter table public.variant_rates enable row level security;

create policy "variant_rates: hanya owner" on public.variant_rates
  for all to authenticated
  using (user_role() = 'owner') with check (user_role() = 'owner');

revoke all on public.variant_rates from anon;
grant select, insert, update on public.variant_rates to authenticated;
revoke delete on public.variant_rates from authenticated;

comment on table public.variant_rates is
  'RIWAYAT tarif per VARIAN — bukan satu baris harga yang ditimpa. '
  'APPEND-ONLY untuk peran API: INSERT hanya dengan berlaku_sejak yang MAJU, '
  'UPDATE ditolak seluruhnya, DELETE sudah dicabut. Harga klien dipajang '
  'publik lewat view harga_publik; honor_mitra tidak pernah keluar dari sini.';
