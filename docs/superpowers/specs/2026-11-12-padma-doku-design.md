# Pembayaran PADMA lewat DOKU — desain

Tanggal: 12 November 2026
Status: **DISETUJUI pemilik repo, 13 November 2026**
Branch: `feat/doku` (worktree `.worktrees/doku`), dari `development` `c50d022`
Brief asal: `docs/superpowers/briefs/2026-11-12-tugas-sesi-2-doku.md`

Dokumen ini punya dua bagian yang **dirilis bersama**:

- **Bagian A:** mesin pesanan P1/P2 pindah dari Midtrans ke DOKU.
- **Bagian B (P3):** pembayaran sesi dari pengajuan klien masuk ke mesin pesanan
  yang sama.

Rencana kerjanya boleh dua (A lalu B), tapi tidak satu pun boleh live sebelum
keduanya selesai.

---

## 1. Kenapa

Hasil tes klien 21 September, butir 1, disalin utuh dari
`documents/umpan-balik-klien/2026-09-21-hasil-tes.md`:

> Semua payment langsung lewat midtrans aja mas, pilihan lebih luas ga hanya
> qris aja (bbrp orang ga mau pk qris), kedua jadi ga perlu konfirm ke aku/
> admin klo transfer uda masuk, dan bisa langsung ada notif ke WA klien (dan
> status jadi otomatis bayar)

Midtrans tidak pernah live karena verifikasi produksinya macet. Klien lalu
memilih DOKU, yang menurut klien sudah siap produksi. Seluruh kode Midtrans
(P1-A, P1-B, P2) hanya ada di `development` lokal: nol transaksi nyata, nol
migrasi P1 di produksi (diukur 28 Sep). Karena itu tidak ada yang perlu
dipindahkan dan tidak ada alasan menjalankan dua gateway.

**Fakta yang mengubah rencana rilis (diperlihatkan pemilik repo 12 Nov dari
Back Office DOKU produksi, Settings → Service):** akun produksi hanya punya
**satu** layanan, yaitu QRIS, berstatus **UPDATING** (belum Active), diajukan
29 Okt 2026. Artinya:

- Go-live menunggu QRIS berstatus Active.
- Bila DOKU hanya QRIS, permintaan klien "pilihan lebih luas ga hanya qris aja"
  belum terjawab. Menambah metode (VA, e-wallet) adalah keputusan bisnis klien
  di Back Office ("Tambah Layanan"), **bukan pekerjaan repo ini**. Halaman
  Checkout menampilkan metode apa pun yang aktif tanpa perubahan kode. Satu
  pengecualian: webhook di desain ini hanya menangani notifikasi **non-SNAP**.
  Bila kelak metode yang diaktifkan (misalnya VA) mengirim notifikasi berformat
  SNAP (K9), webhook butuh jalur tanda tangan kedua sebagai pekerjaan susulan.
  Yang dijamin saat go-live: **QRIS lewat Checkout**.

Email konfirmasi ke DOKU sudah dikirim pemilik repo pada 12 Nov (isinya
§4.3). Jawabannya belum ada saat dokumen ini ditulis.

## 2. Keputusan pemilik repo (12 Nov 2026, sesi brainstorming)

| Pertanyaan | Keputusan |
|---|---|
| Cakupan | Produk digital **dan pembayaran sesi** lewat DOKU. Rekomendasi brief "produk digital dulu" dibatalkan |
| Syarat rilis | Saat rilis, **semua** pembayaran yang dimulai klien di aplikasi lewat DOKU. Tidak ada rilis sebagian |
| Jadwal yang dibuat admin langsung ("jalur 2", `jadwalkanSesi`) | **Tidak pindah ke DOKU.** Dibiarkan persis seperti sekarang; cara bayarnya bermacam-macam dan aplikasi tidak perlu tahu |
| Refund | **Tetap manual.** DOKU hanya untuk menerima uang. Alur refund tidak berubah |
| Nominal | **Dibekukan saat tagihan terbit.** Setelah lunas, perubahan jadwal/jarak tidak menagih tambahan dan tidak mengembalikan selisih. Refund manual memakai angka yang dibayar |
| Tenggat 24 jam lewat | Pengajuan **tidak batal sendiri**; menunggu keputusan admin (terbitkan ulang atau batalkan) |
| Konfirmasi jadwal | **Otomatis** begitu DOKU menyatakan lunas. Tombol "Konfirmasi jadwal" untuk pengajuan hilang |
| Email saat jadwal terkonfirmasi | **Tidak ada** (untuk sekarang) |
| Peralihan saat rilis (tagihan QRIS & bukti yang menggantung di produksi) | **Urusan operasional**, masuk checklist go-live |
| Notifikasi WhatsApp | Tetap proyek terpisah (keputusan P1, tidak dibantah) |
| Tenggat bayar sesi | **24 jam atau jam mulai kunjungan, mana yang lebih dulu.** Pembayaran tidak bisa masuk sesudah kunjungan |
| Mengabari bidan | Admin yang mengabari bidan (bidan tidak punya akses aplikasi). Jadwal yang terkonfirmasi otomatis **diberi penanda "Baru — kabari bidan"** sampai admin menandainya sudah dikabari |
| Uang yang masuk ke tagihan sesi yang sudah ditutup | **Selalu refund manual.** Mesin status P1 tidak diberi jalur keluar dari `kedaluwarsa`/`dibatalkan` |
| C3-b (klien batal/jadwal ulang dari Passport) dan C3-c (pencatatan refund) | **Sesudah rilis DOKU** (13 Nov). Keduanya tidak masuk cakupan rilis. Sampai itu, klien membatalkan lewat admin, dan refund jenjang 1 & 4 dicatat di luar aplikasi. "Refund tetap manual" tidak menggugurkan C3-c, karena C3-c adalah pencatatan, bukan transfer otomatis |

## 3. Tujuan, non-tujuan, anti-tujuan

**Tujuan**

1. Klien membeli produk digital (satuan dan keranjang) dan membayar tagihan sesi
   pengajuannya lewat halaman bayar DOKU, dengan metode apa pun yang aktif di
   akun merchant.
2. Status lunas datang dari DOKU dan berlaku otomatis: akses produk terbit, atau
   sesi terjadwal lahir. Admin tidak lagi memverifikasi transfer untuk
   pengajuan.
3. Seluruh jaminan mesin P1 bertahan (§9).
4. Nol sisa Midtrans di `src/`, env, README, dan teks hukum, kecuali komentar
   sejarah yang disengaja dan migrasi lama yang tidak boleh disunting.

**Non-tujuan**

- Jalur 2 (jadwal admin langsung, klaim "Saya sudah bayar", paket) dan QRIS
  manual untuk jalur itu.
- Refund lewat API DOKU, pencatatan refund di aplikasi (C3-c), dan formulir
  rekening tujuan.
- Notifikasi WA dan email "jadwal terkonfirmasi".
- C3-b (klien membatalkan atau menjadwal ulang sendiri dari Passport).
- Rate limit `/api/pesanan/checkout` (utang P1 yang sudah tercatat).
- Memilih atau membatasi metode bayar di kode.

**Anti-tujuan** (gagal walau "berfungsi"):

- Uang masuk tapi pesanan, akses, atau sesi tidak bergerak tanpa tanda tinjauan
  di mana pun.
- Nominal atau vonis lunas yang bisa datang dari badan permintaan klien atau
  dari parameter yang dikirim pemanggil bersesi.
- Satu pengajuan tertagih dua kali tanpa ada yang melihatnya.
- Rupiah bocor ke layar admin yang dijaga "nol nominal".
- Tagihan sesi yang belum dibayar memblokir klien membeli produk digital, atau
  sebaliknya.

## 4. DOKU: fakta yang dipakai, sumbernya, dan yang belum pasti

Semua klaim di bagian ini diambil dari dokumentasi resmi DOKU per 12 Nov 2026.
URL ditulis tanpa akhiran `.md` (versi yang dibaca peneliti adalah URL yang sama
ditambah `.md`).

### 4.1 Sumber

| # | Topik | URL |
|---|---|---|
| S1 | Checkout, ringkasan | https://developers.doku.com/accept-payments/doku-checkout |
| S2 | Checkout, ringkasan (situs docs) | https://docs.doku.com/accept-payments/integration-tools/doku-checkout |
| S3 | Checkout, membuat pembayaran | https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration |
| S4 | Checkout, peramban | https://developers.doku.com/accept-payments/doku-checkout/integration-guide/frontend-integration |
| S5 | Checkout, simulasi & notifikasi | https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification |
| S6 | Checkout settings | https://developers.doku.com/accept-payments/doku-checkout/configuration/checkout-settings |
| S7 | Metode yang didukung Checkout | https://developers.doku.com/accept-payments/doku-checkout/configuration/supported-payment-methods |
| S8 | Tanda tangan non-SNAP (header permintaan) | https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-component-from-request-header |
| S9 | Tanda tangan non-SNAP (metode GET) | https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-from-api-get-method |
| S10 | Contoh kode tanda tangan non-SNAP | https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/sample-code |
| S11 | Memasang URL notifikasi (dev) | https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url |
| S12 | Memasang URL notifikasi (docs) | https://docs.doku.com/get-started/manage-business/set-up-integration/webhook-payment-notification |
| S13 | Override URL notifikasi | https://developers.doku.com/get-started-with-doku-api/notification/override-notification-url |
| S14 | Praktik terbaik notifikasi | https://developers.doku.com/get-started-with-doku-api/notification/best-practice |
| S15 | Contoh notifikasi non-SNAP | https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap |
| S16 | Contoh notifikasi SNAP | https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-for-snap |
| S17 | Pengiriman ulang notifikasi | https://developers.doku.com/get-started-with-doku-api/notification/retry-notification |
| S18 | Check Status API non-SNAP | https://developers.doku.com/get-started-with-doku-api/check-status-api/non-snap |
| S19 | Status pesanan Checkout (`order.status`) | https://developers.doku.com/accept-payments/doku-checkout/order-and-notification-handling/order-status-for-checkout-page |
| S20 | Notifikasi kedaluwarsa Checkout (dev) | https://developers.doku.com/accept-payments/doku-checkout/order-and-notification-handling/expired-notification |
| S21 | Notifikasi Checkout (docs) | https://docs.doku.com/accept-payments/integration-tools/doku-checkout/configure-notifications |
| S22 | Recover Abandoned Cart | https://developers.doku.com/accept-payments/doku-checkout/order-and-notification-handling/recover-abandoned-cart |
| S23 | Cancel Order API (dev) | https://developers.doku.com/accept-payments/doku-checkout/order-and-notification-handling/cancel-order-api |
| S24 | Kelola pesanan Checkout (docs) | https://docs.doku.com/accept-payments/integration-tools/doku-checkout/manage-checkout-orders |
| S25 | Idempotensi permintaan | https://developers.doku.com/get-started-with-doku-api/idempotency-request |
| S26 | FAQ migrasi SNAP | https://docs.doku.com/miscellaneous/snap-migration |
| S27 | Registrasi pengguna & sandbox | https://developers.doku.com/get-started-with-doku-api/user-registration |
| S28 | Mengambil kredensial | https://developers.doku.com/get-started-with-doku-api/retrieve-payment-credential |
| S29 | Simulasi transaksi (docs) | https://docs.doku.com/get-started/manage-business/set-up-integration/simulate-transactions |
| S30 | Refund (docs) | https://docs.doku.com/get-started/manage-business/manage-finances/refund |
| S31 | Libraries & SDK | https://developers.doku.com/developer-kit/libraries-and-sdk |
| S32 | Koleksi Postman resmi | https://developers.doku.com/developer-kit/postman-collection |
| S33 | Direct API, ringkasan | https://developers.doku.com/accept-payments/direct-api |

