-- ============================================================================
-- USIA KEHAMILAN PADA SKRINING
--
-- Klien pada fase kehamilan boleh menyebutkan usia kehamilannya: mengetik
-- minggunya, atau memilih trimester saja bila tidak hafal. Keduanya OPSIONAL.
--
-- MURNI INFORMASI UNTUK TIM. Tidak satu pun nilai di sini ikut menentukan
-- hijau/merah — `hasil` dan `flags` tetap sepenuhnya turunan bank soal. Bila
-- kelak trimester memang harus mempengaruhi triase, itu perubahan KEBIJAKAN
-- KLINIS yang butuh aturan tertulis dari PADMA lebih dulu, bukan tambalan di
-- migration.
--
-- Kolom sendiri, BUKAN dititipkan ke jsonb `jawaban`: kolom itu bertipe
-- "id soal -> boolean" dan disaring `saringJawaban()` ke id yang dikenal.
-- Angka minggu di sana akan tersaring hilang, atau memaksa melonggarkan
-- penyaring yang justru dibuat menahan temuan red team.
-- ============================================================================

alter table screenings
  add column usia_kehamilan_minggu smallint,
  add column trimester smallint;

-- Rentang wajar. 42, bukan 40: kehamilan lewat waktu itu nyata dan formulir
-- keselamatan tidak boleh menolak orang yang sedang menjalaninya.
alter table screenings
  add constraint screenings_usia_kehamilan_wajar
  check (usia_kehamilan_minggu is null
         or usia_kehamilan_minggu between 0 and 42);

alter table screenings
  add constraint screenings_trimester_wajar
  check (trimester is null or trimester between 1 and 3);

-- FAIL-CLOSED lapis kedua. "Nifas, trimester 2" bukan sekadar data janggal di
-- inbox — ia catatan keselamatan yang membingungkan terapis di rumah klien.
-- Aplikasi sudah menolaknya di skema Zod; ini pagar bila kode kelak dilewati
-- (skrip service-role, endpoint baru, refactor yang lupa memeriksa fase).
alter table screenings
  add constraint screenings_usia_hanya_kehamilan
  check (fase = 'kehamilan'
         or (usia_kehamilan_minggu is null and trimester is null));

-- SATU FAKTA, SATU NILAI. Bila minggu diketahui, trimester WAJIB turunannya.
-- Batasnya sengaja disalin dari src/lib/skrining/usia-kehamilan.ts — Postgres
-- tidak bisa memanggil modul TypeScript — dan tests/skrining-usia-db.test.ts
-- menguji kedua salinan itu minggu demi minggu supaya tidak bisa menyimpang
-- diam-diam.
alter table screenings
  add constraint screenings_trimester_cocok_minggu
  check (
    usia_kehamilan_minggu is null
    or trimester = case
         when usia_kehamilan_minggu <= 13 then 1
         when usia_kehamilan_minggu <= 27 then 2
         else 3
       end
  );

comment on column screenings.usia_kehamilan_minggu is
  'Usia kehamilan dalam minggu (0-42), opsional. Informasi untuk tim — tidak mempengaruhi hasil skrining.';
comment on column screenings.trimester is
  'Trimester 1-3. Turunan usia_kehamilan_minggu bila terisi; boleh berdiri sendiri bila klien tidak hafal minggunya.';
