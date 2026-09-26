# Inti pembayaran PADMA (P1) — desain

Tanggal: 26 September 2026
Status: **disetujui pemilik repo 26 September 2026**, termasuk lima koreksi
sesudah tinjauan tiga kritikus (pencabutan akses, kemampuan staf yang dicabut,
`vercel.json`, nominal sampai ke layar, nominal yang diterima disimpan).

## Masalah

Hasil tes klien 21 September, butir 1, disalin utuh dari
`documents/umpan-balik-klien/2026-09-21-hasil-tes.md` (cabang
`umpan-balik-klien-gelombang-1`):

> Semua payment langsung lewat midtrans aja mas, pilihan lebih luas ga hanya
> qris aja (bbrp orang ga mau pk qris), kedua jadi ga perlu konfirm ke aku/
> admin klo transfer uda masuk, dan bisa langsung ada notif ke WA klien (dan
> status jadi otomatis bayar)

Empat hal diminta sekaligus: semua pembayaran lewat Midtrans, pilihan metode
lebih luas, admin berhenti mengonfirmasi transfer manual, dan notifikasi
WhatsApp dengan status otomatis lunas.

## Kenapa cakupannya berubah dari spec 20 September

Spec `2026-09-20-padma-produk-digital-design.md` menaruh **"memindahkan
pembayaran sesi ke Midtrans" secara eksplisit di luar cakupan**, dengan alasan
yang masih benar: alur sesi sudah matang, dan menyentuhnya berarti menyentuh
pembatalan, tenggat, tagihan email, dan rekap owner.

Klien kini meminta persis hal yang dikecualikan itu. Membangun "Tahap 2" apa
adanya — Midtrans khusus produk digital — berarti membangun mesin pesanan,
webhook bertanda tangan, idempotensi, dan jaring pengaman untuk satu jenis
pembayaran, lalu membongkarnya beberapa minggu kemudian untuk dipasangi sesi.
Dua kali kerja, dan yang kedua retrofit ke tabel uang yang sudah berisi nota
nyata.

Keputusan pemilik repo: **satu mesin pembayaran untuk kedua sumber.**

## Pemecahan

Terlalu besar untuk satu spec. Empat proyek berurutan, masing-masing dengan
spec dan rencananya sendiri:

| | Isi | Kenapa terpisah |
|---|---|---|
| **P1** (spec ini) | `orders`/`order_items`, Snap, webhook, idempotensi, rekonsiliasi, layar staf | Jantungnya. Dibangun sekali, diuji habis, tanpa menyentuh alur mana pun |
| **P2** | Keranjang, checkout multi-item | Menempel ke P1; ini "Tahap 2" lama |
| **P3** | Pembayaran sesi pindah ke P1, bukti manual dipensiunkan | Paling berisiko: menyentuh pembatalan, tenggat, tagihan email, rekap |
| **P4** | `/admin/pembelian`, pendapatan di `/owner/rekap` | Baru bermakna setelah ada transaksi nyata |

**Notifikasi WhatsApp adalah proyek tersendiri, bukan bagian P1.** P1 cukup
menerbitkan dan mencatat kejadian; notifikasi jadi pelanggan kejadian itu.
Alasannya praktis: WhatsApp punya keputusan penyedia sendiri, ongkos per pesan,
dan syarat verifikasi bisnis yang bisa makan waktu berminggu-minggu.
Menggandengnya ke P1 berarti pembayaran otomatis tertahan menunggu hal yang
tidak ada hubungannya dengan pembayaran.

## Keputusan yang sudah diambil

| Pertanyaan | Keputusan |
|---|---|
| Cakupan mesin bayar | **Satu mesin untuk produk digital DAN sesi** |
| Bentuk inti | **Pesanan generik**; `order_items` menunjuk sumbernya |
| WhatsApp | **Proyek terpisah**; P1 menerbitkan kejadian |
| Penyedia | **Midtrans Snap**; kunci sandbox sudah ada, produksi menunggu verifikasi |
| `orders.client_id` | **`on delete restrict`** — nota yang bisa lenyap bukan nota |
| Nominal di layar staf | **YA**, dan **sampai ke layar** `/admin/pesanan`, bukan berhenti di view |
| Nominal yang diterima Midtrans | **Disimpan** (`notifikasi_pesanan.nominal_diterima`), ditampilkan bersebelahan dengan yang ditagih |
| Lubang tulis `digital_entitlements` | **Ditambal di dalam P1** |
| Tenggat pesanan | **24 jam**, satu konstanta untuk kolom kita DAN `expiry` Snap |
| Penjadwal | **P1 melahirkan `web/vercel.json`**, berisi HANYA `/api/cron/pesanan`, kadens `0 3 * * *` (harian — batas paket Hobby) |
| Jaring pengaman utama | **Pemeriksaan saat klien membuka halaman**, bukan cron; cron harian hanya penyapu sisa |
| Cron `/api/cron/tenggat` | **Tidak dijadwalkan di P1** — dan sekarang dijaga uji, bukan prosa |
| Pencabutan akses | **Tombolnya keluar dari cakupan P1**; perilaku pembelian ulang dispesifikasikan (lihat di bawah) |

### Catatan: nominal di layar staf

Rekomendasi rancangan adalah menunda nominal ke P4, supaya pelebaran money
firewall berukuran satu nama dan supaya batas "layar admin nol rupiah" tidak
perlu dicabut. Pemilik repo memutuskan sebaliknya: admin harus bisa menjawab
"berapa yang klien ini bayar" dari dalam PADMA, bukan dari dashboard Midtrans.

Keputusan itu **hanya berarti bila angkanya sampai ke layar.** Konvensi "layar
admin nol rupiah" di repo ini ditegakkan PER MODUL — `tests/admin-bayar.test.ts:880`
merender `BayarPage` dan memindai kelima berkas sumber modul bayar saja — jadi
`/admin/pesanan` yang dikirim tanpa satu rupiah pun akan hijau 100%, view
bernominalnya menganggur tanpa pembaca, dan rekomendasi yang ditolak kembali
lewat pintu ketiadaan. Karena itu P1 mengirim `tests/admin-pesanan.test.ts`
dengan assertion **kebalikan** dari konvensi rumah (lihat "Pagar baru").

Konsekuensi yang dicatat sekarang supaya tidak jadi kejutan di P3: begitu P3
memindahkan tagihan sesi ke pesanan, layar itu akan membawa nominal **sesi** ke
panel admin yang hari ini diuji nol rupiah (`tests/admin-bayar.test.ts:880-883`).
Batas itu harus diputuskan ulang di P3 — bukan penghalang, tapi utang yang
ditandai sejak sekarang.

### Catatan: pencabutan akses, dan dua kemampuan yang P1 cabut

Kolom `digital_entitlements.dicabut_pada` lahir di spec produk digital sebagai
bagian paket opsi "masa akses selamanya", bukan sebagai sesuatu yang diminta
klien, dan tidak ada satu pun kode yang menulisnya (diverifikasi ulang di
"Penambalan `digital_entitlements`").

P1 **tidak membangun tombol cabut maupun pulihkan.** Tapi P1 tidak bisa diam
soal apa yang terjadi kalau orang yang aksesnya dicabut membayar lagi, karena
`digital_entitlements` punya `unique (client_id, product_id)`
(`20260921120000_produk_entitlement.sql:24`) — setiap penerbitan akses WAJIB
memilih `do nothing` atau `do update`, dan diam berarti implementer yang memilih.
Perilakunya dispesifikasikan di "Penyaluran akses"; ketiga keadaannya di sana.

**Kalimat lama "bila akses dicabut manual lalu orangnya membayar lagi, aksesnya
kembali" salah, dan dihapus.** Preseden rumah menolak `do update` dengan
komentar yang tegas (`20260921150000_ambil_produk_gratis.sql:49-52`), jadi yang
sebenarnya terjadi adalah kebalikannya: orang itu membayar dan **tidak mendapat
apa-apa, diam-diam**, pesanannya `lunas` tanpa `akses_terbit`, dan satu-satunya
tombol yang relevan menulis "sudah ada" lagi — alarm yang tidak bisa ditutup
siapa pun. Risiko yang disetujui adalah "akses balik"; yang akan dibangun tanpa
koreksi ini adalah "uang diambil, akses tidak balik, alarm macet". P1 menutupnya
lewat keadaan (3): `akses_tertahan` + `butuh_tinjauan_pada`.

**Dua kemampuan staf yang P1 cabut — diterima sadar.** Policy hari ini
`for all` dengan hak tulis penuh (`20260921120000_produk_entitlement.sql:44-47`),
jadi lewat PostgREST seorang admin bersesi hari ini bisa:

1. menulis `dicabut_pada` — satu-satunya tuas rem yang bisa ditarik tanpa akses
   basis data;
2. menerbitkan entitlement `sumber='pemberian_admin'` — nilai enum yang lahir
   persis untuk itu, dan labelnya "Pemberian admin" sudah dirender di
   `src/app/admin/produk/[id]/page.tsx:35`.

