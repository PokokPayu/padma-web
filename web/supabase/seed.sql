-- FASE tidak lagi ditanam di sini. Ia data ACUAN, bukan katalog dummy: id
-- teksnya dirujuk kode dan tabelnya hanya dibaca, sehingga produksi — yang
-- lahir lewat `db push` dan tidak pernah menjalankan berkas ini — akan rusak
-- tanpanya. Pindah ke migration 20260908120000_tanam_fase_acuan.sql; satu
-- sumber kebenaran, bukan dua.

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

-- Blok CERMIN dari langkah backfill migrasi `varian_layanan`
-- (`insert into service_variants select id, '' from services`). Pada
-- `db reset` yang bersih, migrasi berjalan SEBELUM berkas seed ini — jadi
-- backfill migrasi menyalin NOL baris untuk layanan seed di atas, dan setiap
-- layanan seed lahir yatim tanpa varian. Pernyataan yang sama diulang di sini
-- SESUDAH layanan seed ada, dengan `where not exists` supaya idempoten
-- terhadap backfill migrasi pada basis data yang sudah berisi layanan
-- produksi. Task berikutnya yang menambahkan varian bertingkat pada layanan
-- tertentu (…107, …109) menonaktifkan baris baku ini alih-alih menghapusnya —
-- pensiun lewat `aktif = false`, bukan penghapusan baris, sama seperti aturan
-- lain di proyek ini.
insert into service_variants (service_id, label)
  select id, '' from services
  where not exists (select 1 from service_variants v where v.service_id = services.id);

-- `service_rates` dijatuhkan Task 5 (migration `bubarkan_service_rates`):
-- dua sumber harga berarti satu di antaranya pasti basi tanpa ada yang tahu
-- kapan. Blok ini dulu dua langkah (isi `service_rates`, lalu blok CERMIN
-- menyalinnya ke `variant_rates` — sama seperti langkah salin migrasi
-- `tarif_per_varian`, diulang di sini karena migrasi berjalan SEBELUM seed
-- pada `db reset` bersih); Task 5 meleburnya menjadi satu insert langsung ke
-- `variant_rates` yang menunjuk varian baku tiap layanan. Nominalnya sengaja
-- SAMA PERSIS dengan seed lama.
--
-- `where not exists (...)` di bawah dipertahankan dari blok CERMIN lama
-- dengan alasan yang SAMA: `berlaku_sejak` tidak disebut di sini (default
-- `current_date`), jadi berkas ini aman dijalankan ulang pada basis data yang
-- sudah berisi tarif produksi (mis. `seed.sql` dijalankan lagi pada hari yang
-- sama) — tanpa penjaga ini, pengulangan itu menabrak
-- `variant_rates_unik_per_tanggal` alih-alih no-op senyap.
insert into variant_rates (variant_id, harga_klien, honor_mitra)
  select v.id, r.harga, r.honor
    from (values
      ('11111111-1111-1111-1111-111111111101'::uuid, 425000, 190000),
      ('11111111-1111-1111-1111-111111111102'::uuid, 250000, 100000),
      ('11111111-1111-1111-1111-111111111103'::uuid, 300000, 130000),
      ('11111111-1111-1111-1111-111111111104'::uuid, 350000, 150000),
      ('11111111-1111-1111-1111-111111111105'::uuid, 275000, 110000),
      ('11111111-1111-1111-1111-111111111106'::uuid, 450000, 200000),
      ('11111111-1111-1111-1111-111111111107'::uuid, 400000, 175000),
      ('11111111-1111-1111-1111-111111111108'::uuid, 375000, 160000),
      ('11111111-1111-1111-1111-111111111109'::uuid, 400000, 180000),
      ('11111111-1111-1111-1111-111111111110'::uuid, 300000, 125000)
    ) as r(service_id, harga, honor)
    join service_variants v on v.service_id = r.service_id
   where not exists (
     select 1 from variant_rates vr
      where vr.variant_id = v.id and vr.berlaku_sejak = current_date
   );

-- Contoh varian BERTINGKAT untuk data pengembangan.
-- Tiga layanan ini dipilih karena TIDAK dirujuk satu berkas uji pun
-- (diverifikasi dengan grep atas UUID-nya di tests/), sehingga contohnya masuk
-- tanpa memerahkan asersi yang tidak berhubungan dengan varian.
--
-- Varian baku bawaan migrasi diberi urutan 0 dan dinonaktifkan untuk kedua
-- layanan bervarian: layanan tidak boleh punya dua "harga utama" yang keduanya
-- aktif, karena landing akan menampilkan keduanya sebagai pilihan yang sah.
update service_variants set aktif = false
 where service_id in ('11111111-1111-1111-1111-111111111107',
                      '11111111-1111-1111-1111-111111111109')
   and label = '' and durasi_menit is null and format is null;

