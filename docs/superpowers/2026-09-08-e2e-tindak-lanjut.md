# E2E Sesudah Sapuan Panel Staf — Runbook, Pagar, dan Batasnya

**Spec/Rencana:** `.superpowers/sdd/2026-09-08-padma-e2e-sesudah-sapuan/` (task-1 s/d task-5)
**Pendahulu:** `docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md` (sapuan panel yang mematahkan skrip-skrip ini)

Rencana ini menulis ulang empat skrip E2E yang patah akibat sapuan panel staf (rencana 2), menutup
satu pagar ejaan murah, dan mendokumentasikan semuanya di sini. Baca ini sebelum menjalankan atau
mengubah E2E di proyek ini.

---

## Hasil terukur — bukan diperkirakan

Spec awal memperkirakan "delapan skrip E2E akan merah". Diukur sungguhan pada `main` (`21c7f0e`)
dengan menjalankan ketujuh skrip aman satu per satu: **empat merah, bukan delapan** — lihat
`global-constraints.md` untuk tabel lengkapnya. Tugas 1–4 menulis ulang keempat skrip itu:

| Skrip | Kepatahan diprediksi brief | Kepatahan TIDAK diprediksi, ditemukan sungguhan | Hasil akhir |
|---|---|---|---|
| `materi-pdf.e2e.ts` (Tugas 1) | 4 (`Materi baru`, `Kelola isi`, `Aktifkan`/`Nonaktifkan`, `Kelola penugasan`) | **2 tambahan**: dua pemakaian locator `kartuMateri` lain (baris ~463 penugasan Rina, ~512 pencabutan Ananda) yang brief lewatkan sama sekali — total `kartuMateri` dipakai di **lima** tempat, bukan tiga yang disebut brief. Ditemukan lewat `grep -n "kartuMateri"` sebelum menghapus deklarasinya. **Plus satu bug produksi serius** (lihat bagian berikut) yang tidak diprediksi brief sama sekali. | 12/12 lolos |
| `admin-pelengkap.e2e.ts` (Tugas 2) | 1 (`Nonaktifkan`/`Aktifkan` pindah ke halaman detail) | **0 tambahan** — lolos 26/26 pada percobaan pertama sesudah penerapan brief, tanpa iterasi. | 26/26 lolos |
| `admin-operasional.e2e.ts` (Tugas 3) | 3 (`+ Jadwalkan sesi`→`+ Sesi baru`, teks sukses `Jadwal sesi tersimpan.` hilang, `Tandai selesai`→`Ubah`) | **0 tambahan** — lolos 26/26 pada percobaan pertama sesudah penerapan brief, tanpa iterasi. | 26/26 lolos |
| `materi-video.e2e.ts` (Tugas 4) | 2 situs (pembuatan materi, unggah isi) — sama polanya dengan `materi-pdf.e2e.ts` | Tidak dapat diukur — **skrip ini BELUM DIJALANKAN sama sekali** (lihat bagian di bawah). | **tak terukur** |

Jadi dari empat skrip yang ditulis ulang, hanya satu (`materi-pdf.e2e.ts`) menyembunyikan kepatahan
di belakang titik henti pertamanya — dan yang tersembunyi di sana bukan cuma locator, tapi juga bug
produksi. Dua skrip lainnya (`admin-pelengkap`, `admin-operasional`) ternyata sama persis dengan
prediksi brief tanpa sisa. Jangan simpulkan dari dua kasus bersih itu bahwa brief selalu akurat —
`materi-pdf.e2e.ts` membuktikan sebaliknya di skrip pertama yang dikerjakan.

### Bug produksi yang ditemukan Tugas 1 — argumen terkuat untuk mempertahankan E2E

`src/app/admin/materi/[id]/page.tsx` (Server Component) mengoper prop berupa **fungsi**
(`labelUntuk: (nama) => string`) ke `<CentangLayanan>`, sebuah **Client Component**. Ini melanggar
batas Server→Client Next.js (fungsi tidak bisa diserialisasi lintas batas itu tanpa `"use server"`),
dan meledakkan **setiap** kunjungan ke `/admin/materi/[id]` — bukan cuma materi uji, materi apa pun —
sejak sapuan panel memindahkan Kartu "Layanan tertaut" ke halaman detail. Diperbaiki di `7e095b7`
dengan mengganti prop fungsi menjadi `labelAkhiran?: string` (string polos).

