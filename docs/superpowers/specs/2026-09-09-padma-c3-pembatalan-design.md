# PADMA C3 — Pembatalan Berjenjang, Jadwal Ulang, dan Kredit Layanan

**Tanggal:** 9 September 2026
**Pendahulu:** `docs/superpowers/specs/2026-09-08-padma-c2-pembayaran-design.md` — C2 selesai dan
ter-merge (`09f044b`). C1 selesai lebih dulu (C1-a `2ac03b8`, C1-b `23f0764`, C1-c `b087797`).

**Sumber kebijakan:** `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md` — salinan utuh
poster klien "KEBIJAKAN PEMBATALAN & JADWAL ULANG". Keputusan pemiliknya sudah bulat; dokumen ini
tidak menawar isinya, hanya merancang cara sistem menjalankannya. **Jangan meringkas isi kebijakan
dari ingatan; baca dari berkas itu.**

**Sumber keputusan rancangan:** keputusan pemilik repo 9 September 2026 atas tujuh pertanyaan yang
tidak bisa diturunkan dari kode — jatah jadwal ulang, titik mulai kredit, kedalaman pencatatan
refund, siapa yang menekan tombol, cara jenjang 3 terpicu, pemecahan tahap, penyimpanan rekening,
dan sumber ketersediaan saat klien menjadwal ulang.

**Bagian ketiga dari tiga:** C1 membangun alur sampai jadwal terkunci. C2 menjadikan pembayaran
syarat konfirmasi. **C3 (dokumen ini)** membangun jalan keluarnya — membatalkan, menjadwal ulang,
dan apa yang klien terima sebagai gantinya.

**Dipecah tiga.** C3 memuat empat jenjang kebijakan, objek kredit, refund berbukti, DAN layanan
mandiri klien; itu lebih besar dari C1 maupun C2. Spec ini utuh, tetapi implementasinya berjalan
sebagai tiga rencana terpisah yang masing-masing menghasilkan sesuatu yang hidup:

| Tahap | Isi | Bisa dipakai sendiri? |
|---|---|---|
| **C3-a** | Fondasi: fungsi jenjang, `hak_sesi`, RPC batal & jadwal ulang, jejak, panel admin | Ya — admin bisa menjalankan seluruh kebijakan dari panel |
| **C3-b** | Klien membatalkan & menjadwal ulang sendiri dari Passport | Ya — menambah kanal, tidak mengubah aturan |
| **C3-c** | Refund berbukti: rekening tujuan, bukti transfer balik, status | Ya — melengkapi jenjang 1 & 4 |

---

## Masalah

Sesudah C2, sebuah sesi yang sudah dibayar tidak punya jalan keluar di dalam sistem. Kliennya bisa
melihat sesi itu di Passport dan tidak bisa berbuat apa-apa terhadapnya — `sessions` sengaja tidak
punya policy UPDATE untuk klien (migrasi `20260829180000`). Adminnya bisa mengubah statusnya, tetapi
tidak ada satu pun tempat di sistem yang tahu bahwa membatalkan pada H-3 hari berbeda akibatnya dari
membatalkan satu jam sebelum bidan datang.

Empat hal mengalir dari situ:

1. **Kebijakan yang sudah dicetak tidak dijalankan siapa pun kecuali ingatan admin.** Empat jenjang,
   masing-masing dengan akibat berbeda, dihitung dari selisih waktu — persis jenis pekerjaan yang
   dilakukan manusia dengan salah.
2. **Jadwal ulang tidak ada sama sekali.** Ia bukan pelengkap pembatalan melainkan isi pokok tiga
   dari empat jenjang, dan hari ini satu-satunya caranya adalah membatalkan lalu memesan ulang —
   yang menurut kebijakan justru bukan hal yang sama.
3. **Kredit layanan tidak punya wujud.** Jenjang 2 menjanjikan sesuatu yang tidak bisa disimpan di
   mana pun; kalau dijanjikan lewat WhatsApp saja, ia hidup di ingatan dua orang dan kedaluwarsanya
   tidak pernah benar-benar berlaku.
4. **Uang keluar tidak berjejak.** C2 mencatat setiap rupiah masuk beserta buktinya. Yang keluar —
   refund jenjang 1 dan 4 — tidak tercatat di mana pun.

