-- ============================================================================
-- TUTUP TEMUAN RED TEAM PANEL ADMIN
-- ============================================================================
-- Empat celah, dua kelompok. Semuanya SENYAP di UI, dan tiga di antaranya
-- membuat pagar yang sudah ada terlihat utuh padahal sudah dilewati.
--
--  (1) Jejak audit pembayaran hanya menutup jalur UPDATE. Trigger
--      `catat_status_bayar` adalah `after update of status_bayar`, jadi baris
--      yang LAHIR berstatus 'lunas' lewat POST /rest/v1/ tidak mencatat apa
--      pun. Admin tidak perlu menghapus jejak — cukup tidak pernah membuatnya.
--      Diperparah dua hal: `client_packages` tidak punya stempel waktu sama
--      sekali (lihat (2)), dan `guard_transisi_status_bayar` melarang 'lunas'
--      diputar mundur oleh peran API — sehingga baris palsu itu juga tidak
--      bisa dicabut admin atau owner lain lewat aplikasi.
--  (2) `client_packages` tanpa created_at/updated_at: nol forensik.
--  (3) Jalur produksi satu-satunya yang menggerakkan `status_bayar`,
--      `klaimSudahBayar()`, menulis lewat service role. Setiap klaim "saya
--      sudah transfer" tercatat `aktor_id = NULL, peran_aktor='service_role'`
--      — persis sengketa yang tabel jejak dibuat untuk menyelesaikannya.
--  (4) View `public.partner_publik` bisa DITULIS setiap pengguna login,
--      melewati RLS `partners` sepenuhnya.
--
-- Catatan penomoran: cap waktu 18:00:00 agar berjalan SESUDAH seluruh
-- migration Plan 3A (yang terakhir 20260829170000). Migration lama TIDAK
-- diubah: ia sudah dipakai, dan riwayat yang ditulis ulang menyembunyikan
-- justru pelajaran yang mahal ini.

-- ============================================================================
-- (4) VIEW partner_publik — verba tulis dicabut
-- ============================================================================
-- Tiga fakta bertemu menjadi pintu tulis:
--   a. `authenticated` memegang INSERT/UPDATE/DELETE atas view ini, warisan
--      default privileges Supabase saat view dibuat. Baris
--      `revoke all ... from anon; grant select ... to authenticated;` yang
--      dipakai dua kali di repo ini MENYESATKAN: `revoke`-nya hanya mengenai
--      `anon`, sehingga terbaca "hanya baca" padahal tidak.
--   b. View-nya `select id, nama from partners` tanpa WHERE, jadi
--      AUTO-UPDATABLE penuh (information_schema.views.is_updatable = YES).
--   c. `security_invoker = off` membuat hak & RLS diperiksa sebagai PEMILIK
--      view (postgres), sehingga policy "partners: staf" tidak pernah ikut
--      diperiksa.
-- Yang dicabut hanya verba TULIS: (c) wajib dipertahankan — view inilah batas
-- kolomnya, dan klien memang tidak berhak membaca `partners`. Mengubahnya
-- menjadi `security_invoker = on` akan mematikan riwayat sesi seluruh klien.
--
-- `force row level security` pada `partners` SENGAJA TIDAK dipakai: pemilik
-- view adalah `postgres`, jadi RLS yang dipaksakan justru akan menyaring
-- pembacaan view itu sendiri menjadi 0 baris (policy yang ada hanya untuk
-- 'admin'/'owner'), dan `supabase/seed.sql` — yang menyisipkan `partners`
-- sebagai postgres — ikut mati.
revoke all on public.partner_publik from anon, authenticated;
grant select on public.partner_publik to authenticated;

-- ============================================================================
-- (2) client_packages — stempel waktu
-- ============================================================================
-- Satu-satunya objek uang tanpa jejak waktu apa pun. Nama kolomnya netral
-- terhadap regex money firewall struktural.
alter table public.client_packages
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

create trigger trg_client_packages_updated_at
  before update on public.client_packages
  for each row execute function public.sentuh_updated_at();

-- ============================================================================
-- (1a) Pencatat jejak IKUT menutup jalur INSERT
-- ============================================================================
-- Satu fungsi untuk dua TG_OP. `old` tidak pernah ter-assign pada trigger
-- INSERT (menyebutnya melempar "record old is not assigned yet"), jadi
-- percabangan TG_OP wajib, bukan gaya penulisan.
--
-- Baris yang lahir langsung berstatus non-'belum' dicatat sebagai
-- `status_lama = null` — "lahir begitu", bukan transisi. Kolomnya memang sudah
-- nullable sejak awal.
create or replace function public.catat_status_bayar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lama pay_status;
begin
  if tg_op = 'INSERT' then
    -- Kelahiran berstatus 'belum' bukan keputusan uang; trigger INSERT-nya
    -- sudah menyaring lewat klausa WHEN, ini pagar keduanya.
    if new.status_bayar is not distinct from 'belum'::pay_status then
      return null;
    end if;
    lama := null;
  else
    -- Trigger `after update of <kolom>` menyala saat kolomnya DISEBUT di SET,
    -- BUKAN saat nilainya berubah. Tanpa penjaga ini, upsert idempoten
    -- scripts/seed-users.ts — dijalankan tests/global-setup.ts setiap
    -- `npm test` — menumpuk satu baris jejak palsu per sesi per run.
    if new.status_bayar is not distinct from old.status_bayar then
      return null;
    end if;
    lama := old.status_bayar;
  end if;

  insert into public.jejak_status_bayar (
    sesi_id, paket_klien_id, status_lama, status_baru, aktor_id, peran_aktor
  ) values (
    case when tg_table_name = 'sessions' then new.id end,
    case when tg_table_name = 'client_packages' then new.id end,
    lama,
    new.status_bayar,
    auth.uid(),
    case when auth.uid() is null then 'service_role' else user_role()::text end
  );

  -- AFTER trigger: nilai kembalian diabaikan.
  return null;
