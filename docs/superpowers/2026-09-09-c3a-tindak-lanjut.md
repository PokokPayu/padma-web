# C3-a — fondasi pembatalan: tindak lanjut

Spec: `docs/superpowers/specs/2026-09-09-padma-c3-pembatalan-design.md`
Rencana: `docs/superpowers/plans/2026-09-09-padma-c3a-fondasi-pembatalan.md`
Selesai & ter-merge: 9 September 2026. Bagian C berikutnya: **C3-b** (klien
menekan sendiri) dan **C3-c** (permintaan refund sungguhan).

Suite saat pemeriksaan Task 7 (`npx vitest run`, setelah perbaikan regresi di
bawah): **2.560 uji di 169 berkas — 2.554 lolos, 6 gagal di 4 berkas**; keempat
berkas itu gagal karena debris basis data lokal bersama, bukan regresi kode
(lihat bagian tersendiri di bawah). Sebelum perbaikan, jalannya pertama
menunjukkan 7 uji gagal di 5 berkas — satu di antaranya
(`tests/admin-sesi-daftar.test.ts`) regresi nyata dan sudah diperbaiki.
`npm run lint`: **0 error, 12 warning** (semuanya sudah ada sebelum C3-a,
tidak disentuh rencana ini).
`npm run build` (Turbopack, bawaan Next 16): gagal di worktree ini karena
Turbopack menolak symlink `node_modules` yang menunjuk keluar akar worktree
— murni gangguan lingkungan; `next build --webpack` (type-check penuh
termasuk `tests/`) dan `npm run build` biasa di checkout non-worktree
keduanya **hijau, 0 error**. Rincian di bagian "Yang perlu disiapkan" dan
laporan Task 7.

## Yang sekarang berlaku

### 1. Rantai status sesi, dan mengapa dua "batal" tidak disatukan

```
terjadwal ──┬─→ berjalan ──┬─→ selesai
            │              └─→ tidak_hadir
            ├─→ dibatalkan_padma   (staf + alasan terisi, TANPA darurat)
            └─→ dibatalkan_klien   (klien sendiri — atau staf ATAS NAMA klien
                                    lewat darurat medis; jenjang dari WAKTU)
```

`dibatalkan_klien` dan `dibatalkan_padma` **sengaja tidak disatukan** menjadi
satu nilai `dibatalkan`, walau keduanya sama-sama "sesi ini tidak jadi
berjalan". Alasannya dua, dan keduanya nyata:

- **Status adalah catatan tentang SIAPA, bukan tentang APA.** Setiap layar dan
  setiap laporan yang kelak dibangun di atas tabel ini (rekap owner, riwayat
  klien) butuh menyebut siapa yang membatalkan tanpa membuka `jejak_jadwal`.
  Menyatukannya membuat pertanyaan itu hanya terjawab lewat join ke tabel
  jejak — informasi yang sebenarnya sudah ada di baris `sessions` itu sendiri
  hilang begitu disatukan.
- **Akibat uangnya berbeda, dan bukan kebetulan.** Jenjang 4 (PADMA
  membatalkan) SELALU refund penuh — klinik yang berhalangan bukan tanggungan
  klien. Klien yang membatalkan sendiri tunduk pada jenjang WAKTU (≥24 jam =
  refund, 2–24 jam = hak sesi, <2 jam = hangus). `batalkan_sesi()` menentukan
  jenjang & status dari SATU pasang syarat (`staf && alasan terisi && bukan
  darurat` → jenjang 4; selain itu → jenjang dari waktu), dan siapa pun yang
  menyatukan kedua status akan merasa sedang "menyederhanakan" — padahal yang
  hilang adalah kemampuan membedakan kedua aturan uang itu di baris manapun
  yang hanya menyimpan status, tanpa jejak.

### 2. Kembaran rumus jenjang: TS menerangkan, SQL memutuskan

Rumus "berapa lama lagi sebelum sesi, jadi jenjang berapa" ada di DUA tempat:

- `jenjangPembatalan()` — `web/src/lib/pembatalan/jenjang.ts`, murni,
  menerima `sekarang` sebagai argumen supaya bisa diuji di ambangnya.