---

## Keputusan

### P1 — Jenjang DITURUNKAN saat dibaca, tidak pernah disimpan

Jenjang sebuah pembatalan adalah fungsi dari `sessions.tanggal + sessions.jam_mulai` terhadap saat
tindakan dilakukan. Ia dihitung setiap kali dibutuhkan dan tidak punya kolom.

Alasannya sama dengan nominal tagihan di C2 (P2): angka turunan yang disimpan melahirkan sumber
kedua yang suatu hari berselisih dengan yang pertama, dan tidak ada yang tahu mana yang benar. Yang
**disimpan** adalah akibatnya — hak sesi yang terbit, jatah yang terpakai, baris jejak — karena itu
fakta, bukan hitungan.

```
jenjangPembatalan(sesi, sekarang) → 1 | 2 | 3
  selisih ≥ 24 jam  → 1
  2 ≤ selisih < 24  → 2
  selisih < 2 jam   → 3
```

**Zona waktunya WIB, dan itu bukan detail.** Vercel berjalan UTC. Menghitung ambang dengan kalender
mesin menggeser batasnya tujuh jam, dan bentuk kegagalannya adalah kredit klien yang hangus sehari
lebih awal atau refund yang seharusnya penuh berubah jadi kredit. Fungsi ini memakai offset `+07:00`
tetap yang sudah ada di `src/lib/jadwal/jam.ts` (`instanSesi`). Indonesia tidak mengenal DST, jadi
offset tetap benar sepanjang tahun — dan itu sebabnya ia ditulis sebagai konstanta, bukan diambil
dari zona mesin.

**Jenjang 4 tidak ada di fungsi ini.** Ia bukan pertanyaan waktu melainkan pertanyaan siapa: PADMA
yang membatalkan. Menempatkannya di fungsi yang sama akan memaksa fungsi murni itu tahu tentang
aktor, dan aktor datang dari sesi pengguna.

### P2 — Jenjang 3 murni `< 2 jam`; penanda berangkat DIBUANG

Poster menyebut tiga pemicu jenjang 3: `< 2 jam`, mitra sudah berangkat, atau no-show. Yang kedua
adalah keadaan, bukan ambang — dan menandainya menuntut kolom baru, tombol admin, serta satu kelas
kesalahan baru ("admin lupa menekan"), sementara bidan belum punya akun sendiri.

**Keputusan pemilik: berangkat dianggap terjadi pada T-2 jam.** Dalam praktik PADMA bidan memang
berangkat sekitar dua jam sebelum sesi, jadi ketiga pemicu itu berimpit dan penanda terpisahnya
tidak menambah apa pun.

**Yang TIDAK tertutup, dan ditanggung dengan sadar:** sesi berjenjang `di_atas_20` (>20 km,
ongkosnya ditetapkan owner per kasus di `transport_khusus`) menuntut bidan berangkat lebih awal dari
dua jam. Klien yang membatalkan pada T-3 jam untuk sesi seperti itu tetap jatuh di jenjang 2 —
jadwal ulang gratis — padahal ongkos jalannya sudah keluar. Pemilik memilih menanggungnya. Ini
ditulis di sini supaya ia tetap berupa keputusan, bukan lubang yang tidak terlihat: bila kelak
terlalu sering terjadi, obatnya adalah tombol darurat "bidan sudah berangkat" untuk sesi jauh saja,
bukan penandaan wajib harian.

**No-show tetap ada** dan tidak menuntut apa pun yang baru: `session_status` sudah punya
`tidak_hadir`. Sesi ber-status itu tidak pernah menerbitkan hak maupun refund.

### P3 — Kredit adalah OBJEK HAK, bukan nominal

Jenjang 2 menerbitkan satu baris `hak_sesi`: hak atas **satu sesi untuk layanan yang sama**, tidak
bisa dipindah ke layanan lain (permintaan pemilik: "agar lebih mudah"), berlaku 30 hari.

```
hak_sesi
  id, client_id, service_id, kedaluwarsa date,
  sesi_asal_id, dipakai_sesi_id (null selama belum dipakai),
  created_at
```

