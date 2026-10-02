# P4 — Rekap penjualan & riwayat pembelian produk digital

**Tanggal:** 2 Oktober 2026
**Status:** disetujui, siap direncanakan
**Cabang induk:** `development`

---

## 1. Tujuan

PADMA sudah bisa menjual produk digital dan sudah bisa menerima uangnya (P1-A
mesin pembayaran, P1-B permukaan pembayaran). Yang belum ada: satu pun layar
yang menjawab **"berapa yang terjual, dan siapa yang membelinya"**.

Keadaan hari ini, diukur bukan diingat:

- `/owner/rekap` murni sesi dan honor mitra — nol referensi ke `orders`,
  `order_items`, maupun `digital_product*`.
- `/admin/pesanan` adalah **layar pemulihan**, bukan riwayat: ia hanya menarik
  pesanan yang `butuh_tinjauan_pada`-nya terisi atau yang statusnya masih
  dipantau. Penjualan yang sudah tuntas **lenyap dari sana**. Itu desain yang
  benar untuk tugasnya, dan persis kenapa P4 butuh layarnya sendiri.
- `/passport/produk` memperlihatkan produk yang dimiliki klien — tanpa harga,
  tanpa nomor nota.
- `/admin/klien/[id]` punya "Riwayat sesi", tidak punya riwayat pembelian.

## 2. Untuk siapa, dan untuk apa

Dua pembaca dengan dua pertanyaan yang berbeda, dan keduanya dilayani:

| Pembaca | Pertanyaannya | Layarnya |
|---|---|---|
| Owner | Berapa yang masuk bulan ini? Produk mana yang laku? | `/owner/penjualan` |
| Admin | Bulan ini terjual apa saja? Klien ini sudah beli apa? | `/admin/penjualan` + bagian di `/admin/klien/[id]` |

Keperluannya **pembukuan sekaligus keputusan bisnis** — itu keputusan pemilik
repo, dan ia yang membuat kedua layar ada alih-alih satu.

## 3. Fakta basis data yang mengikat desain ini

Ketiganya diverifikasi langsung di migrasinya pada 2 Okt 2026, bukan diingat.
Kalau salah satunya berubah, desain ini harus ditinjau ulang.

### 3.1 `lunas_pada` hanya terisi pada transisi sungguhan ke `lunas`

`20260927100000_sebab_tinjauan_lestari.sql:509` —
`lunas_pada = case when v_tujuan = 'lunas' then now() else o.lunas_pada end`.

Pesanan yang dibayar **lewat tenggat** (`lunas_setelah_tutup`) tidak pernah
berpindah status: cabangnya di `:452-469` menulis jejak dan penanda tinjauan,
lalu `return 'tanpa_efek'`. Pesanan itu karena itu **tidak punya `lunas_pada`
sama sekali**, walau uangnya sudah masuk.

**Akibat:** tanggal uang masuk untuk kelompok itu hanya tersedia di
`notifikasi_pesanan.diterima_pada`.

### 3.2 `sebab_tinjauan` yang pertama menang

`20260927100000_sebab_tinjauan_lestari.sql:402` —
`sebab_tinjauan = coalesce(o.sebab_tinjauan, v_sebab)`.

Itu benar untuk tujuan migrasi tersebut (alasan pertama yang menjelaskan kenapa
sebuah pesanan ditahan tidak boleh ditimpa alasan berikutnya), tetapi ia
berarti: pesanan yang lebih dulu bertanda `selisih_nominal` lalu kemudian kena
chargeback **tetap terbaca `selisih_nominal` selamanya**.

**Akibat:** `orders.sebab_tinjauan` **tidak boleh** dipakai untuk mendeteksi
refund atau chargeback. Saringan yang bersandar padanya akan melewatkan
chargeback diam-diam.

### 3.3 Setiap notifikasi sah tercatat lengkap sebelum percabangan vonis