insert into service_variants (service_id, label, durasi_menit, format, urutan)
  select v.service_id, v.label, v.durasi_menit, v.format, v.urutan
    from (values
      ('11111111-1111-1111-1111-111111111107'::uuid,'',60, null::varian_format,1),
      ('11111111-1111-1111-1111-111111111107'::uuid,'',90, null::varian_format,2),
      ('11111111-1111-1111-1111-111111111107'::uuid,'',120,null::varian_format,3),
      ('11111111-1111-1111-1111-111111111109'::uuid,'',90,'private',1),
      ('11111111-1111-1111-1111-111111111109'::uuid,'',90,'circle', 2)
    ) as v(service_id, label, durasi_menit, format, urutan)
   where not exists (
     select 1 from service_variants sv
      where sv.service_id = v.service_id
        and sv.durasi_menit is not distinct from v.durasi_menit
        and sv.format is not distinct from v.format
   );

-- Harga coret sengaja terisi pada sebagian baris saja: kedua cabang tampilan
-- (dicoret / polos) harus ada di data pengembangan.
insert into variant_rates (variant_id, harga_klien, harga_coret, honor_mitra)
  select v.id,
         h.harga,
         h.coret,
         h.honor
    from (values
      (60,  null::varian_format, '11111111-1111-1111-1111-111111111107'::uuid, 350000, 370000, 150000),
      (90,  null,                '11111111-1111-1111-1111-111111111107'::uuid, 400000, 420000, 175000),
      (120, null,                '11111111-1111-1111-1111-111111111107'::uuid, 450000, null,   200000),
      (90,  'private',           '11111111-1111-1111-1111-111111111109'::uuid, 400000, 420000, 180000),
      (90,  'circle',            '11111111-1111-1111-1111-111111111109'::uuid, 250000, null,   110000)
    ) as h(durasi, format, service_id, harga, coret, honor)
    join service_variants v
      on v.service_id = h.service_id
     and v.durasi_menit = h.durasi
     and v.format is not distinct from h.format
   where not exists (
     select 1 from variant_rates vr
      where vr.variant_id = v.id and vr.berlaku_sejak = current_date
   );

-- Tarif transport soft launch, dari materi klien. `di_atas_20` sengaja tidak
-- ada: tarifnya ditetapkan owner per kasus (lihat transport_khusus).
--
-- Perhatikan 0–5 km: klien Rp0, mitra Rp10.000. Itu BUKAN salah ketik — ia
-- subsidi PADMA, dan angka ketiganya (selisih) sengaja tidak disimpan.
--
-- Honor mitra untuk jenjang selain `0_5` BELUM PERNAH DISEBUT KLIEN (spec §2
-- "Yang tidak dijamin"). Angka 5_10/10_15/15_20 di bawah adalah semaian
-- PENGEMBANGAN semata — JANGAN menyalinnya ke produksi tanpa konfirmasi klien.
--
-- `on conflict (jenjang, berlaku_sejak)` aman dipakai langsung (bukan
-- `where not exists` seperti blok variant_rates di atas): constraint-nya
-- adalah unique BIASA (bukan sebagian/parsial), jadi ON CONFLICT DO NOTHING
-- sudah idempoten terhadap pengulangan `seed.sql` pada hari yang sama.
insert into transport_rates (jenjang, tarif_klien, honor_mitra) values
  ('0_5',       0, 10000),
  ('5_10',  10000, 10000),
  ('10_15', 20000, 15000),
  ('15_20', 30000, 20000)
  on conflict (jenjang, berlaku_sejak) do nothing;

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
--
-- Kedua materi VIDEO (…701, …703) diseed `aktif = false` (fix F4, video-r2
-- fix wave): keduanya TIDAK punya baris `material_videos` (lihat catatan di
-- bawah, spec §13b A-6), dan sebelumnya `aktif` dibiarkan di nilai bawaan
-- (`true`) tanpa isi — `aktifkanMateri` (`src/app/admin/materi/aksi.ts`)
-- sendiri MENOLAK menerbitkan materi tanpa isi lewat panel admin, tapi INSERT
-- langsung di seed ini melangkahi penjaga itu. Akibatnya nyata, bukan
-- teoretis: `npx supabase db reset && npm run dev` TANPA vitest membiarkan
-- KEDUA materi ini aktif dengan pemutar yang tidak pernah jalan, dan Ananda
-- (berhak atas …701 lewat sesi `selesai`-nya) adalah pasien yang mendapatinya
-- rusak sejak pertama membuka materi ini. `tests/global-setup.ts` membalik
-- `aktif` ke `true` untuk keduanya, tapi HANYA untuk lingkungan test dan
-- HANYA sesudah menyemai baris `material_videos`-nya — lihat komentar di sana.
insert into materials (id, judul, tipe, deskripsi, aktif) values
  ('77777777-7777-7777-7777-777777777701',
   'Pijat Mandiri Prekonsepsi','video','Panduan video pijat perut mandiri 12 menit.', false),
  ('77777777-7777-7777-7777-777777777702',
   'Panduan Siklus Subur','ebook','E-book bergambar tentang membaca siklus.', true),
  ('77777777-7777-7777-7777-777777777703',
   'Teknik Pelekatan Menyusui','video','Panduan video pelekatan & posisi menyusui.', false),
  ('77777777-7777-7777-7777-777777777704',
   'Panduan ASI Perah','ebook','E-book penyimpanan & penanganan ASI perah.', true);

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

