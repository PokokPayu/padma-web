# C3-a — fondasi pembatalan: tindak lanjut

Spec: `docs/superpowers/specs/2026-09-09-padma-c3-pembatalan-design.md`
Rencana: `docs/superpowers/plans/2026-09-09-padma-c3a-fondasi-pembatalan.md`
Selesai & ter-merge: 9 September 2026. Bagian C berikutnya: **C3-b** (klien
menekan sendiri) dan **C3-c** (permintaan refund sungguhan).

Suite sesudah putaran perbaikan menyeluruh (9 September 2026,
`npx vitest run` PENUH di worktree ini): **2.591 uji di 171 berkas — seluruhnya
lolos, 0 gagal**. Basis data lokal dihitung ulang sesudahnya dengan service
role dan kembali ke **8 baris `sessions` seed** (0 `hak_sesi`, 0
`jejak_jadwal`) — tidak ada debris yang ditinggalkan.
`npm run lint`: **0 error, 11 warning** (semuanya sudah ada sebelum C3-a,
tidak disentuh rencana ini).
`npm run build` (Turbopack, bawaan Next 16): **exit 0**. Kegagalan yang
tercatat pada Task 7 (`TurbopackInternalError: Symlink [project]/node_modules
is invalid, it points out of the filesystem root`) murni gangguan lingkungan —
`node_modules` worktree waktu itu symlink ke checkout utama; begitu
dependensinya dipasang sungguhan di worktree, build selesai bersih.

Angka Task 7 yang lama (2.560 uji, 6 gagal di 4 berkas karena debris; build
gagal) sudah TIDAK berlaku — keduanya selesai, dan sebabnya diuraikan di bagian
"Debris basis data lokal" di bawah.

## Yang sekarang berlaku

### 1. Rantai status sesi, dan mengapa dua "batal" tidak disatukan

```
terjadwal ──┬─→ berjalan ──┬─→ selesai
            │              └─→ tidak_hadir
            ├─→ dibatalkan_padma   (oleh = 'padma'; staf saja, alasan WAJIB;
            │                       SELALU jenjang 4, refund penuh)
            └─→ dibatalkan_klien   (oleh = 'klien'; jenjang dari WAKTU, atau
                                    jenjang 1 lewat darurat medis)
```

**Aktornya DINYATAKAN, tidak disimpulkan.** Versi pertama `batalkan_sesi()`
menentukan jenjang 4 dari `staf AND alasan tidak kosong AND bukan darurat`,
sementara panel merender `alasan` sebagai kotak catatan biasa yang opsional —
tanpa satu isyarat pun bahwa mengetiknya mengubah akibat uang. Dua kegagalan
uang bisa dicapai dari layar yang sama: admin yang mengetik "klien minta batal"
saat klien menelepon 6 jam sebelum sesi mengubah kredit 30 hari menjadi refund
penuh atas nama PADMA; admin yang membiarkan alasan kosong saat bidan sakit
membuat klien kehilangan seluruh uangnya sambil dicatat sebagai pihak yang
membatalkan. `oleh` kini argumen tanpa nilai bawaan, tanda tangan lama dibuang,
dan panel meminta aktornya lebih dulu dengan ringkasan jenjang yang mengikuti
pilihan itu.

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
menulis baris.

Pagar kesepakatannya kini SUNGGUH ADA: `tests/jenjang-sql-vs-ts.test.ts`.
Sampai berkas itu lahir, kalimat "dijaga uji seperti `jarak-sql-vs-ts`" muncul
di komentar migrasi DAN di catatan ini tanpa ada ujinya — komentar yang
menjanjikan jaminan yang tidak dibangun, kesalahan yang sama bentuknya dengan
"dijaga indeks unik" di §5 di bawah.

Kedua sisi tidak bisa disuapi INSTAN yang sama: sisi SQL membaca `now()`
sendiri dan sengaja tidak menerimanya sebagai argumen ("sekarang" yang bisa
dikirim pemanggil adalah "sekarang" yang bisa dikarang klien). Yang bisa
disuapi identik adalah SELISIHNYA — dan selisih itulah satu-satunya hal yang
dibaca kedua rumus. Pasangan `(tanggal, jam)` untuk SQL dirakit di dalam SATU
pernyataan dari `now() at time zone 'Asia/Jakarta'`, jadi jaraknya persis
sampai mikrodetik dan ambang 24 jam serta 2 jam benar-benar diuji TEPAT di
titiknya, bukan di sekitarnya.

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