**Tidak ada satu pun kolom nominal, dan itu intinya.** Money firewall struktural
(`tests/money-firewall-struktural.test.ts`) hanya mengizinkan kolom uang di `variant_rates`,
`honor_marks`, `transport_rates`, dan `transport_khusus`; menaruh nilai kredit di sini akan merah,
dan itu benar. Konsekuensi yang **diinginkan**: jenjang 2 tidak pernah menyentuh tabel uang sama
sekali. Klien menerima hak, bukan saldo — dan hak tidak bisa dicairkan, tidak bisa dipindahkan, dan
tidak menuntut rekonsiliasi.

**Kedaluwarsa = tanggal sesi yang batal + 30 hari** (keputusan pemilik), bukan tanggal pembatalan.
Menghitungnya sejak pembatalan menghukum klien yang membatalkan lebih awal — insentif yang terbalik,
karena justru pembatalan awal yang memungkinkan slotnya dijual lagi.

**Satu hak dan sepuluh hak adalah mekanisme yang sama.** Bila paket kelak dibuka (saklar
`PAKET_TAMPIL`, lihat "Utang terbuka" §1 spec C1), paket menerbitkan sepuluh baris `hak_sesi`
sekaligus alih-alih melahirkan mekanisme kedua. Tabel ini sengaja tidak menyebut kata "kredit"
maupun "paket" pada namanya.

**Hak dipakai sekali.** `dipakai_sesi_id` diisi saat hak ditukar sesi baru, dan indeks unik parsial
atas kolom itu menjamin satu hak tidak bisa melahirkan dua sesi. Hak yang `kedaluwarsa < hari ini`
ditolak saat ditukar — pemeriksaannya di fungsi basis data, bukan di TypeScript, supaya tidak bisa
dilewati lewat jalur mana pun.

### P4 — Jatah jadwal ulang 1× menempel pada BARIS SESI, dan jadwal ulang memindahkan baris itu

Keputusan pemilik: **1× per pemesanan**; sesudah jatahnya habis, permintaan jadwal ulang berikutnya
di jendela 2–24 jam diperlakukan sebagai pembatalan (dananya jadi kredit 30 hari), bukan dilempar ke
jenjang 3.

Kolom `sessions.jadwal_ulang_terpakai boolean not null default false`.

**Jadwal ulang mengubah `tanggal` & `jam_mulai` pada baris yang SAMA.** Alternatif yang ditolak:
membatalkan baris lama lalu membuat baris baru. Baris baru lahir dengan
`jadwal_ulang_terpakai = false`, sehingga jatah "1× per pemesanan" bisa di-reset tanpa batas hanya
dengan menjadwal ulang berulang kali — aturannya jadi bohong tanpa satu pun galat. Riwayat
perpindahannya tidak hilang: ia hidup di `jejak_jadwal` (P6).

Di jenjang 1 jadwal ulang **gratis dan tidak memakai jatah** — poster memberi pilihan bebas antara
refund penuh dan jadwal ulang. Jatah hanya relevan di jenjang 2.

### P5 — Semua perubahan lewat RPC; klien TETAP tanpa hak UPDATE atas `sessions`

Klien tidak diberi policy UPDATE baru atas `sessions`, meskipun C3-b membuatnya bisa membatalkan dan
menjadwal ulang sendiri. Semua berjalan lewat dua fungsi *security definer*:

```
batalkan_sesi(sesi_id, alasan)          → jenjang, hak yang terbit
jadwal_ulang_sesi(sesi_id, tanggal, jam) → jenjang, jatah terpakai?
```

Dua alasan, dan keduanya sudah terbukti di repo ini:

1. **Atomisitas.** Membatalkan di jenjang 2 adalah dua tulisan yang harus berlaku sebagai satu
   keputusan: sesi menjadi batal, DAN haknya terbit. Kegagalan di antaranya meninggalkan klien tanpa
   sesi dan tanpa gantinya — dan itu bentuk kegagalan yang paling mahal di seluruh C3. Argumen yang
   sama melahirkan `konfirmasi_permintaan()` di C2.
