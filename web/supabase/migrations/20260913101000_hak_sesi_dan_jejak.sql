-- ============================================================================
-- C3-a (2/2): HAK SESI, JEJAK JADWAL, JATAH JADWAL ULANG
-- ============================================================================

-- ---------------------------------------------------------------------------
-- HAK SESI — kredit berwujud OBJEK HAK, bukan saldo (spec C3 P3)
-- ---------------------------------------------------------------------------
-- TIDAK ADA satu pun kolom nominal di sini, dan itu bukan kelalaian melainkan
-- intinya. Money firewall struktural (`tests/money-firewall-struktural.test.ts`)
-- hanya mengizinkan kolom uang di `variant_rates`, `honor_marks`,
-- `transport_rates`, dan `transport_khusus`; menaruh nilai kredit di sini akan
-- merah, dan itu benar. Konsekuensi yang DIINGINKAN: jenjang 2 tidak pernah
-- menyentuh tabel uang sama sekali. Klien menerima HAK, bukan saldo — dan hak
-- tidak bisa dicairkan, tidak bisa dipindahkan, dan tidak menuntut
-- rekonsiliasi.
--
-- Namanya sengaja tidak menyebut "kredit" maupun "paket": bila paket kelak
-- dibuka (saklar PAKET_TAMPIL), paket menerbitkan SEPULUH baris di tabel yang
-- sama alih-alih melahirkan mekanisme kedua.
create table public.hak_sesi (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- LAYANAN TERKUNCI. Permintaan pemilik: hak tidak bisa dipindah ke layanan
  -- lain, "agar lebih mudah". Menyimpannya sebagai kolom wajib membuat aturan
  -- itu ditegakkan struktur, bukan diingat pemanggil.
  service_id uuid not null references public.services(id),
  kedaluwarsa date not null,
  -- Sesi yang batal dan melahirkan hak ini. Tanpa FK ke sessions: sesi bisa
  -- dihapus, sedangkan hak yang sudah terbit tetap milik klien.
  sesi_asal_id uuid,
  -- Sesi baru yang menghabiskan hak ini. NULL selama belum dipakai.
  dipakai_sesi_id uuid,
  created_at timestamptz not null default now()
);

-- SATU hak, SATU sesi. Parsial supaya baris yang belum dipakai (NULL) tidak
-- saling bentrok — tanpa `where`, hanya satu hak di seluruh tabel yang boleh
-- belum terpakai.
create unique index hak_sesi_dipakai_sekali
  on public.hak_sesi (dipakai_sesi_id)
  where dipakai_sesi_id is not null;

create index hak_sesi_milik_klien on public.hak_sesi (client_id, kedaluwarsa);

alter table public.hak_sesi enable row level security;

-- Klien MEMBACA miliknya sendiri, dan hanya itu. Tidak ada policy INSERT,
-- UPDATE, maupun DELETE untuk siapa pun kecuali staf: hak terbit dari fungsi
-- `security definer` (Task 3), tidak pernah dari peramban. Klien yang bisa
-- menyisipkan barisnya sendiri adalah klien yang bisa mencetak sesi gratis.
create policy "hak_sesi: klien baca miliknya" on public.hak_sesi for select
  to authenticated
  using (client_id in (select c.id from public.clients c where c.user_id = auth.uid()));

create policy "hak_sesi: staf" on public.hak_sesi for all
  to authenticated
  using (public.user_role() in ('admin', 'owner'))
  with check (public.user_role() in ('admin', 'owner'));

-- ---------------------------------------------------------------------------
-- JATAH JADWAL ULANG (spec C3 P4)
-- ---------------------------------------------------------------------------
-- Menempel pada BARIS SESI, dan jadwal ulang mengubah baris yang sama.
-- Alternatif yang ditolak: membatalkan baris lama lalu membuat baris baru.
-- Baris baru lahir dengan jatah kosong, sehingga "1× per pemesanan" bisa
-- di-reset tanpa batas hanya dengan menjadwal ulang berulang — aturannya jadi
-- bohong tanpa satu pun galat. Riwayat perpindahannya tidak hilang: ia hidup
-- di `jejak_jadwal` di bawah.
alter table public.sessions
  add column jadwal_ulang_terpakai boolean not null default false;

-- ---------------------------------------------------------------------------
-- JEJAK JADWAL (spec C3 P6)
-- ---------------------------------------------------------------------------
-- SENGAJA TANPA foreign key ke `sessions`, mengikuti `jejak_status_bayar`:
-- `clients -> sessions` adalah ON DELETE CASCADE, jadi FK ke sana akan
-- menghapus tepat bukti yang menjelaskan penghapusan itu.
--
-- Ongkosnya nyata dan harus ditanggung: setiap berkas uji yang menghapus sesi
-- WAJIB menyapu jejaknya sendiri, atau `tests/jejak-yatim.test.ts` merah di
-- suite yang tidak menyentuh pembatalan sama sekali.
create table public.jejak_jadwal (
  id uuid primary key default gen_random_uuid(),
  sesi_id uuid not null,
  tindakan text not null check (tindakan in ('batal', 'jadwal_ulang', 'tukar_hak')),
  -- 1..4. Disimpan APA ADANYA hasil hitungan saat tindakan dilakukan — ini
  -- catatan sejarah, bukan turunan yang bisa dihitung ulang: aturannya bisa
  -- berubah, dan jejak harus tetap menyebut aturan yang berlaku saat itu.
  jenjang smallint not null check (jenjang between 1 and 4),
  dari_tanggal date,
  dari_jam time,
  ke_tanggal date,
  ke_jam time,
  -- Wajib berisi untuk pengecualian darurat medis (spec C3 P7); untuk tindakan
  -- biasa boleh kosong.
  alasan text not null default '',
  darurat boolean not null default false,
  -- nullable: jalur service role (seed, pembersihan uji) tidak punya auth.uid()
  aktor_id uuid,
  peran_aktor text not null,
  dicatat_pada timestamptz not null default now()
);

create index jejak_jadwal_sesi on public.jejak_jadwal (sesi_id, dicatat_pada);

alter table public.jejak_jadwal enable row level security;

create policy "jejak_jadwal: staf baca" on public.jejak_jadwal for select
  to authenticated
  using (public.user_role() in ('admin', 'owner'));

-- TIDAK ADA policy INSERT/UPDATE/DELETE untuk siapa pun. Barisnya ditulis
-- fungsi `security definer`, dan baris audit tidak boleh dihapus oleh admin
-- yang sedang diaudit. Pembersihan di uji WAJIB lewat service role.
