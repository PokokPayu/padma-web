insert into phases (id, nama_sanskrit, nama, urutan) values
  ('prekonsepsi','Sankalpa','Prekonsepsi / Promil',1),
  ('kehamilan','Garbha','Kehamilan',2),
  ('nifas','Purnama','Nifas & Menyusui',3),
  ('menopause','Sandhya','Menopause',4),
  ('newborn','Shishu','Newborn Care',5);

-- Katalog DUMMY (keputusan #12) — client mengganti sendiri lewat panel saat live.
insert into services (id, phase_id, nama) values
  ('11111111-1111-1111-1111-111111111101','prekonsepsi','Sankalpa Fertility Massage'),
  ('11111111-1111-1111-1111-111111111102','prekonsepsi','PADMA Flow Yoga - Prekonsepsi'),
  ('11111111-1111-1111-1111-111111111103','prekonsepsi','Konsultasi Nutrisi Prekonsepsi'),
  ('11111111-1111-1111-1111-111111111104','kehamilan','Garbha Relief Massage'),
  ('11111111-1111-1111-1111-111111111105','kehamilan','Prenatal Gentle Yoga'),
  ('11111111-1111-1111-1111-111111111106','nifas','Lactation Hero'),
  ('11111111-1111-1111-1111-111111111107','nifas','Purnama Recovery Massage'),
  ('11111111-1111-1111-1111-111111111108','menopause','Sandhya Balance Care'),
  ('11111111-1111-1111-1111-111111111109','newborn','Shishu Parent Touch'),
  ('11111111-1111-1111-1111-111111111110','newborn','Baby Massage Class');

insert into service_rates (service_id, harga_klien, honor_mitra) values
  ('11111111-1111-1111-1111-111111111101',425000,190000),
  ('11111111-1111-1111-1111-111111111102',250000,100000),
  ('11111111-1111-1111-1111-111111111103',300000,130000),
  ('11111111-1111-1111-1111-111111111104',350000,150000),
  ('11111111-1111-1111-1111-111111111105',275000,110000),
  ('11111111-1111-1111-1111-111111111106',450000,200000),
  ('11111111-1111-1111-1111-111111111107',400000,175000),
  ('11111111-1111-1111-1111-111111111108',375000,160000),
  ('11111111-1111-1111-1111-111111111109',400000,180000),
  ('11111111-1111-1111-1111-111111111110',300000,125000);

insert into packages (id, service_id, nama, jumlah_sesi) values
  ('22222222-2222-2222-2222-222222222201','11111111-1111-1111-1111-111111111101','Sankalpa Prima',8);

insert into partners (id, nama, no_hp) values
  ('33333333-3333-3333-3333-333333333301','Bidan Sri Wahyuni','0811-0000-0001'),
  ('33333333-3333-3333-3333-333333333302','Bidan Dewi Lestari','0811-0000-0002');

insert into app_settings (key, value) values ('nomor_wa','6287778400200');

-- ===== MATERI DUMMY (keputusan #12 & #13) =====
-- Dua layanan sengaja dipakai untuk menguji gating materi:
--   * 1101 Sankalpa Fertility Massage — Ananda punya sesi `selesai` (TERBUKA)
--   * 1106 Lactation Hero            — Ananda tidak punya sesi apa pun (TERKUNCI)
insert into materials (id, judul, tipe, deskripsi) values
  ('77777777-7777-7777-7777-777777777701',
   'Pijat Mandiri Prekonsepsi','video','Panduan video pijat perut mandiri 12 menit.'),
  ('77777777-7777-7777-7777-777777777702',
   'Panduan Siklus Subur','ebook','E-book bergambar tentang membaca siklus.'),
  ('77777777-7777-7777-7777-777777777703',
   'Teknik Pelekatan Menyusui','video','Panduan video pelekatan & posisi menyusui.'),
  ('77777777-7777-7777-7777-777777777704',
   'Panduan ASI Perah','ebook','E-book penyimpanan & penanganan ASI perah.');

-- Materi <-> layanan. Sampai Task 11 ini hidup di kolom tunggal
-- `materials.service_id`; kolom itu sudah dihapus (migration
-- materi_hapus_bab_teks), jadi tautannya ditulis LANGSUNG ke sini alih-alih
-- disalin dari kolom yang sudah tidak ada. Empat materi seed masing-masing
-- menempel tepat satu layanan, persis seperti sebelumnya — materi BOLEH
-- punya nol layanan sejak migration materi_banyak_layanan, tapi tidak ada
-- alasan demo ini memulainya kosong.
insert into material_services (material_id, service_id) values
  ('77777777-7777-7777-7777-777777777701','11111111-1111-1111-1111-111111111101'),
  ('77777777-7777-7777-7777-777777777702','11111111-1111-1111-1111-111111111101'),
  ('77777777-7777-7777-7777-777777777703','11111111-1111-1111-1111-111111111106'),
  ('77777777-7777-7777-7777-777777777704','11111111-1111-1111-1111-111111111106');

-- URL video hidup di tabel tergating `material_videos`, BUKAN di `materials`
-- (lihat migration gate_material_video).
insert into material_videos (material_id, url) values
  ('77777777-7777-7777-7777-777777777701','https://vimeo.com/padma-sankalpa-001'),
  ('77777777-7777-7777-7777-777777777703','https://vimeo.com/RAHASIA-123');

-- Halaman e-book (Task 10 — reader kini gambar hasil rasterisasi; bab teks
-- sudah dibongkar total di Task 11, material_chapters tidak ada lagi). Hanya
-- materi TERBUKA (…702) yang diberi baris `material_pages`: tanpa
-- ini reader-nya akan selalu jatuh ke keadaan "berhak tapi isi belum
-- diunggah" (M10, keadaan 2) walau Ananda sudah menyelesaikan layanannya —
-- padahal seed ini justru dipakai untuk membuktikan keadaan 3 ("berhak DAN
-- ada isinya"). Materi TERKUNCI (…704) sengaja dibiarkan tanpa baris: Ananda
-- tidak berhak sama sekali, jadi RPC `berhak_isi_materi` sudah menutupnya di
-- keadaan 1 sebelum jumlah halamannya pernah relevan.
-- `objek` di sini MEMANG menunjuk berkas sungguhan di bucket privat
-- `materi-halaman` — bukan path yang hanya kebetulan berbentuk benar. SQL
-- murni tidak bisa menaruh BYTE gambar ke storage (itu jalur Storage API),
-- jadi ketiga objeknya diunggah terpisah oleh `unggahHalamanMateriDemo()` di
-- scripts/seed-users.ts, sesudah baris ini ada (satu-satunya urutan yang
-- mungkin: RLS `berhak_isi_materi` pada `material_pages` butuh baris DB-nya
-- lebih dulu). Ini bukan kerapian kosmetik: sebelum diperbaiki, ketiga baris
-- ini menunjuk objek yang tidak pernah diunggah, dan membuka e-book ini di
-- dev menampilkan tiga `<img>` yang semuanya 404 — reader yang tampak rusak,
-- persis kelas masalah "layar menjanjikan sesuatu yang tidak benar" yang
-- dirapikan berulang kali di rencana ini. Jumlah halaman & dimensi di sini
-- WAJIB SAMA PERSIS dengan `HALAMAN_DEMO`/`LEBAR_DEMO`/`TINGGI_DEMO` di
-- scripts/seed-users.ts.
insert into material_pages (material_id, halaman, objek, lebar, tinggi) values
  ('77777777-7777-7777-7777-777777777702',1,'77777777-7777-7777-7777-777777777702/0001.webp',1600,2263),
  ('77777777-7777-7777-7777-777777777702',2,'77777777-7777-7777-7777-777777777702/0002.webp',1600,2263),
  ('77777777-7777-7777-7777-777777777702',3,'77777777-7777-7777-7777-777777777702/0003.webp',1600,2263);

-- Materi TERKUNCI (…704) MEMANG dapat baris juga — beda dari draf pertama
-- migration Task 10, dan sengaja. "Aktif" tanpa satu pun halaman adalah
-- persis kelas bug yang rencana ini bongkar berulang kali: kartu yang
-- menjanjikan isi padahal kosong. Objeknya BOLEH fiktif (tidak diunggah
-- `unggahHalamanMateriDemo()`) karena — TIDAK SEPERTI …702 — materi ini
-- terbukti tidak pernah bisa dibuka siapa pun di data demo: Ananda tidak
-- pernah menjalani Lactation Hero, jadi `berhak_isi_materi` menutupnya di
-- keadaan 1 SEBELUM baris ini pernah dijawab ke klien mana pun. Tidak ada
-- `<img>` yang bisa 404 kalau rute halamannya tidak pernah tercapai.
insert into material_pages (material_id, halaman, objek, lebar, tinggi) values
  ('77777777-7777-7777-7777-777777777704',1,'77777777-7777-7777-7777-777777777704/0001.webp',1600,2263);