### 6. "Batal" adalah HIMPUNAN — dan sisi SQL-nya tidak punya pemaksa

Cacat paling mahal yang ditemukan review menyeluruh bukan di kode baru,
melainkan di kode lama yang mendadak salah: `SESI_DIBATALKAN` adalah konstanta
**tunggal** `'dibatalkan_padma'`, dipakai lima tempat untuk berarti "kecualikan
sesi yang batal". Lahirnya `dibatalkan_klien` membuat kelimanya menganggap
separuh pembatalan sebagai sesi hidup — bidan berangkat ke kunjungan yang sudah
dibatalkan, dan klien yang dijanjikan refund tetap melihat tagihannya.

Di TypeScript ia kini `SESI_TIDAK_TERJADI: Record<StatusSesi, boolean>`, jadi
anggota enum berikutnya **menolak build** sampai seseorang memutuskan status itu
termasuk "terjadi" atau "tidak". Itu pagar yang benar: ia memaksa keputusan
alih-alih membiarkannya terlewat.

**Sisi SQL tidak punya padanannya.** `klaim_sudah_bayar` sempat tertinggal
dengan literal tunggal yang sama (ditutup migrasi `20260913103000`), dan bentuk
penggantinya — `not in ('dibatalkan_padma', 'dibatalkan_klien')` di dalam badan
plpgsql — tetap **tidak menolak dipasang** ketika anggota enum baru lahir.
Yang menjaganya sekarang hanya uji berpasangan di `klaim-sesi-lepas.test.ts` dan
pemindai `prosrc` di `rantai-status-db.test.ts`, dan pemindai itu menangkap nilai
**mati**, bukan nilai baru yang belum disebut.

Konsekuensinya harus dipegang siapa pun yang menambah anggota `session_status`
berikutnya: **sapu seluruh definisi fungsi SQL dengan tangan.** TypeScript akan
memberitahumu; Postgres tidak.

`tidak_hadir` sengaja TETAP di luar daftar itu. Apakah sesi yang kliennya tidak
hadir tetap ditagih adalah keputusan C3 yang belum diambil, dan mengubahnya
sambil lewat dalam sebuah perbaikan bug berarti mengambil keputusan produk
diam-diam.

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

## Debris basis data lokal — SUDAH SELESAI, dan akar penyebabnya

**Keadaan sekarang: bersih.** 142 baris debris sudah disapu, dan basis data
lokal kembali ke 8 baris `sessions` seed. `npm run build` juga sudah **exit 0**
di worktree ini begitu `node_modules`-nya dipasang sungguhan alih-alih
di-symlink: kegagalan Turbopack sebelumnya murni symlink yang menunjuk keluar
akar proyek, bukan masalah kode. Bagian ini disimpan karena AKAR
PENYEBABNYA masih relevan bagi setiap berkas uji berikutnya.

Selama Task 7, `npm test` penuh awalnya menunjukkan 7 uji gagal di 5 berkas.
Satu di antaranya regresi nyata dan sudah diperbaiki:
`tests/admin-sesi-daftar.test.ts` menguji `SARING_SESI.status` dengan daftar
literal yang belum memasukkan `dibatalkan_klien` — nilai enum baru dari C3-a
tidak pernah dibawa masuk ke daftar saringan admin.

Empat berkas lain (`admin-bayar.test.ts`, `passport-bayar-ajukan.test.ts`,
`passport-seed-demo.test.ts`, `passport-sesi.test.ts`) gagal karena **142 baris
`sessions` debris** milik klien seed ANANDA/RINA. Berkas-berkas itu menghitung
SELURUH sesi milik ANANDA tanpa menyaring tanggal, sehingga debris apa pun
langsung membocorkan hitungannya.

**Akar penyebabnya, dalam bentuknya yang sebenarnya:** `bersihkan()` di
`tests/pembatalan-rpc.test.ts` menyapu **daftar tanggal TETAP** ("2027-09-20",
"2027-09-25", dst), sementara hampir seluruh sesi di berkas itu dibuat lewat
`jamRelatif()` — helper yang menghasilkan tanggal BERGERAK relatif terhadap
hari ini (`jamRelatif(48)` = hari-ini + 48 jam). Tanggal bergerak tidak pernah
masuk daftar tetap mana pun, jadi setiap sesi yang lahir lewatnya tertinggal
permanen, setiap kali berkas itu dijalankan. Catatan versi pertama bagian ini
menyalahkan `SLOT_BALAPAN` (tanggal dinamis milik uji balapan) — itu keliru:
`SLOT_BALAPAN` hanya satu dari banyak sumber, dan yang membuat kebocorannya
terus-menerus adalah `jamRelatif()` yang dipakai hampir semua uji di berkas itu.

