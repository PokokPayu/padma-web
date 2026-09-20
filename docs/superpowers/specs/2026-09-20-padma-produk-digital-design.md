# Penjualan produk digital — desain

Tanggal: 20 September 2026
Status: menunggu persetujuan pemilik repo

## Masalah

Klien ingin berjualan produk digital di PADMA. Yang diminta:

1. Produk berupa **video** atau **PDF**.
2. Per produk: **boleh diunduh atau tidak**, **berbayar atau gratis**, harganya
   bisa disetel.
3. **Daftar siapa saja yang sudah membeli**.
4. **Keranjang** saat hendak membeli; **wajib login** untuk membeli.
5. Halaman produk digital di **sisi pelanggan** dan di **master** staf, plus
   **riwayat pembelian** di sisi admin maupun owner.
6. Di master ada **harga coret**, seperti pada harga layanan.
7. **Landing page** memuat daftar produk digital ini.

## Yang sudah ada di repo, dan kenapa itu penting

Fitur ini bukan ladang kosong. Empat hal sudah hidup dan dipakai ulang, bukan
ditulis ulang:

- **Pengiriman video**: `lib/r2.ts` — presigned PUT yang mengikat path, MIME,
  dan ukuran; presigned GET berumur 2 jam (`UMUR_TONTON_DETIK`); pemutar di
  `passport/materi/[id]/pemutar-video.tsx`.
- **Pengiriman PDF**: rasterisasi per halaman (`lib/materi/rasterisasi.ts`),
  watermark yang **dibakar ke dalam gambar** (`lib/materi/watermark.ts`,
  termasuk pembuangan karakter kontrol C0 yang pernah bisa merusak seluruh
  e-book satu klien), dan rute penyaji `api/materi/[id]/halaman/[n]`.
- **Harga coret**: sudah terbukti di `owner/tarif` — riwayat append-only
  (`variant_rates`), view publik sempit (`harga_publik`), view staf
  (`varian_harga_staf`), dan aturan "coret tidak boleh lebih murah dari harga
  jual".
- **Katalog publik**: `lib/katalog.ts` — dibaca dengan anon key supaya policy
  baca publik benar-benar teruji.

Yang **belum** ada sama sekali: entitas pesanan yang berdiri sendiri (hari ini
`status_bayar` menempel di baris `booking_requests`), pembayaran otomatis, dan
jalur **unduhan** apa pun — seluruh materi hari ini sengaja tidak bisa diunduh.

## Keputusan yang sudah diambil

Sembilan pertanyaan dijawab pemilik repo sebelum desain ini ditulis:

| Pertanyaan | Keputusan |
|---|---|
| Cara membayar | **Payment gateway otomatis** — bayar, akses terbuka dalam detik |
| Gateway mana | **Midtrans** (Snap); sandbox dulu, produksi beda env var saja |
| Cakupan gateway | **Khusus produk digital**. Pembayaran sesi tetap QRIS manual + bukti + verifikasi admin, utuh apa adanya |
| Hubungan dengan Materi | **Entitas baru**, mesin pengirimannya dipakai ulang |
| Proteksi unduhan | **Tautan bertanda tangan + watermark PDF** per pembeli |
| Produk gratis | Tombol **"Ambil gratis"**, melewati keranjang & gateway, **tetap wajib login** |
| Masa akses | **Selamanya**; admin tetap bisa mencabut |
| Hak menyetel harga | **Owner saja**; admin melihat, tidak menyunting |
| Refund | **Tidak ada**, dinyatakan jelas sebelum bayar; pencabutan manual tetap mungkin |

Dua alasan yang paling mahal untuk dibalik, karena itu ditulis terbuka:

**Kenapa entitas baru, bukan kolom baru di `materials`.** Akses materi digerbang
"punya sesi `selesai` pada layanan ini". Akses produk digerbang "sudah
membeli". Dua sumbu izin dalam satu tabel membuat setiap policy RLS yang sudah
ada harus dipikirkan ulang, dan membuka jalan materi kursus tak sengaja
terpajang di etalase. Mesin pengirimannya tetap satu — yang dipisah adalah
sumbu izinnya, bukan kodenya.

