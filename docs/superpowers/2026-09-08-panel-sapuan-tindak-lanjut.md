# Panel Staf — Sapuan Enam Modul: Runbook, Utang, dan Verifikasi

**Spec:** `docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md`
**Rencana:** `docs/superpowers/plans/2026-09-07-padma-panel-sapuan-modul.md` (rencana 2 dari 3)
**Pendahulu:** `docs/superpowers/plans/2026-09-07-padma-panel-fondasi.md` (rencana 1, ter-merge)
**Runbook & utang rencana 1:** `docs/superpowers/2026-09-07-panel-fondasi-tindak-lanjut.md`

Berkas ini menutup rencana 2. Sama seperti runbook rencana 1, ia menyimpan tiga hal yang tidak
tercatat di riwayat git: apa yang berubah, apa yang wajib diketahui penerus, dan utang yang sengaja
ditunda beserta alasannya masing-masing.

---

## Apa yang berubah, dalam satu tabel

| Modul | Sebelum | Sesudah |
|---|---|---|
| **Sesi** | Dua formulir ("tandai selesai", "ubah jenjang") di dalam sel tabel; formulir jadwal di header | Bilah cari + saring (status · jenjang kosong · waktu) + paginasi; kedua formulir baris pindah ke `PanelSesi` (`?ubah=<id>`), formulir jadwal jadi `?ubah=baru` |
| **Beranda** | — | StatTile jenjang kosong menaut langsung ke `/admin/sesi?jenjang=kosong` |
| **Bayar** | Daftar tanpa saring/cari/paginasi | Bilah saring status + cari (nama/PADMA ID/label) + paginasi; paginasi JS di atas gabungan dua sumber (lihat utang #1) |
| **Skrining** | Inbox tanpa saring/cari/paginasi | Bilah saring tindak lanjut + hasil + cari + paginasi |
| **Layanan** | Formulir ubah di sel tabel | Daftar datar (cari, saring aktif/tidak) → baris menaut ke `/admin/layanan/[id]`: data, varian, paket, materi terkait |
| **Varian** | Bagian dari formulir layanan | Panel geser di dalam halaman detail layanan (`?ubah=<id>`, `?ubah=baru`) |
| **Materi** | Formulir/aksi di sel tabel | Daftar datar (cari, saring aktif/tipe/kelengkapan isi) → baris menaut ke `/admin/materi/[id]`: metadata, isi, layanan tertaut, penugasan |
| **Klien** *(diselesaikan di sini, task 12)* | `/admin/klien/baru` dan `/admin/klien/[id]` masih berpalet klien (paper/night/gold) | Disapu ke token `panel-*` — satu palet dari daftar sampai detail |

Dua pagar cetakan ditutup **sebelum** sapuan (Tugas 1 rencana ini), karena keduanya akan digandakan
enam kali oleh modul-modul di atas:

- `nominalDalam()` (`web/tests/helpers/nominal.ts`) menggantikan `/Rp\s?\d/` di 21 berkas uji —
  menangkap nominal telanjang, "Rp." bertitik, dan "rp" huruf kecil.
- `kelasPanelDi()` / `tokenHantu()` (`web/tests/helpers/token-panel.ts`) memperluas pemindaian
  token Tailwind dari `src/app/_shell/panel/` ke `src/app/admin/` dan `src/app/owner/`, dan dari
  tiga awalan (`text|bg|border`) ke empat belas (menambah `ring|outline|shadow|…`).

**Dua rute baru ditambahkan ke pagar crawl money-firewall E2E, dan itu sudah DIBUKTIKAN, bukan
hanya ditulis.** `/admin/layanan/${SVC_SEED_E2E}` dan padanan Materi ditambahkan ke `RUTE_ADMIN` di
`tests/e2e/owner.e2e.ts`. Draf pertama runbook ini mencatatnya sebagai utang terbuka karena tugas
verifikasi (Langkah 6) dilarang menjalankan skrip E2E apa pun — hanya diverifikasi lewat pembacaan
kode. Arvin kemudian menjalankan `npm run start` + `npm run test:e2e:owner` sendiri: **10/10
pemeriksaan lolos**, dengan 11 rute admin terpindai (naik dari 9) dan nol nominal ditemukan —
dikonfirmasi bukan pemindai mati lewat kontrol positif di pemeriksaan yang sama
(`/owner/tarif` tetap menemukan keempat nominal ujinya). Lihat "Verifikasi menyeluruh" di bawah
untuk baris keluaran persisnya. **Ini sekarang item selesai, bukan utang** — tidak lagi muncul di
tabel utang.

---

## Runbook — baca sebelum meneruskan

**1. Setiap brief harus meminta `npm run lint`, bukan hanya `tsc --noEmit`.** Gelombang pertama
rencana ini (commit `1bcbfaa`) sempat mengirim empat galat lint — impor bergaya `require()` di
badan `describe` sebuah berkas uji — yang lolos bersih dari `tsc --noEmit` karena itu murni aturan
ESLint (`@typescript-eslint/no-require-imports`), bukan galat tipe. Galat itu baru terlihat di
batas gelombang, saat verifikasi menyeluruh dijalankan. Setiap brief tugas berikutnya di proyek ini
wajib mencantumkan `npm run lint` sebagai langkah verifikasinya sendiri, bukan mengandalkan
verifikasi akhir rencana untuk menangkapnya.

**2. `sed` bawaan macOS (BSD sed) mendiamkan `\b` tanpa galat.** Sapuan palet Klien (task 12a, sudah
ter-merge sebagai `e535ef9`) memakai `sed -e 's/text-ink\b/.../'` untuk memindahkan `text-ink`
telanjang (bukan `text-ink-soft`) ke `text-panel-ink` di lima berkas. Di GNU `sed`, `\b` berarti
"batas kata"; di BSD `sed` (bawaan macOS, tanpa `--posix` atau `gsed`) urutan itu tidak dikenali dan
**tidak melempar galat sama sekali** — substitusinya diam-diam tidak melakukan apa pun untuk kelas
itu, sementara `grep -E`/`ugrep` di mesin yang sama justru MENDUKUNG `\b`, sehingga verifikasi lewat
grep dengan pola yang sama akan ikut melaporkan "bersih" secara keliru. Implementer menemukannya
lewat pemeriksaan manual pasca-sed — bukan lewat uji yang gagal, karena kelas `text-ink` telanjang
itu kebetulan tidak ikut diuji pagar palet — dan memperbaiki dua kemunculan yang lolos di
`src/app/admin/klien/[id]/kartu-aktivasi.tsx` (baris tombol "Salin pesan" dan baris peringatan
"Tautan ini hanya tampil sekali") dengan Edit manual, lalu memverifikasi ulang dengan
`grep -on "text-ink[a-zA-Z-]*"`. Pelajaran: sapuan lewat `sed` di mesin ini wajib diverifikasi dengan
pola grep yang TIDAK memakai `\b`, atau pakai `gsed` dari Homebrew bila `\b` sungguhan diperlukan.

**3. Sepuluh cacat ditemukan di teks brief rencana ini sendiri**, seluruhnya oleh implementer atau
reviewer yang mengerjakannya — bukan satu pun oleh penulis rencana saat menulisnya. Termasuk di
antaranya: hitungan uji yang salah (diperbaiki di `ee7c154`), pola pagar nominal yang terlalu
longgar terhadap pecahan desimal tiga angka (diperbaiki di `726148e` sebelum sempat dipakai),
kesalahan penamaan berkas rujukan, dan asumsi tentang struktur data yang meleset saat dicoba
sungguhan. Ini argumen paling kuat untuk mempertahankan gerbang review per tugas: bukan karena
implementer sering salah, melainkan karena rencana itu sendiri butuh mata kedua sebelum dipercaya
sebagai kebenaran tunggal yang diikuti dua belas tugas berturut-turut.

**4. Pola dua lapis (`ambilDaftar<Modul>` + `page.tsx`) berulang enam kali dengan konsisten**, tapi
konsekuensinya: cacat struktural apa pun yang lolos di modul pertama (Sesi) punya kesempatan
tersalin ke lima modul berikutnya sebelum ada yang menyadarinya. Task 1 rencana ini (dua pagar
cetakan) adalah usaha eksplisit menutup dua cacat semacam itu SEBELUM penyalinan terjadi. Bila
menambah modul ketujuh nanti, periksa dulu apakah ada cacat serupa yang sudah menyebar diam-diam ke
enam modul yang ada — jangan asumsikan modul pertama sudah bersih hanya karena ia yang tertua.

**5. Uang tidak pernah masuk lapisan data manapun di bawah `/admin`, dan itu diuji per-berkas.**
Pola `sesi.ts`, `layanan.ts`, `tagihan.ts` sama: setiap lapisan data punya uji "money firewall" yang
menegaskan sumbernya sendiri (bukan hanya markup halamannya) tidak pernah menyebut
`variant_rates`/`honor_marks`/`transport_rates`/`transport_khusus`. Pertahankan pola ini di modul
mana pun berikutnya — memeriksa markup saja tidak menangkap nominal yang dihitung lalu sengaja tidak
dirender.

**6. Basis data Supabase lokal dipakai bersama antar sesi kerja** — koordinasikan sebelum `npm test`
penuh (lihat Global Constraint 13 rencana ini). Diperiksa sebelum menjalankan suite penuh untuk
runbook ini: umur seluruh kontainer `supabase_*_web` seragam (~2 jam), tidak ada tanda pembangunan
ulang di tengah jalan.

**7. `npm run test:e2e:owner` AMAN dijalankan, dan ia satu-satunya cara membuktikan pagar crawl
money-firewall sungguhan bekerja — bukan hanya tertulis benar di kode.** Hanya
`test:e2e:video` dan `test:e2e:semua` yang dilarang total: keduanya mengunggah ke bucket Cloudflare
R2 PRODUKSI milik klien. `test:e2e:owner` butuh server berjalan di `localhost:3000`
(`npm run start` di atas build yang sudah ada — bukan `npm run dev`), hanya menyentuh basis data
Supabase LOKAL, dan membersihkan fixture-nya sendiri (pemeriksaan 9 di skrip itu menegaskan
pembersihan ini). Skrip ini yang membuktikan dua entri baru `/admin/layanan/${SVC_SEED_E2E}` dan
padanan Materi benar masuk `RUTE_ADMIN` dan benar-benar dipindai (lihat "Verifikasi menyeluruh" di
bawah untuk hasilnya). **Siapa pun yang menambah rute `/admin` berikutnya wajib menambahkannya ke
`RUTE_ADMIN` di `tests/e2e/owner.e2e.ts` DAN menjalankan skrip ini** — sebelum runbook ini ditulis
ulang, tidak ada satu pun berkas di repo yang mengatakan kewajiban itu secara eksplisit, dan itu
persis bagaimana kesenjangan yang ditutup rencana ini (halaman baru tanpa pagar crawl) bisa
terbentuk pertama kali.

---

## Verifikasi menyeluruh (Langkah 6)

Dijalankan dari `web/`, 2026-09-08. Tidak ada perbaikan kode dalam tugas ini — bila salah satu merah,
rencana berhenti di sana; semuanya hijau.

```
$ npm run build
▲ Next.js 16.3.3 (Turbopack)
✓ Compiled successfully in 843ms
✓ Generating static pages using 11 workers (33/33) in 240ms
```
Seluruh rute berhasil dibangun, termasuk dua rute detail baru: `/admin/layanan/[id]` dan
`/admin/materi/[id]`.

```
$ npx tsc --noEmit
(tidak ada keluaran — nol galat tipe)
```

```
$ npm run lint
✖ 6 problems (0 errors, 6 warnings)
```
Nol galat. Enam peringatan, seluruhnya di berkas pra-ada dan persis yang diharapkan:
`src/app/masuk/form-masuk.tsx` (1), `src/app/passport/materi/[id]/reader-pdf.tsx` (1),
`tests/e2e/passport.e2e.ts` (1), `tests/grant-anon.test.ts` (1), `tests/materi-video-r2.test.ts` (1),
`tests/transport-geocode.test.ts` (1). Tidak satu pun berasal dari berkas yang disentuh rencana ini.

```
$ npm test
 Test Files  127 passed (127)
      Tests  2105 passed (2105)
   Duration  120.54s
```
Seluruh suite hijau: 127 berkas, 2105 uji.

E2E **tidak dijalankan dalam tugas verifikasi ini sendiri** atas instruksi eksplisit — bukan lupa,
dan bukan asumsi "pasti hijau". `npm run test:e2e:video` dan `test:e2e:semua` dilarang total
(menyentuh bucket Cloudflare R2 produksi milik klien); ketujuh skrip lain sengaja tidak dijalankan
di sini agar tidak tumpang tindih dengan uji yang dijalankan manual oleh Arvin.

**`tests/e2e/owner.e2e.ts` sudah dijalankan sungguhan sesudahnya, terpisah dari tugas ini** —
`npm run start` (build produksi di `localhost:3000`) lalu `npm run test:e2e:owner`. Hasil: **10/10
pemeriksaan lolos**. Baris penentunya:

```
PASS  7b. nol nominal rate card di 11 rute /admin + 6 rute /passport
      17 rute diperiksa terhadap 22 nominal, nol temuan
```

Sebelas rute admin — naik dari sembilan — membuktikan kedua entri `RUTE_ADMIN` baru
(`/admin/layanan/${SVC_SEED_E2E}` dan padanan Materi) benar masuk daftar dan benar-benar dipindai,
bukan sekadar tertulis di kode. Pemeriksaan 8 di skrip yang sama adalah KONTROL POSITIF — ia
menegaskan pemindai nominal MENEMUKAN keempat angka uji di `/owner/tarif` (`777.000`, `333.000`,
`999000`, `555000`) — jadi "nol temuan" di pemeriksaan 7b berarti pemindainya bekerja dan memang
tidak menemukan apa-apa, bukan pemindai yang mati. Ini menutup apa yang sebelumnya tercatat sebagai
utang di draf pertama runbook ini (diverifikasi lewat pembacaan kode saja saat itu, belum lewat
eksekusi) — lihat "Apa yang berubah" di atas untuk detailnya.

---

## Utang tindak lanjut

Diurutkan menurut nilai.

| # | Utang | Kenapa ditunda |
|---|---|---|
| 1 | **`max_rows = 1000` masih terbuka untuk query HITUNG** di beberapa tempat baru. `ambilDaftarLayanan()` (`src/lib/admin/layanan.ts:68-70`) membaca seluruh `service_variants`, seluruh `packages`, dan seluruh `sessions` (kolom `service_id` saja, tapi SETIAP baris klinik) tanpa `.range()` untuk menghitung `jumlahVarian`/`jumlahPaket`/`sesiTercatat` per layanan di JS — komentar di sumbernya (baris 65-67) sudah menyalin persis peringatan yang sama dari runbook rencana 1. **Koreksi atas draf pertama entri ini:** `ambilLayanan()` (detail satu layanan, di berkas yang sama) JUGA kena utang ini, bukan terkecuali — draf pertama mencatat ia "memakai `daftarKatalogAdmin()` yang sudah dibatasi per-layanan", dan itu keliru: `daftarKatalogAdmin()` (`src/lib/admin/katalog-admin.ts`) tidak punya satu pun `.range()`/`.limit()` di keenam query-nya (`phases`, `services`, `packages`, `client_packages`, `sessions`, `service_variants`) — ia membaca seluruh tabel lalu menyaring per-layanan DI JS SESUDAHNYA, pola yang sama persis dengan utang ini di tempat lain, bukan pengecualian darinya. Konsekuensinya senyap: `sesiTercatat` di halaman detail layanan dan di setiap baris varian akan under-report begitu klinik melewati 1000 sesi, tanpa satu pun error. `daftarTagihanAdmin()` (`src/lib/admin/tagihan.ts`) membaca KEDUA tabel sumbernya (`client_packages` dan `sessions`) tanpa `.range()` sama sekali — paginasi JS-nya (`cocok.slice(dari, dari + PER_HAL)`) memotong daftar yang **sudah** terbaca, jadi ia memperbaiki layar dan biaya render, BUKAN batas bacaan; komentar di `tagihan.ts:293-300` mencatat ini secara eksplisit. Sama kelasnya dengan utang #1 runbook rencana 1 (`mitra.ts`, `klien.ts`), yang **masih terbuka juga**. | Polanya sudah dikenal sejak rencana 1 — obatnya view atau RPC hitung-per-grup, di luar bobot rencana ini. Untuk Bayar khususnya, menutupnya menuntut lebih dari sekadar view: `client_packages` dan `sessions` tidak berbagi kolom nama, jadi PostgREST tidak bisa meng-OR-kan keduanya jadi satu hasil terurut — dibutuhkan view `union all` berkolom seragam supaya `.range()` bisa jalan sama sekali. |
| 2 | **Saringan `isi=belum` di modul Materi menyaring HALAMAN yang sudah diambil, bukan seluruh daftar.** `ambilDaftarMateri()` (`src/lib/admin/materi-admin.ts:261-295`) menjalankan `.range(dari, sampai)` LEBIH DULU, baru memfilter `!lengkap` di JS sesudahnya (baris 288-295, komentar sudah menyalin persis peringatan yang sama dari `lib/admin/klien.ts` untuk "punya paket"). Katalog dengan lebih banyak materi tak-lengkap daripada muat dalam satu halaman akan under-report jumlahnya secara senyap — total yang ditampilkan benar untuk halaman ini, tapi materi tak-lengkap di halaman lain tidak pernah ikut terjaring saringan. Tidak pernah dilatih uji dengan lebih dari 25 materi tak-lengkap sekaligus. | Struktural identik dengan utang #12 rencana 1 — perbaikannya sebuah view SQL yang menghitung `lengkap` di database, bukan di JS sesudah `.range()`. Di luar bobot rencana ini. |
| 3 | **DITUTUP** (rencana 3A, merge `6e5e813`) — **dengan satu residu**. Ketiga skrip Playwright yang patah oleh pemecahan Materi menjadi daftar+detail (`tests/e2e/materi-pdf.e2e.ts`, `tests/e2e/materi-video.e2e.ts`, `tests/e2e/admin-pelengkap.e2e.ts`, bukan delapan seperti diprediksi spec) sudah ditulis ulang mengikuti kontrol yang pindah ke halaman detail `/admin/materi/[id]`; ketujuh skrip E2E yang aman dijalankan lolos. Rinciannya, termasuk satu bug produksi Server→Client yang ditemukan dan ditutup di tugas yang sama, ada di `docs/superpowers/2026-09-08-e2e-tindak-lanjut.md`. **Residu yang TIDAK ikut tertutup:** `materi-video.e2e.ts` diperbaiki tapi BELUM TERUJI-EKSEKUSI — skrip ini menyentuh bucket Cloudflare R2 produksi milik klien, jadi perbaikannya belum pernah benar-benar dijalankan sekali pun (lihat bagian "`materi-video.e2e.ts` — BELUM TERUJI-EKSEKUSI" di runbook tersebut). | Tidak lagi ditunda untuk dua dari tiga skrip. Residu `materi-video.e2e.ts` menunggu keputusan sadar pemilik repo untuk menanggung risiko menyentuh produksi, bukan tertunda tanpa alasan — lihat `npm run test:e2e:video` di runbook E2E untuk prasyarat dan peringatannya. |
| 4 | **Enam berkas di bawah `/admin` masih berpalet klien lama** (paper/night/gold): `src/app/admin/page.tsx`, `src/app/admin/pengaturan/page.tsx`, `src/app/admin/pengaturan/form-pengaturan.tsx`, `src/app/admin/materi/form-materi.tsx`, `src/app/admin/layanan/form-layanan.tsx`, `src/app/admin/sesi/antrean-permintaan.tsx` — diverifikasi lewat grep atas `bg-night`, `text-gold-pale`, `border-gold`, `bg-white`, `border-black/1x`, `text-ink(-soft)`. Rencana ini menutup dua utang cetakan (Tugas 1) dan sapuan Klien (task 12); daftar sapuan rencana ini sendiri berbunyi "Sesi, Bayar, Skrining, Layanan, Varian, Materi" — enam berkas di atas jatuh di LUAR daftar itu karena mereka bukan halaman daftar/formulir utama modulnya (mereka form ANAK atau halaman lain). **Katakan ini terus terang: panel `/admin` masih terbaca campuran di beberapa tempat** — pembaca yang mengira sapuan sudah tuntas akan terkejut sendiri begitu membuka `/admin/pengaturan` atau formulir tambah materi/layanan. | Sama seperti utang #5 rencana 1: seluruh halaman `/admin` lain juga masih berpalet lama, yang menonjol hanya yang bertetangga langsung dengan daftar yang sudah disapu. Menutup enam ini sekaligus di luar rencana berarti menyentuh berkas yang tidak terdaftar di brief manapun rencana ini — risiko regresi di luar cakupan yang sedang diverifikasi. |
| 5 | **`KelompokSaring.label` wajib diisi tapi tidak pernah dirender.** Inherited dari utang #6 rencana 1, sekarang lebih parah: tujuh halaman (`bayar`, `klien`, `layanan`, `materi`, `mitra`, `sesi`, `skrining`) memakai `<BilahDaftar kelompok={[…]}>` dengan lebih dari satu kelompok chip berdampingan tanpa penanda di mana satu kelompok berakhir dan yang lain mulai. `/admin/sesi` adalah kasus terburuk: TIGA kelompok (status · jenjang · waktu) tampil sebagai satu baris chip tanpa jeda visual. | Sama seperti rencana 1: menampilkannya mengubah tata letak bilah di tujuh halaman sekaligus — keputusan visual yang butuh persetujuan sebelum disentuh, bukan cacat yang bisa diperbaiki sepintas. |
| 6 | **`aria-pressed` pada `<Link>` bukan ARIA yang sah** — atribut itu hanya berlaku pada elemen `role="button"`/`switch`, bukan tautan navigasi. Didefinisikan sekali di primitif `src/app/_shell/panel/bilah-daftar.tsx:78` dan karena itu otomatis menyala di ketujuh halaman yang memakainya (lihat utang #5) — naik dari dua halaman (Mitra, Klien) di rencana 1. Keadaan "chip ini aktif" karena itu hanya tersampaikan lewat warna (`bg-panel-ink`); pemakai pembaca layar mendengar deretan tautan tanpa tanda mana yang sedang aktif. `aria-current="page"` (atau nilai token lain yang sesuai) adalah atribut yang benar untuk tautan yang menandai keadaan saat ini. | Sama seperti rencana 1: lolos lint dan lolos mata sekaligus karena efeknya hanya kelihatan lewat pembaca layar sungguhan. Menutupnya di satu tempat (primitifnya) otomatis menutup ketujuh halaman sekaligus — nilainya besar, tapi tetap di luar cakupan tugas verifikasi ini. |
| 7 | **Tidak ada uji yang membuktikan kekebalan `max_rows` milik `ambilDaftarMateri()`.** `tests/materi-admin-batas-baris.test.ts` membuktikan HANYA `daftarMateriAdmin()` (fungsi lama, dipakai halaman katalog bersarang) kebal `max_rows` lewat embed agregat `material_pages(count)`. Fungsi BARU `ambilDaftarMateri()`, yang kini menjadi sumber data `/admin/materi` — daftar utama yang dilihat admin sehari-hari — mengulang pola agregat yang sama (`material_pages(count)`, `src/lib/admin/materi-admin.ts:249`) tapi tidak punya uji sendiri yang menegaskannya. Bila suatu saat seseorang menukar embed itu ke `material_pages(*)` biasa (menarik SETIAP baris halaman, bukan hitungannya), seluruh suite yang ada tetap hijau — cacatnya identik dengan yang pernah terjadi di `daftarMateriAdmin()`, hanya kali ini tidak ada pagar yang bisa menangkapnya. | Ditemukan saat menyusun runbook ini, bukan diketahui sejak awal rencana — masuk sebagai temuan baru, bukan utang yang sengaja dicatat penulis rencana. Menutupnya berarti menyalin pola `tests/materi-admin-batas-baris.test.ts` (materi tunggal dengan >1000 halaman) menargetkan `ambilDaftarMateri()`, pekerjaan kecil namun di luar cakupan tugas verifikasi ini. |
| 8 | **`text-panel-muted` di atas `bg-panel-bg` menghitung sekitar 4,4:1** — sedikit di bawah ambang AA 4,5:1 untuk teks normal 13px. Dipakai luas: `form-sesi.tsx`, `tabel-inbox.tsx` (Skrining), `tabel-bayar.tsx` (Bayar), dan menyebar lebih jauh lewat sapuan enam modul karena token ini bagian dari kombinasi standar panel. | Bukan cacat yang diperkenalkan rencana ini — ini konvensi yang SUDAH ter-merge sejak rencana 1 dan diikuti apa adanya di sini, bukan diciptakan di sini. Memperbaikinya berarti mengubah nilai token `--color-panel-muted`, yang menyentuh SETIAP halaman panel sekaligus — perubahan sistem warna, bukan tambalan lokal. |
| 9 | **Saringan tanggal Sesi menyimpang dari spec K3.** Spec menyebut "status · jenjang kosong · rentang tanggal"; rencana ini mengirim tiga chip preset (`waktu=mendatang|pekan_ini|lampau`) alih-alih sepasang `<input type="date">` bebas. Rentang bebas butuh parameter di luar model daftar-putih `uraikanParamDaftar()`, validasi tanggal sendiri, dan satu primitif bilah baru. | Dicatat di rencana sendiri sebagai "Penyimpangan dari spec — dicatat, bukan disembunyikan" sebelum satu baris kode pun ditulis. Rentang bebas tetap bisa ditambahkan kapan saja sebagai parameter TAMBAHAN tanpa membongkar tiga preset yang sudah ada. |
| 10 | **Saringan `hasil=merah\|hijau` di modul Skrining melebihi spec K3.** Spec K3 hanya mencantumkan SATU saringan untuk Skrining: "sudah ditindaklanjuti / belum" (`tindak`). `SARING_SKRINING` (`src/lib/admin/skrining.ts:22-25`) menambahkan `hasil: ["hijau", "merah"]` sebagai saringan KEDUA. Konsekuensi yang menyertainya: `?cari=<nama>&hasil=merah` menaruh nama seseorang bersebelahan dengan HASIL SKRINING MERAHnya di riwayat peramban dan access log server. | Disetujui rencana sendiri sebelum satu baris kode pun ditulis — bukan overreach implementer — tapi tidak pernah dicatat sebagai deviasi eksplisit di runbook manapun sampai review sapuan panel menemukannya; ditambahkan di sini sekarang. Halamannya di belakang `requireRole` dan tidak ada jawaban kuesioner yang terekspos, jadi paparan nama+hasil di URL/log adalah keputusan yang disadari (judgment call), bukan pelanggaran — komentar pagar navigasi di `tests/admin-inbox.test.ts` sudah diperluas untuk mengakui `hasil` sebagai klasifikasi klinis, bukan parameter navigasi netral seperti `cari`/`tindak`. |
| 11 | **Perilaku tombol "+ baru" berbeda di ketiga modul pola-B.** Spec K3 menyatakan modul pola-B (objek berdaftar-anak) menavigasi ke HALAMAN baru saat menambah baris. Klien mengikutinya (`/admin/klien/baru`). Layanan dan Materi tidak — keduanya membuka PANEL GESER di `?ubah=baru`. Tiga modul pola-B kini berperilaku dua cara berbeda untuk aksi yang secara konsep sama. | Rencana ini secara eksplisit MERESEPKAN panel geser untuk Layanan/Materi — bukan overreach implementer — dengan alasan: layanan/materi baru belum punya satu pun anak untuk ditampilkan, jadi halaman detail yang baru dibuka akan kosong, sementara panel geser menawarkan hal yang sama tanpa lompatan halaman. Argumen itu masuk akal, tapi tidak pernah dicatat sebagai deviasi eksplisit sampai review sapuan panel menemukannya. Menyatukan ketiganya ke satu bentuk adalah keputusan produk yang butuh persetujuan, di luar bobot perbaikan ini. |

**Catatan penomoran:** utang "dua entri crawl money-firewall belum dieksekusi" yang tadinya berdiri
di posisi #5 di draf pertama runbook ini DIHAPUS dari tabel, bukan diberi nomor baru — item itu
sudah tuntas (lihat "Apa yang berubah" di atas), dan tabel utang seharusnya hanya berisi hal yang
benar-benar belum selesai. Nomor #5-#9 di atas adalah penomoran ulang dari #6-#10 draf pertama;
tidak ada rujukan eksternal ke nomor lama yang perlu disesuaikan (belum ada dokumen lain yang
mengutip nomor utang ini).

**#10 dan #11 ditambahkan** oleh gelombang perbaikan review sapuan-panel (commit sesudah `dacc4de`)
— DITAMBAHKAN di ekor tabel, bukan disisipkan lalu menggeser nomor #1-#9, persis supaya rujukan
nomor di atas tetap berlaku. Keduanya deviasi dari spec K3 yang sebelumnya hanya hidup di kode
(SARING_SKRINING, tombol "+ baru" Layanan/Materi) tanpa pernah dicatat sebagai deviasi eksplisit —
review sapuan panel yang menemukannya, bukan implementer tugas aslinya.

### Warisan dari rencana 1 yang masih terbuka

Untuk menghindari pembaca mengira utang rencana 1 sudah tuntas hanya karena tidak disebut ulang di
sini secara penuh: utang #2 (money firewall bisa dilewati nominal telanjang — **ini sudah DITUTUP**
oleh Tugas 1 rencana ini, `nominalDalam()`), #3 (seed klien tanpa alamat), #7 (`hal` dijepit di dua
tempat berbeda), #9 (uji `pesanBerikutnya` menjamin fungsi murni saja), #10 (pagar identitas
melewatkan bentuk 3-argumen `.filter()`), #11 (`namaBarisId()` menelusuri markup) — **semuanya masih
berdiri seperti runbook rencana 1 mencatatnya**, tidak disentuh rencana ini.

---

## Catatan proses

**Enam modul disalin dari pola yang sama (Sesi menjadi cetakan), dan cacat struktural di cetakan
punya jendela sempit untuk ketahuan sebelum tersalin lima kali.** Task 1 rencana ini — menutup dua
pagar cetakan SEBELUM menyentuh satu pun modul — adalah usaha eksplisit menyempitkan jendela itu.
Nilainya terlihat langsung: pagar token yang diperluas ke `src/app/admin`/`src/app/owner` di Task 1
menjadi satu-satunya alasan enam berkas di utang #4 di atas bisa didaftar dengan pasti sebagai
"belum disapu" alih-alih "mungkin belum disapu, belum pernah diperiksa mesin".

**Sepuluh cacat brief, empat asersi hampa (rencana 1), dan sekarang satu gap `sed` BSD** — pola yang
berulang di setiap rencana panel sejauh ini adalah: kode uji dan teks brief sama-sama butuh mata
kedua, bukan hanya kode produksinya. Tidak satu pun dari ketiga rencana panel ini lolos tanpa
sesuatu yang ditemukan pihak selain penulisnya.
