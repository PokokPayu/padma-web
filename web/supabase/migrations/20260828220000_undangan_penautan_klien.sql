-- ============================================================================
-- PENAUTAN AKUN KLIEN LEWAT TOKEN UNDANGAN SEKALI-PAKAI
-- ============================================================================
-- Temuan (direproduksi, bukan teori):
--   1. penyerang mendaftar mandiri dengan email klien yang belum tertaut
--      (`rina@padma.test`) → BERHASIL, dan karena
--      `[auth.email] enable_confirmations = false` GoTrue meng-auto-confirm
--      email itu TANPA bukti kepemilikan apa pun;
--   2. `linkClientByEmail()` mencocokkan email → `clients.user_id` diisi id
--      penyerang;
--   3. penyerang membaca PII: [{"nama":"Rina Hapsari","no_hp":"0857-0000-1111"}];
--   4. penyerang membaca rekam medis lewat RLS `clients.user_id = auth.uid()`:
--      "RAHASIA MEDIS: riwayat keguguran 2024, TD 130/85".
--
-- Akar masalahnya BUKAN cara mencocokkan email. Pencocokan persis `.eq()` atas
-- email ternormalisasi (migration 20260828114500) sudah benar dan tahan
-- wildcard/kapitalisasi. Yang salah adalah ASUMSI di baliknya: bahwa email yang
-- dipakai login benar-benar milik orang itu. Menebak alamat email bukan
-- otentikasi — dan alamat klien memang gampang ditebak.
--
-- Perbaikan: penautan digerbangi TOKEN UNDANGAN — rahasia acak kriptografis
-- (32 byte) yang dibuat server saat admin membuat data klien, dikirim lewat
-- KANAL TERPISAH (pesan sambutan WhatsApp yang memang sudah ada di alur bisnis
-- spec bagian 4), berumur terbatas (default 14 hari), dan sekali pakai. Email
-- tetap harus cocok persis, tetapi email saja TIDAK PERNAH cukup.

-- ===== 1) JEJAK PENAUTAN DI BARIS KLIEN =====
-- `linked_at` sengaja tinggal di `clients`: ia bukan rahasia (klien berhak
-- tahu kapan akunnya tertaut) dan admin memerlukannya untuk melihat siapa yang
-- belum mengaktifkan akun.
alter table public.clients
  add column linked_at timestamptz;

comment on column public.clients.linked_at is
  'Waktu akun auth tertaut ke baris klien ini lewat token undangan '
  '(public.client_invites). NULL = belum diaktifkan.';

-- ===== 2) TOKEN DISIMPAN DI TABEL TERPISAH, BUKAN KOLOM `clients` =====
-- Kenapa BUKAN kolom `clients.invite_token` + `revoke select (kolom)`:
-- diuji langsung di Postgres lokal (28 Agu 2026), pola itu MEMATAHKAN query
-- yang sudah ada. Hak kolom hanya berlaku bila hak SELECT tingkat TABEL
-- dicabut lebih dulu, dan begitu itu dilakukan:
--
--   begin;
--   alter table public.clients add column invite_token text unique;
--   revoke select on public.clients from anon, authenticated;
--   grant select (id, padma_id, nama, email, no_hp, phase_id, user_id,
--                 created_at) on public.clients to authenticated;
--   set local role authenticated;
--   select * from public.clients limit 1;
--   -- ERROR:  permission denied for table clients   <-- 42501
--   rollback;
--
-- `select *` (dipakai PostgREST untuk `.select("*")`, panel admin, dan test)
-- GAGAL 42501 untuk klien MAUPUN admin — bukan menyembunyikan kolomnya. Ini
-- persis kesimpulan yang sudah dicatat migration `gate_material_video` untuk
-- `materials.video_url`.
--
-- Maka polanya diikuti apa adanya: rahasia pindah ke tabel sendiri yang
-- `anon` dan `authenticated` tidak punya hak sama sekali atasnya. Token hanya
-- bisa disentuh service role di server. Baris `clients` tetap utuh sehingga
-- `select *` tetap jalan.
create table public.client_invites (
  client_id uuid primary key references public.clients(id) on delete cascade,
  -- SHA-256 heksadesimal dari token, BUKAN tokennya. Dump/backup DB yang bocor
  -- karena itu tidak berisi kunci yang bisa langsung dipakai menautkan akun.
  -- NULL sesudah dipakai: barisnya tetap ada untuk jejak audit, tapi tidak ada
  -- lagi yang bisa dicocokkan.
  token_hash text unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  -- Undangan yang belum dipakai WAJIB punya token; yang sudah dipakai wajib
  -- tidak punya. Invarian "sekali pakai" ditegakkan DB, bukan hanya aplikasi.
  constraint client_invites_token_sekali_pakai
    check ((used_at is null) = (token_hash is not null))
);

comment on table public.client_invites is
  'Token undangan aktivasi akun klien: acak 32 byte, disimpan sebagai SHA-256, '
  'sekali pakai, berumur terbatas. Dikirim admin lewat pesan sambutan WhatsApp. '
  'Tidak boleh terbaca peran API mana pun — hanya service role di server.';

-- ===== 3) RLS + HAK TABEL: tertutup rapat untuk peran API =====
-- Dua lapis, sama seperti tabel sensitif lain di skema ini: hak tabel menjawab
-- "boleh menyentuh tabel ini?", RLS menjawab "baris mana?". Di sini jawabannya
-- "tidak sama sekali" untuk anon & authenticated — termasuk admin & owner,
-- yang login sebagai `authenticated` juga: tidak ada satu pun alur produk yang
-- mengharuskan token undangan terbaca dari browser. Admin cukup menerima
-- TAUTAN siap-kirim dari server saat undangan dibuat.
alter table public.client_invites enable row level security;
-- Sengaja TANPA policy apa pun: RLS aktif tanpa policy = semua akses non-bypass
-- ditolak. service_role (BYPASSRLS) tetap bisa bekerja dari server.

revoke all on public.client_invites from anon, authenticated;
-- `revoke ... on table` tidak menyentuh hak tingkat KOLOM yang mungkin lahir
-- dari default privileges; sapu bersih agar tabel tidak tampak tertutup di
-- level tabel tetapi masih bocor per-kolom.
revoke all (client_id, token_hash, expires_at, created_at, used_at, used_by)
  on public.client_invites from anon, authenticated;

-- Pencarian selalu lewat hash token; unique index dari constraint sudah
-- melayaninya. Index tambahan untuk menyapu undangan kedaluwarsa.
create index client_invites_expires_idx on public.client_invites (expires_at);