2. **Permukaan tulis.** Policy UPDATE untuk klien atas `sessions` membuka seluruh kolom baris itu,
   termasuk `status_bayar`, `partner_id`, dan `jenjang`. Fungsi definer membuka tepat satu tindakan.
   Kepemilikan diperiksa di dalam fungsi terhadap `auth.uid()`, bukan dipercayakan kepada pemanggil.

Fungsi-fungsi ini tidak boleh bisa dieksekusi peran `anon`.

### P6 — Jejak jadwal, tanpa foreign key

Tabel `jejak_jadwal`: `sesi_id`, `tindakan` (batal / jadwal_ulang), `jenjang`, `dari_tanggal`,
`dari_jam`, `ke_tanggal`, `ke_jam`, `alasan`, `aktor_id`, `peran_aktor`, `dicatat_pada`.

**Tanpa foreign key ke `sessions`**, mengikuti `jejak_status_bayar`: cascade akan menghapus tepat
bukti yang menjelaskan penghapusan. Konsekuensinya sudah diketahui dan harus ditulis di rencana —
setiap berkas uji yang menghapus sesi wajib menyapu jejaknya sendiri, atau
`tests/jejak-yatim.test.ts` merah di suite yang tidak menyentuh pembatalan sama sekali. Pagar itu
diperluas agar ikut memeriksa tabel baru ini.

Peran `authenticated` tidak memegang DELETE atas tabel jejak: baris audit tidak boleh dihapus oleh
admin yang sedang diaudit.

### P7 — Darurat medis adalah keputusan MANUSIA, dengan alasan tertulis wajib

Poster menyebut persalinan dan rawat inap "ditinjau untuk reschedule tanpa penalti". Kata "ditinjau"
dipertahankan apa adanya: sistem tidak pernah mendeteksi keadaan darurat sendiri.

Wujudnya: admin dapat menaikkan sebuah tindakan ke **perlakuan jenjang 1** dengan alasan tertulis
yang **wajib diisi** dan tercatat di `jejak_jadwal` beserta namanya. Tanpa alasan, tombolnya menolak.
Ini satu-satunya jalan jenjang bisa menyimpang dari hitungan waktu, dan hanya staf yang memilikinya —
klien tidak pernah bisa menyatakan dirinya darurat.

### P8 — Klien mengusulkan waktu; bidannya dipertahankan

Saat klien menjadwal ulang sendiri (C3-b), ia memilih tanggal & jam seperti mengajukan pemesanan,
dan **bidannya tetap yang sama**. Hubungan klien–bidan sudah terbentuk, dan mengganti orang yang
akan masuk ke rumah seseorang bukan akibat wajar dari memindahkan jam.

Waktu usulannya tunduk pada **aturan yang sudah ada** — jam buka dan tenggat minimum di
`app_settings` — plus bentrok jadwal bidan itu sendiri. Bila bidannya bentrok, klien diberi tahu
untuk memilih waktu lain, bukan dilempar ke antrean: "jadwal ulang gratis" yang harus menunggu
persetujuan bukan lagi terasa gratis.

**Aturannya dipakai ulang, penegakannya TIDAK.** `guard_booking_pembatas` adalah trigger
`before insert on booking_requests`; ia tidak pernah melihat `sessions` sama sekali, jadi jadwal
ulang tidak mewarisi pagar apa pun secara cuma-cuma. Penegakannya hidup di dalam
`jadwal_ulang_sesi()`, membaca kunci `app_settings` yang sama supaya jam buka klinik tidak punya dua
sumber yang bisa berselisih.

Dan itu harus dari dalam fungsi *security definer* — bukan trigger biasa. C1-a sudah menemukan
jebakannya sekali: `guard_booking_pembatas` bersifat SECURITY INVOKER, sehingga ia membaca
`app_settings` sebagai klien, mendapat nol baris karena policy, lalu **diam** alih-alih menolak.
Pagar yang membaca pengaturannya dengan hak pemanggil adalah pagar yang mati tanpa suara. Uji untuk
ini wajib dijalankan dengan sesi klien sungguhan, bukan service role — pelajaran C2 yang sama
(`docs/superpowers/2026-09-09-c2-tindak-lanjut.md` §1).