`20260927100000_sebab_tinjauan_lestari.sql:322-333` — `insert into
public.notifikasi_pesanan (pesanan_id, sidik, transaksi_id, status_midtrans,
kanal, nominal_diterima)` dijalankan di langkah (4), jauh sebelum percabangan
vonis di `:388` dan `:440`. Tabelnya append-only dengan `unique (sidik)`.

**Akibat:** `notifikasi_pesanan.status_midtrans` adalah sumber yang bisa
dipercaya untuk "pesanan ini pernah menerima notifikasi jenis apa saja", dan
`diterima_pada` untuk "kapan uangnya mendarat".

### 3.4 Refund bukan fitur PADMA

Repo ini nol mekanisme refund, dan memang tidak perlu punya. Cabang
`refund`/`chargeback` di webhook ada karena **Midtrans bisa mengirimi kita**
notifikasi jenis itu dari dua sumber yang bukan keputusan PADMA: refund manual
dari dashboard Midtrans, dan chargeback yang dibuka bank penerbit kartu
pembeli. Payload Snap PADMA tidak membatasi kanal pembayaran (nol
`enabled_payments`), jadi kartu kredit aktif dan chargeback mungkin terjadi.

Frekuensinya mendekati nol. Yang tidak nol adalah ongkos bila ia terjadi dan
rekapnya diam-diam tetap menghitungnya sebagai pendapatan.

## 4. Definisi: apa yang dihitung sebagai penjualan

### 4.1 Omzet

```
omzet = Σ harga_beku  atas pesanan dengan:
          status = 'lunas'
          DAN tidak pernah menerima notifikasi berstatus
              refund | partial_refund | chargeback | partial_chargeback
```

Dua hal yang mudah salah dan karena itu ditulis eksplisit:

- Pesanan `lunas` yang bertanda `akses_tertahan` atau `selisih_nominal`
  **tetap dihitung**. Uangnya masuk dan terverifikasi; yang bermasalah
  pengantaran aksesnya, bukan uangnya.
- Deteksi refund/chargeback dibaca dari `notifikasi_pesanan.status_midtrans`,
  **bukan** dari `orders.sebab_tinjauan` (lihat §3.2).

### 4.2 Baris pengecualian

Tidak dijumlahkan ke omzet, tidak pula disembunyikan. Tiga kelompok, masing-
masing dengan banyaknya dan nilainya sendiri:

| Kelompok | Kriteria | Kenapa bukan omzet |
|---|---|---|
| Ditahan | `status = 'ditahan'` | Uangnya ditahan Midtrans, bukan di PADMA — `20260926140000:389` menyebutnya terang-terangan |
| Bayar lewat tenggat | `status in ('kedaluwarsa','dibatalkan')` **dan** punya jejak `lunas_setelah_tutup` | Uangnya masuk tetapi pesanannya sudah ditutup; penyalur tidak pernah berjalan dan aksesnya belum tentu terbit |
| Dikembalikan | `status = 'lunas'` **dan** pernah menerima notifikasi refund/chargeback | Uangnya sudah keluar lagi |

**Tidak ada pengurangan otomatis.** Nominal refund tidak pernah disimpan:
`notifikasi_pesanan` hanya punya `nominal_diterima` dari `gross_amount`
(`20260926120000:105`), tanpa kolom `refund_amount`. Mengurangkan apa pun dari
omzet berarti mengarang angkanya.

Baris pengecualian menutup dengan arahan ke `/admin/pesanan` — di sanalah
perkaranya diselesaikan, bukan di layar rekap.

### 4.3 Sumbu waktu

**Bulan, menurut kalender Asia/Jakarta.**

Rekap honor memakai pekan karena gajian hari Sabtu; penjualan tidak punya
jangkar seperti itu, dan bulan adalah satuan pembukuan.

Tanggal yang dipakai:

- omzet dan nota biasa → `orders.lunas_pada`
- pengecualian "bayar lewat tenggat" → `notifikasi_pesanan.diterima_pada`
  (lihat §3.1 — baris itu tidak punya `lunas_pada`)

