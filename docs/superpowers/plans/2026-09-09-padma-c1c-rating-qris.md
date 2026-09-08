# PADMA C1-c — Rating Layanan & Bidan, dan QRIS Asli

**Spec:** `docs/superpowers/specs/2026-09-08-padma-c1-fondasi-jadwal-design.md`, keputusan **J10**
dan **J12**. Ini bagian terakhir C1; J1/J2/J7/J8/J13 mendarat di C1-a (`2ac03b8`), J3–J6/J9/J11 di
C1-b (`23f0764`).

**Cabang:** `c1c-rating`, dari `main` `23f0764`.

---

## Global Constraints

Sama seperti C1-a/C1-b. Yang paling sering menggigit:

1. **JANGAN `test:e2e:video` / `test:e2e:semua`** — bucket R2 produksi klien.
2. **JANGAN `supabase db push` ke produksi.**
3. Basis data lokal dipakai bersama; resep reset: `npx supabase db reset` → `docker start` container
   mati → `docker restart supabase_auth_web`.
4. **Tidak ada kehati-hatian data produksi** — belum rilis. Kolom wajib langsung `not null`.
5. **MONEY FIREWALL** — `tests/money-firewall-struktural.test.ts` membatasi kolom nominal uang pada
   `variant_rates`, `honor_marks`, `transport_rates`, `transport_khusus`. Tabel rating **tidak boleh**
   punya kolom yang terbaca sebagai nominal; `bintang_*` aman, `harga`/`tarif`/`honor` tidak.
6. `requireRole()` di DALAM setiap server action.
7. Prop bernilai FUNGSI tidak menyeberang dari server ke komponen `"use client"`.
8. `tests/inventaris-rute.test.ts` — rute baru wajib terdaftar di README.
9. `next build` men-typecheck `tests/` juga.

---

## J10 — Rating layanan DAN rating bidan

### Keputusan yang mengikat

**DUA penilaian, bukan satu.** Dilebur jadi satu angka, layanan yang salah rancang terbaca sebagai
bidan yang buruk: sesi 90 menit yang sebenarnya butuh 120 menit menghasilkan klien kecewa, dan
bintangnya jatuh ke orang yang mengerjakannya dengan benar. Di tim sekecil ini satu bidan
mengerjakan banyak layanan, jadi angka tercampur bukan hanya tak berguna — ia tidak adil pada orang
yang nyata. Dua tuas PADMA juga berbeda pemiliknya: katalog & durasi di tangan owner, pembinaan tim
di tangan admin.

**Rating aplikasi TIDAK dibuat.** Klien awalnya meminta; ditolak dan klien setuju. Bintang untuk
perangkat lunak tidak menunjuk apa pun yang bisa dikerjakan, dan menit sesudah sesi di rumah klien
adalah milik perawatannya.

**Yang disimpan menyertakan SALINAN siapa bidannya dan varian apa saat itu** — bukan sekadar rujukan
ke sesinya. Mitra pada sebuah sesi bisa berganti (bidan sakit, jadwal ulang di C3), dan penilaian
yang menempel lewat rujukan akan diam-diam berpindah ke orang lain. **Penilaian adalah fakta tentang
siapa yang datang hari itu.**

**Penjaganya di basis data**, karena klien memegang hak tulis:
- hanya sesi **miliknya** dan hanya yang berstatus `selesai` yang bisa dinilai;
- satu penilaian per sesi (indeks unik) — boleh diperbarui pemiliknya, tidak bisa digandakan;
- bintang 1–5 lewat CHECK, komentar dibatasi panjangnya;
- klien membaca miliknya, staf membaca semua, **TANPA view agregat** — view agregat persis yang
  dulu membocorkan rate card lengkap ke admin di repo ini.

**Yang TIDAK dilakukannya**, ditulis eksplisit supaya tidak merayap: rating **tidak** memengaruhi
honor mitra, **tidak** dipakai memilih mitra otomatis, dan **tidak pernah** terlihat klien lain.
Ia alat pembinaan, bukan papan skor. → wajib jadi uji yang bisa merah.

