-- ===== ENUMS =====
create type app_role as enum ('klien','admin','owner');
create type session_status as enum ('terjadwal','selesai','batal');
create type pay_status as enum ('belum','menunggu_verifikasi','lunas');
create type screening_result as enum ('hijau','merah');
create type screening_followup as enum ('baru','dihubungi','jadi_klien','ditolak');
create type package_status as enum ('aktif','selesai','berhenti');
create type material_type as enum ('ebook','video');
create type booking_status as enum ('menunggu','dikonfirmasi','ditolak');
create type waktu_pref as enum ('pagi','siang','sore');

-- ===== PROFIL & PERAN =====
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null default 'klien',
  nama text not null default '',
  created_at timestamptz not null default now()
);

-- ===== MASTER DATA =====
create table phases (
  id text primary key,              -- 'prekonsepsi' | 'kehamilan' | 'nifas' | 'menopause' | 'newborn'
  nama_sanskrit text not null,      -- Sankalpa, Garbha, ...
  nama text not null,               -- label Indonesia
  urutan int not null
);

create table services (
  id uuid primary key default gen_random_uuid(),
  phase_id text not null references phases(id),
  nama text not null,
  deskripsi text not null default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

create table packages (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  nama text not null,
  jumlah_sesi int not null check (jumlah_sesi > 0),
  aktif boolean not null default true
);

create table partners (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  no_hp text not null default '',
  aktif boolean not null default true
);

create table app_settings (
  key text primary key,
  value text not null
);

-- ===== KLIEN & OPERASIONAL =====
create table clients (
  id uuid primary key default gen_random_uuid(),
  padma_id text not null unique,
  nama text not null,
  email text not null unique,
  no_hp text not null default '',
  phase_id text not null references phases(id),
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index clients_user_id_idx on clients(user_id);
create index clients_email_lower_idx on clients (lower(email));

create table client_packages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  package_id uuid not null references packages(id),
  tanggal_mulai date not null default current_date,
  status package_status not null default 'aktif',
  status_bayar pay_status not null default 'belum'
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  service_id uuid not null references services(id),
  client_package_id uuid references client_packages(id),
  partner_id uuid not null references partners(id),
  tanggal date not null,
  status session_status not null default 'terjadwal',
  catatan text not null default '',
  rekomendasi text not null default '',
  -- hanya relevan untuk sesi lepas; sesi dalam paket ikut status paketnya
  status_bayar pay_status not null default 'belum',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_client_idx on sessions(client_id);
create index sessions_tanggal_idx on sessions(tanggal);

create table screenings (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  no_hp text not null,
  fase text not null,
  jawaban jsonb not null,
  hasil screening_result not null,
  flags jsonb not null default '[]',
  status_tindak_lanjut screening_followup not null default 'baru',
  client_id uuid references clients(id),
  created_at timestamptz not null default now()
);

create table booking_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  service_id uuid not null references services(id),
  tanggal date not null,
  preferensi_waktu waktu_pref not null,
  catatan text not null default '',
  status booking_status not null default 'menunggu',
  created_at timestamptz not null default now()
);

-- ===== MATERI (tanpa file — konten per-bab di DB, keputusan #13) =====
create table materials (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  judul text not null,
  tipe material_type not null,
  deskripsi text not null default '',
  video_url text,                    -- penyedia terproteksi (Vimeo/CF Stream), bukan file
  aktif boolean not null default true
);

create table material_chapters (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  urutan int not null,
  judul text not null,
  isi text not null default ''
);

-- ===== TABEL UANG (hanya owner — RLS di migration berikutnya) =====
create table service_rates (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  harga_klien int not null,
  honor_mitra int not null,
  berlaku_sejak date not null default current_date
);
create index service_rates_lookup_idx on service_rates(service_id, berlaku_sejak desc);

create table honor_marks (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  week_start date not null,
  dibayar_pada timestamptz not null default now(),
  ditandai_oleh uuid references auth.users(id),
  unique (partner_id, week_start)
);
