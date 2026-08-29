-- ============================================================================
-- CABUT HAK DELETE BERLEBIH — sisa yang tidak ikut tercabut di Plan 3A
-- ============================================================================
-- Migration `pengerasan_admin` (20260829150000) mencabut DELETE dari
-- `sessions`, `clients`, `client_packages`, dan `screenings` dengan alasan
-- "klinik tidak punya alur bisnis hapus rekam medis". Alasannya benar;
-- penerapannya tidak lengkap. Direproduksi lewat REST sebagai admin sungguhan
-- (bukan dibaca dari policy), sesudah seluruh migration Plan 3A terpasang:
--
--   DELETE /rest/v1/materials?id=eq.<materi>
--   Authorization: Bearer <JWT admin>      <-- anon key, BUKAN service role
--   -> HTTP 204. Barisnya hilang, DAN `material_chapters` + `material_videos`
--      ikut tersapu ON DELETE CASCADE. Satu permintaan menghapus seluruh isi
--      sebuah materi.
--
--   DELETE /rest/v1/booking_requests?id=eq.<permintaan>   -> baris lenyap,
--      tanpa satu pun jejak.
--
--   Hal yang sama masih berlaku untuk partners, services, packages, phases,
--   app_settings, service_rates, dan honor_marks.
--
-- ===== PRINSIP YANG DIPAKAI MEMUTUSKAN (bukan mencabut semuanya) =====
-- DICABUT bila penghapusan MENGHANCURKAN RIWAYAT atau BUKTI, atau bila operasi
-- itu tidak pernah menjadi pekerjaan sah staf. Klinik ini tidak mengenal
-- "hapus rekam medis"; pensiun diwakili kolom `aktif` atau status
-- `batal`/`ditolak`, dan bentuk-bentuk itu SUDAH ADA di skema.
-- DIPERTAHANKAN bila operasinya memang penyuntingan isi yang wajar dan tidak
-- menghancurkan apa pun (lihat bagian (2) di bawah — dua tabel sengaja
-- dibiarkan).
--
-- Dicabut di lapis HAK TABEL untuk satu verba saja, mengikuti pelajaran yang
-- sudah tiga kali dibayar di repo ini (materials.video_url, client_invites.
-- token_hash, client_packages): hak KOLOM mematahkan `select *` dan payload
-- baris utuh, sedangkan `revoke delete on <tabel>` tidak menyentuh
-- select/insert/update sama sekali.
--
-- `service_role` TIDAK ikut tersentuh di mana pun: itulah jalur seed
-- (`supabase/seed.sql`, `scripts/seed-users.ts`) dan pembersihan `afterAll`
-- seluruh suite test.

-- ---------------------------------------------------------------------------
-- (1a) MATERI — cascade menyapu bab & video
-- ---------------------------------------------------------------------------
-- Ini temuan yang paling mahal dari seluruh berkas, dan alasannya bukan
-- jumlah barisnya melainkan RASIO: satu permintaan HTTP menghapus baris
-- materi, SELURUH `material_chapters`-nya, dan `material_videos`-nya —
-- semuanya lewat ON DELETE CASCADE, tanpa konfirmasi apa pun, tanpa jejak.
-- Isi bab adalah karya tulis yang disusun klinik sendiri (seed-nya saja
-- ribuan karakter prosa); ia tidak bisa "dibuat ulang dari data lain".
--
-- Bentuk pensiun yang benar sudah ada dan sudah dipakai produk:
-- `materials.aktif`. `src/lib/passport/data.ts` menyaring `aktif = true` di
-- dua tempat, jadi menonaktifkan materi SUDAH menghilangkannya dari passport
-- klien — tanpa menghancurkan satu huruf pun. DELETE tidak menambah satu
-- kemampuan produk pun; ia hanya menambah satu cara kehilangan.
revoke delete on public.materials from authenticated;

