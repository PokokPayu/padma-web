-- supabase/migrations/20260831120000_materi_halaman_pdf.sql
-- ============================================================================
-- HALAMAN E-BOOK SEBAGAI GAMBAR
-- ============================================================================

create table public.material_pages (
  material_id uuid not null references public.materials(id) on delete cascade,
  halaman     int  not null check (halaman >= 1),
  objek       text not null,
  lebar       int  not null check (lebar  > 0),
  tinggi      int  not null check (tinggi > 0),
  primary key (material_id, halaman)
);

-- Menyimpan KUNCI OBJEK, bukan URL. Baris ini terbaca klien lewat RLS (ia perlu
-- tahu jumlah halaman & dimensinya untuk menata layar tanpa melompat). Bila
-- yang tersimpan URL bertanda tangan, satu baris yang terbaca langsung menjadi
-- tautan siap sebar — kelas bug yang persis pernah terjadi lewat
-- materials.video_url.
comment on column public.material_pages.objek is
  'Kunci objek di bucket privat `materi-halaman`. BUKAN URL, dan tidak boleh '
  'pernah menjadi URL: baris ini terbaca klien, sementara bucket-nya tidak '
  'memberi hak apa pun kepada `authenticated`.';

alter table public.material_pages enable row level security;
revoke all on public.material_pages from anon, authenticated;
-- HANYA select. Draft pertama migration ini juga memberi insert/update/delete
-- di sini, karena RPC di bawah sempat `security invoker` (hak tulis diputuskan
-- policy staf, bukan hak tabel). Itu ternyata membuka radius: kelas bug
-- `?urutan=gte.0` yang dulu menyapu seluruh bab `material_chapters` berlaku
-- IDENTIK di sini, dan diprobe nyata sebagai admin sungguhan sebelum ditutup —
-- `DELETE material_pages?halaman=gte.0` menyapu SELURUH halaman SELURUH
-- materi dalam satu permintaan, karena policy "halaman: staf kelola" di bawah
-- tidak menyempit ke satu materi. Ditutup dengan pola yang sama seperti
-- chapters/videos: hak tabel tulis dicabut total dari `authenticated`, dan
-- satu-satunya jalur tulis kini `ganti_halaman_materi` (`security definer`,
-- radius terkunci parameter — lihat komentarnya di bawah).
--
-- Policy "halaman: staf kelola" di bawah SENGAJA tetap `for all` dengan
-- `with check` tulis, bukan diperketat jadi `for select`: policy yang
-- mengizinkan lebih dari hak tabel tidak berbahaya (Postgres tetap menolak di
-- lapisan hak tabel duluan), dan mempersempitnya sekarang hanya akan menjadi
-- pekerjaan yang harus dibalik lagi bila radiusnya nanti benar-benar dipagari
-- per-materi alih-alih lewat pencabutan total ini.
grant select on public.material_pages to authenticated;

-- Gating IDENTIK dengan material_chapters, dan memakai FUNGSI YANG SAMA
-- (`berhak_isi_materi`, lahir di migration penugasan). Menyalin ekspresinya ke
-- sini berarti dua tempat yang harus ditemukan dan disepakatkan setiap kali
-- aturan hak berubah — dan yang satu akan tertinggal.
--
-- `to authenticated` wajib ada di KEDUA policy di bawah: tanpanya sebuah
-- policy lahir `to public`, yang mencakup `anon`, dan
-- tests/hak-default-sequence-fungsi.test.ts menangkap persis ini untuk policy
-- manapun yang memanggil `user_role()` (di sini: "halaman: staf kelola").
-- Pola ini dipertahankan PERSIS dari setiap policy di migration
-- materi_banyak_layanan & materi_penugasan.
create policy "halaman: klien berhak" on public.material_pages
  for select
  to authenticated
  using (public.berhak_isi_materi(material_id));

-- `for all` sudah mencakup select; policy select staf tersendiri hanya menambah
-- satu tempat lagi yang harus ditemukan saat mengaudit.
create policy "halaman: staf kelola" on public.material_pages
  for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- ---------------------------------------------------------------------------
