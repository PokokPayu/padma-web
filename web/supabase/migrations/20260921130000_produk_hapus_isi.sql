-- ============================================================================
-- HAPUS ISI PRODUK — RPC berparameter tunggal, bukan GRANT DELETE
-- ============================================================================
-- `alter default privileges in schema public revoke delete on tables from
-- authenticated` (migration `cabut_hak_hapus_berlebih`, 20260829190000)
-- berlaku untuk SETIAP tabel baru, termasuk dua yang dibuat migration
-- `produk_digital` (20260921100000) di atas. Itu memang niatnya, tertulis
-- tegas di migration itu sendiri: tabel baru yang BUTUH DELETE staf harus
-- menyatakan diri secara eksplisit, dan lupa melakukannya gagal BERISIK
-- (42501) alih-alih diam.
--
-- Task 6 (`src/app/admin/produk/[id]/unggah.ts`) menulis EMPAT titik DELETE
-- atas dua tabel ini, lewat sesi staf (`createServerSupabase()`):
--
--   1. `terbitkanUrlUnggahHalamanProduk` mengosongkan `digital_product_pages`
--      SEBELUM menerbitkan URL unggah halaman baru — langkah PERTAMA saat
--      mengunggah/mengganti PDF produk apa pun.
--   2. `lepasIsiProduk` mengosongkan `digital_product_files` saat melepas
--      video.
--   3. `lepasIsiProduk` mengosongkan `digital_product_pages` saat melepas
--      isi produk PDF.
--   4. `lepasIsiProduk` mengosongkan `digital_product_files` saat melepas
--      berkas PDF utuh.
--
-- Tanpa hak tulis yang benar, KEEMPATNYA gagal 42501 "permission denied for
-- table" — dibuktikan EMPIRIS lewat probe langsung terhadap sesi admin
-- sungguhan (anon key + JWT admin, bukan service role), bukan diasumsikan
-- dari RLS semata. Konsekuensinya sebelum migration ini: PDF produk bahkan
-- TIDAK BISA diunggah ulang sama sekali — langkah pertamanya sendiri
-- (mengosongkan baris halaman lama) sudah gagal, dan "Lepas isi" gagal
-- untuk KEDUA jenis produk.
--
-- ===========================================================================
-- KENAPA JAWABANNYA BUKAN `grant delete ... to authenticated`
-- ===========================================================================
-- Draf pertama migration ini justru menulis GRANT itu. SALAH, dan repo ini
-- sudah membayar pelajaran yang sama persis dua kali sebelumnya — lihat
-- `20260831120000_materi_halaman_pdf.sql` baris ~28-45 (untuk
-- `material_pages`) dan `20260829200000_batas_radius_hapus_isi_materi.sql`
-- (untuk `material_chapters`/`material_videos`).
--
-- Intinya: FILTER PostgREST ADALAH PILIHAN PEMANGGIL, BUKAN PEMBATAS BARIS.
-- Policy "halaman produk: staf" / "berkas produk: staf" (migration
-- `produk_digital`) keduanya `for all ... using (user_role() in
-- ('admin','owner'))` TANPA menyempit ke SATU produk — itu memang
-- keputusan yang benar untuk SELECT/INSERT/UPDATE (staf memang berhak atas
-- SELURUH katalog), tapi kalau DELETE ikut diberi hak tabel yang sama,
-- permintaan admin sungguhan:
--
--   DELETE /rest/v1/digital_product_pages?halaman=gte.0
--
-- menyapu SELURUH halaman SELURUH produk dalam satu panggilan — persis
-- kelas bug `?urutan=gte.0` yang dulu menyapu seluruh bab `material_chapters`,
-- dan yang membuat migration materi di atas mencabut hak tabelnya total dan
-- memindahkan satu-satunya jalur tulis ke fungsi `security definer`
-- berparameter WAJIB. Jawabannya di sini sama persis: RPC yang radiusnya
-- terkunci PARAMETER, bukan GRANT yang radiusnya terkunci NIAT BAIK
-- pemanggil.
--
-- ===========================================================================
-- DUA POLA BERBEDA, DIPILIH SESUAI BENTUK TABELNYA (persis materi)
-- ===========================================================================
-- `digital_product_pages` mengikuti pola `material_pages`: SELURUH isinya
-- selalu diganti sebagai SATU SET (rasterisasi ulang PDF di peramban lalu
-- unggah ulang semua halaman) — tidak pernah disunting satu halaman.
-- Karena itu SELURUH hak tabel (bukan cuma DELETE) dicabut, SELECT
-- dikembalikan (staf & pemilik entitlement tetap perlu membaca baris ini
-- lewat RLS masing-masing), dan satu-satunya jalur tulis adalah
-- `ganti_halaman_produk` — persis `ganti_halaman_materi`.
--
-- `digital_product_files` mengikuti pola `material_videos`: satu baris per
-- produk (`unique (product_id)`), disunting lewat UPSERT yang tetap sah dan
-- tetap terbuka (`catatVideoProduk`/`catatPdfProduk`), dan HANYA verba
-- DELETE yang dicabut — radiusnya sudah sempit (`product_id` unik), tapi
-- filter tautologis tetap bisa menyapu SELURUH produk lain sekaligus
-- (`DELETE digital_product_files?product_id=neq.<x>`). Jalur lepasnya
-- adalah `lepas_berkas_produk`, persis `lepas_video_materi`.
--
-- ===========================================================================
-- NILAI KEMBALI RPC: nama objek, BUKAN dibaca terpisah sesudahnya
-- ===========================================================================
-- Kedua fungsi mengembalikan `objek` baris yang DIHAPUS lewat `returning`,
-- bukan sekadar jumlah baris. Pemanggilnya (`unggah.ts`) BUTUH nama objek
-- storage untuk membersihkannya, dan membaca baris itu lewat SELECT
-- terpisah SEBELUM memanggil RPC (draf awal Task 6 melakukan ini) adalah
-- balapan dengan dirinya sendiri: antara SELECT dan DELETE, baris itu bisa
-- berubah. Mengembalikannya langsung dari `delete ... returning` di dalam
-- RPC yang sama menutup celah itu — satu pernyataan atomik, bukan dua.
create or replace function public.ganti_halaman_produk(
  p_product_id uuid,
  p_halaman    jsonb
) returns table(objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_product_id is null then
    raise exception 'p_product_id wajib diisi';
  end if;

  -- `security definer` MENEMBUS RLS, jadi otorisasi wajib diperiksa di sini —
  -- tidak ada policy yang akan menolak apa pun di dalam fungsi ini.
  --
  -- Diperiksa HANYA bila ada sesi pengguna sungguhan (`auth.uid()` terisi).
  -- Tanpa syarat itu, service role ikut tertolak: `user_role()` adalah
  -- `coalesce((select role from profiles where id = auth.uid()), 'klien')`,
  -- dan service role tidak punya baris profil sama sekali — auth.uid()-nya
  -- NULL — sehingga ia jatuh ke default 'klien' dan tertolak PERSIS seperti
  -- klien sungguhan. Pola ini disalin PERSIS dari `ganti_halaman_materi`
  -- (`materi_halaman_pdf.sql`), yang menuliskan alasan ini panjang lebar
  -- sesudah dibuktikan gagal empiris tanpa syarat ini.
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh mengganti halaman produk';
  end if;

  -- `RETURN QUERY` TIDAK menghentikan eksekusi fungsi (berbeda dari `RETURN`
  -- biasa) — ia menumpuk baris ke hasil SETOF dan lanjut ke pernyataan
  -- berikutnya. Baris yang dihapus di sinilah yang dibaca `unggah.ts` untuk
  -- membersihkan objek storage lamanya.
  return query
    delete from public.digital_product_pages
     where product_id = p_product_id
    returning digital_product_pages.objek;

  insert into public.digital_product_pages (product_id, halaman, objek)
  select p_product_id,
         (x->>'halaman')::int,
         x->>'objek'
    from jsonb_array_elements(p_halaman) as x;
end $$;

comment on function public.ganti_halaman_produk(uuid, jsonb) is
  'Satu-satunya jalur tulis digital_product_pages. Radius terkunci '
  'p_product_id — mengosongkan lalu mengisi ulang SATU produk, tidak pernah '
  'lebih. Memulangkan objek baris yang dihapus supaya pemanggil bisa '
  'membersihkan storage tanpa SELECT terpisah yang balapan dengan DELETE.';

-- `digital_product_pages`: SELURUH hak tabel dicabut (bukan cuma DELETE) —
-- isinya selalu diganti sebagai satu set, tidak pernah disunting baris per
-- baris, jadi tidak ada alasan produk mana pun butuh INSERT/UPDATE/DELETE
-- langsung. SELECT dikembalikan: policy "halaman produk: staf" dan "halaman
-- produk: pemilik baca" (migration `produk_entitlement`) masih perlu
-- dievaluasi untuk staf DAN pembeli.
revoke all on public.digital_product_pages from authenticated;
grant select on public.digital_product_pages to authenticated;

-- `digital_product_files`: hanya DELETE dicabut. INSERT/UPDATE (lewat
-- `.upsert()` di `catatVideoProduk`/`catatPdfProduk`) TETAP jalur sah yang
-- terbuka — satu baris per produk sudah aman disunting langsung, dan
-- `revoke all` di sini hanya akan memaksa upsert juga pindah ke RPC tanpa
-- menutup radius tambahan apa pun.
revoke delete on public.digital_product_files from authenticated;

create or replace function public.lepas_berkas_produk(p_product_id uuid)
returns table(objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_product_id is null then
    raise exception 'p_product_id wajib diisi';
  end if;

  -- Pola guard identik `ganti_halaman_produk` di atas — lihat komentarnya.
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh melepas berkas produk';
  end if;

  return query
    delete from public.digital_product_files
     where product_id = p_product_id
    returning digital_product_files.objek;
end $$;

comment on function public.lepas_berkas_produk(uuid) is
  'Satu-satunya jalur DELETE digital_product_files. Radius terkunci '
  'p_product_id (kolom UNIQUE — paling banyak satu baris). Memulangkan '
  'objek baris yang dihapus, sama alasannya dengan ganti_halaman_produk.';

-- Aturan [F] migration `fail_closed_sequence_fungsi`: setiap fungsi/RPC baru
-- menyatakan haknya EKSPLISIT. PostgREST mengekspos setiap fungsi `public`
-- sebagai RPC, dan anon key tertanam di bundel peramban.
revoke execute on function public.ganti_halaman_produk(uuid, jsonb) from public, anon;
revoke execute on function public.lepas_berkas_produk(uuid) from public, anon;
grant  execute on function public.ganti_halaman_produk(uuid, jsonb) to authenticated;
grant  execute on function public.lepas_berkas_produk(uuid) to authenticated;

-- ===========================================================================
-- INVARIAN DITULIS DI SKEMA
-- ===========================================================================
-- Komentar tabel adalah tempat kedua orang berikutnya melihat sebelum
-- menulis `grant delete` lagi.
comment on table public.digital_product_pages is
  'Halaman PDF produk terasterisasi. SELURUH hak tabel dicabut dari '
  'authenticated — filter PostgREST adalah pilihan pemanggil, bukan '
  'pembatas baris, sehingga satu permintaan tautologis bisa menyapu halaman '
  'SELURUH produk sekaligus. Satu-satunya jalur tulis: '
  'public.ganti_halaman_produk(p_product_id, p_halaman). Penghapusan massal '
  'hanya lewat service role.';

comment on table public.digital_product_files is
  'Berkas isi produk (video ATAU PDF utuh), satu baris per produk '
  '(product_id unik). INSERT/UPDATE lewat upsert TETAP terbuka untuk staf; '
  'verba DELETE dicabut dari peran API karena filter tautologis bisa '
  'melepas berkas SELURUH produk sekaligus. Pelepasan satu berkas lewat '
  'public.lepas_berkas_produk(p_product_id). Penghapusan massal hanya lewat '
  'service role.';