-- ---------------------------------------------------------------------------
-- (1b) PERMINTAAN JADWAL — membalik keputusan `pengerasan_admin`
-- ---------------------------------------------------------------------------
-- Migration itu menulis: "booking_requests TETAP boleh dihapus staf: ia
-- antrean, bukan rekam medis." Keputusan itu dibalik di sini. Migration lama
-- TIDAK diubah — ia sudah dipakai, dan alasan pembaliknya justru pantas
-- terbaca berdampingan dengan alasan aslinya:
--
--  1. Baris ini terbaca KLIEN (policy "booking: klien baca miliknya"). Ia
--     satu-satunya bukti bahwa klien pernah meminta tanggal tertentu.
--     Menghapusnya membuat permintaan lenyap dari passport pemiliknya sendiri,
--     diam-diam. "Saya sudah mengajukan tanggal 5" menjadi tidak bisa
--     dibuktikan siapa pun — persis bentuk sengketa yang tabel jejak status
--     bayar dibuat untuk menyelesaikannya.
--  2. Bentuk penolakan SUDAH ADA: status 'ditolak'. Ia mengosongkan antrean
--     admin, MELEPASKAN index `booking_requests_antrean_unik` (parsial pada
--     `status = 'menunggu'`), dan mengembalikan kuota lima-permintaan klien —
--     persis seluruh efek yang dikejar DELETE, dengan barisnya tetap ada.
--     Artinya DELETE di sini bukan kemampuan tambahan, melainkan jalan pintas
--     yang kebetulan juga menghapus bukti.
--  3. Sebaliknya, DELETE punya efek samping yang tidak diinginkan siapa pun:
--     ia mengembalikan kuota & melepas dedup TANPA meninggalkan tanda bahwa
--     permintaan itu pernah ada — pembatas volume migration
--     `pembatas_permintaan_jadwal` bisa diputar ulang tanpa batas.
--  4. FK `sessions.booking_request_id` sudah menahan penghapusan permintaan
--     yang SUDAH menjadi sesi (23503, diuji di admin-sesi-konfirmasi). Jadi
--     yang masih bisa dihapus hari ini justru HANYA permintaan yang belum
--     dijawab — kelompok yang paling mungkin disengketakan.
revoke delete on public.booking_requests from authenticated;

-- ---------------------------------------------------------------------------
-- (1c) MASTER DATA — semuanya sudah punya bentuk pensiun sendiri
-- ---------------------------------------------------------------------------
-- `partners`: produk SUDAH memutuskan ini, dan tinggal hak tabelnya yang
-- belum menyusul. `src/app/admin/mitra/form-mitra.tsx` menulis "Tidak ada
-- tombol HAPUS di sini, dan itu disengaja", dan `nonaktifkanMitra()` hanya
-- menyetel `aktif = false`. Seluruh migration `pengerasan_admin` bagian (3)
-- dikerjakan supaya nama bidan nonaktif TETAP menempel pada riwayat sesi
-- klien; satu DELETE membatalkan kerja itu untuk mitra yang belum punya sesi.
revoke delete on public.partners from authenticated;

-- `services` & `packages`: keduanya punya kolom `aktif`, dan katalog publik
-- (`bacaKatalog`, landing) maupun pembatas permintaan jadwal sudah menyaring
-- dengannya. Layanan juga digantungi `service_rates`, `materials`, `sessions`,
-- dan `booking_requests` — riwayat harga dan rekam sesi ikut kehilangan
-- rujukannya begitu barisnya boleh hilang.
revoke delete on public.services from authenticated;
revoke delete on public.packages from authenticated;

-- `phases`: taksonomi lima fase yang DITULIS KERAS di produk — enum
-- `FaseSkrining`, bank soal skrining, dan glif Sanskerta di landing semuanya
-- memetakan id fase satu per satu. Menghapus satu baris fase memutus pemetaan
-- itu tanpa error apa pun di layar. Tidak ada alur admin yang pernah menambah
-- atau membuang fase; ia bagian dari model klinik, bukan data operasional.
revoke delete on public.phases from authenticated;

-- `app_settings`: key/value setelan, dan satu-satunya kuncinya hari ini
-- (`nomor_wa`) menggerakkan SELURUH CTA WhatsApp di landing & wizard skrining.
-- Menghapusnya mematikan CTA itu diam-diam. Tidak ada alur produk yang pernah
-- menghapus setelan — hanya menimpanya (upsert), yang tetap utuh.
revoke delete on public.app_settings from authenticated;

-- ---------------------------------------------------------------------------
-- (1d) TABEL UANG — HANYA verba DELETE, sengaja
-- ---------------------------------------------------------------------------
-- `service_rates` bukan satu baris harga yang ditimpa melainkan RIWAYAT yang
-- ditumpuk: `berlaku_sejak` + index `(service_id, berlaku_sejak desc)` adalah
-- versi harga. Tarif lama bukan sampah — ia dasar honor yang sudah terlanjur
-- dibayarkan. Menghapusnya menulis ulang sejarah uang.
--
-- `honor_marks` adalah BUKTI bahwa seorang mitra sudah dibayar untuk satu
-- pekan (unik per `partner_id, week_start`). Menghapusnya menghapus bukti
-- pembayaran itu sendiri, dan sengketa "pekan itu sudah dibayar atau belum"
-- menjadi tidak bisa dijawab dari basis data. Bila kelak sebuah tanda perlu
-- DIBATALKAN, Plan 5 wajib menambahkan kolom pembatalan yang meninggalkan
-- jejak (pola `aktif`/`dibatalkan_pada`), bukan mengembalikan DELETE:
-- pembatalan yang sah adalah fakta baru, bukan penghapusan fakta lama.
-- Sementara itu jalan keluarnya tetap ada lewat service role.
revoke delete on public.service_rates from authenticated;
revoke delete on public.honor_marks   from authenticated;