Sesudah P1, keduanya hanya lewat **konsol SQL / service role**. Diterima karena
itu praktis keadaan hari ini juga: tidak ada satu pun tombol di panel untuk
keduanya, jadi yang dicabut adalah kemampuan yang sudah menuntut orang mengetik
`curl` atau membuka SQL editor. Konsekuensinya ditulis terang: "rem darurat"
sesudah P1 hanya bisa ditarik pemegang service role, dan kategori "Pemberian
admin" menjadi kategori yang **tidak bisa lagi lahir** — labelnya tetap dirender
untuk baris lama, dan tidak akan pernah bertambah. Bila salah satunya kelak
benar-benar dibutuhkan, ia lahir sebagai RPC kedua ber-radius terkunci, bukan
sebagai pengembalian hak tulis tabel.

## Bentuk data

Enam migrasi, cap waktu manual **di atas `20260924100000`** — bukan di atas tip
`main` (`20260921170000_harga_produk_publik_hanya_tayang.sql`, 84 berkas).
Cabang `umpan-balik-klien-gelombang-1` — sumber butir 1 yang jadi alasan P1 ini
— sudah membawa `20260922100000_pekan_sabtu_jumat.sql` dan
`20260924100000_materi_jejak_buka.sql` yang belum ter-merge. Praktisnya: pakai
`20260926*` ke atas, supaya urutan penerapan sama antara DB segar dan DB yang
sudah menerima cabang itu.

Keenamnya, supaya angka "enam" bisa diperiksa:

1. `*_pesanan_enum.sql` — tiga tipe enum + `perpindahan_pesanan_sah()`.
2. `*_pesanan_tabel.sql` — `orders`, `order_items`, CHECK, indeks, grant, policy.
3. `*_pesanan_jejak.sql` — `jejak_pesanan`, `notifikasi_pesanan`,
   `notifikasi_ditolak_harian`.
4. `*_pesanan_rpc.sql` — `buat_pesanan`, `catat_token_snap`,
   `batalkan_pesanan_saya`, `punya_pesanan_menunggu`, `putuskan_pesanan_ditahan`,
   `tutup_tinjauan`.
5. `*_pesanan_webhook_rpc.sql` — `terapkan_notifikasi_midtrans`,
   `salurkan_pesanan`, `terbitkan_akses_item`, view `pesanan_item_staf`.
6. `*_entitlement_tambal.sql` — penambalan `digital_entitlements`.

**Nol `alter table booking_requests`, nol `alter type pay_status`, nol sentuhan
gerbang isi produk.**

### Enum

`order_status`: `menunggu_bayar`, `ditahan`, `lunas`, `kedaluwarsa`,
`dibatalkan`. **Lima nilai, bukan enam** — `ditinjau` dibuang: ia adalah
mekanisme tinjauan kedua yang hidup berdampingan dengan `butuh_tinjauan_pada`
tanpa satu pun kalimat yang menyebut apa yang melahirkannya, dan pesanan yang
masuk ke sana tidak punya jalan pulang. Penanda tinjauan sekarang **satu**, dan
ia ortogonal terhadap status: `butuh_tinjauan_pada`.

`order_item_source`: `produk_digital`, `sesi`.

`order_event`: `dibuat`, `token_terbit`, `notifikasi`, `lunas`, `ditahan`,
`kedaluwarsa`, `dibatalkan`, `selisih_nominal`, `selisih_status`,
`lunas_setelah_tutup`, `akses_terbit`, `akses_sudah_ada`, `akses_tertahan`,
`penangan_belum_ada`, `diperiksa_ulang`, `tinjauan_ditutup`. Tidak ada kejadian
"tinjauan dibuka": yang membukanya selalu salah satu dari lima kejadian di
"Penanda tinjauan" di bawah, dan nilai enum yang tidak punya penulis adalah
nilai yang pasti salah dibaca kelak.

`order_status` sengaja enum **terpisah** dari `pay_status`: nol
`alter type ... add value` berarti nol risiko 55P04, dan assertion money
firewall yang mengunci tiga pemilik kolom `status_bayar`
(`tests/money-firewall-struktural.test.ts:236-240`) tetap utuh. Kolomnya bernama
`status`, bukan `status_bayar`.

Nilai `order_item_source.'sesi'` lahir sekarang meski nol penulis — preseden
yang sama dengan `entitlement_source.'beli'`.

### `orders`

`id`, `kode` (unik, `PSN-YYMMDD-XXXXXX`), `percobaan` (1..9), `client_id`
(FK `clients`, **`on delete restrict`**), `status`, `jumlah_item`, `dibuat_pada`,
`kedaluwarsa_pada`, `lunas_pada`, `ditutup_pada`, `snap_token`,
`snap_diterbitkan_pada`, `notifikasi_pada`, `diperiksa_pada`,
`butuh_tinjauan_pada`, `sebab_tinjauan`, `kanal`, `transaksi_id`,
`status_midtrans`.

**Tanpa kolom nominal.** Total dijumlahkan dari `order_items`.

`kedaluwarsa_pada = dibuat_pada + interval '24 hours'`, dan **durasi yang sama
dikirim sebagai `expiry` di payload Snap, dari satu konstanta di kode.** Dua
angka yang boleh berbeda adalah dua kegagalan simetris: kolom lebih pendek →
kita berhenti bertanya sementara VA-nya masih bisa dibayar, dan settlement
mendarat pada pesanan yang sudah kita tutup; kolom lebih panjang → Lapis 3
menanyai Midtrans tentang transaksi yang tak akan pernah berubah. Angka 24 jam
mengikuti keputusan pemilik repo yang sudah berlaku untuk tenggat bayar sesi
(`20260912130000_tenggat_dan_skrining.sql:4`), jadi klien tidak menghadapi dua
tenggat berbeda di satu aplikasi.

`kode` dihasilkan dari `upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))`
— `gen_random_uuid()` bawaan Postgres dan sudah dipakai sebagai default di
seluruh tabel repo ini (mis. `20260921120000_produk_entitlement.sql:12`).
Tabrakan `unique (kode)` diulang paling banyak lima kali di dalam RPC, lalu
menyerah dengan galat yang bisa dibaca; enam heksadesimal per tanggal berarti
tabrakan adalah kejadian yang tidak akan pernah dilihat siapa pun, tapi penulis
yang tidak menanganinya membuat checkout gagal dengan 23505 telanjang.

`order_id` yang dikirim ke Midtrans adalah `kode || '.' || percobaan`. Midtrans
menolak `order_id` kembar selamanya; sufiks percobaan itulah jalan keluar ketika
token gagal terbit dan `order_id`-nya sudah terbakar. **`percobaan` dinaikkan
HANYA oleh `buat_pesanan(p_product_id, p_ulang := true)`**, yaitu ketika rute
checkout memanggil ulang sesudah Snap menolak menerbitkan token — bukan setiap
kali halaman dibuka. Percobaan kesepuluh tidak melempar 23514: RPC menutup
pesanan itu jadi `dibatalkan` dan melahirkan pesanan baru, sehingga batas
`1..9` adalah pagar terakhir, bukan jalur pemulihan.

**Dua CHECK positif berpasangan, bukan satu:**

```sql
constraint pesanan_tutup_bercap check (
  (status in ('ditahan','lunas','kedaluwarsa','dibatalkan')) = (ditutup_pada is not null)),
constraint pesanan_terbuka_tanpa_cap check (
  (status = 'menunggu_bayar') = (ditutup_pada is null)),
```

Nilai enum keenam yang lupa diklasifikasikan jatuh ke luar **keduanya** dan
gagal 23514 pada penulisan pertamanya. Satu CHECK saja fail-*open*: `false =
false` lolos.

Satu pesanan terbuka per klien, dijaga basis data:

```sql
create unique index pesanan_terbuka_satu_per_klien
  on public.orders (client_id) where status = 'menunggu_bayar';
```

Itulah yang membuat "dua panggilan checkout paralel melahirkan tepat satu
pesanan" benar tanpa kunci di TypeScript: yang kalah menerima 23505, membaca
ulang, dan memulangkan pesanan terbuka yang sudah ada bila produknya sama —
atau galat yang bisa dibaca ("selesaikan dulu pesanan yang terbuka") bila
produknya berbeda. P1 memang satu item per pesanan; P2 mewarisi indeks yang sama.

Hak: `revoke all from anon, authenticated`, lalu `grant select to authenticated`
saja — tidak pernah insert maupun update. Dua policy SELECT: klien membaca
miliknya, staf membaca semua. Policy SELECT untuk staf aman; bahaya
`PATCH ?filter=tautologi` datang dari grant UPDATE, dan UPDATE tidak pernah
diberikan.

### `order_items`

`id`, `pesanan_id` (FK `orders` on delete cascade), `jenis`, `product_id`
(nullable, FK), `booking_request_id` (nullable, FK), `judul_beku`, `harga_beku`,
`urutan`, dengan `check (num_nonnulls(product_id, booking_request_id) = 1)` dan
`unique (pesanan_id, urutan)`.

**Dua CHECK bercermin, bukan satu** — alasan yang sama dengan `orders`:

