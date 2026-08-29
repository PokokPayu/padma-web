-- ============================================================================
-- JEJAK AUDIT KEPUTUSAN PEMBAYARAN + PENJAGA TRANSISI
-- ============================================================================
-- Sampai hari ini `status_bayar` hanyalah enum: tidak ada catatan SIAPA
-- menyetel 'lunas', KAPAN, dan dari status apa. Saat klien berkata "saya sudah
-- transfer" dan admin berkata "belum masuk", tidak ada satu baris pun yang bisa
-- dipakai membantah. Ini utang paling mahal secara bisnis di aplikasi ini.
--
-- Penamaan kolom sengaja menghindari kata bernuansa uang: money-firewall
-- struktural (tests/money-firewall-struktural.test.ts) memindai NAMA KOLOM
-- dengan regex per-kata, dan `status_bayar_lama` cocok dengan polanya. Dipakai
-- `status_lama`/`status_baru`. Tabel ini juga TIDAK boleh menamai kolomnya
-- `status_bayar`: test yang sama meng-assert nama itu hanya ada di
-- `client_packages` dan `sessions`.
--
-- Catatan penomoran: cap waktu 16:00:00 agar berjalan SESUDAH
-- 20260829150000_pengerasan_admin.sql — di sanalah default privileges TRUNCATE
-- untuk `authenticated` dicabut, dan tabel di bawah ini ikut mewarisinya.

create table public.jejak_status_bayar (
  id uuid primary key default gen_random_uuid(),
  -- SENGAJA TANPA foreign key. `clients -> sessions/client_packages` semuanya
  -- ON DELETE CASCADE; FK ke sana akan menghapus tepat bukti yang menjelaskan
  -- penghapusan itu — jejak audit yang ikut lenyap bersama yang diaudit tidak
  -- berguna sama sekali.
  sesi_id uuid,
  paket_klien_id uuid,
  status_lama pay_status,
  status_baru pay_status not null,
  -- nullable: jalur service role (seed, pembersihan test) tidak punya auth.uid()
  aktor_id uuid,
  peran_aktor text not null,
  dicatat_pada timestamptz not null default now(),
  constraint jejak_sasaran_tunggal check (
    (sesi_id is not null and paket_klien_id is null)
    or (sesi_id is null and paket_klien_id is not null)
  )
);

create index jejak_status_bayar_sesi_idx on public.jejak_status_bayar (sesi_id);
create index jejak_status_bayar_paket_idx on public.jejak_status_bayar (paket_klien_id);

alter table public.jejak_status_bayar enable row level security;

-- Hanya BACA untuk staf. Sengaja TIDAK ada policy INSERT/UPDATE/DELETE untuk
-- peran API mana pun: pengisian dikerjakan trigger SECURITY DEFINER, sehingga
-- jejak tidak bisa dikarang maupun dihapus oleh admin yang sedang diaudit.
create policy "jejak: staf baca" on public.jejak_status_bayar
  for select to authenticated
  using (user_role() in ('admin','owner'));

-- Pagar tingkat HAK, bukan sekadar policy: policy bisa ditambahkan seseorang
-- besok tanpa satu test pun merah selama haknya masih ada. `revoke all` dulu
-- (default privileges Supabase memberi authenticated INSERT/UPDATE/DELETE/
-- REFERENCES/TRIGGER pada setiap tabel baru), baru SELECT dikembalikan.
revoke all on public.jejak_status_bayar from anon;
revoke all on public.jejak_status_bayar from authenticated;
grant select on public.jejak_status_bayar to authenticated;

-- ============================================================================
-- PENCATAT
-- ============================================================================
-- SECURITY DEFINER karena `authenticated` sengaja tidak memegang INSERT.
-- Akibatnya `current_user` di dalam fungsi menjadi `postgres` (pemilik tabel,
-- yang melewati RLS), jadi identitas pemanggil TIDAK boleh diambil dari
-- current_user: ia diambil dari `auth.uid()`/`user_role()` yang membaca GUC JWT
-- request dan tidak terpengaruh security definer.
create or replace function public.catat_status_bayar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Trigger `after update of status_bayar` menyala saat kolomnya DISEBUT di
  -- SET, BUKAN saat nilainya berubah. Tanpa penjaga ini, upsert idempoten
  -- scripts/seed-users.ts — dijalankan tests/global-setup.ts setiap
  -- `npm test` — menumpuk satu baris jejak palsu per sesi per run.
  if new.status_bayar is not distinct from old.status_bayar then
    return null;
  end if;

  insert into public.jejak_status_bayar (
    sesi_id, paket_klien_id, status_lama, status_baru, aktor_id, peran_aktor
  ) values (
    case when tg_table_name = 'sessions' then new.id end,
    case when tg_table_name = 'client_packages' then new.id end,
    old.status_bayar,
    new.status_bayar,
    auth.uid(),
    case when auth.uid() is null then 'service_role' else user_role()::text end
  );

  -- AFTER trigger: nilai kembalian diabaikan.
  return null;
end;
$$;

-- Fungsi baru wajib tertutup untuk public & anon (lihat migration
-- fail_closed_sequence_fungsi): PostgREST mengekspos setiap fungsi public
-- sebagai RPC.
revoke execute on function public.catat_status_bayar() from public, anon;

create trigger trg_catat_status_bayar_sesi
  after update of status_bayar on public.sessions
  for each row execute function public.catat_status_bayar();

create trigger trg_catat_status_bayar_paket
  after update of status_bayar on public.client_packages
  for each row execute function public.catat_status_bayar();

-- ============================================================================
-- PENJAGA TRANSISI
-- ============================================================================
-- Pagar "hanya belum -> menunggu_verifikasi" untuk KLIEN hidup di server action
-- Plan 4 (`src/lib/passport/aksi.ts`). Di sini ditambahkan pagar DB untuk STAF:
-- pembayaran yang sudah dinyatakan lunas tidak boleh diputar mundur diam-diam.
--
-- Batas yang ditulis jujur: trigger ini TIDAK menjaga jalur klaim klien, dan
-- itu tidak bisa diperbaiki dengan hak tabel — klien, admin, dan owner adalah
-- peran SQL yang SAMA (`authenticated`). Yang menjaga jalur klien adalah
-- ketiadaan policy UPDATE untuknya plus server action bernilai hardcoded.
create or replace function public.guard_transisi_status_bayar()
returns trigger
language plpgsql
as $$
begin
  if new.status_bayar is not distinct from old.status_bayar then
    return new;
  end if;

  -- Gerbang peran SQL WAJIB: tanpanya scripts/seed-users.ts dan pembersihan
  -- afterAll di test (keduanya service role) akan mati, dan seluruh suite ikut
  -- mati. Yang dijaga adalah peran API — jalur manusia lewat PostgREST.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if old.status_bayar = 'lunas' then
      raise exception 'pembayaran yang sudah lunas tidak dapat diputar mundur'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_transisi_status_bayar() from public, anon;

create trigger trg_guard_transisi_bayar_sesi
  before update of status_bayar on public.sessions
  for each row execute function public.guard_transisi_status_bayar();

create trigger trg_guard_transisi_bayar_paket
  before update of status_bayar on public.client_packages
  for each row execute function public.guard_transisi_status_bayar();
