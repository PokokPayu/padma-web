# Panel Owner — Runbook, Utang, dan Verifikasi Penutup (Rencana 3B)

**Spec:** `docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md` (K7)
**Rencana:** `docs/superpowers/plans/2026-09-09-padma-panel-owner.md`
**Ledger tugas:** `.superpowers/sdd/2026-09-09-padma-panel-owner/progress.md`
**Runbook rencana sebelumnya (bentuk yang ditiru berkas ini):**
`docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md`
**Gelombang perbaikan penutup:**
`.superpowers/sdd/2026-09-09-padma-panel-owner/fix-wave-report.md`

Berkas ini menutup rencana 3B (panel owner). Task 10 (dijalankan 2026-09-09, commit
`0544877dd9f2b0a9cec9128f159392ce7d7cbaa2`) **tidak memperbaiki kode** — hanya melapor apa
adanya. Ia menemukan **dua regresi lintas-tugas** yang lolos dari sepuluh review per-tugas
(karena tidak satu tugas pun berwenang menyentuh berkas tempat regresinya berada) DAN satu
kesenjangan verifikasi (`/owner/transport` belum pernah dibuka di peramban sungguhan).

**STATUS SEKARANG: KETIGANYA DITUTUP.** Sebuah gelombang perbaikan terpisah, dijalankan
sesudah Task 10 di atas HEAD yang sama, memperbaiki README, memperbaiki cara berkas uji
memanggil `RekapPage`, dan menambah dua pemeriksaan E2E baru yang membuktikan
`/owner/transport` dan `PanelGeser`-nya hidup di peramban sungguhan. Isi "Perhatian mendesak"
dan "Tabel utang" di bawah **SENGAJA TIDAK dihapus** — ia catatan bahwa `npm test` PENUH
menemukan dua regresi yang sepuluh review per-tugas lewatkan, dan itu pelajaran paling
berharga dari rencana ini: alasan kenapa suite penuh WAJIB dijalankan, bukan hanya uji
per-berkas. Status penutupan tiap baris ditandai inline di bawah, dengan rujukan ke
angka verifikasi terbaru di bagian "Verifikasi menyeluruh — gelombang perbaikan penutup".

---

## Perhatian mendesak — dua kegagalan BARU ditemukan di suite penuh, bukan dari Task 9

> **[DITUTUP oleh gelombang perbaikan penutup, 2026-09-09]** — kedua kegagalan di bawah ini
> SUDAH diperbaiki: baris tabel README ditambahkan, dan helper `render()` di
> `paket-tersembunyi.test.tsx` sekarang memanggil `RekapPage({ searchParams: Promise.resolve({}) })`
> persis seperti pola `SP()` yang sudah dipakai berkas itu untuk halaman lain. `npm test`
> PENUH sesudah perbaikan: **165 berkas lolos, 2502 uji lolos, 0 merah** — lihat "Verifikasi
> menyeluruh — gelombang perbaikan penutup" di bawah untuk keluaran lengkapnya. Narasi asli di
> bawah ini dipertahankan UTUH sebagai bukti bahwa keduanya BENAR pernah merah, dan bahwa
> `npm test` penuh-lah yang menangkapnya — bukan satu pun dari sepuluh review per-tugas.

Task 9 melaporkan E2E owner 10/10 lolos. `npm test` PENUH belum pernah dijalankan sejak
Task 1 dimulai (Global Constraint koordinasi Supabase lokal). Saat dijalankan di sini untuk
pertama kalinya di atas seluruh sembilan tugas sekaligus, suite memulangkan **2 berkas gagal,
2 uji gagal dari 2502** — keduanya regresi lintas-tugas yang tidak tertangkap satu pun brief
karena tidak ada satu tugas pun yang berwenang menyentuh berkas tempat kegagalannya berada.
Lihat "Verifikasi menyeluruh" di bawah untuk keluaran persisnya. Ringkasan akar masalah:

1. **`tests/paket-tersembunyi.test.tsx` — `RekapPage` dipanggil tanpa `searchParams`.**
   Task 6 (`f73f717`) mengubah tanda tangan `RekapPage` dari tanpa argumen menjadi
   `RekapPage({ searchParams: Promise<...> })` (agar bisa menyaring `honor`). Berkas uji ini
   hidup di luar cakupan brief mana pun rencana ini — ia bagian dari fitur saklar paket, dan
   memanggil `RekapPage` lewat helper `render(halaman, props = {})` miliknya sendiri, dengan
   `props` default `{}`. `uraikanParamDaftar()` (`src/app/_shell/panel/daftar.ts:50`) lalu
   mengakses `sp[nama]` pada `searchParams` yang `undefined` dan melempar
   `TypeError: Cannot read properties of undefined (reading 'honor')`.
   **Ini bukan bug produksi** — Next.js App Router selalu mengoper `searchParams` (minimal
   `Promise` yang resolve ke `{}`) ke setiap `page.tsx`, jadi pengguna sungguhan tidak pernah
   memicu ini. Ini murni utang test-scaffolding: helper `render()` di
   `paket-tersembunyi.test.tsx` tidak tahu `RekapPage` sekarang butuh prop, karena tak satu
   pun brief Task 5/6 mendaftarkan berkas ini sebagai berkas yang wajib diperiksa ulang.
2. **`tests/inventaris-rute.test.ts` — README belum menyebut rute baru.** Task 4 menambah
   rute `/owner/tarif/[variantId]`, tapi tidak ada brief yang meminta baris baru di tabel
   rute README (`README.md` sekitar baris 127-129). Uji ini membandingkan rute nyata di
   `src/app` terhadap tabel README dua arah, dan menangkap selisihnya persis seperti
   dirancang.

**Kedua ini murni utang dokumentasi/scaffolding, bukan cacat produksi** — dibuktikan oleh
`npm run build` sukses penuh (41 rute, termasuk `/owner/tarif/[variantId]`) dan `tsc --noEmit`
bersih di langkah berikutnya. Tapi keduanya BENAR merah di `npm test`, dan Task 10 tidak
berwenang memperbaikinya. Masuk sebagai baris pertama tabel utang di bawah.

---

## Apa yang berubah, dalam satu tabel

| Halaman | Sebelum | Sesudah |
|---|---|---|
| **`/owner` (beranda)** | Sudah berpalet panel sejak sebelum rencana ini; satu token pra-panel tersisa (`hover:text-night`) | Token terakhir disapu ke `hover:text-panel-ink` (Task 8) — beranda kini 100% bebas token pra-panel |
| **`/owner/rekap`** | Daftar kartu pekan tanpa saring/cari/paginasi | Bilah cari (nama mitra) + chip saring `honor` (`tuntas`/`belum`) + paginasi 8 kartu/halaman (D2) — primitif `hitungRentang`/`jumlahHalaman`/`Paginasi` diperluas menerima `perHal` (Task 1) khusus untuk ini |
| **`/owner/tarif`** | Tabel rate card dengan `<FormTarif>` di setiap sel + `<details>` riwayat per baris | Daftar datar berpalet panel — bilah cari + chip saring `tarif` (`bertarif`/`belum`) & `aktif` (`ya`/`tidak`) + tabel ringkas tanpa formulir; setiap baris menaut ke halaman detail |
| **`/owner/tarif/[variantId]`** *(BARU)* | — (tidak ada) | Halaman detail per varian: status tarif berjalan, `<FormTarif>` penuh (kini Client Component tanpa tombol pembuka — langsung terbuka), riwayat tarif lengkap sebagai `<ul>`, bukan `<details>` (D3) |
| **`/owner/transport`** | Formulir tarif di dalam sel tabel empat jenjang; daftar sesi >20 km menunggu tanpa saring/paginasi | Formulir (keempat jenjang DAN tarif khusus per sesi) pindah ke panel geser `PanelGeser` (`?ubah=<jenjang>`, `?ubah=sesi-<id>`) (D1); daftar sesi menunggu dipaginasi JS |