**Yang sengaja TIDAK dibangun: kalender ketersediaan bidan.** Menampilkan slot kosong menuntut jam
kerja tiap bidan didata lebih dulu — subsistem yang belum ada sama sekali dan besarnya setara satu
tahap tersendiri. Usulan-lalu-tolak-bila-bentrok memberi hasil yang sama bagi klien dengan ongkos
yang jauh lebih kecil.

Admin menerima pemberitahuan bahwa sesi berpindah; jadwalnya sendiri sudah berlaku.

### P9 — Refund: rekening menempel pada permintaannya, dan DIHAPUS saat selesai

Jenjang 1 dan 4 menjanjikan refund 100%. Uangnya masuk manual lewat QRIS statis, jadi keluarnya juga
manual — tidak ada webhook yang bisa dipicu. Yang dikerjakan sistem adalah mencatat, bukan
mentransfer.

```
permintaan_refund
  id, sesi_id, client_id, status (diminta / terkirim),
  rekening_bank, rekening_nomor, rekening_nama,   ← dikosongkan saat status → terkirim
  bukti_objek, diproses_oleh, diproses_pada, created_at
```

- **Rekening menempel pada permintaan refund, bukan pada profil klien.** Nomor rekening adalah
  identitas yang tahan lama; yang PADMA butuhkan hanya satu transfer. Menaruhnya di profil berarti
  setiap klien membawanya selamanya, termasuk ratusan yang tidak pernah minta refund. Rekening
  tujuan juga bisa berbeda dari sumber pembayaran — QRIS bisa berasal dari dompet digital yang tidak
  menerima transfer balik.
- **Dihapus otomatis begitu admin menandai transfer terkirim** (keputusan pemilik). Yang tersisa:
  jejak "refund selesai, oleh siapa, kapan" dan bukti transfernya. Penghapusannya dikerjakan fungsi
  basis data pada transisi status, bukan oleh kode aplikasi yang bisa lupa dipanggil.
- **Klien mengisi rekening di formulir pembatalan** saat ia yang membatalkan. Bila **PADMA** yang
  membatalkan (jenjang 4), klien tidak sedang di formulir mana pun: Passport-nya menampilkan
  permintaan mengisi rekening. Selama status masih `diminta`, klien bisa memperbaiki isinya sendiri —
  salah ketik satu digit tidak boleh menuntut percakapan WhatsApp.
- **Bukti transfer balik** memakai pola yang sudah teruji di C2: bucket privat tanpa satu pun policy,
  kunci objek diturunkan dari id permintaan refund, dibuka hanya lewat rute bertanda yang memanggil
  `requireRole` sebelum menyentuh storage dan membalas `private, no-store`.
- **Nama pemilik rekening dicocokkan admin dengan nama klien sebelum mengirim.** Rekening tujuan
  adalah permukaan penipuan: akun klien yang dibobol bisa dipakai membatalkan sesi dan mengalihkan
  uangnya. Yang menahannya bukan kode melainkan manusia yang tetap ada di jalur — dan itu ditulis di
  sini sebagai langkah, bukan diandaikan.

Kolom `rekening_*` tidak tersandung money firewall: yang dipagarinya kolom **nominal** (harga,
tarif, honor, biaya, total), bukan identitas rekening. Tidak ada nominal refund yang disimpan —
besarannya adalah apa yang sudah dibayar, dan itu sudah diturunkan dari tarif seperti di C2.

---

## Di luar ruang lingkup C3

- **Kalender ketersediaan bidan & akun mitra.** P8 menjelaskan alasannya.
- **Pengembalian dana otomatis.** Tidak ada jalurnya; QRIS PADMA statis.
- **Paket.** Masih di balik saklar `PAKET_TAMPIL`. `hak_sesi` dirancang agar paket kelak
  memakainya, tetapi paketnya sendiri bukan pekerjaan C3.
- **Penalti bagi klien yang berulang kali membatalkan.** Tidak ada di poster; menambahkannya berarti
  membuat kebijakan baru, bukan menjalankan yang ada.
- **Pemberitahuan email.** Tetap dua kanal seperti C2: layar dan pesan WhatsApp siap-salin.

---

## Konsekuensi yang sudah diketahui