```sql
check ((jenis = 'produk_digital') = (product_id is not null)),
check ((jenis = 'sesi')          = (booking_request_id is not null)),
```

Dengan satu CHECK saja, nilai `order_item_source` ketiga (`'kelas'`, misalnya)
yang membawa `booking_request_id` lolos kedua pagar. Spec ini baru saja
melahirkan `'sesi'` sebelum ada penulisnya, jadi nilai ketiga bukan hipotesis
jauh.

**Nol grant, nol policy.** Trigger menolak seluruh UPDATE — tanpa gerbang
`current_user`, karena yang paling mungkin menulis ulang harga beku adalah
webhook ber-service-role, persis peran yang idiom gerbang itu kecualikan. DELETE
sengaja **tidak** dijaga: cascade dari `orders` menjalankan DELETE sungguhan
pada baris anak, dan menolaknya membuat pesanan mustahil dihapus siapa pun,
termasuk pembersihan fixture.

`booking_request_id` lahir sekarang dan tidak pernah terisi di P1. Repo punya
doktrin melawan kolom mati, dan ini dilanggar **sadar**: ongkosnya asimetris —
satu kolom nullable hari ini versus `alter table` pada tabel uang yang sudah
memuat nota nyata besok.

### `pesanan_item_staf` (view)

View `security_invoker = off` dengan predikat `user_role() in ('admin','owner')`
di dalam badannya, memproyeksikan `pesanan_id`, `kode`, `jenis`, `judul_beku`,
`harga_beku`, `urutan`. `revoke all from public, anon, authenticated` lalu
`grant select to authenticated`. Anon tidak pernah.

Karena view ini memuat nominal, ia didaftarkan **per-kolom** di
`KOLOM_UANG_VIEW_DIIZINKAN` — pola yang sama dengan `varian_harga_staf`. Ia
adalah yang **dibaca `/admin/pesanan`**; view bernominal tanpa pembaca berarti
keputusan pemilik repo berhenti di basis data.

### `jejak_pesanan`

Kolomnya ditulis supaya "unique pada keputusan" tidak punya dua bacaan:

`id`, `pesanan_id`, `padma_id`, `kejadian` (`order_event`), `keterangan`,
`dibuat_pada`.

Pola `jejak_status_bayar` (`20260829160000_jejak_status_bayar.sql`): tanpa FK
(sengaja — jejak yang ikut lenyap bersama yang diaudit tidak berguna), policy
**baca staf saja**, `revoke all` lalu `grant select to authenticated`, pengisian
oleh fungsi `security definer`. `padma_id` didenormalisasi supaya pelanggan
kejadian tidak perlu hak baca `clients`.

Satu indeks, bukan dua, dan ia sekaligus kontraknya:

```sql
create unique index jejak_pesanan_lunas_sekali
  on public.jejak_pesanan (pesanan_id) where kejadian = 'lunas';
```

`unique (pesanan_id, kejadian)` **salah**: `notifikasi` lahir satu per notifikasi
Midtrans, `diperiksa_ulang` satu per panggilan Lapis 3, `token_terbit` satu per
`percobaan`. Yang dijanjikan ke proyek WhatsApp adalah jejak `'lunas'` lahir
**tepat satu kali** per pesanan — itu saja, dan itulah indeks di atas.

### `notifikasi_pesanan` dan `notifikasi_ditolak_harian`

`notifikasi_pesanan`: `id`, `pesanan_id`, `sidik` (**`unique`**), `transaksi_id`,
`status_midtrans`, `kanal`, `nominal_diterima`, `diterima_pada`. Lapis idempotensi
pertama, dan sekaligus satu-satunya tempat **nominal yang benar-benar diterima
Midtrans** disimpan — diambil dari `gross_amount` notifikasi yang **sudah lolos
signature**, tidak pernah dari badan yang belum diverifikasi.

Kenapa nominal itu perlu ada: untuk pesanan `lunas`, `sum(harga_beku)` sudah
menjawab "berapa yang dibayar" karena verifikasi jumlah lolos. Untuk pesanan
`ditahan` — satu-satunya baris yang angkanya benar-benar jadi keputusan manusia,
karena artinya "uang masuk tapi jumlahnya tidak cocok" — yang tersimpan tanpa
kolom ini hanyalah angka yang KITA tagih, dan staf tetap harus membuka dashboard
Midtrans untuk tahu selisihnya. Ongkosnya disebut terbuka: `notifikasi_pesanan`
ikut masuk `TABEL_UANG`. Policy: **baca staf saja**, pola `jejak_status_bayar`,
supaya `/admin/pesanan` bisa membacanya dengan sesi pemanggil tanpa service role.

`notifikasi_ditolak_harian`: `tanggal` (PK), `jumlah`. Menghitung notifikasi
bertanda tangan salah per hari, tanpa menyimpan satu teks pun dari penyerang.
Kolomnya **`jumlah`, bukan `total`** — `/(^|_)totals?(_|$)/` adalah salah satu
dari sembilan belas pola money firewall, dan penghitung penyerang bukan tabel
uang. Tanpa policy: RLS aktif, nol policy, hanya service role.

### Penambalan `digital_entitlements`

Migrasi keenam, dan satu-satunya tempat P1 menyentuh tabel yang sudah dipakai
produksi. `revoke insert, update from authenticated`; policy staf dipersempit
jadi `for select`; pemberian akses pindah ke RPC ber-radius terkunci. Ditambah
satu kolom: `pesanan_id uuid null references public.orders(id) on delete restrict`.

Alasan pencabutan hak: lubang itu mendahului P1, tapi **P1 yang mengubah
artinya**. Sebelum P1, entitlement tidak punya harga. Sesudah P1, `sumber='beli'`
adalah klaim pendapatan yang bisa dikarang setiap akun staf tanpa satu baris
`orders` maupun `jejak_pesanan` — dan cerita rekonsiliasi yang P1 janjikan buta
sepenuhnya terhadapnya, karena ia hanya melihat dari sisi pesanan.

Alasan kolom `pesanan_id`: tanpanya invarian rekonsiliasi tidak punya kunci
pasangan sama sekali. `jejak_pesanan` sengaja tanpa FK, dan `product_id` hidup di
`order_items` — "berpasangan" jadi kueri yang harus dirancang sendiri oleh
implementer, padahal itulah inti janji P1. Dengan kolomnya, invariannya satu
join dan uji rekonsiliasinya berbunyi harfiah: **tidak ada entitlement
`sumber='beli'` dengan `pesanan_id is null`, dan setiap `pesanan_id` yang
ditunjuk berstatus `lunas`.** Ia uji suite atas basis data lokal, bukan
pemeriksaan terhadap produksi — produksi belum punya satu pun baris `beli`.
Ia sekaligus menjawab "pesanan mana yang membayari akses ini" untuk P4. Pembersihan fixture menghapus entitlement sebelum pesanan —
konsekuensi `restrict` yang disebut di sini supaya tidak ditemukan sebagai galat.

`client_id` tabel ini tetap `on delete cascade`
(`20260921120000_produk_entitlement.sql:13`), **diperiksa dan sengaja dibiarkan**:
setiap entitlement `sumber='beli'` kini menunjuk `orders`, dan `orders.client_id`
adalah `restrict` — jadi klien yang pernah membeli tidak bisa dihapus sama
sekali, dan cascade itu tidak akan pernah mengenai catatan pembelian. Yang masih
bisa lenyap bersama klien hanyalah entitlement `gratis`/`pemberian_admin`, yang
bukan nota.

Aman dilakukan: tiga kueri `digital_entitlements` di `src/` seluruhnya `.select()`
(`admin/produk/[id]/page.tsx:47`, `produk/[slug]/tombol-ambil.tsx:114`,
`lib/passport/produk-saya.ts:64` — baris `.from(...)`-nya; filter
`.is("dicabut_pada", null)` duduk tiga baris di bawah masing-masing), dan
satu-satunya penulis produksi
(`ambil_produk_gratis`) adalah `security definer` sehingga pencabutan hak
`authenticated` tidak menyentuhnya. Karena kesimpulan itu bersandar pada satu
kata kunci di satu baris migrasi, P1 mengirim uji yang membuktikannya: alur
ambil produk gratis harus tetap hijau **sesudah** revoke.

## Mesin status

Ditulis sebagai **himpunan**, bukan konstanta tunggal — pelajaran yang repo ini
sudah bayar sekali: nilai enum baru membuat konstanta tunggal salah diam-diam,
dan plpgsql tidak bisa dipaksa kompilator seperti TypeScript.

- **TERBUKA** (boleh menerima uang): `menunggu_bayar`
- **TIDAK AKTIF**: `ditahan`, `lunas`, `kedaluwarsa`, `dibatalkan`
- **BERUANG** (uang sudah masuk): `lunas`, `ditahan`
- **MATI** (boleh checkout ulang): `kedaluwarsa`, `dibatalkan`

```
menunggu_bayar → lunas | ditahan | kedaluwarsa | dibatalkan
ditahan        → lunas | dibatalkan   (HANYA lewat RPC putusan staf)
lunas / kedaluwarsa / dibatalkan → tidak ke mana pun
```