end;
$$;

-- `create or replace` mempertahankan ACL, tetapi pencabutannya ditulis ulang
-- supaya berkas ini berdiri sendiri saat dibaca (lihat migration
-- fail_closed_sequence_fungsi).
revoke execute on function public.catat_status_bayar() from public, anon;

create trigger trg_catat_status_bayar_sesi_insert
  after insert on public.sessions
  for each row when (new.status_bayar is distinct from 'belum'::pay_status)
  execute function public.catat_status_bayar();

create trigger trg_catat_status_bayar_paket_insert
  after insert on public.client_packages
  for each row when (new.status_bayar is distinct from 'belum'::pay_status)
  execute function public.catat_status_bayar();

-- ============================================================================
-- (1b) Peran API tidak boleh MELAHIRKAN keputusan uang
-- ============================================================================
-- Mencatat jejak INSERT saja belum cukup: baris "lunas" yang lahir dari peran
-- API tetap melompati verifikasi manual, dan penjaga transisi membuatnya tidak
-- bisa dicabut lagi lewat aplikasi. Karena itu keputusan uang HANYA boleh
-- terjadi lewat UPDATE — jalur yang sudah terjaga penuh (jejak beraktor +
-- penjaga transisi).
--
-- Gerbang peran SQL WAJIB: tanpanya scripts/seed-users.ts dan pembersihan
-- afterAll di test (keduanya service role) mati, dan seluruh suite ikut mati.
-- Yang dijaga adalah peran API — jalur manusia lewat PostgREST. Klien, admin,
-- dan owner adalah peran SQL yang SAMA (`authenticated`), jadi pagar ini
-- berlaku untuk ketiganya sekaligus.
create or replace function public.guard_insert_status_bayar()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator')
     and new.status_bayar is distinct from 'belum'::pay_status then
    raise exception 'status pembayaran baru hanya boleh diputuskan lewat pembaruan, bukan saat baris dibuat'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_insert_status_bayar() from public, anon;

create trigger trg_guard_insert_bayar_sesi
  before insert on public.sessions
  for each row execute function public.guard_insert_status_bayar();

create trigger trg_guard_insert_bayar_paket
  before insert on public.client_packages
  for each row execute function public.guard_insert_status_bayar();

-- ============================================================================
-- (3) Klaim klien memakai SESI PENGGUNA, bukan service role
-- ============================================================================
-- Klien sengaja tidak punya policy UPDATE pada `sessions`/`client_packages`
-- (RLS tidak mengenal batas per-kolom untuk UPDATE), jadi jalurnya harus
-- lewat fungsi. `security definer` supaya haknya cukup; identitas TIDAK
-- diambil dari `current_user` (di dalam fungsi ia menjadi `postgres`)
-- melainkan dari `auth.uid()`, yang membaca GUC JWT request dan tidak
-- terpengaruh security definer. Karena JWT klien ikut terbawa, trigger jejak
-- mencatat `peran_aktor='klien'` dengan aktor_id yang sebenarnya.
--
-- Tidak ada satu pun argumen berupa status tujuan: begitu status datang dari
-- browser, verifikasi manual admin bisa dilompati klien sendiri. Fungsi ini
-- hanya mengenal SATU transisi, ditulis di sini dan tidak di tempat lain.
create or replace function public.klaim_sudah_bayar(jenis text, sasaran_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pemilik uuid;
begin
  if jenis not in ('paket', 'sesi') then
    raise exception 'jenis klaim tidak dikenal: %', jenis using errcode = '22023';
  end if;

  -- Kepemilikan diturunkan dari SESI, tidak pernah dari argumen — itulah yang
  -- membuat filter di bawah bermakna.
  select c.id into pemilik
    from public.clients c
   where c.user_id = auth.uid()
   limit 1;
  if pemilik is null then
    return; -- akun belum tertaut: tidak ada baris yang boleh disentuh
  end if;

  if jenis = 'sesi' then
    return query
      update public.sessions s
         set status_bayar = 'menunggu_verifikasi'
       where s.id = sasaran_id
         and s.client_id = pemilik
         and s.status_bayar = 'belum'
      returning s.id;
  else
    return query
      update public.client_packages p
         set status_bayar = 'menunggu_verifikasi'
       where p.id = sasaran_id
         and p.client_id = pemilik
         and p.status_bayar = 'belum'
      returning p.id;
  end if;
end;
$$;

-- Fungsi baru wajib tertutup untuk public & anon: PostgREST mengekspos setiap
-- fungsi public sebagai RPC, dan anon key tertanam di bundel browser.
revoke execute on function public.klaim_sudah_bayar(text, uuid) from public, anon;
grant execute on function public.klaim_sudah_bayar(text, uuid) to authenticated;
