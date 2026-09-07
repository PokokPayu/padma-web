# PADMA C1 — Fondasi Jadwal: Jam, Rantai Status, Mitra, dan Skrining sebagai Syarat

**Tanggal:** 8 September 2026
**Pendahulu:** `docs/superpowers/specs/2026-09-08-padma-daftar-mandiri-design.md` — spec itu punya
"Tahap C" yang isinya sekarang PINDAH ke sini dan diperluas. Tahap A (saklar paket) dan B (auth)
di spec itu tidak berubah.
**Sumber keputusan klien:** rangkaian gambar alur pemesanan (langkah 6–12) dan poster "Kebijakan
Pembatalan & Jadwal Ulang", keduanya diterima 8 September 2026.

**Bagian dari tiga:** C1 (dokumen ini) membangun alur pemesanan sampai jadwal terkunci.
C2 menyisipkan pembayaran sebagai syarat konfirmasi. C3 membangun pembatalan berjenjang waktu,
jadwal ulang, dan kredit layanan. C1 berdiri sendiri: setelah ia selesai, klien benar-benar bisa
memesan dan tim benar-benar bisa menjadwalkan.

## Masalah

Alur pemesanan yang diminta klien tidak bisa dijalankan skema sekarang, dan sebabnya empat hal yang
berdiri sendiri-sendiri.

1. **Sesi tidak punya jam.** `sessions.tanggal` bertipe `date`. Yang ada soal waktu hanyalah
   `booking_requests.preferensi_waktu` (`pagi`/`siang`/`sore`) — sebuah preferensi, bukan janji.
   Seluruh kebijakan pembatalan bersandar pada "≥ 24 jam sebelum sesi" dan "< 2 jam"; tanpa jam,
   tidak satu pun dari batas itu bisa dihitung.

2. **Rantai statusnya terlalu pendek.** `booking_status` hanya `menunggu`/`dikonfirmasi`/`ditolak`.
   Tidak ada keadaan "sedang dicarikan bidan" maupun "bidan sudah siap" — padahal justru di antara
   keduanya transport dihitung dan tagihan terbit.

3. **Tidak ada syarat skrining.** Aturan bisnisnya "skrining dulu, baru pesan", dan itu belum
   terwujud di mana pun dalam kode. Corong skrining di landing berakhir di WhatsApp.

4. **Tidak ada penilaian setelah sesi.** Mutu layanan dan mutu orang yang mengerjakannya sama-sama
   tidak terekam.

## Keputusan

### J1 — Dua objek, rantai terbelah di konfirmasi

