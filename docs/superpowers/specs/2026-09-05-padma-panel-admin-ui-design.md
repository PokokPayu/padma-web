# PADMA — Perombakan UI/UX Panel Admin & Owner — Design Doc

**Tanggal:** 5 September 2026
**Status:** menunggu review

## 1. Konteks

Seluruh pekerjaan fungsional PADMA v1 sudah selesai dan ter-merge. Revisi ini datang dari klien
dan sifatnya murni tampilan: panel `/admin` dan `/owner` diminta berubah menjadi **admin panel
sebagaimana umumnya** — sidebar, dashboard, tata letak kerja — bukan kartu tab horizontal yang
ada sekarang.

Kondisi hari ini: kedua panel memakai container `max-w-6xl` terpusat dengan kartu navigasi
horizontal di atas isi (9 tujuan untuk admin, 3 untuk owner), plus bottom bar khusus mobile.
Beranda admin berisi 4 kartu antrean; beranda owner 3 kartu angka pekan berjalan. Bahasa visualnya
mengikuti prototipe klien: krem `paper`, serif Marcellus untuk judul dan angka, radius 16px, aksen
emas tersebar di seluruh permukaan.

Dokumen ini merancang penggantinya.

## 2. Batas Kejujuran — apa yang berubah dan apa yang tidak

**Yang berubah:**

- Kerangka navigasi kedua panel: sidebar gelap permanen + topbar, drawer di layar kecil.
- Bahasa visual di dalam `/admin` dan `/owner`: palet, kerapatan, radius, tipografi.
- Isi beranda kedua panel: naik dari deretan kartu angka menjadi dashboard dengan grafik tren.
- Bentuk DOM shell — dan karena itu, asersi bentuk di beberapa berkas test.

**Yang TIDAK berubah, dan sengaja dijaga tidak berubah:**

- **Landing, skrining, dan seluruh `/passport` (panel klien).** Palet krem-emas-serif tetap hidup
  di sana. Perombakan ini berhenti di pintu panel staf.
- **Skema basis data, RLS, dan seluruh server action.** Tidak ada satu migration pun.
- **Money firewall.** Panel admin tetap tidak boleh memuat satu nominal pun; panel owner tetap
  satu-satunya tempat nominal hidup, dan penolakannya tetap ditegakkan di level basis data.
- **Argumen `requireRole` di tiap layout.** `/admin` tetap `["admin","owner"]`, `/owner` tetap
  `["owner"]`, keduanya tetap dipanggil **tepat satu kali** per layout.
- **Jalur data.** Seluruh pembacaan tetap lewat sesi pengguna (`createServerSupabase`), tidak
  pernah service role.

**Yang tidak dijamin:**

