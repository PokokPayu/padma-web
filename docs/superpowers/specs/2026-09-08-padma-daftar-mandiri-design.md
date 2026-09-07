# PADMA — Pendaftaran Mandiri, Halaman Auth, dan Skrining sebagai Syarat Memesan

**Tanggal:** 8 September 2026
**Pendahulu:** `docs/superpowers/specs/2026-08-26-padma-v1-design.md` (model penautan akun),
`docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md` (butir K8 — logo ditunda).

> **Diperbarui 8 September 2026 (sore).** Tahap C dokumen ini — corong skrining, `screening_id`,
> gerbang pemesanan, pembatalan oleh klien — **PINDAH** ke
> `docs/superpowers/specs/2026-09-08-padma-c1-fondasi-jadwal-design.md`, yang memperluasnya dengan
> jam sesi, rantai status dua objek, pemilihan mitra, dan rating. Sebabnya: klien memutuskan
> merancang seluruh siklus hidup pemesanan sekarang, dan mengerjakan Tahap C lebih dulu berarti
> membangun di atas `booking_requests` yang justru akan dirombak. Keputusan K8, K9, K10, K12, K13,
> K15, dan K16 di bawah tetap berlaku sebagai catatan alasan, tetapi yang dieksekusi adalah
> versinya di spec C1. **Tahap A dan B tidak berubah.**

## Masalah

Empat hal berdiri sendiri-sendiri tetapi bertemu di satu tempat: pintu masuk aplikasi.

1. **Halaman `/masuk` tidak seperti prototipe yang disetujui klien.** Yang ada: kartu putih di
   tengah layar. Yang disetujui: panggung dua kolom — sisi hijau bercerita, sisi putih berisi
   formulir (`padma-prototype.html` baris 326–348 dan 972–1005).

2. **Tidak ada jalan mendaftar sendiri.** Model sekarang: admin membuat data klien, lalu klien
   mengaktifkannya lewat tautan undangan WhatsApp. Klien menghendaki **dua jalur**: orang bisa
   mendaftar sendiri, dan admin tetap bisa membuatkan.

3. **Tidak ada pemulihan kata sandi.** Klien yang lupa sandi tidak punya jalan selain menghubungi
   admin.

4. **Corong skrining berhenti di WhatsApp.** Orang menyelesaikan skrining, dinyatakan hijau, lalu
   dilempar keluar aplikasi. Padahal alur pemesanan yang sebenarnya adalah **skrining dulu, baru
   pesan** — dan itu belum diwujudkan di mana pun dalam kode.

Ditambah satu utang yang syaratnya baru terpenuhi: butir **K8** spec 7 September menunda logo
karena aset yang ada berlatar hijau bertekstur. Klien sudah mengirim `web/public/logo-padma.png`
— 1264px, latar benar-benar transparan (rerata alpha 16/255, diukur). Untuk web, K8 tidak lagi
terblokir.

## Keputusan

### K1 — Pendaftaran mandiri diizinkan; penautan tetap butuh bukti

Ini pembalikan sadar atas catatan keras di `src/lib/auth/link-client.ts`, dan alasannya harus
tercatat supaya tidak dibaca sebagai kelalaian.

Dulu "email cocok" ditolak sebagai bukti kepemilikan — benar, karena saat itu email **tidak pernah
dibuktikan**: `[auth.email] enable_confirmations = false` membuat GoTrue meng-auto-confirm setiap
pendaftaran mandiri. Menebak alamat email klien sudah cukup untuk dianggap pemiliknya.

Sejak 28 Agustus 2026 `enable_confirmations = true` (`supabase/config.toml`). Yang berubah bukan
pendapat, melainkan fakta: email kini dibuktikan sebelum sesi diberikan. Karena itu penautan
berdasarkan email terverifikasi menjadi sah.

