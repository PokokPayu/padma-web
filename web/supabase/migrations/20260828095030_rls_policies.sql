-- ===== HELPER PERAN =====
create or replace function public.user_role()
returns app_role
language sql stable security definer set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()), 'klien'::app_role);
$$;

-- ===== TRIGGER: auto-buat profil untuk user baru =====
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nama)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== AKTIFKAN RLS DI SEMUA TABEL =====
alter table profiles enable row level security;
alter table phases enable row level security;
alter table services enable row level security;
alter table packages enable row level security;
alter table partners enable row level security;
alter table app_settings enable row level security;
alter table clients enable row level security;
alter table client_packages enable row level security;
alter table sessions enable row level security;
alter table screenings enable row level security;
alter table booking_requests enable row level security;
alter table materials enable row level security;
alter table material_chapters enable row level security;
alter table service_rates enable row level security;
alter table honor_marks enable row level security;

-- ===== PROFILES =====
create policy "profil: baca sendiri atau staf" on profiles for select
  using (id = auth.uid() or user_role() in ('admin','owner'));
create policy "profil: staf kelola" on profiles for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- ===== MASTER DATA (baca: semua user login; tulis: staf) =====
create policy "phases: baca" on phases for select using (auth.uid() is not null);
create policy "services: baca" on services for select using (auth.uid() is not null);
create policy "packages: baca" on packages for select using (auth.uid() is not null);
create policy "services: staf kelola" on services for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "packages: staf kelola" on packages for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "phases: staf kelola" on phases for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "partners: staf" on partners for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "settings: staf" on app_settings for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- ===== KLIEN & OPERASIONAL =====
create policy "clients: milik sendiri" on clients for select
  using (user_id = auth.uid());
create policy "clients: staf" on clients for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "client_packages: milik sendiri" on client_packages for select
  using (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "client_packages: staf" on client_packages for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "sessions: milik sendiri" on sessions for select
  using (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "sessions: staf" on sessions for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- screenings: publik TIDAK boleh insert langsung (lewat server action + service role);
-- hanya staf yang boleh membaca/mengubah.
create policy "screenings: staf" on screenings for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "booking: klien baca miliknya" on booking_requests for select
  using (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "booking: klien ajukan" on booking_requests for insert
  with check (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "booking: staf" on booking_requests for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- ===== MATERI: meta terbaca user login; ISI bab hanya bila ada sesi selesai =====
create policy "materials: baca meta" on materials for select using (auth.uid() is not null);
create policy "materials: staf kelola" on materials for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "chapters: staf" on material_chapters for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "chapters: klien dgn sesi selesai" on material_chapters for select
  using (exists (
    select 1
    from materials m
    join sessions s on s.service_id = m.service_id and s.status = 'selesai'
    join clients c on c.id = s.client_id
    where m.id = material_id and c.user_id = auth.uid()
  ));

-- ===== TABEL UANG: HANYA OWNER (money firewall) =====
create policy "rates: hanya owner" on service_rates for all
  using (user_role() = 'owner') with check (user_role() = 'owner');
create policy "honor: hanya owner" on honor_marks for all
  using (user_role() = 'owner') with check (user_role() = 'owner');