- `jenjang_pembatalan(tanggal, jam)` — SQL, migrasi
  `20260913102000_rpc_pembatalan.sql`, membaca `now()` sendiri.

Kembaran ini **disengaja**, mengikuti pola yang sama dengan `jarak_km` vs
`haversineKm` (C1). Pembagian kerjanya bukan duplikasi sembarangan:

- **TypeScript MENERANGKAN** — dipakai untuk menampilkan ke admin/klien apa
  yang AKAN terjadi ("sisa waktu X jam, jenjang Y, klien akan menerima Z")
  SEBELUM tombol ditekan. Salah di sini berarti UI menyesatkan, bukan uang
  salah jalan.
- **SQL MEMUTUSKAN** — dipanggil di dalam `batalkan_sesi()` dan
  `jadwal_ulang_sesi()`, dan hasilnya itulah yang menentukan status baris dan
  apakah `hak_sesi` terbit. RPC-nya `security definer`; permukaan tulis yang
  dibuka pemanggil hanya `sesi_id`, `alasan`, `darurat` — jenjang TIDAK
  PERNAH diterima sebagai argumen, persis karena nilai yang bisa dikirim
  peramban adalah nilai yang bisa dinaikkan sendiri oleh klien.

**Bila keduanya berselisih, yang berlaku adalah basis data.** UI yang salah
menampilkan jenjang adalah bug tampilan yang bisa diperbaiki tanpa menyentuh
uang siapa pun; RPC yang salah menghitung jenjang adalah bug yang sudah
menulis baris. Pasangan ini dijaga agar tidak diam-diam berselisih — pola yang
sama dengan `tests/jarak-sql-vs-ts.test.ts` untuk jarak — sehingga perbaikan
salah satu sisi tanpa sisi lain gagal di suite, bukan di produksi.

### 3. `jenjang_pembatalan` harus `stable`, bukan `immutable`

Badan fungsi membaca `now()`:

```sql
create or replace function public.jenjang_pembatalan(tanggal date, jam time)
returns smallint
language sql
stable          -- BUKAN immutable
...
```

Postgres **mempercayai label ini tanpa memeriksa isinya** — tidak ada
pemeriksaan statis bahwa fungsi `immutable` benar-benar tidak membaca apa pun
di luar argumennya. Kalau fungsi ini ditandai `immutable`, planner boleh
melipatnya menjadi konstanta pada waktu parse, memakainya di indeks
fungsional, atau membekukan hasilnya dalam rencana query yang di-cache
(prepared statement, function inlining lintas panggilan). Jenjang yang
membeku adalah jenjang yang berhenti mengikuti waktu — dan yang berhenti
bersamanya adalah uang klien: sesi yang tadinya jenjang 1 (refund) bisa
tampak beku sebagai jenjang 1 walau jamnya sudah lewat ambang 24 jam,
tergantung kapan rencana query itu terakhir disusun. `stable` cukup: hasilnya
boleh berbeda antar pemanggilan (karena `now()`), tapi konsisten dalam satu
pernyataan/transaksi — persis yang dibutuhkan `batalkan_sesi()` yang
memanggilnya sekali per eksekusi.

### 4. Pagar jam tidak diwarisi — kenapa RPC-nya wajib `security definer`

`guard_booking_pembatas` adalah trigger `before insert on booking_requests`.
Ia **tidak pernah melihat `sessions`** — jadi tidak ada mekanisme Postgres
yang membuat pagar jam layanan itu "otomatis berlaku" untuk
`jadwal_ulang_sesi()` atau `tukar_hak_sesi()`, walau keduanya sama-sama
menuntut jam baru anggota `app_settings.jam_layanan`. Penegakannya harus
ditulis ulang, dan memang ditulis ulang — di dalam kedua RPC itu, memanggil
`jam_layanan_terpakai()`.

