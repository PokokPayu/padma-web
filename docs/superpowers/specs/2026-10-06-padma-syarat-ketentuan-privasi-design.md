# Syarat & Ketentuan, Kebijakan Privasi, dan persetujuan tercatat — desain

Tanggal: 6 Oktober 2026
Status: menunggu persetujuan pemilik repo
Basis: branch `development`
Permintaan asal: pemilik repo — "tambahkan terms and condition". Klien PADMA belum
punya teks apa pun dan menyerahkan penyusunannya kepada kita: "soal keamanan data
dll lah intinya terms conditions pada umumnya".

> **Teks hukum di bawah ini adalah DRAF teknis, bukan nasihat hukum.** Ia disusun
> supaya akurat terhadap sistem yang sebenarnya. Sebelum tayang di produksi, teksnya
> **wajib dibaca konsultan hukum dan disetujui klien** (lihat "Prasyarat rilis").

## Masalah

PADMA sudah live sejak ~21 September 2026 dan mengumpulkan data kesehatan, tetapi
tidak punya halaman Syarat & Ketentuan, tidak punya Kebijakan Privasi, dan tidak
meminta persetujuan apa pun di mana pun:

- **Skrining menyimpan data pribadi spesifik** (UU No. 27/2022 tentang Pelindungan
  Data Pribadi): perdarahan, kehamilan risiko tinggi, tanda DVT, bahkan pikiran
  menyakiti diri atau bayi (`pp_mental`, `src/lib/skrining/bank-soal.ts`), plus usia
  kehamilan. Siapa pun bisa mengisinya tanpa akun lewat `/api/skrining`.
- **Form daftar tidak punya centang persetujuan**, dan akun juga bisa lahir lewat
  Google (dari `/masuk` maupun `/daftar`) serta undangan admin (`/aktivasi`).
- **Kebijakan pembatalan klien tidak tampil di UI mana pun.** Ia hanya hidup di
  `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md`.
- **Produk digital tidak punya teks lisensi.** Satu-satunya kalimat yang tampil:
  "dikirim seketika sesudah pembayaran dan tidak dapat dikembalikan".
- Midtrans (verifikasi merchant) dan Google (layar persetujuan OAuth yang
  dipublikasikan) sama-sama meminta URL dokumen-dokumen ini.

## Keputusan yang sudah diambil

| Pertanyaan | Keputusan |
|---|---|
| Sumber teks | **Kita yang menyusun**, dari fakta sistem dan keputusan klien yang sudah tercatat. Bukan templat |
| Bentuk persetujuan | **Centang wajib yang tercatat** (bukan sekadar kalimat pemberitahuan) |
| Mekanisme | **Pendekatan A**: centang di tempat data dikumpulkan (skrining, daftar) + **satu gerbang** di `/passport` untuk semua jalur akun lainnya |
| Identitas penyelenggara | **"PADMA Wellness"**, tanpa badan usaha |
| Saluran permintaan data pribadi | **WhatsApp admin**, dibaca dari `/admin/pengaturan` lewat `bacaPengaturan()` |
| Janji penghapusan | **Riwayat disimpan, permintaan hapus ditinjau per kasus.** Jujur terhadap pagar DB ("klinik tidak mengenal hapus rekam medis", `20260829150000_pengerasan_admin.sql`). Tidak ada anonimisasi atau hapus total |
| Basis branch | **`development`**. Dokumen mencakup produk digital, Midtrans, dan keranjang sejak awal |
| Jumlah dokumen dan versi | **Dua halaman, SATU nomor versi.** Klien menyetujui keduanya sekaligus; revisi salah satunya = setuju ulang |
| Tempat teks | **TSX di repo**, bukan isian panel admin. Mengubah teks hukum harus sekaligus menaikkan versi, dan itu pekerjaan pengembang |

### Dua revisi terhadap desain yang disetujui di percakapan

