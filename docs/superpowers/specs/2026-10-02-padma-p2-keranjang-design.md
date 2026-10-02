# P2 — Keranjang & checkout multi-item — desain

Tanggal: 2 Oktober 2026
Status: menunggu persetujuan pemilik repo
Induk: `2026-09-26-padma-inti-pembayaran-design.md` (P1, tabel "Pemecahan")
Permintaan asal: `2026-09-20-padma-produk-digital-design.md`, butir 4 —
"**Keranjang** saat hendak membeli; **wajib login** untuk membeli."

## Masalah

P1 membangun mesin pembayaran Midtrans yang sudah multi-item di seluruh
tubuhnya — `salurkan_pesanan` mengulang semua `order_items`, webhook
membandingkan `gross_amount` dengan jumlah harga beku dan `jumlah_item` dengan
cacah baris, `/admin/pesanan` membaca semua item. Yang membatasinya ke satu
produk hanya satu hal: RPC `buat_pesanan(uuid, boolean)` menerima satu id.

Yang belum ada sama sekali: keranjang. `cart_items` dirancang di spec 20 Sep
tapi tidak pernah dibuat di migrasi mana pun.

## Keputusan yang sudah diambil

| Pertanyaan | Keputusan |
|---|---|
| Tempat keranjang | **Basis data** (`cart_items`), bukan localStorage — ditetapkan spec 20 Sep: membeli wajib login, keranjang selamat saat ganti perangkat |
| Tombol di halaman produk berbayar | **Dua**: "Beli sekarang" (alur P1, utuh) + "Tambah ke keranjang". Menyimpang dari spec 20 Sep yang hanya punya satu tombol, karena P1 sudah memasang beli langsung |
| Pesanan terbuka berisi produk lain | **Ditolak**, plus tombol batal di layar keranjang. Tidak dibatalkan otomatis: instruksi VA mungkin sudah di tangan pembeli, dan menutupnya mengundang `lunas_setelah_tutup` |
| Kembali ke produk sesudah login | **Masuk P2** — dijanjikan spec 20 Sep, belum pernah dibangun |
| Hubungan keranjang ↔ pesanan | **Keranjang = penyimpanan; checkout menerima larik id.** Satu RPC pesanan untuk "Beli sekarang" dan keranjang, supaya gerbang uang hidup di SATU badan fungsi |
| Alamat layar keranjang | **`/passport/keranjang`**, bukan `/keranjang` seperti spec 20 Sep: gerbang klien dan kepala passport sudah tersedia di sana |
| Tingkat pengujian | **Dipangkas** — hanya tiga titik buta pengujian manual (lihat Pengujian) |

Kenapa larik dan bukan "checkout membaca keranjang dari basis data": jalur
kedua membuat "Beli sekarang" butuh fungsi sendiri, dan gerbang anti-dobel lalu
hidup di dua tempat. Itu persis bentuk cacat tagih-dua-kali yang lolos tujuh
review per-tugas P1-A. Bonusnya: layar mengirim id yang **sedang tampil**, jadi
keranjang yang diubah di tab lain tidak membuat pembeli membayar sesuatu yang
tidak ia lihat.

## Data

### `cart_items`

```sql
create table public.cart_items (
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.digital_products(id) on delete cascade,
  ditambahkan_pada timestamptz not null default now(),
  primary key (client_id, product_id)
);
```

Nol kolom harga. Harga dibaca dari `harga_produk_publik` saat ditampilkan dan
dibekukan oleh RPC pesanan saat checkout — keranjang mengingat *apa*, bukan
*berapa*.

Hak mengikuti P1: `revoke all from anon, authenticated`, `grant select to
authenticated`, satu policy "keranjang: klien baca miliknya"
(`exists (select 1 from clients c where c.id = cart_items.client_id and
c.user_id = auth.uid())`). Nol grant insert/update/delete — setiap penulisan
lewat RPC.

### Pembersihan otomatis