`punya_pesanan_menunggu(p_product_id)` memulangkan true untuk
`status in (TERBUKA) or status = 'ditahan'` — yaitu "belum mati dan belum
melahirkan akses". `ditahan` **wajib** ikut: uangnya sudah masuk, hanya
nominalnya meleset, dan menghitungnya sebagai "tidak ada pesanan" mengembalikan
tombol beli kepada orang yang sudah menyetor. Urutan yang dipakai layar
disebutkan supaya tidak ditebak: entitlement dulu (punya → tampilkan produknya),
baru fungsi ini (→ "Pembayaran Anda sedang diproses"), baru tombol beli.

`ditahan` ada supaya "uang masuk tapi jumlahnya tidak cocok" punya **keadaan
akhir**. Tanpanya pesanan itu `menunggu_bayar` selamanya, diperiksa ulang setiap
kali kliennya membuka halaman DAN disapu cron harian, dan melahirkan satu baris
jejak per jalan — kejadian yang seharusnya paling langka menjadi kebisingan
paling berisik yang tak pernah didengar.

`kedaluwarsa` lahir **hanya dari jawaban Midtrans**: notifikasi `expire`/`cancel`,
jawaban Status API `expire`/`cancel`, atau 404 "Transaction doesn't exist"
ketika `kedaluwarsa_pada` sudah lewat plus tenggang satu jam. Yang terakhir
tetap "Midtrans yang memutuskan" — ia menyatakan transaksinya tidak pernah ada;
waktu lokal hanya memutuskan kapan berhenti bertanya, dan satu jam itu margin
terhadap jam Midtrans, bukan perpanjangan tenggat. **Tidak ada cron yang
menyapu pesanan jadi kedaluwarsa hanya karena jam dinding lewat.**

Fungsi `perpindahan_pesanan_sah(dari, ke)` ditutup dengan `else false` untuk
nilai enum yang belum dikenal, dan pemanggilnya membungkus dengan
`coalesce(..., false)` — tanpa keduanya penjaganya fail-*open*, karena
`not NULL` adalah NULL dan `if NULL then` tidak dieksekusi.

### Penanda tinjauan: satu kolom, satu aturan

`butuh_tinjauan_pada` + `sebab_tinjauan` adalah **satu-satunya** penanda
tinjauan, dan ia ortogonal terhadap status. Aturannya tunggal dan mengikat:

> Setiap kejadian dalam himpunan {`selisih_nominal`, `selisih_status`,
> `lunas_setelah_tutup`, `akses_tertahan`, `penangan_belum_ada`} **WAJIB**
> menyetel `butuh_tinjauan_pada` dan `sebab_tinjauan` pada baris `orders`-nya,
> di transaksi yang sama dengan jejaknya.

Tanpa aturan ini, dua kegagalan termahal lolos dari jaring yang justru ada untuk
mereka. `lunas_setelah_tutup` adalah settlement yang mendarat pada pesanan
`kedaluwarsa`/`dibatalkan`: tidak ada transisi, penyalur tidak berjalan, akses
tidak terbit — statusnya bukan `ditahan` dan bukan `lunas`, jadi ia tak muncul di
blok mana pun meski uangnya sudah masuk. `akses_tertahan` sama: terminal, dan
"terminal" justru yang lolos. Dengan aturan di atas, predikat "Butuh perhatian"
tidak perlu tumbuh setiap kali ada nilai enum baru.

"Tutup tinjauan" mengosongkan kedua kolom itu dan melahirkan `tinjauan_ditutup`.
Ia tidak menyentuh status sama sekali — itulah keuntungan membuang `ditinjau`.

Dan justru karena ia tidak menyentuh status, ia **menolak baris berstatus
`ditahan`** (errcode `P0001`, kalimatnya menyuruh memakai "putuskan"). Tanpa
penolakan itu, satu klik menghasilkan pesanan `ditahan` ber-`butuh_tinjauan_pada
is null`: uang pembeli sudah di tangan Midtrans, aksesnya tidak pernah terbit,
dan barisnya lolos dari klausa penanda sekaligus dari jaring `lunas`. Klausa
`status = 'ditahan'` di blok "Butuh perhatian" adalah pagar keduanya — dua pagar
untuk satu lubang, karena lubang ini memakan uang orang.

## Checkout

Satu kalimat arsitektur, supaya tiga penyebutan tidak berarti tiga mekanisme:

> Checkout adalah rute tipis `/api/pesanan/checkout` yang memanggil RPC
> `buat_pesanan(p_product_id, p_ulang)` **dengan sesi pemanggil** — bukan server
> action, dan **tidak pernah service role**. RPC-lah yang memilih `client_id`
> dari `auth.uid()`, membekukan harga, menerbitkan `kode`, dan menolak pesanan
> terbuka kedua lewat unique parsial.

Token Snap dicatat lewat `catat_token_snap(p_pesanan_id, p_token)`, dan
`/api/pesanan/[id]/batal` memanggil `batalkan_pesanan_saya(p_pesanan_id)` —
keduanya dengan sesi pemanggil, memilih barisnya dari `auth.uid()`, dan hanya
menerima pesanan `menunggu_bayar`. Pembatalan mandiri itu bukan hiasan: karena
satu klien hanya boleh punya satu pesanan terbuka, tanpa tombol itu orang yang
berubah pikiran soal produk harus menunggu 24 jam. Yang bisa disalahgunakan
pemanggil hanyalah pesanannya sendiri — ia merusak checkoutnya sendiri, bukan
milik orang lain, dan `snap_token` tidak pernah dipercaya sebagai bukti
pembayaran oleh apa pun.

## Webhook

`src/app/api/pembayaran/midtrans/route.ts`, POST saja, `runtime = "nodejs"`.
Hidup di `src/app/api/**`, bukan `src/app/admin/**`, jadi larangan service role
(`tests/admin-shell.test.ts:605`) tidak tersentuh.

Urutannya mengikat:

1. **Badan dibatasi 16 KB** dengan pagar byte nyata — `content-length` boleh
   bohong. Lewat → 400.
2. **`MIDTRANS_SERVER_KEY` kosong → 503**, bukan 401 dan bukan 200. Ini
   keputusan yang paling mudah salah: 2xx/4xx memberi tahu Midtrans "sudah
   selesai" dan notifikasi itu tidak pernah datang lagi; 503 membuatnya
   mengirim ulang, sehingga env yang lupa dipasang berakhir sebagai
   keterlambatan, bukan sebagai uang yang hilang.
3. **Zod, semua `z.string()`** — bukan `z.coerce`. Signature dihitung atas
   string persis seperti dikirim; mengubah `"150000.00"` jadi angka lalu kembali
   mematahkannya dengan cara yang terlihat seperti "Midtrans salah". Wajib:
   `order_id`, `status_code`, `gross_amount`, `signature_key`,
   `transaction_status`, `transaction_id`. Opsional: `fraud_status`,
   `payment_type` (`fraud_status` hanya ada pada kartu). Skemanya **tidak**
   `.strict()`: field baru dari Midtrans diabaikan, bukan menolak notifikasi —
   400 di sini mengunci pesanan mati. Gagal → 400.
4. **Bentuk `order_id`** disaring regex sebelum satu sha512 pun dihitung. Tidak
   cocok → 400, nol sentuhan basis data.
5. **Signature** `sha512(order_id + status_code + gross_amount + serverKey)`,
   panjang disamakan lebih dulu lalu `timingSafeEqual` — fungsi itu **melempar**
   pada panjang berbeda. Tidak cocok → satu upsert penghitung harian, lalu 401.
   Nol teks penyerang disimpan.
6. **Idempotensi** lewat `unique (sidik)` di `notifikasi_pesanan`, dengan
   `sidik` yang dihitung **harfiah** seperti ini, sesudah langkah 5:

   ```ts
   sidik = sha256hex([order_id, status_code, transaction_status,
                      fraud_status ?? "", transaction_id].join("|"))
   ```

   Dihitung di rute (Node `crypto`) dan dikirim sebagai argumen RPC.

   Yang **bukan** `sidik`, dan kenapa: `order_id` saja atau `transaction_id`
   saja adalah tebakan yang sangat wajar untuk kata "sidik pesanan", dan
   keduanya memakan uang. Midtrans mengirim beberapa notifikasi per pesanan
   (`pending` lalu `settlement`, kadang `capture` lalu `settlement`); dengan
   sidik sepesanan, notifikasi `pending` mendarat duluan, mengunci barisnya, dan
   `settlement` ditolak sebagai duplikat — pembeli membayar, uang masuk ke
   Midtrans, pesanan tinggal `menunggu_bayar` selamanya. `fraud_status` ikut
   karena `capture`+`challenge` dan `capture`+`accept` adalah dua keputusan
   berbeda atas transaksi yang sama.

   **Insert `notifikasi_pesanan` berada DI DALAM transaksi yang sama** dengan
   transisi dan penyaluran. Bila ia commit lebih dulu lalu transisi gagal, retry
   Midtrans ditolak sebagai duplikat dan kegagalan sementara menjadi permanen —
   kebalikan dari maksud Lapis 0. Rollback melepas sidiknya; retry masih bisa
   menyembuhkan.
