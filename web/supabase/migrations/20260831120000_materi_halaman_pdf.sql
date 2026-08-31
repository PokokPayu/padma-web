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
-- Hak tulis diberikan karena RPC di bawah `security invoker`: yang memutuskan
-- boleh-tidaknya adalah policy staf, bukan hak tabel ini.
grant select, insert, update, delete on public.material_pages to authenticated;

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
-- Pengganti halaman: satu transaksi, radius terikat parameter
-- ---------------------------------------------------------------------------
-- Repo ini pernah kehilangan SELURUH bab materi karena satu filter tautologis
-- (`?urutan=gte.0`), dan pelajarannya adalah RPC. Fungsi ini menghapus banyak
-- baris sekaligus, tetapi radiusnya terikat parameter WAJIB `p_material_id` —
-- tidak ada filter yang bisa dibuat tautologis dari luar.
create or replace function public.ganti_halaman_materi(
  p_material_id uuid,
  p_halaman     jsonb
) returns int
language plpgsql security invoker set search_path = public as $$
declare
  n int;
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
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

-- `security invoker` disengaja: hak tulis tetap diputuskan policy staf, bukan
-- diberikan oleh fungsinya. `security definer` di sini akan membuat setiap klien
-- login bisa mengganti halaman materi mana pun.