-- Materi video demo sengaja TIDAK diberi baris `material_videos`, sehingga ia
-- tampil "Belum ada isi" di panel admin — dan sejak `aktif = false` di atas,
-- ia TIDAK muncul sama sekali di passport (bukan "terkunci": kartu terkunci
-- menuntut `aktif = true` supaya klien yang berhak melihatnya berstatus
-- terkunci; ini nonaktif, jadi tidak ada kartu apa pun untuk dilihat).
--
-- Alternatifnya menyemai objek sungguhan ke R2 pada setiap `db reset`, yang
-- berarti setiap mesin dev menulis ke bucket bersama — tidak sepadan demi satu
-- materi demo. Konsekuensinya diterima sadar (spec §13b A-6): reader video
-- hanya bisa dicoba sesudah admin mengunggah video sungguhan DAN menerbitkannya.

-- Halaman e-book (Task 10 — reader kini gambar hasil rasterisasi; bab teks
-- sudah dibongkar total di Task 11, material_chapters tidak ada lagi).
-- KEDUA materi ebook demo dapat baris `material_pages` — TERBUKA (…702)
-- MAUPUN TERKUNCI (…704).
--
-- Draf pertama fix ronde 2 membiarkan …704 tanpa baris (atau dengan baris
-- ber-objek fiktif) dengan alasan "Ananda tidak pernah berhak, jadi tidak
-- relevan". Itu SALAH, dan `tests/admin-sesi-catatan.test.ts` (test "materi
-- layanan itu ikut TERBUKA untuk klien") membuktikannya: menandai SATU sesi
-- Lactation Hero SIAPA PUN "selesai" — aksi admin sehari-hari, dan SEARAH
-- karena `DELETE sessions` sudah dicabut — langsung membuka …704 lewat
-- cabang otomatis `berhak_isi_materi`, tanpa satu pun langkah tambahan.
-- Materi yang aktif tanpa objek sungguhan di baliknya berarti pembukaan itu
-- berakhir gambar 404 permanen bagi klien yang bersangkutan — persis kelas
-- bug yang rencana ini bongkar berulang kali: kartu yang menjanjikan isi
-- padahal kosong.
--
-- `objek` di sini MEMANG menunjuk berkas sungguhan di bucket privat
-- `materi-halaman` untuk KEDUA materi — bukan path yang hanya kebetulan
-- berbentuk benar, dan TIDAK ADA lagi baris yang objeknya fiktif. SQL murni
-- tidak bisa menaruh BYTE gambar ke storage (itu jalur Storage API), jadi
-- keempat objeknya diunggah terpisah oleh `unggahHalamanMateriDemo()` di
-- scripts/seed-users.ts, sesudah baris ini ada (satu-satunya urutan yang
-- mungkin: RLS `berhak_isi_materi` pada `material_pages` butuh baris DB-nya
-- lebih dulu). Ini bukan kerapian kosmetik: sebelum diperbaiki, baris-baris
-- ini menunjuk objek yang tidak pernah diunggah, dan membuka salah satu
-- e-book ini di dev menampilkan `<img>` 404 — reader yang tampak rusak,
-- persis kelas masalah "layar menjanjikan sesuatu yang tidak benar" yang
-- dirapikan berulang kali di rencana ini. Jumlah halaman & dimensi di sini
-- WAJIB SAMA PERSIS dengan `MATERI_EBOOK_DEMO`/`LEBAR_DEMO`/`TINGGI_DEMO` di
-- scripts/seed-users.ts.
insert into material_pages (material_id, halaman, objek, lebar, tinggi) values
  ('77777777-7777-7777-7777-777777777702',1,'77777777-7777-7777-7777-777777777702/0001.webp',1600,2263),
  ('77777777-7777-7777-7777-777777777702',2,'77777777-7777-7777-7777-777777777702/0002.webp',1600,2263),
  ('77777777-7777-7777-7777-777777777702',3,'77777777-7777-7777-7777-777777777702/0003.webp',1600,2263),
  ('77777777-7777-7777-7777-777777777704',1,'77777777-7777-7777-7777-777777777704/0001.webp',1600,2263),
  ('77777777-7777-7777-7777-777777777704',2,'77777777-7777-7777-7777-777777777704/0002.webp',1600,2263),
  ('77777777-7777-7777-7777-777777777704',3,'77777777-7777-7777-7777-777777777704/0003.webp',1600,2263);
