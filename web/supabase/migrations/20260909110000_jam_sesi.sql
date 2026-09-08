-- ============================================================================
-- JAM MULAI PADA PERMINTAAN DAN SESI (spec C1 J2)
-- ============================================================================
-- `sessions.tanggal` bertipe `date`. Satu-satunya keterangan waktu yang pernah
-- ada adalah `booking_requests.preferensi_waktu` ('pagi'/'siang'/'sore') —
-- sebuah PREFERENSI, bukan janji. Seluruh kebijakan pembatalan yang datang di
-- C3 bersandar pada "≥ 24 jam sebelum sesi" dan "< 2 jam"; tanpa jam, tidak
-- satu pun batas itu bisa dihitung.
--
-- `preferensi_waktu` TIDAK dihapus. Ia sekarang berarti "kalau jam yang saya
-- minta tidak bisa, saya lebih suka pagi/siang/sore" — keterangan bagi admin
-- saat menawarkan alternatif, bukan lagi satu-satunya keterangan waktu. Ia juga
-- masih menjadi bagian kunci dedup antrean, jadi menghapusnya akan melonggarkan
-- pagar yang sama sekali tidak sedang dibahas di sini.
--
-- Tipe `time` (tanpa zona), bukan `timestamptz`, dan itu disengaja: yang
-- disimpan adalah JAM DINDING klinik, dan zona waktunya tetap satu untuk
-- seluruh sistem (WIB). `timestamptz` akan menyimpan instan yang benar tetapi
-- membuat "jam berapa sesinya" menjadi pertanyaan yang jawabannya bergantung
-- pada zona pembacanya — untuk klinik yang seluruh kliennya di satu zona, itu
-- kerumitan tanpa imbalan. Perakitan instan (untuk menghitung tenggat) hidup di
-- satu tempat, `src/lib/jadwal/jam.ts`, dengan offset +07:00 yang tetap.

-- ===== BACKFILL =====
-- Kolom ditambah DENGAN bawaan, diisi, lalu bawaannya DICABUT. Tanpa langkah
-- ketiga, setiap insert yang lupa menyebut jam akan tersimpan diam-diam dengan
-- jam yang tidak pernah dipilih siapa pun — dan klien menemukannya saat bidan
-- datang di jam yang salah.
--
-- '09:00' untuk baris lama BUKAN tebakan tentang jam sesinya yang sebenarnya:
-- baris-baris itu memang tidak pernah punya jam, dan tidak ada nilai yang bisa
-- membuatnya punya. Ia sekadar nilai yang sah supaya kolom bisa NOT NULL, dan
-- dicatat di sini supaya pembaca berikutnya tidak salah menyangka data lama
-- memuat keterangan yang tidak pernah ada.
alter table public.booking_requests add column jam_mulai time not null default '09:00';
alter table public.booking_requests alter column jam_mulai drop default;

alter table public.sessions add column jam_mulai time not null default '09:00';
alter table public.sessions alter column jam_mulai drop default;

comment on column public.booking_requests.jam_mulai is
  'Jam mulai yang DIPILIH klien (spec J2). Jam dinding WIB. Daftar jam yang '
  'boleh dipilih tinggal di app_settings.jam_layanan, bukan di kode.';

comment on column public.sessions.jam_mulai is
  'Jam mulai sesi, disalin dari permintaan saat konfirmasi. Batas 24 jam & '
  '2 jam pada C3 dihitung dari tanggal + jam ini, zona Asia/Jakarta.';

-- ===== BENTUK =====
-- Menit bulat :00 atau :30. Bukan kerapian: daftar jam di pengaturan diketik
-- manusia, dan jam seperti 09:07 yang lolos ke sini akan tampil di setiap layar
-- sebagai janji yang tak seorang pun bermaksud membuatnya. CHECK ini lapis
-- TERAKHIR — pagar pertamanya `bentukJamSah()` + daftar jam di server action.
alter table public.booking_requests
  add constraint booking_requests_jam_bulat
  check (extract(minute from jam_mulai) in (0, 30) and extract(second from jam_mulai) = 0);

alter table public.sessions
  add constraint sessions_jam_bulat
  check (extract(minute from jam_mulai) in (0, 30) and extract(second from jam_mulai) = 0);