---

## Runbook — baca sebelum meneruskan

### Tiga deviasi dari huruf spec (D1–D3) — diputuskan pemilik repo sebelum satu baris kode ditulis

Disalin utuh dari `docs/superpowers/plans/2026-09-09-padma-panel-owner.md` ("Deviasi dari
huruf spec — dicatat, bukan disembunyikan"):

- **D1 — Formulir tarif transport ikut pindah ke panel geser.** Arah awal berbunyi "tabel
  empat jenjangnya dibiarkan". Yang dibiarkan adalah **cari/saring/paginasi**-nya (tidak
  masuk akal untuk empat baris tetap); formulirnya tetap dipindah, karena keluhan inti klien
  adalah formulir di dalam sel tabel dan di halaman ini keluhan itu masih terjadi persis.
- **D2 — `/owner/rekap` memakai 8 kartu per halaman, bukan `PER_HAL = 25`.** Kartu pekan jauh
  lebih tinggi daripada baris tabel. Ini memaksa primitif `hitungRentang`/`jumlahHalaman`/
  `Paginasi` menerima ukuran halaman (Task 1) — perubahan kecil pada primitif bersama, bukan
  cabang kedua.
- **D3 — Riwayat tarif pindah dari `<details>` di baris daftar ke halaman detail
  `/owner/tarif/[variantId]`.** Riwayat adalah daftar anak, dan aturan repo berbunyi "punya
  daftar anak → halaman detail". Konsekuensinya riwayat tidak lagi terbaca dari daftar;
  sebagai gantinya ia selalu terender penuh di detail, bukan terlipat.

### Empat ruling preflight — tiga di antaranya memperbaiki teks rencana SEBELUM eksekusi

Disalin dari `progress.md` ("Rulings preflight"), bagian "Konsistensi internal tiap tugas"
menandai R1–R3 eksplisit sebagai **CACAT** di teks rencana — ketiganya ditemukan oleh
pemindaian preflight, sebelum implementer Task 3/4 menulis satu baris kode pun:

- **Ruling R1 (T3 Step 1)** — `expect(markup).not.toContain("<details")` diganti
  `expect(markup).not.toMatch(/Riwayat tarif/i)`. Sebab: `<Bantuan>`
  (`_shell/panel/bantuan.tsx:17`), yang dipakai halaman daftar itu sendiri, SENDIRI merender
  `<details>` — assertion aslinya mustahil hijau dan akan memaksa implementer membuang
  `<Bantuan>` demi ujinya.
- **Ruling R2 (T3 Step 1)** — `expect(hasil).toMatch(/Menampilkan 1 dari 1/)` diganti
  `expect(hasil).toMatch(/Menampilkan (\d+) dari \1\b/)` plus memastikan satu nama layanan
  uji LAIN tidak muncul. Sebab: layanan uji bisa punya lebih dari satu varian, dan baris rate
  card adalah per VARIAN; angka "1 dari 1" adalah tebakan tentang fixture, bukan tentang
  perilaku.
- **Ruling R3 (T4 Step 1)** — `expect(sumberForm).not.toContain("useState(false)")` diganti
  `expect(sumberForm).not.toMatch(/setTerbuka|\bterbuka\b/)`. Sebab: Step 3 tugas yang SAMA
  menyuruh menambah `const [sukses, setSukses] = useState(false)` — assertion aslinya
  menabrak resepnya sendiri.
- **Ruling keempat** — urutan eksekusi dikunci T1→T2→…→T10, karena T3↔T4 berbagi satu berkas
  uji dan T8 memindai hasil sapuan keempat tugas lainnya (T3/T4/T6/T7). Ini bukan perbaikan
  cacat teks, melainkan penguncian urutan supaya dua ketergantungan berbagi-berkas di atas
  tidak saling menabrak.

### Temuan struktural: trigger `trg_terbitkan_varian_baku` menerbitkan varian kembar

Migrasi `20260906130000_varian_baku_otomatis.sql` memasang trigger yang menerbitkan **satu
`service_variants` berlabel `""`** untuk SETIAP baris `services` yang lahir — dan
`service_variants` **tidak punya unique `(service_id, label)`**. Diverifikasi **dua kali
secara independen**: implementer Task 3 (query langsung ke `service_variants`, dua baris
`id` berbeda untuk `service_id` yang sama, `label` sama-sama `""`) dan reviewer Task 3 lewat
transaksi ROLLBACK terpisah ke Supabase lokal. Konsekuensi untuk penulis uji berikutnya:

- **Fixture apa pun yang menyisipkan `services` lalu menyisipkan varian eksplisit berlabel
  `""`** akan berakhir dengan DUA varian per layanan (satu dari trigger, tak-bertarif; satu
  dari fixture, bertarif) — trigger ini berlaku untuk Task 3, 4, dan 9 sekaligus (dicatat
  eksplisit di `progress.md`).
- **Assertion yang mencari varian lewat NAMA LAYANAN tidak bisa diandalkan** — baris rate
  card bekerja per VARIAN, bukan per layanan, dan layanan uji bisa punya >1 varian tanpa
  diminta. Targetkan **id varian** (baca lewat `.single()` bila memang harus tepat satu, atau
  bandingkan HARGA/nominal, bukan nama).
- Task 9 mengonfirmasi pola aman: fixture E2E-nya membaca varian baku lewat `.select("id")
  ...eq("service_id", idLayanan).single()` — `.single()` melempar bila baris ≠ 1, sehingga
  keberadaan tepat satu varian per layanan fixture itu TERJAMIN oleh kode, bukan diasumsikan.

### Pagar palet baru — `tests/panel-primitif.test.ts`

Test baru (Task 8) di dalam `describe("token visual panel")`: **"tidak ada berkas di
`src/app/owner` yang memakai palet PRA-PANEL"**. Pola terlarang yang dipindai di SELURUH
`src/app/owner`: `night`, `paper`, `gold-pale`, `bg-white`, `border-black/x`, `font-serif`.

**Sengaja TIDAK dilarang: `leaf`, `clay`** — keduanya aksen sah era panel, bukan sisa palet
klien lama. Reviewer Task 8 membuktikan pagar ini bergigi secara independen: menyisipkan
`text-night` sementara memerahkannya (dengan nama berkas di pesan galat), begitu pula
`bg-white` dan `font-serif`; menyisipkan `text-leaf`/`text-clay` TIDAK memerahkannya. Satu
temuan nyata dari pagar ini: `hover:text-night` di `owner/page.tsx:17` — sudah diperbaiki
sebelum Task 8 selesai.

### Kewajiban bagi siapa pun yang menambah rute `/owner` berikutnya