**Kenapa unit test tidak pernah menangkapnya:** `renderToStaticMarkup`, yang dipakai suite unit,
tidak punya batas server/klien — ia merender fungsi itu tanpa keluhan. Tiga review kode sebelumnya
membaca prop `labelUntuk` secara terisolasi dan tidak melihat masalahnya. **E2E ini adalah test
pertama yang benar-benar mengunjungi halaman itu di peramban sungguhan, dan langsung menangkapnya.**
Ini bukan argumen abstrak "E2E itu berguna" — ini satu bug nyata, yang benar-benar meledakkan
produksi, yang hanya bisa ditangkap oleh kelas test yang butuh peramban sungguhan. Koordinator
mencatat pola constraint ini (fungsi lintas batas Server/Client) sudah menggigit proyek dua kali
sebelumnya — kemungkinan ada instans lain yang belum ketahuan di modul yang belum pernah dikunjungi
E2E.

---

## `materi-video.e2e.ts` — BELUM TERUJI-EKSEKUSI

Tugas 4 menulis ulang dua situs selektor di skrip ini (pembuatan materi lewat panel geser, unggah
isi lewat halaman detail) mengikuti pola yang identik dan sudah terbukti hijau di
`materi-pdf.e2e.ts` (perbandingan berdampingan ada di `task-4-report.md`). **Tidak satu baris pun
dari perubahan itu pernah benar-benar dijalankan** — bukan "kemungkinan besar benar", benar-benar
nol eksekusi.

**Kenapa:** skrip ini menyentuh bucket Cloudflare R2 **produksi** milik klien lewat presigned PUT
sungguhan (unggah lalu hapus objek asli). Menjalankannya untuk memverifikasi pekerjaan sendiri
bukan pertukaran yang setara dengan risikonya, dan dilarang eksplisit oleh brief maupun
global-constraints rencana ini.

**Yang TIDAK bisa dipastikan dari pembacaan kode saja:**
1. Apakah rantai presigned PUT ke R2 produksi benar-benar sukses dari peramban (kredensial, CORS
   bucket produksi, izin tanda tangan) — inti yang justru dibuktikan skrip ini.
2. Apakah `timeout: 20_000`/`60_000` cukup pada mesin sungguhan, termasuk potensi race antara
   `router.refresh()` milik `IsiVideo`/`PengunggahVideo` dan `.first()` yang menunggu teks "Video
   tersimpan." (pola disalin dari `materi-pdf.e2e.ts` yang terbukti hijau untuk kasus PDF, tapi
   belum dibuktikan untuk video secara spesifik — jalur unggahnya beda, `XMLHttpRequest` vs
   mekanisme `PengunggahPdf`).
3. Apakah pemeriksaan 3–7 di bawah dua situs yang diubah (presigned GET, URL tidak bocor di HTML
   server, penolakan tanpa tanda tangan, penolakan klien tanpa hak, pembersihan) masih lolos —
   sama sekali tidak disentuh Tugas 4, dan belum pernah dibuktikan berjalan runtut sesudah
   perubahan di dua situs itu.
4. Apakah pembersihan (`bersihkan()`, `pulihkanRina()`) berjalan benar pada kondisi gagal di
   tengah jalan.

**Apa yang harus dilakukan pemilik repo untuk memverifikasinya**, ketika siap menanggung risiko
menyentuh R2 produksi:

```bash
# prasyarat: kredensial R2 produksi lengkap di .env.local, server hidup di
# localhost:3000, npx supabase start, npm run seed:users
cd web
npm run test:e2e:video
```

Ini akan **mengunggah lalu menghapus objek sungguhan di bucket R2 produksi klien**. Keputusan untuk
menjalankannya ada di pemilik repo, bukan di implementer rencana ini.

---

## Pagar selektor E2E (`web/tests/e2e-selektor.test.ts`)

### Apa yang dijaga

Skrip E2E tidak ikut `npm test` — ia butuh server hidup. Akibatnya sapuan panel bisa mengganti label
tombol jadi tautan (atau menghapusnya) dan seluruh suite unit tetap hijau selama berminggu-minggu,
sampai seseorang kebetulan menjalankan E2E. Pagar ini menutup sebagian kelas itu dengan biaya
nyaris nol: ia mengekstrak setiap literal string dari pola
`getByRole("button"|"link", { name: "…" })` di `tests/e2e/*.e2e.ts`, dan memeriksa bahwa literal itu
masih ada di suatu tempat di `src/app/` (pencocokan substring atas gabungan seluruh isi berkas
`.ts`/`.tsx`, bukan parsing AST).