1. **Trigger `screenings` dibatalkan, diganti uji struktural.** Bagian 2 menyetujui
   trigger BEFORE INSERT yang menolak skrining tanpa persetujuan. Saat diperiksa,
   sekitar 19 berkas uji ber-DB menyisipkan baris `screenings` langsung, dan semuanya
   akan patah, sementara Docker mati sehingga perbaikannya tidak bisa diverifikasi.
   Penggantinya: (a) kedua rute memakai SATU skema (`SkemaSkriningPublik`) dan SATU
   fungsi pencap (`capPersetujuanSkrining()`), sehingga aturannya tetap hidup di satu
   tempat; (b) uji struktural memindai `src/` dan menuntut setiap
   `.from("screenings").insert(` memakai fungsi pencap itu. Jalur ketiga di masa depan
   tetap tertangkap, di CI, tanpa menyentuh fixture.
2. **Checkout menjawab `403`, bukan `409`.** `/api/pesanan/checkout` sudah memakai
   `409` untuk dua keadaan lain (pesanan terbuka, gagal membuat pesanan). Kode
   tersendiri mencegah tombol beli salah membaca.

## Dokumen

### Konstanta versi

`src/lib/persetujuan/versi.ts`:

```ts
/** Tanggal berlaku S&K + Kebijakan Privasi. Menaikkannya = semua klien setuju ulang. */
export const VERSI_DOKUMEN = "2026-10-06";
```

Formatnya `YYYY-MM-DD`. Kedua halaman menampilkannya sebagai "Berlaku sejak
6 Oktober 2026". **Nilainya diisi ulang dengan tanggal final saat rilis** (lihat
Prasyarat rilis). Mengganti nilai sebelum rilis tidak berefek apa pun, karena
produksi belum punya satu pun catatan persetujuan.

Versi **selalu dicap oleh server** dari konstanta ini. Peramban tidak pernah
mengirim nomor versi yang dipercaya.

### Bentuk halaman

- `/syarat-ketentuan` dan `/kebijakan-privasi`, masing-masing `page.tsx` dengan
  `SitusShell` + `Wadah`, seperti `/tentang`. `revalidate = 300` karena nomor
  WhatsApp di bagian kontak dibaca dari pengaturan.
  Tautannya `wa.me/<nomor>` **polos**, bukan `tautanWaSitus`, yang mengisi pesan "saya dari
  WEBSITE… tanya kelas serta pricelist" — salah untuk permintaan data pribadi.
- Prosa yang nyaman dibaca: lebar teks ~70 karakter, judul bagian bernomor.
- Kepala halaman: judul, "Berlaku sejak <tanggal>", daftar isi bertaut jangkar.
- Setiap bagian punya `id` stabil (misalnya `#data-kesehatan`, `#pembatalan`,
  `#hak-anda`). Daftar id diekspor dari satu berkas supaya `/persetujuan` dan uji
  memakai daftar yang sama.
- **Tidak masuk menu header.** `HalamanSitus` tidak berubah.
- Footer: dua tautan di **baris bawah**, sebaris dengan WhatsApp, alamat, dan jam,
  bukan di grid `TAUTAN_FOOTER`.

### Syarat & Ketentuan: isi wajib per bagian

Setiap butir di bawah adalah fakta yang HARUS tertulis. Prosa penghubungnya bebas,
faktanya tidak.

1. **Penerimaan.** Persetujuan diberikan dengan mencentang kotak di formulir daftar,
   skrining, atau layar persetujuan. Versi dan tanggal berlaku tercantum.
2. **Tentang layanan.** PADMA adalah layanan wellness dan edukasi, **bukan layanan
   medis, diagnosis, atau terapi**. Bila diperlukan asesmen individual, diagnosis,
   atau terapi medis, PADMA mengarahkan klien ke tenaga medis yang sesuai (kalimat
   yang sudah tampil di `src/app/tentang/page.tsx`). Keadaan darurat: hubungi **119**.
3. **Akun dan Digital Passport.**
   - Data yang diisi harus benar.
   - Klien menjaga kerahasiaan kata sandinya.
   - Satu akun untuk satu orang.
   - Pengguna berusia minimal **18 tahun** (*asumsi*, lihat Pertanyaan terbuka).