**Perbaikannya:** `bersihkan()` ditulis ulang memakai PELACAKAN ID. Setiap id
sesi yang lahir dari kode berkas itu — `buatSesiUntuk()`, `terbitkanHakBerasal()`,
dan setiap panggilan `tukar_hak_sesi` yang melahirkan sesi baru — dicatat ke
`SESI_MILIK_UJI`, dan `bersihkan()` menyapu TEPAT himpunan itu (plus
`jejak_jadwal` dan `jejak_status_bayar` miliknya, karena tidak ada cascade).
Alternatif "sapu seluruh sesi milik ANANDA/RINA" DITOLAK: kedua id klien itu
dipakai puluhan berkas uji lain, jadi menyapu berdasarkan `client_id` berisiko
menabrak fixture berkas lain bila pernah dijalankan berdampingan.

### Keterbatasan yang DITERIMA: `SESI_MILIK_UJI` hidup di memori proses

`SESI_MILIK_UJI` adalah `Set` level-modul. Ia hanya berisi id yang dibuat oleh
proses vitest YANG SEDANG BERJALAN. Konsekuensinya: sesi dari proses uji yang
**terhenti paksa sebelum `afterAll`** (Ctrl-C, `--bail`, proses dimatikan, mesin
tidur) tidak akan pernah tersapu oleh proses berikutnya — himpunannya lahir
kosong lagi, dan baris-baris itu menjadi debris permanen sampai seseorang
menghapusnya dengan tangan.

**Gejalanya, supaya diagnosisnya cepat:** berkas uji LAIN yang tidak disentuh
satu baris pun ikut merah, karena jumlah baris yang mereka hitung membengkak
(mis. `passport-sesi.test.ts` mengharapkan 8 sesi dan menemukan 124). Berkas
yang bersalah sendiri tetap hijau. Begitu gejala itu muncul, jangan mencari
regresi di kode yang baru diubah — hitung dulu baris `sessions` dengan service
role dan bandingkan dengan 8 baris seed.

**Kenapa tidak ditambal sekarang:** menutupnya butuh penanda yang BERTAHAN di
basis data, bukan di memori — konvensi penandaan baris fixture (mis. awalan
UUID khusus uji, atau kolom penanda) yang berlaku untuk SELURUH suite dan
disepakati semua berkas yang membuat `sessions`. Itu perubahan lintas puluhan
berkas uji, bukan perubahan satu berkas, dan menaruhnya di sini akan membuat
`tests/pembatalan-rpc.test.ts` punya konvensi sendiri yang tidak diikuti berkas
lain — yaitu setengah pagar, yang justru paling mudah dipercaya keliru.

## Empat keputusan yang DISENGAJA, supaya C3-b tidak mewarisinya sebagai asumsi diam-diam

Keempatnya diambil sadar di C3-a. Ditulis di sini, bukan dibiarkan tersirat di
kode, karena masing-masing menunggu keputusan produk yang bukan milik C3-a.

**1. Rantai batal → hak → tukar → batal MEMPERBARUI kredit tanpa batas.**
Sesi pengganti yang lahir dari `tukar_hak_sesi()` lahir dengan
`jadwal_ulang_terpakai = false` (jatah jadwal ulang kosong lagi), dan bila sesi
itu dibatalkan lagi di jendela 2–24 jam, hak barunya kedaluwarsa 30 hari sejak
tanggal sesi yang BARU. Tidak ada uang yang keluar — kredit tetap satu hak,
tetap terkunci ke layanan yang sama — tetapi "berlaku 30 hari" berhenti benar:
klien bisa menggeser kredit yang sama maju terus tanpa batas. **Diputuskan di
C3-b**, dan dua jalan yang tersedia sudah kelihatan: membawa ASAL-USUL hak
(kedaluwarsa dihitung dari hak paling awal dalam rantainya), atau membatasi
penerbitan ulang (hak yang lahir dari sesi yang sendirinya lahir dari hak tidak
menerbitkan hak baru). Keduanya menyentuh kolom yang belum ada.