S22 tidak dibuka sebagai halaman tersendiri. Isinya dibaca dari
`https://developers.doku.com/llms-full.txt`, dan path halamannya disalin dari
indeks `https://developers.doku.com/llms.txt`.

### 4.2 Fakta yang dipakai desain

**Produk: DOKU Checkout (non-SNAP).**

- Halaman bayar ter-hosting dengan banyak metode dalam satu integrasi, bisa
  redirect atau disematkan [S1, S2].
- Direct API berarti membangun halaman bayar sendiri per metode. DOKU sendiri
  menyarankan Checkout bila tidak ingin integrasi per channel [S33].
- FAQ migrasi SNAP menyatakan *"no migration to SNAP is required if you are
  using … DOKU Checkout"* dan menawarkan Checkout sebagai alternatif bagi
  merchant yang tidak ingin migrasi SNAP [S26].
- SDK Node resmi hanya untuk SNAP dan tidak mencakup Checkout [S31], jadi
  adapter ditulis sendiri seperti adapter Midtrans.

**Membuat pembayaran** [S3]:

- `POST https://api-sandbox.doku.com/checkout/v1/payment` (sandbox) dan
  `POST https://api.doku.com/checkout/v1/payment` (produksi).
- Header: `Client-Id`, `Request-Id` (maks 128), `Request-Timestamp` (ISO8601
  UTC, contoh `2020-09-22T01:51:00Z`), dan `Signature`.
- Medan badan yang dipakai:
  - `order.amount`: angka, IDR, tanpa desimal.
  - `order.invoice_number`: wajib, unik, maks 64. Maks **30** bila kartu kredit
    aktif, dan **tanpa simbol** bila KKI dipakai.
  - `payment.payment_due_date`: dalam **menit**, default 60.
  - `order.line_items[]`: total harga × jumlah harus sama dengan
    `order.amount`.
  - `order.callback_url` dan `order.auto_redirect`.
  - `order.recover_abandoned_cart` [S22].
- Jawaban 200 memuat `response.payment.url`, `token_id`, dan `expired_date`
  (`yyyyMMddHHmmss`, UTC+7). Galat dijawab HTTP 400 `{"error_messages":[…]}`.
- `Request-Id` adalah kunci idempotensi: Request-Id dan badan yang sama
  memulangkan jawaban yang sama dengan HTTP 409 [S25].

**Tanda tangan non-SNAP** [S8, S9, S10]:

- `Digest = base64(SHA-256(badan JSON))`.
- Komponennya digabung dengan `\n`, tanpa baris baru di akhir:
  `Client-Id:…`, `Request-Id:…`, `Request-Timestamp:…`, `Request-Target:<path>`,
  `Digest:…`.
- Lalu `HMAC-SHA256` dengan Secret Key, di-base64, dan diawali `HMACSHA256=`.
- Untuk metode GET, baris `Digest` dihilangkan [S9].

**Peramban** [S4, S5]:

- Ada dua pilihan: redirect ke `payment.url`, atau popup lewat skrip
  `jokul-checkout-1.0.0.js`.
- **Tidak ada callback JS yang didokumentasikan.**
- Sesudah membayar, pelanggan diarahkan ke `callback_url` [S5].

**Notifikasi** [S11–S17]:

- URL notifikasi **dipasang di Back Office** per kelompok channel [S11, S12].
  ngrok dilarang, URL harus publik, dan HTTPS dianjurkan [S11].
- `override_notification_url` per permintaan harus ber-path sama dengan yang
  terpasang [S13].
- Notifikasi dikirim sebagai POST ber-header `Client-Id`, `Request-Id`,
  `Request-Timestamp`, dan `Signature`. Verifikasinya memakai algoritma HMAC
  yang sama; `Request-Target` = path URL notifikasi kita, dan Digest dihitung
  dari badan [S14].
- `transaction.status` di notifikasi: "SUCCESS atau FAILED" [S14]. Contoh kartu
  juga memperlihatkan `VOIDED` dan `REFUNDED` [S15].
- **Khusus Checkout: notifikasi `FAILED` harus diabaikan** karena pelanggan
  bisa berganti metode [S14].
- Notifikasi kembar bisa terjadi, jadi pemrosesan wajib idempoten [S14].
- Bentuk badan berbeda per channel [S15]. `order.amount` bisa berupa angka (VA),
  string (gerai), atau `"20000.00"` (QRIS). QRIS tidak membawa
  `original_request_id`.
- Channel ber-format SNAP memakai header dan tanda tangan lain (`X-SIGNATURE`,
  HMAC-SHA512) [S16].
- Pengiriman ulang terjadi bila jawaban bukan 2xx: tiga kali, pada +30 menit,
  +6 jam, dan +12 jam dari percobaan awal. Kirim ulang manual tersedia di Back
  Office [S17].

**Check Status** [S18, S19]:

- `GET https://api(-sandbox).doku.com/orders/v1/status/{invoice_number}`,
  ditandatangani seperti GET (tanpa Digest).
- Anjuran DOKU: "Hit Check status after 60 seconds after payment completion".
- Nilai `transaction.status`: `PENDING`, `SUCCESS` (final), `FAILED`, `EXPIRED`
  (final), `REFUNDED` (final), `TIMEOUT`, dan `REDIRECT`. Kartu juga bisa
  memulangkan `PARTIAL_REFUNDED` dan `VOIDED`.
- `order.status` Checkout (`ORDER_GENERATED`, `ORDER_EXPIRED`,
  `ORDER_RECOVERED`) hanya untuk merchant yang terdaftar sejak Desember 2024
  [S19].

**Kedaluwarsa & pemulihan** [S20–S24]:

- Recover Abandoned Cart membiarkan pesanan yang sudah kedaluwarsa dibayar
  sampai 3 kali. Fitur ini diatur per merchant di Dashboard dan per pesanan
  lewat `order.recover_abandoned_cart` [S22].
- Notifikasi kedaluwarsa Checkout adalah fitur terpisah, dan payload-nya tidak
  didokumentasikan [S20, S21].
- Cancel Order API ada (`POST /checkout/v3/cancellations`), tetapi dua situs
  dokumentasi saling bertentangan soal cakupannya [S23, S24].

**Sandbox:**

- Registrasi lewat `https://sandbox.doku.com/bo/sandbox-registration` [S27].
- Kunci ada di Integrations → API Keys [S28].
- Simulator ada di `https://sandbox.doku.com/integration/simulator/` [S5, S29].

**Refund:** Checkout tidak punya API refund. Refund non-kartu lewat tiket
support [S30]. Ini tidak relevan karena refund tetap manual.

### 4.3 Perlu konfirmasi DOKU

Butir bertanda ✉ sudah ditanyakan di email 12 Nov (nomor email dalam kurung).

