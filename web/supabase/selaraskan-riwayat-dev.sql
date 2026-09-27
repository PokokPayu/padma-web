-- Menyelaraskan riwayat migrasi DEV dengan PRODUKSI, per 28 September 2026.
--
-- KENAPA BERKAS INI ADA: `supabase db dump` TIDAK membawa skema
-- `supabase_migrations`. Skema produksi yang di-restore ke dev karena itu datang
-- tanpa riwayat, dan `supabase db push` akan mengira NOL migrasi pernah
-- diterapkan lalu mencoba menjalankan seluruh 91 di atas skema yang
-- objeknya sudah ada. Yang keluar bukan gladi bersih melainkan tumpukan
-- "already exists" yang tidak memberi tahu apa pun.
--
-- Daftar di bawah adalah 75 migrasi yang SUDAH ada di produksi,
-- diverifikasi `supabase migration list --linked` pada 28 Sep 2026: produksi
-- berhenti tepat di 20260915100000, dan 16 sesudahnya belum pernah dijalankan
-- di mana pun — satu skrining usia kehamilan, delapan produk digital, tujuh inti
-- pembayaran P1.
--
-- BENTUK TABELNYA disalin dari Supabase lokal, bukan dikarang: `version text not
-- null`, `statements text[]`, `name text`. Membuatnya dengan `version` saja
-- membuat `db push` berikutnya gagal menyisipkan dua kolom sisanya.
-- `statements` sengaja dibiarkan NULL: ia isi SQL yang dijalankan, dan tidak ada
-- gunanya memalsukannya untuk migrasi yang memang dijalankan di tempat lain.
--
-- CARA PAKAI — KE DEV, JANGAN KE PRODUKSI:
--   psql '<url-dev>' -f supabase/selaraskan-riwayat-dev.sql
--   npx supabase link --project-ref <ref-dev>
--   npx supabase db push
--
-- Langkah terakhir itulah gladi bersihnya: 16 migrasi, urutan yang sama
-- persis dengan yang akan dijalankan di produksi.
--
-- Aman diulang: `on conflict do nothing`.

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version    text not null primary key,
  statements text[],
  name       text
);

insert into supabase_migrations.schema_migrations (version, name) values
  ('20260828094716', 'init_schema'),
  ('20260828095030', 'rls_policies'),
  ('20260828101036', 'harden_rls'),
  ('20260828105934', 'gate_material_video'),
  ('20260828114500', 'normalisasi_email_klien'),
  ('20260828185500', 'cabut_grant_anon_berlebih'),
  ('20260828220000', 'undangan_penautan_klien'),
  ('20260828230000', 'fail_closed_sequence_fungsi'),
  ('20260828235000', 'kunci_kolom_penautan_klien'),
  ('20260829000000', 'baca_publik_katalog'),
  ('20260829120000', 'batas_ukuran_skrining'),
  ('20260829130000', 'passport_penjaga'),
  ('20260829140000', 'pembatas_permintaan_jadwal'),
  ('20260829150000', 'pengerasan_admin'),
  ('20260829160000', 'jejak_status_bayar'),
  ('20260829170000', 'sesi_dari_permintaan'),
  ('20260829180000', 'tutup_celah_red_team'),
  ('20260829190000', 'cabut_hak_hapus_berlebih'),
  ('20260829200000', 'batas_radius_hapus_isi_materi'),
  ('20260830100000', 'klaim_hanya_sesi_lepas'),
  ('20260830110000', 'sesi_paket_tanpa_status_bayar'),
  ('20260830120000', 'registri_kunci_pengaturan'),
  ('20260830130000', 'gating_materi_hormati_aktif'),
  ('20260830140000', 'kunci_kolom_identitas'),
  ('20260830150000', 'pengerasan_tabel_uang'),
  ('20260831100000', 'materi_banyak_layanan'),
  ('20260831110000', 'materi_penugasan'),
  ('20260831120000', 'materi_halaman_pdf'),
  ('20260831130000', 'materi_hapus_bab_teks'),
  ('20260903000000', 'kunci_paksa_aktor_penugasan'),
  ('20260904120000', 'materi_video_r2'),
  ('20260905120000', 'material_videos_bentuk_objek'),
  ('20260906100000', 'varian_layanan'),
  ('20260906110000', 'sesi_menunjuk_varian'),
  ('20260906120000', 'tarif_per_varian'),
  ('20260906130000', 'varian_baku_otomatis'),
  ('20260906140000', 'bubarkan_service_rates'),
  ('20260906150000', 'harga_publik'),
  ('20260906160000', 'varian_wajib'),
  ('20260907100000', 'alamat_dan_koordinat'),
  ('20260907110000', 'tarif_transport'),
  ('20260907120000', 'transport_khusus'),
  ('20260907130000', 'geocode_cache'),
  ('20260907140000', 'sesi_menunggu_tarif'),
  ('20260907150000', 'sesi_menunggu_jenjang'),
  ('20260907160000', 'swasunting_profil_klien'),
  ('20260907170000', 'batalkan_cache_gagal'),
  ('20260908100000', 'fase_klien_boleh_kosong'),
  ('20260908110000', 'komentar_penautan_dua_jalur'),
  ('20260908120000', 'tanam_fase_acuan'),
  ('20260909100000', 'rantai_status_nilai'),
  ('20260909101000', 'rantai_status_pagar'),
  ('20260909110000', 'jam_sesi'),
  ('20260909120000', 'registri_jam_layanan'),
  ('20260909130000', 'mitra_pada_permintaan'),
  ('20260909135000', 'konfirmasi_atomik'),
  ('20260909140000', 'pembatalan_oleh_klien'),
  ('20260909145000', 'literal_batal_tertinggal'),
  ('20260909150000', 'pagar_jam_dan_jenjang'),
  ('20260910100000', 'skrining_syarat_pemesanan'),
  ('20260911100000', 'penilaian_sesi'),
  ('20260911110000', 'qris_asli'),
  ('20260912100000', 'status_bayar_nilai'),
  ('20260912101000', 'status_bayar_pagar'),
  ('20260912120000', 'bucket_bukti'),
  ('20260912130000', 'tenggat_dan_skrining'),
  ('20260913100000', 'status_sesi_nilai'),
  ('20260913101000', 'hak_sesi_dan_jejak'),
  ('20260913102000', 'rpc_pembatalan'),
  ('20260913103000', 'klaim_batal_klien'),
  ('20260914100000', 'tarif_dasar_di_atas_20'),
  ('20260914110000', 'jejak_email_tagihan'),
  ('20260914120000', 'harga_klien_untuk_staf'),
  ('20260914130000', 'menunggu_tarif_hanya_tanpa_nominal'),
  ('20260915100000', 'sertifikat_sesi')
on conflict (version) do nothing;

-- Sesudah ini, `npx supabase migration list --linked` terhadap DEV harus
-- menunjukkan 16 baris berkolom remote kosong — persis yang tertunda
-- di produksi. Bila angkanya bukan 16, berhenti: berarti restore
-- skemanya tidak seperti yang diduga.
