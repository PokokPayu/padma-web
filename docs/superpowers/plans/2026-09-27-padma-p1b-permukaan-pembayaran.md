# Inti Pembayaran P1-B — Permukaan & Penjadwal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyambungkan mesin pembayaran yang sudah ada di basis data ke dunia luar — adapter Midtrans, webhook bertanda tangan, checkout Snap, layar pemulihan staf, dan penjadwal rekonsiliasi.

**Architecture:** Rute webhook memverifikasi tanda tangan lalu menyerahkan seluruh keputusan ke fungsi mesin; ia tidak pernah memutuskan sendiri. Jaring pengaman utamanya BUKAN penjadwal melainkan pemeriksaan saat klien membuka halaman — orang yang paling butuh memicu penyembuhannya sendiri dalam hitungan detik. GitHub Actions tiap 15 menit hanya menyapu pesanan milik orang yang tidak pernah kembali.

**Tech Stack:** Next.js 16 (route handler, server component), Midtrans Snap, Zod, GitHub Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-padma-inti-pembayaran-design.md`

**PRASYARAT:** `docs/superpowers/plans/2026-09-27-padma-p1a-mesin-basis-data.md` (Tugas 1–7) harus TUNTAS lebih dulu. Setiap tugas di sini memanggil fungsi RPC yang lahir di sana; memulai rencana ini duluan berarti memanggil fungsi yang belum ada.

## Global Constraints

Berlaku untuk **setiap** tugas, tanpa diulang di masing-masing.

- **Bahasa Indonesia**: komentar, pesan galat, UI, pesan commit. Komentar menjelaskan KENAPA.
- **`web/AGENTS.md` (dirujuk `web/CLAUDE.md`): versi Next.js di repo ini PUNYA breaking changes dibanding pengetahuan model.** Baca panduan relevan di `web/node_modules/next/dist/docs/` sebelum menulis kode Next apa pun.
- **`requireRole` di SETIAP server action.** Route handler adalah endpoint mandiri; tidak ada layout yang menjaganya.
- **Setiap rute baru WAJIB terdaftar di tabel rute `web/README.md`** — `tests/inventaris-rute.test.ts` memeriksa dua arah.
- **Service role HARAM di `src/app/admin/**`** kecuali allowlist di `tests/admin-shell.test.ts`.
- **Vonis Midtrans tidak pernah jadi parameter yang dikirim pemanggil bersesi.** Pemeriksaan ulang adalah rute server yang bertanya sendiri ke Status API, bukan RPC berparameter status.
- **Galat PostgREST dibaca, tidak pernah dibuang.**
- **`tests/setup-fetch-guard.ts` melempar untuk setiap host selain localhost** — uji yang mengimpor rute webhook atau cron wajib menstub `globalThis.fetch`.
- **`api.midtrans.com` TIDAK PERNAH masuk daftar izin uji.** Uji yang tidak sengaja menembak produksi adalah kejadian uang sungguhan.
- **Rahasia hidup di env dan GitHub Secrets, tidak pernah di repo** — repo `PokokPayu/padma-web` publik.
- **Supabase lokal dipakai bersama sesi lain** — koordinasikan sebelum `npm test` penuh atau `db reset`.
- Perintah dijalankan dari `web/`.
- Setiap pesan commit diakhiri baris: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Review Focus

Kelas masukan yang tersirat di spec tapi mudah lolos dari uji. Masing-masing sudah punya ujinya di tugas yang memiliki kodenya; daftar ini supaya peninjau tahu ke mana melihat.

1. **Nilai `MIDTRANS_PRODUKSI` selain `true`** — `"TRUE"`, `"1"`, `"yes"`, string kosong, tak diset. Semuanya WAJIB jatuh ke sandbox. Satu nilai yang salah dibaca berarti uji menembak endpoint produksi, dan itu kejadian uang sungguhan. Tugas 8, berkas uji tanpa basis data.
2. **Notifikasi untuk pesanan tak dikenal** — dijawab 200 tanpa jejak berarti pemetaan berjalan tanpa terlihat. Tugas 8 menaikkan penghitung `tak_dikenal` terpisah dari penghitung tanda tangan salah, dan ujinya memastikan yang naik memang yang benar.
3. **Radius Lapis 1b untuk sesi staf** — `orders` punya policy baca staf, jadi pemeriksaan-saat-dibuka bisa menyentuh pesanan milik orang lain bila radiusnya tidak dikunci ke `auth.uid()`. Tugas 10.
4. **Dua sebab berbeda yang dijawab kode HTTP sama** — `/api/pesanan/[id]/putuskan` menjawab 400 untuk putusan asing (pagar rute) dan untuk pesanan yang tidak sedang ditahan (pagar RPC). Kalimat keduanya sengaja tidak berbagi satu frasa pun, supaya menghapus pagar rute membuat ujinya merah alih-alih lolos diam-diam. Tugas 11.
5. **Penjadwal yang tidak pernah berjalan** — berkas workflow yang ada tapi tidak menyebut rutenya, atau menyebut rute tenggat yang sengaja tidak dijadwalkan. Tugas 12 menjaga keduanya, karena keputusan yang bergantung pada seseorang mengingat untuk tidak mengetik sesuatu bukan keputusan yang terjaga.

---

## Koreksi dari review akhir P1-A (27 Sep 2026)

P1-A tuntas dan ter-merge ke `main` di `79e1e3e`. Review seluruh branch
mengoreksi tiga hal yang rencana ini masih menyatakan keliru. Baca ini sebelum
Tugas 8 dan Tugas 11 — ketiganya menyangkut hal yang sudah berubah di `main`.

**1. `jejak_pesanan.keterangan` SUDAH punya penulis.** Catatan serah-terima P1-A
sempat berbunyi kolom ini belum punya penulis mana pun, jadi ujinya ditunda ke
Tugas 8. Itu sudah tidak benar sejak Tugas 5:
`20260926140000_pesanan_webhook_rpc.sql:548` menulis
`format('ditagih %s, diterima %s', ...)` ke sana — disengaja, karena staf butuh
kedua angka pada baris yang mereka pakai memutuskan perkara uang.

Kolomnya kini terjaga `tests/pesanan-teks-tanpa-nominal.test.ts`, lengkap dengan
daftar putih `kejadian` yang boleh memuat angka dan kontrol dua arah. **Tugas 8
tidak perlu memperluas uji itu.** Yang perlu dilakukan Tugas 8 hanyalah menambah
nilai `kejadian` ke daftar putih BILA ia melahirkan penulis nominal baru — dan
kalau tidak, tidak usah menyentuhnya sama sekali.

**2. Penimpaan `sebab_tinjauan` terjangkau HARI INI, bukan hanya lewat tombol
coba-ulang Tugas 11.** `20260926140000_pesanan_webhook_rpc.sql` memuat TUJUH
penugasan `sebab_tinjauan`; lima di antaranya menugaskan tanpa `coalesce`, dan
kelimanya tersebar di TIGA fungsi — bukan hanya di `terapkan_notifikasi_midtrans`
(`terbitkan_akses_item` dan `salurkan_pesanan` masing-masing punya satu). Catatan
lama mengaitkan keterjangkauannya dengan tombol yang dibangun Tugas 11; itu
terlalu sempit. Notifikasi `refund`/`chargeback` yang mendarat pada pesanan yang
sudah bertanda `lunas_setelah_tutup` menimpa alasannya diam-diam, tanpa satu pun
kode baru. **Tugas 11 jangan membatasi perbaikannya pada jalur coba-ulang** —
pagar yang hanya menutup satu pemanggil meninggalkan yang lain.

Perintah ini sekarang punya LANGKAH dan BERKAS, bukan hanya kalimat:
**Tugas 11 Step 3**, `web/supabase/migrations/20260927100000_sebab_tinjauan_lestari.sql`.

**3. Pelajaran proses yang menentukan cara Tugas 8–12 ditinjau.** Review seluruh
branch menemukan celah yang bisa menagih klien **dua kali** untuk satu produk,
dan celah itu lolos dari SELURUH tujuh review per-tugas P1-A. Cacatnya ada di
spec: aturannya ditulis harfiah (`status = 'ditahan'`) lalu dijelaskan sebagai
*"belum mati dan belum melahirkan akses"* — dan pesanan `kedaluwarsa` yang
membawa `lunas_setelah_tutup` (settlement terlambat, uang sudah masuk) memenuhi
penjelasannya tapi tidak memenuhi aturannya. Tiap review per-tugas menilai
terhadap brief-nya sendiri, dan brief-nya menyalin spec, jadi tak satu pun bisa
melihatnya.

Dua konsekuensi mengikat untuk rencana ini:

- **Jangan ganti review menyeluruh dengan penjumlahan review per-tugas.** P1-B
  wajib berakhir dengan review seluruh branch, sama seperti P1-A.
- **Saat sebuah aturan datang dengan kalimat yang menjelaskannya, periksa
  keduanya saling cocok.** Kalau penjelasan dan aturan berbeda, salah satunya
  salah — dan yang harfiah-lah yang dikirim ke klien.

---


## 0. KAMUS NAMA — satu nama, sekali saja

### 0.1 Cap waktu keenam migrasi (urutan MENGIKAT)

**DIPERBARUI 27 Sep 2026 — keenam migrasi ini SUDAH ADA di `main`.** P1-A ter-merge
di `79e1e3e` (fast-forward), dan `web/supabase/migrations/` kini berisi 90 berkas,
bukan 84. Tabel di bawah karena itu bukan rencana lagi melainkan inventaris: jangan
membuatnya, panggil isinya.

Cabang `umpan-balik-klien-gelombang-1` masih membawa `20260922100000` dan
`20260924100000` yang belum ter-merge, dan cap `20260926*` tetap dipilih supaya
urutannya sama apa pun urutan merge-nya. Keduanya (`pekan_sabtu_jumat`,
`materi_jejak_buka`) tidak bersinggungan dengan mesin pembayaran, jadi tidak ada
kebergantungan fungsional ke arah mana pun.

| # | Berkas (di `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/`) | Tugas |
|---|---|---|
| 1 | `20260926100000_pesanan_enum.sql` | 1 |
| 2 | `20260926110000_pesanan_tabel.sql` | 2 |
| 3 | `20260926120000_pesanan_jejak.sql` | 3 |
| 4 | `20260926130000_pesanan_rpc.sql` | 4 |
| 5 | `20260926140000_pesanan_webhook_rpc.sql` | 5 |
| 6 | `20260926150000_entitlement_tambal.sql` | 6 |

Urutan mengikat: enum (1) sebelum tabel (2); tabel sebelum jejak (3); jejak sebelum RPC (4, 5) karena
RPC menulis jejak; `orders` (2) sebelum penambalan (6) karena `digital_entitlements.pesanan_id` menunjuk `orders`.

**P1-B melahirkan SATU migrasi, dan hanya satu:**
`20260927100000_sebab_tinjauan_lestari.sql` (migrasi ke-91), milik **Tugas 11 Step 3**. Ia nol
objek baru — `create or replace function` atas `terbitkan_akses_item`, `salurkan_pesanan`, dan
`terapkan_notifikasi_midtrans` untuk membungkus lima penugasan `sebab_tinjauan` dengan
`coalesce`. Tugas 8, 9, 10, dan 12 tidak menulis SQL sama sekali; kalau salah satunya merasa
perlu, itu tanda briefnya sudah menyimpang.

### 0.2 Objek basis data

| Jenis | Nama PERSIS | Lahir di |
|---|---|---|
| enum | `public.order_status` = `menunggu_bayar`, `ditahan`, `lunas`, `kedaluwarsa`, `dibatalkan` (5) | T1 |
| enum | `public.order_item_source` = `produk_digital`, `sesi` (2) | T1 |
| enum | `public.order_event` = `dibuat`, `token_terbit`, `notifikasi`, `lunas`, `ditahan`, `kedaluwarsa`, `dibatalkan`, `selisih_nominal`, `selisih_status`, `lunas_setelah_tutup`, `akses_terbit`, `akses_sudah_ada`, `akses_tertahan`, `penangan_belum_ada`, `diperiksa_ulang`, `tinjauan_ditutup` (16) | T1 |
| tabel | `public.orders` | T2 |
| tabel | `public.order_items` | T2 |
| tabel | `public.jejak_pesanan` | T3 |
| tabel | `public.notifikasi_pesanan` | T3 |
| tabel | `public.notifikasi_ditolak_harian` | T3 |
| view | `public.pesanan_item_staf` | T5 |
| kolom baru | `public.digital_entitlements.pesanan_id uuid null references public.orders(id) on delete restrict` | **T5** (dipindah dari T6 — keberatan B-1, diterima) |
| kolom baru | `public.notifikasi_ditolak_harian.tak_dikenal integer not null default 0` | T3 |

Campuran Inggris/Indonesia (`orders`/`order_items` vs `jejak_pesanan`) **disengaja dan mengikuti spec harfiah** —
jangan "dirapikan".

### 0.3 Nama constraint & indeks (dirujuk uji, jadi bukan selera)

| Nama | Objek | Tugas |
|---|---|---|
| `orders_kode_unik` | `unique (kode)` pada `orders` | T2 |
| `pesanan_tutup_bercap` | CHECK positif #1 | T2 |
| `pesanan_terbuka_tanpa_cap` | CHECK positif #2 | T2 |
| `pesanan_percobaan_wajar` | `check (percobaan between 1 and 9)` | T2 |
| `pesanan_terbuka_satu_per_klien` | unique partial `(client_id) where status = 'menunggu_bayar'` | T2 |
| `orders_klien_idx` | `(client_id, dibuat_pada desc)` | T2 |
| `orders_sapuan_idx` | `(diperiksa_pada nulls first) where status = 'menunggu_bayar'` | T2 |
| `item_sumber_tunggal` | `check (num_nonnulls(product_id, booking_request_id) = 1)` | T2 |
| `item_produk_bercermin` | `check ((jenis = 'produk_digital') = (product_id is not null))` | T2 |
| `item_sesi_bercermin` | `check ((jenis = 'sesi') = (booking_request_id is not null))` | T2 |
| `order_items_pesanan_urutan_unik` | `unique (pesanan_id, urutan)` | T2 |
| `item_pesanan_beku` | trigger `before update on order_items` | T2 |
| `jejak_pesanan_lunas_sekali` | unique partial `(pesanan_id) where kejadian = 'lunas'` | T3 |
| `jejak_pesanan_pesanan_idx` | `(pesanan_id, dibuat_pada desc)` | T3 |
| `notifikasi_pesanan_sidik_unik` | `unique (sidik)` | T3 |
| `notifikasi_pesanan_pesanan_idx` | `(pesanan_id, diterima_pada desc)` | T3 |

`order_items_pesanan_idx` **SENGAJA TIDAK dibuat** (keberatan A-2, diterima): constraint
`order_items_pesanan_urutan_unik` sudah menerbitkan btree atas kolom kunci yang sama persis, dan
indeks kedua hanya menambah ongkos tulis pada tabel uang. Jangan menambahkannya, dan jangan
meng-assert namanya di uji mana pun.

### 0.4 Fungsi SQL — tanda tangan PERSIS

Setiap fungsi `set search_path = public`. Templat hak mengikuti `20260830150000_pengerasan_tabel_uang.sql:197`
untuk yang tertutup, dan aturan [F] `20260828230000_fail_closed_sequence_fungsi.sql:176-177` + baris
`from ... authenticated` untuk yang tertutup (templat rumah TIDAK menyebut `authenticated` — itulah lubang
yang `tests/fungsi-mesin-tertutup.test.ts` tutup).

| Fungsi | Lahir | Hak |
|---|---|---|
| `public.perpindahan_pesanan_sah(p_dari public.order_status, p_ke public.order_status) returns boolean` — `language sql immutable` | T1 | TERTUTUP |
| `public.tolak_ubah_item_pesanan() returns trigger` — `raise ... errcode = '42501'` | T2 | TERTUTUP (bukan penulis; tidak masuk daftar putih mana pun) |
| `public.catat_notifikasi_ditolak() returns void` — upsert `notifikasi_ditolak_harian` (`jumlah = jumlah + 1`) | T3 | TERTUTUP |
| `public.catat_notifikasi_tak_dikenal() returns void` — upsert `notifikasi_ditolak_harian` (`tak_dikenal = tak_dikenal + 1`) | T3 | TERTUTUP |
| `public.buat_pesanan(p_product_id uuid, p_ulang boolean default false) returns table (pesanan_id uuid, kode text, percobaan smallint, nominal_tagih integer, judul text)` | T4 | TERBUKA_SADAR |
| `public.catat_token_snap(p_pesanan_id uuid, p_token text) returns void` | T4 | TERBUKA_SADAR |
| `public.batalkan_pesanan_saya(p_pesanan_id uuid) returns boolean` | T4 | TERBUKA_SADAR |
| `public.punya_pesanan_menunggu(p_product_id uuid) returns boolean` | T4 | terbuka, BUKAN penulis → tidak masuk daftar mana pun |
| `public.putuskan_pesanan_ditahan(p_pesanan_id uuid, p_putusan text) returns void` | T4 | TERBUKA_SADAR |
| `public.tutup_tinjauan(p_pesanan_id uuid) returns void` | T4 | TERBUKA_SADAR |
| `public.terapkan_notifikasi_midtrans(p_order_id text, p_transaction_status text, p_fraud_status text, p_transaction_id text, p_payment_type text, p_gross_amount numeric, p_sidik text, p_sumber text default 'webhook') returns text` | T5 | TERTUTUP |
| `public.salurkan_pesanan(p_pesanan_id uuid) returns void` | T5 | TERTUTUP |
| `public.terbitkan_akses_item(p_item_id uuid) returns text` | T5 | TERTUTUP |

**Dua keputusan yang dikunci di sini karena dua tugas bergantung padanya:**

1. `p_putusan` bertipe **`text`**, bukan `order_status`. Nilai sah `'lunas'` dan `'dibatalkan'`; apa pun
   selain itu → `raise ... errcode = 'P0001'` berkalimat manusia. Alasan: enum lewat PostgREST menggagalkan
   nilai asing dengan `22P02` telanjang, dan spec menuntut galat yang bisa dibaca.
2. `terapkan_notifikasi_midtrans` memulangkan **`text`** dari himpunan tertutup
   `'diterapkan' | 'duplikat' | 'tanpa_efek' | 'pesanan_tidak_ada'`. Itulah yang dipetakan rute ke kode HTTP.
   `'pesanan_tidak_ada'` **tidak ada di tabel peta kode jawaban spec** — ia lahir karena rute harus
   menangani "tanda tangan sah tapi `order_id` tidak menunjuk pesanan mana pun". Dipetakan ke **200**
   (kelas "tidak ada yang tersisa untuk disembuhkan"), **tetapi TIDAK PERNAH SENYAP**: rute menaikkan
   `notifikasi_ditolak_harian.tak_dikenal` lewat `catat_notifikasi_tak_dikenal()` sebelum menjawab 200.
   Notifikasi bertanda tangan SAH yang kita buang tidak boleh lebih sunyi daripada notifikasi
   bertanda tangan palsu — yang kedua sudah punya penghitungnya sejak T3.
   `p_sumber` = `'webhook' | 'status_api'`; yang kedua melahirkan jejak `diperiksa_ulang`.
   Galat basis data dibiarkan MELEMPAR — itulah satu-satunya jalan ke 500.

### 0.5 Nama berkas TypeScript

**DIPERBARUI 27 Sep 2026 — ketiga berkas milik T1/T4 SUDAH ADA di `main`** (P1-A ter-merge di
`79e1e3e`), sama seperti keenam migrasi §0.1. Barisnya di bawah karena itu bukan pekerjaan
melainkan inventaris: buka isinya, jangan membuatnya lagi.

| Path (di `/Users/arvinfairuz/Documents/padma/web/`) | Isi | Lahir |
|---|---|---|
| `src/lib/pesanan/status.ts` | tipe & himpunan status, konstanta waktu. **Tanpa `server-only`** — diimpor komponen klien. **SUDAH ADA di `main`** | T1 |
| `src/lib/pesanan/order-id.ts` | bentuk `kode` & `order_id` Midtrans. Murni, tanpa `server-only`. **SUDAH ADA di `main`** | T4 |
| `src/lib/midtrans/konfig.ts` | pilihan sandbox/produksi + kunci | T8 |
| `src/lib/midtrans/tanda-tangan.ts` | sha512, `timingSafeEqual`, sidik | T8 |
| `src/lib/midtrans/skema.ts` | Zod notifikasi (semua `z.string()`, TIDAK `.strict()`) | T8 |
| `src/lib/midtrans/kode-jawaban.ts` | peta hasil → kode HTTP | T8 |
| `src/lib/midtrans/adapter.ts` | Snap create + Status API (`server-only`) | T8 |
| `src/lib/midtrans/snap-peramban.ts` | pemuat skrip Snap di peramban | T9 |
| `src/lib/pesanan/periksa-menggantung.ts` | Lapis 1b bersama (`server-only`) | T10 |
| `src/lib/pesanan/picu-periksa.ts` | keputusan pemicu Lapis 1b, murni. **Tanpa `server-only`** — diimpor komponen klien | T10 |
| `src/lib/admin/pesanan.ts` | pembaca layar staf | T11 |
| `tests/helpers/klien-kedua.ts` | fixture klien KEDUA ber-akun auth (`EMAIL_KLIEN_KEDUA`, `KLIEN_KEDUA_ID`, `siapkanKlienKedua()`, `bongkarKlienKedua()`). Lahir di T4, **dipakai T4, T9, dan T10** (lihat §0.11). **SUDAH ADA di `main`** | T4 |

### 0.6 Ekspor TypeScript yang dipakai lebih dari satu tugas

```ts
// src/lib/pesanan/status.ts            (T1 melahirkan; T4,8,9,10,11 memakai)
// ARAH TURUNANNYA: array `as const` DULU, tipe SESUDAHNYA — itulah bentuk yang mendarat
// di `main`, dan arahnya bukan selera. Union yang ditulis tangan lebih dulu membuat
// arraynya sekadar mengulanginya, jadi nilai enum keenam yang ditambahkan ke salah satu
// saja lolos tanpa satu pun galat kompilasi. Dengan arah ini arraynya SATU-SATUNYA sumber,
// dan `tests/pesanan-status-db.test.ts` mengadunya dengan `pg_enum` menurut `enumsortorder`.
export const STATUS_PESANAN_SAH = [
  "menunggu_bayar", "ditahan", "lunas", "kedaluwarsa", "dibatalkan",
] as const;                                                     // kelimanya, urut enum
export type StatusPesanan = (typeof STATUS_PESANAN_SAH)[number];
export const SUMBER_ITEM_PESANAN = ["produk_digital", "sesi"] as const;
export type SumberItemPesanan = (typeof SUMBER_ITEM_PESANAN)[number];
export const KEJADIAN_PESANAN_SAH = [                           // 16 nilai, urut enum
  "dibuat", "token_terbit", "notifikasi", "lunas", "ditahan", "kedaluwarsa", "dibatalkan",
  "selisih_nominal", "selisih_status", "lunas_setelah_tutup", "akses_terbit",
  "akses_sudah_ada", "akses_tertahan", "penangan_belum_ada", "diperiksa_ulang",
  "tinjauan_ditutup",
] as const;
// KejadianPesanan DITURUNKAN dari arraynya — `(typeof KEJADIAN_PESANAN_SAH)[number]`,
// BUKAN `string & {}` (keberatan A-4, diterima): `string & {}` menerima string apa pun,
// dan yang membuat salah ketik nama kejadian merah di kompilator T5/T8/T11 justru union-nya.
export type KejadianPesanan = (typeof KEJADIAN_PESANAN_SAH)[number];
export const PESANAN_TERBUKA:     readonly StatusPesanan[];      // ["menunggu_bayar"]
export const PESANAN_TIDAK_AKTIF: readonly StatusPesanan[];      // ["ditahan","lunas","kedaluwarsa","dibatalkan"]
export const PESANAN_BERUANG:     readonly StatusPesanan[];      // ["lunas","ditahan"]
export const PESANAN_MATI:        readonly StatusPesanan[];      // ["kedaluwarsa","dibatalkan"]
export const KEJADIAN_BUTUH_TINJAUAN: readonly KejadianPesanan[];
//   ["selisih_nominal","selisih_status","lunas_setelah_tutup","akses_tertahan","penangan_belum_ada"]
export const LABEL_STATUS_PESANAN: Record<StatusPesanan, string>;
export const JAM_TENGGAT_PESANAN = 24;   // SATU konstanta: kolom kedaluwarsa_pada DAN `expiry` Snap
export const MENIT_JEDA_PERIKSA  = 5;    // pembatas Lapis 1b (diperiksa_pada)
export const JAM_TENGGANG_404    = 1;    // margin terhadap jam Midtrans sebelum 404 = kedaluwarsa
// PEMAKAI WAJIB (aturan rencana ini, BUKAN pagar uji): T10 menyapu dengan
// `.in("status",[...PESANAN_TERBUKA])` — termasuk UPDATE pencap `diperiksa_pada`, yang juga
// dilarang membawa literal; T11 memilih baris layar dengan
// `[...PESANAN_TERBUKA, ...PESANAN_BERUANG]` dan menyaring blok "Butuh perhatian" dengan
// `PESANAN_BERUANG.includes(...)`; `tombol-pesanan.tsx` menggerbangi "Periksa ulang" dengan
// `PESANAN_TERBUKA.includes(status)`. Kedua anggota `PESANAN_BERUANG` di sana menuntut tombol
// yang BERLAWANAN (`lunas` menerbitkan barangnya, `ditahan` meminta manusia memutuskan), dan
// himpunan tidak bisa memisahkan mereka tanpa melahirkan yang kelima — pemisahnya karena itu
// `Record<StatusPesanan, ...>` PENUH, mekanisme `LABEL_STATUS_PESANAN`: nama status jadi KUNCI
// yang diperiksa kompilator, bukan literal yang dibandingkan.
// NOL literal "menunggu_bayar"/"ditahan" di T10/T11, dan NOL himpunan KELIMA yang bernama
// lain. Himpunan tanpa konsumen adalah hiasan, dan hiasan itulah yang membuat nilai enum
// keenam hilang dari layar diam-diam.
// KLAIM "diuji" DICABUT 27 Sep 2026: nol uji di `main` memindai `src/` untuk literal status,
// jadi yang menegakkannya hanyalah peninjau. Menuliskan penegak yang tidak ada lebih buruk
// daripada tidak menuliskan apa pun — pembaca berikutnya berhenti memeriksa sendiri.
// Peta perpindahan status SENGAJA tidak hidup di berkas ini: nol kode produksi P1
// membutuhkannya (yang menilai adalah `perpindahan_pesanan_sah` di transaksi yang sama), dan
// salinan TS kedua hanya jadi tempat kedua yang bisa basi. Ia hidup sebagai PENDAPAT KEDUA di
// `tests/pesanan-status-db.test.ts` (keberatan A-5, diterima).
// src/lib/pesanan/order-id.ts          (T4 melahirkan; T8,10,11 memakai)
// KEDUANYA WAJIB TANPA FLAG `g` (keberatan C-1, diterima — mengikat T4).
// `RegExp.test()` pada regex ber-`g` menyimpan `lastIndex` dan memulangkan false BERGANTIAN:
// di rute webhook itu berarti setiap notifikasi sah KEDUA dijawab 400, dan 400 memberi tahu
// Midtrans "sudah selesai, jangan kirim lagi" — pesanan terkunci mati dengan uang yang masuk.
export const POLA_KODE_PESANAN: RegExp;  // /^PSN-\d{6}-[0-9A-F]{6}$/      TANPA `g`
export const POLA_ORDER_ID: RegExp;      // /^PSN-\d{6}-[0-9A-F]{6}\.[1-9]$/  TANPA `g`
export function rakitOrderId(kode: string, percobaan: number): string;          // `${kode}.${percobaan}`
export function uraiOrderId(orderId: string): { kode: string; percobaan: number } | null;

// src/lib/midtrans/konfig.ts           (T8 melahirkan; T9,10,11 memakai)
export function midtransProduksi(): boolean;        // process.env.MIDTRANS_PRODUKSI === "true", TEPAT itu
// Aturan "HANYA nilai true" dijaga `web/tests/midtrans-konfig.test.ts` (T8, nol basis data):
// delapan masukan (satu positif + tujuh negatif) — "true","TRUE","1","yes","false","", undefined — dan basisSnap()/basisApiMidtrans()
// wajib memuat `.sandbox.` untuk semua kecuali yang pertama.
export function serverKeyMidtrans(): string;        // "" bila tidak terpasang → penelepon memutuskan 503
export function basisSnap(): string;                // app(.sandbox).midtrans.com/snap/v1
export function basisApiMidtrans(): string;         // api(.sandbox).midtrans.com/v2
export function urlSkripSnap(produksi: boolean): string;

// src/lib/midtrans/tanda-tangan.ts     (T8 melahirkan; T10,11 memakai lewat adapter)
export function hitungTandaTangan(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string;
export function tandaTanganCocok(dikirim: string, dihitung: string): boolean;
export function hitungSidik(b: {
  orderId: string; statusCode: string; transactionStatus: string; fraudStatus: string; transactionId: string;
}): string;   // sha256hex([orderId,statusCode,transactionStatus,fraudStatus,transactionId].join("|"))

// src/lib/midtrans/skema.ts            (T8 melahirkan; T10,11 memakai)
// z.object(...) + `export type NotifikasiMidtrans = z.infer<typeof SkemaNotifikasiMidtrans>`,
// BUKAN anotasi `z.ZodType<...>` (keberatan C-8, diterima): anotasi itu membuang `.shape` di zod v4.
// Bentuk tipenya identik:
//   { order_id: string; status_code: string; gross_amount: string; signature_key: string;
//     transaction_status: string; transaction_id: string;
//     fraud_status?: string; payment_type?: string }
// Semua `z.string()`, TIDAK `.strict()`. SATU pengecualian yang mengikat:
//   gross_amount: z.string().regex(/^\d+(\.\d+)?$/)
// Tanpa regex itu, `gross_amount` cacat lolos ke RPC sebagai string, PostgREST gagal cast 22P02,
// rute menjawab 500, dan Midtrans mengulang notifikasi yang sama selamanya. Dengan regex itu ia
// berhenti di 400 `skema_gagal` — badan yang tidak akan pernah berubah.
export const SkemaNotifikasiMidtrans;
export type NotifikasiMidtrans = z.infer<typeof SkemaNotifikasiMidtrans>;

// src/lib/midtrans/kode-jawaban.ts     (T8 melahirkan; dipakai T8; pagar setara WAJIB di T10)
// DIKOREKSI 27 Sep 2026: baris ini sempat berbunyi “dirujuk T12” — grep atas SELURUH Tugas 12
// memberi nol kecocokan untuk `kode-jawaban|KODE_JAWABAN|hasilRpcSah`. Yang benar: T10 memanggil
// RPC yang SAMA dengan T8, jadi ia butuh penjaga himpunan tertutupnya SENDIRI — `const SAH`
// lokal di `periksa-menggantung.ts`, bukan impor dari sini. Berkas ini hidup di sisi server-only
// rute webhook, dan menariknya ke jalur T10 menukar satu cacat dengan cacat lain.
export type HasilWebhook =
  | "badan_terlalu_besar" | "kunci_kosong" | "skema_gagal" | "bentuk_order_id"
  | "tanda_tangan_salah" | "duplikat" | "tanpa_efek" | "diterapkan" | "pesanan_tidak_ada" | "galat";
export const KODE_JAWABAN: Record<HasilWebhook, number>;
// 400,503,400,400,401,200,200,200,200,500 — berurutan seperti tipe di atas
export function hasilRpcSah(nilai: string): nilai is HasilWebhook;
// Penjaga himpunan tertutup nilai balik RPC (keberatan C-4, diterima). Tanpa ia, nilai yang lupa
// dipetakan terbaca `KODE_JAWABAN[undefined]` = undefined, dan `NextResponse.json(..., { status:
// undefined })` menjawab 200 — kegagalan dilaporkan ke Midtrans sebagai selesai.

// src/lib/midtrans/adapter.ts          (T8 melahirkan; T9,10,11 memakai; T12 me-`vi.mock`)
// "12" sempat ikut dicabut bersama lima modul lain pada 27 Sep 2026. Untuk kelimanya itu benar
// (grep atas seluruh Tugas 12 memberi nol kecocokan); untuk berkas INI tidak:
// `tests/pesanan-jadwal-actions.test.ts` menulis `vi.mock("@/lib/midtrans/adapter", ...)` beserta
// kedua ekspornya. Mock ADALAH pemakaian, dan bentuk pemakaian yang paling rapuh pula — ia
// mengunci path modul DAN bentuk kedua ekspornya tanpa satu pun impor yang bisa dilihat
// kompilator. Mengganti nama berkas ini membuat mock T12 diam-diam tidak terpasang, dan yang
// menyelamatkannya hanya pagar `fetch` berkas itu, bukan tipe. Kamus yang menyangkal pemakaian
// itu sama menyesatkannya dengan kamus yang melebih-lebihkannya.
export type PermintaanSnap = { orderId: string; nominal: number; judul: string; kedaluwarsaJam: number };
export async function terbitkanTokenSnap(p: PermintaanSnap):
  Promise<{ ok: true; token: string } | { ok: false; pesan: string }>;
export type StatusMidtrans = {
  order_id: string; status_code: string; transaction_status: string; transaction_id: string;
  gross_amount: string; fraud_status: string | null; payment_type: string | null;
};
export async function bacaStatusTransaksi(orderId: string):
  Promise<{ ok: true; status: StatusMidtrans } | { ok: false; kode: number; pesan: string }>;
// Arti `kode` pada kegagalan MENGIKAT bagi pemanggil:
//   404 = "Transaction doesn't exist" — pemanggil (T10/11/12) yang memutuskan kedaluwarsa,
//         HANYA bila kedaluwarsa_pada + JAM_TENGGANG_404 sudah lewat.
//   0   = tidak bisa dihubungi sama sekali (jaringan/batas waktu), ATAU jawaban Midtrans yang
//         `gross_amount`-nya hilang / bukan angka. BUKAN vonis apa pun tentang transaksinya —
//         T10/T11/T12 TIDAK BOLEH menerjemahkannya jadi status (keberatan C-5, diterima).
//  -1   = `MIDTRANS_SERVER_KEY` belum terpasang; nol permintaan keluar. Kode SENDIRI, bukan 0,
//         karena kedua sebab itu menuntut dua kalimat yang berbeda kepada manusia: jaringan
//         sembuh dengan dicoba lagi, kunci server yang belum dipasang TIDAK PERNAH. T8 sudah
//         memisahkannya di dua permukaan lain (webhook menjawab 503 `kunci_kosong`;
//         `terbitkanTokenSnap` memulangkan "Pembayaran belum aktif. Hubungi tim PADMA."),
//         dan hanya jalur Status API yang sempat meleburnya.
// `gross_amount` pada jalur `ok: true` karena itu SELALU string berbentuk angka. Ia TIDAK
// pernah dipalsukan menjadi "0": "tidak tahu berapa" bukan "nol rupiah", dan memalsukannya
// menggeser pesanan yang SUDAH DIBAYAR PENUH ke `ditahan` ber-nominal_diterima 0 — yang lalu
// tidak bisa diputuskan siapa pun karena `putuskan_pesanan_ditahan` menuntut nominal tercatat.

// src/lib/pesanan/periksa-menggantung.ts   (T10 melahirkan; T11 & T12 memakai)
export const BATAS_PERIKSA_SEKALI = 3;   // batas baris per PEMBUKAAN HALAMAN (Lapis 1b)
// Pasangannya milik T12 dan SENGAJA tidak diekspor dari sini: `const BATAS_SAPUAN = 20` hidup
// sebagai konstanta lokal di `src/app/api/cron/pesanan/route.ts`. Dua angka, dua pemilik, dua
// alasan — tiga karena satu klien hanya punya satu pesanan terbuka, dua puluh karena satu job
// Actions harus selesai sebelum waktunya habis. Menyatukannya berarti mengubah kadens penjadwal
// dengan menyunting pagar laju halaman.
export type PesananDiperiksa = { id: string; kode: string; percobaan: number; kedaluwarsaPada: string };
export type HasilPeriksaPesanan =
  | "diterapkan" | "duplikat" | "tanpa_efek" | "pesanan_tidak_ada"
  | "bentuk_order_id" | "belum_kedaluwarsa" | "midtrans_tak_terjawab" | "kunci_belum_terpasang"
  | "galat_basis_data";
// SEMBILAN nilai. `kunci_belum_terpasang` lahir dari `kode: -1` adapter dan TIDAK boleh
// dilebur ke `midtrans_tak_terjawab`: yang kedua menyuruh staf mencoba lagi, dan kunci server
// yang belum dipasang tidak pernah sembuh dengan dicoba lagi. Tipe, bukan komentar — inilah
// satu-satunya mekanisme di repo ini yang membuat "lupa menangani satu kasus" jadi galat
// kompilasi: `Record<HasilPeriksaPesanan, string>` di T11 memerah sampai petanya lengkap.
export async function terapkanJawabanMidtrans(p: PesananDiperiksa): Promise<HasilPeriksaPesanan>;
// TIDAK PERNAH melempar — termasuk `rakitOrderId`, yang MELEMPAR untuk kode cacat dan karena itu
// WAJIB berada DI DALAM try; hasilnya `"bentuk_order_id"` (keberatan pemeriksa L0-6, diterima).
// Nilai balik RPC-nya dijaga penjaga himpunan tertutup LOKAL (`const SAH`), sikap kepercayaan
// yang sama dengan `hasilRpcSah` di T8 atas RPC yang sama. Nilai di luar himpunan menjadi
// `"galat_basis_data"`, bukan di-cast diam-diam.
export async function sapuPesananMenggantung(
  pemilih: SupabaseClient, batasBaris: number, clientId: string | null = null,
): Promise<{ diperiksa: number }>;   // MELEMPAR bila PEMILIHAN barisnya gagal
// Tanda tangannya `clientId: string | null = null`, BUKAN `clientId?: string | null` — satu
// ejaan saja, karena berkas ini seluruh alasan keberadaannya adalah tanda tangan yang PERSIS.
// `clientId` menyempitkan radius ke satu klien. Lapis 1b WAJIB mengisinya (lihat di bawah);
// Lapis 3 (cron, service role, lintas klien) membiarkannya null.
// Loopnya membungkus SETIAP baris dengan try sendiri: satu baris cacat tidak boleh memakan sapuan.
export async function periksaPesananMenggantung(): Promise<{ diperiksa: number }>;
// Memilih pesanan `menunggu_bayar` MILIK PEMANGGIL lalu menerapkan jawabannya lewat
// terapkan_notifikasi_midtrans DENGAN SERVICE ROLE. Menyembunyikan kegagalan: never throws.
// RADIUSNYA TIDAK BOLEH BERSANDAR PADA RLS SAJA: `orders` punya DUA policy SELECT, dan yang
// kedua (`"pesanan: staf baca"`) memulangkan pesanan SELURUH klien untuk sesi admin/owner.
// Karena itu fungsi ini membaca `clients` milik pemanggil lebih dulu — dengan
// `.eq("user_id", user.id)` EKSPLISIT (pola `ambilKlien`, `src/lib/passport/data.ts:66`),
// bukan `maybeSingle()` telanjang: tanpa klausa itu sesi staf memungut baris `clients`
// siapa saja yang kebetulan pertama, gerbangnya berhenti menggerbang, dan uji
// "SESI STAF tidak memicu pemeriksaan apa pun" lulus karena alasan yang salah (sesi admin
// kebetulan tidak punya baris `clients` di seed hari ini). Tanpa baris klien ia memulangkan
// `{ diperiksa: 0 }`; dengan baris klien ia mengoper `clientId` ke penyapu.

// src/lib/pesanan/picu-periksa.ts       (T10 melahirkan; dipakai komponen klien T9/T10)
export async function picuPeriksaSekali(
  periksa: () => Promise<{ diperiksa: number }>, segarkan: () => void,
): Promise<number>;

// src/lib/admin/pesanan.ts             (T11 melahirkan; T11 saja)
export type ItemPesanan = { pesananId: string; kode: string; jenis: SumberItemPesanan;
  judulBeku: string; hargaBeku: number; urutan: number };
export type BarisPesanan = {
  id: string; kode: string; status: StatusPesanan; percobaan: number; padmaId: string;
  jumlahItem: number; dibuatPada: string; kedaluwarsaPada: string; lunasPada: string | null;
  diperiksaPada: string | null; butuhTinjauanPada: string | null; sebabTinjauan: string | null;
  kanal: string | null; transaksiId: string | null; statusMidtrans: string | null;
  items: ItemPesanan[]; nominalTagih: number; nominalDiterima: number | null;
};
export async function bacaPesananStaf(): Promise<{ butuhPerhatian: BarisPesanan[]; terbuka: BarisPesanan[] }>;
```

### 0.7 Nama env (keempatnya, `.env.example` milik T7)

`MIDTRANS_SERVER_KEY` · `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` · `MIDTRANS_PRODUKSI` · `CRON_SECRET`

**Jebakan yang mengikat T9:** `MIDTRANS_PRODUKSI` **tanpa** prefiks `NEXT_PUBLIC_`, jadi peramban
tidak bisa membacanya. Pilihan URL skrip Snap karena itu dibaca di server (`page.tsx`) dan dioper
sebagai **prop `produksi: boolean`** ke `TombolBeli`. Membacanya dari komponen klien = `undefined`
= selalu sandbox, senyap.

### 0.8 Kosakata `sebab_tinjauan` (teks bebas, tapi dikunci supaya T5/T8/T11 sepakat)

`selisih_nominal` · `selisih_status` · `lunas_setelah_tutup` · `akses_tertahan` · `penangan_belum_ada`
· `refund` · `chargeback`

Nol digit di dalamnya — itu yang membuat uji nominal-sebagai-teks (T2) hijau tanpa pengecualian.

### 0.9 Bentuk `kode` dan `order_id`

`kode` = `PSN-YYMMDD-XXXXXX`, `XXXXXX` = 6 heksadesimal HURUF BESAR dari
`upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))`. Tabrakan diulang maksimum 5 kali.
`order_id` Midtrans = `kode || '.' || percobaan`. Regex keduanya ada di §0.6
(`src/lib/pesanan/order-id.ts`), **tanpa flag `g`**.
Bentuk ini punya **TIGA salinan** — penerbit SQL di `buat_pesanan` (T4), `POLA_KODE_PESANAN`/
`POLA_ORDER_ID` di TypeScript (T4), dan regex di dalam `terapkan_notifikasi_midtrans` (T5).
Tiga salinan menuntut pengikat yang menyentuh ketiganya, dan pengikatnya hidup di T5:
`kode` hasil `buat_pesanan` dikirim lewat `terapkan_notifikasi_midtrans` dan hasilnya wajib
BUKAN `'pesanan_tidak_ada'`. Tanpa itu, satu orang yang menurunkan `upper(...)` di penerbit
membuat SETIAP notifikasi dijawab 200 lalu dibuang, tanpa galat di mana pun.
**Jangan `gen_random_bytes`** — pgcrypto nol hasil di seluruh 90 migrasi (diverifikasi).

### 0.10 Nama daftar putih di `tests/fungsi-mesin-tertutup.test.ts` (T7)

- `MESIN_TERTUTUP` = `["perpindahan_pesanan_sah","salurkan_pesanan","terapkan_notifikasi_midtrans","terbitkan_akses_item"]`
- `TERBUKA_SADAR` — **bukan lagi daftar nama telanjang, melainkan peta nama → GERBANG YANG
  DIHARAPKAN.** Ini perbaikan temuan "uji yang tidak bisa merah": memindai `prosrc` untuk
  `auth.uid()` **atau** `user_role()` tidak bisa membedakan gerbang dari penyebutan, dan
  `putuskan_pesanan_ditahan` sudah memuat KEDUANYA hari ini (`auth.uid()` di sana hanya
  mengambil nama pemutus untuk jejak, bukan menggerbangi apa pun).

  ```ts
  const TERBUKA_SADAR = {
    ambil_produk_gratis:       "auth.uid",
    batalkan_pesanan_saya:     "auth.uid",
    buat_pesanan:              "auth.uid",
    catat_token_snap:          "auth.uid",
    putuskan_pesanan_ditahan:  "user_role",
    tutup_tinjauan:            "user_role",
  } as const;
  ```
- `POLA_PENULIS` = `/(insert\s+into|update)\s+(public\.)?(orders|order_items|jejak_pesanan|digital_entitlements|notifikasi_pesanan)\b/i`
  dijalankan atas `pg_proc.prosrc` **yang komentarnya sudah dibuang**. Disalin ulang dari
  `tests/fungsi-mesin-tertutup.test.ts:114-115` di `main` (T7 sudah mendarat): `notifikasi_pesanan`
  ikut karena `terapkan_notifikasi_midtrans` menyisipkan sidiknya ke sana, dan kamus yang
  kehilangan satu tabel membuat penulis baru atas tabel itu lolos tanpa masuk daftar mana pun.

Pengikatnya: setiap fungsi yang cocok `POLA_PENULIS` wajib ada di **tepat satu** daftar.
`MESIN_TERTUTUP` di-assert per-nama (bukan `toEqual` atas himpunan turunan), supaya
`tolak_ubah_item_pesanan`, `catat_notifikasi_ditolak`, dan `catat_notifikasi_tak_dikenal` —
tertutup tapi bukan penulis — tidak memerahkan apa pun.

**Dua aturan pemindaian yang mengikat T7** (tanpa keduanya pagar ini lahir hijau selamanya):

1. **Komentar dibuang sebelum dipindai**, di kueri katalog:
   `regexp_replace(coalesce(p.prosrc,''), '--[^\n]*', '', 'g')`. `prosrc` MEMUAT komentar, jadi
   satu baris `-- gerbangnya lewat user_role()` di dalam badan `$$` sudah cukup meluluskan fungsi
   apa pun. Rencana ini sendiri membuktikan bahayanya: komentar `tolak_ubah_item_pesanan` di T2
   sengaja ditaruh DI LUAR badan `$$` supaya tidak memalsukan kecocokan `POLA_PENULIS`.
2. **Kontrol positif permanen**, dan ia MURNI — nol sentuhan basis data bersama: predikatnya
   diekstrak jadi fungsi biasa `bergerbang(badan: string, gerbang: "auth.uid" | "user_role")`,
   lalu diadu dengan literal. Badan yang HANYA memuat `-- auth.uid()` wajib DITOLAK; badan yang
   memuat `user_role()` sungguhan wajib diterima; dan badan ber-`auth.uid()` wajib ditolak ketika
   gerbang yang diharapkan `user_role`.

**Pagar kedua yang menyentuh KELIMA tugas: `tests/pesanan-teks-tanpa-nominal.test.ts` (T2).**
Ia tidak memindai fixture-nya sendiri — ia memindai SELURUH ISI tabel `jejak_pesanan` yang ada
saat ia berjalan, dengan `POLA_DIGIT_TELANJANG = /(?<![\w.:-])\d{4,}(?![\w-])/` dan daftar putih
`kejadian` yang hanya berisi `selisih_nominal` dan `selisih_status`. Karena `fileParallelism: false`,
baris yang ditinggalkan berkas lain tetap HIDUP saat pagar ini jalan, jadi fixture tugas mana pun
bisa memerahkannya — di berkas orang lain, dengan sebab yang tidak disebut di berkas mana pun.
Kelima pembaca pra-terbang menemukan risiko ini terpisah dan menyimpulkan "aman" terpisah; hijaunya
hari ini bergantung pada kebetulan bahwa judul fixture tidak memuat empat digit berturut. Kebetulan
bukan kewajiban, jadi kewajibannya ditulis di sini, satu kali, untuk semua:

> Setiap fixture P1-B — `judul` produk, `judul_beku`, `transaction_id`,
> `keterangan` jejak — DILARANG memuat empat digit berturut-turut yang tidak
> diapit `-`, `.`, `:`, atau huruf. Pagarnya `tests/pesanan-teks-tanpa-nominal.test.ts`
> dan ia memindai baris HIDUP lintas berkas, bukan fixture-nya sendiri.

Bentuk `kode` (`PSN-260926-XX0001`) dan `trx-<kode>.<percobaan>` sudah memenuhi larangan itu karena
setiap deret digitnya diapit `-` atau huruf. Yang berbahaya adalah judul produk uji ber-tahun
(`"Kelas 2026"`), nominal yang diketik ke `keterangan`, dan `transaction_id` buatan tangan
berupa angka telanjang.

### 0.11 Peta fixture: berkas uji → klien seed

`pesanan_terbuka_satu_per_klien` adalah unique partial atas `(client_id) where status =
'menunggu_bayar'` (`20260926110000:116-117`). Ia berlaku **per KLIEN, bukan per produk**: satu
klien hanya boleh punya SATU pesanan terbuka di seluruh basis data, jadi dua fixture terbuka atas
klien yang sama — walau produknya berbeda — mustahil hidup bersamaan.

`tests/pesanan-teks-tanpa-nominal.test.ts:110-112` sudah memilih Rina dengan alasan tertulis
("supaya fixture di sini tidak bertabrakan dengan `pesanan_terbuka_satu_per_klien` milik berkas uji
lain") dan dulu menunjuk "peta §13.2" yang tidak pernah ada. Inilah petanya — dan rujukan di
berkas itu sudah diarahkan ke sini (27 Sep 2026), bukan dibuang: alasan memilih Rina tetap
berlaku, yang hilang hanya alamatnya.

Ketiga klien seed yang dipakai: **Ananda** `44444444-4444-4444-4444-444444444401` (ber-akun
auth), **Rina** `44444444-4444-4444-4444-444444444402` (sengaja TANPA akun auth), dan **Klien
Kedua** `KLIEN_KEDUA_ID` = `44444444-4444-4444-4444-4444444444c2` (fixture yang dibuat dan
dibongkar sendiri oleh berkas yang memakainya).

| Berkas uji | Klien yang menampung pesanan `menunggu_bayar` | Catatan |
|---|---|---|
| `tests/pesanan-teks-tanpa-nominal.test.ts` (T2, sudah di `main`) | Rina | pagar lintas-berkas; presedennya lahir di sini |
| `tests/pesanan-webhook.test.ts` (T8) | Ananda | pesanan lahir lewat `buat_pesanan` dengan sesi Ananda |
| `tests/pesanan-checkout-rute.test.ts` (T9) | Ananda | `KLIEN_KEDUA_ID` dipakai sebagai SESI kedua saja ("klien B tidak bisa membatalkan pesanan klien A") — nol pesanan atas namanya |
| `tests/pesanan-periksa-dibuka.test.ts` (T10) | Ananda + Rina + Klien Kedua | baris ber-`kode` SENGAJA CACAT wajib di `KLIEN_KEDUA_ID` |
| `tests/admin-pesanan.test.tsx` (T11) | Ananda + Rina | dua baris blok "Terbuka", satu per klien |
| `tests/pesanan-jadwal-actions.test.ts` (T12) | Ananda | satu baris terbuka |

**Dua aturan mengikat, dan keduanya berlaku untuk setiap berkas uji P1-B:**

1. **Satu pesanan `menunggu_bayar` per klien per berkas.** Butuh baris terbuka kedua? Pakai klien
   seed berikutnya dari peta di atas, atau `siapkanKlienKedua()` (`tests/helpers/klien-kedua.ts`,
   sudah ada di `main`) — jangan menambah produk kedua dan berharap indeksnya per produk.
   Dan begitu sebuah berkas mengambil klien baru, **barisnya ditambahkan ke peta ini**: peta yang
   berhenti diperbarui adalah peta yang menyesatkan lebih buruk daripada ketiadaan peta.
2. **Pembersih fixture mencari lewat KUNCI PRIMER, tidak pernah lewat kolom yang bisa disunting
   ujinya sendiri.** `bersihkan()` menghapus lewat `id` yang sudah dipegang (dikumpulkan saat
   menyemai), bukan lewat `.like("kode", ...)`, `.eq("status", ...)`, atau `.eq("slug", ...)`.
   Bentuk kegagalannya bukan uji merah melainkan basis data yang TERACUNI PERMANEN: T10 mengganti
   `orders.kode` jadi `"bukan-kode-pesanan"` untuk menguji jalur `bentuk_order_id`, dan pembersih
   yang mencari lewat `kode` tidak akan pernah menemukan barisnya lagi. Baris terbuka yang hidup
   selamanya membuat SETIAP `buat_pesanan` untuk klien itu gagal di T8, T11, dan T12 — dan karena
   Supabase lokal dipakai bersama sesi lain, racunnya menyeberang keluar dari suite ini.

   Yang mengikat adalah LARANGANNYA, bukan mekanismenya: berkas yang tidak pernah menyunting
   `kode` (T8, T11, T12) boleh tetap memakai awalan `kode` untuk menyapu sisa run sebelumnya,
   dan T10 memakainya sekali di `beforeAll` untuk hal yang sama. Yang dilarang adalah
   penghapusan DALAM-RUN yang bersandar pada kolom yang disunting ujinya sendiri — dan T10
   satu-satunya berkas P1-B yang menyunting salah satu.

### 0.12 Perintah menghapus tidak pernah memakai nomor baris

Setiap langkah yang menyuruh MENGHAPUS sesuatu dari berkas yang sudah ada menyebut **namanya**
— komponen, fungsi, baris tabel — dan batasnya ("dari dokbloknya sampai kurung tutupnya"),
**bukan rentang baris**. Alasannya bukan kerapian: nomor baris adalah satu-satunya bentuk
rujukan di dokumen ini yang bisa SALAH tanpa terlihat salah. Rencana ini sendiri membawa
buktinya — perintah "hapus baris 119–137" pada `tombol-ambil.tsx` menunjuk `return baris !== null;`
milik `punyaProdukDiPeramban`, fungsi yang tugas yang sama IMPOR; dituruti harfiah, fungsinya
rusak dan ekor komponen yang mau dihapus justru menggantung.

Kelas yang sama berlaku untuk **menyisipkan**: keempat suntingan `web/README.md` di rencana ini
menyebut baris jangkarnya (`` `/api/cron/tenggat` ``, `` `/admin/bayar` ``,
`` `/api/pesanan/[id]/batal` ``, `` `/api/produk/[id]/unduh` ``) dan menambahkan
"**cari barisnya, jangan percaya nomornya**" — karena setiap tugas menggeser nomor tugas
berikutnya. Nomor baris boleh tetap ditulis sebagai ancar-ancar; ia tidak pernah jadi perintah.

---
---

### Task 8: Adapter Midtrans + rute webhook

Akar repo `/Users/arvinfairuz/Documents/padma`; aplikasi di `web/`. Semua perintah di
bawah dijalankan dari `/Users/arvinfairuz/Documents/padma/web`.

Ini **pintu masuk uang** ke PADMA. Mendarat sesudah Task 1–7.

**BACA DULU sebagai pola yang ditiru** (path lengkap):
- `/Users/arvinfairuz/Documents/padma/web/src/app/api/skrining/route.ts` baris 29–58 —
  `bacaBodyTerbatas()`, pagar byte NYATA. Fungsi itu **tidak diekspor**; salin sebagai
  fungsi lokal ke rute baru. **Jangan menyunting rute skrining** — ia di luar cakupan.
- `/Users/arvinfairuz/Documents/padma/web/src/app/api/cron/tenggat/route.ts` — bentuk
  rute mesin: `createAdminSupabase()`, `NextResponse.json`, dokblok yang menjelaskan
  KENAPA rahasia dan bukan `requireRole`.
- `/Users/arvinfairuz/Documents/padma/web/src/lib/skrining/skema.ts` — gaya Zod repo ini.
- `/Users/arvinfairuz/Documents/padma/web/src/lib/r2.ts` baris 1–40 — `import "server-only"`
  dan helper `wajib()`/pembacaan env di satu tempat.
- `/Users/arvinfairuz/Documents/padma/web/tests/cron-tenggat.test.ts` — bentuk uji rute:
  `const { POST } = await import(...)`, `new Request("http://localhost/...", {...})`.
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-ambil-gratis.test.ts` baris 1–22 —
  cetakan `semai()` untuk produk digital (produk + berkas + harga) dan pembersihannya.
- `/Users/arvinfairuz/Documents/padma/web/tests/jejak-yatim.test.ts` — **wajib dibaca**.
  Tabel jejak sengaja tanpa FK, jadi berkas uji yang membuat lalu menghapus pesanan
  **WAJIB menyapu `jejak_pesanan` dan `notifikasi_pesanan` miliknya sendiri lewat
  service role**, atau saudaranya `tests/pesanan-jejak-yatim.test.ts` (Task 3) merah.
- `/Users/arvinfairuz/Documents/padma/web/tests/setup-fetch-guard.ts` — **JANGAN
  disunting.** Ia daftar izin; menambahkan `.sandbox.midtrans.com` berarti memberi izin
  suite menembak Midtrans sungguhan.
- `/Users/arvinfairuz/Documents/padma/web/README.md` baris 152–163 — tabel rute
  non-halaman; baris `/api/cron/tenggat` ada di baris 158.

**Files:**
- Create: `web/src/lib/midtrans/konfig.ts`
- Create: `web/src/lib/midtrans/tanda-tangan.ts`
- Create: `web/src/lib/midtrans/skema.ts`
- Create: `web/src/lib/midtrans/kode-jawaban.ts`
- Create: `web/src/lib/midtrans/adapter.ts`
- Create: `web/src/app/api/pembayaran/midtrans/route.ts`
- Modify: `web/README.md:158` (menyisipkan SATU baris tepat sesudah baris
  `` `/api/cron/tenggat` ``. Nomor baris itu benar pada `main` hari ini; bila tugas lain
  sudah menyisipkan barisnya duluan, **cari barisnya, jangan percaya nomornya**.)
- Create: `web/tests/midtrans-konfig.test.ts` — **nol basis data, nol jaringan**
- Test: `web/tests/pesanan-webhook.test.ts`, `web/tests/midtrans-konfig.test.ts`

**Interfaces:**
- Consumes (T3): `public.catat_notifikasi_ditolak() returns void` dan
  `public.catat_notifikasi_tak_dikenal() returns void` — keduanya dipanggil dengan
  **service role**, `security definer`, upsert `+ 1` pada `current_date`. Yang pertama untuk
  tanda tangan salah (sebelum 401), yang kedua untuk `pesanan_tidak_ada` (sebelum 200).
- Consumes (T4): `web/src/lib/pesanan/order-id.ts` →
  `export const POLA_ORDER_ID: RegExp` (`/^PSN-\d{6}-[0-9A-F]{6}\.[1-9]$/`),
  `export function rakitOrderId(kode: string, percobaan: number): string`;
  dan RPC `public.buat_pesanan(p_product_id uuid, p_ulang boolean default false) returns table (pesanan_id uuid, kode text, percobaan smallint, nominal_tagih integer, judul text)`
  (dipakai uji untuk menyemai pesanan lewat jalur sungguhan).
- Consumes (T5): `public.terapkan_notifikasi_midtrans(p_order_id text, p_transaction_status text, p_fraud_status text, p_transaction_id text, p_payment_type text, p_gross_amount numeric, p_sidik text, p_sumber text default 'webhook') returns text`
  — memulangkan salah satu dari `'diterapkan' | 'duplikat' | 'tanpa_efek' | 'pesanan_tidak_ada'`.
- Consumes (repo): `createAdminSupabase()` dari `@/lib/supabase/admin`; `zod` v4.
- Produces (dipakai T9, T10, T11, T12 — tanda tangan PERSIS):

```ts
// src/lib/midtrans/konfig.ts
export function midtransProduksi(): boolean;
export function serverKeyMidtrans(): string;
export function basisSnap(): string;
export function basisApiMidtrans(): string;
export function urlSkripSnap(produksi: boolean): string;

// src/lib/midtrans/tanda-tangan.ts
export function hitungTandaTangan(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string;
export function tandaTanganCocok(dikirim: string, dihitung: string): boolean;
export function hitungSidik(b: { orderId: string; statusCode: string; transactionStatus: string; fraudStatus: string; transactionId: string }): string;

// src/lib/midtrans/skema.ts
export const SkemaNotifikasiMidtrans;              // z.object, TIDAK .strict()
export type NotifikasiMidtrans = { order_id: string; status_code: string; gross_amount: string; signature_key: string; transaction_status: string; transaction_id: string; fraud_status?: string; payment_type?: string };

// src/lib/midtrans/kode-jawaban.ts
export type HasilWebhook = "badan_terlalu_besar" | "kunci_kosong" | "skema_gagal" | "bentuk_order_id" | "tanda_tangan_salah" | "duplikat" | "tanpa_efek" | "diterapkan" | "pesanan_tidak_ada" | "galat";
export const KODE_JAWABAN: Record<HasilWebhook, number>;
export function hasilRpcSah(nilai: string): nilai is HasilWebhook;

// src/lib/midtrans/adapter.ts   (server-only)
export type PermintaanSnap = { orderId: string; nominal: number; judul: string; kedaluwarsaJam: number };
export async function terbitkanTokenSnap(p: PermintaanSnap): Promise<{ ok: true; token: string } | { ok: false; pesan: string }>;
export type StatusMidtrans = { order_id: string; status_code: string; transaction_status: string; transaction_id: string; gross_amount: string; fraud_status: string | null; payment_type: string | null };
export async function bacaStatusTransaksi(orderId: string): Promise<{ ok: true; status: StatusMidtrans } | { ok: false; kode: number; pesan: string }>;
```

- Produces: `POST /api/pembayaran/midtrans`, `export const runtime = "nodejs"`, **nol
  ekspor GET**.

---

- [ ] **Step 1: Tulis `src/lib/midtrans/konfig.ts`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/lib/midtrans/konfig.ts`:

```ts
/**
 * Pemilihan lingkungan Midtrans — satu tempat, dan hanya satu.
 *
 * SENGAJA bukan `NODE_ENV`: pratinjau Vercel berjalan dengan
 * `NODE_ENV=production` dan akan menembak Midtrans PRODUKSI, yaitu uang
 * sungguhan dari lingkungan yang dibuat untuk coba-coba. Yang memilih adalah
 * env terpisah, dan HANYA nilai `"true"` persis — bukan `"1"`, bukan `"TRUE"`,
 * bukan "apa pun yang truthy". Env yang salah ketik harus jatuh ke sandbox,
 * karena arah kegagalan yang aman di sini hanya satu.
 *
 * TANPA `server-only`: `urlSkripSnap()` dipanggil dari komponen klien. Yang
 * TIDAK boleh dipanggil dari peramban adalah `midtransProduksi()` dan
 * `serverKeyMidtrans()` — `MIDTRANS_PRODUKSI` tidak berprefix `NEXT_PUBLIC_`,
 * jadi di peramban ia `undefined` dan hasilnya SELALU sandbox, tanpa satu pun
 * galat. Karena itu `urlSkripSnap` menerima pilihannya sebagai PARAMETER, dan
 * yang membacanya adalah server (lihat `/produk/[slug]/page.tsx`).
 */

/** `true` hanya untuk nilai `"true"` persis. Apa pun selain itu = sandbox. */
export function midtransProduksi(): boolean {
  return process.env.MIDTRANS_PRODUKSI === "true";
}

/**
 * `""` bila tidak terpasang — penelepon yang memutuskan artinya, dan keputusan
 * itu berbeda per penelepon. Webhook memutuskan 503 (Midtrans WAJIB mengirim
 * ulang); adapter memutuskan menolak menerbitkan token.
 */
export function serverKeyMidtrans(): string {
  return process.env.MIDTRANS_SERVER_KEY ?? "";
}

export function basisSnap(): string {
  return midtransProduksi()
    ? "https://app.midtrans.com/snap/v1"
    : "https://app.sandbox.midtrans.com/snap/v1";
}

export function basisApiMidtrans(): string {
  return midtransProduksi()
    ? "https://api.midtrans.com/v2"
    : "https://api.sandbox.midtrans.com/v2";
}

/**
 * URL skrip Snap untuk peramban. Pilihannya DIOPER, tidak dibaca dari env di
 * sini — lihat dokblok berkas. Fungsi ini sengaja tidak memanggil
 * `midtransProduksi()`; kalau ia melakukannya, komponen klien yang memanggilnya
 * akan selalu mendapat sandbox dan tidak ada yang tahu sampai pembayaran
 * produksi pertama gagal.
 */
export function urlSkripSnap(produksi: boolean): string {
  return produksi
    ? "https://app.midtrans.com/snap/snap.js"
    : "https://app.sandbox.midtrans.com/snap/snap.js";
}
```

---

- [ ] **Step 2: Tulis `src/lib/midtrans/tanda-tangan.ts`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/lib/midtrans/tanda-tangan.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Tanda tangan notifikasi Midtrans:
 *   sha512(order_id + status_code + gross_amount + serverKey)
 *
 * Keempatnya dirangkai APA ADANYA, tanpa pemisah, tanpa normalisasi. Itulah
 * kenapa skema notifikasi memakai `z.string()` dan bukan `z.coerce.number()`:
 * mengubah `"150000.00"` menjadi angka lalu kembali menghasilkan `"150000"`,
 * tanda tangannya tidak cocok, dan kegagalannya terlihat persis seperti
 * "Midtrans salah" — padahal kita yang mengubah bahan yang ditandatangani.
 */
export function hitungTandaTangan(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash("sha512")
    .update(orderId + statusCode + grossAmount + serverKey, "utf8")
    .digest("hex");
}

/**
 * Banding waktu-tetap.
 *
 * `timingSafeEqual` MELEMPAR ketika panjang kedua buffer berbeda — bukan
 * memulangkan false. Memanggilnya tanpa menyamakan panjang lebih dulu berarti
 * satu notifikasi bertanda tangan pendek menjatuhkan rute ke 500, dan 500
 * mengundang Midtrans mengirim ulang selamanya.
 *
 * Panjang yang dibandingkan di sini tidak membocorkan rahasia apa pun: kedua
 * sisi adalah sha512 heksadesimal, yaitu 128 karakter TETAP. Panjang yang
 * berbeda sudah berarti "bukan dari Midtrans" sebelum satu byte pun dibanding.
 */
export function tandaTanganCocok(dikirim: string, dihitung: string): boolean {
  const a = Buffer.from(dikirim, "utf8");
  const b = Buffer.from(dihitung, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sidik idempotensi — kunci `unique` di `notifikasi_pesanan`.
 *
 * Yang BUKAN sidik, dan kenapa: `order_id` saja atau `transaction_id` saja
 * adalah tebakan yang sangat wajar, dan keduanya memakan uang. Midtrans
 * mengirim BEBERAPA notifikasi per pesanan (`pending` lalu `settlement`, kadang
 * `capture` lalu `settlement`). Dengan sidik se-pesanan, notifikasi `pending`
 * mendarat duluan, mengunci barisnya, dan `settlement` ditolak sebagai
 * duplikat — pembeli membayar, uangnya masuk ke Midtrans, pesanannya tinggal
 * `menunggu_bayar` selamanya.
 *
 * `fraudStatus` ikut karena `capture`+`challenge` dan `capture`+`accept` adalah
 * DUA KEPUTUSAN BERBEDA atas transaksi yang sama.
 *
 * Dipisah `"|"` supaya dua bidang tetangga tidak bisa bertukar batas
 * ("ab"+"c" dan "a"+"bc" adalah string yang sama tanpa pemisah).
 */
export function hitungSidik(b: {
  orderId: string;
  statusCode: string;
  transactionStatus: string;
  fraudStatus: string;
  transactionId: string;
}): string {
  return createHash("sha256")
    .update(
      [b.orderId, b.statusCode, b.transactionStatus, b.fraudStatus, b.transactionId].join("|"),
      "utf8",
    )
    .digest("hex");
}
```

---

- [ ] **Step 3: Tulis `src/lib/midtrans/skema.ts` dan `src/lib/midtrans/kode-jawaban.ts`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/lib/midtrans/skema.ts`:

```ts
import { z } from "zod";

/**
 * Notifikasi webhook Midtrans.
 *
 * SEMUA `z.string()`, tidak satu pun `z.coerce` — lihat dokblok
 * `hitungTandaTangan`: yang ditandatangani adalah string PERSIS seperti dikirim.
 *
 * TIDAK `.strict()`, dan itu keputusan, bukan kelalaian. Midtrans menambah
 * field ke payloadnya dari waktu ke waktu (`currency`, `merchant_id`,
 * `settlement_time`, `expiry_time`, …). Skema ketat akan menolak notifikasi sah
 * dengan 400 — dan 400 memberi tahu Midtrans "sudah selesai, jangan kirim lagi".
 * Satu field baru dari pihak ketiga akan MENGUNCI PESANAN MATI, dengan uang
 * yang sudah masuk. Field yang tidak kita kenal diabaikan.
 *
 * `fraud_status` opsional karena hanya ada pada transaksi kartu; `payment_type`
 * opsional karena Status API dan webhook tidak selalu sepakat mengirimkannya.
 */
export const SkemaNotifikasiMidtrans = z.object({
  order_id: z.string(),
  status_code: z.string(),
  /**
   * SATU-SATUNYA medan yang dibatasi bentuknya, dan alasannya bukan kerapian:
   * nilainya dikirim apa adanya sebagai `p_gross_amount numeric` ke RPC. Tanpa
   * batas ini, `gross_amount` yang bukan angka lolos sebagai string, PostgREST
   * gagal cast dengan `22P02`, rute menjawab **500**, dan Midtrans mengulang
   * notifikasi yang sama SELAMANYA — 500 adalah satu-satunya kelas yang
   * retry-nya benar-benar dianggap bisa menyembuhkan. Dengan batas ini ia
   * berhenti di 400 `skema_gagal`: badan yang tidak akan pernah berubah, dan
   * mengulanginya percuma.
   *
   * Tetap `z.string()`, bukan `z.coerce.number()`: yang ditandatangani adalah
   * string PERSIS seperti dikirim, dan yang meng-cast adalah basis data —
   * satu kali, ke tipe kolom yang sudah memutuskan presisinya.
   */
  gross_amount: z.string().regex(/^\d+(\.\d+)?$/),
  signature_key: z.string(),
  transaction_status: z.string(),
  transaction_id: z.string(),
  fraud_status: z.string().optional(),
  payment_type: z.string().optional(),
});

export type NotifikasiMidtrans = z.infer<typeof SkemaNotifikasiMidtrans>;
```

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/lib/midtrans/kode-jawaban.ts`:

```ts
/**
 * Peta hasil webhook -> kode HTTP.
 *
 * "Retry Midtrans sebagai lapis nol" hanya berarti bila setiap keluaran punya
 * kodenya sendiri. Yang dijaga peta ini:
 *   4xx = badan yang TIDAK AKAN PERNAH berubah; mengulanginya percuma.
 *   200 = tidak ada lagi yang tersisa untuk disembuhkan.
 *   503 = salah KITA, sementara; Midtrans wajib mengirim ulang.
 *   500 = satu-satunya kelas yang retry benar-benar menyembuhkan.
 *
 * Yang paling mudah salah adalah `kunci_kosong`. 2xx/4xx di sana memberi tahu
 * Midtrans "sudah selesai" dan notifikasi itu tidak pernah datang lagi; 503
 * membuat env yang lupa dipasang berakhir sebagai KETERLAMBATAN, bukan sebagai
 * uang yang hilang.
 *
 * `pesanan_tidak_ada` TIDAK ada di tabel peta kode jawaban spec. Ia lahir
 * karena rute harus menangani "tanda tangan sah, tetapi `order_id` tidak
 * menunjuk pesanan mana pun" — mis. pesanan sandbox lama, atau basis data yang
 * di-reset. Ia masuk kelas 200: tanda tangannya sah, jadi ini memang dari
 * Midtrans, dan tidak ada apa pun yang bisa disembuhkan dengan mengulang.
 */
export type HasilWebhook =
  | "badan_terlalu_besar"
  | "kunci_kosong"
  | "skema_gagal"
  | "bentuk_order_id"
  | "tanda_tangan_salah"
  | "duplikat"
  | "tanpa_efek"
  | "diterapkan"
  | "pesanan_tidak_ada"
  | "galat";

export const KODE_JAWABAN: Record<HasilWebhook, number> = {
  badan_terlalu_besar: 400,
  kunci_kosong: 503,
  skema_gagal: 400,
  bentuk_order_id: 400,
  tanda_tangan_salah: 401,
  duplikat: 200,
  tanpa_efek: 200,
  diterapkan: 200,
  pesanan_tidak_ada: 200,
  galat: 500,
};

/** Himpunan TERTUTUP yang boleh dipulangkan `terapkan_notifikasi_midtrans`. */
const HASIL_RPC = new Set<string>(["diterapkan", "duplikat", "tanpa_efek", "pesanan_tidak_ada"]);

/**
 * Nilai balik RPC yang tidak dikenal harus menjadi 500, bukan diam-diam 200.
 * Tanpa penjaga ini, satu nilai enum baru di SQL yang lupa dipetakan akan
 * terbaca sebagai `KODE_JAWABAN[undefined]` — yaitu `undefined` — dan
 * `NextResponse.json(..., { status: undefined })` menjawab 200. Pesanan yang
 * gagal diproses akan dilaporkan "selesai" ke Midtrans.
 */
export function hasilRpcSah(nilai: string): nilai is HasilWebhook {
  return HASIL_RPC.has(nilai);
}
```

---

- [ ] **Step 3b: Tulis `tests/midtrans-konfig.test.ts` — env yang memutuskan ke mana uang pergi**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/tests/midtrans-konfig.test.ts`. Nol basis
data, nol jaringan, dan berkas tersendiri dengan sengaja: yang dijaganya murni pembacaan env,
dan menyatukannya dengan uji rute membuat kegagalan konfigurasi terbaca sebagai kegagalan
webhook.

```ts
import { describe, it, expect, afterEach } from "vitest";
import { midtransProduksi, basisSnap, basisApiMidtrans, urlSkripSnap } from "@/lib/midtrans/konfig";

/**
 * `MIDTRANS_PRODUKSI` — HANYA nilai `"true"` PERSIS.
 *
 * Empat fungsi di `konfig.ts` memutuskan ke mana uang sungguhan dikirim, dan
 * sampai berkas ini lahir tidak satu pun punya uji. Spec menaruh aturan ini di
 * daftar env dengan huruf tebal DAN menyebut sendiri bentuk kegagalannya:
 * pratinjau Vercel berjalan dengan `NODE_ENV=production` dan akan menembak
 * Midtrans produksi — uang sungguhan dari lingkungan yang dibuat untuk
 * coba-coba.
 *
 * Skenario konkretnya satu commit jauhnya: seseorang membaca
 * `MIDTRANS_PRODUKSI=false` di `.env.example` lalu menulis
 * `return Boolean(process.env.MIDTRANS_PRODUKSI)` atau `!== "false"` — dua
 * bentuk yang terlihat setara sekilas. `Boolean("false")` adalah `true`. Sejak
 * commit itu SETIAP pratinjau dan setiap mesin dev yang memasang env apa pun
 * menembak `api.midtrans.com` dengan kunci produksi, ke pesanan yang basis
 * datanya basis data coba-coba. Arah kegagalan yang aman di sini hanya satu:
 * apa pun yang tidak persis `"true"` jatuh ke sandbox.
 */
const asli = process.env.MIDTRANS_PRODUKSI;

afterEach(() => {
  if (asli === undefined) delete process.env.MIDTRANS_PRODUKSI;
  else process.env.MIDTRANS_PRODUKSI = asli;
});

function pasang(nilai: string | undefined): void {
  if (nilai === undefined) delete process.env.MIDTRANS_PRODUKSI;
  else process.env.MIDTRANS_PRODUKSI = nilai;
}

describe("MIDTRANS_PRODUKSI memilih lingkungan", () => {
  it('nilai "true" PERSIS — dan hanya itu — memilih produksi', () => {
    pasang("true");
    expect(midtransProduksi()).toBe(true);
    expect(basisSnap()).not.toContain(".sandbox.");
    expect(basisApiMidtrans()).not.toContain(".sandbox.");
    expect(basisSnap()).toBe("https://app.midtrans.com/snap/v1");
    expect(basisApiMidtrans()).toBe("https://api.midtrans.com/v2");
  });

  it.each([["TRUE"], ["True"], ["1"], ["yes"], ["false"], [""], [undefined]])(
    "nilai %p jatuh ke SANDBOX",
    (nilai) => {
      pasang(nilai as string | undefined);
      expect(midtransProduksi()).toBe(false);
      expect(basisSnap()).toContain(".sandbox.");
      expect(basisApiMidtrans()).toContain(".sandbox.");
    },
  );

  it("urlSkripSnap memakai PARAMETERNYA, bukan env", () => {
    // Pasangan dari larangan negatif di tests/produk-tombol-beli.test.tsx:
    // `MIDTRANS_PRODUKSI` tanpa prefiks NEXT_PUBLIC_ berarti komponen klien
    // yang membacanya sendiri SELALU mendapat undefined — sandbox, di
    // produksi, tanpa satu pun galat. Karena itu pilihannya dioper.
    pasang("true");
    expect(urlSkripSnap(false)).toContain("app.sandbox.midtrans.com");
    expect(urlSkripSnap(true)).toBe("https://app.midtrans.com/snap/snap.js");
  });
});
```

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/midtrans-konfig.test.ts
```

Kesembilan kasus hijau. Bila `nilai "TRUE" jatuh ke SANDBOX` merah, `konfig.ts` memakai
perbandingan yang tidak case-sensitive atau `Boolean(...)` — perbaiki di `konfig.ts`, jangan
melonggarkan ujinya.

- [ ] **Step 4: Tulis `src/lib/midtrans/adapter.ts`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/lib/midtrans/adapter.ts`:

```ts
import "server-only";
import { basisApiMidtrans, basisSnap, serverKeyMidtrans } from "./konfig";

/**
 * Satu-satunya berkas di PADMA yang berbicara ke Midtrans lewat jaringan.
 *
 * `server-only`: kunci SERVER dipakai sebagai Basic auth di sini. Berkas ini
 * tidak boleh pernah ikut terbundel ke peramban, dan direktif itulah yang
 * membuat impor yang salah gagal saat build alih-alih membocorkan kunci diam-diam.
 *
 * Batas waktu dipasang eksplisit. `fetch` bawaan Node tidak punya batas waktu
 * bawaan — permintaan yang menggantung akan menahan rute checkout sampai
 * platform yang memutusnya, dan pembeli melihat tombol yang berputar selamanya.
 */
const BATAS_MS = 10_000;

function otorisasi(): string {
  // Midtrans memakai Basic auth: server key sebagai username, password KOSONG.
  // Titik dua di ujung bukan salah ketik.
  return `Basic ${Buffer.from(`${serverKeyMidtrans()}:`).toString("base64")}`;
}

/** Midtrans menolak `item_details.name` lebih dari 50 karakter. */
function potong(teks: string, maks: number): string {
  return teks.length <= maks ? teks : `${teks.slice(0, maks - 1)}…`;
}

export type PermintaanSnap = {
  orderId: string;
  nominal: number;
  judul: string;
  kedaluwarsaJam: number;
};

/**
 * Menerbitkan token Snap.
 *
 * `expiry` dikirim dari konstanta yang SAMA dengan yang mengisi
 * `orders.kedaluwarsa_pada` (`JAM_TENGGAT_PESANAN`). Dua angka yang boleh
 * berbeda adalah dua kegagalan simetris: kolom lebih pendek -> kita berhenti
 * bertanya sementara VA-nya masih bisa dibayar, dan settlement mendarat pada
 * pesanan yang sudah kita tutup; kolom lebih panjang -> penyapu menanyai
 * Midtrans tentang transaksi yang tidak akan pernah berubah.
 *
 * Tidak pernah melempar. Kegagalan dipulangkan sebagai nilai, karena pemanggilnya
 * (rute checkout) punya jawaban yang lebih baik daripada 500: 502 dengan pesan,
 * dan pembeli boleh mencoba lagi dengan `ulang: true`.
 */
export async function terbitkanTokenSnap(
  p: PermintaanSnap,
): Promise<{ ok: true; token: string } | { ok: false; pesan: string }> {
  if (serverKeyMidtrans() === "") {
    return { ok: false, pesan: "Pembayaran belum aktif. Hubungi tim PADMA." };
  }

  let jawab: Response;
  try {
    jawab = await fetch(`${basisSnap()}/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: otorisasi(),
      },
      body: JSON.stringify({
        transaction_details: { order_id: p.orderId, gross_amount: p.nominal },
        item_details: [
          { id: p.orderId, price: p.nominal, quantity: 1, name: potong(p.judul, 50) },
        ],
        expiry: { unit: "hour", duration: p.kedaluwarsaJam },
      }),
      signal: AbortSignal.timeout(BATAS_MS),
    });
  } catch {
    // Jaringan mati, DNS gagal, batas waktu lewat. Tidak dicatat isinya —
    // yang berguna bagi pembeli hanyalah "coba lagi".
    console.error("[midtrans] Snap tidak bisa dihubungi.");
    return { ok: false, pesan: "Layanan pembayaran tidak bisa dihubungi." };
  }

  const isi = (await jawab.json().catch(() => null)) as
    | { token?: string; error_messages?: string[] }
    | null;

  if (!jawab.ok || !isi?.token) {
    // Pesan galat Midtrans dicatat ke LOG SERVER (berguna: ia menyebut field
    // mana yang ditolak) tetapi tidak pernah dipulangkan ke pembeli.
    console.error(
      `[midtrans] Snap menolak ${jawab.status}:`,
      (isi?.error_messages ?? []).join("; "),
    );
    return { ok: false, pesan: "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi." };
  }

  return { ok: true, token: isi.token };
}

export type StatusMidtrans = {
  order_id: string;
  status_code: string;
  transaction_status: string;
  transaction_id: string;
  gross_amount: string;
  fraud_status: string | null;
  payment_type: string | null;
};

/**
 * Status API — dipakai Lapis 1b (pemeriksaan saat halaman dibuka), tombol
 * "Periksa ulang" staf, dan penyapu terjadwal.
 *
 * `kode` pada kegagalan punya arti yang MENGIKAT bagi pemanggil:
 *   404 = Midtrans menyatakan transaksinya TIDAK PERNAH ADA. Hanya pemanggil
 *         yang boleh menyimpulkan "kedaluwarsa" darinya, dan HANYA bila
 *         `kedaluwarsa_pada + JAM_TENGGANG_404` sudah lewat — satu jam itu
 *         margin terhadap jam Midtrans, bukan perpanjangan tenggat.
 *   0   = tidak bisa dihubungi sama sekali (jaringan/batas waktu), ATAU jawaban
 *         yang `gross_amount`-nya hilang / bukan angka. Bukan vonis apa pun
 *         tentang transaksinya; jangan pernah diterjemahkan jadi status.
 *  -1   = `MIDTRANS_SERVER_KEY` belum terpasang. Nol permintaan keluar.
 * Nilai lain = jawaban HTTP Midtrans apa adanya.
 *
 * ===== KENAPA -1 PUNYA KODE SENDIRI, BUKAN IKUT 0 =====
 * Keduanya berarti "tidak ada jawaban", tapi keduanya menuntut KALIMAT yang
 * berbeda kepada manusia yang menekan tombolnya: jaringan yang mati sembuh
 * dengan dicoba lagi, kunci server yang belum dipasang TIDAK PERNAH. Dilebur,
 * layar staf berkata "Midtrans tidak menjawab. Coba lagi beberapa saat lagi."
 * untuk keadaan yang tidak akan berubah sampai seseorang memasang env — dan
 * staf mencoba lagi selamanya. Kedua permukaan T8 yang lain sudah memisahkannya
 * (rute webhook menjawab 503 `kunci_kosong`, `terbitkanTokenSnap` di atas
 * memulangkan "Pembayaran belum aktif. Hubungi tim PADMA."); hanya jalur Status
 * API yang sempat meleburnya. Pemetaannya di T10: `kode === -1` →
 * `"kunci_belum_terpasang"`, dan `Record<HasilPeriksaPesanan, string>` di T11
 * memaksa kalimatnya ditulis.
 */
export async function bacaStatusTransaksi(
  orderId: string,
): Promise<{ ok: true; status: StatusMidtrans } | { ok: false; kode: number; pesan: string }> {
  if (serverKeyMidtrans() === "") {
    return { ok: false, kode: -1, pesan: "Kunci Midtrans belum dipasang." };
  }

  let jawab: Response;
  try {
    jawab = await fetch(`${basisApiMidtrans()}/${encodeURIComponent(orderId)}/status`, {
      method: "GET",
      headers: { accept: "application/json", authorization: otorisasi() },
      signal: AbortSignal.timeout(BATAS_MS),
    });
  } catch {
    return { ok: false, kode: 0, pesan: "Layanan pembayaran tidak bisa dihubungi." };
  }

  const isi = (await jawab.json().catch(() => null)) as Record<string, unknown> | null;

  if (jawab.status === 404) {
    return { ok: false, kode: 404, pesan: "Transaksi tidak ada di Midtrans." };
  }
  if (!jawab.ok || isi === null) {
    return { ok: false, kode: jawab.status, pesan: "Midtrans menjawab tidak seperti biasanya." };
  }

  const teks = (kunci: string): string => (isi[kunci] == null ? "" : String(isi[kunci]));
  const teksAtauNull = (kunci: string): string | null =>
    isi[kunci] == null ? null : String(isi[kunci]);

  const gross = teks("gross_amount");
  if (!/^\d+(\.\d+)?$/.test(gross)) {
    // TIDAK dipalsukan menjadi "0". "Tidak tahu berapa" bukan "nol rupiah" —
    // alasan yang sama persis dengan yang sudah ditulis untuk kolom
    // `notifikasi_pesanan.nominal_diterima` yang nullable.
    //
    // Bentuk kegagalan kalau ia dipalsukan: jawaban Status API yang benar
    // `settlement` tapi tanpa medan `gross_amount` mengirim 0 ke mesin,
    // verifikasi jumlah gagal, dan pesanan yang SUDAH DIBAYAR PENUH digeser ke
    // `ditahan` ber-`nominal_diterima = 0`. Itu bukan kegagalan yang hilang —
    // ia muncul di "Butuh perhatian" — tapi ia menuntut putusan manusia untuk
    // pembayaran yang sempurna, dan `putuskan_pesanan_ditahan` MELOLOSKANNYA
    // karena `0` bukan `null`.
    //
    // `kode: 0` = "tidak tahu apa-apa", dan pemanggil dilarang
    // menerjemahkannya jadi status apa pun. Pesanan tidak bergerak, dan
    // pemeriksaan berikutnya mencoba lagi.
    return { ok: false, kode: 0, pesan: "Jawaban Midtrans tanpa gross_amount yang bisa dibaca." };
  }

  return {
    ok: true,
    status: {
      order_id: teks("order_id") || orderId,
      status_code: teks("status_code"),
      transaction_status: teks("transaction_status"),
      transaction_id: teks("transaction_id"),
      // Dijamin berbentuk angka oleh penjaga di atas, dan diteruskan APA
      // ADANYA sebagai string ke RPC — bentuk yang sama dengan jalur webhook.
      gross_amount: gross,
      fraud_status: teksAtauNull("fraud_status"),
      payment_type: teksAtauNull("payment_type"),
    },
  };
}
```

---

- [ ] **Step 5: Tulis `tests/pesanan-webhook.test.ts`** (uji DULU, implementasi rute sesudahnya)

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-webhook.test.ts`:

```ts
/**
 * WEBHOOK MIDTRANS — satu kasus per baris peta kode jawaban, plus empat urutan
 * notifikasi yang benar-benar terjadi di lapangan.
 *
 * Ini pintu masuk uang. Ia dipanggil SUNGGUHAN di sini, melawan basis data
 * lokal sungguhan, dengan pesanan yang dilahirkan lewat RPC `buat_pesanan`
 * memakai sesi klien sungguhan — bukan baris yang disisipkan langsung. Pesanan
 * yang tidak pernah lewat pintu depannya tidak membuktikan pintu depannya benar.
 *
 * ===== KENAPA `createClient` LANGSUNG, BUKAN `createAdminSupabase()` =====
 * Satu kasus (galat basis data -> 500) menuntut `@/lib/supabase/admin` di-mock.
 * Kalau fixture memakai modul yang sama, fixture-nya ikut rusak saat mock itu
 * menyala. Klien layanan di bawah karena itu dibuat langsung.
 *
 * ===== PEMBERSIHAN WAJIB =====
 * `jejak_pesanan` dan `notifikasi_pesanan` SENGAJA tanpa foreign key (jejak yang
 * ikut lenyap bersama yang diaudit tidak berguna), jadi menghapus pesanan tidak
 * menyapunya. Berkas ini menyapunya sendiri lewat service role — kalau tidak,
 * `tests/pesanan-jejak-yatim.test.ts` merah, dan merahnya di berkas ORANG LAIN.
 * Urutan penghapusan mengikat: entitlement dulu (ia menunjuk `orders` dengan
 * `on delete restrict`), baru pesanan, baru jejak, baru produknya
 * (`order_items.product_id` menahan penghapusan produk tanpa cascade).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

// ===== Klien layanan, sengaja di luar modul yang di-mock (lihat dokblok) =====
const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ===== Mock modul admin: hanya untuk kasus "galat basis data -> 500" =====
const ref = vi.hoisted(() => ({ paksaGalat: false }));
vi.mock("@/lib/supabase/admin", async (impor) => {
  const asli = await impor<typeof import("@/lib/supabase/admin")>();
  return {
    createAdminSupabase: () => {
      const klien = asli.createAdminSupabase();
      if (!ref.paksaGalat) return klien;
      // Hanya `.rpc` yang dipakai rute ini; menggantinya cukup untuk
      // memaksa cabang galat tanpa merusak apa pun yang lain.
      return {
        rpc: async () => ({ data: null, error: { message: "galat-uji", code: "XX000" } }),
      } as unknown as ReturnType<typeof asli.createAdminSupabase>;
    },
  };
});

const { POST } = await import("@/app/api/pembayaran/midtrans/route");
const { hitungTandaTangan, hitungSidik } = await import("@/lib/midtrans/tanda-tangan");
const { KODE_JAWABAN } = await import("@/lib/midtrans/kode-jawaban");
const { rakitOrderId, POLA_ORDER_ID } = await import("@/lib/pesanan/order-id");

const KUNCI = "kunci-uji-webhook";
const KLIEN = "ananda@padma.test";

/**
 * Setiap permintaan KELUAR yang bukan Supabase lokal dicatat DAN dilempar.
 * Webhook tidak boleh menelepon Midtrans sama sekali — ia sudah memegang
 * notifikasi yang bertanda tangan; menanyakan ulang berarti percaya pada dua
 * sumber kebenaran untuk satu fakta.
 */
const asliFetch = globalThis.fetch;
const keluar: string[] = [];

beforeAll(() => {
  process.env.MIDTRANS_SERVER_KEY = KUNCI;
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url)) {
      keluar.push(url);
      throw new Error(`[uji] webhook menembak host luar: ${url}`);
    }
    return asliFetch(...args);
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.MIDTRANS_SERVER_KEY;
  await bersihkan();
});

// ===== Fixture =====
let productId = "";
let clientId = "";
const pesananDibuat: string[] = [];

async function semaiProduk(harga: number): Promise<string> {
  const { data } = await svc
    .from("digital_products")
    .insert({ judul: "PAD-UJI Webhook Midtrans", slug: "pad-uji-webhook-midtrans", jenis: "pdf", aktif: true })
    .select("id")
    .single<{ id: string }>();
  await svc.from("digital_product_files").insert({
    product_id: data!.id,
    objek: `${data!.id}/isi.pdf`,
    mime: "application/pdf",
    byte: 1024,
  });
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga });
  return data!.id;
}

/** Pesanan dilahirkan lewat PINTU DEPANNYA: RPC dengan sesi klien sungguhan. */
async function buatPesanan(): Promise<{ id: string; orderId: string; nominal: number }> {
  const klien = await signInAs(KLIEN);
  const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: productId });
  if (error) throw new Error(`buat_pesanan gagal: ${error.message}`);
  const baris = (data as Array<{ pesanan_id: string; kode: string; percobaan: number; nominal_tagih: number }>)[0];
  pesananDibuat.push(baris.pesanan_id);
  return {
    id: baris.pesanan_id,
    orderId: rakitOrderId(baris.kode, baris.percobaan),
    nominal: baris.nominal_tagih,
  };
}

async function bersihkanPesanan(): Promise<void> {
  // 1. Entitlement dulu: ia menunjuk `orders` dengan `on delete restrict`.
  await svc.from("digital_entitlements").delete().eq("product_id", productId);
  // 2. Pesanan (cascade ke `order_items`).
  if (pesananDibuat.length) {
    await svc.from("orders").delete().in("id", pesananDibuat);
    // 3. Jejak & notifikasi: TANPA foreign key, jadi tidak ada cascade.
    await svc.from("jejak_pesanan").delete().in("pesanan_id", pesananDibuat);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", pesananDibuat);
    pesananDibuat.length = 0;
  }
}

async function bersihkan(): Promise<void> {
  await bersihkanPesanan();
  if (productId) await svc.from("digital_products").delete().eq("id", productId);
}

beforeAll(async () => {
  await svc.from("digital_products").delete().eq("slug", "pad-uji-webhook-midtrans");
  productId = await semaiProduk(150_000);
  const { data } = await svc
    .from("clients")
    .select("id")
    .eq("email", KLIEN)
    .maybeSingle<{ id: string }>();
  clientId = data?.id ?? "";
});

beforeEach(async () => {
  ref.paksaGalat = false;
  await bersihkanPesanan();
});

// ===== Perakit notifikasi =====
type Notifikasi = {
  order_id: string;
  status_code?: string;
  gross_amount?: string;
  transaction_status?: string;
  transaction_id?: string;
  fraud_status?: string;
  payment_type?: string;
  signature_key?: string;
};

function rakit(n: Notifikasi): Record<string, string> {
  const badan: Record<string, string> = {
    order_id: n.order_id,
    status_code: n.status_code ?? "200",
    gross_amount: n.gross_amount ?? "150000.00",
    transaction_status: n.transaction_status ?? "settlement",
    transaction_id: n.transaction_id ?? "trx-uji-1",
    payment_type: n.payment_type ?? "bank_transfer",
  };
  if (n.fraud_status !== undefined) badan.fraud_status = n.fraud_status;
  badan.signature_key =
    n.signature_key ??
    hitungTandaTangan(badan.order_id, badan.status_code, badan.gross_amount, KUNCI);
  return badan;
}

function permintaan(badan: unknown): Request {
  return new Request("http://127.0.0.1/api/pembayaran/midtrans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof badan === "string" ? badan : JSON.stringify(badan),
  });
}

async function kirim(badan: unknown): Promise<{ status: number; hasil: string }> {
  const jawab = await POST(permintaan(badan));
  const isi = (await jawab.json().catch(() => ({}))) as { hasil?: string };
  return { status: jawab.status, hasil: isi.hasil ?? "" };
}

// ===========================================================================

describe("cetakan tanda tangan & sidik — nilai emas, bukan tautologi", () => {
  it("tanda tangan = sha512(order_id + status_code + gross_amount + serverKey)", () => {
    // Nilai di kanan dihitung sekali di luar berkas ini dan ditulis harfiah.
    // Membandingkannya dengan hasil `hitungTandaTangan` sendiri akan hijau
    // bahkan bila urutan perangkaiannya tertukar.
    expect(hitungTandaTangan("PSN-260926-ABCDEF.1", "200", "150000.00", "kunci-uji")).toBe(
      "22f6793f7c0e45e56f8a20cff5569baa56aa8cb6160c8c05308d753b245ef75c" +
        "3bb8a3a8dbf06806449cd881444e47f8d9a07b2aca8f0249cbcbd96ad46d526f",
    );
  });

  it("sidik = sha256(orderId|statusCode|transactionStatus|fraudStatus|transactionId)", () => {
    expect(
      hitungSidik({
        orderId: "PSN-260926-ABCDEF.1",
        statusCode: "200",
        transactionStatus: "settlement",
        fraudStatus: "",
        transactionId: "abc-123",
      }),
    ).toBe("809196ac0055ce75a880c37a0927b8024f2ac1fcb484e6075b70d93da10651dd");
  });

  it("capture+challenge dan capture+accept atas transaksi yang SAMA punya sidik berbeda", () => {
    // Inilah SATU-SATUNYA alasan `fraud_status` ada di dalam sidik, dan sampai
    // kasus ini lahir alasan itu tidak dijaga apa pun. Kedua notifikasi datang
    // dengan `transaction_id` dan `status_code` yang sama; kalau sidiknya sama,
    // keputusan KEDUA Midtrans atas transaksi yang sama ditolak sebagai
    // duplikat — dan keputusan kedua itulah yang memindahkan uang dari
    // "ditahan Midtrans" ke "benar-benar masuk", atau sebaliknya.
    const dasar = {
      orderId: "PSN-260926-ABCDEF.1",
      statusCode: "200",
      transactionStatus: "capture",
      transactionId: "abc-123",
    };
    expect(hitungSidik({ ...dasar, fraudStatus: "challenge" })).not.toBe(
      hitungSidik({ ...dasar, fraudStatus: "accept" }),
    );
  });

  it("pending dan settlement atas transaksi yang sama punya sidik BERBEDA", () => {
    // Inilah alasan sidiknya bukan `order_id` saja. Kalau keduanya sama,
    // `settlement` ditolak sebagai duplikat dan pembelinya membayar untuk apa-apa.
    const dasar = { orderId: "PSN-260926-ABCDEF.1", fraudStatus: "", transactionId: "abc-123" };
    expect(hitungSidik({ ...dasar, statusCode: "201", transactionStatus: "pending" })).not.toBe(
      hitungSidik({ ...dasar, statusCode: "200", transactionStatus: "settlement" }),
    );
  });
});

describe("peta kode jawaban — satu kasus per baris", () => {
  it("badan > 16 KB dengan content-length jujur -> 400", async () => {
    const besar = JSON.stringify({ order_id: "x".repeat(17 * 1024) });
    const { status, hasil } = await kirim(besar);
    expect(status).toBe(400);
    expect(hasil).toBe("badan_terlalu_besar");
  });

  it("badan > 16 KB TANPA content-length (aliran) -> 400 — pagar BYTE, bukan pagar header", async () => {
    // Spec menegaskan satu hal tentang langkah ini: "pagar byte nyata —
    // content-length boleh bohong". Kasus di atas TIDAK membuktikannya: undici
    // menyetel content-length dengan jujur, jadi cabang PERTAMA
    // `bacaBodyTerbatas` sudah memulangkan null dan seluruh jalur pembacaan
    // aliran bertahap tidak pernah dieksekusi. Seseorang boleh menyederhanakan
    // fungsi itu jadi pemeriksaan header saja ("alirannya rumit dan tidak
    // pernah kepakai") dan uji di atas tetap hijau — lalu satu permintaan
    // `transfer-encoding: chunked` 50 MB dibaca habis ke memori sebelum satu
    // pemeriksaan pun berjalan.
    //
    // Ini satu-satunya bentuk yang membedakan pagar byte dari pagar header.
    const potongan = "x".repeat(4 * 1024);
    const aliran = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (let i = 0; i < 5; i += 1) controller.enqueue(enc.encode(potongan));
        controller.close();
      },
    });

    const permintaanAliran = new Request("http://127.0.0.1/api/pembayaran/midtrans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: aliran,
      // Wajib di undici untuk badan ber-aliran; tanpanya `fetch`/`Request`
      // menolak sebelum rutenya sempat dipanggil.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const jawab = await POST(permintaanAliran);
    const isi = (await jawab.json().catch(() => ({}))) as { hasil?: string };
    expect(jawab.status).toBe(400);
    expect(isi.hasil).toBe("badan_terlalu_besar");
  });

  it("MIDTRANS_SERVER_KEY kosong -> 503, bukan 401 dan bukan 200", async () => {
    // 2xx/4xx memberi tahu Midtrans "sudah selesai" dan notifikasi itu tidak
    // pernah datang lagi. 503 membuat env yang lupa dipasang berakhir sebagai
    // keterlambatan, bukan sebagai uang yang hilang.
    const p = await buatPesanan();
    const badan = rakit({ order_id: p.orderId });
    delete process.env.MIDTRANS_SERVER_KEY;
    try {
      const { status, hasil } = await kirim(badan);
      expect(status).toBe(503);
      expect(hasil).toBe("kunci_kosong");
    } finally {
      process.env.MIDTRANS_SERVER_KEY = KUNCI;
    }
  });

  it("JSON rusak -> 400", async () => {
    const { status, hasil } = await kirim("{bukan json");
    expect(status).toBe(400);
    expect(hasil).toBe("skema_gagal");
  });

  it("field wajib tidak lengkap -> 400", async () => {
    const { status, hasil } = await kirim({ order_id: "PSN-260926-ABCDEF.1" });
    expect(status).toBe(400);
    expect(hasil).toBe("skema_gagal");
  });

  it("field TAMBAHAN dari Midtrans TIDAK menolak notifikasi", async () => {
    // Skema sengaja tidak `.strict()`. 400 di sini akan mengunci pesanan mati
    // dengan uang yang sudah masuk, hanya karena Midtrans menambah satu field.
    const p = await buatPesanan();
    const badan = { ...rakit({ order_id: p.orderId }), settlement_time: "2026-09-26 10:00:00", currency: "IDR" };
    const { status } = await kirim(badan);
    expect(status).toBe(200);
  });

  it("bentuk order_id tidak cocok -> 400, dan NOL sentuhan basis data", async () => {
    const sebelum = await jumlahDitolakHariIni();
    const { status, hasil } = await kirim(rakit({ order_id: "bukan-order-id" }));
    expect(status).toBe(400);
    expect(hasil).toBe("bentuk_order_id");
    // Penghitung notifikasi ditolak TIDAK naik: bentuk yang salah disaring
    // sebelum satu sha512 pun dihitung, dan sebelum satu baris pun ditulis.
    expect(await jumlahDitolakHariIni()).toBe(sebelum);
  });

  it("tanda tangan salah -> 401, dan penghitung harian NAIK satu", async () => {
    const p = await buatPesanan();
    const sebelum = await jumlahDitolakHariIni();
    const { status, hasil } = await kirim(
      rakit({ order_id: p.orderId, signature_key: "a".repeat(128) }),
    );
    expect(status).toBe(401);
    expect(hasil).toBe("tanda_tangan_salah");
    expect(await jumlahDitolakHariIni()).toBe(sebelum + 1);

    // Nol teks penyerang tersimpan: yang bertambah hanya angkanya.
    const { data } = await svc.from("notifikasi_pesanan").select("id").eq("pesanan_id", p.id);
    expect(data ?? []).toEqual([]);
  });

  it("tanda tangan salah berpanjang BERBEDA -> 401, bukan 500", async () => {
    // `timingSafeEqual` MELEMPAR pada panjang berbeda. Tanpa penyamaan panjang
    // lebih dulu, notifikasi ini menjatuhkan rute ke 500 dan mengundang
    // Midtrans mengirim ulang selamanya.
    const p = await buatPesanan();
    const { status } = await kirim(rakit({ order_id: p.orderId, signature_key: "pendek" }));
    expect(status).toBe(401);
  });

  it("order_id sah bentuknya tapi bukan milik pesanan mana pun -> 200, dan tak_dikenal NAIK satu", async () => {
    // 200 memang jawaban yang benar — tanda tangannya sah dan tidak ada apa pun
    // yang bisa disembuhkan dengan mengulang. Yang TIDAK boleh adalah 200 yang
    // tidak meninggalkan satu baris pun di mana pun: bukan `orders`, bukan
    // `jejak_pesanan`, bukan `notifikasi_pesanan` (RPC keluar sebelum insert
    // sidik), bukan penghitung tanda tangan salah. Tanda tangannya SAH,
    // artinya uang itu sungguhan milik kita, lalu kita membuangnya.
    //
    // Dua jalan masuk yang nyata dan sama-sama nol-galat: notifikasi untuk
    // `percobaan` lama yang kelak "dirapikan" jadi pencarian kode+percobaan,
    // dan pergeseran bentuk `kode` di penerbitnya. Assertion kedua di bawah
    // yang membuat keduanya punya alarm.
    const sebelumTak = await jumlahTakDikenalHariIni();
    const sebelumDitolak = await jumlahDitolakHariIni();

    const { status, hasil } = await kirim(rakit({ order_id: "PSN-990101-FFFFFF.9" }));
    expect(status).toBe(200);
    expect(hasil).toBe("pesanan_tidak_ada");
    expect(await jumlahTakDikenalHariIni()).toBe(sebelumTak + 1);
    // Dan penghitung tanda tangan SALAH tidak ikut bergerak: dua angka, dua
    // arti, dan menyatukannya membuat yang kedua tidak pernah bisa dibaca.
    expect(await jumlahDitolakHariIni()).toBe(sebelumDitolak);
  });

  it("galat basis data -> 500", async () => {
    const p = await buatPesanan();
    const badan = rakit({ order_id: p.orderId });
    ref.paksaGalat = true;
    const { status, hasil } = await kirim(badan);
    expect(status).toBe(500);
    expect(hasil).toBe("galat");
  });

  it("KODE_JAWABAN memetakan KESEPULUH hasil, tanpa undefined", () => {
    // `NextResponse.json(..., { status: undefined })` menjawab 200. Satu hasil
    // yang lupa dipetakan berarti kegagalan dilaporkan "selesai" ke Midtrans.
    const nilai = Object.values(KODE_JAWABAN);
    expect(nilai).toHaveLength(10);
    expect(nilai.every((k) => Number.isInteger(k) && k >= 200 && k < 600)).toBe(true);
  });
});

describe("jalur sukses — uang masuk, akses terbit, satu transaksi", () => {
  it("settlement -> 200 diterapkan, pesanan LUNAS, entitlement terbit", async () => {
    const p = await buatPesanan();
    const { status, hasil } = await kirim(rakit({ order_id: p.orderId }));
    expect(status).toBe(200);
    expect(hasil).toBe("diterapkan");

    const { data: pesanan } = await svc
      .from("orders")
      .select("status, lunas_pada, ditutup_pada, kanal, transaksi_id")
      .eq("id", p.id)
      .single<{ status: string; lunas_pada: string | null; ditutup_pada: string | null; kanal: string | null; transaksi_id: string | null }>();
    expect(pesanan!.status).toBe("lunas");
    expect(pesanan!.lunas_pada).not.toBeNull();
    expect(pesanan!.ditutup_pada).not.toBeNull();
    expect(pesanan!.kanal).toBe("bank_transfer");
    expect(pesanan!.transaksi_id).toBe("trx-uji-1");

    // Kepemilikan adalah SATU-SATUNYA sumber kebenaran akses — bukan status
    // pesanan. Kalau entitlement tidak terbit, pembeli membayar dan tidak
    // mendapat apa-apa meski pesanannya berkata "lunas".
    const { data: hak } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("product_id", productId)
      .eq("client_id", clientId)
      .single<{ sumber: string; pesanan_id: string | null }>();
    expect(hak!.sumber).toBe("beli");
    expect(hak!.pesanan_id).toBe(p.id);

    // Nominal yang benar-benar diterima Midtrans DISIMPAN, apa pun hasilnya.
    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("nominal_diterima")
      .eq("pesanan_id", p.id)
      .single<{ nominal_diterima: string | number | null }>();
    expect(Number(notif!.nominal_diterima)).toBe(150_000);

    // Janji tunggal ke proyek WhatsApp: jejak `lunas` lahir TEPAT SEKALI.
    expect(await jumlahJejak(p.id, "lunas")).toBe(1);
  });

  it("nominal MELESET -> ditahan + selisih_nominal + penanda tinjauan, bukan lunas", async () => {
    const p = await buatPesanan();
    const { status } = await kirim(rakit({ order_id: p.orderId, gross_amount: "100000.00" }));
    expect(status).toBe(200);

    const { data } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.id)
      .single<{ status: string; butuh_tinjauan_pada: string | null; sebab_tinjauan: string | null }>();
    expect(data!.status).toBe("ditahan");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
    expect(data!.sebab_tinjauan).toBe("selisih_nominal");
    expect(await jumlahJejak(p.id, "selisih_nominal")).toBe(1);

    // Akses TIDAK terbit: uang masuk tapi jumlahnya tidak cocok.
    const { data: hak } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", productId)
      .eq("client_id", clientId);
    expect(hak ?? []).toEqual([]);
  });
});

describe("urutan notifikasi — empat yang benar-benar terjadi", () => {
  it("notifikasi KEMBAR PERSIS: yang kedua 200 duplikat, tanpa efek kedua", async () => {
    const p = await buatPesanan();
    const badan = rakit({ order_id: p.orderId });

    expect((await kirim(badan)).hasil).toBe("diterapkan");
    const kedua = await kirim(badan);
    expect(kedua.status).toBe(200);
    expect(kedua.hasil).toBe("duplikat");

    // Satu baris notifikasi, satu jejak lunas, satu entitlement.
    const { data: notif } = await svc.from("notifikasi_pesanan").select("id").eq("pesanan_id", p.id);
    expect((notif ?? []).length).toBe(1);
    expect(await jumlahJejak(p.id, "lunas")).toBe(1);
  });

  it("pending lalu settlement: sidik BERBEDA, keduanya diproses", async () => {
    const p = await buatPesanan();
    const pending = await kirim(
      rakit({ order_id: p.orderId, status_code: "201", transaction_status: "pending", transaction_id: "trx-uji-1" }),
    );
    expect(pending.status).toBe(200);

    const settle = await kirim(rakit({ order_id: p.orderId, transaction_id: "trx-uji-1" }));
    expect(settle.hasil).toBe("diterapkan");

    const { data } = await svc.from("orders").select("status").eq("id", p.id).single<{ status: string }>();
    expect(data!.status).toBe("lunas");

    const { data: notif } = await svc.from("notifikasi_pesanan").select("id").eq("pesanan_id", p.id);
    expect((notif ?? []).length).toBe(2);
  });

  it("URUTAN TERBALIK: settlement lalu pending — status tidak mundur", async () => {
    // Midtrans tidak menjamin urutan kedatangan. `pending` yang mendarat
    // sesudah `settlement` tidak boleh mengembalikan pesanan ke menunggu_bayar:
    // setiap UPDATE membawa `status = any(<array positif>)` di klausa where-nya,
    // jadi cabang yang tidak mengenai baris tidak mengubah apa pun.
    const p = await buatPesanan();
    expect((await kirim(rakit({ order_id: p.orderId }))).hasil).toBe("diterapkan");

    const pending = await kirim(
      rakit({ order_id: p.orderId, status_code: "201", transaction_status: "pending" }),
    );
    expect(pending.status).toBe(200);
    expect(pending.hasil).toBe("tanpa_efek");

    const { data } = await svc.from("orders").select("status").eq("id", p.id).single<{ status: string }>();
    expect(data!.status).toBe("lunas");
    expect(await jumlahJejak(p.id, "lunas")).toBe(1);
  });

  it("settlement pada pesanan yang SUDAH TERTUTUP -> lunas_setelah_tutup + tinjauan", async () => {
    // Uang mendarat pada pesanan yang sudah kita batalkan. Tidak ada transisi,
    // penyalur tidak berjalan, akses tidak terbit — dan statusnya bukan
    // `ditahan` maupun `lunas`, jadi tanpa penanda tinjauan ia tidak muncul di
    // blok mana pun meski uangnya sudah masuk.
    const p = await buatPesanan();
    const klien = await signInAs(KLIEN);
    await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: p.id });

    const { status } = await kirim(rakit({ order_id: p.orderId }));
    expect(status).toBe(200);

    const { data } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.id)
      .single<{ status: string; butuh_tinjauan_pada: string | null; sebab_tinjauan: string | null }>();
    expect(data!.status).toBe("dibatalkan");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
    expect(data!.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(await jumlahJejak(p.id, "lunas_setelah_tutup")).toBe(1);
  });

  it("dua order_id sah berturut-turut sama-sama lolos saringan bentuk", async () => {
    // Pagar terhadap `POLA_ORDER_ID` yang lahir ber-flag `g`: `RegExp.test()`
    // pada regex ber-`g` menyimpan `lastIndex` dan memulangkan false
    // bergantian, sehingga notifikasi kedua ditolak 400 tanpa sebab yang
    // terlihat. Diuji di dua lapis: cetakannya sendiri, dan lewat rutenya.
    expect(POLA_ORDER_ID.test("PSN-260926-ABCDEF.1")).toBe(true);
    expect(POLA_ORDER_ID.test("PSN-260926-ABCDEF.1")).toBe(true);

    const a = await buatPesanan();
    expect((await kirim(rakit({ order_id: a.orderId }))).status).toBe(200);
    await bersihkanPesanan();
    const b = await buatPesanan();
    expect((await kirim(rakit({ order_id: b.orderId }))).hasil).toBe("diterapkan");
  });
});

describe("webhook tidak menelepon siapa pun", () => {
  it("nol permintaan keluar ke host mana pun selain Supabase lokal", () => {
    // Berjalan paling akhir di berkas ini (vitest menjalankan `it` berurutan),
    // jadi ia melihat SELURUH permintaan yang dilakukan kasus-kasus di atas.
    expect(keluar).toEqual([]);
  });
});

// ===== Pembantu baca =====
async function jumlahJejak(pesananId: string, kejadian: string): Promise<number> {
  const { data } = await svc
    .from("jejak_pesanan")
    .select("id")
    .eq("pesanan_id", pesananId)
    .eq("kejadian", kejadian);
  return (data ?? []).length;
}

async function jumlahDitolakHariIni(): Promise<number> {
  const hariIni = new Date().toISOString().slice(0, 10);
  const { data } = await svc
    .from("notifikasi_ditolak_harian")
    .select("jumlah")
    .eq("tanggal", hariIni)
    .maybeSingle<{ jumlah: number }>();
  return data?.jumlah ?? 0;
}

async function jumlahTakDikenalHariIni(): Promise<number> {
  const hariIni = new Date().toISOString().slice(0, 10);
  const { data } = await svc
    .from("notifikasi_ditolak_harian")
    .select("tak_dikenal")
    .eq("tanggal", hariIni)
    .maybeSingle<{ tak_dikenal: number }>();
  return data?.tak_dikenal ?? 0;
}
```

---

- [ ] **Step 6: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-webhook.test.ts
```

Kegagalan yang DIHARAPKAN: berkas gagal dimuat seluruhnya —
`Cannot find module '@/app/api/pembayaran/midtrans/route'`. Rutenya belum ada.

---

- [ ] **Step 7: Tulis rute webhook**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/app/api/pembayaran/midtrans/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { serverKeyMidtrans } from "@/lib/midtrans/konfig";
import { hitungSidik, hitungTandaTangan, tandaTanganCocok } from "@/lib/midtrans/tanda-tangan";
import { SkemaNotifikasiMidtrans } from "@/lib/midtrans/skema";
import { KODE_JAWABAN, hasilRpcSah, type HasilWebhook } from "@/lib/midtrans/kode-jawaban";
import { POLA_ORDER_ID } from "@/lib/pesanan/order-id";

/**
 * WEBHOOK MIDTRANS — pintu masuk uang.
 *
 * Hidup di `src/app/api/**`, BUKAN `src/app/admin/**`, jadi larangan service
 * role (`tests/admin-shell.test.ts:605`) tidak tersentuh. Ia memang menulis
 * dengan service role: pemanggilnya Midtrans, tidak ada sesi dan tidak ada peran.
 *
 * POST saja. Tidak ada ekspor GET — penjadwalnya GitHub Actions dengan `curl`,
 * dan kita yang memilih verbanya.
 *
 * URUTANNYA MENGIKAT, dari yang paling murah dan paling membatasi:
 *   1. badan dibatasi 16 KB dengan pagar byte NYATA (`content-length` boleh bohong)
 *   2. MIDTRANS_SERVER_KEY kosong -> 503 (bukan 401, bukan 200)
 *   3. Zod, semua z.string(), TIDAK .strict()
 *   4. bentuk order_id disaring regex SEBELUM satu sha512 pun dihitung
 *   5. tanda tangan; tidak cocok -> penghitung harian naik, lalu 401
 *   6. sidik dihitung DI SINI (Node crypto) dan dikirim sebagai argumen RPC
 *   7-8. verifikasi jumlah, transisi, dan penyaluran — SEMUANYA di dalam RPC,
 *        satu transaksi. Insert sidik yang commit lebih dulu akan membuat retry
 *        Midtrans ditolak duplikat dan kegagalan sementara menjadi permanen.
 */
export const runtime = "nodejs";

/**
 * Notifikasi Midtrans terbesar jauh di bawah 2 KB. 16 KB sangat longgar dan
 * tetap menutup badan raksasa sebelum ia sampai ke `JSON.parse`.
 */
const MAKS_BYTE_BODY = 16 * 1024;

/**
 * Salinan lokal dari `src/app/api/skrining/route.ts:29-58` — fungsi di sana
 * sengaja tidak diekspor, dan rute skrining di luar cakupan tugas ini.
 * Pagarnya BYTE NYATA: `content-length` boleh bohong atau tidak ada, jadi
 * alirannya dibaca bertahap dan dibatalkan begitu melewati batas.
 */
async function bacaBodyTerbatas(request: Request, maks: number): Promise<string | null> {
  const dilaporkan = Number(request.headers.get("content-length"));
  if (Number.isFinite(dilaporkan) && dilaporkan > maks) return null;

  const aliran = request.body;
  if (!aliran) {
    const teks = await request.text();
    return new TextEncoder().encode(teks).byteLength > maks ? null : teks;
  }

  const pembaca = aliran.getReader();
  const pengurai = new TextDecoder("utf-8");
  let teks = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await pembaca.read();
      if (done) break;
      total += value.byteLength;
      if (total > maks) {
        await pembaca.cancel().catch(() => {});
        return null;
      }
      teks += pengurai.decode(value, { stream: true });
    }
  } finally {
    pembaca.releaseLock();
  }
  return teks + pengurai.decode();
}

/**
 * Badan jawaban menyebut HASILNYA, bukan hanya kodenya. Dua hasil bisa berbagi
 * satu kode HTTP (`duplikat`, `tanpa_efek`, `diterapkan`, dan
 * `pesanan_tidak_ada` semuanya 200), dan log Midtrans yang hanya mencatat "200"
 * tidak bisa membedakan "berhasil" dari "tidak ada yang bisa dilakukan".
 */
function jawab(hasil: HasilWebhook): NextResponse {
  return NextResponse.json({ hasil }, { status: KODE_JAWABAN[hasil] });
}

export async function POST(request: Request) {
  // 1.
  const teks = await bacaBodyTerbatas(request, MAKS_BYTE_BODY);
  if (teks === null) return jawab("badan_terlalu_besar");

  // 2.
  const serverKey = serverKeyMidtrans();
  if (serverKey === "") {
    console.error("[midtrans] MIDTRANS_SERVER_KEY belum dipasang — notifikasi ditunda.");
    return jawab("kunci_kosong");
  }

  // 3.
  let mentah: unknown;
  try {
    mentah = JSON.parse(teks);
  } catch {
    return jawab("skema_gagal");
  }
  const urai = SkemaNotifikasiMidtrans.safeParse(mentah);
  if (!urai.success) return jawab("skema_gagal");
  const n = urai.data;

  // 4. Nol sentuhan basis data, nol sha512, untuk bentuk yang tidak mungkin milik kita.
  if (!POLA_ORDER_ID.test(n.order_id)) return jawab("bentuk_order_id");

  // 5.
  const dihitung = hitungTandaTangan(n.order_id, n.status_code, n.gross_amount, serverKey);
  if (!tandaTanganCocok(n.signature_key, dihitung)) {
    // Satu angka per hari, NOL teks penyerang. Kegagalan mencatat tidak boleh
    // mengubah jawabannya: yang penting 401-nya sampai.
    try {
      await createAdminSupabase().rpc("catat_notifikasi_ditolak");
    } catch {
      console.error("[midtrans] gagal mencatat notifikasi ditolak.");
    }
    return jawab("tanda_tangan_salah");
  }

  // 6. Sesudah tanda tangan lolos, tidak sebelumnya.
  const sidik = hitungSidik({
    orderId: n.order_id,
    statusCode: n.status_code,
    transactionStatus: n.transaction_status,
    fraudStatus: n.fraud_status ?? "",
    transactionId: n.transaction_id,
  });

  // 7-8. Satu panggilan, satu transaksi. (9) ada di bawah, sesudah hasilnya
  // diketahui.
  //
  // `p_gross_amount` dikirim sebagai STRING persis seperti yang ditandatangani.
  // Mengubahnya menjadi angka di TypeScript berarti pembulatan JavaScript ikut
  // menentukan verifikasi jumlah; yang meng-cast-nya adalah basis data, satu
  // kali, ke tipe kolom yang memang sudah memutuskan presisinya.
  const { data, error } = await createAdminSupabase().rpc("terapkan_notifikasi_midtrans", {
    p_order_id: n.order_id,
    p_transaction_status: n.transaction_status,
    p_fraud_status: n.fraud_status ?? "",
    p_transaction_id: n.transaction_id,
    p_payment_type: n.payment_type ?? "",
    p_gross_amount: n.gross_amount,
    p_sidik: sidik,
    p_sumber: "webhook",
  });

  if (error) {
    // SATU-SATUNYA kelas yang retry benar-benar menyembuhkan.
    console.error(`[midtrans] RPC gagal untuk ${n.order_id}: ${error.message}`);
    return jawab("galat");
  }

  const hasil = typeof data === "string" ? data : "";
  if (!hasilRpcSah(hasil)) {
    console.error(`[midtrans] RPC memulangkan nilai tak dikenal: ${JSON.stringify(data)}`);
    return jawab("galat");
  }

  // 9. `pesanan_tidak_ada` adalah SATU-SATUNYA keluaran yang menjawab "sudah
  // selesai" kepada Midtrans tanpa menulis apa pun ke basis data: bukan baris
  // `orders`, bukan `jejak_pesanan`, bukan `notifikasi_pesanan` (RPC keluar
  // sebelum insert sidik), dan bukan penghitung tanda tangan salah. Padahal
  // tanda tangannya SAH — artinya uang itu sungguhan milik kita — lalu kita
  // membuang notifikasinya dan menyuruh Midtrans berhenti mengirim.
  //
  // Notifikasi bertanda tangan sah yang kita buang tidak boleh lebih sunyi
  // daripada notifikasi bertanda tangan palsu. Satu angka per hari, nol teks
  // disimpan — dan angka itu yang kelak menyalakan alarm saat seseorang
  // "merapikan" pencarian pesanan menjadi kode+percobaan, atau menurunkan
  // `upper(...)` di penerbit kode.
  if (hasil === "pesanan_tidak_ada") {
    console.error(`[midtrans] order_id bertanda tangan sah tapi tak dikenal: ${n.order_id}`);
    try {
      await createAdminSupabase().rpc("catat_notifikasi_tak_dikenal");
    } catch {
      // Kegagalan mencatat tidak boleh mengubah jawabannya.
      console.error("[midtrans] gagal mencatat notifikasi tak dikenal.");
    }
  }

  return jawab(hasil);
}
```

---

- [ ] **Step 8: Jalankan uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-webhook.test.ts
```

Seluruh kasus hijau. Bila `dua order_id sah berturut-turut sama-sama lolos saringan
bentuk` merah pada assertion pertamanya, `POLA_ORDER_ID` di
`src/lib/pesanan/order-id.ts` (Task 4) lahir dengan flag `g` — **buang flag itu di
sana**, jangan mengakali di rute.

---

- [ ] **Step 9: Daftarkan rutenya di README**

`tests/inventaris-rute.test.ts` memeriksa DUA ARAH: berkas rute tanpa baris README dan
baris README tanpa berkas sama-sama merah. Sisipkan **satu baris** tepat sesudah baris
`` `/api/cron/tenggat` `` di `/Users/arvinfairuz/Documents/padma/web/README.md`
(baris 158 pada `main` hari ini):

```
| `/api/pembayaran/midtrans` | Mesin | POST notifikasi Midtrans. Berlapis: batas 16 KB body → kunci server terpasang (kosong = 503, supaya Midtrans mengirim ulang) → skema Zod non-strict → bentuk `order_id` → tanda tangan sha512 waktu-tetap → idempotensi lewat `unique (sidik)`. Verifikasi jumlah, transisi status, dan penerbitan akses terjadi di SATU transaksi di dalam RPC |
```

Lalu:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/inventaris-rute.test.ts
```

---

- [ ] **Step 10: Jalankan pagar yang bersinggungan**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-webhook.test.ts tests/midtrans-konfig.test.ts tests/inventaris-rute.test.ts tests/env-terdokumentasi.test.ts tests/jejak-yatim.test.ts tests/pesanan-jejak-yatim.test.ts tests/fungsi-mesin-tertutup.test.ts
```

Ketujuhnya hijau. `env-terdokumentasi` ikut karena rute ini adalah pembaca pertama
`MIDTRANS_SERVER_KEY`; `pesanan-jejak-yatim` ikut karena berkas uji baru ini membuat
lalu menghapus pesanan.

---

- [ ] **Step 11: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add web/src/lib/midtrans web/src/app/api/pembayaran web/tests/pesanan-webhook.test.ts web/tests/midtrans-konfig.test.ts web/README.md && git commit -F - <<'PESAN'
feat(pesanan): webhook Midtrans — pintu masuk uang, sepuluh langkah urut

Rute POST /api/pembayaran/midtrans plus lima modul adapter. Urutannya
mengikat dan tiap langkah punya alasannya sendiri.

Kunci server kosong menjawab 503, BUKAN 401 dan bukan 200: 2xx/4xx
memberi tahu Midtrans "sudah selesai" dan notifikasi itu tidak pernah
datang lagi, jadi env yang lupa dipasang berakhir sebagai uang yang
hilang alih-alih keterlambatan.

Skema Zod sengaja TIDAK .strict() — satu field baru dari Midtrans akan
mengunci pesanan mati lewat 400. Semua z.string(), bukan z.coerce:
yang ditandatangani adalah string persis seperti dikirim.

Sidik idempotensi = sha256(order_id|status_code|transaction_status|
fraud_status|transaction_id), bukan order_id saja. Dengan sidik
se-pesanan, notifikasi `pending` mengunci barisnya dan `settlement`
ditolak duplikat — pembeli membayar dan pesanannya tinggal menunggu
selamanya. Sidiknya lahir di dalam transaksi yang sama dengan transisi;
rollback melepasnya supaya retry masih bisa menyembuhkan.

Pagar 16 KB diuji DUA kali: sekali dengan content-length jujur, sekali
dengan badan ber-aliran TANPA content-length. Hanya yang kedua yang
membedakan pagar byte dari pagar header, dan "content-length boleh
bohong" persis yang spec tuntut.

pesanan_tidak_ada tidak lagi senyap: ia menaikkan penghitung harian
kedua sebelum menjawab 200. Tanda tangannya SAH, artinya uang itu
sungguhan milik kita, lalu kita membuang notifikasinya — dan notifikasi
sah yang kita buang tidak boleh lebih sunyi daripada notifikasi palsu
yang kita tolak.

gross_amount dibatasi bentuknya di skema. Tanpa itu masukan cacat
berhenti di 500 dan Midtrans mengulanginya selamanya; dengan itu ia
berhenti di 400, badan yang memang tidak akan pernah berubah. Adapter
juga berhenti memalsukan gross_amount yang hilang menjadi "0": "tidak
tahu berapa" bukan "nol rupiah", dan yang dipalsukan menggeser pesanan
yang sudah dibayar penuh ke ditahan ber-nominal 0 — yang lalu tidak bisa
diputuskan siapa pun.

tests/midtrans-konfig.test.ts mengunci aturan MIDTRANS_PRODUKSI "hanya
nilai true": empat fungsi yang memutuskan ke mana uang sungguhan dikirim
sebelumnya nol uji, dan Boolean("false") adalah true.

Uji memanggil rutenya sungguhan atas pesanan yang lahir lewat pintu
depannya (RPC buat_pesanan dengan sesi klien): satu kasus per baris peta
kode jawaban, kembar persis, pending-lalu-settlement, urutan TERBALIK,
dan settlement pada pesanan yang sudah tertutup. setup-fetch-guard.ts
tidak disentuh — berkas ujinya menstub fetch sendiri dan meng-assert nol
permintaan keluar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
```

---

### Task 9: Checkout — rute, Snap, tombol

Akar repo `/Users/arvinfairuz/Documents/padma`; aplikasi di `web/`. Semua perintah di
bawah dijalankan dari `/Users/arvinfairuz/Documents/padma/web`.

Mendarat sesudah Task 8 (ia memakai `terbitkanTokenSnap` dan `urlSkripSnap`).

**BACA DULU sebagai pola yang ditiru** (path lengkap):
- `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/tombol-ambil.tsx` —
  **berkas kembarnya**. `PanelAmbil` (murni tampilan, diuji dengan render sungguhan)
  terpisah dari `TombolAmbil` (efek + panggilan). `punyaProdukDiPeramban()` sudah
  diekspor dan dipakai ulang di sini. Dokblok "Membaca kepemilikan DARI PERAMBAN"
  menjelaskan kenapa `/produk/[slug]` tidak boleh membaca cookie.
- `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/page.tsx` — cabang
  `HargaProduk` yang akan disunting; `export const revalidate = 300` di baris 9.
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-tombol-ambil.test.tsx` — cetakan
  uji render (`renderToStaticMarkup`, `vi.mock` untuk server action).
- `/Users/arvinfairuz/Documents/padma/web/src/app/api/bukti/route.ts` — rute POST
  bersesi: sesi dulu, kepemilikan dibaca DENGAN SESI (RLS yang memutuskan), baru menulis.
- `/Users/arvinfairuz/Documents/padma/web/src/app/api/produk/[id]/unduh/route.ts` baris
  37–44 — bentuk `{ params }: { params: Promise<{ id: string }> }` di Next 16.
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-rute-isi.test.ts` baris 26–37 —
  cetakan `vi.hoisted` + `vi.mock("@/lib/supabase/server")` untuk menyuntikkan sesi
  sungguhan ke rute.
- `/Users/arvinfairuz/Documents/padma/web/tests/pagar-batas-server-klien.test.ts` —
  **`page.tsx` adalah berkas SERVER**: dilarang mengirim arrow function sebagai prop JSX
  dari sana. Prop yang ditambahkan di tugas ini hanya `string` dan `boolean`.
- `/Users/arvinfairuz/Documents/padma/web/tests/jejak-yatim.test.ts` — alasan uji ini
  wajib menyapu `jejak_pesanan`/`notifikasi_pesanan` fixture-nya sendiri.

**Files:**
- Create: `web/src/app/api/pesanan/checkout/route.ts`
- Create: `web/src/app/api/pesanan/[id]/batal/route.ts`
- Create: `web/src/lib/midtrans/snap-peramban.ts`
- Create: `web/src/app/produk/[slug]/tombol-beli.tsx`
- Modify: `web/src/app/produk/[slug]/tombol-ambil.tsx` — dua suntingan, keduanya
  **berbasis nama, bukan nomor baris** (§0.12): `function BlokBuka` → `export function BlokBuka`,
  dan HAPUS komponen `TautanBuka` seutuhnya (dokblok sampai kurung tutup badannya), yang
  pekerjaannya diserap `TombolBeli`
- Modify: `web/src/app/produk/[slug]/page.tsx:5,17-58,62-97` (impor, dua prop baru pada
  `HargaProduk`, cabang berbayar merender `<TombolBeli>`)
- Modify: `web/README.md:158` (menyisipkan DUA baris tepat sesudah baris
  `` `/api/cron/tenggat` ``. Nomor itu benar pada `main` hari ini, tapi **Tugas 8 sudah
  menyisipkan satu baris duluan — cari baris `` `/api/cron/tenggat` ``, jangan percaya
  nomornya.**)
- Test: `web/tests/pesanan-checkout-rute.test.ts`, `web/tests/produk-tombol-beli.test.tsx`

**Interfaces:**
- Consumes (T1): `web/src/lib/pesanan/status.ts` → `export const JAM_TENGGAT_PESANAN = 24`
- Consumes (T4): `web/src/lib/pesanan/order-id.ts` →
  `export function rakitOrderId(kode: string, percobaan: number): string`,
  `export const POLA_KODE_PESANAN: RegExp`; dan RPC
  `public.buat_pesanan(p_product_id uuid, p_ulang boolean default false) returns table (pesanan_id uuid, kode text, percobaan smallint, nominal_tagih integer, judul text)`,
  `public.catat_token_snap(p_pesanan_id uuid, p_token text) returns void`,
  `public.batalkan_pesanan_saya(p_pesanan_id uuid) returns boolean`,
  `public.punya_pesanan_menunggu(p_product_id uuid) returns boolean`
- Consumes (T8): `terbitkanTokenSnap(p: PermintaanSnap): Promise<{ ok: true; token: string } | { ok: false; pesan: string }>`,
  `midtransProduksi(): boolean`, `urlSkripSnap(produksi: boolean): string`
- Consumes (repo): `createServerSupabase()` dari `@/lib/supabase/server`;
  `penggunaSaatIni()` dari `@/lib/auth/sesi`; `createBrowserSupabase()` dari
  `@/lib/supabase/client`; `punyaProdukDiPeramban(sb, productId)` dari
  `@/app/produk/[slug]/tombol-ambil`
- Produces (kontrak rute — dipakai T10 dan komponen):
  `POST /api/pesanan/checkout` body `{ productId: string, ulang?: boolean }` →
  `200 { token: string, kode: string, pesananId: string, produksi: boolean }` |
  `400 { pesan }` (badan tidak berbentuk) | `401` (tanpa sesi) |
  `409 { pesan }` (pesanan terbuka untuk produk lain) |
  `502 { pesan }` (Snap menolak; klien boleh mengulang dengan `ulang: true`);
  `POST /api/pesanan/[id]/batal` → `200 { dibatalkan: boolean }` | `401` | `409 { pesan }`
- Produces: `web/src/lib/midtrans/snap-peramban.ts` →
  `export async function muatSkripSnap(clientKey: string, produksi: boolean): Promise<void>`
- Produces: `web/src/app/produk/[slug]/tombol-beli.tsx` →
  `export type KeadaanBeli = "belum" | "punya" | "menunggu"`,
  `export async function keadaanBeli(punyaProduk: () => Promise<boolean>, punyaPesanan: () => Promise<boolean>): Promise<KeadaanBeli>`
  — keputusan URUTAN LAYAR, diekstrak jadi fungsi MURNI supaya bisa dijalankan sungguhan,
  `export function PanelBeli(...)`, `export function TombolBeli({ slug, productId, produksi, clientKey })`
  — **T10 menambahkan SATU efek** ke `TombolBeli` (memanggil server action
  `periksaPesananSaya()` lalu `router.refresh()`); jangan menutup berkas ini.
- Produces: `export function BlokBuka({ slug }: { slug: string })` di `tombol-ambil.tsx`

**Arsitektur yang tidak boleh ditafsir ulang:** rute **tipis**, memanggil RPC **dengan
sesi pemanggil**, **tidak pernah service role**. Bukan server action. RPC yang memilih
`client_id` dari `auth.uid()`. Nol halaman `/bayar/selesai` dan nol rute balik Snap yang
menerbitkan apa pun — `onSuccess` hanya memicu pembacaan ulang entitlement.

---

- [ ] **Step 1: Tulis `tests/pesanan-checkout-rute.test.ts`** (uji DULU)

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-checkout-rute.test.ts`:

```ts
/**
 * CHECKOUT — dua rute tipis, dipanggil SUNGGUHAN dengan sesi sungguhan.
 *
 * Yang dijaga di sini bukan "rutenya mengembalikan 200", melainkan empat hal
 * yang masing-masing pernah menjadi cara alur pembayaran gagal diam-diam:
 *
 *   1. `order_id` yang dikirim ke Snap = `kode.percobaan`. Midtrans menolak
 *      `order_id` kembar SELAMANYA; salah merakitnya berarti percobaan kedua
 *      mustahil dan pembeli terkunci sampai tenggatnya lewat.
 *   2. `expiry` Snap memakai konstanta yang SAMA dengan `kedaluwarsa_pada`.
 *      Dua angka yang berbeda = dua kegagalan simetris (lihat spec).
 *   3. Rute tidak pernah memakai service role. Yang memilih `client_id` adalah
 *      `auth.uid()` DI DALAM RPC — pemeriksaan yang hanya hidup di TypeScript
 *      bisa dilewati dengan satu panggilan langsung ke PostgREST.
 *   4. Pemegang sesi lain tidak bisa membatalkan pesanan orang.
 *
 * Adapter Midtrans DI-MOCK. `tests/setup-fetch-guard.ts` tidak disunting: suite
 * ini tidak punya izin — dan tidak butuh — menembak Snap sungguhan.
 *
 * Pembersihan `jejak_pesanan`/`notifikasi_pesanan` WAJIB (keduanya sengaja tanpa
 * foreign key). Tanpa itu `tests/pesanan-jejak-yatim.test.ts` merah, di berkas
 * orang lain.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";
// Klien KEDUA ber-akun auth, lahir di Tugas 4 (`tests/helpers/klien-kedua.ts`).
// Tanpa ia, "pemegang sesi lain tidak bisa membatalkan pesanan orang" hanya
// bisa ditulis dengan sesi admin — dan admin menabrak gerbang yang SAMA SEKALI
// BERBEDA (lihat kasusnya di bawah).
import {
  EMAIL_KLIEN_KEDUA,
  siapkanKlienKedua,
  bongkarKlienKedua,
} from "./helpers/klien-kedua";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type HasilSnap = { ok: true; token: string } | { ok: false; pesan: string };

const ref = vi.hoisted(() => ({
  sesi: null as SupabaseClient | null,
  snap: { ok: true, token: "snap-token-uji" } as { ok: true; token: string } | { ok: false; pesan: string },
  diterima: null as null | { orderId: string; nominal: number; judul: string; kedaluwarsaJam: number },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("@/lib/midtrans/adapter", () => ({
  terbitkanTokenSnap: async (p: { orderId: string; nominal: number; judul: string; kedaluwarsaJam: number }): Promise<HasilSnap> => {
    ref.diterima = p;
    return ref.snap;
  },
  bacaStatusTransaksi: async () => ({ ok: false, kode: 0, pesan: "tidak dipakai di berkas ini" }),
}));

const { POST: checkout } = await import("@/app/api/pesanan/checkout/route");
const { POST: batal } = await import("@/app/api/pesanan/[id]/batal/route");
const { POLA_KODE_PESANAN, rakitOrderId } = await import("@/lib/pesanan/order-id");
const { JAM_TENGGAT_PESANAN } = await import("@/lib/pesanan/status");

const KLIEN = "ananda@padma.test";
/** Akun BERPROFIL tapi TANPA baris `clients` — gerbang identitas, bukan kepemilikan. */
const TANPA_REKAM_KLIEN = "admin@padma.test";

let produkA = "";
let produkB = "";
let clientId = "";

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data } = await svc
    .from("digital_products")
    .insert({ judul: `PAD-UJI ${slug}`, slug, jenis: "pdf", aktif: true })
    .select("id")
    .single<{ id: string }>();
  await svc.from("digital_product_files").insert({
    product_id: data!.id, objek: `${data!.id}/isi.pdf`, mime: "application/pdf", byte: 1024,
  });
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga });
  return data!.id;
}

async function sapuPesanan(): Promise<void> {
  const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
  const id = (data ?? []).map((b) => (b as { id: string }).id);
  await svc.from("digital_entitlements").delete().in("product_id", [produkA, produkB]);
  if (id.length) {
    await svc.from("orders").delete().in("id", id);
    await svc.from("jejak_pesanan").delete().in("pesanan_id", id);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", id);
  }
}

beforeAll(async () => {
  for (const slug of ["pad-uji-checkout-a", "pad-uji-checkout-b"]) {
    await svc.from("digital_products").delete().eq("slug", slug);
  }
  produkA = await semaiProduk("pad-uji-checkout-a", 150_000);
  produkB = await semaiProduk("pad-uji-checkout-b", 75_000);
  await siapkanKlienKedua();
  const { data } = await svc.from("clients").select("id").eq("email", KLIEN).maybeSingle<{ id: string }>();
  clientId = data!.id;
});

afterAll(async () => {
  await sapuPesanan();
  await bongkarKlienKedua();
  await svc.from("digital_products").delete().in("id", [produkA, produkB]);
});

beforeEach(async () => {
  ref.snap = { ok: true, token: "snap-token-uji" };
  ref.diterima = null;
  ref.sesi = await signInAs(KLIEN);
  await sapuPesanan();
});

function mintaCheckout(badan: unknown): Request {
  return new Request("http://127.0.0.1/api/pesanan/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof badan === "string" ? badan : JSON.stringify(badan),
  });
}

function mintaBatal(): Request {
  return new Request("http://127.0.0.1/api/pesanan/x/batal", { method: "POST" });
}

describe("POST /api/pesanan/checkout", () => {
  it("tanpa sesi -> 401, dan NOL pesanan lahir", async () => {
    ref.sesi = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(401);

    const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
    expect(data ?? []).toEqual([]);
  });

  it("badan tanpa productId -> 400", async () => {
    expect((await checkout(mintaCheckout({}))).status).toBe(400);
    expect((await checkout(mintaCheckout("{bukan json"))).status).toBe(400);
  });

  it("produk berbayar -> 200 dengan token, kode, pesananId, produksi", async () => {
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(200);
    const isi = (await jawab.json()) as { token: string; kode: string; pesananId: string; produksi: boolean };

    expect(isi.token).toBe("snap-token-uji");
    expect(isi.kode).toMatch(POLA_KODE_PESANAN);
    expect(isi.produksi).toBe(false);

    const { data } = await svc
      .from("orders")
      .select("id, status, client_id, snap_token, jumlah_item")
      .eq("id", isi.pesananId)
      .single<{ id: string; status: string; client_id: string; snap_token: string | null; jumlah_item: number }>();
    expect(data!.status).toBe("menunggu_bayar");
    // `client_id` dipilih RPC dari auth.uid(), bukan dikirim rute.
    expect(data!.client_id).toBe(clientId);
    expect(data!.snap_token).toBe("snap-token-uji");
    expect(data!.jumlah_item).toBe(1);
  });

  it("order_id yang dikirim ke Snap = kode.percobaan, dan expiry = JAM_TENGGAT_PESANAN", async () => {
    // Dua invarian yang tidak punya bentuk lain untuk diperiksa: keduanya hidup
    // di ARGUMEN yang dioper ke Midtrans, bukan di baris basis data mana pun.
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    const isi = (await jawab.json()) as { kode: string };

    expect(ref.diterima).not.toBeNull();
    expect(ref.diterima!.orderId).toBe(rakitOrderId(isi.kode, 1));
    expect(ref.diterima!.kedaluwarsaJam).toBe(JAM_TENGGAT_PESANAN);
    expect(ref.diterima!.nominal).toBe(150_000);
  });

  it("Snap menolak -> 502 dengan pesan, dan pesanannya TETAP ada untuk diulang", async () => {
    ref.snap = { ok: false, pesan: "Pembayaran belum bisa dimulai." };
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(502);
    expect((await jawab.json()) as { pesan: string }).toHaveProperty("pesan");

    // Pesanannya tidak dihapus: `ulang: true` yang menaikkan percobaan dan
    // melahirkan order_id baru, karena order_id lama sudah terbakar di Midtrans.
    const { data } = await svc.from("orders").select("id, percobaan").eq("client_id", clientId);
    expect((data ?? []).length).toBe(1);
  });

  it("ulang: true menaikkan percobaan, dan order_id ikut berubah", async () => {
    ref.snap = { ok: false, pesan: "gagal" };
    await checkout(mintaCheckout({ productId: produkA }));

    ref.snap = { ok: true, token: "snap-token-uji-2" };
    const jawab = await checkout(mintaCheckout({ productId: produkA, ulang: true }));
    expect(jawab.status).toBe(200);
    const isi = (await jawab.json()) as { kode: string };
    expect(ref.diterima!.orderId).toBe(rakitOrderId(isi.kode, 2));
  });

  it("pesanan terbuka untuk produk LAIN -> 409 dengan kalimat yang bisa dibaca", async () => {
    expect((await checkout(mintaCheckout({ productId: produkA }))).status).toBe(200);

    const jawab = await checkout(mintaCheckout({ productId: produkB }));
    expect(jawab.status).toBe(409);
    const isi = (await jawab.json()) as { pesan: string };
    // Bukan "23505" telanjang. Yang membacanya adalah pembeli.
    expect(isi.pesan.length).toBeGreaterThan(10);
    expect(isi.pesan).not.toMatch(/23505|duplicate key|constraint/i);

    // Tepat SATU pesanan, tetap milik produk pertama.
    const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
    expect((data ?? []).length).toBe(1);
  });

  it("checkout ULANG produk yang SAMA memulangkan pesanan terbuka yang ada, bukan yang kedua", async () => {
    const a = (await (await checkout(mintaCheckout({ productId: produkA }))).json()) as { pesananId: string };
    const b = (await (await checkout(mintaCheckout({ productId: produkA }))).json()) as { pesananId: string };
    expect(b.pesananId).toBe(a.pesananId);

    const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
    expect((data ?? []).length).toBe(1);
  });
});

describe("POST /api/pesanan/[id]/batal", () => {
  async function buat(): Promise<string> {
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    return ((await jawab.json()) as { pesananId: string }).pesananId;
  }

  it("tanpa sesi -> 401", async () => {
    const id = await buat();
    ref.sesi = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(401);
  });

  it("pesanan sendiri yang menunggu_bayar -> 200 dibatalkan, dan checkout produk lain jadi bisa", async () => {
    // Pembatalan mandiri bukan hiasan: satu klien hanya boleh punya satu
    // pesanan terbuka, jadi tanpa tombol ini orang yang berubah pikiran soal
    // produk harus menunggu 24 jam.
    const id = await buat();
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(200);
    expect((await jawab.json()) as { dibatalkan: boolean }).toEqual({ dibatalkan: true });

    const { data } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", id)
      .single<{ status: string; ditutup_pada: string | null }>();
    expect(data!.status).toBe("dibatalkan");
    expect(data!.ditutup_pada).not.toBeNull();

    expect((await checkout(mintaCheckout({ productId: produkB }))).status).toBe(200);
  });

  it("KLIEN LAIN tidak bisa membatalkan pesanan orang: 200 { dibatalkan: false }, pesanan UTUH", async () => {
    // DUA SEBAB, DUA UJI — dan versi pertama rencana ini menggabungkannya jadi
    // satu yang justru akan GAGAL apa adanya. Dengan sesi admin,
    // `batalkan_pesanan_saya` menabrak gerbang PERTAMA-nya
    // (`v_client_id is null -> 42501`), rute memetakan kode non-P0001 ke 409,
    // sementara ujinya meng-assert 200 `{ dibatalkan: false }`. Akibat yang
    // lebih halus: jalur `dibatalkan: false` — SATU-SATUNYA jalur yang menguji
    // kepemilikan baris — tidak pernah dieksekusi sama sekali, dan klausa
    // `and o.client_id = v_client_id` boleh dihapus hari ini tanpa satu pun
    // uji merah.
    const id = await buat();
    ref.sesi = await signInAs(EMAIL_KLIEN_KEDUA);
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(200);
    expect((await jawab.json()) as { dibatalkan: boolean }).toEqual({ dibatalkan: false });

    // Yang penting bukan kodenya, melainkan ini: pesanannya UTUH.
    const { data } = await svc.from("orders").select("status").eq("id", id).single<{ status: string }>();
    expect(data!.status).toBe("menunggu_bayar");
  });

  it("akun TANPA rekam klien ditolak 409 — gerbang identitas, bukan kepemilikan", async () => {
    // Judulnya menyebut sebab yang SEBENARNYA diuji. Ia tetap dipertahankan
    // karena gerbang identitas memang harus berdiri; yang tidak boleh adalah
    // mengira ia membuktikan kepemilikan baris.
    const id = await buat();
    ref.sesi = await signInAs(TANPA_REKAM_KLIEN);
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(409);

    const { data } = await svc.from("orders").select("status").eq("id", id).single<{ status: string }>();
    expect(data!.status).toBe("menunggu_bayar");
  });

  it("id yang bukan UUID -> 409, tanpa menyentuh apa pun", async () => {
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id: "bukan-uuid" }) });
    expect(jawab.status).toBe(409);
  });
});
```

---

- [ ] **Step 2: Jalankan uji rute, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-checkout-rute.test.ts
```

Kegagalan yang DIHARAPKAN: berkas gagal dimuat —
`Cannot find module '@/app/api/pesanan/checkout/route'`.

---

- [ ] **Step 3: Tulis rute checkout**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/app/api/pesanan/checkout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { terbitkanTokenSnap } from "@/lib/midtrans/adapter";
import { midtransProduksi } from "@/lib/midtrans/konfig";
import { rakitOrderId } from "@/lib/pesanan/order-id";
import { JAM_TENGGAT_PESANAN } from "@/lib/pesanan/status";

/**
 * CHECKOUT — rute TIPIS. Satu kalimat arsitektur, supaya tiga penyebutan tidak
 * berarti tiga mekanisme:
 *
 *   Rute ini memanggil RPC `buat_pesanan` DENGAN SESI PEMANGGIL — bukan server
 *   action, dan TIDAK PERNAH service role. RPC-lah yang memilih `client_id` dari
 *   `auth.uid()`, membekukan harga, menerbitkan `kode`, dan menolak pesanan
 *   terbuka kedua lewat unique parsial.
 *
 * Yang ada di sini hanyalah tiga hal yang memang tidak bisa hidup di SQL:
 * merakit `order_id` Midtrans, memanggil Snap, dan menerjemahkan galat basis
 * data menjadi kalimat yang dibaca pembeli.
 *
 * Nol halaman `/bayar/selesai` dan nol rute balik Snap: `onSuccess` di peramban
 * hanya memicu pembacaan ulang entitlement, dan ia BUKAN sumber kebenaran
 * pembayaran. Yang memutuskan lunas hanyalah notifikasi bertanda tangan.
 */
export const runtime = "nodejs";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BarisPesanan = {
  pesanan_id: string;
  kode: string;
  percobaan: number;
  nominal_tagih: number;
  judul: string;
};

export async function POST(request: Request) {
  const user = await penggunaSaatIni();
  if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });

  let badan: unknown;
  try {
    badan = await request.json();
  } catch {
    return NextResponse.json({ pesan: "Format tidak valid." }, { status: 400 });
  }
  const isi = (badan ?? {}) as { productId?: unknown; ulang?: unknown };
  const productId = typeof isi.productId === "string" ? isi.productId : "";
  if (!POLA_UUID.test(productId)) {
    return NextResponse.json({ pesan: "Produk tidak dikenali." }, { status: 400 });
  }
  // `ulang` dinaikkan HANYA ketika Snap menolak menerbitkan token dan
  // `order_id` lamanya sudah terbakar — bukan setiap kali halaman dibuka.
  const ulang = isi.ulang === true;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("buat_pesanan", {
    p_product_id: productId,
    p_ulang: ulang,
  });

  if (error) {
    // `P0001` adalah `raise exception` KITA, dan kalimatnya memang ditulis
    // untuk pembeli ("Selesaikan dulu pesanan yang terbuka..."). Kode galat
    // lain diganti kalimat generik: pesan Postgres mentah membocorkan nama
    // constraint dan tidak berarti apa-apa bagi siapa pun yang membacanya.
    const pesan =
      error.code === "P0001" ? error.message : "Pesanan tidak bisa dibuat sekarang.";
    return NextResponse.json({ pesan }, { status: 409 });
  }

  const baris = (data as BarisPesanan[] | null)?.[0];
  if (!baris) {
    return NextResponse.json({ pesan: "Pesanan tidak bisa dibuat sekarang." }, { status: 409 });
  }

  // `kode.percobaan` — Midtrans menolak `order_id` kembar SELAMANYA, dan sufiks
  // percobaan itulah satu-satunya jalan keluar ketika token gagal terbit.
  const orderId = rakitOrderId(baris.kode, baris.percobaan);

  const snap = await terbitkanTokenSnap({
    orderId,
    nominal: baris.nominal_tagih,
    judul: baris.judul,
    // Satu konstanta untuk kolom `kedaluwarsa_pada` DAN `expiry` Snap.
    kedaluwarsaJam: JAM_TENGGAT_PESANAN,
  });

  if (!snap.ok) {
    // 502, bukan 500: yang gagal adalah pihak ketiga, dan pesanannya SENGAJA
    // dibiarkan hidup supaya pembeli bisa mengulang dengan `ulang: true`.
    return NextResponse.json({ pesan: snap.pesan }, { status: 502 });
  }

  const { error: eCatat } = await supabase.rpc("catat_token_snap", {
    p_pesanan_id: baris.pesanan_id,
    p_token: snap.token,
  });
  if (eCatat) {
    // SENGAJA tidak menggagalkan checkout. Tokennya sudah terbit dan pembeli
    // sudah bisa membayar; yang hilang hanyalah catatan kita sendiri, dan
    // `snap_token` tidak pernah dipercaya sebagai bukti pembayaran oleh apa pun.
    console.error(`[pesanan] gagal mencatat token snap ${baris.pesanan_id}: ${eCatat.message}`);
  }

  return NextResponse.json({
    token: snap.token,
    kode: baris.kode,
    pesananId: baris.pesanan_id,
    // Dibaca di SERVER dan dipulangkan, karena `MIDTRANS_PRODUKSI` tidak
    // berprefix NEXT_PUBLIC_ dan peramban tidak bisa membacanya sendiri.
    produksi: midtransProduksi(),
  });
}
```

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/app/api/pesanan/[id]/batal/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";

/**
 * PEMBATALAN MANDIRI.
 *
 * Bukan hiasan: satu klien hanya boleh punya SATU pesanan terbuka (unique
 * parsial `pesanan_terbuka_satu_per_klien`), jadi tanpa tombol ini orang yang
 * berubah pikiran soal produk harus menunggu 24 jam.
 *
 * Yang bisa disalahgunakan pemanggil hanyalah pesanannya SENDIRI: RPC memilih
 * barisnya dari `auth.uid()` dan hanya menerima pesanan `menunggu_bayar`. Ia
 * merusak checkoutnya sendiri, bukan milik orang lain — dan `snap_token` tidak
 * pernah dipercaya sebagai bukti pembayaran oleh apa pun.
 *
 * `dibatalkan: false` BUKAN galat. Ia jawaban jujur untuk "tidak ada pesanan
 * yang cocok dengan itu milik Anda" — dan menjawabnya 404 justru akan memberi
 * tahu pemanggil pesanan siapa yang ada.
 */
export const runtime = "nodejs";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await penggunaSaatIni();
  if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });

  if (!POLA_UUID.test(id)) {
    return NextResponse.json({ pesan: "Pesanan tidak dikenali." }, { status: 409 });
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("batalkan_pesanan_saya", { p_pesanan_id: id });

  if (error) {
    const pesan =
      error.code === "P0001" ? error.message : "Pesanan ini tidak bisa dibatalkan.";
    return NextResponse.json({ pesan }, { status: 409 });
  }

  return NextResponse.json({ dibatalkan: data === true });
}
```

---

- [ ] **Step 4: Jalankan uji rute, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-checkout-rute.test.ts
```

---

- [ ] **Step 5: Tulis `tests/produk-tombol-beli.test.tsx`** (uji DULU untuk komponen)

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/tests/produk-tombol-beli.test.tsx`:

```tsx
/**
 * TOMBOL BELI — tiga keadaan, dan satu jebakan env yang senyap.
 *
 * Urutan keadaan yang ditampilkan layar TIDAK boleh ditebak, dan spec
 * menyebutnya: entitlement DULU (punya -> tampilkan jalan masuknya), baru
 * `punya_pesanan_menunggu` (-> "Pembayaran Anda sedang diproses"), baru tombol
 * beli. Membaliknya berarti orang yang baru mentransfer lewat VA ditawari
 * membeli lagi — dan sebagian akan membayar dua kali.
 *
 * ===== JEBAKAN ENV, DIUJI SEBAGAI PERILAKU =====
 * `MIDTRANS_PRODUKSI` TIDAK berprefix `NEXT_PUBLIC_`, jadi di peramban ia
 * `undefined`. Komponen klien yang memanggil `midtransProduksi()` karena itu
 * akan SELALU memuat skrip Snap sandbox, di produksi, tanpa satu pun galat —
 * pembayaran yang "berhasil" dengan uang mainan. Dua pagar di bawah:
 *   (a) perilaku — `urlSkripSnap(false)` tetap sandbox WALAU env produksi
 *       terpasang; ia memakai parameternya, bukan env;
 *   (b) sumber — larangan NEGATIF: kedua berkas sisi-peramban tidak boleh
 *       menyebut `midtransProduksi` maupun `process.env` sama sekali. Larangan
 *       negatif tidak bisa dipuaskan oleh sebuah baris impor.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

// `tombol-beli.tsx` mengimpor `punyaProdukDiPeramban` dari `tombol-ambil.tsx`,
// yang menarik server action `ambil.ts` (dan lewat itu `next/cache` serta klien
// Supabase sisi server). Di-mock supaya berkas ini benar-benar hanya menguji
// render.
vi.mock("@/app/produk/[slug]/ambil", () => ({
  ambilProdukGratis: async () => ({ ok: true, punya: true }),
}));

const { PanelBeli, keadaanBeli } = await import("@/app/produk/[slug]/tombol-beli");
const { urlSkripSnap } = await import("@/lib/midtrans/konfig");
const { muatSkripSnap } = await import("@/lib/midtrans/snap-peramban");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const kosong = { slug: "panduan-menyusui", pending: false, pesan: null, onBeli: () => {} };

describe("PanelBeli — tiga keadaan", () => {
  it('belum punya: menawarkan "Beli sekarang"', () => {
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="belum" />);
    expect(m).toContain("Beli sekarang");
    expect(m).not.toContain("/passport/produk/panduan-menyusui");
    expect(m).not.toContain("sedang diproses");
  });

  it('pembayaran menggantung: "sedang diproses", BUKAN tombol beli', () => {
    // Inilah pagar terhadap pembayaran ganda. Orang yang baru mentransfer lewat
    // VA kembali ke halaman ini sebelum notifikasi mendarat; menawarinya tombol
    // beli berarti sebagian dari mereka membayar dua kali.
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="menunggu" />);
    expect(m).toContain("sedang diproses");
    expect(m).not.toContain("Beli sekarang");
    // Dan jalan menuju tempat produknya akan muncul.
    expect(m).toContain('href="/passport/produk"');
  });

  it('sudah punya: menawarkan "Buka", bukan "Beli sekarang" lagi', () => {
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="punya" />);
    expect(m).toContain('href="/passport/produk/panduan-menyusui"');
    expect(m).toContain("Buka");
    expect(m).not.toContain("Beli sekarang");
  });

  it("sedang menyiapkan: tombolnya nonaktif, bukan bisa diklik dua kali", () => {
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="belum" pending />);
    expect(m).toContain("disabled");
    expect(m).not.toContain("Beli sekarang");
  });

  it("pesan galat dirender apa adanya", () => {
    const m = renderToStaticMarkup(
      <PanelBeli {...kosong} keadaan="belum" pesan="Pembayaran belum bisa dimulai." />,
    );
    expect(m).toContain("Pembayaran belum bisa dimulai.");
  });
});

describe("urutan keadaan — DIJALANKAN, bukan dibaca dari teks sumber", () => {
  /**
   * Spec menuliskan urutannya secara eksplisit justru karena membaliknya
   * memakan uang: "orang yang baru mentransfer lewat VA melihat 'Pembayaran
   * Anda sedang diproses' alih-alih tombol beli, dan tidak membayar dua kali".
   *
   * Kelima uji `PanelBeli` di atas MENERIMA `keadaan` sebagai prop — mereka
   * menguji bahwa tampilan untuk "menunggu" benar, bukan bahwa keadaan
   * "menunggu" pernah dihitung. Tanpa ketiga kasus di bawah, seseorang boleh
   * menukar dua blok keputusannya (klien yang SUDAH punya produknya tapi
   * kebetulan punya pesanan `ditahan` akan melihat "sedang diproses" alih-alih
   * "Buka"), atau menghapus cabang `punya_pesanan_menunggu` sama sekali
   * (setiap orang yang baru mentransfer VA ditawari membeli lagi) — dan tidak
   * ada satu pun yang merah.
   */
  it("entitlement DULU: punya = true menang atas pesanan menunggu", async () => {
    let pesananDitanya = 0;
    const hasil = await keadaanBeli(
      async () => true,
      async () => {
        pesananDitanya += 1;
        return true;
      },
    );
    expect(hasil).toBe("punya");
    // Dan `punya_pesanan_menunggu` TIDAK ditanyakan sama sekali. Inilah
    // assertion yang membongkar pembalikan urutan: kalau blok pesanan
    // dipindahkan ke atas, angka ini jadi 1 dan hasilnya "menunggu".
    expect(pesananDitanya).toBe(0);
  });

  it("belum punya tapi ada pesanan menunggu -> 'menunggu', bukan tombol beli", async () => {
    expect(await keadaanBeli(async () => false, async () => true)).toBe("menunggu");
  });

  it("belum punya dan tidak ada pesanan -> 'belum'", async () => {
    expect(await keadaanBeli(async () => false, async () => false)).toBe("belum");
  });
});

describe("pemilihan sandbox/produksi tidak boleh senyap", () => {
  // Bentuk env-nya sendiri ("HANYA nilai true") dijaga berkas TERSENDIRI milik
  // Tugas 8: `tests/midtrans-konfig.test.ts`, tujuh nilai, nol basis data.
  // Yang tinggal di sini adalah dua hal yang memang milik sisi peramban:
  // bahwa `urlSkripSnap` memakai parameternya, dan larangan negatif atas kedua
  // berkas sisi-klien.
  it("urlSkripSnap memakai PARAMETERNYA, bukan env", () => {
    const sebelum = process.env.MIDTRANS_PRODUKSI;
    process.env.MIDTRANS_PRODUKSI = "true";
    try {
      // Kalau fungsi ini diam-diam membaca env, baris ini merah — dan itulah
      // satu-satunya cara jebakan ini bisa tertangkap sebelum produksi.
      expect(urlSkripSnap(false)).toContain("app.sandbox.midtrans.com");
      expect(urlSkripSnap(true)).toBe("https://app.midtrans.com/snap/snap.js");
    } finally {
      if (sebelum === undefined) delete process.env.MIDTRANS_PRODUKSI;
      else process.env.MIDTRANS_PRODUKSI = sebelum;
    }
  });

  it.each([
    "src/app/produk/[slug]/tombol-beli.tsx",
    "src/lib/midtrans/snap-peramban.ts",
  ])("%s tidak menyebut midtransProduksi maupun process.env", (rel) => {
    const isi = baca(rel);
    expect(isi).not.toContain("midtransProduksi");
    expect(isi).not.toContain("process.env");
  });

  it("page.tsx membaca keduanya di SERVER dan mengopernya sebagai prop", () => {
    const isi = baca("src/app/produk/[slug]/page.tsx");
    expect(isi).toContain("midtransProduksi");
    expect(isi).toContain("NEXT_PUBLIC_MIDTRANS_CLIENT_KEY");
    expect(isi).toContain("produksi={");
    expect(isi).toContain("clientKey={");
  });
});

describe("muatSkripSnap", () => {
  it("MELEMPAR di luar peramban", async () => {
    // Pagar terhadap impor yang salah: dipanggil dari server component ia harus
    // gagal keras, bukan memulangkan promise yang tidak pernah selesai.
    await expect(muatSkripSnap("kunci", false)).rejects.toThrow();
  });
});
```

---

- [ ] **Step 6: Jalankan uji komponen, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/produk-tombol-beli.test.tsx
```

Kegagalan yang DIHARAPKAN: `Cannot find module '@/app/produk/[slug]/tombol-beli'`.

---

- [ ] **Step 7: Tulis `src/lib/midtrans/snap-peramban.ts`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/lib/midtrans/snap-peramban.ts`:

```ts
import { urlSkripSnap } from "./konfig";

/**
 * Pemuat skrip Snap — satu kali per halaman, dan satu kali saja.
 *
 * Skrip Snap tidak bisa diimpor sebagai modul: ia menempel `window.snap`
 * sesudah dimuat, dan atribut `data-client-key` pada tag <script>-nyalah yang
 * memberitahunya merchant mana ini.
 *
 * `produksi` DIOPER, tidak dibaca dari env. `MIDTRANS_PRODUKSI` tidak berprefix
 * `NEXT_PUBLIC_`, jadi membacanya di sini akan selalu memberi `undefined` dan
 * karenanya SELALU sandbox — di produksi, tanpa satu pun galat. Yang membacanya
 * adalah `/produk/[slug]/page.tsx` di server.
 *
 * Janji pemuatannya disimpan di modul: dua tombol di satu halaman (atau satu
 * tombol yang diklik dua kali) tidak boleh menyisipkan dua tag <script>. Pada
 * kegagalan, janjinya DILEPAS supaya klik berikutnya benar-benar mencoba lagi
 * alih-alih mewarisi kegagalan lama selamanya.
 */
declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        opsi: {
          onSuccess?: () => void;
          onPending?: () => void;
          onError?: () => void;
          onClose?: () => void;
        },
      ) => void;
    };
  }
}

const ID_SKRIP = "midtrans-snap";

let pemuatan: Promise<void> | null = null;

export async function muatSkripSnap(clientKey: string, produksi: boolean): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("muatSkripSnap hanya hidup di peramban.");
  }
  if (window.snap) return;
  if (pemuatan) return pemuatan;

  pemuatan = new Promise<void>((selesai, gagal) => {
    const skrip = document.createElement("script");
    skrip.id = ID_SKRIP;
    skrip.src = urlSkripSnap(produksi);
    skrip.async = true;
    skrip.setAttribute("data-client-key", clientKey);
    skrip.onload = () => selesai();
    skrip.onerror = () => gagal(new Error("Skrip pembayaran gagal dimuat."));
    document.head.appendChild(skrip);
  });

  try {
    await pemuatan;
  } catch (galat) {
    pemuatan = null;
    document.getElementById(ID_SKRIP)?.remove();
    throw galat;
  }
}
```

---

- [ ] **Step 8: Ekspor `BlokBuka`, dan periksa sebelum mencabut `TautanBuka`**

`TombolBeli` MENYERAP pekerjaan `TautanBuka`: keduanya menjawab pertanyaan yang sama
("orang ini sudah memiliki produknya"), dan dua komponen yang menjawab satu pertanyaan
pasti berbeda jawabannya suatu hari. Sebelum mencabut, buktikan tidak ada pemakai lain:

```bash
cd /Users/arvinfairuz/Documents/padma/web && grep -rn "TautanBuka" src/ tests/
```

Harapan: hanya `src/app/produk/[slug]/tombol-ambil.tsx` (definisi) dan
`src/app/produk/[slug]/page.tsx` (impor + satu pemakaian). Bila ada pemakai lain,
**berhenti** dan pakai `TombolBeli` di sana juga, atau biarkan `TautanBuka` hidup.

Lalu di `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/tombol-ambil.tsx`:

1. Cari deklarasi `function BlokBuka({ slug }: { slug: string }) {` (baris 22 pada `main`
   hari ini — cari namanya, jangan percaya nomornya) dan ganti menjadi:

```tsx
/**
 * Satu bentuk "sudah dimiliki", dipakai TIGA pemanggil — gratis (`PanelAmbil`),
 * berbayar (`PanelBeli`), dan siapa pun sesudahnya. Diekspor supaya kedua panel
 * tidak menumbuhkan salinannya masing-masing: dua blok "Buka" yang berbeda
 * tautannya adalah cacat yang hanya terlihat oleh yang sudah membayar.
 */
export function BlokBuka({ slug }: { slug: string }) {
```

2. Hapus komponen bernama `TautanBuka` — **dari baris pertama dokbloknya (`/**`) sampai
   kurung tutup badannya (`}`)**, dan **JANGAN memakai nomor baris**. Pekerjaannya diserap
   `TombolBeli`. `PanelAmbil`, `TombolAmbil`, dan `punyaProdukDiPeramban` tidak disentuh;
   `tests/produk-tombol-ambil.test.tsx` tidak menyebut `TautanBuka` sama sekali (diperiksa),
   jadi ia tetap hijau.

   Versi pertama langkah ini berbunyi "baris 119–137", dan nomor itu **salah sejak rencana
   ini ditulis** — bukan akibat P1-A. Di `main` hari ini baris 119 adalah `return baris !== null;`,
   ekor `punyaProdukDiPeramban`: fungsi yang tugas ini sendiri IMPOR. Dituruti harfiah,
   fungsinya rusak dan ekor komponen yang mau dihapus justru menggantung. Aturan umumnya
   §0.12. Sesudah menghapus, jalankan `grep -n "TautanBuka" src/ tests/` lagi: nol hasil, dan
   `npx tsc --noEmit` hijau.

---

- [ ] **Step 9: Tulis `src/app/produk/[slug]/tombol-beli.tsx`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/tombol-beli.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { muatSkripSnap } from "@/lib/midtrans/snap-peramban";
import { BlokBuka, punyaProdukDiPeramban } from "./tombol-ambil";

/**
 * Keadaan tombol produk BERBAYAR, dari sudut pandang pengunjung. Urutan
 * pemeriksaannya MENGIKAT dan disebut spec supaya tidak ditebak:
 *
 *   "punya"    — entitlement hidup. Diperiksa DULUAN, karena kepemilikan adalah
 *                satu-satunya sumber kebenaran akses; status pesanan bukan.
 *   "menunggu" — punya pesanan yang belum mati dan belum melahirkan akses
 *                (`menunggu_bayar` ATAU `ditahan`). Orang ini SUDAH menyetor.
 *   "belum"    — pengunjung anon, atau klien yang memang belum memulai apa pun.
 *
 * Membalik dua yang pertama berarti orang yang baru mentransfer lewat VA
 * ditawari membeli lagi, dan sebagian dari mereka akan membayar dua kali.
 */
export type KeadaanBeli = "belum" | "punya" | "menunggu";

/**
 * KEPUTUSAN URUTAN LAYAR, sebagai fungsi MURNI.
 *
 * ===== KENAPA DIEKSTRAK DARI `segarkan()` =====
 * Selama ia tinggal di dalam `useCallback`, ia tidak bisa dijalankan satu kali
 * pun oleh suite ini: `renderToStaticMarkup` tidak menjalankan efek dan repo
 * ini nol jsdom. Kelima uji `PanelBeli` MENERIMA `keadaan` sebagai prop —
 * mereka membuktikan tampilan untuk "menunggu" benar, bukan bahwa keadaan
 * "menunggu" pernah DIHITUNG. Seseorang boleh menukar dua blok di bawah, atau
 * menghapus cabang `punyaPesanan` sama sekali, dan tidak ada yang merah.
 *
 * Resep ini sudah dipakai Tugas 10 untuk masalah yang sama (`picu-periksa.ts`,
 * "supaya bisa dijalankan sungguhan"); di sini ia diterapkan ke keputusan yang
 * jauh lebih mahal bila terbalik.
 *
 * ===== URUTANNYA MENGIKAT, DAN SPEC MENYEBUTNYA =====
 *   1. entitlement DULU — kepemilikan adalah satu-satunya sumber kebenaran
 *      akses; status pesanan bukan. Orang yang SUDAH punya produknya harus
 *      melihat "Buka", apa pun keadaan pesanannya.
 *   2. baru `punya_pesanan_menunggu` — "orang yang baru mentransfer lewat VA
 *      melihat 'Pembayaran Anda sedang diproses' alih-alih tombol beli, dan
 *      tidak membayar dua kali".
 *   3. baru tombol beli.
 *
 * `punyaPesanan` diterima sebagai FUNGSI, bukan sebagai boolean: itulah yang
 * membuat "tidak pernah dipanggil ketika sudah punya" bisa di-assert, dan
 * sekaligus yang menghemat satu perjalanan RPC untuk setiap pemilik produk.
 */
export async function keadaanBeli(
  punyaProduk: () => Promise<boolean>,
  punyaPesanan: () => Promise<boolean>,
): Promise<KeadaanBeli> {
  if (await punyaProduk()) return "punya";
  return (await punyaPesanan()) ? "menunggu" : "belum";
}

/**
 * Bagian yang MURNI tampilan — dipisahkan supaya ketiga keadaannya bisa diuji
 * dengan render sungguhan (`tests/produk-tombol-beli.test.tsx`), bukan lewat
 * pembacaan teks sumber. Efek, jaringan, dan popup Snap tinggal di `TombolBeli`.
 */
export function PanelBeli({
  slug,
  keadaan,
  pending,
  pesan,
  onBeli,
}: {
  slug: string;
  keadaan: KeadaanBeli;
  pending: boolean;
  pesan: string | null;
  onBeli: () => void;
}) {
  if (keadaan === "punya") return <BlokBuka slug={slug} />;

  if (keadaan === "menunggu") {
    return (
      <div className="mt-4 rounded-xl bg-gold/10 px-4 py-3">
        <p className="text-[13.5px] font-bold text-night">
          Pembayaran Anda sedang diproses.
        </p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Transfer bank dan VA kadang butuh beberapa menit. Begitu pembayarannya
          diterima, produk ini muncul di{" "}
          <Link href="/passport/produk" className="font-semibold text-leaf underline">
            Pembelian Saya
          </Link>
          . Halaman ini tidak perlu dimuat ulang terus-menerus.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onBeli}
        disabled={pending}
        className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Menyiapkan pembayaran..." : "Beli sekarang"}
      </button>
      {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
    </div>
  );
}

/**
 * `produksi` dan `clientKey` DIOPER dari server (`page.tsx`), tidak dibaca di
 * sini. `MIDTRANS_PRODUKSI` tidak berprefix `NEXT_PUBLIC_`; membacanya dari
 * komponen klien memberi `undefined`, yang berarti sandbox — selamanya, di
 * produksi, tanpa satu pun galat.
 */
export function TombolBeli({
  slug,
  productId,
  produksi,
  clientKey,
}: {
  slug: string;
  productId: string;
  produksi: boolean;
  clientKey: string;
}) {
  const [keadaan, setKeadaan] = useState<KeadaanBeli>("belum");
  const [pesan, setPesan] = useState<string | null>(null);
  const [pending, mulai] = useTransition();
  const router = useRouter();

  /**
   * Keadaan dibaca DARI PERAMBAN, bukan dari server: `/produk/[slug]` sengaja
   * anon dan ter-cache (`revalidate = 300`), dan membaca cookie di sana akan
   * membuat SELURUH etalase dynamic demi satu tombol.
   */
  const segarkan = useCallback(async () => {
    const sb = createBrowserSupabase();
    // Tanpa sesi tidak ada yang perlu ditanyakan, dan bertanya hanya melahirkan
    // 42501 di konsol pengunjung: `anon` tidak memegang hak atas
    // `digital_entitlements` maupun RPC pesanan.
    const { data: sesi } = await sb.auth.getSession();
    if (!sesi.session) {
      setKeadaan("belum");
      return;
    }
    // Urutannya hidup di `keadaanBeli`, bukan di sini — lihat dokbloknya.
    setKeadaan(
      await keadaanBeli(
        () => punyaProdukDiPeramban(sb, productId),
        async () => {
          const { data } = await sb.rpc("punya_pesanan_menunggu", { p_product_id: productId });
          return data === true;
        },
      ),
    );
  }, [productId]);

  useEffect(() => {
    void segarkan();
  }, [segarkan]);

  function klik() {
    mulai(async () => {
      setPesan(null);

      try {
        await muatSkripSnap(clientKey, produksi);
      } catch {
        setPesan("Pembayaran tidak bisa dibuka. Coba lagi sebentar lagi.");
        return;
      }

      const jawab = await fetch("/api/pesanan/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId }),
      });

      if (jawab.status === 401) {
        // `/masuk` tidak membaca parameter lanjutan apa pun di repo ini, jadi
        // tidak ada janji "kembali ke sini" yang dibuat lalu dilanggar.
        router.push("/masuk");
        return;
      }

      const isi = (await jawab.json().catch(() => null)) as
        | { token?: string; pesan?: string }
        | null;
      if (!jawab.ok || !isi?.token) {
        setPesan(isi?.pesan ?? "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.");
        return;
      }

      window.snap?.pay(isi.token, {
        // `onSuccess` BUKAN sumber kebenaran pembayaran — yang memutuskan lunas
        // hanyalah notifikasi bertanda tangan. Ia hanya memicu pembacaan ulang.
        // Pada metode yang membawa pengguna keluar aplikasi (deeplink e-wallet)
        // ia bisa tidak pernah menyala sama sekali, dan itu diterima sadar:
        // pembeli menemukan produknya di Pembelian Saya saat ia kembali.
        onSuccess: () => {
          void segarkan();
          router.refresh();
        },
        onPending: () => setKeadaan("menunggu"),
        onClose: () => void segarkan(),
        onError: () => setPesan("Pembayaran gagal. Silakan coba lagi."),
      });
    });
  }

  return (
    <PanelBeli
      slug={slug}
      keadaan={keadaan}
      pending={pending}
      pesan={pesan}
      onBeli={klik}
    />
  );
}
```

---

- [ ] **Step 10: Sunting `src/app/produk/[slug]/page.tsx`**

Tiga perubahan di `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/page.tsx`:

1. Baris impor (baris 5) — ganti impor `TautanBuka` dan tambahkan dua impor:

```tsx
import { midtransProduksi } from "@/lib/midtrans/konfig";
import { TombolAmbil } from "./tombol-ambil";
import { TombolBeli } from "./tombol-beli";
```

2. `HargaProduk` menerima dua prop baru, dan cabang berbayarnya merender `<TombolBeli>`:

```tsx
function HargaProduk({
  slug,
  productId,
  harga,
  hargaCoret,
  produksi,
  clientKey,
}: {
  slug: string;
  productId: string;
  harga: number | null;
  hargaCoret: number | null;
  produksi: boolean;
  clientKey: string;
}) {
  if (harga === null) {
    return <p className="mt-4 text-[15px] text-ink-soft">Harga segera diumumkan</p>;
  }
  if (harga === 0) {
    return (
      <div className="mt-4 flex flex-col items-start gap-3">
        <span className="rounded-full bg-leaf-soft px-3 py-1 text-[12px] font-bold uppercase tracking-wide text-leaf">
          Gratis
        </span>
        {/* Pengunjung anon diarahkan ke /masuk oleh server action itu sendiri
            — lihat komentar `ambil.ts`. Klien yang SUDAH memiliki produknya
            melihat tombol "Buka" alih-alih "Ambil gratis"; halaman ini tetap
            dibaca anon dan di-cache, kepemilikannya ditanyakan dari peramban
            (lihat `punyaProdukDiPeramban`). */}
        <TombolAmbil slug={slug} productId={productId} />
      </div>
    );
  }
  return (
    <>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-bold text-night">{formatRupiah(harga)}</span>
        {hargaCoret !== null && (
          <s className="text-[15px] text-ink-soft/70">{formatRupiah(hargaCoret)}</s>
        )}
      </div>
      {/* `TombolBeli` MENYERAP `TautanBuka` yang dulu berdiri di sini: yang
          sudah memiliki tetap melihat "Buka", yang punya pembayaran
          menggantung melihat "sedang diproses", dan sisanya melihat tombol
          beli. Satu komponen, karena ketiganya menjawab satu pertanyaan. */}
      <TombolBeli
        slug={slug}
        productId={productId}
        produksi={produksi}
        clientKey={clientKey}
      />
    </>
  );
}
```

3. Pemanggilan `HargaProduk` di dalam `ProdukDetailPage` mengoper keduanya:

```tsx
        {/* Keduanya dibaca DI SERVER. `MIDTRANS_PRODUKSI` sengaja tanpa prefiks
            NEXT_PUBLIC_, jadi peramban tidak bisa membacanya sendiri — dan
            komponen klien yang mencoba akan selalu mendapat sandbox, senyap.
            Karena halaman ini `revalidate = 300`, keduanya juga harus sudah
            terpasang saat build/revalidasi, bukan hanya saat request. */}
        <HargaProduk
          slug={produk.slug}
          productId={produk.id}
          harga={produk.harga}
          hargaCoret={produk.hargaCoret}
          produksi={midtransProduksi()}
          clientKey={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? ""}
        />
```

---

- [ ] **Step 11: Jalankan kedua uji komponen & rute, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/produk-tombol-beli.test.tsx tests/produk-tombol-ambil.test.tsx tests/pesanan-checkout-rute.test.ts tests/pagar-batas-server-klien.test.ts
```

Keempatnya hijau. `produk-tombol-ambil` ikut karena `tombol-ambil.tsx` disunting;
`pagar-batas-server-klien` ikut karena `page.tsx` adalah berkas server yang baru
menerima dua prop.

---

- [ ] **Step 12: Daftarkan kedua rute di README**

Sisipkan **dua baris** tepat sesudah baris `` `/api/cron/tenggat` `` di
`/Users/arvinfairuz/Documents/padma/web/README.md`. Segmen dinamis ditulis **harfiah
`[id]`** — `tests/inventaris-rute.test.ts` memungut rute dari sistem berkas, jadi `[id]`
yang ditulis `:id` akan sekaligus menjadi "hantu" dan "tak terdaftar":

```
| `/api/pesanan/checkout` | Klien | POST membuat pesanan lalu menerbitkan token Snap. Rute TIPIS: RPC `buat_pesanan` dipanggil dengan SESI PEMANGGIL, tidak pernah service role — `client_id` dipilih dari `auth.uid()` di dalam RPC, harga dibekukan di sana, dan pesanan terbuka kedua ditolak unique parsial |
| `/api/pesanan/[id]/batal` | Klien | POST pembatalan mandiri pesanan sendiri yang masih `menunggu_bayar`. Ada karena satu klien hanya boleh punya satu pesanan terbuka: tanpanya, berubah pikiran soal produk berarti menunggu 24 jam |
```

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/inventaris-rute.test.ts
```

---

- [ ] **Step 13: Jalankan pagar yang bersinggungan**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-checkout-rute.test.ts tests/produk-tombol-beli.test.tsx tests/produk-tombol-ambil.test.tsx tests/inventaris-rute.test.ts tests/env-terdokumentasi.test.ts tests/pesanan-jejak-yatim.test.ts tests/jejak-yatim.test.ts tests/landing-produk.test.tsx tests/produk-katalog.test.ts
```

Seluruhnya hijau. `env-terdokumentasi` ikut karena `page.tsx` adalah pembaca pertama
`NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`; dua berkas produk terakhir ikut karena etalase dan
halaman produk baru saja disunting.

---

- [ ] **Step 14: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add web/src/app/api/pesanan web/src/lib/midtrans/snap-peramban.ts "web/src/app/produk/[slug]" web/tests/pesanan-checkout-rute.test.ts web/tests/produk-tombol-beli.test.tsx web/README.md && git commit -F - <<'PESAN'
feat(pesanan): checkout — dua rute tipis, Snap popup, tombol beli

Rute TIPIS dan itu keputusan, bukan gaya: keduanya memanggil RPC dengan
SESI PEMANGGIL, tidak pernah service role. Yang memilih client_id adalah
auth.uid() di dalam RPC — pemeriksaan yang hanya hidup di TypeScript bisa
dilewati dengan satu panggilan langsung ke PostgREST.

Pembatalan mandiri bukan hiasan: satu klien hanya boleh punya satu
pesanan terbuka, jadi tanpanya orang yang berubah pikiran soal produk
harus menunggu 24 jam. Yang bisa disalahgunakan pemanggil hanyalah
pesanannya sendiri.

Tombol beli menyerap TautanBuka: keadaan "punya", "menunggu", dan "belum"
menjawab SATU pertanyaan, dan dua komponen yang menjawab satu pertanyaan
pasti berbeda jawabannya suatu hari. Urutannya mengikat — entitlement
dulu, baru punya_pesanan_menunggu, baru tombol beli: membaliknya berarti
orang yang baru mentransfer lewat VA ditawari membeli lagi.

Keputusan urutan itu DIEKSTRAK jadi fungsi murni keadaanBeli(), bukan
dibiarkan di dalam useCallback: renderToStaticMarkup tidak menjalankan
efek dan repo ini nol jsdom, jadi keputusan yang tinggal di dalam hook
hanya bisa "diuji" dengan memindai teks sumber. Ketiga kombinasinya
dijalankan sungguhan, termasuk yang membongkar pembalikan urutan —
punya=true harus memulangkan "punya" TANPA menanyakan pesanan sama
sekali.

Otorisasi lintas-klien memakai klien kedua ber-akun auth dari
tests/helpers/klien-kedua.ts, bukan admin: sesi admin menabrak gerbang
identitas (42501 -> 409), bukan klausa kepemilikan baris, sehingga jalur
{ dibatalkan: false } tidak pernah dieksekusi sama sekali.

MIDTRANS_PRODUKSI sengaja tanpa prefiks NEXT_PUBLIC_, jadi peramban tidak
bisa membacanya: pilihan sandbox/produksi dibaca di server dan dioper
sebagai prop. Komponen klien yang membacanya sendiri akan SELALU memuat
Snap sandbox di produksi tanpa satu pun galat. Dijaga dua arah — uji
perilaku bahwa urlSkripSnap memakai parameternya walau env produksi
terpasang, dan larangan negatif atas kedua berkas sisi-peramban.

Nol halaman /bayar/selesai dan nol rute balik Snap yang menerbitkan apa
pun. onSuccess hanya memicu pembacaan ulang entitlement.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
```
### Task 10: Lapis 1b — pemeriksaan saat halaman dibuka

Jaring pengaman UTAMA P1. Bukan cron. Orang yang paling butuh pemeriksaan — yang baru
membayar lalu kembali mencari produknya — adalah orang yang sedang membuka halaman itu.

**BACA DULU** (pola yang ditiru, path lengkap):

- `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/tombol-ambil.tsx` — kenapa
  kepemilikan di `/produk/[slug]` ditanyakan DARI PERAMBAN, bukan dari server (dokblok
  `punyaProdukDiPeramban`, baris 89-102). Alasan yang sama mengikat tugas ini.
- `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/ambil.ts` — bentuk server
  action `"use server"` di repo ini.
- `/Users/arvinfairuz/Documents/padma/web/src/app/passport/produk/page.tsx` — halaman yang
  disunting di Step 7.
- `/Users/arvinfairuz/Documents/padma/web/src/lib/admin/tagihan-pengajuan.ts` baris 103-123 —
  doktrin rumah soal galat: **dibaca, tidak dibuang**. Tugas ini melanggarnya SATU arah dengan
  sadar (lihat dokblok `periksaPesananMenggantung`), jadi bacalah apa yang dilanggar.
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-reader-passport.test.tsx` baris 1-45 —
  pola merender halaman server sungguhan dengan sesi klien nyata.
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-ambil-gratis.test.ts` baris 1-25 — pola
  menyemai `digital_products` + harga + berkas lewat service role.
- `/Users/arvinfairuz/Documents/padma/web/tests/setup-fetch-guard.ts` — **jangan disunting.**
  Ia daftar izin host; menambah `.midtrans.com` berarti memberi izin uji menembak Midtrans
  sungguhan. Uji di bawah memalsukan adapternya, bukan jaringannya.

**Files:**

- Create: `web/src/lib/pesanan/periksa-menggantung.ts`
- Create: `web/src/lib/pesanan/picu-periksa.ts`
- Create: `web/src/app/produk/[slug]/periksa.ts`
- Modify: `web/src/app/passport/produk/page.tsx:1-18`
- Modify: `web/src/app/produk/[slug]/tombol-beli.tsx` (berkas milik Task 9 — tugas ini menambah
  SATU efek mount dan dua impor; jangan menyentuh yang lain)
- Test: `web/tests/pesanan-periksa-dibuka.test.ts`

**Interfaces:**

- Consumes (Task 1) — `web/src/lib/pesanan/status.ts`:
  - `export const MENIT_JEDA_PERIKSA = 5;`
  - `export const JAM_TENGGANG_404 = 1;`
  - `export const PESANAN_TERBUKA: readonly StatusPesanan[];` — **dipakai sungguhan** di kueri
    pemilih (`.in("status", [...PESANAN_TERBUKA])`), bukan literal `"menunggu_bayar"`. Himpunan
    itu lahir di Tugas 1 untuk mencegah satu pelajaran mahal: nilai enum baru membuat konstanta
    tunggal salah DIAM-DIAM. Dengan literal, nilai keenam yang kelak lahir tidak pernah
    ditanyakan ke Midtrans dan himpunan T1 berhenti punya konsumen sama sekali.
- Consumes (Task 2) — tabel `public.orders`, dibaca DENGAN SESI PEMANGGIL lewat policy
  `"pesanan: klien baca miliknya"`. Kolom yang dipakai: `id, kode, percobaan, status,
  dibuat_pada, kedaluwarsa_pada, diperiksa_pada`.
- Consumes (Task 4) — `web/src/lib/pesanan/order-id.ts`:
  - `export function rakitOrderId(kode: string, percobaan: number): string;`
- Consumes (Task 5) — RPC, dipanggil DENGAN SERVICE ROLE:
  - `public.terapkan_notifikasi_midtrans(p_order_id text, p_transaction_status text,
    p_fraud_status text, p_transaction_id text, p_payment_type text, p_gross_amount numeric,
    p_sidik text, p_sumber text default 'webhook') returns text`
    — nilai balik dari himpunan `'diterapkan' | 'duplikat' | 'tanpa_efek' | 'pesanan_tidak_ada'`.
- Consumes (Task 8) — `web/src/lib/midtrans/adapter.ts` dan `web/src/lib/midtrans/tanda-tangan.ts`:
  - `export type StatusMidtrans = { order_id: string; status_code: string;
    transaction_status: string; transaction_id: string; gross_amount: string;
    fraud_status: string | null; payment_type: string | null };`
  - `export async function bacaStatusTransaksi(orderId: string):
    Promise<{ ok: true; status: StatusMidtrans } | { ok: false; kode: number; pesan: string }>;`
  - `export function hitungSidik(b: { orderId: string; statusCode: string;
    transactionStatus: string; fraudStatus: string; transactionId: string }): string;`
- Consumes (repo): `createServerSupabase()` dari `@/lib/supabase/server`,
  `createAdminSupabase()` dari `@/lib/supabase/admin`.
- Consumes (T4, sudah ada di `main`) — `web/tests/helpers/klien-kedua.ts`:
  `KLIEN_KEDUA_ID`, `siapkanKlienKedua()`, `bongkarKlienKedua()`. Dipakai **hanya** oleh berkas
  uji, dan hanya untuk menampung satu baris: pesanan yang `kode`-nya sengaja dirusak. Lihat
  §0.11 — baris itu tidak boleh menyentuh klien yang dipakai Tugas 8, 11, dan 12.
- Produces (dipakai Task 11 dan Task 12 — tanda tangan PERSIS):
  ```ts
  // web/src/lib/pesanan/periksa-menggantung.ts
  export const BATAS_PERIKSA_SEKALI = 3;
  export type PesananDiperiksa = {
    id: string; kode: string; percobaan: number; kedaluwarsaPada: string;
  };
  export type HasilPeriksaPesanan =
    | "diterapkan" | "duplikat" | "tanpa_efek" | "pesanan_tidak_ada"
    | "bentuk_order_id" | "belum_kedaluwarsa" | "midtrans_tak_terjawab" | "kunci_belum_terpasang"
    | "galat_basis_data";
  export async function terapkanJawabanMidtrans(p: PesananDiperiksa): Promise<HasilPeriksaPesanan>;
  export async function sapuPesananMenggantung(
    pemilih: SupabaseClient, batasBaris: number, clientId: string | null = null,
  ): Promise<{ diperiksa: number }>;                 // MELEMPAR bila PEMILIHAN barisnya gagal
  export async function periksaPesananMenggantung(): Promise<{ diperiksa: number }>;  // TIDAK PERNAH melempar
  ```
  **SEMBILAN nilai, bukan delapan.** `kunci_belum_terpasang` datang dari `kode: -1` adapter
  (Tugas 8) dan sengaja TIDAK dilebur ke `midtrans_tak_terjawab`: yang kedua menyuruh staf
  mencoba lagi, dan kunci server yang belum dipasang tidak pernah sembuh dengan dicoba lagi.
  Tugas 11 memetakannya ke kalimat yang sudah dipilih Tugas 8 — *"Pembayaran belum aktif.
  Hubungi tim PADMA."* — dan `Record<HasilPeriksaPesanan, string>` di sana yang MEMAKSA
  petanya lengkap.
  ```ts
  // web/src/lib/pesanan/picu-periksa.ts   (tanpa server-only — diimpor komponen klien)
  export async function picuPeriksaSekali(
    periksa: () => Promise<{ diperiksa: number }>,
    segarkan: () => void,
  ): Promise<number>;
  ```
  ```ts
  // web/src/app/produk/[slug]/periksa.ts
  export async function periksaPesananSaya(): Promise<{ diperiksa: number }>;
  ```

---

- [ ] **Step 1: Tulis uji yang gagal**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-periksa-dibuka.test.ts`:

```ts
/**
 * LAPIS 1b — PEMERIKSAAN SAAT HALAMAN DIBUKA (spec "Rekonsiliasi — empat lapis").
 *
 * Inilah jaring pengaman utama P1, dan ia menjaga dua hal yang gagal ke arah
 * berlawanan, jadi keduanya diuji terpisah:
 *
 *  1. TERLALU JARANG. Pesanan yang menggantung karena webhook tidak pernah
 *     mendarat akan tinggal `menunggu_bayar` selamanya bila tidak ada yang
 *     bertanya ke Midtrans. Pembeli sudah mentransfer dan tidak mendapat
 *     apa-apa — kegagalan termahal di seluruh P1.
 *  2. TERLALU SERING. Satu halaman yang di-refresh berkali-kali tidak boleh
 *     berubah jadi banjir permintaan ke Midtrans. Pagarnya `orders.diperiksa_pada`,
 *     dan ia HARUS tercap walaupun jawabannya tidak mengubah apa pun — kalau
 *     tidak, justru pesanan yang jawabannya "belum apa-apa" (kasus paling umum)
 *     yang ditanyakan ulang tanpa batas.
 *
 * Ditambah dua sifat yang tidak boleh ditawar:
 *
 *  3. KEGAGALAN DISEMBUNYIKAN. Midtrans tidak terhubung -> halaman tetap
 *     terender dengan keadaan yang ia tahu. Orang yang sedang mencari produknya
 *     tidak boleh melihat layar galat karena pemeriksaan latar gagal.
 *  4. HANYA MILIK PEMANGGIL. Pemilihan barisnya memakai SESI pemanggil, bukan
 *     service role — kalau tidak, membuka satu halaman menembakkan permintaan
 *     Midtrans atas pesanan orang lain.
 *
 * Midtrans TIDAK PERNAH ditembak dari suite: `tests/setup-fetch-guard.ts`
 * adalah daftar izin dan `.midtrans.com` sengaja TIDAK ada di sana. Yang
 * dipalsukan di berkas ini adalah modul adapternya, bukan jaringannya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
// Klien KEDUA ber-akun auth, lahir di Tugas 4 dan sudah ada di `main`. Dipakai
// di sini HANYA untuk menampung baris yang `kode`-nya sengaja dirusak — lihat
// `bersihkan()` dan §0.11.
import { KLIEN_KEDUA_ID, siapkanKlienKedua, bongkarKlienKedua } from "./helpers/klien-kedua";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

// `createServerSupabase()` membaca cookies() dan hanya bermakna di dalam
// request scope. Modulnya diganti klien Supabase ber-SESI NYATA: RLS tetap
// berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// Adapter Midtrans dipalsukan SELURUHNYA. `panggilan` mencatat setiap order_id
// yang ditanyakan — itulah yang membuat pagar "sekali per lima menit" bisa
// diuji sebagai KETIADAAN permintaan, bukan sebagai komentar.
const midtrans = vi.hoisted(() => ({
  jawaban: null as unknown,
  panggilan: [] as string[],
  lempar: false,
}));
vi.mock("@/lib/midtrans/adapter", () => ({
  bacaStatusTransaksi: async (orderId: string) => {
    midtrans.panggilan.push(orderId);
    if (midtrans.lempar) throw new Error("Midtrans tidak terhubung");
    return midtrans.jawaban;
  },
  terbitkanTokenSnap: async () => ({ ok: false, pesan: "tidak dipakai di berkas ini" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { periksaPesananMenggantung, terapkanJawabanMidtrans } = await import(
  "@/lib/pesanan/periksa-menggantung"
);
const { picuPeriksaSekali } = await import("@/lib/pesanan/picu-periksa");
const { default: HalamanProdukSaya } = await import("@/app/passport/produk/page");

const KLIEN_ANANDA = "44444444-4444-4444-4444-444444444401";
const KLIEN_RINA = "44444444-4444-4444-4444-444444444402"; // sengaja tanpa akun auth
const SLUG = "uji-lapis-1b";
const JUDUL = "Uji Lapis Satu B";
const HARGA = 120_000;
const AWALAN_KODE = "PSN-260926-1B";

let produkId: string;

/**
 * Kunci primer setiap baris `orders` yang berkas ini semai, dikumpulkan saat
 * menyemai. `bersihkan()` menghapus lewat DAFTAR INI, bukan lewat `kode`
 * — aturan §0.11 nomor 2, dan berkas inilah yang membayarnya: uji
 * "bentuk_order_id" MENGGANTI `orders.kode` jadi "bukan-kode-pesanan", jadi
 * pembersih yang mencari lewat `kode` tidak akan pernah menemukan barisnya lagi.
 */
const idDisemai: string[] = [];

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

/**
 * Satu pesanan `menunggu_bayar` berikut satu itemnya, ditulis SERVICE ROLE.
 * Bahan uji tidak lewat jalur yang diuji: `orders` tidak punya satu pun grant
 * INSERT untuk peran API, dan itu memang pagar yang dipertahankan.
 */
async function semaiPesanan(o: {
  kode: string;
  clientId?: string;
  menitLalu?: number;
  diperiksaMenitLalu?: number | null;
  kedaluwarsaJam?: number; // positif = masa depan, negatif = sudah lewat
}): Promise<string> {
  const dibuat = new Date(Date.now() - (o.menitLalu ?? 30) * 60_000).toISOString();
  const { data, error } = await admin
    .from("orders")
    .insert({
      kode: o.kode,
      percobaan: 1,
      client_id: o.clientId ?? KLIEN_ANANDA,
      status: "menunggu_bayar",
      jumlah_item: 1,
      dibuat_pada: dibuat,
      kedaluwarsa_pada: new Date(
        Date.now() + (o.kedaluwarsaJam ?? 24) * 3_600_000,
      ).toISOString(),
      diperiksa_pada:
        o.diperiksaMenitLalu == null
          ? null
          : new Date(Date.now() - o.diperiksaMenitLalu * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: galatItem } = await admin.from("order_items").insert({
    pesanan_id: data!.id,
    jenis: "produk_digital",
    product_id: produkId,
    judul_beku: JUDUL,
    harga_beku: HARGA,
    urutan: 1,
  });
  if (galatItem) throw galatItem;
  idDisemai.push(data!.id as string);
  return data!.id as string;
}

function jawabanSukses(orderId: string, status: string) {
  return {
    ok: true as const,
    status: {
      order_id: orderId,
      status_code: "200",
      transaction_status: status,
      transaction_id: `trx-${orderId}`,
      gross_amount: `${HARGA}.00`,
      fraud_status: null,
      payment_type: "bank_transfer",
    },
  };
}

async function statusPesanan(id: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", id).single();
  return data!.status as string;
}

/**
 * Menghapus lewat KUNCI PRIMER yang sudah dipegang — tidak pernah lewat `kode`.
 *
 * Versi pertama rencana ini mencari barisnya dengan
 * `.like("kode", "PSN-260926-1B%")`, dan uji "bentuk_order_id" di bawah
 * mengganti `orders.kode` jadi `"bukan-kode-pesanan"` beberapa baris sebelum
 * pembersih itu jalan. Akibatnya bukan uji merah melainkan basis data yang
 * teracuni PERMANEN: barisnya `menunggu_bayar`, `pesanan_terbuka_satu_per_klien`
 * berlaku per KLIEN, dan sesudah berkas ini berjalan SEKALI setiap
 * `buat_pesanan` untuk klien itu gagal — di Tugas 8, 11, dan 12, dan di sesi
 * orang lain yang memakai Supabase lokal yang sama.
 *
 * Aturan umumnya §0.11 nomor 2: pembersih fixture tidak pernah mencari lewat
 * kolom yang bisa disunting ujinya sendiri.
 */
async function bersihkan() {
  // Entitlement DULU: `digital_entitlements.pesanan_id` menunjuk `orders`
  // dengan `on delete restrict` (migrasi 5 — kolomnya dipindah ke sana, lihat
  // §0.2), jadi pesanan tidak bisa dihapus selama entitlementnya masih ada.
  // `product_id` aman dipakai di sini: tidak ada satu pun uji yang menyuntingnya.
  await admin.from("digital_entitlements").delete().eq("product_id", produkId);

  const ids = idDisemai.splice(0);
  if (ids.length === 0) return;
  // Jejak & notifikasi SENGAJA tanpa FK (pola `jejak_status_bayar`), jadi
  // keduanya tidak ikut tersapu dan harus dihapus sendiri — lihat
  // tests/pesanan-jejak-yatim.test.ts.
  await admin.from("jejak_pesanan").delete().in("pesanan_id", ids);
  await admin.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
  await admin.from("order_items").delete().in("pesanan_id", ids);
  await admin.from("orders").delete().in("id", ids);
}

beforeAll(async () => {
  ref.sesi = await signInAs("ananda@padma.test");
  // Klien KETIGA yang dipakai berkas ini, dan satu-satunya yang menampung
  // baris ber-`kode` sengaja cacat. `siapkanKlienKedua()` MENYAPU sisa run
  // sebelumnya lebih dulu, dan sapuannya berkunci `client_id` — bukan `kode`
  // — sehingga baris cacat dari run yang mati di tengah jalan tetap terhapus.
  // Itulah pagar kedua di bawah `bersihkan()`: poin 1 memperbaiki sebabnya,
  // poin ini membuat kegagalannya tidak fatal (§0.11).
  await siapkanKlienKedua();

  // Sisa run SEBELUMNYA yang `kode`-nya masih utuh. Pembersih dalam-run
  // memakai kunci primer (lihat `bersihkan()`); sapuan berkunci awalan hanya
  // dipakai SEKALI di sini, untuk baris yatim yang id-nya sudah tidak dipegang
  // siapa pun. Baris yang `kode`-nya sudah dirusak tidak tertangkap di sini —
  // ia milik `KLIEN_KEDUA_ID`, dan `siapkanKlienKedua()` di atas yang
  // menyapunya.
  const { data: yatim } = await admin
    .from("orders").select("id").like("kode", `${AWALAN_KODE}%`);
  for (const b of yatim ?? []) idDisemai.push(b.id as string);

  await admin.from("digital_products").delete().eq("slug", SLUG);
  const { data, error } = await admin
    .from("digital_products")
    .insert({ judul: JUDUL, slug: SLUG, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkId = data!.id as string;
  await admin.from("digital_product_prices").insert({ product_id: produkId, harga: HARGA });
  await admin.from("digital_product_files").insert({
    product_id: produkId,
    objek: `${produkId}/isi.pdf`,
    mime: "application/pdf",
    byte: 1024,
  });
});

beforeEach(async () => {
  midtrans.panggilan.length = 0;
  midtrans.lempar = false;
  midtrans.jawaban = null;
  await bersihkan();
});

afterAll(async () => {
  await bersihkan();
  await admin.from("digital_products").delete().eq("id", produkId);
  // Membongkar klien kedua BESERTA akun auth-nya — fixture yang dibuat sendiri
  // dibongkar sendiri, dan urutannya sudah dikunci di helper itu.
  await bongkarKlienKedua();
});

// ---------------------------------------------------------------------------
// 1. Penyembuhan
// ---------------------------------------------------------------------------

describe("pesanan menggantung disembuhkan saat halaman dibuka", () => {
  it("settlement yang ditemukan Status API membuat pesanan lunas DAN menerbitkan akses", async () => {
    const kode = `${AWALAN_KODE}0001`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const hasil = await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    expect(hasil.diperiksa).toBe(1);
    expect(await statusPesanan(id)).toBe("lunas");

    const { data: hak } = await admin
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("product_id", produkId)
      .eq("client_id", KLIEN_ANANDA);
    expect((hak ?? []).length).toBe(1);
    expect(hak![0].sumber).toBe("beli");
    expect(hak![0].pesanan_id).toBe(id);
  });

  it("membuka /passport/produk menyembuhkan pesanan lalu menampilkan produknya", async () => {
    // Bukti bahwa kabelnya benar-benar terpasang di halaman, bukan hanya bahwa
    // fungsinya bisa dipanggil. Urutannya mengikat: pemeriksaan SEBELUM
    // produkSaya(), atau produk yang baru saja terbit tidak ikut terender.
    const kode = `${AWALAN_KODE}0002`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const markup = renderToStaticMarkup(await HalamanProdukSaya());

    expect(await statusPesanan(id)).toBe("lunas");
    expect(markup).toContain(JUDUL);
  });
});

// ---------------------------------------------------------------------------
// 2. Pagar laju — sekali per pesanan per lima menit
// ---------------------------------------------------------------------------

describe("pagar laju", () => {
  it("pesanan yang baru diperiksa satu menit lalu TIDAK ditanyakan lagi", async () => {
    const kode = `${AWALAN_KODE}0003`;
    await semaiPesanan({ kode, diperiksaMenitLalu: 1 });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const hasil = await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([]);
    expect(hasil.diperiksa).toBe(0);
  });

  it("pesanan yang baru lahir dua menit lalu TIDAK ditanyakan", async () => {
    // Menanyakan pesanan yang baru dibuat berarti menanyai Midtrans tentang
    // transaksi yang kliennya belum sempat bayar.
    const kode = `${AWALAN_KODE}0004`;
    await semaiPesanan({ kode, menitLalu: 2 });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([]);
  });

  it("jawaban yang TIDAK mengubah apa pun tetap mencap diperiksa_pada", async () => {
    // Kasus paling umum di produksi: Midtrans menjawab 404 sementara tenggang
    // satu jam belum lewat, jadi tidak ada yang bisa diputuskan. Tanpa cap,
    // PERSIS pesanan inilah yang ditanyakan ulang setiap kali halamannya
    // dibuka — banjir permintaan yang lahir dari kasus paling sering.
    const kode = `${AWALAN_KODE}0005`;
    const id = await semaiPesanan({ kode, kedaluwarsaJam: 5 });
    midtrans.jawaban = { ok: false as const, kode: 404, pesan: "Transaction doesn't exist" };

    await periksaPesananMenggantung();
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");

    await periksaPesananMenggantung();
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
  });
});

// ---------------------------------------------------------------------------
// 3. 404 dan tenggang satu jam
// ---------------------------------------------------------------------------

describe("404 Transaction doesn't exist", () => {
  it("TIDAK mengedaluwarsakan selama tenggang satu jam belum lewat", async () => {
    const kode = `${AWALAN_KODE}0006`;
    const id = await semaiPesanan({ kode, kedaluwarsaJam: 5 });
    midtrans.jawaban = { ok: false as const, kode: 404, pesan: "Transaction doesn't exist" };

    await periksaPesananMenggantung();

    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("mengedaluwarsakan sesudah kedaluwarsa_pada + satu jam lewat", async () => {
    // Yang memutuskan tetap Midtrans: ia menyatakan transaksinya tidak pernah
    // ada. Jam lokal hanya memutuskan kapan berhenti bertanya.
    const kode = `${AWALAN_KODE}0007`;
    const id = await semaiPesanan({ kode, kedaluwarsaJam: -2 });
    midtrans.jawaban = { ok: false as const, kode: 404, pesan: "Transaction doesn't exist" };

    await periksaPesananMenggantung();

    expect(await statusPesanan(id)).toBe("kedaluwarsa");
  });
});

// ---------------------------------------------------------------------------
// 4. Kegagalan disembunyikan
// ---------------------------------------------------------------------------

describe("kegagalan disembunyikan", () => {
  it("kode pesanan yang CACAT tidak melempar, dan tidak menghentikan sapuan", async () => {
    // `rakitOrderId` MELEMPAR untuk kode cacat — keputusan yang benar di
    // checkout, tapi fungsi ini seluruh nilainya adalah tidak pernah melempar,
    // dan Tugas 11 membangun peta kode HTTP-nya di atas janji itu. Baris cacat
    // bisa lahir dari fixture service role atau perbaikan SQL manual: keduanya
    // melewati CHECK karena `kode` memang tidak punya CHECK bentuk.
    //
    // ===== KENAPA `KLIEN_KEDUA_ID`, BUKAN ANANDA =====
    // Ini SATU-SATUNYA baris di seluruh P1-B yang namanya sengaja dirusak, dan
    // baris yang namanya dirusak adalah baris yang paling mungkin lolos dari
    // pembersih mana pun. Ia karena itu tidak pernah menyentuh klien yang
    // dipakai tiga tugas lain: kalau ia toh tertinggal,
    // `pesanan_terbuka_satu_per_klien` (unik per KLIEN) hanya mengunci klien
    // fixture yang dibongkar `bongkarKlienKedua()` di `afterAll` — bukan
    // Ananda, yang setiap `buat_pesanan`-nya di Tugas 8, 11, dan 12 akan gagal
    // selamanya. Lihat §0.11.
    //
    // SATU pesanan saja per klien: `pesanan_terbuka_satu_per_klien` adalah
    // indeks unik GLOBAL per klien. Yang diuji di sini memang
    // `terapkanJawabanMidtrans` langsung, bukan pemilihnya.
    const id = await semaiPesanan({ kode: `${AWALAN_KODE}0011`, clientId: KLIEN_KEDUA_ID });
    await admin.from("orders").update({ kode: "bukan-kode-pesanan" }).eq("id", id);

    const hasil = await terapkanJawabanMidtrans({
      id,
      kode: "bukan-kode-pesanan",
      percobaan: 1,
      kedaluwarsaPada: new Date(Date.now() + 3_600_000).toISOString(),
    });
    // TIDAK melempar, dan Midtrans tidak pernah ditanyakan: bentuk yang cacat
    // berhenti sebelum satu permintaan pun keluar.
    expect(hasil).toBe("bentuk_order_id");
    expect(midtrans.panggilan).toEqual([]);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("jawaban Status API TANPA gross_amount tidak menggeser apa pun", async () => {
    // Adapter memulangkan `{ok:false, kode:0}` untuk jawaban yang
    // `gross_amount`-nya hilang atau bukan angka, dan `kode: 0` BUKAN vonis.
    // Bila ia dipalsukan jadi "0", pesanan yang SUDAH DIBAYAR PENUH digeser ke
    // `ditahan` ber-`nominal_diterima = 0` — dan `putuskan_pesanan_ditahan`
    // meloloskannya karena 0 bukan null, sehingga staf memutuskan pembayaran
    // yang sebenarnya sempurna.
    const kode = `${AWALAN_KODE}0013`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = { ok: false as const, kode: 0, pesan: "tanpa gross_amount" };

    const hasil = await periksaPesananMenggantung();
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    // Ditanyakan, tapi tidak dihitung: dua kegagalan infrastruktur
    // (`midtrans_tak_terjawab`, `galat_basis_data`) sengaja tidak masuk angka
    // laporan, supaya penjadwal yang gagal tidak terbaca seperti penjadwal
    // yang bersih.
    expect(hasil.diperiksa).toBe(0);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");

    const { data: notif } = await admin
      .from("notifikasi_pesanan").select("id").eq("pesanan_id", id);
    expect(notif ?? []).toEqual([]);
  });

  it('kunci server yang belum terpasang BUKAN "Midtrans tak terjawab"', async () => {
    // Adapter sudah memisahkan keduanya di sumbernya, dan pemisahan itu tidak
    // punya satu pun uji sampai hari ini — cabang yang tidak bisa merah adalah
    // cabang yang belum terbukti ada.
    //
    // `kode: 0` berarti kita SUDAH bertanya dan tidak mendapat jawaban;
    // `kode: -1` berarti NOL permintaan pernah keluar karena
    // `MIDTRANS_SERVER_KEY` kosong. Satu nilai bedanya, dua tindakan manusia
    // yang berbeda: yang pertama sembuh dengan dicoba lagi, yang kedua tidak
    // akan pernah sembuh sampai seseorang memasang env. Dilebur jadi
    // `midtrans_tak_terjawab`, Tugas 11 menjawab 502 "Coba lagi beberapa saat
    // lagi." untuk keadaan yang tidak bisa berubah — dan staf mencoba lagi
    // selamanya alih-alih menghubungi orang yang memegang envnya.
    const kode = `${AWALAN_KODE}0014`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = {
      ok: false as const,
      kode: -1,
      pesan: "Kunci Midtrans belum dipasang.",
    };

    const hasil = await terapkanJawabanMidtrans({
      id,
      kode,
      percobaan: 1,
      kedaluwarsaPada: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(hasil).toBe("kunci_belum_terpasang");
    // `panggilan` memaku bahwa order_id-nya memang dirakit dan diajukan ke
    // adapter: nilai balik saja tidak menyatakan permintaan mana yang dibentuk
    // — atau apakah ada yang dibentuk sama sekali.
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("adapter yang melempar TIDAK melempar keluar, dan halaman tetap terender", async () => {
    const kode = `${AWALAN_KODE}0008`;
    const id = await semaiPesanan({ kode });
    midtrans.lempar = true;

    const hasil = await periksaPesananMenggantung();
    expect(hasil).toEqual({ diperiksa: 0 });
    expect(await statusPesanan(id)).toBe("menunggu_bayar");

    const markup = renderToStaticMarkup(await HalamanProdukSaya());
    expect(markup).toContain("Pembelian Saya");
  });
});

// ---------------------------------------------------------------------------
// 5. Radius: hanya pesanan pemanggil
// ---------------------------------------------------------------------------

describe("radius pemeriksaan", () => {
  it("SESI STAF tidak memicu pemeriksaan apa pun, walau RLS memulangkan semua baris", async () => {
    // Uji radius yang lain memakai sesi `ananda@padma.test` — satu-satunya
    // peran yang klaimnya BENAR, jadi ia tidak bisa merah untuk kasus ini.
    // `orders` punya DUA policy SELECT, dan `"pesanan: staf baca"`
    // memulangkan pesanan SELURUH klien: untuk sesi admin, RLS bukan pagar
    // sama sekali. `/produk/[slug]` halaman publik yang bisa dibuka staf mana
    // pun, dan efek mount TombolBeli memicunya tanpa syarat.
    //
    // Ongkosnya dua, dan yang kedua lebih halus: kuota Midtrans dipakai untuk
    // orang yang tidak memintanya, DAN `diperiksa_pada` mereka tercap,
    // sehingga penyapu Lapis 3 melewatinya selama lima menit berikutnya.
    //
    // Uji ini hanya memaku yang diklaimnya bila gerbangnya benar-benar
    // menggerbang: `periksaPesananMenggantung` membaca `clients` dengan
    // `.eq("user_id", user.id)`. Tanpa klausa itu ia tetap HIJAU hari ini —
    // bukan karena gerbangnya bekerja, melainkan karena `admin@padma.test`
    // kebetulan tidak punya baris `clients` di seed. Satu baris klien untuk
    // akun staf, kapan pun kelak ditambahkan, langsung membalik kelulusan itu
    // menjadi kebocoran senyap.
    const kode = `${AWALAN_KODE}0010`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const sesiSemula = ref.sesi;
    ref.sesi = await signInAs("admin@padma.test");
    try {
      const hasil = await periksaPesananMenggantung();
      expect(midtrans.panggilan).toEqual([]);
      expect(hasil).toEqual({ diperiksa: 0 });
      expect(await statusPesanan(id)).toBe("menunggu_bayar");

      // Dan capnya TIDAK ikut tertulis — inilah bagian yang memperdaya
      // penyapu Lapis 3 bila gerbangnya hilang.
      const { data } = await admin
        .from("orders").select("diperiksa_pada").eq("id", id).single();
      expect(data!.diperiksa_pada).toBeNull();
    } finally {
      ref.sesi = sesiSemula;
    }
  });

  it("pesanan milik klien LAIN tidak pernah ditanyakan", async () => {
    // Bila pemilihan barisnya memakai service role, membuka satu halaman
    // menembakkan permintaan Midtrans atas pesanan orang lain — dan mencapnya
    // sudah diperiksa padahal pemiliknya tidak pernah melihat layar itu.
    const kode = `${AWALAN_KODE}0009`;
    const id = await semaiPesanan({ kode, clientId: KLIEN_RINA });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const hasil = await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([]);
    expect(hasil.diperiksa).toBe(0);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });
});

// ---------------------------------------------------------------------------
// 6. Pemicu sisi peramban
// ---------------------------------------------------------------------------

describe("picuPeriksaSekali", () => {
  it("menyegarkan HANYA bila ada yang benar-benar diperiksa", async () => {
    let disegarkan = 0;
    const n = await picuPeriksaSekali(async () => ({ diperiksa: 2 }), () => {
      disegarkan += 1;
    });
    expect(n).toBe(2);
    expect(disegarkan).toBe(1);
  });

  it("TIDAK menyegarkan ketika tidak ada yang diperiksa", async () => {
    // Refresh tanpa sebab adalah satu perjalanan server penuh per pembukaan
    // halaman, pada halaman etalase yang justru dirancang supaya murah.
    let disegarkan = 0;
    const n = await picuPeriksaSekali(async () => ({ diperiksa: 0 }), () => {
      disegarkan += 1;
    });
    expect(n).toBe(0);
    expect(disegarkan).toBe(0);
  });

  it("server action yang melempar tidak merusak halaman", async () => {
    let disegarkan = 0;
    const n = await picuPeriksaSekali(
      async () => {
        throw new Error("jaringan putus");
      },
      () => {
        disegarkan += 1;
      },
    );
    expect(n).toBe(0);
    expect(disegarkan).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Kabel di halaman publik — PELENGKAP, bukan pagarnya
// ---------------------------------------------------------------------------

describe("kabel Lapis 1b di /produk/[slug]", () => {
  it("TombolBeli memicu pemeriksaan lewat picuPeriksaSekali", () => {
    // Pemindaian teks sumber, dan ia memang lemah: repo ini sudah beberapa kali
    // tertipu uji yang puas oleh baris impor. Karena itu ia DIPASANGKAN dengan
    // tiga uji `picuPeriksaSekali` di atas (perilakunya) dan uji
    // "/passport/produk menyembuhkan lalu menampilkan" (kabel halaman kedua
    // yang benar-benar dirender). Yang dijaga di sini hanya satu hal yang
    // memang mustahil dirender: efek mount komponen klien — `renderToStaticMarkup`
    // tidak menjalankan useEffect, dan repo ini tidak punya jsdom.
    const sumber = baca("src/app/produk/[slug]/tombol-beli.tsx");
    expect(sumber).toMatch(/useEffect\(/);
    expect(sumber).toContain("picuPeriksaSekali(");
    expect(sumber).toContain("periksaPesananSaya");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-periksa-dibuka.test.ts
```

Kegagalan yang diharapkan: `Error: Failed to load url /Users/.../src/lib/pesanan/periksa-menggantung.ts`
— seluruh berkas merah karena modulnya belum ada. Itu memang merah yang benar untuk Step 2;
merah yang bermakna baru muncul di Step 8, sesudah modulnya lahir tetapi sebelum halamannya
dikabeli.

**Catatan menjalankan uji:** Supabase lokal dipakai bersama sesi lain. Jalankan BERKAS TUNGGAL
seperti di atas selama mengerjakan; `npm test` penuh hanya dijalankan sesudah berkoordinasi.

- [ ] **Step 3: Tulis mesin pemeriksanya**

Buat `/Users/arvinfairuz/Documents/padma/web/src/lib/pesanan/periksa-menggantung.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { bacaStatusTransaksi } from "@/lib/midtrans/adapter";
import { hitungSidik } from "@/lib/midtrans/tanda-tangan";
import { MENIT_JEDA_PERIKSA, JAM_TENGGANG_404, PESANAN_TERBUKA } from "./status";
import { rakitOrderId } from "./order-id";

/**
 * LAPIS 1b — PEMERIKSAAN SAAT HALAMAN DIBUKA (spec "Rekonsiliasi — empat lapis").
 *
 * Jaring pengaman UTAMA P1. Bukan cron — cron (Lapis 3) hanya menyapu pesanan
 * milik orang yang tidak pernah kembali membuka halamannya.
 *
 * Jalur penerapannya SATU untuk tiga pemanggil: halaman klien (di sini),
 * tombol "Periksa ulang" staf (`/api/pesanan/[id]/periksa-ulang`), dan penyapu
 * terjadwal (`/api/cron/pesanan`). Tiga jalur berbeda untuk satu keputusan
 * adalah tiga peluang untuk berbeda — dan yang berbeda di sini adalah vonis
 * atas uang orang.
 */

/**
 * Berapa pesanan yang boleh ditanyakan dalam SATU pembukaan halaman.
 *
 * Tiga, bukan "semua": satu klien hanya boleh punya satu pesanan terbuka
 * (`pesanan_terbuka_satu_per_klien`), jadi tiga sudah longgar — dan batas ini
 * yang menahan biaya bila kelak P2 melonggarkan indeks itu.
 */
export const BATAS_PERIKSA_SEKALI = 3;

export type PesananDiperiksa = {
  id: string;
  kode: string;
  percobaan: number;
  /** ISO. Dipakai memutuskan kapan 404 Midtrans boleh dibaca sebagai kedaluwarsa. */
  kedaluwarsaPada: string;
};

/**
 * Empat nilai pertama datang APA ADANYA dari `terapkan_notifikasi_midtrans`;
 * lima sisanya lahir di sini karena RPC-nya tidak pernah dipanggil untuk kasus
 * itu. Dibedakan supaya pemanggil (rute staf) bisa mengatakan "Midtrans tidak
 * menjawab" alih-alih "tidak ada yang berubah" — dua kalimat yang menuntut dua
 * tindakan berbeda dari manusia yang menekan tombolnya.
 *
 * Union, bukan komentar: `Record<HasilPeriksaPesanan, string>` di Tugas 11
 * memerah di kompilator sampai setiap nilai punya kalimatnya. Inilah
 * satu-satunya mekanisme di repo ini yang mengubah "lupa menangani satu kasus"
 * dari kalimat salah di layar staf menjadi galat kompilasi.
 */
export type HasilPeriksaPesanan =
  | "diterapkan"
  | "duplikat"
  | "tanpa_efek"
  | "pesanan_tidak_ada"
  // `orders.kode` / `percobaan` yang cacat: `rakitOrderId` MELEMPAR untuk
  // keduanya, dan fungsi ini tidak boleh melempar. Lihat dokblok di bawah.
  | "bentuk_order_id"
  | "belum_kedaluwarsa"
  | "midtrans_tak_terjawab"
  // TERPISAH dari `midtrans_tak_terjawab`, dan pemisahan itu seluruh gunanya:
  // jaringan yang mati sembuh dengan dicoba lagi, `MIDTRANS_SERVER_KEY` yang
  // belum terpasang TIDAK PERNAH. Dilebur, staf membaca "Coba lagi beberapa
  // saat lagi." untuk keadaan yang tidak akan berubah sampai seseorang
  // memasang env — dan mencoba lagi selamanya. Adapter sudah memisahkannya di
  // sumbernya (`kode: -1`), dan dua permukaan Tugas 8 yang lain sudah lama
  // mengatakan kalimat yang benar (webhook 503 `kunci_kosong`,
  // `terbitkanTokenSnap` "Pembayaran belum aktif. Hubungi tim PADMA.").
  | "kunci_belum_terpasang"
  | "galat_basis_data";

type BarisMenggantung = {
  id: string;
  kode: string;
  percobaan: number;
  kedaluwarsa_pada: string;
};

/**
 * Menanyakan Status API untuk SATU pesanan lalu menjalankan jawabannya lewat
 * jalur yang sama dengan webhook.
 *
 * Tidak pernah melempar: setiap kegagalan menjadi salah satu nilai
 * `HasilPeriksaPesanan`. Pemanggilnya adalah halaman yang sedang dibuka orang.
 */
export async function terapkanJawabanMidtrans(
  p: PesananDiperiksa,
): Promise<HasilPeriksaPesanan> {
  // `rakitOrderId` MELEMPAR untuk `kode` cacat atau `percobaan` di luar 1..9 —
  // keputusan yang benar untuk checkout (kegagalan yang dilempar di sana
  // berhenti di checkout; yang diloloskan berhenti di uang), tapi fungsi INI
  // seluruh nilainya adalah tidak pernah melempar, dan Tugas 11 membangun peta
  // kode HTTP-nya di atas janji itu. Karena itu ia berada DI DALAM try.
  //
  // Bentuk kegagalannya bila ia di luar: satu baris `orders` ber-`kode` cacat
  // (fixture service role, atau perbaikan SQL manual) membuat
  // `/api/pesanan/[id]/periksa-ulang` menjawab 500 telanjang alih-alih
  // `{hasil}` yang dikontrakkan — dan lebih mahal di Lapis 3, di mana satu
  // baris cacat menghentikan SELURUH sapuan sementara
  // `periksaPesananMenggantung` menelan lemparannya jadi `{diperiksa: 0}`:
  // penyapu yang MATI terbaca sebagai penyapu yang tidak menemukan apa-apa.
  let orderId: string;
  try {
    orderId = rakitOrderId(p.kode, p.percobaan);
  } catch {
    console.error(`[pesanan] bentuk kode/percobaan cacat pada pesanan ${p.id}`);
    return "bentuk_order_id";
  }

  let jawaban: Awaited<ReturnType<typeof bacaStatusTransaksi>>;
  try {
    jawaban = await bacaStatusTransaksi(orderId);
  } catch {
    return "midtrans_tak_terjawab";
  }

  if (!jawaban.ok) {
    // `-1` DULU, sebelum saringan 404: kunci server yang belum terpasang berarti
    // NOL permintaan pernah keluar, jadi ini bukan "Midtrans tidak menjawab"
    // melainkan "kita tidak pernah bertanya". Kalimatnya di Tugas 11 menyuruh
    // menghubungi tim, bukan mencoba lagi — dan itulah satu-satunya tindakan
    // yang bisa mengubah keadaannya.
    if (jawaban.kode === -1) return "kunci_belum_terpasang";
    // 404 "Transaction doesn't exist" adalah SATU-SATUNYA kegagalan yang boleh
    // dibaca sebagai vonis; sisanya (5xx, timeout) berarti kita belum tahu
    // apa-apa.
    if (jawaban.kode !== 404) return "midtrans_tak_terjawab";

    const tenggang = Date.parse(p.kedaluwarsaPada) + JAM_TENGGANG_404 * 3_600_000;
    // Satu jam itu MARGIN terhadap jam Midtrans, bukan perpanjangan tenggat:
    // menutup pesanan lebih cepat daripada Midtrans berarti settlement mendarat
    // pada pesanan yang sudah kita tutup. `Number.isFinite` menjaga cap waktu
    // yang tidak bisa diurai — kalau tidak, `NaN` membuat perbandingannya
    // false dan pesanan itu tak pernah bisa kedaluwarsa.
    if (!Number.isFinite(tenggang) || Date.now() < tenggang) return "belum_kedaluwarsa";

    return kirimKeMesin({
      orderId,
      transactionStatus: "expire",
      fraudStatus: "",
      transactionId: "",
      paymentType: "",
      // `null`, BUKAN 0. Tugas 3 menulis kolomnya nullable JUSTRU supaya
      // "tidak tahu" bukan "nol rupiah", dan Tugas 11 mengulanginya di tipe
      // (`null = belum ada notifikasi bernominal. BUKAN nol.`). Mengirim 0 di
      // sini melahirkan baris `notifikasi_pesanan` ber-`nominal_diterima =
      // 0.00` untuk SETIAP pesanan kedaluwarsa, dan /admin/pesanan menampilkan
      // "diterima Rp 0" bersebelahan dengan "ditagih Rp 150.000" untuk pesanan
      // yang tidak pernah dibayar siapa pun — selisih palsu di kolom yang
      // seluruh keberadaannya dibenarkan sebagai "angka yang jadi keputusan
      // manusia".
      //
      // Aman terhadap Tugas 5: verifikasi jumlah hanya berjalan bila vonisnya
      // `lunas`, dan vonis cabang 404 selalu `kedaluwarsa`.
      grossAmount: null,
      sidik: hitungSidik({
        orderId,
        statusCode: "404",
        transactionStatus: "expire",
        fraudStatus: "",
        transactionId: "",
      }),
    });
  }

  const s = jawaban.status;
  return kirimKeMesin({
    orderId,
    transactionStatus: s.transaction_status,
    fraudStatus: s.fraud_status ?? "",
    transactionId: s.transaction_id,
    paymentType: s.payment_type ?? "",
    // STRING apa adanya. Adapter sudah menjamin bentuknya angka (jawaban tanpa
    // `gross_amount` yang bisa dibaca dipulangkan sebagai `{ok:false, kode:0}`),
    // jadi tidak ada yang perlu di-parse di sini — dan tidak ada yang boleh.
    grossAmount: s.gross_amount,
    sidik: hitungSidik({
      orderId,
      statusCode: s.status_code,
      transactionStatus: s.transaction_status,
      fraudStatus: s.fraud_status ?? "",
      transactionId: s.transaction_id,
    }),
  });
}

/**
 * Nilai balik SAH `terapkan_notifikasi_midtrans`, sebagai himpunan tertutup.
 *
 * Kembaran `hasilRpcSah` di `src/lib/midtrans/kode-jawaban.ts` (Tugas 8), dan
 * itu disengaja: rute webhook dan berkas ini memanggil RPC yang SAMA, jadi
 * keduanya harus punya sikap kepercayaan yang sama terhadap nilainya. Tanpa
 * penjaga di sini, `data as HasilPeriksaPesanan` membuat nilai kelima yang
 * kelak lahir masuk diam-diam sebagai tipe yang salah — rute Tugas 8 berhenti
 * aman, sementara jalur ini menyalurkan string asing ke `Record<...>` dan
 * memulangkan `undefined` sebagai kalimat ke layar staf.
 *
 * TIDAK mengimpor `hasilRpcSah`: `kode-jawaban.ts` hidup di sisi server-only
 * rute webhook bersama tipe `HasilWebhook` yang memuat nilai-nilai yang tidak
 * berarti apa-apa di sini (`badan_terlalu_besar`, `tanda_tangan_salah`).
 * Menariknya ke jalur ini menukar satu cacat dengan cacat lain.
 */
const SAH = new Set(["diterapkan", "duplikat", "tanpa_efek", "pesanan_tidak_ada"]);

/**
 * SERVICE ROLE, dan itu disengaja: `terapkan_notifikasi_midtrans` ada di
 * `MESIN_TERTUTUP` (tests/fungsi-mesin-tertutup.test.ts) — tertutup bagi
 * `authenticated` justru supaya vonis Midtrans tidak pernah bisa diketik
 * pemanggil bersesi.
 */
async function kirimKeMesin(a: {
  orderId: string;
  transactionStatus: string;
  fraudStatus: string;
  transactionId: string;
  paymentType: string;
  /** STRING seperti dikirim Midtrans, atau `null` untuk "tidak tahu berapa". */
  grossAmount: string | null;
  sidik: string;
}): Promise<HasilPeriksaPesanan> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("terapkan_notifikasi_midtrans", {
    p_order_id: a.orderId,
    p_transaction_status: a.transactionStatus,
    p_fraud_status: a.fraudStatus,
    p_transaction_id: a.transactionId,
    p_payment_type: a.paymentType,
    // STRING apa adanya, atau null — bentuk yang SAMA dengan yang dikirim
    // rute webhook (Tugas 8). Satu parameter `numeric` dengan dua bentuk
    // kiriman berarti dua jalur cast yang tidak pernah diuji bersama, jadi
    // salah satunya tidak terjaga; dan mengubahnya jadi `number` di TypeScript
    // berarti pembulatan JavaScript ikut menentukan verifikasi jumlah. Yang
    // meng-cast adalah basis data, satu kali, ke tipe kolom yang sudah
    // memutuskan presisinya.
    p_gross_amount: a.grossAmount,
    p_sidik: a.sidik,
    // Sumbernya DINYATAKAN: itulah yang melahirkan jejak `diperiksa_ulang` dan
    // membedakannya dari notifikasi webhook di layar staf.
    p_sumber: "status_api",
  });
  if (error) return "galat_basis_data";
  if (data == null) return "tanpa_efek";
  // Nilai di LUAR himpunan bukan "tanpa efek" dan bukan hasil yang bisa
  // dipetakan — ia berarti mesinnya sudah berubah dan jalur ini belum.
  // `galat_basis_data` karena itu jawaban yang jujur: ia memaksa 500 di rute
  // staf dan TIDAK menaikkan penghitung sapuan, alih-alih memalsukan "sudah
  // diperiksa" untuk nilai yang tidak seorang pun di sini mengerti.
  if (!SAH.has(data as string)) {
    console.error(`[pesanan] nilai balik terapkan_notifikasi_midtrans tak dikenal: ${data}`);
    return "galat_basis_data";
  }
  return data as HasilPeriksaPesanan;
}

/**
 * Memilih pesanan terbuka yang layak ditanyakan, mencapnya, lalu menerapkannya.
 *
 * `pemilih` menentukan RADIUS-nya, dan itu satu-satunya perbedaan antara dua
 * pemanggilnya: Lapis 1b mengoper sesi pemanggil (policy "pesanan: klien baca
 * miliknya" yang memutuskan, jadi hanya pesanan sendiri), Lapis 3 mengoper
 * service role (lintas klien). Satu kueri, dua radius, nol duplikasi predikat.
 *
 * MELEMPAR bila pemilihannya gagal — pemanggil yang harus bertahan hidup
 * (`periksaPesananMenggantung`) menangkapnya sendiri, pemanggil yang harus
 * melapor (rute cron) menerjemahkannya jadi 500.
 */
export async function sapuPesananMenggantung(
  pemilih: SupabaseClient,
  batasBaris: number,
  clientId: string | null = null,
): Promise<{ diperiksa: number }> {
  const batas = new Date(Date.now() - MENIT_JEDA_PERIKSA * 60_000).toISOString();

  let kueri = pemilih
    .from("orders")
    .select("id, kode, percobaan, kedaluwarsa_pada")
    // `PESANAN_TERBUKA`, bukan literal "menunggu_bayar" (Tugas 1). Nilai enum
    // keenam yang kelak lahir dan diklasifikasikan sebagai terbuka ikut
    // tersapu tanpa satu baris pun disunting di sini; dengan literal, ia
    // menghilang dari penyapu tanpa ada yang tahu.
    .in("status", [...PESANAN_TERBUKA])
    // Baru lahir = kliennya belum sempat membayar. Menanyakannya berarti
    // menembak Midtrans untuk transaksi yang pasti belum berubah.
    .lt("dibuat_pada", batas)
    .or(`diperiksa_pada.is.null,diperiksa_pada.lt.${batas}`)
    .order("diperiksa_pada", { ascending: true, nullsFirst: true })
    .limit(batasBaris);

  // RADIUS. Lapis 1b mengisinya; Lapis 3 (cron, service role, lintas klien)
  // membiarkannya null. Kenapa ia tidak boleh diserahkan kepada RLS saja:
  // `orders` punya DUA policy SELECT, dan `"pesanan: staf baca"` memulangkan
  // pesanan SELURUH klien untuk sesi admin/owner. Lihat dokblok
  // `periksaPesananMenggantung` di bawah.
  if (clientId !== null) kueri = kueri.eq("client_id", clientId);

  const { data, error } = await kueri.returns<BarisMenggantung[]>();
  if (error) throw error;
  if (!data || data.length === 0) return { diperiksa: 0 };

  // ===== CAP DULU, BARU BERTANYA =====
  // `terapkan_notifikasi_midtrans` juga menyetel `diperiksa_pada`, tapi ia
  // hanya berjalan untuk jawaban yang benar-benar diterapkan. Dua jawaban
  // paling sering — 404 sebelum tenggang lewat, dan Midtrans tak terjawab —
  // tidak pernah sampai ke sana, jadi tanpa cap di sini PERSIS pesanan itulah
  // yang ditanyakan ulang setiap kali halamannya dibuka. Mencap lebih dulu
  // juga membuat pagar lajunya bertahan terhadap proses yang mati di tengah
  // jalan: yang dicatat adalah "kita sudah BERTANYA", bukan "jawabannya kena".
  //
  // UPDATE ini memakai service role dan menyentuh `orders` dari TypeScript —
  // satu-satunya di seluruh P1. Ia sempit dengan sengaja: satu kolom yang
  // bukan status dan bukan uang, dan `where`-nya tetap membawa pagar status
  // supaya baris yang sudah bergerak di antara SELECT dan UPDATE tidak ikut
  // tersentuh.
  //
  // Pagarnya `PESANAN_TERBUKA`, bukan literal "menunggu_bayar" — himpunan yang
  // SAMA dengan yang dipakai pemilih di atas. Dua predikat yang harus selalu
  // sepakat tidak boleh ditulis dua cara: nilai enum keenam yang kelak
  // diklasifikasikan terbuka akan ikut terpilih tapi TIDAK ikut tercap, dan
  // pesanan yang tidak pernah tercap adalah pesanan yang ditanyakan ulang ke
  // Midtrans setiap kali halamannya dibuka.
  const admin = createAdminSupabase();
  const { error: galatCap } = await admin
    .from("orders")
    .update({ diperiksa_pada: new Date().toISOString() })
    .in(
      "id",
      data.map((b) => b.id),
    )
    .in("status", [...PESANAN_TERBUKA]);
  // Gagal mencap -> BERHENTI, jangan bertanya. Bertanya tanpa cap adalah
  // bentuk banjir yang paling mudah lolos review.
  if (galatCap) throw galatCap;

  let diperiksa = 0;
  for (const b of data) {
    // TRY PER BARIS. `terapkanJawabanMidtrans` sudah dikontrakkan tidak pernah
    // melempar, tapi kontrak yang dijaga di satu tempat saja adalah kontrak
    // yang patah diam-diam: satu baris cacat di tengah sapuan Lapis 3 akan
    // menghentikan SELURUH sisanya, dan `periksaPesananMenggantung` menelan
    // lemparannya jadi `{diperiksa: 0}` — penyapu yang mati terbaca sebagai
    // penyapu yang tidak menemukan apa-apa.
    let hasil: HasilPeriksaPesanan;
    try {
      hasil = await terapkanJawabanMidtrans({
        id: b.id,
        kode: b.kode,
        percobaan: b.percobaan,
        kedaluwarsaPada: b.kedaluwarsa_pada,
      });
    } catch {
      console.error(`[pesanan] pemeriksaan baris ${b.id} melempar; sapuan diteruskan.`);
      continue;
    }
    // "Diperiksa" berarti jawabannya SAMPAI, apa pun isinya. Yang tidak
    // dihitung hanyalah KETIGA kegagalan infrastruktur — kalau ikut dihitung,
    // angka yang dilaporkan penjadwal tidak bisa dibedakan dari penjadwal yang
    // jalan sempurna. `kunci_belum_terpasang` yang paling mahal bila lolos:
    // server tanpa kunci akan melaporkan "diperiksa: 20" tiap lima belas menit
    // tanpa satu permintaan pun pernah keluar.
    if (
      hasil !== "midtrans_tak_terjawab" &&
      hasil !== "kunci_belum_terpasang" &&
      hasil !== "galat_basis_data"
    ) {
      diperiksa += 1;
    }
  }
  return { diperiksa };
}

/**
 * Lapis 1b untuk halaman yang sedang dibuka klien. TIDAK PERNAH MELEMPAR.
 *
 * Doktrin rumah adalah kebalikannya — galat dibaca, tidak dibuang (lihat
 * `src/lib/admin/tagihan-pengajuan.ts:103-123`) — dan penyimpangan di sini
 * disebut terang: pemanggilnya bukan gerbang melainkan LATAR. Pemeriksaan yang
 * gagal tidak boleh membuat orang melihat layar galat saat yang ia cari
 * hanyalah produknya, dan tidak ada satu pun keputusan yang bergantung pada
 * nilai kembaliannya. Pemanggil yang memang gerbang — rute cron — memakai
 * `sapuPesananMenggantung` langsung dan melaporkan kegagalannya.
 */
export async function periksaPesananMenggantung(): Promise<{ diperiksa: number }> {
  try {
    const sesi = await createServerSupabase();

    // ===== RADIUS: DIGERBANGI DI SINI, BUKAN DISERAHKAN KE RLS =====
    // Dokblok versi pertama berbunyi "pemanggil anon memperoleh nol baris,
    // jadi tidak ada apa pun yang bisa dipicu atas nama orang lain" — dan itu
    // benar HANYA untuk anon. `orders` punya DUA policy SELECT (Tugas 2), dan
    // yang kedua, `"pesanan: staf baca"` ber-`user_role() in ('admin','owner')`,
    // memulangkan pesanan SELURUH klien.
    //
    // `/produk/[slug]` adalah halaman PUBLIK yang bisa dibuka staf mana pun,
    // dan efek mount `TombolBeli` memicu ini tanpa syarat. Tanpa gerbang di
    // bawah: admin yang cuma memeriksa tampilan etalase menembakkan tiga
    // permintaan Status API atas pesanan tiga klien acak — dan mencap
    // `diperiksa_pada` mereka, sehingga `orders_sapuan_idx` yang mengurutkan
    // penyapu Lapis 3 `nulls first` jadi diperdaya: pesanan yang "baru
    // diperiksa" oleh orang yang cuma lewat dilewati penyapu selama lima
    // menit berikutnya.
    //
    // Gerbangnya `.eq("user_id", user.id)`, dan klausa itu BUKAN hiasan.
    // `clients` punya policy baca staf juga, jadi tanpa klausa itu sesi
    // admin/owner memungut baris `clients` siapa saja yang kebetulan pertama
    // dipulangkan — `maybeSingle()` bahkan melempar untuk lebih dari satu
    // baris, jadi gerbangnya "berhasil" hanya selama seed kebetulan punya satu
    // klien. Polanya `ambilKlien` (`src/lib/passport/data.ts:66`), dan alasan
    // yang ditulis di sana sama: operator setara atas `user_id`, tidak pernah
    // pola.
    const {
      data: { user },
    } = await sesi.auth.getUser();
    if (!user) return { diperiksa: 0 };

    const { data: klien } = await sesi
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();
    // Nol baris klien = pemanggilnya anon, staf, atau akun yang belum tertaut.
    // Tidak ada pesanan MILIKNYA untuk diperiksa, dan tidak ada apa pun yang
    // boleh dipicu atas nama orang lain.
    if (!klien) return { diperiksa: 0 };

    return await sapuPesananMenggantung(sesi, BATAS_PERIKSA_SEKALI, klien.id);
  } catch {
    return { diperiksa: 0 };
  }
}
```

- [ ] **Step 4: Tulis pemicu sisi peramban**

Buat `/Users/arvinfairuz/Documents/padma/web/src/lib/pesanan/picu-periksa.ts`:

```ts
/**
 * Pemicu Lapis 1b di sisi PERAMBAN.
 *
 * ===== KENAPA MODUL TERSENDIRI, BUKAN BADAN useEffect =====
 * `renderToStaticMarkup` tidak menjalankan efek, dan repo ini tidak punya jsdom
 * maupun testing-library — jadi logika yang tinggal di dalam `useEffect` hanya
 * bisa "diuji" dengan memindai teks sumbernya, dan uji semacam itu sudah
 * beberapa kali menipu repo ini. Dipisahkan begini, keputusannya jadi fungsi
 * biasa yang bisa dijalankan sungguhan.
 *
 * TANPA `server-only`: ia diimpor komponen `"use client"`.
 */

/**
 * Memanggil pemeriksaan satu kali, lalu menyegarkan HANYA bila ada yang
 * benar-benar berubah.
 *
 * Dua sifatnya yang mudah hilang saat disederhanakan:
 *
 *  • `segarkan()` bersyarat. Menyegarkan tanpa sebab berarti satu perjalanan
 *    server penuh setiap kali halaman etalase dibuka — halaman yang justru
 *    dirancang murah (`export const revalidate = 300`).
 *  • Galat ditelan. Server action yang gagal (jaringan klien putus, deploy
 *    berjalan) tidak boleh melahirkan unhandled rejection di konsol pengunjung
 *    yang cuma sedang melihat-lihat produk.
 */
export async function picuPeriksaSekali(
  periksa: () => Promise<{ diperiksa: number }>,
  segarkan: () => void,
): Promise<number> {
  let hasil: { diperiksa: number } | undefined;
  try {
    hasil = await periksa();
  } catch {
    return 0;
  }
  const jumlah = Number(hasil?.diperiksa ?? 0);
  if (!Number.isFinite(jumlah) || jumlah <= 0) return 0;
  segarkan();
  return jumlah;
}
```

- [ ] **Step 5: Tulis server action untuk halaman publik**

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/periksa.ts`:

```ts
"use server";

import { periksaPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";

/**
 * Lapis 1b untuk `/produk/[slug]`, dipicu dari PERAMBAN.
 *
 * ===== KENAPA SERVER ACTION, BUKAN PANGGILAN DI SERVER COMPONENT =====
 * `/produk/[slug]` punya `export const revalidate = 300` dan dibaca anon.
 * Memanggil pemeriksaan ini di dalam render berarti membaca cookie di server
 * component, dan itu membuat SELURUH etalase dynamic demi satu tombol —
 * pengunjung anon membayar ongkosnya tanpa pernah punya pesanan. Alasan yang
 * sama sudah dipakai `punyaProdukDiPeramban` di `tombol-ambil.tsx`.
 *
 * ===== KENAPA TANPA requireRole, DAN KENAPA RLS SAJA TIDAK CUKUP =====
 * Yang dituntut hanyalah "pemanggilnya seorang klien", dan itu diputuskan di
 * dalam `periksaPesananMenggantung()`: ia membaca baris `clients` pemanggil
 * dengan sesi pemanggil, dan tanpa baris itu ia memulangkan `{diperiksa: 0}`
 * tanpa menyentuh apa pun.
 *
 * Kalimat "RLS yang menjaga radiusnya" BENAR untuk anon dan SALAH untuk staf:
 * `orders` punya DUA policy SELECT, dan `"pesanan: staf baca"` memulangkan
 * pesanan SELURUH klien. Halaman ini publik dan bisa dibuka admin mana pun,
 * jadi tanpa gerbang itu satu admin yang memeriksa tampilan etalase
 * menembakkan permintaan Status API atas pesanan orang lain — dan mencap
 * `diperiksa_pada` mereka, memperdaya penyapu Lapis 3.
 *
 * Yang tetap berlaku: pemeriksaan yang hanya hidup di server action bisa
 * dilewati dengan satu panggilan langsung ke PostgREST, jadi gerbangnya tidak
 * ditaruh DI SINI melainkan di fungsi yang dipanggil — satu tempat untuk dua
 * pemanggil (halaman ini dan `/passport/produk`).
 */
export async function periksaPesananSaya(): Promise<{ diperiksa: number }> {
  return periksaPesananMenggantung();
}
```

- [ ] **Step 6: Kabeli `/passport/produk`**

Sunting `/Users/arvinfairuz/Documents/padma/web/src/app/passport/produk/page.tsx`.

Tambahkan impor sesudah baris 3 (`import { ambilKlien } ...`):

```ts
import { periksaPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";
```

Lalu sisipkan panggilannya di dalam `HalamanProdukSaya`, **di antara** penjaga `if (!klien)`
dan `const produk = await produkSaya(...)`, sehingga badan fungsinya berbunyi:

```ts
  const klien = await ambilKlien();
  if (!klien) return null; // layout sudah menangani; ini penjaga tipe

  // LAPIS 1b (spec "Rekonsiliasi"). Urutannya MENGIKAT: pemeriksaan lebih dulu,
  // baru pembacaan. Dibalik, akses yang baru saja terbit dalam permintaan yang
  // sama tidak ikut terbaca — dan yang dilihat pembeli adalah halaman kosong
  // tepat sesudah pembayarannya berhasil, yaitu kebohongan yang paling mahal.
  //
  // Halaman ini memang sudah dynamic (ada sesi, `ambilKlien()` membaca cookie),
  // jadi tidak ada ongkos cache yang hilang — berbeda dengan `/produk/[slug]`
  // yang karena itu dipicu dari peramban.
  await periksaPesananMenggantung();

  const produk = await produkSaya(klien.id);
```

- [ ] **Step 7: Kabeli `/produk/[slug]` lewat `TombolBeli`**

Sunting `/Users/arvinfairuz/Documents/padma/web/src/app/produk/[slug]/tombol-beli.tsx`
(berkas milik Task 9). Tiga perubahan, tidak lebih:

1. Pastikan `useEffect` ikut diimpor dari `react` (Task 9 sudah mengimpor `useState`/
   `useTransition` dari sana; tambahkan `useEffect` ke daftar yang sama).
2. Tambahkan dua impor di dekat impor lain:

```ts
import { picuPeriksaSekali } from "@/lib/pesanan/picu-periksa";
import { periksaPesananSaya } from "./periksa";
```

3. Di dalam `export function TombolBeli({ ... })`, sebagai hook PERTAMA sesudah deklarasi
   `const router = useRouter();`, sisipkan:

```tsx
  // LAPIS 1b DI HALAMAN PUBLIK (spec "Rekonsiliasi").
  //
  // Dipicu dari peramban, bukan dari render, karena halaman ini
  // `export const revalidate = 300` dan dibaca anon — membaca cookie di server
  // component akan membuat seluruh etalase dynamic demi satu tombol.
  //
  // Sekali per mount. Pagar lima menit yang sesungguhnya hidup di basis data
  // (`orders.diperiksa_pada`), bukan di sini: apa pun yang dipasang di peramban
  // bisa dilewati dengan satu tab baru.
  useEffect(() => {
    void picuPeriksaSekali(periksaPesananSaya, () => router.refresh());
  }, [router]);
```

Bila Task 9 belum mendeklarasikan `router` di komponen itu, tambahkan
`const router = useRouter();` beserta `import { useRouter } from "next/navigation";`
— pola yang sama dipakai `TombolAmbil` di `tombol-ambil.tsx:153`.

- [ ] **Step 8: Jalankan uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-periksa-dibuka.test.ts
```

Lalu pastikan tetangganya tidak ikut tergeser:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/produk-ambil-gratis.test.ts tests/produk-tombol-ambil.test.tsx tests/pagar-batas-server-klien.test.ts tests/inventaris-rute.test.ts
```

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add web/src/lib/pesanan/periksa-menggantung.ts web/src/lib/pesanan/picu-periksa.ts "web/src/app/produk/[slug]/periksa.ts" "web/src/app/produk/[slug]/tombol-beli.tsx" web/src/app/passport/produk/page.tsx web/tests/pesanan-periksa-dibuka.test.ts && git commit -m "$(cat <<'PESAN'
feat(pesanan): Lapis 1b — pemeriksaan pesanan menggantung saat halaman dibuka

Jaring pengaman utama P1, dan sengaja bukan cron: yang paling butuh
pemeriksaan adalah orang yang baru membayar lalu kembali mencari
produknya, dan dialah yang sedang membuka halaman itu.

Satu jalur penerapan untuk tiga pemanggil (halaman klien, tombol staf,
penyapu terjadwal) supaya vonis Midtrans tidak pernah punya tiga bacaan.

Dua pagar, keduanya diuji sebagai perilaku: sekali per pesanan per lima
menit lewat orders.diperiksa_pada — dicap SEBELUM bertanya, supaya jawaban
yang tidak mengubah apa pun tetap menghentikan pengulangan — dan kegagalan
yang disembunyikan, supaya Midtrans yang tak terhubung tidak berubah jadi
layar galat bagi orang yang cuma mencari produknya.

Radiusnya dijaga DUA lapis, bukan satu: pemilihan barisnya memakai sesi
pemanggil, DAN client_id-nya disaring eksplisit. Lapis kedua ada karena
orders punya dua policy SELECT — untuk sesi admin/owner, RLS memulangkan
pesanan seluruh klien, dan /produk/[slug] adalah halaman publik yang bisa
dibuka staf mana pun. Tanpa itu, satu admin yang memeriksa tampilan
etalase menembakkan permintaan Midtrans atas pesanan orang lain dan
mencap diperiksa_pada mereka — memperdaya penyapu Lapis 3.

rakitOrderId dipindahkan ke DALAM try dan hasilnya nilai baru
"bentuk_order_id": fungsi yang seluruh nilainya adalah tidak pernah
melempar tidak boleh memanggil fungsi yang melempar di luar try. Loop
sapuan juga membungkus setiap baris sendiri — satu baris cacat tidak
boleh memakan seluruh sapuan, sementara penelan galat di atasnya membuat
penyapu yang mati terbaca seperti penyapu yang bersih.

p_gross_amount dikirim sebagai STRING atau null, bentuk yang sama dengan
jalur webhook. Cabang 404 mengirim null, bukan 0: kolomnya nullable
justru supaya "tidak tahu" bukan "nol rupiah", dan 0 melahirkan selisih
palsu di layar staf untuk setiap pesanan kedaluwarsa.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

---

### Task 11: Layar `/admin/pesanan` + empat rute pemulihan

Lapis 2 — dipicu manusia. Tanpa keempat tombolnya, lapis ini hanya bisa melaporkan, tidak bisa
menyembuhkan.

**BACA DULU** (pola yang ditiru, path lengkap):

- `/Users/arvinfairuz/Documents/padma/web/src/app/admin/bayar/page.tsx` — bentuk halaman panel
  admin: `requireRole` di baris pertama, `<Bantuan>`, dua blok `<section aria-label=…>`.
- `/Users/arvinfairuz/Documents/padma/web/src/app/admin/bayar/tabel-bayar.tsx` — bentuk tabel
  panel, dan alasan tombol dirender BERSYARAT menurut status barisnya (dokblok baris 8-20).
- `/Users/arvinfairuz/Documents/padma/web/src/app/passport/bayar/[id]/unggah-bukti.tsx`
  baris 40-67 — satu-satunya pola `fetch` ke rute sendiri dari komponen klien di repo ini.
- `/Users/arvinfairuz/Documents/padma/web/src/lib/admin/tagihan-pengajuan.ts` — pembaca layar
  staf: sesi pemanggil, galat dilempar bukan disamarkan jadi daftar kosong (baris 103-123).
- `/Users/arvinfairuz/Documents/padma/web/src/app/api/bukti/[permintaan]/route.ts` — rute staf
  `requireRole(["admin","owner"])` di baris pertama.
- `/Users/arvinfairuz/Documents/padma/web/tests/admin-bayar.test.ts` baris 82-110 dan 224-243 —
  pola mem-`vi.mock` `@/lib/supabase/server` dengan sesi nyata + merender halaman server.
- `/Users/arvinfairuz/Documents/padma/web/tests/helpers/nominal.ts` — `nominalDalam()`, yang di
  sini dipakai dengan assertion KEBALIKAN.
- `/Users/arvinfairuz/Documents/padma/web/tests/admin-shell.test.ts` baris 401-450 dan 604-651 —
  empat suntingan Step 10 ada di sana, dan sapuan "nol service role di `src/app/admin/**`"
  (baris 643-651) adalah alasan keempat rute hidup di `src/app/api/**`.

**Batas yang perlu diketahui sebelum menulis satu baris pun:**

- `src/app/admin/**` disapu `tests/admin-shell.test.ts:643` — **nol `createAdminSupabase`,
  nol `SERVICE_ROLE`.** Karena itu keempat tombolnya adalah RUTE di `src/app/api/**`, bukan
  server action di dalam modul layar.
- `src/app/**/*.tsx` yang BUKAN `"use client"` tidak boleh mengoper prop berisi arrow function
  (`tests/pagar-batas-server-klien.test.ts`). `tabel-pesanan.tsx` karena itu tidak menerima
  callback apa pun; `tombol-pesanan.tsx` yang memegang `fetch`-nya sendiri.
- Kelas Tailwind `panel-*` yang dipakai harus punya token (`tests/panel-primitif.test.ts:137`
  menyapu `src/app/admin`). Token yang ADA hanya: `panel-bg`, `panel-surface`, `panel-border`,
  `panel-ink`, `panel-muted`, `panel-rail`, `panel-rail-ink`, `panel-rail-aktif`. **Tidak ada
  `panel-danger`** — warna peringatan memakai `clay`.
- `export const metadata = { title: "Pesanan" }` — TANPA "PADMA". Template `%s · PADMA` di root
  layout yang menambahkannya (`tests/identitas-aplikasi.test.ts`).

**Files:**

- Create: `web/supabase/migrations/20260927100000_sebab_tinjauan_lestari.sql` — migrasi
  **ke-91**, satu-satunya berkas SQL di seluruh P1-B. `create or replace function` atas tiga
  fungsi yang sudah ada; nol objek baru (Step 3)
- Create: `web/src/lib/admin/pesanan.ts`
- Create: `web/src/app/admin/pesanan/page.tsx`
- Create: `web/src/app/admin/pesanan/tabel-pesanan.tsx`
- Create: `web/src/app/admin/pesanan/tombol-pesanan.tsx`
- Create: `web/src/app/api/pesanan/[id]/periksa-ulang/route.ts`
- Create: `web/src/app/api/pesanan/[id]/terbitkan-akses/route.ts`
- Create: `web/src/app/api/pesanan/[id]/putuskan/route.ts`
- Create: `web/src/app/api/pesanan/[id]/tutup-tinjauan/route.ts`
- Modify: `web/src/app/admin/_shell/nav-admin.tsx:34-36`
- Modify: `web/tests/admin-shell.test.ts:408`, `:410-423`, `:432`, `:442-448`
- Modify: `web/README.md` — satu baris HALAMAN tepat sesudah baris `` `/admin/bayar` ``
  (:129 pada `main` hari ini) dan EMPAT baris rute tepat sesudah baris
  `` `/api/pesanan/[id]/batal` `` milik Tugas 9. **Cari baris jangkarnya, jangan percaya
  nomornya** (§0.12)
- Test: `web/tests/admin-pesanan.test.tsx` (**ekstensi `.tsx`**, bukan `.ts`: berkas ini
  merender `<TabelPesanan …/>` dengan sintaks JSX, mengikuti `tests/produk-tombol-ambil.test.tsx`.
  `tests/admin-bayar.test.ts` bisa `.ts` karena ia memakai `createElement`, bukan JSX.)

**Interfaces:**

- Consumes (Task 1) — `web/src/lib/pesanan/status.ts` (**sudah ada di `main`**):
  - `export type StatusPesanan = (typeof STATUS_PESANAN_SAH)[number];` — DITURUNKAN dari
    `export const STATUS_PESANAN_SAH = ["menunggu_bayar","ditahan","lunas","kedaluwarsa","dibatalkan"] as const`,
    bukan union yang ditulis tangan. Arahnya penting bagi tugas ini: nilai enum keenam cukup
    ditambahkan ke arraynya, dan `Record<StatusPesanan, string>` di bawah langsung memerah.
  - `export type SumberItemPesanan = (typeof SUMBER_ITEM_PESANAN)[number];`
  - `export const LABEL_STATUS_PESANAN: Record<StatusPesanan, string>;`
  - `export const PESANAN_TERBUKA` dan `export const PESANAN_BERUANG` — dipakai memilih baris
    layar dan menyaring blok "Butuh perhatian" (§0.6). `PESANAN_TERBUKA` juga yang menggerbangi
    tombol "Periksa ulang" di `tombol-pesanan.tsx`; pemisah `lunas`/`ditahan` di berkas itu
    BUKAN himpunan melainkan `Record<StatusPesanan, ...>` penuh — lihat dokbloknya.
- Consumes (Task 2) — `public.orders`, dibaca DENGAN SESI PEMANGGIL lewat policy
  `"pesanan: staf baca"`. `public.order_items` — **nol grant, nol policy**: hanya service role.
- Consumes (Task 3) — `public.notifikasi_pesanan (pesanan_id, nominal_diterima, diterima_pada)`
  dan `public.jejak_pesanan (pesanan_id, kejadian)`, keduanya policy baca staf.
- Consumes (Task 4) — RPC dipanggil DENGAN SESI PEMANGGIL:
  - `public.putuskan_pesanan_ditahan(p_pesanan_id uuid, p_putusan text) returns void`
    — `p_putusan` bertipe **text**; nilai selain `'lunas'`/`'dibatalkan'` melempar `P0001`.
  - `public.tutup_tinjauan(p_pesanan_id uuid) returns void`
    — melempar `P0001` untuk baris `ditahan`.
- Consumes (Task 5) — `public.pesanan_item_staf (pesanan_id, kode, jenis, judul_beku,
  harga_beku, urutan)` (**tanpa kolom id item**); `public.terbitkan_akses_item(p_item_id uuid)
  returns text` DENGAN SERVICE ROLE, memulangkan
  `'akses_terbit' | 'akses_sudah_ada' | 'akses_tertahan'`.
- Consumes (Task 10) — `web/src/lib/pesanan/periksa-menggantung.ts`:
  ```ts
  export type PesananDiperiksa = { id: string; kode: string; percobaan: number; kedaluwarsaPada: string };
  export type HasilPeriksaPesanan =
    | "diterapkan" | "duplikat" | "tanpa_efek" | "pesanan_tidak_ada"
    | "bentuk_order_id" | "belum_kedaluwarsa" | "midtrans_tak_terjawab" | "kunci_belum_terpasang"
    | "galat_basis_data";
  export async function terapkanJawabanMidtrans(p: PesananDiperiksa): Promise<HasilPeriksaPesanan>;
  ```
  **SEMBILAN nilai, bukan delapan.** `bentuk_order_id` lahir karena `rakitOrderId` MELEMPAR untuk
  `kode`/`percobaan` cacat dan `terapkanJawabanMidtrans` dikontrakkan tidak pernah melempar.
  `kunci_belum_terpasang` lahir dari `kode: -1` adapter: kunci server yang belum dipasang tidak
  pernah sembuh dengan dicoba lagi, jadi ia TIDAK boleh ikut kalimat "Coba lagi beberapa saat
  lagi." milik `midtrans_tak_terjawab`.
  `PESAN` di rute "Periksa ulang" adalah `Record<HasilPeriksaPesanan, string>`, jadi nilai yang
  lupa dipetakan MERAH di kompilator — tapi hanya kalau petanya memang lengkap.
- Consumes (repo): `requireRole(allowed: AppRole[])` dari `@/lib/auth/require-role`
  (`AppRole = "klien" | "admin" | "owner"`, memulangkan `{ userId, role, nama }` dan
  **redirect** bila ditolak); `createServerSupabase()`; `createAdminSupabase()`;
  `formatRupiah(nilai: number): string` dari `@/lib/rupiah-publik`;
  `Bantuan({ judul, children })` dari `@/app/_shell/panel/bantuan`.
- Produces:
  ```ts
  // web/src/lib/admin/pesanan.ts
  export type ItemPesanan = {
    pesananId: string; kode: string; jenis: SumberItemPesanan;
    judulBeku: string; hargaBeku: number; urutan: number;
  };
  export type BarisPesanan = {
    id: string; kode: string; status: StatusPesanan; percobaan: number; padmaId: string;
    jumlahItem: number; dibuatPada: string; kedaluwarsaPada: string; lunasPada: string | null;
    diperiksaPada: string | null; butuhTinjauanPada: string | null; sebabTinjauan: string | null;
    kanal: string | null; transaksiId: string | null; statusMidtrans: string | null;
    items: ItemPesanan[]; nominalTagih: number; nominalDiterima: number | null;
  };
  export async function bacaPesananStaf(): Promise<{ butuhPerhatian: BarisPesanan[]; terbuka: BarisPesanan[] }>;
  ```
  Kontrak keempat rute (dipakai `tombol-pesanan.tsx`):
  - `POST /api/pesanan/[id]/periksa-ulang` → `200 { hasil: HasilPeriksaPesanan, pesan: string }`
    | `404` | `502` (Midtrans tak terjawab) | `503` (kunci server belum terpasang) | `500`
    — setiap kode selain 200 membawa `pesan`, karena `tombol-pesanan.tsx` HANYA menampilkan
    `pesan` ketika `res.ok` bernilai false.
  - `POST /api/pesanan/[id]/terbitkan-akses` → `200 { terbit: string[], belumAdaPenangan: number[] }`
    | `404` | `409` (pesanan belum lunas) | `500`
  - `POST /api/pesanan/[id]/putuskan` body `{ putusan: "lunas" | "dibatalkan" }`
    → `200 { diputuskan: string }` | `400 { pesan: string }`
  - `POST /api/pesanan/[id]/tutup-tinjauan` → `200 { ditutup: true }` | `400 { pesan: string }`

---

- [ ] **Step 1: Tulis uji yang gagal**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/admin-pesanan.test.tsx` — perhatikan
ekstensinya: berkas ini memakai sintaks JSX, jadi `.ts` akan gagal di-parse.

```ts
/**
 * LAYAR PESANAN STAF (/admin/pesanan) + EMPAT RUTE PEMULIHAN.
 *
 * ===== ASSERTION YANG KEBALIKAN DARI KONVENSI RUMAH =====
 * Setiap modul panel admin di repo ini diuji dengan
 * `expect(nominalDalam(markup)).toEqual([])` — "layar admin nol rupiah".
 * Berkas ini menuntut KEBALIKANNYA: `expect(nominalDalam(markup)).not.toEqual([])`.
 *
 * Itu bukan kelalaian, melainkan KEPUTUSAN PEMILIK REPO yang tercatat di spec
 * `docs/superpowers/specs/2026-09-26-padma-inti-pembayaran-design.md`, seksi
 * "Catatan: nominal di layar staf": admin harus bisa menjawab "berapa yang
 * klien ini bayar" dari dalam PADMA, bukan dari dashboard Midtrans. Untuk
 * baris `ditahan` — satu-satunya baris yang angkanya benar-benar jadi
 * keputusan manusia, karena artinya "uang masuk tapi jumlahnya tidak cocok" —
 * yang ditagih dan yang diterima harus terbaca BERDAMPINGAN, karena
 * selisihnyalah yang diputuskan.
 *
 * Kenapa keputusan itu butuh UJI, bukan cukup kode: konvensi "nol rupiah"
 * ditegakkan PER MODUL (`tests/admin-bayar.test.ts:880` merender `BayarPage`
 * lalu memindai kelima berkas sumber modul bayar saja). Artinya
 * `/admin/pesanan` yang dikirim tanpa satu rupiah pun akan hijau 100%, view
 * `pesanan_item_staf` yang bernominal menganggur tanpa pembaca, dan keputusan
 * pemilik repo gugur lewat pintu KETIADAAN. Uji ini yang menutup pintu itu.
 *
 * UTANG P3, dicatat sekarang supaya tidak jadi kejutan: begitu P3 memindahkan
 * tagihan sesi ke pesanan, layar ini akan membawa nominal SESI ke panel admin
 * yang hari ini diuji nol rupiah (`tests/admin-bayar.test.ts:880-883`). Batas
 * itu harus diputuskan ulang di P3.
 *
 * Selebihnya berkas ini menjaga empat lubang yang semuanya memakan uang orang:
 * pesanan `ditahan` yang hilang dari layar, pesanan `lunas` tanpa akses yang
 * tidak pernah muncul, "tutup tinjauan" yang diam-diam mengubur baris
 * `ditahan`, dan "terbitkan akses" atas pesanan yang belum dibayar.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { nominalDalam } from "./helpers/nominal";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// `redirect()` melempar di dalam request Next. Di uji ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/pesanan",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

// Midtrans dipalsukan seluruhnya — `tests/setup-fetch-guard.ts` adalah daftar
// izin dan `.midtrans.com` sengaja TIDAK ada di sana.
const midtrans = vi.hoisted(() => ({ jawaban: null as unknown, panggilan: [] as string[] }));
vi.mock("@/lib/midtrans/adapter", () => ({
  bacaStatusTransaksi: async (orderId: string) => {
    midtrans.panggilan.push(orderId);
    return midtrans.jawaban;
  },
  terbitkanTokenSnap: async () => ({ ok: false, pesan: "tidak dipakai di berkas ini" }),
}));

const { bacaPesananStaf } = await import("@/lib/admin/pesanan");
const { default: PesananPage } = await import("@/app/admin/pesanan/page");
const { TabelPesanan } = await import("@/app/admin/pesanan/tabel-pesanan");
const { POST: periksaUlang } = await import("@/app/api/pesanan/[id]/periksa-ulang/route");
const { POST: terbitkanAkses } = await import("@/app/api/pesanan/[id]/terbitkan-akses/route");
const { POST: putuskan } = await import("@/app/api/pesanan/[id]/putuskan/route");
const { POST: tutupTinjauan } = await import("@/app/api/pesanan/[id]/tutup-tinjauan/route");

const KLIEN_ANANDA = "44444444-4444-4444-4444-444444444401";
const PADMA_ANANDA = "PAD-2607-0012";
const KLIEN_RINA = "44444444-4444-4444-4444-444444444402";
const AWALAN_KODE = "PSN-260926-AD";
const SLUG = "uji-admin-pesanan";
const JUDUL = "Uji Layar Pesanan";

const K_TERBUKA_BARU = `${AWALAN_KODE}0001`;
const K_TERBUKA_LAMA = `${AWALAN_KODE}0002`;
const K_DITAHAN = `${AWALAN_KODE}0003`;
const K_LUNAS_TANPA_AKSES = `${AWALAN_KODE}0004`;
const K_LUNAS_BERAKSES = `${AWALAN_KODE}0005`;

let produkId: string;
let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
const idPesanan = new Map<string, string>();

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

async function semai(o: {
  kode: string;
  clientId: string;
  status: "menunggu_bayar" | "ditahan" | "lunas";
  harga: number;
  diperiksaMenitLalu?: number | null;
  butuhTinjauan?: string | null;
}): Promise<string> {
  const tutup = o.status === "menunggu_bayar" ? null : new Date().toISOString();
  const { data, error } = await admin
    .from("orders")
    .insert({
      kode: o.kode,
      percobaan: 1,
      client_id: o.clientId,
      status: o.status,
      jumlah_item: 1,
      kedaluwarsa_pada: new Date(Date.now() + 20 * 3_600_000).toISOString(),
      ditutup_pada: tutup,
      lunas_pada: o.status === "lunas" ? tutup : null,
      diperiksa_pada:
        o.diperiksaMenitLalu == null
          ? null
          : new Date(Date.now() - o.diperiksaMenitLalu * 60_000).toISOString(),
      butuh_tinjauan_pada: o.butuhTinjauan ? new Date().toISOString() : null,
      sebab_tinjauan: o.butuhTinjauan ?? null,
      kanal: o.status === "menunggu_bayar" ? null : "bank_transfer",
      transaksi_id: o.status === "menunggu_bayar" ? null : `trx-${o.kode}`,
      status_midtrans: o.status === "menunggu_bayar" ? null : "settlement",
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: galatItem } = await admin.from("order_items").insert({
    pesanan_id: data!.id,
    jenis: "produk_digital",
    product_id: produkId,
    judul_beku: JUDUL,
    harga_beku: o.harga,
    urutan: 1,
  });
  if (galatItem) throw galatItem;

  idPesanan.set(o.kode, data!.id as string);
  return data!.id as string;
}

async function statusPesanan(id: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", id).single();
  return data!.status as string;
}

function permintaan(jalur: string, badan?: unknown): Request {
  return new Request(`http://127.0.0.1/api/pesanan/x/${jalur}`, {
    method: "POST",
    headers: badan ? { "content-type": "application/json" } : {},
    body: badan ? JSON.stringify(badan) : undefined,
  });
}

const param = (id: string) => ({ params: Promise.resolve({ id }) });

async function bersihkan() {
  await admin.from("digital_entitlements").delete().eq("product_id", produkId);
  const { data } = await admin.from("orders").select("id").like("kode", `${AWALAN_KODE}%`);
  const ids = (data ?? []).map((b) => b.id as string);
  if (ids.length === 0) return;
  await admin.from("jejak_pesanan").delete().in("pesanan_id", ids);
  await admin.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
  await admin.from("order_items").delete().in("pesanan_id", ids);
  await admin.from("orders").delete().in("id", ids);
  idPesanan.clear();
}

/**
 * Lima pesanan yang menutupi KEDUA klausa "Butuh perhatian" sekaligus kedua
 * urutan blok "Terbuka". Dua pesanan `menunggu_bayar` WAJIB milik dua klien
 * berbeda: `pesanan_terbuka_satu_per_klien` hanya mengizinkan satu per klien.
 *
 * DUA, bukan tiga: `bacaPesananStaf` menyaring dengan `butuhTinjauanPada !== null`
 * ATAU `PESANAN_BERUANG.includes(...) && belum ada akses`. Hitungan "tiga" adalah
 * sisa desain sebelum kedua klausa lama (`status === "ditahan"` tanpa syarat, dan
 * `status === "lunas" && belum ada akses`) dilebur jadi satu lewat himpunan Tugas 1.
 */
async function siapkan() {
  await bersihkan();

  await semai({
    kode: K_TERBUKA_BARU, clientId: KLIEN_ANANDA,
    status: "menunggu_bayar", harga: 75_000, diperiksaMenitLalu: null,
  });
  await semai({
    kode: K_TERBUKA_LAMA, clientId: KLIEN_RINA,
    status: "menunggu_bayar", harga: 60_000, diperiksaMenitLalu: 30,
  });

  const idDitahan = await semai({
    kode: K_DITAHAN, clientId: KLIEN_ANANDA,
    status: "ditahan", harga: 120_000, butuhTinjauan: "selisih_nominal",
  });
  // Uang memang pernah tercatat masuk — syarat `putuskan_pesanan_ditahan`.
  await admin.from("notifikasi_pesanan").insert({
    pesanan_id: idDitahan,
    sidik: `sidik-${K_DITAHAN}`,
    transaksi_id: `trx-${K_DITAHAN}`,
    status_midtrans: "settlement",
    kanal: "bank_transfer",
    nominal_diterima: 95_000,
  });

  await semai({
    kode: K_LUNAS_TANPA_AKSES, clientId: KLIEN_ANANDA,
    status: "lunas", harga: 250_000,
  });

  const idBerakses = await semai({
    kode: K_LUNAS_BERAKSES, clientId: KLIEN_RINA,
    status: "lunas", harga: 310_000,
  });
  await admin.from("jejak_pesanan").insert({
    pesanan_id: idBerakses,
    padma_id: "PAD-2608-0019",
    kejadian: "akses_terbit",
    keterangan: "fixture",
  });
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");

  await admin.from("digital_products").delete().eq("slug", SLUG);
  const { data, error } = await admin
    .from("digital_products")
    .insert({ judul: JUDUL, slug: SLUG, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkId = data!.id as string;
  await admin.from("digital_product_prices").insert({ product_id: produkId, harga: 120_000 });
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  midtrans.panggilan.length = 0;
  midtrans.jawaban = null;
  await siapkan();
});

afterAll(async () => {
  await bersihkan();
  await admin.from("digital_products").delete().eq("id", produkId);
});

// ---------------------------------------------------------------------------
// Pembaca
// ---------------------------------------------------------------------------

describe("bacaPesananStaf", () => {
  it("Butuh perhatian memuat kedua klausa, dan lunas yang aksesnya sudah terbit TIDAK ikut", async () => {
    const { butuhPerhatian } = await bacaPesananStaf();
    const kode = butuhPerhatian.map((p) => p.kode);

    expect(kode).toContain(K_DITAHAN); // uang masuk, barang belum keluar
    expect(kode).toContain(K_LUNAS_TANPA_AKSES); // jaring yang tidak menunggu siapa pun ingat
    // Klausa kedua TIDAK boleh menangkap pesanan yang sudah beres: layar yang
    // selalu penuh adalah layar yang berhenti dibaca.
    expect(kode).not.toContain(K_LUNAS_BERAKSES);
  });

  it("Terbuka memuat yang menunggu bayar, urut diperiksa_pada nulls first", async () => {
    const { terbuka } = await bacaPesananStaf();
    const kode = terbuka.map((p) => p.kode);
    expect(kode).toContain(K_TERBUKA_BARU);
    expect(kode).toContain(K_TERBUKA_LAMA);
    // Yang BELUM PERNAH diperiksa duduk paling atas — dialah yang paling
    // mungkin menggantung tanpa ada yang tahu.
    expect(kode.indexOf(K_TERBUKA_BARU)).toBeLessThan(kode.indexOf(K_TERBUKA_LAMA));
  });

  it("nominal tagih dijumlahkan dari harga beku item, dan yang diterima dibaca dari notifikasi", async () => {
    const { butuhPerhatian } = await bacaPesananStaf();
    const ditahan = butuhPerhatian.find((p) => p.kode === K_DITAHAN)!;
    expect(ditahan.nominalTagih).toBe(120_000);
    expect(ditahan.nominalDiterima).toBe(95_000);
    expect(ditahan.items.map((i) => i.hargaBeku)).toEqual([120_000]);
    expect(ditahan.padmaId).toBe(PADMA_ANANDA);
  });

  it("pesanan tanpa notifikasi bernominal memulangkan nominalDiterima null, bukan nol", async () => {
    // Nol dan "belum ada angkanya" adalah dua kalimat berbeda, dan yang kedua
    // tidak boleh dirender sebagai "Rp 0" di sebelah yang ditagih.
    const { terbuka } = await bacaPesananStaf();
    expect(terbuka.find((p) => p.kode === K_TERBUKA_BARU)!.nominalDiterima).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------

describe("halaman /admin/pesanan", () => {
  const markup = async () => renderToStaticMarkup(await PesananPage());

  it("MEMUAT nominal — kebalikan konvensi rumah, atas keputusan pemilik repo", async () => {
    const m = await markup();
    expect(nominalDalam(m), "nominal justru HARUS ada di layar ini").not.toEqual([]);
    expect(m).toContain("Rp 120.000");
    expect(m).toContain("Rp 250.000");
  });

  it("baris ditahan menampilkan yang DITAGIH dan yang DITERIMA berdampingan", async () => {
    const m = await markup();
    expect(m).toContain("Rp 120.000");
    expect(m).toContain("Rp 95.000");
    expect(m).toMatch(/Diterima/);
  });

  it("menampilkan kedua blok beserta sebab tinjauannya", async () => {
    const m = await markup();
    expect(m).toContain("Butuh perhatian");
    expect(m).toContain("Terbuka");
    expect(m).toContain("selisih_nominal");
    expect(m).toContain(PADMA_ANANDA);
  });

  it("menolak sesi klien", async () => {
    ref.sesi = sesiKlien;
    await expect(markup()).rejects.toThrow("REDIRECT /setelah-masuk");
  });

  it("nol service role di seluruh modul layar", async () => {
    // Ditegaskan ulang di sini meski `tests/admin-shell.test.ts:643` sudah
    // menyapu `src/app/admin/**`: sapuan itu punya daftar pengecualian, dan
    // daftar yang bertambah adalah cara paling sunyi sebuah modul kehilangan
    // pagarnya. Modul INI tidak pernah boleh masuk ke sana.
    for (const berkas of [
      "src/app/admin/pesanan/page.tsx",
      "src/app/admin/pesanan/tabel-pesanan.tsx",
      "src/app/admin/pesanan/tombol-pesanan.tsx",
      "src/lib/admin/pesanan.ts",
    ]) {
      const isi = baca(berkas);
      expect(isi, `${berkas} memakai service role`).not.toContain("createAdminSupabase");
      expect(isi, `${berkas} memakai service role`).not.toContain("SERVICE_ROLE");
    }
  });
});

// ---------------------------------------------------------------------------
// Tabel — dirender sendiri, tanpa basis data
// ---------------------------------------------------------------------------

describe("TabelPesanan", () => {
  const dasar = {
    id: "11111111-1111-1111-1111-111111111111",
    kode: "PSN-260926-AD9999",
    status: "ditahan" as const,
    percobaan: 1,
    padmaId: PADMA_ANANDA,
    jumlahItem: 1,
    dibuatPada: "2026-09-26T01:00:00Z",
    kedaluwarsaPada: "2026-09-27T01:00:00Z",
    lunasPada: null,
    diperiksaPada: null,
    butuhTinjauanPada: "2026-09-26T02:00:00Z",
    sebabTinjauan: "selisih_nominal",
    kanal: "bank_transfer",
    transaksiId: "trx-9999",
    statusMidtrans: "settlement",
    items: [
      {
        pesananId: "11111111-1111-1111-1111-111111111111",
        kode: "PSN-260926-AD9999",
        jenis: "produk_digital" as const,
        judulBeku: "Panduan Uji",
        hargaBeku: 120_000,
        urutan: 1,
      },
    ],
    nominalTagih: 120_000,
    nominalDiterima: 95_000,
  };

  it("PADMA ID yang tidak terbaca dirender sebagai KEGAGALAN, bukan sebagai teks kosong", () => {
    // Pelajaran repo: embed PostgREST yang ditolak RLS memulangkan NULL, bukan
    // galat. Baris yang PADMA ID-nya kosong karena itu bukan "klien tanpa
    // PADMA ID" melainkan "kita tidak berhasil membacanya" — dan dua hal itu
    // menuntut tindakan berbeda dari staf yang melihatnya.
    const m = renderToStaticMarkup(<TabelPesanan baris={[{ ...dasar, padmaId: "" }]} />);
    expect(m).toContain("PADMA ID tidak terbaca");
  });

  it("TIDAK menawarkan Tutup tinjauan pada baris ditahan", () => {
    // `tutup_tinjauan` menolak baris `ditahan` dengan P0001. Menawarkan tombol
    // yang pasti ditolak adalah janji yang tidak akan ditepati — dan di sini
    // janji itu berbunyi "beres" untuk pesanan yang uangnya sudah di tangan
    // Midtrans dan barangnya belum keluar.
    const m = renderToStaticMarkup(<TabelPesanan baris={[dasar]} />);
    expect(m).not.toContain("Tutup tinjauan");
    expect(m).toContain("Putuskan lunas");
    expect(m).toContain("Putuskan batal");
  });

  it("menawarkan Tutup tinjauan pada baris bertanda tinjauan yang BUKAN ditahan", () => {
    const m = renderToStaticMarkup(
      <TabelPesanan baris={[{ ...dasar, status: "lunas" as const, nominalDiterima: null }]} />,
    );
    expect(m).toContain("Tutup tinjauan");
    expect(m).toContain("Terbitkan akses");
  });
});

// ---------------------------------------------------------------------------
// Empat rute pemulihan
// ---------------------------------------------------------------------------

describe("gerbang peran keempat rute", () => {
  it("menolak sesi klien", async () => {
    ref.sesi = sesiKlien;
    const id = idPesanan.get(K_DITAHAN)!;
    await expect(periksaUlang(permintaan("periksa-ulang"), param(id))).rejects.toThrow(
      "REDIRECT /setelah-masuk",
    );
    await expect(terbitkanAkses(permintaan("terbitkan-akses"), param(id))).rejects.toThrow(
      "REDIRECT /setelah-masuk",
    );
    await expect(
      putuskan(permintaan("putuskan", { putusan: "lunas" }), param(id)),
    ).rejects.toThrow("REDIRECT /setelah-masuk");
    await expect(tutupTinjauan(permintaan("tutup-tinjauan"), param(id))).rejects.toThrow(
      "REDIRECT /setelah-masuk",
    );
  });
});

describe("POST /api/pesanan/[id]/putuskan", () => {
  it("menolak putusan asing di RUTE — kalimatnya, bukan hanya kodenya", async () => {
    // Dokblok rute ini menyatakan "dua pagar untuk satu lubang, karena lubang
    // ini memakan uang orang". Klaim itu tidak bisa dibuktikan oleh dua uji
    // yang sama-sama cuma membaca `r.status`: rute menjawab 400 untuk daftar
    // putih lokalnya DAN untuk setiap galat RPC.
    //
    // Skenario konkret yang lolos tanpa assertion kalimat: seseorang menghapus
    // `PUTUSAN_SAH` dari rute ("RPC-nya sudah memeriksa, ini duplikat").
    // Nilai "kedaluwarsa" kini berjalan sampai ke basis data, RPC menolaknya
    // dengan P0001, rute tetap 400, uji tetap hijau — dan pagar kedua yang
    // diklaim dokblok hilang tanpa bekas. Kebalikannya juga tidak terjaga.
    //
    // Yang memisahkan keduanya hanya KALIMATNYA — jadi kedua kalimat itu
    // sengaja TIDAK berbagi satu frasa pun. Versi sebelumnya berbunyi
    // 'Putusan hanya boleh "lunas" atau "dibatalkan".' sementara RPC berbunyi
    // 'Putusan harus "lunas" atau "dibatalkan", bukan "%"' — keduanya memuat
    // substring yang di-assert, jadi menghapus PUTUSAN_SAH dari rute membuat
    // permintaan jatuh ke RPC, tetap 400, dan uji ini TETAP HIJAU. Pagar kedua
    // boleh hilang tanpa bekas. "tidak dikenal" hanya ada di kalimat RUTE.
    const id = idPesanan.get(K_DITAHAN)!;
    const r = await putuskan(permintaan("putuskan", { putusan: "kedaluwarsa" }), param(id));
    expect(r.status).toBe(400);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan).toContain("tidak dikenal");
    // Bukti negatifnya: kalau pagar rute dihapus dan permintaan jatuh ke RPC,
    // pesannya memuat "bukan" dan uji ini merah — bukan lolos diam-diam.
    expect(isi.pesan).not.toContain("bukan");
    expect(await statusPesanan(id)).toBe("ditahan");
  });

  it('menggerakkan pesanan ditahan ke "lunas" dan mencatat siapa yang memutuskan', async () => {
    const id = idPesanan.get(K_DITAHAN)!;
    const r = await putuskan(permintaan("putuskan", { putusan: "lunas" }), param(id));
    expect(r.status).toBe(200);
    expect(await statusPesanan(id)).toBe("lunas");

    const { data: jejak } = await admin
      .from("jejak_pesanan")
      .select("kejadian, padma_id")
      .eq("pesanan_id", id)
      .eq("kejadian", "lunas");
    expect((jejak ?? []).length).toBe(1);
  });

  it("menolak pesanan yang BUKAN ditahan — dan kalimatnya datang dari RPC", async () => {
    // Pasangan uji di atas. Putusannya SAH, jadi daftar putih rute
    // meloloskannya; yang menolak adalah `putuskan_pesanan_ditahan`. Kalimat
    // RPC-nya berbeda dari kalimat rute, dan perbedaan itulah yang membuat
    // kedua pagar bisa merah SENDIRI-SENDIRI.
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    const r = await putuskan(permintaan("putuskan", { putusan: "lunas" }), param(id));
    expect(r.status).toBe(400);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan).toContain("tidak sedang ditahan");
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });
});

describe("POST /api/pesanan/[id]/tutup-tinjauan", () => {
  it("MENOLAK baris ditahan dengan kalimat yang menyuruh memakai putusan", async () => {
    const id = idPesanan.get(K_DITAHAN)!;
    const r = await tutupTinjauan(permintaan("tutup-tinjauan"), param(id));
    expect(r.status).toBe(400);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan.toLowerCase()).toContain("putuskan");
    // Dan penandanya TIDAK ikut hilang: baris ini harus tetap terlihat.
    const { data } = await admin
      .from("orders")
      .select("butuh_tinjauan_pada")
      .eq("id", id)
      .single();
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
  });

  it("mengosongkan penanda pada baris lunas bertanda tinjauan, tanpa menyentuh status", async () => {
    const id = idPesanan.get(K_LUNAS_TANPA_AKSES)!;
    await admin
      .from("orders")
      .update({ butuh_tinjauan_pada: new Date().toISOString(), sebab_tinjauan: "akses_tertahan" })
      .eq("id", id);

    const r = await tutupTinjauan(permintaan("tutup-tinjauan"), param(id));
    expect(r.status).toBe(200);

    const { data } = await admin
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", id)
      .single();
    expect(data!.status).toBe("lunas");
    expect(data!.butuh_tinjauan_pada).toBeNull();
    expect(data!.sebab_tinjauan).toBeNull();
  });
});

describe("POST /api/pesanan/[id]/terbitkan-akses", () => {
  it("menerbitkan entitlement untuk pesanan lunas yang aksesnya belum terbit", async () => {
    const id = idPesanan.get(K_LUNAS_TANPA_AKSES)!;
    const r = await terbitkanAkses(permintaan("terbitkan-akses"), param(id));
    expect(r.status).toBe(200);
    const isi = (await r.json()) as { terbit: string[] };
    expect(isi.terbit).toEqual(["akses_terbit"]);

    const { data } = await admin
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("product_id", produkId)
      .eq("client_id", KLIEN_ANANDA);
    expect((data ?? []).length).toBe(1);
    expect(data![0].sumber).toBe("beli");
    expect(data![0].pesanan_id).toBe(id);
  });

  it("MENOLAK pesanan yang belum lunas — tombol bukan pagar", async () => {
    // Tombolnya memang hanya dirender untuk baris `lunas`, tapi rute adalah
    // endpoint MANDIRI: satu curl sudah cukup memberikan barang yang belum
    // dibayar.
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    const r = await terbitkanAkses(permintaan("terbitkan-akses"), param(id));
    expect(r.status).toBe(409);

    const { data } = await admin
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", produkId);
    expect(data ?? []).toEqual([]);
  });
});

describe("POST /api/pesanan/[id]/periksa-ulang", () => {
  it("menanyai Status API lalu menjalankan jawabannya lewat mesin", async () => {
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    midtrans.jawaban = {
      ok: true as const,
      status: {
        order_id: `${K_TERBUKA_BARU}.1`,
        status_code: "200",
        transaction_status: "settlement",
        transaction_id: "trx-periksa-ulang",
        gross_amount: "75000.00",
        fraud_status: null,
        payment_type: "gopay",
      },
    };

    const r = await periksaUlang(permintaan("periksa-ulang"), param(id));
    expect(r.status).toBe(200);
    expect(midtrans.panggilan).toEqual([`${K_TERBUKA_BARU}.1`]);
    expect(await statusPesanan(id)).toBe("lunas");
  });

  it("Midtrans yang tidak menjawab memulangkan 502, bukan 200 palsu", async () => {
    // 200 di sini berarti staf melihat "selesai" untuk pemeriksaan yang tidak
    // pernah terjadi, lalu berhenti memeriksanya.
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    midtrans.jawaban = { ok: false as const, kode: 500, pesan: "gangguan" };

    const r = await periksaUlang(permintaan("periksa-ulang"), param(id));
    expect(r.status).toBe(502);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("pesanan yang tidak ada memulangkan 404", async () => {
    const r = await periksaUlang(
      permintaan("periksa-ulang"),
      param("00000000-0000-0000-0000-000000000000"),
    );
    expect(r.status).toBe(404);
    expect(midtrans.panggilan).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/admin-pesanan.test.tsx
```

Kegagalan yang diharapkan: `Failed to load url @/lib/admin/pesanan` — seluruh berkas merah
karena modulnya belum ada.

- [ ] **Step 3: Migrasi ke-91 — `sebab_tinjauan` yang pertama tidak pernah tertimpa**

Koreksi "review akhir P1-A" di kepala rencana ini (butir 2) memerintahkan perbaikan lima
UPDATE `sebab_tinjauan` yang menugaskan tanpa `coalesce`, dan menambahkan *"jangan membatasi
perbaikannya pada jalur coba-ulang"*. Perintah itu sebelumnya tidak punya LANGKAH: nol berkas
`.sql` di blok Files mana pun, nol Step yang menulis migrasi, nol uji yang menegaskan
`sebab_tinjauan` bertahan. Perintah yang tidak punya langkah bukan perintah — ia hanya kalimat.
Langkah ini yang memilikinya.

**Kenapa Tugas 11, bukan tugas baru:** layar inilah yang MENAMPILKAN `sebab_tinjauan`
(`tabel-pesanan.tsx`, kolom "Butuh perhatian"). Orang yang membangun layarnya adalah orang yang
peduli alasannya benar; memisahkannya jadi tugas sendiri berarti menyerahkan kebenaran isi
kolom kepada orang yang tidak pernah melihat kolomnya.

**Dua aturan yang mengikat isi migrasinya:**

1. **Pakai `create or replace function`**, supaya **ACL-nya lestari**. Ketiga fungsi yang
   disentuh ada di `MESIN_TERTUTUP`; `create or replace` mempertahankan OID-nya, jadi
   pencabutan hak dan `comment on function` ikut bertahan tanpa ditulis ulang.
2. **Bila toh memilih `drop` + `create`, WAJIB menulis ulang**
   `revoke all on function public.terapkan_notifikasi_midtrans(...) from public, anon, authenticated;`
   — berikut dua saudaranya. Kalau lupa, `tests/fungsi-mesin-tertutup.test.ts` menangkapnya,
   dan itu memang gunanya.

**Yang berubah: LIMA assignment, dari tujuh.** Kelimanya dibungkus
`coalesce(o.sebab_tinjauan, …)` — sepasang dengan `butuh_tinjauan_pada` yang sudah
`coalesce(o.butuh_tinjauan_pada, now())` di baris atasnya:

| # | Fungsi | Nilai yang ditugaskan | Kapan penimpaannya terjadi |
|---|---|---|---|
| 1 | `terbitkan_akses_item` | `'akses_tertahan'` | pesanan yang sudah bertanda `selisih_nominal` gagal menerbitkan akses |
| 2 | `salurkan_pesanan` | `'penangan_belum_ada'` | item kedua berjenis `sesi` menimpa alasan item pertama |
| 3 | `terapkan_notifikasi_midtrans` | `v_sebab` (cabang refund/chargeback/asing) | **terjangkau hari ini**: `refund` mendarat pada pesanan bertanda `lunas_setelah_tutup` |
| 4 | `terapkan_notifikasi_midtrans` | `'lunas_setelah_tutup'` | pesanan `dibatalkan` yang sudah bertanda `selisih_status` |
| 5 | `terapkan_notifikasi_midtrans` | `'selisih_status'` (transisi ditolak) | baris `menunggu_bayar` yang sudah bertanda dari tombol Tugas 11 |

**Dua yang TIDAK disentuh**, dan keduanya sengaja: cabang "notifikasi mendarat pada pesanan
yang sedang ditahan" sudah menulis `coalesce(o.sebab_tinjauan, 'selisih_status')` sejak hari
pertama — dialah cetakan yang kelima di atas ikuti — dan UPDATE transisi menulis
`coalesce(v_sebab, o.sebab_tinjauan)`, arah KEBALIKAN yang memang benar di sana: baris itu
satu-satunya yang benar-benar MEMINDAHKAN pesanan, dan alasan keadaan barunya menggantikan
alasan keadaan lamanya.

**Uji DULU.** Tambahkan blok berikut di **akhir**
`/Users/arvinfairuz/Documents/padma/web/tests/admin-pesanan.test.tsx` — ia memakai perkakas
yang sudah ada di berkas itu (`semai`, `admin`, `AWALAN_KODE`, `KLIEN_RINA`):

```ts
// ---------------------------------------------------------------------------
// sebab_tinjauan lestari (migrasi 20260927100000)
// ---------------------------------------------------------------------------

describe("sebab_tinjauan tidak tertimpa notifikasi berikutnya", () => {
  it("refund yang mendarat pada pesanan bertanda lunas_setelah_tutup TIDAK menimpa alasannya", async () => {
    // Jalur yang terjangkau HARI INI, tanpa satu baris kode baru — dan yang
    // hilang adalah satu-satunya petunjuk bahwa uang pernah masuk pada pesanan
    // yang sudah kami tutup. `butuh_tinjauan_pada` sudah ber-`coalesce` sejak
    // awal, jadi sebelum migrasi ini cap waktunya menyebut kejadian PERTAMA
    // sementara alasannya menyebut kejadian TERAKHIR.
    const kode = `${AWALAN_KODE}0006`;
    const id = await semai({
      kode, clientId: KLIEN_RINA, status: "lunas", harga: 50_000,
      butuhTinjauan: "lunas_setelah_tutup",
    });

    const { error } = await admin.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: `${kode}.1`,
      p_transaction_status: "refund",
      p_fraud_status: "",
      p_transaction_id: `trx-${kode}-refund`,
      p_payment_type: "bank_transfer",
      p_gross_amount: 50_000,
      p_sidik: `sidik-${kode}-refund`,
      p_sumber: "webhook",
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from("orders")
      .select("sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", id)
      .single();
    expect(data!.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
  });

  it("pesanan yang BELUM bertanda tetap mendapat sebabnya", async () => {
    // Kontrol positif, dan ia wajib: `coalesce` hanya boleh mempertahankan yang
    // sudah ada, bukan berhenti menulis. Tanpa pasangan ini, migrasi yang
    // keliru membuang assignment-nya sama sekali tetap hijau — dan pesanan
    // yang di-refund berhenti muncul di "Butuh perhatian" dengan alasan apa pun.
    const kode = `${AWALAN_KODE}0007`;
    const id = await semai({ kode, clientId: KLIEN_RINA, status: "lunas", harga: 40_000 });

    await admin.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: `${kode}.1`,
      p_transaction_status: "chargeback",
      p_fraud_status: "",
      p_transaction_id: `trx-${kode}-cb`,
      p_payment_type: "credit_card",
      p_gross_amount: 40_000,
      p_sidik: `sidik-${kode}-cb`,
      p_sumber: "webhook",
    });

    const { data } = await admin
      .from("orders")
      .select("sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", id)
      .single();
    expect(data!.sebab_tinjauan).toBe("chargeback");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
  });
});
```

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/admin-pesanan.test.tsx -t "sebab_tinjauan"
```

Kasus pertama MERAH dengan `expected 'refund' to be 'lunas_setelah_tutup'` — merah yang
bermakna, bukan "modul belum ada". Kasus kedua sudah hijau, dan memang harus: ia kontrol
positif, bukan perbaikan.

Lalu buat `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260927100000_sebab_tinjauan_lestari.sql`.
Badan ketiga fungsinya **disalin dari `20260926140000_pesanan_webhook_rpc.sql` yang ada di
`main`**, bukan ditulis ulang dari ingatan — `create or replace` menimpa SELURUH badan, jadi
satu baris yang hilang saat menyalin adalah satu perilaku yang hilang dari mesin pembayaran:

```sql
-- ===========================================================================
-- sebab_tinjauan LESTARI — alasan PERTAMA tidak pernah tertimpa
-- ===========================================================================
-- Migrasi ke-91, dan ia tidak melahirkan apa pun: ketiga fungsi di bawah sudah
-- ada sejak `20260926140000_pesanan_webhook_rpc.sql`. Yang berubah cuma LIMA
-- assignment `sebab_tinjauan`, masing-masing dibungkus
-- `coalesce(o.sebab_tinjauan, …)`.
--
-- ===== KENAPA =====
-- Setiap UPDATE penanda tinjauan sudah menulis
-- `butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now())` — cap WAKTU
-- pertama yang bertahan. Pasangannya, `sebab_tinjauan`, menugaskan telanjang di
-- lima tempat, jadi cap waktunya menyebut kejadian pertama sementara alasannya
-- menyebut kejadian terakhir. Dua kolom yang hidup berpasangan dan bercerita
-- beda adalah kolom yang membuat staf memutuskan perkara uang dengan alasan
-- yang salah.
--
-- Jalannya terjangkau HARI INI, tanpa satu baris kode baru: notifikasi `refund`
-- atau `chargeback` yang mendarat pada pesanan yang sudah bertanda
-- `lunas_setelah_tutup` menimpa alasannya diam-diam — dan `lunas_setelah_tutup`
-- adalah satu-satunya petunjuk bahwa uang pernah masuk pada pesanan yang sudah
-- kami tutup.
--
-- ===== LIMA, BUKAN TUJUH =====
-- Dua UPDATE `sebab_tinjauan` yang lain TIDAK disentuh, dan keduanya sengaja:
--   * cabang "notifikasi mendarat pada pesanan yang sedang ditahan" sudah
--     menulis `coalesce(o.sebab_tinjauan, 'selisih_status')` sejak hari
--     pertama — dialah cetakan yang empat lainnya ikuti;
--   * UPDATE transisi (`set status = v_tujuan …`) menulis
--     `coalesce(v_sebab, o.sebab_tinjauan)`, arah yang KEBALIKAN dan memang
--     benar di sana: baris itu satu-satunya yang benar-benar MEMINDAHKAN
--     pesanan, dan alasan keadaan barunya menggantikan alasan keadaan lamanya.
--
-- ===== KENAPA `create or replace`, BUKAN `drop` + `create` =====
-- Ketiganya ada di `MESIN_TERTUTUP` (`tests/fungsi-mesin-tertutup.test.ts`):
-- hak eksekusinya sudah dicabut dari `public`, `anon`, dan `authenticated`.
-- `create or replace` mempertahankan OID fungsinya, jadi ACL DAN
-- `comment on function` ikut lestari tanpa satu baris pun ditulis ulang di
-- sini. `drop` + `create` mengembalikan default privileges Supabase, dan fungsi
-- mesin yang terbuka bagi `authenticated` berarti vonis Midtrans bisa diketik
-- pemanggil bersesi.
--
-- Bila revisi berikutnya TETAP memilih `drop` + `create`, ia WAJIB menulis ulang
-- ketiga barisnya:
--   revoke all on function public.terbitkan_akses_item(uuid) from public, anon, authenticated;
--   revoke all on function public.salurkan_pesanan(uuid) from public, anon, authenticated;
--   revoke all on function
--     public.terapkan_notifikasi_midtrans(text, text, text, text, text, numeric, text, text)
--     from public, anon, authenticated;
-- Lupa menulisnya bukan kegagalan senyap — `tests/fungsi-mesin-tertutup.test.ts`
-- menangkapnya, dan itu memang gunanya.
--
-- Badan ketiga fungsi di bawah adalah SALINAN PERSIS dari
-- `20260926140000_pesanan_webhook_rpc.sql`, kecuali kelima baris `coalesce` itu
-- dan komentar yang menjelaskannya. Menyalin dari berkas itu, bukan menulis
-- ulang dari ingatan, adalah bagian dari perintahnya.

-- ---------------------------------------------------------------------------
-- 1/3 — terbitkan_akses_item: `akses_tertahan`
-- ---------------------------------------------------------------------------
create or replace function public.terbitkan_akses_item(p_item_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_pesanan_id uuid;
  v_client_id uuid;
  v_padma_id text;
  v_product_id uuid;
  v_jenis public.order_item_source;
  v_ent_id uuid;
  v_dicabut timestamptz;
  v_baru uuid;
begin
  select i.pesanan_id, i.product_id, i.jenis, o.client_id, c.padma_id
    into v_pesanan_id, v_product_id, v_jenis, v_client_id, v_padma_id
    from public.order_items i
    join public.orders o on o.id = i.pesanan_id
    join public.clients c on c.id = o.client_id
   where i.id = p_item_id;

  if v_pesanan_id is null then
    raise exception 'Item pesanan % tidak ditemukan.', p_item_id using errcode = 'P0002';
  end if;
  if v_jenis <> 'produk_digital' then
    raise exception 'Item % bukan produk digital; aksesnya bukan urusan fungsi ini.', p_item_id
      using errcode = 'P0001';
  end if;

  select e.id, e.dicabut_pada into v_ent_id, v_dicabut
    from public.digital_entitlements e
   where e.client_id = v_client_id and e.product_id = v_product_id
   for update;

  -- (1) BELUM ADA BARISNYA
  if v_ent_id is null then
    insert into public.digital_entitlements (client_id, product_id, sumber, pesanan_id)
    values (v_client_id, v_product_id, 'beli', v_pesanan_id)
    on conflict (client_id, product_id) do nothing
    returning id into v_baru;

    if v_baru is not null then
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'akses_terbit', format('produk %s', v_product_id));
      return 'akses_terbit';
    end if;

    -- Balapan: barisnya lahir di antara SELECT dan INSERT (jalur gratis
    -- berjalan bersamaan). Nilai ulang, jangan menebak.
    select e.id, e.dicabut_pada into v_ent_id, v_dicabut
      from public.digital_entitlements e
     where e.client_id = v_client_id and e.product_id = v_product_id;

    if v_ent_id is null then
      -- Mustahil di bawah `unique (client_id, product_id)`: INSERT gagal
      -- karena KONFLIK, tapi SELECT ulang tidak menemukan baris yang
      -- bertabrakan dengannya. Diam di sini berarti (2) di bawah berjalan
      -- dengan v_ent_id NULL — UPDATE `pesanan_id` mengenai nol baris, dan
      -- fungsi memulangkan 'akses_sudah_ada' padahal TIDAK ADA entitlement
      -- dan TIDAK ADA tinjauan yang menyala. Mustahil yang diam-diam adalah
      -- mustahil yang harus melempar, bukan mustahil yang harus dipercaya.
      raise exception 'Balapan entitlement produk % tidak terselesaikan.', v_product_id
        using errcode = 'P0002';
    end if;
  end if;

  -- (2) ADA DAN BELUM DICABUT
  if v_dicabut is null then
    -- `sumber` TIDAK dinaikkan menjadi 'beli': entitlement gratis yang
    -- produknya kemudian dibeli tetap gratis. Yang mencatat pendapatan adalah
    -- `orders`, bukan kolom ini.
    update public.digital_entitlements e
       set pesanan_id = v_pesanan_id
     where e.id = v_ent_id and e.pesanan_id is null;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'akses_sudah_ada', format('produk %s', v_product_id));
    return 'akses_sudah_ada';
  end if;

  -- (3) ADA DAN SUDAH DICABUT
  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, 'akses_tertahan',
          format('entitlement produk %s dicabut pada %s — akses tidak dihidupkan',
                 v_product_id, v_dicabut));

  -- Array POSITIF LIMA nilai, bukan dua: `status = any(...)` di sini bukan
  -- pagar CHECK (UPDATE ini tidak menyentuh `status` maupun `ditutup_pada`,
  -- jadi tidak ada kombinasi yang bisa melanggar `pesanan_tutup_bercap`),
  -- melainkan asumsi tentang SIAPA YANG MEMANGGIL. `status in ('lunas',
  -- 'ditahan')` benar untuk pemanggil hari ini (satu-satunya: cabang lunas
  -- `terapkan_notifikasi_midtrans`), tapi begitu Tugas 11 ("Terbitkan akses")
  -- memanggil fungsi ini pada baris yang SUDAH `kedaluwarsa`/`dibatalkan`/
  -- bahkan masih `menunggu_bayar`, dua nilai itu membuat UPDATE ini mengenai
  -- NOL baris — jejak `akses_tertahan` tetap tercatat, tapi
  -- `butuh_tinjauan_pada` TIDAK menyala, tidak ada yang melempar, dan fungsi
  -- memulangkan string yang SAMA dengan jalur sehat. Sama seperti langkah (5)
  -- "Cermin kolom Midtrans" di `terapkan_notifikasi_midtrans` di bawah, array
  -- di sini dilebarkan ke lima nilai supaya "uang masuk, barang tidak keluar"
  -- tidak pernah diam hanya karena pemanggilnya bukan yang dibayangkan hari
  -- ini.
  update public.orders o
     set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
         -- coalesce: sebab PERTAMA yang menyalakan tinjauan bertahan, sepasang
         -- dengan `butuh_tinjauan_pada` sebaris di atasnya. Baris `lunas` yang
         -- sudah bertanda `selisih_nominal` lalu gagal menerbitkan akses akan
         -- kehilangan alasan pertamanya kalau baris ini menugaskan telanjang.
         sebab_tinjauan = coalesce(o.sebab_tinjauan, 'akses_tertahan')
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

  return 'akses_tertahan';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2/3 — salurkan_pesanan: `penangan_belum_ada`
-- ---------------------------------------------------------------------------
create or replace function public.salurkan_pesanan(p_pesanan_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_padma_id text;
begin
  select c.padma_id into v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.id = p_pesanan_id;
  if v_padma_id is null then
    raise exception 'Pesanan % tidak ditemukan.', p_pesanan_id using errcode = 'P0002';
  end if;

  for r in
    select i.id, i.jenis
      from public.order_items i
     where i.pesanan_id = p_pesanan_id
     order by i.urutan
  loop
    case r.jenis
      when 'produk_digital' then
        perform public.terbitkan_akses_item(r.id);
      when 'sesi' then
        -- Nilai enum `sesi` lahir sebelum penulisnya (P3). Yang lahir di sini
        -- bukan penanganan diam-diam, melainkan panggilan kepada manusia.
        insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
        values (p_pesanan_id, v_padma_id, 'penangan_belum_ada',
                format('item %s berjenis sesi — P1 belum punya penyalurnya', r.id));

        -- Array POSITIF LIMA nilai — alasan yang sama persis dengan
        -- `terbitkan_akses_item` (lihat komentarnya): `status = any(...)` di
        -- sini adalah asumsi soal siapa pemanggil, bukan pagar CHECK, dan
        -- pemanggil kedua (Tugas 11) bisa mengenai baris yang tidak ada di
        -- ('lunas','ditahan'). Diam di sana berarti jejak tercatat tapi
        -- tinjauan tidak menyala.
        update public.orders o
           set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
               -- coalesce, alasan yang sama dengan `terbitkan_akses_item`:
               -- pesanan berisi DUA item bisa lebih dulu menyalakan tinjauan
               -- lewat item pertama, dan item kedua tidak boleh menimpanya.
               sebab_tinjauan = coalesce(o.sebab_tinjauan, 'penangan_belum_ada')
         where o.id = p_pesanan_id
           and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);
      else
        -- Nilai `order_item_source` KETIGA yang kelak lahir berhenti di sini
        -- dengan kalimat, bukan dengan `case_not_found` yang tidak menyebut
        -- apa pun. Fail-closed disengaja: diam berarti uang diambil untuk
        -- barang yang tidak ada yang tahu cara menyerahkannya.
        raise exception 'Jenis item pesanan % belum punya penyalur: %', r.id, r.jenis
          using errcode = 'P0001';
    end case;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/3 — terapkan_notifikasi_midtrans: `v_sebab` (refund/chargeback/asing),
--       `lunas_setelah_tutup`, dan `selisih_status` (transisi ditolak)
-- ---------------------------------------------------------------------------
create or replace function public.terapkan_notifikasi_midtrans(
  p_order_id text,
  p_transaction_status text,
  p_fraud_status text,
  p_transaction_id text,
  p_payment_type text,
  p_gross_amount numeric,
  p_sidik text,
  p_sumber text default 'webhook'
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_kode text;
  v_percobaan smallint;
  v_percobaan_kini smallint;
  v_pesanan_id uuid;
  v_status public.order_status;
  v_jumlah_item smallint;
  v_padma_id text;
  v_notif_id uuid;
  v_total integer;
  v_cacah integer;
  v_baris integer;
  v_vonis text;
  v_tujuan public.order_status;
  v_kejadian public.order_event;
  v_sebab text;
begin
  if p_sumber not in ('webhook', 'status_api') then
    raise exception 'Sumber notifikasi tidak dikenal: %', p_sumber using errcode = 'P0001';
  end if;

  -- (1) BENTUK order_id. Rute sudah menyaringnya sebelum satu sha512 pun
  -- dihitung, tapi Lapis 1b dan Lapis 3 memanggil fungsi ini juga. Bentuk yang
  -- tidak dikenal berarti tidak ada pesanan untuk disembuhkan — bukan galat
  -- yang layak di-retry.
  if p_order_id !~ '^PSN-[0-9]{6}-[0-9A-F]{6}\.[1-9]$' then
    return 'pesanan_tidak_ada';
  end if;
  v_kode := split_part(p_order_id, '.', 1);
  v_percobaan := split_part(p_order_id, '.', 2)::smallint;

  -- (2) Pesanan dicari lewat KODE saja, sengaja BUKAN kode+percobaan.
  -- Notifikasi bisa datang untuk percobaan lama (popup Snap lama yang masih
  -- terbuka saat klien menekan "coba lagi"), dan uang yang mendarat lewat
  -- percobaan lama tetap uang yang mendarat. Selisih percobaan dicatat di
  -- jejak, tidak dipakai untuk membuang notifikasinya.
  select o.id, o.status, o.percobaan, o.jumlah_item, c.padma_id
    into v_pesanan_id, v_status, v_percobaan_kini, v_jumlah_item, v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.kode = v_kode
   for update of o;

  if v_pesanan_id is null then
    return 'pesanan_tidak_ada';
  end if;

  -- (3) PEMERIKSAAN ULANG DICATAT SEBELUM PINTU SIDIK.
  -- Kalau `diperiksa_pada` hanya disetel pada jalur yang lolos sidik, Status
  -- API yang memulangkan status yang SAMA akan selalu 'duplikat', kolomnya
  -- tidak pernah bergerak, dan pembatas "sekali per lima menit" di Lapis 1b
  -- tidak pernah berlaku — satu halaman yang di-refresh berkali-kali berubah
  -- menjadi banjir permintaan ke Midtrans.
  if p_sumber = 'status_api' then
    update public.orders o
       set diperiksa_pada = now()
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'diperiksa_ulang',
            format('status api menjawab %s', p_transaction_status));
  end if;

  -- (4) IDEMPOTENSI. `sidik` dihitung di rute (Node crypto) atas lima medan
  -- notifikasi, BUKAN atas order_id saja: Midtrans mengirim beberapa
  -- notifikasi per pesanan (`pending` lalu `settlement`), dan sidik sepesanan
  -- akan menolak `settlement` sebagai duplikat — pembeli membayar, uang masuk,
  -- pesanan tinggal `menunggu_bayar` selamanya.
  insert into public.notifikasi_pesanan (
    pesanan_id, sidik, transaksi_id, status_midtrans, kanal, nominal_diterima
  ) values (
    v_pesanan_id, p_sidik, nullif(p_transaction_id, ''), p_transaction_status,
    nullif(p_payment_type, ''), p_gross_amount
  )
  on conflict (sidik) do nothing
  returning id into v_notif_id;

  if v_notif_id is null then
    return 'duplikat';
  end if;

  -- (5) Cermin kolom Midtrans pada barisnya. `status = any(<array positif>)`
  -- ditulis walau UPDATE ini tidak menyentuh status: nilai enum keenam yang
  -- kelak lahir tanpa diklasifikasikan jatuh ke luar array dan TIDAK mendapat
  -- cermin — kehilangan yang kecil dan terbatas, dibanding UPDATE tanpa pagar
  -- status yang menjadi kebiasaan lalu ditiru cabang yang benar-benar
  -- memindahkan baris.
  update public.orders o
     set notifikasi_pada  = case when p_sumber = 'webhook' then now() else o.notifikasi_pada end,
         transaksi_id     = coalesce(nullif(p_transaction_id, ''), o.transaksi_id),
         status_midtrans  = p_transaction_status,
         kanal            = coalesce(nullif(p_payment_type, ''), o.kanal)
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, 'notifikasi',
          p_transaction_status
          || coalesce(' / ' || nullif(p_fraud_status, ''), '')
          || case when v_percobaan <> v_percobaan_kini
                  then format(' (order_id percobaan %s, baris kini di %s)', v_percobaan, v_percobaan_kini)
                  else '' end);

  -- (6) VONIS. `fraud_status` ikut karena `capture`+`challenge` dan
  -- `capture`+`accept` adalah dua keputusan berbeda atas transaksi yang sama.
  if p_transaction_status = 'settlement'
     or (p_transaction_status = 'capture'
         and coalesce(nullif(p_fraud_status, ''), 'accept') = 'accept') then
    v_vonis := 'lunas';
  elsif p_transaction_status = 'capture' then
    -- capture + challenge/deny: uangnya ditahan Midtrans, bukan kita.
    v_vonis := 'curiga';
  elsif p_transaction_status in ('expire', 'cancel') then
    v_vonis := 'kedaluwarsa';
  elsif p_transaction_status = 'deny' then
    v_vonis := 'dibatalkan';
  elsif p_transaction_status in ('pending', 'authorize') then
    v_vonis := 'menunggu';
  elsif p_transaction_status in ('refund', 'partial_refund') then
    v_vonis := 'refund';
  elsif p_transaction_status in ('chargeback', 'partial_chargeback') then
    v_vonis := 'chargeback';
  else
    v_vonis := 'asing';
  end if;

  if v_vonis = 'menunggu' then
    return 'tanpa_efek';
  end if;

  -- Pengembalian uang & status asing: status TIDAK bergerak, akses TIDAK
  -- dicabut, manusia dipanggil. Repo ini tidak punya mekanisme pengembalian
  -- uang di mana pun; menebak kebijakannya di webhook lebih buruk daripada
  -- memanggil manusia.
  if v_vonis in ('refund', 'chargeback', 'asing') then
    v_sebab := case when v_vonis = 'asing' then 'selisih_status' else v_vonis end;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'selisih_status',
            format('midtrans menjawab %s — ditangani manusia', p_transaction_status));

    update public.orders o
       set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
           -- coalesce: INI kasus yang terjangkau hari ini tanpa satu baris kode
           -- baru. Notifikasi `refund`/`chargeback` yang mendarat pada pesanan
           -- yang sudah bertanda `lunas_setelah_tutup` menimpa alasannya, dan
           -- staf kehilangan satu-satunya petunjuk bahwa uang pernah masuk pada
           -- pesanan yang sudah ditutup.
           sebab_tinjauan = coalesce(o.sebab_tinjauan, v_sebab)
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

    return 'diterapkan';
  end if;

  -- (7) VERIFIKASI JUMLAH terhadap angka yang KITA simpan. Mustahil tanpa
  -- harga beku: angka pembandingnya ada di tangan Midtrans dan ikut
  -- ditandatangani. `nominal_diterima` sudah tersimpan di langkah (4) apa pun
  -- hasilnya di bawah.
  --
  -- Dihitung TANPA syarat vonis — bukan hanya di dalam `if v_vonis = 'lunas'`:
  -- cabang `curiga -> ditahan` (capture + challenge/deny) juga menulis baris
  -- audit `format('ditagih %s, diterima %s', v_total, ...)` di bawah, dan
  -- v_total yang hanya terisi pada jalur 'lunas' membuat baris yang staf baca
  -- untuk memutuskan pembayaran kartu yang dicurigai kehilangan separuh
  -- angkanya (tertagih kosong) — pada persis kasus yang paling butuh dibaca
  -- manusia.
  select coalesce(sum(i.harga_beku), 0)::integer, count(*)::integer
    into v_total, v_cacah
    from public.order_items i
   where i.pesanan_id = v_pesanan_id;

  if v_vonis = 'lunas' then
    if p_gross_amount is distinct from v_total::numeric or v_cacah <> v_jumlah_item then
      v_vonis := 'ditahan';
      v_sebab := 'selisih_nominal';
    end if;
  end if;

  if v_vonis = 'curiga' then
    v_vonis := 'ditahan';
    v_sebab := 'selisih_status';
  end if;

  if v_vonis = 'lunas' then
    v_tujuan := 'lunas'; v_kejadian := 'lunas';
  elsif v_vonis = 'ditahan' then
    v_tujuan := 'ditahan'; v_kejadian := 'ditahan';
  elsif v_vonis = 'kedaluwarsa' then
    v_tujuan := 'kedaluwarsa'; v_kejadian := 'kedaluwarsa';
  else
    v_tujuan := 'dibatalkan'; v_kejadian := 'dibatalkan';
  end if;

  -- (8a) Pesanan yang SUDAH TIDAK TERBUKA. Webhook tidak pernah memindahkan
  -- `ditahan` — itu putusan staf, dan satu-satunya jalannya
  -- `putuskan_pesanan_ditahan`.
  if v_status <> 'menunggu_bayar' then
    if v_vonis = 'lunas'
       and v_status = any (array['kedaluwarsa','dibatalkan']::public.order_status[]) then
      -- Settlement yang mendarat pada pesanan yang sudah kami tutup: tidak ada
      -- transisi, penyalur tidak berjalan, akses tidak terbit — dan tanpa
      -- penanda di bawah barisnya tidak muncul di blok mana pun meski uangnya
      -- sudah masuk.
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'lunas_setelah_tutup',
              format('settlement %s mendarat pada pesanan %s', p_transaction_id, v_status));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             -- coalesce: pesanan `dibatalkan` bisa sudah bertanda `selisih_status`
             -- dari notifikasi sebelumnya, dan alasan pertama itulah yang
             -- menjelaskan kenapa barisnya ditutup begitu.
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'lunas_setelah_tutup')
       where o.id = v_pesanan_id
         and o.status = any (array['kedaluwarsa','dibatalkan']::public.order_status[]);

    elsif v_status = 'ditahan' and v_vonis in ('lunas', 'ditahan') then
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'selisih_status',
              format('notifikasi %s mendarat pada pesanan yang sedang ditahan', p_transaction_status));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_status')
       where o.id = v_pesanan_id
         and o.status = any (array['ditahan']::public.order_status[]);
    end if;

    return 'tanpa_efek';
  end if;

  -- (8b) Penjaga transisi. `coalesce(..., false)` WAJIB: `not NULL` adalah
  -- NULL dan `if NULL then` tidak dieksekusi — tanpa pembungkus ini penjaganya
  -- fail-OPEN.
  if not coalesce(public.perpindahan_pesanan_sah(v_status, v_tujuan), false) then
    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'selisih_status',
            format('mesin status menolak %s -> %s', v_status, v_tujuan));

    update public.orders o
       set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
           -- coalesce: baris `menunggu_bayar` yang ditolak mesin status bisa
           -- sudah bertanda sebab lain (mis. `akses_tertahan` dari tombol
           -- "Terbitkan akses" Tugas 11), dan sebab pertama yang bertahan.
           sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_status')
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar']::public.order_status[]);

    return 'tanpa_efek';
  end if;

  update public.orders o
     set status = v_tujuan,
         ditutup_pada = now(),
         lunas_pada = case when v_tujuan = 'lunas' then now() else o.lunas_pada end,
         butuh_tinjauan_pada = case when v_sebab is null
                                    then o.butuh_tinjauan_pada
                                    else coalesce(o.butuh_tinjauan_pada, now()) end,
         sebab_tinjauan = coalesce(v_sebab, o.sebab_tinjauan)
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar']::public.order_status[]);

  get diagnostics v_baris = row_count;
  if v_baris = 0 then
    -- Balapan yang kalah: barisnya sudah dipindahkan transaksi lain. Keadaan
    -- akhir sudah tercapai, dan 200 adalah jawabannya.
    return 'tanpa_efek';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, v_kejadian,
          format('midtrans %s, transaksi %s', p_transaction_status, p_transaction_id));

  if v_sebab is not null then
    -- Aturan penanda tinjauan: kelima kejadian dalam KEJADIAN_BUTUH_TINJAUAN
    -- WAJIB menyetel butuh_tinjauan_pada + sebab_tinjauan di transaksi yang
    -- sama dengan jejaknya. Penandanya sudah disetel UPDATE di atas.
    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, v_sebab::public.order_event,
            format('ditagih %s, diterima %s', v_total, p_gross_amount));
  end if;

  -- (9) PENYALURAN, di transaksi yang SAMA, dan HANYA dari cabang yang
  -- benar-benar memindahkan baris.
  if v_tujuan = 'lunas' then
    perform public.salurkan_pesanan(v_pesanan_id);
  end if;

  return 'diterapkan';
end;
$$;
```

Terapkan lalu jalankan lagi:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase migration up && npx vitest run tests/admin-pesanan.test.tsx tests/fungsi-mesin-tertutup.test.ts
```

Keduanya hijau. `fungsi-mesin-tertutup` ikut karena migrasi ini menyentuh tiga fungsi yang ada
di daftar `MESIN_TERTUTUP`-nya: kalau `create or replace` tanpa sengaja berubah jadi
`drop` + `create`, di sanalah merahnya muncul. `migration up` dipakai, **bukan `db reset`** —
Supabase lokal di mesin ini dipakai bersama sesi lain.

- [ ] **Step 4: Tulis pembaca layar staf**

Buat `/Users/arvinfairuz/Documents/padma/web/src/lib/admin/pesanan.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import {
  PESANAN_BERUANG,
  PESANAN_TERBUKA,
  type StatusPesanan,
  type SumberItemPesanan,
} from "@/lib/pesanan/status";

/**
 * PEMBACA LAYAR PESANAN STAF (Lapis 2, spec "Rekonsiliasi — empat lapis").
 *
 * Seluruhnya dibaca dengan SESI PEMANGGIL — nol service role. Policy
 * `"pesanan: staf baca"`, `"jejak pesanan: staf baca"` dan
 * `"notifikasi pesanan: staf baca"` yang memutuskan, jadi admin yang perannya
 * dicabut kehilangan layar ini seketika tanpa satu baris kode pun berubah.
 *
 * Nominal DIPULANGKAN sebagai angka, bukan sebagai teks berformat: pemformatan
 * tinggal di komponen (`tabel-pesanan.tsx`), supaya modul ini tetap bisa
 * dipakai pemanggil yang menghitung, bukan yang menampilkan. Kenapa nominalnya
 * ada sama sekali di layar admin — lihat dokblok `tests/admin-pesanan.test.tsx`.
 */

export type ItemPesanan = {
  pesananId: string;
  kode: string;
  jenis: SumberItemPesanan;
  judulBeku: string;
  hargaBeku: number;
  urutan: number;
};

export type BarisPesanan = {
  id: string;
  kode: string;
  status: StatusPesanan;
  percobaan: number;
  /** "" berarti embed-nya TIDAK terbaca, bukan "klien tanpa PADMA ID". */
  padmaId: string;
  jumlahItem: number;
  dibuatPada: string;
  kedaluwarsaPada: string;
  lunasPada: string | null;
  diperiksaPada: string | null;
  butuhTinjauanPada: string | null;
  sebabTinjauan: string | null;
  kanal: string | null;
  transaksiId: string | null;
  statusMidtrans: string | null;
  items: ItemPesanan[];
  nominalTagih: number;
  /** null = belum ada notifikasi bernominal. BUKAN nol. */
  nominalDiterima: number | null;
};

type BarisOrders = {
  id: string;
  kode: string;
  status: StatusPesanan;
  percobaan: number;
  jumlah_item: number;
  dibuat_pada: string;
  kedaluwarsa_pada: string;
  lunas_pada: string | null;
  diperiksa_pada: string | null;
  butuh_tinjauan_pada: string | null;
  sebab_tinjauan: string | null;
  kanal: string | null;
  transaksi_id: string | null;
  status_midtrans: string | null;
  clients: { padma_id: string } | null;
};

const KOLOM =
  "id, kode, status, percobaan, jumlah_item, dibuat_pada, kedaluwarsa_pada, lunas_pada, " +
  "diperiksa_pada, butuh_tinjauan_pada, sebab_tinjauan, kanal, transaksi_id, status_midtrans, " +
  "clients ( padma_id )";

/**
 * Status yang selalu ikut dibaca, apa pun penanda tinjauannya — DITURUNKAN
 * dari himpunan Tugas 1, bukan diketik ulang.
 *
 * Ini bukan kerapian. Keempat himpunan itu lahir untuk mencegah satu pelajaran
 * yang repo ini sudah bayar sekali: nilai enum baru membuat konstanta tunggal
 * salah DIAM-DIAM. Dengan daftar hard-coded di sini, P3 yang menambah nilai
 * keenam `order_status` (mis. `sebagian_lunas`) akan memerahkan uji partisi
 * Tugas 1 — bagus — lalu orang menambahkannya ke `PESANAN_TIDAK_AKTIF` dan
 * suite hijau lagi, sementara layar ini tidak pernah menampilkannya di blok
 * mana pun. Pesanan beruang menghilang dari layar: persis kegagalan yang
 * himpunan itu katakan sedang dicegahnya.
 *
 * Diturunkan, BUKAN diberi nama sendiri sebagai himpunan kelima: himpunan
 * turunan yang punya namanya sendiri adalah tempat kedua yang bisa basi.
 */
const STATUS_DIPANTAU: StatusPesanan[] = [...PESANAN_TERBUKA, ...PESANAN_BERUANG];

/** Dua kejadian yang berarti "akses sudah diurus"; sisanya berarti belum. */
const KEJADIAN_AKSES = ["akses_terbit", "akses_sudah_ada"];

const BATAS_BARIS = 200;

export async function bacaPesananStaf(): Promise<{
  butuhPerhatian: BarisPesanan[];
  terbuka: BarisPesanan[];
}> {
  const sb = await createServerSupabase();

  // DUA kueri, bukan satu `or(...)`. Satu `or` yang memuat `status.in.(…)`
  // menitipkan pemisahan koma-di-dalam-kurung kepada parser PostgREST, dan
  // salah tulis satu kurung di sana tidak menghasilkan galat melainkan
  // saringan yang DIAM-DIAM lebih longgar. Dua kueri yang masing-masing
  // sederhana lebih murah dibaca daripada satu yang harus dipercaya.
  const [ditandai, dipantau] = await Promise.all([
    sb
      .from("orders")
      .select(KOLOM)
      .not("butuh_tinjauan_pada", "is", null)
      .order("butuh_tinjauan_pada", { ascending: true })
      .limit(BATAS_BARIS)
      .returns<BarisOrders[]>(),
    sb
      .from("orders")
      .select(KOLOM)
      .in("status", STATUS_DIPANTAU)
      .order("dibuat_pada", { ascending: false })
      .limit(BATAS_BARIS)
      .returns<BarisOrders[]>(),
  ]);
  // Galat DIBACA, bukan dibuang (pola `lib/admin/tagihan-pengajuan.ts:103-123`).
  // Layar yang kosong karena PostgREST gagal terlihat persis seperti layar yang
  // kosong karena memang tidak ada masalah — dan di layar ini "tidak ada
  // masalah" adalah kalimat tentang uang orang.
  if (ditandai.error) throw ditandai.error;
  if (dipantau.error) throw dipantau.error;

  const perId = new Map<string, BarisOrders>();
  for (const b of [...(ditandai.data ?? []), ...(dipantau.data ?? [])]) perId.set(b.id, b);
  const ids = [...perId.keys()];
  if (ids.length === 0) return { butuhPerhatian: [], terbuka: [] };

  const [item, notifikasi, jejak] = await Promise.all([
    sb
      .from("pesanan_item_staf")
      .select("pesanan_id, kode, jenis, judul_beku, harga_beku, urutan")
      .in("pesanan_id", ids)
      .order("urutan", { ascending: true }),
    sb
      .from("notifikasi_pesanan")
      .select("pesanan_id, nominal_diterima, diterima_pada")
      .in("pesanan_id", ids)
      .not("nominal_diterima", "is", null)
      .order("diterima_pada", { ascending: false }),
    sb
      .from("jejak_pesanan")
      .select("pesanan_id, kejadian")
      .in("pesanan_id", ids)
      .in("kejadian", KEJADIAN_AKSES),
  ]);
  if (item.error) throw item.error;
  if (notifikasi.error) throw notifikasi.error;
  if (jejak.error) throw jejak.error;

  const itemPer = new Map<string, ItemPesanan[]>();
  for (const r of item.data ?? []) {
    const daftar = itemPer.get(r.pesanan_id as string) ?? [];
    daftar.push({
      pesananId: r.pesanan_id as string,
      kode: r.kode as string,
      jenis: r.jenis as SumberItemPesanan,
      judulBeku: r.judul_beku as string,
      hargaBeku: Number(r.harga_beku),
      urutan: Number(r.urutan),
    });
    itemPer.set(r.pesanan_id as string, daftar);
  }

  // Notifikasi TERAKHIR yang bernominal, bukan penjumlahan: satu pesanan bisa
  // menerima `pending` lalu `settlement`, dan yang jadi keputusan manusia
  // adalah angka terakhir yang benar-benar masuk.
  const diterimaPer = new Map<string, number>();
  for (const r of notifikasi.data ?? []) {
    const kunci = r.pesanan_id as string;
    if (!diterimaPer.has(kunci)) diterimaPer.set(kunci, Number(r.nominal_diterima));
  }

  const punyaAkses = new Set((jejak.data ?? []).map((r) => r.pesanan_id as string));

  const semua: BarisPesanan[] = [...perId.values()].map((b) => {
    const items = itemPer.get(b.id) ?? [];
    return {
      id: b.id,
      kode: b.kode,
      status: b.status,
      percobaan: b.percobaan,
      // Embed yang ditolak RLS memulangkan NULL, bukan galat — pelajaran repo.
      // "" diteruskan apa adanya ke komponen, yang merendernya sebagai
      // kegagalan baca yang TERLIHAT, bukan sebagai sel kosong.
      padmaId: b.clients?.padma_id ?? "",
      jumlahItem: b.jumlah_item,
      dibuatPada: b.dibuat_pada,
      kedaluwarsaPada: b.kedaluwarsa_pada,
      lunasPada: b.lunas_pada,
      diperiksaPada: b.diperiksa_pada,
      butuhTinjauanPada: b.butuh_tinjauan_pada,
      sebabTinjauan: b.sebab_tinjauan,
      kanal: b.kanal,
      transaksiId: b.transaksi_id,
      statusMidtrans: b.status_midtrans,
      items,
      // Dijumlahkan dari `harga_beku`, karena `orders` memang lahir NOL kolom
      // nominal (spec "Bentuk data / orders").
      nominalTagih: items.reduce((n, i) => n + i.hargaBeku, 0),
      nominalDiterima: diterimaPer.has(b.id) ? diterimaPer.get(b.id)! : null,
    };
  });

  /**
   * DUA klausa, dan yang kedua tidak bergantung pada siapa pun mengingat:
   * uang sudah masuk (`PESANAN_BERUANG`) dan aksesnya belum tercatat terbit
   * (`akses_terbit`/`akses_sudah_ada`). Ia tetap terlihat walau penanda
   * tinjauannya sudah dikosongkan — dua pagar untuk satu lubang, karena
   * lubang ini memakan uang orang.
   *
   * Keduanya ditulis lewat himpunan Tugas 1, nol literal status: nilai enum
   * keenam yang kelak diklasifikasikan "beruang" ikut terlihat tanpa satu
   * baris pun disunting, dan itulah seluruh alasan himpunan itu ada.
   */
  const butuhPerhatian = semua.filter(
    (p) =>
      p.butuhTinjauanPada !== null ||
      // `PESANAN_BERUANG`, bukan literal "ditahan" + literal "lunas".
      // Himpunan itu berarti UANG SUDAH MASUK, dan aturannya satu kalimat:
      // uang masuk yang aksesnya belum tercatat terbit selalu terlihat.
      //
      // Ia menggantikan DUA klausa lama (`status === "ditahan"` tanpa syarat,
      // dan `status === "lunas" && belum ada akses`) dengan hasil yang sama
      // untuk data hari ini — `ditahan` tidak pernah punya jejak
      // `akses_terbit`/`akses_sudah_ada`, karena penyalur hanya berjalan pada
      // transisi ke `lunas` dan keadaan (3) menulis `akses_tertahan` yang
      // bukan anggota KEJADIAN_AKSES. Bedanya ada di masa depan: nilai enum
      // keenam yang kelak diklasifikasikan "beruang" ikut terlihat di sini
      // tanpa satu baris pun disunting, sementara dua literal akan
      // menghilangkannya dari layar diam-diam.
      (PESANAN_BERUANG.includes(p.status) && !punyaAkses.has(p.id)),
  );

  // Satu pesanan boleh muncul di KEDUA blok (mis. `menunggu_bayar` yang
  // bertanda tinjauan). Menyembunyikannya dari "Terbuka" akan membuat blok itu
  // berbohong soal berapa pesanan yang sedang menunggu pembayaran.
  const terbuka = semua
    .filter((p) => PESANAN_TERBUKA.includes(p.status))
    .sort((a, b) => {
      // `diperiksa_pada nulls first`: yang belum pernah diperiksa sama sekali
      // adalah yang paling mungkin menggantung tanpa ada yang tahu.
      if (a.diperiksaPada === null && b.diperiksaPada === null) {
        return a.dibuatPada.localeCompare(b.dibuatPada);
      }
      if (a.diperiksaPada === null) return -1;
      if (b.diperiksaPada === null) return 1;
      return a.diperiksaPada.localeCompare(b.diperiksaPada);
    });

  return { butuhPerhatian, terbuka };
}
```

- [ ] **Step 5: Tulis tombolnya (komponen klien)**

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/admin/pesanan/tombol-pesanan.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PESANAN_TERBUKA, type StatusPesanan } from "@/lib/pesanan/status";

/**
 * Pemecah `PESANAN_BERUANG`, dan satu-satunya tempat di berkas ini yang
 * menyebut nama status.
 *
 * Kenapa bukan himpunan seperti di `bacaPesananStaf`: "Periksa ulang" memang
 * bisa dinyatakan dengan `PESANAN_TERBUKA` (lihat JSX di bawah), tapi kedua
 * anggota `PESANAN_BERUANG` menuntut tombol yang BERLAWANAN — `lunas`
 * menerbitkan barangnya, `ditahan` justru meminta manusia memutuskan lebih
 * dulu. Himpunan Tugas 1 sengaja tidak memecah keduanya, dan §0.6 melarang
 * melahirkan himpunan kelima yang bernama lain di sini.
 *
 * Yang memaksa kelengkapannya karena itu `Record` BERTIPE PENUH, mekanisme
 * yang sama dengan `LABEL_STATUS_PESANAN` di `status.ts`: nama status hidup
 * sebagai KUNCI yang diperiksa kompilator, bukan sebagai literal yang
 * dibandingkan. Nilai enum keenam memerahkan berkas ini sampai seseorang
 * memutuskan tombol apa yang pantas untuknya — alih-alih menghilangkan
 * tombolnya dari layar staf tanpa suara.
 */
const TOMBOL_BERUANG: Record<StatusPesanan, "akses" | "putusan" | null> = {
  menunggu_bayar: null,
  ditahan: "putusan",
  lunas: "akses",
  kedaluwarsa: null,
  dibatalkan: null,
};

/**
 * Empat tindakan pemulihan Lapis 2, masing-masing dengan alamatnya sendiri.
 *
 * ===== KENAPA fetch KE RUTE, BUKAN SERVER ACTION =====
 * Dua di antaranya (periksa ulang, terbitkan akses) menulis lewat FUNGSI MESIN
 * yang tertutup bagi `authenticated` — `terapkan_notifikasi_midtrans` dan
 * `terbitkan_akses_item` ada di `MESIN_TERTUTUP`
 * (`tests/fungsi-mesin-tertutup.test.ts`), jadi keduanya menuntut service role.
 * Dan `tests/admin-shell.test.ts:643` melarang service role di seluruh
 * `src/app/admin/**`. Rute di `src/app/api/**` adalah satu-satunya tempat
 * keduanya boleh bertemu.
 *
 * ===== TOMBOL DIRENDER BERSYARAT =====
 * Bukan karena tampilan adalah pagar — setiap rute memeriksa syaratnya sendiri
 * — melainkan karena menawarkan tombol yang pasti ditolak adalah janji yang
 * tidak akan ditepati. `Tutup tinjauan` khususnya: pada baris `ditahan` ia
 * ditolak `P0001`, dan seandainya tidak ditolak ia akan mengubur pesanan yang
 * uangnya sudah di tangan Midtrans dan barangnya belum keluar.
 *
 * ===== NOL LITERAL STATUS =====
 * Tidak satu pun cabang di bawah membandingkan `status` dengan string yang
 * diketik di tempat. Pelajaran repo yang sudah dibayar sekali: nilai enum baru
 * membuat konstanta tunggal salah DIAM-DIAM — dan di layar ini bentuk salahnya
 * adalah tombol pemulihan yang berhenti muncul untuk status yang justru paling
 * butuh dipulihkan, tanpa satu pun galat.
 */
export function TombolPesanan({
  pesananId,
  status,
  butuhTinjauan,
}: {
  pesananId: string;
  status: StatusPesanan;
  butuhTinjauan: boolean;
}) {
  const router = useRouter();
  const [menyegarkan, mulai] = useTransition();
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  async function kirim(jalur: string, badan?: unknown) {
    setPesan(null);
    setSibuk(true);
    try {
      const res = await fetch(`/api/pesanan/${pesananId}/${jalur}`, {
        method: "POST",
        headers: badan ? { "content-type": "application/json" } : undefined,
        body: badan ? JSON.stringify(badan) : undefined,
      });
      const isi = (await res.json().catch(() => ({}))) as { pesan?: string };
      if (!res.ok) {
        // Kalimat rute diteruskan apa adanya: rute yang menolak sudah menulis
        // alasannya untuk dibaca manusia, dan menggantinya dengan "Gagal."
        // membuang justru bagian yang berguna.
        setPesan(isi.pesan ?? "Tindakan gagal dijalankan.");
        return;
      }
      mulai(() => router.refresh());
    } catch {
      setPesan("Jaringan tidak menjawab. Coba lagi.");
    } finally {
      setSibuk(false);
    }
  }

  const mati = sibuk || menyegarkan;
  const kelas =
    "min-h-[36px] rounded-lg border border-panel-border bg-panel-bg px-3 text-[12px] font-bold text-panel-ink disabled:opacity-60";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {PESANAN_TERBUKA.includes(status) && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("periksa-ulang")}>
            Periksa ulang
          </button>
        )}
        {TOMBOL_BERUANG[status] === "akses" && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("terbitkan-akses")}>
            Terbitkan akses
          </button>
        )}
        {TOMBOL_BERUANG[status] === "putusan" && (
          <>
            <button
              type="button"
              disabled={mati}
              className={kelas}
              onClick={() => void kirim("putuskan", { putusan: "lunas" })}
            >
              Putuskan lunas
            </button>
            <button
              type="button"
              disabled={mati}
              className={kelas}
              onClick={() => void kirim("putuskan", { putusan: "dibatalkan" })}
            >
              Putuskan batal
            </button>
          </>
        )}
        {butuhTinjauan && TOMBOL_BERUANG[status] !== "putusan" && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("tutup-tinjauan")}>
            Tutup tinjauan
          </button>
        )}
      </div>
      {pesan && <p className="text-[11.5px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Tulis tabelnya**

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/admin/pesanan/tabel-pesanan.tsx`:

```tsx
import { formatRupiah } from "@/lib/rupiah-publik";
import { LABEL_STATUS_PESANAN, type StatusPesanan } from "@/lib/pesanan/status";
import type { BarisPesanan } from "@/lib/admin/pesanan";
import { TombolPesanan } from "./tombol-pesanan";

/**
 * Tabel pesanan staf — satu-satunya permukaan admin PADMA yang menampilkan
 * nominal PESANAN (yang ditagih dan yang diterima), dan satu-satunya tempat di
 * seluruh aplikasi dua angka uang perlu dibaca BERDAMPINGAN.
 *
 * Bukan satu-satunya layar admin bernominal, dan klaim itu sengaja tidak
 * ditulis: `/admin/produk` sudah menampilkan harga hari ini (README.md:134,
 * "harga TAMPIL tapi tidak bisa disunting admin"), dan empat berkas di
 * `src/app/admin/**` sudah mengimpor `formatRupiah`. Yang baru di sini adalah
 * nominal PESANAN — uang yang benar-benar berpindah — bukan nominal apa pun.
 *
 * `formatRupiah` diimpor dari `@/lib/rupiah-publik` dan itu memang ganjil
 * dibaca sekilas di bawah `src/app/admin/**` — lihat dokblok berkas itu.
 * Keganjilannya disengaja dan dicatat di sini: pengecualian ini adalah
 * keputusan pemilik repo (spec 26 Sep 2026, "Catatan: nominal di layar staf"),
 * dan ia dijaga uji yang assertionnya KEBALIKAN konvensi rumah
 * (`tests/admin-pesanan.test.tsx`). Yang TIDAK berubah: honor mitra tidak
 * pernah lewat sini, dan `orders` sendiri lahir nol kolom nominal.
 *
 * Komponen SERVER: ia tidak mengoper satu pun prop berisi fungsi
 * (`tests/pagar-batas-server-klien.test.ts`). Yang interaktif hidup utuh di
 * `TombolPesanan`.
 */
const KELAS_PILL: Record<StatusPesanan, string> = {
  menunggu_bayar: "bg-[#F7EDD3] text-[#8A6A1B]",
  // Merah bata, sama dengan "belum dibayar" di modul bayar: `ditahan` berarti
  // uang masuk tapi barang belum keluar — keadaan paling mendesak di tabel ini.
  ditahan: "bg-clay/10 text-clay",
  lunas: "bg-leaf-soft text-leaf",
  kedaluwarsa: "bg-panel-bg text-panel-muted",
  dibatalkan: "bg-panel-bg text-panel-muted",
};

export function TabelPesanan({ baris }: { baris: BarisPesanan[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-panel-border bg-panel-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-panel-border bg-panel-bg text-[11px] uppercase tracking-wider text-panel-muted">
              <th className="p-4 text-left font-extrabold">Pesanan</th>
              <th className="p-4 text-left font-extrabold">Item</th>
              <th className="p-4 text-left font-extrabold">Status</th>
              <th className="p-4 text-left font-extrabold">Nominal</th>
              <th className="p-4 text-left font-extrabold">Tindakan</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((p) => (
              <tr
                key={p.id}
                data-pesanan={p.kode}
                data-status={p.status}
                className="border-b border-panel-border/70 align-top"
              >
                <td className="p-4">
                  <b className="font-mono text-[12.5px]">{p.kode}</b>
                  {p.padmaId === "" ? (
                    // Embed PostgREST yang ditolak RLS memulangkan null, bukan
                    // galat. Sel kosong akan terbaca sebagai "klien ini memang
                    // tidak punya PADMA ID" — kalimat yang berbeda, dan yang
                    // menuntut tindakan berbeda.
                    <span className="mt-0.5 block text-[11px] font-bold text-clay">
                      PADMA ID tidak terbaca
                    </span>
                  ) : (
                    <span className="mt-0.5 block font-mono text-[11px] text-panel-muted">
                      {p.padmaId}
                    </span>
                  )}
                  {p.percobaan > 1 && (
                    <span className="mt-0.5 block text-[11px] text-panel-muted">
                      Percobaan ke-{p.percobaan}
                    </span>
                  )}
                </td>

                <td className="p-4">
                  {p.items.map((i) => (
                    <span key={`${i.pesananId}-${i.urutan}`} className="block">
                      {i.judulBeku}
                      <span className="ml-1.5 text-[11.5px] text-panel-muted">
                        {formatRupiah(i.hargaBeku)}
                      </span>
                    </span>
                  ))}
                  {p.items.length === 0 && (
                    <span className="text-[11.5px] italic text-clay">Item tidak terbaca</span>
                  )}
                </td>

                <td className="p-4">
                  <span
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ${KELAS_PILL[p.status]}`}
                  >
                    {LABEL_STATUS_PESANAN[p.status]}
                  </span>
                  {p.sebabTinjauan && (
                    <span className="mt-1 block font-mono text-[11px] font-bold text-clay">
                      {p.sebabTinjauan}
                    </span>
                  )}
                  {p.kanal && (
                    <span className="mt-0.5 block text-[11px] text-panel-muted">{p.kanal}</span>
                  )}
                </td>

                <td className="p-4">
                  <span className="block font-bold">{formatRupiah(p.nominalTagih)}</span>
                  <span className="text-[11px] text-panel-muted">Ditagih</span>
                  {p.nominalDiterima !== null && (
                    // BERDAMPINGAN, bukan menggantikan: selisih kedua angka
                    // inilah yang menjadi keputusan manusia pada baris
                    // `ditahan`. Tanpa keduanya, staf tetap harus membuka
                    // dashboard Midtrans untuk tahu berapa yang benar-benar
                    // masuk.
                    <>
                      <span className="mt-1 block font-bold text-clay">
                        {formatRupiah(p.nominalDiterima)}
                      </span>
                      <span className="text-[11px] text-panel-muted">Diterima</span>
                    </>
                  )}
                </td>

                <td className="p-4">
                  <TombolPesanan
                    pesananId={p.id}
                    status={p.status}
                    butuhTinjauan={p.butuhTinjauanPada !== null}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Tulis halamannya**

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/admin/pesanan/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { bacaPesananStaf } from "@/lib/admin/pesanan";
import { TabelPesanan } from "./tabel-pesanan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pesanan" };

/**
 * LAPIS 2 — REKONSILIASI YANG DIPICU MANUSIA (spec 26 Sep 2026).
 *
 * DUA BLOK, bukan satu saringan. "Butuh perhatian" menjawab "apa yang salah";
 * "Terbuka" menjawab "apa yang sedang berjalan". Meleburnya jadi satu daftar
 * bersaringan berarti pesanan yang uangnya sudah masuk berbaris di antara
 * pesanan yang belum dibayar, dan yang mendesak berhenti terlihat mendesak.
 */
export default async function PesananPage() {
  await requireRole(["admin", "owner"]);

  const { butuhPerhatian, terbuka } = await bacaPesananStaf();

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Pesanan</h1>
        <Bantuan judul="Tentang halaman ini">
          Pembayaran produk digital berjalan sendiri lewat Midtrans; halaman ini hanya untuk
          yang <b>tidak</b> berjalan sendiri. <b>Butuh perhatian</b> memuat pesanan yang
          uangnya sudah masuk tapi barangnya belum keluar — <b>Ditahan</b> (nominalnya tidak
          cocok), pesanan bertanda tinjauan, dan pesanan <b>Lunas</b> yang aksesnya tidak
          pernah terbit. <b>Terbuka</b> memuat yang masih menunggu pembayaran, yang paling
          lama tidak diperiksa di atas.
          {" "}
          <b>Periksa ulang</b> menanyakan keadaan transaksi ke Midtrans lalu menjalankan
          jawabannya — vonisnya tetap datang dari Midtrans, bukan dari tombol ini.{" "}
          <b>Terbitkan akses</b> menerbitkan ulang akses produk untuk pesanan yang sudah
          lunas. <b>Putuskan</b> hanya untuk baris Ditahan, dan nama Anda ikut tercatat.{" "}
          <b>Tutup tinjauan</b> mengosongkan penanda tanpa menyentuh status — ia sengaja
          menolak baris Ditahan, karena pesanan Ditahan menuntut putusan, bukan penutupan.
          {" "}
          Nominal pesanan ditampilkan di halaman ini — satu-satunya di panel admin yang
          menunjukkan yang ditagih bersebelahan dengan yang diterima — karena
          pertanyaan &ldquo;berapa yang klien ini bayar&rdquo; harus bisa dijawab dari dalam
          PADMA, bukan dari dashboard Midtrans. Pengembalian uang tidak dilakukan dari sini;
          yang disediakan hanyalah nomor transaksi untuk diurus di dashboard Midtrans.
        </Bantuan>
      </header>

      <section aria-label="Butuh perhatian" className="mb-6">
        <h2 className="mb-2 text-[15px] font-bold text-panel-ink">
          Butuh perhatian — uang masuk, barang belum keluar
        </h2>
        {butuhPerhatian.length === 0 ? (
          <p className="rounded-lg border border-panel-border bg-panel-surface p-6 text-center text-[13px] italic text-panel-muted">
            Tidak ada pesanan yang menunggu keputusan.
          </p>
        ) : (
          <TabelPesanan baris={butuhPerhatian} />
        )}
      </section>

      <section aria-label="Terbuka">
        <h2 className="mb-2 text-[15px] font-bold text-panel-ink">
          Terbuka — menunggu pembayaran
        </h2>
        {terbuka.length === 0 ? (
          <p className="rounded-lg border border-panel-border bg-panel-surface p-6 text-center text-[13px] italic text-panel-muted">
            Tidak ada pesanan yang sedang menunggu pembayaran.
          </p>
        ) : (
          <TabelPesanan baris={terbuka} />
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Tulis rute "periksa ulang" dan "terbitkan akses"**

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/api/pesanan/[id]/periksa-ulang/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  terapkanJawabanMidtrans,
  type HasilPeriksaPesanan,
} from "@/lib/pesanan/periksa-menggantung";

export const runtime = "nodejs";

/**
 * PERIKSA ULANG — RUTE, BUKAN RPC BERPARAMETER STATUS (spec "Rekonsiliasi").
 *
 * Vonis Midtrans tidak boleh jadi parameter yang dikirim pemanggil bersesi,
 * atau admin mana pun bisa mencetak `lunas` dengan satu curl. Karena itu yang
 * dikirim dari layar hanyalah ID pesanan; yang menentukan hasilnya adalah
 * Status API Midtrans, dan jawabannya masuk lewat `terapkan_notifikasi_midtrans`
 * — fungsi yang tertutup bagi `authenticated` justru supaya begitu.
 *
 * Hidup di `src/app/api/**`, bukan `src/app/admin/**`: larangan service role
 * (`tests/admin-shell.test.ts:643`) tidak tersentuh.
 */
const PESAN: Record<HasilPeriksaPesanan, string> = {
  diterapkan: "Jawaban Midtrans diterapkan.",
  duplikat: "Notifikasi itu sudah pernah diproses sebelumnya.",
  tanpa_efek: "Tidak ada yang berubah — keadaan pesanan sudah sesuai jawaban Midtrans.",
  pesanan_tidak_ada: "Midtrans tidak mengenali nomor pesanan ini.",
  // Bukan kegagalan Midtrans, melainkan baris kita sendiri yang cacat — dan
  // kalimatnya harus menyuruh manusia melihat barisnya, bukan mencoba lagi.
  bentuk_order_id:
    "Nomor pesanan ini tidak berbentuk sah, jadi Midtrans tidak bisa ditanyai. Periksa barisnya.",
  belum_kedaluwarsa:
    "Midtrans belum mengenal transaksinya, dan tenggang satu jam sesudah tenggat belum lewat.",
  midtrans_tak_terjawab: "Midtrans tidak menjawab. Coba lagi beberapa saat lagi.",
  // Kalimat yang SAMA PERSIS dengan yang sudah dipilih `terbitkanTokenSnap`
  // (Tugas 8) untuk keadaan yang sama, dan sengaja TIDAK menyuruh mencoba
  // lagi: `MIDTRANS_SERVER_KEY` yang belum terpasang tidak berubah karena
  // tombolnya ditekan ulang. Satu-satunya tindakan yang menolong adalah
  // memanggil orang yang bisa memasang env-nya.
  kunci_belum_terpasang: "Pembayaran belum aktif. Hubungi tim PADMA.",
  galat_basis_data: "Jawaban Midtrans gagal diterapkan.",
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  // Barisnya dibaca dengan SESI PEMANGGIL — policy "pesanan: staf baca" yang
  // memutuskan, bukan perbandingan yang ditulis di sini. Service role baru
  // muncul di dalam `terapkanJawabanMidtrans`, sesudah haknya diputuskan RLS.
  const sb = await createServerSupabase();
  const { data: pesanan } = await sb
    .from("orders")
    .select("id, kode, percobaan, kedaluwarsa_pada")
    .eq("id", id)
    .maybeSingle<{ id: string; kode: string; percobaan: number; kedaluwarsa_pada: string }>();
  if (!pesanan) {
    return NextResponse.json({ pesan: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  const hasil = await terapkanJawabanMidtrans({
    id: pesanan.id,
    kode: pesanan.kode,
    percobaan: pesanan.percobaan,
    kedaluwarsaPada: pesanan.kedaluwarsa_pada,
  });

  // 502, bukan 200: "sudah diperiksa" untuk pemeriksaan yang tidak pernah
  // terjadi membuat staf berhenti memeriksanya.
  if (hasil === "midtrans_tak_terjawab") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 502 });
  }
  // 503, angka yang sama dengan jawaban rute webhook untuk keadaan yang sama
  // (`kunci_kosong`, Tugas 8), dan BUKAN 200 — `tombol-pesanan.tsx` hanya
  // menampilkan `pesan` ketika `res.ok` bernilai false, jadi 200 di sini
  // membuat kalimat "Pembayaran belum aktif" tidak pernah sampai ke layar dan
  // tombolnya terlihat berhasil. Bukan 502: tidak ada gerbang hulu yang gagal,
  // yang belum siap adalah SERVER INI.
  if (hasil === "kunci_belum_terpasang") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 503 });
  }
  // 500: yang rusak adalah baris kita, bukan pihak ketiga, dan tidak ada yang
  // bisa disembuhkan dengan menekan tombolnya lagi.
  if (hasil === "bentuk_order_id") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 500 });
  }
  if (hasil === "galat_basis_data") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 500 });
  }
  return NextResponse.json({ hasil, pesan: PESAN[hasil] });
}
```

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/api/pesanan/[id]/terbitkan-akses/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * TERBITKAN ULANG AKSES (Lapis 2).
 *
 * ===== KENAPA terbitkan_akses_item, BUKAN salurkan_pesanan =====
 * Penyalur di-key pada TRANSISI, bukan pada niat: ia hanya dipanggil dari
 * cabang `terapkan_notifikasi_midtrans` yang benar-benar memindahkan baris
 * (spec, "Kejadian dan penyaluran"). Memanggilnya dari sini akan membuat
 * kalimat itu tidak lagi benar, dan kalimat itulah yang membuat "lunas tanpa
 * akses" mustahil alih-alih sekadar jarang. Jadi tombol ini memanggil
 * `terbitkan_akses_item` LANGSUNG, satu per item.
 *
 * `order_items` lahir NOL GRANT dan NOL POLICY, jadi id itemnya hanya bisa
 * dibaca service role — dan view `pesanan_item_staf` sengaja tidak
 * memproyeksikan kolom id. Urutannya karena itu mengikat: peran diputuskan
 * `requireRole`, kepemilikan barisnya diputuskan RLS lewat sesi pemanggil,
 * BARU service role menyentuh `order_items`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const sb = await createServerSupabase();
  const { data: pesanan } = await sb
    .from("orders")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string }>();
  if (!pesanan) {
    return NextResponse.json({ pesan: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  // Tombolnya memang hanya dirender untuk baris `lunas`, tetapi rute adalah
  // endpoint MANDIRI: tanpa gerbang ini, satu curl sudah cukup memberikan
  // barang yang belum dibayar.
  if (pesanan.status !== "lunas") {
    return NextResponse.json(
      { pesan: "Akses hanya bisa diterbitkan untuk pesanan yang sudah lunas." },
      { status: 409 },
    );
  }

  const admin = createAdminSupabase();
  const { data: item, error: galatItem } = await admin
    .from("order_items")
    .select("id, jenis, urutan")
    .eq("pesanan_id", id)
    .order("urutan", { ascending: true })
    .returns<{ id: string; jenis: string; urutan: number }[]>();
  if (galatItem) {
    return NextResponse.json({ pesan: "Item pesanan tidak terbaca." }, { status: 500 });
  }
  if (!item || item.length === 0) {
    return NextResponse.json({ pesan: "Pesanan ini tidak punya item." }, { status: 404 });
  }

  const terbit: string[] = [];
  const belumAdaPenangan: number[] = [];
  for (const b of item) {
    // Jenis selain `produk_digital` belum punya penangan di P1 (spec:
    // penyaluran sesi lahir di P3). Dilaporkan, bukan ditebak — menebaknya
    // berarti menerbitkan akses produk untuk item yang bukan produk.
    if (b.jenis !== "produk_digital") {
      belumAdaPenangan.push(b.urutan);
      continue;
    }
    const { data, error } = await admin.rpc("terbitkan_akses_item", { p_item_id: b.id });
    if (error) {
      return NextResponse.json({ pesan: "Penerbitan akses gagal." }, { status: 500 });
    }
    terbit.push(String(data));
  }

  return NextResponse.json({ terbit, belumAdaPenangan });
}
```

- [ ] **Step 9: Tulis rute "putuskan" dan "tutup tinjauan"**

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/api/pesanan/[id]/putuskan/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * PUTUSAN STAF ATAS PESANAN `ditahan` (spec "Rekonsiliasi — Lapis 2").
 *
 * DUA putusan, bukan satu: "putuskan" yang hanya punya satu hasil bukan
 * putusan. Admin yang menemukan pembayaran kurang Rp 50.000 harus punya jalan
 * selain "berikan saja".
 *
 * ===== KENAPA INI BOLEH DIPARAMETERKAN, SEMENTARA VONIS MIDTRANS TIDAK =====
 * Vonis Midtrans memang tidak boleh diparameterkan — itulah kenapa pemeriksaan
 * ulang adalah rute yang MENANYAI Status API. Yang diputuskan di sini bukan
 * "apa kata Midtrans" melainkan "apa yang kita lakukan terhadap uang yang
 * sudah masuk", dan ia dicatat dengan nama pemutusnya. Karena itu RPC-nya
 * dipanggil dengan SESI PEMANGGIL, bukan service role: `putuskan_pesanan_ditahan`
 * bergerbang `user_role()` dan mengambil `padma_id` pemutus dari sesi itu.
 * Service role di sini akan membuat jejaknya menyebut mesin, bukan manusia —
 * dan jejak audit yang tidak menyebut manusia tidak berguna.
 */
const PUTUSAN_SAH = ["lunas", "dibatalkan"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const badan = (await request.json().catch(() => ({}))) as { putusan?: unknown };
  const putusan = typeof badan.putusan === "string" ? badan.putusan : "";
  // Disaring di sini JUGA, bukan hanya di RPC: dua pagar untuk satu lubang,
  // karena lubang ini memakan uang orang. RPC tetap pagar yang sesungguhnya —
  // pemeriksaan yang hanya hidup di rute bisa dilewati lewat PostgREST.
  if (!PUTUSAN_SAH.includes(putusan)) {
    return NextResponse.json(
      { pesan: "Putusan tidak dikenal." },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();
  const { error } = await sb.rpc("putuskan_pesanan_ditahan", {
    p_pesanan_id: id,
    p_putusan: putusan,
  });
  if (error) {
    // P0001 adalah galat yang KITA tulis untuk dibaca manusia; sisanya adalah
    // kalimat Postgres, dan admin tidak boleh melihat kode Postgres.
    const pesan =
      error.code === "P0001" ? error.message : "Putusan tidak bisa dijalankan atas pesanan ini.";
    return NextResponse.json({ pesan }, { status: 400 });
  }

  return NextResponse.json({ diputuskan: putusan });
}
```

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/api/pesanan/[id]/tutup-tinjauan/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * TUTUP TINJAUAN (Lapis 2).
 *
 * Mengosongkan `butuh_tinjauan_pada` + `sebab_tinjauan` dan melahirkan jejak
 * `tinjauan_ditutup`. Ia TIDAK menyentuh status sama sekali — itulah keuntungan
 * membuang nilai enum `ditinjau` dari desain.
 *
 * Dan justru karena ia tidak menyentuh status, RPC-nya MENOLAK baris `ditahan`
 * (P0001). Tanpa penolakan itu, satu klik menghasilkan pesanan `ditahan`
 * ber-`butuh_tinjauan_pada is null`: uang pembeli sudah di tangan Midtrans,
 * aksesnya tidak pernah terbit, dan barisnya lolos dari klausa penanda
 * sekaligus dari jaring `lunas`. Kalimat penolakannya diteruskan apa adanya ke
 * layar karena ia menyuruh memakai tombol yang benar.
 *
 * Sesi pemanggil, bukan service role: RPC-nya bergerbang `user_role()` dan
 * mencatat siapa yang menutup.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const sb = await createServerSupabase();
  const { error } = await sb.rpc("tutup_tinjauan", { p_pesanan_id: id });
  if (error) {
    const pesan =
      error.code === "P0001" ? error.message : "Tinjauan tidak bisa ditutup untuk pesanan ini.";
    return NextResponse.json({ pesan }, { status: 400 });
  }

  return NextResponse.json({ ditutup: true });
}
```

- [ ] **Step 10: Daftarkan tujuan ke sidebar admin + perbaiki pagarnya**

Sunting `/Users/arvinfairuz/Documents/padma/web/src/app/admin/_shell/nav-admin.tsx`. Sisipkan
tujuan ke-12 di `MENU`, tepat **sesudah** butir `/admin/produk` (baris 34) dan **sebelum**
`/admin/pengaturan`:

```ts
  // Judul halamannya "Pesanan". Ikon "bayar" dipakai ulang — ia memang tujuan
  // uang. Tanpa badge: "butuh perhatian" bukan antrean yang bisa dibereskan
  // dengan menekan tombol berulang kali, dan angka merah permanen di sidebar
  // adalah alarm yang dinormalkan.
  //
  // SIDEBAR SAJA. `RINGKAS` (bar bawah) tetap empat tujuan tersibuk klinik;
  // pesanan digital bukan salah satunya, dan bar bawah yang tumbuh jadi lima
  // memotong label justru di tujuan yang paling perlu dikenali.
  { href: "/admin/pesanan", label: "Pesanan", ikon: "bayar" },
```

Lalu sunting `/Users/arvinfairuz/Documents/padma/web/tests/admin-shell.test.ts` — **empat
suntingan, semuanya wajib**:

1. Baris 408 — judul uji: `"memuat sebelas tujuan berbahasa Indonesia di sidebar"` menjadi
   `"memuat dua belas tujuan berbahasa Indonesia di sidebar"`. (Judul yang berbohong tidak
   memerahkan apa pun dan bertahan bertahun-tahun.)
2. Baris 410-423 — tambahkan ke daftar `tujuan`, tepat sesudah `["/admin/produk", "Produk"]`:

```ts
      // Pesanan (P1 inti pembayaran, Task 11): layar rekonsiliasi Lapis 2.
      ["/admin/pesanan", "Pesanan"],
```

3. Baris 432 — `expect([...m.matchAll(/<a\b/g)]).toHaveLength(11 + 4);` menjadi:

```ts
    // Dua belas tautan sidebar + empat tautan bar bawah.
    expect([...m.matchAll(/<a\b/g)]).toHaveLength(12 + 4);
```

4. Baris 442-448 — tambahkan `"/admin/pesanan"` ke daftar href yang hadir **sekali**,
   sesudah `"/admin/materi"`:

```ts
      "/admin/pesanan",
```

**Satu hal yang SENGAJA tidak diperbaiki di sini, dicatat supaya ia keputusan dan bukan
kelalaian:** daftar href-hadir-sekali itu sudah bocor SEBELUM P1 — `"/admin/produk"` tidak ada
di dalamnya, jadi tujuan itu lolos dari assertion ejaannya sejak lahir. Perbaikannya satu baris,
tapi ia bukan regresi P1, dan menambalnya di tengah rencana pembayaran mencampur dua alasan di
satu commit yang seluruh isinya tentang uang. Tambahkan **`"/admin/pesanan"` saja**; catat
`/admin/produk` sebagai utang terpisah.

- [ ] **Step 11: Daftarkan kelima rute ke README**

Sunting `/Users/arvinfairuz/Documents/padma/web/README.md`. `tests/inventaris-rute.test.ts`
memeriksa **dua arah**, jadi berkas tanpa baris dan baris tanpa berkas sama-sama merah.

Sisipkan satu baris tepat sesudah baris `/admin/bayar` (README.md:129 pada `main` hari ini —
**cari barisnya, jangan percaya nomornya**).

Dan sadari apa yang baris ini lakukan pada tugas SESUDAHNYA: ia disisipkan di ATAS tabel rute,
jadi SELURUH tabel rute bergeser satu baris ke bawah — setiap nomor baris yang Tugas 12 pegang
menjadi salah. Itulah kenapa langkah ini, dan langkah Tugas 12, menyebut baris jangkarnya dan
bukan nomornya (§0.12).

```
| `/admin/pesanan` | Admin, Owner | Rekonsiliasi pesanan Midtrans: blok "Butuh perhatian" (bertanda tinjauan, atau uang sudah masuk tapi akses belum tercatat terbit) dan "Terbuka"; satu-satunya layar admin yang menampilkan nominal PESANAN (yang ditagih vs yang diterima) — keputusan pemilik repo, dijaga `tests/admin-pesanan.test.tsx` |
```

Lalu tambahkan empat baris rute **tepat sesudah baris `` `/api/pesanan/[id]/batal` ``**
milik Tugas 9 — bukan di akhir tabel. Kelima rute `/api/pesanan/*` P1-B karena itu duduk
berurutan sebagai satu blok, dan `/api/cron/pesanan` milik Tugas 12 menutup tabelnya di
bawah. `tests/inventaris-rute.test.ts` hanya memungut kolom pertama dan BUTA terhadap urutan,
jadi tidak ada uji yang memerah bila blok ini tercerai — yang rusak hanya satu-satunya peta
PADMA yang dibaca manusia. **Cari baris jangkarnya, jangan percaya nomornya** (§0.12).
Nama segmen dinamis ditulis **harfiah `[id]`** — uji inventaris memungut rute dari sistem
berkas, jadi `:id` sekaligus jadi "hantu" dan "tak terdaftar":

```
| `/api/pesanan/[id]/periksa-ulang` | Admin, Owner | POST menanyakan Status API Midtrans untuk satu pesanan lalu menjalankan jawabannya lewat `terapkan_notifikasi_midtrans` (service role). Vonisnya datang dari Midtrans, tidak pernah dari badan permintaan |
| `/api/pesanan/[id]/terbitkan-akses` | Admin, Owner | POST menerbitkan ulang akses untuk pesanan **lunas** yang aksesnya tidak pernah terbit; memanggil `terbitkan_akses_item` per item, bukan penyalur — aturan "penyalur hanya dari transisi" tetap utuh |
| `/api/pesanan/[id]/putuskan` | Admin, Owner | POST putusan staf atas pesanan `ditahan`: `lunas` atau `dibatalkan`. RPC dengan sesi pemanggil, bergerbang `user_role()`, nama pemutus ikut tercatat di jejak |
| `/api/pesanan/[id]/tutup-tinjauan` | Admin, Owner | POST mengosongkan penanda tinjauan tanpa menyentuh status; MENOLAK baris `ditahan` — yang itu menuntut putusan, bukan penutupan |
```

- [ ] **Step 12: Jalankan uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/admin-pesanan.test.tsx tests/admin-shell.test.ts tests/inventaris-rute.test.ts
```

Lalu pagar yang tersentuh secara tidak langsung:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/panel-primitif.test.ts tests/pagar-batas-server-klien.test.ts tests/identitas-aplikasi.test.ts tests/admin-bayar.test.ts tests/e2e-selektor.test.ts
```

- [ ] **Step 13: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add web/supabase/migrations/20260927100000_sebab_tinjauan_lestari.sql web/src/lib/admin/pesanan.ts web/src/app/admin/pesanan web/src/app/api/pesanan web/src/app/admin/_shell/nav-admin.tsx web/tests/admin-pesanan.test.tsx web/tests/admin-shell.test.ts web/README.md && git commit -m "$(cat <<'PESAN'
feat(pesanan): layar /admin/pesanan + empat rute pemulihan

Lapis 2 rekonsiliasi: dipicu manusia. Dua blok, bukan satu saringan —
"Butuh perhatian" menjawab apa yang salah, "Terbuka" menjawab apa yang
sedang berjalan. Klausa kedua ("uang sudah masuk, akses belum tercatat terbit")
sengaja tidak bergantung pada siapa pun mengingat menyalakan penanda.

Layar ini satu-satunya permukaan admin yang menampilkan nominal PESANAN
(yang ditagih vs yang diterima), atas keputusan pemilik repo, dan ujinya
menegaskannya dengan assertion kebalikan konvensi rumah supaya keputusan itu
tidak gugur lewat pintu ketiadaan. Bukan satu-satunya layar admin bernominal
— /admin/produk sudah menampilkan harga hari ini. Untuk baris ditahan, yang
ditagih dan yang diterima terbaca berdampingan — selisihnya yang jadi
keputusan manusia.

Empat tombol punya alamatnya masing-masing. Dua yang menulis lewat fungsi
mesin hidup sebagai rute di src/app/api/** karena src/app/admin/** dilarang
menyentuh service role; dua sisanya RPC dengan sesi pemanggil supaya jejak
auditnya menyebut manusia, bukan mesin. "Terbitkan akses" memanggil
terbitkan_akses_item langsung, bukan penyalur, supaya aturan "penyalur
hanya dari transisi" tetap utuh — dan menolak pesanan yang belum lunas,
karena tombol bukan pagar.

Migrasi ke-91 ikut di sini karena layar inilah yang menampilkan
sebab_tinjauan: lima UPDATE membungkus penugasannya dengan coalesce supaya
alasan PERTAMA bertahan, sepasang dengan butuh_tinjauan_pada yang sudah
begitu sejak awal. Terjangkau hari ini tanpa kode baru — refund yang
mendarat pada pesanan bertanda lunas_setelah_tutup menimpa satu-satunya
petunjuk bahwa uang pernah masuk. create or replace, supaya pencabutan hak
ketiga fungsi mesin itu lestari.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

---

### Task 12: Lapis 3 — rute cron + GitHub Actions

Penyapu sisa, bukan jaring utama. Ia menangkap pesanan milik orang yang tidak pernah
membuka halamannya lagi.

**BACA DULU** (pola yang ditiru PERSIS, path lengkap):

- `/Users/arvinfairuz/Documents/padma/web/src/app/api/cron/tenggat/route.ts` — **satu-satunya
  rute mesin di repo ini.** POST di baris 22, gerbang rahasia di baris 23-28, dokblok
  "KENAPA RAHASIA, BUKAN requireRole" di baris 13-21. Rute baru meniru bentuknya persis.
- `/Users/arvinfairuz/Documents/padma/web/tests/cron-tenggat.test.ts` — lima kasus gerbang
  rahasia. Uji baru meniru kelimanya.
- `/Users/arvinfairuz/Documents/padma/.github/workflows/backup-db.yml` — **di AKAR REPO, bukan
  di `web/`** (`web/.github` tidak ada). Baris 12-18: blok `schedule` yang lahir DIKOMENTARI,
  beserta alasannya. Baris 20-28: `concurrency` + `permissions: contents: read`.
- `/Users/arvinfairuz/Documents/padma/web/tests/geocode-route.test.ts` baris 36-52 — pola stub
  `fetch` selektif yang tetap meloloskan 127.0.0.1.
- `/Users/arvinfairuz/Documents/padma/web/tests/setup-fetch-guard.ts` — **jangan disunting.**

**Files:**

- Create: `web/src/app/api/cron/pesanan/route.ts`
- Create: `/Users/arvinfairuz/Documents/padma/.github/workflows/rekonsiliasi-pesanan.yml`
  ← **AKAR REPO**
- Modify: `web/README.md` — satu baris di AKHIR tabel rute non-halaman, tepat sesudah
  baris `` `/api/produk/[id]/unduh` `` (**cari barisnya, jangan percaya nomornya**, §0.12)
- Test: `web/tests/pesanan-jadwal-actions.test.ts`

**Interfaces:**

- Consumes (Task 10) — `web/src/lib/pesanan/periksa-menggantung.ts`:
  ```ts
  export async function sapuPesananMenggantung(
    pemilih: SupabaseClient, batasBaris: number, clientId: string | null = null,
  ): Promise<{ diperiksa: number }>;   // MELEMPAR bila PEMILIHAN barisnya gagal
  ```
  Parameter ketiganya ber-**nilai bawaan**, bukan opsional ber-`?` — satu ejaan saja untuk
  tanda tangan yang seluruh alasan keberadaannya adalah PERSIS (§0.6). `BATAS_SAPUAN = 20`
  yang dioper sebagai argumen kedua hidup sebagai konstanta LOKAL di rute cron, bukan ekspor
  Tugas 10: ia pasangan `BATAS_PERIKSA_SEKALI = 3`, dan keduanya punya alasan yang berbeda.
  Jalur penerapannya SAMA dengan Lapis 1b; yang berbeda hanya DUA argumen pertama-dan-ketiga —
  service role sebagai `pemilih` dan `clientId: null` (lintas klien) di sini, versus sesi
  pemanggil berikut `clientId`-nya (hanya miliknya) di sana. `clientId` ditulis EKSPLISIT di
  rute cron, bukan dibiarkan default: itulah satu-satunya baris yang menyatakan sapuan ini
  memang lintas klien.
- Consumes (repo): `createAdminSupabase()` dari `@/lib/supabase/admin`; `process.env.CRON_SECRET`.
- Produces:
  - `POST /api/cron/pesanan` → `200 { diperiksa: number }` | `401` | `500`.
    **Tidak ada ekspor `GET`**, dan **tidak ada `vercel.json` yang lahir**: `curl` dari Actions
    yang memilih verbanya.
  - `.github/workflows/rekonsiliasi-pesanan.yml` — `workflow_dispatch`,
    `concurrency: rekonsiliasi-pesanan`, `permissions: contents: read`, satu `curl -X POST --fail`
    ber-`Authorization: Bearer ${{ secrets.CRON_SECRET }}`. Blok `schedule` **lahir DIKOMENTARI**.

---

- [ ] **Step 1: Tulis uji yang gagal**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-jadwal-actions.test.ts`:

```ts
/**
 * LAPIS 3 — PENYAPU TERJADWAL (spec "Rekonsiliasi — empat lapis").
 *
 * Dua hal dijaga berkas ini, dan keduanya adalah kelas kegagalan yang TIDAK
 * menghasilkan galat di mana pun:
 *
 *  1. BERKAS JADWAL YANG MENYAPU HAL YANG SALAH. Selama tidak ada satu pun
 *     berkas workflow, "`/api/cron/tenggat` tidak dijadwalkan" adalah
 *     non-tindakan yang gratis. Begitu berkasnya lahir, ia berubah jadi baris
 *     yang harus SENGAJA TIDAK diketik — dan keputusan yang bergantung pada
 *     seseorang mengingat untuk tidak mengetik sesuatu bukan keputusan yang
 *     terjaga. Menghidupkan tenggat akan membatalkan sekaligus seluruh
 *     pengajuan yang menumpuk sejak September: pembatalan massal ke klien
 *     nyata, di hari yang sama dengan go-live pembayaran.
 *  2. RAHASIA HARFIAH DI BERKAS PUBLIK. Repo `PokokPayu/padma-web` PUBLIK.
 *     `CRON_SECRET` yang tertulis harfiah di workflow adalah rahasia yang
 *     terbit ke seluruh internet dalam satu commit, dan rute yang dijaganya
 *     menembakkan permintaan ke Midtrans.
 *
 * Ditambah gerbang rutenya sendiri, yang punya satu cara gagal khas: terbuka
 * lebar ketika konfigurasinya lupa dipasang. Kelimanya meniru
 * `tests/cron-tenggat.test.ts`.
 *
 * Midtrans TIDAK PERNAH ditembak dari suite. Berkas ini mengimpor rute cron,
 * jadi ia WAJIB menstub `globalThis.fetch` — dan stubnya dibuat MELEMPAR untuk
 * host selain 127.0.0.1, supaya "adapternya berhenti di-mock" jadi merah,
 * bukan jadi permintaan sungguhan yang lambat dan senyap.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";

const admin = createAdminSupabase();

// Adapter Midtrans dipalsukan seluruhnya; `jawabPer` dikunci PER order_id
// supaya pesanan menggantung milik berkas uji lain — rute ini memilih barisnya
// dengan service role, jadi lintas klien — tidak ikut tergerakkan.
const midtrans = vi.hoisted(() => ({
  jawabPer: new Map<string, unknown>(),
  panggilan: [] as string[],
}));
vi.mock("@/lib/midtrans/adapter", () => ({
  bacaStatusTransaksi: async (orderId: string) => {
    midtrans.panggilan.push(orderId);
    return (
      midtrans.jawabPer.get(orderId) ?? {
        ok: false,
        kode: 500,
        pesan: "bukan pesanan milik berkas uji ini",
      }
    );
  },
  terbitkanTokenSnap: async () => ({ ok: false, pesan: "tidak dipakai di berkas ini" }),
}));

const { POST } = await import("@/app/api/cron/pesanan/route");
const modulRute = await import("@/app/api/cron/pesanan/route");

// ---------------------------------------------------------------------------
// Berkas workflow — di AKAR REPO, bukan di web/
// ---------------------------------------------------------------------------

const BERKAS_YML = path.resolve(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "rekonsiliasi-pesanan.yml",
);

describe(".github/workflows/rekonsiliasi-pesanan.yml", () => {
  it("ada di akar repo", () => {
    // Dua tingkat naik dari web/tests/, bukan satu: `web/.github` tidak ada,
    // dan berkas workflow yang salah taruh tidak pernah dijalankan siapa pun —
    // gagal dalam diam, bentuk kegagalan termahal untuk sebuah penjadwal.
    expect(existsSync(BERKAS_YML), `tidak ada di ${BERKAS_YML}`).toBe(true);
  });

  const yml = () => readFileSync(BERKAS_YML, "utf8");

  it("menembak /api/cron/pesanan", () => {
    expect(yml()).toContain("/api/cron/pesanan");
  });

  it("mengambil rahasianya dari GitHub Secret", () => {
    expect(yml()).toContain("secrets.CRON_SECRET");
  });

  it("TIDAK menyebut /api/cron/tenggat sama sekali", () => {
    // Bukan basa-basi: menghidupkannya membatalkan sekaligus seluruh pengajuan
    // yang lewat tenggat sejak September, ke klien nyata. Sebelum diputuskan,
    // jumlah barisnya harus dihitung dulu — dan kueri itu menyentuh produksi.
    expect(yml()).not.toContain("/api/cron/tenggat");
  });

  it("memakai curl --fail, supaya jawaban non-2xx MEMERAHKAN job", () => {
    // Tanpa `--fail`, curl pulang dengan kode 0 untuk 401 — dan penjadwal yang
    // ditolak setiap 15 menit terlihat hijau selamanya.
    expect(yml()).toMatch(/curl[^\n]*--fail/);
  });

  it("nol rahasia yang ditulis harfiah", () => {
    // Repo ini PUBLIK.
    const POLA: Array<[RegExp, string]> = [
      [/Bearer\s+(?!\$)[^\s"']{8,}/, "header Bearer diikuti nilai harfiah"],
      [/(SB-)?Mid-(server|client)-[A-Za-z0-9_-]{4,}/, "kunci Midtrans harfiah"],
      [/eyJ[A-Za-z0-9_-]{20,}/, "JWT harfiah (kunci Supabase)"],
      [/CRON_SECRET\s*[:=]\s*(?!\$)["']?[A-Za-z0-9_-]{8,}/, "CRON_SECRET diberi nilai harfiah"],
    ];
    const isi = yml();
    for (const [pola, sebab] of POLA) {
      expect(pola.test(isi), `${sebab}: ${isi.match(pola)?.[0]}`).toBe(false);
    }
  });

  it("blok schedule LAHIR DIKOMENTARI", () => {
    // Mengikuti backup-db.yml. Jadwal yang aktif sebelum sasarannya ada gagal
    // setiap kali jalan, dan alarm yang berbunyi terus adalah alarm yang
    // berhenti dibaca.
    //
    // KETIKA JADWALNYA DIHIDUPKAN di langkah terakhir go-live: HAPUS `it` ini,
    // jangan dilonggarkan. Ia ada supaya blok jadwal tidak menyala tanpa
    // sengaja ikut commit lain — menghapusnya adalah satu baris yang sadar dan
    // tercatat di git, yang memang bentuk keputusan yang diinginkan.
    const isi = yml();
    expect(isi).toMatch(/^\s*#\s*schedule:/m);
    expect(isi).toMatch(/^\s*#\s*-\s*cron:\s*"\*\/15 \* \* \* \*"/m);
    expect(isi, "blok schedule sudah aktif").not.toMatch(/^\s{2}schedule:/m);
  });
});

// ---------------------------------------------------------------------------
// Rute cron
// ---------------------------------------------------------------------------

const AWALAN_KODE = "PSN-260926-C0";
const KLIEN_ANANDA = "44444444-4444-4444-4444-444444444401";
const SLUG = "uji-cron-pesanan";
const JUDUL = "Uji Cron Pesanan";
const HARGA = 88_000;

let produkId: string;
const rahasiaAsli = process.env.CRON_SECRET;

function permintaan(header?: string): Request {
  return new Request("http://127.0.0.1/api/cron/pesanan", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

async function semaiMenggantung(kode: string): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      kode,
      percobaan: 1,
      client_id: KLIEN_ANANDA,
      status: "menunggu_bayar",
      jumlah_item: 1,
      // Lebih tua dari MENIT_JEDA_PERIKSA, atau penyapu memang tidak akan
      // menyentuhnya.
      dibuat_pada: new Date(Date.now() - 60 * 60_000).toISOString(),
      kedaluwarsa_pada: new Date(Date.now() + 12 * 3_600_000).toISOString(),
      diperiksa_pada: null,
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: galatItem } = await admin.from("order_items").insert({
    pesanan_id: data!.id,
    jenis: "produk_digital",
    product_id: produkId,
    judul_beku: JUDUL,
    harga_beku: HARGA,
    urutan: 1,
  });
  if (galatItem) throw galatItem;
  return data!.id as string;
}

async function statusPesanan(id: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", id).single();
  return data!.status as string;
}

async function bersihkan() {
  await admin.from("digital_entitlements").delete().eq("product_id", produkId);
  const { data } = await admin.from("orders").select("id").like("kode", `${AWALAN_KODE}%`);
  const ids = (data ?? []).map((b) => b.id as string);
  if (ids.length === 0) return;
  await admin.from("jejak_pesanan").delete().in("pesanan_id", ids);
  await admin.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
  await admin.from("order_items").delete().in("pesanan_id", ids);
  await admin.from("orders").delete().in("id", ids);
}

beforeAll(async () => {
  await admin.from("digital_products").delete().eq("slug", SLUG);
  const { data, error } = await admin
    .from("digital_products")
    .insert({ judul: JUDUL, slug: SLUG, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkId = data!.id as string;
  await admin.from("digital_product_prices").insert({ product_id: produkId, harga: HARGA });
});

beforeEach(async () => {
  // Pagar fetch: 127.0.0.1 (Supabase lokal) lewat, sisanya MELEMPAR. Ini bukan
  // salinan setup-fetch-guard.ts yang malas — ia menjaga hal yang berbeda:
  // bahwa berkas INI tidak pernah menembakkan satu pun permintaan keluar
  // seandainya mock adapternya kelak terlepas.
  const asli = globalThis.fetch;
  vi.stubGlobal("fetch", (...arg: Parameters<typeof fetch>) => {
    const url = arg[0] instanceof Request ? arg[0].url : String(arg[0]);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(url)) {
      throw new Error(`uji ini tidak boleh menembak ${url}`);
    }
    return asli(...arg);
  });

  midtrans.panggilan.length = 0;
  midtrans.jawabPer.clear();
  await bersihkan();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (rahasiaAsli === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = rahasiaAsli;
});

afterAll(async () => {
  await bersihkan();
  await admin.from("digital_products").delete().eq("id", produkId);
});

describe("gerbang rahasia /api/cron/pesanan", () => {
  it("MENOLAK semua orang ketika CRON_SECRET tidak terpasang", async () => {
    // Fail-closed, persis seperti rute tenggat. Rute yang terbuka karena
    // konfigurasinya lupa dipasang adalah rute publik yang menembakkan
    // permintaan ke Midtrans sebanyak yang diminta siapa pun.
    delete process.env.CRON_SECRET;
    const r = await POST(permintaan("Bearer apa pun"));
    expect(r.status).toBe(401);
    expect(midtrans.panggilan).toEqual([]);
  });

  it("menolak tanpa header", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan())).status).toBe(401);
  });

  it("menolak rahasia yang salah", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan("Bearer salah"))).status).toBe(401);
  });

  it("menolak rahasia yang benar TANPA skema Bearer", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan("rahasia-uji"))).status).toBe(401);
  });

  it("NOL ekspor GET", async () => {
    // Keharusan mengekspor GET lahir dari Vercel Cron yang memanggil GET.
    // Penjadwalnya kini GitHub Actions dengan `curl`, jadi kitalah yang
    // memilih verbanya — dan permukaan yang tidak perlu ada sebaiknya tidak
    // ada, apalagi permukaan yang bisa ditembak dari bilah alamat peramban.
    expect((modulRute as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe("sapuan /api/cron/pesanan", () => {
  it("menyembuhkan pesanan menggantung dan melaporkan jumlahnya", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0001`;
    const id = await semaiMenggantung(kode);
    midtrans.jawabPer.set(`${kode}.1`, {
      ok: true,
      status: {
        order_id: `${kode}.1`,
        status_code: "200",
        transaction_status: "settlement",
        transaction_id: `trx-${kode}`,
        gross_amount: `${HARGA}.00`,
        fraud_status: null,
        payment_type: "qris",
      },
    });

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);

    const isi = (await r.json()) as { diperiksa: number };
    // Jumlahnya penting: rute yang selalu menjawab "ok" tidak bisa dibedakan
    // dari rute yang tidak pernah menemukan apa pun, dan penjadwal tidak punya
    // apa pun untuk dicatat.
    expect(typeof isi.diperiksa).toBe("number");
    expect(isi.diperiksa).toBeGreaterThanOrEqual(1);

    expect(midtrans.panggilan).toContain(`${kode}.1`);
    expect(await statusPesanan(id)).toBe("lunas");
  });

  it("menyapu LINTAS KLIEN — bukan hanya pesanan pemanggil", async () => {
    // Inilah bedanya dengan Lapis 1b: penyapu memilih barisnya dengan service
    // role, jadi ia menangkap pesanan milik orang yang tidak pernah membuka
    // halamannya lagi. Tidak ada sesi sama sekali di rute ini.
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0002`;
    const id = await semaiMenggantung(kode);
    midtrans.jawabPer.set(`${kode}.1`, {
      ok: false,
      kode: 404,
      pesan: "Transaction doesn't exist",
    });
    // Tenggat sudah lewat lebih dari satu jam -> 404 boleh dibaca kedaluwarsa.
    await admin
      .from("orders")
      .update({ kedaluwarsa_pada: new Date(Date.now() - 3 * 3_600_000).toISOString() })
      .eq("id", id);

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);
    expect(midtrans.panggilan).toContain(`${kode}.1`);
    expect(await statusPesanan(id)).toBe("kedaluwarsa");
  });

  it("pesanan yang baru diperiksa TIDAK ditanyakan lagi", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0003`;
    const id = await semaiMenggantung(kode);
    await admin
      .from("orders")
      .update({ diperiksa_pada: new Date().toISOString() })
      .eq("id", id);

    await POST(permintaan("Bearer rahasia-uji"));

    expect(midtrans.panggilan).not.toContain(`${kode}.1`);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("kunci server yang belum terpasang melaporkan diperiksa: 0, BUKAN jumlah barisnya", async () => {
    // Kegagalan termahal yang bisa lolos dari berkas ini, dan satu-satunya
    // yang tidak menghasilkan galat di mana pun: server tanpa
    // `MIDTRANS_SERVER_KEY` melaporkan "diperiksa: 20" tiap lima belas menit
    // tanpa satu permintaan pun pernah keluar. Penjadwal yang sakit terbaca
    // PERSIS seperti penjadwal yang sehat, dan angka di badan jawaban inilah
    // satu-satunya hal yang pernah dicatat siapa pun — `curl --fail` tidak
    // menolongnya, karena 200 memang jawaban yang benar.
    //
    // Lewat rute, bukan memanggil `sapuPesananMenggantung` langsung: yang
    // dibaca penjadwal adalah angka yang keluar dari rute, dan rute yang
    // meneruskannya apa adanya itulah yang dijanjikan.
    //
    // `toBe(0)` boleh EKSAK di sini sementara uji penyembuhan di atas terpaksa
    // menulis `toBeGreaterThanOrEqual(1)`: penyapu memilih barisnya LINTAS
    // KLIEN, jadi pesanan menggantung milik berkas lain ikut terbawa — tapi
    // semuanya jatuh ke jawaban bawaan `kode: 500`, yang juga tidak dihitung.
    // Nol karena itu berarti nol, bukan "kebetulan sedang sepi".
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0004`;
    const id = await semaiMenggantung(kode);
    midtrans.jawabPer.set(`${kode}.1`, {
      ok: false,
      kode: -1,
      pesan: "Kunci Midtrans belum dipasang.",
    });

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);

    // Barisnya BENAR-BENAR terpilih dan diproses. Tanpa baris ini `0` juga
    // dipulangkan oleh sapuan yang tidak menemukan apa-apa, dan ujinya hijau
    // untuk alasan yang salah — persis bentuk kegagalan yang sedang dijaga.
    expect(midtrans.panggilan).toContain(`${kode}.1`);

    const isi = (await r.json()) as { diperiksa: number };
    expect(isi.diperiksa).toBe(0);
    // Dan tidak ada vonis yang dibuat dari ketiadaan jawaban.
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-jadwal-actions.test.ts
```

Kegagalan yang diharapkan: `Failed to load url @/app/api/cron/pesanan/route` — seluruh berkas
merah karena rutenya belum ada. Sesudah Step 3 (rute lahir, workflow belum), yang tersisa merah
adalah tujuh `it` di `describe(".github/workflows/rekonsiliasi-pesanan.yml")` — itulah merah
yang membuktikan berkas jadwalnya benar-benar dituntut, bukan diasumsikan.

- [ ] **Step 3: Tulis rute cronnya**

Buat `/Users/arvinfairuz/Documents/padma/web/src/app/api/cron/pesanan/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sapuPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";

export const runtime = "nodejs";

/**
 * LAPIS 3 — PENYAPU PESANAN MENGGANTUNG (spec 26 Sep 2026, "Rekonsiliasi").
 *
 * PENYAPU SISA, bukan jaring utama, dan itu disengaja walau kadensnya rapat.
 * Jaring utamanya Lapis 1b (pemeriksaan saat halaman dibuka) karena ia dipicu
 * oleh orang yang paling butuh: yang baru membayar lalu kembali mencari
 * produknya. Yang ditangkap di sini hanyalah pesanan milik orang yang tidak
 * pernah membuka halamannya lagi.
 *
 * Alasannya bukan kehematan: tidak satu pun penjadwal menjamin ketepatan
 * waktu. Dokumentasi GitHub Actions sendiri menyatakan jadwal bisa tertunda
 * saat beban tinggi dan sebagian job antre bisa DIBUANG — terutama di awal
 * setiap jam. Desain yang menggantungkan uang orang pada ketepatan penjadwal
 * akan salah di penjadwal mana pun.
 *
 * ===== KENAPA POST, DAN KENAPA TIDAK ADA GET =====
 * Keharusan mengekspor GET lahir dari Vercel Cron yang memanggil GET.
 * Penjadwalnya di sini GitHub Actions dengan `curl` — kita yang memilih
 * verbanya, jadi bentuknya sama dengan `/api/cron/tenggat` (POST di baris 22
 * berkas itu). Tidak ada `vercel.json` yang perlu lahir, dan tidak ada jebakan
 * "salah taruh di akar repo lalu gagal dalam diam".
 *
 * ===== KENAPA RAHASIA, BUKAN requireRole =====
 * Pemanggilnya mesin: tidak ada sesi, tidak ada peran. Tanpa `CRON_SECRET`
 * terpasang, rute ini MENOLAK semua orang — fail-closed persis seperti rute
 * tenggat. Rute publik yang menembakkan permintaan ke Midtrans bisa dipanggil
 * siapa pun berulang kali, dan ongkosnya dibayar akun merchant PADMA.
 * Nilainya hidup sebagai GitHub Secret, bukan di repo: repo ini PUBLIK, jadi
 * itu syarat, bukan kehati-hatian umum.
 */

/**
 * Batas baris per jalan.
 *
 * Dua puluh, bukan "semua": satu jalan berarti sampai dua puluh perjalanan
 * bolak-balik ke Status API Midtrans secara berurutan, dan job Actions yang
 * kehabisan waktu tidak menyelesaikan apa pun. Kadens lima belas menit berarti
 * tunggakan yang lebih panjang tetap habis dalam beberapa putaran — dan urutan
 * `diperiksa_pada nulls first` menjamin yang paling lama tidak diperiksa selalu
 * dapat giliran lebih dulu.
 */
const BATAS_SAPUAN = 20;

export async function POST(request: Request) {
  const rahasia = process.env.CRON_SECRET ?? "";
  const dikirim = request.headers.get("authorization") ?? "";

  if (!rahasia || dikirim !== `Bearer ${rahasia}`) {
    return NextResponse.json({ pesan: "Tidak berwenang." }, { status: 401 });
  }

  try {
    // Service role sebagai PEMILIH: itulah satu-satunya perbedaan dengan Lapis
    // 1b, yang mengoper sesi pemanggil dan karena itu hanya melihat pesanannya
    // sendiri. Jalur penerapannya sesudah pemilihan sama persis — satu
    // keputusan, satu bacaan.
    // `null` sebagai argumen ketiga DITULIS EKSPLISIT, bukan dibiarkan default:
    // ia yang membedakan Lapis 3 dari Lapis 1b. Lapis 1b mengoper `client_id`
    // pemanggil supaya radiusnya tidak bergantung pada kebetulan bahwa
    // pemanggilnya bukan staf; Lapis 3 memang lintas klien, dan itu keputusan
    // yang harus terlihat di tempat ia diambil.
    const { diperiksa } = await sapuPesananMenggantung(
      createAdminSupabase(),
      BATAS_SAPUAN,
      null,
    );
    // Jumlahnya dipulangkan supaya penjadwal punya sesuatu untuk dicatat —
    // rute yang selalu menjawab "ok" tidak bisa dibedakan dari rute yang tidak
    // pernah menemukan apa pun.
    return NextResponse.json({ diperiksa });
  } catch {
    // 500, dan `curl --fail` di workflow menerjemahkannya jadi job MERAH.
    // Penyapu yang gagal dalam diam adalah penyapu yang tidak ada.
    return NextResponse.json({ pesan: "Gagal menjalankan." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Tulis berkas workflow-nya**

Buat `/Users/arvinfairuz/Documents/padma/.github/workflows/rekonsiliasi-pesanan.yml`
— **di AKAR REPO**, bersebelahan dengan `backup-db.yml`, bukan di dalam `web/`:

```yaml
name: Rekonsiliasi pesanan

on:
  workflow_dispatch:

  # ===== JADWAL TIAP 15 MENIT — SENGAJA MASIH MATI =====
  # Dihidupkan sebagai LANGKAH TERAKHIR go-live pembayaran, sesudah aplikasi
  # ter-deploy dan CRON_SECRET terpasang DI DUA TEMPAT: sebagai GitHub Secret
  # di repo ini, dan sebagai env di proyek Vercel. Alasannya sama persis dengan
  # yang sudah tertulis di backup-db.yml: jadwal yang aktif sebelum sasarannya
  # ada akan gagal setiap kali jalan, dan alarm yang berbunyi terus adalah
  # alarm yang berhenti dibaca.
  #
  # Menghidupkannya juga berarti MENGHAPUS satu `it` di
  # web/tests/pesanan-jadwal-actions.test.ts ("blok schedule LAHIR DIKOMENTARI")
  # — satu baris yang sadar dan tercatat di git, bukan pelonggaran.
  #
  # GitHub Actions mengizinkan tiap 5 menit dan runner standarnya gratis tanpa
  # batas menit untuk repo publik. Vercel paket Hobby hanya mengizinkan cron
  # SEKALI SEHARI dan ekspresi yang lebih sering menggagalkan deploy — itulah
  # kenapa penjadwalnya bukan Vercel Cron.
  # schedule:
  #   - cron: "*/15 * * * *"

# Satu jalan pada satu waktu. Dua sapuan yang tumpang tindih akan menanyakan
# pesanan yang sama ke Midtrans dua kali: `orders.diperiksa_pada` dicap sebelum
# bertanya, tapi cap itu tidak melindungi dari dua proses yang memilih barisnya
# pada detik yang sama.
concurrency:
  group: rekonsiliasi-pesanan
  cancel-in-progress: false

# Job ini tidak menyentuh isi repo sama sekali — tidak ada checkout, tidak ada
# komentar PR, tidak ada rilis. Yang dibutuhkannya hanya satu permintaan HTTP.
permissions:
  contents: read

jobs:
  sapu:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    env:
      # BUKAN rahasia: domain produksi PADMA sudah publik dan tertulis di
      # web/README.md. Ia diletakkan di sini, bukan sebagai secret, supaya yang
      # ada di daftar secret repo tetap hanya hal yang benar-benar rahasia —
      # daftar secret yang penuh hal biasa adalah daftar yang berhenti dibaca.
      BASIS_URL: https://padmawellnessid.com

    steps:
      - name: Sapu pesanan yang menggantung
        env:
          # Nilainya diambil dari GitHub Secret dan TIDAK PERNAH dicetak.
          # Ditaruh sebagai env LANGKAH INI, bukan env job: env job-wide masuk
          # ke setiap langkah sesudahnya tanpa diminta (pelajaran yang sudah
          # tertulis di backup-db.yml).
          RAHASIA: ${{ secrets.CRON_SECRET }}
        run: |
          set -euo pipefail
          if [ -z "${RAHASIA:-}" ]; then
            echo "::error::Secret CRON_SECRET belum dipasang — rute akan menjawab 401."
            exit 1
          fi

          # --fail WAJIB: tanpanya curl pulang dengan kode 0 untuk 401, dan
          # penjadwal yang ditolak setiap 15 menit terlihat hijau selamanya.
          # -sS: senyap kecuali galat, supaya log tidak penuh bilah kemajuan.
          # --max-time: satu jalan menyapu paling banyak dua puluh pesanan,
          # masing-masing satu perjalanan ke Status API Midtrans.
          jawab=$(curl -sS --fail --max-time 120 \
            -X POST "$BASIS_URL/api/cron/pesanan" \
            -H "Authorization: Bearer $RAHASIA")

          echo "$jawab"
          {
            echo "### Rekonsiliasi pesanan"
            echo "- jawaban: \`$jawab\`"
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 5: Daftarkan rutenya ke README**

Sunting `/Users/arvinfairuz/Documents/padma/web/README.md`. Sisipkan satu baris di **AKHIR
tabel rute non-halaman**, tepat sesudah baris `` `/api/produk/[id]/unduh` `` — bukan di
sebelah `` `/api/cron/tenggat` ``. Kedua rute mesin memang bersaudara, tapi Tugas 11 sudah
menempatkan kelima rute `/api/pesanan/*` sebagai satu blok berurutan, dan menyelipkan rute
ini ke tengah tabel memisahkan blok itu tanpa alasan.

**Jangan memakai nomor baris sama sekali di langkah ini** (§0.12). Tugas 8 menambah satu
baris, Tugas 9 dua, dan Tugas 11 satu baris HALAMAN di ATAS tabel rute berikut empat baris
rute — delapan pergeseran sebelum tugas ini mendarat, dan tugas ini yang paling jauh
bergeser. `tests/inventaris-rute.test.ts` memungut kolom pertama dengan regex dan BUTA
terhadap urutan, jadi baris yang mendarat di tempat yang salah tidak memerahkan apa pun —
yang rusak hanya satu-satunya peta PADMA yang dibaca manusia.

`tests/inventaris-rute.test.ts` memeriksa dua arah, jadi rute tanpa baris dan baris tanpa rute
sama-sama merah:

```
| `/api/cron/pesanan` | Mesin | POST penyapu Lapis 3: menanyakan Status API Midtrans untuk pesanan terbuka yang paling lama tidak diperiksa, lalu menjalankan jawabannya lewat jalur yang sama dengan webhook. Dijaga `CRON_SECRET`, fail-closed. Dipanggil `.github/workflows/rekonsiliasi-pesanan.yml` tiap 15 menit — GitHub Actions, bukan Vercel Cron (paket Hobby hanya mengizinkan cron harian) |
```

- [ ] **Step 6: Jalankan uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-jadwal-actions.test.ts tests/inventaris-rute.test.ts tests/cron-tenggat.test.ts
```

Lalu, sesudah berkoordinasi soal Supabase lokal yang dipakai bersama, suite penuh:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npm test
```

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add web/src/app/api/cron/pesanan/route.ts .github/workflows/rekonsiliasi-pesanan.yml web/tests/pesanan-jadwal-actions.test.ts web/README.md && git commit -m "$(cat <<'PESAN'
feat(pesanan): Lapis 3 — rute penyapu + jadwal GitHub Actions

Penyapu sisa, bukan jaring utama: yang ditangkap di sini hanyalah pesanan
milik orang yang tidak pernah membuka halamannya lagi. Jaring utamanya
tetap Lapis 1b, karena tidak satu pun penjadwal menjamin ketepatan waktu —
dokumentasi Actions sendiri menyebut job antre bisa dibuang.

POST, bukan GET: keharusan GET lahir dari Vercel Cron: dengan curl dari
Actions kita yang memilih verbanya, jadi tidak ada vercel.json yang perlu
lahir dan tidak ada permukaan GET yang bisa ditembak dari bilah alamat.
Dijaga CRON_SECRET, fail-closed seperti rute tenggat.

Workflow mencontoh backup-db.yml, termasuk blok schedule yang LAHIR
DIKOMENTARI — jadwal yang aktif sebelum sasarannya ada gagal setiap kali
jalan, dan alarm yang berbunyi terus adalah alarm yang berhenti dibaca.

Ujinya menahan dua hal yang tidak menghasilkan galat di mana pun: berkas
jadwal yang diam-diam ikut menghidupkan /api/cron/tenggat (pembatalan
massal ke klien nyata), dan rahasia yang ditulis harfiah di repo publik.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```