7. **Verifikasi jumlah** terhadap `sum(harga_beku)` yang KITA simpan, dan
   `count(*)` terhadap `jumlah_item`. Tidak cocok → `ditahan` (+ `selisih_nominal`,
   + `butuh_tinjauan_pada`), bukan `lunas`. `gross_amount` yang diterima disimpan
   sebagai `nominal_diterima` apa pun hasilnya.
8. **Transisi dan penyaluran dalam SATU transaksi.**

Setiap UPDATE membawa `status = any(<array positif>)` di klausa `where`-nya,
sehingga cabang yang tidak mengenai baris tidak melanggar CHECK dan tidak
berubah menjadi loop 500 abadi sepanjang jendela retry Midtrans.

### Peta kode jawaban

"Retry Midtrans sebagai lapis nol" hanya berarti bila setiap keluaran punya
kodenya sendiri — termasuk yang paling sering terjadi.

| Kondisi | Kode | Kenapa |
|---|---|---|
| Badan > 16 KB | 400 | Bukan notifikasi Midtrans; retry tidak akan memperbaikinya |
| `MIDTRANS_SERVER_KEY` kosong | 503 | Salah kita, sementara — Midtrans wajib mengirim ulang |
| Zod gagal (field wajib tidak lengkap) | 400 | Badan yang tidak bisa diverifikasi; mengulanginya tidak mengubah apa pun |
| Bentuk `order_id` tidak cocok | 400 | Nol sentuhan basis data |
| Signature tidak cocok | 401 | Bukan dari Midtrans |
| `sidik` duplikat | 200 | Sudah diproses — "sudah selesai" memang jawaban yang benar |
| Transisi tidak mengenai baris | 200 | Keadaan akhir sudah tercapai; jejaknya tetap lahir |
| Sukses | 200 | — |
| Galat basis data / penyaluran melempar | 500 | Satu-satunya kelas yang retry benar-benar menyembuhkan |

## Kejadian dan penyaluran

Kejadian adalah **satu baris di `jejak_pesanan`**, diterbitkan di dalam
transaksi yang menggeser status. Bukan bus, bukan antrean, bukan NOTIFY — repo
ini punya nol infrastruktur pekerjaan latar, dan pembatas laju yang ada pun
mengakui di komentarnya sendiri bahwa `Map` per-proses tidak bertahan di
serverless (`src/lib/skrining/pembatas.ts:25`).

Penyalurnya satu `case` atas `order_items.jenis`, dan itulah **satu-satunya
tempat di seluruh mesin pembayaran yang tahu nama domain**:

```sql
case r.jenis
  when 'produk_digital' then perform public.terbitkan_akses_item(r.id);
  when 'sesi' then insert into public.jejak_pesanan (…, 'penangan_belum_ada', …);
end case;
```

Penyalur dipanggil di **transaksi yang sama** dengan pergeseran status. Itu
bukan detail — itulah yang membuat "lunas tanpa akses" mustahil alih-alih
sekadar jarang. Bila penyaluran dilakukan di TypeScript sesudah RPC pulang, ada
jendela antara "pesanan lunas" dan "akses terbit" yang bisa dimasuki proses yang
mati, dan memulihkannya menuntut persis infrastruktur yang sedang kita tolak
bangun.

Penyalur di-key pada **transisi**, bukan pada niat: ia hanya dipanggil dari
cabang yang benar-benar memindahkan baris. Tombol "terbitkan ulang akses" di
Lapis 2 karena itu memanggil `terbitkan_akses_item` **langsung**, bukan lewat
penyalur — aturan "penyalur hanya dari transisi" tetap utuh.

### Penyaluran akses: `terbitkan_akses_item(p_item_id)`, tiga keadaan

`digital_entitlements` punya `unique (client_id, product_id)`, jadi diam berarti
implementer yang memilih `do nothing` atau `do update`. Ketiganya ditulis
harfiah:

1. **Belum ada barisnya** → insert `sumber='beli'`, `pesanan_id` diisi;
   jejak `akses_terbit`.
2. **Ada dan `dicabut_pada is null`** → jejak `akses_sudah_ada`, **`sumber`
   TIDAK diubah**. Entitlement `gratis` yang produknya kemudian dibeli tetap
   `gratis`; yang mencatat pendapatan adalah `orders`, bukan kolom `sumber`, dan
   menaikkannya akan menulis ulang sejarah yang benar. `pesanan_id` diisi bila
   masih kosong, supaya pertanyaan "pesanan mana yang membayari akses ini" tetap
   terjawab.
3. **Ada dan `dicabut_pada is not null`** → **akses TIDAK dihidupkan**, jejak
   `akses_tertahan`, dan `butuh_tinjauan_pada` menyala. Mengikuti preseden
   `ambil_produk_gratis` yang menolak `do update` secara eksplisit
   (`20260921150000_ambil_produk_gratis.sql:49-52`): pencabutan adalah keputusan
   manusia, dan pembayaran tidak boleh membatalkannya diam-diam. Tapi
   "uang-masuk-barang-tak-keluar" tidak boleh ikut diam: kasus ini **selalu**
   terlihat manusia di blok "Butuh perhatian", dan "tutup tinjauan" adalah
   tindakan sadar yang menutupnya sesudah uangnya diurus dari dashboard Midtrans.

## Rekonsiliasi — empat lapis

Dua lapis pertama tidak butuh penjadwal.

**Lapis 0 — retry Midtrans.** Peta kode jawaban di atas adalah lapis ini: 500 di
mana retry menyembuhkan, 200 di mana tidak ada yang tersisa untuk disembuhkan,
4xx hanya untuk badan yang tidak akan pernah berubah. Ongkosnya nol dan ia
menutup mayoritas kasus.

**Lapis 1 — kebenaran dihitung saat dibaca.** Kepemilikan produk **selalu**
dibaca dari `digital_entitlements`, tidak pernah disimpulkan dari status
pesanan. Begitu webhook mendarat — sedetik atau sehari kemudian — layar langsung
benar tanpa ada yang perlu disapu. Ditambah `punya_pesanan_menunggu(product_id)`
supaya orang yang baru mentransfer lewat VA melihat "Pembayaran Anda sedang
diproses" alih-alih tombol beli, dan tidak membayar dua kali.

**Lapis 1b — pemeriksaan saat halaman dibuka. Inilah jaring pengaman utama P1,
bukan cron.** Ketika klien membuka `/produk/[slug]` atau `/passport/produk` dan
`punya_pesanan_menunggu` menemukan pesanannya menggantung **lebih dari lima
menit**, server menanyakan Status API Midtrans saat itu juga dan menjalankan
jawabannya lewat jalur yang sama dengan webhook.

Alasannya bukan kehematan, melainkan ketepatan sasaran: orang yang paling butuh
pemeriksaan itu — yang baru saja membayar lalu kembali mencari produknya —
adalah orang yang sedang membuka halaman itu. Ia memicu penyembuhannya sendiri,
dalam hitungan detik, tanpa penjadwal apa pun. Cron harian di Lapis 3 tinggal
menyapu sisa: pesanan milik orang yang tidak pernah kembali.

Pagarnya: pemeriksaan ini **tidak pernah dipicu lebih sering dari sekali per
pesanan per lima menit** (`diperiksa_pada`), supaya satu halaman yang di-refresh
berkali-kali tidak berubah jadi banjir permintaan ke Midtrans. Dan ia
**menyembunyikan kegagalannya**: kalau Midtrans tidak bisa dihubungi, halaman
tetap terender dengan keadaan yang ia tahu — pemeriksaan yang gagal tidak boleh
membuat orang melihat layar galat saat yang ia cari hanyalah produknya.

**Lapis 2 — dipicu manusia.** `/admin/pesanan`, membaca `pesanan_item_staf` dan
`notifikasi_pesanan` dengan sesi pemanggil (nol service role), dengan **dua blok,
bukan satu saringan**:

- **Butuh perhatian** — `butuh_tinjauan_pada is not null` **ATAU `status =
  'ditahan'`**, **tanpa memandang status**. Aturan penanda tinjauan di atas yang
  membuat klausa pertama cukup untuk kejadian. Klausa `ditahan` bukan
  kelebihan: ia satu-satunya status yang berarti **uang sudah masuk dan barang
  belum keluar**, dan ia harus tetap terlihat walau penandanya sudah
  dikosongkan. Satu klausa ketiga dipasang sebagai jaring yang tidak bergantung
  pada siapa pun mengingat: pesanan `lunas` yang tidak punya `akses_terbit`
  maupun `akses_sudah_ada`.
- **Terbuka** — urut `diperiksa_pada nulls first`.

Setiap baris menampilkan **nominal**: `harga_beku` per item dan totalnya. Untuk
baris `ditahan`, `nominal_diterima` notifikasi terakhir ditampilkan
**bersebelahan** dengan yang ditagih — itu satu-satunya tempat di seluruh PADMA di mana dua angka uang perlu
dibaca berdampingan, karena selisihnyalah yang menjadi keputusan manusia.

