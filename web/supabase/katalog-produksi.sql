-- ============================================================================
-- KATALOG PRODUKSI PADMA — pricelist soft launch dari klien (8 September 2026)
-- ============================================================================
--
-- Berkas ini BUKAN `seed.sql` dan BUKAN migrasi. Ia dijalankan SEKALI, dengan
-- tangan, ke basis data produksi.
--
--   * Bukan `seed.sql`: katalog di sana adalah data dummy (keputusan #12), dan
--     30 berkas di `tests/` serta `src/` terikat pada UUID-nya
--     (`11111111-…-1111111111NN`). Menukar isinya memerahkan semuanya
--     sekaligus — itu utang terbuka #2 spec C1, butir V10 spec varian, dan
--     bukan pekerjaan yang boleh menumpang di sini.
--   * Bukan migrasi: katalog adalah data BISNIS yang diubah klien sendiri
--     lewat panel. Migrasi untuk skema; `phases` jadi migrasi karena ia data
--     ACUAN yang dirujuk kode, dan katalog bukan itu.
--
-- CARA MENJALANKAN: Supabase Dashboard → SQL Editor → tempel seluruh isi
-- berkas ini → Run. Aman diulang: setiap blok berpenjaga `where not exists`,
-- jadi menjalankannya dua kali tidak menggandakan apa pun.
--
-- SUMBER: tabel harga soft launch kiriman klien. Dua program sengaja TIDAK
-- punya harga Circle — dicoret klien di tabel aslinya:
--   * Garbha Relief  (pijat relaksasi bumil)
--   * Purnama Rest   (pijat relaksasi ibu nifas)
-- Keduanya pijat perorangan, jadi ketiadaan Circle memang masuk akal.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. TARIF ACUAN — seluruh harga katalog ini ditentukan oleh durasi × format.
--
-- Ke-14 program mengikuti pola yang SAMA PERSIS tanpa satu pun pengecualian,
-- jadi harga ditulis sekali di sini dan disebarkan lewat join, bukan diketik
-- 30 kali. Salah ketik pada satu baris di sini terlihat; salah ketik pada satu
-- dari 30 baris berulang tidak.
--
-- `harga_klien` = kolom "Harga Soft Launch"  (yang dibayar hari ini)
-- `harga_coret` = kolom "Harga Normal"       (yang tampil dicoret)
--
-- >>> HONOR MITRA MASIH NOL — SEMENTARA, ATAS KEPUTUSAN PEMILIK 8 Sep 2026. <<<
-- Angka honor TIDAK ADA di tabel harga kiriman klien. Nol dipilih supaya
-- katalog bisa hidup lebih dulu, BUKAN karena mitra tidak dibayar.
--
-- Akibat yang harus diketahui: selama nol, rekap owner menghitung SELURUH
-- harga sebagai margin PADMA. Angkanya akan terlihat wajar dan tetap salah —
-- tidak ada peringatan apa pun yang muncul.
--
-- CARA MEMPERBAIKI kelak — JANGAN sekadar mengubah angka di bawah lalu
-- menjalankan ulang berkas ini. Penjaga `where not exists` di blok 5
-- menjadikannya no-op senyap bila dijalankan pada tanggal yang sama, dan
-- pada tanggal berbeda ia menerbitkan tarif baru yang benar. Yang tepat:
-- tambahkan baris `variant_rates` baru dengan `berlaku_sejak` hari koreksi,
-- supaya riwayat tarif tidak ditimpa. Rekap lama tetap membaca tarif lama.
--
-- Bila ternyata honor TIDAK seragam per durasi×format melainkan berbeda per
-- program, bentuk tabel ini yang harus berubah, bukan angkanya saja.
-- ---------------------------------------------------------------------------
create temporary table tarif_acuan (
  durasi      int not null,
  format      varian_format not null,
  harga_klien int not null,
  harga_coret int not null,
  honor       int not null,
  primary key (durasi, format)
);

insert into tarif_acuan (durasi, format, harga_klien, harga_coret, honor) values
  ( 60, 'private', 139000, 159000, 0),
  ( 90, 'private', 179000, 199000, 0),
  (120, 'private', 219000, 239000, 0),
  ( 60, 'circle',   99000, 109000, 0),
  ( 90, 'circle',  109000, 119000, 0),
  (120, 'circle',  119000, 129000, 0);


-- ---------------------------------------------------------------------------
-- 2. PENJAGA — gagal keras, bukan diam.
--
-- Tanpa ini, honor -1 ditolak constraint `variant_rates_nilai_wajar` dengan
-- pesan yang tidak menjelaskan apa pun, SESUDAH layanan dan varian terlanjur
-- masuk. Lebih baik berhenti sebelum menyentuh satu tabel pun.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from tarif_acuan where honor < 0) then
    raise exception
      'Honor mitra belum diisi. Isi kolom honor pada tabel tarif_acuan di bagian atas berkas ini, lalu jalankan ulang.';
  end if;
  if exists (select 1 from tarif_acuan where honor = 0) then
    raise warning
      'Honor mitra masih NOL — sementara. Rekap owner akan menghitung seluruh harga sebagai margin PADMA sampai tarif baru diterbitkan.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. LAYANAN