**Kenapa gateway, padahal alur manual sudah matang.** Produk digital terkirim
seketika; menunggu admin memverifikasi bukti transfer membatalkan seluruh
keunggulannya. Alur sesi tidak ikut pindah justru supaya subsistem yang sudah
jadi (pembatalan, tenggat, tagihan email, rekap owner) tidak tersenggol.

## Bentuk data

### `digital_products`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid pk | |
| `judul` | text | |
| `slug` | text unik | Alamat publik `/produk/<slug>` |
| `deskripsi` | text | |
| `jenis` | enum `product_type` (`video`\|`pdf`) | |
| `boleh_unduh` | boolean, default false | Default tertutup, dibuka sadar |
| `sampul_objek` | text null | Gambar kartu |
| `aktif` | boolean, default false | Produk baru tidak langsung terpajang |
| `urutan` | int | Urutan di etalase & landing |
| `created_at` | timestamptz | |

**Tanpa satu pun kolom rupiah.** Lihat "Money firewall" di bawah.

### `digital_product_prices`

| Kolom | Tipe | Catatan |
|---|---|---|
| `product_id` | uuid FK | |
| `harga` | int | 0 = produk gratis |
| `harga_coret` | int null | Opsional, diisi manual, angka pemasaran |
| `berlaku_sejak` | date | |

Meniru `variant_rates` persis: **append-only** untuk peran API — INSERT hanya
dengan `berlaku_sejak` yang maju, UPDATE ditolak seluruhnya, DELETE dicabut.
Harga adalah riwayat, bukan satu baris yang ditimpa; nota lama tidak boleh
berubah karena harga hari ini berubah.

Constraint: `harga_coret is null or harga_coret > harga`. Coret yang lebih
murah dari harga jual terbaca sebagai kenaikan harga, bukan diskon — aturan
yang sama sudah ditegakkan di `owner/tarif/status.ts`, dan di sini ia hidup di
**dua** lapisan karena TypeScript bukan lapisan terakhir.

### `digital_product_files`

| Kolom | Tipe | Catatan |
|---|---|---|
| `product_id` | uuid FK | |
| `objek` | text | Kunci R2 (`produk/<id>/...`) atau bucket Supabase |
| `mime` | text | Ditulis server dari hasil unggah, **tidak pernah** dari browser |
| `byte` | bigint | |

Halaman PDF terasterisasi menumpang pola `material_pages` di tabel
`digital_product_pages` (`product_id`, `halaman`, `objek`).

### `digital_entitlements`

| Kolom | Tipe | Catatan |
|---|---|---|
| `client_id` | uuid FK `clients` | |
| `product_id` | uuid FK | |
| `sumber` | enum (`beli`\|`gratis`\|`pemberian_admin`) | |
| `diberikan_pada` | timestamptz | |
| `dicabut_pada` | timestamptz null | Pencabutan, bukan penghapusan — jejaknya tinggal |
| | `unique (client_id, product_id)` | Inilah yang membuat webhook idempoten |

**Inilah satu-satunya sumber kebenaran "boleh akses".** Setiap gerbang — tonton,
baca, unduh — membaca tabel ini dan tidak pernah membaca `orders`. Satu kalimat
izin, satu tabel, empat rute.

### Pembeli adalah `clients.id`, bukan `auth.users.id`

Pendaftaran mandiri sudah selalu membuat baris `clients`
(`lib/auth/link-client.ts`), dan seluruh passport sudah berbicara dalam
`clients.id`. Sumbu identitas kedua hanya akan melahirkan dua daftar pembeli
yang bisa berbeda.

### `cart_items`

`client_id`, `product_id`, `ditambahkan_pada`, `unique (client_id, product_id)`.
Keranjang tinggal **di basis data**, bukan localStorage: membeli sudah
mewajibkan login, jadi tidak ada keranjang tamu yang perlu dipindahkan;
imbalannya keranjang selamat saat ganti perangkat.

### `orders` & `order_items` (tahap 2)

