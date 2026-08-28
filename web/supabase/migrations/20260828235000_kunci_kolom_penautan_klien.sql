-- ============================================================================
-- KUNCI KOLOM PENAUTAN: `clients.user_id` & `clients.linked_at` HANYA SERVICE ROLE
-- ============================================================================
-- Temuan red team (direproduksi lewat REST, bukan teori) — sisa satu-satunya
-- jalur penautan TANPA token undangan sesudah migration
-- `20260828220000_undangan_penautan_klien`:
--
--   PATCH /rest/v1/clients?id=eq.<rina>
--   Authorization: Bearer <JWT admin>        <-- anon key, BUKAN service role
--   {"user_id":"<uid penyerang>","linked_at":"2026-08-28T..."}
--   -> HTTP 200, baris Rina kembali dengan user_id terisi & linked_at terset.
--
-- Sesudah itu penyerang login sebagai DIRINYA SENDIRI (email
-- `penyusup.admin@evil.test`, tidak ada hubungannya dengan email klien) dan
-- membaca PII + rekam medis Rina lewat policy `clients: milik sendiri`
-- (`user_id = auth.uid()`) beserta seluruh tabel yang menggantung padanya
-- (`sessions`, `client_packages`, `screenings`). Diverifikasi sampai lapisan
-- data: [{"nama":"Rina Hapsari","no_hp":"0857-0000-1111"}].
--
-- AKAR MASALAH. Policy `clients: staf` sengaja `for all` supaya staf bisa
-- mengelola data klien, dan itu memang benar untuk kolom OPERASIONAL (nama,
-- no_hp, phase_id, ...). Tetapi RLS Postgres tidak mengenal pembatasan
-- per-KOLOM untuk UPDATE: satu izin `for all` ikut menyerahkan dua kolom yang
-- bukan data operasional melainkan KEPUTUSAN IDENTITAS — akun auth mana yang
-- berhak membaca rekam medis baris ini. Akibatnya seluruh gerbang
-- `linkClientByInvite()` dilewati sekaligus: tanpa token, tanpa cek
-- kedaluwarsa, tanpa cek sekali-pakai, dan tanpa cek email cocok. `linked_at`
-- ikut terisi sehingga barisnya TAMPAK sah, sementara `client_invites`
-- (`used_at`/`used_by`) tetap kosong — tidak ada jejak audit sama sekali.
--
-- Bukan regresi baru (ada sejak model penautan lama), tetapi melanggar
-- invarian eksplisit yang dijanjikan migration undangan: "penautan HANYA lewat
-- token undangan". Sekaligus inkonsistensi kepercayaan dengan money firewall
-- yang sudah memperlakukan admin sebagai peran TERBATAS (admin tidak boleh
-- melihat tarif & honor) — tidak masuk akal bila peran yang sama boleh
-- menentukan akun mana yang membaca rekam medis siapa pun.
--
-- ===== KENAPA TRIGGER, BUKAN HAK KOLOM =====
-- Alternatifnya `revoke update (user_id, linked_at) on clients from
-- authenticated`. Ditolak dengan alasan yang sama seperti dua kali sebelumnya
-- (`gate_material_video`, `undangan_penautan_klien`): hak KOLOM untuk UPDATE
-- hanya berlaku bila hak UPDATE tingkat TABEL dicabut lebih dulu, dan begitu
-- itu dilakukan setiap kolom operasional harus di-grant satu per satu — daftar
-- yang akan basi setiap kali skema Plan 2 menambah kolom, dan basinya
-- GAGAL-TERBUKA (kolom baru otomatis boleh ditulis) bukan gagal-tertutup.
--
-- Trigger BEFORE INSERT/UPDATE menutup persoalannya tanpa daftar kolom:
-- ia mengikat PERUBAHAN NILAI dua kolom yang dilindungi, bukan kehadirannya di
-- payload. Panel admin tetap boleh mengirim baris utuh (`user_id` dengan nilai
-- yang sama tidak dianggap perubahan), dan `select *` tidak pernah tersentuh.
-- Polanya identik `guard_profile_role` yang sudah menjaga `profiles.role`.
--
-- Diprobe langsung sebelum ditulis (28 Agu 2026) — inilah yang membuat pola ini
-- bekerja: fungsi trigger TIDAK memerlukan EXECUTE saat menyala (Postgres
-- memeriksa haknya saat CREATE TRIGGER), sehingga hak `authenticated` boleh
-- dicabut sepenuhnya tanpa melumpuhkan penjagaan. Dibuktikan ulang oleh test
-- `tests/penautan-kolom-terkunci.test.ts` lewat koneksi SQL LANGSUNG sebagai
-- peran `authenticated` (bukan hanya lewat PostgREST).

