-- ============================================================================
-- GATING URL VIDEO MATERI — menutup kebocoran materi sebelum layanan berjalan
-- ============================================================================
-- Temuan: policy "materials: baca meta" berbunyi `using (auth.uid() is not null)`.
-- RLS bekerja per-BARIS, bukan per-KOLOM, jadi policy itu membuka SELURUH kolom
-- baris materi — termasuk `materials.video_url` — untuk setiap user yang login.
-- Akibatnya klien mana pun bisa `select judul, video_url from materials` dan
-- memperoleh URL video layanan yang BELUM PERNAH ia jalani. Isi bab e-book
-- sudah tergating benar lewat tabel terpisah `material_chapters`, sehingga
-- proteksinya asimetris: e-book aman, video bocor. Ini melanggar spec
-- keputusan #13 dan bagian 6 ("materi tidak bocor sebelum layanan berjalan").
--
-- Kenapa BUKAN sekadar mencabut GRANT kolom `video_url`:
-- `revoke select (video_url) ... from authenticated` membuat `select *` (yang
-- dipakai daftar materi di UI & PostgREST) GAGAL dengan 42501 permission
-- denied, bukan diam-diam menyembunyikan kolomnya. Daftar materi ikut mati.
--
-- Solusi: ikuti pola `material_chapters` yang sudah terbukti benar — pindahkan
-- URL video ke tabel tersendiri `material_videos` yang tergating dengan syarat
-- yang sama (ada sesi `selesai` milik klien pada layanan materi tersebut).
-- Baris `materials` tetap terbaca semua user login sehingga UI tetap bisa
-- menampilkan kartu materi dalam keadaan TERKUNCI (judul/tipe/deskripsi).

-- ===== TABEL BARU: URL video terpisah & tergating =====
create table public.material_videos (
  material_id uuid primary key references public.materials(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

comment on table public.material_videos is
  'URL video materi (penyedia terproteksi: Vimeo domain-locked / Cloudflare '
  'Stream). Dipisah dari `materials` karena RLS bekerja per-baris: menyimpan '
  'URL di `materials` membuatnya ikut terbaca oleh policy meta. Gating sama '
  'dengan material_chapters — butuh sesi `selesai` milik klien.';

-- ===== MIGRASI DATA dari kolom lama =====
insert into public.material_videos (material_id, url)
select id, video_url
from public.materials
where video_url is not null and video_url <> ''
on conflict (material_id) do nothing;

-- Kolom lama dibuang total: selama masih ada, ia tetap ikut terbaca policy
-- "materials: baca meta" dan celahnya bisa kambuh lewat data baru.
alter table public.materials drop column video_url;

-- ===== RLS: pola identik dengan material_chapters =====
alter table public.material_videos enable row level security;

create policy "video: staf" on public.material_videos for all
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

create policy "video: klien dgn sesi selesai" on public.material_videos for select
  using (exists (
    select 1
    from public.materials m
    join public.sessions s on s.service_id = m.service_id and s.status = 'selesai'
    join public.clients c on c.id = s.client_id
    where m.id = material_id and c.user_id = auth.uid()
  ));

-- Pertahanan berlapis: anon tidak punya urusan dengan tabel ini sama sekali,
-- jadi cabut hak tabelnya dan jangan bergantung pada RLS semata.
revoke all on public.material_videos from anon;

-- Hak tabel 'authenticated' sengaja DIBIARKAN utuh: admin & owner juga login
-- sebagai peran itu, jadi mencabut insert/update/delete di level SQL akan ikut
-- melumpuhkan pengelolaan materi oleh staf. Pembatas klien adalah RLS —
-- policy "video: staf" (with check) menolak tulisan dari klien.