-- Bucket privat
-- ---------------------------------------------------------------------------
-- SENGAJA tanpa satu pun policy pada storage.objects. Tanpa policy, `anon` dan
-- `authenticated` tidak bisa menyentuh objeknya sama sekali — hanya service
-- role, dari route handler kita, sesudah RLS memutuskan hak. Ini pagar pertama
-- dan yang paling murah: path yang bocor tetap tidak bisa ditukar jadi byte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materi-halaman', 'materi-halaman', false, 5242880,
        array['image/webp','image/jpeg'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Pengganti halaman: SATU-SATUNYA jalur tulis, radius terikat parameter
-- ---------------------------------------------------------------------------
-- Repo ini pernah kehilangan SELURUH bab materi karena satu filter tautologis
-- (`?urutan=gte.0`), dan pelajarannya adalah RPC. Fungsi ini menghapus banyak
-- baris sekaligus, tetapi radiusnya terikat parameter WAJIB `p_material_id` —
-- tidak ada filter yang bisa dibuat tautologis dari luar.
--
-- `security definer`, BUKAN invoker seperti draft pertama migration ini.
-- Hak tabel insert/update/delete sudah dicabut TOTAL dari `authenticated` di
-- atas, jadi fungsi inilah yang HARUS menembus RLS supaya bisa menulis sama
-- sekali — dan karena ia menembus RLS, otorisasinya WAJIB diperiksa di DALAM
-- fungsi (lihat guard `user_role()` di bawah), bukan diserahkan ke policy.
--
-- `security definer` DI SINI vs `security invoker` pada
-- `paksa_aktor_penugasan()` (trigger di migration materi_penugasan) TAMPAK
-- bertentangan. BUKAN kekeliruan yang perlu "diseragamkan" — keduanya benar
-- untuk ALASAN YANG BERLAWANAN, dan menyamakannya akan merusak salah satunya:
--   * DI SINI, definer dipilih supaya fungsi ini bisa menjadi SATU-SATUNYA
--     jalur tulis dengan radius yang benar-benar terkunci parameter. Tidak
--     ada `current_user` yang dibaca fungsi ini sama sekali — satu-satunya
--     gerbang wewenangnya adalah `user_role()` (baris JWT klaim request),
--     yang tidak terpengaruh security definer.
--   * DI `paksa_aktor_penugasan()`, invoker dipilih justru karena fungsi itu
--     WAJIB membaca `current_user` yang SEBENARNYA (peran pemanggil) untuk
--     membedakan permintaan API dari service role/seed. `security definer`
--     di sana akan membuat `current_user` selalu `postgres`, mematikan
--     pembedaan itu — persis bug yang diperbaiki commit
--     "paksa_aktor_penugasan tidak boleh security definer".
-- Singkatnya: pilihannya bergantung pada APA yang dibutuhkan fungsinya dari
-- RLS/`current_user`, bukan pada preferensi gaya penulisan yang seharusnya
-- konsisten di semua fungsi.
create or replace function public.ganti_halaman_materi(
  p_material_id uuid,
  p_halaman     jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;

  -- `security definer` MENEMBUS RLS, jadi otorisasi wajib diperiksa di sini —
  -- tidak ada policy yang akan menolak apa pun di dalam fungsi ini.
  --
  -- Diperiksa HANYA bila ada sesi pengguna sungguhan (`auth.uid()` terisi).
  -- Tanpa syarat itu, service role ikut tertolak: `user_role()` adalah
  -- `coalesce((select role from profiles where id = auth.uid()), 'klien')`
  -- (migration rls_policies), dan service role tidak punya baris profil sama
  -- sekali — auth.uid()-nya NULL — sehingga ia jatuh ke default 'klien' dan
  -- akan tertolak PERSIS seperti klien sungguhan. Itu memutus arsitektur
  -- brief sendiri (bucket tanpa policy storage.objects, "hanya service role
  -- dari route handler kita"), dan mematahkan kedua tes brief yang memanggil
  -- RPC ini lewat `svc()` — DIBUKTIKAN LANGSUNG saat menulis fix ini: tanpa
  -- syarat `auth.uid() is not null`, panggilan service role gagal dengan
  -- `{"code":"P0001","message":"hanya admin/owner boleh mengganti halaman
  -- materi"}`. Pola "auth.uid() is null -> perlakukan sebagai service_role"
  -- BUKAN karangan baru — sudah dipakai identik di `catat_status_bayar()`
  -- (migration tutup_celah_red_team) untuk kebutuhan yang sama.
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh mengganti halaman materi';
  end if;

  delete from public.material_pages where material_id = p_material_id;

  insert into public.material_pages (material_id, halaman, objek, lebar, tinggi)
  select p_material_id,
         (x->>'halaman')::int,
         x->>'objek',
         (x->>'lebar')::int,
         (x->>'tinggi')::int
    from jsonb_array_elements(p_halaman) as x;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ganti_halaman_materi(uuid, jsonb) from public, anon;
grant execute on function public.ganti_halaman_materi(uuid, jsonb) to authenticated;