**Konsekuensinya harus dipikul terbuka:** konfirmasi email naik pangkat dari lapis kedua menjadi
penopang utama. Bila ia dimatikan, celah lama hidup kembali. Karena itu K7 memasang pagar yang
membuat `npm test` merah bila setelan itu berubah.

### K2 — Satu gerbang: `pastikanKlien()` di `/setelah-masuk`

Semua jalur masuk — email+sandi, Google, tautan undangan — bermuara di rute yang sudah ada, dan
rute itu memanggil satu fungsi di `src/lib/auth/pastikan-klien.ts`. Urutan keputusannya tetap:

| # | Syarat | Tindakan |
|---|---|---|
| 1 | `clients.user_id = user.id` sudah ada | → `/passport` |
| 2 | ada cookie undangan | `linkClientByInvite` — **kode lama, tidak disentuh** |
| 3 | `email_confirmed_at` terisi **dan** ada baris klien beremail sama yang belum tertaut | `tautkanKlienLewatEmailTerverifikasi` |
| 4 | `email_confirmed_at` terisi, tidak ada baris klien | terbitkan baris klien baru |
| 5 | `email_confirmed_at` kosong | → `/periksa-email` |

Langkah 5 adalah yang menjaga 3 dan 4. Selama ia berdiri, "email cocok" tidak pernah cukup — yang
cukup adalah "email cocok **dan** sudah dibuktikan".

**Bentuk fungsi langkah 3 mengikat, bukan selera.** Ia menerima objek user Supabase utuh dan
memeriksa `email_confirmed_at` di dalam dirinya sendiri. Ia TIDAK boleh menerima string email
telanjang: fungsi berbentuk begitu adalah `linkClientByEmail` yang dulu dihapus, dan selama fungsi
seperti itu ada, celahnya bisa kambuh hanya dengan satu pemanggilan dari rute baru.

Alasan satu gerbang, bukan logika per-halaman: duplikasi aturan keamanan di dua tempat adalah cara
kedua celah terdahulu lahir. Trigger database ditolak karena tidak bisa membedakan "datang dengan
undangan" dari "daftar mandiri" — padahal justru pembedaan itu intinya.

### K3 — Baris klien mandiri lahir sudah bertuan

Langkah 4 menerbitkan baris `clients` dengan `user_id` terisi sejak INSERT. Tidak ada jendela
waktu ketika baris itu menganggur dan bisa diperebutkan.

- `nama` dan `no_hp` datang dari `user_metadata` yang diisi formulir pendaftaran. `full_name`
  sudah otomatis mengalir ke `profiles.nama` lewat trigger `handle_new_user` yang ada.
- Metadata dikendalikan pengguna, jadi keduanya divalidasi di server: nama dipangkas dan dibatasi
  panjang, `no_hp` dinormalkan. Efeknya hanya pada baris miliknya sendiri — tidak ada hak yang
  bisa diraih dari sana.
- **Fase TIDAK ditanyakan saat mendaftar dan `clients.phase_id` menjadi NULLABLE.** Alasannya:
  setiap pemesanan wajib didahului skrining (K8), dan wizard skrining sudah menanyakan fase.
  Menanyakannya dua kali berarti meminta orang menjawab hal yang sama dua kali, lalu menyimpan dua
  jawaban yang bisa berbeda. Fase diisi dari skrining pertama yang tersambung; sebelum itu ia
  kosong dan dibaca sebagai "belum ditentukan".

  Keempat nilai fase pada skrining (`prekonsepsi`, `kehamilan`, `nifas`, `menopause`) memang id
  `phases` yang sah — `newborn` sengaja tidak diskrining karena yang diskrining adalah ibunya. Jadi
  pemetaannya langsung, tanpa penerjemahan.

  Ongkosnya kecil: `src/lib/admin/klien.ts` sudah memperlakukan `phase_id` sebagai nullable dan
  menampilkan "—". Yang perlu menyesuaikan hanya sampul Passport (`src/lib/passport/data.ts` dan
  `_komponen/sampul.tsx`). Alternatif "fase palsu bernama Belum Ditentukan di tabel `phases`"
  ditolak: tabel itu juga menggerakkan katalog layanan dan materi, sehingga fase palsu akan muncul
  di tempat yang tidak diduga.