Empat tombol, masing-masing dengan alamatnya, supaya `tests/inventaris-rute.test.ts`
(yang memeriksa dua arah) tidak bisa merah karena tebakan mekanisme:
`/api/pesanan/[id]/periksa-ulang`, `/api/pesanan/[id]/terbitkan-akses`,
`/api/pesanan/[id]/putuskan`, `/api/pesanan/[id]/tutup-tinjauan`. Tanpa
tombol-tombol itu lapis 2 hanya bisa melaporkan, tidak bisa menyembuhkan.

Mekanisme keempatnya disebut di sini supaya tidak ada yang ditebak — dan supaya
tidak ada yang bertabrakan dengan daftar putih fungsi di "Pagar repo":

| Tombol | Mekanisme | Kenapa begitu |
|---|---|---|
| Periksa ulang | **Rute**, bukan RPC. `requireRole(["admin","owner"])`, tanya Status API, lalu jawabannya masuk lewat `terapkan_notifikasi_midtrans` dengan service role | Vonis Midtrans tidak boleh jadi parameter yang dikirim pemanggil bersesi. Karena itu fungsi mesinnya tetap tertutup bagi `authenticated` |
| Terbitkan akses | **Rute**, memanggil `salurkan_pesanan` dengan service role | Alasan sama: penyalur ada di `MESIN_TERTUTUP` |
| Putuskan | RPC `putuskan_pesanan_ditahan`, bergerbang `user_role()` | Putusannya memang keputusan staf, dan radiusnya satu pesanan |
| Tutup tinjauan | RPC `tutup_tinjauan`, bergerbang `user_role()` | Sama; ia hanya mengosongkan dua kolom dan menolak baris `ditahan` |

Dua yang pertama menulis `orders` dan `jejak_pesanan` **lewat fungsi mesin**,
bukan lewat fungsi barunya sendiri — itulah yang membuat keduanya tidak perlu
masuk daftar putih mana pun, dan yang membuat pengikat "setiap fungsi penulis
ada di tepat satu daftar" tetap benar.

`putuskan_pesanan_ditahan(p_pesanan_id, p_putusan)` menerima **dua** putusan —
`lunas` atau `dibatalkan` — karena "putuskan" yang hanya punya satu hasil bukan
putusan: admin yang menemukan pembayaran kurang Rp 50.000 harus punya jalan
selain "berikan saja". Penjaganya dinyatakan: hanya dari `status='ditahan'`,
hanya bila pesanan itu punya baris `notifikasi_pesanan` dengan `nominal_diterima`
tidak null (uangnya memang pernah tercatat masuk, bukan sekadar diklaim admin),
dan `padma_id` pemutusnya dicatat di jejak.

Ini **tidak** membantah aturan "vonis Midtrans tidak boleh jadi parameter".
Perbedaannya disebut supaya tidak dibaca sebagai kelalaian: vonis Midtrans
memang tidak boleh diparameterkan — itulah kenapa pemeriksaan ulang adalah rute
server yang menanyai Status API, bukan RPC berparameter status, atau admin mana
pun bisa mencetak `lunas` dengan satu curl. Keputusan **manusia** atas pesanan
yang sudah BERUANG boleh diparameterkan, karena yang diputuskan bukan "apa kata
Midtrans" melainkan "apa yang kita lakukan terhadap uang yang sudah masuk", dan
ia dicatat dengan nama pemutusnya.

**Lapis 3 — cron harian, penyapu sisa.** `/api/cron/pesanan`, menanyakan Status
API untuk pesanan terbuka yang paling lama tidak diperiksa.

Kadensnya **sekali sehari**, dan itu bukan pilihan: paket Vercel Hobby hanya
mengizinkan cron harian, dan ekspresi yang lebih sering **menggagalkan deploy**
(lihat Risiko). Karena itu lapis ini bukan jaring utama — Lapis 1b yang jadi
jaring utama, dan lapis ini hanya menangkap pesanan milik orang yang tidak
pernah membuka halamannya lagi.

- **Wajib mengekspor GET**: Vercel Cron memanggil GET, sementara rute preseden
  (`src/app/api/cron/tenggat/route.ts:22`) hanya mengekspor POST — tanpa ini
  lapis 3 mati dengan 405 sebelum satu baris kode kita berjalan.
- **Tapi GET saja tidak cukup, dan ini yang hampir terlewat**: tidak ada
  `vercel.json` di repo ini, baik di akar maupun di `web/`. Tidak ada satu pun
  blok `crons` di mana pun. `/api/cron/tenggat` "terlantar" bukan karena
  jadwalnya dimatikan — tidak pernah ada berkas jadwal. Jadi **P1 melahirkan
  `vercel.json`** (lihat "Pagar repo yang tersentuh").
- **Dijaga `CRON_SECRET`**: GET memeriksa `authorization: Bearer ${CRON_SECRET}`
  dan memulangkan 401 tanpanya, fail-closed persis seperti rute tenggat
  (`src/app/api/cron/tenggat/route.ts:23-28`). Tanpa itu, rute GET publik yang
  menembak Status API Midtrans bisa dipanggil siapa pun berulang kali.
  `CRON_SECRET` dibaca kode hari ini tetapi **belum ada di `.env.example`** —
  contoh nyata yang menjadi alasan `tests/env-terdokumentasi.test.ts` lahir.

Pemeriksaan ulang adalah **rute server**, bukan RPC berparameter status: vonis
Midtrans tidak pernah boleh jadi parameter yang dikirim pemanggil bersesi.

## Env

Empat, dan keempatnya masuk `.env.example` bersama P1:

- `MIDTRANS_SERVER_KEY` — server-only, dipakai signature. Kosong → webhook 503.
- `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` — Snap popup di peramban menuntutnya.
- `MIDTRANS_PRODUKSI` — **hanya nilai `"true"`** yang memilih `app.midtrans.com`
  dan URL skrip Snap produksi; nilai lain apa pun jatuh ke sandbox. Sengaja
  bukan `NODE_ENV`: pratinjau Vercel berjalan dengan `NODE_ENV=production` dan
  akan menembak Midtrans produksi, yaitu uang sungguhan dari lingkungan yang
  dibuat untuk coba-coba.
- `CRON_SECRET` — sudah dibaca kode, belum terdokumentasi.

## Pagar repo yang tersentuh

Suntingan sadar, dalam commit yang sama dengan migrasinya:

1. **`tests/money-firewall-struktural.test.ts`** — tambah `order_items` dan
   `notifikasi_pesanan` ke `TABEL_UANG`, dan `pesanan_item_staf` ke
   `KOLOM_UANG_VIEW_DIIZINKAN` (per-kolom). Dokbloknya membantah preseden C2
   secara eksplisit: doktrin "nominal diturunkan, tidak pernah disimpan" benar
   untuk **tagihan** (pernyataan tentang apa yang harus dibayar, boleh dihitung
   ulang), dan salah untuk **pesanan** (pernyataan tentang apa yang sudah
   dibayar, tidak boleh dihitung ulang karena angka pembandingnya ada di tangan
   Midtrans dan ikut ditandatangani). Verifikasi jumlah mustahil tanpa angka
   beku. `orders` **tidak** masuk: ia lahir nol kolom nominal.
   Kesempitan per-kolom untuk kedua tabel dasar dijaga cara rumah — dua uji satu
   batas: `expect(diTabelUang).toContain("order_items.harga_beku")` dan
   `toContain("notifikasi_pesanan.nominal_diterima")` ditambahkan ke uji "kolom
   uang yang sah TETAP di tempatnya" (`:215`), persis seperti `transport_rates`.

   Satu batas yang perlu disadari, karena ia berbeda dari yang diminta
   "daftarkan per-kolom": `toContain` menjamin kolom yang **sudah** ada tetap di
   tempatnya, tapi tidak menahan kolom nominal **baru** yang kelak ditambahkan
   ke dua tabel itu — ia akan lolos tanpa satu pun uji merah. Karena itu kedua
   tabel ini juga mendapat assertion daftar kolom **persis** (`toEqual` atas
   nama kolom nominalnya), pola yang sama yang sudah menjaga `harga_publik`.
   Tabel uang yang boleh tumbuh diam-diam adalah tabel uang yang tidak dijaga.
2. **`tests/struktur-rls.test.ts`** — `order_items` dan
   `notifikasi_ditolak_harian` masuk `SENGAJA_TERKUNCI`, **disisipkan menurut
   abjad**: assertion-nya `toEqual` atas hasil `order by c.relname` (`:43`), jadi
   menambah di ujung membuatnya merah dengan pesan yang tidak menjelaskan apa
   pun. Daftarnya menjadi `client_invites`, `notifikasi_ditolak_harian`,
   `order_items`, `screening_claims`. `jejak_pesanan`, `notifikasi_pesanan`, dan
   `orders` **tidak** masuk — ketiganya punya policy baca staf.