`orders`: `id`, `client_id`, `kode` (dikirim ke Midtrans sebagai `order_id`,
unik, tidak bisa ditebak), `status`, `total`, `dibuat_pada`, `dibayar_pada`,
`kedaluwarsa_pada`.

`order_items`: `order_id`, `product_id`, `judul_snapshot`, `harga_snapshot`.
Harga **dibekukan saat checkout** — nota kemarin tidak ikut berubah saat owner
mengubah harga besok.

Status: `menunggu_bayar` → `lunas`, dengan `gagal`, `kedaluwarsa`,
`dibatalkan`, `dikembalikan` di sisi lain.

**"Tidak aktif" ditulis sebagai HIMPUNAN sejak baris pertama**, bukan sebagai
satu konstanta. Repo ini sudah pernah tertipu: nilai enum baru membuat
konstanta tunggal salah diam-diam. Sisi TypeScript bisa dipaksa kompilator
lewat `Record` lengkap; sisi plpgsql tidak bisa, jadi ia dijaga uji tersendiri.

## Money firewall

`tests/money-firewall-struktural.test.ts` menegakkan invarian struktural:
kolom nominal rupiah hanya boleh hidup di `variant_rates` dan `honor_marks`,
dibaca dari `information_schema` sehingga berlaku untuk tabel yang belum lahir.
`digital_product_prices.harga` dan `orders.total` akan memerahkannya — dan itu
memang maksud uji itu.

Pelebarannya **sadar dan terdokumentasi**, sama seperti waktu `variant_rates`
masuk: dua tabel ditambahkan ke `TABEL_UANG` dengan alasannya ditulis di
dokblok uji. Yang tidak berubah: honor mitra tidak pernah keluar dari
`variant_rates` lewat jalur mana pun — dan produk digital tidak punya honor
mitra sama sekali, jadi tidak ada yang bisa bocor selain harga yang memang
publik.

Dua view sempit, menyalin pola `harga_publik` **utuh** — `security_invoker =
off`, `revoke all from public, anon, authenticated` **lebih dulu**, baru `grant
select` (Supabase memberi hak penuh bawaan atas setiap objek baru di skema
`public`, termasuk view; `grant` menambah, bukan menggantikan):

- `harga_produk_publik` — `product_id`, `harga`, `harga_coret`,
  `berlaku_sejak`; `grant select to anon, authenticated`. Daftar kolomnya
  dikunci sebagai assertion di uji tersendiri.
- `produk_harga_staf` — pola `varian_harga_staf`, dengan predikat
  `user_role() in ('admin','owner')` **di dalam view**: grant SQL saja bukan
  batas peran, karena admin, owner, dan klien login sebagai satu peran SQL yang
  sama (`authenticated`).

## Pengiriman berkas & gerbang akses

Urutan yang mengikat di **setiap** rute penyaji, disalin dari
`api/materi/[id]/halaman/[n]/route.ts`:

1. Identitas pembaca. Tidak ada → **404**, bukan 401: rute tidak boleh
   mengonfirmasi bahwa produknya ada.
2. **RLS yang memutuskan hak**, memakai sesi pengguna — bukan `if` di route
   handler. Route handler adalah endpoint mandiri; layout tidak menjaganya.
3. Service role baru menyentuh storage **sesudah** basis data memulangkan
   barisnya.
4. Path diambil dari **baris**, tidak pernah dari parameter.

**Video** — bucket R2 yang sudah ada, prefix `produk/<id>/`; presigned GET 2
jam; pemutar dipakai ulang apa adanya.

**PDF baca-di-tempat** — rasterisasi + `bakarWatermark` identitas pembaca,
seperti e-book.

**Unduhan (baru)** — `api/produk/[id]/unduh`: entitlement diperiksa lewat sesi
pengguna, lalu presigned GET **15 menit**. Umurnya sengaja berbeda dari URL
tonton: URL tonton harus bertahan selama orang mem-*pause*, URL unduh cukup
bertahan selama unduhannya.

