# Panel Staf PADMA — Pola Daftar & Formulir

**Tanggal:** 7 September 2026
**Pendahulu:** `docs/superpowers/specs/2026-09-05-padma-panel-admin-ui-design.md` (kerangka panel).
Rencana 1 (kerangka) dan 2 (dashboard) sudah ter-merge; spec ini menggantikan **langkah 7–9** spec
itu dan memperluasnya.

## Masalah

Klien membuka panel dan berkata: bagian daftar dan formulirnya membingungkan, tidak seperti admin
panel pada umumnya. Penyisiran menemukan empat sebab yang berdiri sendiri-sendiri:

1. **Formulir hidup di dalam sel tabel.** Menekan "Ubah" mengubah kolom aksi menjadi formulir
   bertumpuk vertikal di dalam satu sel sempit. Baris memuai, kolom lain melenceng, dan pada tabel
   panjang mata kehilangan baris mana yang sedang diubah. Terjadi di enam modul: klien, mitra,
   layanan, varian, materi, sesi.
2. **Tidak ada pencarian, saringan, pengurutan, atau paginasi — nol, di seluruh panel.**
   Penyisiran `grep` tidak menemukan satu pun kotak cari. Menemukan satu baris berarti memindai
   seluruh daftar dengan mata.
3. **Tombol "baru" hidup di header halaman** dan terbuka sebagai kartu bergaris putus-putus yang
   mendorong seluruh isi halaman ke bawah.
4. **Tiap modul berpola beda.** Klien punya halaman detail (`/admin/klien/[id]`); mitra, layanan,
   dan materi tidak.

Ditambah satu temuan yang tidak diadukan tetapi berakar sama: **setiap halaman membuka diri dengan
paragraf penjelasan empat baris.** Berguna di hari pertama, kebisingan di hari ketiga puluh — dan
panel ini dibuka setiap hari.

## Keputusan

### K1 — Dua pola, dipisah oleh "apakah objeknya memiliki daftar anak"

Jumlah medan **tidak** dipakai sebagai batas. Diukur, keenam formulir terlalu mirip untuk memisah:
mitra 6, materi 7, sesi 8, klien 9, varian 10, layanan 11. Batas berbasis ukuran akan bergeser
setiap kali satu medan ditambahkan, dan enam bulan lagi tidak ada yang ingat alasannya.

Batasnya: **objek yang hanya punya medan** mendapat panel geser; **objek yang memiliki daftar lain
di dalamnya** mendapat halaman detail.

| Pola | Modul | Alasan |
|---|---|---|
| **Panel geser dari kanan** | Mitra, Sesi, Varian | Tidak ada apa pun yang bisa dibuka lebih dalam. Daftar tetap terlihat, jadi admin bisa mengubah beberapa baris berturut-turut tanpa bolak-balik halaman — cara kerja hariannya. |
| **Halaman detail** | Klien, Layanan, Materi | Klien memuat riwayat sesi, paket, dan akses materi; Layanan memuat varian; Materi memuat penugasan akses per klien. Daftar di dalam panel geser mengulangi kesalahan yang sama seperti formulir di dalam sel tabel. |

Klien sudah memakai pola detail hari ini — ia diikuti, bukan dibuat baru.

Varian adalah anak dari layanan, sehingga panel gesernya terbuka **di dalam** halaman detail
layanan. Itu disengaja dan sah: yang menentukan pola adalah sifat objeknya sendiri, bukan
kedalamannya di pohon.

**Bayar dan Skrining tidak masuk tabel di atas, dan itu bukan kelalaian.** Keduanya daftar yang
hanya punya AKSI (tandai lunas, tolak klaim, tandai ditindaklanjuti) — tidak ada formulir ubah yang
perlu dipindahkan ke mana pun. Keduanya tetap mendapat bilah daftar K3 dan paginasi K4, tetapi
tidak mendapat panel geser maupun halaman detail. **Pengaturan** juga di luar tabel: ia satu
formulir setelan, bukan daftar, jadi tidak mendapat bilah daftar sama sekali.

### K2 — Keadaan daftar DAN panel geser hidup di alamat halaman

Saringan, pencarian, halaman, dan identitas baris yang sedang diubah semuanya parameter URL:

```
/admin/sesi?cari=ananda&status=selesai&jenjang=kosong&hal=2
/admin/mitra?ubah=<id>
```

