-- ============================================================================
-- TRANSPORT KHUSUS — nominal >20 km yang ditetapkan OWNER per kasus
-- ============================================================================
-- Materi klien menulis ">20 km: konfirmasi admin". Itu bukan tarif, itu
-- KETIADAAN tarif. Menyerahkan nominalnya kepada admin akan menabrak money
-- firewall — panel /admin tidak boleh memuat satu nominal pun — sementara
-- menolak pengajuannya menutup pintu bagi klien yang justru mau membayar
-- lebih. Owner satu-satunya peran yang boleh menyentuh angka, jadi ia yang
-- memutuskan, per sesi.

create table public.transport_khusus (
  session_id      uuid primary key references public.sessions(id) on delete cascade,
  tarif_klien     int not null,
  honor_mitra     int not null,
  ditetapkan_oleh uuid references auth.users(id),
  ditetapkan_pada timestamptz not null default now(),

  constraint transport_khusus_nilai_wajar check (tarif_klien >= 0 and honor_mitra >= 0)
);

-- `session_id` sebagai primary key: satu sesi, satu tarif khusus. Tidak ada
-- riwayat di sini dan itu disengaja — nominalnya ditetapkan sekali sebelum
-- tagihan terbit, dan mengubahnya sesudah klien membayar adalah persoalan
-- yang berbeda (koreksi berstempel), bukan pembaruan baris.

-- BUKAN `security definer`: `current_user` harus tetap peran PEMANGGIL, karena
-- justru itu yang membedakan jalur sah dari jalur terlarang.
create or replace function public.jaga_transport_khusus()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  -- Siapa yang menetapkan nominal adalah BUKTI. Pelajaran yang sudah dibayar
  -- sekali di honor_marks: identitas yang datang dari payload bisa dipalsukan,
  -- dan pemalsuannya permanen karena DELETE dicabut.
  new.ditetapkan_oleh := auth.uid();
  new.ditetapkan_pada := now();
  return new;
end;
$$;

comment on function public.jaga_transport_khusus() is
  'BEFORE INSERT transport_khusus untuk peran API: merebut ditetapkan_oleh & '
  'ditetapkan_pada dari payload. Service role dilewatkan untuk jalur seed & '
  'pemindahan data.';

revoke all on function public.jaga_transport_khusus() from public, anon, authenticated;

create trigger trg_jaga_transport_khusus
  before insert on public.transport_khusus
  for each row execute function public.jaga_transport_khusus();

alter table public.transport_khusus enable row level security;

create policy "transport_khusus: hanya owner" on public.transport_khusus
  for all to authenticated
  using (user_role() = 'owner') with check (user_role() = 'owner');

revoke all on public.transport_khusus from anon;
grant select, insert, update on public.transport_khusus to authenticated;
revoke delete on public.transport_khusus from authenticated;

comment on table public.transport_khusus is
  'Nominal transport >20 km, DITETAPKAN OWNER PER KASUS — bukan rate card. '
  'ditetapkan_oleh & ditetapkan_pada DIREBUT dari payload (trigger '
  'trg_jaga_transport_khusus), sama seperti honor_marks. session_id sebagai '
  'primary key: satu sesi, satu tarif khusus, tanpa riwayat — koreksi sesudah '
  'ditetapkan adalah persoalan berbeda, bukan UPDATE baris ini.';