- Peran tidak bisa dinaikkan lewat jalur ini: `handle_new_user` selalu membuat profil berperan
  `klien`, dan `trg_guard_profile_role` menolak peran non-klien dari jalur non-service-role.
  Pertahanan ini sudah ada; spec ini memakainya, bukan membuatnya.
- `padma_id` terbit lewat `buatPadmaId` yang sudah ada.

**Balapan** ditangani seperti pola PADMA ID: dua permintaan bersamaan bisa sama-sama sampai
langkah 4 dan menabrak `clients_email_key` atau `clients_padma_id_key`. Kode 23505 tidak dilempar
sebagai error — ia diartikan "ada yang mendahului", lalu alurnya balik ke langkah 1. DB tetap
penjaga terakhir.

### K4 — Satu panggung untuk lima halaman auth

Komponen `src/app/_auth/panggung.tsx` (folder berawalan `_` bukan segmen URL — pola `_landing` dan
`_shell` yang sudah dipakai). Kartu 900px, dua kolom `1fr 1.1fr`, sudut 26px, kolom kiri `night`
dengan radial-gradient — angkanya langsung dari prototipe. Di bawah 860px kolom menumpuk; sisi
hijau tetap ada sebagai kepala pendek karena ia yang membawa logo.

| Rute | Panel kiri | Isi kanan |
|---|---|---|
| `/masuk` (ubah) | "Passport Anda menunggu." | email, sandi, lupa sandi, Google, tautan ke daftar |
| `/daftar` (baru) | "Mulai perjalanan Anda." | nama, email, WhatsApp, sandi, Google |
| `/lupa-sandi` (baru) | "Tenang, ini bisa dipulihkan." | email → kirim tautan |
| `/atur-sandi` (baru) | idem | sandi baru + ulangi |
| `/periksa-email` (baru) | "Satu langkah lagi." | instruksi + kirim ulang |

`/akun-belum-terhubung` ikut memakai panggung yang sama.

**Batasan yang mengikat:** `tests/e2e/access-matrix.e2e.ts` baris 100–108 mengisi `/masuk` lewat
`getByLabel("Email")`, `getByLabel("Kata sandi")`, dan tombol bernama persis `"Masuk"`. Ketiga nama
itu wajib bertahan.

Mode demo dari prototipe **tidak** dibawa — ia alat presentasi, bukan fitur produk.

### K5 — Logo: PNG di latar gelap, teratai vektor untuk favicon

PNG dipasang di panel hijau; gold di atas hijau tua adalah pemakaian yang logonya memang dirancang
untuknya. Ia **tidak** dipakai di atas latar terang: emas bergradasi di atas krem `paper-warm`
kehilangan kontras.

Favicon **tidak** memakai PNG ini. Cincin teksnya ("PREMIUM WOMEN'S WELLNESS HOMECARE") jadi bubur
di 32px; yang terbaca di ukuran itu hanya teratainya, dan bentuk teratai sudah ada sebagai vektor
bersih di `src/app/_landing/lotus.tsx`. Jadi `src/app/icon.svg` memakai teratai emas.

Ini menutup butir K8 spec 7 September **untuk web**. Yang tetap jadi utang ke klien: **versi
vektor (SVG/AI/PDF) untuk cetak.**

### K6 — Lupa sandi, dan tujuan redirect yang dibatasi daftar putih

`/lupa-sandi` memanggil `resetPasswordForEmail`; tautannya mendarat di `/auth/callback` lalu ke
`/atur-sandi`. Ini menuntut `/auth/callback` menerima parameter tujuan — dan parameter tujuan yang
diterima mentah adalah open redirect.