**2. Pengecualian darurat hanya ada pada PEMBATALAN, tidak pada jadwal ulang.**
`batalkan_sesi()` menerima `darurat` dan menaikkan ke jenjang 1;
`jadwal_ulang_sesi()` tidak punya padanannya sama sekali, sehingga jenjang 3
menolaknya keras. Poster klien justru menjanjikan persalinan dan rawat inap
"ditinjau untuk **RESCHEDULE** tanpa penalti" — dan keadaan darurat hampir
selalu jatuh di jendela <2 jam, yaitu tepat jendela yang menolak jadwal ulang.
Jadi jalur yang paling dijanjikan poster adalah jalur yang paling tertutup hari
ini. Yang bisa dilakukan admin sekarang: membatalkan dengan darurat (jenjang 1,
refund) lalu menjadwalkan sesi baru — dua langkah, dan bukan yang dijanjikan.
**Menunggu C3-b.**

**3. Spec P4 menulis "jatah habis → diperlakukan sebagai pembatalan";
implementasinya MENOLAK KERAS.** `jadwal_ulang_sesi()` melempar galat
`23514` ketika `jadwal_ulang_terpakai` sudah true, sehingga admin harus
melakukan dua langkah sendiri (batalkan, lalu tukar haknya). Penyempitan ini
DISENGAJA: mengubah satu tombol "jadwal ulang" menjadi pembatalan yang
menerbitkan kredit adalah tindakan yang akibat uangnya berbeda dari yang
diminta, dan selama belum ada layar KLIEN yang bisa menampilkan konfirmasi
"jatah Anda habis — ini akan menjadi pembatalan berkredit", satu-satunya orang
yang bisa memberi persetujuan itu adalah admin di telepon. Ditinjau ulang saat
C3-b membangun layar kliennya.

**4. Hak yang terbit KINI sudah bisa dilihat dan ditukar — dari panel admin
saja.** Sampai perbaikan ini, `hak_sesi` tidak dibaca satu halaman pun dan
`tukar_hak_sesi()` tidak punya pemanggil di luar uji: klien yang mendapat
kredit memegang hak yang tidak ada tombolnya, dan klaim tabel tahapan spec
bahwa C3-a "bisa dipakai sendiri" tidak benar. Permukaannya kini ada di
`/admin/klien/[id]` (kartu "Kredit sesi (hak)" + formulir penukaran) — lihat
`src/lib/admin/hak.ts`, `src/app/admin/klien/[id]/kartu-hak.tsx`, dan
`aksi-hak.ts`. Ditempatkan di sana, bukan di `/admin/sesi`, karena hak milik
ORANG dan bukan milik baris sesi: ia lahir justru ketika sebuah sesi berhenti
ada, jadi di daftar sesi tidak ada baris tempatnya menggantung. **KLIEN sendiri
masih belum bisa melihat maupun menukar haknya** — itu tetap C3-b.

## Yang perlu disiapkan sebelum ini hidup di produksi

Dua ganjalan yang tercatat di Task 7 — build Turbopack yang gagal karena
symlink `node_modules`, dan 142 baris debris di basis data lokal — **sudah
selesai keduanya** (lihat bagian di atas). Yang tersisa hanyalah kebiasaan:
jalankan `npm run build` sekali di lingkungan yang dependensinya terpasang
sungguhan, bukan lewat symlink yang menunjuk keluar akar proyek. CI/Vercel
tidak memakai symlink semacam itu.

## Yang BELUM dikerjakan — menunggu C3-b dan C3-c

- **Klien belum bisa menekan apa pun sendiri.** `batalkan_sesi()`,
  `jadwal_ulang_sesi()`, dan `tukar_hak_sesi()` sudah menerima `auth.uid()`
  klien dan memeriksa kepemilikan lewat `clients.user_id` — fondasinya sudah
  benar untuk dipanggil klien — tapi TIDAK ADA satu pun tombol di
  `passport/**` yang memanggilnya. Satu-satunya jalur yang hidup sekarang
  adalah panel admin (`web/src/app/admin/sesi/panel-pembatalan.tsx` +
  `aksi-pembatalan.ts` untuk batal & jadwal ulang;
  `web/src/app/admin/klien/[id]/kartu-hak.tsx` + `aksi-hak.ts` untuk menukar
  kredit), dan admin memanggil RPC yang sama atas nama klien — kini dengan
  menyatakan aktornya secara eksplisit (`oleh = 'klien'`) alih-alih
  menyimpulkannya dari isi kotak alasan. C3-b adalah menaruh tombol itu di
  `passport/sesi`, plus daftar kredit di Passport klien.
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