**Tambahkan rutenya ke pemeriksaan yang relevan di `tests/e2e/owner.e2e.ts` DAN jalankan
`npm run test:e2e:owner`.** Skrip ini satu-satunya yang membuktikan pagar crawl
money-firewall sungguhan bekerja — bukan hanya tertulis benar di kode — dan satu-satunya
yang membuka halaman di peramban sungguhan (Playwright, di atas `npm run build` +
`npm run start`, bukan `npm run dev`). `npm run test:e2e:owner` AMAN dijalankan; hanya
`test:e2e:video` dan `test:e2e:semua` yang dilarang total (keduanya mengunggah ke bucket
Cloudflare R2 PRODUKSI milik klien).

---

## Verifikasi menyeluruh

Dijalankan dari `web/`, 2026-09-09, di atas commit `0544877`. Angka disalin persis dari
terminal — tidak diringkas.

### Langkah 1 — suite penuh

```
$ npm test
 Test Files  2 failed | 163 passed (165)
      Tests  2 failed | 2500 passed (2502)
   Duration  188.56s
```

Dua kegagalan (lihat "Perhatian mendesak" di atas untuk analisis akar masalah):

```
FAIL  tests/inventaris-rute.test.ts > inventaris rute: README memetakan seluruh permukaan
      aplikasi > setiap rute di src/app terdaftar di tabel rute README
AssertionError: rute ini ada di src/app tetapi hilang dari tabel rute README:
/owner/tarif/[variantId]
- []
+ [ "/owner/tarif/[variantId]" ]

FAIL  tests/paket-tersembunyi.test.tsx > saklar paket: halaman owner tidak menyebut paket
      > halaman /owner/rekap tidak menyebut paket
TypeError: Cannot read properties of undefined (reading 'honor')
 ❯ uraikanParamDaftar src/app/_shell/panel/daftar.ts:50:28
 ❯ RekapPage src/app/owner/rekap/page.tsx:94:17
 ❯ render tests/paket-tersembunyi.test.tsx:48:5
```

Tidak ada satu pun dari kedua kegagalan ini yang menyentuh berkas yang didaftarkan sebagai
"Files" oleh brief Task 1–9 manapun — keduanya lolos dari setiap gerbang review tugas karena
setiap tugas hanya menjalankan uji di cakupannya sendiri (Global Constraint koordinasi
Supabase lokal menahan `npm test` PENUH sampai Task 10). Task 10 **tidak memperbaikinya** —
sesuai batasan tugas ini.

### Langkah 2 — build, tipe, lint

```
$ npm run build
✓ Compiled successfully
✓ Generating static pages using 11 workers (41/41)
```
41 rute berhasil dibangun, termasuk `/owner/tarif/[variantId]` (rute baru rencana ini) dan
seluruh rute `/owner` lainnya. Build sukses membuktikan kedua kegagalan Langkah 1 adalah
utang test-scaffolding/dokumentasi, BUKAN cacat produksi — App Router selalu mengoper
`searchParams` yang sah ke `page.tsx` sungguhan.

```
$ npx tsc --noEmit
(tidak ada keluaran — nol galat tipe)
```

```
$ npm run lint
✖ 11 problems (0 errors, 11 warnings)
```
Nol galat. Sebelas peringatan, seluruhnya pre-existing dan tidak berkaitan dengan rencana
ini: `atur-sandi/form-atur-sandi.tsx` (1, `no-location-assign-relative-destination`),
`daftar/form-daftar.tsx` (1, sama), `masuk/form-masuk.tsx` (1, sama),
`passport/ajukan/form.tsx` (1, `no-unused-vars`), `passport/materi/[id]/reader-pdf.tsx` (1,
`no-img-element`), `tests/cron-tenggat.test.ts` (2, `no-unused-vars`),
`tests/e2e/passport.e2e.ts` (1, `no-unused-vars`), `tests/grant-anon.test.ts` (1,
`no-unused-vars`), `tests/materi-video-r2.test.ts` (1, `no-unused-vars`),
`tests/transport-geocode.test.ts` (1, `no-unused-vars`). Tidak satu pun berasal dari berkas
yang disentuh rencana ini.

### Langkah 3 — buka halaman-halaman di peramban sungguhan

`npm run build && npm run start` dijalankan di latar (`localhost:3000`, log di
`/tmp/padma-owner-server.log`); port 3000 kosong sebelum dimulai dan dikonfirmasi kosong
lagi sesudah server dimatikan (`kill`).

**Batas pembuktian, dikatakan terus terang:** tidak ada alat automasi peramban (Playwright,
MCP browser, atau sejenisnya) tersedia di sesi Task 10 ini — hanya `curl` lewat Bash. `curl`
TIDAK bisa login (formulir `/masuk` melakukan `signInWithPassword` di JavaScript peramban,
menulis sesi ke `document.cookie`; tidak ada endpoint server yang bisa disuntik cookie lewat
POST biasa), jadi setiap permintaan `curl` ke rute `/owner/*` di sini TANPA sesi dan
diarahkan ulang (307) ke `/masuk` — itu cukup untuk membuktikan **lapisan routing/middleware
tidak crash 500**, tapi TIDAK membuktikan badan halaman (termasuk batas Server→Client formulir
baru) benar-benar terender di peramban sebagai pengguna owner.

Rute yang di-`curl` (semua 307, tanpa 500, log server bersih tanpa stack trace):

```
/owner                                                          -> 307
/owner/rekap                                                    -> 307
/owner/rekap?honor=belum                                        -> 307
/owner/rekap?hal=2                                               -> 307
/owner/rekap?cari=Bidan                                          -> 307
/owner/tarif                                                     -> 307
/owner/tarif?tarif=belum                                         -> 307
/owner/tarif/00000000-0000-0000-0000-000000000000                -> 307
/owner/transport                                                 -> 307
/owner/transport?ubah=jauh                                       -> 307
/owner/transport?ubah=sesi-00000000-0000-0000-0000-000000000000  -> 307
```

**Untuk pembuktian sesungguhnya di peramban asli sebagai owner, dengan formulir diisi dan
riwayat bertambah** — persis yang diminta Step 3 — rujukan yang sah adalah **Task 9**, yang
menjalankan `npm run test:e2e:owner` lewat Playwright (peramban sungguhan) di atas
`npm run build` + `npm run start`, PADA COMMIT YANG SAMA PERSIS (`0544877`) yang diverifikasi
di sini — Task 10 tidak mengubah satu baris kode pun sejak saat itu. Pemeriksaan 3 Task 9
membuka `/owner/tarif`, mengeklik baris ke `/owner/tarif/<variantId>`, mengisi
`<FormTarif>` (Client Component hasil Task 4), menekan submit, dan memverifikasi baris rate
card baru lahir di database — bukti langsung batas Server→Client formulir tarif tidak crash.
Pemeriksaan 1 & 6 membuka `/owner` sungguhan dan tautan pulang ke `/admin`. Pemeriksaan 2, 4,
5 membuka `/owner/rekap` sungguhan (termasuk aksi "Tandai dibayar").