Empat akibat, dan keempatnya alasan keputusan ini:

- **Panel geser dirender di server** dengan datanya sudah lengkap. Tidak ada pengambilan data kedua
  saat panel terbuka, dan tidak ada fungsi yang perlu dioper dari server component ke client
  component — batasan App Router yang sudah dua kali menggigit proyek ini.
- **Isinya bisa diuji dengan `renderToStaticMarkup`**, satu-satunya perkakas render yang dimiliki
  suite ini. Proyek ini berjalan di `environment: "node"` tanpa jsdom maupun testing-library, dan
  "tanpa dependensi baru" mengikat sejak rencana 1. Panel yang digerakkan state klien isinya tidak
  bisa diuji sama sekali tanpa menambah dua pustaka.
- **Tombol kembali browser menutup panel**, sesuai harapan orang.
- **StatTile bisa menaut ke daftar yang sudah tersaring.** Ini menutup utang nomor 1 runbook
  transport: antrean "Sesi selesai tanpa jenjang" hari ini hanya memberi ANGKA lalu meninggalkan
  admin memindai ratusan baris untuk menemukan tiga sesi yang dimaksud.

### K3 — Satu bilah daftar yang sama di setiap halaman

Susunannya, kiri ke kanan, dalam satu baris: kotak cari → chip saringan → jumlah hasil →
tombol "+ baru" di ujung kanan.

Tombol "+ baru" membuka panel geser kosong (modul pola A) atau menuju halaman baru (modul pola B).
Ia tidak pernah lagi menjadi kartu yang mendorong isi halaman ke bawah.

Saringan per daftar:

| Daftar | Saringan |
|---|---|
| Sesi | status (terjadwal/selesai/batal) · jenjang kosong · rentang tanggal |
| Klien | aktif / belum aktivasi · punya paket berjalan |
| Mitra | aktif / nonaktif |
| Bayar | status bayar (belum / menunggu verifikasi / lunas) |
| Skrining | sudah ditindaklanjuti / belum |
| Layanan, Materi | aktif / nonaktif — daftarnya pendek, pencarian sudah cukup |

### K4 — Paginasi dikerjakan sekarang, bukan dicatat sebagai utang ketiga kalinya

`supabase/config.toml` menyetel `max_rows = 1000`: PostgREST memotong bacaan tanpa `.limit()` di
angka itu **secara senyap** — tanpa error, tanpa tanda. Ini sudah dicatat sebagai utang di dua
rencana berturut-turut (`harga_publik` di rencana varian, `ambilSesiMenungguTarif()` di rencana
transport) dan belum pernah ditutup.

Paginasi server-side lewat `.range()` menutupnya untuk seluruh daftar sekaligus, dan pola
`.range()`-nya sudah ada di `lib/owner/data.ts` untuk ditiru.

### K5 — Penjelasan pindah ke tombol bantuan

Header menjadi judul + jumlah data. Paragraf penjelasannya tidak dibuang — ia pindah ke tombol "?"
yang membuka isinya saat diminta. Teksnya sendiri dipertahankan apa adanya: sebagian memuat
pembedaan yang pernah hilang dan mahal (mis. "nonaktif" tidak berarti nama mitra lenyap dari
riwayat).

### K6 — Primitif baru buta peran, tinggal di `_shell/panel/`

Bilah daftar, panel geser, dan paginasi menjadi primitif bersama di
`web/src/app/_shell/panel/`, sejajar `Kartu`, `Tabel`, `StatTile` yang sudah ada.

Aturan yang sudah mengikat sejak rencana 1 tetap berlaku dan tidak dilonggarkan: **primitif WAJIB
buta peran.** Daftar menu tetap milik shell masing-masing panel, dan pemisahan money firewall
PADMA tetap FISIK — tidak ada satu pun kondisional peran di dalam primitif.

`pasangPenutup()` (`_shell/panel/tutup-drawer.ts`) sudah ada dari rencana 1, lengkap dengan tipe
`DokumenMinimal` supaya bisa diuji dengan dokumen palsu tanpa jsdom. Panel geser memakainya, bukan
membuat penangan Escape kedua.

### K7 — Panel owner ikut

`/owner/rekap`, `/owner/tarif`, `/owner/transport` memakai pola dan primitif yang sama.