4. **Skrining.**
   - Skrining wajib diisi sebelum memesan, dan harus diisi jujur sesuai kondisi saat
     itu.
   - Hasilnya **pra-skrining, bukan izin medis**; tim PADMA memverifikasi kondisi
     sebelum layanan.
   - PADMA berhak menunda atau menolak layanan bila ada tanda bahaya.
5. **Pemesanan dan kunjungan.**
   - Area layanan: nilai `alamat_klinik` dari pengaturan (cadangannya "Melayani
     Malang Raya dan Batu").
   - Biaya transport mengikuti alamat kunjungan.
   - Jadwal dikonfirmasi admin, dan bidan/mitra ditugaskan oleh PADMA.
6. **Pembayaran.**
   - Sesi dibayar lewat QRIS dengan mengunggah bukti. Produk digital dibayar lewat
     Midtrans.
   - Tenggat **24 jam** sejak tagihan terbit; lewat dari itu, pengajuan batal dan
     slotnya dilepas (`src/app/passport/bayar/[id]/page.tsx`).
   - Pesanan produk digital kedaluwarsa dalam 24 jam bila tidak dibayar.
7. **Pembatalan dan jadwal ulang.** **Disalin utuh** dari
   `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md`, keempat jenjangnya
   plus pengecualian darurat medis, **tidak diringkas dari ingatan**:

   | # | Keadaan | Yang berlaku |
   |---|---|---|
   | 1 | **≥ 24 jam** sebelum sesi | **Refund 100%** ATAU **reschedule gratis** |
   | 2 | **2–24 jam** sebelum sesi | **Reschedule gratis 1×.** Bila memilih batal: dana menjadi **kredit layanan, berlaku 30 hari** |
   | 3 | **< 2 jam**, ATAU **mitra sudah berangkat**, ATAU **no-show** | **Dana tidak dapat dikembalikan.** Jadwal ulang dihitung sebagai **pemesanan baru** |
   | 4 | **PADMA** yang membatalkan | **Refund 100%** ATAU **reschedule prioritas tanpa biaya tambahan** |

   - **Darurat medis:** persalinan dan rawat inap **ditinjau** untuk reschedule tanpa
     penalti.
   - Ditambah keputusan pemilik yang tercatat di spec C3
     (`2026-09-09-padma-c3-pembatalan-design.md`):
     - jatah reschedule gratis adalah **1× per pemesanan**; sesudah habis, permintaan
       berikutnya di jendela 2–24 jam diperlakukan sebagai pembatalan (kredit 30 hari);
     - kredit berupa **hak satu sesi untuk layanan yang sama**, tidak bisa dipindah ke
       layanan lain;
     - kredit **berlaku sampai tanggal sesi yang batal + 30 hari**;
     - waktu dihitung dalam **WIB**.
   - Refund dikirim lewat **transfer manual oleh admin**. **Tidak ada janji lama
     proses** (lihat Pertanyaan terbuka).
8. **Produk digital.**
   - Lisensi pribadi; dilarang membagikan, menggandakan untuk orang lain, atau menjual
     ulang.
   - Halaman PDF yang dibaca daring ditandai nama dan PADMA ID; berkas PDF yang
     diunduh dicap nama dan email pembeli di setiap halaman.
   - Dikirim seketika sesudah pembayaran dan **tidak dapat dikembalikan** (kalimat yang
     sudah tampil di UI).
   - Akses dapat dicabut bila ketentuan ini dilanggar.
   - Kendala teknis dilaporkan ke WhatsApp admin.
9. **Testimoni.** Hanya ditayangkan dengan izin pemiliknya.
10. **Batasan tanggung jawab.** Sebatas yang diizinkan hukum. PADMA tidak bertanggung
    jawab atas akibat dari informasi skrining atau kondisi yang tidak diungkapkan dengan
    benar, maupun atas pemakaian materi edukasi sebagai pengganti nasihat dokter atau
    bidan.
11. **Perubahan ketentuan.** Versi baru diumumkan di halaman ini, dan klien diminta
    menyetujui ulang sebelum memakai Passport lagi.
12. **Hukum yang berlaku dan kontak.** Hukum Republik Indonesia; perselisihan
    diselesaikan lebih dulu secara musyawarah. Kontak: WhatsApp admin.

### Kebijakan Privasi: isi wajib per bagian

Sumber fakta: inventaris data 6 Oktober 2026 (berkas dan baris dirujuk di bawah).
**Jangan menambahkan janji yang tidak dijalankan sistem.**

1. **Pengendali data.** PADMA Wellness.
2. **Data yang dikumpulkan:**
   - Akun: nama, email, nomor WhatsApp, kata sandi (tersimpan dalam bentuk hash), atau
     identitas Google (nama, email, foto profil).
   - Alamat kunjungan dan titik koordinatnya.
   - **Data kesehatan dari skrining. Disebut terang sebagai data pribadi spesifik:**
     jawaban ya/tidak atas pertanyaan keselamatan, termasuk **kesehatan mental**; fase
     (hamil, nifas, dan seterusnya); usia kehamilan; hasil hijau/merah.
   - Catatan dan rekomendasi sesi yang ditulis tim PADMA.
   - Penilaian dan komentar klien atas sesi.
   - **Bukti pembayaran: gambar yang bisa memuat nama pemilik rekening, nomor
     rekening, dan saldo.** Sarankan klien menutup saldo sebelum mengunggah.
   - Riwayat pesanan dan pembayaran: kanal bayar dan nomor transaksi dari Midtrans.
     **PADMA tidak menerima nomor kartu**, karena pembayaran dimasukkan langsung ke
     Midtrans.
   - Pembelian produk digital: nama dan email tercetak di berkas.
   - Testimoni: nama, keterangan, kutipan, video; hanya dengan izin.
   - Data teknis: cookie sesi; alamat IP diproses sesaat untuk membatasi percobaan
     berulang dan **tidak disimpan** oleh aplikasi.
   - **Data bayi tidak dikumpulkan.** Tidak ada nama atau tanggal lahir bayi.
3. **Tujuan dan dasar pemrosesan:**
   - Menilai kelayakan dan keselamatan layanan (persetujuan eksplisit).
   - Menjadwalkan dan menjalankan kunjungan (pelaksanaan perjanjian).
   - Memproses pembayaran dan mencatat transaksi (pelaksanaan perjanjian, kewajiban
     hukum).
   - Menghubungi klien soal layanannya.
   - **Bukan untuk iklan dan tidak dijual.**
4. **Siapa yang melihat:**
   - Admin dan owner PADMA.
   - Bidan/mitra yang ditugaskan, **sebatas yang diperlukan untuk kunjungan**. Mitra
     tidak punya akun di aplikasi.
5. **Pemroses pihak ketiga**, masing-masing dengan gunanya:

   | Pihak | Guna |
   |---|---|
   | Supabase | Basis data, autentikasi, penyimpanan berkas |
   | Vercel | Hosting aplikasi |
   | Cloudflare R2 | Video materi, produk, dan testimoni |
   | Resend | Email sistem dan tagihan |
   | Google | Masuk dengan Google |
   | Midtrans | Pembayaran produk digital |
   | OpenStreetMap / Nominatim | Mengubah teks alamat menjadi koordinat |

   **Transfer ke luar Indonesia:** sebagian pemroses menyimpan atau memproses data di
   luar Indonesia (Supabase di Singapura; region pastinya dikonfirmasi saat rilis, lihat
   Prasyarat rilis).
6. **WhatsApp.**
   - Tombol WhatsApp di skrining dan pemesanan membuka pesan yang **sudah terisi
     ringkasan, termasuk hasil skrining HIJAU/MERAH**
     (`src/app/skrining/wizard.tsx`). Pesan itu dikirim lewat layanan WhatsApp milik
     Meta, dan klien boleh menyuntingnya sebelum mengirim.
   - Admin juga mengirim undangan dan tagihan lewat WhatsApp.
7. **Keamanan.** Hanya yang benar hari ini:
   - koneksi terenkripsi (HTTPS);
   - akses dibatasi menurut peran;
   - aturan akses di tingkat basis data, sehingga klien hanya bisa membaca datanya
     sendiri;
   - penyimpanan berkas privat;
   - tautan unduh berbatas waktu.

   **Tidak menyebut backup**, karena jadwal backup otomatis masih dimatikan
   (`.github/workflows/backup-db.yml`).
8. **Penyimpanan dan penghapusan.**
   - Riwayat layanan, skrining, dan transaksi disimpan untuk keselamatan layanan
     lanjutan dan kewajiban pembukuan.
   - Permintaan penghapusan **ditinjau per kasus** oleh admin. Data yang tidak wajib
     disimpan dihapus.
   - Klien bisa membetulkan sendiri nama, nomor WhatsApp, dan alamat di Profil
     Passport.
9. **Hak Anda (UU PDP):**
   - mendapat informasi;
   - mengakses dan mendapat salinan;
   - membetulkan;
   - meminta penghapusan (ditinjau);
   - **menarik persetujuan.** Konsekuensinya: layanan yang membutuhkan data tersebut
     tidak dapat dilanjutkan.
   - mengajukan keberatan.

   Semua diajukan lewat WhatsApp admin dan **ditanggapi paling lambat 3×24 jam**
   (*asumsi*, lihat Pertanyaan terbuka).
10. **Cookie.**
    - Hanya cookie yang diperlukan: sesi masuk, penanda klaim skrining (2 jam),
      undangan (1 jam), tujuan setelah masuk (1 jam), dan penanda persetujuan
      (1 hari, baru).
    - **Tanpa analitik dan tanpa pelacak.**
    - Midtrans dapat memasang cookie-nya sendiri saat halaman pembayaran terbuka.
11. **Kebocoran data.** Bila terjadi, klien yang terdampak diberi tahu paling lambat
    3×24 jam (*asumsi*).
12. **Perubahan kebijakan dan kontak.** Sama dengan S&K §11–12.

## Data

Satu migrasi: `supabase/migrations/20261006120000_persetujuan_dokumen.sql`. Cap
waktunya **bukan** `…100000`, karena `feat/p4-rekap-penjualan` sudah memakai
`20261006100000_pesanan_item_produk_id.sql`.

### `persetujuan_akun`

```sql
create table public.persetujuan_akun (
  user_id        uuid        not null,
  versi          text        not null check (versi ~ '^\d{4}-\d{2}-\d{2}$'),
  jalur          text        not null check (jalur in ('daftar', 'gerbang')),
  disetujui_pada timestamptz not null default now(),
  primary key (user_id, versi)
);
```

- **Append-only.** `authenticated` hanya mendapat `select` dan `insert`, dengan policy
  `user_id = auth.uid()` untuk keduanya. **Nol `update`/`delete`** untuk semua peran
  non-service, dan **nol hak bagi `anon`**.
- **Tanpa FK ke `auth.users`**, seperti tabel `jejak_*`. Ini bukti persetujuan dan
  harus tetap ada apa pun yang terjadi pada akunnya.
- **Ditulis dengan sesi klien itu sendiri, bukan service role**, karena persetujuan
  memang tindakan klien. Klien yang memalsukan barisnya sendiri lewat API sama dengan
  menyetujui. Primary key tanpa kolom identitas, jadi tidak ada hak sequence yang
  perlu dibuka.
- Insert memakai `on conflict do nothing`. Cookie daftar dan gerbang bisa mencatat
  versi yang sama dua kali, dan itu bukan kesalahan.

### `screenings`: dua kolom

```sql
alter table public.screenings
  add column persetujuan_versi text,
  add column persetujuan_pada  timestamptz;
```

Nullable. Baris lama tetap `null`, dan itu jujur karena datanya terkumpul sebelum
kebijakan ada. Penegakan untuk baris baru: lihat revisi 1 di atas.

## Kode

### Satu modul: `src/lib/persetujuan/`

| Berkas | Isi |
|---|---|
| `versi.ts` | `VERSI_DOKUMEN`, format tanggal tampilan |
| `bagian.ts` | Daftar `id` jangkar kedua dokumen, dipakai halaman, `/persetujuan`, dan uji |
| `catat.ts` | `catatPersetujuan(supabase, userId, jalur)`: SATU-SATUNYA penulis `persetujuan_akun`. Selalu mencap `VERSI_DOKUMEN` |
| `status.ts` | `statusPersetujuan(userId)` → `{ sudahSetuju, pernahSetuju }`, dibungkus `cache()`. SATU pembaca untuk layout passport, `/persetujuan`, DAN checkout. **Gagal-terbuka**: galat baca dicatat lalu dianggap sudah setuju, supaya migrasi yang terlambat diterapkan tidak mengunci seluruh Passport |
| `skrining.ts` | `capPersetujuanSkrining()` mengembalikan `{ persetujuan_versi, persetujuan_pada }` |
| `cookie.ts` | `COOKIE_SETUJU = "padma_setuju"`, umur 1 hari |
| `tujuan.ts` | `tujuanPersetujuanAman(lanjut)`: whitelist `lanjut`, membungkus `tujuanProdukAman` |

### Alur per pintu

| Pintu | Perubahan |
|---|---|
| `SkemaSkriningPublik` | Bidang baru `setuju_privasi: z.literal(true)` |
| `/api/skrining` dan `/api/skrining/akun` | `...capPersetujuanSkrining()` di insert. Tanpa centang, skema menolak dengan 400 |
| `src/app/daftar/form-daftar.tsx` | Centang wajib. Tombol email dan Google nonaktif sampai dicentang. Tepat sebelum `signUp` / `signInWithOAuth`, JS memasang cookie `padma_setuju=<VERSI_DOKUMEN>` |
| `src/app/setelah-masuk/route.ts` | Sesudah cabang owner/admin, bila cookie = `VERSI_DOKUMEN` → `catatPersetujuan(..., "daftar")`. Cookie selalu dihapus. **Gagal mencatat tidak pernah menggagalkan login** (pola klaim skrining). Bila cookie hilang (misalnya email dikonfirmasi di perangkat lain), gerbang yang menangkap |
| `src/app/passport/layout.tsx` | Sesudah `ambilKlien()`: `if (!(await statusPersetujuan(userId)).sudahSetuju) redirect("/persetujuan")`. `requireRole` tetap dipanggil tepat sekali (`tests/access-matrix-layouts.test.ts`) |
| `src/app/api/pesanan/checkout/route.ts` | Sesudah cek login: belum setuju → `403 { kode: "perlu_persetujuan" }` |
| `src/app/produk/[slug]/tombol-beli.tsx` | `403` + `perlu_persetujuan` → `/persetujuan?lanjut=/produk/<slug>`, sejajar dengan penanganan `401` → masuk yang sudah ada |
| `src/proxy.ts` | `/persetujuan` ditambahkan ke `PROTECTED_PREFIXES` |
| `src/app/persetujuan/` | Halaman baru + server action (lihat Layar) |

### `tujuanPersetujuanAman`

`tujuanProdukAman(lanjut) ?? "/passport"`. Tidak ada pola baru.

- `tujuanProdukAman` (`src/lib/auth/tujuan-produk.ts`) sudah berupa regex ketat
  `^/produk/<slug>$` dengan batas 120 karakter, dan **dipakai ulang, tidak disalin**.
- Satu-satunya pemberi `lanjut` adalah tombol beli. Layout passport tidak tahu path
  asalnya, sehingga klien yang tertahan di sana kembali ke `/passport`. Deep link yang
  hilang di sini bisa diterima: gerbang hanya muncul sekali per versi.

### Yang sengaja tidak ikut

- **Admin dan owner tidak melewati gerbang.** Dokumen ini untuk klien.
- **Gerbang adalah pencatat persetujuan, bukan batas keamanan.** Rute API lain di
  bawah `/passport` tidak dipasangi pemeriksaan. Checkout dikecualikan karena ia
  satu-satunya pintu transaksi yang bisa dicapai **tanpa pernah membuka `/passport`**
  (tombol beli di `/produk/[slug]`).
- **Layar admin untuk melihat siapa sudah setuju.** Tidak dibuat (YAGNI). Owner bisa
  membaca tabelnya langsung.
- **`/masuk` tidak berubah.** Pengguna Google baru dari sana ditangkap gerbang.

## Layar

### `/syarat-ketentuan`, `/kebijakan-privasi`

Lihat "Bentuk halaman" di atas.

### Footer

Baris bawah, sesudah jam operasional:
`· Syarat & Ketentuan · Kebijakan Privasi`.

### Wizard skrining, layar pembuka

- Centang kedua, **terpisah** dari centang "jujur" yang sudah ada:

  > Saya menyetujui PADMA memproses data kesehatan yang saya isi di skrining ini
  > untuk menilai kelayakan layanan, sesuai [Kebijakan Privasi].

- `bolehMulai` mensyaratkan kedua centang.
- Wizard mengirim otomatis begitu pertanyaan terakhir dijawab atau saat ada jawaban
  "ya" yang mendesak. Tidak ada tombol kirim di akhir, jadi centang ini harus ada di
  layar pembuka, **sebelum pertanyaan kesehatan pertama**.
- Tautan dibuka di tab baru supaya isian tidak hilang.
- Berlaku untuk `/skrining` dan `/passport/skrining` (komponen yang sama).

### `/daftar`

Centang di atas tombol:

> Saya menyetujui [Syarat & Ketentuan] dan [Kebijakan Privasi].

Tautan dibuka di tab baru.

### `/persetujuan`

- Memakai `PanggungAuth`, seperti `/daftar`. Hanya untuk peran klien.
- Judul: "Satu langkah sebelum lanjut".
- Kalimat pembuka dibedakan dari ada tidaknya persetujuan versi lama:
  - "Kami memperbarui Syarat & Ketentuan dan Kebijakan Privasi…"
  - "Sebelum memakai Digital Passport…"
- Tiga butir ringkas, masing-masing bertaut ke jangkar dokumen:
  - data kesehatan;
  - pihak ketiga dan transfer ke luar negeri;
  - hak Anda.
- Satu centang, tombol "Setuju & lanjutkan", dan **jalan keluar** lewat
  form `POST /auth/keluar`, supaya klien yang tidak setuju tidak terkunci. `TombolKeluar` tidak dipakai
  karena ia `sm:hidden` (dirancang untuk Profil Passport).
- Server action: `catatPersetujuan(..., "gerbang")`, lalu redirect ke
  `tujuanPersetujuanAman(lanjut)`.
- Klien yang sudah setuju lalu membuka `/persetujuan` langsung diteruskan ke tujuan.

## Pengujian

Setiap uji penjaga **dibuktikan bisa merah dulu** (pelajaran P1: dua kali uji
ternyata tidak menguji apa pun).

### Unit (vitest, tanpa DB): jalan sekarang

- **Skema skrining.** Menolak tanpa `setuju_privasi` dan menolak `setuju_privasi: false`.
- **Kedua rute skrining:**
  - 400 tanpa centang;
  - insert membawa `VERSI_DOKUMEN`;
  - `persetujuan_versi` palsu di body diabaikan.
- **Uji struktural.** Setiap `.from("screenings").insert(` di `src/` memakai
  `capPersetujuanSkrining`.
- **`/setelah-masuk`:**
  - mencatat hanya bila cookie = versi berlaku dan peran klien;
  - cookie berversi lama tidak dicatat;
  - cookie selalu dihapus;
  - insert gagal → login tetap berlanjut.
- **Layout passport.** Belum setuju → redirect `/persetujuan`.
  `access-matrix-layouts` tetap hijau.
- **Checkout.** Belum setuju → `403 perlu_persetujuan`. Tombol beli mengarah ke
  `/persetujuan?lanjut=/produk/<slug>`.
- **`tujuanPersetujuanAman`.** `//evil.com`, `https://evil.com`, `/\evil`, `/admin`,
  dan `/produk/../admin` semuanya menjadi `/passport`. `/produk/abc` diterima apa
  adanya.
- **Server action `/persetujuan`.** Jalur `gerbang`, versi dari konstanta.
- **Form daftar dan wizard.** Tombol nonaktif sampai dicentang; cookie/body terisi.
- **Penjaga isi:**
  - setiap jangkar yang ditautkan `/persetujuan` ada di halaman dokumennya;
  - bagian pembatalan memuat "24 jam", "2 jam", "30 hari", "1×", "119";
  - footer memuat kedua tautan;
  - kedua halaman menampilkan tanggal dari `VERSI_DOKUMEN`.

### Ber-DB: butuh Docker + Supabase lokal

Docker mati per 6 Oktober. Koordinasikan sebelum menjalankan
(`padma-supabase-lokal-bersama`).

- `persetujuan_akun`:
  - klien A tidak bisa membaca atau menyisipkan baris milik B;
  - `update`/`delete` ditolak;
  - `anon` nol hak;
  - format versi dan nilai jalur ditolak bila salah.
- `grant-anon.test.ts` dan `struktur-rls.test.ts` diperbarui untuk tabel baru.

### E2E yang pasti patah

- `daftar-mandiri`: perlu mencentang.
- `funnel-skrining`: perlu centang kedua.
- `passport`: fixture klien perlu baris persetujuan.

Ditambah satu skenario baru: klien tanpa persetujuan → gerbang → setuju → kembali ke
tujuan.

## Prasyarat rilis

1. **Teks dibaca konsultan hukum dan disetujui klien PADMA.** Sesudah itu
   `VERSI_DOKUMEN` diisi tanggal final. Sebelum langkah ini, branch boleh di-merge ke
   `development`, **jangan dirilis**.
2. **Konfirmasi region Supabase produksi** di dasbor. Spec deploy memilih Singapura
   (`ap-southeast-1`), tetapi spec backup masih menyebut Seoul. Teks §5 Kebijakan
   Privasi mengikuti region yang sebenarnya.
3. Migrasi `20261006120000_persetujuan_dokumen.sql` diterapkan **secara sengaja**
   bersama migrasi `development` lain yang belum ada di produksi. **Bukan `db push`.**
4. **Beri tahu klien PADMA sebelum deploy.** Semua klien produksi akan bertemu gerbang
   sekali, dan admin perlu siap menjawab pertanyaannya di WhatsApp.
5. Sesudah tayang, kedua URL didaftarkan di:
   - verifikasi merchant Midtrans;
   - layar persetujuan OAuth Google (salah satu penghalang login Google, lihat
     `padma-google-oauth-hosted`).

## Pertanyaan terbuka

Ditulis supaya kesenyapan tidak dibaca sebagai jawaban. Ketiganya untuk konsultan
hukum dan klien:

1. **Lama proses refund.** Teks sekarang hanya "transfer manual oleh admin", tanpa
   janji waktu. Midtrans mungkin meminta angka.
2. **Usia minimal 18 tahun.** Asumsi. Klien hamil di bawah 18 tahun mungkin ada;
   apakah cukup "didampingi wali"?
3. **Batas tanggap 3×24 jam** untuk permintaan data dan pemberitahuan kebocoran.
   Diambil dari UU PDP. Pastikan admin sanggup memenuhinya.

## Di luar cakupan

- Fitur hapus akun, anonimisasi, atau unduh data mandiri.
- Menyalakan backup otomatis.
- Layar admin untuk riwayat persetujuan.
- Menyembunyikan hasil skrining dari pesan WhatsApp yang terisi otomatis. Pesan itu
  kini **diungkapkan** di Kebijakan Privasi; mengubah isinya adalah keputusan
  terpisah.
