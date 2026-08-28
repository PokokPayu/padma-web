-- ============================================================================
-- HARDENING RLS — menutup temuan red team (eskalasi hak lewat tabel profiles)
-- ============================================================================
-- Temuan: policy "profil: staf kelola" (FOR ALL, using/with check
-- user_role() in ('admin','owner')) membuat admin bebas MENULIS kolom `role`
-- pada baris profil mana pun — termasuk barisnya sendiri — menjadi 'owner'.
-- Karena public.user_role() membaca peran dari tabel profiles (bukan klaim
-- JWT), promosi diri langsung berlaku pada evaluasi RLS berikutnya sehingga
-- money firewall (service_rates & honor_marks "hanya owner") tembus hanya
-- dengan anon key dari browser. Policy FOR ALL juga memberi admin INSERT &
-- DELETE profil (mis. menghapus profil owner).
--
-- WITH CHECK tidak bisa membandingkan OLD.role vs NEW.role, jadi penambalan
-- dilakukan berlapis:
--   Lapis 1 — policy dipersempit: FOR ALL dipecah, hanya UPDATE untuk staf.
--   Lapis 2 — hak kolom SQL: authenticated/anon hanya boleh UPDATE kolom nama.
--   Lapis 3 — trigger integritas: kolom `role` hanya boleh berubah dari jalur
--             service-role / SQL langsung, bukan dari sesi API anon/authenticated.
-- Perubahan peran resmi tetap bisa dilakukan lewat service-role (script seed,
-- server action, atau psql).

-- ===== LAPIS 1: bongkar policy FOR ALL yang terlalu luas =====
drop policy if exists "profil: staf kelola" on public.profiles;

-- Staf tetap boleh memperbarui profil (mis. memperbaiki nama klien).
-- Kolom `role` dijaga oleh lapis 2 & 3 di bawah.
create policy "profil: staf ubah" on public.profiles for update
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Sengaja TIDAK ADA policy INSERT/DELETE pada profiles untuk peran API:
--  - pembuatan profil hanya lewat trigger handle_new_user (security definer),
--  - penghapusan mengikuti cascade dari auth.users atau lewat service-role.
-- Tanpa policy, INSERT/DELETE oleh anon/authenticated ditolak RLS.

-- ===== LAPIS 2: hak kolom di level SQL =====
-- Cabut hak tulis penuh dari peran API, lalu berikan kembali HANYA kolom
-- non-peran. Dengan ini `update ... set role = ...` ditolak Postgres (42501)
-- bahkan sebelum RLS dievaluasi. service_role & postgres tidak terpengaruh.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nama) on public.profiles to authenticated;

-- ===== LAPIS 3: trigger integritas kolom `role` =====
-- Bukan SECURITY DEFINER supaya current_user tetap peran pemanggil:
-- PostgREST menjalankan request sebagai 'anon'/'authenticated', service-role
-- sebagai 'service_role', migration/psql sebagai 'postgres', dan trigger
-- handle_new_user (security definer) sebagai pemilik tabel.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'perubahan peran hanya boleh lewat service-role'
        using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.role is distinct from 'klien'::app_role then
      raise exception 'penetapan peran non-klien hanya boleh lewat service-role'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      raise exception 'id profil tidak boleh diubah'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_role on public.profiles;
create trigger trg_guard_profile_role
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();

-- ===== MONEY FIREWALL: pertahanan berlapis =====
-- Policy owner-only sudah ada; cabut pula seluruh hak tabel uang dari 'anon'
-- agar tidak bergantung pada RLS semata. 'authenticated' tetap butuh hak tabel
-- karena owner login sebagai peran itu — pembatasannya tetap lewat RLS.
revoke all on public.service_rates from anon;
revoke all on public.honor_marks from anon;

comment on column public.profiles.role is
  'Peran aplikasi. HANYA boleh diubah lewat service-role/SQL langsung; '
  'dijaga oleh hak kolom + trigger trg_guard_profile_role.';