**Satu kesenjangan nyata yang harus dikatakan terus terang: `/owner/transport` TIDAK PERNAH
dibuka di peramban sungguhan oleh siapa pun.** Tabel pasangan tugas di `progress.md` mencatat
eksplisit "T7 → T9 | `/owner/transport` | e2e tidak menyentuh transport | bersih" — E2E Task 9
sengaja tidak menyentuhnya. `/owner/transport` memakai `PanelGeser`, Client Component yang
memanggil `useRouter()` di badan komponennya (dicatat Task 7) — persis kelas cacat
"Functions cannot be passed directly to Client Components" yang jadi alasan Step 3 ini WAJIB
ada. Verifikasi `/owner/transport` sejauh ini terbatas pada: `renderToStaticMarkup` (uji unit,
66/66 hijau), `npm run build` (kompilasi sukses), `tsc`/lint bersih, dan `curl` tanpa sesi
(307, tidak 500). **Tidak satu pun dari itu membuktikan panel geser transport benar-benar
terbuka dan berfungsi di peramban sungguhan sebagai owner.** Ini concern nyata, bukan
formalitas — dicatat sebagai baris pertama tabel utang di bawah.

> **[DITUTUP oleh gelombang perbaikan penutup, 2026-09-09]** — dua pemeriksaan baru
> (`10.` dan `11.`) ditambahkan ke `tests/e2e/owner.e2e.ts`: `10.` membuka `/owner/transport`
> sungguhan sebagai owner dan membuktikan label jenjang + tabel rate card tampil tanpa crash;
> `11.` membuka `/owner/transport?ubah=<jenjang pertama>` dan membuktikan `PanelGeser`
> (`role="dialog"`) benar-benar TERLIHAT sesudah hidrasi peramban, lengkap dengan ketiga medan
> formulirnya (`getByLabel` untuk tarif klien, honor mitra, tanggal berlaku) — bukti langsung
> bahwa `useRouter()` di badan komponen `PanelGeser` TIDAK melempar "Functions cannot be
> passed directly to Client Components" saat dihidrasi sungguhan. Keluaran lengkapnya ada di
> "Verifikasi menyeluruh — gelombang perbaikan penutup" di bawah: **12/12 pemeriksaan lolos**.

### Sepuluh baris keluaran `catat()` E2E dari Task 9 — disalin apa adanya (SEBELUM gelombang perbaikan)

```
PASS  1. /owner menampilkan 'Panel Owner' dan ringkasan pekan berjalan
      PADMA Panel Owner Beranda Rekap Tarif Transport Buka Panel Admin Beranda P Pemilik PADMA Panel Owner Halo, Pemilik PADMA. Ringkasan pekan berjalan · 9 September 2026 SESI SELESAI PEKAN INI 0 Selesaika
PASS  2. /owner/rekap menampilkan honor mitra uji dengan tarif pada tanggal sesi
      mencari "E2E-OWNR Bidan 1788889379087" & Rp 666.000
PASS  3. /owner/tarif menampilkan nominal, dan tarif baru lahir sebagai BARIS BARU
      nominal lama tampil: true; baris: [{"harga_klien":777000,"honor_mitra":333000,"berlaku_sejak":"2020-01-06"},{"harga_klien":999000,"honor_mitra":555000,"berlaku_sejak":"2026-09-09"}]
PASS  4. rekap pekan yang sudah lewat TIDAK bergeser sesudah tarif naik
      masih Rp 666.000, bukan Rp 1.110.000
PASS  5. 'Tandai dibayar' melahirkan satu tanda Senin ber-ditandai_oleh uid OWNER
      tanda [{"week_start":"2026-08-31","ditandai_oleh":"69fbffb0-5e31-4327-a980-77cc772e45b2","dibayar_pada":"2026-09-08T17:43:15.665046+00:00"}]; week_start diharapkan 2026-08-31; tombol lenyap: true
PASS  6. owner punya jalan pulang yang bisa DIKLIK dari /owner ke /admin
      mendarat di /admin
PASS  8. KONTROL POSITIF: pemindai nominal MENEMUKAN keempat angka di /owner/tarif/<varian>
      ditemukan: ["777.000","333.000","999000","555000"]
PASS  7a. admin yang login DITOLAK di /owner
      mendarat di /admin
PASS  7b. nol nominal rate card di 11 rute /admin + 6 rute /passport
      17 rute diperiksa terhadap 22 nominal, nol temuan
PASS  9. seluruh data uji terhapus dan rate card klinik tidak ikut tersentuh
      layanan 0, mitra 0, klien 0, tarif uji 0

10/10 pemeriksaan lolos.
Panel owner terbukti utuh: rate card insert-only, rekap berriwayat tarif, tanda bayar beridentitas owner, dan nol nominal di seluruh rute admin & passport.
```

(Urutan cetak di konsol: pemeriksaan 8 tercetak SEBELUM 7a/7b karena kode memang menjalankannya
begitu — komentar di berkas menjelaskannya. Sepuluh baris di atas disalin persis dari
`.superpowers/sdd/2026-09-09-padma-panel-owner/task-9-report.md`, hanya disusun ulang
mengikuti nomor untuk laporan ini; isi tiap baris tidak diubah. Rute `/owner/transport` tidak
ada di antaranya — lihat kesenjangan Langkah 3 di atas.)

---

## Verifikasi menyeluruh — gelombang perbaikan penutup (2026-09-09, sesudah Task 10)

Dijalankan dari `web/`, sesudah menambahkan baris README, memperbaiki helper `render()` di
`tests/paket-tersembunyi.test.tsx`, dan menambah pemeriksaan `10.`/`11.` ke
`tests/e2e/owner.e2e.ts`. Angka disalin persis dari terminal.

### Langkah 1 — dua berkas yang tadinya merah

```
$ npx vitest run tests/inventaris-rute.test.ts tests/paket-tersembunyi.test.tsx
 Test Files  2 passed (2)
      Tests  37 passed (37)
```

### Langkah 2 — suite penuh

```
$ npm test
 Test Files  165 passed (165)
      Tests  2502 passed (2502)
   Duration  555.15s
```

**0 merah** — kedua kegagalan yang dicatat di "Perhatian mendesak" di atas sudah tertutup.

### Langkah 3 — build, tipe, lint

```
$ npm run build
✓ Compiled successfully
✓ Generating static pages using 11 workers (41/41)
```

```
$ npx tsc --noEmit
(tidak ada keluaran — nol galat tipe)
```

```
$ npm run lint
✖ 11 problems (0 errors, 11 warnings)
```
Sebelas peringatan sama persis dengan yang dicatat Task 10 di atas — seluruhnya pre-existing,
tidak satu pun berasal dari berkas yang disentuh gelombang perbaikan ini.

### Langkah 4 — E2E owner, di peramban sungguhan (`npm run build` + `npm run start` + Playwright)

