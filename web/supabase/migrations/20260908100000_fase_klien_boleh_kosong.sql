-- ===========================================================================
-- FASE KLIEN BOLEH KOSONG
-- Spec 8 September 2026, keputusan K3 (pendaftaran mandiri).
-- ===========================================================================
--
-- Sampai migration ini `clients.phase_id` NOT NULL, dan itu masuk akal selama
-- SATU-SATUNYA cara sebuah baris klien lahir adalah lewat formulir admin —
-- admin selalu tahu fase kliennya karena ia baru saja bicara dengannya.
--
-- Sejak pendaftaran mandiri hidup, baris klien juga lahir dari orang yang baru
-- membuat akun sendiri, dan pada saat itu PADMA belum tahu apa pun tentang
-- fasenya. Fase datang dari SKRINING pertama yang tersambung: wizard skrining
-- sudah menanyakannya, dan setiap pemesanan wajib didahului skrining. Menanyakan
-- fase lagi di formulir pendaftaran berarti meminta orang menjawab hal yang sama
-- dua kali, lalu MENYIMPAN DUA JAWABAN YANG BISA BERBEDA — dan begitu keduanya
-- berbeda, tidak ada aturan yang bisa memutuskan mana yang benar.
--
-- NULL di sini karena itu dibaca "belum ditentukan", bukan "hilang". Keempat
-- nilai fase pada skrining (prekonsepsi, kehamilan, nifas, menopause) memang id
-- `phases` yang sah, jadi pengisiannya kelak langsung tanpa penerjemahan;
-- `newborn` sengaja tidak diskrining karena yang diskrining adalah ibunya.
--
-- Alternatif yang DITOLAK: fase palsu bernama "Belum Ditentukan" sebagai baris
-- di tabel `phases`. Tabel itu juga menggerakkan katalog layanan dan materi,
-- sehingga fase palsu akan muncul di tempat yang tidak diduga — mis. sebagai
-- pilihan paket di landing dan sebagai kelompok materi di passport.
--
-- Yang TIDAK dilonggarkan: foreign key ke `phases` tetap ada. Nilai yang bukan
-- NULL tetap wajib merupakan fase yang sungguh terdaftar.

alter table public.clients
  alter column phase_id drop not null;

comment on column public.clients.phase_id is
  'Fase perjalanan klien (referensi public.phases). NULL = BELUM DITENTUKAN, '
  'bukan hilang: baris klien yang lahir dari pendaftaran mandiri belum punya '
  'fase karena fase datang dari skrining pertama yang tersambung — formulir '
  'pendaftaran sengaja tidak menanyakannya agar tidak ada dua jawaban yang '
  'bisa berbeda. Formulir admin tetap mewajibkannya di lapis aplikasi.';