- **Test bentuk akan merah lebih dulu, dan itu memang harusnya.** `admin-shell`, `owner-kerangka`,
  dan `kerangka-muat` mengasersi bentuk DOM yang sedang diganti ("tepat 2 elemen `<nav>`", "tepat
  18 tag `<a>`", kelas `sm:flex`/`sm:hidden`). Asersinya ditulis ulang; **maksud** di baliknya
  tidak. Setiap penulisan ulang wajib menjelaskan di komentar apa yang tetap dijaga.
- **Logo baru belum berupa vektor.** Yang diterima dari klien adalah JPEG 1254×1254 tanpa
  transparansi. Konsekuensinya dijelaskan di §7.

## 3. Keputusan yang disepakati

| # | Keputusan | Alasan |
|---|---|---|
| U1 | **Sidebar gelap + area kerja terang** (pola admin panel klasik) | Paling dikenali klien, dan hijau-malam PADMA justru pas sebagai warna sidebar. Alternatif "terang seluruhnya ala shadcn" ditolak karena identitas PADMA jadi terlalu tipis; "data-dense enterprise" ditolak karena terlalu jauh dari nuansa produk. |
| U2 | **Primitif bersama, shell tetap per peran** | Komponen visual dibagi; **daftar menu tidak**. Satu daftar menu bersama berarti satu baris `if (peran === "owner")` yang memisahkan tab uang dari admin. Money firewall PADMA hari ini bersifat fisik — berkas terpisah, penjaga terpisah — dan kerapian tidak sepadan dengan menukarnya jadi kondisional. |
| U3 | **Sans (Jakarta) seluruhnya di dalam panel**; serif Marcellus tetap di landing, skrining, `/passport` | Serif untuk judul & angka terasa butik, bukan ruang kerja. Angka stat memakai `tabular-nums` supaya kolom angka tidak bergoyang antar-baris. |
| U4 | **Grafik ditulis sendiri sebagai SVG**, tanpa library | Proyek ini tidak punya library grafik dan tidak perlu menambah dependensi untuk dua bentuk grafik. Bentuknya juga bisa mengikuti palet baru persis. |
| U5 | **Drawer + bottom bar 4 tujuan** di layar kecil | Drawer memberi konsistensi dengan desktop; bottom bar menjaga kecepatan admin yang bekerja dari HP. Bottom bar 9 ikon yang ada sekarang dibubarkan. |
| U6 | Dashboard sampai **grafik tren** | Klien meminta "dashboard", dan deretan kartu angka saja akan terbaca sebagai ganti warna belaka. |
| U7 | Berkas `admin/_shell/nav-admin.tsx` & `owner/_shell/nav-owner.tsx` **dipertahankan namanya** | Belasan berkas test menyebut path itu. Isinya berubah total (merakit primitif, bukan menggambar tab), tetapi kerusakan test ditahan seminimal mungkin. |
| U8 | Logo baru **tidak dipakai di sidebar** | Lihat §7. |

## 4. Kerangka & berkas

Lahir baru — `src/app/_shell/panel/`, seluruhnya **buta soal peran**: tidak satu pun berkas di
direktori ini boleh menyebut `"admin"`, `"owner"`, atau mengimpor penjaga peran.

| berkas | tanggung jawab |
|---|---|
| `kerangka.tsx` | `<KerangkaPanel menu menuRingkas nama peran jalanKeluar?>` — merakit sidebar + topbar + drawer + bottom bar, memegang state buka/tutup drawer |
| `sidebar.tsx` | daftar menu vertikal, penanda aktif, badge; `menu` datang sebagai prop |
| `topbar.tsx` | judul halaman, tombol ☰, `MenuAkun` (dipakai ulang dari `_shell/`, tidak ditulis ulang) |
| `bottom-bar.tsx` | tujuan ringkas + badge; `menuRingkas` datang sebagai prop |
| `ikon.tsx` | satu peta nama→path SVG, menggantikan dua salinan ikon yang sekarang hidup terpisah di nav admin & nav owner |
| `stat-tile.tsx` | angka besar + label + keterangan + tautan tujuan |
| `kartu.tsx` | permukaan putih bergaris, dengan/tanpa judul |
| `tabel.tsx` | pembungkus tabel: `overflow-x-auto`, kepala lengket, baris rapat |
| `grafik-batang.tsx`, `grafik-garis.tsx` | SVG murni; menerima `nilai: number[]` dan fungsi format sebagai prop |

Yang berubah isi, tetap namanya:

- `admin/_shell/nav-admin.tsx` — memegang `MENU_ADMIN` (9 tujuan) dan `MENU_RINGKAS_ADMIN`
  (Inbox, Klien, Sesi, Bayar), lalu menyerahkannya ke `KerangkaPanel`.
- `owner/_shell/nav-owner.tsx` — memegang `MENU_OWNER` (3 tujuan) dan jalan keluar
  "Buka Panel Admin" yang **tetap bukan anggota menu** dan tidak pernah ikut menyala sebagai
  `aria-current`. Panel owner hanya punya 3 tujuan, jadi `menuRingkas`-nya sama persis dengan
  `MENU_OWNER` — tidak ada yang perlu diringkas, dan drawer di sana hanya berisi hal yang sama.
- `admin/layout.tsx`, `owner/layout.tsx` — `requireRole` dan `hitungAntrean()` persis seperti
  sekarang; hanya pembungkusnya yang berganti dari container terpusat menjadi grid
  sidebar+konten. Catatan money firewall di kaki halaman pindah ke bawah sidebar.
- `admin/loading.tsx`, `owner/loading.tsx`, `_shell/skeleton.tsx` — bentuk kerangka muat mengikuti
  bentuk kartu baru. Penanda yang ditunggu skrip E2E dan perilaku `prefers-reduced-motion` tidak
  boleh hilang.

## 5. Bahasa visual

Token panel ditambahkan di `globals.css`; token PADMA lama **tidak dihapus** karena landing,
skrining, dan `/passport` masih memakainya.

- **Sidebar**: `--color-night` (#0A2B1F) polos, tanpa gradien. Item aktif: latar `white/8` +
  batang emas 3px di tepi kiri + teks `gold-pale`. Item pasif `#9DB09E`, hover `white/5`.
- **Area kerja**: latar `#F5F6F4` (abu hangat, bukan krem `paper`), permukaan kartu putih, garis
  `#E4E7E3`.
- **Aksen**: `leaf` untuk aksi utama, `clay` untuk bahaya dan angka antrean yang menuntut
  tindakan, `gold` **hanya** di sidebar — di panel, emas berhenti jadi warna hias dan menjadi
  penanda "kamu di sini".
- **Radius** turun dari 16px ke 8px. Kartu ditopang garis 1px, bukan bayangan.
- **Kerapatan** naik: teks dasar 13px, baris tabel `py-2.5`, judul halaman 18px semibold.

## 6. Dashboard

**Admin** — empat stat tile antrean (tetap, tanpa query baru) ditambah:

- **Grafik batang** sesi selesai 8 pekan terakhir. Berkas baru `src/lib/admin/tren.ts`, membaca
  `sessions(tanggal, status)` lewat sesi pengguna dan mengelompokkan pekan di JS dengan
  `awalPekan()` dari `@/lib/owner/pekan` — matematika tanggal murni, nol nominal. (Memindahkan
  `pekan.ts` ke lokasi netral menyentuh 10 berkas termasuk test dan **tidak** dilakukan di sini.)
- **Agenda hari ini**: sesi terjadwal hari ini — klien, layanan, mitra.
- **Aktivitas terbaru** dan tombol aksi cepat (Klien baru, Sesi baru).

**Owner** — tiga kartu pekan berjalan (tetap) ditambah:

- **Grafik garis tiga seri** — harga klien, honor mitra, margin — 8 pekan terakhir. **Tanpa query
  baru:** `ambilRekap()` sudah memulangkan seluruh pekan lengkap dengan marginnya; grafik hanya
  mengambil 8 teratas dan membalik urutannya.
- **Tabel mitra teraktif pekan ini**, dari `RekapPekan.mitra` yang sudah ada.
- Peringatan "sesi belum bertarif" tetap tampil apa adanya — itu uang yang hilang tanpa jejak dan
  tidak boleh tenggelam di dashboard yang lebih ramai.

**Pagar money firewall di lapisan grafik.** `GrafikBatang` dan `GrafikGaris` menerima
`nilai: number` dan fungsi format sebagai prop; keduanya tidak pernah tahu soal rupiah. Yang
menyuntikkan `formatRupiah` hanya halaman owner. Pagar lama ("markup dashboard admin tidak
mengandung `Rp\s?\d`") tetap berlaku, ditambah pagar baru: `src/lib/admin/tren.ts` tidak boleh
menyentuh `service_rates` maupun `honor_marks`, dan tidak boleh memuat `createAdminSupabase`.

## 7. Logo baru

Klien mengirim logo baru: teratai emas + wordmark PADMA di atas hijau tua, dalam badge lingkaran
bertuliskan "PREMIUM WOMEN'S WELLNESS HOMECARE". Berkasnya disalin ke `web/public/logo-padma.jpg`
(JPEG 1254×1254).

**Berkas ini tidak dipakai di sidebar**, karena dua sebab yang tidak bisa disiasati CSS:

1. **Tidak punya transparansi.** Latar hijaunya ikut terbawa, dan warnanya `#182A1A` bertekstur —
   bukan `#0A2B1F` polos milik sidebar. Hasilnya tempelan kotak yang warnanya *hampir* sama, yang
   justru lebih buruk daripada warna yang jelas berbeda.
2. **Teks melingkarnya hilang di bawah ~120px**, sedangkan slot merek di kepala sidebar setinggi
   ~36px.

Karena itu: logo baru dipakai di tempat yang lapang — halaman **Masuk**, layar **Aktivasi**, dan
favicon. Di sidebar dan di seluruh ukuran kecil, lambang tetap komponen vektor `Lotus` + wordmark
"PADMA" berwarna emas.

**Permintaan terbuka ke klien:** versi vektor (SVG/AI/PDF) dan versi berlatar transparan. Dengan
raster 1254px, cetak dan layar retina berukuran besar akan pecah.

## 8. Test

**Tetap hijau tanpa disentuh** — diperlakukan sebagai pagar, bukan penghalang:
`money-firewall-struktural`, `access-matrix-layouts`, `rls-*`, `admin-pengerasan`,
`owner-pengerasan`, dan seluruh test yang menguji server action serta lapisan data.

**Ditulis ulang asersinya, maksudnya dipertahankan:**

| berkas | yang berubah | yang tetap dikunci mati |
|---|---|---|
| `admin-shell.test.ts` | asersi bentuk: sidebar + drawer + bottom bar menggantikan "tepat 2 `<nav>`, tepat 18 `<a>`, `sm:flex`/`sm:hidden`" | badge hilang saat nol; angka badge datang dari data, bukan literal; satu tujuan aktif per rute; sub-rute menyalakan tab induknya; `requireRole` tepat sekali dengan peran persis; nol nominal; nol service role di `src/app/admin/**` (kecuali `materi/unggah.ts`) |
| `owner-kerangka.test.ts` | idem, untuk shell owner | `requireRole(["owner"])` tepat sekali; "Buka Panel Admin" tidak pernah `aria-current` |
| `kerangka-muat.test.ts` | bentuk kerangka meniru kartu baru | kerangka mengumumkan diri sebagai status; blok abu `aria-hidden`; denyut berhenti pada `prefers-reduced-motion`; penanda yang ditunggu skrip E2E |

**Test baru:**

- Primitif panel: `Sidebar` tidak menyebut peran mana pun; drawer tertutup saat rute berganti;
  bottom bar memuat tepat tujuan ringkas yang diberikan.
- `src/lib/admin/tren.ts`: pengelompokan pekan benar di batas pekan; memakai sesi pengguna;
  tidak menyentuh tabel uang.
- Grafik: `GrafikGaris`/`GrafikBatang` tidak memuat string mata uang apa pun dari dirinya sendiri.

**E2E (Playwright, 8 skrip).** Skrip yang menunggu penanda kerangka atau menavigasi lewat nav
harus ikut diperiksa dan diperbarui — perubahan bentuk shell adalah persis kelas perubahan yang
membuat E2E menggantung tanpa pesan yang jelas.

## 9. Urutan pengerjaan

1. Token visual + primitif `_shell/panel/` + testnya.
2. Shell admin (`nav-admin.tsx`, `layout.tsx`) + penulisan ulang `admin-shell.test.ts`.
3. Shell owner + penulisan ulang `owner-kerangka.test.ts`.
4. Kerangka muat (skeleton) + `kerangka-muat.test.ts`.
5. Dashboard admin: `lib/admin/tren.ts`, grafik batang, agenda, aktivitas, aksi cepat.
6. Dashboard owner: grafik garis dari `ambilRekap()`, tabel mitra teraktif.
7. Sapuan halaman isi (klien, sesi, bayar, mitra, layanan, materi, pengaturan, rekap, tarif) ke
   primitif kartu & tabel baru.
8. Logo baru di halaman Masuk & Aktivasi + favicon.
9. E2E disetel ulang dan dijalankan seluruhnya.

Sembilan langkah ini **dipecah menjadi dua rencana implementasi**, bukan satu: langkah 1–4
(kerangka & bahasa visual) berdiri sendiri — sesudahnya kedua panel sudah berbentuk admin panel
dan seluruh test hijau, sehingga hasilnya bisa ditunjukkan ke klien lebih awal. Langkah 5–9
(dashboard, grafik, sapuan halaman isi, logo, E2E) menyusul sebagai rencana kedua di atas
kerangka yang sudah stabil.
