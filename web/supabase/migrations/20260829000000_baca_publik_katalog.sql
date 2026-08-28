-- Landing publik harus bisa menampilkan katalog layanan tanpa login.
-- Policy lama `using (auth.uid() is not null)` membuat pengunjung anonim
-- menerima 0 baris TANPA error — kegagalan senyap yang membuat landing
-- tampil kosong. Di sini kita tambahkan policy baca publik yang EKSPLISIT.
--
-- Batas tegas: hanya katalog pemasaran. Tidak ada data pasien, tidak ada
-- angka uang. `service_rates` TIDAK disentuh — tetap owner-only.
--
-- Hak tabelnya sudah disiapkan migration cabut_grant_anon_berlebih
-- (`grant select on phases/services/packages to anon`, tanpa hak tulis),
-- jadi policy ini hanya membuka BARIS mana yang boleh dibaca — bukan
-- memperluas operasi yang boleh dilakukan anon.
--
-- Sengaja `to anon` (bukan `to public`): policy yang menyasar `public` akan
-- ikut dievaluasi peran authenticated dan — bila kelak memanggil fungsi —
-- menabrak invarian test hak-default-sequence-fungsi.

create policy "phases: baca publik" on phases
  for select to anon using (true);

-- `services`/`packages` hanya baris aktif: katalog yang sudah dinonaktifkan
-- admin tidak boleh muncul lagi di landing.
create policy "services: baca publik" on services
  for select to anon using (aktif = true);

create policy "packages: baca publik" on packages
  for select to anon using (aktif = true);