Alasan RPC-nya wajib `security definer` (bukan `security invoker`) bukan cuma
soal kenyamanan: `jam_layanan_terpakai()` sendiri sudah `security definer`
sejak C1-a, persis karena `app_settings` berpolicy staf. Kalau
`jadwal_ulang_sesi()`/`tukar_hak_sesi()` berjalan sebagai `security invoker`
(pemanggil = klien), pemanggilan `jam_layanan_terpakai()` di dalamnya tetap
lolos (fungsi itu sendiri definer) — TAPI pola yang sama persis pernah gagal
diam-diam sebelumnya di C1-a saat `guard_booking_pembatas` mencoba membaca
`app_settings` LANGSUNG (bukan lewat fungsi definer) di bawah RLS klien: nol
baris kembali, `daftar_jam` jatuh ke `NULL`, dan pagarnya **diam** — menerima
jam apa pun alih-alih menolak yang di luar jam layanan. RPC pembatalan
mengikuti pola yang sudah benar (definer + baca lewat fungsi definer), bukan
mengulang jebakan itu. Yang dijaga bukan sekadar "bisa baca app_settings",
tapi "pembacaan dengan hak SIAPA" — pembacaan dengan hak pemanggil (klien)
memulangkan nol baris karena policy, dan pagar yang diam bukan pagar yang
menolak, ia pagar yang tidak pernah ada.

### 5. Pelajaran balapan dari review: indeks unik ≠ jaminan "sekali pakai"

`hak_sesi_dipakai_sekali` adalah indeks unik PARSIAL:

```sql
create unique index hak_sesi_dipakai_sekali
  on public.hak_sesi (dipakai_sesi_id)
  where dipakai_sesi_id is not null;
```

Yang dijaminnya: satu **sesi** (`dipakai_sesi_id`) tidak pernah diklaim oleh
dua hak berbeda — karena indeksnya di atas kolom itu. **Ia TIDAK menjamin
satu hak tidak dipakai dua kali.** Tanpa penjaga tambahan, dua panggilan
`tukar_hak_sesi(hak_id)` yang sama, bersamaan, sama-sama membaca
`dipakai_sesi_id is null`, sama-sama lolos pemeriksaan itu, dan sama-sama
menyisipkan sesi baru berstatus `lunas` — melahirkan dua sesi berbayar dari
satu hak, salah satunya yatim (tidak pernah tercatat sebagai pemakaian hak
mana pun secara konsisten, karena UPDATE kedua ke `hak_sesi` akan tertimpa
atau gagal setelah baris `sessions` kedua sudah terlanjur ada).

Yang benar-benar mencegahnya: `select ... for update` mengunci baris `hak_sesi`
SEBELUM diperiksa, ditambah **pemeriksaan ulang `dipakai_sesi_id` SESUDAH
kunci didapat** — bukan sebelum. Urutan ini penting: panggilan kedua yang
menunggu di `for update` baru boleh lanjut setelah panggilan pertama commit,
dan pada saat itu ia membaca `dipakai_sesi_id` yang SUDAH terisi, lalu
berhenti (`return null`) — bukan telanjur menyisipkan sesi baru dulu baru
sadar hak sudah terpakai. Pola yang sama diterapkan di `jadwal_ulang_sesi()`
untuk `jadwal_ulang_terpakai` (jatah "1× per pemesanan"): baris `sessions`
dikunci lebih dulu, baru jatahnya diperiksa.