3. **`tests/admin-shell.test.ts`** — tambah `/admin/pesanan` ke daftar tujuan,
   naikkan hitungan tautan yang dikunci persis (`:432`, `11 + 4`), **dan perbaiki
   judul ujinya di `:408`** yang berbunyi "memuat sebelas tujuan" — judul yang
   berbohong sesudah tujuannya dua belas adalah basi yang tidak memerahkan apa
   pun dan bertahan bertahun-tahun.
4. **`web/README.md`** — sembilan baris rute baru (`/api/pesanan/checkout`,
   `/api/pesanan/[id]/batal`, `/api/pesanan/[id]/periksa-ulang`,
   `/api/pesanan/[id]/terbitkan-akses`, `/api/pesanan/[id]/putuskan`,
   `/api/pesanan/[id]/tutup-tinjauan`, `/api/pembayaran/midtrans`,
   `/api/cron/pesanan`, `/admin/pesanan`). `tests/inventaris-rute.test.ts`
   memeriksa dua arah.
5. **`web/vercel.json` — berkas BARU, P1 yang melahirkannya.** Blok `crons`
   berisi **hanya** `/api/cron/pesanan`, kadens **`0 3 * * *`** — sekali sehari.

   **Alamatnya `web/`, bukan akar repo**, dan itu bukan selera: tidak ada
   `package.json` maupun `next.config.*` di akar (diperiksa — keduanya hanya di
   `web/`), jadi root direktori proyek Vercel adalah `web/`, dan `vercel.json`
   di akar repo tidak akan pernah dibaca. Bentuk kegagalannya senyap dua kali —
   berkasnya ada, ujinya hijau, dan cron-nya tidak pernah berjalan. `tests/pesanan-vercel-cron.test.ts` karena itu
   membaca `web/vercel.json` dengan path harfiah dan merah bila berkas itu tidak
   ada di sana.
6. **`tests/grant-anon.test.ts`** — tambah kelima tabel baru dan view staf.
7. **`.env.example`** — keempat env di seksi "Env".

**`tests/setup-fetch-guard.ts` TIDAK disunting.** Pagar itu adalah **daftar
izin**: host yang terdaftar LOLOS ke internet sungguhan (lihat pengecualian R2
"Ruling 10" di puncak berkas). Menambahkan `.sandbox.midtrans.com` berarti
memberi izin uji menembak Midtrans sandbox sungguhan — dan P1 tidak punya uji
integrasi semacam itu. Yang berlaku: **setiap uji yang mengimpor rute webhook
atau cron wajib menstub `globalThis.fetch`**, karena pagar itu melempar untuk
setiap host selain 127.0.0.1/localhost/::1.

Yang hijau tanpa suntingan, sudah diverifikasi terhadap berkas ujinya:
kesembilan belas regex money firewall (`:124-144`) dijalankan terhadap seluruh
nama kolom usulan. **Tiga entri merah, bukan satu** — uji itu memindai BASE
TABLE **dan** VIEW (`:177`): `order_items.harga_beku`,
`pesanan_item_staf.harga_beku`, dan `notifikasi_pesanan.nominal_diterima`.
Ketiganya ditangani suntingan #1. Sisanya bersih: `lunas_pada` aman sementara
`dibayar_pada` tidak akan; `kanal` aman sementara `payment_type` tidak;
`jumlah_item` dan `jumlah` aman sementara `total` tidak; kesembilan belas kolom
`orders` bersih seluruhnya. `status-satu-sumber` tidak tersentuh karena polanya
menuntut kutip penutup dan `"menunggu_bayar"` tidak cocok.

**Pagar baru yang wajib lahir bersama P1:**

- **`tests/fungsi-mesin-tertutup.test.ts`** — yang paling penting, dan
  pengikatnya harus ditulis benar atau ia mustahil dipenuhi. Diagnosis intinya
  benar dan terverifikasi: fungsi baru **lahir terbuka** untuk setiap pengguna
  login (`tests/hak-default-sequence-fungsi.test.ts:158` meng-assert default ACL
  memberi `authenticated` EXECUTE; `:253` membuktikannya atas fungsi yang baru
  dibuat), dan templat aturan [F] di repo sendiri menulis
  `revoke ... from public, anon` **tanpa** `authenticated`
  (`supabase/migrations/20260828230000_fail_closed_sequence_fungsi.sql:176-177`)
  — jadi implementer yang mengikuti templat rumah membuka pintu dan suite tetap
  hijau.

  Yang **tidak** benar, dan karena itu tidak ditulis: bukan "tidak ada uji hak
  fungsi selain sapuan anon". Hak `authenticated` hari ini dijaga **per-fungsi**
  di dua tempat — `tests/tenggat-bayar.test.ts:155` (`batalkan_lewat_tenggat`)
  dan `tests/varian-struktur.test.ts:105` (`terbitkan_varian_baku`) — dan bentuk
  revoke ketatnya sudah jadi preseden migrasi:
  `revoke all on function ... from public, anon, authenticated`
  (`20260830150000_pengerasan_tabel_uang.sql:197,249,319,360`). Itulah templat
  yang disalin. Yang pagar ini ubah: **dua contoh yang harus diingat satu per
  satu menjadi daftar yang dipaksa lengkap.**

  Aturannya **daftar putih bernama**, bukan konsekuensi otomatis dari "menulis
  tabel X" — aturan itu akan melarang persis fungsi yang P1 butuhkan terbuka,
  merah sejak commit pertama, dan satu-satunya penyembuhnya melanggar cakupan.
  Dua daftar, dan setiap fungsi yang `pg_proc.prosrc`-nya menulis `orders`,
  `order_items`, `jejak_pesanan`, atau `digital_entitlements` wajib ada di
  **tepat satu** di antaranya:

  | Daftar | Isi | Assertion |
  |---|---|---|
  | `MESIN_TERTUTUP` | `terapkan_notifikasi_midtrans`, `salurkan_pesanan`, `terbitkan_akses_item`, `perpindahan_pesanan_sah` | `has_function_privilege('authenticated', …)` = **false** |
  | `TERBUKA_SADAR` | `ambil_produk_gratis`, `buat_pesanan`, `catat_token_snap`, `batalkan_pesanan_saya`, `putuskan_pesanan_ditahan`, `tutup_tinjauan` | EXECUTE **true**, DAN `prosrc` memuat `auth.uid()` atau `user_role()` |

  Kolom terakhir itulah pengikat yang sesungguhnya dimaksud: fungsi boleh
  terbuka bagi `authenticated` **asal ia memeriksa sendiri siapa pemanggilnya**.
  `ambil_produk_gratis` dan `buat_pesanan` memilih `client_id` dari `auth.uid()`
  alih-alih memercayai payload; `catat_token_snap` memilih barisnya dengan cara
  yang sama; `putuskan_pesanan_ditahan` bergerbang `user_role()`. Fungsi penulis
  baru yang lahir tanpa masuk salah satu daftar membuat uji merah — yang
  dipaksa bukan pilihannya, melainkan pilihannya diambil sadar.
- **`tests/admin-pesanan.test.ts`** — merender `/admin/pesanan` dan menuntut
  markup-nya **MEMUAT** nominal: `expect(nominalDalam(markup)).not.toEqual([])`.
  Assertion ini **kebalikan** dari konvensi rumah, dan dokbloknya wajib
  mengatakannya: modul ini sengaja dikecualikan dari konvensi "layar admin nol
  rupiah", **atas keputusan pemilik repo**, beserta utang P3 yang tercatat di
  "Catatan: nominal di layar staf". Tanpa uji ini keputusan itu gugur lewat
  ketiadaan, karena konvensinya ditegakkan per modul.
- `tests/pesanan-vercel-cron.test.ts` — `web/vercel.json` ada, `crons`-nya memuat
  `/api/cron/pesanan`, dan **`/api/cron/tenggat` ABSEN dari berkas itu**. Selama
  tidak ada berkas jadwal, "tenggat tidak dijadwalkan" adalah non-tindakan yang
  gratis; begitu berkasnya lahir, ia berubah jadi baris yang harus sengaja TIDAK
  diketik — dan keputusan yang bergantung pada seseorang mengingat untuk tidak
  mengetik sesuatu bukan keputusan yang terjaga. Uji ini yang menjaganya.
- `tests/pesanan-status-db.test.ts` — melingkari `pg_enum`, bukan daftar TS.
- `tests/pesanan-nota-beku.test.ts` — UPDATE `order_items` sebagai service role
  harus 42501, dan DELETE cascade dari `orders` harus berhasil.
- `tests/pesanan-jejak-yatim.test.ts` — saudara `jejak-yatim.test.ts`.
- `tests/pesanan-checkout-db.test.ts` — penolakan diuji lewat PostgREST
  langsung (RPC dengan sesi pemanggil, bukan server action); dua panggilan
  paralel melahirkan tepat satu pesanan; dua panggilan yang diselingi penambahan
  harga memulangkan nominal identik.
- `tests/pesanan-webhook.test.ts` — satu kasus per baris peta kode jawaban,
  termasuk urutan terbalik, `pending` lalu `settlement` (sidik berbeda, keduanya
  diproses), notifikasi kembar persis (sidik sama, yang kedua 200 tanpa efek),
  dan settlement pada pesanan yang sudah tertutup (`lunas_setelah_tutup` +
  `butuh_tinjauan_pada` menyala).