### Apa yang TIDAK dijaga — batasnya, diukur bukan diperkirakan

Regex ini dijalankan atas keadaan `main` sebelum rencana ini: **38 label diperiksa, 4 tidak
ditemukan di `src/app`**. Dari ketiga skrip yang benar-benar patah saat itu, pagar ini hanya akan
menangkap **satu**:

| Kepatahan | Tertangkap pagar ini? | Sebab |
|---|---|---|
| `admin-operasional`: `+ Jadwalkan sesi`, `Tandai selesai` | **ya** | labelnya lenyap sama sekali dari `src/` |
| `materi-pdf`: `Materi baru` | **tidak** | `src/` memuat `+ Materi baru`; pencocokan substring lolos |
| `admin-pelengkap`: `Nonaktifkan` | **tidak** | labelnya utuh, ia hanya PINDAH halaman |

Jadi ini **pagar ejaan** yang menangkap label yang **lenyap total** dari sumber, bukan label yang
berganti bentuk (mis. tombol jadi tautan dengan teks sedikit berbeda) atau berpindah tempat
(mis. tombol yang sama tetap ada tapi kini di halaman lain). **Satu dari tiga kelas kepatahan nyata
di proyek ini.** Tetap lebih baik daripada nol — kelas "label dihapus total" itu nyata dan murah
dijaga dengan cara ini — tetapi jangan membaca bagian ini seolah pagar ini menutup seluruh kelas
kepatahan E2E. Pagar alur yang sesungguhnya menuntut E2E berjalan sungguhan (di CI dengan server
dan basis datanya sendiri, atau manual seperti runbook ini), bukan analisis statis atas teks
sumber.

Konkretnya: kepatahan `admin-pelengkap.e2e.ts` (`Nonaktifkan` pindah dari daftar ke halaman detail)
**tidak akan tertangkap ulang** oleh pagar ini seandainya ia patah lagi dengan cara yang sama —
labelnya tetap ada di `src/app/`, hanya lokasinya yang berubah, dan pagar ini buta terhadap lokasi.

### `DIKECUALIKAN` — dua false-positive yang diketahui, bukan diperbaiki

`funnel-skrining.e2e.ts` mencari tombol `"Kehamilan"` dan `"Menopause"`. Keduanya nama **FASE**
yang datang dari kolom `phases.nama` di basis data, bukan literal di
`src/app/`. Skrip ini hijau (15/15, dibuktikan di bagian berikutnya) — nama fase itu memang benar
ada di runtime lewat data seed, hanya tidak pernah tertulis sebagai string literal di kode sumber
halaman. Keduanya masuk `DIKECUALIKAN` di `web/tests/e2e-selektor.test.ts` dengan alasannya masing-
masing, **bukan** "diperbaiki" di skrip funnel — skrip funnel tidak disentuh sama sekali oleh
rencana ini karena tidak ada yang patah di sana.

Saat menjalankan pagar tanpa pengecualian ini, kedua label itu adalah **satu-satunya** dua yang
gagal — tidak ada label lain yang hilang dari `src/app/`, konsisten dengan pengukuran
global-constraints bahwa ketiga skrip yang benar-benar patah sudah diperbaiki Tugas 1–3 (Tugas 4
tidak menghapus label, hanya memindahkan cara memicunya).

`DIKECUALIKAN` **sengaja dijaga pendek** — setiap tambahan padanya adalah lubang pada pagar ini.
Jangan tambahkan label ke sana hanya karena pagar merah; verifikasi dulu bahwa label itu memang
bukan literal `src/app/` (seperti nama fase dari database), bukan sekadar label yang sungguhan
hilang atau berubah bentuk.

### Bukti bergigi (teeth-proof)

Dijalankan `2026-09-08` di `web/`. Label `"+ Sesi baru"` di `tests/e2e/admin-operasional.e2e.ts:356`
diubah sementara menjadi `"Tombol Yang Tidak Ada"`, lalu dikembalikan.