1. **Sesi >20 km yang batal di T-3 jam merugi ongkos jalan.** P2, ditanggung sadar.
2. **Hak sesi bisa kedaluwarsa tanpa pernah dipakai.** Itu memang isi kebijakannya (30 hari). Yang
   sistem berikan hanyalah kejujuran: Passport menampilkan tanggal kedaluwarsanya sejak hari
   pertama, bukan memberitahu setelah lewat.
3. **Jadwal ulang mandiri bisa menabrak jadwal bidan berkali-kali** bila klien memilih waktu yang
   ramai. Bentuk kegagalannya adalah penolakan yang jelas, bukan jadwal ganda.
4. **Refund yang tidak pernah ditandai terkirim menyimpan rekening selamanya.** Penghapusan
   digantung pada transisi status, jadi permintaan yang menganggur menahan datanya. Panel admin
   menampilkan permintaan refund tertunda beserta umurnya supaya tidak ada yang tenggelam.
5. **Uji yang menghapus sesi harus menyapu `jejak_jadwal`.** P6.

---

## Pengujian

**Fungsi jenjang (murni, tanpa basis data).** Tepat di ambang: selisih persis 24 jam → jenjang 1;
persis 2 jam → jenjang 2; sedetik di bawahnya → jenjang 3. Dan yang paling penting: sesi pukul 08.00
WIB yang dibatalkan pukul 02.00 UTC hari yang sama — hitungan UTC akan menyebutnya sudah lewat,
hitungan WIB menyebutnya 1 jam lagi. Uji itu merah bila zona waktunya salah, dan hanya itu.

**Atomisitas RPC.** Membatalkan di jenjang 2 menerbitkan tepat satu `hak_sesi`; kegagalan di
tengahnya tidak meninggalkan sesi batal tanpa hak. Dipanggil dua kali tidak menerbitkan dua hak.

**Hak sesi.** Tidak bisa dipakai untuk layanan lain; tidak bisa dipakai dua kali (indeks unik
parsial); yang kedaluwarsa ditolak; klien tidak bisa menyisipkan atau mengubah `hak_sesi` milik
siapa pun, termasuk miliknya sendiri.

**Jatah jadwal ulang.** Tidak bisa di-reset dengan menjadwal ulang berulang; sesudah terpakai,
permintaan berikutnya di jendela 2–24 jam menghasilkan kredit, bukan perpindahan.

**Hak & permukaan.** Klien tetap tidak punya policy UPDATE atas `sessions` sesudah C3-b — diperiksa
langsung ke `pg_policies`, bukan disimpulkan dari perilaku. `anon` tidak bisa mengeksekusi kedua RPC.
Klien tidak bisa membatalkan sesi orang lain walau tahu id-nya.

**Refund.** Rekening benar-benar kosong sesudah status menjadi terkirim; bukti hanya terbuka lewat
rute bertanda, dan bucket-nya tanpa satu pun policy. Klien tidak bisa mengubah rekening sesudah
terkirim.

**Struktural.** Money firewall tetap hijau — `hak_sesi` dan `permintaan_refund` tidak boleh punya
satu pun kolom nominal. `tests/jejak-yatim.test.ts` diperluas ke `jejak_jadwal`.

**E2E jalur penuh** (di akhir C3-b dan C3-c): klien membatalkan H-3 hari → melihat pilihan refund
atau jadwal ulang; klien menjadwal ulang di jendela 2–24 jam → sesinya pindah dan jatahnya terpakai;
percobaan kedua → menerima kredit dengan tanggal kedaluwarsa yang benar; menukar kredit menjadi sesi
baru; admin menandai refund terkirim → rekeningnya lenyap dari basis data.

---

## Ketergantungan yang sudah terpenuhi

- **C1 — jam mulai sesi (J2).** Tanpa `jam_mulai`, tidak ada titik hitung untuk ambang 24 & 2 jam.
  Sudah ada sejak migrasi `20260909110000`.
- **C2 — catatan pembayaran.** Sistem harus tahu apa yang sudah dibayar sebelum bisa
  mengembalikannya atau menerbitkan hak penggantinya. Sudah ada: sesi lahir `status_bayar = 'lunas'`.