| # | Pertanyaan | Akibat bagi desain bila jawabannya tidak menguntungkan |
|---|---|---|
| K1 ✉(A1) | Kapan QRIS menjadi Active? | Go-live tertunda. Kode tidak berubah |
| K2 ✉(A2) | Apakah Checkout tersedia untuk akun ini, dan apakah QRIS tampil di Checkout? | **Penghalang terbesar.** Bila tidak, adapter harus pindah ke Direct API QRIS (SNAP). Struktur §5 tetap; adapter, tanda tangan, dan webhook berubah |
| K3 ✉(B4) | Satu URL notifikasi untuk Checkout, atau satu per channel? Apa beda menu *Checkout Page Notification* dan *HTTP Notifications*? | Hanya checklist go-live |
| K4 ✉(B5) | Bisakah satu invoice tercatat SUCCESS dua kali bila pelanggan berganti metode? | Desain sudah menangkapnya (notifikasi kedua `tanpa_efek`, tercatat di jejak). Bila "ya", tambahkan tanda tinjauan untuk SUCCESS kedua (§5.5 baris 1, kolom "lunas") |
| K5 ✉(B6) | Mungkinkah SUCCESS setelah `payment_due_date` lewat, dengan Recover Abandoned Cart mati? | Sudah ditangkap sebagai `lunas_setelah_tutup` |
| K6 ✉(B7) | Karakter apa yang sah di `invoice_number`, dan bolehkah nomor dipakai ulang dengan Request-Id baru? | Desain memakai alfanumerik saja dan nomor baru per percobaan (§5.2), jadi aman di kedua jawaban |
| K7 ✉(B8) | Apa jawaban Check Status untuk invoice tak dikenal, berapa rate limit-nya, dan transaksi mana yang dipulangkan bila percobaannya banyak? | Memengaruhi cabang "tidak ditemukan" (§5.6) |
| K8 ✉(B9) | Apakah pengiriman ulang berhenti hanya pada 2xx atau pada jawaban apa pun? Berapa timeout-nya, dan adakah daftar IP? | Peta kode jawaban (§5.4) tetap. Daftar IP opsional |
| K9 | Bagaimana format notifikasi bila Checkout dibayar lewat channel yang terdaftar sebagai "VA SNAP"? | Bila berformat SNAP, webhook butuh jalur tanda tangan kedua. Relevan hanya bila VA diaktifkan |
| K10 | Payload notifikasi kedaluwarsa Checkout | Tidak dipakai (§5.6); fiturnya jangan dinyalakan |
| K11 | Apakah `auto_redirect` benar-benar wajib, dan parameter apa yang ditambahkan ke `callback_url`? | Halaman kembali tidak memercayai parameter apa pun, jadi aman di kedua jawaban |
| K12 | Batas atas `payment_due_date` | Kita mengirim ≤ 1440 menit |
| K13 | Pertentangan cakupan Cancel Order API antara dua situs dokumentasi | Desain tidak bergantung padanya (§6.6) |
| K14 | Apakah `order.status` aktif untuk akun ini? | Opsional, hanya memperkaya jejak |

---

## 5. Bagian A — mesin pesanan pindah ke DOKU

### 5.1 Produk dan alur peramban

- Integrasinya **DOKU Checkout non-SNAP, mode redirect** (keputusan saya).
  Popup ditolak karena tidak ada callback JS yang terdokumentasi [S4]. Popup
  hanya akan menambah skrip pihak ketiga tanpa memberi sinyal apa pun.
- Alurnya:
  1. Klien menekan Bayar.
  2. Server membuat (atau memakai ulang) tautan bayar.
  3. Peramban diarahkan ke `payment.url`.
  4. DOKU mengembalikan klien ke `callback_url` milik PADMA.
  5. Halaman tujuan menjalankan Lapis 1b.
- Halaman kembali **tidak membaca** parameter apa pun yang ditempelkan DOKU
  (K11) dan tidak menerbitkan apa pun. Prinsip P1 tetap berlaku: tanpa halaman
  `/bayar/selesai` yang menerbitkan.
- `snap-peramban.ts` dan seluruh pemuatan skrip Midtrans dihapus.

### 5.2 Nomor invoice

- `orders.kode` tetap `PSN-YYMMDD-XXXXXX`, karena itu yang dilihat manusia.
- Yang dikirim ke DOKU sebagai `invoice_number` adalah bentuk **alfanumerik
  saja**: `kode` tanpa tanda hubung, diikuti satu digit percobaan 1..9.
  Contoh: `PSN261112A1B2C33`, 16 karakter.
  - Kenapa tanpa simbol: KKI ada di daftar Payment Settings akun klien, dan
    bila dipakai, DOKU melarang simbol [S3].
  - Kenapa ≤ 30: batas bila kartu aktif.
  - Kenapa tetap memakai percobaan: perilaku nomor yang dipakai ulang belum
    pasti (K6).
- Pola ini hidup di TS (rute webhook menyaringnya sebelum tanda tangan dihitung)
  dan di SQL (fungsi mesin). Uji wajib mencocokkan keluaran RPC yang menerbitkan
  nomor dengan regex TS, bukan dengan salinannya sendiri. Preseden:
  `tests/pesanan-checkout-db.test.ts`.

### 5.3 Membuat pembayaran (adapter)

`src/lib/doku/*` menggantikan `src/lib/midtrans/*`. Isinya: konfig, tanda
tangan, skema, adapter, dan kode jawaban.

- **Kapan tautan dibuat:**
  - Pesanan produk: di rute checkout, sesudah RPC pesanan, sama seperti Snap
    sekarang.
  - Pesanan sesi: saat klien menekan Bayar (§6.3), bukan saat admin menerbitkan
    tagihan.
- **Pakai ulang:** pesanan `menunggu_bayar` yang sudah punya tautan yang masih
  berlaku memakai tautan itu. Tautan baru (percobaan +1) hanya lahir bila
  pembuatan gagal atau jawabannya ambigu.
- **Badan permintaan:**
  - `order.amount` = jumlah `harga_beku` dari `order_items`, dibaca di server.
  - `line_items` = satu baris per item, kuantitas 1.
  - `payment.payment_due_date` = sisa menit sampai `orders.kedaluwarsa_pada`.
    Dibulatkan **ke bawah**, supaya DOKU tidak menerima uang sesudah kolom kita
    tutup; bila hasilnya kurang dari 1, tautan tidak dibuat. Tenggat kolom dan
    tenggat DOKU dengan begitu tetap satu angka (prinsip `JAM_TENGGAT_PESANAN`),
    termasuk untuk pesanan sesi yang tenggatnya dipotong jam kunjungan (§6.2).
  - `order.recover_abandoned_cart = false`.
  - `callback_url` menunjuk halaman Passport tempat pesanan itu dibayar.