Trigger `after insert or update of dicabut_pada on digital_entitlements`:
baris yang hidup (`dicabut_pada is null`) menghapus `cart_items` untuk
`(client_id, product_id)` yang sama. Satu tempat menutup semua jalur akses —
beli (webhook), ambil gratis, pemberian staf — tanpa menyentuh satu baris pun
mesin P1.

## RPC

Semua `security definer set search_path = public`, `client_id` dari
`auth.uid()` (tidak pernah dari payload), `revoke all from public, anon`,
`grant execute to authenticated`.

### `tambah_ke_keranjang(p_product_id uuid) returns void`

Menolak (`P0001`, kalimat untuk pembeli) bila: produk tidak tayang atau belum
berharga (`P0002` "Produk tidak tersedia."), harganya 0 ("Produk ini gratis —
ambil lewat tombolnya."), entitlement hidup sudah ada ("Anda sudah memiliki
produk ini."), atau keranjang sudah berisi 20 ("Keranjang penuh — paling banyak
20 produk."). Produk yang sudah di keranjang: `on conflict do nothing`, bukan
galat.

### `hapus_dari_keranjang(p_product_id uuid) returns void`

Menghapus baris milik pemanggil. Tidak mengenai apa pun bukan galat.

### `baca_keranjang()`

Pulangan per baris: `product_id`, `judul`, `slug`, `harga` (nullable),
`keadaan`, `ditambahkan_pada`, urut `ditambahkan_pada`.

`keadaan` satu dari lima, dievaluasi dalam urutan ini:

| Nilai | Syarat |
|---|---|
| `tidak_tersedia` | produk tidak tayang, atau belum berharga |
| `gratis` | harga 0 |
| `sudah_dimiliki` | entitlement hidup (sela waktu sebelum trigger — atau entitlement yang lahir dari jalur yang belum dikenal) |
| `diproses` | **`public.punya_pesanan_menunggu(product_id)` benar** |
| `siap` | selain itu |

`diproses` MEMANGGIL `punya_pesanan_menunggu`, tidak menyalin himpunan
statusnya. Fungsi itu sudah wajib cermin gerbang beruang `buat_pesanan`;
salinan ketiga adalah satu tempat lagi yang bisa berbeda diam-diam.

### `buat_pesanan_keranjang(p_product_ids uuid[], p_ulang boolean default false)`

Pulangan: kolom `buat_pesanan` P1 (`pesanan_id`, `kode`, `percobaan`,
`nominal_tagih`, `judul`) ditambah `jumlah_item smallint`.

1. Kembar dan `null` dibuang, urutan pertama dipertahankan. 0 → "Keranjang
   kosong."; > 20 → "Paling banyak 20 produk dalam satu pesanan."
2. **Gerbang P1 per produk, tanpa diubah satu kondisi pun**: tayang & berharga,
   bukan gratis, nol entitlement hidup, nol pesanan beruang
   (`status in ('ditahan','lunas') or sebab_tinjauan = 'lunas_setelah_tutup'`).
   Untuk larik > 1, kalimat galat MENYEBUT judul produk yang menolak; untuk
   larik 1, kalimatnya SAMA PERSIS dengan P1 (uji P1 bergantung padanya).
3. Pesanan terbuka (`for update`): dipulangkan bila **himpunan** produknya sama
   dengan larik (urutan diabaikan), ditolak dengan kalimat P1 "Selesaikan dulu
   pesanan % yang masih terbuka, atau batalkan lebih dulu." bila berbeda. Logika
   `p_ulang` / percobaan kesepuluh / tabrakan `kode` / kalah balapan 23505
   disalin dari P1 tanpa perubahan perilaku; perbandingan produk di kedua
   tempatnya memakai pembantu yang sama.
4. `orders.jumlah_item = n`; `order_items` dibekukan dalam urutan larik,
   `urutan` 1..n.

Pembantu `himpunan_produk_pesanan_sama(uuid, uuid[]) returns boolean`:
`security definer`, **dicabut dari `authenticated`** — ia membaca
`order_items` dan tidak menggerbangi pemanggilnya.

### `buat_pesanan(uuid, boolean)` — menjadi pembungkus

Tanda tangan dan pulangan tidak berubah. Badannya: periksa `auth.uid()` tidak
null (pintu terbuka wajib menggerbangi dirinya sendiri — `TERBUKA_SADAR`),
lalu `select` lima kolom dari `buat_pesanan_keranjang(array[p_product_id],
p_ulang)`. Seluruh gerbang hidup di satu badan.

## Rute

`POST /api/pesanan/checkout` menerima `{ productId }` (P1, tetap) **atau**
`{ productIds: string[] }`; keduanya divalidasi UUID, 1..20, lalu memanggil
`buat_pesanan_keranjang`. Galat `P0001` diteruskan kalimatnya seperti P1.

Snap tetap menerima **satu** baris `item_details` seharga total. Judulnya
`"<judul pertama> + <n-1> produk lain"` bila n > 1. `item_details` yang
dirinci per produk adalah satu tempat lagi untuk selisih jumlah, dan Midtrans
menolak transaksi yang rinciannya tidak berjumlah `gross_amount`.

## Layar

### `/produk/[slug]` — berbayar, belum dimiliki

`TombolBeli` P1 utuh. Di bawahnya, **hanya pada keadaan `"belum"`**, tombol
**"Tambah ke keranjang"** → sesudah berhasil menjadi "Sudah di keranjang ·
Lihat keranjang" (tautan `/passport/keranjang`). Status "sudah di keranjang"
dibaca dari peramban (`cart_items`, RLS) — halaman tetap anon dan
`revalidate = 300`, alasan yang sama dengan P1.

Galat RPC ditampilkan apa adanya di bawah tombol.

### Belum login → kembali ke produk

Saat pengunjung tanpa sesi menekan **"Beli sekarang" atau "Tambah ke
keranjang"**: peramban menulis cookie `padma_lanjut` = path produk
(`SameSite=Lax`, `max-age` 1 jam), lalu menuju `/masuk`.

`/setelah-masuk` membaca cookie itu **hanya bila tujuannya `/passport`**
(klien biasa — owner, admin, dan alur undangan tidak diubah), memvalidasinya
dengan pembantu baru `tujuanProdukAman()` yang hanya menerima
`^/produk/[a-z0-9-]+$`, lalu menghapus cookie. `tujuanAman()` yang ada adalah
daftar izin path persis dan tidak cocok untuk path ber-slug; ia tidak diubah.

Satu jalur ini menutup login email, Google (`/auth/callback` →
`/setelah-masuk`), dan pendaftaran + konfirmasi email di peramban yang sama.
Produk **tidak** ditambahkan otomatis — pengunjung menekan tombolnya sekali
lagi. Niat beli yang dititipkan di cookie tanpa konfirmasi bukan niat beli.

### `/passport/keranjang`

Di bawah `requireRole(["klien"])` dan kepala passport yang sudah ada. **Nol
item nav baru** (nav sudah enam). Pintu masuk: tautan "Keranjang (n)" di
`/passport/produk`, dan di `/produk` + `/produk/[slug]` bila n > 0.

Isi, dari `baca_keranjang()`:

- Item `siap`: judul (tautan ke produknya), harga hari ini, tombol hapus.
- Item lain: ditandai dengan kalimat keadaannya ("Tidak tersedia lagi",
  "Gratis — ambil di halamannya", "Sudah Anda miliki", "Pembayaran sedang
  diproses"), tombol hapus, **dikeluarkan dari total dan dari checkout**.
- Total item `siap`, kalimat "tidak dapat dikembalikan" yang sama dengan
  halaman produk, tombol **"Bayar"** → `mintaCheckout(<id siap>, ulang)` → Snap.
  `mintaCheckout` diperluas menerima `string | readonly string[]`; logika
  `orderIdTerbakar` / `ulang` P1 dipakai utuh.
- Ditolak karena pesanan terbuka: kode pesanannya (dibaca dari `orders` milik
  pemanggil, `status = 'menunggu_bayar'`, difilter `client_id` — staf yang juga
  klien membaca seluruh tabel lewat policy staf) dan tombol **"Batalkan pesanan
  itu"** → `mintaBatal` P1, dengan peringatan "Jangan batalkan bila Anda sudah
  mendapat nomor VA dan akan mentransfer."
- Snap `onSuccess`/`onPending`: kalimat "Pembayaran sedang diproses — produk
  muncul di Pembelian Saya", lalu baca ulang. Keranjang TIDAK dikosongkan oleh
  peramban; trigger yang mengosongkannya saat akses benar-benar terbit, dan
  sampai itu item tampil `diproses`.
- Lapis 1b: `await periksaPesananMenggantung()` di server component, sama
  persis dengan `/passport/produk` — halaman passport dynamic, jadi tidak perlu
  dipicu dari peramban.

## Yang tidak berubah

Webhook, `terapkan_notifikasi_midtrans`, `salurkan_pesanan`,
`terbitkan_akses_item`, penyapu Lapis 3, `/admin/pesanan`,
`punya_pesanan_menunggu`, `batalkan_pesanan_saya`, adapter Snap. Nol
perubahan tabel uang.

## Pengujian (dipangkas)

Wajib apa pun tingkatnya: `tests/fungsi-mesin-tertutup.test.ts` — empat RPC
baru (`tambah_ke_keranjang`, `hapus_dari_keranjang`, `baca_keranjang`,
`buat_pesanan_keranjang`) masuk `TERBUKA_SADAR` dengan gerbang `auth.uid`;
uji struktural lain yang memerah karena tabel/fungsi baru diperbarui, bukan
dilonggarkan; `npx tsc --noEmit` dan `npm run lint` bersih. Uji P1 yang ada
tetap hijau tanpa diubah — itu bukti pembungkus `buat_pesanan` setia.

Uji baru, hanya tiga titik yang buta bagi pengujian manual:

1. **RLS lewat sesi klien** — klien A membaca `cart_items` miliknya dan nol
   baris milik klien B; `insert` langsung lewat PostgREST ditolak. Kegagalan
   RLS pulang sebagai `[]`, dan keranjang kosong tidak terlihat rusak.
2. **Gerbang per produk di dalam larik** — larik tiga produk dengan satu yang
   sudah dimiliki → ditolak dan kalimatnya menyebut judulnya, nol pesanan
   lahir; satu yang beruang (`lunas_setelah_tutup`) → ditolak; pesanan
   terbuka `{A,B}` + panggilan `{B,A}` → pesanan yang sama; + `{A,C}` →
   ditolak. Ini jalur tagih-dua-kali, dan jarang dicoba dengan tangan.
3. **Trigger pembersihan** — entitlement hidup lahir lewat
   `terapkan_notifikasi_midtrans` (bukan lewat insert langsung) → baris
   keranjangnya hilang. Webhook tidak menyala di sandbox lokal.

Docker lokal sedang mati; ketiga uji itu berjalan sesudah ia hidup. Jangan
`npm test` penuh — Supabase lokal dipakai bersama sesi lain.

## Di luar cakupan

- Rate limit `/api/pesanan/checkout` — utang P1, tidak memburuk; pesanan
  multi-item tidak menambah jumlah transaksi Snap yang bisa dicetak.
- Keranjang tamu (tanpa login) — membeli wajib login.
- Item `sesi` di keranjang — P3.
- Pengingat keranjang tertinggal, kupon, kuantitas.

## Tindak lanjut sebelum produksi

- Migrasi P2 lahir SESUDAH tujuh migrasi P1; urutan penerapannya ikut
  checklist go-live P1 (`web/README.md` Fase 3), **bukan `db push`**.
