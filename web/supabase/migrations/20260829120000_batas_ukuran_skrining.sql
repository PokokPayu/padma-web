-- ============================================================================
-- Batas ukuran baris skrining — LAPIS KEDUA fail-closed di DB.
--
-- Temuan red team pada rute PUBLIK `POST /api/skrining`: skema Zod membatasi
-- panjang kunci `jawaban` tetapi tidak jumlahnya, dan rate limit bisa dilewati
-- dengan memutar `X-Forwarded-For`. Hasilnya satu penyerang anonim menyimpan
-- baris 2,76 MB / 200.001 kunci ke kolom jsonb data kesehatan, tanpa auth.
--
-- Perbaikan utamanya ada di aplikasi (batas jumlah kunci + batas byte body +
-- penyaringan id soal + kunci rate limit yang tidak dikendalikan klien). CHECK
-- di sini adalah pagar kedua, mengikuti filosofi "butuh DUA kesalahan untuk
-- bocor" yang sudah dipakai migration lain: seandainya kode aplikasi kelak
-- dilewati (skrip service-role, endpoint baru, refactor yang lupa menyaring),
-- Postgres tetap menolak baris raksasa.
--
-- Angka: 12 jawaban boolean dengan kunci <= 40 char muat jauh di bawah 4 KB.
-- Ekspresi memakai `length(<jsonb>::text)` — immutable, aman untuk CHECK
-- (pg_column_size bergantung kompresi TOAST, tidak dipakai di sini).
-- ============================================================================

alter table screenings
  add constraint screenings_jawaban_ringkas
  check (length(jawaban::text) <= 4096);

alter table screenings
  add constraint screenings_flags_ringkas
  check (length(flags::text) <= 8192);

-- Panjang teks identitas ikut dipagari agar batas Zod tidak jadi satu-satunya
-- penjaga (nama 80 / no_hp 25 = batas yang sama dengan SkemaSkriningPublik).
alter table screenings
  add constraint screenings_nama_wajar
  check (char_length(nama) <= 80);

alter table screenings
  add constraint screenings_no_hp_wajar
  check (char_length(no_hp) <= 25);

comment on constraint screenings_jawaban_ringkas on screenings is
  'Pagar kedua anti penggelembungan jsonb data kesehatan lewat rute publik /api/skrining.';
