-- ============================================================================
-- SETELAN: DAFTAR JAM LAYANAN (spec C1 J2)
-- ============================================================================
-- "Daftar jam yang boleh dipilih tinggal di app_settings, bukan ditulis keras:
-- jam operasional klinik akan berubah, dan perubahan seperti itu tidak boleh
-- menuntut deploy."
--
-- Bentuk BARU `daftar_jam`, bukan menumpang `teks_polos`: panel perlu tahu cara
-- memvalidasi dan cara menampilkannya, dan `bentuk` adalah tempat pengetahuan
-- itu tinggal (lihat `src/lib/pengaturan/bentuk.ts`). Menumpang teks_polos
-- berarti satu-satunya yang memisahkan "08:00,09:00" dari kalimat bebas adalah
-- kebiasaan admin.
--
-- Yang ditulis di sini KUNCInya, bukan NILAInya — sama seperti tiga kunci yang
-- sudah ada. Nilai sungguhannya diisi klien lewat /admin/pengaturan; sampai itu
-- terjadi `uraikanDaftarJam()` memakai JAM_LAYANAN_BAWAAN.

-- CHECK lama lahir INLINE dan tanpa nama di migration
-- 20260830120000_registri_kunci_pengaturan, sehingga Postgres menamainya
-- sendiri `app_setting_keys_bentuk_check`. Nama itu dipakai apa adanya di
-- bawah — bukan nama karangan, yang akan membuat `drop` diam-diam tidak
-- mengenai apa pun lalu `add` bentrok.
alter table public.app_setting_keys drop constraint if exists app_setting_keys_bentuk_check;

alter table public.app_setting_keys
  add constraint app_setting_keys_bentuk_check
  check (bentuk in ('nomor_wa', 'teks_polos', 'daftar_jam'));

-- Baris registri lahir DI SINI, bukan di seed.sql — alasan yang sama dengan
-- ketiga kunci sebelumnya: `db reset` menjalankan seluruh migration lebih dulu
-- baru seed, dan FK `app_settings.key` menuntut kuncinya sudah terdaftar.
insert into public.app_setting_keys (key, keterangan, bentuk) values
  ('jam_layanan',
   'Jam mulai yang boleh dipilih klien saat memesan — pisahkan dengan koma, mis. 08:00, 09:00, 13:00',
   'daftar_jam');