Pengelompokan bulan **tidak boleh** dilakukan dengan memotong string ISO.
Dokblok `stempelJakarta` di `src/lib/owner/pekan.ts:128-139` sudah mengeja
kelas kesalahannya untuk tanggal: stempel yang dipulangkan PostgREST adalah
UTC, dan pembelian pukul 06.30 WIB tercatat 23.30Z **hari sebelumnya**. Di
pergantian bulan, itu memindahkan omzet ke bulan yang keliru.

## 5. Arsitektur

### 5.1 Pendekatan yang dipilih, dan yang ditolak

**Dipilih — nol view baru, agregasi di TypeScript, satu migrasi mungil.**

Lapisan data membaca `orders` langsung (policy `"pesanan: staf baca"` sudah
mengizinkan staf) disaring per rentang tanggal, lalu mengambil itemnya dari
`pesanan_item_staf` menurut id. Bentuknya sama persis dengan
`src/lib/admin/pesanan.ts` hari ini. Penjumlahan dikerjakan TypeScript.

**Ditolak — view gabungan `penjualan_staf` yang sudah menyatukan orders+items.**
Ia membeli kebersihan kueri dan daya tahan skala, dengan membayar: migrasi
baru, entri baru di `KOLOM_UANG_VIEW_DIIZINKAN` untuk `harga_beku`, satu
permukaan `security_invoker = off` baru yang harus benar, dan suntingan di tiga
uji struktural. Ongkos nyata hari ini untuk masalah skala yang PADMA belum
punya.

**Ditolak — view atau RPC penjumlah di Postgres.** Repo ini sudah menuliskan
doktrinnya dua kali di `src/app/owner/rekap/page.tsx`: *"Sebuah view penjumlah
dimiliki `postgres`, berjalan dengan hak PEMILIK, dan karenanya MELEWATI RLS."*
Margin PADMA dihitung di TypeScript karena alasan itu. Rekap penjualan tidak
punya alasan untuk jadi pengecualian pertama.

**Batas yang diakui:** pendekatan terpilih menarik seluruh baris periode ke
memori sebelum menjumlahkannya. Pada volume PADMA — penjualan produk digital
puluhan per bulan — ini bukan apa-apa. Ia baru jadi masalah di puluhan ribu
baris, dan saat itu tiba, pendekatan kedua sudah tertulis di atas.

### 5.2 Modul baru `src/lib/penjualan/`

| Berkas | Tanggung jawab | IO |
|---|---|---|
| `bulan.ts` | `bulanJakarta(iso) → "2026-10"`, label bulan, deret N bulan terakhir | tidak |
| `hitung.ts` | Klasifikasi baris, agregasi per bulan dan per produk | tidak |
| `baca.ts` | Empat kueri Supabase, penggabungan jadi baris mentah | ya |

`hitung.ts` murni dan karena itu bisa diuji tanpa basis data — pemisahan yang
sama dengan `hitungRekap` di `src/lib/owner/rekap.ts`.

`baca.ts` membaca dengan **sesi pemanggil**, nol service role. Admin yang
perannya dicabut kehilangan layar ini seketika, tanpa satu baris kode berubah.

Empat kueri paralel, menurut daftar id:

1. `orders` — disaring rentang tanggal, dengan embed `clients (padma_id, nama)`
2. `pesanan_item_staf` — menurut `pesanan_id`
3. `notifikasi_pesanan` — menurut `pesanan_id`, untuk deteksi refund/chargeback
   dan untuk tanggal pengecualian "bayar lewat tenggat"
4. `jejak_pesanan` — menurut `pesanan_id`, kejadian `lunas_setelah_tutup`

Kueri keempat **tidak bisa** digantikan dengan menyimpulkannya dari
`notifikasi_pesanan`, dan selisihnya nyata: notifikasi `capture` yang disertai
`fraud_status` menantang menghasilkan vonis `ditahan`, bukan `lunas`, jadi ia
TIDAK melahirkan jejak `lunas_setelah_tutup` — padahal `status_midtrans`-nya
tetap tercatat `capture`. Menyimpulkannya dari notifikasi akan menghitung
pesanan yang uangnya justru belum tentu masuk, ke dalam kelompok yang
seharusnya berarti "uangnya sudah masuk". Polanya mengikuti `KEJADIAN_AKSES`
di `src/lib/admin/pesanan.ts`.