```
$ npm run test:e2e:owner
PASS  1. /owner menampilkan 'Panel Owner' dan ringkasan pekan berjalan
      PADMA Panel Owner Beranda Rekap Tarif Transport Buka Panel Admin Beranda P Pemilik PADMA Panel Owner Halo, Pemilik PADMA. Ringkasan pekan berjalan · 9 September 2026 SESI SELESAI PEKAN INI 0 Selesaika
PASS  2. /owner/rekap menampilkan honor mitra uji dengan tarif pada tanggal sesi
      mencari "E2E-OWNR Bidan 1788894483970" & Rp 666.000
PASS  3. /owner/tarif menampilkan nominal, dan tarif baru lahir sebagai BARIS BARU
      nominal lama tampil: true; baris: [{"harga_klien":777000,"honor_mitra":333000,"berlaku_sejak":"2020-01-06"},{"harga_klien":999000,"honor_mitra":555000,"berlaku_sejak":"2026-09-09"}]
PASS  4. rekap pekan yang sudah lewat TIDAK bergeser sesudah tarif naik
      masih Rp 666.000, bukan Rp 1.110.000
PASS  5. 'Tandai dibayar' melahirkan satu tanda Senin ber-ditandai_oleh uid OWNER
      tanda [{"week_start":"2026-08-31","ditandai_oleh":"69fbffb0-5e31-4327-a980-77cc772e45b2","dibayar_pada":"2026-09-08T19:08:24.615222+00:00"}]; week_start diharapkan 2026-08-31; tombol lenyap: true
PASS  6. owner punya jalan pulang yang bisa DIKLIK dari /owner ke /admin
      mendarat di /admin
PASS  8. KONTROL POSITIF: pemindai nominal MENEMUKAN keempat angka di /owner/tarif/<varian>
      ditemukan: ["777.000","333.000","999000","555000"]
PASS  7a. admin yang login DITOLAK di /owner
      mendarat di /admin
PASS  7b. nol nominal rate card di 11 rute /admin + 6 rute /passport
      17 rute diperiksa terhadap 22 nominal, nol temuan
PASS  10. /owner/transport terbuka tanpa crash dan menampilkan label jenjang + tabel rate card
      PADMA Panel Owner Beranda Rekap Tarif Transport Buka Panel Admin Transport P Pemilik PADMA Transport Tentang halaman ini JENJANG JARAK TARIF KLIEN HONOR MITRA SUBSIDI PADMA BERLAKU SEJAK TETAPKAN 0–5 
PASS  11. /owner/transport?ubah=<jenjang> membuka PanelGeser sungguhan di peramban (hidrasi tidak crash) dengan medan formulirnya
      dialog terlihat: true; medan terlihat: true
PASS  9. seluruh data uji terhapus dan rate card klinik tidak ikut tersentuh
      layanan 0, mitra 0, klien 0, tarif uji 0

12/12 pemeriksaan lolos.
Panel owner terbukti utuh: rate card insert-only, rekap berriwayat tarif, tanda bayar beridentitas owner, dan nol nominal di seluruh rute admin & passport.
```

**12/12**, termasuk `10.` dan `11.` yang baru — inilah bukti peramban-sungguhan yang tadinya
hilang: `/owner/transport` terbuka tanpa crash, dan `PanelGeser`-nya (Client Component yang
memanggil `useRouter()` di badan komponen) terbukti hidrasi dengan benar (`role="dialog"`
terlihat, ketiga medan formulir terlihat) alih-alih melempar "Functions cannot be passed
directly to Client Components".

---

## Tabel utang

Diurutkan menurut nilai/urgensi. Baris 1 dan 2 berstatus **DITUTUP** oleh gelombang perbaikan
penutup (2026-09-09) — dipertahankan di sini, bukan dihapus, sebagai catatan bahwa keduanya
BENAR pernah ada dan hanya ditangkap oleh `npm test` PENUH, bukan oleh sepuluh review
per-tugas.