Rantai status yang diusulkan klien terbelah persis di `CONFIRMED`: yang sebelumnya adalah hidup
sebuah **permintaan**, yang sesudahnya hidup sebuah **sesi**. Repo sudah punya dua tabel itu, dan
pemisahannya sudah dikeraskan — migration `20260829170000_sesi_dari_permintaan` mencatat bahwa
konfirmasi adalah dua tulisan sekaligus, dengan indeks unik sebagai jaring kedua supaya dua admin
yang menekan "Konfirmasi" bersamaan tidak melahirkan dua sesi ("klien kedatangan bidan dua kali,
dan tidak ada error apa pun yang memberi tahu").

Karena itu rantai dipasang pada dua objek, bukan dilebur jadi satu tabel:

| Objek | Status | Dari usulan klien |
|---|---|---|
| `booking_requests` | `diminta` | `REQUESTED` |
| | `mencari_mitra` | `MATCHING_MITRA` |
| | `mitra_siap` | `MITRA_ASSIGNED` |
| | `dikonfirmasi` | `CONFIRMED` |
| | `dibatalkan_klien` | `CANCELLED_BY_CLIENT` |
| `sessions` | `terjadwal` | (setelah `CONFIRMED`) |
| | `berjalan` | `IN_PROGRESS` |
| | `selesai` | `COMPLETED` |
| | `tidak_hadir` | `NO_SHOW` |
| | `dibatalkan_padma` | `CANCELLED_BY_PADMA` |

**Namanya berbahasa Indonesia**, bukan `SCREAMING_SNAKE` bahasa Inggris. Seluruh enum di repo ini
berbahasa Indonesia (`menunggu_verifikasi`, `terjadwal`, `belum`); menaruh `AWAITING_PAYMENT` di
sebelahnya membuat satu skema punya dua kosakata, dan pembaca berikutnya harus menebak mana yang
berlaku. Yang diadopsi adalah MODELNYA, bukan ejaannya.

**`menunggu_bayar` (`AWAITING_PAYMENT`) sengaja BELUM ada di C1.** Ia disisipkan C2 antara
`mitra_siap` dan `dikonfirmasi`. Sampai itu terjadi, admin mengonfirmasi langsung setelah memilih
mitra. Menyiapkan nilai enum yang belum dipakai berarti menaruh keadaan mati di dalam basis data
yang tidak satu pun kode tahu cara keluar darinya.

Nilai lama dipetakan lewat `ALTER TYPE ... RENAME VALUE`: `menunggu` → `diminta`. `ditolak`
dipertahankan nilainya (lihat J8) tetapi tidak lagi bisa dicapai dari layar mana pun.

**Peringatan klien yang dipatuhi:** status skrining dan status pemesanan TIDAK digabung menjadi satu
medan. Keduanya sudah terpisah di repo (`screening_result` pada `screenings`, `booking_status` pada
`booking_requests`) dan tetap begitu.

### J2 — Sesi punya jam mulai yang dipilih klien

`booking_requests` dan `sessions` sama-sama mendapat kolom jam mulai. Klien memilihnya saat memesan
— alur `durasi → tanggal → jam → alamat → catatan` sesuai gambar klien.

Daftar jam yang boleh dipilih tinggal di `app_settings`, bukan ditulis keras: jam operasional
klinik akan berubah, dan perubahan seperti itu tidak boleh menuntut deploy.

`preferensi_waktu` **tetap ada dan tidak dihapus**. Ia sekarang berarti "kalau jam yang saya minta
tidak bisa, saya lebih suka pagi/siang/sore" — keterangan bagi admin saat menawarkan alternatif,
bukan lagi satu-satunya keterangan waktu.

Batas "24 jam" dan "2 jam" pada C3 dihitung dari `tanggal + jam` dalam zona **Asia/Jakarta**, memakai
`hariIniJakarta()` yang sudah ada. Vercel berjalan UTC; menghitung tenggat dengan kalender mesin akan
menggeser batasnya tujuh jam, dan pergeseran itu berbentuk uang klien yang hangus sehari lebih awal.

### J3 — Setiap pengajuan wajib berdiri di atas satu skrining hijau

Aturannya: **skrining setiap kali akan memesan.** Skrining karena itu bukan status akun melainkan
lampiran pada tiap pengajuan.

- `booking_requests` mendapat kolom `screening_id` **NOT NULL**.
- Satu skrining hijau menopang **tepat satu** pengajuan; setelah dipakai ia hangus — dijaga indeks
  unik pada `booking_requests(screening_id)`.
- Alur "Ajukan Jadwal" berubah: wizard skrining dulu → bila hijau, formulir jadwal terbuka.
- Skrining yang menopang pengajuan yang dibatalkan **tidak** hidup kembali.

**Gerbang tiga lapis**, mengikuti cara `guard_booking_pembatas` dan money firewall dikerjakan:

1. **Passport** — tanpa skrining hijau yang belum terpakai, yang tampil adalah ajakan skrining
2. **Server action** `ajukanJadwal` menolak dengan kalimat yang bisa dibaca manusia
3. **DB** — `guard_booking_skrining` menolak baris dari klien tanpa skrining hijau miliknya yang
   belum terpakai

Lapis ketiga bukan hiasan: klien memegang policy INSERT atas `booking_requests` dan bisa memanggil
PostgREST langsung — persis alasan `guard_booking_pembatas` ada.

### J4 — Skrining anonim menempel ke akun lewat token klaim, bukan lewat kodenya

Skrining di landing diisi anonim (nama + no. HP, tanpa email); akun berdiri di atas email.

**Kodenya tidak dipakai sebagai kunci.** `src/lib/skrining/kode.ts` sengaja membuat kode yang mudah
dibacakan lewat telepon: prefiks semenit + sufiks 4 karakter, ~1 juta kemungkinan per menit. Itu
tiket layanan pelanggan, bukan kredensial. Menjadikannya kunci berarti orang bisa menebak kode orang
lain lalu menyedot jawaban kesehatannya ke Passport sendiri.

Yang dipakai: **token klaim** 32 byte dari CSPRNG, hash SHA-256-nya disimpan di baris `screenings`,
tokennya dititipkan di cookie `httpOnly` — pola yang sama persis dengan token undangan, termasuk
sekali-pakai dan klaim atomik.

**Umur token 2 jam.** Tanpa batas itu, satu perangkat bersama — HP di ruang tunggu — membuat orang
kedua yang mendaftar mewarisi skrining orang pertama lengkap dengan jawaban kesehatannya. Sebagai
lapis kedua, saat klaim berhasil Passport menyebut nama pada skrining itu secara terbuka ("Skrining
atas nama **X** telah disambungkan"), supaya salah sambung terlihat, bukan tersembunyi.

Nama dan no. HP pada skrining **tidak** menimpa data akun. Yang berpindah hanya `client_id`, dan
`phase_id` bila masih kosong (J11).

### J5 — Layar hasil skrining: hijau ke aplikasi, merah ke manusia

- **Hijau** — tombol utama "Buat akun & pesan layanan" (`/daftar`, dengan tautan ke `/masuk` bagi
  yang sudah punya akun). Di bawahnya tautan kecil "atau tanya tim dulu via WhatsApp".
- **Merah** — tetap WhatsApp seperti sekarang, tanpa perubahan. Yang dibutuhkan memang bicara dengan
  tim, bukan memesan.

### J6 — Skrining dari dalam Passport: hak baca secukupnya, pembatas tersendiri

Siapa pun yang mendaftar lewat `/daftar` tanpa pernah skrining akan terkunci dari pemesanan. Karena
itu `/passport/skrining` wajib ada: memakai ulang komponen wizard yang sudah ada, menulis dengan
`client_id` terisi sejak awal.

**RLS.** Policy yang ada hanya `"screenings: staf"`; klien tidak punya hak apa pun. Dibuka tepat dua:

- **Baca** — klien membaca baris yang `client_id`-nya miliknya, supaya Passport tahu apakah ada
  skrining hijau yang belum terpakai. Kolom hash token klaim tidak ikut terbaca.
- **Tulis** — klien TIDAK diberi policy INSERT. Skrining dari Passport ditulis lewat rute
  terautentikasi yang memakai service role, sama seperti rute publik, supaya `hasil`, `flags`, dan
  `kode` tetap ditentukan server dan tidak pernah dikirim peramban.

**Pembatas.** `src/lib/skrining/pembatas.ts` dirancang untuk corong anonim: 5 per menit per kunci IP
dan **30 per menit untuk seluruh aplikasi**. Langit-langit global itu masuk akal ketika skrining
adalah peristiwa sekali seumur corong; ia tidak masuk akal begitu skrining menjadi langkah wajib
pada setiap pemesanan. Rute terautentikasi karena itu memakai ember terpisah berkunci `client_id` —
identitas yang sudah terbukti, bukan header kiriman peramban. Ember anonim tidak disentuh.

### J7 — Mitra dipilih admin dari daftar terurut jarak; transport menyusul, bukan mendahului

Admin melihat permintaan berisi nama klien, layanan & durasi, tanggal & jam, area klien, dan
keterangan skrining hijau. Daftar mitra aktif disajikan **terurut jarak** ke alamat klien — mitra
sudah punya koordinat domisili dan alamat klien sudah punya koordinat, dan `haversineKm()` sudah
ada. Admin menekan satu nama; status berpindah `mencari_mitra` → `mitra_siap`.

Keputusannya tetap di tangan manusia. Penugasan otomatis ditolak karena sistem tidak tahu cuti, jam
kerja, maupun kecocokan keahlian — ia hanya tahu jarak garis lurus, dan `jarak.ts` sendiri sudah
menulis bahwa 4,2 km ke seberang sungai bisa berarti 9 km memutar.

**Transport tidak boleh dihitung sebelum mitra dipilih**, karena tarifnya berasal dari domisili
mitra ke alamat klien. Ini bukan sekadar urutan layar: ia alasan struktural mengapa tagihan tidak
bisa terbit di `diminta`, dan mengapa C2 menyisipkan pembayaran setelah `mitra_siap`.

Skema transportnya **sudah ada dan tidak diubah**: `transport_rates` menyimpan tarif klien dan honor
mitra per jenjang (`0_5`, `5_10`, `10_15`, `15_20`), sementara `di_atas_20` sengaja tidak punya
tarif karena "konfirmasi admin" berarti ketiadaan tarif — nominalnya ditetapkan owner per kasus di
`transport_khusus`. Subsidi soft launch ("klien Rp0, mitra tetap menerima") sudah dapat dinyatakan
hari ini sebagai selisih dua kolom itu; **`subsidy_by_padma` tidak dibuat sebagai kolom**, karena
nominal turunan yang disimpan hanya menambah tempat untuk berselisih dan menabrak money firewall
tanpa memberi apa pun.

### J8 — Admin tidak menolak; klien membatalkan sendiri

Admin untuk sementara **tidak** menolak pengajuan. Tombolnya disembunyikan dengan cara yang sama
seperti saklar paket — nilai enum `ditolak` dan penjaganya tetap di tempatnya, hanya tidak lagi
terjangkau dari layar.

Meniadakan penolakan menutup satu-satunya pintu keluar kedua dari antrean, sementara
`BATAS_PERMINTAAN_MENUNGGU = 5` mengunci klien yang antreannya penuh. Tanpa penambal, klien yang
mengajukan lima tanggal yang tidak bisa dilayani terkunci selamanya dan tidak seorang pun punya cara
membereskannya.

Penambalnya: **klien dapat membatalkan pengajuannya sendiri** selama statusnya belum `dikonfirmasi`.
Kendali atas antrean berpindah ke pemiliknya. Seperti seluruh tulisan klien di repo ini, syaratnya
ditegakkan di DB — kepemilikan lewat `auth.uid()` dan status asal wajib belum terkonfirmasi — bukan
hanya di server action.

Pembatalan **sesi yang sudah terkonfirmasi** adalah perkara lain: ia menyangkut uang dan tenggat
waktu, dan seluruhnya milik C3.

### J9 — Skrining merah boleh diulang; jejaknya yang menjaga

Klien yang mendapat hasil merah boleh mengisi skrining lagi tanpa jeda. Menahannya menghukum orang
yang salah pencet, sementara siapa pun yang berniat mengulang sampai hijau toh bisa membuka jendela
penyamaran.

Yang menjaga adalah **jejak**: setiap hasil merah tersimpan sebagai baris tersendiri dan muncul di
inbox admin seperti sekarang. Pola "mengulang sampai hijau" karena itu terlihat oleh tim. Ini
sejalan dengan kalimat yang sudah ada di layar hasil — skrining adalah pra-skrining, bukan izin
medis, dan tim tetap memverifikasi kondisi sebelum layanan.

### J10 — Rating layanan dan rating bidan: dua angka, satu layar

**Dua penilaian, bukan satu.** Dilebur jadi satu angka, layanan yang salah rancang akan terbaca
sebagai bidan yang buruk: sesi 90 menit yang sebenarnya butuh 120 menit menghasilkan klien kecewa,
dan bintangnya jatuh ke orang yang mengerjakannya dengan benar. Di tim sekecil ini satu bidan
mengerjakan banyak layanan, jadi angka yang tercampur bukan hanya tak berguna — ia tidak adil pada
orang yang nyata. Dua tuas PADMA juga berbeda pemiliknya: katalog dan durasi di tangan owner,
pembinaan tim di tangan admin.

**Rating aplikasi TIDAK dibuat.** Bintang untuk perangkat lunak tidak menunjuk apa pun yang bisa
dikerjakan; mutu aplikasi lebih jujur terbaca dari perilaku (berapa yang memulai skrining tanpa
menyelesaikannya, berapa yang berhenti di tagihan). Dan momennya salah: menit setelah sesi di rumah
klien adalah milik perawatannya, bukan milik perangkat lunak.

**Yang dilihat klien.** Satu kartu di beranda Passport setelah sesi selesai — dua baris bintang
("Bagaimana sesinya?" dan "Bagaimana bidannya?") plus komentar opsional. Bisa diabaikan, hilang
sendiri setelah 30 hari, tidak menghadang apa pun.

**Yang disimpan.** Satu baris per sesi: bintang layanan, bintang bidan, komentar, dan **salinan
siapa bidannya serta varian apa saat itu** — bukan sekadar rujukan ke sesinya. Mitra pada sebuah
sesi bisa berganti (bidan sakit, sesi dijadwalkan ulang di C3), dan penilaian yang menempel lewat
rujukan akan diam-diam berpindah ke orang lain. Penilaian adalah fakta tentang siapa yang datang
hari itu.

**Penjaganya di basis data**, karena klien memegang hak tulis:

- hanya sesi **miliknya** dan hanya yang berstatus `selesai` yang bisa dinilai;
- satu penilaian per sesi (indeks unik) — boleh diperbarui pemiliknya, tidak bisa digandakan;
- bintang dibatasi 1–5 lewat CHECK, komentar dibatasi panjangnya;
- klien membaca miliknya sendiri, staf membaca semua, **tanpa view agregat** — view agregat persis
  yang dulu membocorkan rate card lengkap ke admin di repo ini.

**Yang TIDAK dilakukannya**, ditulis eksplisit supaya tidak merayap: rating tidak memengaruhi honor
mitra, tidak dipakai memilih mitra secara otomatis, dan tidak pernah terlihat oleh klien lain. Ia
alat pembinaan, bukan papan skor.

**Yang dilihat staf.** Admin: daftar penilaian terbaru dengan saringan "bintang ≤ 3". Owner: tren
per bidan dan per layanan, dua kolom terpisah, sehingga pertanyaan "orangnya atau layanannya?" bisa
dijawab. Bidan tidak melihat apa pun — belum ada akun mitra.

Komentar bebas diperlakukan sebagai teks tak tepercaya: disimpan apa adanya, ditampilkan hanya ke
staf, tidak pernah dirender sebagai markup. Ia bisa memuat keterangan kesehatan, jadi tunduk pada
disiplin RLS yang sama dengan data klien lain.

### J11 — Fase klien terisi dari skrining pertama yang tersambung

`clients.phase_id` menjadi **nullable** (keputusan K3 spec pendahulu). Fase tidak ditanyakan saat
mendaftar karena wizard skrining sudah menanyakannya, dan setiap pemesanan wajib berskrining.
Keempat nilai fase pada skrining (`prekonsepsi`, `kehamilan`, `nifas`, `menopause`) memang id
`phases` yang sah — `newborn` sengaja tidak diskrining karena yang diskrining ibunya — jadi
pemetaannya langsung.

Sebelum skrining pertama, fase kosong dan dibaca sebagai "belum ditentukan".
`src/lib/admin/klien.ts` sudah memperlakukan `phase_id` sebagai nullable; yang perlu menyesuaikan
hanya sampul Passport.

### J12 — QRIS asli menggantikan QR palsu

`src/app/passport/_komponen/qris.tsx` sekarang membangkitkan pola QR **dekoratif**, dan halamannya
menulis apa adanya "Contoh QR — bukan untuk dipindai". Klien sudah menyerahkan QRIS sungguhan
(statis, NMID `ID1026557963836`, atas nama "PADMA WOMEN'S WELLNESS HOMEC, KESEHATAN & OLAHRAGA").

Berkasnya dipasang sebagai aset yang bisa diganti lewat pengaturan, bukan ditanam di dalam kode:
kode QRIS bisa berganti, dan penggantiannya tidak boleh menuntut deploy. Nama merchant dan NMID
ditampilkan di sebelah kodenya — klien perlu melihat bahwa yang ia pindai memang PADMA.

Karena QRIS ini **statis**, nominalnya tidak menempel di kode: klien mengetik sendiri jumlahnya.
Konsekuensinya — bagaimana uang masuk dicocokkan dengan tagihan mana — milik C2.

### J13 — Circle bukan sesi rombongan, dan tidak akan menjadi kasus khusus

Ditunda dua kali sebelumnya (spec varian §9 dan spec transport), dengan kalimat "hari ini Circle
baru berarti harga". **Klien menutupnya 8 September 2026: tidak ada pembeda antara Private dan
Circle selain harga.** Pemesan Circle tetap satu orang, satu akun, satu sesi.

Ditulis di sini supaya tidak dibuka lagi sebagai "yang belum dikerjakan": tidak ada yang perlu
dikerjakan. Circle adalah varian berformat lain dengan harga lebih murah, dan formulir pemesanan
memperlakukannya persis seperti varian mana pun. Tidak ada peserta jamak, tidak ada transport
patungan, tidak ada honor yang dibagi.

## Utang terbuka yang menunggu jawaban klien

Bukan bagian C1, tetapi ditulis di sini supaya tidak hilang lagi — semuanya sempat terparkir di
spec lama dan baru terangkat kembali lewat penyisiran 8 September.

**1. Paket bundling RS.** Catatan klien 6 September yang belum terjawab: *"Paket bundling dengan
RS, misal beli 1 paket isinya beberapa layanan, tapi yang beli 1 orang — penjadwalan di web
bagaimana? Karena layanan tidak selesai 1 waktu tapi beberapa waktu."* Yang harus diputuskan
sebelum paket dibuka kembali:

- apakah pembeli dan penerima layanan boleh orang yang berbeda (RS membeli untuk pasiennya);
- apakah tiap layanan di dalam paket dijadwalkan terpisah — dan bila ya, apakah masing-masing
  butuh skriningnya sendiri, mengingat J3 mengikat skrining ke tiap pengajuan;
- kapan paket dianggap lunas bila jadwalnya tersebar berminggu-minggu;
- bagaimana paket masuk ke rantai status C1 yang dirancang tanpa memikirkannya.

Peta jalan 6 September menaruh paket sebagai spec ke-3 dan rangkaian status ke-4; urutan itu
sekarang terbalik atas keputusan klien.

**Jawaban kandidat — dicatat supaya pembahasan nanti tidak mulai dari nol.** Kekhawatiran di balik
catatan itu ("layanan tidak selesai satu waktu") mengandaikan paket menuntut model penjadwalan
tersendiri. Kemungkinan besar tidak: **paket adalah pembelian, bukan jadwal.** Membeli paket
menerbitkan beberapa **hak sesi** — objek yang sama persis dengan kredit layanan di C3, hanya
berjumlah lebih dari satu. Tiap hak ditebus lewat pengajuan jadwal biasa: skriningnya sendiri,
jamnya sendiri, mitranya sendiri, kapan pun klien mau, sampai masa berlakunya habis. Bila begitu,
"beberapa waktu" bukan masalah yang perlu dipecahkan — ia perilaku bawaan, dan rantai status C1
tidak perlu tahu apa pun tentang paket; ia hanya melihat pengajuan yang kebetulan lahir sudah
lunas. Syaratnya satu: kredit di C3 memang dikerjakan dalam bentuk hak sesi. Satu hak dan sepuluh
hak adalah mekanisme yang sama.

Yang tetap tidak bisa ditebak dan wajib ditanyakan: apakah pembeli boleh berbeda dari penerima
layanan (RS membayar, pasiennya yang dirawat).

**2. Katalog produksi masih dummy.** Gambar alur klien menyebut "Garbha Relief · 90 menit ·
Rp179.000"; angka itu tidak ada di repo. Katalog di `seed.sql` adalah data karangan (keputusan #12)
dan pricelist asli harus diisi klien lewat panel sebelum live. Menyertainya: ~25 berkas uji yang
terikat UUID seed dan harus dilepaskan (butir V10 spec varian).

**3. Honor mitra untuk jenjang transport selain 0–5 km belum pernah diisi.** Sisi tarif klien sudah
ada; sisi honornya kosong, dan tanpa itu rekap owner tidak bisa menghitung pengeluaran transport.

**4. Logo versi vektor untuk cetak.** Versi transparan sudah diterima dan cukup untuk web.

## Di luar ruang lingkup C1

Disebut eksplisit supaya tidak dikira sudah beres:

- **Pembayaran sebagai syarat konfirmasi** (`menunggu_bayar`), pencocokan uang masuk, dan tenggat
  bayar — **C2**. Pembayaran tetap manual: QRIS lalu diverifikasi admin. Payment gateway ditolak
  untuk sekarang.
- **Pemberitahuan tiga kanal** (WhatsApp siap-kirim, email otomatis, keadaan di Passport) — **C2**,
  karena peristiwa yang memicunya adalah terbitnya tagihan.
- **Pembatalan berjenjang waktu, jadwal ulang, kredit layanan, penanda berangkat & no-show,
  peninjauan darurat medis** — **C3**.
- **Pemeriksaan pra-sesi** (*change-of-condition check*) — ditunda atas keputusan klien; untuk
  sementara urusan SOP lapangan, bukan urusan sistem.
- **Promo dan kode promo** — ditunda. `harga_coret` yang sudah ada dianggap memadai.
- **Seluruh perkara paket** — disembunyikan di balik saklar (Tahap A spec pendahulu), tidak
  dirancang ulang. Formulir pemesanan C1 karena itu hanya menawarkan **durasi (varian)**, bukan
  paket.
- **Akun dan panel mitra** — belum ada. Karena itu `berjalan` → `selesai` ditandai admin, dan bidan
  tidak melihat penilaian dirinya.
- **Sesi rombongan** — bukan sekadar ditunda: J13 menyatakan ia tidak ada.

## Konsekuensi yang sudah diketahui

- **`screening_id NOT NULL` memerahkan 18 titik insert `booking_requests` di 7 berkas test**
  (`admin-agenda`, `admin-sesi-konfirmasi`, `admin-shell`, `hak-hapus-berlebih`, `passport-data`,
  `passport-keamanan`, `passport-pembatas-jadwal`). Penambalnya satu helper
  `tests/helpers/skrining.ts` yang menerbitkan skrining hijau untuk klien uji, dipakai di ke-18
  titik itu.
- **`tests/e2e/funnel-skrining.e2e.ts` akan merah** — ia berakhir di WhatsApp. Harus ditulis ulang
  sampai ke pemesanan.
- **Menambah jam pada sesi menyentuh setiap layar yang menampilkan tanggal sesi**: agenda admin,
  kartu "sesi berikutnya" di Passport, riwayat sesi, dan rekap owner.
- **Mengganti nilai enum menyentuh setiap tempat yang membandingkan status** — termasuk
  `guard_booking_status` yang menyimpan nilai hardcoded, dan test yang mengasersikan kalimatnya.
- **Klien yang dibuat admin dari nol lahir tanpa skrining**, jadi belum bisa mengajukan jadwal.
  Panel admin menampilkan penanda jelas; jalur wajarnya mengonversi dari inbox skrining.
- **`README.md` wajib diperbarui**: `tests/inventaris-rute.test.ts` menjaga tabel rute dua arah.

## Pengujian

Mengikuti disiplin yang sudah berlaku di repo, tanpa perkakas baru.

- **Rantai status** — setiap perpindahan yang sah diuji, dan setiap perpindahan yang tidak sah
  ditolak DB (mis. `diminta` → `dikonfirmasi` melompati `mitra_siap`).
- **Konfirmasi tetap melahirkan tepat satu sesi** — pengerasan lama tidak boleh hilang saat rantai
  diperpanjang. Dua konfirmasi bersamaan tetap menghasilkan satu sesi.
- **Gerbang skrining diuji per lapis**, termasuk satu test yang menembak `booking_requests`
  langsung ke DB untuk membuktikan lapis ketiga benar-benar menahan — pola
  `money-firewall-struktural.test.ts`.
- **Klaim skrining** — kedaluwarsa ditolak, sekali pakai, tidak bisa diklaim dua akun, dan nama
  akun tidak tertimpa.
- **RLS `screenings`** — klien membaca miliknya sendiri; klien lain mendapat nol baris; klien tidak
  punya hak INSERT.
- **Pembatas terautentikasi** — ember `client_id` terpisah dari ember anonim; menghabiskan jatah
  satu klien tidak memengaruhi klien lain maupun corong publik.
- **Pembatalan oleh klien** — klien lain tidak bisa membatalkan pengajuan orang; pengajuan yang
  sudah dikonfirmasi tidak bisa dibatalkan lewat jalur ini. Ditembak langsung ke DB.
- **Rating** — hanya sesi milik sendiri yang berstatus `selesai` yang bisa dinilai; satu baris per
  sesi; bintang di luar 1–5 ditolak; klien lain mendapat nol baris; salinan mitra tidak ikut
  berubah ketika mitra pada sesinya diganti.
- **Jam & zona waktu** — fungsi murni yang menghitung "berapa jam lagi sesinya" diuji dengan
  tanggal yang melintasi pergantian hari Jakarta vs UTC.
- **Urutan mitra menurut jarak** — fungsi murni atas koordinat, tanpa DB.
- **E2E** — corong penuh: skrining → daftar → pilih jam → admin pilih mitra → konfirmasi → sesi
  selesai → rating.

## Prasyarat

- **Migrasi penanam `phases` wajib ada sebelum C1 hidup di produksi.** `phases` hanya diisi
  `supabase/seed.sql` dan `supabase db push` tidak menjalankannya; di produksi tabel itu lahir
  kosong. `clients.phase_id` menunjuk `phases(id)`, jadi J11 akan melanggar foreign key pada klien
  pertama.
- **Berkas QRIS** dari klien harus sudah berada di repo sebelum J12 dikerjakan.
- **Tahap A dan B** spec pendahulu selesai lebih dulu: A karena formulir pemesanan tidak boleh lagi
  menawarkan paket, B karena pemesanan mandiri butuh akun mandiri.

## Risiko utama

**Rantai status yang diperpanjang menyentuh jantung operasional.** Agenda admin, konfirmasi sesi,
rekap owner, dan Passport semuanya membaca status. Perubahan enum adalah jenis perubahan yang gagal
diam-diam: kode yang membandingkan dengan nilai lama tidak error, ia hanya berhenti cocok, dan
akibatnya berbentuk permintaan yang tidak pernah muncul di layar siapa pun. Karena itu setiap
perbandingan status wajib melewati satu tempat, dan test perpindahan status di atas adalah pagarnya.