-- ---------------------------------------------------------------------------
-- (2) YANG SENGAJA TIDAK DICABUT — dan ini keputusan, bukan kelalaian
-- ---------------------------------------------------------------------------
-- `material_chapters` dan `material_videos` TETAP boleh dihapus staf.
--
-- Keduanya adalah ISI yang ditulis klinik sendiri di dalam sebuah materi:
-- tidak ada data klien, tidak ada riwayat, tidak ada bukti sengketa, dan
-- semuanya bisa ditulis ulang. Menghapus satu bab yang keliru adalah
-- penyuntingan yang wajar, dan `material_videos` yang berelasi 1:1 dengan
-- materi hanya bisa "dilepas dari materi" dengan menghapus barisnya — tidak
-- ada kolom `aktif` di sana, dan menambahkannya hanya untuk menghindari DELETE
-- justru menambah keadaan yang harus disaring di setiap query.
--
-- Yang membedakannya dari `materials`: blast radius satu permintaan. Menghapus
-- materi menyapu seluruh isinya sekaligus lewat cascade; menghapus satu bab
-- menghapus satu bab. Pagar yang ditegakkan di (1a) adalah pagar terhadap
-- KEHILANGAN MASSAL YANG SENYAP, bukan larangan menyunting.
--
-- >>> KOREKSI (lihat 20260829200000_batas_radius_hapus_isi_materi.sql) <<<
-- Kalimat "menghapus satu bab menghapus satu bab" SALAH, dan SQL di bagian ini
-- (yaitu: ketiadaan `revoke delete`) sudah dibatalkan migration tersebut.
-- Premisnya tidak pernah diuji lewat PostgREST: filter pada URL adalah PILIHAN
-- PEMANGGIL, bukan pembatas baris. Sebagai admin sungguhan (anon key + JWT
-- admin), `DELETE /rest/v1/material_chapters?urutan=gte.0` -> HTTP 204 dan
-- SELURUH bab SELURUH materi klinik lenyap dalam satu permintaan — radius yang
-- justru LEBIH BESAR daripada menghapus satu `materials`. Paragraf ini sengaja
-- dibiarkan berdiri (SQL migration yang sudah dipakai tidak ditulis ulang di
-- repo ini) agar penalaran yang keliru terbaca berdampingan dengan
-- bantahannya. Yang tetap BENAR dari paragraf ini: penyuntingan bab memang
-- pekerjaan sah — karena itu penggantinya bukan larangan, melainkan RPC
-- berparameter tunggal `hapus_bab_materi` / `lepas_video_materi`.

-- ---------------------------------------------------------------------------
-- (3) TUTUP SUMBERNYA — supaya temuan ini tidak kambuh sendiri
-- ---------------------------------------------------------------------------
-- Tanpa langkah ini, tabel Plan 3B berikutnya lahir dengan DELETE penuh untuk
-- `authenticated` karena Supabase memasang `alter default privileges in schema
-- public grant all on tables to anon, authenticated, service_role` — persis
-- bagaimana kesebelas tabel di atas mendapatkannya. Pencabutan satu per satu
-- tidak menutup sumbernya, dan auditor berikutnya akan menemukan daftar yang
-- sama dengan nama tabel yang berbeda.
--
-- Polanya sama persis dengan `revoke truncate` di `pengerasan_admin` dan
-- `revoke all ... from anon` di `cabut_grant_anon_berlebih`: sengaja
-- fail-closed dan berisik. Tabel baru yang memang butuh DELETE oleh staf harus
-- menyatakan niatnya dengan satu baris `grant delete on public.<tabel> to
-- authenticated;` — lupa melakukannya menghasilkan 42501 yang langsung
-- kelihatan saat pengembangan, jauh lebih baik daripada hak berlebih yang
-- diam. Hanya DELETE yang disentuh; select/insert/update tetap diwarisi.
alter default privileges in schema public revoke delete on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke delete on tables from authenticated;