-- ===== 1) FUNGSI PENJAGA =====
-- BUKAN `security definer`: `current_user` harus tetap peran PEMANGGIL, karena
-- justru itu yang membedakan jalur sah dari jalur terlarang.
--   - PostgREST menjalankan request sebagai `anon`/`authenticated`
--     (koneksinya sendiri `authenticator`) → DITOLAK;
--   - server PADMA memakai service key → `service_role` → DIIZINKAN, dan
--     satu-satunya kode yang menulis kolom ini di sana adalah
--     `linkClientByInvite()` yang menuntut token sah + email cocok;
--   - migration/psql/seed jalan sebagai `postgres` → DIIZINKAN.
create or replace function public.guard_client_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    -- INSERT: baris klien baru selalu lahir BELUM tertaut. Admin membuat data
    -- klien, lalu server menerbitkan undangan — bukan admin menunjuk akunnya.
    if tg_op = 'INSERT'
       and (new.user_id is not null or new.linked_at is not null) then
      raise exception
        'penautan akun klien hanya boleh lewat token undangan (service-role)'
        using errcode = '42501';
    end if;
    -- UPDATE: mengikat PERUBAHAN nilai, sehingga payload yang menyertakan
    -- kolom ini dengan nilai lama tetap lolos.
    -- `is distinct from` sengaja dipakai agar NULL ikut terjaga di kedua arah:
    -- mengisi (null -> uid), MELEPAS (uid -> null), maupun MEMINDAHKAN
    -- (uid -> uid lain) semuanya perubahan. Melepas tautan pun bukan wewenang
    -- staf lewat API: yang berhak menerbitkan ulang undangan adalah server.
    if tg_op = 'UPDATE'
       and (new.user_id is distinct from old.user_id
            or new.linked_at is distinct from old.linked_at) then
      raise exception
        'penautan akun klien hanya boleh lewat token undangan (service-role)'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_client_link() is
  'Menolak perubahan clients.user_id / clients.linked_at dari peran API '
  '(anon, authenticated, authenticator) — termasuk admin & owner. Penautan '
  'hanya sah lewat service role di server (linkClientByInvite: token undangan '
  'sekali pakai + email cocok).';

-- Aturan [F] migration `fail_closed_sequence_fungsi`: hak fungsi baru
-- dinyatakan EKSPLISIT, tidak mengandalkan default privileges siapa pun.
-- Di sini bahkan `authenticated` dicabut: fungsi ini tidak pernah boleh
-- dipanggil dari luar, dan sebagai fungsi trigger ia tetap menyala tanpa
-- EXECUTE (lihat catatan di kepala file).
revoke all on function public.guard_client_link() from public, anon, authenticated;

drop trigger if exists trg_guard_client_link on public.clients;
create trigger trg_guard_client_link
  before insert or update on public.clients
  for each row execute function public.guard_client_link();

-- ===== 2) INVARIAN DITULIS DI SKEMA =====
-- Komentar kolom adalah tempat pertama orang berikutnya melihat sebelum
-- melonggarkan policy `clients: staf`. Diuji keberadaannya oleh regression test
-- supaya tidak hilang tanpa sadar.
comment on column public.clients.user_id is
  'Akun auth pemilik baris klien ini; dasar RLS "clients: milik sendiri" '
  '(user_id = auth.uid()) dan karenanya penentu siapa yang boleh membaca rekam '
  'medisnya. HANYA boleh ditulis service role lewat linkClientByInvite() '
  '(token undangan sekali pakai + email cocok). Peran API — admin & owner '
  'sekalipun — ditolak trigger trg_guard_client_link.';

comment on column public.clients.linked_at is
  'Waktu akun auth tertaut ke baris klien ini lewat token undangan '
  '(public.client_invites). NULL = belum diaktifkan. Bukan rahasia (klien '
  'berhak tahu, admin perlu melihat siapa yang belum aktif), tetapi HANYA '
  'boleh ditulis service role bersama user_id — dijaga trigger '
  'trg_guard_client_link agar tidak ada jejak tautan palsu.';