Tujuan hanya diterima dari daftar putih pendek (`/atur-sandi`, `/setelah-masuk`); apa pun di
luarnya jatuh ke `/setelah-masuk`. Diuji sebagai fungsi murni `tujuanAman(next)`.

Balasan `/lupa-sandi` **selalu sama** entah emailnya terdaftar atau tidak, supaya halaman itu tidak
menjadi alat menebak siapa saja klien PADMA.

Panjang sandi minimum dinaikkan 6 → 8 di `config.toml`. Enam terlalu pendek untuk akun yang
memegang catatan medis, dan sandi kini bukan lagi barang yang hanya dipegang admin.

### K7 — Pagar fail-closed atas setelan yang menopang K1

`tests/konfirmasi-email-wajib.test.ts` membaca `supabase/config.toml` dan menuntut
`enable_confirmations = true` serta `minimum_password_length >= 8`. Test ini murni membaca berkas,
tanpa DB.

Alasannya lurus: K1 sah **karena** setelan itu menyala. Setelan yang menopang keputusan keamanan
tetapi tidak dijaga test adalah setelan yang suatu hari mati diam-diam.

### K8 — Skrining melekat pada pengajuan, bukan pada akun

Aturan bisnisnya: **skrining setiap kali akan memesan.** Karena itu skrining bukan status akun
melainkan lampiran pada tiap pengajuan.

- `booking_requests` mendapat kolom `screening_id` **NOT NULL**. Belum rilis, jadi tidak ada
  migrasi data — tetapi ada ongkos di test, lihat Konsekuensi.
- Satu skrining hijau menopang **tepat satu** pengajuan. Setelah terpakai ia hangus — dijaga
  indeks unik pada `booking_requests(screening_id)` ditambah guard.
- Alur "Ajukan Jadwal" berubah: wizard skrining dulu → bila hijau, lanjut ke formulir jadwal.

**Gerbang tiga lapis**, mengikuti cara `guard_booking_pembatas` dan money firewall sudah dikerjakan:

1. **Passport** — tanpa skrining hijau yang belum terpakai, yang tampil adalah ajakan skrining
2. **Server action** `ajukanJadwal` menolak dengan pesan yang bisa dibaca manusia
3. **DB** — `guard_booking_skrining` menolak baris dari klien tanpa skrining hijau miliknya yang
   belum terpakai

Lapis ketiga bukan hiasan: klien memegang policy INSERT atas `booking_requests` dan bisa memanggil
PostgREST langsung, persis alasan `guard_booking_pembatas` ada.

`/passport/skrining` memakai ulang komponen wizard yang ada, menulis dengan `client_id` terisi
sejak awal. Tanpa halaman ini aturannya berubah jadi jalan buntu bagi siapa pun yang mendaftar
lewat `/daftar` tanpa pernah skrining.

### K9 — Penyambungan skrining anonim memakai token klaim, bukan kode

Skrining di landing diisi anonim (nama + no. HP, tanpa email); akun berdiri di atas email. Jadi
hasil skrining perlu jalan untuk menempel ke akun yang baru jadi.

**Kodenya tidak dipakai sebagai kunci.** `src/lib/skrining/kode.ts` sengaja membuat kode yang mudah
dibacakan lewat telepon: prefiks semenit + sufiks 4 karakter, ~1 juta kemungkinan per menit. Itu
tiket layanan pelanggan, bukan kredensial. Menjadikannya kunci berarti orang bisa menebak kode
orang lain lalu menyedot jawaban kesehatannya ke Passport sendiri.

Yang dipakai: **token klaim** 32 byte dari CSPRNG, hash SHA-256-nya disimpan di baris `screenings`,
tokennya dititipkan di cookie `httpOnly` — pola yang sama persis dengan token undangan, termasuk
sekali-pakai dan klaim atomik.

