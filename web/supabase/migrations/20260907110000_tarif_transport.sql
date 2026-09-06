-- ============================================================================
-- TARIF TRANSPORT — rate card kedua, pagar yang sama dengan yang pertama
-- ============================================================================
-- Pagar di bawah bukan karangan baru: ia salinan pagar `variant_rates`
-- (20260906120000), yang sendiri lahir dari temuan red team dengan bukti
-- tertulis di 20260830150000_pengerasan_tabel_uang.sql. Menuliskannya berbeda
-- berarti dua doktrin uang di satu proyek, dan yang kedua pasti yang lebih
-- lemah.

create table public.transport_rates (
  id            uuid primary key default gen_random_uuid(),
  jenjang       jenjang_transport not null,
  tarif_klien   int not null,
  honor_mitra   int not null,
  berlaku_sejak date not null default current_date,

  constraint transport_rates_unik_per_tanggal unique (jenjang, berlaku_sejak),

  -- SENGAJA TIDAK menuntut `honor_mitra <= tarif_klien`, berbeda dari
  -- variant_rates. Justru sebaliknya yang normal di sini: pada 0–5 km klien
  -- membayar Rp0 sementara mitra menerima Rp10.000. Selisih itu SUBSIDI PADMA,
  -- dan ia tidak disimpan sebagai kolom ketiga — ia dihitung saat dibaca,
  -- supaya tidak ada angka yang bisa berselisih diam-diam dengan dua lainnya.
  constraint transport_rates_nilai_wajar check (tarif_klien >= 0 and honor_mitra >= 0)
);
create index transport_rates_lookup_idx on public.transport_rates(jenjang, berlaku_sejak desc);

-- BUKAN `security definer`: `current_user` harus tetap peran PEMANGGIL, karena
-- justru itu yang membedakan jalur sah dari jalur terlarang.
create or replace function public.guard_tarif_transport_maju()
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
    from public.transport_rates
   where jenjang = new.jenjang
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception
      'tarif transport baru harus berlaku sesudah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_tarif_transport_maju() is
  'Menolak transport_rates ber-berlaku_sejak <= tarif terakhir jenjang yang sama, '
  'dari peran API — owner sekalipun. Tarif retroaktif menggeser rekap pekan yang '
  'honornya SUDAH dibayarkan. Service role dilewatkan: seed & fixture test '
  'menyemai tanggal lampau.';

revoke all on function public.guard_tarif_transport_maju() from public, anon, authenticated;

create trigger trg_guard_tarif_transport_maju
  before insert or update on public.transport_rates
  for each row execute function public.guard_tarif_transport_maju();

create or replace function public.kunci_riwayat_tarif_transport()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'rate card transport bersifat append-only: tetapkan tarif baru sebagai BARIS BARU, jangan menimpa yang lama'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.kunci_riwayat_tarif_transport() is
  'Menolak SETIAP UPDATE transport_rates dari peran API. Verba UPDATE sengaja '
  'TIDAK dicabut dari authenticated (owner login sebagai peran itu); yang '
  'dimatikan kemampuannya, bukan haknya.';

revoke all on function public.kunci_riwayat_tarif_transport() from public, anon, authenticated;

create trigger trg_kunci_riwayat_tarif_transport
  before update on public.transport_rates
  for each row execute function public.kunci_riwayat_tarif_transport();

alter table public.transport_rates enable row level security;

create policy "transport_rates: hanya owner" on public.transport_rates
  for all to authenticated
  using (user_role() = 'owner') with check (user_role() = 'owner');

revoke all on public.transport_rates from anon;
grant select, insert, update on public.transport_rates to authenticated;
revoke delete on public.transport_rates from authenticated;

comment on table public.transport_rates is
  'RIWAYAT tarif transport per JENJANG. APPEND-ONLY untuk peran API. '
  'Jenjang di_atas_20 sengaja TIDAK pernah punya baris di sini: tarifnya '
  'ditetapkan owner per kasus di transport_khusus, karena "konfirmasi admin" '
  'di materi klien bukan tarif melainkan ketiadaan tarif.';