--
-- UUID ditulis tetap (bukan `gen_random_uuid()`) supaya berkas ini idempoten
-- dan supaya baris produksi bisa ditelusuri balik ke baris tabel harga klien.
-- Awalan `22222222` sengaja berbeda dari katalog dummy `11111111`.
--
-- `nama` memuat nama program; `deskripsi` memuat keterangan dalam kurung di
-- bawahnya pada tabel klien.
-- ---------------------------------------------------------------------------
insert into services (id, phase_id, nama, deskripsi)
  select v.id, v.phase_id, v.nama, v.deskripsi
    from (values
      ('22222222-2222-2222-2222-222222222201'::uuid,'kehamilan','Garbha Relief',                        'Pijat Relaksasi Bumil'),
      ('22222222-2222-2222-2222-222222222202'::uuid,'kehamilan','Garbha Flow Yoga Basic',               ''),
      ('22222222-2222-2222-2222-222222222203'::uuid,'kehamilan','Garbha Flow Yoga Complete',            ''),
      ('22222222-2222-2222-2222-222222222204'::uuid,'kehamilan','Garbha Couple Yoga',                   ''),
      ('22222222-2222-2222-2222-222222222205'::uuid,'kehamilan','Garbha Partner Lab Basic',             '6 Touches'),
      ('22222222-2222-2222-2222-222222222206'::uuid,'kehamilan','Garbha Partner Lab Extended+',         '5 Comfort Skill'),
      ('22222222-2222-2222-2222-222222222207'::uuid,'nifas',    'Purnama Rest',                         'Pijat Relaksasi Ibu Nifas'),
      ('22222222-2222-2222-2222-222222222208'::uuid,'newborn',  'Shishu Nurturing Academy Basic',       '2 modul'),
      ('22222222-2222-2222-2222-222222222209'::uuid,'newborn',  'Shishu Nurturing Academy',             '3 modul'),
      ('22222222-2222-2222-2222-222222222210'::uuid,'newborn',  'Shishu Parents Touch Gentle Start',    '0–2 bulan'),
      ('22222222-2222-2222-2222-222222222211'::uuid,'newborn',  'Shishu Parents Touch Explore & Connect','3–6 bulan'),
      ('22222222-2222-2222-2222-222222222212'::uuid,'newborn',  'Shishu Parents Touch Move & Play',     '6–12 bulan'),
      ('22222222-2222-2222-2222-222222222213'::uuid,'nifas',    'Lactation Hero',                       ''),
      ('22222222-2222-2222-2222-222222222214'::uuid,'nifas',    'Return to Work',                       '')
    ) as v(id, phase_id, nama, deskripsi)
   where not exists (select 1 from services s where s.id = v.id);


