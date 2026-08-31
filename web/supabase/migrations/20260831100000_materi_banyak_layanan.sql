-- supabase/migrations/20260831100000_materi_banyak_layanan.sql
-- ============================================================================
-- MATERI BOLEH MILIK BANYAK LAYANAN, DAN BOLEH TIDAK PUNYA SATU PUN
-- ============================================================================
-- `materials.service_id` mengunci satu materi ke satu layanan. Selama isi ebook
-- berupa teks, menyalin materi untuk layanan kedua murah. Sejak isinya menjadi
-- PDF yang dirasterisasi, menyalin berarti merasterisasi & menyimpan dua set
-- gambar halaman untuk isi yang sama persis.
--
-- Kolom `materials.service_id` SENGAJA belum dihapus di sini: aplikasi masih
-- membacanya, dan menghapusnya sekarang akan mematahkan panel admin sebelum
-- penggantinya ada. Penghapusannya menjadi migration tersendiri.

create table public.material_services (
  material_id uuid not null references public.materials(id) on delete cascade,
  service_id  uuid not null references public.services(id)  on delete cascade,
  primary key (material_id, service_id)
);

comment on table public.material_services is
  'Materi <-> Layanan, banyak-ke-banyak dan BOLEH NOL BARIS. Materi tanpa baris '
  'di sini tidak pernah terbuka otomatis; ia hanya terbuka lewat '
  'material_assignments. Panel admin wajib menandai keadaan itu — materi yang '
  'terkunci diam-diam tidak memunculkan gejala apa pun.';

-- Migrasi data: setiap materi lama menjadi tepat satu baris.
insert into public.material_services (material_id, service_id)
select id, service_id from public.materials
on conflict (material_id, service_id) do nothing;

-- Tabel baru lahir TANPA RLS dan `authenticated` mendapat hak penuh secara
-- default. Keduanya dicabut eksplisit.
alter table public.material_services enable row level security;
revoke all on public.material_services from anon, authenticated;
grant select on public.material_services to authenticated;

-- Dibaca setiap pengguna login, PERSIS seperti materials.service_id yang
-- digantikannya. Tidak ada perluasan keterbukaan di sini.
create policy "materi-layanan: baca semua pengguna login"
  on public.material_services for select
  to authenticated
  using (auth.uid() is not null);

create policy "materi-layanan: staf kelola"
  on public.material_services for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- ---------------------------------------------------------------------------
-- Gating dialihkan ke tabel penghubung
-- ---------------------------------------------------------------------------
-- Nama policy dipertahankan PERSIS. Policy yang lahir dengan nama baru akan
-- berdampingan dengan yang lama (RLS meng-OR policy permisif), sehingga jalur
-- lama tetap terbuka tanpa satu pun error.
drop policy if exists "chapters: klien dgn sesi selesai" on public.material_chapters;
create policy "chapters: klien dgn sesi selesai" on public.material_chapters
  for select
  to authenticated
  using (exists (
    select 1
      from public.materials m
      join public.material_services ms on ms.material_id = m.id
      join public.sessions s
        on s.service_id = ms.service_id and s.status = 'selesai'
      join public.clients c on c.id = s.client_id
     where m.id = material_chapters.material_id
       and m.aktif = true
       and c.user_id = auth.uid()
  ));

drop policy if exists "video: klien dgn sesi selesai" on public.material_videos;
create policy "video: klien dgn sesi selesai" on public.material_videos
  for select
  to authenticated
  using (exists (
    select 1
      from public.materials m
      join public.material_services ms on ms.material_id = m.id
      join public.sessions s
        on s.service_id = ms.service_id and s.status = 'selesai'
      join public.clients c on c.id = s.client_id
     where m.id = material_videos.material_id
       and m.aktif = true
       and c.user_id = auth.uid()
  ));