- `tests/pesanan-akses-tiga-keadaan.test.ts` — ketiga keadaan
  `terbitkan_akses_item`, termasuk yang ketiga: entitlement tercabut lalu
  dibayar → akses tetap mati, jejak `akses_tertahan`, `butuh_tinjauan_pada`
  menyala.
- **`ambil_produk_gratis` tetap hijau SESUDAH revoke** — satu kasus di uji
  produk gratis yang sudah ada. Itulah satu-satunya bukti bahwa penambalan
  migrasi keenam tidak mematikan fitur yang hidup di produksi, dan ia menutup
  kelas kesalahan yang grep nama tabel buta terhadapnya.
- `tests/env-terdokumentasi.test.ts` — setiap `process.env.X` di `src/` ada di
  `.env.example`. Kealpaan `CRON_SECRET` membuktikan kelas kesalahan ini tidak
  dijaga siapa pun.
- Uji nominal-sebagai-teks, **dipersempit**: bukan "digit panjang di kolom
  keterangan" secara umum, melainkan uji DB yang memindai isi kolom teks tabel
  pesanan saja (`orders.sebab_tinjauan`, `order_items.judul_beku`) dengan pola
  `\d{1,3}(\.\d{3}){1,}` atau `rp`. Penyempitan itu **sadar berbeda** dari
  keputusan `tests/helpers/nominal.ts:11-25`, dan bedanya disebut: di sana yang
  dipindai adalah markup React yang penuh kelas Tailwind (`opacity-[0.075]`,
  `0.016`) dan id numerik, sehingga ambang digit menuduh yang tidak bersalah; di
  sini yang dipindai adalah dua kolom teks basis data yang tidak pernah punya
  alasan memuat angka sah.

**Jangan pakai `gen_random_bytes`**: pgcrypto nol hasil di seluruh 84 migrasi,
jadi memakainya berarti memasang ekstensi baru di basis data produksi berisi
data klien nyata demi satu sufiks acak. `gen_random_uuid()` bawaan Postgres dan
sudah dipakai di mana-mana — pakai itu. (Aturan `set search_path` pada setiap
fungsi tetap berlaku seperti biasa; migrasi `20260907160000` bicara tentang
`search_path` yang TIDAK disetel, yaitu bahaya yang berbeda, jadi ia bukan
dasar larangan ini.)

## Sengaja tidak dibangun di P1

- **Keranjang** (P2). Checkout menerima satu produk. `orders.jumlah_item`
  sengaja tidak diberi `check (= 1)` supaya P2 tidak perlu migrasi ke tabel uang
  untuk mencabutnya; yang membatasi P1 adalah RPC-nya, bukan skemanya.
- **Pemindahan pembayaran sesi** (P3). `konfirmasi_permintaan()`,
  `terbitkanTagihan()`, `/api/bukti`, bucket `bukti-bayar`, dan **kesembilan
  berkas yang menyebut QRIS** tidak disentuh satu baris pun — empat berkas layar
  (`admin/bayar`, `passport/bayar` ×3), dua jalur pesan
  (`lib/tagihan/email-tagihan.ts`, `lib/tagihan/pesan-tagihan.ts`), dan tiga
  berkas baca/pengaturan (`lib/tagihan/baca.ts`, `lib/settings.ts`,
  `lib/pengaturan/bentuk.ts` — dua yang terakhir berarti QRIS punya saklar di
  panel admin). Angka itu milik taksiran P3; dibiarkan benar sejak sekarang.
- **Riwayat dan rekap** (P4). P1 tidak menjanjikan rekonsiliasi antara "yang
  dikerjakan" dan "yang diterima" — dua angka itu pasti berbeda begitu uang
  masuk, dan menjelaskan selisihnya adalah isi P4.
- **Notifikasi WhatsApp.** Kejadian diterbitkan dan dicatat; nol pelanggan.
  Tidak ada kolom `dikirim_wa_pada` — hanya proyek WA yang tahu apa artinya
  "sudah terkirim", dan kolom mati adalah persis yang doktrin repo tolak.
- **Pengembalian uang.** `refund`, `chargeback` dan variannya dicatat sebagai
  jejak; status tetap `lunas`, akses tidak dicabut. Repo ini tidak punya
  mekanisme pengembalian uang di mana pun. Status yang tidak punya kebijakan
  adalah keadaan mati yang tidak satu pun kode tahu cara keluar darinya;
  menebak kebijakan di webhook lebih buruk daripada memanggil manusia. Yang P1
  siapkan hanyalah `transaksi_id` yang bisa di-refund manusia dari dashboard.
- **Pemilihan metode bayar di kode.** Snap menampilkan semua metode yang aktif
  di akun merchant. "Pilihan lebih luas, tidak hanya QRIS" adalah setelan
  dashboard Midtrans, bukan pekerjaan repo ini.
- **Rahasia atau saklar di `app_settings`.** Kunci hidup di env saja. Batas
  keselamatan yang sesungguhnya untuk langkah rilis adalah **ketiadaan**
  `MIDTRANS_SERVER_KEY` di Vercel, bukan sebuah baris teks yang bisa disunting
  admin mana pun dari panel.
- **Halaman `/bayar/selesai` atau rute balik Snap yang menerbitkan apa pun.**
  Snap popup, lalu baca ulang entitlement dari peramban. `onSuccess` memicu
  pembacaan ulang; ia bukan sumber kebenaran pembayaran. Batasan yang diterima
  sadar: pada metode yang membawa pengguna keluar aplikasi (deeplink e-wallet),
  `onSuccess` bisa tidak pernah menyala — klien menemukan produknya di Pembelian
  Saya saat kembali.
- **Menyentuh `ambil_produk_gratis`, `punya_produk`, atau ketiga rute isi.**
  Pagar "harga nol" tetap berdiri; badan maupun hak ketiganya tidak berubah, dan
  yang lahir hanyalah uji bahwa jalur gratis tetap hijau sesudah penambalan. Gerbang isi membaca entitlement dan tidak
  pernah membaca pesanan — menambahkan pemeriksaan "pesanan lunas" di sana
  menduplikasi sumber kebenaran, dan duplikat kedua pasti berbeda suatu hari.
- **Tombol cabut dan tombol pulihkan akses.** Yang P1 spesifikasikan hanyalah
  apa yang terjadi pada pembelian atas entitlement yang tercabut — karena
  `unique (client_id, product_id)` memaksa keputusan itu diambil sekarang.

## Risiko dan ketergantungan luar

- **Verifikasi merchant Midtrans belum selesai.** Kunci sandbox sudah ada, jadi
  P1 bisa dibuktikan ujung-ke-ujung dengan Snap sungguhan. Yang menunggu kunci
  produksi hanyalah go-live.
- **Webhook menuntut URL publik.** Uji asap ujung-ke-ujung menunggu deploy, atau
  terowongan sementara.
- **Urutan merge P1 versus cabang `umpan-balik-klien-gelombang-1`** harus
  diputuskan sebelum salah satunya menyentuh produksi. Cabang itu memuat dua
  migrasi (`20260922100000`, `20260924100000`) yang belum ter-merge; cap waktu
  P1 dipilih di atas keduanya, tapi urutan penerapannya tetap keputusan manusia.
- **Migrasi produk digital `20260921*` belum pernah sampai ke basis data
  ter-host** — tabel `digital_*` memulangkan 404 di PostgREST produksi per 22
  September. P1 menambah enam migrasi lagi di atasnya. Urutan penerapan ke
  produksi harus diperiksa sebagai pekerjaan tersendiri, bukan `db push`
  membabi buta: produksi berisi data klien nyata.
- **Kadens cron dibatasi paket Vercel, dan batasnya sudah diperiksa** ke
  dokumentasi Vercel (`vercel.com/docs/cron-jobs/usage-and-pricing`, per 15 Juli
  2026): paket **Hobby hanya boleh sekali sehari**, dan ekspresi yang lebih
  sering **menggagalkan deploy** dengan pesan "Hobby accounts are limited to
  daily cron jobs". Ketepatannya pun per-jam: `0 3 * * *` bisa berjalan kapan
  saja antara 03:00 dan 03:59. Itulah sebabnya jaring pengaman utama P1 bukan
  cron melainkan pemeriksaan-saat-dibuka (Lapis 1b); cron harian hanya menyapu
  pesanan milik orang yang tidak pernah kembali. Bila akun kelak naik ke Pro,
  yang berubah hanya satu angka di `web/vercel.json`.
- **Cron `/api/cron/tenggat` masih terlantar.** P1 tidak menjadwalkannya, dan
  kini `tests/pesanan-vercel-cron.test.ts` yang menahannya. Menghidupkannya akan
  membatalkan sekaligus seluruh pengajuan lewat tenggat yang menumpuk sejak
  September — pembatalan massal ke klien nyata, di hari yang sama dengan go-live
  pembayaran. Sebelum diputuskan, hitung dulu berapa baris yang akan terkena;
  kueri itu menyentuh produksi dan menunggu izin pemilik repo.
