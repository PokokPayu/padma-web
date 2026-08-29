-- ============================================================================
-- GATING MATERI MENGHORMATI `materials.aktif`
-- ============================================================================
-- Sampai migration ini, dua policy baca klien —
--   "chapters: klien dgn sesi selesai" pada public.material_chapters
--   "video: klien dgn sesi selesai"    pada public.material_videos
-- — hanya menanyakan satu hal: adakah sesi berstatus `selesai` milik klien pada
-- layanan materi tersebut. Keduanya TIDAK PERNAH melihat `materials.aktif`.
--
-- Direproduksi sebagai klien sungguhan (anon key + JWT Ananda), bukan dibaca
-- dari policy:
--
--   update materials set aktif = false where id = <materi ebook terbuka>;
--   GET /rest/v1/material_chapters?material_id=eq.<materi>
--   -> HTTP 200, 3 bab lengkap beserta seluruh isinya
--   GET /rest/v1/material_videos?material_id=eq.<materi video>
--   -> HTTP 200, URL video apa adanya
--
-- Selama ini penyaringan `aktif` hidup HANYA di query aplikasi
-- (`ambilDaftarMateri`/`ambilMateriDetail` di src/lib/passport/data.ts), dan itu
-- cukup selama satu-satunya cara membaca materi adalah lewat halaman kami
-- sendiri. Ia berhenti cukup hari ini: Plan 3B melahirkan tombol "Nonaktifkan
-- materi" di /admin/materi. Tombol itu berjanji kepada admin klinik bahwa
-- materinya DITARIK — dan tanpa perbaikan ini yang benar-benar terjadi hanyalah
-- kartunya hilang dari UI, sementara isinya tetap dapat diambil siapa pun yang
-- pernah berhak, dengan satu permintaan REST. Tombol yang berbohong sejak hari
-- pertama lebih buruk daripada tidak ada tombol.
--
-- Yang SENGAJA tidak diubah:
--   * policy "materials: baca meta" — baris metadata materi tetap terbaca semua
--     pengguna login. Menutupnya akan mengulangi bug `partner_publik` yang sudah
--     dibayar mahal: nama yang hilang dari layar lain tanpa satu pun error.
--     Yang ditutup di sini adalah ISI-nya, bukan keberadaannya.
--   * policy "chapters: staf" & "video: staf" — admin/owner wajib TETAP bisa
--     membaca isi materi nonaktif; kalau tidak, materi yang ditarik tidak akan
--     pernah bisa diperbaiki lalu diterbitkan kembali dari panel mana pun.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260830120000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

-- ---------------------------------------------------------------------------
-- Bab e-book
-- ---------------------------------------------------------------------------
-- Nama policy dipertahankan PERSIS seperti yang hidup di pg_policies: policy
-- yang lahir dengan nama baru akan berdampingan dengan yang lama (RLS meng-OR
-- kan policy permisif), sehingga celahnya tetap terbuka tanpa satu pun error.
drop policy if exists "chapters: klien dgn sesi selesai" on public.material_chapters;
create policy "chapters: klien dgn sesi selesai" on public.material_chapters
  for select
  using (exists (
    select 1
      from public.materials m
      join public.sessions s
        on s.service_id = m.service_id and s.status = 'selesai'
      join public.clients c on c.id = s.client_id
     where m.id = material_id
       and m.aktif = true          -- <-- perbaikan
       and c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- URL video
-- ---------------------------------------------------------------------------
drop policy if exists "video: klien dgn sesi selesai" on public.material_videos;
create policy "video: klien dgn sesi selesai" on public.material_videos
  for select
  using (exists (
    select 1
      from public.materials m
      join public.sessions s
        on s.service_id = m.service_id and s.status = 'selesai'
      join public.clients c on c.id = s.client_id
     where m.id = material_id
       and m.aktif = true          -- <-- perbaikan
       and c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Invarian ditulis di skema
-- ---------------------------------------------------------------------------
-- Komentar tabel adalah tempat kedua orang berikutnya melihat sebelum menulis
-- ulang policy ini. Keberadaannya diuji regression test supaya tidak hilang
-- tanpa sadar.
comment on column public.materials.aktif is
  'Ketersediaan materi. `false` berarti materi DITARIK: policy baca klien pada '
  'material_chapters & material_videos ikut menutup isinya (sejak migration '
  'gating_materi_hormati_aktif), jadi menonaktifkan bukan sekadar '
  'menyembunyikan kartu di UI. Baris `materials` sendiri TETAP terbaca semua '
  'pengguna login — menutupnya akan mengulangi bug partner_publik. Staf tetap '
  'membaca isi materi nonaktif lewat policy "chapters: staf"/"video: staf", '
  'karena materi yang ditarik harus bisa diperbaiki lalu diterbitkan lagi.';