**Umur token 2 jam, dan itu bukan hiasan.** Tanpa batas itu, satu perangkat bersama — HP di ruang
tunggu — membuat orang kedua yang mendaftar mewarisi skrining orang pertama lengkap dengan jawaban
kesehatannya. Sebagai lapis kedua, saat klaim berhasil Passport menyebut nama pada skrining itu
secara terbuka ("Skrining atas nama **X** telah disambungkan"), supaya salah sambung terlihat.

### K10 — Layar hasil skrining: hijau ke aplikasi, merah ke manusia

- **Hijau** — tombol utama "Buat akun & pesan layanan" (`/daftar`, dengan tautan ke `/masuk` bagi
  yang sudah punya akun). Di bawahnya tautan kecil "atau tanya tim dulu via WhatsApp".
- **Merah** — tetap WhatsApp, tanpa perubahan. Yang dibutuhkan memang bicara dengan tim, bukan
  memesan.

### K11 — Paket disembunyikan di balik satu saklar, bukan dibongkar

Klien meminta seluruh tampilan paket hilang dari sisi klien maupun admin sementara pertanyaan
tentang paket masih terbuka. Penyisiran menemukan paket menyentuh **31 berkas sumber dan 27 berkas
test**, termasuk sampul Passport, halaman Bayar di kedua sisi, rekap owner, dan
`money-firewall-struktural.test.ts`.

Membongkarnya berarti menulis ulang 27 test yang sudah hijau supaya hijau lagi dalam bentuk lain —
kerja besar yang hasilnya tak terlihat siapa pun, untuk keadaan yang **sementara**.

Karena itu: konstanta `PAKET_TAMPIL = false` di satu berkas, dan setiap blok tampilan paket
dibungkus saklar itu. Yang terlihat sama persis dengan yang diminta; menyalakannya kembali nanti
satu baris. Logika data, RLS, dan pagar uang tidak disentuh, sehingga test yang ada tetap hijau apa
adanya. Yang ditambahkan: test yang membuktikan dengan saklar mati, paket tidak muncul di mana pun.

Jalur `ajukanJadwal(jenis: "paket")` ikut tertutup di sisi klien, sehingga tidak ada pintu belakang
memesan tanpa skrining.

### K12 — Penolakan pengajuan ditiadakan; klien membatalkan sendiri

Admin untuk sementara **tidak** menolak pengajuan jadwal. Tombolnya disembunyikan dengan cara yang
sama seperti K11 — saklar, bukan pembongkaran; nilai enum `booking_status.ditolak` dan penjaganya
tetap di tempatnya.

Meniadakan penolakan menutup satu-satunya pintu keluar kedua dari status "menunggu", sementara
`BATAS_PERMINTAAN_MENUNGGU = 5` mengunci klien yang antreannya penuh. Tanpa penambal, klien yang
mengajukan lima tanggal yang tidak bisa dilayani akan terkunci selamanya dan tidak seorang pun
punya cara membereskannya.

Penambalnya: **klien dapat membatalkan pengajuannya sendiri** selama statusnya masih "menunggu".
Kendali atas antrean berpindah ke pemiliknya, dan admin tetap tidak perlu menolak siapa pun.
Seperti seluruh tulisan klien di repo ini, syaratnya ditegakkan di DB (kepemilikan lewat
`auth.uid()` dan status asal wajib "menunggu"), bukan hanya di server action.

Pertanyaan "kalau pengajuan dibatalkan, skriningnya bagaimana?" ikut terjawab oleh K8: satu skrining
menopang tepat satu pengajuan dan hangus setelah dipakai. Membatalkan tidak menghidupkannya kembali.

### K13 — Skrining merah boleh diulang, dan setiap kali tercatat

Klien yang mendapat hasil merah boleh mengisi skrining lagi tanpa jeda. Menahannya akan menghukum
orang yang salah pencet, sementara siapa pun yang berniat mengulang sampai hijau toh bisa membuka
jendela penyamaran.

