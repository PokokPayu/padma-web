-- ============================================================================
-- PENILAIAN SESI: DUA ANGKA, SATU LAYAR (spec C1 J10)
-- ============================================================================
-- DUA penilaian, bukan satu. Dilebur jadi satu angka, layanan yang salah
-- rancang akan terbaca sebagai bidan yang buruk: sesi 90 menit yang sebenarnya
-- butuh 120 menit menghasilkan klien kecewa, dan bintangnya jatuh ke orang yang
-- mengerjakannya dengan benar. Di tim sekecil ini satu bidan mengerjakan banyak
-- layanan, jadi angka yang tercampur bukan hanya tak berguna — ia tidak adil
-- pada orang yang nyata.
--
-- Dua tuas PADMA juga berbeda pemiliknya: katalog & durasi di tangan owner,
-- pembinaan tim di tangan admin. Satu angka tidak bisa menjawab pertanyaan
-- "orangnya atau layanannya?", dan itulah satu-satunya pertanyaan yang membuat
-- penilaian berguna.
--
-- RATING APLIKASI SENGAJA TIDAK ADA. Klien sempat memintanya; ditolak dan klien
-- setuju. Bintang untuk perangkat lunak tidak menunjuk apa pun yang bisa
-- dikerjakan, dan menit sesudah sesi di rumah klien adalah milik perawatannya.