### K8 — Logo ditunda sampai asetnya ada

Logo di halaman Masuk & Aktivasi plus favicon adalah bagian sah langkah 8 spec pendahulu, tetapi
asetnya belum ada: yang di repo hanya `web/public/logo-padma.jpg` — raster 1254px berlatar hijau
bertekstur, tidak bisa dipakai di sidebar maupun untuk cetak.

**Yang harus diminta ke klien: logo versi vektor (SVG/AI/PDF) DAN versi berlatar transparan.**
Sampai itu datang, bagian ini di luar ruang lingkup. Mengerjakannya dengan aset yang ada berarti
mengerjakannya dua kali.

## Konsekuensi yang sudah diketahui

**Delapan skrip E2E akan merah dan harus ditulis ulang.** Semuanya menargetkan susunan lama —
tombol di header, formulir di dalam sel tabel. Ini bagian dari pekerjaan, bukan kejutan di akhir.

**Ada dua pola, bukan satu.** Admin perlu tahu keduanya. Layanan dan materi bertambah satu klik
dibanding sekarang. Ini biaya yang diterima sadar demi tidak menyesakkan daftar anak ke dalam panel
selebar setengah layar.

## Pengujian

Mengikuti disiplin yang sudah berlaku di repo ini, tanpa perkakas baru:

- **Primitif** diuji lewat `renderToStaticMarkup` — pola yang sudah dipakai luas di
  `tests/admin-bayar.test.ts` dan `tests/owner-rekap-halaman.test.ts`.
- **Penguraian parameter URL** (cari, saringan, halaman) adalah fungsi murni di berkas `status.ts`
  sebelah, diuji langsung. Berkas server action hanya boleh mengekspor fungsi async, jadi validator
  murni memang sudah tinggal terpisah — pola yang sama dengan `admin/sesi/status.ts`.
- **Saringan dan paginasi** diuji sampai ke basis data: saringan yang memulangkan baris yang salah
  adalah cacat data, bukan cacat tampilan.
- **`npx tsc --noEmit` wajib dijalankan** sebelum menganggap selesai. Vitest tidak memeriksa tipe,
  dan dua kali dalam pekerjaan panel sebelumnya kode lolos Vitest tetapi ditolak `tsc` dan akan
  memerahkan `npm run build`.
- Satu utang uji yang sudah tercatat ikut ditutup: `berkasPanel()` di `tests/panel-primitif.test.ts`
  membaca direktori tanpa memastikan hasilnya tidak kosong — tambahkan
  `expect(berkasPanel().length).toBeGreaterThan(0)`. Tanpa itu, ujinya lulus hampa bila direktorinya
  hilang.

## Pemecahan menjadi tiga rencana

Terlalu besar untuk satu rencana yang sehat: 12 halaman isi, 6 modul, 8 skrip E2E. Spec-nya tetap
SATU supaya keputusannya tidak berpencar; rencananya tiga, dikerjakan berurutan.

**Rencana 1 — Fondasi + dua modul percontohan.**
Bilah daftar, panel geser, paginasi, penguraian parameter URL. Lalu diterapkan pada **Mitra**
(pola A) dan **Klien** (pola B). Kedua pola terbukti nyata sebelum disebar, dan keduanya modul yang
paling sederhana di kelasnya masing-masing.

**Rencana 2 — Sapuan modul sisanya.**
Sesi, Varian, Layanan, Materi, Bayar, Skrining. Termasuk menaut StatTile "Sesi selesai tanpa
jenjang" ke daftar tersaring.

**Rencana 3 — Panel owner + E2E.**
`/owner/rekap`, `/owner/tarif`, `/owner/transport`, lalu tulis ulang kedelapan skrip E2E.

## Di luar ruang lingkup

- Logo dan favicon (K8) — menunggu aset dari klien.
- Pengurutan kolom dengan klik pada kepala tabel. Pencarian dan saringan menutup kebutuhan
  menemukan; pengurutan adalah kenyamanan, dan menambahnya sekarang memperluas permukaan uji tanpa
  menjawab satu pun dari empat keluhan.
- Aksi massal (pilih beberapa baris lalu tindak sekaligus). Tidak ada dalam keluhan, dan setiap
  aksi massal atas baris uang menuntut jejak auditnya sendiri.