Yang menjaga bukan jeda, melainkan **jejak**: setiap hasil merah tersimpan sebagai baris tersendiri
dan muncul di inbox admin seperti sekarang. Pola "mengulang sampai hijau" karena itu terlihat oleh
tim, bukan tersembunyi. Ini sejalan dengan kalimat yang sudah ada di layar hasil — skrining adalah
pra-skrining, bukan izin medis, dan tim tetap memverifikasi kondisi sebelum layanan.

### K14 — Undangan WhatsApp tetap ada, tetapi jadi pilihan kedua

Penautan lewat email terverifikasi (K1) membuat tautan undangan tidak lagi menjadi satu-satunya
jalan: admin cukup meminta klien mendaftar sendiri dengan email yang sudah didaftarkan. Jalur
undangan tetap dipertahankan — kodenya sudah teruji dan berguna untuk klien yang perlu dituntun —
tetapi panel admin menempatkan "minta klien mendaftar sendiri" sebagai anjuran utama dan tautan
undangan sebagai cadangan.

Tidak ada kode penautan yang dihapus. Menghapus pertahanan yang sudah teruji demi kerapian adalah
perdagangan yang buruk.

### K15 — RLS `screenings` dibuka secukupnya untuk klien

Policy yang ada hanya `"screenings: staf"`; klien tidak punya hak apa pun atas tabel itu. K8 dan K9
menuntut dua hal baru, dan hanya dua:

- **Baca:** klien boleh membaca baris `screenings` yang `client_id`-nya miliknya. Dibutuhkan agar
  Passport tahu apakah ada skrining hijau yang belum terpakai.
- **Tulis:** klien TIDAK diberi policy INSERT. Skrining dari dalam Passport ditulis lewat rute
  terautentikasi yang memakai service role, sama seperti rute publik — supaya `hasil`, `flags`, dan
  `kode` tetap ditentukan server, tidak pernah dikirim peramban.

Kolom hash token klaim (K9) tidak ikut terbaca klien.

### K16 — Skrining dari dalam Passport punya pembatasnya sendiri

`src/lib/skrining/pembatas.ts` dirancang untuk corong anonim: 5 per menit per kunci IP, dan
**30 per menit untuk seluruh aplikasi**. Langit-langit global itu masuk akal ketika skrining adalah
peristiwa sekali seumur corong; ia tidak masuk akal begitu skrining menjadi langkah wajib pada
setiap pemesanan, karena lonjakan wajar klien yang sudah login bisa menabraknya.

Karena itu rute skrining terautentikasi memakai ember terpisah dengan kunci `client_id` — identitas
yang sudah terbukti, bukan header kiriman peramban. Ember anonim tidak disentuh.

### K17 — Bentrok email di panel admin dijawab dengan kalimat

Setelah pendaftaran mandiri hidup, admin bisa membuat data klien beremail sama dengan akun yang
sudah mendaftar sendiri. Yang muncul sekarang adalah pelanggaran `clients_email_key` mentah.

Server action klien menangkap 23505 pada kolom email dan menjawab: "Email ini sudah punya akun
PADMA" beserta tautan ke data klien yang sudah ada. Tidak ada penggabungan otomatis — admin melihat
datanya lalu memutuskan sendiri.

## Ruang lingkup & urutan

| Tahap | Isi | Sifat |
|---|---|---|
| **A** | K11 — sembunyikan paket di balik saklar | Sapuan luas, dangkal, risiko rendah |
| **B** | K1–K7, K14, K17 — halaman auth, pendaftaran mandiri, lupa sandi, logo | Halaman baru + perubahan model penautan |
| ~~**C**~~ | Pindah ke spec C1 (lihat catatan di kepala dokumen) | — |

Urutannya mengikat: C1 membangun formulir pengajuan yang tidak boleh lagi menawarkan paket (jadi A
lebih dulu), dan C1 butuh akun mandiri dari B untuk punya arti. Rencana implementasi memberi titik
henti di antara tahap-tahapnya.

## Di luar ruang lingkup