-- ---------------------------------------------------------------------------
-- 4. VARIAN
--
-- `label` dibiarkan kosong: `labelVarian()` sudah merangkai "60 menit ·
-- Private" dari `durasi_menit` + `format`. Mengisi label akan menghasilkan
-- teks berulang di kartu katalog.
--
-- Garbha Relief (…201) dan Purnama Rest (…207) hanya punya baris `private` —
-- kolom Circle keduanya dicoret klien.
-- ---------------------------------------------------------------------------
insert into service_variants (service_id, label, durasi_menit, format, urutan)
  select v.service_id, '', v.durasi, v.format, v.urutan
    from (values
      -- Garbha Relief — tiga durasi, Private saja
      ('22222222-2222-2222-2222-222222222201'::uuid, 60,'private'::varian_format,1),
      ('22222222-2222-2222-2222-222222222201'::uuid, 90,'private',2),
      ('22222222-2222-2222-2222-222222222201'::uuid,120,'private',3),
      -- Garbha Flow Yoga Basic — 60 menit
      ('22222222-2222-2222-2222-222222222202'::uuid, 60,'private',1),
      ('22222222-2222-2222-2222-222222222202'::uuid, 60,'circle', 2),
      -- Garbha Flow Yoga Complete — 120 menit
      ('22222222-2222-2222-2222-222222222203'::uuid,120,'private',1),
      ('22222222-2222-2222-2222-222222222203'::uuid,120,'circle', 2),
      -- Garbha Couple Yoga — 120 menit
      ('22222222-2222-2222-2222-222222222204'::uuid,120,'private',1),
      ('22222222-2222-2222-2222-222222222204'::uuid,120,'circle', 2),
      -- Garbha Partner Lab Basic — 90 menit
      ('22222222-2222-2222-2222-222222222205'::uuid, 90,'private',1),
      ('22222222-2222-2222-2222-222222222205'::uuid, 90,'circle', 2),
      -- Garbha Partner Lab Extended+ — 120 menit
      ('22222222-2222-2222-2222-222222222206'::uuid,120,'private',1),
      ('22222222-2222-2222-2222-222222222206'::uuid,120,'circle', 2),
      -- Purnama Rest — tiga durasi, Private saja
      ('22222222-2222-2222-2222-222222222207'::uuid, 60,'private',1),
      ('22222222-2222-2222-2222-222222222207'::uuid, 90,'private',2),
      ('22222222-2222-2222-2222-222222222207'::uuid,120,'private',3),
      -- Shishu Nurturing Academy Basic — 60 menit
      ('22222222-2222-2222-2222-222222222208'::uuid, 60,'private',1),
      ('22222222-2222-2222-2222-222222222208'::uuid, 60,'circle', 2),
      -- Shishu Nurturing Academy — 120 menit
      ('22222222-2222-2222-2222-222222222209'::uuid,120,'private',1),
      ('22222222-2222-2222-2222-222222222209'::uuid,120,'circle', 2),
      -- Shishu Parents Touch Gentle Start — 60 menit
      ('22222222-2222-2222-2222-222222222210'::uuid, 60,'private',1),
      ('22222222-2222-2222-2222-222222222210'::uuid, 60,'circle', 2),
      -- Shishu Parents Touch Explore & Connect — 90 menit
      ('22222222-2222-2222-2222-222222222211'::uuid, 90,'private',1),
      ('22222222-2222-2222-2222-222222222211'::uuid, 90,'circle', 2),
      -- Shishu Parents Touch Move & Play — 90 menit
      ('22222222-2222-2222-2222-222222222212'::uuid, 90,'private',1),
      ('22222222-2222-2222-2222-222222222212'::uuid, 90,'circle', 2),
      -- Lactation Hero — 120 menit
      ('22222222-2222-2222-2222-222222222213'::uuid,120,'private',1),
      ('22222222-2222-2222-2222-222222222213'::uuid,120,'circle', 2),
      -- Return to Work — 120 menit
      ('22222222-2222-2222-2222-222222222214'::uuid,120,'private',1),
      ('22222222-2222-2222-2222-222222222214'::uuid,120,'circle', 2)
    ) as v(service_id, durasi, format, urutan)
   where not exists (
     select 1 from service_variants sv
      where sv.service_id = v.service_id
        and sv.durasi_menit = v.durasi
        and sv.format = v.format
   );


-- ---------------------------------------------------------------------------
-- 5. TARIF
--
-- Menyebar `tarif_acuan` ke setiap varian katalog ini lewat durasi × format.
--
-- `berlaku_sejak` sengaja tidak disebut (default `current_date`), sama seperti
-- `seed.sql`: penjaga `where not exists` di bawah membuat pengulangan pada
-- hari yang sama menjadi no-op alih-alih menabrak
-- `variant_rates_unik_per_tanggal`. Perubahan harga kelak masuk sebagai BARIS
-- BARU dengan `berlaku_sejak` lebih baru — riwayat tarif tidak ditimpa.
-- ---------------------------------------------------------------------------
insert into variant_rates (variant_id, harga_klien, harga_coret, honor_mitra)
  select sv.id, t.harga_klien, t.harga_coret, t.honor
    from service_variants sv
    join services s on s.id = sv.service_id
    join tarif_acuan t
      on t.durasi = sv.durasi_menit
     and t.format = sv.format
   where s.id between '22222222-2222-2222-2222-222222222201'
                  and '22222222-2222-2222-2222-222222222214'
     and not exists (
       select 1 from variant_rates vr
        where vr.variant_id = sv.id and vr.berlaku_sejak = current_date
     );

drop table tarif_acuan;