PDF yang diunduh **dicap nama + email pembeli di setiap halaman**, dibakar ke
dalam berkas — lapisan CSS hilang begitu berkas disimpan, dan kebocoran yang
tidak menunjuk sumbernya sama saja dengan tidak ada proteksi. Pencapan
dilakukan **sekali saat entitlement terbit** dan hasilnya disimpan, bukan tiap
klik: mencap PDF tebal per unduhan adalah kerja CPU yang berulang tanpa guna.

## Sisi pelanggan

### `/produk` — etalase publik, tanpa login

Dibaca dengan **anon key** lewat `harga_produk_publik`, meniru `lib/katalog.ts`
— bukan `createServerSupabase()`. Alasannya sudah ditulis panjang di sana dan
berlaku sama: `cookies()` hanya bermakna dalam request scope, dan membaca
cookie membuat halaman publik ikut dynamic tanpa alasan. Anon key juga membuat
policy baca publik benar-benar teruji — bila policy-nya hilang, etalase kosong
**di test**, bukan diam-diam di produksi.

Kartu: sampul, judul, badge jenis (Video/PDF), badge "Bisa diunduh", harga
dengan coret.

### `/produk/[slug]` — halaman produk, publik

Deskripsi, pratinjau, harga, dan satu tombol yang bunyinya bergantung keadaan:

- belum login → **Tambah ke keranjang** (klik → `/masuk`, lalu **kembali ke
  produk yang sama**)
- gratis → **Ambil gratis**
- berbayar, belum dimiliki → **Tambah ke keranjang**
- sudah dimiliki → **Buka**

Kalimat "produk digital tidak dapat dikembalikan" dipajang di sini, bukan hanya
di checkout.

### `/keranjang` dan checkout

Daftar item, total, tombol bayar. Produk yang sudah dimiliki ditolak masuk
keranjang — bukan dibiarkan terbeli dua kali.

### `/passport/produk` — "Pembelian saya"

Produk yang dimiliki, pintu ke pemutar/pembaca/unduhan.

### Landing

Komponen baru `_landing/produk-digital.tsx`, sebaris dengan `lini-layanan.tsx`:
3–4 produk unggulan berdasarkan `urutan`, plus tautan "Lihat semua".
Diletakkan setelah lini layanan, sebelum `passport-teaser`.

## Pembayaran (tahap 2)

Midtrans **Snap**: satu popup yang sudah menangani QRIS, VA, e-wallet, dan
kartu sekaligus. Sandbox dan produksi hanya berbeda env var
(`MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_PRODUKSI`).

### Webhook — tiga aturan yang tidak bisa ditawar

1. **Signature diperiksa, selalu.**
   `sha512(order_id + status_code + gross_amount + ServerKey)` dibandingkan
   dengan `signature_key`, dengan perbandingan waktu-tetap. Tidak lolos → 401,
   dan **tidak pernah menyentuh basis data**. Tanpa ini, siapa pun yang tahu
   URL-nya bisa menerbitkan entitlement gratis untuk dirinya sendiri.
2. **Jumlah diverifikasi ulang terhadap `orders.total`.** Yang menentukan lunas
   adalah angka yang kita simpan, bukan angka di badan notifikasi.
3. **Idempoten.** Midtrans mengirim ulang notifikasi. `unique (client_id,
   product_id)` membuat pengiriman kedua tidak bisa menggandakan apa pun, dan
   transisi lunas → entitlement dibungkus **satu RPC transaksional** — bukan
   dua panggilan PostgREST berurutan yang bisa putus di tengah dan meninggalkan
   pesanan lunas tanpa akses.

Webhook memakai service role (Midtrans tidak punya sesi), dan karena itu
tinggal di `lib/`, bukan di dalam `app/admin/**` — pagar yang sudah ditegakkan
`tests/admin-shell.test.ts`.

### Jaring pengaman

Cron yang sudah ada menanyakan status ke Midtrans untuk pesanan
`menunggu_bayar` yang melewati tenggat, lalu menutupnya sebagai lunas atau
kedaluwarsa. Webhook yang hilang adalah kejadian normal di internet; tanpa
jaring ini, orang yang sudah membayar tidak menerima barangnya dan tidak ada
yang tahu.

## Sisi staf

### `/owner/produk` — satu-satunya tempat harga disetel