- **Seluruh perkara paket** — masih banyak yang harus ditanyakan ke klien. Paket hanya disembunyikan
  (K11), tidak dirancang ulang.
- **Logo versi vektor untuk cetak** — menunggu aset dari klien.
- **Penggabungan data klien ganda** — tidak diperlukan: K1 langkah 3 menautkan ke baris yang sudah
  ada, jadi duplikat tidak terbentuk lewat jalur normal.
- **Tombol pintas admin untuk melewati syarat skrining** — sengaja tidak dibuat. Aturannya
  menyeluruh; tombol semacam itu adalah cara aturan mati pelan-pelan. Bila kelak admin perlu
  menjadwalkan untuk klien yang datang lewat telepon, itu keputusan terpisah dengan jejak audit
  sendiri.

## Konsekuensi yang sudah diketahui

- **`tests/e2e/funnel-skrining.e2e.ts` akan merah** — ia berakhir di WhatsApp. Harus ditulis ulang
  sampai ke pemesanan. Ini bagian dari pekerjaan, bukan kejutan di akhir.
- **Klien yang dibuat admin dari nol lahir tanpa skrining**, jadi belum bisa mengajukan jadwal.
  Panel admin menampilkan penanda jelas; jalur wajarnya adalah mengonversi dari inbox skrining.
- **Orang yang mendaftar lewat `/daftar` tanpa pernah skrining** juga belum bisa memesan — itulah
  sebabnya `/passport/skrining` wajib ada (K8).
- **`screening_id NOT NULL` memerahkan 18 titik insert `booking_requests` di 7 berkas test**
  (`admin-agenda`, `admin-sesi-konfirmasi`, `admin-shell`, `hak-hapus-berlebih`, `passport-data`,
  `passport-keamanan`, `passport-pembatas-jadwal`). Bukan penulisan ulang: satu helper
  `tests/helpers/skrining.ts` yang menerbitkan skrining hijau untuk klien uji, lalu dipakai di
  ke-18 titik itu. Diketahui sejak sekarang supaya tidak muncul sebagai kejutan di tengah Tahap C.
- **Menyembunyikan tombol tolak akan menyentuh test antrean admin** (`admin-sesi-konfirmasi`,
  `admin-shell`). Jalur penolakan di server dan DB tetap ada dan tetap diuji; yang berubah hanya
  keterjangkauannya dari layar.
- **Nama pada skrining tidak menimpa nama akun.** Skrining anonim menyimpan nama dan no. HP sendiri;
  saat diklaim, keduanya TIDAK menindih data akun. Yang berpindah hanya `client_id`, dan `phase_id`
  bila masih kosong. Klien yang menuliskan namanya berbeda saat skrining tidak boleh mendapati nama
  akunnya berubah diam-diam.
- **`README.md` wajib diperbarui**: `tests/inventaris-rute.test.ts` menjaga tabel rute dua arah.

## Pengujian

Mengikuti disiplin yang sudah berlaku di repo, tanpa perkakas baru.

- **Validator murni** (`src/lib/auth/daftar.ts`) — email dinormalkan, sandi ≥ 8, nama tidak
  kosong, no. HP dinormalkan. Tanpa DB. (Fase tidak lagi divalidasi di sini: K3 menghapusnya dari
  formulir pendaftaran.)
- **Keamanan penautan** (`tests/penautan-email-terverifikasi.test.ts`, pola
  `penautan-undangan.test.ts`): email belum terverifikasi + ada baris klien beremail sama → tidak
  tertaut; terverifikasi + baris sudah dimiliki orang lain → tidak bisa direbut; terverifikasi +
  baris belum tertaut → tertaut; terverifikasi + tidak ada baris → baris baru bertuan sejak INSERT.
- **Pagar fail-closed** (K7).
- **Open redirect** — `tujuanAman(next)` diuji dengan `//jahat.com`, `https://jahat.com`, `/admin`,
  `/atur-sandi`.
