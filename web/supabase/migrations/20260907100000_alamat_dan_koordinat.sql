-- ============================================================================
-- ALAMAT & KOORDINAT — bahan baku tarif transport
-- ============================================================================
-- Skema hari ini tidak punya satu pun bahan untuk menghitung transport: klien
-- tidak punya alamat rumah, mitra tidak punya domisili, dan jarak tidak ada di
-- mana pun. Akibatnya tagihan sesi tidak pernah lengkap.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260906160000): `supabase migration new` memakai jam dinding dan pernah
-- menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

create type jenjang_transport as enum ('0_5','5_10','10_15','15_20','di_atas_20');
create type sumber_jenjang    as enum ('otomatis','admin');

-- Alamat DEFAULT klien: mengisi formulir otomatis, bukan sumber kebenaran
-- sesi. Sesi menyimpan alamatnya sendiri (di bawah) supaya klien yang pindah
-- rumah tidak menulis ulang arti seluruh riwayatnya.
alter table public.clients
  add column alamat     text not null default '',
  add column alamat_lat double precision null,
  add column alamat_lon double precision null;

-- Domisili mitra: titik pangkal perhitungan jarak. Mitra tidak berpindah-
-- pindah, jadi satu alamat sudah cukup.
alter table public.partners
  add column alamat text not null default '',
  add column lat    double precision null,
  add column lon    double precision null;

alter table public.booking_requests
  add column alamat     text not null default '',
  add column alamat_lat double precision null,
  add column alamat_lon double precision null;

alter table public.sessions
  add column alamat         text not null default '',
  add column alamat_lat     double precision null,
  add column alamat_lon     double precision null,
  add column jenjang        jenjang_transport null,
  add column jenjang_sumber sumber_jenjang null,
  add column jenjang_alasan text not null default '';

-- KOORDINAT SENGAJA NULLABLE. Geocoding yang gagal — jaringan, batas laju,
-- atau gang yang memang tidak dikenal OpenStreetMap — TIDAK BOLEH
-- menggagalkan penyimpanan alamat. Alamat adalah data operasional yang mitra
-- butuhkan untuk datang ke tempat yang benar; menolak menyimpannya karena OSM
-- tidak mengenalinya menukar masalah kecil dengan masalah besar. Koordinat
-- kosong berarti satu hal saja: jenjangnya tidak disarankan, dan admin
-- memilih sendiri.
--
-- `jenjang` juga nullable: ia baru terisi saat mitra ditentukan, dan sesi yang
-- belum bermitra memang belum punya jenjang.

-- Penimpaan tanpa alasan adalah penimpaan yang tidak bisa dipelajari. Riwayat
-- alasan inilah yang kelak menjawab pertanyaan yang sekarang tidak bisa
-- dijawab siapa pun: seberapa sering geocoding meleset, dan di wilayah mana.
alter table public.sessions
  add constraint sessions_alasan_penimpaan
  check (jenjang_sumber is distinct from 'admin' or length(btrim(jenjang_alasan)) > 0);

comment on column public.sessions.jenjang is
  'Jenjang jarak mitra→alamat sesi. Data OPERASIONAL, bukan nominal: admin '
  'melihatnya untuk memilih mitra terdekat, dan rupiahnya diturunkan dari '
  'transport_rates menurut TANGGAL SESI. Menyimpan rupiah di sini akan '
  'menabrak money firewall sekaligus membekukan tarif yang seharusnya historis.';