| # | Utang | Kenapa ditunda |
|---|---|---|
| 1 | **[DITUTUP]** ~~`/owner/transport` tidak pernah dibuka di peramban sungguhan.~~ E2E Task 9 sengaja tidak menyentuhnya (dicatat eksplisit di `progress.md`). `PanelGeser` (Client Component, `useRouter()` di badan komponen — dicatat Task 7) adalah persis kelas risiko Server→Client yang jadi alasan Step 3 verifikasi ini wajib ada, tapi belum ada bukti peramban-sungguhan untuknya di rencana 3B manapun. `curl` tanpa sesi hanya membuktikan tidak crash 500 sebelum redirect login; tidak membuktikan panel geser terbuka & berfungsi. | Task 10 tidak berwenang menjalankan `npm run test:e2e:owner` dengan skenario baru (di luar cakupan brief), dan tidak punya alat automasi peramban di sesi ini. **Ditutup oleh gelombang perbaikan penutup**: pemeriksaan `10.`/`11.` ditambahkan ke `tests/e2e/owner.e2e.ts`, dijalankan lewat `npm run test:e2e:owner` di peramban sungguhan — 12/12 lolos, lihat "Verifikasi menyeluruh — gelombang perbaikan penutup". |
| 2 | **[DITUTUP]** ~~Dua kegagalan `npm test` baru~~ — `tests/inventaris-rute.test.ts` (README belum menyebut `/owner/tarif/[variantId]`) dan `tests/paket-tersembunyi.test.tsx` (`RekapPage` dipanggil tanpa `searchParams` oleh helper `render()` berkas itu sendiri, sisa dari Task 6 mengubah tanda tangan `RekapPage`). Lihat "Perhatian mendesak" di atas untuk analisis lengkap. Bukan cacat produksi (build sukses membuktikannya), tapi BENAR merah di suite. | Task 10 tidak memperbaiki kode — kedua ini ditemukan justru oleh Task 10 sendiri (baru pertama kali `npm test` PENUH dijalankan sejak Task 1). **Ditutup oleh gelombang perbaikan penutup**: baris README ditambahkan, helper `render()` diperbaiki untuk memanggil `RekapPage(SP())` — `npm test` PENUH sesudahnya: 165 berkas lolos, 2502 uji lolos, 0 merah. |
| 3 | **Paginasi JS di atas daftar yang SUDAH terbaca seluruhnya** — tiga tempat baru di rencana ini: `saringRateCard()` (`src/lib/owner/daftar-tarif.ts:60`, `cocok.slice(dari, sampai + 1)` di atas `ambilRateCard()` yang membaca `phases`/`services`/`service_variants`/SELURUH `variant_rates` tanpa `.range()`), `saringRekap()` (`src/lib/owner/daftar-rekap.ts:50`, sama, di atas `ambilRekap()` yang menghitung SELURUH pekan di TypeScript), dan potongan daftar sesi transport (`src/app/owner/transport/page.tsx:55`, `menunggu.slice(dari, sampai + 1)`). Ketiganya memperbaiki LAYAR dan biaya render — `max_rows = 1000` di `supabase/config.toml` **tetap terbuka** untuk bacaan yang mendasarinya. Komentar di kedua berkas `lib/owner/*` sudah menyalin peringatan ini secara eksplisit dan merujuk `daftarTagihanAdmin()` (`src/lib/admin/tagihan.ts:293-300`) sebagai pola yang sama. | Sama seperti utang #1 kedua runbook sebelumnya (rencana fondasi & sapuan modul) — obatnya view SQL atau RPC hitung-per-grup, di luar bobot rencana ini. Untuk rekap khususnya, menutupnya lebih rumit: tarif harus dicocokkan ke TANGGAL SESI, jadi seluruh riwayat tarif memang harus terbaca apa pun caranya. |
| 4 | **Label `KelompokSaring` yang tidak pernah dirender (utang #5 runbook sapuan modul) kini menyentuh dua halaman owner juga.** `/owner/tarif` memakai `<BilahDaftar kelompok={[...]}>` dengan DUA kelompok chip berdampingan (`tarif`, `aktif`) tanpa penanda batas visual; `/owner/rekap` memakai satu kelompok (`honor`) — lebih ringan, tapi masih mewarisi primitif yang sama tanpa label kelompok terlihat. Total halaman yang kena utang ini di seluruh repo sekarang: tujuh (`admin`) + dua (`owner`) = sembilan. | Sama seperti sebelumnya: menampilkannya mengubah tata letak bilah di sembilan halaman sekaligus — keputusan visual yang butuh persetujuan sebelum disentuh, bukan cacat yang bisa diperbaiki sepintas. |
| 5 | **Warisan rencana fondasi & sapuan modul yang masih terbuka**, tidak disentuh rencana ini: `max_rows = 1000` untuk `ambilDaftarLayanan()`/`ambilLayanan()`/`daftarTagihanAdmin()` (utang #1 runbook sapuan), saringan `isi=belum` Materi menyaring halaman-yang-sudah-diambil bukan seluruh daftar (utang #2), enam berkas `/admin` masih berpalet klien lama (utang #4), `text-panel-muted` di atas `bg-panel-bg` ~4,4:1 sedikit di bawah ambang AA (utang #8), serta seluruh warisan dari rencana fondasi (money firewall nominal telanjang — **sudah ditutup**; seed klien tanpa alamat; `hal` dijepit dua tempat; dst.). | Di luar cakupan rencana panel owner — dicatat di sini hanya supaya pembaca tidak mengira semuanya sudah tuntas karena tidak disebut ulang penuh. |

---

## Cacat yang lahir dari teks rencana ini sendiri

Runbook rencana sapuan modul (pendahulu langsung rencana ini) mencatat **sepuluh** cacat
lahir dari teks brief-nya sendiri, seluruhnya ditangkap implementer/reviewer dan **nol** oleh
penulis rencana. Untuk rencana panel owner ini, dihitung dari `progress.md` dan laporan
sembilan tugas: **lima cacat**, dengan pola tangkapan yang sama — nol oleh penulis rencana
saat menulisnya, tapi kali ini **tiga di antaranya tertangkap sebelum eksekusi** (pemindaian
preflight yang menulis `progress.md`), bukan hanya oleh implementer/reviewer saat mengerjakan:

1. **R1** — assertion `expect(markup).not.toContain("<details")` di draf Step 1 Task 3
   mustahil hijau karena `<Bantuan>` sendiri merender `<details>`. **Ditangkap oleh
   pemindaian preflight**, sebelum Task 1 dimulai.
2. **R2** — assertion `expect(hasil).toMatch(/Menampilkan 1 dari 1/)` di draf Step 1 Task 3
   menebak jumlah varian fixture, bukan menguji perilaku saring. **Ditangkap oleh pemindaian
   preflight**, sebelum Task 1 dimulai.
3. **R3** — assertion `expect(sumberForm).not.toContain("useState(false)")` di draf Step 1
   Task 4 menabrak Step 3 tugas yang SAMA, yang menyuruh menambah
   `useState(false)` untuk state `sukses`. **Ditangkap oleh pemindaian preflight**, sebelum
   Task 1 dimulai.
4. **Assertion `not.toContain("PAD-UJI Tarif Layanan Mundur")`** di draf Step 1 Task 3 (baris
   506 rencana) gagal secara deterministik — trigger `trg_terbitkan_varian_baku` menerbitkan
   varian baku kembar untuk layanan itu, dan assertion aslinya menguji NAMA layanan padahal
   saringan bekerja per VARIAN. **Ditangkap oleh implementer Task 3 saat eksekusi**,
   direproduksi 5× berturut-turut untuk memastikan bukan flake sesi paralel, diganti
   assertion berbasis harga.
5. **`await page.waitForTimeout(600)`** di draf Step 3 Task 9 (baris 1866 rencana) tidak
   cukup di atas build produksi — tombol simpan tarif baru masih berstatus "Menyimpan…" pada
   600ms, membuat pemeriksaan 3 gagal (baris `variant_rates` tetap 1, bukan 2) tanpa
   melempar error. **Ditangkap oleh implementer Task 9 saat eksekusi**, diukur lewat
   `console.log` sementara sebelum diganti `waitFor` berbasis peristiwa (menunggu teks
   "tersimpan sebagai baris baru").

Tidak dihitung sebagai cacat teks rencana (dicatat terpisah karena kategorinya beda):
Task 1 sempat mengubah `layout.tsx` di luar brief karena kesalahan MENAFSIRKAN galat
`LayoutProps` sebagai permanen (keputusan implementer, ditangkap reviewer, di-revert) — bukan
sesuatu yang salah di teks rencana. Task 6 menemukan `NAMA_MITRA` belum ada sebagai konstanta
padahal brief menganggapnya sudah ada — tapi brief itu SENDIRI sudah menyediakan jalan keluar
eksplisit ("bila namanya berbeda, pakai konstanta mitra uji yang sungguhan ada"), jadi ini
asumsi yang terpagar, bukan cacat tak terantisipasi.

---

## Catatan proses

Pola yang sama berulang di ketiga rencana panel sejauh ini (fondasi, sapuan modul, owner):
**kode uji dan teks rencana sama-sama butuh mata kedua.** Kali ini pemindaian preflight
menangkap tiga dari lima cacat SEBELUM implementer sempat menyentuhnya — perbaikan proses
nyata dibanding rencana sapuan modul, yang sepuluh cacatnya seluruhnya baru ketahuan saat
implementasi berjalan. Dua cacat sisanya (assertion trigger varian kembar, `waitForTimeout`)
tidak bisa ditangkap preflight karena keduanya butuh eksekusi sungguhan terhadap Supabase
lokal/build produksi untuk terlihat — preflight yang membaca teks saja tidak akan
menemukannya.

Task 10 sendiri menambah satu temuan kelas baru ke daftar ini: **suite penuh yang baru
pertama kali dijalankan di ujung rencana menemukan dua regresi lintas-tugas** (README route
table, helper `render()` di berkas uji tak-terkait) yang tidak satu pun brief per-tugas
berwenang menangkap karena keduanya hidup di luar cakupan "Files" setiap brief. Ini argumen
tambahan untuk melakukan `npm test` PENUH lebih sering di sepanjang rencana multi-tugas —
bukan hanya di ujungnya — meskipun Global Constraint koordinasi Supabase lokal proyek ini
membuat itu mahal untuk dilakukan di setiap tugas.

**Gelombang perbaikan penutup (2026-09-09)** menutup ketiga temuan Task 10 dalam satu
gelombang, tanpa melonggarkan satu assertion pun: baris README ditambahkan mengikuti gaya
baris yang sudah ada; helper `render()` di `paket-tersembunyi.test.tsx` diperbaiki untuk
memanggil `RekapPage` dengan `searchParams` (yang diuji — pagar saklar `PAKET_TAMPIL` — tidak
disentuh sama sekali, hanya cara memanggilnya); dan dua pemeriksaan baru ditambahkan ke
`tests/e2e/owner.e2e.ts` yang membuktikan `/owner/transport` beserta `PanelGeser`-nya hidup di
peramban sungguhan. Pelajaran yang paling penting untuk diingat justru pelajaran yang
mendahului perbaikan ini: **dua regresi nyata lolos dari sepuluh review per-tugas dan hanya
tertangkap saat `npm test` PENUH dijalankan untuk pertama kalinya** — itulah sebabnya seluruh
narasi "Perhatian mendesak" dan baris tabel utang di atas dipertahankan apa adanya, bukan
dihapus, meski keduanya kini sudah ditutup.

---

## Gelombang perbaikan kedua — dua Important dari REVIEW MENYELURUH (2026-09-09)

**Laporan lengkap:**
`.superpowers/sdd/2026-09-09-padma-panel-owner/fix-wave-2-report.md`

Sesudah gelombang penutup di atas mendarat, satu review MENYELURUH cabang `panel-owner`
(bukan lagi per-tugas) memberi verdict **SIAP DENGAN SYARAT: nol Critical, dua Important**.
Ini bukan pengulangan pelajaran suite-penuh di atas — kedua Important ini punya bentuk yang
BERBEDA dan LEBIH SULIT ditangkap: keduanya lahir dari **gabungan dua tugas yang masing-masing
benar sendiri-sendiri**, jadi tidak satu pun dari sepuluh review per-tugas (yang masing-masing
hanya melihat diff tugasnya sendiri) *bisa* melihatnya — bukan sekadar tidak melihatnya.

### I1 — `FormTarifTransport` kehilangan sinyal suksesnya

`web/src/app/owner/transport/form-tarif-transport.tsx`. Tugas 7 (formulir transport pindah ke
panel geser) membuang state `terbuka` DENGAN BENAR — sebelum tugas itu, sukses menjalankan
`setTerbuka(false)` dan formulir mengatup kembali jadi tombol, dan itulah satu-satunya sinyal
suksesnya. Sesudah tugas itu formulir hidup permanen di dalam `PanelGeser`, sehingga
"mengatup" bukan lagi hal yang bisa terjadi — tapi cabang suksesnya tidak pernah diganti
sesuatu yang lain: ia cuma `setPesan(null)`. Owner menekan "Simpan tarif", panel tetap
terbuka, medan tetap berisi angka lama, dan tidak ada satu kata pun di layar yang bilang
tarifnya tersimpan (tabel di belakang memang tersegarkan, tapi tertutup overlay
`bg-black/30`). Tidak satu pun review Tugas 7 bisa menangkap ini sendirian — brief-nya benar
tentang panel geser, dan hilangnya sinyal sukses hanya terlihat bila dibandingkan dengan
KEADAAN SEBELUM tugas itu berjalan.

**Perbaikan:** disejajarkan ke pola `FormTarif` (`owner/tarif/form-tarif.tsx`) — state
`sukses` boolean + paragraf `text-leaf` yang muncul BERDAMPINGAN dengan formulir (bukan
menggantinya). Dipilih ketimbang pola `FormTarifKhusus` (state `selesai`, MENGGANTI seluruh
formulir dengan paragraf) karena alasan struktural: `FormTarifKhusus` boleh mengganti
formulirnya karena sesi >20 km hanya bisa ditetapkan SEKALI dan lenyap dari daftar sesudahnya
— tidak ada alasan menjaga formulir tetap ada. `FormTarifTransport` sebaliknya INSERT-ONLY
persis seperti `FormTarif`: owner boleh langsung menetapkan tarif jenjang berikutnya di panel
yang sama, jadi formulirnya harus tetap hidup di layar sesudah sukses. Teks suksesnya
menyebut kenyataan yang benar untuk transport (baris baru bertanggal berlaku, bukan
penimpaan), bukan disalin kata demi kata dari `FormTarif`.

Uji baru: `tests/owner-transport.test.ts` — "FormTarifTransport punya sinyal sukses, dan
tidak dirender sebelum ada yang tersimpan" — memeriksa bentuk sumbernya (state `sukses`,
`setSukses(true)`, teks sukses menyebut "baris baru") DAN membuktikan `renderToStaticMarkup`
dari state awal (belum ada aksi yang jalan) tidak pernah memuat teks sukses itu.

### I2 — `tetapkanTarif` tidak menyegarkan rute detail yang lahir dari tugas lain

`web/src/app/owner/tarif/aksi.ts` (fungsi `tetapkanTarif`). Aksi ini menyegarkan
`/owner/tarif`, `/owner/rekap`, dan `/owner` — tiga rute yang sudah ada saat berkas action ini
ditulis. Rute detail `/owner/tarif/[variantId]` lahir BELAKANGAN, di tugas lain, dan tidak ada
brief yang menyambungkan keduanya: brief tugas action tidak tahu rute detail akan lahir; brief
tugas rute detail tidak berwenang menyentuh berkas action milik tugas sebelumnya. Konvensi
repo (`admin/klien/aksi.ts`, `admin/materi/aksi.ts`) justru selalu menyegarkan induk DAN anak
dinamisnya sekaligus — celah ini adalah satu-satunya tempat di seluruh rencana panel owner
yang menyimpang dari konvensi itu, dan hanya kelihatan bila membaca action DAN halaman detail
BERSAMAAN.

Ini lebih dari kelalaian gaya: `form-tarif.tsx` mencetak klaim di layar — *"Tarif baru
tersimpan sebagai baris baru. Riwayat di bawah ikut bertambah."* — dan sebelum perbaikan ini
tidak satu pun uji membuktikan riwayat di layar (bukan di database) memang bertambah sesudah
simpan TANPA reload penuh. Router cache Next bisa saja menahan halaman detail tetap
menampilkan tarif lama saja sesudah aksi sukses, persis karena `revalidatePath` untuk rute itu
tidak pernah dipanggil — dan E2E pemeriksaan 3 sebelumnya menunggu teks sukses lalu langsung
membaca BASIS DATA, melewati layar sama sekali.

**Perbaikan:** `revalidatePath(\`/owner/tarif/${variantId}\`)` ditambahkan mengikuti bentuk
`admin/klien/aksi.ts`/`admin/materi/aksi.ts` persis (induk lalu anak dinamis). Uji baru:
`tests/owner-tarif.test.ts` — "menyegarkan rekap & beranda owner, bukan hanya halaman
tarifnya" diperluas memeriksa rute detail ikut ke daftar `jejak.revalidate`. **Celah
buktinya ikut ditutup**: `tests/e2e/owner.e2e.ts` pemeriksaan 3 sekarang punya pemeriksaan
tambahan `3b.` — sesudah menunggu teks sukses, membaca teks TERLIHAT halaman (tab yang sama,
TANPA reload) dan menegaskan tarif LAMA dan BARU (empat nominal) sama-sama tampak. Assertion
basis data yang sudah ada (`dua`, `lamaUtuh`, `baruBenar`) TIDAK diubah — hanya ditambah.

### Kenapa sepuluh review per-tugas melewatkan keduanya

Pelajaran ini setara nilainya dengan pelajaran "suite penuh menemukan dua regresi" di gelombang
pertama, tapi bentuknya berbeda dan layak dicatat terpisah:

- Regresi gelombang pertama (README, helper test) tertangkap `npm test` PENUH karena
  keduanya adalah kegagalan MEKANIS — assertion yang benar-benar merah, terlihat begitu
  dijalankan bersama, di mana pun sumbernya.
- I1 dan I2 TIDAK merah di satu pun uji otomatis yang ada sebelum gelombang ini — keduanya
  cacat SEMANTIK (sinyal sukses hilang; rute yang seharusnya disegarkan tidak disegarkan) yang
  lolos karena masing-masing setengah dari cerita benar sendirian: Tugas 7 benar tentang panel
  geser; Tugas action benar tentang tiga rute yang ada SAAT itu ditulis. Review per-tugas
  membaca diff SATU tugas terhadap HEAD sebelumnya — tidak satu pun dari sepuluh review itu
  pernah diminta membandingkan Tugas 7 dengan KEADAAN SEBELUM cabang ini dimulai (untuk I1),
  atau membaca berkas action bersama halaman detail yang lahir di tugas lain (untuk I2).
  Satu-satunya cara menangkap kelas cacat ini adalah review yang membaca CABANG UTUH sebagai
  satu kesatuan — persis yang dilakukan review menyeluruh ini.

**Kesimpulan untuk rencana multi-tugas berikutnya:** suite penuh (`npm test`) menjaga terhadap
regresi MEKANIS lintas-tugas; review menyeluruh di ujung cabang menjaga terhadap regresi
SEMANTIK lintas-tugas yang tidak pernah memicu satu assertion pun sampai seseorang membaca
gabungan dua tugas berdampingan. Keduanya perlu, dan tidak saling menggantikan.

### Verifikasi gelombang kedua

Lihat `.superpowers/sdd/2026-09-09-padma-panel-owner/fix-wave-2-report.md` untuk keluaran
lengkap `npm test`, `npm run test:e2e:owner`, `npm run build`, `tsc --noEmit`, dan
`npm run lint` sesudah I1/I2 diperbaiki.

---

## Tabel utang — tambahan gelombang kedua (minor, dicatat tapi ditunda)

Ditemukan review menyeluruh yang sama yang menutup I1/I2. Reviewer menilai keenamnya sah
ditunda — tidak satu pun mengancam benar/salahnya nominal atau keamanan — tapi tidak boleh
dibiarkan tak tercatat.

| # | Utang | Kenapa ditunda |
|---|---|---|
| 6 | Kartu sesi >20 km di `/owner/transport` dipaginasi 25/halaman, padahal alasan deviasi D2 (kartu jauh lebih tinggi daripada baris tabel, karena itu `/owner/rekap` memakai 8/halaman) berlaku SAMA PERSIS untuk kartu sesi transport — belum pernah disesuaikan. | Keputusan visual (ukuran halaman) yang sama seperti D2 sendiri — butuh persetujuan pemilik repo sebelum diubah, bukan cacat yang aman diperbaiki sepintas dalam gelombang penutup bug. |
| 7 | `transport/page.tsx` merender "Menampilkan N dari M" DI ATAS cabang kosong, jadi halaman tanpa sesi menunggu berbunyi "Menampilkan 0 dari 0" lalu "Tidak ada sesi >20 km…" (dua kalimat yang bersaing menjelaskan hal yang sama); dan `?hal=9` (halaman di luar jangkauan) merender daftar kosong tanpa penjelasan apa pun — `/owner/tarif` dan `/owner/rekap` keduanya sudah menjelaskan diri untuk kasus ini, `/owner/transport` belum. | Perbaikan kecil tapi menyentuh urutan render & kondisi kosong yang sudah "bekerja" (tidak crash, tidak salah data) — ditunda demi tidak memperbesar gelombang perbaikan bug dengan poles UI yang tidak diminta review. |
| 8 | Empat tempat memotong halaman (paginasi) di JavaScript dengan ejaan sedikit berbeda satu sama lain: `lib/owner/daftar-tarif.ts`, `lib/owner/daftar-rekap.ts`, `app/owner/transport/page.tsx`, dan `lib/admin/tagihan.ts` yang sudah ada sebelum rencana ini. Sebuah `potongHalaman(baris, hal, perHal)` bersama di `_shell/panel/daftar.ts` akan buta peran (admin/owner) dan merapikan keempatnya sekaligus. | Refactor lintas-modul yang menyentuh berkas admin DAN owner sekaligus — di luar bobot gelombang perbaikan bug ini; layak jadi tugas tersendiri dengan review sendiri. |
| 9 | `tests/owner-rekap-halaman.test.ts` — uji "cari menyaring PEKAN" lebih longgar daripada padanannya di `owner-tarif.test.ts`: ia tetap HIJAU bila halaman diam-diam membuang parameter `cari` sepenuhnya, karena hanya menegaskan nama mitra yang dicari ADA di hasil, tidak pernah menegaskan nama yang TIDAK cocok memang HILANG. Padanan di `owner-tarif.test.ts` menegaskan keduanya. | Memperketat assertion ini di luar cakupan I1/I2 dan berisiko menyentuh berkas uji rekap yang tidak diminta review — dicatat sebagai utang test-coverage murni, aman ditunda karena perilaku produksinya sendiri sudah benar (dibuktikan tidak langsung oleh uji lain di berkas yang sama). |
| 10 | Kata-kata tautan kembali di `/owner/tarif/[variantId]` ("‹ Rate Card") menyimpang dari konvensi `/admin` ("‹ Kembali ke Layanan") — pola "‹ Kembali ke X" tidak diikuti di sini. | Kosmetik murni, tidak mengubah perilaku — ditunda sebagai poles teks yang butuh keputusan penamaan (bahasa Indonesia konsisten), bukan perbaikan bug. |
| 11 | `/owner/tarif` kehilangan spanduk "N varian aktif belum punya tarif" yang ada di rencana sebelumnya; chip `menuntut` yang menggantikannya tidak membawa angka, jadi owner harus mengklik chip itu dulu untuk tahu ada berapa varian yang menuntut tarif. | Regresi kegunaan kecil dari perubahan D3 (rate card jadi daftar datar) — perbaikannya butuh keputusan desain (di mana angka itu ditaruh di layout baru), bukan sekadar tambal kode. |

---

## Catatan proses — gelombang kedua

Pelajaran gelombang pertama: **suite penuh (`npm test`) menangkap regresi lintas-tugas yang
tidak tertangkap review per-tugas, karena regresinya MEKANIS** (assertion yang benar-benar
merah begitu dijalankan bersama).

Pelajaran gelombang kedua, dan levelnya SETARA — bukan pengulangan: **review MENYELURUH di
ujung cabang menangkap dua Important yang sepuluh review per-tugas tidak mungkin lihat, karena
regresinya SEMANTIK** — kehilangan sinyal sukses (I1) dan rute yang seharusnya disegarkan tapi
tidak (I2) — dan keduanya lahir dari GABUNGAN dua tugas yang masing-masing benar terhadap diff
sendirian. Review per-tugas hanya melihat diff tugasnya sendiri terhadap HEAD sebelumnya; tidak
satu pun brief sepuluh tugas rencana ini meminta pembanding "Tugas X dibandingkan dengan
KEADAAN SEBELUM cabang dimulai" atau "berkas action ini dibaca bersama halaman detail yang
lahir tugas lain". Review menyeluruh di ujung cabang, yang membaca seluruh diff sebagai SATU
kesatuan, adalah satu-satunya titik di seluruh proses yang punya sudut pandang untuk
menangkap kelas cacat ini.

**Kesimpulan gabungan kedua gelombang, untuk rencana multi-tugas berikutnya:** tiga lapis
verifikasi menjaga terhadap tiga kelas regresi yang berbeda dan tidak saling menggantikan —
review per-tugas (cacat lokal dalam satu diff), suite penuh (regresi mekanis lintas-tugas),
dan review menyeluruh di ujung cabang (regresi semantik lintas-tugas, lahir dari gabungan dua
tugas yang masing-masing benar sendirian). Melewatkan salah satu lapis bukan berarti lapis
lain otomatis menutupnya — I1 dan I2 sama sekali tidak memicu satu uji pun sampai review
menyeluruh ini membacanya.
