# Inti Pembayaran P1-A — Mesin di Basis Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun seluruh mesin pembayaran di dalam Postgres — pesanan, jejak, idempotensi, penyaluran akses — tanpa satu pun permukaan pengguna dan tanpa menyentuh Midtrans.

**Architecture:** Enam migrasi berurutan melahirkan `orders`/`order_items` (pesanan generik yang tidak tahu domain), tabel jejak, dan sebelas fungsi RPC. Yang menggeser status dan menyalurkan akses berjalan dalam SATU transaksi, sehingga "lunas tanpa akses" mustahil alih-alih sekadar jarang. Tugas terakhir memasang pagar yang menahan seluruhnya. Sesudah rencana ini, `npm test` hijau dan nol pengguna bisa membayar apa pun — itu disengaja.

**Tech Stack:** Supabase/Postgres (plpgsql, RLS, security definer), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-26-padma-inti-pembayaran-design.md`

**Rencana lanjutannya:** `docs/superpowers/plans/2026-09-27-padma-p1b-permukaan-pembayaran.md` (Tugas 8–12: adapter Midtrans, webhook, checkout, layar staf, penjadwal). Jangan mulai sebelum rencana ini tuntas — seluruh Tugas 8–12 memanggil fungsi yang lahir di sini.

## Global Constraints

Berlaku untuk **setiap** tugas, tanpa diulang di masing-masing.

- **Bahasa Indonesia**: komentar, pesan galat, UI, pesan commit. Komentar menjelaskan KENAPA, bukan mengulang apa yang kodenya sudah katakan.
- **Migrasi bercap waktu MANUAL**, urutannya mengikat, dan enum lahir sebelum tabel yang memakainya. Keenamnya sudah ditetapkan di Kamus Nama di bawah. Jangan pakai `supabase migration new` — jam dinding pernah menyelipkan migrasi ke tengah riwayat sehingga `db reset` gagal.
- **Cap waktu di atas `20260924100000`**, bukan di atas tip `main`. Cabang `umpan-balik-klien-gelombang-1` sudah membawa dua migrasi yang belum ter-merge.
- **`security definer` MENEMBUS RLS** — otorisasi diperiksa DI DALAM badan fungsi, tidak ada policy yang akan menolak apa pun di sana.
- **Fungsi baru LAHIR bisa dieksekusi `authenticated`.** Templat aturan [F] di repo hanya mencabut dari `public, anon`. Setiap fungsi mesin wajib dicabut eksplisit dari `authenticated` juga.
- **Filter PostgREST adalah PILIHAN PEMANGGIL, bukan pembatas baris.** Policy `for all` + grant tabel membuat satu permintaan bisa menyapu semua baris. Jawaban repo: cabut hak tulis, sediakan RPC ber-radius terkunci parameter.
- **Galat PostgREST dibaca, tidak pernah dibuang.** 200 + array kosong sesudah insert berarti RLS menahan baris — itu kegagalan tersendiri.
- **Nol `alter table booking_requests`, nol `alter type pay_status`, nol sentuhan gerbang isi produk.**
- **Supabase lokal dipakai bersama sesi lain** — koordinasikan sebelum `npm test` penuh atau `db reset`. Selama mengerjakan, jalankan berkas uji tertentu saja.
- Perintah dijalankan dari `web/`.
- Setiap pesan commit diakhiri baris: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Review Focus

Lima kelas masukan yang tersirat di spec tapi tidak dijaga satu uji pun saat rencana ini pertama ditulis. Masing-masing kini punya ujinya di tugas yang memiliki kodenya — daftar ini ada supaya peninjau tahu ke mana harus melihat, dan supaya ia tidak hilang saat tugasnya disunting.

1. **Pembayaran kartu kredit seluruhnya** — cabang `capture` + `fraud_status`. Empat kasus di Tugas 5: `accept` → lunas, `''` → lunas (mengunci nilai bawaan), `challenge` → ditahan tanpa entitlement, `deny` → dibatalkan. Tanpa ini setiap transaksi kartu berjalan lewat jalur yang nol uji, padahal kartu justru salah satu alasan Midtrans dipilih.
2. **Klien yang sudah memiliki produk membayar lagi** — gerbang di `buat_pesanan` (Tugas 4), plus arah sebaliknya: entitlement yang sudah DICABUT tidak boleh menghalangi pembelian ulang. Uji kedua itu yang menahan gerbangnya ditulis terlalu lebar.
3. **"Rollback melepas sidiknya"** — klaim inti idempotensi Lapis 0. Tugas 5 memicu 23505 sungguhan, lalu membuktikan sidiknya nol baris, statusnya tak bergerak, dan panggilan ulang dengan sidik yang sama diterima. Tanpa ini, kegagalan di tengah transaksi berubah jadi permanen dan uang hilang diam-diam.
4. **Notifikasi untuk pesanan yang tidak dikenal** — dijawab tanpa meninggalkan jejak berarti serangan pemetaan berjalan tanpa terlihat. Tugas 3 melahirkan penghitungnya; Tugas 5 menguji notifikasi untuk percobaan lama.
5. **Nilai `MIDTRANS_PRODUKSI` selain `true`** — dijaga di rencana lanjutan (P1-B Tugas 8), disebut di sini supaya sambungannya tidak hilang.

---


## 0. KAMUS NAMA — satu nama, sekali saja

### 0.1 Cap waktu keenam migrasi (urutan MENGIKAT)

Tip `main` hari ini `20260921170000_harga_produk_publik_hanya_tayang.sql` (84 berkas, diverifikasi).
Cabang `umpan-balik-klien-gelombang-1` membawa `20260922100000` dan `20260924100000` yang belum ter-merge.
Karena itu P1 mulai dari `20260926*`:

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
| kolom baru | `public.digital_entitlements.pesanan_id uuid null references public.orders(id) on delete restrict` | **T5** (dipindah dari T6 — lihat §16 keberatan B-1) |
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

| Path (di `/Users/arvinfairuz/Documents/padma/web/`) | Isi | Lahir |
|---|---|---|
| `src/lib/pesanan/status.ts` | tipe & himpunan status, konstanta waktu. **Tanpa `server-only`** — diimpor komponen klien | T1 |
| `src/lib/pesanan/order-id.ts` | bentuk `kode` & `order_id` Midtrans. Murni, tanpa `server-only` | T4 |
| `src/lib/midtrans/konfig.ts` | pilihan sandbox/produksi + kunci | T8 |
| `src/lib/midtrans/tanda-tangan.ts` | sha512, `timingSafeEqual`, sidik | T8 |
| `src/lib/midtrans/skema.ts` | Zod notifikasi (semua `z.string()`, TIDAK `.strict()`) | T8 |
| `src/lib/midtrans/kode-jawaban.ts` | peta hasil → kode HTTP | T8 |
| `src/lib/midtrans/adapter.ts` | Snap create + Status API (`server-only`) | T8 |
| `src/lib/midtrans/snap-peramban.ts` | pemuat skrip Snap di peramban | T9 |
| `src/lib/pesanan/periksa-menggantung.ts` | Lapis 1b bersama (`server-only`) | T10 |
| `src/lib/pesanan/picu-periksa.ts` | keputusan pemicu Lapis 1b, murni. **Tanpa `server-only`** — diimpor komponen klien | T10 |
| `src/lib/admin/pesanan.ts` | pembaca layar staf | T11 |
| `tests/helpers/klien-kedua.ts` | fixture klien KEDUA ber-akun auth (`EMAIL_KLIEN_KEDUA`, `KLIEN_KEDUA_ID`, `siapkanKlienKedua()`, `bongkarKlienKedua()`). Lahir di T4, **dipakai T4 dan T9** | T4 |

### 0.6 Ekspor TypeScript yang dipakai lebih dari satu tugas

```ts
// src/lib/pesanan/status.ts            (T1 melahirkan; T4,8,9,10,11,12 memakai)
export type StatusPesanan = "menunggu_bayar" | "ditahan" | "lunas" | "kedaluwarsa" | "dibatalkan";
export type SumberItemPesanan = "produk_digital" | "sesi";
export const SUMBER_ITEM_PESANAN: readonly SumberItemPesanan[]; // ["produk_digital","sesi"]
export const KEJADIAN_PESANAN_SAH: readonly KejadianPesanan[];  // 16 nilai, urut enum
// KejadianPesanan DITURUNKAN dari arraynya — `(typeof KEJADIAN_PESANAN_SAH)[number]`,
// BUKAN `string & {}` (keberatan A-4, diterima): `string & {}` menerima string apa pun,
// dan yang membuat salah ketik nama kejadian merah di kompilator T5/T8/T11 justru union-nya.
export type KejadianPesanan = (typeof KEJADIAN_PESANAN_SAH)[number];
export const STATUS_PESANAN_SAH: readonly StatusPesanan[];      // kelimanya, urut enum
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
// PEMAKAI WAJIB (bukan anjuran — diuji): T10 menyapu dengan `.in("status",[...PESANAN_TERBUKA])`,
// T11 memilih baris layar dengan `[...PESANAN_TERBUKA, ...PESANAN_BERUANG]` dan menyaring blok
// "Butuh perhatian" dengan `PESANAN_BERUANG.includes(...)`. NOL literal "menunggu_bayar"/"ditahan"
// di T10/T11, dan NOL himpunan KELIMA yang bernama lain. Himpunan tanpa konsumen adalah hiasan,
// dan hiasan itulah yang membuat nilai enum keenam hilang dari layar diam-diam.
// Peta perpindahan status SENGAJA tidak hidup di berkas ini: nol kode produksi P1
// membutuhkannya (yang menilai adalah `perpindahan_pesanan_sah` di transaksi yang sama), dan
// salinan TS kedua hanya jadi tempat kedua yang bisa basi. Ia hidup sebagai PENDAPAT KEDUA di
// `tests/pesanan-status-db.test.ts` (keberatan A-5, diterima).
// src/lib/pesanan/order-id.ts          (T4 melahirkan; T8,10,11,12 memakai)
// KEDUANYA WAJIB TANPA FLAG `g` (keberatan C-1, diterima — mengikat T4).
// `RegExp.test()` pada regex ber-`g` menyimpan `lastIndex` dan memulangkan false BERGANTIAN:
// di rute webhook itu berarti setiap notifikasi sah KEDUA dijawab 400, dan 400 memberi tahu
// Midtrans "sudah selesai, jangan kirim lagi" — pesanan terkunci mati dengan uang yang masuk.
export const POLA_KODE_PESANAN: RegExp;  // /^PSN-\d{6}-[0-9A-F]{6}$/      TANPA `g`
export const POLA_ORDER_ID: RegExp;      // /^PSN-\d{6}-[0-9A-F]{6}\.[1-9]$/  TANPA `g`
export function rakitOrderId(kode: string, percobaan: number): string;          // `${kode}.${percobaan}`
export function uraiOrderId(orderId: string): { kode: string; percobaan: number } | null;

// src/lib/midtrans/konfig.ts           (T8 melahirkan; T9,10,11,12 memakai)
export function midtransProduksi(): boolean;        // process.env.MIDTRANS_PRODUKSI === "true", TEPAT itu
// Aturan "HANYA nilai true" dijaga `web/tests/midtrans-konfig.test.ts` (T8, nol basis data):
// delapan masukan (satu positif + tujuh negatif) — "true","TRUE","1","yes","false","", undefined — dan basisSnap()/basisApiMidtrans()
// wajib memuat `.sandbox.` untuk semua kecuali yang pertama.
export function serverKeyMidtrans(): string;        // "" bila tidak terpasang → penelepon memutuskan 503
export function basisSnap(): string;                // app(.sandbox).midtrans.com/snap/v1
export function basisApiMidtrans(): string;         // api(.sandbox).midtrans.com/v2
export function urlSkripSnap(produksi: boolean): string;

// src/lib/midtrans/tanda-tangan.ts     (T8 melahirkan; T10,11,12 memakai lewat adapter)
export function hitungTandaTangan(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string;
export function tandaTanganCocok(dikirim: string, dihitung: string): boolean;
export function hitungSidik(b: {
  orderId: string; statusCode: string; transactionStatus: string; fraudStatus: string; transactionId: string;
}): string;   // sha256hex([orderId,statusCode,transactionStatus,fraudStatus,transactionId].join("|"))

// src/lib/midtrans/skema.ts            (T8 melahirkan; T10,11,12 memakai)
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

// src/lib/midtrans/kode-jawaban.ts     (T8 melahirkan; T8 saja yang memakai, tapi diuji T8 & dirujuk T12)
export type HasilWebhook =
  | "badan_terlalu_besar" | "kunci_kosong" | "skema_gagal" | "bentuk_order_id"
  | "tanda_tangan_salah" | "duplikat" | "tanpa_efek" | "diterapkan" | "pesanan_tidak_ada" | "galat";
export const KODE_JAWABAN: Record<HasilWebhook, number>;
// 400,503,400,400,401,200,200,200,200,500 — berurutan seperti tipe di atas
export function hasilRpcSah(nilai: string): nilai is HasilWebhook;
// Penjaga himpunan tertutup nilai balik RPC (keberatan C-4, diterima). Tanpa ia, nilai yang lupa
// dipetakan terbaca `KODE_JAWABAN[undefined]` = undefined, dan `NextResponse.json(..., { status:
// undefined })` menjawab 200 — kegagalan dilaporkan ke Midtrans sebagai selesai.

// src/lib/midtrans/adapter.ts          (T8 melahirkan; T9,10,11,12 memakai)
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
// `gross_amount` pada jalur `ok: true` karena itu SELALU string berbentuk angka. Ia TIDAK
// pernah dipalsukan menjadi "0": "tidak tahu berapa" bukan "nol rupiah", dan memalsukannya
// menggeser pesanan yang SUDAH DIBAYAR PENUH ke `ditahan` ber-nominal_diterima 0 — yang lalu
// tidak bisa diputuskan siapa pun karena `putuskan_pesanan_ditahan` menuntut nominal tercatat.

// src/lib/pesanan/periksa-menggantung.ts   (T10 melahirkan; T11 & T12 memakai)
export const BATAS_PERIKSA_SEKALI = 3;
export type PesananDiperiksa = { id: string; kode: string; percobaan: number; kedaluwarsaPada: string };
export type HasilPeriksaPesanan =
  | "diterapkan" | "duplikat" | "tanpa_efek" | "pesanan_tidak_ada"
  | "bentuk_order_id" | "belum_kedaluwarsa" | "midtrans_tak_terjawab" | "galat_basis_data";
export async function terapkanJawabanMidtrans(p: PesananDiperiksa): Promise<HasilPeriksaPesanan>;
// TIDAK PERNAH melempar — termasuk `rakitOrderId`, yang MELEMPAR untuk kode cacat dan karena itu
// WAJIB berada DI DALAM try; hasilnya `"bentuk_order_id"` (keberatan pemeriksa L0-6, diterima).
export async function sapuPesananMenggantung(
  pemilih: SupabaseClient, batasBaris: number, clientId?: string | null,
): Promise<{ diperiksa: number }>;   // MELEMPAR bila PEMILIHAN barisnya gagal
// `clientId` menyempitkan radius ke satu klien. Lapis 1b WAJIB mengisinya (lihat di bawah);
// Lapis 3 (cron, service role, lintas klien) membiarkannya null.
// Loopnya membungkus SETIAP baris dengan try sendiri: satu baris cacat tidak boleh memakan sapuan.
export async function periksaPesananMenggantung(): Promise<{ diperiksa: number }>;
// Memilih pesanan `menunggu_bayar` MILIK PEMANGGIL lalu menerapkan jawabannya lewat
// terapkan_notifikasi_midtrans DENGAN SERVICE ROLE. Menyembunyikan kegagalan: never throws.
// RADIUSNYA TIDAK BOLEH BERSANDAR PADA RLS SAJA: `orders` punya DUA policy SELECT, dan yang
// kedua (`"pesanan: staf baca"`) memulangkan pesanan SELURUH klien untuk sesi admin/owner.
// Karena itu fungsi ini membaca `clients` milik pemanggil lebih dulu; tanpa baris klien ia
// memulangkan `{ diperiksa: 0 }`, dan dengan baris klien ia mengoper `clientId` ke penyapu.

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
**Jangan `gen_random_bytes`** — pgcrypto nol hasil di seluruh 84 migrasi (diverifikasi).

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
- `POLA_PENULIS` = `/(insert\s+into|update)\s+(public\.)?(orders|order_items|jejak_pesanan|digital_entitlements)\b/i`
  dijalankan atas `pg_proc.prosrc` **yang komentarnya sudah dibuang**.

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

---
---

### Task 1: Enum pesanan + `perpindahan_pesanan_sah`

**Files:**
- Create: `web/src/lib/pesanan/status.ts`
- Create: `web/supabase/migrations/20260926100000_pesanan_enum.sql`
- Test: `web/tests/pesanan-status-db.test.ts`

**Interfaces:**
- Consumes: nihil dari P1 (tugas pertama). Dari repo: `querySql(sql: string, params?: unknown[]): Promise<T[]>` dari `web/tests/helpers/db.ts`.
- Produces:
  - `public.order_status` = enum 5 nilai (`menunggu_bayar`, `ditahan`, `lunas`, `kedaluwarsa`, `dibatalkan`)
  - `public.order_item_source` = enum 2 nilai (`produk_digital`, `sesi`)
  - `public.order_event` = enum 16 nilai (`dibuat`, `token_terbit`, `notifikasi`, `lunas`, `ditahan`, `kedaluwarsa`, `dibatalkan`, `selisih_nominal`, `selisih_status`, `lunas_setelah_tutup`, `akses_terbit`, `akses_sudah_ada`, `akses_tertahan`, `penangan_belum_ada`, `diperiksa_ulang`, `tinjauan_ditutup`)
  - `public.perpindahan_pesanan_sah(p_dari public.order_status, p_ke public.order_status) returns boolean` — `language sql immutable security definer set search_path = public`, ditutup `revoke all ... from public, anon, authenticated`
  - `web/src/lib/pesanan/status.ts` mengekspor: `StatusPesanan`, `SumberItemPesanan`, `KejadianPesanan`, `STATUS_PESANAN_SAH`, `SUMBER_ITEM_PESANAN`, `KEJADIAN_PESANAN_SAH`, `PESANAN_TERBUKA`, `PESANAN_TIDAK_AKTIF`, `PESANAN_BERUANG`, `PESANAN_MATI`, `KEJADIAN_BUTUH_TINJAUAN`, `LABEL_STATUS_PESANAN`, `JAM_TENGGAT_PESANAN = 24`, `MENIT_JEDA_PERIKSA = 5`, `JAM_TENGGANG_404 = 1`

**BACA DULU** (pola yang ditiru, path lengkap):
- `/Users/arvinfairuz/Documents/padma/web/src/lib/jadwal/status.ts` — cetakan modul status MURNI: nol impor, `as const` + tipe turunan, dan dokblok yang menjelaskan KENAPA daftarnya hidup di satu tempat. Modul pesanan meniru bentuknya persis, termasuk larangan mengimpor apa pun (ia akan diimpor komponen `"use client"` di Tugas 9).
- `/Users/arvinfairuz/Documents/padma/web/tests/rantai-status-db.test.ts` — cetakan uji "melingkari `pg_enum`": fungsi `nilaiEnum(nama)` di baris 17-27 dan loop lengkap seluruh pasangan `(dari, ke)` di baris 71-105. Uji Tugas 1 adalah saudara berkas ini untuk enum pesanan.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260912101000_status_bayar_pagar.sql:57-78` — bentuk `perpindahan_*_sah` yang sudah jadi preseden rumah: `language sql immutable`, satu `case` atas `dari`, lalu `revoke execute`.
- `/Users/arvinfairuz/Documents/padma/web/tests/hak-default-sequence-fungsi.test.ts:253-266` — bukti empiris yang jadi alasan baris `revoke` di migrasi ini WAJIB menyebut `authenticated`: fungsi yang baru dibuat LAHIR ber-EXECUTE untuk `authenticated` (`authenticated_bisa` di-assert `true`).
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260828230000_fail_closed_sequence_fungsi.sql:176-177` — templat aturan [F] rumah, yang menulis `revoke ... from public, anon` TANPA `authenticated`. Jangan menyalinnya apa adanya; itulah lubang yang uji Tugas 7 tutup.
- `/Users/arvinfairuz/Documents/padma/web/tests/helpers/db.ts` — `querySql`, koneksi `pg` langsung. Hak fungsi hidup di katalog sistem dan tidak pernah terlihat lewat PostgREST.

---

- [ ] **Step 1: Tulis daftar harapan `src/lib/pesanan/status.ts`**

Berkas ini BUKAN implementasi yang diuji. Yang diuji adalah basis data; berkas ini adalah **daftar harapannya** — persis peran `src/lib/jadwal/status.ts` terhadap `tests/rantai-status-db.test.ts`. Karena itu ia ditulis lebih dulu, dan uji di Step 2 membandingkannya dengan `pg_enum`.

Buat `/Users/arvinfairuz/Documents/padma/web/src/lib/pesanan/status.ts`:

```ts
/**
 * SATU-SATUNYA tempat di TypeScript yang tahu nama-nama status pesanan.
 *
 * Kenapa berkas ini lahir sebelum satu tabel pun: mengganti nilai enum adalah
 * perubahan yang gagal DIAM-DIAM. Kode yang membandingkan dengan nilai lama
 * tidak melempar apa pun — ia hanya berhenti cocok, dan untuk mesin PEMBAYARAN
 * bentuk kegagalannya adalah pesanan yang uangnya sudah masuk tapi tidak muncul
 * di layar siapa pun.
 *
 * Berkas ini MURNI: nol impor. Ia dipakai server action, route handler, DAN
 * komponen `"use client"` (tombol beli, Tugas 9) — satu impor Supabase di sini
 * sudah cukup menyeret klien service role ke bundel peramban (konvensi
 * `src/lib/auth/pesan-undangan.ts`).
 *
 * ===== HIMPUNAN, BUKAN KONSTANTA TUNGGAL =====
 * Keempat himpunan di bawah adalah pelajaran yang repo ini sudah bayar sekali:
 * nilai enum baru membuat konstanta tunggal salah diam-diam. `status === "lunas"`
 * benar hari ini dan salah begitu `ditahan` lahir; `PESANAN_BERUANG.includes(...)`
 * memaksa orang berikutnya memutuskan di mana nilai barunya masuk.
 *
 * ===== KENAPA BUKAN MENGIMPOR `JAM_TENGGAT_BAYAR` =====
 * `src/lib/tagihan/tenggat.ts:10` sudah mengekspor `JAM_TENGGAT_BAYAR = 24`
 * untuk tenggat bayar SESI. `JAM_TENGGAT_PESANAN` di bawah bernilai sama dan
 * SENGAJA tidak mengimpornya: P3-lah yang memindahkan pembayaran sesi ke mesin
 * pesanan, dan penyatuan dua konstanta ini adalah keputusannya, bukan keputusan
 * P1. Menyatukannya sekarang berarti P1 mendahului keputusan yang belum diambil.
 */

/**
 * Enum `order_status` — LIMA nilai, bukan enam.
 *
 * `ditinjau` sengaja tidak ada. Ia akan menjadi mekanisme tinjauan kedua yang
 * hidup berdampingan dengan `butuh_tinjauan_pada` tanpa satu pun kalimat yang
 * menyebut apa yang melahirkannya, dan pesanan yang masuk ke sana tidak punya
 * jalan pulang. Penanda tinjauan sekarang SATU, dan ia ortogonal terhadap
 * status.
 *
 * Urutannya mengikuti alur nyata (terbuka dulu, lalu ketiga keadaan akhir),
 * dan urutan itu MENGIKAT: `tests/pesanan-status-db.test.ts` membandingkannya
 * dengan `pg_enum` menurut `enumsortorder`, bukan menurut abjad.
 */
export const STATUS_PESANAN_SAH = [
  "menunggu_bayar",
  "ditahan",
  "lunas",
  "kedaluwarsa",
  "dibatalkan",
] as const;

export type StatusPesanan = (typeof STATUS_PESANAN_SAH)[number];

/**
 * Enum `order_item_source`.
 *
 * `sesi` lahir sekarang meski NOL penulis di P1 — preseden yang sama dengan
 * `entitlement_source.'beli'`. Yang membuatnya bukan kolom mati: `order_items`
 * membawa dua CHECK bercermin yang menjadikan nilai ini sah hanya bersama
 * `booking_request_id`, dan P3 tinggal mengisinya tanpa `alter table` pada
 * tabel uang yang sudah memuat nota nyata.
 */
export const SUMBER_ITEM_PESANAN = ["produk_digital", "sesi"] as const;

export type SumberItemPesanan = (typeof SUMBER_ITEM_PESANAN)[number];

/**
 * Enum `order_event` — 16 nilai, urut sama dengan `pg_enum`.
 *
 * Tidak ada kejadian "tinjauan dibuka": yang membukanya SELALU salah satu dari
 * kelima kejadian di `KEJADIAN_BUTUH_TINJAUAN`, dan nilai enum yang tidak punya
 * penulis adalah nilai yang pasti salah dibaca kelak.
 */
export const KEJADIAN_PESANAN_SAH = [
  "dibuat",
  "token_terbit",
  "notifikasi",
  "lunas",
  "ditahan",
  "kedaluwarsa",
  "dibatalkan",
  "selisih_nominal",
  "selisih_status",
  "lunas_setelah_tutup",
  "akses_terbit",
  "akses_sudah_ada",
  "akses_tertahan",
  "penangan_belum_ada",
  "diperiksa_ulang",
  "tinjauan_ditutup",
] as const;

export type KejadianPesanan = (typeof KEJADIAN_PESANAN_SAH)[number];

/** TERBUKA — satu-satunya keadaan yang boleh menerima uang. */
export const PESANAN_TERBUKA: readonly StatusPesanan[] = ["menunggu_bayar"];

/** TIDAK AKTIF — sudah punya cap `ditutup_pada`, apa pun sebabnya. */
export const PESANAN_TIDAK_AKTIF: readonly StatusPesanan[] = [
  "ditahan",
  "lunas",
  "kedaluwarsa",
  "dibatalkan",
];

/**
 * BERUANG — uang sudah masuk.
 *
 * `ditahan` ikut, dan itu seluruh alasan status itu ada: "uang masuk tapi
 * jumlahnya tidak cocok" butuh keadaan AKHIR. Tanpanya pesanan itu
 * `menunggu_bayar` selamanya, diperiksa ulang setiap kali kliennya membuka
 * halaman DAN disapu penjadwal — kejadian yang seharusnya paling langka
 * menjadi kebisingan paling berisik yang tak pernah didengar.
 */
export const PESANAN_BERUANG: readonly StatusPesanan[] = ["lunas", "ditahan"];

/** MATI — boleh checkout ulang; tidak ada uang yang tertinggal di sini. */
export const PESANAN_MATI: readonly StatusPesanan[] = ["kedaluwarsa", "dibatalkan"];

/**
 * Kejadian yang WAJIB menyalakan `butuh_tinjauan_pada` + `sebab_tinjauan` pada
 * baris `orders`-nya, di transaksi yang sama dengan jejaknya.
 *
 * Aturannya tunggal dan mengikat, dan tanpa aturan itu dua kegagalan termahal
 * lolos dari jaring yang justru ada untuk mereka. `lunas_setelah_tutup` adalah
 * settlement yang mendarat pada pesanan `kedaluwarsa`/`dibatalkan`: statusnya
 * bukan `ditahan` dan bukan `lunas`, jadi ia tidak muncul di blok mana pun
 * meski uangnya sudah masuk. `akses_tertahan` sama: terminal, dan "terminal"
 * justru yang lolos.
 */
export const KEJADIAN_BUTUH_TINJAUAN: readonly KejadianPesanan[] = [
  "selisih_nominal",
  "selisih_status",
  "lunas_setelah_tutup",
  "akses_tertahan",
  "penangan_belum_ada",
];

/**
 * Label layar untuk setiap status. `Record` bertipe penuh, bukan
 * `Partial<Record<...>>`: nilai enum baru yang lupa diberi label akan
 * memerahkan kompilator, bukan merender string kosong di panel staf.
 */
export const LABEL_STATUS_PESANAN: Record<StatusPesanan, string> = {
  menunggu_bayar: "Menunggu pembayaran",
  ditahan: "Ditahan — perlu diputuskan",
  lunas: "Lunas",
  kedaluwarsa: "Kedaluwarsa",
  dibatalkan: "Dibatalkan",
};

/**
 * Tenggat pesanan, dalam jam. SATU konstanta untuk DUA tempat: kolom
 * `orders.kedaluwarsa_pada` dan `expiry` di payload Snap.
 *
 * Dua angka yang boleh berbeda adalah dua kegagalan simetris. Kolom lebih
 * pendek: kita berhenti bertanya sementara VA-nya masih bisa dibayar, dan
 * settlement mendarat pada pesanan yang sudah kita tutup. Kolom lebih panjang:
 * penyapu menanyai Midtrans tentang transaksi yang tak akan pernah berubah.
 */
export const JAM_TENGGAT_PESANAN = 24;

/**
 * Pembatas Lapis 1b: satu pesanan tidak pernah ditanyakan ke Status API lebih
 * sering dari sekali per lima menit (`orders.diperiksa_pada`). Tanpanya satu
 * halaman yang di-refresh berkali-kali berubah jadi banjir permintaan.
 */
export const MENIT_JEDA_PERIKSA = 5;

/**
 * Margin terhadap jam Midtrans sebelum jawaban 404 ("Transaction doesn't
 * exist") boleh dibaca sebagai kedaluwarsa. Bukan perpanjangan tenggat: yang
 * memutuskan tetap Midtrans — ia menyatakan transaksinya tidak pernah ada —
 * dan waktu lokal hanya memutuskan kapan berhenti bertanya.
 */
export const JAM_TENGGANG_404 = 1;
```

---

- [ ] **Step 2: Tulis uji yang gagal**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-status-db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import {
  STATUS_PESANAN_SAH,
  SUMBER_ITEM_PESANAN,
  KEJADIAN_PESANAN_SAH,
  KEJADIAN_BUTUH_TINJAUAN,
  PESANAN_TERBUKA,
  PESANAN_TIDAK_AKTIF,
  PESANAN_BERUANG,
  PESANAN_MATI,
  LABEL_STATUS_PESANAN,
  JAM_TENGGAT_PESANAN,
  MENIT_JEDA_PERIKSA,
  JAM_TENGGANG_404,
  type StatusPesanan,
} from "@/lib/pesanan/status";

/**
 * Enum Postgres dan daftar TypeScript adalah DUA daftar yang harus identik —
 * persis jenis kesalahan yang paling mudah terjadi dan paling sulit terlihat.
 * Berkas ini karena itu MELINGKARI `pg_enum`, bukan mengulang daftarnya:
 * sumber kebenarannya basis data, dan `src/lib/pesanan/status.ts` adalah
 * KLAIM yang diadu dengannya. Menulis daftar ketiga di sini berarti tiga
 * tempat yang bisa berbeda.
 */
async function nilaiEnum(nama: string): Promise<string[]> {
  const baris = await querySql<{ label: string }>(
    `select e.enumlabel as label
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = $1
      order by e.enumsortorder`,
    [nama],
  );
  return baris.map((b) => b.label);
}

/**
 * Peta perpindahan yang diharapkan, ditulis DI SINI dan bukan di
 * `src/lib/pesanan/status.ts`.
 *
 * Alasannya: tidak satu pun kode produksi P1 membutuhkan peta ini di
 * TypeScript — yang menilai perpindahan adalah `perpindahan_pesanan_sah()` di
 * dalam transaksi yang sama dengan penulisannya, dan peta TS kedua hanya akan
 * jadi tempat kedua yang bisa basi. Yang dibutuhkan uji adalah PENDAPAT KEDUA,
 * dan pendapat kedua memang tempatnya di berkas uji.
 */
const PERPINDAHAN_PESANAN: Record<StatusPesanan, readonly StatusPesanan[]> = {
  menunggu_bayar: ["lunas", "ditahan", "kedaluwarsa", "dibatalkan"],
  // HANYA lewat RPC putusan staf (Tugas 4). Petanya tetap di sini karena
  // fungsi penilai tidak tahu siapa pemanggilnya — dan memang tidak boleh
  // tahu: ia penjaga INTEGRITAS, bukan penjaga otorisasi.
  ditahan: ["lunas", "dibatalkan"],
  lunas: [],
  kedaluwarsa: [],
  dibatalkan: [],
};

describe("enum pesanan lahir utuh di basis data", () => {
  it("order_status berisi PERSIS lima nilai, urut sama dengan daftar TS", async () => {
    expect(await nilaiEnum("order_status")).toEqual([...STATUS_PESANAN_SAH]);
  });

  it("order_status TIDAK memuat 'ditinjau' — penanda tinjauan hanya satu kolom", async () => {
    // Nilai keenam ini dibuang sadar di spec: ia mekanisme tinjauan kedua yang
    // hidup berdampingan dengan `butuh_tinjauan_pada`, dan pesanan yang masuk
    // ke sana tidak punya jalan pulang. Assertion ini menahannya lahir kembali
    // lewat `alter type ... add value` di migrasi mana pun sesudah ini.
    expect(await nilaiEnum("order_status")).not.toContain("ditinjau");
  });

  it("order_item_source berisi PERSIS dua nilai", async () => {
    expect(await nilaiEnum("order_item_source")).toEqual([...SUMBER_ITEM_PESANAN]);
  });

  it("order_event berisi PERSIS enam belas nilai, urut sama dengan daftar TS", async () => {
    const nilai = await nilaiEnum("order_event");
    expect(nilai).toHaveLength(16);
    expect(nilai).toEqual([...KEJADIAN_PESANAN_SAH]);
  });

  it("pay_status TIDAK ikut diperlebar — order_status adalah tipe TERPISAH", async () => {
    // Nol `alter type pay_status add value` berarti nol risiko 55P04, dan
    // assertion money firewall yang mengunci ketiga pemilik kolom
    // `status_bayar` (tests/money-firewall-struktural.test.ts:236-240) tetap
    // utuh. Uji ini yang menahan "gampang, tambahkan saja ke pay_status".
    expect(await nilaiEnum("pay_status")).toEqual(["belum", "menunggu_verifikasi", "lunas"]);
  });
});

describe("himpunan status — partisi yang tidak boleh bocor", () => {
  it("TERBUKA dan TIDAK AKTIF bersama menutup kelima nilai, tanpa tumpang tindih", () => {
    // Nilai enum keenam yang kelak lahir dan lupa diklasifikasikan jatuh ke
    // luar KEDUANYA, dan uji ini yang menemukannya — bukan pengguna yang
    // pesanannya menghilang dari kedua blok layar staf.
    expect([...PESANAN_TERBUKA, ...PESANAN_TIDAK_AKTIF].sort()).toEqual(
      [...STATUS_PESANAN_SAH].sort(),
    );
    const irisan = PESANAN_TERBUKA.filter((s) => PESANAN_TIDAK_AKTIF.includes(s));
    expect(irisan).toEqual([]);
  });

  it("BERUANG dan MATI membelah TIDAK AKTIF tepat dua, tanpa sisa", () => {
    expect([...PESANAN_BERUANG, ...PESANAN_MATI].sort()).toEqual([...PESANAN_TIDAK_AKTIF].sort());
    expect(PESANAN_BERUANG.filter((s) => PESANAN_MATI.includes(s))).toEqual([]);
  });

  it("ditahan ada di BERUANG — uangnya sudah masuk, hanya jumlahnya meleset", () => {
    expect(PESANAN_BERUANG).toContain("ditahan");
    expect(PESANAN_MATI).not.toContain("ditahan");
  });

  it("setiap status punya label layar", () => {
    expect(Object.keys(LABEL_STATUS_PESANAN).sort()).toEqual([...STATUS_PESANAN_SAH].sort());
    for (const s of STATUS_PESANAN_SAH) {
      expect(LABEL_STATUS_PESANAN[s].length, `label ${s} kosong`).toBeGreaterThan(0);
    }
  });

  it("kelima kejadian penanda tinjauan adalah anggota sah order_event", () => {
    for (const k of KEJADIAN_BUTUH_TINJAUAN) {
      expect(KEJADIAN_PESANAN_SAH, `kejadian ${k} bukan anggota order_event`).toContain(k);
    }
    expect([...KEJADIAN_BUTUH_TINJAUAN]).toEqual([
      "selisih_nominal",
      "selisih_status",
      "lunas_setelah_tutup",
      "akses_tertahan",
      "penangan_belum_ada",
    ]);
  });

  it("konstanta waktu bernilai seperti yang diputuskan spec", () => {
    expect(JAM_TENGGAT_PESANAN).toBe(24);
    expect(MENIT_JEDA_PERIKSA).toBe(5);
    expect(JAM_TENGGANG_404).toBe(1);
  });
});

describe("perpindahan_pesanan_sah", () => {
  it("menilai KEDUA PULUH LIMA pasangan persis seperti petanya", async () => {
    // Seluruh pasangan, termasuk `dari = ke`: perpindahan ke dirinya sendiri
    // harus false, bukan "tidak diuji". Pemanggil yang lupa menyaring
    // `is not distinct from` akan menabraknya, dan itu memang yang benar.
    for (const dari of STATUS_PESANAN_SAH) {
      for (const ke of STATUS_PESANAN_SAH) {
        const [{ hasil }] = await querySql<{ hasil: boolean | null }>(
          `select public.perpindahan_pesanan_sah($1::public.order_status,
                                                 $2::public.order_status) as hasil`,
          [dari, ke],
        );
        const diharapkan = PERPINDAHAN_PESANAN[dari].includes(ke);
        expect(
          hasil,
          `perpindahan ${dari} -> ${ke} seharusnya ${diharapkan ? "SAH" : "DITOLAK"}`,
        ).toBe(diharapkan);
      }
    }
  });

  it("nilai enum yang TIDAK dikenal dijawab false, bukan NULL (else false)", async () => {
    // Inilah uji `else false`, dan ia bisa dijalankan tanpa melahirkan nilai
    // enum keenam: `case p_dari when 'menunggu_bayar' then ...` dengan p_dari
    // NULL tidak cocok dengan satu `when` pun, jadi ia jatuh ke cabang ELSE.
    // Tanpa `else false`, `case` tanpa cabang yang cocok memulangkan NULL —
    // dan `if not NULL then` TIDAK PERNAH dieksekusi, sehingga penjaganya
    // fail-OPEN. Assertion ini yang membedakan keduanya.
    const [{ hasil }] = await querySql<{ hasil: boolean | null }>(
      `select public.perpindahan_pesanan_sah(null::public.order_status,
                                             'lunas'::public.order_status) as hasil`,
    );
    expect(hasil).toBe(false);
  });

  it("sasaran NULL memulangkan NULL — INILAH alasan pemanggil membungkus coalesce", async () => {
    // Bukan cacat yang dibiarkan diam-diam, melainkan kontrak yang ditulis
    // sebagai uji: `p_ke in (...)` atas NULL bernilai NULL, jadi cabang `then`
    // memulangkan NULL walau `else false` sudah ada. Setiap pemanggil di
    // Tugas 4 dan Tugas 5 karena itu WAJIB menulis
    // `coalesce(public.perpindahan_pesanan_sah(...), false)`. Bila seseorang
    // kelak membuat fungsi ini tidak pernah NULL, uji ini yang merah — dan
    // itulah saat yang tepat untuk mencabut coalesce di pemanggilnya.
    const [{ hasil }] = await querySql<{ hasil: boolean | null }>(
      `select public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                             null::public.order_status) as hasil`,
    );
    expect(hasil).toBeNull();
  });
});

describe("hak fungsi mesin", () => {
  it("authenticated TIDAK boleh mengeksekusi perpindahan_pesanan_sah", async () => {
    // Fungsi baru LAHIR ber-EXECUTE untuk authenticated — dibuktikan
    // tests/hak-default-sequence-fungsi.test.ts:253-266 — dan templat aturan
    // [F] repo sendiri menulis `revoke ... from public, anon` TANPA menyebut
    // authenticated. Implementer yang mengikuti templat rumah membuka pintu
    // dan suite tetap hijau. Assertion ini merah tepat pada kelalaian itu.
    const [row] = await querySql<{ bisa: boolean }>(
      `select has_function_privilege(
                'authenticated',
                'public.perpindahan_pesanan_sah(public.order_status, public.order_status)'::regprocedure,
                'EXECUTE') as bisa`,
    );
    expect(row.bisa).toBe(false);
  });

  it("anon TIDAK boleh mengeksekusinya", async () => {
    const [row] = await querySql<{ bisa: boolean }>(
      `select has_function_privilege(
                'anon',
                'public.perpindahan_pesanan_sah(public.order_status, public.order_status)'::regprocedure,
                'EXECUTE') as bisa`,
    );
    expect(row.bisa).toBe(false);
  });

  it("service_role TETAP boleh — jalur webhook & penyapu berjalan dengannya", async () => {
    // Pencabutan yang membabi buta akan melumpuhkan justru jalur yang
    // membutuhkannya. Dua arah, satu batas.
    const [row] = await querySql<{ bisa: boolean }>(
      `select has_function_privilege(
                'service_role',
                'public.perpindahan_pesanan_sah(public.order_status, public.order_status)'::regprocedure,
                'EXECUTE') as bisa`,
    );
    expect(row.bisa).toBe(true);
  });
});
```

---

- [ ] **Step 3: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-status-db.test.ts
```

Kegagalan yang diharapkan — dan perhatikan bahwa ia bukan "modul tidak ditemukan": `src/lib/pesanan/status.ts` sudah ada sejak Step 1, jadi berkasnya memuat dan yang merah adalah BASIS DATA-nya.

- `order_status berisi PERSIS lima nilai…` → `expected [] to deeply equal [ 'menunggu_bayar', … ]` (tipe enumnya belum ada, `nilaiEnum` memulangkan array kosong).
- `order_item_source berisi PERSIS dua nilai` dan `order_event berisi PERSIS enam belas nilai` → sama, `[]`.
- Ketiga kasus `perpindahan_pesanan_sah` → melempar `function public.perpindahan_pesanan_sah(order_status, order_status) does not exist` (SQLSTATE 42883).
- Ketiga kasus `hak fungsi mesin` → melempar `type "public.order_status" does not exist` saat `::regprocedure` diurai.

Yang HIJAU sejak sekarang dan memang harus begitu: seluruh `describe("himpunan status …")` (ia menguji daftar TS terhadap dirinya sendiri) dan `pay_status TIDAK ikut diperlebar` (kontrol positif — ia membuktikan `nilaiEnum` benar-benar bisa membaca enum yang ADA, sehingga `[]` di atas berarti "belum ada", bukan "helper-nya rusak").

---

- [ ] **Step 4: Tulis migrasinya**

Buat `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260926100000_pesanan_enum.sql`:

```sql
-- ===========================================================================
-- INTI PEMBAYARAN (1/6) — TIGA ENUM + PENILAI PERPINDAHAN
-- ===========================================================================
-- Cap waktu 20260926* dipilih di atas 20260924100000, BUKAN sekadar di atas
-- tip `main` (20260921170000). Cabang `umpan-balik-klien-gelombang-1` membawa
-- 20260922100000 dan 20260924100000 yang belum ter-merge; mulai dari 20260926
-- membuat urutan penerapan sama antara DB segar dan DB yang sudah menerima
-- cabang itu.
--
-- Berkas ini HANYA melahirkan tipe dan satu fungsi murni. Tidak ada tabel di
-- sini, dan itu disengaja: `alter type ... add value` tidak boleh dipakai di
-- transaksi yang sama dengan pemakaian nilainya (55P04), dan Supabase CLI
-- menjalankan tiap berkas migrasi dalam transaksinya sendiri. Memisahkan enum
-- ke berkasnya sendiri membuat migrasi berikutnya bebas memakainya.

-- ---------------------------------------------------------------------------
-- (1) STATUS PESANAN — LIMA nilai, bukan enam
-- ---------------------------------------------------------------------------
-- `ditinjau` sengaja TIDAK dibuat. Ia akan menjadi mekanisme tinjauan kedua
-- yang hidup berdampingan dengan `orders.butuh_tinjauan_pada` tanpa satu pun
-- kalimat yang menyebut apa yang melahirkannya, dan pesanan yang masuk ke
-- sana tidak punya jalan pulang. Penanda tinjauan sekarang SATU kolom, dan ia
-- ortogonal terhadap status.
--
-- Tipe ini SENGAJA terpisah dari `pay_status`. Nol `alter type pay_status add
-- value` berarti nol risiko 55P04 pada enum yang sudah dipakai tiga tabel,
-- dan assertion money firewall yang mengunci ketiga pemilik kolom
-- `status_bayar` tetap utuh. Kolom status pesanan karena itu bernama `status`,
-- bukan `status_bayar`.
--
-- Urutan nilainya mengikuti alur nyata, dan urutan itu MENGIKAT:
-- tests/pesanan-status-db.test.ts membandingkannya dengan
-- src/lib/pesanan/status.ts menurut `enumsortorder`, bukan menurut abjad.
create type public.order_status as enum (
  'menunggu_bayar',
  'ditahan',
  'lunas',
  'kedaluwarsa',
  'dibatalkan'
);

comment on type public.order_status is
  'Keadaan sebuah pesanan. LIMA nilai: menunggu_bayar (satu-satunya yang boleh '
  'menerima uang), ditahan (uang masuk, jumlah tidak cocok — keadaan AKHIR, '
  'bukan antrean), lunas, kedaluwarsa, dibatalkan. Tanpa "ditinjau": penanda '
  'tinjauan adalah orders.butuh_tinjauan_pada, dan ia ortogonal terhadap status.';

-- ---------------------------------------------------------------------------
-- (2) SUMBER ITEM
-- ---------------------------------------------------------------------------
-- `sesi` lahir sekarang meski NOL penulis di P1 — preseden yang sama dengan
-- `entitlement_source.'beli'`. Yang membuatnya bukan nilai mati: `order_items`
-- (migrasi 2) membawa dua CHECK bercermin yang menjadikan nilai ini sah HANYA
-- bersama `booking_request_id`, jadi P3 tinggal mengisinya tanpa `alter table`
-- pada tabel uang yang sudah memuat nota nyata.
create type public.order_item_source as enum (
  'produk_digital',
  'sesi'
);

comment on type public.order_item_source is
  'Apa yang dibeli sebuah baris nota. `sesi` lahir tanpa penulis di P1 dan '
  'diisi P3; ongkosnya asimetris — satu nilai enum hari ini versus alter type '
  'pada tabel uang berisi nota nyata besok.';

-- ---------------------------------------------------------------------------
-- (3) KEJADIAN PESANAN — 16 nilai
-- ---------------------------------------------------------------------------
-- Tidak ada nilai "tinjauan dibuka". Yang membuka tinjauan SELALU salah satu
-- dari lima: selisih_nominal, selisih_status, lunas_setelah_tutup,
-- akses_tertahan, penangan_belum_ada. Nilai enum yang tidak punya penulis
-- adalah nilai yang pasti salah dibaca kelak.
--
-- Kejadian inilah yang dijanjikan ke proyek WhatsApp (proyek TERPISAH): P1
-- menerbitkan dan mencatat, nol pelanggan. Tidak ada kolom `dikirim_wa_pada`
-- di mana pun — hanya proyek WA yang tahu apa artinya "sudah terkirim", dan
-- kolom mati adalah persis yang doktrin repo ini tolak.
create type public.order_event as enum (
  'dibuat',
  'token_terbit',
  'notifikasi',
  'lunas',
  'ditahan',
  'kedaluwarsa',
  'dibatalkan',
  'selisih_nominal',
  'selisih_status',
  'lunas_setelah_tutup',
  'akses_terbit',
  'akses_sudah_ada',
  'akses_tertahan',
  'penangan_belum_ada',
  'diperiksa_ulang',
  'tinjauan_ditutup'
);

comment on type public.order_event is
  'Kejadian yang dicatat jejak_pesanan. Lima di antaranya (selisih_nominal, '
  'selisih_status, lunas_setelah_tutup, akses_tertahan, penangan_belum_ada) '
  'WAJIB menyalakan orders.butuh_tinjauan_pada di transaksi yang sama dengan '
  'jejaknya — itulah satu-satunya aturan yang membuat blok "Butuh perhatian" '
  'tidak perlu tumbuh setiap kali ada nilai enum baru.';

-- ---------------------------------------------------------------------------
-- (4) PENILAI PERPINDAHAN
-- ---------------------------------------------------------------------------
-- Dipisah menjadi FUNGSI PENILAI, bukan ditanam di badan RPC. Alasannya bisa
-- diuji: fungsi penilai dapat dipanggil langsung untuk SELURUH 25 pasangan
-- tanpa membuat satu pun baris fixture — dan uji yang mahal adalah uji yang
-- lubangnya tidak pernah ditutup.
--
-- `else false` BUKAN basa-basi. Tanpa cabang itu, nilai enum keenam yang kelak
-- lahir membuat `case` memulangkan NULL, dan `if not NULL then` TIDAK PERNAH
-- dieksekusi — penjaganya fail-OPEN pada persis nilai yang belum dikenal
-- siapa pun. Pasangannya di sisi pemanggil: setiap pemakaian di migrasi 4 & 5
-- WAJIB dibungkus `coalesce(..., false)`, karena `p_ke` yang NULL tetap
-- memulangkan NULL dari dalam cabang `then`.
--
-- TIDAK bergerbang peran, dan itu disengaja (pola yang sama dengan
-- `perpindahan_permintaan_sah`, lihat komentar panjang di
-- 20260909101000_rantai_status_pagar.sql): ini penjaga INTEGRITAS —
-- "perpindahan mana yang MASUK AKAL" — dan jawabannya sama untuk siapa pun.
-- Menyalin bungkus peran ke sini akan membebaskan seluruh jalur service role,
-- dan justru di jalur itulah data uang rusak paling sering lahir.
--
-- `security definer` di sini tidak membuka apa pun: badannya nol sentuhan
-- tabel, dan haknya dicabut dari ketiga peran API di bawah. Ia ditulis supaya
-- seluruh fungsi P1 punya bentuk kepala yang sama, sehingga daftar putih di
-- tests/fungsi-mesin-tertutup.test.ts (Tugas 7) tidak perlu mengecualikan satu
-- bentuk khusus.
create or replace function public.perpindahan_pesanan_sah(
  p_dari public.order_status,
  p_ke public.order_status
) returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select case p_dari
    when 'menunggu_bayar' then p_ke in ('lunas', 'ditahan', 'kedaluwarsa', 'dibatalkan')
    when 'ditahan'        then p_ke in ('lunas', 'dibatalkan')
    when 'lunas'          then false
    when 'kedaluwarsa'    then false
    when 'dibatalkan'     then false
    else false
  end;
$$;

comment on function public.perpindahan_pesanan_sah(public.order_status, public.order_status) is
  'Penilai perpindahan status pesanan. Ditutup else false: nilai enum yang '
  'belum dikenal dijawab FALSE, bukan NULL. Pemanggilnya tetap wajib '
  'coalesce(..., false) karena sasaran NULL memulangkan NULL. Tertutup untuk '
  'seluruh peran API — ia anggota MESIN_TERTUTUP.';

-- Fungsi baru LAHIR ber-EXECUTE untuk `authenticated` (dibuktikan empiris di
-- tests/hak-default-sequence-fungsi.test.ts:253-266). Templat aturan [F] repo
-- (20260828230000_fail_closed_sequence_fungsi.sql:176-177) hanya menulis
-- `from public, anon` — menyalinnya apa adanya di sini akan membuka fungsi
-- mesin pembayaran kepada setiap pengguna login, tanpa satu pun uji merah
-- sebelum Tugas 7 lahir. Bentuk ketat di bawah adalah preseden
-- 20260830150000_pengerasan_tabel_uang.sql:197.
revoke all on function public.perpindahan_pesanan_sah(public.order_status, public.order_status)
  from public, anon, authenticated;
```

---

- [ ] **Step 5: Terapkan migrasi & jalankan uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase migration up && npx vitest run tests/pesanan-status-db.test.ts
```

`migration up` dipakai, bukan `db reset`: **Supabase lokal di mesin ini dipakai bersama sesi lain**, dan `db reset` menghapus data mereka. Bila `migration up` menolak karena riwayat lokal sudah menyimpang, barulah:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase db reset && npx vitest run tests/pesanan-status-db.test.ts
```

Seluruh kasus hijau (15 kasus).

---

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma && git add web/src/lib/pesanan/status.ts web/supabase/migrations/20260926100000_pesanan_enum.sql web/tests/pesanan-status-db.test.ts && git commit -m "$(cat <<'PESAN'
feat(pesanan): tiga enum pesanan + penilai perpindahan fail-closed

Migrasi pertama dari enam. Hanya tipe dan satu fungsi murni: nilai enum
yang baru ditambahkan tidak boleh dipakai di transaksi yang sama (55P04),
dan Supabase CLI menjalankan tiap berkas migrasi dalam transaksinya
sendiri — memisahkannya membuat lima migrasi berikutnya bebas memakainya.

order_status berisi LIMA nilai. "ditinjau" dibuang sadar: ia mekanisme
tinjauan kedua yang hidup berdampingan dengan butuh_tinjauan_pada tanpa
satu pun kalimat yang menyebut apa yang melahirkannya, dan pesanan yang
masuk ke sana tidak punya jalan pulang. Tipenya TERPISAH dari pay_status
supaya nol alter type pada enum yang sudah dipakai tiga tabel.

perpindahan_pesanan_sah ditutup `else false`. Tanpa cabang itu nilai enum
keenam membuat case memulangkan NULL, dan `if not NULL then` tidak pernah
dieksekusi — penjaganya fail-OPEN pada persis nilai yang belum dikenal
siapa pun. Ujinya membuktikannya lewat argumen NULL, dan sekaligus mengunci
kontrak sebaliknya: sasaran NULL memulangkan NULL, itulah alasan setiap
pemanggil membungkus coalesce.

Haknya dicabut juga dari `authenticated`, bukan hanya public & anon:
fungsi baru LAHIR terbuka untuk setiap pengguna login, dan templat aturan
[F] repo sendiri tidak menyebutnya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

---

### Task 2: Tabel `orders` & `order_items`

**Files:**
- Create: `web/supabase/migrations/20260926110000_pesanan_tabel.sql`
- Create: `web/tests/pesanan-nota-beku.test.ts`
- Create: `web/tests/pesanan-teks-tanpa-nominal.test.ts`
- Modify: `web/tests/money-firewall-struktural.test.ts` — **ENTRI `order_items` SAJA**:
  `:75-81` (`TABEL_UANG`), `:111-116` (`KOLOM_UANG_VIEW_DIIZINKAN`), sesudah `:183`
  (helper `kolomUangDi`), `:215-227` (assertion `toContain`), plus satu `it` baru
- Modify: `web/tests/struktur-rls.test.ts:22-32` (`SENGAJA_TERKUNCI`) — **ENTRI `order_items` SAJA**
- **JANGAN** menyunting `web/tests/grant-anon.test.ts`. Pemilik tunggalnya **Tugas 5**
  (peta §13): berkas itu menerjemahkan nama lewat `format('public.%I',$1)::regclass`, yang
  MELEMPAR `42P01` untuk relasi yang belum ada, jadi ia hanya bisa dilengkapi sekali jalan
  sesudah anggota terakhirnya — view `pesanan_item_staf` — lahir di migrasi 5. Menambah nama di
  sini tidak menutup apa pun lebih cepat (ia daftar izin murni, tidak memerahkan apa pun saat
  ditambah) dan hanya memecah kepemilikan satu berkas menjadi tiga tugas.
- **JANGAN** menulis entri/assertion `notifikasi_pesanan` maupun `notifikasi_ditolak_harian` di
  kedua berkas di atas: tabelnya lahir di Tugas 3, dan menulisnya sekarang membuat suite tugas
  ini berakhir MERAH. Entri itu milik Tugas 3 (peta §13).

**Interfaces:**
- Consumes (dari Tugas 1, tanda tangan persis): tipe `public.order_status` dan `public.order_item_source` sebagai tipe kolom; `JAM_TENGGAT_PESANAN` dari `@/lib/pesanan/status` (dipakai UJI untuk mengikat literal SQL ke konstanta TS).
- Consumes (dari repo): `public.clients(id)`, `public.digital_products(id)`, `public.booking_requests(id)`, `public.user_role()`, `auth.uid()`.
- Produces:
  - `public.orders` — 19 kolom, NOL kolom nominal: `id`, `kode`, `percobaan`, `client_id`, `status`, `jumlah_item`, `dibuat_pada`, `kedaluwarsa_pada`, `lunas_pada`, `ditutup_pada`, `snap_token`, `snap_diterbitkan_pada`, `notifikasi_pada`, `diperiksa_pada`, `butuh_tinjauan_pada`, `sebab_tinjauan`, `kanal`, `transaksi_id`, `status_midtrans`. Hak: `grant select to authenticated` saja. Dua policy SELECT.
  - `public.order_items` — 8 kolom: `id`, `pesanan_id`, `jenis`, `product_id`, `booking_request_id`, `judul_beku`, `harga_beku`, `urutan`. NOL grant, NOL policy, RLS aktif.
  - Constraint & indeks bernama: `orders_kode_unik`, `pesanan_tutup_bercap`, `pesanan_terbuka_tanpa_cap`, `pesanan_percobaan_wajar`, `pesanan_terbuka_satu_per_klien`, `orders_klien_idx`, `orders_sapuan_idx`, `item_sumber_tunggal`, `item_produk_bercermin`, `item_sesi_bercermin`, `order_items_pesanan_urutan_unik`, trigger `item_pesanan_beku`.
  - `public.tolak_ubah_item_pesanan() returns trigger` — menolak SELURUH UPDATE dengan `42501`.
- Produces (ke pagar rumah): `order_items` masuk `TABEL_UANG` & `SENGAJA_TERKUNCI`; `pesanan_item_staf` didaftarkan lebih dulu di `KOLOM_UANG_VIEW_DIIZINKAN` (pengecualian boleh mendahului objeknya — lihat Step 5). Pendaftaran `TABEL_TERTUTUP_ANON` untuk KEENAM objek P1 dikerjakan Tugas 5 sekali jalan.

**BACA DULU** (pola yang ditiru, path lengkap):
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921110000_produk_harga.sql` — cetakan tabel uang rumah: `revoke all ... from anon, authenticated` sebagai titik nol yang disengaja, komentar tabel yang menyebut invariannya, dan penjelasan kenapa ketiadaan policy ITULAH pagarnya.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921120000_produk_entitlement.sql:41-60` — bentuk policy `to authenticated` EKSPLISIT, dan alasannya: policy tanpa target lahir `to public`, dan `public` mencakup `anon`, sehingga SELECT anon ikut memanggil `user_role()` yang haknya sudah dicabut dan gagal 42501 alih-alih memulangkan nol baris.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260829160000_jejak_status_bayar.sql:54-60` — urutan `revoke all` lalu `grant select`, dengan alasannya (default privileges Supabase memberi `authenticated` hak penuh atas setiap tabel baru).
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-harga-publik.test.ts:13-22` — cetakan assertion "berkolom PERSIS", dan `:51-69` — cetakan "sisipkan satu baris lewat service role tepat sebelum diperiksa, supaya `0 baris` membuktikan PENYARINGAN, bukan ketiadaan data".
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-ambil-gratis.test.ts:1-21` — cetakan fixture produk digital (`semai()` + `afterEach` yang membongkar).
- `/Users/arvinfairuz/Documents/padma/web/tests/helpers/nominal.ts` — `nominalDalam(teks)`; dokbloknya menjelaskan kenapa ambang digitnya dipilih seperti itu untuk MARKUP. Uji teks-tanpa-nominal di Step 4 sengaja memakai pola yang BERBEDA, dan alasannya ditulis di dokbloknya sendiri.
- `/Users/arvinfairuz/Documents/padma/web/tests/money-firewall-struktural.test.ts` UTUH — terutama `TABEL_UANG` (`:75-81`), `KOLOM_UANG_VIEW_DIIZINKAN` (`:111-116`), kesembilan belas `POLA_NOMINAL` (`:124-144`), dan sapuan yang mencakup BASE TABLE **dan** VIEW (`:177`).

---

- [ ] **Step 1: Tulis uji nota beku yang gagal**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-nota-beku.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { JAM_TENGGAT_PESANAN } from "@/lib/pesanan/status";

/**
 * NOTA PESANAN — tabel uang yang barisnya tidak boleh ditulis ulang.
 *
 * `order_items.harga_beku` adalah satu-satunya angka yang dipakai
 * memverifikasi `gross_amount` notifikasi Midtrans. Bila baris itu bisa
 * disunting sesudah terbit, verifikasi jumlah berhenti berarti apa pun:
 * siapa pun yang bisa menulisnya bisa membuat setiap notifikasi "cocok".
 *
 * Karena itu pembekuannya dijaga TRIGGER, bukan ketiadaan policy. Ketiadaan
 * policy menjaga peran API; yang paling mungkin menulis ulang harga beku
 * justru webhook ber-SERVICE ROLE, dan service role melewati RLS sepenuhnya.
 * Uji di describe "pembekuan" karena itu menembak DUA jalur: PostgREST dengan
 * service role, dan SQL langsung sebagai `postgres`.
 *
 * DELETE sengaja TIDAK dijaga, dan itu diuji sebagai assertion positif:
 * cascade dari `orders` menjalankan DELETE sungguhan pada baris anak, dan
 * menolaknya membuat pesanan mustahil dihapus siapa pun — termasuk
 * pembersihan fixture berkas ini sendiri.
 */

// Diketik ulang, bukan diimpor dari scripts/seed-users.ts — pola yang sama
// dengan tests/link-client-injeksi.test.ts:36-38. Sumbernya
// scripts/seed-users.ts:23-24; keduanya disemai tests/global-setup.ts.
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

const svc = createAdminSupabase();

/**
 * Sampah fixture, dibongkar terbalik di afterEach.
 *
 * URUTANNYA MENGIKAT: pesanan lebih dulu (cascade menyapu itemnya), baru
 * produk. `orders.client_id` ber-`on delete restrict`, jadi klien seed tidak
 * pernah ikut tersentuh — itu memang maksudnya: nota yang bisa lenyap bukan
 * nota.
 *
 * Kenapa ini bukan kerapian belaka: `pesanan_terbuka_satu_per_klien` adalah
 * indeks unik PARSIAL atas (client_id) untuk status 'menunggu_bayar'. Satu
 * pesanan terbuka yang tertinggal di sini akan memerahkan SETIAP berkas uji
 * lain yang membuat pesanan untuk klien yang sama — termasuk uji checkout
 * Tugas 4.
 */
const pesananSampah: string[] = [];
const produkSampah: string[] = [];
const permintaanSampah: string[] = [];

afterEach(async () => {
  while (pesananSampah.length) {
    await svc.from("orders").delete().eq("id", pesananSampah.pop()!);
  }
  while (permintaanSampah.length) {
    await svc.from("booking_requests").delete().eq("id", permintaanSampah.pop()!);
  }
  while (produkSampah.length) {
    await svc.from("digital_products").delete().eq("id", produkSampah.pop()!);
  }
});

let urutanSlug = 0;

async function semaiProduk(judul = "Uji nota beku"): Promise<string> {
  urutanSlug += 1;
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul, slug: `uji-nota-beku-${Date.now()}-${urutanSlug}`, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkSampah.push(data!.id);
  return data!.id;
}

/**
 * Satu permintaan jadwal, bahan uji CHECK bercermin sisi `sesi`.
 *
 * Statusnya 'ditolak' SENGAJA: indeks dedup antrean
 * (`booking_requests_antrean_unik`) hanya mencakup diminta/mencari_mitra/
 * mitra_siap, jadi baris ini tidak pernah bertabrakan dengan fixture berkas
 * uji lain.
 *
 * TANPA `screening_id`, dan itu sah: kolomnya di-`drop not null`
 * (20260912130000_tenggat_dan_skrining.sql:27) dan indeks uniknya kini parsial
 * `where screening_id is not null`. Ketiga trigger BEFORE INSERT pada tabel itu
 * — termasuk `guard_booking_skrining` yang menuntut skrining hijau — bergerbang
 * `current_user in ('anon','authenticated','authenticator')`, jadi service role
 * melewatinya. Fixture ini karena itu tidak perlu menyeret satu baris
 * `screenings` yang kemudian harus ikut disapu.
 *
 * Tidak ada trigger jejak status bayar pada `booking_requests`
 * (jejak_status_bayar hanya dipasang pada `sessions` dan `client_packages`),
 * jadi baris ini tidak meninggalkan jejak yatim.
 */
async function semaiPermintaan(): Promise<string> {
  const { data: layanan, error: eLayanan } = await svc
    .from("services")
    .select("id")
    .eq("aktif", true)
    .limit(1)
    .single();
  if (eLayanan) throw eLayanan;

  const { data, error } = await svc
    .from("booking_requests")
    .insert({
      client_id: ANANDA_CLIENT_ID,
      service_id: layanan!.id,
      tanggal: "2027-01-15",
      preferensi_waktu: "pagi",
      status: "ditolak",
    })
    .select("id")
    .single();
  if (error) throw error;
  permintaanSampah.push(data!.id);
  return data!.id;
}

function kodeUji(): string {
  const acak = Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, "0");
  return `PSN-260926-${acak}`;
}

type BentukPesanan = {
  client_id?: string;
  status?: string;
  ditutup_pada?: string | null;
  percobaan?: number;
  jumlah_item?: number;
};

async function sisipPesanan(bentuk: BentukPesanan = {}) {
  const hasil = await svc
    .from("orders")
    .insert({
      kode: kodeUji(),
      client_id: bentuk.client_id ?? ANANDA_CLIENT_ID,
      status: bentuk.status ?? "menunggu_bayar",
      ditutup_pada: bentuk.ditutup_pada ?? null,
      percobaan: bentuk.percobaan ?? 1,
      jumlah_item: bentuk.jumlah_item ?? 1,
    })
    .select("id")
    .single();
  if (hasil.data) pesananSampah.push(hasil.data.id);
  return hasil;
}

describe("struktur orders", () => {
  it("berkolom PERSIS sembilan belas, urut seperti yang ditulis migrasi", async () => {
    // Daftar dikunci karena menambah kolom ke tabel uang adalah satu baris
    // ketikan yang tidak memerahkan apa pun — dan tabel ini yang menjadi nota.
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "id",
      "kode",
      "percobaan",
      "client_id",
      "status",
      "jumlah_item",
      "dibuat_pada",
      "kedaluwarsa_pada",
      "lunas_pada",
      "ditutup_pada",
      "snap_token",
      "snap_diterbitkan_pada",
      "notifikasi_pada",
      "diperiksa_pada",
      "butuh_tinjauan_pada",
      "sebab_tinjauan",
      "kanal",
      "transaksi_id",
      "status_midtrans",
    ]);
  });

  it("NOL kolom nominal — total dijumlahkan dari order_items, tidak pernah disimpan", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'`,
    );
    const nominal = kolom
      .map((k) => k.column_name)
      .filter((n) => /(^|_)(harga|nominal|tarif|biaya|totals?|amounts?)(_|$)/.test(n));
    expect(
      nominal,
      "orders SENGAJA lahir tanpa kolom nominal — itulah kenapa ia TIDAK masuk " +
        "TABEL_UANG di tests/money-firewall-struktural.test.ts. Kolom nominal di " +
        "sini akan membocorkan angka ke dua policy SELECT yang dipegang klien.",
    ).toEqual([]);
  });

  it("tenggat bawaannya SAMA dengan JAM_TENGGAT_PESANAN di TypeScript", async () => {
    // Pengikat dua angka yang harus identik. Payload Snap memakai konstanta
    // TS; kolom ini memakai literal SQL. Dua angka yang boleh berbeda adalah
    // dua kegagalan simetris — kolom lebih pendek berarti settlement mendarat
    // pada pesanan yang sudah kita tutup.
    const [kolom] = await querySql<{ column_default: string | null }>(
      `select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'
          and column_name = 'kedaluwarsa_pada'`,
    );
    expect(kolom.column_default).toContain(`${JAM_TENGGAT_PESANAN}:00:00`);
  });

  it("client_id ber-ON DELETE RESTRICT — nota yang bisa lenyap bukan nota", async () => {
    const [fk] = await querySql<{ confdeltype: string }>(
      `select c.confdeltype
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'orders' and c.contype = 'f'
          and c.conkey = array[(select attnum from pg_attribute
                                 where attrelid = t.oid and attname = 'client_id')]`,
    );
    // 'r' = restrict, 'c' = cascade, 'a' = no action.
    expect(fk.confdeltype).toBe("r");
  });
});

describe("dua CHECK berpasangan — nilai enum yang lupa diklasifikasikan gagal", () => {
  it("status tertutup WAJIB membawa ditutup_pada", async () => {
    const { error } = await sisipPesanan({ status: "lunas", ditutup_pada: null });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("pesanan_tutup_bercap");
  });

  it("status menunggu_bayar TIDAK boleh membawa ditutup_pada", async () => {
    const { error } = await sisipPesanan({
      status: "menunggu_bayar",
      ditutup_pada: new Date().toISOString(),
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("pesanan_terbuka_tanpa_cap");
  });

  it("pasangan yang benar lolos KEDUA CHECK", async () => {
    // Pagar yang membabi buta akan membuat kasus ini merah. Dua arah, satu
    // batas — kedua CHECK positif harus bisa dipenuhi bersamaan.
    const { error } = await sisipPesanan({
      status: "lunas",
      ditutup_pada: new Date().toISOString(),
    });
    expect(error).toBeNull();
  });

  it("percobaan di luar 1..9 ditolak di kedua ujungnya", async () => {
    const nol = await sisipPesanan({ percobaan: 0 });
    expect(nol.error?.code).toBe("23514");
    expect(nol.error?.message).toContain("pesanan_percobaan_wajar");

    const sepuluh = await sisipPesanan({ percobaan: 10 });
    expect(sepuluh.error?.code).toBe("23514");
  });
});

describe("satu pesanan terbuka per klien", () => {
  it("pesanan terbuka KEDUA untuk klien yang sama ditolak 23505", async () => {
    // Inilah yang membuat "dua panggilan checkout paralel melahirkan tepat
    // satu pesanan" benar tanpa kunci di TypeScript (Tugas 4): yang kalah
    // menerima 23505, membaca ulang, dan memulangkan pesanan terbuka yang
    // sudah ada.
    const pertama = await sisipPesanan();
    expect(pertama.error).toBeNull();

    const kedua = await sisipPesanan();
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("pesanan_terbuka_satu_per_klien");
  });

  it("dua klien BERBEDA boleh sama-sama punya pesanan terbuka", async () => {
    // Pagar yang kebablasan akan membuat PADMA hanya bisa melayani satu
    // pembeli pada satu waktu.
    const a = await sisipPesanan({ client_id: ANANDA_CLIENT_ID });
    const b = await sisipPesanan({ client_id: RINA_CLIENT_ID });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });

  it("pesanan yang sudah TERTUTUP tidak menghalangi pesanan terbuka berikutnya", async () => {
    const lama = await sisipPesanan({
      status: "kedaluwarsa",
      ditutup_pada: new Date().toISOString(),
    });
    expect(lama.error).toBeNull();

    const baru = await sisipPesanan();
    expect(baru.error).toBeNull();
  });
});

describe("dua CHECK bercermin pada order_items", () => {
  async function sisipItem(isi: Record<string, unknown>) {
    const pesanan = await sisipPesanan();
    return svc
      .from("order_items")
      .insert({
        pesanan_id: pesanan.data!.id,
        judul_beku: "Kelas Prakonsepsi",
        harga_beku: 150000,
        urutan: 1,
        ...isi,
      })
      .select("id");
  }

  it("jenis produk_digital TANPA product_id ditolak", async () => {
    const permintaanId = await semaiPermintaan();
    const { error } = await sisipItem({
      jenis: "produk_digital",
      booking_request_id: permintaanId,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("item_produk_bercermin");
  });

  it("jenis sesi yang membawa product_id ditolak", async () => {
    // Dengan SATU CHECK (`num_nonnulls = 1`) saja, baris ini lolos: ia memang
    // hanya mengisi satu kolom. Cerminnya yang menangkapnya.
    const produkId = await semaiProduk();
    const { error } = await sisipItem({ jenis: "sesi", product_id: produkId });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("item_sesi_bercermin");
  });

  it("mengisi KEDUA kolom sumber ditolak", async () => {
    const produkId = await semaiProduk();
    const permintaanId = await semaiPermintaan();
    const { error } = await sisipItem({
      jenis: "produk_digital",
      product_id: produkId,
      booking_request_id: permintaanId,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("item_sumber_tunggal");
  });

  it("baris produk_digital yang benar lolos", async () => {
    const produkId = await semaiProduk();
    const { error } = await sisipItem({ jenis: "produk_digital", product_id: produkId });
    expect(error).toBeNull();
  });

  it("baris sesi yang benar lolos — P3 tidak perlu alter table pada tabel uang", async () => {
    // `booking_request_id` lahir sekarang dan tidak pernah terisi di P1. Ini
    // pelanggaran SADAR terhadap doktrin "nol kolom mati": ongkosnya asimetris
    // — satu kolom nullable hari ini versus alter table pada tabel uang yang
    // sudah memuat nota nyata besok. Assertion ini membuktikan jalurnya memang
    // terbuka, bukan sekadar dijanjikan.
    const permintaanId = await semaiPermintaan();
    const { error } = await sisipItem({ jenis: "sesi", booking_request_id: permintaanId });
    expect(error).toBeNull();
  });

  it("urutan kembar dalam satu pesanan ditolak", async () => {
    const produkId = await semaiProduk();
    const pesanan = await sisipPesanan();
    const baris = {
      pesanan_id: pesanan.data!.id,
      jenis: "produk_digital",
      product_id: produkId,
      judul_beku: "Kelas Prakonsepsi",
      harga_beku: 150000,
      urutan: 1,
    };
    expect((await svc.from("order_items").insert(baris).select("id")).error).toBeNull();
    const kedua = await svc.from("order_items").insert(baris).select("id");
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("order_items_pesanan_urutan_unik");
  });
});

describe("pembekuan baris nota", () => {
  async function semaiNota(): Promise<{ pesananId: string; itemId: string }> {
    const produkId = await semaiProduk();
    const pesanan = await sisipPesanan();
    const { data, error } = await svc
      .from("order_items")
      .insert({
        pesanan_id: pesanan.data!.id,
        jenis: "produk_digital",
        product_id: produkId,
        judul_beku: "Kelas Prakonsepsi",
        harga_beku: 150000,
        urutan: 1,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { pesananId: pesanan.data!.id, itemId: data!.id };
  }

  it("UPDATE lewat PostgREST dengan SERVICE ROLE ditolak 42501", async () => {
    const { itemId } = await semaiNota();
    const { error } = await svc.from("order_items").update({ harga_beku: 1 }).eq("id", itemId);
    expect(error?.code).toBe("42501");
  });

  it("UPDATE lewat SQL langsung sebagai postgres JUGA ditolak 42501", async () => {
    // Bukan pengulangan. Uji di atas membuktikan pagarnya berdiri di jalur
    // PostgREST; uji ini membuktikan ia bukan pagar PostgREST — trigger tanpa
    // gerbang `current_user` menolak SIAPA PUN, termasuk superuser migrasi.
    // Kalau seseorang kelak menambahkan gerbang peran "supaya pemeliharaan
    // gampang", uji inilah yang merah.
    const { itemId } = await semaiNota();
    await expect(
      querySql(`update public.order_items set harga_beku = 1 where id = $1`, [itemId]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("UPDATE kolom yang BUKAN nominal pun ditolak", async () => {
    // Trigger menolak SELURUH update, bukan `update of harga_beku`. Judul beku
    // adalah bagian nota yang sama: nota yang judulnya bisa diganti sesudah
    // terbit bukan nota.
    const { itemId } = await semaiNota();
    const { error } = await svc
      .from("order_items")
      .update({ judul_beku: "Judul lain" })
      .eq("id", itemId);
    expect(error?.code).toBe("42501");
  });

  it("DELETE baris item TIDAK dijaga — cascade harus bisa jalan", async () => {
    const { itemId } = await semaiNota();
    const { error } = await svc.from("order_items").delete().eq("id", itemId);
    expect(error).toBeNull();
  });

  it("menghapus pesanan ikut menyapu itemnya (cascade sungguhan)", async () => {
    const { pesananId, itemId } = await semaiNota();
    const { error } = await svc.from("orders").delete().eq("id", pesananId);
    expect(error).toBeNull();

    const { data } = await svc.from("order_items").select("id").eq("id", itemId);
    expect(data ?? []).toEqual([]);
  });
});

describe("hak tabel & RLS", () => {
  it("authenticated hanya memegang SELECT atas orders — tidak pernah menulis", async () => {
    const hak = await querySql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'orders' and grantee = 'authenticated'
        order by privilege_type`,
    );
    expect(hak.map((h) => h.privilege_type)).toEqual(["SELECT"]);
  });

  it("authenticated TIDAK memegang hak apa pun atas order_items", async () => {
    // Nol grant, bukan "grant select lalu RLS". Baris nota tidak pernah dibaca
    // langsung oleh peran API — yang dibaca layar staf adalah view
    // `pesanan_item_staf` (migrasi 5), yang batas kolom & perannya ada DI
    // DALAM view.
    const hak = await querySql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'order_items'
          and grantee = 'authenticated'`,
    );
    expect(hak).toEqual([]);
  });

  it("anon nol hak atas KEDUA tabel", async () => {
    const hak = await querySql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name in ('orders','order_items')
          and grantee = 'anon'`,
    );
    expect(hak).toEqual([]);
  });

  it("klien membaca pesanannya sendiri dan TIDAK membaca pesanan klien lain", async () => {
    // Dua baris disisipkan lewat service role tepat sebelum diperiksa, supaya
    // "0 baris" membuktikan PENYARINGAN, bukan ketiadaan data.
    const milikAnanda = await sisipPesanan({ client_id: ANANDA_CLIENT_ID });
    const milikRina = await sisipPesanan({ client_id: RINA_CLIENT_ID });
    expect(milikAnanda.error).toBeNull();
    expect(milikRina.error).toBeNull();

    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("orders")
      .select("id")
      .in("id", [milikAnanda.data!.id, milikRina.data!.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((b) => b.id)).toEqual([milikAnanda.data!.id]);
  });

  it("staf membaca KEDUANYA", async () => {
    const milikAnanda = await sisipPesanan({ client_id: ANANDA_CLIENT_ID });
    const milikRina = await sisipPesanan({ client_id: RINA_CLIENT_ID });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("orders")
      .select("id")
      .in("id", [milikAnanda.data!.id, milikRina.data!.id]);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(2);
  });

  it("klien login berhenti di 42501 pada order_items — GRANT, bukan RLS", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.from("order_items").select("harga_beku").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("anon berhenti di 42501 pada orders", async () => {
    const { error } = await anonClient().from("orders").select("kode").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("klien TIDAK bisa menyisipkan pesanan untuk dirinya lewat REST", async () => {
    // Checkout adalah RPC (Tugas 4), bukan insert. Klien yang bisa menulis
    // barisnya sendiri adalah klien yang bisa memilih harganya sendiri.
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien
      .from("orders")
      .insert({ kode: kodeUji(), client_id: ANANDA_CLIENT_ID, jumlah_item: 1 })
      .select("id");
    expect(error?.code).toBe("42501");
  });
});
```

---

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-nota-beku.test.ts
```

Seluruh kasus merah, dan sebabnya satu: `relation "public.orders" does not exist`. Bentuknya berbeda-beda per jalur — `querySql` melempar 42P01 langsung, sementara supabase-js memulangkan `error.code === "42P01"` sehingga assertion `toBe("23514")` merah dengan nilai yang terbaca. Keduanya sah sebagai merah; yang penting TIDAK ADA satu pun kasus hijau sebelum migrasi ditulis.

---

- [ ] **Step 3: Tulis migrasinya**

Buat `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260926110000_pesanan_tabel.sql`:

```sql
-- ===========================================================================
-- INTI PEMBAYARAN (2/6) — NOTA: orders & order_items
-- ===========================================================================
-- `orders` adalah pernyataan tentang APA YANG SUDAH DIBAYAR, bukan tagihan.
-- Perbedaan itu yang membuat doktrin C2 ("nominal diturunkan, tidak pernah
-- disimpan") benar untuk tagihan dan SALAH di sini: angka pembandingnya ada di
-- tangan Midtrans dan ikut ditandatangani, jadi verifikasi jumlah mustahil
-- tanpa angka beku. Yang membeku ada di `order_items.harga_beku`;
-- `orders` sendiri lahir NOL kolom nominal, dan karena itu ia TIDAK masuk
-- TABEL_UANG.
--
-- Nol `alter table booking_requests`, nol `alter type pay_status`, nol
-- sentuhan gerbang isi produk.

-- ---------------------------------------------------------------------------
-- (1) PESANAN
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),

  -- Bentuk PSN-YYMMDD-XXXXXX. Enam heksadesimal per tanggal dari
  -- gen_random_uuid() — pgcrypto NOL hasil di seluruh migrasi repo ini, jadi
  -- `gen_random_bytes` berarti memasang ekstensi baru di basis data produksi
  -- berisi data klien nyata demi satu sufiks acak. Penerbitnya ada di
  -- migrasi 4, yang mengulang maksimum lima kali saat tabrakan.
  kode text not null,

  -- Midtrans menolak `order_id` kembar SELAMANYA. `order_id` yang dikirim
  -- adalah `kode || '.' || percobaan`, dan sufiks itulah jalan keluar ketika
  -- token gagal terbit dan order_id-nya sudah terbakar. Dinaikkan HANYA oleh
  -- buat_pesanan(p_ulang := true), bukan setiap kali halaman dibuka.
  percobaan smallint not null default 1,

  -- ON DELETE RESTRICT, bukan cascade: nota yang bisa lenyap bukan nota.
  -- Konsekuensinya disebut terbuka — klien yang pernah membeli tidak bisa
  -- dihapus sama sekali, dan itu memang yang diinginkan.
  client_id uuid not null references public.clients(id) on delete restrict,

  status public.order_status not null default 'menunggu_bayar',

  -- SENGAJA tanpa `check (= 1)`: yang membatasi P1 ke satu item adalah RPC-nya,
  -- bukan skemanya. P2 (keranjang) karena itu tidak perlu migrasi ke tabel
  -- uang untuk mencabutnya.
  jumlah_item smallint not null,

  dibuat_pada timestamptz not null default now(),

  -- 24 jam, dan durasi yang SAMA dikirim sebagai `expiry` di payload Snap dari
  -- satu konstanta di kode (JAM_TENGGAT_PESANAN, src/lib/pesanan/status.ts).
  -- Dua angka yang boleh berbeda adalah dua kegagalan simetris: kolom lebih
  -- pendek → kita berhenti bertanya sementara VA-nya masih bisa dibayar, dan
  -- settlement mendarat pada pesanan yang sudah kita tutup; kolom lebih
  -- panjang → penyapu menanyai Midtrans tentang transaksi yang tak akan pernah
  -- berubah. Angkanya mengikuti tenggat bayar sesi yang sudah berlaku
  -- (20260912130000_tenggat_dan_skrining.sql:4), supaya klien tidak menghadapi
  -- dua tenggat berbeda di satu aplikasi.
  kedaluwarsa_pada timestamptz not null default now() + interval '24 hours',

  lunas_pada timestamptz,
  ditutup_pada timestamptz,

  -- Token Snap TIDAK PERNAH dipercaya sebagai bukti pembayaran oleh apa pun.
  -- Ia disimpan supaya popup yang sama bisa dibuka ulang tanpa membakar
  -- order_id baru.
  snap_token text,
  snap_diterbitkan_pada timestamptz,

  notifikasi_pada timestamptz,

  -- Pembatas Lapis 1b: satu pesanan tidak ditanyakan ke Status API lebih sering
  -- dari sekali per lima menit. Juga kunci urut penyapu Lapis 3.
  diperiksa_pada timestamptz,

  -- SATU-SATUNYA penanda tinjauan, dan ia ORTOGONAL terhadap status. Itulah
  -- keuntungan membuang nilai enum 'ditinjau': "tutup tinjauan" mengosongkan
  -- dua kolom ini tanpa menyentuh status sama sekali.
  butuh_tinjauan_pada timestamptz,
  sebab_tinjauan text,

  -- Metode bayar menurut Midtrans (payment_type). Dinamai `kanal` karena
  -- `payment_type` cocok dengan pola money firewall ke-17 dan `kanal` tidak —
  -- dan yang disimpan di sini memang bukan nominal.
  kanal text,
  transaksi_id text,
  status_midtrans text,

  constraint orders_kode_unik unique (kode),

  -- DUA CHECK POSITIF BERPASANGAN, bukan satu. Nilai enum keenam yang lupa
  -- diklasifikasikan jatuh ke luar KEDUANYA dan gagal 23514 pada penulisan
  -- pertamanya. Satu CHECK saja fail-OPEN: `false = false` lolos.
  constraint pesanan_tutup_bercap check (
    (status in ('ditahan','lunas','kedaluwarsa','dibatalkan')) = (ditutup_pada is not null)
  ),
  constraint pesanan_terbuka_tanpa_cap check (
    (status = 'menunggu_bayar') = (ditutup_pada is null)
  ),

  -- Percobaan kesepuluh TIDAK pernah melempar 23514 kepada pembeli: RPC
  -- checkout menutup pesanan itu jadi 'dibatalkan' dan melahirkan pesanan
  -- baru. Batas ini adalah pagar TERAKHIR, bukan jalur pemulihan.
  constraint pesanan_percobaan_wajar check (percobaan between 1 and 9)
);

comment on table public.orders is
  'Pesanan generik — satu mesin untuk produk digital DAN sesi (P3). TANPA '
  'kolom nominal: total dijumlahkan dari order_items, yang membekukannya. '
  'authenticated memegang SELECT saja; penulisannya hanya lewat RPC dan fungsi '
  'mesin. client_id ON DELETE RESTRICT — nota yang bisa lenyap bukan nota.';

-- Satu pesanan terbuka per klien, DIJAGA BASIS DATA. Inilah yang membuat "dua
-- panggilan checkout paralel melahirkan tepat satu pesanan" benar tanpa kunci
-- di TypeScript: yang kalah menerima 23505, membaca ulang, dan memulangkan
-- pesanan terbuka yang sudah ada bila produknya sama. P2 mewarisi indeks ini
-- apa adanya.
create unique index pesanan_terbuka_satu_per_klien
  on public.orders (client_id) where status = 'menunggu_bayar';

create index orders_klien_idx on public.orders (client_id, dibuat_pada desc);

-- Urut penyapu Lapis 3: yang paling lama tidak diperiksa lebih dulu, dan yang
-- BELUM PERNAH diperiksa paling dulu dari semuanya. `nulls first` ditulis
-- eksplisit — bawaan Postgres untuk ASC adalah NULLS LAST, dan indeks yang
-- urutannya berbeda dari kueri tidak akan dipakai perencana.
create index orders_sapuan_idx
  on public.orders (diperiksa_pada nulls first) where status = 'menunggu_bayar';

alter table public.orders enable row level security;

-- `to authenticated` DITULIS EKSPLISIT — pola yang sama dengan
-- 20260921120000_produk_entitlement.sql:41-47. Policy tanpa target lahir
-- `to public`, dan `public` MENCAKUP `anon`: setiap SELECT anon akan ikut
-- mengevaluasi policy staf, memanggil user_role() yang EXECUTE-nya sudah
-- dicabut dari anon, dan gagal 42501 alih-alih memulangkan baris kosong.
create policy "pesanan: klien baca miliknya" on public.orders for select
  to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = orders.client_id and c.user_id = auth.uid()
  ));

-- Policy SELECT untuk staf aman. Bahaya `PATCH ?filter=tautologi` datang dari
-- grant UPDATE, dan UPDATE tidak pernah diberikan kepada siapa pun di tabel
-- ini.
create policy "pesanan: staf baca" on public.orders for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

-- Titik nol yang disengaja. Default privileges Supabase memberi hak PENUH atas
-- setiap tabel baru di skema public kepada anon MAUPUN authenticated; tanpa
-- kedua baris ini, INSERT/UPDATE menempel diam-diam dan seluruh janji "hanya
-- lewat RPC" di atas hanya berlaku di atas kertas.
revoke all on public.orders from anon;
revoke all on public.orders from authenticated;
grant select on public.orders to authenticated;

-- ---------------------------------------------------------------------------
-- (2) BARIS NOTA
-- ---------------------------------------------------------------------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  pesanan_id uuid not null references public.orders(id) on delete cascade,
  jenis public.order_item_source not null,

  product_id uuid references public.digital_products(id),

  -- Lahir sekarang, TIDAK PERNAH terisi di P1. Pelanggaran SADAR terhadap
  -- doktrin "nol kolom mati": ongkosnya asimetris — satu kolom nullable hari
  -- ini versus `alter table` pada tabel uang yang sudah memuat nota nyata
  -- besok.
  booking_request_id uuid references public.booking_requests(id),

  judul_beku text not null,

  -- SATU-SATUNYA angka yang dipakai memverifikasi gross_amount notifikasi
  -- Midtrans. Ia beku karena angka pembandingnya ada di tangan Midtrans dan
  -- ikut ditandatangani; menghitungnya ulang dari harga hari ini berarti nota
  -- yang berubah sesudah dibayar.
  harga_beku integer not null check (harga_beku >= 0),

  urutan smallint not null,

  constraint item_sumber_tunggal check (num_nonnulls(product_id, booking_request_id) = 1),

  -- DUA CHECK BERCERMIN, bukan satu — alasan yang sama dengan orders. Dengan
  -- `item_sumber_tunggal` saja, nilai order_item_source KETIGA (mis. 'kelas')
  -- yang membawa booking_request_id lolos kedua pagar. Migrasi 1 baru saja
  -- melahirkan 'sesi' sebelum ada penulisnya, jadi nilai ketiga bukan
  -- hipotesis jauh.
  constraint item_produk_bercermin check ((jenis = 'produk_digital') = (product_id is not null)),
  constraint item_sesi_bercermin   check ((jenis = 'sesi')           = (booking_request_id is not null)),

  constraint order_items_pesanan_urutan_unik unique (pesanan_id, urutan)
);

comment on table public.order_items is
  'Baris nota. APPEND-ONLY bagi siapa pun, termasuk service role: trigger '
  'item_pesanan_beku menolak SELURUH UPDATE dengan 42501. DELETE sengaja TIDAK '
  'dijaga — cascade dari orders harus bisa jalan. harga_beku adalah satu-satunya '
  'angka pembanding gross_amount Midtrans; tabel ini anggota TABEL_UANG.';

-- Indeks `order_items_pesanan_idx` SENGAJA TIDAK dibuat — peta §0.3 mencatat
-- keputusan itu, jadi tidak ada uji mana pun yang meng-assert namanya.
-- Alasannya: constraint `order_items_pesanan_urutan_unik` sudah menerbitkan
-- indeks btree atas (pesanan_id, urutan), dan indeks kedua berkolom kunci sama
-- persis hanya menambah ongkos tulis tanpa satu pun kueri yang lebih cepat —
-- "semua item satu pesanan" memakai awalan kiri indeks unik itu.

alter table public.order_items enable row level security;

-- NOL policy dan NOL grant, dua-duanya disengaja. Baris nota tidak pernah
-- dibaca langsung oleh peran API; yang dibaca layar staf adalah view
-- `pesanan_item_staf` (migrasi 5), yang batas kolom dan batas perannya ada DI
-- DALAM view. Tabel ini karena itu masuk SENGAJA_TERKUNCI di
-- tests/struktur-rls.test.ts.
revoke all on public.order_items from anon;
revoke all on public.order_items from authenticated;

-- ---------------------------------------------------------------------------
-- (3) PEMBEKUAN — trigger, bukan ketiadaan policy
-- ---------------------------------------------------------------------------
-- Ketiadaan policy menjaga peran API. Yang paling mungkin menulis ulang harga
-- beku justru WEBHOOK ber-SERVICE ROLE — peran yang melewati RLS sepenuhnya,
-- dan persis peran yang idiom gerbang `current_user` kecualikan. Karena itu
-- trigger di bawah TIDAK bergerbang peran: ia menolak siapa pun.
--
-- Perhatikan bahwa badan fungsinya tidak menyebut nama tabel mana pun. Itu
-- bukan kebetulan: tests/fungsi-mesin-tertutup.test.ts (Tugas 7) memindai
-- `pg_proc.prosrc` dengan pola /(insert into|update)\s+(public\.)?(orders|
-- order_items|jejak_pesanan|digital_entitlements)/, dan fungsi yang cocok
-- WAJIB masuk salah satu dari dua daftar putih. Fungsi ini bukan penulis, jadi
-- ia tidak masuk daftar mana pun — dan komentar yang menyebut nama tabelnya
-- ditaruh DI LUAR badan $$ supaya tidak memalsukan kecocokan itu.
create or replace function public.tolak_ubah_item_pesanan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Baris nota pesanan tidak dapat diubah sesudah terbit.'
    using errcode = '42501';
end;
$$;

comment on function public.tolak_ubah_item_pesanan() is
  'Menolak SELURUH UPDATE pada baris nota, tanpa gerbang current_user: yang '
  'paling mungkin menulis ulang harga beku adalah webhook ber-service-role. '
  'DELETE sengaja tidak disentuh — cascade dari pesanan harus bisa jalan.';

revoke all on function public.tolak_ubah_item_pesanan() from public, anon, authenticated;

create trigger item_pesanan_beku
  before update on public.order_items
  for each row execute function public.tolak_ubah_item_pesanan();
```

---

- [ ] **Step 4: Terapkan migrasi, jalankan uji nota beku, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase migration up && npx vitest run tests/pesanan-nota-beku.test.ts
```

Seluruh kasus hijau (25 kasus). Bila `migration up` menolak karena riwayat lokal menyimpang, pakai `npx supabase db reset` — tapi **koordinasikan dulu: Supabase lokal di mesin ini dipakai bersama sesi lain.**

---

- [ ] **Step 5: Jalankan tiga pagar rumah, pastikan DUA di antaranya MERAH**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/money-firewall-struktural.test.ts tests/struktur-rls.test.ts tests/grant-anon.test.ts
```

Migrasi yang baru mendarat memerahkan dua pagar rumah, dan itulah merah yang menuntut suntingan di Step 6:

- `tests/money-firewall-struktural.test.ts` → `tidak ada kolom bernuansa nominal uang di luar variant_rates & honor_marks` merah dengan `[ 'order_items.harga_beku (integer)' ]`.
- `tests/struktur-rls.test.ts` → `tabel ber-RLS tanpa policy hanya yang sengaja terkunci` merah: hasil kueri kini `["client_invites", "order_items", "screening_claims"]`, sementara `SENGAJA_TERKUNCI` masih dua entri.
- `tests/grant-anon.test.ts` → **hijau, dan TIDAK disunting di tugas ini.** Itu memang sifat daftar izin: ia hanya memeriksa nama yang terdaftar, jadi ketiadaan `orders`/`order_items` di sana tidak memerahkan apa pun hari ini. Yang melengkapinya adalah Tugas 5, sekali jalan untuk keenam objek P1 — lihat peta §13 dan §13.1. Jangan menambah nama di sini: `format('public.%I',$1)::regclass` MELEMPAR 42P01 untuk `pesanan_item_staf` yang belum lahir, dan daftar yang dipecah tiga tugas adalah persis cara satu entri jatuh di celah antar-tugas.

---

- [ ] **Step 6: Sunting ketiga pagar rumah**

**(a) `/Users/arvinfairuz/Documents/padma/web/tests/money-firewall-struktural.test.ts`**

Ganti blok `TABEL_UANG` (baris 75-81) menjadi:

```ts
const TABEL_UANG = new Set([
  "variant_rates",
  "honor_marks",
  "transport_rates",
  "transport_khusus",
  "digital_product_prices",
  // `order_items` (P1, migrasi `pesanan_tabel`) bergabung dan MEMBANTAH
  // preseden C2 secara eksplisit. Doktrin "nominal diturunkan, tidak pernah
  // disimpan" benar untuk TAGIHAN — pernyataan tentang apa yang HARUS dibayar,
  // yang boleh dihitung ulang dari tarif menurut tanggal sesi — dan salah
  // untuk PESANAN: pernyataan tentang apa yang SUDAH dibayar, yang tidak boleh
  // dihitung ulang karena angka pembandingnya ada di tangan Midtrans dan ikut
  // ditandatangani. Verifikasi jumlah mustahil tanpa angka beku.
  //
  // `orders` TIDAK ikut, dan itu bukan kelalaian: ia lahir NOL kolom nominal,
  // dan uji "NOL kolom nominal" di tests/pesanan-nota-beku.test.ts yang
  // menahannya tetap begitu. Totalnya dijumlahkan dari baris nota.
  //
  // `notifikasi_pesanan` menyusul di Tugas 3, BERSAMA kedua assertion-nya —
  // tabelnya belum ada sekarang, jadi menuliskannya di sini membuat suite
  // tugas ini berakhir merah.
  "order_items",
]);
```

Ganti blok `KOLOM_UANG_VIEW_DIIZINKAN` (baris 111-116) menjadi:

```ts
const KOLOM_UANG_VIEW_DIIZINKAN = new Map<string, Set<string>>([
  ["harga_publik", new Set(["harga_klien", "harga_coret"])],
  ["varian_harga_staf", new Set(["harga_klien", "harga_coret"])],
  ["harga_produk_publik", new Set(["harga", "harga_coret"])],
  ["produk_harga_staf", new Set(["harga", "harga_coret"])],
  // `pesanan_item_staf` (P1, migrasi `pesanan_webhook_rpc`) — SATU kolom saja.
  // Didaftarkan lebih dulu di sini, sebelum view-nya lahir, dan itu aman:
  // entri ini adalah PENGECUALIAN, bukan assertion. Selama view-nya belum ada,
  // ia tidak membebaskan apa pun; begitu ia lahir, uji ini tidak perlu
  // disunting lagi oleh tugas yang sedang sibuk dengan jantung mesinnya.
  //
  // Ia adalah view yang DIBACA /admin/pesanan. Nominal di layar staf adalah
  // keputusan pemilik repo, dan view bernominal tanpa pembaca berarti
  // keputusan itu berhenti di basis data.
  ["pesanan_item_staf", new Set(["harga_beku"])],
]);
```

Sisipkan helper baru tepat SESUDAH blok `beforeAll` (yaitu sesudah baris 183, sebelum `describe(...)` pertama):

```ts
/**
 * Kolom bernuansa uang yang HIDUP di sebuah tabel, urut abjad.
 *
 * Kenapa ini perlu ada di samping `toContain` di bawah, dan bukan
 * menggantikannya: `toContain` menjamin kolom yang SUDAH ada tetap di
 * tempatnya, tapi tidak menahan kolom nominal BARU yang kelak ditambahkan ke
 * tabel uang yang sama — ia akan lolos tanpa satu pun uji merah. Tabel uang
 * yang boleh tumbuh diam-diam adalah tabel uang yang tidak dijaga.
 *
 * Polanya sama dengan yang sudah menjaga daftar kolom `harga_publik`.
 */
function kolomUangDi(tabel: string): string[] {
  return semuaKolom
    .filter((k) => k.table_name === tabel)
    .map((k) => k.column_name)
    .filter(bernuansaUang)
    .sort();
}
```

Tambahkan dua baris di dalam `it("kolom uang yang sah TETAP berada di tempatnya …")` (sesudah baris 226), dan satu `it` baru tepat sesudah blok itu (sesudah baris 227):

```ts
    // P1: nota pesanan. Pemindahan diam-diam `harga_beku` keluar dari
    // `order_items` mematikan verifikasi jumlah tanpa satu pun uji lain merah.
    expect(diTabelUang).toContain("order_items.harga_beku");
  });

  it("tabel uang P1 berkolom nominal PERSIS satu — tidak boleh tumbuh diam-diam", () => {
    // Tugas 3 menambahkan barisnya sendiri untuk `notifikasi_pesanan` di dalam
    // `it` ini. Jangan menuliskannya sekarang: tabelnya belum ada.
    expect(kolomUangDi("order_items")).toEqual(["harga_beku"]);
  });
```

**(b) `/Users/arvinfairuz/Documents/padma/web/tests/struktur-rls.test.ts`**

Ganti `SENGAJA_TERKUNCI` (baris 22-32) menjadi — perhatikan **urut abjad**, karena assertion-nya `toEqual` atas hasil `order by c.relname` (baris 43); menambah di ujung membuatnya merah dengan pesan yang tidak menjelaskan apa pun. Dan perhatikan apa yang TIDAK ditulis: `notifikasi_ditolak_harian` belum lahir, dan daftar ini diadu dengan katalog HIDUP — menuliskannya sekarang berarti suite tugas ini berakhir merah. Tugas 3 yang menyisipkannya, menurut abjad, antara `client_invites` dan `order_items`:

```ts
  const SENGAJA_TERKUNCI = [
    // Token undangan disimpan sebagai SHA-256 dan tidak boleh terbaca peran
    // API mana pun, termasuk admin. Penerbitannya lewat server action
    // service-role yang mengembalikan token mentah sekali saja.
    "client_invites",
    // Baris nota pesanan (P1). NOL grant dan NOL policy, dua-duanya sengaja:
    // yang dibaca layar staf adalah view `pesanan_item_staf`, yang batas
    // kolom DAN batas perannya ada di dalam view. `orders`, `jejak_pesanan`,
    // dan `notifikasi_pesanan` TIDAK masuk daftar ini — ketiganya punya
    // policy baca.
    "order_items",
    // Token klaim skrining (spec C1 J3) disimpan sebagai SHA-256 dan sengaja
    // tanpa policy sama sekali — lihat komentar tabelnya di migration
    // 20260910100000_skrining_syarat_pemesanan.sql. Hanya service role di
    // server yang boleh menyambungkan skrining anonim ke akun.
    "screening_claims",
  ];
```

**(c) `/Users/arvinfairuz/Documents/padma/web/tests/grant-anon.test.ts` — TIDAK DISENTUH.**

Ini bukan kelalaian, dan ia dicatat sebagai langkah supaya tidak "diperbaiki" oleh orang berikutnya.
Berkas itu daftar izin murni yang menerjemahkan setiap nama lewat
`format('public.%I', $1::text)::regclass` — dan relasi yang belum ada MELEMPAR `42P01`, bukan
lolos. Anggota terakhir daftar P1 adalah view `pesanan_item_staf`, yang baru lahir di migrasi 5,
jadi daftarnya hanya bisa dilengkapi sekali jalan di **Tugas 5** — dan di sanalah pemilik
tunggalnya (peta §13). Menambah `orders`/`order_items` di sini tidak menutup apa pun lebih cepat:
daftar izin tidak memerahkan apa pun saat ditambah, dan yang membuatnya merah kelak adalah satu
baris `grant select on public.orders to anon` di migrasi mana pun sesudah T5.

---

- [ ] **Step 7: Jalankan ketiga pagar, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/money-firewall-struktural.test.ts tests/struktur-rls.test.ts tests/grant-anon.test.ts
```

Ketiganya hijau — dan `grant-anon` hijau **tanpa satu pun suntingan** dari tugas ini.
`money-firewall-struktural` kini berjalan dengan satu kasus lebih banyak dari sebelumnya.

Bila `money-firewall-struktural` atau `struktur-rls` masih MERAH di sini, bacalah nama yang
disebutnya: bila yang disebut `notifikasi_pesanan` atau `notifikasi_ditolak_harian`, berarti
migrasi Tugas 3 sudah ikut terpasang di basis data lokal Anda (sesi lain?) — **jangan** menambal
dengan menuliskan entrinya di sini; itu milik Tugas 3, dan menulisnya dua kali melahirkan konflik
di berkas yang sama.

---

- [ ] **Step 8: Tulis uji nominal-sebagai-teks — memindai SUMBERNYA, bukan tabel kosong**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-teks-tanpa-nominal.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { querySql } from "./helpers/db";

/**
 * NOMINAL YANG MENYELINAP SEBAGAI TEKS.
 *
 * Money firewall struktural menjaga NAMA KOLOM. Ia buta sepenuhnya terhadap
 * angka rupiah yang dituliskan ke dalam kolom TEKS — dan dua kolom teks tabel
 * pesanan adalah tempat paling wajar bagi kebocoran itu: `orders.sebab_tinjauan`
 * ("selisih 50.000") dan `order_items.judul_beku` ("Kelas Prakonsepsi
 * Rp 150.000"). Keduanya terbaca staf, dan `judul_beku` juga diproyeksikan view
 * `pesanan_item_staf`.
 *
 * ===== KENAPA YANG DIPINDAI SUMBERNYA, BUKAN ISI TABELNYA =====
 * Versi pertama berkas ini meng-assert "nol baris" atas `orders.sebab_tinjauan`
 * dan `order_items.judul_beku`. Keduanya KOSONG di setiap jalan bersih, jadi
 * assertion itu hijau karena tidak ada yang dipindai — pagar yang tidak bisa
 * merah, yaitu pagar yang membeli rasa aman tanpa menjual apa pun. Lebih buruk
 * di mesin ini: Supabase lokal dipakai bersama sesi lain, jadi hasil pindaian
 * atas tabel yang "kebetulan" berisi fixture orang lain tidak deterministik.
 *
 * Yang diganti bukan polanya melainkan ARAHNYA. `judul_beku` diisi
 * `buat_pesanan` dengan MENYALIN `digital_products.judul`; nominal hanya bisa
 * masuk lewat judul produk, dan tabel itu SELALU berisi (seed + fixture).
 * Karena itu kasus pertama memindai `digital_products.judul` dan menolak jalan
 * bila tabelnya kosong. `sebab_tinjauan` dijaga dari sisi kosakata (kasus
 * terakhir): nilainya tujuh kata tetap, nol digit seluruhnya.
 *
 * Keputusan yang diambil sadar: `buat_pesanan` TIDAK membersihkan judul. Nota
 * yang judulnya berbeda dari judul produk adalah nota yang berbohong; yang
 * dijaga karena itu judul produknya, di hulu.
 *
 * ===== KENAPA POLANYA BERBEDA DARI tests/helpers/nominal.ts =====
 * Perbedaannya SADAR, dan ini tempatnya ditulis. `nominalDalam()` memindai
 * MARKUP React yang penuh kelas Tailwind (`opacity-[0.075]`) dan id numerik,
 * jadi ia menuntut DUA kelompok ribuan supaya tidak menuduh yang tidak
 * bersalah. Yang dipindai DI SINI adalah teks basis data yang tidak pernah
 * punya alasan memuat angka berpemisah sama sekali, jadi ambangnya dipersempit
 * ke SATU kelompok — "50.000" tertangkap di sini dan memang harus.
 */
const POLA_NOMINAL_TEKS = /(\b\d{1,3}(?:\.\d{3})+\b)|(rp\.?\s*\d)/i;

const svc = createAdminSupabase();

/** Klien seed kedua; dipakai supaya fixture di sini tidak bertabrakan dengan
 *  `pesanan_terbuka_satu_per_klien` milik berkas uji lain (peta §13.2). */
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

const pesananSampah: string[] = [];
const produkSampah: string[] = [];
let nomorSlug = 0;

afterEach(async () => {
  // Urutan MENGIKAT: pesanan dulu (cascade menyapu `order_items`), baru produk
  // — `order_items.product_id` tanpa cascade menahan penghapusan produk.
  while (pesananSampah.length) {
    await svc.from("orders").delete().eq("id", pesananSampah.pop()!);
  }
  while (produkSampah.length) {
    await svc.from("digital_products").delete().eq("id", produkSampah.pop()!);
  }
});

function kodeUji(): string {
  return `PSN-260926-${Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, "0")}`;
}

async function semaiProduk(judul: string): Promise<string> {
  nomorSlug += 1;
  const { data, error } = await svc
    .from("digital_products")
    .insert({
      judul,
      slug: `uji-teks-nominal-${Date.now()}-${nomorSlug}`,
      jenis: "pdf",
      aktif: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  produkSampah.push(data!.id);
  return data!.id;
}

/** SATU-SATUNYA sumber `order_items.judul_beku`. */
async function judulProduk(): Promise<string[]> {
  const baris = await querySql<{ judul: string }>(`select p.judul from public.digital_products p`);
  return baris.map((b) => b.judul);
}

type Teks = { sumber: string; isi: string };

async function teksNota(): Promise<Teks[]> {
  return querySql<Teks>(
    `select 'orders.sebab_tinjauan' as sumber, o.sebab_tinjauan as isi
       from public.orders o
      where o.sebab_tinjauan is not null
     union all
     select 'order_items.judul_beku', i.judul_beku
       from public.order_items i`,
  );
}

function bocor(baris: Teks[]): string[] {
  return baris
    .filter((b) => POLA_NOMINAL_TEKS.test(b.isi))
    .map((b) => `${b.sumber}: ${JSON.stringify(b.isi)}`);
}

describe("judul produk — hulu satu-satunya judul_beku", () => {
  it("nol judul produk digital memuat nominal", async () => {
    const judul = await judulProduk();
    // ANTI-HAMPA, dan inilah bedanya dengan versi pertama berkas ini: kalau
    // tabelnya kosong, assertion di bawah hijau tanpa memindai apa pun.
    expect(
      judul.length,
      "nol produk digital di basis data — pemindai ini tidak memindai apa pun, " +
        "jadi hijaunya tidak berarti apa-apa. Jalankan seed lebih dulu.",
    ).toBeGreaterThan(0);

    const tertuduh = judul.filter((j) => POLA_NOMINAL_TEKS.test(j));
    expect(
      tertuduh,
      "Judul produk memuat nominal, dan `buat_pesanan` MENYALINNYA apa adanya ke " +
        "`order_items.judul_beku` — yang lalu diproyeksikan view `pesanan_item_staf`. " +
        "Harga hidup di `digital_product_prices`; buang angkanya dari judul.\n" +
        tertuduh.join("\n"),
    ).toEqual([]);
  });

  it("pemindai judul benar-benar bisa merah (kontrol positif)", async () => {
    await semaiProduk("Panduan Menyusui Rp 150.000");
    const tertuduh = (await judulProduk()).filter((j) => POLA_NOMINAL_TEKS.test(j));
    expect(tertuduh).toContain("Panduan Menyusui Rp 150.000");
  });
});

describe("kolom teks tabel pesanan tidak memuat nominal", () => {
  it("baris nota yang BENAR-BENAR ada ikut terpindai, dan bersih", async () => {
    // Pemindai nota tetap ada — tapi ia hanya berarti bila ada barisnya. Kasus
    // ini yang menyediakan barisnya, dan yang menolak jalan bila pemindainya
    // ternyata tidak melihat apa pun.
    const produk = await semaiProduk("Kelas Prakonsepsi");
    const { data, error } = await svc
      .from("orders")
      .insert({ kode: kodeUji(), client_id: RINA_CLIENT_ID, jumlah_item: 1 })
      .select("id")
      .single();
    expect(error).toBeNull();
    pesananSampah.push(data!.id);

    const { error: eItem } = await svc.from("order_items").insert({
      pesanan_id: data!.id,
      jenis: "produk_digital",
      product_id: produk,
      judul_beku: "Kelas Prakonsepsi",
      harga_beku: 150_000,
      urutan: 1,
    });
    expect(eItem).toBeNull();

    const baris = await teksNota();
    expect(baris.length, "pemindai nota tidak melihat satu baris pun").toBeGreaterThan(0);
    expect(bocor(baris)).toEqual([]);
  });

  it("pemindai sebab_tinjauan benar-benar bisa merah (kontrol positif)", async () => {
    // Pagar yang tidak pernah bisa memerah terbaca persis seperti pagar yang
    // bekerja. Kasus ini menyisipkan pelanggaran SUNGGUHAN, membuktikan
    // pemindai di atas menemukannya, lalu membongkarnya lagi.
    const { data, error } = await svc
      .from("orders")
      .insert({
        kode: kodeUji(),
        client_id: RINA_CLIENT_ID,
        jumlah_item: 1,
        sebab_tinjauan: "selisih 50.000",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    pesananSampah.push(data!.id);

    expect(bocor(await teksNota()).some((b) => b.includes("50.000"))).toBe(true);
  });

  it("kosakata sebab_tinjauan yang sah TIDAK dituduh", () => {
    // Arah kedua, sama pentingnya: pola yang terlalu lebar akan memerahkan
    // setiap baris ditahan yang sah, dan pagar yang selalu merah adalah pagar
    // yang berhenti dibaca.
    for (const sah of [
      "selisih_nominal",
      "selisih_status",
      "lunas_setelah_tutup",
      "akses_tertahan",
      "penangan_belum_ada",
      "refund",
      "chargeback",
    ]) {
      expect(POLA_NOMINAL_TEKS.test(sah), `kosakata sah dituduh: ${sah}`).toBe(false);
    }
  });
});
```

**Yang DIHAPUS dari berkas ini, dan kenapa.** Kasus
`it("nol baris membawa angka rupiah di sebab_tinjauan atau judul_beku")` — pemindaian SELURUH isi
`orders.sebab_tinjauan` dan `order_items.judul_beku` tanpa filter — dibuang. Kedua tabel itu
kosong di setiap jalan bersih, jadi assertion-nya hijau karena tidak ada yang dipindai, dan pada
Supabase lokal yang dipakai bersama sesi lain hasilnya malah tidak deterministik. Uji yang tidak
bisa gagal lebih buruk daripada tidak ada uji: ia membeli rasa aman. Penggantinya dua kasus yang
benar-benar bisa merah — pemindaian hulu (`digital_products.judul`, tabel yang SELALU berisi,
dengan penolakan anti-hampa) dan pemindaian nota atas baris yang kasusnya sendiri semai.

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-teks-tanpa-nominal.test.ts
```

Kelima kasus hijau. Dua kontrol positif (judul dan `sebab_tinjauan`) adalah yang membuktikan
kedua pemindai benar-benar bisa merah; kasus kosakata membuktikan polanya tidak terlalu lebar.
Bila kasus pertama merah dengan sebuah judul produk SEED, itu bukan uji yang salah — itu judul
yang harus dibetulkan sebelum P1 mendarat.

---

- [ ] **Step 9: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma && git add web/supabase/migrations/20260926110000_pesanan_tabel.sql web/tests/pesanan-nota-beku.test.ts web/tests/pesanan-teks-tanpa-nominal.test.ts web/tests/money-firewall-struktural.test.ts web/tests/struktur-rls.test.ts && git commit -m "$(cat <<'PESAN'
feat(pesanan): tabel orders & order_items, nota yang tidak bisa ditulis ulang

orders lahir NOL kolom nominal — totalnya dijumlahkan dari order_items —
jadi ia sengaja TIDAK masuk TABEL_UANG. Yang masuk adalah order_items,
dan pendaftarannya membantah preseden C2 dengan alasan yang ditulis di
dokblok pagarnya: "nominal diturunkan, tidak pernah disimpan" benar untuk
TAGIHAN dan salah untuk PESANAN, karena angka pembandingnya ada di tangan
Midtrans dan ikut ditandatangani.

DUA CHECK positif berpasangan di orders, bukan satu: nilai enum keenam
yang lupa diklasifikasikan jatuh ke luar KEDUANYA dan gagal 23514 pada
penulisan pertamanya. Satu CHECK saja fail-open — false = false lolos.
Alasan yang sama melahirkan dua CHECK bercermin di order_items: dengan
num_nonnulls saja, nilai order_item_source ketiga yang membawa
booking_request_id lolos kedua pagar.

Pembekuan baris nota dijaga TRIGGER, bukan ketiadaan policy, dan tanpa
gerbang current_user: yang paling mungkin menulis ulang harga beku adalah
webhook ber-service-role, persis peran yang idiom gerbang itu kecualikan.
Ujinya menembak dua jalur — PostgREST dan SQL langsung. DELETE sengaja
tidak dijaga, dan itu diuji sebagai assertion positif: cascade dari orders
harus bisa jalan.

Indeks unik parsial pesanan_terbuka_satu_per_klien adalah yang membuat
dua checkout paralel melahirkan tepat satu pesanan, tanpa kunci di
TypeScript.

Pagar rumah disunting di commit yang sama, tapi HANYA entri milik tabel yang
lahir di sini: order_items ke TABEL_UANG dan SENGAJA_TERKUNCI, plus assertion
daftar kolom PERSIS supaya tabel uang tidak boleh tumbuh diam-diam. Entri
notifikasi_* menyusul bersama migrasi yang melahirkannya; daftar izin anon
dilengkapi sekali jalan di migrasi kelima, sesudah view staf ada.

Uji nominal-sebagai-teks memindai HULUNYA (digital_products.judul), bukan isi
dua tabel yang kosong di setiap jalan bersih: assertion "0 baris" atas tabel
kosong hijau karena tidak memindai apa pun, dan pada Supabase lokal yang
dipakai bersama ia malah tidak deterministik.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

---

### Task 3: Jejak & notifikasi

**Files:**
- Create: `web/supabase/migrations/20260926120000_pesanan_jejak.sql`
- Create: `web/tests/pesanan-jejak-yatim.test.ts`
- Modify: `web/tests/money-firewall-struktural.test.ts` — **ENTRI `notifikasi_pesanan` SAJA**
  (`TABEL_UANG` += satu nama; dua assertion di dalam blok yang sudah dibuat Tugas 2). Helper
  `kolomUangDi` sudah ada — jangan membuatnya lagi.
- Modify: `web/tests/struktur-rls.test.ts` — **ENTRI `notifikasi_ditolak_harian` SAJA**, disisipkan
  **menurut abjad** antara `"client_invites"` dan `"order_items"`.
- **JANGAN** menyunting `web/tests/grant-anon.test.ts`. Pemilik tunggalnya **Tugas 5** (peta §13):
  berkas itu menerjemahkan nama lewat `format('public.%I',$1)::regclass`, yang MELEMPAR `42P01`
  untuk relasi yang belum ada, jadi ia hanya bisa dilengkapi sekali jalan sesudah view
  `pesanan_item_staf` lahir di migrasi 5. Daftar izin tidak memerahkan apa pun saat ditambah,
  jadi menundanya tidak menutup apa pun lebih lambat — yang didapat adalah SATU pemilik untuk
  satu berkas, alih-alih satu berkas yang tiga tugas berhak menyentuhnya.
- **JANGAN** menyentuh entri `order_items` di kedua berkas pagar di atas: itu milik Tugas 2, dan
  sudah mendarat.

**Interfaces:**
- Consumes (Tugas 1): `public.order_event` — tipe kolom `jejak_pesanan.kejadian`.
- Consumes (Tugas 2): `public.orders(id)` sebagai NILAI kolom saja. `jejak_pesanan.pesanan_id` dan `notifikasi_pesanan.pesanan_id` **SENGAJA tanpa foreign key** (pola `20260829160000_jejak_status_bayar.sql`: jejak yang ikut lenyap bersama yang diaudit tidak berguna). Uji yatim di tugas ini adalah konsekuensi langsungnya.
- Consumes (repo): `public.user_role()`.
- Produces:
  - `public.jejak_pesanan` — `id`, `pesanan_id uuid`, `padma_id text`, `kejadian public.order_event not null`, `keterangan text`, `dibuat_pada timestamptz not null default now()`. Policy baca staf saja; `grant select to authenticated`.
  - Indeks `jejak_pesanan_lunas_sekali` (unique parsial `(pesanan_id) where kejadian = 'lunas'`) dan `jejak_pesanan_pesanan_idx`.
  - `public.notifikasi_pesanan` — `id`, `pesanan_id uuid`, `sidik text not null`, `transaksi_id text`, `status_midtrans text`, `kanal text`, `nominal_diterima numeric(14,2)`, `diterima_pada timestamptz not null default now()`. Constraint `notifikasi_pesanan_sidik_unik`, indeks `notifikasi_pesanan_pesanan_idx`. Policy baca staf saja.
  - `public.notifikasi_ditolak_harian` — `tanggal date primary key`, `jumlah integer not null default 0`, `tak_dikenal integer not null default 0`. RLS aktif, NOL policy, NOL grant.
  - `public.catat_notifikasi_ditolak() returns void` — `security definer`, upsert `jumlah = jumlah + 1` pada `current_date`. Tertutup untuk `public, anon, authenticated`. **Tugas 8 memanggilnya dengan service role** sesudah tanda tangan gagal, sebelum 401.
  - `public.catat_notifikasi_tak_dikenal() returns void` — kembarannya, menaikkan `tak_dikenal`. **Tugas 8 memanggilnya dengan service role** sebelum menjawab 200 untuk `pesanan_tidak_ada`.

**BACA DULU** (pola yang ditiru, path lengkap):
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260829160000_jejak_status_bayar.sql` UTUH — cetakan tabel jejak rumah: tanpa FK (dengan alasannya di komentar kolom), policy baca staf saja, `revoke all` lalu `grant select`, pengisian oleh fungsi `security definer`.
- `/Users/arvinfairuz/Documents/padma/web/tests/jejak-yatim.test.ts` UTUH — berkas yang ditiru uji tugas ini, termasuk bentuk `left join` + `is null` (baris 58-77) dan alasan kenapa `not exists` atas UNION tidak dipakai.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921150000_ambil_produk_gratis.sql:78-81` — bentuk `revoke all on function ... from public, anon` lalu `grant execute ... to authenticated`. Fungsi di tugas ini melakukan KEBALIKANNYA (tidak ada grant sama sekali), dan alasannya ditulis di migrasinya.
- `/Users/arvinfairuz/Documents/padma/web/tests/helpers/db.ts` — `querySql`.
- `/Users/arvinfairuz/Documents/padma/web/tests/money-firewall-struktural.test.ts:124-144` — kesembilan belas pola. `nominal_diterima` cocok dengan pola ke-5 (`/(^|_)nominal(_|$)/`); `jumlah` TIDAK cocok dengan pola ke-15 (`/(^|_)totals?(_|$)/`), dan itulah kenapa kolom penghitung penyerang bernama `jumlah`, bukan `total`.

---

- [ ] **Step 1: Tulis uji jejak yatim yang gagal**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/pesanan-jejak-yatim.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * HIGIENE + STRUKTUR jejak pesanan — saudara tests/jejak-yatim.test.ts.
 *
 * `jejak_pesanan` dan `notifikasi_pesanan` SENGAJA tanpa foreign key ke
 * `orders`: jejak audit yang ikut lenyap bersama yang diaudit tidak berguna
 * sama sekali. Konsekuensinya persis yang sudah menggigit repo ini satu kali —
 * tidak ada cascade yang menyapu baris yang sasarannya dihapus, dan tidak satu
 * pun uji lain meng-assert JUMLAH TOTAL jejak, sehingga kebocoran fixture bisa
 * hidup selamanya tanpa memerahkan apa pun.
 *
 * Berkas ini pagar yang hilang itu, untuk tabel pesanan. Setiap berkas uji
 * yang membuat lalu menghapus pesanan WAJIB menyapu jejak & notifikasinya
 * sendiri lewat SERVICE ROLE — peran `authenticated` memang tidak boleh punya
 * DELETE di sini, dan hak itu ditegaskan ulang di bawah supaya "perbaikan"
 * yang sebenarnya melonggarkan keamanan tetap merah.
 */
const svc = createAdminSupabase();

const jejakSampah: string[] = [];
const notifikasiSampah: string[] = [];
const pesananSampah: string[] = [];

afterEach(async () => {
  while (jejakSampah.length) {
    await svc.from("jejak_pesanan").delete().eq("id", jejakSampah.pop()!);
  }
  while (notifikasiSampah.length) {
    await svc.from("notifikasi_pesanan").delete().eq("id", notifikasiSampah.pop()!);
  }
  while (pesananSampah.length) {
    await svc.from("orders").delete().eq("id", pesananSampah.pop()!);
  }
});

const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

function kodeUji(): string {
  return `PSN-260926-${Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, "0")}`;
}

async function semaiPesanan(): Promise<string> {
  const { data, error } = await svc
    .from("orders")
    .insert({ kode: kodeUji(), client_id: RINA_CLIENT_ID, jumlah_item: 1 })
    .select("id")
    .single();
  if (error) throw error;
  pesananSampah.push(data!.id);
  return data!.id;
}

type Yatim = { sumber: string; id: string; pesanan_id: string; keterangan: string | null };

/**
 * Baris jejak & notifikasi yang pesanannya sudah tidak ada.
 *
 * `left join` + `is null`, bentuk yang sama dengan tests/jejak-yatim.test.ts:
 * ia ikut menangkap kolom yang berisi UUID yang tidak pernah ada sama sekali
 * (salah ketik fixture), bukan hanya yang sudah dihapus.
 */
async function yatim(): Promise<Yatim[]> {
  return querySql<Yatim>(
    `select 'jejak_pesanan' as sumber, j.id::text, j.pesanan_id::text, j.kejadian::text as keterangan
       from public.jejak_pesanan j
       left join public.orders o on o.id = j.pesanan_id
      where j.pesanan_id is not null and o.id is null
     union all
     select 'notifikasi_pesanan', n.id::text, n.pesanan_id::text, n.status_midtrans
       from public.notifikasi_pesanan n
       left join public.orders o2 on o2.id = n.pesanan_id
      where n.pesanan_id is not null and o2.id is null
      order by 1, 2`,
  );
}

describe("higiene jejak pesanan", () => {
  it("tidak ada baris jejak/notifikasi YATIM yang ditinggalkan berkas uji mana pun", async () => {
    const baris = await yatim();
    expect(
      baris.length,
      baris.length === 0
        ? ""
        : `${baris.length} baris menunjuk pesanan yang sudah tidak ada.\n` +
          `Sebuah berkas uji membuat pesanan lalu menghapusnya tanpa ikut menyapu\n` +
          `jejak/notifikasinya di afterAll. Kedua tabel itu SENGAJA tanpa foreign key,\n` +
          `jadi tidak ada cascade yang menyapunya — sapu manual lewat SERVICE ROLE.\n` +
          baris.map((b) => `  - ${b.sumber} ${b.id} -> ${b.pesanan_id} (${b.keterangan})`).join("\n"),
    ).toBe(0);
  });

  it("pemindai yatim benar-benar bisa merah (kontrol positif)", async () => {
    // Tanpa kasus ini, uji di atas hijau entah pemindainya bekerja atau
    // tabelnya kosong — dua keadaan yang tidak bisa dibedakan assertion itu
    // sendirian, dan persis kelemahan yang membuat kebocoran jejak lama hidup
    // bertahun-tahun.
    const pesananId = await semaiPesanan();
    const { data } = await svc
      .from("jejak_pesanan")
      .insert({ pesanan_id: pesananId, kejadian: "dibuat", keterangan: "kontrol positif" })
      .select("id")
      .single();
    jejakSampah.push(data!.id);

    // Pesanannya dihapus DULU, jejaknya sengaja ditinggal — inilah bentuk
    // kebocoran yang sedang diburu.
    await svc.from("orders").delete().eq("id", pesananId);
    pesananSampah.length = 0;

    const baris = await yatim();
    expect(baris.some((b) => b.id === data!.id)).toBe(true);
  });
});

describe("jejak 'lunas' lahir TEPAT SATU KALI per pesanan", () => {
  it("jejak lunas kedua untuk pesanan yang sama ditolak 23505", async () => {
    // Inilah SATU-SATUNYA janji P1 kepada proyek WhatsApp: pelanggan kejadian
    // boleh mengandaikan satu baris 'lunas' per pesanan, selamanya.
    // `unique (pesanan_id, kejadian)` SALAH dan akan mematahkan tiga kejadian
    // lain — itu diuji di kasus berikutnya.
    const pesananId = await semaiPesanan();
    const baris = { pesanan_id: pesananId, kejadian: "lunas" };

    const pertama = await svc.from("jejak_pesanan").insert(baris).select("id").single();
    expect(pertama.error).toBeNull();
    jejakSampah.push(pertama.data!.id);

    const kedua = await svc.from("jejak_pesanan").insert(baris).select("id");
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("jejak_pesanan_lunas_sekali");
  });

  it("kejadian LAIN boleh berulang untuk pesanan yang sama", async () => {
    // `notifikasi` lahir satu per notifikasi Midtrans, `diperiksa_ulang` satu
    // per panggilan penyapu, `token_terbit` satu per percobaan. Indeks unik
    // atas (pesanan_id, kejadian) akan mematahkan ketiganya — dan bentuk
    // kegagalannya adalah webhook yang menolak notifikasi kedua Midtrans.
    const pesananId = await semaiPesanan();
    for (const kejadian of ["notifikasi", "notifikasi", "diperiksa_ulang", "diperiksa_ulang"]) {
      const { data, error } = await svc
        .from("jejak_pesanan")
        .insert({ pesanan_id: pesananId, kejadian })
        .select("id")
        .single();
      expect(error, `kejadian ${kejadian} seharusnya boleh berulang`).toBeNull();
      jejakSampah.push(data!.id);
    }
  });
});

describe("notifikasi_pesanan — lapis idempotensi pertama", () => {
  it("sidik kembar ditolak 23505", async () => {
    const pesananId = await semaiPesanan();
    const sidik = `sidik-uji-${Date.now()}`;

    const pertama = await svc
      .from("notifikasi_pesanan")
      .insert({ pesanan_id: pesananId, sidik, status_midtrans: "settlement" })
      .select("id")
      .single();
    expect(pertama.error).toBeNull();
    notifikasiSampah.push(pertama.data!.id);

    const kedua = await svc
      .from("notifikasi_pesanan")
      .insert({ pesanan_id: pesananId, sidik, status_midtrans: "settlement" })
      .select("id");
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("notifikasi_pesanan_sidik_unik");
  });

  it("dua sidik BERBEDA untuk satu pesanan sama-sama diterima", async () => {
    // Midtrans mengirim beberapa notifikasi per pesanan: `pending` lalu
    // `settlement`. Dengan sidik SEPESANAN, yang pertama mengunci barisnya dan
    // `settlement` ditolak sebagai duplikat — pembeli membayar, uang masuk,
    // pesanan tinggal menunggu_bayar selamanya. Kasus ini pagar terhadap
    // "sederhanakan saja sidiknya jadi order_id".
    const pesananId = await semaiPesanan();
    for (const status of ["pending", "settlement"]) {
      const { data, error } = await svc
        .from("notifikasi_pesanan")
        .insert({ pesanan_id: pesananId, sidik: `sidik-${status}-${Date.now()}`, status_midtrans: status })
        .select("id")
        .single();
      expect(error).toBeNull();
      notifikasiSampah.push(data!.id);
    }
  });

  it("nominal_diterima ada dan bertipe angka — bukan teks", async () => {
    // Satu-satunya tempat nominal yang BENAR-BENAR diterima Midtrans
    // disimpan. Untuk baris `ditahan` — satu-satunya baris yang angkanya jadi
    // keputusan manusia — tanpa kolom ini yang tersimpan hanyalah angka yang
    // KITA tagih, dan staf tetap harus membuka dashboard Midtrans.
    const [kolom] = await querySql<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'notifikasi_pesanan'
          and column_name = 'nominal_diterima'`,
    );
    expect(kolom.data_type).toBe("numeric");
    // Nullable: notifikasi yang tanda tangannya sah tapi badannya tanpa
    // gross_amount tetap tercatat, dan "tidak tahu" bukan "nol rupiah".
    expect(kolom.is_nullable).toBe("YES");
  });
});

describe("notifikasi_ditolak_harian — penghitung penyerang", () => {
  it("kolomnya bernama `jumlah`, bukan `total`", async () => {
    // `/(^|_)totals?(_|$)/` adalah pola ke-15 dari sembilan belas di money
    // firewall struktural, dan penghitung notifikasi bertanda tangan salah
    // bukan tabel uang. Nama yang salah di sini memerahkan pagar yang tidak
    // ada hubungannya, dan "perbaikan"-nya akan melebarkan TABEL_UANG.
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'notifikasi_ditolak_harian'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual(["tanggal", "jumlah", "tak_dikenal"]);
  });

  it("catat_notifikasi_tak_dikenal() menaikkan tak_dikenal, BUKAN jumlah", async () => {
    // Dua penghitung, dua arti, dan memisahkannya bukan kerapian: `jumlah`
    // adalah notifikasi bertanda tangan PALSU (serangan atau kunci salah),
    // `tak_dikenal` adalah notifikasi bertanda tangan SAH yang order_id-nya
    // tidak menunjuk pesanan mana pun — yaitu uang yang benar-benar milik kita
    // lalu kita buang. Menyatukannya membuat angka kedua tidak pernah bisa
    // dibaca, dan angka kedua itulah satu-satunya jejak yang ditinggalkan
    // cabang `pesanan_tidak_ada`.
    const sebelumnya = await querySql<{ jumlah: number; tak_dikenal: number }>(
      `select jumlah, tak_dikenal from public.notifikasi_ditolak_harian
        where tanggal = current_date`,
    );
    const awal = sebelumnya.length
      ? { jumlah: Number(sebelumnya[0].jumlah), tak: Number(sebelumnya[0].tak_dikenal) }
      : null;

    try {
      expect((await svc.rpc("catat_notifikasi_tak_dikenal")).error).toBeNull();
      expect((await svc.rpc("catat_notifikasi_tak_dikenal")).error).toBeNull();

      const [sesudah] = await querySql<{ jumlah: number; tak_dikenal: number }>(
        `select jumlah, tak_dikenal from public.notifikasi_ditolak_harian
          where tanggal = current_date`,
      );
      expect(Number(sesudah.tak_dikenal)).toBe((awal?.tak ?? 0) + 2);
      // Dan penghitung tanda tangan salah TIDAK ikut bergerak.
      expect(Number(sesudah.jumlah)).toBe(awal?.jumlah ?? 0);
    } finally {
      if (awal === null) {
        await querySql(`delete from public.notifikasi_ditolak_harian where tanggal = current_date`);
      } else {
        await querySql(
          `update public.notifikasi_ditolak_harian
              set jumlah = $1, tak_dikenal = $2
            where tanggal = current_date`,
          [awal.jumlah, awal.tak],
        );
      }
    }
  });

  it("catat_notifikasi_ditolak() menaikkan hitungan hari ini tepat satu per panggilan", async () => {
    // Kenapa RPC, bukan upsert dari TypeScript: supabase-js `upsert` tidak
    // bisa menyatakan `jumlah = jumlah + 1` — ia menimpa. Dua notifikasi
    // bertanda tangan salah dalam satu hari akan tercatat sebagai satu.
    const sebelumnya = await querySql<{ jumlah: number }>(
      `select jumlah from public.notifikasi_ditolak_harian where tanggal = current_date`,
    );
    const awal = sebelumnya.length ? Number(sebelumnya[0].jumlah) : null;

    try {
      // Lewat service role, persis jalur yang dipakai rute webhook (Tugas 8).
      expect((await svc.rpc("catat_notifikasi_ditolak")).error).toBeNull();
      expect((await svc.rpc("catat_notifikasi_ditolak")).error).toBeNull();

      const [sesudah] = await querySql<{ jumlah: number }>(
        `select jumlah from public.notifikasi_ditolak_harian where tanggal = current_date`,
      );
      expect(Number(sesudah.jumlah)).toBe((awal ?? 0) + 2);
    } finally {
      // Dipulihkan PERSIS ke keadaan semula, bukan dihapus membabi buta:
      // berkas uji lain (webhook, Tugas 8) juga menaikkannya, dan menghapus
      // baris milik mereka akan memerahkan berkas yang sehat.
      if (awal === null) {
        await querySql(`delete from public.notifikasi_ditolak_harian where tanggal = current_date`);
      } else {
        await querySql(
          `update public.notifikasi_ditolak_harian set jumlah = $1 where tanggal = current_date`,
          [awal],
        );
      }
    }
  });

  it("authenticated TIDAK boleh memanggil kedua penghitungnya", async () => {
    for (const f of ["catat_notifikasi_ditolak", "catat_notifikasi_tak_dikenal"]) {
      const [row] = await querySql<{ bisa: boolean }>(
        `select has_function_privilege('authenticated',
                  format('public.%I()', $1::text)::regprocedure, 'EXECUTE') as bisa`,
        [f],
      );
      expect(row.bisa, `public.${f}() masih terbuka bagi authenticated`).toBe(false);
    }
  });

  it("tabelnya tertutup untuk kedua peran API", async () => {
    const hak = await querySql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'notifikasi_ditolak_harian'
          and grantee in ('anon','authenticated')`,
    );
    expect(hak).toEqual([]);
  });
});

describe("hak & RLS kedua tabel jejak", () => {
  it("authenticated hanya memegang SELECT atas jejak_pesanan & notifikasi_pesanan", async () => {
    const hak = await querySql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('jejak_pesanan','notifikasi_pesanan')
          and grantee = 'authenticated'
        order by table_name, privilege_type`,
    );
    expect(hak.map((h) => `${h.table_name}.${h.privilege_type}`)).toEqual([
      "jejak_pesanan.SELECT",
      "notifikasi_pesanan.SELECT",
    ]);
  });

  it("pembersihan TIDAK boleh dipermudah dengan memberi DELETE ke peran API", async () => {
    // Pagar terhadap "perbaikan" yang salah arah, disalin sengaja dari
    // tests/jejak-yatim.test.ts: kebocoran yatim ditutup dengan menyapu lewat
    // service role — BUKAN dengan melonggarkan hak tabel supaya
    // `authenticated` bisa menghapus jejaknya sendiri.
    const hak = await querySql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('jejak_pesanan','notifikasi_pesanan')
          and grantee in ('anon','authenticated')
          and privilege_type in ('DELETE','TRUNCATE','UPDATE','INSERT')`,
    );
    expect(hak).toEqual([]);
  });

  it("staf membaca keduanya, klien TIDAK", async () => {
    // Satu baris disisipkan lewat service role tepat sebelum diperiksa, supaya
    // "0 baris" pada sisi klien membuktikan PENYARINGAN, bukan ketiadaan data.
    const pesananId = await semaiPesanan();
    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .insert({ pesanan_id: pesananId, kejadian: "dibuat" })
      .select("id")
      .single();
    jejakSampah.push(jejak!.id);

    const admin = await signInAs("admin@padma.test");
    const dilihatAdmin = await admin.from("jejak_pesanan").select("id").eq("id", jejak!.id);
    expect(dilihatAdmin.error).toBeNull();
    expect((dilihatAdmin.data ?? []).length).toBe(1);

    const klien = await signInAs("ananda@padma.test");
    const dilihatKlien = await klien.from("jejak_pesanan").select("id").eq("id", jejak!.id);
    expect(dilihatKlien.error).toBeNull();
    expect(dilihatKlien.data ?? []).toEqual([]);
  });

  it("anon berhenti di 42501 pada ketiga tabel", async () => {
    for (const tabel of ["jejak_pesanan", "notifikasi_pesanan", "notifikasi_ditolak_harian"]) {
      const { error } = await anonClient().from(tabel).select("*").limit(1);
      expect(error?.code, `anon seharusnya ditolak pada ${tabel}`).toBe("42501");
    }
  });
});
```

---

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/pesanan-jejak-yatim.test.ts
```

Seluruh kasus merah dengan `relation "public.jejak_pesanan" does not exist` (42P01) dan, untuk kasus hak fungsi, `function public.catat_notifikasi_ditolak() does not exist` / `... catat_notifikasi_tak_dikenal() ...` (42883). Tidak ada satu pun kasus yang hijau sebelum migrasinya ditulis — termasuk uji yatim, karena kueri pemindainya sendiri menyentuh tabel yang belum lahir.

---

- [ ] **Step 3: Tulis migrasinya**

Buat `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260926120000_pesanan_jejak.sql`:

```sql
-- ===========================================================================
-- INTI PEMBAYARAN (3/6) — JEJAK & NOTIFIKASI
-- ===========================================================================
-- Kejadian di P1 adalah SATU BARIS di `jejak_pesanan`, diterbitkan di dalam
-- transaksi yang menggeser status. Bukan bus, bukan antrean, bukan NOTIFY:
-- repo ini punya NOL infrastruktur pekerjaan latar, dan pembatas laju yang ada
-- pun mengakui di komentarnya sendiri bahwa `Map` per-proses tidak bertahan di
-- serverless (src/lib/skrining/pembatas.ts:25).
--
-- Notifikasi WhatsApp adalah proyek TERSENDIRI. P1 menerbitkan dan mencatat;
-- NOL pelanggan. Tidak ada kolom `dikirim_wa_pada` di sini — hanya proyek WA
-- yang tahu apa artinya "sudah terkirim", dan kolom mati adalah persis yang
-- doktrin repo ini tolak.

-- ---------------------------------------------------------------------------
-- (1) JEJAK
-- ---------------------------------------------------------------------------
create table public.jejak_pesanan (
  id uuid primary key default gen_random_uuid(),

  -- SENGAJA TANPA foreign key, pola 20260829160000_jejak_status_bayar.sql:
  -- jejak audit yang ikut lenyap bersama yang diaudit tidak berguna sama
  -- sekali. Ongkosnya nyata dan diterima: tidak ada cascade yang menyapu baris
  -- yatim, jadi setiap berkas uji wajib menyapu miliknya sendiri lewat service
  -- role — itulah yang dijaga tests/pesanan-jejak-yatim.test.ts.
  pesanan_id uuid,

  -- DIDENORMALISASI dengan sengaja: pelanggan kejadian (proyek WhatsApp)
  -- tidak perlu hak baca `clients` untuk tahu jejak ini milik siapa.
  padma_id text,

  kejadian public.order_event not null,
  keterangan text,
  dibuat_pada timestamptz not null default now()
);

comment on table public.jejak_pesanan is
  'Jejak kejadian pesanan. TANPA foreign key (jejak yang ikut lenyap bersama '
  'yang diaudit tidak berguna) dan tanpa hak tulis bagi peran API: pengisiannya '
  'lewat fungsi security definer. Pembersihan baris yatim WAJIB lewat service '
  'role. Satu-satunya janji ke proyek WhatsApp ada di indeks '
  'jejak_pesanan_lunas_sekali.';

-- SATU indeks unik, dan ia SEKALIGUS kontraknya: jejak 'lunas' lahir TEPAT
-- SATU KALI per pesanan. `unique (pesanan_id, kejadian)` SALAH dan akan
-- mematahkan tiga kejadian sekaligus — `notifikasi` lahir satu per notifikasi
-- Midtrans, `diperiksa_ulang` satu per panggilan penyapu, `token_terbit` satu
-- per percobaan. Bentuk kegagalannya: webhook menolak notifikasi KEDUA
-- Midtrans, yaitu settlement.
create unique index jejak_pesanan_lunas_sekali
  on public.jejak_pesanan (pesanan_id) where kejadian = 'lunas';

create index jejak_pesanan_pesanan_idx on public.jejak_pesanan (pesanan_id, dibuat_pada desc);

alter table public.jejak_pesanan enable row level security;

-- Hanya BACA untuk staf. Sengaja TIDAK ada policy INSERT/UPDATE/DELETE untuk
-- peran API mana pun: pengisian dikerjakan fungsi SECURITY DEFINER (migrasi 4
-- & 5), sehingga jejak tidak bisa dikarang maupun dihapus oleh admin yang
-- sedang diaudit.
create policy "jejak pesanan: staf baca" on public.jejak_pesanan for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

revoke all on public.jejak_pesanan from anon;
revoke all on public.jejak_pesanan from authenticated;
grant select on public.jejak_pesanan to authenticated;

-- ---------------------------------------------------------------------------
-- (2) NOTIFIKASI MIDTRANS — lapis idempotensi pertama
-- ---------------------------------------------------------------------------
create table public.notifikasi_pesanan (
  id uuid primary key default gen_random_uuid(),

  -- Tanpa FK, alasan yang sama dengan jejak di atas.
  pesanan_id uuid,

  -- Dihitung di rute webhook (Node crypto) dan dikirim sebagai argumen RPC:
  -- sha256hex([order_id, status_code, transaction_status, fraud_status ?? '',
  -- transaction_id].join('|')). Yang BUKAN sidik, dan kenapa: `order_id` saja
  -- atau `transaction_id` saja adalah tebakan yang sangat wajar dan keduanya
  -- MEMAKAN UANG — dengan sidik sepesanan, notifikasi `pending` mendarat
  -- duluan, mengunci barisnya, dan `settlement` ditolak sebagai duplikat.
  -- `fraud_status` ikut karena capture+challenge dan capture+accept adalah dua
  -- keputusan berbeda atas transaksi yang sama.
  sidik text not null,

  transaksi_id text,
  status_midtrans text,
  kanal text,

  -- SATU-SATUNYA tempat nominal yang benar-benar DITERIMA Midtrans disimpan,
  -- diambil dari gross_amount notifikasi yang SUDAH LOLOS signature — tidak
  -- pernah dari badan yang belum diverifikasi.
  --
  -- Kenapa perlu ada: untuk pesanan `lunas`, sum(harga_beku) sudah menjawab
  -- "berapa yang dibayar" karena verifikasi jumlah lolos. Untuk pesanan
  -- `ditahan` — satu-satunya baris yang angkanya benar-benar jadi keputusan
  -- manusia — yang tersimpan tanpa kolom ini hanyalah angka yang KITA tagih,
  -- dan staf tetap harus membuka dashboard Midtrans untuk tahu selisihnya.
  -- Ongkosnya disebut terbuka: tabel ini karena itu ikut masuk TABEL_UANG.
  --
  -- Nullable: notifikasi yang tanda tangannya sah tapi badannya tanpa
  -- gross_amount tetap dicatat, dan "tidak tahu" bukan "nol rupiah".
  nominal_diterima numeric(14,2),

  diterima_pada timestamptz not null default now(),

  constraint notifikasi_pesanan_sidik_unik unique (sidik)
);

comment on table public.notifikasi_pesanan is
  'Lapis idempotensi pertama webhook Midtrans, dan satu-satunya tempat nominal '
  'yang BENAR-BENAR diterima disimpan (nominal_diterima). Anggota TABEL_UANG. '
  'Policy baca staf saja, supaya /admin/pesanan membacanya dengan sesi '
  'pemanggil tanpa service role. Insert-nya berada DI DALAM transaksi yang '
  'sama dengan transisi & penyaluran: sidik yang commit lebih dulu mengubah '
  'kegagalan sementara menjadi permanen.';

create index notifikasi_pesanan_pesanan_idx
  on public.notifikasi_pesanan (pesanan_id, diterima_pada desc);

alter table public.notifikasi_pesanan enable row level security;

create policy "notifikasi pesanan: staf baca" on public.notifikasi_pesanan for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

revoke all on public.notifikasi_pesanan from anon;
revoke all on public.notifikasi_pesanan from authenticated;
grant select on public.notifikasi_pesanan to authenticated;

-- ---------------------------------------------------------------------------
-- (3) PENGHITUNG NOTIFIKASI BERTANDA TANGAN SALAH
-- ---------------------------------------------------------------------------
-- Menghitung saja, dan NOL teks penyerang disimpan. Kolomnya bernama `jumlah`,
-- BUKAN `total`: /(^|_)totals?(_|$)/ adalah salah satu dari sembilan belas
-- pola money firewall, dan penghitung penyerang bukan tabel uang.
create table public.notifikasi_ditolak_harian (
  tanggal date primary key,

  -- Notifikasi bertanda tangan SALAH: serangan, atau kunci yang tidak cocok.
  jumlah integer not null default 0,

  -- Notifikasi bertanda tangan SAH yang `order_id`-nya tidak menunjuk pesanan
  -- mana pun. Dipisahkan dari `jumlah` karena artinya berlawanan: yang ini
  -- BENAR-BENAR dari Midtrans, artinya uangnya sungguhan milik kita, lalu kita
  -- membuang notifikasinya dan menyuruh Midtrans berhenti mengirim (200).
  -- Itu satu-satunya keluaran webhook yang tidak menulis apa pun ke mana pun:
  -- bukan `orders`, bukan `jejak_pesanan`, bukan `notifikasi_pesanan` (RPC
  -- keluar sebelum insert sidik). Kolom ini jejaknya. Dua jalan masuk yang
  -- nyata dan nol-galat: notifikasi untuk `percobaan` lama yang kelak
  -- "dirapikan" menjadi pencarian kode+percobaan, dan pergeseran bentuk `kode`
  -- di penerbitnya — keduanya membuat SETIAP notifikasi dijawab 200 lalu
  -- hilang, dengan suite tetap hijau.
  --
  -- Namanya bukan `total_tak_dikenal`: /(^|_)totals?(_|$)/ adalah pola ke-15
  -- money firewall, dan penghitung bukan nominal.
  tak_dikenal integer not null default 0
);

comment on table public.notifikasi_ditolak_harian is
  'Dua penghitung harian webhook Midtrans, keduanya NOL teks penyerang: '
  'jumlah = notifikasi bertanda tangan SALAH; tak_dikenal = notifikasi '
  'bertanda tangan SAH yang order_id-nya tidak dikenal, yaitu satu-satunya '
  'keluaran webhook yang tidak menulis apa pun ke tabel mana pun. RLS aktif '
  'tanpa policy sama sekali: hanya service role. Kolomnya `jumlah`, bukan '
  '`total` — yang kedua akan memerahkan money firewall atas tabel yang sama '
  'sekali bukan tabel uang.';

-- RLS aktif, NOL policy: tidak ada peran API yang bisa menyentuhnya. Itulah
-- yang membuat tabel ini masuk SENGAJA_TERKUNCI di tests/struktur-rls.test.ts.
alter table public.notifikasi_ditolak_harian enable row level security;

revoke all on public.notifikasi_ditolak_harian from anon;
revoke all on public.notifikasi_ditolak_harian from authenticated;

-- Kenapa RPC, dan bukan upsert dari TypeScript: supabase-js `upsert` tidak
-- bisa menyatakan `jumlah = jumlah + 1` — ia MENIMPA. Dua notifikasi bertanda
-- tangan salah dalam satu hari akan tercatat sebagai satu, dan penghitung yang
-- selalu berkata "1" adalah penghitung yang tidak ada.
--
-- `security definer` karena peran pemanggilnya nanti (service role lewat rute
-- webhook) memang tidak diberi hak tabel apa pun di sini, dan supaya jalur
-- penulisan tetap SATU walau kelak ada pemanggil kedua.
create or replace function public.catat_notifikasi_ditolak()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifikasi_ditolak_harian as h (tanggal, jumlah)
  values (current_date, 1)
  on conflict (tanggal) do update set jumlah = h.jumlah + 1;
end;
$$;

comment on function public.catat_notifikasi_ditolak() is
  'Menaikkan penghitung notifikasi bertanda tangan salah hari ini. Dipanggil '
  'rute webhook dengan SERVICE ROLE sesudah signature gagal, sebelum 401. '
  'Tertutup untuk seluruh peran API: pemanggil bersesi tidak punya urusan '
  'menaikkan penghitung penyerang.';

-- Kembarannya untuk cabang `pesanan_tidak_ada`. Ditulis sebagai fungsi KEDUA,
-- bukan sebagai parameter pada fungsi di atas: tanda tangan yang berubah
-- adalah tanda tangan yang harus dicari di setiap pemanggil, dan kedua
-- penghitung ini memang dipanggil dari dua tempat berbeda di rute yang sama.
create or replace function public.catat_notifikasi_tak_dikenal()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifikasi_ditolak_harian as h (tanggal, tak_dikenal)
  values (current_date, 1)
  on conflict (tanggal) do update set tak_dikenal = h.tak_dikenal + 1;
end;
$$;

comment on function public.catat_notifikasi_tak_dikenal() is
  'Menaikkan penghitung notifikasi bertanda tangan SAH yang order_id-nya tidak '
  'menunjuk pesanan mana pun. Dipanggil rute webhook dengan SERVICE ROLE tepat '
  'sebelum menjawab 200: notifikasi sah yang kita buang tidak boleh lebih '
  'sunyi daripada notifikasi palsu yang kita tolak.';

-- Tertutup, TERMASUK dari `authenticated`. Templat aturan [F] repo
-- (20260828230000_fail_closed_sequence_fungsi.sql:176-177) hanya menulis
-- `from public, anon`; fungsi baru LAHIR ber-EXECUTE untuk setiap pengguna
-- login, jadi menyalin templat itu apa adanya membuka pintu tanpa satu pun uji
-- merah. Bentuk ketat di bawah adalah preseden
-- 20260830150000_pengerasan_tabel_uang.sql:197.
revoke all on function public.catat_notifikasi_ditolak() from public, anon, authenticated;
revoke all on function public.catat_notifikasi_tak_dikenal() from public, anon, authenticated;
```

---

- [ ] **Step 4: Terapkan migrasi, jalankan uji jejak, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase migration up && npx vitest run tests/pesanan-jejak-yatim.test.ts
```

Seluruh kasus hijau (15 kasus — satu lebih banyak dari versi pertama rencana ini, yaitu penghitung `tak_dikenal`). Bila `migration up` menolak, `npx supabase db reset` — **koordinasikan dulu, Supabase lokal dipakai bersama sesi lain.**

---

- [ ] **Step 5: Jalankan dua pagar rumah, pastikan MERAH**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/money-firewall-struktural.test.ts tests/struktur-rls.test.ts
```

- `money-firewall-struktural` → `tidak ada kolom bernuansa nominal uang di luar variant_rates & honor_marks` merah dengan `[ 'notifikasi_pesanan.nominal_diterima (numeric)' ]`.
- `struktur-rls` → `tabel ber-RLS tanpa policy hanya yang sengaja terkunci` merah: hasilnya kini `["client_invites", "notifikasi_ditolak_harian", "order_items", "screening_claims"]` sementara daftarnya masih tiga entri sesudah Tugas 2.

`jejak_pesanan` dan `notifikasi_pesanan` TIDAK muncul di daftar kedua, dan itu benar: keduanya punya policy baca staf.

---

- [ ] **Step 6: Sunting kedua pagar + daftar anon**

**(a) `/Users/arvinfairuz/Documents/padma/web/tests/money-firewall-struktural.test.ts`**

Tambahkan satu entri di akhir `TABEL_UANG`, sesudah `"order_items"`:

```ts
  // `notifikasi_pesanan` (P1, migrasi `pesanan_jejak`) menyimpan
  // `nominal_diterima`: gross_amount notifikasi yang SUDAH lolos signature.
  // Untuk pesanan `ditahan` — satu-satunya baris yang angkanya jadi keputusan
  // manusia — tanpa kolom itu yang tersimpan hanyalah angka yang KITA tagih,
  // dan staf tetap harus membuka dashboard Midtrans untuk tahu selisihnya.
  // Ongkosnya: tabel ini ikut masuk daftar, dan policy-nya baca staf saja.
  "notifikasi_pesanan",
```

Tambahkan satu baris di dalam `it("kolom uang yang sah TETAP berada di tempatnya …")`, sesudah baris `toContain("order_items.harga_beku")`:

```ts
    expect(diTabelUang).toContain("notifikasi_pesanan.nominal_diterima");
```

Dan satu baris di dalam `it("tabel uang P1 berkolom nominal PERSIS satu …")` yang lahir di Tugas 2:

```ts
    expect(kolomUangDi("notifikasi_pesanan")).toEqual(["nominal_diterima"]);
```

**(b) `/Users/arvinfairuz/Documents/padma/web/tests/struktur-rls.test.ts`**

Sisipkan satu entri di `SENGAJA_TERKUNCI`, **menurut abjad** — antara `"client_invites"` dan `"order_items"`:

```ts
    // Penghitung notifikasi Midtrans bertanda tangan salah (P1). RLS aktif
    // tanpa policy sama sekali: yang dicatat adalah jumlah, dan NOL teks
    // penyerang disimpan. Tidak ada peran API yang punya alasan membacanya,
    // termasuk staf — angkanya urusan pemilik service role.
    "notifikasi_ditolak_harian",
```

Daftarnya menjadi, urut: `client_invites`, `notifikasi_ditolak_harian`, `order_items`, `screening_claims`.

**(c) `/Users/arvinfairuz/Documents/padma/web/tests/grant-anon.test.ts` — TIDAK DISENTUH.**

Dicatat sebagai langkah supaya tidak "diperbaiki" oleh orang berikutnya, dan supaya tugas ini
tidak mengulang tabrakan yang sudah terjadi sekali: berkas itu daftar izin murni yang
menerjemahkan setiap nama lewat `format('public.%I', $1::text)::regclass`, dan relasi yang belum
ada MELEMPAR `42P01`. Anggota terakhir daftar P1 adalah view `pesanan_item_staf`, yang lahir di
migrasi 5 — jadi daftarnya dilengkapi sekali jalan di **Tugas 5**, pemilik tunggalnya (peta §13).
Ketiga nama milik tugas ini (`jejak_pesanan`, `notifikasi_pesanan`, `notifikasi_ditolak_harian`)
ikut mendarat di sana, bersama `orders` dan `order_items`.

---

- [ ] **Step 7: Jalankan ketiga pagar, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/money-firewall-struktural.test.ts tests/struktur-rls.test.ts tests/grant-anon.test.ts
```

Ketiganya hijau — dan `grant-anon` hijau **tanpa satu pun suntingan** dari tugas ini.

---

- [ ] **Step 8: Jalankan pagar struktural rumah yang menyapu SELURUH skema**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/hak-hapus-berlebih.test.ts tests/hak-default-sequence-fungsi.test.ts tests/jejak-yatim.test.ts
```

Ketiganya harus hijau **tanpa satu pun suntingan**, dan itulah gunanya langkah ini: ketiga berkas itu menyapu seluruh skema, bukan daftar bernama, jadi merah di sini berarti lima tabel baru P1 mewarisi hak yang tidak disadari siapa pun.

- `hak-hapus-berlebih` → `tidak ada satu tabel pun yang masih memberi DELETE ke authenticated` tetap `["material_assignments","material_services"]`; `TRUNCATE tetap tercabut` tetap `[]`. Keduanya hijau karena default privileges Supabase sudah dicabut untuk kedua verba itu, dan migrasi P1 mencabut sisanya.
- `hak-default-sequence-fungsi` → `tidak ada fungsi/prosedur public yang bisa dieksekusi anon` tetap `[]`: ketiga fungsi baru (`perpindahan_pesanan_sah`, `tolak_ubah_item_pesanan`, `catat_notifikasi_ditolak`) dicabut dari `anon` di migrasinya masing-masing.
- `jejak-yatim` → hijau: berkas uji P1 menyapu fixture-nya sendiri, dan tabel `jejak_status_bayar` tidak disentuh sama sekali oleh ketiga migrasi P1.

---

- [ ] **Step 9: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma && git add web/supabase/migrations/20260926120000_pesanan_jejak.sql web/tests/pesanan-jejak-yatim.test.ts web/tests/money-firewall-struktural.test.ts web/tests/struktur-rls.test.ts && git commit -m "$(cat <<'PESAN'
feat(pesanan): jejak, notifikasi, dan penghitung notifikasi ditolak

Tiga tabel, satu fungsi. Kejadian di P1 adalah satu baris jejak yang lahir
di dalam transaksi yang menggeser status — bukan bus, bukan antrean, bukan
NOTIFY: repo ini punya nol infrastruktur pekerjaan latar, dan pembatas laju
yang ada pun mengakui Map per-proses tidak bertahan di serverless.

jejak_pesanan_lunas_sekali adalah indeks unik PARSIAL, dan ia sekaligus
satu-satunya janji P1 kepada proyek WhatsApp: jejak 'lunas' lahir tepat
sekali per pesanan. unique (pesanan_id, kejadian) SALAH dan akan mematahkan
tiga kejadian sekaligus — notifikasi lahir satu per notifikasi Midtrans,
diperiksa_ulang satu per panggilan penyapu, token_terbit satu per percobaan.
Bentuk kegagalannya: webhook menolak notifikasi KEDUA Midtrans, yaitu
settlement.

notifikasi_pesanan.sidik unik adalah lapis idempotensi pertama.
nominal_diterima disimpan karena untuk pesanan `ditahan` — satu-satunya
baris yang angkanya jadi keputusan manusia — tanpa kolom itu yang tersimpan
hanyalah angka yang KITA tagih. Ongkosnya dibayar terbuka: tabel ini masuk
TABEL_UANG.

DUA penghitung harian, bukan satu, dan memisahkannya bukan kerapian:
`jumlah` adalah notifikasi bertanda tangan PALSU; `tak_dikenal` adalah
notifikasi bertanda tangan SAH yang order_id-nya tidak dikenal — satu-satunya
keluaran webhook yang menjawab "sudah selesai" tanpa menulis apa pun ke tabel
mana pun. Notifikasi sah yang kita buang tidak boleh lebih sunyi daripada
notifikasi palsu yang kita tolak.

Kolom penghitung bernama `jumlah`, bukan `total`: yang kedua cocok dengan
pola ke-15 money firewall, dan penghitung penyerang bukan tabel uang.
Kenaikannya lewat RPC karena supabase-js upsert tidak bisa menyatakan
jumlah = jumlah + 1 — ia menimpa, dan penghitung yang selalu berkata "1"
adalah penghitung yang tidak ada.

Kedua tabel jejak sengaja TANPA foreign key, mengikuti jejak_status_bayar.
Konsekuensinya ditutup uji yatim berkontrol positif, bukan diserahkan pada
ingatan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

### Task 4: RPC checkout & putusan staf

**Files:**
- Create: `web/supabase/migrations/20260926130000_pesanan_rpc.sql`
- Create: `web/src/lib/pesanan/order-id.ts`
- Create: `web/tests/helpers/klien-kedua.ts` — fixture klien KEDUA ber-akun auth, dipakai tugas
  ini DAN Tugas 9. Ditaruh di `helpers/` supaya tidak digandakan: dua salinan fixture yang
  membuat baris `clients` ber-`padma_id` unik adalah dua salinan yang suatu hari bertabrakan.
- Test: `web/tests/pesanan-checkout-db.test.ts`

**Interfaces:**
- Consumes (T1): `public.order_status`, `public.order_item_source`, `public.order_event`, dan
  `public.perpindahan_pesanan_sah(p_dari public.order_status, p_ke public.order_status) returns boolean`
  — **selalu dibungkus `coalesce(..., false)`**; `not NULL` adalah NULL dan `if NULL then` tidak dieksekusi.
- Consumes (T2): `public.orders` (19 kolom, nol kolom nominal), `public.order_items` (8 kolom),
  indeks unik parsial `pesanan_terbuka_satu_per_klien on public.orders (client_id) where status = 'menunggu_bayar'`,
  constraint `orders_kode_unik`.
- Consumes (T3): `public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)`.
- Consumes (repo, sudah ada): view `public.harga_produk_publik (product_id, harga, harga_coret, berlaku_sejak)`;
  `public.digital_products (id, judul, slug, jenis, aktif)`; `public.clients (id, user_id, padma_id)`;
  `public.user_role() returns app_role`.
- Produces (dipakai T5, T8, T9, T10, T11, T12):
  - `public.buat_pesanan(p_product_id uuid, p_ulang boolean default false) returns table (pesanan_id uuid, kode text, percobaan smallint, nominal_tagih integer, judul text)`
  - `public.catat_token_snap(p_pesanan_id uuid, p_token text) returns void`
  - `public.batalkan_pesanan_saya(p_pesanan_id uuid) returns boolean`
  - `public.punya_pesanan_menunggu(p_product_id uuid) returns boolean`
  - `public.putuskan_pesanan_ditahan(p_pesanan_id uuid, p_putusan text) returns void`
  - `public.tutup_tinjauan(p_pesanan_id uuid) returns void`
  - Gerbang entitlement di `buat_pesanan`: pemanggil yang SUDAH memiliki produknya
    (`digital_entitlements` ber-`dicabut_pada is null`) ditolak `P0001`.
  - `web/src/lib/pesanan/order-id.ts` (kedua pola **tanpa flag `g`**): `POLA_KODE_PESANAN`, `POLA_ORDER_ID`,
    `rakitOrderId(kode: string, percobaan: number): string`,
    `uraiOrderId(orderId: string): { kode: string; percobaan: number } | null`

**Baca dulu (pola rumah yang ditiru — path lengkap):**
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921150000_ambil_produk_gratis.sql`
  — pola PERSIS untuk RPC klien: `security definer set search_path = public`, `client_id` diambil dari
  `auth.uid()` bukan dari payload, harga dibaca dari view yang sama dengan etalase, lalu
  `revoke ... from public, anon` + `grant execute ... to authenticated`.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260909135000_konfirmasi_atomik.sql`
  — pola PERSIS untuk RPC staf: penjaga `user_role() not in ('admin','owner')` **di dalam** fungsi,
  `update ... where status = <syarat>` sebagai kunci baris, dan "keadaan tujuan tidak pernah jadi parameter".
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260828230000_fail_closed_sequence_fungsi.sql`
  baris 171-178 — aturan [F]: setiap fungsi baru menyatakan haknya sendiri.
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-ambil-gratis.test.ts` — bentuk uji RPC lewat
  PostgREST langsung (`signInAs(...).rpc(...)`), termasuk pembersihan `afterEach`.
- `/Users/arvinfairuz/Documents/padma/web/tests/helpers/as-user.ts` dan `web/tests/helpers/db.ts`
  — `signInAs`, `anonClient`, `querySql`.
- `/Users/arvinfairuz/Documents/padma/web/src/lib/tagihan/tenggat.ts` — gaya modul TS murni
  (dokblok berbahasa Indonesia yang menjelaskan KENAPA, bukan APA).

**Batasan yang berlaku di tugas ini:**
- Semua perintah dijalankan dari `/Users/arvinfairuz/Documents/padma/web`.
- Perintah penerapan migrasi di tugas ini adalah **`npx supabase migration up`**, BUKAN
  `npx supabase db reset`: Supabase lokal di mesin ini **dipakai bersama sesi lain**, dan
  `db reset` menghapus data mereka. `db reset` hanya jalur mundur bila riwayat lokal sudah
  menyimpang — koordinasikan dulu. Jangan menjalankan `npm test` penuh selama pengerjaan.
- Jangan menyentuh `tests/money-firewall-struktural.test.ts` dan `tests/struktur-rls.test.ts`
  (entri P1-nya milik **Tugas 2 lalu Tugas 3**, per entri — peta §13), `tests/grant-anon.test.ts`
  (pemilik tunggal **Tugas 5**), maupun `tests/setup-fetch-guard.ts` (nol pemilik).

- [ ] **Step 0: Tulis fixture klien KEDUA (`tests/helpers/klien-kedua.ts`)**

Buat `/Users/arvinfairuz/Documents/padma/web/tests/helpers/klien-kedua.ts`:

```ts
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * KLIEN KEDUA BER-AKUN AUTH — fixture yang dibuat sendiri, bukan seed.
 *
 * ===== KENAPA IA HARUS ADA =====
 * `scripts/seed-users.ts` hanya punya SATU klien ber-akun auth: Ananda. Rina
 * sengaja `user_id: null`, dan admin/owner tidak punya baris `clients` sama
 * sekali. Akibatnya setiap kali rencana P1 ingin menulis "orang lain tidak
 * bisa menyentuh pesanan saya", ia terpaksa memakai `admin@padma.test` — dan
 * gerbang PERTAMA ketiga RPC klien adalah `v_client_id is null -> 42501`,
 * bukan pemeriksaan kepemilikan baris. Yang teruji jadi "akun tanpa rekam
 * klien ditolak", BUKAN "klien B ditolak atas pesanan klien A": klausa
 * `and o.client_id = v_client_id` di `catat_token_snap` dan
 * `batalkan_pesanan_saya` boleh dihapus hari ini tanpa satu pun uji merah.
 *
 * ===== KENAPA BUKAN MENAUTKAN RINA =====
 * Rina adalah bahan uji PENAUTAN, dan seed menegakkan dua syarat sekaligus:
 * barisnya belum bertuan DAN tidak ada akun auth atas alamatnya
 * (`pastikanRinaBelumDiaktifkan`). Menautkannya memerahkan seluruh berkas uji
 * penautan — merah di berkas ORANG LAIN, dengan sebab yang tidak disebut di
 * mana pun. Pelajaran repo yang sudah dibayar sekali pada koordinat mitra:
 * fixture yang dibagi berubah jadi fixture yang saling memerahkan. Buat
 * sendiri, bongkar sendiri.
 *
 * Pola `createUser` + `deleteUser` ini sudah dipakai rumah:
 * tests/link-client.test.ts:49, tests/penautan-undangan.test.ts:106,
 * tests/penautan-kolom-terkunci.test.ts:83.
 */
const svc = createAdminSupabase();

export const EMAIL_KLIEN_KEDUA = "klien-kedua@padma.test";
/** Sandi seragam fixture repo ini — `signInAs()` memakainya untuk semua akun. */
export const KLIEN_KEDUA_ID = "44444444-4444-4444-4444-4444444444c2";
const PADMA_ID_KLIEN_KEDUA = "PAD-2609-9002";

/**
 * Dipanggil di `beforeAll`. Menyapu sisa run sebelumnya lebih dulu:
 * `clients.padma_id` unik, dan akun auth yatim menahan penghapusan barisnya.
 */
export async function siapkanKlienKedua(): Promise<string> {
  await bongkarKlienKedua();

  const { data, error } = await svc.auth.admin.createUser({
    email: EMAIL_KLIEN_KEDUA,
    password: "padma-dev-123",
    email_confirm: true,
  });
  if (error) throw error;

  const { error: eKlien } = await svc.from("clients").insert({
    id: KLIEN_KEDUA_ID,
    padma_id: PADMA_ID_KLIEN_KEDUA,
    nama: "Klien Kedua (uji)",
    email: EMAIL_KLIEN_KEDUA,
    no_hp: "0899-0000-0002",
    phase_id: "prekonsepsi",
    user_id: data.user!.id,
    linked_at: new Date().toISOString(),
  });
  if (eKlien) throw eKlien;

  return KLIEN_KEDUA_ID;
}

/**
 * Dipanggil di `afterAll`. Urutannya MENGIKAT:
 *   entitlement → jejak & notifikasi → orders → clients → akun auth.
 * `digital_entitlements.pesanan_id` dan `orders.client_id` keduanya
 * `on delete restrict`, `jejak_pesanan`/`notifikasi_pesanan` sengaja tanpa FK
 * (jadi tidak ada cascade, dan tests/pesanan-jejak-yatim.test.ts akan merah di
 * berkas orang lain), dan `clients.user_id -> auth.users(id)` tidak punya
 * ON DELETE sama sekali.
 */
export async function bongkarKlienKedua(): Promise<void> {
  await svc.from("digital_entitlements").delete().eq("client_id", KLIEN_KEDUA_ID);

  const { data: pesanan } = await svc
    .from("orders")
    .select("id")
    .eq("client_id", KLIEN_KEDUA_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("orders").delete().eq("client_id", KLIEN_KEDUA_ID);
  await svc.from("clients").delete().eq("id", KLIEN_KEDUA_ID);

  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data?.users ?? []) {
    if (u.email?.toLowerCase() === EMAIL_KLIEN_KEDUA) {
      await svc.auth.admin.deleteUser(u.id);
    }
  }
}
```

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/pesanan-checkout-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import {
  POLA_KODE_PESANAN,
  POLA_ORDER_ID,
  rakitOrderId,
  uraiOrderId,
} from "@/lib/pesanan/order-id";

/**
 * CHECKOUT DIUJI LEWAT POSTGREST LANGSUNG, bukan lewat server action.
 *
 * Alasannya sama dengan yang sudah tertulis di
 * `supabase/migrations/20260921150000_ambil_produk_gratis.sql`: server action
 * bukan satu-satunya jalan menuju RPC ini — PostgREST mengekspos
 * `rpc/buat_pesanan` kepada siapa pun yang login. Uji yang hanya melewati
 * server action membuktikan server action-nya sopan, bukan bahwa pintunya
 * terkunci.
 *
 * Enam kasus di bawah adalah kasus yang MEMBAYAR ongkos berkas ini:
 *   1. dua panggilan paralel melahirkan TEPAT SATU pesanan (indeks unik
 *      parsial `pesanan_terbuka_satu_per_klien`, bukan kunci di TypeScript);
 *   2. harga yang sudah dibekukan TIDAK ikut naik walau harga etalase naik
 *      di antara dua panggilan;
 *   3. pesanan terbuka untuk produk LAIN ditolak dengan kalimat yang bisa
 *      dibaca manusia, bukan 23505 telanjang;
 *   4. klien yang SUDAH memiliki produknya ditolak — jalan "uang masuk tanpa
 *      barang baru keluar" yang tidak muncul di layar siapa pun;
 *   5. KLIEN LAIN (bukan sekadar akun tanpa rekam klien) tidak bisa menyentuh
 *      pesanan orang — satu-satunya uji yang menjaga klausa
 *      `and o.client_id = v_client_id`;
 *   6. setiap `P0001` diadu per KALIMAT, bukan per kode: satu fungsi di sini
 *      melempar P0001 untuk empat sebab berbeda, dan kode telanjang tidak bisa
 *      membedakan satu pun di antaranya.
 */

const KLIEN_EMAIL = "ananda@padma.test";
/** Klien seed yang SUDAH tertaut ke akun auth (scripts/seed-users.ts). */
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

// Klien KEDUA ber-akun auth — lihat dokblok `tests/helpers/klien-kedua.ts`
// (Step 0). Tanpa ia, "orang lain tidak bisa menyentuh pesanan saya" hanya
// bisa ditulis dengan sesi admin, yang menabrak gerbang yang SAMA SEKALI
// BERBEDA.
import {
  EMAIL_KLIEN_KEDUA,
  KLIEN_KEDUA_ID,
  siapkanKlienKedua,
  bongkarKlienKedua,
} from "./helpers/klien-kedua";

type BarisPesanan = {
  pesanan_id: string;
  kode: string;
  percobaan: number;
  nominal_tagih: number;
  judul: string;
};

const svc = createAdminSupabase();
const produkUji: string[] = [];

/** Hari ini menurut BASIS DATA, bukan menurut jam mesin penguji (vitest TZ=UTC). */
async function hariIniJakarta(): Promise<string> {
  const baris = await querySql<{ hari: string }>(
    "select (now() at time zone 'Asia/Jakarta')::date::text as hari",
  );
  return baris[0].hari;
}

async function semaiProduk(
  slug: string,
  harga: number,
  opsi: { aktif?: boolean; berlakuSejak?: string } = {},
): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: opsi.aktif ?? true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc.from("digital_product_prices").insert({
    product_id: data!.id,
    harga,
    // Sengaja LAMPAU: uji "harga beku" menyisipkan baris harga BERTANGGAL HARI
    // INI di tengah jalan, dan `unique (product_id, berlaku_sejak)` menolak dua
    // baris bertanggal sama.
    berlaku_sejak: opsi.berlakuSejak ?? "2026-09-01",
  });
  if (eHarga) throw eHarga;
  return data!.id;
}

/**
 * Pembersihan BERURUTAN, dan urutannya bukan selera (peta §13.2):
 *
 *   digital_entitlements → jejak_pesanan & notifikasi_pesanan → orders
 *   → digital_products
 *
 * `digital_entitlements.pesanan_id` ber-`on delete restrict`, jadi entitlement
 * yang menunjuk pesanan harus lenyap lebih dulu. Yang disemai berkas ini
 * ber-`pesanan_id` null, tapi urutannya ditulis benar sejak awal supaya ia
 * tidak jadi galat yang harus dicari sebabnya begitu Tugas 5 mendarat.
 *
 * `jejak_pesanan` dan `notifikasi_pesanan` sengaja TANPA foreign key (jejak
 * yang ikut lenyap bersama yang diaudit tidak berguna), jadi tidak ada cascade
 * yang menyapunya — `tests/pesanan-jejak-yatim.test.ts` akan merah bila
 * dilewatkan. `orders` dihapus SEBELUM `digital_products` karena
 * `order_items.product_id` menunjuk produk TANPA `on delete cascade`:
 * menghapus produknya lebih dulu gagal dengan 23503.
 */
async function bersihkan(): Promise<void> {
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);

  const { data: pesanan } = await svc
    .from("orders")
    .select("id")
    .eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) {
    await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
  }
}

afterEach(bersihkan);

beforeAll(async () => {
  // Sapu sisa run SEBELUMNYA, bukan hanya bersih-bersih sesudah (peta §13.2).
  // `pesanan_terbuka_satu_per_klien` adalah indeks unik GLOBAL: satu pesanan
  // `menunggu_bayar` yang tertinggal karena `testTimeout` memerahkan
  // penyemaian SETIAP berkas uji P1 pada run berikutnya, dengan 23505 yang
  // tidak menyebut berkas mana yang meninggalkannya.
  await bersihkan();
  await siapkanKlienKedua();
});

afterAll(bongkarKlienKedua);

async function pesananBaru(produkId: string): Promise<BarisPesanan> {
  const klien = await signInAs(KLIEN_EMAIL);
  const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: produkId });
  if (error) throw new Error(`buat_pesanan gagal: ${error.code} ${error.message}`);
  return (data as BarisPesanan[])[0];
}

describe("bentuk kode & order_id — satu bentuk, dua bahasa", () => {
  it("rakitOrderId menyusun kode + percobaan dan MENOLAK percobaan di luar 1..9", () => {
    expect(rakitOrderId("PSN-260926-A1B2C3", 1)).toBe("PSN-260926-A1B2C3.1");
    expect(POLA_ORDER_ID.test(rakitOrderId("PSN-260926-A1B2C3", 9))).toBe(true);
    // Percobaan 10 akan melahirkan order_id yang TIDAK cocok POLA_ORDER_ID,
    // dan webhook menolaknya sebelum satu sha512 pun dihitung: uang masuk,
    // pesanan tidak bergerak. Karena itu ia melempar, bukan memulangkan string.
    expect(() => rakitOrderId("PSN-260926-A1B2C3", 10)).toThrow();
    expect(() => rakitOrderId("psn-260926-a1b2c3", 1)).toThrow();
  });

  it("kedua pola lahir TANPA flag `g` — dua panggilan berturut-turut sama jawabannya", () => {
    // `RegExp.test()` pada regex ber-`g` menyimpan `lastIndex` dan memulangkan
    // false BERGANTIAN. Di rute webhook (Tugas 8) itu berarti setiap notifikasi
    // sah KEDUA dijawab 400 — dan 400 memberi tahu Midtrans "sudah selesai,
    // jangan kirim lagi": pesanan terkunci mati dengan uang yang sudah masuk,
    // tanpa satu pun galat di mana pun. Dua baris identik berturut-turut adalah
    // satu-satunya bentuk yang membedakannya.
    expect(POLA_KODE_PESANAN.flags).not.toContain("g");
    expect(POLA_ORDER_ID.flags).not.toContain("g");
    expect(POLA_ORDER_ID.test("PSN-260926-A1B2C3.1")).toBe(true);
    expect(POLA_ORDER_ID.test("PSN-260926-A1B2C3.1")).toBe(true);
    expect(POLA_KODE_PESANAN.test("PSN-260926-A1B2C3")).toBe(true);
    expect(POLA_KODE_PESANAN.test("PSN-260926-A1B2C3")).toBe(true);
  });

  it("uraiOrderId memulangkan null untuk bentuk asing, bukan tebakan", () => {
    expect(uraiOrderId("PSN-260926-A1B2C3.2")).toEqual({
      kode: "PSN-260926-A1B2C3",
      percobaan: 2,
    });
    expect(uraiOrderId("PSN-260926-A1B2C3")).toBeNull();
    expect(uraiOrderId("PSN-260926-A1B2C3.0")).toBeNull();
    expect(uraiOrderId("PSN-260926-G1B2C3.1")).toBeNull();
    expect(uraiOrderId("../../etc/passwd")).toBeNull();
  });
});

describe("buat_pesanan", () => {
  it("menerbitkan pesanan berkode yang cocok dengan regex TypeScript", async () => {
    const produk = await semaiProduk("checkout-kode", 120_000);
    const baris = await pesananBaru(produk);

    // Bentuk `kode` hidup di SQL; regex-nya hidup di TypeScript. Assertion ini
    // satu-satunya tempat keduanya dipaksa bertemu.
    expect(baris.kode).toMatch(POLA_KODE_PESANAN);
    expect(baris.percobaan).toBe(1);
    expect(baris.nominal_tagih).toBe(120_000);
    expect(baris.judul).toBe("Uji checkout-kode");

    const { data: pesanan } = await svc
      .from("orders")
      .select("status, jumlah_item, ditutup_pada, kedaluwarsa_pada, dibuat_pada")
      .eq("id", baris.pesanan_id)
      .single();
    expect(pesanan!.status).toBe("menunggu_bayar");
    expect(pesanan!.jumlah_item).toBe(1);
    expect(pesanan!.ditutup_pada).toBeNull();
    const jarakJam =
      (Date.parse(pesanan!.kedaluwarsa_pada) - Date.parse(pesanan!.dibuat_pada)) / 3_600_000;
    expect(Math.round(jarakJam)).toBe(24);

    const { data: item } = await svc
      .from("order_items")
      .select("jenis, product_id, judul_beku, harga_beku, urutan, booking_request_id")
      .eq("pesanan_id", baris.pesanan_id)
      .single();
    expect(item!.jenis).toBe("produk_digital");
    expect(item!.product_id).toBe(produk);
    expect(item!.harga_beku).toBe(120_000);
    expect(item!.urutan).toBe(1);
    expect(item!.booking_request_id).toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian, padma_id")
      .eq("pesanan_id", baris.pesanan_id);
    expect((jejak ?? []).map((j) => j.kejadian)).toEqual(["dibuat"]);
    expect(jejak![0].padma_id).toBe("PAD-2607-0012");
  });

  it("DUA panggilan paralel melahirkan TEPAT SATU pesanan", async () => {
    const produk = await semaiProduk("checkout-paralel", 150_000);
    const klien = await signInAs(KLIEN_EMAIL);

    const [a, b] = await Promise.all([
      klien.rpc("buat_pesanan", { p_product_id: produk }),
      klien.rpc("buat_pesanan", { p_product_id: produk }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const idA = (a.data as BarisPesanan[])[0].pesanan_id;
    const idB = (b.data as BarisPesanan[])[0].pesanan_id;
    // Yang kalah menerima 23505 dari `pesanan_terbuka_satu_per_klien`, membaca
    // ulang, dan memulangkan pesanan yang sudah ada — bukan galat, dan bukan
    // pesanan kedua.
    expect(idA).toBe(idB);

    const { data: pesanan } = await svc
      .from("orders")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("status", "menunggu_bayar");
    expect((pesanan ?? []).length).toBe(1);

    const { data: item } = await svc.from("order_items").select("id").eq("pesanan_id", idA);
    expect((item ?? []).length).toBe(1);
  });

  it("harga BEKU: panggilan kedua memulangkan nominal yang sama walau harga etalase naik", async () => {
    const produk = await semaiProduk("checkout-harga-beku", 120_000);
    const pertama = await pesananBaru(produk);
    expect(pertama.nominal_tagih).toBe(120_000);

    const hari = await hariIniJakarta();
    const { error } = await svc
      .from("digital_product_prices")
      .insert({ product_id: produk, harga: 999_000, berlaku_sejak: hari });
    expect(error).toBeNull();

    // KONTROL: harga etalase memang sudah berubah. Tanpa baris ini, uji di
    // bawah bisa hijau hanya karena harganya tidak pernah naik.
    const { data: etalase } = await svc
      .from("harga_produk_publik")
      .select("harga")
      .eq("product_id", produk)
      .single();
    expect(etalase!.harga).toBe(999_000);

    const klien = await signInAs(KLIEN_EMAIL);
    const kedua = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(kedua.error).toBeNull();
    const barisKedua = (kedua.data as BarisPesanan[])[0];
    expect(barisKedua.pesanan_id).toBe(pertama.pesanan_id);
    expect(barisKedua.nominal_tagih).toBe(120_000);

    const { data: item } = await svc
      .from("order_items")
      .select("harga_beku")
      .eq("pesanan_id", pertama.pesanan_id)
      .single();
    expect(item!.harga_beku).toBe(120_000);
  });

  it("pesanan terbuka untuk produk LAIN ditolak dengan kalimat yang bisa dibaca", async () => {
    const produkA = await semaiProduk("checkout-produk-a", 120_000);
    const produkB = await semaiProduk("checkout-produk-b", 90_000);
    const pertama = await pesananBaru(produkA);

    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produkB });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0001");
    expect(error!.message).toContain("Selesaikan dulu pesanan");
    // Kodenya ikut disebut: tanpa itu klien tidak tahu pesanan mana yang harus
    // ia selesaikan atau batalkan.
    expect(error!.message).toContain(pertama.kode);

    const { data: pesanan } = await svc
      .from("orders")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID);
    expect((pesanan ?? []).length).toBe(1);
  });

  it("produk GRATIS tidak lewat checkout — pagar harga nol tetap berdiri", async () => {
    const produk = await semaiProduk("checkout-gratis", 0);
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("P0001");
    expect(error!.message).toContain("gratis");
  });

  it("klien yang SUDAH memiliki produknya ditolak — dan NOL pesanan lahir", async () => {
    // Kelas masukan yang paling mahal di seluruh P1, dan sampai sekarang nol
    // assertion menyentuhnya: uang masuk tanpa barang baru keluar, DAN tanpa
    // satu tanda pun di layar mana pun. Jalurnya: entitlement lama (gratis,
    // beli, atau pemberian admin) -> tombol beli terender karena
    // `punyaProdukDiPeramban` fail-open -> bayar -> settlement -> `lunas` ->
    // `terbitkan_akses_item` keadaan (2) -> jejak `akses_sudah_ada` TANPA
    // penanda tinjauan -> `bacaPesananStaf` justru MENGELUARKAN baris itu dari
    // "Butuh perhatian" karena jejak aksesnya ada.
    //
    // Yang menutupnya harus SQL, bukan TypeScript: rpc/buat_pesanan terbuka
    // bagi setiap pengguna login lewat PostgREST.
    const produk = await semaiProduk("checkout-sudah-punya", 120_000);
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "gratis",
    });
    expect(eEnt).toBeNull();

    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("P0001");
    // Kalimat yang KHAS untuk sebab ini. `toBe("P0001")` telanjang tidak bisa
    // membedakan gerbang ini dari enam raise lain di fungsi yang sama, jadi
    // menghapus salah satunya tidak memerahkan apa pun.
    expect(error!.message).toContain("sudah memiliki produk ini");

    const { data: pesanan } = await svc
      .from("orders")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID);
    expect(pesanan ?? []).toEqual([]);
  });

  it("entitlement yang sudah DICABUT tidak menghalangi pembelian ulang", async () => {
    // Arah kedua, dan tanpa ia gerbang di atas boleh ditulis terlalu lebar:
    // pencabutan adalah keputusan manusia, dan orang yang aksesnya dicabut
    // tetap boleh membeli lagi. Yang tidak boleh adalah pembayarannya
    // MENGHIDUPKAN akses lama diam-diam — itu urusan `terbitkan_akses_item`
    // keadaan (3), diuji di Tugas 5.
    const produk = await semaiProduk("checkout-pernah-dicabut", 120_000);
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "beli",
      dicabut_pada: new Date("2026-09-01T00:00:00Z").toISOString(),
    });
    expect(eEnt).toBeNull();

    const klien = await signInAs(KLIEN_EMAIL);
    const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error).toBeNull();
    expect((data as BarisPesanan[])[0].nominal_tagih).toBe(120_000);
  });

  it("produk yang belum tayang tidak bisa dipesan lewat id yang bocor dari panel", async () => {
    const produk = await semaiProduk("checkout-belum-tayang", 120_000, { aktif: false });
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("P0002");
  });

  it("akun tanpa rekam klien ditolak 42501, bukan dibiarkan memesan", async () => {
    const produk = await semaiProduk("checkout-tanpa-klien", 120_000);
    // Admin seed punya profil, TIDAK punya baris `clients`.
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("42501");
  });

  it("p_ulang menaikkan percobaan pada pesanan yang SAMA dan mengosongkan token lama", async () => {
    const produk = await semaiProduk("checkout-ulang", 120_000);
    const pertama = await pesananBaru(produk);

    const klien = await signInAs(KLIEN_EMAIL);
    const token = await klien.rpc("catat_token_snap", {
      p_pesanan_id: pertama.pesanan_id,
      p_token: "token-snap-lama",
    });
    expect(token.error).toBeNull();

    const kedua = await klien.rpc("buat_pesanan", { p_product_id: produk, p_ulang: true });
    expect(kedua.error).toBeNull();
    const barisKedua = (kedua.data as BarisPesanan[])[0];
    expect(barisKedua.pesanan_id).toBe(pertama.pesanan_id);
    expect(barisKedua.percobaan).toBe(2);
    expect(barisKedua.nominal_tagih).toBe(120_000);

    const { data: pesanan } = await svc
      .from("orders")
      .select("percobaan, snap_token, snap_diterbitkan_pada")
      .eq("id", pertama.pesanan_id)
      .single();
    expect(pesanan!.percobaan).toBe(2);
    // Token percobaan lama tidak boleh tertinggal: order_id-nya sudah terbakar.
    expect(pesanan!.snap_token).toBeNull();
    expect(pesanan!.snap_diterbitkan_pada).toBeNull();

    // order_id percobaan kedua tetap berbentuk sah bagi TypeScript.
    expect(rakitOrderId(barisKedua.kode, barisKedua.percobaan)).toMatch(POLA_ORDER_ID);
  });

  it("percobaan KESEPULUH menutup pesanan lama dan melahirkan yang baru — bukan 23514", async () => {
    const produk = await semaiProduk("checkout-percobaan-habis", 120_000);
    const pertama = await pesananBaru(produk);
    await svc.from("orders").update({ percobaan: 9 }).eq("id", pertama.pesanan_id);

    const klien = await signInAs(KLIEN_EMAIL);
    const kesepuluh = await klien.rpc("buat_pesanan", { p_product_id: produk, p_ulang: true });
    expect(kesepuluh.error).toBeNull();
    const baru = (kesepuluh.data as BarisPesanan[])[0];
    expect(baru.pesanan_id).not.toBe(pertama.pesanan_id);
    expect(baru.percobaan).toBe(1);
    expect(baru.nominal_tagih).toBe(120_000);

    const { data: lama } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", pertama.pesanan_id)
      .single();
    expect(lama!.status).toBe("dibatalkan");
    // CHECK `pesanan_tutup_bercap` menuntutnya; tanpa cap, UPDATE-nya 23514.
    expect(lama!.ditutup_pada).not.toBeNull();
  });
});

describe("catat_token_snap & batalkan_pesanan_saya", () => {
  it("token tercatat pada pesanan milik pemanggil, dan jejak token_terbit lahir", async () => {
    const produk = await semaiProduk("token-milik-sendiri", 120_000);
    const pesanan = await pesananBaru(produk);

    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("catat_token_snap", {
      p_pesanan_id: pesanan.pesanan_id,
      p_token: "snap-token-abc",
    });
    expect(error).toBeNull();

    const { data: baris } = await svc
      .from("orders")
      .select("snap_token, snap_diterbitkan_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.snap_token).toBe("snap-token-abc");
    expect(baris!.snap_diterbitkan_pada).not.toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian")
      .eq("pesanan_id", pesanan.pesanan_id);
    expect((jejak ?? []).map((j) => j.kejadian)).toContain("token_terbit");
  });

  it("akun tanpa rekam klien ditolak 42501 — gerbang IDENTITAS, bukan kepemilikan", async () => {
    // Judulnya sengaja menyebut sebab yang SEBENARNYA diuji. Versi sebelumnya
    // berbunyi "tidak bisa menimpa token pesanan orang", padahal yang ditabrak
    // sesi admin adalah gerbang PERTAMA fungsi ini (`v_client_id is null`),
    // bukan klausa `and o.client_id = v_client_id`. Judul yang menyebut sebab
    // yang salah membuat orang berikutnya mengira kepemilikan baris sudah
    // terjaga — kasus di bawah ini yang benar-benar menjaganya.
    const produk = await semaiProduk("token-tanpa-klien", 120_000);
    const pesanan = await pesananBaru(produk);

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("catat_token_snap", {
      p_pesanan_id: pesanan.pesanan_id,
      p_token: "token-orang-lain",
    });
    expect(error?.code).toBe("42501");
    expect(error!.message).toContain("belum tertaut ke rekam klien");

    const { data: baris } = await svc
      .from("orders")
      .select("snap_token")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.snap_token).toBeNull();
  });

  it("KLIEN LAIN tidak bisa menimpa token pesanan orang — P0002, token utuh", async () => {
    // Inilah uji yang menjaga klausa `and o.client_id = v_client_id`. Tanpa
    // klien kedua ber-akun auth, klausa itu boleh dihapus hari ini dan seluruh
    // suite tetap hijau — karena satu-satunya "orang lain" yang tersedia
    // (admin) menabrak gerbang identitas lebih dulu.
    const produk = await semaiProduk("token-klien-lain", 120_000);
    const pesanan = await pesananBaru(produk);

    const lain = await signInAs(EMAIL_KLIEN_KEDUA);
    const { error } = await lain.rpc("catat_token_snap", {
      p_pesanan_id: pesanan.pesanan_id,
      p_token: "token-klien-lain",
    });
    // P0002, bukan 42501: ia PUNYA rekam klien, hanya bukan pemilik barisnya.
    // Dan pesanan orang lain tidak boleh bisa dibedakan dari pesanan yang
    // tidak ada sama sekali.
    expect(error?.code).toBe("P0002");

    const { data: baris } = await svc
      .from("orders")
      .select("snap_token")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.snap_token).toBeNull();
  });

  it("KLIEN LAIN membatalkan pesanan orang: false, dan pesanannya UTUH", async () => {
    const produk = await semaiProduk("batal-klien-lain", 120_000);
    const pesanan = await pesananBaru(produk);

    const lain = await signInAs(EMAIL_KLIEN_KEDUA);
    const { data, error } = await lain.rpc("batalkan_pesanan_saya", {
      p_pesanan_id: pesanan.pesanan_id,
    });
    // `false`, BUKAN galat: "tidak ada pesanan yang cocok dengan itu milik
    // Anda" adalah jawaban jujur, dan 404 justru memberi tahu pemanggil
    // pesanan siapa yang ada. Jalur inilah yang dipakai rute /batal (Tugas 9),
    // dan tanpa klien kedua ia TIDAK PERNAH dieksekusi satu kali pun.
    expect(error).toBeNull();
    expect(data).toBe(false);

    const { data: baris } = await svc
      .from("orders")
      .select("status")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("menunggu_bayar");
  });

  it("pesanan yang bukan milik pemanggil dijawab P0002, bukan diberi tahu apa sebabnya", async () => {
    // Pesanan milik orang lain dan pesanan yang tidak ada sama sekali harus
    // tidak bisa dibedakan dari luar: keduanya sama-sama bukan urusan
    // pemanggil. Dipakai uuid yang tidak menunjuk apa pun karena seed hanya
    // punya SATU klien tertaut.
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("catat_token_snap", {
      p_pesanan_id: "00000000-0000-0000-0000-0000000000bb",
      p_token: "token-hantu",
    });
    expect(error?.code).toBe("P0002");
  });

  it("pembatalan mandiri berhasil SEKALI, lalu memulangkan false", async () => {
    const produk = await semaiProduk("batal-mandiri", 120_000);
    const pesanan = await pesananBaru(produk);

    const klien = await signInAs(KLIEN_EMAIL);
    const pertama = await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: pesanan.pesanan_id });
    expect(pertama.error).toBeNull();
    expect(pertama.data).toBe(true);

    const kedua = await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: pesanan.pesanan_id });
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe(false);

    const { data: baris } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("dibatalkan");
    expect(baris!.ditutup_pada).not.toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian")
      .eq("pesanan_id", pesanan.pesanan_id);
    // Sekali dibatalkan, sekali dicatat — panggilan kedua tidak menambah jejak.
    expect((jejak ?? []).filter((j) => j.kejadian === "dibatalkan").length).toBe(1);
  });

  it("sesudah dibatalkan, produk yang sama bisa di-checkout lagi", async () => {
    const produk = await semaiProduk("batal-lalu-checkout", 120_000);
    const pesanan = await pesananBaru(produk);
    const klien = await signInAs(KLIEN_EMAIL);
    await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: pesanan.pesanan_id });

    const lagi = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(lagi.error).toBeNull();
    expect((lagi.data as BarisPesanan[])[0].pesanan_id).not.toBe(pesanan.pesanan_id);
  });
});

describe("punya_pesanan_menunggu", () => {
  it("true untuk menunggu_bayar DAN untuk ditahan — uangnya sudah masuk", async () => {
    const produk = await semaiProduk("menunggu-atau-ditahan", 120_000);
    const klien = await signInAs(KLIEN_EMAIL);

    const sebelum = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    expect(sebelum.data).toBe(false);

    const pesanan = await pesananBaru(produk);
    const terbuka = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    expect(terbuka.data).toBe(true);

    await svc
      .from("orders")
      .update({ status: "ditahan", ditutup_pada: new Date().toISOString() })
      .eq("id", pesanan.pesanan_id);
    const ditahan = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    // Menghitung `ditahan` sebagai "tidak ada pesanan" mengembalikan tombol
    // beli kepada orang yang sudah menyetor.
    expect(ditahan.data).toBe(true);

    await svc
      .from("orders")
      .update({ status: "dibatalkan" })
      .eq("id", pesanan.pesanan_id);
    const mati = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    expect(mati.data).toBe(false);
  });
});

describe("putuskan_pesanan_ditahan", () => {
  async function pesananDitahan(produk: string, denganNominal: boolean) {
    const pesanan = await pesananBaru(produk);
    await svc
      .from("orders")
      .update({
        status: "ditahan",
        ditutup_pada: new Date().toISOString(),
        butuh_tinjauan_pada: new Date().toISOString(),
        sebab_tinjauan: "selisih_nominal",
      })
      .eq("id", pesanan.pesanan_id);
    if (denganNominal) {
      const { error } = await svc.from("notifikasi_pesanan").insert({
        pesanan_id: pesanan.pesanan_id,
        sidik: randomUUID(),
        transaksi_id: "trx-uji",
        status_midtrans: "settlement",
        kanal: "bank_transfer",
        nominal_diterima: 100_000,
      });
      if (error) throw error;
    }
    return pesanan;
  }

  it("klien biasa ditolak 42501 — putusan atas uang bukan miliknya", async () => {
    const produk = await semaiProduk("putusan-klien", 120_000);
    const pesanan = await pesananDitahan(produk, true);
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "lunas",
    });
    expect(error?.code).toBe("42501");
  });

  it("putusan di luar lunas/dibatalkan ditolak dengan kalimat, bukan 22P02 telanjang", async () => {
    const produk = await semaiProduk("putusan-asing", 120_000);
    const pesanan = await pesananDitahan(produk, true);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "kedaluwarsa",
    });
    expect(error?.code).toBe("P0001");
    // Kalimat RPC — berbeda dari kalimat RUTE ("Putusan hanya boleh ..."),
    // dan perbedaan itulah yang membuat "dua pagar untuk satu lubang" bisa
    // dibuktikan satu per satu di Tugas 11.
    expect(error!.message).toContain("Putusan harus");
    expect(error!.message).toContain("lunas");
    expect(error!.message).toContain("dibatalkan");
  });

  it("pesanan ditahan TANPA nominal_diterima tercatat ditolak", async () => {
    const produk = await semaiProduk("putusan-tanpa-nominal", 120_000);
    const pesanan = await pesananDitahan(produk, false);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "lunas",
    });
    // Uangnya harus pernah TERCATAT masuk, bukan sekadar diklaim admin.
    expect(error?.code).toBe("P0001");
    // Dan KALIMATNYA diadu, bukan hanya kodenya. `putuskan_pesanan_ditahan`
    // melempar P0001 untuk EMPAT sebab berbeda (putusan asing, perpindahan
    // ditolak mesin status, nominal belum tercatat, baris bukan `ditahan`):
    // `toBe("P0001")` telanjang tidak bisa membedakan satu pun di antaranya,
    // jadi menghapus salah satu pagar tidak memerahkan apa pun. Repo ini sudah
    // memakai pola yang benar di tempat lain ("gratis", "Selesaikan dulu
    // pesanan"); ketidak-konsistenannya yang jadi lubang.
    expect(error!.message).toContain("belum punya catatan nominal");
  });

  it("memindahkan ditahan -> lunas, mencatat pemutusnya, dan TIDAK menyalurkan akses", async () => {
    const produk = await semaiProduk("putusan-lunas", 120_000);
    const pesanan = await pesananDitahan(produk, true);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "lunas",
    });
    expect(error).toBeNull();

    const { data: baris } = await svc
      .from("orders")
      .select("status, lunas_pada, ditutup_pada, butuh_tinjauan_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.lunas_pada).not.toBeNull();
    expect(baris!.ditutup_pada).not.toBeNull();
    // Penandanya SENGAJA tidak ikut dikosongkan: barisnya tetap terlihat di
    // "Butuh perhatian" sampai aksesnya diterbitkan dan tinjauannya ditutup.
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian, keterangan")
      .eq("pesanan_id", pesanan.pesanan_id);
    const lunas = (jejak ?? []).filter((j) => j.kejadian === "lunas");
    expect(lunas.length).toBe(1);
    expect(lunas[0].keterangan).toContain("Admin PADMA");

    // Penyalur ada di MESIN_TERTUTUP dan dipanggil lewat rute "Terbitkan
    // akses" (Tugas 11), bukan dari RPC yang terbuka bagi `authenticated`.
    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk);
    expect(ent ?? []).toEqual([]);
  });

  it("pesanan yang BUKAN ditahan ditolak, dengan kalimatnya sendiri", async () => {
    const produk = await semaiProduk("putusan-bukan-ditahan", 120_000);
    const pesanan = await pesananBaru(produk);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "dibatalkan",
    });
    expect(error?.code).toBe("P0001");
    // Kalimat yang KHAS: ia memisahkan sebab ini dari ketiga P0001 lain di
    // fungsi yang sama, DAN ia yang diadu uji rute /putuskan (Tugas 11) untuk
    // membuktikan pagar RPC-nya benar-benar yang menolak, bukan daftar putih
    // di rutenya.
    expect(error!.message).toContain("tidak sedang ditahan");
  });
});

describe("tutup_tinjauan", () => {
  it("MENOLAK baris ditahan dan menyuruh memakai putusan (kalimatnya diadu)", async () => {
    const produk = await semaiProduk("tinjauan-ditahan", 120_000);
    const pesanan = await pesananBaru(produk);
    await svc
      .from("orders")
      .update({
        status: "ditahan",
        ditutup_pada: new Date().toISOString(),
        butuh_tinjauan_pada: new Date().toISOString(),
        sebab_tinjauan: "selisih_nominal",
      })
      .eq("id", pesanan.pesanan_id);

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("tutup_tinjauan", { p_pesanan_id: pesanan.pesanan_id });
    expect(error?.code).toBe("P0001");
    expect(error!.message).toContain("putuskan");

    const { data: baris } = await svc
      .from("orders")
      .select("butuh_tinjauan_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();
  });

  it("mengosongkan kedua kolom penanda TANPA menyentuh status", async () => {
    const produk = await semaiProduk("tinjauan-lunas", 120_000);
    const pesanan = await pesananBaru(produk);
    await svc
      .from("orders")
      .update({
        status: "lunas",
        ditutup_pada: new Date().toISOString(),
        lunas_pada: new Date().toISOString(),
        butuh_tinjauan_pada: new Date().toISOString(),
        sebab_tinjauan: "akses_tertahan",
      })
      .eq("id", pesanan.pesanan_id);

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("tutup_tinjauan", { p_pesanan_id: pesanan.pesanan_id });
    expect(error).toBeNull();

    const { data: baris } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.butuh_tinjauan_pada).toBeNull();
    expect(baris!.sebab_tinjauan).toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian")
      .eq("pesanan_id", pesanan.pesanan_id);
    expect((jejak ?? []).map((j) => j.kejadian)).toContain("tinjauan_ditutup");
  });

  it("klien biasa ditolak 42501", async () => {
    const produk = await semaiProduk("tinjauan-klien", 120_000);
    const pesanan = await pesananBaru(produk);
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("tutup_tinjauan", { p_pesanan_id: pesanan.pesanan_id });
    expect(error?.code).toBe("42501");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/pesanan-checkout-db.test.ts
```

Kegagalan yang DIHARAPKAN di tahap ini: vitest gagal me-resolve impor —
`Failed to resolve import "@/lib/pesanan/order-id" from "tests/pesanan-checkout-db.test.ts"`.
Seluruh berkas merah karena modulnya belum lahir. Itu memang merah yang benar untuk
langkah ini; merah yang menarik datang di Step 4.

- [ ] **Step 3: Tulis modul bentuk kode (`order-id.ts`)**

Buat `web/src/lib/pesanan/order-id.ts`:

```ts
/**
 * BENTUK `kode` PESANAN DAN `order_id` MIDTRANS.
 *
 * Fungsi murni tanpa impor — dipakai rute server (checkout, webhook, cron)
 * DAN komponen peramban, jadi berkas ini sengaja TIDAK memanggil `server-only`.
 *
 * Kenapa bentuknya hidup di dua bahasa sekaligus, dan kenapa itu bukan
 * duplikasi yang bisa dihapus: `kode` DITERBITKAN oleh SQL (`buat_pesanan`),
 * sementara yang menyaring notifikasi masuk sebelum satu sha512 pun dihitung
 * adalah TypeScript. Dua bentuk yang berselisih berarti webhook menolak
 * notifikasi yang sah — uang masuk, pesanan tidak bergerak, dan tidak ada
 * galat di mana pun. Karena itu `tests/pesanan-checkout-db.test.ts`
 * mencocokkan `kode` HASIL RPC ke regex di bawah, bukan ke salinannya sendiri.
 */

/**
 * `PSN-YYMMDD-XXXXXX`, XXXXXX = enam heksadesimal HURUF BESAR.
 *
 * TANPA flag `g`, dan itu bukan gaya: `RegExp.test()` pada regex ber-`g`
 * menyimpan `lastIndex` dan memulangkan false BERGANTIAN pada pemanggilan
 * berikutnya. Pola ini dipakai rute webhook untuk menyaring `order_id` sebelum
 * satu sha512 pun dihitung, jadi flag `g` di sini berarti setiap notifikasi sah
 * KEDUA dijawab 400 — dan 400 memberi tahu Midtrans "sudah selesai, jangan
 * kirim lagi". Pesanan terkunci mati dengan uang yang sudah masuk, tanpa satu
 * pun galat. Kedua pola di berkas ini punya ujinya sendiri untuk itu.
 */
export const POLA_KODE_PESANAN = /^PSN-\d{6}-[0-9A-F]{6}$/;

/**
 * `kode` + titik + percobaan 1..9 — inilah `order_id` yang dikenal Midtrans.
 *
 * Midtrans menolak `order_id` kembar SELAMANYA; sufiks percobaan itulah jalan
 * keluar ketika token gagal terbit dan order_id-nya sudah terbakar.
 *
 * TANPA flag `g` — lihat dokblok `POLA_KODE_PESANAN`.
 */
export const POLA_ORDER_ID = /^PSN-\d{6}-[0-9A-F]{6}\.[1-9]$/;

/**
 * MELEMPAR, bukan memulangkan string cacat.
 *
 * `percobaan` 10 akan menghasilkan `...A1B2C3.10`, yang TIDAK cocok dengan
 * `POLA_ORDER_ID` — dan rute webhook membuang notifikasi yang bentuknya tidak
 * cocok sebelum menyentuh basis data. Kegagalan yang dilempar di sini
 * berhenti di checkout; kegagalan yang diloloskan berhenti di uang.
 */
export function rakitOrderId(kode: string, percobaan: number): string {
  if (!POLA_KODE_PESANAN.test(kode)) {
    throw new Error(`Kode pesanan tidak berbentuk PSN-YYMMDD-XXXXXX: ${kode}`);
  }
  if (!Number.isInteger(percobaan) || percobaan < 1 || percobaan > 9) {
    throw new Error(`Percobaan pesanan di luar 1..9: ${percobaan}`);
  }
  return `${kode}.${percobaan}`;
}

/**
 * `null` untuk bentuk asing — pemanggilnya yang memutuskan kodenya (400 di
 * webhook). Tebakan "ambil saja bagian sebelum titik" akan menjadikan
 * `../../etc/passwd` sebuah kode pesanan.
 */
export function uraiOrderId(orderId: string): { kode: string; percobaan: number } | null {
  if (!POLA_ORDER_ID.test(orderId)) return null;
  const pisah = orderId.lastIndexOf(".");
  return {
    kode: orderId.slice(0, pisah),
    percobaan: Number(orderId.slice(pisah + 1)),
  };
}
```

- [ ] **Step 4: Jalankan uji lagi — sekarang merahnya yang benar**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/pesanan-checkout-db.test.ts
```

Diharapkan: `describe("bentuk kode & order_id …")` **HIJAU** (dua uji murni), sementara
seluruh uji basis data **MERAH** dengan
`buat_pesanan gagal: PGRST202 Could not find the function public.buat_pesanan(p_product_id) in the schema cache`.
Bila uji murni ikut merah, perbaiki `order-id.ts` sebelum melanjutkan — jangan menumpuk dua
kegagalan yang berbeda sebabnya.

- [ ] **Step 5: Tulis migrasinya**

Buat `web/supabase/migrations/20260926130000_pesanan_rpc.sql`:

```sql
-- ===========================================================================
-- RPC CHECKOUT & PUTUSAN STAF — enam pintu yang memilih barisnya SENDIRI
-- ===========================================================================
-- Arsitektur yang tidak boleh ditafsir ulang: checkout adalah RUTE TIPIS yang
-- memanggil RPC di bawah DENGAN SESI PEMANGGIL — bukan server action, dan
-- tidak pernah service role. RPC-lah yang memilih `client_id` dari
-- `auth.uid()`, membekukan harga, menerbitkan `kode`, dan menolak pesanan
-- terbuka kedua lewat unique parsial.
--
-- KENAPA KEENAMNYA BOLEH TERBUKA BAGI `authenticated`, padahal keempat fungsi
-- mesin di migrasi berikutnya ditutup rapat: fungsi di sini memeriksa SENDIRI
-- siapa pemanggilnya — empat lewat `auth.uid()`, dua lewat `user_role()`.
-- Yang tidak boleh diparameterkan adalah VONIS MIDTRANS, dan tidak satu pun
-- fungsi di berkas ini menerimanya. `tests/fungsi-mesin-tertutup.test.ts`
-- (Tugas 7) memaksa pilihan itu diambil sadar lewat daftar TERBUKA_SADAR.
--
-- Pola hak mengikuti aturan [F]
-- (`20260828230000_fail_closed_sequence_fungsi.sql:171-178`): setiap fungsi
-- menyatakan haknya sendiri, tidak menumpang warisan default ACL.

-- ---------------------------------------------------------------------------
-- buat_pesanan
-- ---------------------------------------------------------------------------
-- Satu-satunya pintu klien MELAHIRKAN pesanan untuk dirinya sendiri, dan ia
-- memilih client_id-nya SENDIRI dari auth.uid() alih-alih memercayai payload:
-- klien yang boleh menyebut client_id adalah klien yang bisa menagih orang
-- lain. Pola ini disalin dari `ambil_produk_gratis`
-- (`20260921150000_ambil_produk_gratis.sql`), termasuk alasan harga dibaca
-- dari `harga_produk_publik` — view yang SAMA dengan yang dipakai etalase,
-- supaya "harga menurut layar" dan "harga menurut basis data" tidak pernah
-- berbeda, termasuk soal tanggal berlaku.
create or replace function public.buat_pesanan(
  p_product_id uuid,
  p_ulang boolean default false
)
returns table (
  pesanan_id uuid,
  kode text,
  percobaan smallint,
  nominal_tagih integer,
  judul text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_padma_id text;
  v_judul text;
  v_harga integer;
  v_pesanan_id uuid;
  v_kode text;
  v_percobaan smallint;
  v_terbuka_id uuid;
  v_terbuka_kode text;
  v_terbuka_percobaan smallint;
  v_produk_terbuka uuid;
  v_kendala text;
  v_sisa integer := 5;
  v_baru boolean := false;
begin
  select c.id, c.padma_id into v_client_id, v_padma_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  -- Produk harus TAYANG dan harganya sudah ditetapkan. Produk yang belum
  -- ditayangkan tidak boleh bisa dipesan lewat id yang bocor dari panel.
  select p.judul, h.harga into v_judul, v_harga
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;
  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;

  -- Pagar harga nol dari sisi yang berlawanan: `ambil_produk_gratis` menolak
  -- yang berbayar, fungsi ini menolak yang gratis. Tanpa baris ini, Snap
  -- menerima tagihan Rp 0 dan menolaknya dengan galat yang tidak menyebut
  -- sebabnya.
  if v_harga = 0 then
    raise exception 'Produk ini gratis — ambil lewat tombol ambil, bukan checkout.'
      using errcode = 'P0001';
  end if;

  -- GERBANG ENTITLEMENT. Klien yang SUDAH memiliki produk ini tidak boleh
  -- membayarnya lagi, dan pemeriksaannya hidup DI SINI karena satu-satunya
  -- penjaga yang ada hari ini hidup di peramban: `punyaProdukDiPeramban`
  -- (src/app/produk/[slug]/tombol-ambil.tsx) menulis
  -- `const { data: baris } = await sb...` dan MEMBUANG `error` sepenuhnya —
  -- setiap kegagalan baca memulangkan `false`, yaitu FAIL-OPEN ke arah tombol
  -- beli. Sementara `rpc/buat_pesanan` terbuka bagi setiap pengguna login lewat
  -- PostgREST, jadi pemeriksaan yang hanya hidup di TypeScript bisa dilewati
  -- dengan satu `curl` (alasan yang sama persis dengan dokblok
  -- `ambil_produk_gratis`).
  --
  -- Bentuk kegagalan tanpa gerbang ini, dan ia sunyi sepenuhnya: pembeli
  -- membayar → settlement → `lunas` → `salurkan_pesanan` →
  -- `terbitkan_akses_item` keadaan (2) → jejak `akses_sudah_ada`, `sumber`
  -- tidak diubah, TANPA `butuh_tinjauan_pada`. Lalu `bacaPesananStaf` justru
  -- MENGELUARKAN baris itu dari blok "Butuh perhatian" karena jejak aksesnya
  -- ada. Uang masuk, nol barang baru keluar, nol tanda di layar staf maupun
  -- layar klien.
  --
  -- Spec diam soal ini, dan diamnya spec bukan izin: keadaan (2) ditulis
  -- dengan asumsi entitlement lamanya `gratis`, bukan `beli` yang dibayar dua
  -- kali. Bila pemilik repo justru ingin pembelian ulang DIIZINKAN (mis.
  -- memperpanjang akses), gerbang ini dicabut DAN keadaan (2)
  -- `terbitkan_akses_item` wajib menyalakan `butuh_tinjauan_pada` — pilih satu,
  -- jangan diam.
  if exists (
    select 1
      from public.digital_entitlements e
     where e.client_id = v_client_id
       and e.product_id = p_product_id
       and e.dicabut_pada is null
  ) then
    raise exception 'Anda sudah memiliki produk ini — buka di Pembelian Saya.'
      using errcode = 'P0001';
  end if;

  -- Pesanan BERUANG untuk produk yang sama menutup checkout ulang. `ditahan`
  -- berarti uangnya sudah masuk dan hanya nominalnya meleset; menjualnya lagi
  -- berarti menagih orang dua kali untuk satu barang. Pemeriksaan yang hanya
  -- hidup di TypeScript adalah pemeriksaan yang bisa dilewati satu `curl` —
  -- alasan yang sama dengan yang tertulis di `ambil_produk_gratis`.
  if exists (
    select 1
      from public.orders o
      join public.order_items i on i.pesanan_id = o.id
     where o.client_id = v_client_id
       and o.status = 'ditahan'
       and i.product_id = p_product_id
  ) then
    raise exception 'Pembayaran Anda untuk produk ini sedang ditinjau staf.'
      using errcode = 'P0001';
  end if;

  -- Pesanan terbuka yang sudah ada. `for update` menyerialkan dua panggilan
  -- `p_ulang` yang datang bersamaan supaya `percobaan` tidak melompat dua.
  select o.id, o.kode, o.percobaan
    into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
    from public.orders o
   where o.client_id = v_client_id and o.status = 'menunggu_bayar'
   for update;

  if v_terbuka_id is not null then
    select i.product_id into v_produk_terbuka
      from public.order_items i
     where i.pesanan_id = v_terbuka_id
     order by i.urutan
     limit 1;

    if v_produk_terbuka is distinct from p_product_id then
      raise exception
        'Selesaikan dulu pesanan % yang masih terbuka, atau batalkan lebih dulu.',
        v_terbuka_kode using errcode = 'P0001';
    end if;

    if not p_ulang then
      -- Panggilan kedua untuk produk yang SAMA memulangkan pesanan yang sama,
      -- berikut harga yang sudah dibekukan. Inilah yang membuat dua checkout
      -- paralel berakhir sebagai satu pesanan tanpa kunci di TypeScript.
      v_pesanan_id := v_terbuka_id;
      v_kode := v_terbuka_kode;
      v_percobaan := v_terbuka_percobaan;
    elsif v_terbuka_percobaan < 9 then
      -- `percobaan` dinaikkan HANYA di sini: saat Snap menolak menerbitkan
      -- token dan order_id-nya sudah terbakar. Bukan setiap kali halaman
      -- dibuka. Token lama ikut dikosongkan supaya tidak ada dua popup hidup.
      update public.orders o
         set percobaan = v_terbuka_percobaan + 1,
             snap_token = null,
             snap_diterbitkan_pada = null
       where o.id = v_terbuka_id
         and o.status = any (array['menunggu_bayar']::public.order_status[])
      returning o.id, o.kode, o.percobaan
        into v_pesanan_id, v_kode, v_percobaan;

      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'dibuat', format('percobaan ke-%s', v_percobaan));
    else
      -- Percobaan KESEPULUH tidak melempar 23514: pesanan lama ditutup dan
      -- pesanan baru lahir di bawah. Batas 1..9 adalah pagar terakhir, bukan
      -- jalur pemulihan.
      if not coalesce(
        public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                       'dibatalkan'::public.order_status), false) then
        raise exception 'Mesin status menolak menutup pesanan %.', v_terbuka_kode
          using errcode = 'P0001';
      end if;

      update public.orders o
         set status = 'dibatalkan',
             ditutup_pada = now()
       where o.id = v_terbuka_id
         and o.status = any (array['menunggu_bayar']::public.order_status[]);

      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_terbuka_id, v_padma_id, 'dibatalkan',
              'percobaan kesepuluh: pesanan lama ditutup, pesanan baru diterbitkan');
    end if;
  end if;

  -- Pesanan baru. Tabrakan `orders_kode_unik` diulang paling banyak lima kali;
  -- enam heksadesimal per tanggal membuat tabrakan kejadian yang tidak akan
  -- pernah dilihat siapa pun, tapi penulis yang tidak menanganinya membuat
  -- checkout gagal dengan 23505 telanjang.
  --
  -- `gen_random_uuid()` bawaan Postgres, BUKAN `gen_random_bytes`: pgcrypto
  -- nol hasil di seluruh migrasi repo ini, dan memasang ekstensi baru di basis
  -- data produksi berisi data klien nyata demi satu sufiks acak tidak sepadan.
  while v_pesanan_id is null and v_sisa > 0 loop
    v_sisa := v_sisa - 1;
    v_kode := 'PSN-'
           || to_char((now() at time zone 'Asia/Jakarta')::date, 'YYMMDD')
           || '-'
           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.orders (kode, client_id, jumlah_item)
      values (v_kode, v_client_id, 1)
      -- Kolom DIKUALIFIKASI: `percobaan` juga nama parameter OUT fungsi ini, dan
      -- RETURNING yang tidak dikualifikasi akan gagal "column reference is
      -- ambiguous" saat pertama kali dipanggil — bukan saat migrasi dijalankan.
      returning orders.id, orders.percobaan into v_pesanan_id, v_percobaan;
      v_baru := true;
    exception when unique_violation then
      -- DUA constraint bisa melahirkan 23505 di sini, dan keduanya menuntut
      -- jawaban yang berbeda. Tanpa `constraint_name`, yang satu akan diobati
      -- dengan obat yang lain.
      get stacked diagnostics v_kendala = constraint_name;
      if v_kendala = 'pesanan_terbuka_satu_per_klien' then
        -- Kalah balapan dengan panggilan paralel: yang menang sudah commit,
        -- jadi barisnya terlihat sekarang. Baca ulang dan pulangkan miliknya.
        select o.id, o.kode, o.percobaan
          into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
          from public.orders o
         where o.client_id = v_client_id and o.status = 'menunggu_bayar';

        select i.product_id into v_produk_terbuka
          from public.order_items i
         where i.pesanan_id = v_terbuka_id
         order by i.urutan
         limit 1;

        if v_produk_terbuka is distinct from p_product_id then
          raise exception
            'Selesaikan dulu pesanan % yang masih terbuka, atau batalkan lebih dulu.',
            v_terbuka_kode using errcode = 'P0001';
        end if;

        v_pesanan_id := v_terbuka_id;
        v_kode := v_terbuka_kode;
        v_percobaan := v_terbuka_percobaan;
      elsif v_kendala <> 'orders_kode_unik' then
        raise;
      end if;
    end;
  end loop;

  if v_pesanan_id is null then
    raise exception 'Gagal menerbitkan kode pesanan sesudah lima percobaan. Coba lagi.'
      using errcode = 'P0001';
  end if;

  if v_baru then
    -- Harga & judul DIBEKUKAN di sini. Nota yang ikut berubah saat harga
    -- berubah bukan nota.
    insert into public.order_items (
      pesanan_id, jenis, product_id, judul_beku, harga_beku, urutan
    ) values (
      v_pesanan_id, 'produk_digital', p_product_id, v_judul, v_harga, 1
    );

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'dibuat', 'checkout produk digital');
  end if;

  -- Nominal dijumlahkan dari `order_items`, bukan dibaca ulang dari etalase:
  -- itulah bedanya "yang kami tagih" dengan "harga hari ini".
  return query
    select v_pesanan_id,
           v_kode,
           v_percobaan,
           (select coalesce(sum(i.harga_beku), 0)::integer
              from public.order_items i
             where i.pesanan_id = v_pesanan_id),
           (select i.judul_beku
              from public.order_items i
             where i.pesanan_id = v_pesanan_id
             order by i.urutan
             limit 1);
end;
$$;

comment on function public.buat_pesanan(uuid, boolean) is
  'Satu-satunya pintu klien melahirkan pesanan untuk dirinya sendiri. '
  'client_id diambil dari auth.uid(), TIDAK dari payload. Harga dibekukan dari '
  'harga_produk_publik — view yang sama dengan etalase. Pesanan terbuka kedua '
  'ditolak unique parsial pesanan_terbuka_satu_per_klien; yang kalah balapan '
  'memulangkan pesanan yang sudah ada bila produknya sama. p_ulang adalah '
  'SATU-SATUNYA yang menaikkan percobaan. Menolak P0001 bila pemanggil SUDAH '
  'memiliki produknya: penjaga yang hanya hidup di peramban adalah penjaga '
  'yang fail-open, dan bentuk kegagalannya uang masuk tanpa barang keluar.';

revoke all on function public.buat_pesanan(uuid, boolean) from public, anon;
grant execute on function public.buat_pesanan(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- catat_token_snap
-- ---------------------------------------------------------------------------
-- Token Snap BUKAN bukti pembayaran dan tidak pernah dipercaya sebagai bukti
-- oleh apa pun; ia hanya alamat popup. Yang dijaga di sini cuma satu: pesanan
-- yang ditulisi harus milik pemanggil, dan harus masih terbuka.
create or replace function public.catat_token_snap(
  p_pesanan_id uuid,
  p_token text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_padma_id text;
  v_kena uuid;
begin
  select c.id, c.padma_id into v_client_id, v_padma_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  update public.orders o
     set snap_token = p_token,
         snap_diterbitkan_pada = now()
   where o.id = p_pesanan_id
     and o.client_id = v_client_id
     and o.status = any (array['menunggu_bayar']::public.order_status[])
  returning o.id into v_kena;

  if v_kena is null then
    -- P0002 ("no data found"), bukan 42501: pemanggil tidak boleh bisa
    -- membedakan "bukan milik saya" dari "sudah tidak terbuka" — keduanya
    -- sama-sama bukan urusannya.
    raise exception 'Pesanan terbuka itu tidak ada pada akun ini.' using errcode = 'P0002';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, 'token_terbit', 'token snap dicatat');
end;
$$;

comment on function public.catat_token_snap(uuid, text) is
  'Mencatat token Snap pada pesanan MILIK PEMANGGIL yang masih menunggu bayar. '
  'Token bukan bukti pembayaran; yang dijaga hanya kepemilikan barisnya.';

revoke all on function public.catat_token_snap(uuid, text) from public, anon;
grant execute on function public.catat_token_snap(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- batalkan_pesanan_saya
-- ---------------------------------------------------------------------------
-- Bukan hiasan: karena satu klien hanya boleh punya SATU pesanan terbuka,
-- tanpa tombol ini orang yang berubah pikiran soal produk harus menunggu 24
-- jam. Yang bisa disalahgunakan pemanggil hanyalah pesanannya sendiri.
create or replace function public.batalkan_pesanan_saya(p_pesanan_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_padma_id text;
  v_kena uuid;
begin
  select c.id, c.padma_id into v_client_id, v_padma_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  if not coalesce(
    public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                   'dibatalkan'::public.order_status), false) then
    raise exception 'Mesin status menolak pembatalan mandiri.' using errcode = 'P0001';
  end if;

  update public.orders o
     set status = 'dibatalkan',
         ditutup_pada = now()
   where o.id = p_pesanan_id
     and o.client_id = v_client_id
     and o.status = any (array['menunggu_bayar']::public.order_status[])
  returning o.id into v_kena;

  -- Tidak mengenai baris mana pun bukan galat: sudah dibatalkan, sudah lunas,
  -- atau bukan miliknya. `false` dibedakan dari galat oleh pemanggilnya.
  if v_kena is null then
    return false;
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, 'dibatalkan', 'dibatalkan sendiri oleh klien');
  return true;
end;
$$;

comment on function public.batalkan_pesanan_saya(uuid) is
  'Pembatalan mandiri pesanan MILIK PEMANGGIL yang masih menunggu bayar. '
  'Memulangkan false (bukan galat) bila tidak mengenai baris mana pun.';

revoke all on function public.batalkan_pesanan_saya(uuid) from public, anon;
grant execute on function public.batalkan_pesanan_saya(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- punya_pesanan_menunggu
-- ---------------------------------------------------------------------------
-- Dipakai layar sebagai penentu "Pembayaran Anda sedang diproses" alih-alih
-- tombol beli. `ditahan` WAJIB ikut: uangnya sudah masuk, hanya nominalnya
-- meleset, dan menghitungnya sebagai "tidak ada pesanan" mengembalikan tombol
-- beli kepada orang yang sudah menyetor.
--
-- `security definer` bukan kemewahan: `order_items` lahir tanpa policy sama
-- sekali, jadi fungsi ber-invoker akan selalu memulangkan false.
create or replace function public.punya_pesanan_menunggu(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.orders o
      join public.order_items i on i.pesanan_id = o.id
      join public.clients c on c.id = o.client_id
     where c.user_id = auth.uid()
       and i.product_id = p_product_id
       and o.status = any (array['menunggu_bayar','ditahan']::public.order_status[])
  );
$$;

comment on function public.punya_pesanan_menunggu(uuid) is
  'Benar bila pemanggil punya pesanan yang belum mati dan belum melahirkan '
  'akses untuk produk ini: menunggu_bayar ATAU ditahan. Urutan layar: '
  'entitlement dulu, lalu fungsi ini, baru tombol beli.';

revoke all on function public.punya_pesanan_menunggu(uuid) from public, anon;
grant execute on function public.punya_pesanan_menunggu(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- putuskan_pesanan_ditahan
-- ---------------------------------------------------------------------------
-- DUA putusan, bukan satu: "putuskan" yang hanya punya satu hasil bukan
-- putusan — admin yang menemukan pembayaran kurang Rp 50.000 harus punya
-- jalan selain "berikan saja".
--
-- Ini TIDAK membantah aturan "vonis Midtrans tidak boleh jadi parameter".
-- Bedanya: yang diputuskan di sini bukan "apa kata Midtrans" melainkan "apa
-- yang kita lakukan terhadap uang yang sudah masuk", dan ia dicatat dengan
-- nama pemutusnya.
--
-- `p_putusan` bertipe TEXT, bukan order_status: enum lewat PostgREST
-- menggagalkan nilai asing dengan 22P02 telanjang, dan yang dituntut di sini
-- adalah galat yang bisa dibaca manusia.
--
-- Fungsi ini SENGAJA tidak memanggil `salurkan_pesanan`: penyalur ada di
-- MESIN_TERTUTUP dan dipanggil lewat rute "Terbitkan akses" (Tugas 11) dengan
-- service role. Pesanan yang baru diputus `lunas` karena itu tetap terlihat di
-- blok "Butuh perhatian" — `lunas` tanpa `akses_terbit` — sampai aksesnya
-- benar-benar diterbitkan. Dua klik sadar, bukan satu klik yang menebak.
create or replace function public.putuskan_pesanan_ditahan(
  p_pesanan_id uuid,
  p_putusan text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_pemutus text;
  v_tujuan public.order_status;
  v_padma_id text;
  v_kena uuid;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh memutuskan pesanan yang ditahan.'
      using errcode = '42501';
  end if;

  if p_putusan not in ('lunas', 'dibatalkan') then
    raise exception 'Putusan harus "lunas" atau "dibatalkan", bukan "%".', p_putusan
      using errcode = 'P0001';
  end if;
  v_tujuan := p_putusan::public.order_status;

  if not coalesce(
    public.perpindahan_pesanan_sah('ditahan'::public.order_status, v_tujuan), false) then
    raise exception 'Mesin status menolak perpindahan ditahan -> %.', p_putusan
      using errcode = 'P0001';
  end if;

  -- Uangnya harus pernah TERCATAT masuk, bukan sekadar diklaim admin.
  if not exists (
    select 1 from public.notifikasi_pesanan n
     where n.pesanan_id = p_pesanan_id and n.nominal_diterima is not null
  ) then
    raise exception
      'Pesanan ini belum punya catatan nominal yang diterima Midtrans; tidak ada yang bisa diputuskan.'
      using errcode = 'P0001';
  end if;

  select p.nama into v_pemutus from public.profiles p where p.id = auth.uid();

  select c.padma_id into v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.id = p_pesanan_id;

  update public.orders o
     set status = v_tujuan,
         lunas_pada = case when v_tujuan = 'lunas' then now() else o.lunas_pada end,
         -- `ditahan` sudah bercap tutup; capnya dipertahankan, bukan ditimpa.
         ditutup_pada = coalesce(o.ditutup_pada, now())
   where o.id = p_pesanan_id
     and o.status = any (array['ditahan']::public.order_status[])
  returning o.id into v_kena;

  if v_kena is null then
    raise exception 'Pesanan itu tidak sedang ditahan.' using errcode = 'P0001';
  end if;

  -- `padma_id` tetap milik KLIEN pesanan (itulah gunanya kolom itu
  -- didenormalisasi: pelanggan kejadian tidak perlu hak baca `clients`).
  -- Identitas PEMUTUS dicatat di keterangan — staf tidak punya padma_id.
  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, v_tujuan::text::public.order_event,
          format('putusan staf: %s — oleh %s', p_putusan, coalesce(v_pemutus, 'staf tanpa nama')));
end;
$$;

comment on function public.putuskan_pesanan_ditahan(uuid, text) is
  'Putusan MANUSIA atas pesanan yang sudah beruang: lunas atau dibatalkan. '
  'Hanya dari status ditahan, hanya bila ada notifikasi ber-nominal_diterima, '
  'dan pemutusnya dicatat di keterangan jejak. TIDAK menyalurkan akses — itu '
  'tugas rute "Terbitkan akses" yang memanggil fungsi mesin dengan service role.';

revoke all on function public.putuskan_pesanan_ditahan(uuid, text) from public, anon;
grant execute on function public.putuskan_pesanan_ditahan(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- tutup_tinjauan
-- ---------------------------------------------------------------------------
-- Mengosongkan penanda tinjauan TANPA menyentuh status — itulah keuntungan
-- membuang nilai enum `ditinjau`.
--
-- Dan justru karena ia tidak menyentuh status, ia MENOLAK baris `ditahan`.
-- Tanpa penolakan itu, satu klik menghasilkan pesanan `ditahan` ber-
-- `butuh_tinjauan_pada is null`: uang pembeli sudah di tangan Midtrans,
-- aksesnya tidak pernah terbit, dan barisnya lolos dari klausa penanda
-- sekaligus dari jaring `lunas`.
create or replace function public.tutup_tinjauan(p_pesanan_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_penutup text;
  v_padma_id text;
  v_status public.order_status;
  v_kena uuid;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh menutup tinjauan.' using errcode = '42501';
  end if;

  select o.status, c.padma_id into v_status, v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.id = p_pesanan_id;
  if v_status is null then
    raise exception 'Pesanan tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_status = 'ditahan' then
    raise exception
      'Pesanan ini ditahan — pakai "putuskan" (lunas atau dibatalkan), bukan "tutup tinjauan".'
      using errcode = 'P0001';
  end if;

  select p.nama into v_penutup from public.profiles p where p.id = auth.uid();

  update public.orders o
     set butuh_tinjauan_pada = null,
         sebab_tinjauan = null
   where o.id = p_pesanan_id
     and o.butuh_tinjauan_pada is not null
     and o.status = any (array['menunggu_bayar','lunas','kedaluwarsa','dibatalkan']::public.order_status[])
  returning o.id into v_kena;

  if v_kena is null then
    raise exception 'Pesanan itu tidak sedang menunggu tinjauan.' using errcode = 'P0001';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, 'tinjauan_ditutup',
          format('ditutup oleh %s', coalesce(v_penutup, 'staf tanpa nama')));
end;
$$;

comment on function public.tutup_tinjauan(uuid) is
  'Mengosongkan butuh_tinjauan_pada + sebab_tinjauan tanpa menyentuh status. '
  'MENOLAK baris ditahan: yang ditahan diputuskan, bukan ditutup tinjauannya.';

revoke all on function public.tutup_tinjauan(uuid) from public, anon;
grant execute on function public.tutup_tinjauan(uuid) to authenticated;
```

- [ ] **Step 6: Terapkan migrasi & jalankan uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx supabase migration up && npx vitest run tests/pesanan-checkout-db.test.ts
```

Diharapkan: seluruh berkas HIJAU. Bila `migration up` menolak karena riwayat lokal menyimpang,
barulah `npx supabase db reset` — **koordinasikan dulu, Supabase lokal dipakai bersama sesi lain.**
Bila migrasi ini sendiri yang gagal,
baca nomor galatnya sebelum menyunting apa pun — `42P13` berarti tanda tangan `returns table`
berselisih dengan `return query`, dan `42702` (ambiguous column) berarti ada kolom yang belum
diberi alias di badan fungsi.

- [ ] **Step 7: Jalankan dua uji tetangga yang paling mungkin terbawa**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/pesanan-jejak-yatim.test.ts tests/hak-default-sequence-fungsi.test.ts
```

Keduanya HIJAU. Yang pertama membuktikan pembersihan `afterEach` berkas uji baru tidak
meninggalkan jejak yatim; yang kedua membuktikan keenam fungsi baru lahir tertutup untuk `anon`
(sapuan "tidak ada fungsi/prosedur public yang bisa dieksekusi anon").

- [ ] **Step 8: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20260926130000_pesanan_rpc.sql \
        web/src/lib/pesanan/order-id.ts \
        web/tests/helpers/klien-kedua.ts \
        web/tests/pesanan-checkout-db.test.ts
git commit -m "$(cat <<'PESAN'
feat(pesanan): RPC checkout & putusan staf

Enam pintu yang memilih barisnya sendiri: buat_pesanan, catat_token_snap,
batalkan_pesanan_saya, punya_pesanan_menunggu, putuskan_pesanan_ditahan,
tutup_tinjauan. Keempat yang pertama memilih client_id dari auth.uid(); dua
yang terakhir bergerbang user_role(). Vonis Midtrans tidak menjadi parameter
di satu pun dari mereka.

Dua panggilan checkout paralel melahirkan tepat satu pesanan — yang kalah
menerima 23505 dari pesanan_terbuka_satu_per_klien, membaca ulang, dan
memulangkan pesanan yang sudah ada bila produknya sama. Harga dibekukan dari
harga_produk_publik, view yang sama dengan etalase.

buat_pesanan juga menolak klien yang SUDAH memiliki produknya. Penjaga
"sudah punya" satu-satunya hari ini hidup di peramban dan membuang error-nya
— fail-open ke arah tombol beli — sementara rpc/buat_pesanan terbuka bagi
setiap pengguna login lewat PostgREST. Tanpa gerbang ini bentuk kegagalannya
sunyi sepenuhnya: uang masuk, akses lama dicatat "sudah ada", dan jejak itu
justru MENGELUARKAN barisnya dari blok "Butuh perhatian".

src/lib/pesanan/order-id.ts memegang bentuk kode & order_id di sisi
TypeScript, keduanya TANPA flag `g`: RegExp.test() pada regex ber-g
memulangkan false bergantian, dan di webhook itu berarti notifikasi sah
KEDUA dijawab 400. Ujinya mencocokkan kode HASIL RPC ke regex itu, bukan ke
salinannya sendiri.

Otorisasi lintas-KLIEN diuji dengan klien kedua yang dibuat berkas ujinya
sendiri, bukan dengan admin: gerbang pertama ketiga RPC klien adalah
"akun tanpa rekam klien", jadi sesi admin menabrak pagar yang sama sekali
berbeda dan klausa and o.client_id = v_client_id tidak terjaga apa pun.
Rina sengaja TIDAK dipakai — seed menegakkan ia belum punya akun auth.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

---

### Task 5: RPC webhook, penyaluran akses, view staf

**Files:**
- Create: `web/supabase/migrations/20260926140000_pesanan_webhook_rpc.sql`
- Modify: `web/tests/grant-anon.test.ts` — **tugas ini PEMILIK TUNGGALNYA** (peta §13).
  Keenam nama P1 ditambahkan sekali jalan di Step 5. T2 dan T3 sengaja tidak menyentuhnya.
- Test: `web/tests/pesanan-akses-tiga-keadaan.test.ts`
- **JANGAN** menyentuh `web/tests/money-firewall-struktural.test.ts` maupun
  `web/tests/struktur-rls.test.ts`: entri P1 keduanya milik Tugas 2 lalu Tugas 3, dan keduanya
  sudah mendarat.

**Interfaces:**
- Consumes (T1): ketiga enum + `public.perpindahan_pesanan_sah(p_dari public.order_status, p_ke public.order_status) returns boolean`
  — **selalu `coalesce(..., false)`**.
- Consumes (T2): `public.orders` (seluruh 19 kolom), `public.order_items` (seluruh 8 kolom),
  trigger `item_pesanan_beku` (karena itu tidak satu pun fungsi di sini meng-UPDATE `order_items`).
- Consumes (T3): `public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)`,
  `public.notifikasi_pesanan (pesanan_id, sidik, transaksi_id, status_midtrans, kanal, nominal_diterima)`
  berikut constraint `notifikasi_pesanan_sidik_unik`, dan indeks `jejak_pesanan_lunas_sekali`.
- Consumes (T4): bentuk `kode`/`order_id` §0.9 — `p_order_id` diurai dengan regex yang sama.
- Consumes (repo): `public.digital_entitlements (client_id, product_id, sumber, dicabut_pada)`
  berikut `unique (client_id, product_id)` (`20260921120000_produk_entitlement.sql:24`);
  `public.clients (id, padma_id)`; `public.user_role()`.
- Produces (ke pagar rumah): keenam objek P1 masuk `TABEL_TERTUTUP_ANON` — `orders`,
  `order_items`, `jejak_pesanan`, `notifikasi_pesanan`, `notifikasi_ditolak_harian`, dan
  `pesanan_item_staf`. Yang terakhir itu alasan daftarnya baru bisa dilengkapi di sini.
- Produces (dipakai T8, T10, T11, T12):
  - `public.terapkan_notifikasi_midtrans(p_order_id text, p_transaction_status text, p_fraud_status text, p_transaction_id text, p_payment_type text, p_gross_amount numeric, p_sidik text, p_sumber text default 'webhook') returns text`
    — nilainya dari himpunan tertutup `'diterapkan' | 'duplikat' | 'tanpa_efek' | 'pesanan_tidak_ada'`
  - `public.salurkan_pesanan(p_pesanan_id uuid) returns void`
  - `public.terbitkan_akses_item(p_item_id uuid) returns text`
    — `'akses_terbit' | 'akses_sudah_ada' | 'akses_tertahan'`
  - `public.pesanan_item_staf (pesanan_id, kode, jenis, judul_beku, harga_beku, urutan)`
  - kolom `public.digital_entitlements.pesanan_id uuid null references public.orders(id) on delete restrict`
    — **lihat "Penyimpangan dari peta" di bawah: kolom ini dipindahkan dari migrasi 6 ke migrasi 5.**

**KENAPA `digital_entitlements.pesanan_id` LAHIR DI MIGRASI 5, BUKAN 6:**
Peta versi awal menempatkannya di Tugas 6; keberatan ini DITERIMA dan peta sudah diperbarui —
kolom itu kini lahir di migrasi 5 di peta maupun di sini. Catatan ini ditinggalkan sebagai
alasannya, bukan sebagai penyimpangan yang masih berdiri. Menaruhnya di Tugas 6 berarti Step "jalankan uji, pastikan LULUS" pada tugas ini
MUSTAHIL dipenuhi — `terbitkan_akses_item` akan gagal `42703 column "pesanan_id" does not exist` pada
panggilan pertamanya, dan ketiga keadaannya merah. Karena itu **satu baris `alter table` dipindahkan
ke migrasi 5**. Tugas 6 tetap memegang seluruh sisanya (pencabutan hak, penyempitan policy, uji
rekonsiliasi). Alternatif yang ditolak: menulis ulang `terbitkan_akses_item` dengan
`create or replace` di migrasi 6 — delapan puluh baris jantung mesin dalam dua salinan.

**Baca dulu (pola rumah yang ditiru — path lengkap):**
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921150000_ambil_produk_gratis.sql`
  baris 49-52 — preseden `on conflict do nothing` (BUKAN `do update`): pengambilan ulang tidak
  menghidupkan entitlement yang sudah dicabut. Keadaan (3) di bawah adalah kelanjutan langsung
  keputusan itu.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260829160000_jejak_status_bayar.sql`
  — pola fungsi `security definer` yang mengisi tabel jejak yang `authenticated` tidak boleh tulis.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921110000_produk_harga.sql`
  baris 100-121 — pola view staf: `with (security_invoker = off)`, predikat `user_role()` DI DALAM
  badan view, lalu `revoke all ... from public, anon, authenticated` + `grant select to authenticated`.
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260912130000_tenggat_dan_skrining.sql`
  baris 84-112 — preseden fungsi yang ditutup dari SELURUH peran API (`revoke ... from public, anon,
  authenticated`) tetapi tetap dipanggil server dengan service role
  (`src/app/api/cron/tenggat/route.ts:31`). Itulah bentuk hak ketiga fungsi mesin di sini.
- `/Users/arvinfairuz/Documents/padma/web/tests/produk-entitlement-db.test.ts` — bentuk uji
  entitlement dengan service role + `signInAs`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/pesanan-akses-tiga-keadaan.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { rakitOrderId } from "@/lib/pesanan/order-id";

/**
 * JANTUNG MESIN, DIUJI DI TEMPAT IA BERDIRI.
 *
 * Dua describe, dan keduanya sengaja ada di satu berkas:
 *
 *  1. KETIGA KEADAAN `terbitkan_akses_item`. Yang ketiga — entitlement yang
 *     sudah DICABUT lalu produknya dibayar — adalah keadaan yang paling mudah
 *     hilang dan paling mahal: tanpa keadaan (3), orang itu membayar dan tidak
 *     mendapat apa-apa DIAM-DIAM, pesanannya `lunas` tanpa `akses_terbit`, dan
 *     satu-satunya tombol yang relevan menulis "sudah ada" lagi selamanya.
 *
 *  2. CABANG-CABANG `terapkan_notifikasi_midtrans` yang TIDAK bisa dijangkau
 *     dari uji rute (Tugas 8) dengan ongkos wajar: `p_sumber = 'status_api'`,
 *     notifikasi pada pesanan yang sudah tertutup, dan nominal yang meleset.
 *     Uji rute membuktikan kode HTTP-nya; yang di sini membuktikan barisnya.
 *
 * Ditambah LIMA kelas masukan yang sebelumnya nol assertion, dan semuanya
 * jalan "uang masuk tanpa barang keluar":
 *   - seluruh cabang `capture` + `fraud_status` (yaitu SETIAP pembayaran
 *     kartu kredit), berikut `deny`;
 *   - klaim inti Lapis 0 "rollback melepas sidiknya" — dibuktikan dengan
 *     memicu 23505 sungguhan lewat `jejak_pesanan_lunas_sekali`, bukan dengan
 *     mem-mock RPC-nya;
 *   - notifikasi yang datang untuk `percobaan` LAMA (VA lama yang baru
 *     dibayar besoknya);
 *   - pengikat TIGA salinan bentuk `kode` (penerbit SQL, regex TS, regex di
 *     dalam RPC) dalam satu kasus, tanpa melahirkan salinan keempat;
 *   - verifikasi `count(*)` vs `jumlah_item`, dan `chargeback`.
 *
 * Tidak satu pun uji di berkas ini menyentuh jaringan: fungsi yang diuji
 * adalah fungsi BASIS DATA, dan Status API Midtrans tidak pernah dipanggil
 * dari sini. Karena itu berkas ini tidak perlu (dan tidak boleh) menyunting
 * `tests/setup-fetch-guard.ts`.
 */

const KLIEN_EMAIL = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

const svc = createAdminSupabase();
const produkUji: string[] = [];
let nomorKode = 0;

function kodeUji(): string {
  nomorKode += 1;
  return `PSN-260926-${nomorKode.toString().padStart(6, "0")}`;
}

function sidikUji(): string {
  return randomUUID();
}

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc
    .from("digital_product_prices")
    .insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  if (eHarga) throw eHarga;
  return data!.id;
}

type Pesanan = { pesananId: string; kode: string; itemId: string; orderId: string };

/**
 * Pesanan disemai LANGSUNG dengan service role, bukan lewat `buat_pesanan`.
 *
 * Bukan karena RPC itu tidak dipercaya, melainkan karena berkas ini butuh
 * pesanan berstatus `kedaluwarsa` dan `lunas` — keadaan yang `buat_pesanan`
 * memang tidak bisa melahirkan, dan yang menjadi inti dua kasus di bawah.
 * CHECK berpasangan `pesanan_tutup_bercap`/`pesanan_terbuka_tanpa_cap`
 * menuntut `ditutup_pada` terisi untuk setiap status selain `menunggu_bayar`;
 * fixture yang lupa mengisinya gagal 23514, bukan lolos diam-diam.
 */
async function semaiPesanan(opsi: {
  produkId: string;
  harga: number;
  status?: string;
  judul?: string;
}): Promise<Pesanan> {
  const status = opsi.status ?? "menunggu_bayar";
  const { data, error } = await svc
    .from("orders")
    .insert({
      kode: kodeUji(),
      client_id: ANANDA_CLIENT_ID,
      jumlah_item: 1,
      status,
      ditutup_pada: status === "menunggu_bayar" ? null : new Date().toISOString(),
      lunas_pada: status === "lunas" ? new Date().toISOString() : null,
    })
    .select("id, kode, percobaan")
    .single();
  if (error) throw error;

  const { data: item, error: eItem } = await svc
    .from("order_items")
    .insert({
      pesanan_id: data!.id,
      jenis: "produk_digital",
      product_id: opsi.produkId,
      judul_beku: opsi.judul ?? "Uji produk digital",
      harga_beku: opsi.harga,
      urutan: 1,
    })
    .select("id")
    .single();
  if (eItem) throw eItem;

  return {
    pesananId: data!.id,
    kode: data!.kode,
    itemId: item!.id,
    orderId: rakitOrderId(data!.kode, data!.percobaan),
  };
}

/**
 * Urutan pembersihan MENGIKAT:
 *   jejak & notifikasi (tanpa FK) → entitlement (pesanan_id restrict)
 *   → orders (cascade ke order_items) → digital_products
 *
 * `digital_entitlements.pesanan_id` adalah `on delete restrict`: menghapus
 * pesanan lebih dulu gagal 23503. Itu konsekuensi yang dicatat di spec, bukan
 * galat yang perlu dicari sebabnya.
 */
async function bersihkan(): Promise<void> {
  const { data: pesanan } = await svc
    .from("orders")
    .select("id")
    .eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) {
    await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
  }
}

afterEach(bersihkan);

async function kejadian(pesananId: string): Promise<string[]> {
  const { data } = await svc
    .from("jejak_pesanan")
    .select("kejadian")
    .eq("pesanan_id", pesananId);
  return (data ?? []).map((j) => j.kejadian as string);
}

describe("terbitkan_akses_item — tiga keadaan, semuanya harfiah", () => {
  it("(1) BELUM ADA barisnya: entitlement lahir sumber='beli' dan menunjuk pesanannya", async () => {
    const produk = await semaiProduk("akses-belum-ada", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "lunas" });

    const { data, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: p.itemId });
    expect(error).toBeNull();
    expect(data).toBe("akses_terbit");

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, dicabut_pada, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.sumber).toBe("beli");
    expect(ent!.dicabut_pada).toBeNull();
    // Tanpa kolom ini, invarian rekonsiliasi tidak punya kunci pasangan sama
    // sekali — dan "pesanan mana yang membayari akses ini" tak terjawab.
    expect(ent!.pesanan_id).toBe(p.pesananId);

    expect(await kejadian(p.pesananId)).toEqual(["akses_terbit"]);
  });

  it("(2) SUDAH ADA & belum dicabut: sumber TIDAK diubah, pesanan_id diisi bila kosong", async () => {
    const produk = await semaiProduk("akses-sudah-ada", 120_000);
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "gratis",
    });
    expect(eEnt).toBeNull();

    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "lunas" });
    const { data, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: p.itemId });
    expect(error).toBeNull();
    expect(data).toBe("akses_sudah_ada");

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    // Yang mencatat pendapatan adalah `orders`, bukan kolom `sumber`.
    // Menaikkan 'gratis' menjadi 'beli' akan menulis ulang sejarah yang benar.
    expect(ent!.sumber).toBe("gratis");
    expect(ent!.pesanan_id).toBe(p.pesananId);

    expect(await kejadian(p.pesananId)).toEqual(["akses_sudah_ada"]);
  });

  it("(3) SUDAH ADA & DICABUT: akses TIDAK dihidupkan, dan tinjauan MENYALA", async () => {
    const produk = await semaiProduk("akses-tercabut", 120_000);
    const dicabut = new Date("2026-09-20T03:00:00Z").toISOString();
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "beli",
      dicabut_pada: dicabut,
    });
    expect(eEnt).toBeNull();

    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "lunas" });
    const { data, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: p.itemId });
    expect(error).toBeNull();
    expect(data).toBe("akses_tertahan");

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    // Pencabutan adalah keputusan MANUSIA; pembayaran tidak boleh
    // membatalkannya diam-diam.
    expect(ent!.dicabut_pada).toBe(dicabut);

    const { data: pesanan } = await svc
      .from("orders")
      .select("butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.pesananId)
      .single();
    // Tapi "uang masuk, barang tidak keluar" juga tidak boleh ikut diam.
    expect(pesanan!.butuh_tinjauan_pada).not.toBeNull();
    expect(pesanan!.sebab_tinjauan).toBe("akses_tertahan");

    expect(await kejadian(p.pesananId)).toEqual(["akses_tertahan"]);
  });

  it("item yang tidak ada ditolak, bukan dianggap sudah tersalur", async () => {
    const { error } = await svc.rpc("terbitkan_akses_item", {
      p_item_id: "00000000-0000-0000-0000-0000000000aa",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0002");
  });
});

describe("terapkan_notifikasi_midtrans — jantung mesin", () => {
  it("settlement bernominal cocok: LUNAS dan aksesnya terbit di transaksi yang sama", async () => {
    const produk = await semaiProduk("mesin-lunas", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-lunas-1",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, lunas_pada, ditutup_pada, kanal, transaksi_id, status_midtrans, notifikasi_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.lunas_pada).not.toBeNull();
    expect(baris!.ditutup_pada).not.toBeNull();
    expect(baris!.kanal).toBe("bank_transfer");
    expect(baris!.transaksi_id).toBe("trx-lunas-1");
    expect(baris!.status_midtrans).toBe("settlement");
    expect(baris!.notifikasi_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.sumber).toBe("beli");
    expect(ent!.pesanan_id).toBe(p.pesananId);

    const jejak = await kejadian(p.pesananId);
    expect(jejak).toEqual(expect.arrayContaining(["notifikasi", "lunas", "akses_terbit"]));
    // Janji tunggal ke proyek WhatsApp: jejak 'lunas' lahir TEPAT SEKALI.
    expect(jejak.filter((k) => k === "lunas").length).toBe(1);
  });

  it("sidik yang SAMA dua kali: yang kedua 'duplikat', tanpa baris notifikasi kedua", async () => {
    const produk = await semaiProduk("mesin-duplikat", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    const sidik = sidikUji();
    const muatan = {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-dup",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidik,
    };

    const pertama = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(pertama.data).toBe("diterapkan");
    const kedua = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe("duplikat");

    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("id")
      .eq("pesanan_id", p.pesananId);
    expect((notif ?? []).length).toBe(1);

    const jejak = await kejadian(p.pesananId);
    expect(jejak.filter((k) => k === "lunas").length).toBe(1);
  });

  it("pending lalu settlement (sidik BERBEDA): keduanya diproses", async () => {
    const produk = await semaiProduk("mesin-pending-settle", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const pending = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-a",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(pending.data).toBe("tanpa_efek");

    const { data: masihTerbuka } = await svc
      .from("orders")
      .select("status")
      .eq("id", p.pesananId)
      .single();
    expect(masihTerbuka!.status).toBe("menunggu_bayar");

    const settle = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-a",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    // Sidik sepesanan akan mengunci baris ini di 'pending' SELAMANYA. Inilah
    // uji yang membuat pilihan sidik berbutir-notifikasi tidak bisa diubah
    // diam-diam.
    expect(settle.data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("lunas");
  });

  it("nominal MELESET: pesanan DITAHAN, dan nominal yang diterima tetap disimpan", async () => {
    const produk = await semaiProduk("mesin-selisih", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-kurang",
      p_payment_type: "bank_transfer",
      p_gross_amount: 70000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, ditutup_pada, butuh_tinjauan_pada, sebab_tinjauan, lunas_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("ditahan");
    expect(baris!.ditutup_pada).not.toBeNull();
    expect(baris!.lunas_pada).toBeNull();
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();
    expect(baris!.sebab_tinjauan).toBe("selisih_nominal");

    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("nominal_diterima")
      .eq("pesanan_id", p.pesananId)
      .single();
    // Untuk baris `ditahan` inilah satu-satunya tempat angka yang BENAR-BENAR
    // diterima tersimpan; tanpa kolom ini staf harus membuka dashboard
    // Midtrans untuk tahu selisihnya.
    expect(Number(notif!.nominal_diterima)).toBe(70000);

    const jejak = await kejadian(p.pesananId);
    expect(jejak).toEqual(expect.arrayContaining(["ditahan", "selisih_nominal"]));

    // Akses TIDAK terbit: yang ditahan belum diputuskan siapa pun.
    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk);
    expect(ent ?? []).toEqual([]);
  });

  it("settlement pada pesanan yang sudah KEDALUWARSA: status tetap, tinjauan menyala", async () => {
    const produk = await semaiProduk("mesin-setelah-tutup", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "kedaluwarsa" });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-telat",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("tanpa_efek");

    const { data: baris } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("kedaluwarsa");
    // Tanpa penanda ini, barisnya tidak muncul di blok mana pun di
    // /admin/pesanan meski uangnya sudah masuk.
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();
    expect(baris!.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(await kejadian(p.pesananId)).toEqual(
      expect.arrayContaining(["notifikasi", "lunas_setelah_tutup"]),
    );
  });

  it("expire memindahkan pesanan ke kedaluwarsa; expire kedua tanpa efek", async () => {
    const produk = await semaiProduk("mesin-expire", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const pertama = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "expire",
      p_fraud_status: "",
      p_transaction_id: "",
      p_payment_type: "",
      p_gross_amount: 0,
      p_sidik: sidikUji(),
    });
    expect(pertama.data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("kedaluwarsa");
    expect(baris!.ditutup_pada).not.toBeNull();

    const kedua = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "expire",
      p_fraud_status: "",
      p_transaction_id: "",
      p_payment_type: "",
      p_gross_amount: 0,
      p_sidik: sidikUji(),
    });
    // Keadaan akhir sudah tercapai — dan cabang yang tidak mengenai baris
    // tidak boleh berubah jadi 500 abadi sepanjang jendela retry Midtrans.
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe("tanpa_efek");
  });

  it("refund: status tetap lunas, akses TIDAK dicabut, tapi manusia dipanggil", async () => {
    const produk = await semaiProduk("mesin-refund", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-refund",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "refund",
      p_fraud_status: "",
      p_transaction_id: "trx-refund",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", p.pesananId)
      .single();
    // Repo ini tidak punya mekanisme pengembalian uang di mana pun; status
    // yang tidak punya kebijakan adalah keadaan mati.
    expect(baris!.status).toBe("lunas");
    expect(baris!.sebab_tinjauan).toBe("refund");
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.dicabut_pada).toBeNull();
    expect(await kejadian(p.pesananId)).toEqual(expect.arrayContaining(["selisih_status"]));
  });

  it("capture + fraud_status='accept': LUNAS dan aksesnya terbit", async () => {
    // KARTU KREDIT. Permintaan klien yang melahirkan P1 berbunyi "pilihan
    // lebih luas ga hanya qris aja", dan kartu adalah SATU-SATUNYA metode yang
    // mengirim `capture` + `fraud_status`. Sampai kasus ini lahir, seluruh
    // cabang itu nol assertion — settlement, expire, refund, duplikat, dan
    // urutan terbalik semuanya diuji, dan jalur kartu tidak satu pun.
    const produk = await semaiProduk("mesin-capture-accept", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "capture",
      p_fraud_status: "accept",
      p_transaction_id: "trx-capture-accept",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("lunas");
    expect(await kejadian(p.pesananId)).toEqual(expect.arrayContaining(["lunas", "akses_terbit"]));
  });

  it("capture TANPA fraud_status dibaca 'accept' — default coalesce dikunci", async () => {
    // `coalesce(nullif(p_fraud_status,''),'accept')` adalah satu baris yang
    // bisa dibalik ke 'challenge' oleh siapa pun yang mengira itu lebih aman.
    // Dua arah gagalnya sama-sama mahal: dibalik -> SETIAP pembayaran kartu
    // mendarat di `ditahan` dan menuntut putusan manusia satu per satu,
    // sementara `punya_pesanan_menunggu` menahan tombol belinya. Kasus ini
    // yang membuat pembalikan itu merah.
    const produk = await semaiProduk("mesin-capture-kosong", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "capture",
      p_fraud_status: "",
      p_transaction_id: "trx-capture-kosong",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("lunas");
  });

  it("capture + fraud_status='challenge': DITAHAN, nol entitlement", async () => {
    // Arah sebaliknya, dan ini yang paling mahal: uangnya masih DITAHAN
    // Midtrans dan bisa dibalikkan. Memperlakukannya `accept` berarti barang
    // keluar atas uang yang belum benar-benar masuk.
    const produk = await semaiProduk("mesin-capture-challenge", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "capture",
      p_fraud_status: "challenge",
      p_transaction_id: "trx-capture-challenge",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("ditahan");
    expect(baris!.sebab_tinjauan).toBe("selisih_status");
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk);
    expect(ent ?? []).toEqual([]);
  });

  it("deny: pesanan DIBATALKAN, bukan dibiarkan menggantung", async () => {
    const produk = await semaiProduk("mesin-deny", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "deny",
      p_fraud_status: "deny",
      p_transaction_id: "trx-deny",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status, ditutup_pada").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("dibatalkan");
    expect(baris!.ditutup_pada).not.toBeNull();
  });

  it("ROLLBACK MELEPAS SIDIKNYA — dan retry sesudahnya benar-benar menyembuhkan", async () => {
    // KLAIM INTI LAPIS 0, dan sampai kasus ini lahir ia nol assertion.
    // Satu-satunya uji kelas 500 di seluruh rencana (Tugas 8, "galat basis
    // data -> 500") mem-MOCK `createAdminSupabase().rpc`, sehingga RPC-nya
    // TIDAK PERNAH dijalankan: tidak ada transaksi, tidak ada sidik, tidak ada
    // rollback untuk dibuktikan.
    //
    // Pemicunya murah dan nyata: `jejak_pesanan_lunas_sekali` adalah indeks
    // unik PARSIAL, jadi satu baris jejak `lunas` yang sudah ada membuat insert
    // jejak di akhir RPC gagal 23505 -> RPC melempar -> rute 500 -> Midtrans
    // mengirim ulang. Bila kelak seseorang memindahkan insert sidik ke
    // panggilan supabase-js terpisah ("biar rutenya yang tahu duplikat"), atau
    // membungkusnya `exception when others then null`, SETIAP uji lain tetap
    // hijau — sementara retry kedua dijawab `duplikat` -> 200, pesanan tinggal
    // `menunggu_bayar` selamanya, dan uangnya sudah di Midtrans.
    const produk = await semaiProduk("mesin-rollback-sidik", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data: palsu, error: ePalsu } = await svc
      .from("jejak_pesanan")
      .insert({ pesanan_id: p.pesananId, kejadian: "lunas", keterangan: "penghalang uji" })
      .select("id")
      .single();
    expect(ePalsu).toBeNull();

    const sidik = sidikUji();
    const muatan = {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-rollback",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidik,
    };

    const gagal = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(gagal.error?.code).toBe("23505");

    // Inilah rollbacknya: sidiknya TIDAK tertinggal, dan barisnya tidak bergerak.
    const { data: notif } = await svc
      .from("notifikasi_pesanan").select("id").eq("sidik", sidik);
    expect(notif ?? []).toEqual([]);
    const { data: masih } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(masih!.status).toBe("menunggu_bayar");

    // Dan inilah seluruh isi janji Lapis 0: sesudah penghalangnya hilang,
    // notifikasi dengan sidik yang SAMA masih bisa menyembuhkan.
    await svc.from("jejak_pesanan").delete().eq("id", palsu!.id);
    const ulang = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(ulang.error).toBeNull();
    expect(ulang.data).toBe("diterapkan");

    const { data: sesudah } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(sesudah!.status).toBe("lunas");
  });

  it("notifikasi untuk PERCOBAAN LAMA tetap diterapkan, dan selisihnya dicatat", async () => {
    // RPC sengaja mencari pesanan lewat `kode` SAJA. Skenarionya nyata:
    // pembeli membuka Snap percobaan 1, mendapat nomor VA, menekan "coba
    // lagi" sehingga barisnya naik ke percobaan 2, lalu besoknya transfer ke
    // VA LAMA. Uang yang mendarat lewat percobaan lama tetap uang yang
    // mendarat.
    //
    // Tanpa kasus ini, seseorang "merapikan" pencariannya jadi
    // `where kode = v_kode and percobaan = v_percobaan` — pembacaan yang
    // terdengar LEBIH benar — dan pembayaran itu dijawab 200 lalu lenyap tanpa
    // bekas, dengan seluruh suite tetap hijau.
    const produk = await semaiProduk("mesin-percobaan-lama", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.from("orders").update({ percobaan: 3 }).eq("id", p.pesananId);

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      // p.orderId dirakit saat percobaan masih 1 — persis VA lama.
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-va-lama",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("lunas");

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("keterangan")
      .eq("pesanan_id", p.pesananId)
      .eq("kejadian", "notifikasi");
    expect((jejak ?? []).some((j) => (j.keterangan ?? "").includes("percobaan"))).toBe(true);
  });

  it("kode HASIL buat_pesanan lolos regex DI DALAM RPC — pengikat tiga salinan", async () => {
    // Bentuk `kode` punya TIGA salinan: penerbit SQL di `buat_pesanan`,
    // `POLA_KODE_PESANAN`/`POLA_ORDER_ID` di TypeScript, dan regex di dalam
    // fungsi ini. Uji Tugas 4 mengikat dua yang pertama; kasus ini yang
    // mengikat ketiganya sekaligus, tanpa melahirkan salinan keempat.
    //
    // Bentuk kegagalan yang dijaganya: satu orang menurunkan `upper(...)` di
    // penerbit, dan sejak saat itu SETIAP notifikasi dijawab
    // `pesanan_tidak_ada` -> 200 -> dibuang, tanpa galat di mana pun.
    const produk = await semaiProduk("mesin-bentuk-kode", 120_000);
    const klien = await signInAs(KLIEN_EMAIL);
    const { data: dibuat, error: eBuat } = await klien.rpc("buat_pesanan", {
      p_product_id: produk,
    });
    expect(eBuat).toBeNull();
    const baris = (dibuat as Array<{ kode: string; percobaan: number }>)[0];

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: rakitOrderId(baris.kode, baris.percobaan),
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-bentuk",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).not.toBe("pesanan_tidak_ada");
  });

  it("jumlah_item yang tidak cocok dengan cacah item nyata: DITAHAN", async () => {
    // Spec menuntut verifikasi `count(*)` di samping verifikasi nominal, dan
    // kodenya ada (`v_cacah <> v_jumlah_item`) — tapi di P1 keduanya selalu 1,
    // jadi cabang ini akan mendarat di P2 (keranjang) tanpa pernah dibuktikan
    // bekerja. Di sanalah ia jadi satu-satunya yang menangkap item yang hilang
    // antara checkout dan settlement.
    const produk = await semaiProduk("mesin-cacah-item", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.from("orders").update({ jumlah_item: 2 }).eq("id", p.pesananId);

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-cacah",
      p_payment_type: "bank_transfer",
      // Nominalnya COCOK — jadi yang memerahkan hanya cacah itemnya.
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("ditahan");
    expect(baris!.sebab_tinjauan).toBe("selisih_nominal");
  });

  it("chargeback: status tetap lunas, akses tidak dicabut, manusia dipanggil", async () => {
    // Spec menyebut "refund, chargeback dan variannya"; hanya `refund` yang
    // diuji sebelumnya. Keduanya jatuh ke cabang yang sama, tapi `v_sebab`-nya
    // berbeda — dan `sebab_tinjauan` itulah yang dibaca staf.
    const produk = await semaiProduk("mesin-chargeback", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-cb",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "chargeback",
      p_fraud_status: "",
      p_transaction_id: "trx-cb",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.sebab_tinjauan).toBe("chargeback");
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.dicabut_pada).toBeNull();
  });

  it("order_id yang tidak menunjuk pesanan mana pun: 'pesanan_tidak_ada', NOL tulisan", async () => {
    const asing = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: "PSN-260926-FFFFFF.1",
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-hantu",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(asing.error).toBeNull();
    expect(asing.data).toBe("pesanan_tidak_ada");

    const cacat = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: "bukan-order-id",
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-hantu",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(cacat.error).toBeNull();
    expect(cacat.data).toBe("pesanan_tidak_ada");

    // Sidiknya TIDAK boleh ikut tersimpan: baris notifikasi yatim akan
    // menolak notifikasi sah yang kelak membawa sidik yang sama.
    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("id")
      .is("pesanan_id", null);
    expect(notif ?? []).toEqual([]);
  });

  it("p_sumber='status_api' menyetel diperiksa_pada dan melahirkan jejak diperiksa_ulang", async () => {
    const produk = await semaiProduk("mesin-status-api", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-periksa",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
      p_sumber: "status_api",
    });
    expect(error).toBeNull();
    expect(data).toBe("tanpa_efek");

    const { data: baris } = await svc
      .from("orders")
      .select("diperiksa_pada, notifikasi_pada")
      .eq("id", p.pesananId)
      .single();
    // Pembatas "sekali per pesanan per lima menit" (Lapis 1b) bersandar pada
    // kolom ini. Bila ia hanya disetel pada jalur yang TIDAK duplikat, satu
    // halaman yang di-refresh berkali-kali menjadi banjir permintaan.
    expect(baris!.diperiksa_pada).not.toBeNull();
    expect(baris!.notifikasi_pada).toBeNull();
    expect(await kejadian(p.pesananId)).toEqual(
      expect.arrayContaining(["diperiksa_ulang", "notifikasi"]),
    );
  });

  it("pemeriksaan ulang yang BERULANG tetap menyetel diperiksa_pada walau sidiknya duplikat", async () => {
    const produk = await semaiProduk("mesin-periksa-dua-kali", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    const sidik = sidikUji();
    const muatan = {
      p_order_id: p.orderId,
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-ulang",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidik,
      p_sumber: "status_api",
    };
    await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    await svc.from("orders").update({ diperiksa_pada: null }).eq("id", p.pesananId);

    const kedua = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(kedua.data).toBe("duplikat");

    const { data: baris } = await svc
      .from("orders")
      .select("diperiksa_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.diperiksa_pada).not.toBeNull();
  });

  it("sumber yang tidak dikenal ditolak — bukan diam-diam dianggap webhook", async () => {
    const produk = await semaiProduk("mesin-sumber-asing", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    const { error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-x",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
      p_sumber: "tombol_admin",
    });
    expect(error?.code).toBe("P0001");
  });
});

describe("view pesanan_item_staf", () => {
  it("staf melihat enam kolom BERNOMINAL; klien tidak melihat baris apa pun", async () => {
    const produk = await semaiProduk("view-staf", 120_000);
    const p = await semaiPesanan({
      produkId: produk,
      harga: 120_000,
      status: "lunas",
      judul: "Kelas Menyusui",
    });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("pesanan_item_staf")
      .select("*")
      .eq("pesanan_id", p.pesananId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(Object.keys(data![0]).sort()).toEqual([
      "harga_beku",
      "jenis",
      "judul_beku",
      "kode",
      "pesanan_id",
      "urutan",
    ]);
    expect(data![0].harga_beku).toBe(120_000);
    expect(data![0].kode).toBe(p.kode);
    expect(data![0].judul_beku).toBe("Kelas Menyusui");

    const klien = await signInAs(KLIEN_EMAIL);
    const { data: lewatKlien, error: eKlien } = await klien
      .from("pesanan_item_staf")
      .select("pesanan_id")
      .eq("pesanan_id", p.pesananId);
    // Predikat `user_role()` hidup DI DALAM badan view: klien mendapat nol
    // baris, bukan galat — dan bukan harga orang lain.
    expect(eKlien).toBeNull();
    expect(lewatKlien ?? []).toEqual([]);
  });

  it("anon ditolak di pintu HAK, bukan sekadar dipulangkan nol baris", async () => {
    const { error } = await anonClient().from("pesanan_item_staf").select("pesanan_id").limit(1);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/pesanan-akses-tiga-keadaan.test.ts
```

Kegagalan yang DIHARAPKAN:
`PGRST202 Could not find the function public.terbitkan_akses_item(p_item_id) in the schema cache`
untuk describe pertama dan kedua, serta
`PGRST205 Could not find the table 'public.pesanan_item_staf' in the schema cache` untuk describe
ketiga. Nol uji hijau di berkas ini.

- [ ] **Step 3: Tulis migrasinya**

Buat `web/supabase/migrations/20260926140000_pesanan_webhook_rpc.sql`:

```sql
-- ===========================================================================
-- MESIN PEMBAYARAN — tiga fungsi TERTUTUP + satu view staf
-- ===========================================================================
-- Ketiganya ditutup dari SELURUH peran API (`revoke ... from public, anon,
-- authenticated`) dan dipanggil server dengan SERVICE ROLE. Alasannya satu
-- kalimat: vonis Midtrans tidak boleh menjadi parameter yang dikirim pemanggil
-- bersesi — kalau boleh, admin mana pun bisa mencetak `lunas` dengan satu
-- `curl`. Preseden bentuknya `20260912130000_tenggat_dan_skrining.sql:110`
-- (`batalkan_lewat_tenggat`, dipanggil `src/app/api/cron/tenggat/route.ts:31`).
-- `tests/fungsi-mesin-tertutup.test.ts` (Tugas 7) mengunci ketiganya di daftar
-- MESIN_TERTUTUP.
--
-- Semua yang terjadi di dalam `terapkan_notifikasi_midtrans` — sisipan sidik,
-- verifikasi jumlah, transisi, penyaluran — berada di SATU transaksi. Bila
-- sidiknya commit lebih dulu lalu transisinya gagal, retry Midtrans ditolak
-- sebagai duplikat dan kegagalan SEMENTARA menjadi PERMANEN: kebalikan dari
-- maksud Lapis 0. Rollback melepas sidiknya; retry masih bisa menyembuhkan.

-- ---------------------------------------------------------------------------
-- Kolom pasangan entitlement <-> pesanan
-- ---------------------------------------------------------------------------
-- DIPINDAHKAN dari migrasi keenam ke sini, sadar: `terbitkan_akses_item` di
-- bawah menulis kolom ini pada panggilan pertamanya, jadi migrasi yang
-- melahirkan kolomnya BELAKANGAN membuat seluruh uji tugas ini merah sampai
-- migrasi berikutnya mendarat. Sisa penambalan `digital_entitlements`
-- (pencabutan hak tulis `authenticated` dan penyempitan policy staf) tetap di
-- migrasi keenam.
--
-- `on delete restrict`: nota yang bisa lenyap bukan nota. Konsekuensinya
-- dicatat sekarang supaya tidak ditemukan sebagai galat — pembersihan fixture
-- wajib menghapus entitlement SEBELUM pesanannya.
alter table public.digital_entitlements
  add column pesanan_id uuid null references public.orders(id) on delete restrict;

comment on column public.digital_entitlements.pesanan_id is
  'Pesanan yang membayari akses ini. NULL untuk entitlement gratis & pemberian '
  'admin. Inilah kunci pasangan invarian rekonsiliasi: tidak ada entitlement '
  'sumber=beli dengan pesanan_id null, dan setiap pesanan yang ditunjuk lunas.';

-- ---------------------------------------------------------------------------
-- terbitkan_akses_item — TIGA keadaan, ditulis harfiah
-- ---------------------------------------------------------------------------
-- `digital_entitlements` punya `unique (client_id, product_id)`
-- (`20260921120000_produk_entitlement.sql:24`), jadi DIAM di sini berarti
-- implementer yang memilih `do nothing` atau `do update`. Ketiganya dinyatakan:
--
--   (1) belum ada        -> insert sumber='beli' + pesanan_id, jejak akses_terbit
--   (2) ada & belum dicabut -> jejak akses_sudah_ada, `sumber` TIDAK diubah,
--                              pesanan_id diisi bila masih kosong
--   (3) ada & DICABUT    -> akses TIDAK dihidupkan, jejak akses_tertahan,
--                              butuh_tinjauan_pada menyala
--
-- Keadaan (3) mengikuti preseden `ambil_produk_gratis`
-- (`20260921150000_ambil_produk_gratis.sql:49-52`) yang menolak `do update`:
-- pencabutan adalah keputusan manusia, dan pembayaran tidak boleh
-- membatalkannya diam-diam. Tapi "uang masuk, barang tidak keluar" juga tidak
-- boleh ikut diam — karena itu penandanya menyala, dan barisnya SELALU
-- terlihat di blok "Butuh perhatian".
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

  update public.orders o
     set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
         sebab_tinjauan = 'akses_tertahan'
   where o.id = v_pesanan_id
     and o.status = any (array['lunas','ditahan']::public.order_status[]);

  return 'akses_tertahan';
end;
$$;

comment on function public.terbitkan_akses_item(uuid) is
  'Tiga keadaan penerbitan akses: akses_terbit / akses_sudah_ada / '
  'akses_tertahan. Entitlement yang DICABUT tidak pernah dihidupkan oleh '
  'pembayaran; yang menyala adalah butuh_tinjauan_pada.';

revoke all on function public.terbitkan_akses_item(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- salurkan_pesanan — satu-satunya tempat mesin tahu NAMA DOMAIN
-- ---------------------------------------------------------------------------
-- Dipanggil di transaksi yang SAMA dengan pergeseran status. Itu bukan detail:
-- itulah yang membuat "lunas tanpa akses" mustahil alih-alih sekadar jarang.
-- Bila penyaluran dikerjakan di TypeScript sesudah RPC pulang, ada jendela di
-- antaranya yang bisa dimasuki proses yang mati — dan memulihkannya menuntut
-- persis infrastruktur pekerjaan latar yang repo ini tolak bangun.
--
-- Penyalur di-key pada TRANSISI, bukan pada niat: ia hanya dipanggil dari
-- cabang yang benar-benar memindahkan baris. Tombol "terbitkan ulang akses"
-- (Tugas 11) memanggil `terbitkan_akses_item` lewat fungsi ini juga, dengan
-- service role dari rutenya sendiri.
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

        update public.orders o
           set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
               sebab_tinjauan = 'penangan_belum_ada'
         where o.id = p_pesanan_id
           and o.status = any (array['lunas','ditahan']::public.order_status[]);
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

comment on function public.salurkan_pesanan(uuid) is
  'Satu case atas order_items.jenis — SATU-SATUNYA tempat mesin pembayaran '
  'tahu nama domain. Dipanggil di transaksi yang sama dengan pergeseran '
  'status, dan hanya dari cabang yang benar-benar memindahkan baris.';

revoke all on function public.salurkan_pesanan(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- terapkan_notifikasi_midtrans — JANTUNGNYA
-- ---------------------------------------------------------------------------
-- Nilai baliknya himpunan tertutup, dan itulah yang dipetakan rute ke kode
-- HTTP (`src/lib/midtrans/kode-jawaban.ts`, Tugas 8):
--
--   'diterapkan'        -> 200  keadaan pesanan berubah (status ATAU penanda tinjauan)
--   'duplikat'          -> 200  sudah diproses; "sudah selesai" memang jawaban yang benar
--   'tanpa_efek'        -> 200  keadaan akhir sudah tercapai; jejaknya tetap lahir
--   'pesanan_tidak_ada' -> 200  tanda tangan sah, order_id tak dikenal; tidak ada
--                               yang tersisa untuk disembuhkan
--
-- Galat basis data DIBIARKAN MELEMPAR — itulah satu-satunya jalan ke 500, dan
-- 500 adalah satu-satunya kelas yang retry Midtrans benar-benar sembuhkan.
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
           sebab_tinjauan = v_sebab
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

    return 'diterapkan';
  end if;

  -- (7) VERIFIKASI JUMLAH terhadap angka yang KITA simpan. Mustahil tanpa
  -- harga beku: angka pembandingnya ada di tangan Midtrans dan ikut
  -- ditandatangani. `nominal_diterima` sudah tersimpan di langkah (4) apa pun
  -- hasilnya di bawah.
  if v_vonis = 'lunas' then
    select coalesce(sum(i.harga_beku), 0)::integer, count(*)::integer
      into v_total, v_cacah
      from public.order_items i
     where i.pesanan_id = v_pesanan_id;

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
             sebab_tinjauan = 'lunas_setelah_tutup'
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
           sebab_tinjauan = 'selisih_status'
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

comment on function public.terapkan_notifikasi_midtrans(text, text, text, text, text, numeric, text, text) is
  'Jantung mesin pembayaran. Sisipan sidik, verifikasi jumlah, transisi, dan '
  'penyaluran berada di SATU transaksi — rollback melepas sidiknya supaya '
  'retry Midtrans masih bisa menyembuhkan. Memulangkan diterapkan / duplikat / '
  'tanpa_efek / pesanan_tidak_ada; galat basis data dibiarkan melempar (500).';

revoke all on function
  public.terapkan_notifikasi_midtrans(text, text, text, text, text, numeric, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- pesanan_item_staf — view bernominal yang DIBACA /admin/pesanan
-- ---------------------------------------------------------------------------
-- `security_invoker = off` dengan predikat `user_role()` DI DALAM badannya:
-- admin, owner, dan klien login sebagai SATU peran SQL yang sama
-- (`authenticated`), jadi grant saja bukan batas peran. Pola yang sama dengan
-- `produk_harga_staf` (`20260921110000_produk_harga.sql:108-121`).
--
-- Karena view ini memuat nominal, ia didaftarkan PER-KOLOM di
-- `KOLOM_UANG_VIEW_DIIZINKAN` — suntingan itu milik Tugas 2, dan sesudah
-- migrasi ini mendarat `tests/money-firewall-struktural.test.ts` kembali hijau.
-- View bernominal tanpa pembaca berarti keputusan pemilik repo berhenti di
-- basis data, jadi Tugas 11 yang membacanya sampai ke layar.
create view public.pesanan_item_staf with (security_invoker = off) as
  select i.pesanan_id,
         o.kode,
         i.jenis,
         i.judul_beku,
         i.harga_beku,
         i.urutan
    from public.order_items i
    join public.orders o on o.id = i.pesanan_id
   where public.user_role() in ('admin', 'owner');

revoke all on public.pesanan_item_staf from public, anon, authenticated;
grant select on public.pesanan_item_staf to authenticated;

comment on view public.pesanan_item_staf is
  'Item pesanan BERNOMINAL untuk /admin/pesanan — enam kolom, predikat '
  'user_role() di dalam badannya. Anon tidak pernah. Inilah satu-satunya jalan '
  'harga beku keluar dari order_items.';
```

- [ ] **Step 4: Terapkan migrasi & jalankan uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx supabase migration up && npx vitest run tests/pesanan-akses-tiga-keadaan.test.ts
```

Seluruh berkas HIJAU. Perhatikan satu kasus yang bentuk merahnya berbeda dari yang lain:
"ROLLBACK MELEPAS SIDIKNYA" sengaja meng-assert bahwa panggilannya MELEMPAR `23505` — bila ia
justru lolos, yang salah bukan ujinya melainkan `jejak_pesanan_lunas_sekali` yang hilang atau
berubah jadi `unique (pesanan_id, kejadian)`.

Kalau `case_not_found` muncul, berarti cabang `else` di `salurkan_pesanan`
terhapus; kalau `42703 column "pesanan_id" does not exist`, berarti `alter table` di puncak migrasi
ini terlewat.

- [ ] **Step 5: Lengkapi daftar izin anon (berkas MILIK tugas ini), lalu jalankan ketiga pagar**

**Ketiga pagar rumah SUDAH HIJAU sejak Tugas 2 dan Tugas 3 — tugas ini TIDAK menutup merah apa
pun.** Kalimat itu ditulis eksplisit karena versi pertama rencana ini menjanjikan sebaliknya
("merah sejak Tugas 2"), dan janji itu salah: pendaftaran `pesanan_item_staf` di
`KOLOM_UANG_VIEW_DIIZINKAN` adalah PENGECUALIAN, bukan assertion — selama view-nya belum ada, ia
tidak membebaskan apa pun dan tidak memerahkan apa pun. Pengeksekusi yang mencari merah hantu di
sini akan menyimpulkan pagarnya tidak berjalan (dugaan yang sangat masuk akal:
`money-firewall-struktural` memang punya mode gagal "hijau karena tidak memindai apa pun") lalu
menyunting berkas yang tugasnya sendiri larang disentuh.

Yang BENAR-BENAR dikerjakan di sini adalah satu suntingan, di berkas yang tugas ini miliki
sendiri: `/Users/arvinfairuz/Documents/padma/web/tests/grant-anon.test.ts`. Tambahkan **enam**
nama di dalam `TABEL_TERTUTUP_ANON`, tepat sesudah entri `"varian_harga_staf"` (baris 81),
sebelum `] as const;`:

```ts
  // Pesanan (P1) — kelima tabel dan SATU view, didaftarkan sekali jalan di
  // migrasi kelima karena daftar ini menerjemahkan setiap nama lewat
  // `format('public.%I', $1::text)::regclass`: relasi yang belum ada MELEMPAR
  // 42P01, bukan lolos. `pesanan_item_staf` baru lahir bersama migrasi ini,
  // jadi lebih awal dari sini mustahil — dan karena daftar izin tidak
  // memerahkan apa pun saat ditambah, tidak ada yang hilang dengan menunggu.
  //
  // `orders` memberi SELECT kepada `authenticated` saja (dua policy di
  // dalamnya yang membedakan klien dari staf); `order_items` tidak memberi
  // apa pun kepada siapa pun; `notifikasi_ditolak_harian` nol policy, nol
  // grant. Anon tidak pernah punya urusan dengan satu pun di antaranya:
  // etalase publik membaca produk dan harga, tidak pernah membaca nota.
  "orders",
  "order_items",
  "jejak_pesanan",
  "notifikasi_pesanan",
  "notifikasi_ditolak_harian",
  // View bernominal, dan SATU-SATUNYA jalan `harga_beku` keluar dari
  // `order_items` — plus `kode` dan `judul_beku` SELURUH pesanan. Batas
  // perannya ada DI DALAM badan view (`user_role() in ('admin','owner')`),
  // bukan di GRANT-nya, persis seperti `varian_harga_staf` di atas. Bedanya
  // dari `harga_publik`, yang justru SENGAJA digrant ke anon: yang ini tidak
  // pernah, dalam keadaan apa pun.
  //
  // Tanpa baris ini, satu `grant select on public.pesanan_item_staf to anon`
  // di migrasi P2/P4 mana pun — atau satu `create or replace view` yang
  // mengembalikan default privileges — membuka seluruh harga beku, kode
  // pesanan, dan judul item ke internet, dan NOL uji merah:
  // `money-firewall-struktural` justru sudah membebaskan kolomnya lewat
  // `KOLOM_UANG_VIEW_DIIZINKAN`, dan `struktur-rls` tidak melihat view.
  "pesanan_item_staf",
```

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/money-firewall-struktural.test.ts tests/grant-anon.test.ts tests/struktur-rls.test.ts
```

Ketiganya HIJAU. Yang berubah cuma `grant-anon`, dan ia hijau juga SEBELUM suntingan ini —
sifat daftar izin. Bila `money-firewall-struktural` justru MERAH dengan
`pesanan_item_staf.harga_beku`, artinya entri pengecualian milik Tugas 2 hilang dari berkas itu:
**laporkan, jangan sunting** — berkas itu bukan milik tugas ini.

- [ ] **Step 6: Jalankan uji tetangga yang paling mungkin terbawa**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/pesanan-jejak-yatim.test.ts tests/produk-entitlement-db.test.ts tests/produk-rute-isi.test.ts
```

Ketiganya HIJAU. Yang kedua dan ketiga membuktikan kolom baru `pesanan_id` tidak mengubah
apa pun bagi gerbang isi yang sudah hidup.

- [ ] **Step 7: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20260926140000_pesanan_webhook_rpc.sql \
        web/tests/pesanan-akses-tiga-keadaan.test.ts \
        web/tests/grant-anon.test.ts
git commit -m "$(cat <<'PESAN'
feat(pesanan): mesin webhook, penyaluran akses, view staf

terapkan_notifikasi_midtrans menyatukan sisipan sidik, verifikasi jumlah,
transisi, dan penyaluran dalam SATU transaksi: rollback melepas sidiknya,
sehingga kegagalan sementara tidak menjadi permanen lewat pintu duplikat.
Nilai baliknya himpunan tertutup yang dipetakan rute ke kode HTTP.

terbitkan_akses_item menulis ketiga keadaannya harfiah. Yang ketiga —
entitlement yang sudah dicabut lalu produknya dibayar — TIDAK menghidupkan
akses, dan menyalakan butuh_tinjauan_pada supaya "uang masuk, barang tidak
keluar" tidak ikut diam.

Kolom digital_entitlements.pesanan_id dipindahkan ke migrasi ini dari migrasi
berikutnya: terbitkan_akses_item menulisnya pada panggilan pertamanya, jadi
melahirkannya belakangan membuat seluruh uji tugas ini merah sampai migrasi
itu mendarat.

Ketiga fungsi mesin ditutup dari seluruh peran API; yang memanggilnya adalah
server dengan service role.

Daftar izin anon dilengkapi di commit yang sama, sekali jalan untuk keenam
objek P1: grant-anon.test.ts menerjemahkan setiap nama lewat regclass, yang
MELEMPAR untuk relasi yang belum ada, jadi ia hanya bisa dilengkapi sesudah
anggota terakhirnya — view pesanan_item_staf — lahir. View itu satu-satunya
jalan harga beku keluar dari order_items, dan tanpa barisnya satu grant ke
anon di migrasi mana pun sesudah ini membuka seluruh nota ke internet dengan
nol uji merah.

Lima kelas masukan yang sebelumnya nol assertion ikut ditutup: seluruh cabang
capture/fraud_status (setiap pembayaran kartu), klaim rollback melepas sidik
yang dibuktikan dengan 23505 sungguhan alih-alih RPC yang di-mock, notifikasi
untuk percobaan lama, pengikat tiga salinan bentuk kode, serta verifikasi
cacah item dan chargeback.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

---

### Task 6: Penambalan `digital_entitlements`

**Files:**
- Create: `web/supabase/migrations/20260926150000_entitlement_tambal.sql`
- Create (test): `web/tests/pesanan-rekonsiliasi-entitlement.test.ts`
- Modify: `web/tests/produk-ambil-gratis.test.ts:1-5` (satu konstanta baru) dan
  `web/tests/produk-ambil-gratis.test.ts:96-97` (satu kasus baru, disisipkan sebelum `});` penutup
  `describe` di baris 97)

**Interfaces:**
- Consumes (T2): `public.orders(id)` dan `public.orders.status` — invarian rekonsiliasi menuntut
  setiap `pesanan_id` yang ditunjuk berstatus `'lunas'`.
- Consumes (T5): `public.salurkan_pesanan(p_pesanan_id uuid) returns void` dan
  `public.terbitkan_akses_item(p_item_id uuid) returns text` — **satu-satunya penulis
  `sumber='beli'`** sesudah migrasi ini; serta kolom `public.digital_entitlements.pesanan_id`
  yang lahir di migrasi 5 (lihat "Penyimpangan dari peta" pada Tugas 5).
- Consumes (repo, terverifikasi): `20260921120000_produk_entitlement.sql` —
  `unique (client_id, product_id)` (`:24`), `client_id ... on delete cascade` (`:13`),
  policy `"entitlement: staf" ... for all` (`:44-47`); dan `public.ambil_produk_gratis(uuid)`
  yang `security definer` sehingga tak tersentuh pencabutan hak `authenticated`.
- Produces: hak tulis `digital_entitlements` bagi `authenticated` dicabut; policy staf menjadi
  `for select`; invarian rekonsiliasi terjaga uji.

**Baca dulu (pola rumah yang ditiru — path lengkap):**
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921120000_produk_entitlement.sql`
  baris 40-60 — policy yang sedang dipersempit, berikut alasan `to authenticated` ditulis eksplisit
  (tanpa target, policy lahir `to public`, dan `public` MENCAKUP `anon`).
- `/Users/arvinfairuz/Documents/padma/web/supabase/migrations/20260921150000_ambil_produk_gratis.sql`
  — fungsi `security definer` yang TETAP hidup sesudah pencabutan hak; itulah yang uji sisipan di
  `tests/produk-ambil-gratis.test.ts` buktikan.
- `/Users/arvinfairuz/Documents/padma/web/tests/jejak-yatim.test.ts` — bentuk uji INVARIAN atas
  seluruh basis data (`left join` + `is null`, pesan galat yang menyebut baris pelanggarnya).
- `/Users/arvinfairuz/Documents/padma/web/src/app/admin/produk/aksi.ts` baris 274-288 — komentar
  yang menyebut "pencabutan punya tombolnya SENDIRI"; tombol itu tidak pernah dibangun, dan sesudah
  migrasi ini ia hanya bisa lahir sebagai RPC ber-radius terkunci.

- [ ] **Step 1: Tulis uji invarian yang gagal**

Buat `web/tests/pesanan-rekonsiliasi-entitlement.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * REKONSILIASI: setiap klaim pendapatan punya pesanan yang membayarinya.
 *
 * Lubang yang ditambal migrasi keenam MENDAHULUI P1, tapi P1 yang mengubah
 * artinya. Sebelum P1, entitlement tidak punya harga. Sesudah P1,
 * `sumber='beli'` adalah KLAIM PENDAPATAN yang — selama policy staf masih
 * `for all` dan hak tulis `authenticated` masih menempel — bisa dikarang
 * setiap akun staf tanpa satu baris `orders` maupun `jejak_pesanan`. Cerita
 * rekonsiliasi yang P1 janjikan buta sepenuhnya terhadapnya, karena ia hanya
 * melihat dari sisi pesanan.
 *
 * Dua kemampuan staf yang ikut dicabut, DITERIMA SADAR dan ditulis terang:
 *   1. menulis `dicabut_pada` — satu-satunya tuas rem yang bisa ditarik tanpa
 *      akses basis data;
 *   2. menerbitkan entitlement `sumber='pemberian_admin'` — kategori yang
 *      sejak sekarang TIDAK BISA LAGI LAHIR; labelnya tetap dirender untuk
 *      baris lama (`src/app/admin/produk/[id]/page.tsx:35`) dan tidak akan
 *      pernah bertambah.
 * Keduanya praktis keadaan hari ini juga: tidak ada satu pun tombol di panel
 * untuk keduanya, jadi yang dicabut adalah kemampuan yang sudah menuntut orang
 * mengetik `curl` atau membuka SQL editor.
 *
 * Invariannya ditulis HARFIAH seperti di spec: tidak ada entitlement
 * `sumber='beli'` dengan `pesanan_id is null`, dan setiap `pesanan_id` yang
 * ditunjuk berstatus `lunas`.
 */

const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const svc = createAdminSupabase();
const produkUji: string[] = [];
let nomorKode = 0;

type Pelanggar = {
  id: string;
  client_id: string;
  product_id: string;
  pesanan_id: string | null;
  status_pesanan: string | null;
};

/**
 * `left join` + `is null`, bukan `not exists`: bentuk ini ikut menangkap
 * `pesanan_id` yang menunjuk pesanan yang sudah tidak ada sama sekali, bukan
 * hanya yang statusnya salah.
 */
async function entitlementBeliYatim(): Promise<Pelanggar[]> {
  return querySql<Pelanggar>(
    `select e.id,
            e.client_id,
            e.product_id,
            e.pesanan_id,
            o.status::text as status_pesanan
       from public.digital_entitlements e
       left join public.orders o on o.id = e.pesanan_id
      where e.sumber = 'beli'
        and (e.pesanan_id is null or o.id is null or o.status <> 'lunas')
      order by e.diberikan_pada`,
  );
}

function ringkas(baris: Pelanggar[]): string {
  return baris
    .map(
      (b) =>
        `  - entitlement ${b.id} (klien ${b.client_id}, produk ${b.product_id})` +
        ` -> pesanan ${b.pesanan_id ?? "(kosong)"} berstatus ${b.status_pesanan ?? "(tidak ada)"}`,
    )
    .join("\n");
}

function kodeUji(): string {
  nomorKode += 1;
  return `PSN-260927-${nomorKode.toString().padStart(6, "0")}`;
}

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc
    .from("digital_product_prices")
    .insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  if (eHarga) throw eHarga;
  return data!.id;
}

async function semaiPesananLunas(produkId: string, harga: number) {
  const { data, error } = await svc
    .from("orders")
    .insert({
      kode: kodeUji(),
      client_id: ANANDA_CLIENT_ID,
      jumlah_item: 1,
      status: "lunas",
      ditutup_pada: new Date().toISOString(),
      lunas_pada: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: item, error: eItem } = await svc
    .from("order_items")
    .insert({
      pesanan_id: data!.id,
      jenis: "produk_digital",
      product_id: produkId,
      judul_beku: "Uji rekonsiliasi",
      harga_beku: harga,
      urutan: 1,
    })
    .select("id")
    .single();
  if (eItem) throw eItem;
  return { pesananId: data!.id, itemId: item!.id };
}

/** Entitlement DULU, pesanan SESUDAHNYA — `pesanan_id` adalah `on delete restrict`. */
async function bersihkan(): Promise<void> {
  const { data: pesanan } = await svc
    .from("orders")
    .select("id")
    .eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) {
    await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
  }
}

afterEach(bersihkan);

describe("hak tulis digital_entitlements sesudah penambalan", () => {
  it("admin TIDAK bisa lagi menerbitkan entitlement lewat PostgREST", async () => {
    const produk = await semaiProduk("tambal-admin-sisip", 120_000);
    const admin = await signInAs("admin@padma.test");

    const { error } = await admin
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "pemberian_admin" })
      .select("id");
    // 42501 di tingkat HAK TABEL, bukan sekadar nol baris dari RLS: policy
    // bisa ditambahkan seseorang besok tanpa satu uji pun merah selama haknya
    // masih menempel.
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", produk);
    expect(data ?? []).toEqual([]);
  });

  it("admin TIDAK bisa lagi menulis dicabut_pada lewat PostgREST", async () => {
    const produk = await semaiProduk("tambal-admin-cabut", 120_000);
    const { error: eSemai } = await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "gratis" });
    expect(eSemai).toBeNull();

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("digital_entitlements")
      .update({ dicabut_pada: new Date().toISOString() })
      .eq("product_id", produk)
      .select("id");
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("product_id", produk)
      .single();
    expect(data!.dicabut_pada).toBeNull();
  });

  it("admin TETAP bisa MEMBACA seluruh entitlement — panel produk hidup dari ini", async () => {
    const produk = await semaiProduk("tambal-admin-baca", 120_000);
    await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "gratis" });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("digital_entitlements")
      .select("id, sumber")
      .eq("product_id", produk);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  it("policy staf tidak lagi menyediakan verba TULIS apa pun", async () => {
    const policy = await querySql<{ policyname: string; cmd: string }>(
      `select policyname, cmd
         from pg_policies
        where schemaname = 'public'
          and tablename = 'digital_entitlements'
        order by policyname`,
    );
    const staf = policy.find((p) => p.policyname === "entitlement: staf");
    expect(staf).toBeDefined();
    // `for all` mencakup INSERT/UPDATE/DELETE. Penyempitan ini adalah separuh
    // penambalan; separuh lainnya adalah pencabutan hak tabel di atas.
    expect(staf!.cmd).toBe("SELECT");
    expect(policy.every((p) => p.cmd === "SELECT")).toBe(true);
  });

  it("DELETE tetap mustahil bagi staf — dijaga ketiadaan policy, dan itu dibuktikan di sini", async () => {
    // Spec mencabut INSERT dan UPDATE saja; DELETE masih menempel di tingkat
    // hak tabel. Yang menahannya adalah KETIADAAN policy DELETE — pagar yang
    // senyap (nol baris, bukan galat), jadi ia ditagih uji alih-alih dipercaya.
    const produk = await semaiProduk("tambal-admin-hapus", 120_000);
    await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "gratis" });

    const admin = await signInAs("admin@padma.test");
    const { data: terhapus, error } = await admin
      .from("digital_entitlements")
      .delete()
      .eq("product_id", produk)
      .select("id");
    expect(error).toBeNull();
    expect(terhapus ?? []).toEqual([]);

    const { data } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", produk);
    expect((data ?? []).length).toBe(1);
  });
});

describe("invarian rekonsiliasi entitlement <-> pesanan", () => {
  it("nol entitlement sumber='beli' yang tidak berpasangan dengan pesanan LUNAS", async () => {
    const yatim = await entitlementBeliYatim();
    expect(
      yatim.length,
      yatim.length === 0
        ? ""
        : `${yatim.length} entitlement mengklaim 'beli' tanpa pesanan lunas yang membayarinya.\n` +
          `Sesudah penambalan, satu-satunya penulis sumber='beli' adalah\n` +
          `terbitkan_akses_item — jadi baris seperti ini berarti ada jalur tulis lain\n` +
          `yang terbuka, ATAU sebuah berkas uji menyemai entitlement 'beli' dengan\n` +
          `service role tanpa pesanannya.\n` +
          `Pelanggar:\n${ringkas(yatim)}`,
    ).toBe(0);
  });

  it("kuerinya benar-benar bisa MERAH — dibuktikan dengan pelanggar yang disengaja", async () => {
    // Uji invarian yang tidak pernah dibuktikan bisa merah adalah uji yang
    // hijau karena kueri-nya salah, dan tidak ada yang bisa membedakannya.
    const produk = await semaiProduk("rekonsiliasi-pelanggar", 120_000);
    const { data: karangan, error } = await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "beli" })
      .select("id")
      .single();
    expect(error).toBeNull();

    const dengan = await entitlementBeliYatim();
    expect(dengan.map((p) => p.id)).toContain(karangan!.id);

    await svc.from("digital_entitlements").delete().eq("id", karangan!.id);
    const sesudah = await entitlementBeliYatim();
    expect(sesudah.map((p) => p.id)).not.toContain(karangan!.id);
  });

  it("pesanan yang BELUM lunas juga dihitung pelanggar", async () => {
    const produk = await semaiProduk("rekonsiliasi-belum-lunas", 120_000);
    const { data: pesanan } = await svc
      .from("orders")
      .insert({ kode: kodeUji(), client_id: ANANDA_CLIENT_ID, jumlah_item: 1 })
      .select("id")
      .single();
    const { data: karangan } = await svc
      .from("digital_entitlements")
      .insert({
        client_id: ANANDA_CLIENT_ID,
        product_id: produk,
        sumber: "beli",
        pesanan_id: pesanan!.id,
      })
      .select("id")
      .single();

    const yatim = await entitlementBeliYatim();
    expect(yatim.map((p) => p.id)).toContain(karangan!.id);
  });

  it("akses yang diterbitkan MESIN memenuhi invarian tanpa perbaikan apa pun", async () => {
    const produk = await semaiProduk("rekonsiliasi-mesin", 120_000);
    const { pesananId } = await semaiPesananLunas(produk, 120_000);

    const { error } = await svc.rpc("salurkan_pesanan", { p_pesanan_id: pesananId });
    expect(error).toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.sumber).toBe("beli");
    expect(ent!.pesanan_id).toBe(pesananId);

    const yatim = await entitlementBeliYatim();
    expect(yatim.length, ringkas(yatim)).toBe(0);
  });

  it("pesanan yang entitlement-nya masih berdiri TIDAK bisa dihapus (on delete restrict)", async () => {
    const produk = await semaiProduk("rekonsiliasi-restrict", 120_000);
    const { pesananId } = await semaiPesananLunas(produk, 120_000);
    await svc.rpc("salurkan_pesanan", { p_pesanan_id: pesananId });

    // Nota yang bisa lenyap bukan nota. Konsekuensinya: pembersihan fixture
    // menghapus entitlement SEBELUM pesanan — dicatat, bukan ditemukan sebagai
    // galat di tengah run yang merah.
    const { error } = await svc.from("orders").delete().eq("id", pesananId).select("id");
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });
});
```

- [ ] **Step 2: Sisipkan kasus "alur gratis tetap hijau" ke berkas uji yang sudah ada**

Di `web/tests/produk-ambil-gratis.test.ts`, tambahkan konstanta di bawah baris 5
(`const bersihkan: string[] = [];`):

```ts
/** Klien seed yang sudah tertaut — dipakai kasus "tetap hijau sesudah revoke". */
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
```

lalu sisipkan kasus berikut **sebelum** baris 97 (`});` penutup `describe`):

```ts
  /**
   * PAGAR TERHADAP PENAMBALAN MIGRASI KEENAM.
   *
   * Migrasi `20260926150000_entitlement_tambal.sql` mencabut INSERT & UPDATE
   * `digital_entitlements` dari `authenticated`. Kesimpulan bahwa pencabutan
   * itu AMAN bersandar pada satu kata kunci di satu baris migrasi:
   * `ambil_produk_gratis` adalah `security definer`, sehingga ia berjalan
   * dengan hak pemiliknya dan tidak ikut kehilangan apa pun.
   *
   * Kasus ini mengubah kesimpulan itu menjadi bukti. Ia juga akan MERAH bila
   * penambalan ditulis sebagai `revoke all ... from authenticated` alih-alih
   * `revoke insert, update`: klien akan kehilangan SELECT, dan pembacaan
   * entitlement di bawah memulangkan nol baris — kelas kesalahan yang grep
   * nama tabel buta terhadapnya.
   */
  it("alur ambil gratis TETAP hijau sesudah hak tulis authenticated dicabut", async () => {
    const svc = createAdminSupabase();
    const id = await semai("gratis-sesudah-tambal", 0);
    const klien = await signInAs("ananda@padma.test");

    // Pintu LANGSUNG memang tertutup untuk setiap peran API.
    const langsung = await klien
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: id, sumber: "gratis" })
      .select("id");
    expect(langsung.error).not.toBeNull();

    // Pintu yang SAH tetap terbuka.
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).toBeNull();

    // Dan klien tetap bisa MEMBACA miliknya — tanpa ini, "Pembelian saya"
    // kosong untuk semua orang dan tidak satu pun uji lain menangkapnya.
    const { data, error: eBaca } = await klien
      .from("digital_entitlements")
      .select("sumber")
      .eq("product_id", id);
    expect(eBaca).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(data![0].sumber).toBe("gratis");

    const { data: lewatSvc } = await svc
      .from("digital_entitlements")
      .select("pesanan_id")
      .eq("product_id", id)
      .single();
    // Entitlement gratis TIDAK menunjuk pesanan mana pun — dan invarian
    // rekonsiliasi memang hanya berlaku untuk sumber='beli'.
    expect(lewatSvc!.pesanan_id).toBeNull();
  });
```

- [ ] **Step 3: Jalankan kedua berkas uji, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/pesanan-rekonsiliasi-entitlement.test.ts tests/produk-ambil-gratis.test.ts
```

Kegagalan yang DIHARAPKAN, dan masing-masing menunjuk hal yang berbeda:
- `"admin TIDAK bisa lagi menerbitkan entitlement lewat PostgREST"` →
  `expected undefined to be '42501'` — hari ini sisipannya **berhasil** (policy `for all` masih
  berlaku dan hak INSERT masih menempel). Inilah lubangnya, terlihat sebagai uji merah.
- `"admin TIDAK bisa lagi menulis dicabut_pada lewat PostgREST"` → sama, `undefined`.
- `"policy staf tidak lagi menyediakan verba TULIS apa pun"` → `expected 'ALL' to be 'SELECT'`.
- `tests/produk-ambil-gratis.test.ts` → **seluruhnya HIJAU, termasuk kasus baru.** Itu disengaja
  dan bukan tanda ujinya lemah: kasus itu adalah pagar REGRESI — ia menjaga agar penambalan di
  Step 4 tidak mematikan fitur yang hidup di produksi. Cara membuatnya merah disebut di dokbloknya
  sendiri: tulis `revoke all ... from authenticated` alih-alih `revoke insert, update`, dan klien
  kehilangan SELECT sehingga pembacaan entitlement memulangkan nol baris. Jalankan itu sekali
  sebagai percobaan bila ragu, lalu kembalikan.
- Describe `"invarian rekonsiliasi"` → keempat uji pertamanya hijau sejak sekarang (migrasi 5 sudah
  mendarat, jadi `salurkan_pesanan` dan kolom `pesanan_id` ada). Yang merah di tahap ini HANYA
  ketiga uji hak & policy di describe pertama — dan itulah lubangnya, terlihat sebagai uji merah.

- [ ] **Step 4: Tulis migrasinya**

Buat `web/supabase/migrations/20260926150000_entitlement_tambal.sql`:

```sql
-- ===========================================================================
-- PENAMBALAN digital_entitlements — satu-satunya sentuhan P1 pada tabel yang
-- sudah dipakai produksi
-- ===========================================================================
-- Lubangnya MENDAHULUI P1, tapi P1 yang mengubah artinya. Sebelum P1,
-- entitlement tidak punya harga. Sesudah P1, `sumber='beli'` adalah KLAIM
-- PENDAPATAN yang bisa dikarang setiap akun staf lewat satu `curl` ke
-- PostgREST — tanpa satu baris `orders` maupun `jejak_pesanan` — dan cerita
-- rekonsiliasi yang P1 janjikan buta sepenuhnya terhadapnya, karena ia hanya
-- melihat dari sisi pesanan.
--
-- AMAN DILAKUKAN, diverifikasi bukan diasumsikan: ketiga kueri
-- `digital_entitlements` di `src/` seluruhnya `.select()`
-- (`admin/produk/[id]/page.tsx:47`, `produk/[slug]/tombol-ambil.tsx:114`,
-- `lib/passport/produk-saya.ts:64`), dan satu-satunya penulis produksi —
-- `ambil_produk_gratis` — adalah `security definer` sehingga pencabutan hak
-- `authenticated` tidak menyentuhnya. Karena kesimpulan itu bersandar pada
-- SATU kata kunci di SATU baris migrasi, uji yang membuktikannya lahir bersama
-- migrasi ini (`tests/produk-ambil-gratis.test.ts`, kasus "alur ambil gratis
-- TETAP hijau sesudah hak tulis authenticated dicabut").
--
-- DUA KEMAMPUAN STAF YANG DICABUT, DITERIMA SADAR:
--   1. menulis `dicabut_pada` — satu-satunya tuas rem yang bisa ditarik tanpa
--      akses basis data. Sesudah ini, rem darurat hanya bisa ditarik pemegang
--      service role.
--   2. menerbitkan `sumber='pemberian_admin'` — kategori yang sejak sekarang
--      TIDAK BISA LAGI LAHIR. Labelnya tetap dirender untuk baris lama
--      (`src/app/admin/produk/[id]/page.tsx:35`) dan tidak akan pernah
--      bertambah.
-- Keduanya praktis keadaan hari ini juga: tidak ada satu pun tombol di panel
-- untuk keduanya, jadi yang dicabut adalah kemampuan yang sudah menuntut orang
-- mengetik `curl` atau membuka SQL editor. Komentar di
-- `src/app/admin/produk/aksi.ts:274-288` menyebut "pencabutan punya tombolnya
-- SENDIRI" — bila tombol itu kelak benar-benar dibutuhkan, ia lahir sebagai
-- RPC kedua ber-radius terkunci, BUKAN sebagai pengembalian hak tulis tabel.

-- INSERT & UPDATE saja yang dicabut, sesuai spec. DELETE sengaja dibiarkan di
-- tingkat hak tabel dan ditahan oleh KETIADAAN policy DELETE — pagar yang
-- senyap (nol baris, bukan galat), jadi ia ditagih uji alih-alih dipercaya:
-- lihat kasus "DELETE tetap mustahil bagi staf" di
-- tests/pesanan-rekonsiliasi-entitlement.test.ts.
revoke insert, update on public.digital_entitlements from authenticated;

-- Policy staf dipersempit dari `for all` menjadi `for select`. Pagar tingkat
-- HAK di atas dan penyempitan policy di sini adalah DUA pagar untuk satu
-- lubang, dan itu disengaja: policy bisa ditambahkan seseorang besok tanpa
-- satu uji pun merah selama haknya masih ada, dan sebaliknya hak bisa
-- dikembalikan diam-diam selama policy-nya masih `for all`.
--
-- `to authenticated` DITULIS ULANG, bukan dilupakan: policy tanpa target lahir
-- `to public`, dan `public` MENCAKUP `anon` — setiap SELECT anon atas tabel ini
-- akan ikut mengevaluasi policy staf, memanggil `user_role()` yang EXECUTE-nya
-- sudah dicabut dari anon, dan gagal 42501 alih-alih memulangkan baris kosong
-- (alasan yang sama persis dengan yang tertulis di migrasi aslinya,
-- 20260921120000_produk_entitlement.sql:40-47).
drop policy "entitlement: staf" on public.digital_entitlements;

create policy "entitlement: staf" on public.digital_entitlements for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

comment on table public.digital_entitlements is
  'Kepemilikan produk digital. SATU-SATUNYA sumber kebenaran akses — setiap '
  'gerbang isi membaca tabel ini, tidak pernah membaca pesanan. Sejak '
  'penambalan P1: peran API hanya MEMBACA. Penerbitan akses lewat '
  'ambil_produk_gratis (gratis) atau terbitkan_akses_item (beli); pencabutan '
  'hanya lewat service role.';
```

- [ ] **Step 5: Terapkan migrasi & jalankan kedua berkas uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx supabase migration up && npx vitest run tests/pesanan-rekonsiliasi-entitlement.test.ts tests/produk-ambil-gratis.test.ts
```

Kedua berkas HIJAU seluruhnya.

- [ ] **Step 6: Buktikan tidak ada fitur hidup yang ikut mati**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/produk-entitlement-db.test.ts tests/produk-rute-isi.test.ts \
  tests/produk-reader-passport.test.tsx tests/admin-produk.test.ts tests/produk-tombol-ambil.test.tsx
```

Kelimanya HIJAU. Inilah langkah yang menagih klaim "aman dilakukan" di dokblok migrasi: kelima
berkas itu menyentuh `digital_entitlements` atau layar yang membacanya. Bila salah satunya merah
dengan 42501, yang salah adalah cakupan `revoke`-nya — **jangan** menambal dengan mengembalikan
hak tulis; cari penulis `authenticated` yang selama ini tersembunyi dan pindahkan ke RPC.

- [ ] **Step 7: Jalankan seluruh suite pesanan sekali jalan**

```bash
cd /Users/arvinfairuz/Documents/padma/web
npx vitest run tests/pesanan-status-db.test.ts tests/pesanan-nota-beku.test.ts \
  tests/pesanan-teks-tanpa-nominal.test.ts tests/pesanan-jejak-yatim.test.ts \
  tests/pesanan-checkout-db.test.ts tests/pesanan-akses-tiga-keadaan.test.ts \
  tests/pesanan-rekonsiliasi-entitlement.test.ts \
  tests/money-firewall-struktural.test.ts tests/struktur-rls.test.ts tests/grant-anon.test.ts
```

Seluruhnya HIJAU. Enam migrasi P1 sudah lengkap pada titik ini, jadi inilah kali pertama seluruh
pagar basis data bisa dinilai bersama — termasuk kedua pagar yang entrinya dibelah Tugas 2 dan
Tugas 3, dan daftar izin anon yang baru lengkap di Tugas 5.

`tests/fungsi-mesin-tertutup.test.ts` dan `tests/env-terdokumentasi.test.ts` **sengaja TIDAK ada
di perintah ini**: keduanya lahir di Tugas 7, dan menyebut berkas yang belum ada membuat vitest
gagal dengan "No test files found" — kegagalan yang terbaca seperti suite yang rusak. Tugas 7
yang menjalankan keduanya bersama kesepuluh berkas di atas, dan Tugas 7 pula titik berhenti
dokumen ini (peta §17): sesudahnya seluruh suite hijau dan NOL permukaan pengguna lahir.

- [ ] **Step 8: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20260926150000_entitlement_tambal.sql \
        web/tests/pesanan-rekonsiliasi-entitlement.test.ts \
        web/tests/produk-ambil-gratis.test.ts
git commit -m "$(cat <<'PESAN'
feat(pesanan): tambal lubang tulis digital_entitlements

Hak INSERT & UPDATE dicabut dari authenticated, dan policy staf dipersempit
dari for all menjadi for select. Dua pagar untuk satu lubang: hak bisa
dikembalikan diam-diam selama policy-nya masih for all, dan policy bisa
ditambahkan besok selama haknya masih menempel.

Lubangnya mendahului P1, tapi P1 yang mengubah artinya: sesudah P1,
sumber='beli' adalah klaim pendapatan yang bisa dikarang setiap akun staf
lewat satu curl, dan rekonsiliasi dari sisi pesanan buta terhadapnya.

Dua kemampuan staf ikut dicabut, diterima sadar: menulis dicabut_pada, dan
menerbitkan pemberian_admin. Keduanya sejak sekarang hanya lewat service role;
kategori "Pemberian admin" tidak akan pernah bertambah.

Invarian rekonsiliasi diuji harfiah — tidak ada entitlement sumber='beli'
dengan pesanan_id null, dan setiap pesanan yang ditunjuk berstatus lunas —
berikut satu kasus yang membuktikan kuerinya benar-benar bisa merah. Alur
ambil produk gratis dibuktikan TETAP hijau sesudah pencabutan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
)"
```

### Task 7: Pagar fungsi tertutup & env

Akar repo `/Users/arvinfairuz/Documents/padma`; aplikasi di `web/`. Semua perintah di
bawah dijalankan dari `/Users/arvinfairuz/Documents/padma/web`.

Tugas ini **nol migrasi**. Ia hanya melahirkan dua pagar dan satu baris dokumentasi env.
Ia mendarat **sesudah** migrasi 1–6 (Task 1–6) karena uji pertamanya membaca katalog
fungsi sungguhan di basis data lokal.

**BACA DULU sebagai pola yang ditiru** (path lengkap, jangan menebak isinya):
- `/Users/arvinfairuz/Documents/padma/web/tests/hak-default-sequence-fungsi.test.ts`
  — pola kueri `has_function_privilege(...)` atas `pg_proc`, dan dokblok yang menjelaskan
  KENAPA fungsi baru lahir terbuka untuk `authenticated`.
- `/Users/arvinfairuz/Documents/padma/web/tests/varian-struktur.test.ts` baris 105–118
  — satu-satunya bentuk assertion hak per-fungsi yang sudah ada di repo hari ini.
- `/Users/arvinfairuz/Documents/padma/web/tests/helpers/db.ts` — `querySql()`; koneksi
  SQL langsung, dipakai karena hak tabel/fungsi hidup di katalog sistem dan tidak
  pernah terlihat lewat PostgREST.
- `/Users/arvinfairuz/Documents/padma/web/tests/inventaris-rute.test.ts` — pola uji yang
  hanya MEMBACA berkas (`readFileSync`/`readdirSync`, `path.resolve(__dirname, "..")`),
  tanpa DB. Uji env meniru bentuk ini.
- `/Users/arvinfairuz/Documents/padma/web/.env.example` — 46 baris; setiap blok env
  didahului komentar yang menjelaskan apa yang mati bila ia tidak dipasang.

**Files:**
- Create: `web/tests/env-terdokumentasi.test.ts`
- Create: `web/tests/fungsi-mesin-tertutup.test.ts`
- Modify: `web/.env.example:46` (menambah di AKHIR berkas, sesudah baris
  `NEXT_PUBLIC_BASIS_URL=http://localhost:3000`)
- Test: `web/tests/env-terdokumentasi.test.ts`, `web/tests/fungsi-mesin-tertutup.test.ts`

**Interfaces:**
- Consumes (dari T1, tanda tangan PERSIS):
  `public.perpindahan_pesanan_sah(p_dari public.order_status, p_ke public.order_status) returns boolean`
- Consumes (dari T4, tanda tangan PERSIS):
  `public.buat_pesanan(p_product_id uuid, p_ulang boolean default false) returns table (pesanan_id uuid, kode text, percobaan smallint, nominal_tagih integer, judul text)`;
  `public.catat_token_snap(p_pesanan_id uuid, p_token text) returns void`;
  `public.batalkan_pesanan_saya(p_pesanan_id uuid) returns boolean`;
  `public.putuskan_pesanan_ditahan(p_pesanan_id uuid, p_putusan text) returns void`;
  `public.tutup_tinjauan(p_pesanan_id uuid) returns void`
- Consumes (dari T5, tanda tangan PERSIS):
  `public.terapkan_notifikasi_midtrans(p_order_id text, p_transaction_status text, p_fraud_status text, p_transaction_id text, p_payment_type text, p_gross_amount numeric, p_sidik text, p_sumber text default 'webhook') returns text`;
  `public.salurkan_pesanan(p_pesanan_id uuid) returns void`;
  `public.terbitkan_akses_item(p_item_id uuid) returns text`
- Consumes (sudah ada di repo): `public.ambil_produk_gratis(p_product_id uuid) returns uuid`
  (`20260921150000_ambil_produk_gratis.sql`)
- Produces: `web/.env.example` yang memuat `MIDTRANS_SERVER_KEY`,
  `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`, `MIDTRANS_PRODUKSI`, `CRON_SECRET` —
  **prasyarat hijau T8, T9, T10, T11, T12**: begitu salah satu dari mereka menulis
  `process.env.MIDTRANS_SERVER_KEY` di `src/`, `tests/env-terdokumentasi.test.ts`
  merah sampai barisnya ada di `.env.example`.
- Produces: dua daftar putih bernama di `web/tests/fungsi-mesin-tertutup.test.ts` —
  `MESIN_TERTUTUP` dan `TERBUKA_SADAR`. Setiap tugas sesudahnya yang melahirkan
  fungsi SQL penulis `orders`/`order_items`/`jejak_pesanan`/`digital_entitlements`
  wajib menambahkan namanya ke **tepat satu** daftar itu, atau suite merah.

---

- [ ] **Step 1: Tulis `tests/env-terdokumentasi.test.ts`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/tests/env-terdokumentasi.test.ts`:

```ts
/**
 * PAGAR: setiap env yang DIBACA kode punya barisnya sendiri di `.env.example`.
 *
 * Kelas kesalahan ini bukan hipotesis. `CRON_SECRET` dibaca
 * `src/app/api/cron/tenggat/route.ts` sejak rute itu lahir, dan sampai commit ini
 * ia TIDAK ADA di `.env.example` — jadi satu-satunya cara seseorang tahu ia harus
 * memasangnya adalah membaca kode rutenya. Bentuk kegagalannya khas dan mahal:
 * rute itu fail-closed, jadi env yang lupa dipasang tidak melahirkan galat
 * konfigurasi melainkan 401 yang terlihat seperti "penjadwalnya salah rahasia".
 *
 * ===== SATU ARAH, DAN ITU DISENGAJA =====
 * Yang diuji hanya "dibaca kode -> ada di contoh". Arah sebaliknya (terdokumentasi
 * tetapi belum dipakai) TIDAK memerahkan apa pun. Alasannya praktis: P1 menulis
 * keempat env Midtrans ke `.env.example` di tugas ini, sementara yang membacanya
 * lahir di tugas-tugas berikutnya. Pagar dua arah akan memaksa urutan mendarat
 * yang tidak ada hubungannya dengan kebenaran apa pun.
 *
 * ===== BATAS YANG DIKETAHUI =====
 * Pemindainya mencari literal `process.env.NAMA`. Pembacaan DINAMIS
 * (`process.env[nama]`, seperti helper `wajib()` di `src/lib/r2.ts:22`) tidak
 * terlihat olehnya — keempat env R2 memang sudah terdokumentasi, tapi itu karena
 * seseorang menulisnya, bukan karena pagar ini menuntutnya. Siapa pun yang
 * menambah pembacaan dinamis baru harus mendokumentasikannya sendiri.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const SRC = path.join(AKAR, "src");
const CONTOH = readFileSync(path.join(AKAR, ".env.example"), "utf8");

/**
 * Disediakan runtime, bukan oleh berkas konfigurasi kita. `NODE_ENV` disetel
 * Next.js/Node sendiri; menuliskannya di `.env.example` justru mengundang orang
 * menimpanya dan memecahkan build.
 */
const DISEDIAKAN_RUNTIME = new Set(["NODE_ENV"]);

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    const anak = path.join(dir, entri.name);
    if (entri.isDirectory()) hasil.push(...berkasSumber(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

/** Setiap `process.env.NAMA` yang ditulis harfiah di `src/`, tanpa duplikat. */
function envDibaca(): string[] {
  const nama = new Set<string>();
  for (const berkas of berkasSumber(SRC)) {
    const isi = readFileSync(berkas, "utf8");
    for (const cocok of isi.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!DISEDIAKAN_RUNTIME.has(cocok[1])) nama.add(cocok[1]);
    }
  }
  return [...nama].sort();
}

/**
 * Terdokumentasi berarti punya BARISNYA SENDIRI (`NAMA=` di awal baris), bukan
 * sekadar disebut di dalam komentar. Komentar yang menyebut sebuah env tidak
 * memberi tahu siapa pun nilai apa yang harus dipasang — dan `.env.example`
 * repo ini memang penuh komentar yang menyebut nama env tetangganya.
 */
function terdokumentasi(nama: string): boolean {
  return new RegExp(`^${nama}=`, "m").test(CONTOH);
}

describe("env terdokumentasi", () => {
  it("pemindainya benar-benar menemukan sesuatu", () => {
    // Anti-hampa. Pemindai yang rusak memulangkan daftar kosong, dan daftar
    // kosong membuat assertion utama di bawah hijau selamanya tanpa memeriksa
    // apa pun. Angka ini LANTAI, bukan langit-langit.
    expect(envDibaca().length).toBeGreaterThanOrEqual(8);
  });

  it("cetakan `terdokumentasi` tidak hampa: mengenali yang ada, menolak yang tidak", () => {
    expect(terdokumentasi("NEXT_PUBLIC_SUPABASE_URL")).toBe(true);
    expect(terdokumentasi("PADMA_ENV_YANG_TIDAK_PERNAH_ADA")).toBe(false);
  });

  it("penyebutan di dalam KOMENTAR saja tidak dihitung terdokumentasi", () => {
    // Pagar terhadap "perbaikan" termurah yang salah: menambahkan nama env ke
    // sebuah komentar dan menganggap dokumentasinya selesai.
    const palsu = "# CRON_SECRET disebut di sini saja\nLAIN=1\n";
    expect(new RegExp("^CRON_SECRET=", "m").test(palsu)).toBe(false);
  });

  it("setiap env yang dibaca src/ punya barisnya sendiri di .env.example", () => {
    const hilang = envDibaca().filter((n) => !terdokumentasi(n));
    expect(
      hilang,
      hilang.length === 0
        ? ""
        : `Env ini dibaca kode tetapi tidak ada di web/.env.example: ${hilang.join(", ")}.\n` +
          `Tambahkan barisnya BESERTA komentar yang menjelaskan apa yang mati tanpanya —\n` +
          `itulah bentuk yang dipakai seluruh berkas itu, dan itulah yang membuatnya berguna.`,
    ).toEqual([]);
  });
});
```

---

- [ ] **Step 2: Jalankan uji env, pastikan GAGAL**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/env-terdokumentasi.test.ts
```

Kegagalan yang DIHARAPKAN — tepat satu kasus merah:
`setiap env yang dibaca src/ punya barisnya sendiri di .env.example`, dengan pesan
`Env ini dibaca kode tetapi tidak ada di web/.env.example: CRON_SECRET.`

Tiga kasus lain hijau. Bila kasus ini sudah hijau sekarang, berarti seseorang sudah
menambahkan `CRON_SECRET` ke `.env.example` — periksa `git diff` sebelum melanjutkan;
pagar yang lahir hijau tidak pernah membuktikan ia bisa merah.

---

- [ ] **Step 3: Tambahkan keempat env ke `.env.example`**

Tambahkan di AKHIR `/Users/arvinfairuz/Documents/padma/web/.env.example` (sesudah
baris 46, `NEXT_PUBLIC_BASIS_URL=http://localhost:3000`) — satu baris kosong dulu:

```sh
# Midtrans — kunci SERVER, dipakai menghitung tanda tangan notifikasi webhook
# dan sebagai Basic auth ke Snap/Status API. Tanpa ini webhook menjawab 503,
# BUKAN 401 dan bukan 200: 2xx/4xx memberi tahu Midtrans "sudah selesai" dan
# notifikasi itu tidak pernah datang lagi, sehingga env yang lupa dipasang
# berakhir sebagai UANG YANG HILANG alih-alih keterlambatan.
MIDTRANS_SERVER_KEY=SB-Mid-server-isi-dari-dashboard-midtrans

# Kunci KLIEN. Skrip Snap di peramban menuntutnya lewat atribut
# `data-client-key`; tanpa ini popup pembayaran tidak pernah terbuka. Ber-prefix
# NEXT_PUBLIC_ karena memang dikirim ke peramban — dan itu aman: kunci klien
# tidak bisa menerbitkan transaksi sendiri.
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=SB-Mid-client-isi-dari-dashboard-midtrans

# HANYA nilai "true" PERSIS yang memilih app.midtrans.com dan skrip Snap
# produksi; nilai lain apa pun jatuh ke sandbox. SENGAJA bukan NODE_ENV:
# pratinjau Vercel berjalan dengan NODE_ENV=production dan akan menembak
# Midtrans produksi — uang sungguhan dari lingkungan yang dibuat untuk coba-coba.
#
# TANPA prefix NEXT_PUBLIC_, jadi peramban TIDAK bisa membacanya. Pemilihan URL
# skrip Snap karena itu dibaca di server (`/produk/[slug]/page.tsx`) dan dioper
# sebagai prop ke komponen tombolnya. Membacanya dari komponen klien =
# `undefined` = selalu sandbox, tanpa satu pun galat.
MIDTRANS_PRODUKSI=false

# Rahasia bersama untuk rute mesin (`/api/cron/tenggat`, `/api/cron/pesanan`).
# Rute-rute itu FAIL-CLOSED: tanpa nilai ini mereka menolak SEMUA ORANG dengan
# 401, dan 401 itu terlihat persis seperti "penjadwalnya salah rahasia". Di
# produksi nilainya hidup sebagai GitHub Secret, bukan di repo — repo ini publik.
CRON_SECRET=rahasia-panjang-acak-khusus-lingkungan-ini
```

---

- [ ] **Step 4: Jalankan uji env, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/env-terdokumentasi.test.ts
```

Empat kasus hijau.

---

- [ ] **Step 5: Tulis `tests/fungsi-mesin-tertutup.test.ts`**

Berkas BARU `/Users/arvinfairuz/Documents/padma/web/tests/fungsi-mesin-tertutup.test.ts`:

```ts
/**
 * PAGAR: fungsi mesin pembayaran TERTUTUP bagi `authenticated`, dan setiap
 * fungsi yang menulis tabel pesanan ada di TEPAT SATU daftar putih bernama.
 *
 * ===== DIAGNOSIS, DAN KENAPA TEMPLAT RUMAH SENDIRI MELUBANGINYA =====
 * Fungsi baru LAHIR TERBUKA untuk setiap pengguna login. Itu bukan dugaan:
 * `tests/hak-default-sequence-fungsi.test.ts:158` meng-assert default ACL memberi
 * `authenticated` EXECUTE, dan `:253` membuktikannya atas fungsi yang BARU dibuat.
 * Sementara itu templat aturan [F] repo ini —
 * `supabase/migrations/20260828230000_fail_closed_sequence_fungsi.sql:176-177` —
 * menulis `revoke ... from public, anon` TANPA `authenticated`. Implementer yang
 * mengikuti templat rumah karena itu membuka pintu, dan suite tetap hijau.
 *
 * Bentuk revoke ketatnya sudah jadi preseden migrasi:
 * `revoke all on function ... from public, anon, authenticated`
 * (`20260830150000_pengerasan_tabel_uang.sql:197,249,319,360`).
 *
 * Yang pagar ini ubah: hak `authenticated` per-fungsi hari ini dijaga di DUA
 * tempat saja — `tests/tenggat-bayar.test.ts:155` dan
 * `tests/varian-struktur.test.ts:105` — yaitu dua contoh yang harus diingat satu
 * per satu. Berkas ini mengubahnya menjadi DAFTAR YANG DIPAKSA LENGKAP.
 *
 * ===== KENAPA DAFTAR PUTIH BERNAMA, BUKAN ATURAN OTOMATIS =====
 * "Fungsi yang menulis tabel uang harus tertutup" akan melarang persis fungsi
 * yang P1 BUTUHKAN terbuka (`buat_pesanan` dipanggil rute checkout dengan sesi
 * pemanggil), merah sejak commit pertama, dan satu-satunya penyembuhnya melanggar
 * cakupan. Yang dipaksa di sini bukan pilihannya, melainkan pilihannya diambil
 * SADAR: fungsi penulis baru yang lahir tanpa masuk salah satu daftar = merah.
 *
 * Kolom kedua `TERBUKA_SADAR` adalah pengikat yang sesungguhnya: fungsi boleh
 * terbuka bagi `authenticated` ASAL ia memeriksa sendiri siapa pemanggilnya —
 * `auth.uid()` (memilih client_id-nya sendiri alih-alih memercayai payload) atau
 * `user_role()` (gerbang peran staf).
 *
 * ===== YANG BUKAN URUSAN BERKAS INI =====
 * Hak `anon` TIDAK diperiksa di sini. Ia sudah dijaga menyeluruh oleh
 * `tests/hak-default-sequence-fungsi.test.ts` ("tidak ada fungsi/prosedur public
 * yang bisa dieksekusi anon", diperiksa atas OBJEK NYATA). Satu batas, satu
 * pemilik.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { querySql } from "./helpers/db";

/**
 * Jantung mesin pembayaran. Ketiga yang pertama menulis uang orang; yang keempat
 * adalah penjaga transisinya. Tidak satu pun boleh bisa dipanggil dari PostgREST
 * oleh pemegang sesi mana pun — vonis Midtrans tidak boleh menjadi parameter
 * yang dikirim pemanggil bersesi, atau admin mana pun bisa mencetak `lunas`
 * dengan satu `curl`.
 */
const MESIN_TERTUTUP = [
  "perpindahan_pesanan_sah",
  "salurkan_pesanan",
  "terapkan_notifikasi_midtrans",
  "terbitkan_akses_item",
] as const;

/**
 * Terbuka bagi `authenticated` — SADAR, dan masing-masing menggerbangi dirinya
 * sendiri. Urut abjad supaya penambahan berikutnya punya satu tempat yang jelas.
 *
 * ===== KENAPA PETA NAMA -> GERBANG, BUKAN DAFTAR NAMA =====
 * Versi pertama pagar ini memindai badan fungsi untuk `auth.uid()` ATAU
 * `user_role()`, dan itu tidak bisa membedakan GERBANG dari PENYEBUTAN. Sudah
 * ada satu kecocokan yang kebetulan hari ini: `putuskan_pesanan_ditahan`
 * memuat `where p.id = auth.uid()` — baris yang mengambil NAMA PEMUTUS untuk
 * jejak, sama sekali bukan gerbang. Gerbangnya yang sesungguhnya `user_role()`.
 * Dengan "salah satu dari dua", menghapus gerbang yang benar tetap hijau lewat
 * penyebutan yang lain; pengikatnya tidak mengikat apa pun.
 *
 * Yang dinyatakan di sini karena itu gerbang MANA yang diharapkan per nama.
 */
const TERBUKA_SADAR = {
  // Memilih `client_id`-nya sendiri dari sesi, alih-alih memercayai payload.
  ambil_produk_gratis: "auth.uid",
  batalkan_pesanan_saya: "auth.uid",
  buat_pesanan: "auth.uid",
  catat_token_snap: "auth.uid",
  // Gerbang PERAN. `auth.uid()` juga muncul di badan keduanya, tapi hanya
  // untuk mengambil nama pemutus/penutup — dan itulah sebabnya kolom ini
  // menyebut gerbang yang diharapkan, bukan menerima salah satu dari dua.
  putuskan_pesanan_ditahan: "user_role",
  tutup_tinjauan: "user_role",
} as const;

type Gerbang = (typeof TERBUKA_SADAR)[keyof typeof TERBUKA_SADAR];

const NAMA_TERBUKA_SADAR = Object.keys(TERBUKA_SADAR) as Array<keyof typeof TERBUKA_SADAR>;

/**
 * Predikat gerbang, DIEKSTRAK supaya bisa diadu dengan literal — lihat
 * describe "kontrol positif predikat gerbang" di bawah.
 *
 * `prosrc` MEMUAT KOMENTAR, jadi pemindaian mentah dipuaskan satu baris
 * `-- gerbangnya lewat user_role(), lihat migrasi 2026xxxx`. Rencana ini
 * sendiri tahu bahayanya: komentar `tolak_ubah_item_pesanan` di migrasi Tugas 2
 * sengaja ditaruh DI LUAR badan `$$` supaya tidak memalsukan kecocokan
 * POLA_PENULIS. Kesadaran yang sama diterapkan di sini, pada pengikat yang
 * jauh lebih penting.
 */
export function bergerbang(badan: string, gerbang: Gerbang): boolean {
  const tanpaKomentar = badan.replace(/--[^\n]*/g, "");
  return gerbang === "auth.uid"
    ? /auth\.uid\s*\(\s*\)/.test(tanpaKomentar)
    : /user_role\s*\(\s*\)/.test(tanpaKomentar);
}

/**
 * "Menulis tabel pesanan." TANPA flag `g` — `RegExp.test()` pada regex ber-`g`
 * menyimpan `lastIndex` dan memulangkan false bergantian pada pemanggilan
 * berikutnya. Pagar yang hijau setiap baris genap adalah pagar yang lebih buruk
 * daripada tidak ada.
 */
const POLA_PENULIS =
  /(insert\s+into|update)\s+(public\.)?(orders|order_items|jejak_pesanan|digital_entitlements)\b/i;

type Fungsi = {
  nama: string;
  tanda_tangan: string;
  badan: string;
  authenticated_bisa: boolean;
};

let katalog: Fungsi[] = [];

beforeAll(async () => {
  // Dibaca lewat `p.oid`, BUKAN lewat string `'nama(tipe,tipe)'::regprocedure`:
  // fungsi berargumen default punya satu tanda tangan identitas yang gampang
  // salah ketik, dan salah ketik pada regprocedure melempar galat yang terbaca
  // seperti "fungsinya tidak ada" — bukan seperti "ujinya yang salah".
  katalog = await querySql<Fungsi>(
    `select p.proname as nama,
            p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as tanda_tangan,
            -- KOMENTAR DIBUANG DI SINI JUGA, bukan hanya di `bergerbang()`:
            -- POLA_PENULIS di bawah juga dijalankan atas kolom ini, dan satu
            -- baris `-- update public.orders ...` di dalam badan $$ sudah
            -- cukup menyeret fungsi yang bukan penulis ke daftar yatim.
            regexp_replace(coalesce(p.prosrc, ''), '--[^\n]*', '', 'g') as badan,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_bisa
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
      order by 1`,
  );
});

/** Semua overload bernama `nama`. Kosong berarti fungsinya memang tidak ada. */
function cari(nama: string): Fungsi[] {
  return katalog.filter((f) => f.nama === nama);
}

describe("katalog fungsi terbaca", () => {
  it("kueri katalog benar-benar memulangkan fungsi", () => {
    // Anti-hampa. Kueri yang rusak memulangkan nol baris, dan nol baris membuat
    // SELURUH assertion di bawah lolos tanpa memeriksa apa pun.
    expect(katalog.length).toBeGreaterThanOrEqual(20);
  });
});

describe("MESIN_TERTUTUP — tidak bisa dipanggil pemegang sesi", () => {
  it.each(MESIN_TERTUTUP)("fungsi %s ada di basis data", (nama) => {
    // Nama yang salah ketik akan membuat seluruh assertion hak di bawahnya
    // hampa: tidak ada baris untuk diperiksa, jadi tidak ada yang bisa merah.
    expect(cari(nama).length, `fungsi public.${nama} tidak ada di basis data`)
      .toBeGreaterThan(0);
  });

  it.each(MESIN_TERTUTUP)("authenticated TIDAK bisa mengeksekusi %s", (nama) => {
    const terbuka = cari(nama).filter((f) => f.authenticated_bisa);
    expect(
      terbuka.map((f) => f.tanda_tangan),
      terbuka.length === 0
        ? ""
        : `public.${nama} masih bisa dipanggil pemegang sesi mana pun lewat PostgREST.\n` +
          `Templat rumah (20260828230000:176-177) menulis "revoke ... from public, anon"\n` +
          `TANPA authenticated. Yang dipakai untuk fungsi mesin adalah bentuk ketatnya:\n` +
          `  revoke all on function public.${nama}(...) from public, anon, authenticated;`,
    ).toEqual([]);
  });
});

describe("kontrol positif predikat gerbang — PERMANEN, nol basis data", () => {
  // Pagar yang lahir hijau dan tidak pernah dibuktikan bisa merah terbaca
  // persis seperti pagar yang bekerja. Step 7 membuktikannya sekali, secara
  // manual, lalu buktinya dibuang bersama suntingan sementaranya — yang
  // tertinggal di repo hanya pagar yang lahir hijau. KETIGA kasus di bawah
  // adalah bukti yang TERTINGGAL, dan ia murni: nol sentuhan basis data
  // bersama, jadi sesi lain tidak terganggu.
  it("badan yang HANYA menyebut gerbang di dalam KOMENTAR ditolak", () => {
    const palsu = "begin\n  -- gerbangnya lewat auth.uid(), lihat migrasi 2026\n  return 1;\nend;";
    expect(bergerbang(palsu, "auth.uid")).toBe(false);
  });

  it("badan yang benar-benar memanggil gerbangnya diterima", () => {
    expect(bergerbang("select 1 from clients where user_id = auth.uid()", "auth.uid")).toBe(true);
    expect(bergerbang("if public.user_role() not in ('admin') then", "user_role")).toBe(true);
  });

  it("gerbang yang SALAH ditolak walau gerbang lain ada di badannya", () => {
    // Inilah yang membuat kolom "gerbang yang diharapkan" berarti:
    // `putuskan_pesanan_ditahan` memuat auth.uid() untuk mengambil nama
    // pemutus, dan itu TIDAK boleh menggantikan gerbang perannya.
    const badan = "select p.nama from profiles p where p.id = auth.uid();";
    expect(bergerbang(badan, "user_role")).toBe(false);
  });
});

describe("TERBUKA_SADAR — terbuka, tetapi menggerbangi dirinya sendiri", () => {
  it.each(NAMA_TERBUKA_SADAR)("fungsi %s ada di basis data", (nama) => {
    expect(cari(nama).length, `fungsi public.${nama} tidak ada di basis data`)
      .toBeGreaterThan(0);
  });

  it.each(NAMA_TERBUKA_SADAR)("authenticated BISA mengeksekusi %s", (nama) => {
    const tertutup = cari(nama).filter((f) => !f.authenticated_bisa);
    expect(
      tertutup.map((f) => f.tanda_tangan),
      tertutup.length === 0
        ? ""
        : `public.${nama} tertutup bagi authenticated, padahal ia memang harus\n` +
          `bisa dipanggil klien/staf lewat PostgREST. Menutupnya mematikan fitur\n` +
          `yang hidup — termasuk pengambilan produk gratis di produksi.`,
    ).toEqual([]);
  });

  it.each(NAMA_TERBUKA_SADAR)("%s memasang gerbang yang DIHARAPKAN untuknya", (nama) => {
    // INILAH pengikat yang sesungguhnya, dan ia menyebut gerbang MANA.
    // "auth.uid() atau user_role()" tidak bisa membedakan gerbang dari
    // penyebutan: `putuskan_pesanan_ditahan` memuat KEDUANYA hari ini, dan
    // yang kedua cuma mengambil nama pemutus untuk jejak. Dengan "salah satu",
    // menghapus gerbang yang benar tetap hijau lewat sisa yang lain.
    const gerbang = TERBUKA_SADAR[nama];
    const buta = cari(nama).filter((f) => !bergerbang(f.badan, gerbang));
    expect(
      buta.map((f) => f.tanda_tangan),
      buta.length === 0
        ? ""
        : `public.${nama} terbuka bagi authenticated TAPI badannya tidak memanggil\n` +
          `${gerbang}() — gerbang yang daftar ini nyatakan untuknya. Komentar tidak\n` +
          `dihitung: pemindainya membuang komentar lebih dulu. Fungsi terbuka yang\n` +
          `memercayai payload adalah fungsi yang bisa dipakai memberi produk kepada\n` +
          `orang lain.`,
    ).toEqual([]);
  });
});

describe("pengikat: setiap penulis tabel pesanan ada di TEPAT SATU daftar", () => {
  it("cetakan POLA_PENULIS mengenali penulis dan tidak menuduh pembaca", () => {
    // Pagar yang menguji pagarnya sendiri — pola yang salah menggandakan dirinya
    // diam-diam dan terbaca persis seperti pola yang bekerja.
    expect(POLA_PENULIS.test("insert into public.digital_entitlements (client_id) values ($1)")).toBe(true);
    expect(POLA_PENULIS.test("update public.orders set status = 'lunas'")).toBe(true);
    expect(POLA_PENULIS.test("insert into jejak_pesanan (pesanan_id) values ($1)")).toBe(true);
    expect(POLA_PENULIS.test("select * from public.orders where id = $1")).toBe(false);
    expect(POLA_PENULIS.test("update public.booking_requests set status = 'x'")).toBe(false);
    // Tanpa flag `g`: dua pemanggilan berturut-turut atas masukan yang sama
    // harus memberi jawaban yang sama.
    expect(POLA_PENULIS.test("update public.orders set status = 'lunas'")).toBe(true);
  });

  it("ada sekurangnya satu penulis yang terdeteksi", () => {
    // Anti-hampa kedua: `ambil_produk_gratis` sudah menulis
    // `digital_entitlements` sejak 20260921150000, jadi daftar kosong di sini
    // berarti pemindainya rusak, bukan repo yang bersih.
    const penulis = katalog.filter((f) => POLA_PENULIS.test(f.badan));
    expect(penulis.map((f) => f.nama)).toContain("ambil_produk_gratis");
  });

  it("tidak ada penulis yang berada di LUAR kedua daftar", () => {
    const daftar = new Set<string>([...MESIN_TERTUTUP, ...NAMA_TERBUKA_SADAR]);
    const yatim = [
      ...new Set(
        katalog.filter((f) => POLA_PENULIS.test(f.badan)).map((f) => f.nama),
      ),
    ]
      .filter((n) => !daftar.has(n))
      .sort();

    expect(
      yatim,
      yatim.length === 0
        ? ""
        : `Fungsi ini menulis orders/order_items/jejak_pesanan/digital_entitlements\n` +
          `tetapi tidak ada di daftar mana pun: ${yatim.join(", ")}.\n` +
          `Pilih SATU, dan pilihlah sadar:\n` +
          `  MESIN_TERTUTUP — tidak boleh dipanggil pemegang sesi; revoke ... from\n` +
          `                   public, anon, authenticated di migrasinya.\n` +
          `  TERBUKA_SADAR  — boleh dipanggil pemegang sesi, ASAL badannya memilih\n` +
          `                   barisnya dari auth.uid() atau bergerbang user_role().`,
    ).toEqual([]);
  });

  it("kedua daftar tidak beririsan", () => {
    const irisan = MESIN_TERTUTUP.filter((n) => (NAMA_TERBUKA_SADAR as readonly string[]).includes(n));
    expect(irisan, `nama ini ada di KEDUA daftar: ${irisan.join(", ")}`).toEqual([]);
  });

  it("nama di dalam daftar boleh BUKAN penulis — dan itu disengaja", () => {
    // `perpindahan_pesanan_sah` tidak menulis apa pun; ia penjaga transisi murni.
    // Ia tetap di MESIN_TERTUTUP karena membukanya berarti memberi tahu dunia
    // bentuk mesin statusnya secara cuma-cuma. Assertion ini mengunci bahwa
    // pengikat di atas TIDAK menuntut sebaliknya (yaitu: bukan `toEqual` atas
    // himpunan penulis), supaya `tolak_ubah_item_pesanan`,
    // `catat_notifikasi_ditolak`, dan `catat_notifikasi_tak_dikenal` —
    // ketiganya tertutup tetapi bukan penulis — tidak perlu masuk daftar mana
    // pun.
    const f = cari("perpindahan_pesanan_sah");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => !POLA_PENULIS.test(x.badan))).toBe(true);
  });
});
```

---

- [ ] **Step 6: Jalankan uji fungsi, catat hasilnya**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/fungsi-mesin-tertutup.test.ts
```

Bila Task 1–6 sudah memakai bentuk revoke ketat seperti yang diminta petanya, berkas ini
**lahir hijau** — kecuali tiga kasus di `describe("kontrol positif predikat gerbang …")`, yang
memang menguji predikatnya sendiri terhadap literal dan karena itu punya merahnya sendiri bila
`bergerbang()` salah tulis. Selebihnya belum membuktikan apa pun — Step 7 yang membuktikannya.

Bila ia merah di sini, bacalah pesannya: fungsi yang disebut memang masih terbuka, dan
migrasi yang melahirkannya harus diperbaiki (tambahkan `authenticated` ke baris
`revoke all on function ... from public, anon;`-nya) sebelum lanjut.

---

- [ ] **Step 7: Buktikan pagar itu BISA merah — dua sunting sementara**

Pagar yang lahir hijau dan tidak pernah dibuktikan bisa merah terbaca persis seperti
pagar yang bekerja. Dua sunting berikut hanya menyentuh berkas uji — **nol perubahan
basis data**, jadi sesi lain yang memakai Supabase lokal yang sama tidak terganggu.

**(a) Buktikan assertion hak benar-benar membaca katalog.** Pindahkan sementara
`"ambil_produk_gratis"` dari `TERBUKA_SADAR` ke `MESIN_TERTUTUP`, lalu:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/fungsi-mesin-tertutup.test.ts
```

Harus MERAH di `authenticated TIDAK bisa mengeksekusi ambil_produk_gratis`, dengan
pesan yang menyebut tanda tangannya. **Kembalikan ke posisi semula.**

**(b) Buktikan pengikatnya bekerja.** Hapus sementara `"salurkan_pesanan"` dari
`MESIN_TERTUTUP`, lalu jalankan perintah yang sama.

Harus MERAH di `tidak ada penulis yang berada di LUAR kedua daftar`, dengan pesan
`Fungsi ini menulis ... tetapi tidak ada di daftar mana pun: salurkan_pesanan.`
**Kembalikan ke posisi semula.**

**(c) Buktikan kolom gerbangnya mengikat.** Ubah sementara
`putuskan_pesanan_ditahan: "user_role"` menjadi `"auth.uid"` — lalu balik: ubah
`buat_pesanan: "auth.uid"` menjadi `"user_role"`.

Yang PERTAMA harus tetap HIJAU (badan `putuskan_pesanan_ditahan` memang memuat `auth.uid()`,
untuk mengambil nama pemutus) — dan itulah demonstrasi kenapa "salah satu dari dua" tidak
mengikat apa pun. Yang KEDUA harus MERAH: `buat_pesanan` nol `user_role()`.
**Kembalikan keduanya.**

Berbeda dengan (a) dan (b), bukti untuk (c) **tertinggal di repo** dalam bentuk ketiga kasus
`describe("kontrol positif predikat gerbang …")`: ia mengadu `bergerbang()` dengan literal,
termasuk badan yang menyebut gerbangnya HANYA di dalam komentar. Tanpa kasus permanen itu, satu
baris `-- gerbangnya lewat user_role()` di badan `$$` mana pun sudah cukup meluluskan fungsi
apa pun, selamanya.

---

- [ ] **Step 8: Jalankan kedua uji, pastikan LULUS**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run tests/fungsi-mesin-tertutup.test.ts tests/env-terdokumentasi.test.ts
```

Dua berkas hijau seluruhnya. Pastikan `git diff tests/fungsi-mesin-tertutup.test.ts`
tidak menyisakan satu pun sunting sementara dari Step 7.

**Lalu SELURUH suite Tugas 1–7 sekali jalan — inilah titik berhenti dokumen ini** (peta §17):

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx vitest run \
  tests/pesanan-status-db.test.ts tests/pesanan-nota-beku.test.ts \
  tests/pesanan-teks-tanpa-nominal.test.ts tests/pesanan-jejak-yatim.test.ts \
  tests/pesanan-checkout-db.test.ts tests/pesanan-akses-tiga-keadaan.test.ts \
  tests/pesanan-rekonsiliasi-entitlement.test.ts tests/produk-ambil-gratis.test.ts \
  tests/money-firewall-struktural.test.ts tests/struktur-rls.test.ts tests/grant-anon.test.ts \
  tests/hak-hapus-berlebih.test.ts tests/hak-default-sequence-fungsi.test.ts \
  tests/jejak-yatim.test.ts tests/inventaris-rute.test.ts \
  tests/fungsi-mesin-tertutup.test.ts tests/env-terdokumentasi.test.ts
```

Seluruhnya HIJAU, dan `inventaris-rute` ikut justru untuk membuktikan hal yang TIDAK terjadi:
Tugas 1–7 melahirkan **nol rute, nol halaman, nol komponen**, jadi tabel rute README tidak
tersentuh sama sekali. Sesudah titik ini, dokumen kedua (Tugas 8–12) yang membuka permukaan
pengguna pertama.

---

- [ ] **Step 9: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma && git add web/tests/fungsi-mesin-tertutup.test.ts web/tests/env-terdokumentasi.test.ts web/.env.example && git commit -F - <<'PESAN'
test(pesanan): daftar putih fungsi mesin + env yang dipaksa terdokumentasi

Dua pagar, nol migrasi.

Fungsi baru LAHIR TERBUKA untuk setiap pengguna login (dibuktikan
hak-default-sequence-fungsi.test.ts:158,253), dan templat aturan [F] repo
ini sendiri menulis "revoke ... from public, anon" tanpa authenticated —
jadi implementer yang mengikuti templat rumah membuka pintu dan suite
tetap hijau. Hak per-fungsi sebelumnya hanya dijaga di dua tempat
(tenggat-bayar.test.ts:155, varian-struktur.test.ts:105): dua contoh yang
harus diingat satu per satu. Kini daftar yang dipaksa lengkap — setiap
fungsi yang menulis orders/order_items/jejak_pesanan/digital_entitlements
wajib ada di TEPAT SATU dari MESIN_TERTUTUP atau TERBUKA_SADAR, dan yang
terbuka wajib memeriksa sendiri pemanggilnya lewat auth.uid()/user_role().

CRON_SECRET sudah dibaca api/cron/tenggat sejak rute itu lahir dan tidak
pernah ada di .env.example. Rute itu fail-closed, jadi env yang lupa
dipasang tidak melahirkan galat konfigurasi melainkan 401 yang terlihat
seperti "penjadwalnya salah rahasia". Uji kedua menutup kelas itu, satu
arah saja supaya keempat env Midtrans boleh mendarat sebelum pembacanya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
PESAN
```

---