-- ---------------------------------------------------------------------------
-- (4) DUA SARAN AUDITOR YANG SENGAJA TIDAK DIJALANKAN
-- ---------------------------------------------------------------------------
-- Ditulis di sini, bukan di pesan commit, karena inilah tempat pertama orang
-- berikutnya melihat sebelum "melengkapi" pekerjaan ini.
--
-- SARAN A: "cabut hak tabel `authenticated` dari service_rates & honor_marks
-- demi pertahanan berlapis, seperti yang dilakukan pada profiles."
--   KELIRU. Owner, admin, dan klien login sebagai peran SQL yang SAMA:
--   `authenticated`. Pada `profiles` polanya bekerja karena staf hanya butuh
--   SATU kolom (`nama`), sehingga hak tabel bisa dicabut lalu satu kolom
--   di-grant ulang. Tabel uang tidak punya himpunan sempit seperti itu: owner
--   butuh seluruh kolom dan seluruh verba baca/tulis. Mencabut hak tabelnya
--   melumpuhkan satu-satunya peran yang memang berhak melihatnya.
--   Dibuktikan, bukan diperkirakan — sebagai peran `authenticated` sungguhan
--   dengan JWT owner:
--     begin;
--       revoke all on public.service_rates from authenticated;
--       set local role authenticated;
--       select set_config('request.jwt.claims', <klaim owner>, true);
--       select count(*) from public.service_rates;
--       -- ERROR: permission denied for table service_rates
--     rollback;
--   Baseline pada transaksi yang sama tanpa revoke: 10 baris. Probe itu
--   dipasang permanen di tests/hak-hapus-berlebih.test.ts supaya sarannya
--   tidak dijalankan diam-diam di kemudian hari. Yang BISA dicabut tanpa
--   melumpuhkan owner hanyalah verba DELETE — itulah yang dikerjakan (1d),
--   dan kontrol positifnya (owner tetap membaca/menambah/mengubah rate card)
--   diuji di berkas yang sama.
--
-- SARAN B: "cabut hak kolom UPDATE `clients.user_id`; penahan penautan liar
-- jangan hanya trigger."
--   KELIRU, dan kekeliruannya TERBALIK dari yang dikira: trigger
--   `guard_client_link` di sini LEBIH kuat daripada hak kolom, bukan lebih
--   lemah. Hak kolom mengikat KEHADIRAN kolom di payload; trigger mengikat
--   PERUBAHAN NILAI. Panel admin yang mengirim baris utuh dengan `user_id`
--   bernilai sama adalah alur sah, dan hanya trigger yang meloloskannya —
--   invarian itu bahkan sudah tertulis sebagai assertion di
--   tests/penautan-kolom-terkunci.test.ts sejak migration
--   `kunci_kolom_penautan_klien`.
--   Dicoba sungguhan pada basis data lokal:
--     revoke update on public.clients from authenticated;
--     grant update (padma_id, nama, email, no_hp, phase_id, created_at)
--       on public.clients to authenticated;
--   lalu `npx vitest run tests/penautan-kolom-terkunci.test.ts` ->
--     "admin tetap bisa mengelola kolom operasional klien" MERAH dengan
--     42501 "permission denied for table clients" pada PATCH baris utuh.
--   Hak kolomnya dikembalikan; sarannya tidak dijalankan.

-- ---------------------------------------------------------------------------
-- (5) INVARIAN DITULIS DI SKEMA
-- ---------------------------------------------------------------------------
-- Komentar tabel adalah tempat kedua orang berikutnya melihat (sesudah
-- migration ini) sebelum mengembalikan DELETE. Keberadaannya diuji regression
-- test supaya tidak hilang tanpa sadar.
comment on table public.materials is
  'Materi (e-book/video) untuk klien. TIDAK PERNAH dihapus lewat peran API: '
  'penghapusannya menyapu material_chapters & material_videos lewat ON DELETE '
  'CASCADE dalam satu permintaan. Bentuk pensiunnya adalah `aktif = false`, '
  'yang sudah disaring passport klien. DELETE hanya lewat service role.';

comment on table public.booking_requests is
  'Antrean permintaan jadwal dari klien, sekaligus BUKTI klien bahwa ia pernah '
  'meminta tanggal tertentu (terbaca pemiliknya lewat policy "booking: klien '
  'baca miliknya"). TIDAK PERNAH dihapus lewat peran API: bentuk penolakannya '
  'adalah status `ditolak`, yang sudah mengosongkan antrean admin, melepaskan '
  'index parsial booking_requests_antrean_unik, dan mengembalikan kuota klien '
  'tanpa menghapus jejaknya. DELETE hanya lewat service role.';