Form meniru `owner/tarif/form-tarif.tsx`, termasuk tombol bantu isi coret dan
pemeriksaan "coret tidak boleh lebih murah".

### `/admin/produk` — master produk

Membuat produk, mengunggah berkas, judul/deskripsi/sampul, aktif/nonaktif,
urutan. Harga **tampil** lewat `produk_harga_staf`, tidak bisa disunting.

Halaman detail memuat **daftar pembeli**: nama, tanggal, sumber, tombol cabut
akses, dan tombol beri akses manual untuk kasus khusus.

### `/admin/pembelian` — riwayat pembelian

Semua pesanan; saring per status dan rentang tanggal, cari per nama klien.
Admin melihat status dan isi pesanan. **Total rupiah per pesanan tampil di
sisi owner**, dan rekap pendapatan produk digital masuk `/owner/rekap` yang
sudah ada.

## Pengujian

TDD per tugas. Yang dijaga paling ketat:

- **Entitlement diuji dengan sesi klien sungguhan, bukan service role.** Embed
  yang ditolak RLS memulangkan `null`, bukan galat — fitur bisa mati diam-diam,
  dan uji ber-service-role buta sepenuhnya terhadapnya.
- **Money firewall**: pelebaran `TABEL_UANG` yang sadar, dan daftar kolom kedua
  view dikunci sebagai assertion.
- **Webhook**: signature ditolak bila salah, jumlah tidak cocok ditolak,
  notifikasi kembar tidak menggandakan entitlement. Semuanya dengan notifikasi
  palsu yang **kita tandatangani sendiri** — tidak menunggu akun merchant, tidak
  menunggu Midtrans.
- **Harga coret**: coret lebih murah ditolak di TS dan di constraint.
- **Gerbang unduhan**: bukan-pembeli menerima 404; entitlement tercabut menerima
  404.
- **Himpunan status**: `Record` lengkap di TS, uji tersendiri untuk plpgsql.

Catatan operasional: Supabase lokal dipakai bersama sesi lain — `npm test`
penuh perlu dikoordinasikan lebih dulu.

## Tahapan

**Tahap 1 — katalog & pengiriman.** Skema (`digital_products`, harga, berkas,
entitlement), master owner + admin, unggah berkas, etalase `/produk`, halaman
produk, seksi landing, `/passport/produk`, dan **produk gratis hidup penuh**.
Tidak ada satu baris pun kode pembayaran. Tahap ini bisa dirilis sendiri dan
sudah bisa ditunjukkan ke klien.

**Tahap 2 — uang.** Keranjang, `orders`/`order_items`, Snap, webhook,
entitlement berbayar, cron jaring pengaman.

**Tahap 3 — pelaporan.** `/admin/pembelian`, rekap pendapatan di `/owner/rekap`,
pencabutan akses, pemberian akses manual.

Urutannya dipilih supaya bagian tersulit untuk diuji (webhook gateway) berdiri
di tahapnya sendiri, dan supaya seluruh rantai unggah → simpan → sajikan →
watermark sudah terbukti jalan sebelum uang masuk ke gambar.

## Risiko dan ketergantungan luar

- **Akun merchant Midtrans butuh waktu** (verifikasi, biasanya berbadan usaha +
  rekening atas nama yang sama). Sandbox bisa dipakai hari ini tanpa akun.
  Tahap 1 tidak bergantung padanya sama sekali.
- **Webhook menuntut URL publik**, sementara PADMA belum pernah live. Uji asap
  ujung-ke-ujung tahap 2 karena itu menunggu deploy pertama ke Vercel, atau
  terowongan sementara. Kodenya tidak menunggu.
- **CORS R2** perlu memuat domain produksi sebelum unggahan dari peramban
  bekerja di luar lokal — sudah tercatat sebagai sisa pekerjaan rantai video.

## Di luar cakupan

- Memindahkan pembayaran sesi ke Midtrans.
- Langganan, sewa berjangka, kupon diskon, dan afiliasi.
- Bundel produk, serta produk yang membungkus materi kursus yang sudah ada.
- Refund otomatis lewat gateway.