**MERAH** (label diubah jadi tidak ada):
```
$ npx vitest run tests/e2e-selektor.test.ts
 ❯ tests/e2e-selektor.test.ts (5 tests | 1 failed)
     × setiap label yang dicari skrip E2E masih ada di src/app

FAIL  tests/e2e-selektor.test.ts > pagar ejaan selektor E2E > setiap label yang dicari skrip E2E masih ada di src/app
AssertionError: label E2E tidak ditemukan di src/app: expected [ Array(1) ] to deeply equal []
+ [
+   "tests/e2e/admin-operasional.e2e.ts: \"Tombol Yang Tidak Ada\"",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```
`EXIT=1`.

**HIJAU** (label dikembalikan ke `"+ Sesi baru"`, diverifikasi `git diff --stat` nol perubahan
tersisa pada berkas E2E):
```
$ npx vitest run tests/e2e-selektor.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```
`EXIT=0`.

---

## Cara menjalankan E2E

1. **Server harus hidup di `http://localhost:3000`.** `BASE = process.env.E2E_BASE_URL ??
   "http://localhost:3000"`. Jalankan `npm run build && npm run start` di terminal terpisah untuk
   build produksi, atau `npm run dev` untuk pengembangan. Tanpa server, setiap skrip gagal dengan
   `ERR_CONNECTION_REFUSED` yang tidak ada hubungannya dengan kode.

2. **JANGAN PERNAH menjalankan dua skrip ini:**
   - `npm run test:e2e:video` — mengunggah lalu menghapus objek di bucket Cloudflare R2 **produksi**
     milik klien.
   - `npm run test:e2e:semua` — memanggil `test:e2e:video` sebagai bagian dari rangkaiannya.

3. **Ketujuh skrip lain aman, jalankan satu per satu** (jangan paralel — basis data Supabase lokal
   dipakai bersama):
   ```bash
   npm run test:e2e            # access-matrix — 19/19
   npm run test:e2e:funnel     # funnel-skrining — 15/15
   npm run test:e2e:passport   # passport — 21/21
   npm run test:e2e:admin      # admin-operasional — 26/26
   npm run test:e2e:pelengkap  # admin-pelengkap — 26/26
   npm run test:e2e:owner      # owner (money-firewall crawl) — 10/10
   npm run test:e2e:materi     # materi-pdf — 12/12
   ```
   Angka di atas adalah hasil run `2026-09-08` sesudah Tugas 1–5 (lihat "Verifikasi menyeluruh" di
   bawah untuk keluaran lengkapnya).

4. **Jika login menggantung atau muncul `Processing this request timed out`:**
   `docker restart supabase_auth_web`, tunggu ~20 detik, ulangi. **JANGAN** `npm run db:recover`
   atau `npx supabase db reset` — keduanya rusak di mesin ini.

5. **Jika kegagalan berpindah-pindah berkas antar run**, curigai sesi lain lebih dulu:
   `ps -Ao args | grep vitest` (atau `grep -i "tsx tests/e2e"` untuk E2E) sebelum menyimpulkan
   kode Anda cacat. Basis data Supabase lokal dipakai bersama antar sesi kerja — kejadian ini sudah
   terjadi nyata selama pengerjaan Tugas 1.

6. **Setiap skrip membersihkan fixture-nya sendiri di blok `finally`.** Jangan interupsi paksa
   (Ctrl-C) di tengah jalan kecuali darurat — fixture yang tertinggal memerahkan berkas uji vitest
   lain yang tidak ada hubungannya, sudah terjadi di rencana panel sebelumnya.

---

## Money-firewall crawl: kewajiban untuk rute `/admin` baru

`tests/e2e/owner.e2e.ts` menjalankan pemeriksaan 7b: memindai setiap rute di `RUTE_ADMIN` (saat ini
11 rute) plus `RUTE_KLIEN` (6 rute) dan memastikan **nol** nominal rate card
(`variant_rates`/`honor_marks`/`transport_rates`/`transport_khusus`) bocor ke HTML yang dikirim ke
peramban. Pemeriksaan ini buta-rute — ia hanya memindai apa yang ada di `RUTE_ADMIN`, bukan
menemukan rute secara otomatis dari struktur `src/app/admin/`.