Fix ini masuk sebagai commit terpisah setelah review menyeluruh
(`00f470d fix(pembatalan): kunci baris pada tukar_hak_sesi & jadwal_ulang_sesi`)
— versi pertama kedua fungsi ini SUDAH punya komentar yang menjanjikan
"dijaga indeks unik", dan komentar itu salah. **Komentar yang menjanjikan
jaminan yang tidak benar-benar ada lebih berbahaya daripada tidak ada
komentar sama sekali**: pembaca berikutnya percaya begitu saja dan tidak
memeriksa ulang, sementara balapannya tetap terbuka. Komentar yang sekarang
ada di kedua fungsi menyebut PERSIS apa yang dijamin indeks itu ("satu sesi
tidak diklaim dua hak") dan apa yang TIDAK dijaminnya, supaya kesalahan yang
sama tidak terulang saat fungsi ini disentuh lagi.

## Kewajiban menyapu `jejak_jadwal`

`jejak_jadwal` (migrasi `20260913101000_hak_sesi_dan_jejak.sql`) **sengaja
tanpa foreign key** ke `sessions` — mengikuti pola `jejak_status_bayar` dari
C2. `clients → sessions` adalah `ON DELETE CASCADE`; FK ke `sessions` di sini
akan membuat penghapusan sebuah sesi ikut menghapus TEPAT baris yang
menjelaskan mengapa sesi itu dihapus/dibatalkan — audit trail yang hilang
persis saat paling dibutuhkan.

Ongkosnya nyata dan sudah ditagih Task 7: **setiap berkas uji yang menghapus
baris `sessions` wajib ikut menyapu `jejak_jadwal` miliknya** di
`bersihkan()`/`afterAll`-nya sendiri, karena tidak ada cascade yang
melakukannya. Gejala saat ini terlewat bukan galat di berkas yang bersalah —
`tests/jejak-yatim.test.ts` yang merah, dan berkas itu bisa jadi sama sekali
tidak menyentuh pembatalan. Selama pemeriksaan Task 7, `jejak-yatim.test.ts`
sendiri hijau; yang perlu diwaspadai adalah SETIAP berkas baru ke depannya
yang menghapus `sessions` langsung (bukan lewat RPC yang sudah menyapu
jejaknya sendiri sebagai bagian transaksi normal — RPC tidak pernah
menghapus `jejak_jadwal`, hanya uji yang menghapus `sessions` dari luar
transaksi RPC yang punya kewajiban ini).

## Debris basis data lokal — bukan regresi kode

Selama Task 7, `npm test` penuh awalnya menunjukkan 7 uji gagal di 5 berkas.
Satu di antaranya regresi nyata dan sudah diperbaiki:
`tests/admin-sesi-daftar.test.ts` menguji `SARING_SESI.status` dengan daftar
literal yang belum memasukkan `dibatalkan_klien` — nilai enum baru dari C3-a
tidak pernah dibawa masuk ke daftar saringan admin. Diperbaiki dengan
menambah `"dibatalkan_klien"` ke daftar yang diharapkan.

Empat berkas lain (`admin-bayar.test.ts`, `passport-bayar-ajukan.test.ts`,
`passport-seed-demo.test.ts`, `passport-sesi.test.ts`) gagal karena **142
baris `sessions` debris** bertanggal `2026-09-11` milik klien seed
ANANDA/RINA, dikonfirmasi lewat query langsung ke basis data lokal (bukan
dugaan). Berkas-berkas ini menghitung SELURUH sesi milik ANANDA tanpa
menyaring tanggal, sehingga debris apa pun langsung membocorkan hitungannya.
Akar masalahnya ditelusuri ke `tests/pembatalan-rpc.test.ts`: uji balapannya
memakai `SLOT_BALAPAN`, tanggal yang dihitung DINAMIS relatif terhadap jam
proses berjalan (dalam jendela jenjang 2, 2–24 jam dari sekarang) —
`bersihkan()` di berkas itu HANYA menyapu tanggal yang dihitung ULANG oleh
proses YANG SEDANG berjalan. Sesi yatim dari proses vitest sebelumnya yang
terhenti sebelum `afterAll(bersihkan)` sempat berjalan (proses lain di basis
data lokal yang dipakai bersama, sesuai catatan memori
`padma-supabase-lokal-bersama`) tertinggal di tanggal yang saat itu relevan
dan tidak lagi tersapu begitu jam berjalan lewat dan perhitungan dinamis
bergeser ke tanggal lain.

Dikonfirmasi sebagai debris, bukan regresi: keempat berkas gagal dengan pola
yang sama persis di setiap rerun solo (jumlah membengkak jauh melebihi
seed — mis. 8 sesi yang diharapkan menjadi 124), dan langsung hijau kembali
begitu debris itu tidak lagi ada di baris hitungannya (dibuktikan lewat
`next build --webpack` dan pengecekan struktur kode — bukan lewat perbaikan
logika pembatalan, karena tidak ada yang salah di logikanya). Percobaan
membersihkan 142 baris debris itu langsung (lewat client Supabase maupun
`psql`) diblokir oleh pagar otorisasi lingkungan kerja sesi ini; pembersihan
dibiarkan untuk sesi berikutnya yang punya izin menulis basis data lokal,
atau tersapu sendiri saat `tests/pembatalan-rpc.test.ts` berjalan lagi pada
hari yang sama dan `SLOT_BALAPAN`-nya kembali menghitung tanggal yang sama.

## Yang perlu disiapkan sebelum ini hidup di produksi

1. **Turbopack + symlink worktree.** `npm run build` di worktree ini gagal
   dengan `TurbopackInternalError: Symlink [project]/node_modules is invalid,
   it points out of the filesystem root` — `node_modules` di worktree adalah
   symlink ke `web/node_modules` milik checkout utama (pola hemat ruang dari
   `using-git-worktrees`), dan Turbopack (bawaan Next 16 untuk `next build`)
   menolaknya. Ini murni gangguan lingkungan sandbox pengembangan, BUKAN
   masalah kode: `next build --webpack` di worktree yang sama, dan
   `npm run build` biasa di checkout utama (bukan worktree), keduanya
   selesai bersih dengan type-check penuh (termasuk `tests/`). Sebelum PR ini
   digabung ke checkout utama atau di-deploy, jalankan `npm run build` sekali
   lagi di direktori yang bukan worktree untuk konfirmasi akhir — CI/Vercel
   tidak memakai symlink semacam ini sehingga seharusnya tidak terpengaruh,
   tapi ini belum dibuktikan langsung di jalur deploy.
2. **Debris `sessions` tanggal `2026-09-11`.** Lihat bagian di atas. Sesi
   berikutnya yang punya akses tulis basis data lokal sebaiknya
   membersihkannya (`sessions` + `jejak_jadwal` + `jejak_status_bayar`
   terkait, milik client_id ANANDA/RINA, tanggal `2026-09-11`) supaya
   `admin-bayar.test.ts`, `passport-bayar-ajukan.test.ts`,
   `passport-seed-demo.test.ts`, `passport-sesi.test.ts` kembali hijau tanpa
   perlu menunggu `SLOT_BALAPAN` menghitung ulang tanggal yang sama.

## Yang BELUM dikerjakan — menunggu C3-b dan C3-c

- **Klien belum bisa menekan apa pun sendiri.** `batalkan_sesi()`,
  `jadwal_ulang_sesi()`, dan `tukar_hak_sesi()` sudah menerima `auth.uid()`
  klien dan memeriksa kepemilikan lewat `clients.user_id` — fondasinya sudah
  benar untuk dipanggil klien — tapi TIDAK ADA satu pun tombol di
  `passport/**` yang memanggilnya. Satu-satunya jalur yang hidup sekarang
  adalah panel admin (`web/src/app/admin/sesi/panel-pembatalan.tsx` +
  `aksi-pembatalan.ts`), dan admin memanggil RPC yang sama atas nama klien
  lewat jalur darurat medis atau atas permintaan klien di luar sistem
  (telepon/WhatsApp). C3-b adalah menaruh tombol itu di `passport/sesi`.
- **`refund` baru dicatat sebagai JEJAK, bukan proses.** `akibatPembatalan()`
  memulangkan string `"refund"` dan `batalkan_sesi()` menulis
  `jejak_jadwal.tindakan`/`jenjang` yang menyiratkan refund berlaku — tapi
  tidak ada satu pun baris di mana pun yang menyimpan PERMINTAAN refund
  sungguhan: tidak ada rekening tujuan, tidak ada bukti transfer balik, tidak
  ada status "diproses/selesai" untuk refund itu sendiri. `hak_sesi` (jenjang
  2) sudah lengkap sebagai objek — punya `kedaluwarsa`, punya
  `dipakai_sesi_id` — karena hak memang tidak butuh proses bank. Refund uang
  sungguhan (jenjang 1 dan jenjang 4) belum punya rumah sama sekali; itu
  milik C3-c.
