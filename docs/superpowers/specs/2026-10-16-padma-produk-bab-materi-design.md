# Produk digital: bab, materi, pratinjau, dan masa berlaku — desain

Tanggal: 16 Oktober 2026
Status: menunggu tinjauan pemilik repo
Mengubah: `2026-09-20-padma-produk-digital-design.md` (lihat "Keputusan lama yang dibalik")

## Masalah

Klien mengubah bentuk produk digital. Hari ini satu produk = satu berkas (video
**atau** PDF). Yang diminta sekarang:

1. Satu produk berisi **banyak materi**, campuran video dan PDF.
2. Materi dikelompokkan dalam **bab**.
3. Produk **dan setiap materi** punya gambar sampul.
4. Admin bisa menandai materi tertentu sebagai **pratinjau**: isinya bisa dibuka
   sebelum membeli. Materi lain tampil bergembok.
5. Produk punya **masa berlaku** sesudah dibeli: N bulan, N tahun, atau selamanya.

## Referensi klien

Klien menunjuk halaman kelas di `elearning.bidankita.com` (contoh: "Gentle &
Comfort Technique For Labor's Mom") dan sebuah kartu produk "Kelas Masalah
Menyusui pada Bayi". Tangkapan layar dikirim lewat chat. Berkasnya tidak
tersimpan, jadi isinya dicatat di sini:

- **Kartu produk:** sampul di kiri; judul, potongan deskripsi, lalu jumlah per
  jenis dengan ikon: "11 Video · 1 Artikel".
- **Halaman produk, kolom kiri:** sampul, judul, tombol "Tambah Ke Keranjang"
  dan "Beli Sekarang", "15 Materi", harga "Rp 750.000 / 9 Bulan".
- **Halaman produk, kolom kanan:** deskripsi panjang, total "15 Materi", lalu
  daftar **bab** yang bisa dibuka-tutup. Setiap bab memuat judul dan "N Materi",
  contohnya "TEHNIK Comfort Measure — 7 Materi".
- **Baris materi:** tombol di kiri, thumbnail, judul, dan keterangan satu-dua
  baris. Materi pratinjau berlabel "View" merah dan aktif. Materi terkunci
  berlabel "Play" abu-abu dengan **gembok merah di atas thumbnail**.
- Di referensi juga ada breadcrumb kategori, wishlist, rating, dan profil
  pemateri. Keempatnya **tidak** dikerjakan (lihat "Di luar lingkup").

## Keputusan

Dijawab pemilik repo sebelum desain ini ditulis:

| Pertanyaan | Keputusan |
|---|---|
| Sampul | Produk **dan** setiap materi punya sampul sendiri |
| "Artikel" | **PDF**, dibaca lewat penampil halaman yang sudah ada |
| Unit beli | **Seluruh produk**. Harga, keranjang, dan Midtrans tetap per produk |
| Pengelompokan | **Produk → Bab → Materi** |
| Pratinjau | Admin menandai per materi; isinya bisa dibuka **tanpa membeli** |
| Siapa boleh membuka pratinjau | **Wajib login**, sehingga watermark nama tetap ada |
| Izin unduh | **Per materi**, dan hanya untuk pemilik aktif. Materi pratinjau tidak pernah bisa diunduh |
| Masa berlaku | **Per produk**, dalam bulan atau tahun, atau **selamanya** |
| Siapa menyetel masa berlaku | **Owner**, di samping harga. Admin hanya mengurus isi |
| Beli lagi saat akses masih aktif | **Tidak bisa** sampai masa berlakunya habis |
| Kategori/breadcrumb | **Tidak sekarang** |
| Pendekatan | **A**: tabel bab dan materi khusus produk digital |
| Data uji produk lama | **Dihapus tanpa migrasi data**. Tabel produk belum pernah ada di produksi |

### Keputusan lama yang dibalik

Spec 20 September menetapkan **"Masa akses: selamanya"**. Keputusan itu
dibalik: masa berlaku sekarang disetel per produk, dan "selamanya" tinggal
salah satu pilihannya. Akibatnya kata "punya produk" di seluruh sistem berarti
**"punya, belum dicabut, dan belum kedaluwarsa"**.

Keputusan lain dari spec itu **tetap berlaku**: produk digital adalah entitas
terpisah dari `materials`; harga hanya diatur owner; `aktif = false` berarti
berhenti dijual, **bukan** mencabut akses pembeli; tidak ada refund.

### Pendekatan yang ditolak

- **Memakai ulang `materials`** (materi sesi). Spec 20 September sengaja
  memisahkan entitas ini, dan RLS `materials` terikat pada pasien sesi.
- **Daftar materi sebagai JSON di baris produk.** Gerbang isi butuh RLS per
  materi, dan JSON tidak bisa dijaga RLS.

## Model data

Semua perubahan ditulis sebagai **migrasi baru**. Migrasi 21 September tidak
disunting, karena DB lokal dan branch lain sudah menerapkannya.

### Produk — `digital_products`

- **Dibuang:** `jenis` dan `boleh_unduh`, beserta enum `product_type` kalau
  tidak dipakai di tempat lain.
- **Tetap:** `sampul_objek`, yang kini benar-benar ditulis (lihat Panel admin).
- **Baru:** `masa_berlaku_bulan int null check (masa_berlaku_bulan > 0)`.
  - NULL berarti selamanya.
  - Pilihan "N tahun" di form disimpan sebagai `N × 12`, jadi cukup satu kolom
    tanpa urusan satuan.
  - Kolom ini hanya bisa ditulis owner. Pagar kolomnya mengikuti pola harga.

### Bab — `digital_product_sections` (baru)

| Kolom | Catatan |
|---|---|
| `id uuid pk` | |
| `product_id uuid not null` → `digital_products` on delete cascade | |
| `judul text not null` | |
| `urutan int not null default 0` | |
| `created_at timestamptz` | |

### Materi — `digital_product_materials` (baru)

| Kolom | Catatan |
|---|---|
| `id uuid pk` | |
| `section_id uuid not null` → bab, on delete **restrict** | Bab berisi tidak bisa terhapus |
| `product_id uuid not null` → `digital_products` on delete cascade | Disimpan ganda, lihat di bawah |
| `judul text not null` | |
| `keterangan text not null default ''` | |
| `jenis` enum `material_kind ('video','pdf')` | Terkunci setelah isi diunggah |
| `sampul_objek text null` | Bucket publik `produk-sampul` |
| `pratinjau boolean not null default false` | Default TERTUTUP |
| `boleh_unduh boolean not null default false` | Default TERTUTUP, sama dengan alasan lama |
| `urutan int not null default 0` | |
| `created_at timestamptz` | |

`product_id` disimpan ganda supaya predikat akses bisa menjawab "materi ini
milik produk apa" tanpa join. Konsistensinya dijamin **di basis data, bukan di
aplikasi**: foreign key komposit `(section_id, product_id)` →
`digital_product_sections (id, product_id)`, ditambah `unique (id, product_id)`
di tabel bab. Materi yang mengaku milik produk lain daripada babnya akan
ditolak Postgres.

### Isi — `digital_product_files` dan `digital_product_pages`

- Berganti kunci dari `product_id` ke `material_id`, dengan `unique
  (material_id)` dan primary key `(material_id, halaman)`.
- Isi lama dihapus. Objek storage lama yang tersisa di lingkungan lokal boleh
  dibiarkan.
- Kunci objek baru: `produk/<product_id>/<material_id>/isi.<ext>` di R2,
  `<product_id>/<material_id>/<n>.webp` di `produk-halaman`, dan
  `<product_id>/<material_id>/isi.pdf` di `produk-berkas`. Semua ditentukan
  server dan tidak pernah dikirim peramban.
- RPC `ganti_halaman_produk` dan `lepas_berkas_produk` berganti parameter ke
  `material_id`. Postur hak aksesnya tidak berubah.
- Sampul materi: `<product_id>/<material_id>/sampul-<uuid>.<ext>` di
  `produk-sampul`. Sampul produk: `<product_id>/sampul-<uuid>.<ext>`. Nama
  **unik per unggahan**: bucket-nya publik dan di-cache CDN, jadi menimpa
  nama yang sama membuat pengunjung terus melihat gambar lama. Objek lama
  dihapus sesudah baris menunjuk yang baru.

### Akses — `digital_entitlements`

- **Baru:** `berlaku_sampai timestamptz null`. NULL berarti selamanya. Nilainya
  **dibekukan saat akses terbit**: kalau owner mengubah durasi, pembeli lama
  tidak ikut berubah.
- `unique (client_id, product_id)` **tetap**. Beli ulang setelah kedaluwarsa
  memperbarui baris yang sama, bukan membuat baris baru.
- **`punya_produk(product_id)`** ditambah syarat `and (e.berlaku_sampai is null
  or e.berlaku_sampai > now())`. Inilah **satu-satunya tempat** definisi "boleh
  akses" berubah. Policy `digital_products` untuk pemilik, ketiga gerbang, dan
  passport mengikutinya tanpa disunting satu per satu.
- **Predikat baru `boleh_buka_materi(material_id)`** (security definer, EXECUTE
  hanya untuk `authenticated`): benar jika `punya_produk(m.product_id)`, ATAU
  materinya `pratinjau` dan produknya `aktif`. Pemanggil anon tidak pernah
  sampai ke sini karena policy-nya `to authenticated`.
- Policy `files` dan `pages` untuk pemilik diganti memakai
  `boleh_buka_materi(material_id)`.

### Pesanan — `order_items`

- **Baru:** `masa_berlaku_bulan_beku int null`, diisi saat item dibuat
  (`buat_pesanan`, `buat_pesanan_keranjang`), sepasang dengan `judul_beku` dan
  `harga_beku`.
- Alasannya: pembeli yang membayar sesudah melihat "9 Bulan" harus mendapat 9
  bulan, walaupun owner mengubahnya saat pesanannya masih menunggu bayar.

## Masa berlaku dalam alur bayar

**Kata "sudah punya" dipersempit menjadi "punya dan aktif"** di setiap
penolakan pembelian ganda:

- `tambah_ke_keranjang`
- status keranjang di `baca_keranjang`
- `buat_pesanan` dan `buat_pesanan_keranjang`
- keadaan tombol beli/ambil di halaman produk

Semuanya memakai satu predikat bersama, bukan salinan kalimat `exists (...)`
yang ditulis ulang di tiap fungsi.

**Penerbitan akses** — `terbitkan_akses_item`. Fungsi ini bagian dari alur
**otomatis**: webhook Midtrans → `terapkan_notifikasi_midtrans` menandai
pesanan `lunas` → fungsi ini membuat entitlement, semuanya tanpa campur tangan
manusia dan dalam hitungan detik. Tombol "Terbitkan akses" di panel admin
memanggil fungsi yang sama, tetapi hanya untuk pesanan yang ditandai butuh
tinjauan (`lunas_setelah_tutup`, `selisih_status`, `akses_tertahan`,
`penangan_belum_ada`).

Ketiga cabang yang ada tetap, tetapi cabang (2) dipecah:

| Keadaan baris | Tindakan | Jejak |
|---|---|---|
| (1) Belum ada | Insert dengan `berlaku_sampai = now() + durasi beku` | `akses_terbit` |
| (2a) Ada, belum dicabut, **masih aktif** | Seperti hari ini: hanya mengisi `pesanan_id` jika kosong | `akses_sudah_ada` |
| (2b) Ada, belum dicabut, **sudah kedaluwarsa** | Update `berlaku_sampai = now() + durasi beku`, `pesanan_id`, `sumber = 'beli'`, `diberikan_pada = now()` | `akses_terbit`, keterangan "diperbarui" |
| (3) Dicabut | Seperti hari ini: tertahan, tinjauan menyala | `akses_tertahan` |

- **Durasi dihitung sejak akses terbit (`now()`), bukan sejak `lunas_pada`.**
  Di alur otomatis selisihnya beberapa detik. Bedanya hanya terasa pada
  pesanan yang tertahan: kalau admin menerbitkan aksesnya beberapa hari
  kemudian, pembeli tidak kehilangan hari-hari itu. Dikonfirmasi pemilik repo
  16 Oktober.
- **Idempotensi webhook:** notifikasi kembar untuk pesanan yang sama jatuh ke
  (2a), karena aksesnya baru saja diperbarui dan sudah aktif. Tidak ada
  perpanjangan ganda.
- **Pencabutan tetap berbeda dari kedaluwarsa.** Akses yang dicabut admin tidak
  hidup lagi hanya karena pembeli membeli ulang; pesanannya masuk tinjauan
  seperti hari ini.
- **`ambil_produk_gratis`:** kalau barisnya kedaluwarsa (dan tidak dicabut),
  baris itu diperbarui dengan durasi produk saat ini. Produk gratis tidak punya
  pesanan, jadi tidak ada nilai beku.
- **Trigger `keranjang_bersih_saat_akses`** kini juga menyala saat
  `berlaku_sampai` diperbarui, bukan hanya saat insert atau saat `dicabut_pada`
  berubah.
- Dua pesanan menunggu bayar untuk produk yang sama sudah dicegah oleh
  `punya_pesanan_menunggu`. Tidak berubah.
- **Tidak ada nilai enum `order_event` baru.** Pembaruan dicatat sebagai
  `akses_terbit` dengan keterangan `diperbarui`. Menambah nilai enum pesanan
  menyentuh himpunan status yang ditulis tangan di TypeScript; pembaruan akses
  memang penerbitan akses, jadi nilai yang ada sudah benar.

### Pesanan `lunas` lama tidak boleh memblokir beli ulang

Ditemukan saat menyusun rencana. P1 menganggap **setiap** pesanan `lunas`
sebagai "pembayaran sedang ditinjau" (`punya_pesanan_menunggu` dan gerbang di
`buat_pesanan_keranjang`). Itu aman selama akses selamanya, karena layar selalu
memeriksa entitlement lebih dulu. Dengan masa berlaku, pesanan `lunas` lama
yang aksesnya sudah kedaluwarsa akan memblokir pembelian ulang **selamanya**.

Aturan baru: pesanan beruang (`ditahan`, `lunas`, atau bersebab
`lunas_setelah_tutup`) dianggap menggantung **hanya jika** belum ada
entitlement tak dicabut untuk produk itu dengan `diberikan_pada >=
o.dibuat_pada`. Acuannya `dibuat_pada`, bukan `lunas_pada`, karena pesanan
`lunas_setelah_tutup` berstatus kedaluwarsa/dibatalkan dan tidak selalu punya
`lunas_pada`. Entitlement yang dicabut tidak pernah menyelesaikan apa pun:
`akses_tertahan` tetap menggantung seperti sekarang.

Kriteria ini ditulis **satu kali** di fungsi pembantu
`pembayaran_produk_menggantung(client_id, product_id)`, dipakai oleh
`punya_pesanan_menunggu` dan `buat_pesanan_keranjang`. Dua salinan "set
cermin" yang bisa berselisih diam-diam diganti satu definisi.

### Pemilik kedaluwarsa tetap bisa membaca data produknya

Policy `"produk: pemilik entitlement baca"` di `digital_products` memakai
`punya_produk`. Kalau predikat itu menolak akses kedaluwarsa, produk
**nonaktif** yang aksesnya habis memulangkan `null` di embed `produkSaya`, dan
hilang diam-diam dari "Pembelian Saya". Policy ini karena itu beralih ke
predikat baru **`pernah_punya_produk(id)`**: entitlement milik pemanggil yang
belum dicabut, berapa pun `berlaku_sampai`-nya. Yang dibuka hanya baris
`digital_products` (judul, slug, deskripsi), bukan isi.

## Panel admin — isi

**`/admin/produk/[id]`** menjadi penyunting isi bertingkat:

- **Data produk:** judul, slug, deskripsi, dan **unggah sampul** lewat signed
  upload ke `produk-sampul`. Path-nya ditentukan server action. Mengganti
  sampul akan menghapus objek lama dengan service role, karena bucket ini
  memang tidak punya policy update/delete untuk staf.
- **Bab:** tambah, ganti nama, naik/turun urutan, dan hapus. Bab hanya bisa
  dihapus kalau kosong; FK `restrict` menjaganya, dan UI menyembunyikan
  tombolnya.
- **Materi di dalam bab:**
  - Tambah, sunting judul/keterangan, unggah sampul, saklar pratinjau, saklar
    boleh unduh, dan naik/turun urutan.
  - Pengunggah isi memakai ulang `PengunggahVideoProduk` dan
    `PengunggahPdfProduk`, dengan kunci yang dipindah ke `material_id`.
  - `jenis` terkunci setelah isi diunggah, aturan lama yang kini berlaku per
    materi.
  - Menghapus materi membersihkan objek R2/storage dan salinan PDF bercap milik
    pembeli (`hapusSalinanPembeli`), seperti `lepasIsiProduk` hari ini.
- **Syarat aktifkan produk:** minimal satu materi, dan **setiap** materi sudah
  berisi. Ini pengganti `punyaIsi(jenis, …)`.
- **`/admin/produk`:** filter "jenis" dibuang. Kolom yang tampil: jumlah per
  jenis ("11 Video · 1 Artikel") dan status kelengkapan isi.

## Panel owner — syarat jual

- **`/owner/produk`:** di samping form harga ada **masa berlaku**: Selamanya,
  N bulan, atau N tahun. Kolom `LABEL_JENIS` di tabel harga diganti dengan
  jumlah materi.
- Admin melihat masa berlaku (read-only) di halaman produknya, tapi tidak bisa
  menyuntingnya.

## Halaman publik

**Kartu `/produk`** (`kartu-produk.tsx`): sampul, judul, potongan deskripsi,
dan "N Video · N Artikel". Jenis yang jumlahnya nol tidak ditampilkan; badge
"Bisa diunduh" dibuang.

**`/produk/[slug]`**, mengikuti referensi:

- **Kiri:** sampul, judul, tombol Keranjang/Beli/Ambil gratis yang sudah ada,
  "N Materi", dan harga dengan akhiran durasi ("/ 9 Bulan", "/ 1 Tahun", atau
  tanpa akhiran untuk selamanya).
- **Kanan:** deskripsi, lalu daftar bab yang bisa dibuka-tutup (bab pertama
  terbuka) beserta jumlah materinya.
- **Baris materi:** thumbnail, judul, dan keterangan, dalam tiga keadaan:
  - Pratinjau: tombol "Lihat" aktif, menuju penampil.
  - Terkunci: gembok di atas thumbnail, tidak bisa diklik.
  - Pemilik aktif: semua baris terbuka.
- **Di HP:** kedua kolom ditumpuk, kartu beli di atas dan daftar bab di bawah.
- Daftar bab dan materi dibaca dengan **anon key** (judul, keterangan, jenis,
  sampul, pratinjau, urutan) lewat policy baca publik yang hanya berlaku untuk
  produk `aktif`. Isi (`files`/`pages`) tetap **tidak** pernah bisa dibaca anon.

Sampul materi terkunci tetap terlihat publik. Hal ini disengaja: referensi juga
memajangnya, dan sampul tidak dihitung sebagai isi berbayar.

## Kembali sesudah login

Repo **sudah punya** mekanismenya sejak P2: cookie `padma_lanjut`, dibaca
`/setelah-masuk` lewat `tujuanProdukAman()` (`src/lib/auth/tujuan-produk.ts`),
yang hanya menerima `/produk/<slug>`. Mekanisme itu **diperluas**, tanpa
membuat `?lanjut=` baru:

- **Pola kedua yang sama sempitnya:**
  `^/passport/produk/<slug>/<uuid>$`. Cookie ini tetap dianggap masukan musuh;
  apa pun selain kedua pola itu memulangkan `null`.
- **"Lihat" pada materi pratinjau** saat belum login: titip tujuan ke penampil
  materi, lalu ke `/masuk`.
- **"Ambil gratis"** saat belum login: titip `/produk/<slug>`, lalu ke
  `/masuk`. Ini menutup utang yang tercatat di komentar `ambil.ts`, dan
  komentar itu diperbarui.

## Sisi pembeli

**Penampil `/passport/produk/[slug]/[materiId]`:**

- Pemutar video (`pemutar-video.tsx`) atau pembaca PDF (`reader-pdf.tsx`)
  sesuai jenis materi, dengan daftar bab/materi di samping (di bawah, kalau di
  HP) untuk berpindah.
- Bisa dibuka **pemilik aktif**, atau **siapa pun yang login** untuk materi
  pratinjau. Selain itu `notFound()`, mengikuti pola gerbang yang ada.
- Tombol unduh tampil hanya jika pemanggil pemilik aktif, materinya
  `boleh_unduh`, dan berkasnya ada.

**`/passport/produk/[slug]`** menjadi daftar isi produk milik pembeli, dengan
susunan bab yang sama seperti di halaman publik.

**`/passport/produk`** menampilkan status per produk:

- "Aktif sampai 12 Jul 2027" (tanggal Asia/Jakarta)
- "Selamanya"
- "Masa berlaku habis", disertai tautan ke `/produk/<slug>` untuk membeli lagi

`produk-saya.ts` tetap membaca entitlement milik pemanggil, termasuk yang
kedaluwarsa, supaya status "habis" bisa tampil. Isi produk yang kedaluwarsa
tetap tertutup oleh `punya_produk`.

## Gerbang isi

Rute pindah ke `/api/produk/materi/[id]/…`. Rute lama
`/api/produk/[id]/{video,halaman,unduh}` dihapus.

| Rute | Syarat |
|---|---|
| `video` | Login; materi berjenis video; baris `files` terbaca lewat RLS (`boleh_buka_materi`) |
| `halaman/[n]` | Login; baris `pages` terbaca lewat RLS; watermark nama dan PADMA ID dibakar seperti hari ini |
| `unduh` | Login; **`punya_produk`** (bukan sekadar boleh buka); materi `boleh_unduh`; berkas ada. PDF dicap per pembeli **per materi** |

Unduhan sengaja memakai `punya_produk` dan bukan `boleh_buka_materi`, supaya
materi pratinjau tidak bisa diunduh. Pemeriksaannya dilakukan di rute **dan**
di RPC/policy. Pemeriksaan yang hanya hidup di rute bisa dilewati dengan
panggilan langsung ke PostgREST.

## Dampak ke branch lain

- **`feat/p4-rekap-penjualan`:** rekapnya per `product_id`, jadi tidak
  terdampak. Namun `tests/penjualan-db.test.ts` meng-insert `digital_products
  {jenis: "pdf"}` dan akan merah setelah kolom itu dibuang. Perbaikannya satu
  baris, dikerjakan di sisi yang di-merge belakangan.
- **`feat/syarat-ketentuan-privasi`:** tidak terdampak. Kata `jenis` di sana
  adalah kunci union hasil, bukan jenis produk.
- **`src/app/_landing/produk-digital.tsx`:** tidak dipasang di `page.tsx`.
  Hanya disesuaikan supaya ujinya tetap hijau, tidak dipasang ulang.

## Pengujian

**Uji DB:**

- RLS `boleh_buka_materi` untuk enam keadaan: pemilik aktif, pemilik
  kedaluwarsa, pemilik dicabut, non-pembeli pada materi pratinjau,
  non-pembeli pada materi terkunci, dan anon. Uji dijalankan dengan sesi
  klien, **bukan** service role, karena uji ber-service-role buta terhadap RLS.
- FK komposit menolak materi yang `product_id`-nya beda dari babnya.
- Bab berisi tidak bisa dihapus.
- `terbitkan_akses_item` untuk keempat cabang, termasuk notifikasi kembar
  sesudah (2b) yang harus jatuh ke (2a).
- Dicabut tetap mati sesudah dibeli ulang.
- `masa_berlaku_bulan_beku` terisi di kedua jalur pembuatan pesanan dan
  dipakai saat akses terbit, walaupun produknya diubah di antaranya.
- Keranjang dan pesanan menolak produk yang aktif dan menerima produk yang
  kedaluwarsa.
- Admin tidak bisa menulis `masa_berlaku_bulan`.
- Anon bisa membaca daftar bab/materi produk aktif, tetapi **tidak** produk
  nonaktif, dan tidak pernah membaca `files`/`pages`.

**Uji rute:**

- Ketiga gerbang per materi, termasuk: unduhan materi pratinjau oleh
  non-pembeli ditolak, dan video materi PDF ditolak.

**Uji unit:**

- `tujuanProdukAman` menolak `//evil.com`, `https://evil.com`, `/\evil`, dan
  `/passport/produk/x/bukan-uuid`, serta menerima kedua pola sah.
- Format akhiran durasi: 1/9/12/24 bulan, null.

**Uji lama:** sekitar 25 berkas meng-insert `jenis` di tingkat produk atau
menyentuh `files`/`pages` per produk. Semuanya disesuaikan. Daftar lengkapnya
masuk ke rencana implementasi.

**Lingkungan:** uji ber-DB butuh Supabase lokal (Docker). Kalau Docker mati
saat eksekusi, hal itu dilaporkan apa adanya, dan uji yang tidak bisa jalan
disebut satu per satu, bukan dianggap lulus.

## Di luar lingkup

- Kategori dan breadcrumb
- Wishlist
- Rating dan ulasan
- Profil pemateri
- Pelacakan progres tonton
- Urutan seret-lepas (diganti tombol naik/turun)
- Pembelian per materi
- Pratinjau untuk pengunjung anonim
- Pemasangan ulang seksi produk di landing

## Tindak lanjut (mode uji dipangkas, 16 Oktober)

Pemilik repo memilih tingkat uji **dipangkas**. Yang diuji otomatis: RLS
`boleh_buka_materi` untuk enam keadaan, cabang penerbitan akses + webhook
kembar, pembekuan durasi, FK bab-materi, pagar kolom masa berlaku, cookie
tujuan, dan gerbang rute (porting uji lama + pratinjau + kedaluwarsa). Yang
**tidak** dijaga uji otomatis:

1. Radius RPC `ganti_halaman_materi_produk` / `lepas_berkas_materi` (satu materi
   tidak menyentuh materi lain).
2. Aturan tayang "isi lengkap" dan "jenis materi terkunci sesudah isi diunggah".
3. Render tombol unduh di penampil materi.
4. Pembersihan objek storage + salinan bercap saat materi dihapus.
5. Seksi landing produk tetap tidak dipasang.