create table public.session_ratings (
  id uuid primary key default gen_random_uuid(),

  -- Satu penilaian per sesi. UNIQUE, bukan sekadar index biasa: penilaian yang
  -- bisa digandakan adalah rata-rata yang bisa dikarang dengan menekan tombol
  -- kirim dua kali.
  session_id uuid not null unique references public.sessions(id) on delete cascade,

  -- Pemiliknya. Disalin, bukan diturunkan lewat join saat membaca: policy RLS
  -- di bawah membandingkannya langsung, dan join di dalam policy adalah biaya
  -- yang dibayar setiap baris setiap kali.
  client_id uuid not null references public.clients(id) on delete cascade,

  -- ===== SALINAN KEADAAN SAAT ITU (bagian terpenting tabel ini) =====
  -- Mitra pada sebuah sesi BISA BERGANTI — bidan sakit, atau sesinya dijadwalkan
  -- ulang di C3. Penilaian yang menempel lewat rujukan ke `sessions.partner_id`
  -- akan diam-diam berpindah ke orang lain begitu itu terjadi, dan tidak ada
  -- satu pun galat yang memberi tahu.
  --
  -- Penilaian adalah FAKTA TENTANG SIAPA YANG DATANG HARI ITU. Karena itu
  -- keduanya disalin, dan tidak pernah ditulis ulang sesudahnya.
  partner_id uuid not null references public.partners(id),
  variant_id uuid not null references public.service_variants(id),

  -- Bintang 1–5. CHECK, bukan kepercayaan pada formulir: klien memegang hak
  -- tulis atas tabel ini.
  bintang_layanan smallint not null check (bintang_layanan between 1 and 5),
  bintang_bidan smallint not null check (bintang_bidan between 1 and 5),

  -- Komentar bebas = TEKS TAK TEPERCAYA. Disimpan apa adanya, ditampilkan hanya
  -- ke staf, dan tidak pernah dirender sebagai markup. Ia bisa memuat
  -- keterangan kesehatan, jadi tunduk pada disiplin RLS yang sama dengan data
  -- klien lain.
  --
  -- Batas panjang bukan kerapian: tanpa itu satu tempelan raksasa menjadi
  -- payload yang harus dirender ulang di setiap kunjungan layar staf.
  komentar text not null default '' check (length(komentar) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.session_ratings is
  'Penilaian sesi: DUA angka (layanan & bidan) plus komentar opsional. '
  'partner_id & variant_id adalah SALINAN keadaan saat sesi terjadi, bukan '
  'rujukan hidup — mitra pada sesi bisa berganti, dan penilaian tidak boleh '
  'ikut berpindah orang. TIDAK ADA view agregat: view agregat persis yang dulu '
  'membocorkan rate card lengkap ke admin di repo ini.';

create index session_ratings_klien_idx on public.session_ratings (client_id, created_at desc);
create index session_ratings_mitra_idx on public.session_ratings (partner_id);
create index session_ratings_varian_idx on public.session_ratings (variant_id);

alter table public.session_ratings enable row level security;
revoke all on public.session_ratings from anon;

-- ===== PENJAGA ISI: hanya sesi MILIKNYA, dan hanya yang SELESAI =====
-- Policy RLS menjawab "baris mana"; ia tidak bisa menjawab "apakah salinan
-- mitranya jujur". Trigger ini yang menjawabnya — dan ia MENULIS ULANG
-- `partner_id`/`variant_id` dari baris sesi alih-alih memercayai kiriman
-- peramban, sehingga salinannya tidak pernah bisa dikarang.
create or replace function public.guard_penilaian_sesi()
returns trigger
language plpgsql
as $$
declare
  s public.sessions%rowtype;
  pemilik uuid;
begin
  select * into s from public.sessions where id = new.session_id;
  if not found then
    raise exception 'sesi tidak ditemukan' using errcode = '42501';
  end if;

  -- Hanya sesi yang SELESAI yang bisa dinilai. Menilai sesi yang belum terjadi
  -- adalah menilai sesuatu yang belum ada; menilai sesi yang dibatalkan adalah
  -- menilai orang yang tidak pernah datang.
  if s.status <> 'selesai' then
    raise exception 'hanya sesi yang sudah selesai yang bisa dinilai'
      using errcode = '42501';
  end if;

  -- Untuk peran API, kepemilikan diperiksa terhadap SESI — bukan terhadap
  -- `client_id` yang dikirim. Payload yang menyebut client_id orang lain
  -- karena itu tidak menolong siapa pun.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    select c.id into pemilik
      from public.clients c
     where c.user_id = auth.uid()
     limit 1;

    if pemilik is null or pemilik <> s.client_id then
      raise exception 'hanya pemilik sesi yang bisa menilainya'
        using errcode = '42501';
    end if;
  end if;

  -- `client_id` dan kedua salinan DITULIS ULANG dari baris sesi. Ini yang
  -- membuat "salinan keadaan saat itu" menjadi fakta, bukan janji.
  new.client_id := s.client_id;
  new.partner_id := s.partner_id;
  new.variant_id := s.variant_id;
  new.updated_at := now();

  return new;
end;
$$;

revoke execute on function public.guard_penilaian_sesi() from public, anon;

create trigger trg_guard_penilaian_sesi
  before insert or update on public.session_ratings
  for each row execute function public.guard_penilaian_sesi();

-- ===== POLICY =====
-- Klien: membaca & menulis MILIKNYA. Boleh memperbarui — orang berhak berubah
-- pikiran tentang bintangnya — tetapi tidak bisa menggandakan (UNIQUE di atas).
create policy "penilaian: klien baca miliknya" on public.session_ratings
  for select to authenticated
  using (client_id in (select c.id from public.clients c where c.user_id = auth.uid()));

create policy "penilaian: klien menilai" on public.session_ratings
  for insert to authenticated
  with check (client_id in (select c.id from public.clients c where c.user_id = auth.uid()));

create policy "penilaian: klien memperbarui miliknya" on public.session_ratings
  for update to authenticated
  using (client_id in (select c.id from public.clients c where c.user_id = auth.uid()))
  with check (client_id in (select c.id from public.clients c where c.user_id = auth.uid()));

-- Staf membaca semua. TIDAK ada policy DELETE untuk siapa pun: penilaian yang
-- bisa dihapus adalah penilaian yang bisa dibersihkan sebelum ditinjau.
create policy "penilaian: staf baca" on public.session_ratings
  for select to authenticated
  using (user_role() in ('admin', 'owner'));

revoke delete on public.session_ratings from authenticated;