- **Data pribadi minimum** (keputusan saya):
  - `customer.*` diisi hanya medan yang diwajibkan DOKU.
  - `judul_beku` item sesi bersifat generik ("Sesi kunjungan PADMA", "Biaya
    transport") tanpa nama layanan. Nama layanan sesi bisa mengungkap kondisi
    kesehatan, dan DOKU tidak perlu tahu.
- Kunci hanya dari env (§5.8). Tanpa kunci, checkout menjawab "pembayaran belum
  tersedia", sama seperti perilaku P1 tanpa `MIDTRANS_SERVER_KEY`.

### 5.4 Webhook `/api/pembayaran/doku`

Urutan lapisannya dipertahankan dari P1 (invarian 3):

1. **Batas ukuran badan:** 16 KB, dibaca sebagai teks mentah.
2. **Kunci terpasang.** Bila `DOKU_CLIENT_ID` atau `DOKU_SECRET_KEY` kosong,
   jawab **503**.
3. **Validasi skema (Zod)** yang longgar per channel:
   - Wajib: `order.invoice_number`, `order.amount` (angka atau string), dan
     `transaction.status`.
   - Opsional: `channel.id`, `service.id`, `transaction.original_request_id`,
     dan `transaction.date`.
   - Header wajib: `Client-Id`, `Request-Id`, `Request-Timestamp`, `Signature`.
4. **Bentuk nomor invoice** (§5.2).
5. **Tanda tangan, dibandingkan dalam waktu tetap:**
   - Header `Client-Id` harus sama dengan milik kita.
   - Digest dihitung dari **byte badan mentah**, bukan JSON hasil serialisasi
     ulang.
   - `Request-Target` = path rute ini.
   - Tidak ada penolakan berdasarkan selisih jam (`Request-Timestamp`). Apakah
     pengiriman ulang ditandatangani ulang belum pasti, dan replay sudah
     dinetralkan oleh idempotensi.
6. **Normalisasi nominal.** Angka atau string desimal yang nilainya bilangan
   bulat (`20000`, `"20000"`, `"20000.00"`) menjadi integer. Selain itu
   menjadi `null`, yang dibaca mesin sebagai nominal tidak cocok.
7. **Sidik → RPC** `terapkan_notifikasi_gateway(…, sumber = 'webhook')`.

Peta kode jawaban tetap memakai tabel P1 (`kode-jawaban.ts`): 400 untuk ukuran,
skema, dan bentuk; 503 bila kunci kosong; 401 bila tanda tangan salah; 200 untuk
duplikat, tanpa efek, diterapkan, dan pesanan tidak ada; 500 bila galat. Ada
satu catatan yang ditulis di dokblok, bukan diubah di peta: DOKU hanya mengirim
ulang **tiga kali** dalam 12 jam [S17], bukan berulang seperti Midtrans. 503
dan 500 karena itu tetap "keterlambatan", tetapi Lapis 1b dan Lapis 3 adalah
penyelamat yang sesungguhnya.

**Sidik** (diserahkan ke builder, dengan dua syarat yang wajib diuji):

- Pengiriman ulang dengan badan yang byte-nya identik menghasilkan sidik yang
  sama.
- Dua status berbeda untuk invoice yang sama menghasilkan sidik berbeda.

### 5.5 Tabel pemetaan status DOKU → mesin pesanan (LENGKAP)

Kolom "Pesanan …" adalah status pesanan saat notifikasi atau jawaban itu
mendarat. "Tinjauan" berarti `butuh_tinjauan_pada` dan `sebab_tinjauan`
disetel di transaksi yang sama dengan jejaknya (aturan `KEJADIAN_BUTUH_TINJAUAN`).

| # | Jawaban DOKU | Datang lewat | Vonis | Pesanan `menunggu_bayar` | Pesanan `kedaluwarsa` / `dibatalkan` | Pesanan `ditahan` | Pesanan `lunas` |
|---|---|---|---|---|---|---|---|
| 1 | `SUCCESS`, nominal = Σ`harga_beku` dan cacah item cocok | webhook, status API | lunas | → `lunas`, jejak `lunas`, **penyalur jalan** | jejak + tinjauan `lunas_setelah_tutup` | jejak + tinjauan `selisih_status` | tanpa efek, jejak `notifikasi` (lihat K4) |
| 2 | `SUCCESS`, nominal **tidak** cocok atau tidak bisa dinormalisasi | webhook, status API | ditahan | → `ditahan`, tinjauan `selisih_nominal` | jejak + tinjauan **`lunas_setelah_tutup`** (lihat catatan cacat P1) | jejak + tinjauan `selisih_status` | jejak + tinjauan `selisih_nominal` |
| 3 | `PENDING`, `REDIRECT`, `TIMEOUT` | status API | menunggu | tanpa efek | tanpa efek | tanpa efek | tanpa efek |
| 4 | `FAILED` | webhook, status API | menunggu (Checkout: pelanggan boleh berganti metode [S14]) | tanpa efek | tanpa efek | tanpa efek | tanpa efek |
| 5 | `EXPIRED` | status API | kedaluwarsa | → `kedaluwarsa` | tanpa efek | tanpa efek | tanpa efek |
| 6 | `REFUNDED`, `PARTIAL_REFUNDED` | webhook, status API | refund | status tetap, tinjauan `refund` | status tetap, tinjauan `refund` | status tetap, tinjauan `refund` | status tetap, tinjauan `refund`; akses/sesi **tidak** dicabut |
| 7 | `VOIDED` | webhook, status API (kartu) | asing | status tetap, tinjauan `selisih_status` | sama | sama | sama |
| 8 | Nilai lain apa pun (termasuk kosong) | webhook, status API | asing | status tetap, tinjauan `selisih_status` | sama | sama | sama |
| 9 | Status API: invoice **tidak ditemukan** (bentuk jawabannya K7) | status API | — | sebelum `kedaluwarsa_pada` + `JAM_TENGGANG`: tanpa efek. Sesudahnya: → `kedaluwarsa`, jejak memuat jawaban DOKU | tanpa efek | tanpa efek | tanpa efek |
| 10 | Status API: baris 3 atau 4 **sesudah** `kedaluwarsa_pada` + `JAM_TENGGANG` | status API | — | → `kedaluwarsa`, jejak memuat jawaban DOKU | tanpa efek | tanpa efek | tanpa efek |
| 11 | Status API tidak terjawab (jaringan, 5xx, 401) | status API | — | tanpa efek, tidak menyentuh `diperiksa_pada` (perilaku P1) | — | — | — |

Catatan:

- **Baris 9 dan 10 adalah perluasan sadar** dari pengecualian 404 P1: vonis
  tetap dari gateway, waktu lokal hanya memutuskan kapan berhenti bertanya.
  Perluasan ini aman karena `recover_abandoned_cart = false` dan karena setiap
  SUCCESS yang mendarat kemudian tertangkap sebagai `lunas_setelah_tutup`
  (baris 1–2). Tidak ada yang bergantung pada fitur notifikasi kedaluwarsa
  DOKU (K10).
- **Cacat P1 yang ditutup oleh fungsi baru.** Pada
  `terapkan_notifikasi_midtrans` versi `20260927100000`, langkah (7) mengubah
  vonis `lunas` menjadi `ditahan` bila nominal tidak cocok **sebelum** langkah
  (8a) memeriksa `lunas_setelah_tutup`. Settlement terlambat bernominal salah
  pada pesanan yang sudah ditutup karenanya jatuh ke `tanpa_efek` tanpa tanda
  tinjauan, padahal uangnya sudah masuk. Fungsi baru wajib memperlakukan
  SUCCESS apa pun pada pesanan tertutup sebagai `lunas_setelah_tutup`. Ujinya
  harus terbukti merah terhadap logika lama.
- Cabang Midtrans `capture`/`challenge`/`deny` tidak punya padanan DOKU dan
  ikut hilang. Status `ditahan` tetap lahir lewat baris 2.
- Status dibandingkan sebagai **himpunan bernama** di TS dan sebagai daftar
  eksplisit di SQL, bukan sebagai string tunggal yang tersebar. Uji
  table-driven wajib menyentuh **setiap baris dan setiap kolom** tabel ini.

### 5.6 Rekonsiliasi

Tiga lapis P1 tetap ada, dan hanya sumber jawabannya yang berganti:

- **Lapis 0, webhook** (§5.4).
- **Lapis 1b, periksa saat halaman dibuka** (`periksa-menggantung.ts`). Lapis
  ini memakai Check Status DOKU per `invoice_number` dengan percobaan terkini,
  dengan pembatas `MENIT_JEDA_PERIKSA` = 5 dan `BATAS_PERIKSA_SEKALI` yang tetap.
  - Halaman yang memicunya: halaman pembelian produk seperti sekarang, ditambah
    halaman tagihan sesi (§6.3), termasuk saat klien kembali dari DOKU.
  - Pemeriksaan pertama sesudah kembali bisa mendapat `PENDING` (DOKU
    menganjurkan jeda 60 detik). Layar menampilkan "pembayaran sedang
    diproses", dan webhook biasanya menyelesaikannya lebih dulu.
- **Lapis 3, cron `/api/cron/pesanan`.** Sama, menyapu semua pesanan terbuka
  termasuk pesanan sesi. Blok `schedule` di
  `.github/workflows/rekonsiliasi-pesanan.yml` tetap dikomentari sampai go-live.
- Rute pemulihan staf (`periksa-ulang`, `putuskan`, `terbitkan-akses`,
  `tutup-tinjauan`) memakai Check Status DOKU. Jawabannya masuk lewat
  `terapkan_notifikasi_gateway(…, sumber = 'status_api')` dengan service role.
  Vonis tetap tidak pernah menjadi parameter dari pemanggil bersesi.
- `JAM_TENGGANG_404` berganti nama netral (misalnya `JAM_TENGGANG_TANPA_VONIS`)
  dan nilainya tetap 1 jam.

### 5.7 Migrasi maju (strategi (a) brief: nama netral-gateway)

Migrasi P1/P2 **tidak disunting**, karena sudah diterapkan di instans lokal dan
uji bergantung pada riwayatnya. Satu migrasi maju baru:

- **Ganti nama kolom:**
  - `orders.snap_token` → `tautan_bayar`
  - `orders.snap_diterbitkan_pada` → `tautan_terbit_pada`
  - `orders.status_midtrans` → `status_gateway`
  - `notifikasi_pesanan.status_midtrans` → `status_gateway`
- **Fungsi webhook:** `terapkan_notifikasi_midtrans` di-drop, lalu lahir
  `terapkan_notifikasi_gateway` dengan pemetaan §5.5.
  - Parameter yang disarankan: invoice, status, transaksi_id, kanal, nominal,
    sidik, sumber.
  - Hak aksesnya identik dengan yang lama: `revoke all … from public, anon,
    authenticated`, sehingga hanya service role yang bisa memanggilnya.
- **Fungsi lain:** `catat_token_snap` → `catat_tautan_bayar`. Setiap fungsi yang
  menulis `snap_token = null` (`buat_pesanan`, `buat_pesanan_keranjang`) dan
  setiap view atau fungsi yang membaca kolom lama ikut didefinisikan ulang.
  Builder **wajib** mengaudit dengan
  `grep -n "snap_\|midtrans" supabase/migrations` terhadap definisi terakhir
  setiap objek.
- **Nilai enum `order_event.token_terbit` dipertahankan** (keputusan saya).
  DOKU juga memulangkan `token_id`, dan mengganti nama nilai enum menambah
  risiko tanpa manfaat.
- **Cap waktu** harus lebih baru daripada migrasi terakhir di `development`.
  Per 12 Nov itu `20261112100000_hapus_artikel_testimoni_rpc.sql`, yang lahir
  sesudah branch ini dibuat. Merge `development` ke `feat/doku` sebelum migrasi
  pertama ditulis, dan koordinasikan dengan `padma-c3` sebelum merge karena
  cabang lain bisa membawa migrasi. Per 13 Nov, `development` (`bf0195d`) sudah
  membawa `20261113100000_menunggu_tarif_tanpa_batal_klien.sql` dari
  `fix/audit-b2-b4`, jadi cap waktu migrasi DOKU harus lebih baru dari itu.
  Di lokal, pakai
  `npx supabase migration up --include-all`.

### 5.8 Env, konfigurasi, dan penghapusan Midtrans

- Env yang lahir: `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, dan `DOKU_PRODUKSI`
  (boolean yang memilih basis URL). Tidak ada kunci publik, karena mode redirect
  tidak memuat skrip.
- Env yang mati: `MIDTRANS_SERVER_KEY`, `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`, dan
  `MIDTRANS_PRODUKSI`.
- Yang dihapus: `src/lib/midtrans/*`, `src/app/api/pembayaran/midtrans/`, dan
  setiap rujukan di `src/`. Target brief: `grep -ri midtrans src` hanya
  menyisakan komentar sejarah yang disengaja.
- Label layar "Midtrans" di `/admin/pesanan`, `/admin/penjualan`, dan
  `/owner/penjualan` berganti menjadi "DOKU" atau label netral. Di P4 hanya
  labelnya yang berubah (brief §7), kecuali filter sumber di §6.10.
- `web/README.md` Fase 3 ditulis ulang untuk DOKU (§8).
- Ke-23 berkas uji yang menyebut Midtrans ditulis ulang untuk DOKU. Uji yang
  hanya menyebut nama dalam komentar cukup disesuaikan.

### 5.9 Teks hukum

Perubahan ini **wajib ikut review hukum**. `VERSI_DOKUMEN` dinaikkan hanya bila
pemilik repo memutuskannya, karena kenaikannya memaksa seluruh klien menyetujui
ulang.

- **Kebijakan privasi** (`isi-kebijakan-privasi.tsx` baris 22, 68, 208):
  - Daftar pemroses: Midtrans → DOKU.
  - Kegunaannya menjadi "pemrosesan pembayaran produk digital dan tagihan
    sesi".
  - Catatan data kartu/rekening dan cookie di halaman pembayaran menyebut DOKU.
- **S&K bagian pembayaran** (`isi-syarat-ketentuan.tsx` ±103–116). Teks hari ini
  menjanjikan dua hal yang **tidak lagi benar**:
  1. "Sesi kunjungan dibayar lewat QRIS PADMA, lalu bukti pembayarannya diunggah
     di Digital Passport."
  2. "Lewat dari [24 jam], pengajuan batal dan slotnya dilepas untuk klien
     lain." Ini bertentangan dengan keputusan pemilik bahwa tenggat lewat
     menunggu keputusan admin.

  Usulan isi, dengan redaksi final di tangan review hukum:
  - Sesi yang diajukan lewat aplikasi dibayar dari Digital Passport lewat
    halaman pembayaran DOKU.
  - Sesi yang diatur langsung oleh admin dibayar sesuai arahan admin.
  - Tagihan berlaku 24 jam atau sampai jam kunjungan, mana yang lebih dulu. Bila
    lewat, admin menghubungi klien untuk menerbitkan ulang atau membatalkan
    pengajuan.
  - Produk digital dibayar lewat DOKU dan kedaluwarsa dalam 24 jam.

---

## 6. Bagian B (P3) — tagihan sesi pengajuan lewat DOKU

### 6.1 Cakupan jalur

| Jalur | Asal sesi | Hari ini | Sesudah P3 |
|---|---|---|---|
| 1 | Pengajuan klien di aplikasi (`booking_requests`) | Tagihan QRIS → unggah bukti → admin verifikasi → admin "Konfirmasi jadwal" | Tagihan = pesanan DOKU → lunas dari DOKU → sesi lahir otomatis |
| 2 | Admin menjadwalkan langsung (`jadwalkanSesi`; "sebagian besar jadwal klinik lahir di telepon") | Sesi lahir `belum` → klien "Saya sudah bayar" → admin tandai lunas/tolak | **Tidak berubah satu baris pun** |
| — | Penukaran kredit (`tukar_hak_sesi`) | Sesi lahir `lunas` | Tidak berubah |
| — | Paket (`client_packages`, tersembunyi) | Rel klaim | Tidak berubah |

Karena jalur 2 tetap, yang **dipertahankan** adalah: `/admin/bayar` (tab klaim
sesi/paket), daftar `/passport/bayar` beserta QRIS-nya untuk klaim jalur 2
(`page.tsx` baris 175–177), `klaim_sudah_bayar`, `tandaiLunas`, `tolakKlaim`,
dan ketiga kunci QRIS di `/admin/pengaturan`.

### 6.2 Menerbitkan tagihan = membuat pesanan sesi

Admin tetap menekan "Terbitkan tagihan" di `/admin/sesi` dari status
`mitra_siap`. Bedanya, aksi itu kini memanggil **satu fungsi SQL berperan staf**
(nama saran: `terbitkan_tagihan_sesi(p_permintaan_id)`) yang dalam satu
transaksi:

1. Mengunci baris pengajuan dan memeriksa bahwa statusnya `mitra_siap`.
   Terbit ulang (§6.5) masuk lewat jalur yang sama dari `menunggu_bayar`.
2. **Menghitung harga di SQL** dari `variant_rates.harga_klien` yang berlaku
   pada tanggal sesi, ditambah `transport_rates.tarif_klien` untuk jenjang
   jarak. Jenjangnya dihitung dari koordinat tersimpan dengan `jarak_km` dan
   `jenjang_dari_jarak` yang sudah ada.
   - Tidak satu pun angka atau jenjang datang dari pemanggil. Ini doktrin
     `konfirmasi_permintaan`: nilai turunan tidak boleh menyeberang.
   - Bila tarif atau koordinat tidak lengkap, fungsi menolak dengan kalimat
     yang bisa ditindak admin, seperti perilaku `terbitkanTagihan` sekarang.
3. Membuat `orders` berjenis sesi dengan
   `kedaluwarsa_pada = least(now() + tenggat, jam mulai kunjungan)`. Jam mulai
   kunjungan = `tanggal` + `jam_mulai` pengajuan, dibaca dalam zona
   Asia/Jakarta, sesuai keputusan pemilik "mana yang lebih dulu". Fungsi
   **menolak** menerbitkan tagihan bila jam mulai kunjungan sudah lewat. Pesanan
   itu membawa **dua** `order_items` ber-`jenis = 'sesi'` dan `booking_request_id`
   pengajuan itu: layanan dan transport. Rinciannya dengan begitu tetap bisa
   ditampilkan ke klien dari angka beku. Item transport bernilai 0 boleh
   dihilangkan.
4. Mengubah pengajuan menjadi `menunggu_bayar` dengan `tenggat` = **nilai yang
   sama persis** dengan `orders.kedaluwarsa_pada`, dan `status_bayar = 'belum'`.

Sesudah fungsi ini ada, **rumus harga hidup di satu tempat (SQL).**
`hitungTagihanPengajuan` di TS dihapus. Sebelum dihapus, satu uji kesetaraan
membuktikan fungsi SQL memulangkan angka yang sama dengan rumus TS lama untuk
fixture yang mencakup: jenjang terisi, jenjang kosong, tarif yang berganti
tanggal berlaku, dan transport nol.

Email tagihan (`email-tagihan.ts`) dan teks WA (`pesan-tagihan.ts`) tetap ada,
tetapi isinya menjadi **tautan ke halaman tagihan di Passport**, bukan gambar
QRIS (keputusan saya).

- Nominal di email diambil dari angka beku.
- **Teks WA tidak lagi memuat nominal.** Tautan `wa.me` bernominal saat ini hidup
  di markup `/admin/sesi` di balik panel `?lihat=`, padahal halaman itu dijaga
  "nol rupiah". Uji money firewall tidak pernah membuka panel itu (audit
  `padma-c3` §2, rujukan `2026-09-09-tab-permintaan-tindak-lanjut.md:101-102`).
- Klien melihat nominalnya di Passport. P3 menambah assertion money firewall
  yang **membuka panel `?lihat=`** pengajuan `menunggu_bayar`.

**Tenggat tunggal.** `JAM_TENGGAT_BAYAR` (`lib/tagihan/tenggat.ts`) dan
`JAM_TENGGAT_PESANAN` (`lib/pesanan/status.ts`) disatukan menjadi satu
konstanta, sesuai catatan di `status.ts` yang menyerahkan keputusan ini ke P3.
Fungsi SQL menyetel `kedaluwarsa_pada` secara eksplisit dan tidak bersandar
pada default kolom.

### 6.3 Klien membayar

- **`/passport/bayar`:** tagihan pengajuan tampil dengan tombol "Bayar" (DOKU),
  bukan QRIS. Klaim jalur 2 di halaman yang sama tidak berubah.
- **`/passport/bayar/[id]`:**
  - Rincian diambil dari **angka beku**. `order_items` nol grant untuk
    `authenticated`, jadi bacaannya lewat RPC klien ber-`security definer`
    yang memilih baris dari `auth.uid()`, bukan lewat service role di halaman.
    Pelajaran P1: dua tempat yang memegang satu aturan harus bisa **melihat
    data yang sama**.
  - QRIS dan unggah bukti dihapus dari halaman ini.
  - Tombol Bayar memanggil rute server yang membuat atau memakai ulang tautan
    (§5.3), lalu meredirect.
  - Halaman ini menjalankan Lapis 1b.
- **Keadaan yang ditampilkan halaman detail:**

| Keadaan | Yang klien lihat |
|---|---|
| Pesanan `menunggu_bayar`, sebelum tenggat | Rincian, sisa waktu, tombol Bayar |
| Baru kembali dari DOKU, status belum final | "Pembayaran sedang diproses", tanpa tombol Bayar ganda (builder memutuskan caranya, misalnya tombol nonaktif sementara atau tautan yang sama) |
| Lunas, sesi lahir | "Lunas", ditambah tautan ke jadwal di Passport |
| Lunas, sesi tertahan (§6.4) | "Pembayaran diterima, jadwal sedang disiapkan admin" |
| `ditahan` atau tinjauan | "Pembayaran sedang diperiksa admin" |
| Tenggat lewat, pesanan `kedaluwarsa` | "Tagihan kedaluwarsa. Admin akan menghubungi Anda." Tanpa tombol Bayar |
| Pengajuan dibatalkan | Seperti sekarang |

- **Klien membatalkan pengajuan** `menunggu_bayar` (`batalkanPengajuan`, yang
  sudah ada): pesanan terbukanya ikut menjadi `dibatalkan` dalam **transaksi
  yang sama**. Uang yang tetap mendarat sesudahnya tertangkap sebagai
  `lunas_setelah_tutup`.

### 6.4 Lunas → sesi lahir otomatis (penyalur sesi)

Cabang `'sesi'` di `salurkan_pesanan` berhenti mencatat `penangan_belum_ada`.
Ia memanggil penyalur sesi, sebuah **fungsi tertutup** yang tidak bisa
dieksekusi `anon` maupun `authenticated` dan masuk daftar
`tests/fungsi-mesin-tertutup`. Penyalur ini:

- **Bekerja per `booking_request_id`, bukan per item.** Pesanan sesi membawa dua
  item untuk satu pengajuan, dan sesi hanya boleh lahir sekali.
- **Memeriksa empat syarat:** pengajuan masih `menunggu_bayar`, bidannya masih
  aktif, pesanannya `lunas`, dan jam mulai kunjungan belum lewat. Syarat
  terakhir adalah pertahanan berlapis. Dengan tenggat "mana yang lebih dulu"
  (§6.2), DOKU seharusnya sudah menolak pembayaran sesudah tenggat; tetapi bila
  uang tetap mendarat, sesi di masa lalu tidak boleh lahir diam-diam.
- **Bila syaratnya terpenuhi,** mengerjakan apa yang hari ini dikerjakan
  `konfirmasi_permintaan`:
  - `status_bayar = 'lunas'` dan `status = 'dikonfirmasi'`;
  - sisipan `sessions` berstatus `terjadwal`, lahir `lunas`, dengan
    `booking_request_id`, jenjang dihitung di SQL.
  - Sisipan sesi itu **direfaktor menjadi satu fungsi internal** yang dipakai
    bersama, bukan disalin.
  - Jejaknya kejadian baru `sesi_terkonfirmasi`.
  - Sesi itu lahir **bertanda "perlu dikabarkan ke bidan"** (§6.7). Builder
    memilih bentuknya, misalnya satu kolom stempel waktu di `sessions` yang
    diisi penyalur dan dikosongkan aksi admin "Sudah dikabari". Nama kolomnya
    tidak boleh mengandung `bayar`, karena pola money firewall
    (`money-firewall-struktural.test.ts`) menandai nama itu.
- **Bila syarat tidak terpenuhi** (bidan nonaktif, pengajuan sudah dibatalkan,
  atau sudah dikonfirmasi oleh pesanan lain):
  - jejak memakai kejadian baru `sesi_tertahan` ditambah tanda tinjauan;
  - fungsi ini **tidak pernah melempar**. Pengecualian di sini akan membatalkan
    pencatatan lunas di transaksi webhook, lalu uang yang sudah masuk hilang
    dari basis data. Polanya sama dengan `akses_tertahan` di
    `terbitkan_akses_item`.
- `sesi_tertahan` masuk `KEJADIAN_BUTUH_TINJAUAN`. Nilai enum `order_event`
  yang baru ditambahkan di SQL dan di `KEJADIAN_PESANAN_SAH`, dengan urutan
  yang dijaga `tests/pesanan-status-db.test.ts`.

**Pemulihan oleh staf.** Rute `/api/pesanan/[id]/terbitkan-akses` (P1 Tugas 11)
diperluas sehingga untuk item sesi ia menjalankan ulang penyalur sesi. Admin
mengganti bidan lebih dulu bila perlu (ganti bidan sesudah lunas **tidak**
mengubah nominal; keputusan butir 2), lalu menekan tombol di `/admin/pesanan`.
Labelnya disesuaikan builder ("Terbitkan akses / Buat sesi").
`putuskan_pesanan_ditahan` yang memutuskan "lunas" juga harus menjalankan
penyalur yang sama.

`konfirmasi_permintaan` (RPC staf) **hanya** tersisa untuk tagihan warisan QRIS
(§7): pengajuan yang **tidak punya satu pun pesanan**. Untuk pengajuan yang
punya pesanan, RPC itu wajib menolak, sehingga satu-satunya jalan kelahiran sesi
adalah penyalur. Pengajuan baru selalu lahir dengan pesanan (§6.2), jadi jalur
warisan mengering dengan sendirinya. Sesudah tidak ada lagi baris warisan di
produksi, RPC ini dan layarnya dihapus sebagai langkah terpisah.

### 6.5 Tenggat lewat, terbit ulang, dan pembatalan oleh admin

- **Tidak ada pembatalan otomatis.** Rute `/api/cron/tenggat` dan
  `batalkan_lewat_tenggat()` dipensiunkan. Rute dihapus, dan fungsi di-drop
  atau dipakai ulang untuk pembatalan satu baris di bawah. Uji penjaga
  `pesanan-jadwal-actions` yang melarang penjadwalannya ikut disesuaikan.
- **`/admin/sesi`** menampilkan keadaan pengajuan `menunggu_bayar` tanpa rupiah:
  - "Menunggu pembayaran, tenggat …"
  - "Tenggat lewat"
  - "Pembayaran perlu ditinjau", bertaut ke `/admin/pesanan`.
- **Aksi admin pada pengajuan `menunggu_bayar`:**
  - **Terbitkan ulang.** Pesanan yang masih terbuka ditutup sebagai
    `dibatalkan`, harga dibekukan ulang, lalu pesanan baru dan tenggat baru
    terbit, semuanya dalam satu transaksi. Aksi ini **ditolak** bila salah satu
    hal berikut benar:
    - pengajuan sudah punya pesanan BERUANG (`lunas`/`ditahan`);
    - salah satu pesanan pengajuan itu masih membawa tinjauan
      `lunas_setelah_tutup` yang belum ditutup staf (uang sudah masuk lewat
      pesanan lama);
    - `booking_requests.status_bayar <> 'belum'` (sisa alur QRIS lama, §7).

    Dengan begitu klien yang uangnya sudah masuk tidak pernah disodori tagihan
    kedua. Syarat yang sama **menyembunyikan tombol Bayar** di Passport; klien
    melihat "Pembayaran sedang diperiksa admin" (keputusan saya).

    Penyelesaian `lunas_setelah_tutup` pada pesanan sesi selalu **refund
    manual** (keputusan pemilik). Admin mentransfer balik di luar aplikasi,
    menutup tinjauannya lewat `tutup_tinjauan` yang sudah ada, lalu kunci di
    atas terlepas sehingga tagihan yang berlaku bisa dibayar atau diterbitkan
    ulang. Tidak ada transisi baru keluar dari `kedaluwarsa`/`dibatalkan`.
  - **Batalkan pengajuan.** Status menjadi `dibatalkan_tenggat` (nilai enum yang
    sudah ada, dengan pelepasan skrining seperti `batalkan_lewat_tenggat`
    sekarang), dan pesanan terbuka ditutup `dibatalkan` di transaksi yang sama.
    - Aksi ini berlaku juga untuk baris warisan tanpa pesanan (§7).
    - Aksi ini **ditolak** bila uang sudah masuk, dengan syarat yang sama dengan
      kunci "Terbitkan ulang" di atas. Pengajuan yang uangnya sudah masuk
      diselesaikan lewat tinjauan: buat sesinya, lalu bila perlu batalkan
      sesinya lewat jenjang C3-a.
    - Melepas skrining itu penting. Menurut audit `padma-c3` 12 Nov
      (`docs/superpowers/2026-11-12-audit-pekerjaan-tertunda.md` §2),
      `dibatalkan_tenggat` belum pernah punya penulis yang hidup. Skrining yang
      dipegang pengajuan macet tidak pernah lepas (`lib/passport/aksi.ts`
      memakai skrining yang belum dipegang pengajuan mana pun), sehingga klien
      harus skrining ulang untuk mengajukan lagi.
  - Kirim tagihan via WA dan kirim (ulang) email tetap ada. Tombol "Konfirmasi
    jadwal" hilang.
- **Perubahan masukan harga sebelum lunas** (ganti bidan, ubah tanggal, jam,
  alamat, atau varian) pada pengajuan yang pesanannya masih terbuka: pesanan
  itu ditutup `dibatalkan` dan admin harus menerbitkan ulang. Builder memilih
  tempat penegakannya di SQL. Yang wajib: tidak ada jalan mengubah masukan
  harga sementara pesanan lama masih bisa dibayar.
- **Cancel Order API DOKU** (`/checkout/v3/cancellations`) **tidak** dipakai
  sebagai syarat (K13). Builder boleh memanggilnya sebagai upaya terbaik saat
  pesanan ditutup di pihak kita, asal kegagalannya tidak menggagalkan aksi.

### 6.6 Aturan "satu pesanan terbuka"

Indeks `pesanan_terbuka_satu_per_klien` hari ini membuat tagihan sesi yang belum
dibayar memblokir checkout produk, dan sebaliknya. Invarian barunya:

1. Paling banyak **satu pesanan produk terbuka per klien**. Makna P1/P2 tetap,
   termasuk `buat_pesanan`, `buat_pesanan_keranjang`,
   `pembayaran_produk_menggantung`, dan `punya_pesanan_menunggu`.
2. Paling banyak **satu pesanan terbuka per pengajuan**.
3. Pesanan sesi terbuka tidak pernah memblokir pesanan produk, dan sebaliknya.
4. Seorang klien boleh punya beberapa pesanan sesi terbuka sekaligus untuk
   pengajuan yang berbeda.

Caranya diserahkan ke builder, misalnya kolom jenis pada `orders` dengan indeks
parsial, ditambah penguncian baris pengajuan. **Syarat audit:** setiap pembaca
yang hari ini berasumsi "pesanan terbuka klien = pesanan produk" harus
ditemukan dan dibatasi ke produk. Ini mencakup Lapis 1b di halaman produk,
"Pembelian Saya", tombol beli, keranjang, dan `batalkan_pesanan_saya`. Pesanan
sesi tidak boleh muncul sebagai pembelian produk, dan `batalkan_pesanan_saya`
tidak boleh menjadi jalan klien membatalkan pesanan sesi tanpa membatalkan
pengajuannya.

### 6.7 Layar staf dan money firewall

- `/admin/sesi` tetap **nol rupiah**, karena dijaga uji `helpers/nominal`.
  Status bayar tampil sebagai kata, bukan angka.
- **Penanda "Baru — kabari bidan"** (keputusan pemilik):
  - Sesi yang lahir dari penyalur tampil dengan penanda itu di `/admin/sesi`
    sampai admin menekan "Sudah dikabari".
  - Sesi yang sudah dibatalkan tidak lagi ditandai.
  - Jumlah sesi bertanda sebaiknya ikut hitungan antrean di header admin
    (`lib/admin/antrean.ts`). Detailnya keputusan builder.
  - Sesi jalur 2, penukaran kredit, dan jalur warisan tidak ditandai, karena
    admin sendiri yang membuatnya.
- `/admin/pesanan` menampilkan pesanan sesi dengan label jenis "Sesi" dan
  tautan ke pengajuannya. Nominal sudah boleh tampil di layar ini (keputusan
  P1).
  - View `pesanan_item_staf` mendapat kolom `booking_request_id`. Allowlist
    kolom view di `money-firewall-struktural.test.ts` ikut diperbarui; kolom ini
    bukan kolom uang.
- **Refund manual:** admin melihat angka yang dibayar klien di `/admin/pesanan`
  lewat kode pesanan. Layar pembatalan C3-a **tidak berubah** dan tetap tanpa
  nominal (interpretasi saya atas "tetap seperti sekarang saja", 12 Nov).
- `booking_requests.status_bayar` tetap ada. Untuk jalur 1 ia hanya ditulis oleh
  fungsi mesin (penyalur dan terbit tagihan), dan tidak pernah lagi oleh staf
  atau rute. Builder memastikan staf tidak bisa menulis `status_bayar`
  pengajuan lewat REST langsung. Hari ini mereka bisa: kebijakan `FOR ALL` +
  hak `UPDATE`, tanpa penjaga transisi dan tanpa jejak (§11).

### 6.8 Yang dipensiunkan

Untuk jalur 1 saja:

- **Unggah bukti:** `/api/bukti` (POST unggah) dan `unggah-bukti.tsx`, dimatikan
  sejak rilis.
- **Verifikasi bukti:** `verifikasiPengajuan` dan tab tagihan pengajuan di
  `/admin/bayar` (`tagihan-pengajuan.tsx`, `aksi-pengajuan.ts`,
  `lib/admin/tagihan-pengajuan.ts`). Bagian ini **dibatasi ke baris warisan
  tanpa pesanan** (§7), lalu dihapus setelah baris warisan habis.
- **Tampilan QRIS** di `/passport/bayar/[id]`.
- **Konfirmasi manual:** tombol "Konfirmasi jadwal" untuk pengajuan, beserta
  pemakaian `konfirmasiPermintaan` dari layar.
- **Pembatalan otomatis karena tenggat:** `/api/cron/tenggat` dan
  `batalkan_lewat_tenggat` (§6.5).
- **Rumus harga di TS:** `hitungTagihanPengajuan` (§6.2), dan pembaca lain yang
  menghitung ulang tagihan pengajuan dari tarif.

**Gugur bersama jalur 1:** rencana pencocokan mutasi rekening (c2:106-108)
tidak dibangun. **Tidak gugur:** mengganti gambar QRIS dari panel (c1c:51-53),
karena QRIS tetap dipakai jalur 2.

**Bukti lama di bucket `bukti-bayar`** adalah data nyata di produksi.
P3 **tidak menghapus apa pun** dari bucket. Penampil bukti staf
(`/api/bukti/[permintaan]`) dan aksi hapus bukti yang sudah ada (`hapusBukti`)
dipertahankan selama masih ada objek lama, supaya kebijakan retensi yang
berlaku tetap bisa dijalankan (keputusan saya). Pengosongan bucket dan
penghapusan kodenya adalah langkah terpisah sesudah rilis.

### 6.9 Hubungan dengan C3

- **C3-a** (jenjang pembatalan, kredit, jadwal ulang): **tidak berubah.** Sesi
  dari pembayaran DOKU lahir `lunas` seperti sesi dari konfirmasi lama, jadi
  `batalkan_sesi`, `jenjang_pembatalan`, dan `tukar_hak_sesi` bekerja apa
  adanya. Label akibat "refund" tetap label; transfer baliknya manual.
- **C3-b** (rencana `plans/2026-09-11-padma-c3b-mandiri-klien.md`, tidak pernah
  dieksekusi): **tidak diserap P3.** Rencananya tetap hidup, tetapi sebelum
  dieksekusi wajib ditinjau ulang untuk dua hal:
  1. Kalimat akibat uang di layar klien harus merujuk ke **angka yang dibayar**
     (pesanan), bukan angka yang dihitung ulang dari tarif.
  2. Pembatalan pengajuan yang masih `menunggu_bayar` sudah ditangani P3
     (§6.3).
- **C3-c** (refund berbukti, formulir rekening): **digantikan sebagian.** Hal
  yang tidak berlaku lagi:
  - Refund tetap manual di luar aplikasi (keputusan pemilik 12 Nov).
  - Asumsi spec C3 bahwa nominal refund "diturunkan ulang dari tarif" gugur;
    sumbernya kini `order_items.harga_beku` pesanan yang lunas.

  Untuk sesi hasil penukaran kredit, tautannya ke pesanan asal lewat
  `hak_sesi.sesi_asal_id`. Formulir rekening dan penghapusan otomatisnya tetap
  tidak dibangun.
  Empat celah C3-c yang dicatat audit `padma-c3` §2 tetap terbuka untuk siapa
  pun yang kelak membangunnya. P3 hanya menjawab satu, yaitu sumber besaran:
  `harga_beku`. Tiga lainnya belum terjawab:
  - di mana angka refund boleh dicatat, mengingat larangan kolom nominal dan
    allowlist money firewall;
  - kapan baris refund lahir;
  - status ditolak atau gagal.
- **`tidak_hadir` (no-show):** P3 tidak memutuskan apa pun di sini.
  - Untuk jalur 1, pertanyaan "ditagih atau tidak" kehilangan maknanya, karena
    sesi sudah lunas sebelum terjadi, dan poster klien menulis "dana tidak
    kembali".
  - Untuk jalur 2 (sesi `belum`), keputusan itu tetap terbuka di luar P3
    (`lib/jadwal/status.ts:260`; audit §2).
- Kebijakan pembatalan klien di
  `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md` tidak disentuh.

### 6.10 Rekap

- **Rekap owner** (`lib/owner/rekap.ts`, pekan Sabtu–Jumat): tidak berubah.
  Rekap itu tidak membaca status bayar dan menghitung dari sesi `selesai`.
- **P4 rekap penjualan** (`lib/penjualan/*`) membaca seluruh `orders`. Tanpa
  tindakan apa pun, pesanan sesi akan masuk diam-diam ke angka "penjualan".
  Keputusan saya: **P4 tetap berarti penjualan produk digital.** Pembacanya
  dibatasi ke item `produk_digital`, dan sebuah uji membuktikan pesanan sesi
  lunas tidak mengubah angka P4. Menggabungkan pendapatan sesi ke P4 adalah
  keputusan pemilik lain waktu.

---

## 7. Peralihan saat rilis (operasional)

Isi checklist §8 butir 6. Pemilik memutuskan peralihan sebagai urusan
operasional. Produksi tetap menerima unggahan bukti sampai detik deploy, jadi
"antrean dikosongkan sebelum deploy" tidak bisa dijamin. Karena itu kode
menyediakan **jalur warisan yang sempit** untuk pengajuan `menunggu_bayar` yang
**tidak punya satu pun pesanan** (keputusan saya, dibangun dari kode yang sudah
ada, bukan kode baru):

| `status_bayar` baris warisan | Sisi admin | Sisi klien (Passport) |
|---|---|---|
| `belum` (tagihan QRIS belum dibayar) | "Terbitkan ulang" lewat DOKU (§6.5) | "Tagihan Anda sedang dialihkan ke pembayaran baru; admin akan mengirimkannya." Tanpa QRIS, tanpa unggah |
| `menunggu_verifikasi` (bukti sudah diunggah) | Penampil bukti + verifikasi lama tetap ada **khusus baris ini** | "Bukti Anda sedang diperiksa admin" |
| `lunas` (sudah diverifikasi, belum dikonfirmasi) | "Konfirmasi jadwal" lama tetap ada **khusus baris ini** | Seperti sekarang |

Aturan pendampingnya:

- Unggah bukti baru dimatikan sejak rilis, untuk semua baris.
- "Terbitkan ulang" ditolak bila `status_bayar <> 'belum'` (§6.5), sehingga klien
  yang sudah membayar QRIS tidak pernah ditagih dua kali.
- Klien yang sudah mentransfer QRIS tetapi belum mengunggah bukti ditangani
  admin secara manual, di luar aplikasi. Menghitung baris seperti ini butuh
  query produksi, dan itu menunggu izin pemilik repo.
- **Tumpukan tagihan lewat tenggat sejak September.** Cron tenggat tidak pernah
  dijadwalkan, jadi produksi kemungkinan menyimpan banyak pengajuan
  `menunggu_bayar` yang tenggatnya sudah lama lewat (audit `padma-c3` §2).
  - Baris-baris itu adalah baris warisan.
  - Admin memutuskannya **satu per satu**: terbitkan ulang lewat DOKU bila klien
    masih ingin, atau batalkan (§6.5) untuk melepas skriningnya.
  - Tidak ada pembatalan massal. Itu keputusan yang sama yang membuat cron
    tenggat dilarang.
  - Jumlahnya diukur dengan query agregat produksi, sesudah izin pemilik repo.
- Tidak ada migrasi data yang membuat pesanan otomatis.
- Sesudah tidak ada baris warisan di produksi, jalur warisan (tab verifikasi,
  tombol konfirmasi lama, `konfirmasi_permintaan`) dihapus sebagai langkah
  terpisah.

## 8. Checklist go-live (langkah manusia)

`web/README.md` Fase 3 ditulis ulang dengan isi ini:

1. **DOKU:** QRIS berstatus **Active** (K1), Checkout dikonfirmasi tersedia
   (K2), dan jawaban email 12 Nov sudah masuk ke spec atau rencana.
2. **Sandbox:**
   - Daftar akun sandbox [S27] dan pasang kunci hanya di `.env.local`.
   - Uji asap ujung-ke-ujung di **deploy preview Vercel**, bukan terowongan
     lokal, karena ngrok dilarang DOKU [S11].
   - Bayar lewat simulator [S29], lalu pastikan webhook mengubah pesanan produk
     **dan** pesanan sesi.
3. **Back Office produksi:**
   - Pasang Notification URL `https://<domain-produksi>/api/pembayaran/doku`
     untuk setiap kelompok channel yang aktif (K3).
   - **Matikan Recover Abandoned Cart** [S22].
   - **Jangan** menyalakan notifikasi kedaluwarsa Checkout (K10).
4. **Vercel env:**
   - Pasang `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, dan `DOKU_PRODUKSI=true`.
   - Pastikan tidak ada env Midtrans yang tersisa.
   - Fluid Compute tetap menyala (catatan P1: tanpanya `maxDuration`
     menggagalkan build).
5. **Migrasi** diterapkan dengan sengaja, **bukan `db push`**. Urutannya
   diputuskan bersama migrasi lain yang menunggu di produksi (wewenang
   `padma-c3`, termasuk ranjau `pekan_sabtu_jumat`). Sesudahnya, periksa
   `supabase_migrations.schema_migrations`.
6. **Peralihan** (§7). Dikerjakan admin pada hari rilis.
7. **Penjadwal:** `CRON_SECRET` di GitHub Secrets, buka komentar blok `schedule`
   di `rekonsiliasi-pesanan.yml`, lalu hapus uji penjaganya.
8. **Teks hukum:** review hukum selesai, dan pemilik memutuskan kenaikan
   `VERSI_DOKUMEN`.
9. **Rotasi kunci:** Secret Key DOKU tidak pernah ditempel di chat, issue, atau
   log. Bila pernah, rotasi di Back Office sebelum go-live.

## 9. Invarian P1 yang wajib bertahan (dicek di review seluruh branch)

1. Verifikasi nominal, transisi status, penerbitan akses, **dan kelahiran sesi**
   terjadi dalam satu transaksi di dalam RPC, tidak pernah di TS.
2. Idempotensi lewat `unique (sidik)`.
3. Urutan lapisan webhook (§5.4), termasuk tanda tangan waktu-tetap dan 503
   saat kunci kosong.
4. Tiga lapis rekonsiliasi. Vonis selalu dari DOKU, tidak pernah dari badan
   permintaan klien. Pengecualian waktu lokal hanya baris 9–10 §5.5.
5. `lunas_setelah_tutup` dan celah tagih-dua-kali tetap tertutup, ditambah
   cacat §5.5 yang kini ditutup.
6. Tidak ada refund. `aktif = false` berarti berhenti dijual. Harga hanya diatur
   owner; untuk sesi, harga dibaca dari tarif milik owner, tidak pernah diketik
   admin.

## 10. Pengujian

- **Setiap uji baru dibuktikan bisa merah:** mutasi kodenya, tunjukkan ujinya
  gagal, lalu kembalikan (brief §6.4).
- **Uji table-driven untuk §5.5**, yang menyentuh setiap sel tabel, termasuk
  sel "tanpa efek".
- **Tanda tangan:** vektor uji dari contoh resmi [S8, S10] bila dokumentasi
  memuat keluaran lengkapnya. Bila tidak, vektor buatan sendiri yang kemudian
  dibuktikan di sandbox. Wajib ada uji perbandingan waktu-tetap dan uji
  "badan diubah satu byte → 401".
- **Hak akses:** fungsi mesin baru tertutup bagi `anon` dan `authenticated`;
  RPC baca tagihan klien hanya memulangkan milik pemanggil; staf tidak bisa
  menulis `status_bayar` pengajuan lewat REST.
- **Uji kesetaraan harga SQL vs TS lama** (§6.2) sebelum rumus TS dihapus.
- **P4 tidak berubah** oleh pesanan sesi (§6.10).
- **Utang uji tagihan yang ikut dibayar P3**, karena P3 menulis ulang modulnya
  (`2026-09-09-tagihan-email-katalog-tindak-lanjut.md` §D dan §G):
  - D1, tarif berganti tanggal: menaikkan tarif tidak menggeser tagihan yang
    sudah terbit (angka beku), dan tagihan baru memakai tarif yang berlaku pada
    tanggal kunjungan.
  - D2, kegagalan kirim email tertelan: menerbitkan tagihan tetap berhasil, dan
    `email_tagihan_pada` tidak tercap.
  - D3, nominal bocor ke admin: assertion yang membuka panel `?lihat=` (§6.2).
  - D4, rincian klien vs admin: admin tanpa nominal, dan rincian klien dari
    angka beku.
  - E2E `bayar-pengajuan` (rusak sejak sebelum P3) ditulis ulang untuk alur
    DOKU. Peramban berhenti di redirect ke DOKU, lalu notifikasi bertanda tangan
    disimulasikan ke webhook.
- **Lingkungan:** Supabase lokal terisolasi `web-doku` di port 547xx (brief
  §6.2). Merah bawaan pembanding, per `development` `71b7828`: hanya
  `materi-video-r2` ×6 (R2 placeholder), ditambah 5 skrip e2e basi.
  `hak-hapus-berlebih` sudah hijau sejak 12 Nov, jadi brief §6.6 usang di
  butir itu.
- **Uji asap sandbox** adalah langkah manusia (§8 butir 2) dan tidak menggantikan
  uji otomatis.

## 11. Temuan dari penelusuran kode yang memengaruhi desain

Diukur 12 Nov di `development`. Detail baris ada di laporan penelusuran;
ringkasnya:

- **Tenggat bayar pengajuan tidak pernah ditegakkan.** Cron-nya tidak
  terjadwal, dan `sudahLewatTenggat` tidak dipanggil di `src`. P3 menjadikan
  tenggat itu tenggat pesanan DOKU.
- **`booking_requests.status_bayar` tanpa penjaga transisi dan tanpa jejak,**
  padahal komentar di `20260912120000:31-32` dan `aksi-pengajuan.ts:26-28`
  mengklaim ada. Staf bisa menyetel `lunas` dengan satu PATCH REST.
- **Unggah ulang bukti** sesudah verifikasi mengembalikan `lunas` ke
  `menunggu_verifikasi` (`/api/bukti` service role, tanpa pemeriksaan status).
  Celah ini hilang bersama rutenya.
- **Jenjang jarak dihitung dua kali** (TS saat tagihan, SQL saat konfirmasi).
  Hasilnya bisa berbeda bila koordinat mitra disunting di antaranya. P3
  menghitungnya sekali di SQL saat tagihan, lalu harga dibekukan.
- **`order_items.booking_request_id` tanpa indeks unik.** Invarian "satu pesanan
  terbuka per pengajuan" (§6.6) menutup tagih ganda.
- **Lencana "Bayar" di admin** hanya menghitung sesi dan paket
  (`lib/admin/antrean.ts:48-72`). Setelah P3 itu benar untuk jalur 2. Tinjauan
  pesanan sesi muncul lewat lencana `/admin/pesanan`.

## 12. Diserahkan ke builder

- Struktur berkas `src/lib/doku/*`, isi adapter, dan bentuk Zod persisnya.
- Medan sidik, asal dua syarat §5.4 teruji.
- Nama fungsi SQL, kolom jenis pesanan, dan cara menegakkan §6.6 dan §6.5
  ("perubahan masukan harga").
- Men-drop atau menutup `konfirmasi_permintaan` dan `batalkan_lewat_tenggat`.
- Redaksi teks layar dan email dalam batas §6.3 dan §6.5.
- Pemakaian Cancel Order API sebagai upaya terbaik.
- Pembagian rencana (disarankan: rencana A, lalu rencana B), dan urutan tugas di
  dalamnya, dengan **satu syarat urutan** (keputusan saya):
  - Pekerjaan yang netral-gateway dikerjakan lebih dulu: migrasi, fungsi
    `terapkan_notifikasi_gateway` + tabel §5.5, SQL P3, dan layar.
  - Adapter, tanda tangan, dan webhook dikerjakan sesudah kunci **sandbox**
    tersedia di `.env.local` worktree. Bentuk Zod dan penanganan Digest
    dibuktikan terhadap notifikasi sandbox sungguhan, bukan hanya dokumentasi.
  - Bila jawaban K2 negatif (Checkout tidak tersedia), tugas adapter
    direncanakan ulang ke Direct API QRIS. Pekerjaan netral-gateway tidak
    terbuang.

## 13. Keputusan yang saya ambil (mohon dicek pemilik repo)

1. DOKU **Checkout non-SNAP, redirect**, bukan popup dan bukan Direct API (§5.1).
2. `invoice_number` **alfanumerik**, ditambah digit percobaan (§5.2).
3. **Data minimum ke DOKU;** nama item sesi generik (§5.3).
4. **`FAILED` tidak final;** jawaban non-final sesudah tenggat + 1 jam berarti
   kedaluwarsa (§5.5 baris 9–10).
5. **Nilai enum `token_terbit` dipertahankan** (§5.7).
6. Email dan WA tagihan tetap ada, **isinya tautan ke Passport** (§6.2).
7. **Dua item per pesanan sesi** (layanan + transport), supaya rincian tetap
   tampil dari angka beku (§6.2).
8. **Rumus harga pindah ke SQL;** rumus TS dihapus sesudah uji kesetaraan
   (§6.2).
9. **Perubahan masukan harga sebelum lunas menutup pesanan** dan mewajibkan
   terbit ulang (§6.5).
10. **Cron tenggat dan pembatalan otomatis dihapus,** bukan sekadar dibiarkan
    tak terjadwal (§6.5).
11. **Bukti lama dan penampilnya dipertahankan** sampai bucket kosong (§6.8).
12. **P4 tetap khusus produk digital** (§6.10).
13. **Angka refund dilihat di `/admin/pesanan`;** layar pembatalan tidak berubah
    (§6.7).
14. **Terbit ulang dan tombol Bayar dikunci** bila sudah ada uang masuk lewat
    pesanan mana pun atau lewat QRIS lama (§6.5).
15. **Jalur warisan sempit** untuk tagihan QRIS lama tanpa pesanan, dibangun
    dari kode yang sudah ada dan dihapus setelah kosong (§7).
16. **Pekerjaan netral-gateway didahulukan;** adapter dan webhook menunggu kunci
    sandbox (§12).
17. **Go-live dijamin untuk QRIS lewat Checkout saja;** notifikasi VA berformat
    SNAP menjadi pekerjaan susulan bila VA diaktifkan (§1, K9).
18. **Teks WA tagihan tanpa nominal,** hanya tautan Passport, supaya markup
    `/admin/sesi` benar-benar nol rupiah (§6.2).
19. **"Batalkan pengajuan" ditolak bila uang sudah masuk,** dan baris warisan
    yang lewat tenggat diputuskan admin satu per satu, tanpa pembatalan massal
    (§6.5, §7).