**Komentar bebas = teks tak tepercaya.** Disimpan apa adanya, ditampilkan hanya ke staf, tidak
pernah dirender sebagai markup. Ia bisa memuat keterangan kesehatan → tunduk pada disiplin RLS yang
sama dengan data klien lain.

**Kartu klien:** satu kartu di beranda Passport sesudah sesi selesai — dua baris bintang
("Bagaimana sesinya?" dan "Bagaimana bidannya?") + komentar opsional. Bisa diabaikan, **hilang
sendiri setelah 30 hari**, tidak menghadang apa pun.

**Yang dilihat staf:** admin — daftar penilaian terbaru dengan saringan "bintang ≤ 3". Owner — tren
per bidan dan per layanan, **dua kolom terpisah**, sehingga "orangnya atau layanannya?" bisa
dijawab. Bidan tidak melihat apa pun (belum ada akun mitra).

### Tugas

- **R1** Skema + RLS + CHECK + indeks unik. Uji: hanya sesi sendiri & `selesai`; satu per sesi;
  bintang di luar 1–5 ditolak; klien lain nol baris; **salinan mitra tidak berubah ketika mitra pada
  sesinya diganti**; tidak ada view agregat.
- **R2** Server action `nilaiSesi` (klien) — `requireRole`, kepemilikan dari sesi, bukan payload.
- **R3** Kartu penilaian di beranda Passport + jendela 30 hari (fungsi murni + uji).
- **R4** Layar admin (daftar + saringan ≤3) dan owner (dua kolom tren).
- **R5** Pagar "yang TIDAK dilakukannya": honor tidak menyentuh rating, pemilihan mitra tidak
  membacanya, klien lain tidak pernah melihatnya.

---

## J12 — QRIS asli

`src/app/passport/_komponen/qris.tsx` sekarang membangkitkan pola QR **dekoratif** dan halamannya
menulis "Contoh QR — bukan untuk dipindai". Berkas QRIS sungguhan sudah ada di repo
(`web/public/qris-padma.jpeg`, commit `e520b7a`).

**Keputusan:**
- Gambar, nama merchant, dan NMID dibaca dari `app_settings` (kunci baru: `qris_gambar`,
  `qris_merchant`, `qris_nmid`) — kode QRIS bisa berganti, dan penggantiannya tidak boleh menuntut
  deploy.
- Nama merchant & NMID **ditampilkan di sebelah kodenya**: klien perlu melihat bahwa yang ia pindai
  memang PADMA.
- Chip "Contoh QR — bukan untuk dipindai" **dibuang**, dan komponen dekoratifnya dihapus. Menyisakan
  keduanya berarti dua QR di repo dan satu kesempatan salah pasang.
- Nominal **tidak** menempel: QRIS-nya statis, klien mengetik jumlahnya sendiri. Pencocokan uang
  masuk milik C2.

**Batas yang jujur, ditulis di catatan tindak lanjut:** "tanpa deploy" berlaku untuk MENGGANTI
rujukan gambarnya lewat panel. Mengunggah berkas baru masih menuntut tempat menaruhnya; selama
belum ada unggahan aset di panel, nilai bawaannya menunjuk berkas di `public/`.

- **Q1** Kunci setelan + migrasi + nilai bawaan.
- **Q2** Halaman bayar memakai gambar sungguhan + merchant + NMID; komponen dekoratif dihapus.
- **Q3** Uji: tidak ada lagi teks "bukan untuk dipindai"; NMID & merchant tampil; halaman tidak
  pernah menampilkan nominal.

---

## Di luar lingkup

- **Pencocokan uang masuk, tenggat bayar, notifikasi** — C2.
- **Pembatalan berjenjang, jadwal ulang, kredit** — C3.
- **Akun & panel mitra** — belum ada; bidan tidak melihat penilaiannya.