- **Render halaman** lewat `renderToStaticMarkup` untuk kelima halaman auth, termasuk memastikan
  `/masuk` memuat tautan ke `/daftar` dan `/lupa-sandi`.
- **Klaim skrining** — kedaluwarsa ditolak, sekali pakai, tidak bisa diklaim dua akun.
- **Gerbang pemesanan diuji per lapis**, termasuk satu test yang menembak `booking_requests`
  langsung ke DB untuk membuktikan lapis ketiga benar-benar menahan — pola
  `money-firewall-struktural.test.ts`.
- **Saklar paket** — dengan `PAKET_TAMPIL = false`, paket tidak muncul di keluaran render mana pun.
- **Pembatalan oleh klien** (K12) — klien membatalkan pengajuannya sendiri; klien lain TIDAK bisa
  membatalkan pengajuan orang, dan pengajuan yang sudah dikonfirmasi tidak bisa dibatalkan. Ditembak
  langsung ke DB, bukan lewat server action saja.
- **RLS `screenings`** (K15) — klien membaca skriningnya sendiri; klien lain mendapat nol baris;
  klien tidak punya hak INSERT.
- **Pembatas terautentikasi** (K16) — ember `client_id` terpisah dari ember anonim; menghabiskan
  jatah satu klien tidak memengaruhi klien lain maupun corong publik.
- **Bentrok email admin** (K17) — 23505 pada email dijawab kalimat, bukan dilempar.
- **E2E** — skrip baru untuk pendaftaran mandiri, dirangkai ke `test:e2e:semua`.

**Batas jujur:** E2E pendaftaran menguji gerbang `/setelah-masuk` dengan user yang dibuat lewat
service role (`email_confirm: true`), pola `scripts/seed-users.ts`. Kaki "email konfirmasi
benar-benar terkirim dan tautannya bekerja" TIDAK diuji otomatis — ia menuntut membaca kotak surat
lokal. Kaki itu masuk runbook sebagai pemeriksaan manual sebelum rilis.

## Prasyarat produksi

- **SMTP sendiri wajib ada.** Konfirmasi email kini berdiri di jalur utama setiap pendaftaran
  mandiri, ditambah setiap reset sandi. Layanan email bawaan Supabase hosted dibatasi sangat ketat
  dan pada dasarnya hanya untuk menguji. Tanpa SMTP sungguhan, orang mendaftar → email tidak pernah
  datang → akun mati di langkah 5, dan gejalanya akan terlihat seperti "aplikasinya rusak".
- **`site_url` dan `additional_redirect_urls`** harus memuat domain produksi, kalau tidak tautan
  konfirmasi dan reset menunjuk `localhost:3000`.
- **Provider Google dinyalakan** di dashboard. Utang ini sudah tercatat, tetapi kini naik dari
  "tombolnya belum jalan" menjadi "salah satu dari dua jalur pendaftaran belum jalan".
- **`[auth.rate_limit] email_sent = 2`** perlu dinaikkan agar pengujian manual tidak terhenti
  sendiri.
- **Migrasi penanam `phases` wajib ada sebelum Tahap C hidup di produksi.** `phases` hanya diisi
  `supabase/seed.sql`, dan `supabase db push` tidak menjalankannya — di produksi tabel itu lahir
  kosong. `clients.phase_id` menunjuk `phases(id)`, jadi langkah "isi fase dari skrining yang
  disambungkan" (K3) akan melanggar foreign key pada klien pertama. Jebakan ini sudah tercatat di
  spec deploy 7 September; di sini ia berubah dari catatan menjadi prasyarat berpalang.

## Risiko utama

**Konfirmasi email adalah satu-satunya hal yang membuat K1 aman.** Ia dijaga test (K7) dan
disebutkan di runbook, tetapi ia tetap satu setelan di satu berkas. Siapa pun yang kelak
mematikannya untuk "mempermudah pengujian" membuka kembali celah yang butuh dua kali perbaikan
untuk ditutup.