**Siapa pun yang menambah rute `/admin` baru wajib menambahkannya ke `RUTE_ADMIN` di
`tests/e2e/owner.e2e.ts`, lalu menjalankan `npm run test:e2e:owner` untuk membuktikan rute itu
benar-benar terpindai** (bukan sekadar tertulis di kode — lihat pemeriksaan 8 di skrip yang sama,
kontrol positif yang menegaskan pemindai memang menemukan nominal ketika nominal itu memang ada,
supaya "nol temuan" tidak disalahartikan sebagai "pemindai mati"). **Rute yang duduk di luar
`RUTE_ADMIN` tidak dijaga apa pun** — bukan oleh pagar ini, bukan oleh yang lain di proyek ini.
Rencana panel sapuan (`docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md`) sudah membuktikan
pola ini bekerja: dua rute detail baru (`/admin/layanan/[id]`, `/admin/materi/[id]`) ditambahkan ke
daftar ini dan dibuktikan terpindai (11 rute, naik dari 9) sebelum rencana ini dimulai.

---

## Verifikasi menyeluruh (Langkah 3–4 rencana ini)

Dijalankan dari `web/`, `2026-09-08`, server produksi (`next start`) sudah hidup di `localhost:3000`
sebelum rencana ini dimulai (dikelola koordinator, tidak di-restart oleh rencana ini). Tidak ada
`npm run build` dijalankan.

### Ketujuh skrip E2E aman

| Skrip | Exit | Pemeriksaan lolos |
|---|---|---|
| `test:e2e` (access-matrix) | 0 | 19/19 |
| `test:e2e:funnel` | 0 | 15/15 |
| `test:e2e:passport` | 0 | 21/21 |
| `test:e2e:admin` (admin-operasional) | 0 | 26/26 |
| `test:e2e:pelengkap` (admin-pelengkap) | 0 | 26/26 |
| `test:e2e:owner` | 0 | 10/10 (17 rute dipindai terhadap 22 nominal, nol temuan; kontrol positif di `/owner/tarif` menemukan keempat nominal ujinya) |
| `test:e2e:materi` (materi-pdf) | 0 | 12/12 |

`test:e2e:video` dan `test:e2e:semua` **tidak dijalankan**, sesuai larangan.

### Suite unit, lint, tsc

```
$ npm test
 Test Files  128 passed (128)
      Tests  2124 passed (2124)
EXIT=0
```

```
$ npm run lint
✖ 6 problems (0 errors, 6 warnings)
EXIT=0
```
Keenam warning persis daftar pra-ada di global-constraints: `src/app/masuk/form-masuk.tsx`,
`src/app/passport/materi/[id]/reader-pdf.tsx`, `tests/e2e/passport.e2e.ts`,
`tests/grant-anon.test.ts`, `tests/materi-video-r2.test.ts`, `tests/transport-geocode.test.ts`.
Tidak ada warning baru.

```
$ npx tsc --noEmit
(tidak ada keluaran — nol galat tipe)
EXIT=0
```

Sebelum menjalankan `npm test` penuh, diperiksa `ps -Ao args | grep vitest` — kosong, tidak ada
sesi lain yang sedang menjalankan uji pada saat itu.

---

## Kekhawatiran untuk pembaca berikutnya

1. **`materi-video.e2e.ts` tetap berstatus tak-terverifikasi** sampai pemilik repo menjalankannya
   sendiri dengan kredensial R2 produksi. Ini bukan kelalaian rencana ini — ini keputusan sadar
   yang ditulis eksplisit di brief dan diulang di sini supaya tidak terlupa.
2. **Pagar selektor ini murah tapi sempit.** Ia menutup satu dari tiga kelas kepatahan yang pernah
   nyata terjadi di proyek ini (label lenyap total). Ia tidak menggantikan kebutuhan menjalankan
   E2E sungguhan secara berkala — idealnya di CI, dengan server dan basis data sendiri, bukan
   dijalankan manual oleh siapa pun yang kebetulan ingat.
3. **Bug produksi Tugas 1 (fungsi lintas batas Server/Client) kemungkinan punya instans lain** di
   modul yang belum pernah dikunjungi E2E — koordinator mencatat pola ini sudah menggigit proyek
   dua kali sebelum Tugas 1. Tidak ada pagar statis di proyek ini yang menangkap kelas bug ini;
   hanya kunjungan peramban sungguhan yang bisa.
4. **`DIKECUALIKAN` di `e2e-selektor.test.ts` sengaja pendek (dua entri).** Siapa pun yang
   menambahkan entri ketiga harus bisa menunjukkan bahwa label itu memang bukan literal
   `src/app/` (seperti data dari basis data) — bukan sekadar cara memuluskan pagar yang merah.