### 5.3 Migrasi

Satu, dan kecil:

```sql
create or replace view public.pesanan_item_staf with (security_invoker = off) as
  select i.pesanan_id, o.kode, i.jenis, i.judul_beku, i.harga_beku, i.urutan,
         i.product_id
    from public.order_items i
    join public.orders o on o.id = i.pesanan_id
   where public.user_role() in ('admin', 'owner');
```

`create or replace view` mengizinkan penambahan kolom **di ujung** daftar dan
tidak menjatuhkan grant yang sudah ada.

**Kenapa perlu:** tanpa `product_id`, pengelompokan per produk hanya bisa
berpegang pada `judul_beku`. Satu produk yang pernah diganti namanya akan pecah
jadi dua baris laporan — diam-diam, dengan kedua angkanya terlihat masuk akal.

**Yang ikut berubah:** uji "enam kolom" di
`tests/pesanan-akses-tiga-keadaan.test.ts:1036-1043` **disunting** jadi tujuh.
Kemerahannya disengaja dan itulah gunanya uji tersebut. Ia disunting, bukan
ditambahi uji kedua di sebelahnya — dua uji yang mengklaim jumlah kolom berbeda
adalah dua uji yang salah satunya basi.

**Yang TIDAK berubah:** `money-firewall-struktural` (`product_id` bukan kolom
nominal), `grant-anon`, `struktur-rls`. Bila salah satunya merah, itu tanda
implementasinya menyimpang dari spec ini — bukan tanda ujinya perlu disunting.

## 6. Layar

### 6.1 `/owner/penjualan`

Bentuknya **meniru `/owner/rekap`** dengan sengaja: owner yang sama membuka
keduanya, dan dua layar uang yang bentuknya berbeda adalah dua layar yang harus
dipelajari dua kali.

- **Grafik batang 12 bulan terakhir** memakai
  `src/app/_shell/panel/grafik-batang.tsx`, yang sudah membawa tabel padanan
  sehingga angkanya tetap terbaca tanpa melihat grafiknya.
- **Kartu per bulan**, terbaru di atas, berpaginasi — padanan `KartuPekan`.
  Tiap kartu memuat omzet bulan itu, jumlah pembelian, rincian **per produk**
  (judul, banyaknya, nilai), dan — hanya bila ada — baris pengecualian.
- Baris pengecualian memakai bentuk yang sudah berjalan untuk "sesi belum
  bertarif": kotak berbingkai `clay`, kalimat yang menyebut banyaknya dan
  nilainya per kelompok, dan arahan ke `/admin/pesanan`.
- Tiap kartu membawa atribut `data-bulan`. Alasannya sama dengan `data-pekan`
  di `/owner/rekap`: seluruh nominal di halaman semacam ini tampak serupa, dan
  tanpa penanda sebuah assertion (atau seorang pembaca) bisa membaca angka
  bulan lain.

**Tanpa `BilahDaftar`.** Rekap honor punya saringan karena ada pekerjaan yang
menempel di sana — honor yang belum dibayar. Penjualan tidak punya padanannya,
dan saringan tanpa tindakan hanyalah kontrol yang harus dirawat.

### 6.2 `/admin/penjualan`

Tabel nota memakai `BilahDaftar` + `Paginasi` + `Tabel` yang sudah dipakai
delapan daftar lain.

Kolom: tanggal lunas · kode pesanan · klien (PADMA ID + nama) · produk ·
nominal · catatan.

**Disaring per bulan, bawaannya bulan berjalan.** Itu pembatas, bukan
kenyamanan: saringan bulan membuat kuerinya terbatas dengan sendirinya,
sehingga tidak ada pemotongan diam-diam.

Ada pilihan **"semua bulan"** dengan batas baris yang **dicetak di layar apa
adanya** — pola yang sudah dipakai `/admin/pesanan`, yang mengekspor
`BATAS_BARIS` justru supaya halamannya bisa menyebut angkanya sendiri. Batas
yang tidak diumumkan adalah batas yang berbohong: 200 baris terpotong terlihat
persis seperti 200 baris yang memang hanya segitu.

**Pencarian dikerjakan di TypeScript**, bukan di PostgREST. Barisnya sudah
ditarik ke memori untuk dijumlahkan, jadi mencari di sana gratis — dan ia bisa
mencakup **judul produk**, yang lewat PostgREST mustahil disaring dari `orders`
karena judulnya hidup di kueri yang lain. Cakupan pencarian: kode pesanan,
PADMA ID, nama klien, judul produk.

### 6.3 Bagian di `/admin/klien/[id]`

Satu `section` "Riwayat pembelian", sejajar dan sebentuk dengan "Riwayat sesi"
yang sudah ada di halaman itu (`:190-241`). Seluruh pembelian klien tersebut —
terbatas dengan sendirinya karena satu klien — dengan tanggal, kode, produk,
nominal, dan catatan bila pesanannya termasuk pengecualian.

Inilah layar yang dibuka admin saat sedang menelepon klien.

## 7. Yang sengaja TIDAK dibuat

- **Nol tombol aksi.** Ketiga permukaan ini **baca saja**. Pembatalan,
  penerbitan akses, dan penutupan tinjauan sudah punya rumahnya di
  `/admin/pesanan`; menduplikasinya berarti dua jalur tulis untuk satu
  keputusan uang. Ini pula yang membuat P4 kecil kemungkinan bertabrakan dengan
  P2 keranjang yang dikerjakan sesi lain: ia tidak menulis apa pun.
- **Nol ekspor CSV.** Ditunda sampai diketahui kolom apa yang sebenarnya
  diminta akuntan; menebaknya sekarang berisiko membangun CSV yang salah kolom.
  Ekspor bisa ditambahkan belakangan tanpa membongkar apa pun, karena
  `hitung.ts` sudah memisahkan agregasi dari penyajian.
- **Nol nota/invoice PDF.** PADMA belum pernah membuat PDF dari data; yang ada
  hanya PDF yang diunggah manusia. Itu layak jadi pekerjaan tersendiri.
- **Nol kolom nominal turunan di basis data.** Lihat §5.1.

## 8. Pengujian

### 8.1 Murni, tanpa basis data

Beban terberat ada di sini, karena `hitung.ts` memang dirancang untuk itu.

**`bulanJakarta`:**
- pembelian pukul 06.30 WIB tanggal 1 Oktober (tercatat `2026-09-30T23:30:00Z`)
  masuk `"2026-10"`
- **kontrol negatif yang tinggal di repo:** `iso.slice(0, 7)` atas stempel yang
  sama memulangkan `"2026-09"` — ditulis sebagai assertion supaya terbukti
  ujinya bisa gagal, bukan hijau karena hampa
- stempel tak sah tidak memulangkan bucket hantu

**`hitung.ts`:**
- omzet dijumlahkan dari `lunas` bersih
- `lunas` bertanda `akses_tertahan` **ikut** dihitung
- `lunas` bertanda `selisih_nominal` **ikut** dihitung
- `ditahan` keluar dari omzet, masuk pengecualian dengan nilainya
- `kedaluwarsa` berjejak `lunas_setelah_tutup` sama
- `lunas` ber-notifikasi `chargeback` keluar dari omzet
- **jebakan `coalesce`:** pesanan `lunas` yang `sebab_tinjauan`-nya
  `'selisih_nominal'` *tetapi* punya notifikasi `chargeback` harus keluar dari
  omzet. Uji inilah yang membuktikan deteksinya tidak bersandar pada
  `sebab_tinjauan`, dan ia akan merah persis saat seseorang
  "menyederhanakannya" ke sana.
- **pembenar migrasi:** dua baris nota ber-`judul_beku` berbeda tetapi
  `product_id` sama menjadi **satu** baris per-produk. Tanpa migrasi §5.3, uji
  ini tidak bisa ditulis sama sekali.
- anti-hampa: larik kosong → omzet nol dan pengecualian kosong, bukan `NaN`

### 8.2 Ber-basis-data

Sedikit, karena mahal dan karena Supabase lokal dipakai bersama sesi lain.

- uji kolom `pesanan_item_staf` **disunting** dari enam jadi tujuh;
  `product_id` terbaca; anon tetap `42501`; klien tetap nol baris
- `baca.ts` dengan sesi admin dan owner memulangkan baris; dengan sesi **klien**
  memulangkan kosong **tanpa galat** — inilah yang menangkap kegagalan
  embed-RLS-null, bentuk kegagalan yang sudah pernah dibayar repo ini

### 8.3 Komponen

- kartu bulan merender nilai pengecualian **terpisah** dari omzet, tidak
  terjumlah, dibedakan lewat `data-bulan`
- layar admin mencetak batas barisnya saat "semua bulan" dipilih

### 8.4 Kewajiban dari pagar yang sudah ada

`tests/inventaris-rute.test.ts` memeriksa **dua arah**, jadi `/owner/penjualan`
dan `/admin/penjualan` **wajib** masuk tabel rute di `web/README.md`. Bukan
kerapian — ujinya merah kalau tidak.

## 9. Penanganan galat

- **Galat PostgREST dibaca lalu dilempar**, tidak dibuang diam-diam (pola
  `src/lib/admin/pesanan.ts`). Layar penjualan yang kosong karena kuerinya gagal
  terlihat persis seperti bulan yang memang belum ada penjualannya — dan di
  layar ini perbedaan itu adalah perkara uang.
- **Embed yang ditahan RLS memulangkan `null`, bukan galat.** `clients
  (padma_id, nama)` yang tidak terbaca dirender sebagai kegagalan baca yang
  **terlihat**, bukan sebagai sel kosong.
- **Pesanan tanpa item terbaca → `null`, bukan `0`.** "Rp 0" yang diucapkan
  dengan yakin lebih mahal daripada "tidak terbaca", karena ia terbaca sebagai
  selisih. Nol yang sah — produk gratis — tetap punya barisnya, jadi yang
  memisahkan keduanya adalah ada/tidaknya item, bukan jumlahnya.

## 10. Koordinasi

P2 (keranjang) dikerjakan sesi lain dan menyentuh jalur **tulis** yang sama
(`orders`, `order_items`, rute checkout). P4 hanya membaca, jadi tabrakannya
minimal — tetapi tiga hal tetap berlaku:

1. P4 dikerjakan di worktree dan branch sendiri, bercabang dari `development`.
2. `src/lib/pesanan/status.ts` serta bentuk `orders`/`order_items` adalah milik
   bersama. Bila P2 perlu mengubah bentuknya, P4 yang menyesuaikan — penulis
   menentukan, pembaca mengikuti.
3. Supabase lokal dipakai bersama. Keduanya memakai uji **berlingkup**; siapa
   pun yang hendak `db reset` atau menjalankan suite penuh memberi tahu lebih
   dulu.

P4 sudah dirancang agar siap-keranjang sejak awal: ia melaporkan per
**`order_items`**, bukan per `orders`. Begitu satu pesanan bisa memuat beberapa
barang, tidak ada yang perlu ditulis ulang.

## 11. Batas yang diketahui

- **Angka di layar ini adalah yang DITAGIH dan dikonfirmasi Midtrans, bukan
  yang mendarat di rekening bank.** Potongan biaya Midtrans dan jeda settlement
  tidak pernah masuk basis data ini. Untuk pembukuan yang harus cocok dengan
  mutasi rekening, angka ini adalah titik awal, bukan titik akhir — dan
  halaman menyebutkannya lewat `Bantuan`.
- Seluruh baris periode ditarik ke memori sebelum dijumlahkan (§5.1).
- Nominal refund tidak tersedia, jadi pengurangan otomatis mustahil (§4.2).
