# Tagihan bernominal, email tagihan, & katalog pesan layanan — rencana implementasi

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development (disarankan) atau superpowers:executing-plans untuk mengeksekusi rencana ini tugas demi tugas. Langkah memakai sintaks kotak centang (`- [ ]`).

**Goal:** Membuat total tagihan benar-benar terhitung dan terbaca — di layar admin, di layar klien, di pesan WhatsApp, dan lewat email yang terkirim otomatis — lalu merombak halaman pesan layanan menjadi katalog berharga.

**Architecture:** Tidak ada nominal baru yang disimpan. Total tetap diturunkan dari `variant_rates` + `transport_rates` menurut tanggal sesi. Kebuntuan >20 km dibuka dengan memberi jenjang itu tarif dasar di rate card, sementara `transport_khusus` tetap hidup sebagai penimpa per kasus milik owner. Email dikirim lewat HTTP API Resend dari modul yang tidak pernah melempar.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres + RLS + PostgREST), TypeScript, Tailwind v4, Vitest, Playwright (E2E lewat `tsx`).

**Spec:** `docs/superpowers/specs/2026-09-09-padma-tagihan-email-katalog-design.md`

---

## Global Constraints

Setiap tugas di bawah tunduk pada seluruh butir ini. Baca semuanya sebelum tugas pertama.

- **MODE NOL UJI BARU.** Pemilik repo memilihnya secara eksplisit demi kecepatan. **Jangan menulis satu pun berkas uji baru dan jangan menambah `it(...)` baru.** Ini menggantikan langkah TDD bawaan skill: setiap tugas berpola *implementasi → jalankan uji yang ada → perbaiki yang merah → commit*.
- **Menyesuaikan uji yang SUDAH ADA agar cocok dengan perilaku baru yang disengaja itu wajib, dan itu bukan "uji baru".** Yang dilarang adalah menambah cakupan baru.
- **DUA berkas uji tidak boleh disesuaikan sama sekali:** `tests/money-firewall-struktural.test.ts` dan `tests/tagihan-baca-hak.test.ts`. Keduanya menjaga batas yang pekerjaan ini tidak berhak menggeser. Bila salah satunya merah, yang salah adalah kodenya.
- **Basis data Supabase lokal dipakai bersama sesi lain.** Jangan menjalankan `npm run db:recover` atau `npx supabase db reset` tanpa memberi tahu pemilik repo lebih dulu. Untuk memuat migrasi baru, pakai `npx supabase migration up`.
- **Jangan pernah `supabase db push`** ke proyek mana pun. Proyek ini belum pernah rilis.
- **Money firewall.** Kolom nominal uang hanya boleh hidup di `variant_rates`, `honor_marks`, `transport_rates`, `transport_khusus`. Jangan menambah kolom bernominal ke tabel mana pun. `honor_mitra` tidak pernah keluar dari `variant_rates`/`transport_rates` menuju permukaan admin atau klien.
- **Berkas yang dilarang memuat identifier `formatRupiah`** (dijaga uji sumber, jangan dilanggar): apa pun di `src/app/_shell/panel/**`, plus dasbor admin, agenda, tren, dan hak-tukar. Berkas yang **boleh**: `src/app/admin/sesi/**` (nominal sudah lewat sana sejak C2 untuk pesan WhatsApp) dan `src/app/passport/**`.
- **`src/app/admin/**` tidak boleh memuat `createAdminSupabase`** (service role). Bila butuh service role, kerjakan di `src/lib/**`.
- **`src/lib/tagihan/pesan-tagihan.ts` dan `src/lib/tagihan/email-tagihan.ts` WAJIB murni — nol baris `import`.** Keduanya dipakai dari halaman yang merender komponen `"use client"`; satu impor bermodul Supabase menyeret service role ke bundel peramban. Dijaga `tests/pesan-tagihan.test.ts`.
- **Bahasa.** Seluruh identifier, komentar, pesan commit, dan teks layar berbahasa Indonesia. Ikuti gaya komentar repo: jelaskan **kenapa**, bukan **apa**.
- **Format rupiah** selalu lewat `formatRupiah()` dari `@/lib/rupiah-publik`. Jangan menulis penyisip titik ribuan sendiri.
- **Label varian** selalu lewat `labelVarian()` dari `@/lib/varian`. Jangan menulis perangkai kedua.
- **Nama status** selalu dari `@/lib/jadwal/status`. Jangan menulis literal `"menunggu_bayar"` di luar berkas itu (dijaga `tests/status-satu-sumber.test.ts`).
- Perintah dijalankan dari `web/`: `npm test`, `npm run lint`, `npm run build`.

### Uji yang diperkirakan merah, per tugas

Dicatat di muka supaya tidak dikira kerusakan tak sengaja. 10 berkas menyentuh `di_atas_20`; periksa satu per satu, jangan diasumsikan aman.

`tests/transport-tarif-pengerasan.test.ts`, `tests/tagihan-pengajuan.test.ts`, `tests/pesan-tagihan.test.ts`, `tests/passport-turunan.test.ts`, `tests/owner-transport.test.ts`, `tests/transport-saran.test.ts`, `tests/admin-bayar.test.ts`, `tests/owner-rekap-halaman.test.ts`, `tests/transport-jarak.test.ts`, `tests/owner-rekap.test.ts`, `tests/transport-alamat-struktur.test.ts`, `tests/e2e/owner.e2e.ts`, `tests/e2e/bayar-pengajuan.e2e.ts`.

---

## Peta berkas

**Dibuat:**

| Berkas | Tanggung jawab |
|---|---|
| `web/supabase/migrations/20260914100000_tarif_dasar_di_atas_20.sql` | Cabut CHECK `transport_rates_bukan_per_kasus`; perbarui komentar tabel `transport_khusus` |
| `web/supabase/migrations/20260914110000_jejak_email_tagihan.sql` | Kolom `booking_requests.email_tagihan_pada timestamptz` |
| `web/src/lib/email/kirim.ts` | Satu-satunya jalur keluar email. `server-only`, tidak pernah melempar, gagal-tertutup terhadap env |
| `web/src/lib/tagihan/email-tagihan.ts` | Perender subjek + HTML + teks polos tagihan. **MURNI, nol impor** |
| `web/src/app/passport/ajukan/katalog.tsx` | Pemilih layanan berbentuk katalog (komponen klien) |
| `web/src/app/passport/ajukan/ringkasan.tsx` | Blok ringkasan biaya lengket (komponen klien) |

**Diubah:**

| Berkas | Perubahan |
|---|---|
| `web/supabase/seed.sql:136-141` | Tambah baris `transport_rates` `di_atas_20` |
| `web/supabase/seed.sql:146-148` | Beri mitra seed `lat`/`lon` Malang |
| `web/src/lib/transport/tarif.ts:36-41` | `JENJANG_TARIF_RATE_CARD` memuat `di_atas_20`; dokblok diperbarui |
| `web/src/lib/tagihan/pengajuan.ts` | Cabang `di_atas_20` jatuh ke rate card; tipe `SebabTagihanTakLengkap` + dua peta kalimat |
| `web/src/lib/tagihan/baca.ts` | Hapus bacaan `transport_khusus` yang mati; teruskan `sebab` |
| `web/src/lib/admin/tagihan-pengajuan.ts` | Pulangkan rincian + `sebab`, bukan hanya `total` |
| `web/src/lib/tagihan/pesan-tagihan.ts` | Pesan WhatsApp memuat rincian |
| `web/src/app/admin/sesi/aksi.ts` | `terbitkanTagihan()`: gerbang total + kirim email; `kirimUlangEmailTagihan()` baru |
| `web/src/app/admin/sesi/page.tsx` | Rakit rincian untuk panel & pesan WA |
| `web/src/app/admin/sesi/panel-permintaan.tsx` | Blok Tagihan: rincian, sebab, status email |
| `web/src/app/admin/sesi/aksi-permintaan.tsx` | Tombol "Kirim ulang email" |
| `web/src/app/passport/bayar/page.tsx` | Teruskan rincian ke kartu |
| `web/src/app/passport/bayar/kartu-tagihan.tsx` | Rincian berbaris, `data-total` dipertahankan |
| `web/src/app/passport/ajukan/page.tsx` | Baca `harga_publik`; oper ke katalog |
| `web/src/app/passport/ajukan/form.tsx` | Pakai katalog & ringkasan; kontrak FormData TIDAK berubah |
| `web/.env.example` | `RESEND_API_KEY`, `EMAIL_PENGIRIM` |

---

## Task 1: Tarif dasar `di_atas_20` & koordinat mitra seed

Membuka kebuntuan struktural §1.3 spec, dan mematikan penyebab langsung "Total: menyusul dari tim" di lingkungan pengembangan.

**Files:**
- Create: `web/supabase/migrations/20260914100000_tarif_dasar_di_atas_20.sql`
- Modify: `web/supabase/seed.sql:136-141`, `web/supabase/seed.sql:146-148`
- Modify: `web/src/lib/transport/tarif.ts:28-41`
- Modify: `web/tests/transport-tarif-pengerasan.test.ts:150-161`

**Interfaces:**
- Consumes: —
- Produces: `JENJANG_TARIF_RATE_CARD` kini memuat kelima jenjang termasuk `di_atas_20`. Tugas berikutnya bergantung pada `tarifTransportPadaTanggal()` bisa memulangkan baris untuk `di_atas_20`.

- [ ] **Step 1: Tulis migrasinya**

Buat `web/supabase/migrations/20260914100000_tarif_dasar_di_atas_20.sql`:

```sql
-- ============================================================================
-- TARIF DASAR UNTUK `di_atas_20` — PELAPISAN, BUKAN PEMBALIKAN RULING 6
-- ============================================================================
-- CHECK `transport_rates_bukan_per_kasus` lahir dari review red-team yang
-- membuktikan doktrin ">20 km bukan tarif" tidak menghalangi apa pun selama ia
-- hanya hidup sebagai komentar tabel. Doktrin itu benar untuk masalah yang
-- dilihatnya, dan SALAH untuk masalah yang belum terlihat waktu itu:
--
--   pengajuan >20 km
--     -> tarifnya milik owner per kasus, disimpan per SESI (transport_khusus)
--     -> sesi baru lahir SESUDAH lunas (konfirmasi_permintaan menuntut 'lunas')
--     -> untuk lunas, tagihannya harus terbit
--     -> untuk terbit, tarifnya harus ada
--     -> tarifnya baru bisa ditetapkan kalau sesinya ada
--
-- Lingkaran tertutup: SETIAP klien yang tinggal lebih dari 20 km dari bidannya
-- tidak akan pernah bisa memesan. Itu bukan pagar uang, itu fitur yang mati.
--
-- Yang diputuskan karena itu BUKAN "di_atas_20 sama seperti jenjang lain",
-- melainkan DUA LAPIS:
--
--   1. `transport_rates` memuat tarif DASAR `di_atas_20` — supaya tagihan
--      selalu bisa terbit dan klien selalu tahu berapa yang harus dibayar;
--   2. `transport_khusus` TETAP HIDUP dan TETAP MENANG bila ada — supaya 80 km
--      tidak pernah tertagih sama dengan 25 km.
--
-- Kekhawatiran Ruling 6 ("dua sumber kebenaran untuk nominal yang sama") tidak
-- kembali, karena urutannya ditetapkan dan hanya ada satu: penimpa dulu, baru
-- tarif dasar. Aturan itu hidup di `hitungTagihanPengajuan()`
-- (src/lib/tagihan/pengajuan.ts) sebagai SATU cabang, bukan tersebar.
--
-- Tabel ini tetap append-only berjenjang. Migrasi ini SENGAJA tidak menyisipkan
-- satu baris tarif pun: nominal adalah keputusan owner, dan migrasi yang
-- membawa angka uang menjadikan angka itu bagian dari SKEMA — tidak bisa
-- diubah tanpa migrasi berikutnya, dan tercatat di riwayat git alih-alih di
-- `berlaku_sejak`. Barisnya masuk lewat `seed.sql` untuk pengembangan dan lewat
-- panel owner /owner/transport untuk produksi.

alter table public.transport_rates
  drop constraint transport_rates_bukan_per_kasus;

comment on table public.transport_rates is
  'Rate card transport per jenjang jarak, append-only berjenjang. Termasuk '
  '`di_atas_20` sebagai tarif DASAR sejak migrasi tarif_dasar_di_atas_20 — '
  'lihat komentar di berkas migrasi itu untuk alasannya. Owner menimpanya per '
  'kasus lewat `transport_khusus`, dan penimpa selalu menang.';

comment on table public.transport_khusus is
  'PENIMPA per kasus atas tarif dasar `di_atas_20` di `transport_rates`, '
  'ditetapkan owner per SESI. Sebelum migrasi tarif_dasar_di_atas_20 tabel ini '
  'adalah SATU-SATUNYA sumber nominal >20 km, dan itulah yang membuat pengajuan '
  '>20 km tidak pernah bisa ditagih. Sekarang ia opsional: ketiadaannya berarti '
  'tarif dasar yang berlaku, bukan tagihan yang tertahan.';
```

- [ ] **Step 2: Muat migrasinya**

```bash
cd web && npx supabase migration up
```

Harapan: sukses tanpa galat. Bila `supabase` belum jalan, tanyakan pemilik repo lebih dulu — basis data lokal ini dipakai bersama.

- [ ] **Step 3: Buka `JENJANG_TARIF_RATE_CARD`**

Di `web/src/lib/transport/tarif.ts`, ganti dokblok + konstanta di baris 28-41 dengan:

```ts
/**
 * Jenjang yang boleh punya baris `transport_rates`.
 *
 * `di_atas_20` BERGABUNG di migrasi `tarif_dasar_di_atas_20`. Doktrin lama
 * (">20 km adalah KETIADAAN tarif, nominalnya per kasus di `transport_khusus`")
 * benar untuk masalah yang dilihatnya dan salah untuk yang belum terlihat:
 * `transport_khusus` berkunci `session_id`, sesi baru lahir sesudah lunas, dan
 * lunas menuntut tagihan yang tidak pernah bisa terbit. Setiap klien >20 km
 * tersangkut permanen.
 *
 * Yang berlaku sekarang: rate card memberi tarif DASAR supaya tagihan selalu
 * bisa terbit; `transport_khusus` tetap menimpanya per kasus bila owner
 * menetapkannya. Urutannya ditetapkan di SATU tempat —
 * `hitungTagihanPengajuan()` di `lib/tagihan/pengajuan.ts`.
 *
 * Konstanta ini menggerakkan layar owner (`/owner/transport` merender satu
 * kartu per anggota), penjagaan `simpanTarifTransport()`, dan daftar
 * "tarif belum ditetapkan" di `lib/owner/data.ts`. Menambah `di_atas_20` di
 * sini karena itu sekaligus memberi owner layar untuk menetapkannya.
 */
export const JENJANG_TARIF_RATE_CARD: readonly JenjangTransport[] = [
  "0_5",
  "5_10",
  "10_15",
  "15_20",
  "di_atas_20",
];
```

- [ ] **Step 4: Seed — tarif `di_atas_20` & koordinat mitra**

Di `web/supabase/seed.sql`, ubah blok baris 136-141 menjadi:

```sql
insert into transport_rates (jenjang, tarif_klien, honor_mitra) values
  ('0_5',           0, 10000),
  ('5_10',      10000, 10000),
  ('10_15',     20000, 15000),
  ('15_20',     30000, 20000),
  -- Tarif DASAR >20 km (migrasi tarif_dasar_di_atas_20). Angka pengembangan;
  -- produksi menetapkannya sendiri lewat /owner/transport. Owner menimpanya
  -- per kasus di `transport_khusus` untuk jarak yang menuntutnya.
  ('di_atas_20', 45000, 30000)
  on conflict (jenjang, berlaku_sejak) do nothing;
```

Lalu ubah blok baris 146-148 menjadi:

```sql
-- KOORDINAT WAJIB, bukan hiasan. Tanpa `lat`/`lon`, jenjang transport tidak
-- bisa dihitung, `hitungTagihanPengajuan()` memulangkan total NULL, dan SETIAP
-- pesan tagihan berbunyi "Total: menyusul dari tim". Mitra seed sebelumnya
-- tidak punya keduanya, dan itulah sebab langsung gejala tersebut di seluruh
-- lingkungan pengembangan & demo.
--
-- Titiknya di Malang, sekitar wilayah layanan PADMA. Untuk produksi berlaku
-- aturan yang sama dan lebih keras: setiap mitra wajib punya pin di peta
-- (form /admin/mitra sudah punya pemilihnya) SEBELUM tagihan pertama terbit.
insert into partners (id, nama, no_hp, lat, lon) values
  ('33333333-3333-3333-3333-333333333301','Bidan Sri Wahyuni','0811-0000-0001',-7.966620,112.632632),
  ('33333333-3333-3333-3333-333333333302','Bidan Dewi Lestari','0811-0000-0002',-7.947500,112.615000);
```

- [ ] **Step 5: Sesuaikan uji constraint yang kini sengaja berubah**

Di `web/tests/transport-tarif-pengerasan.test.ts`, ganti seluruh blok `it(...)` di baris 141-161 (termasuk komentar di atasnya) dengan versi yang menguji perilaku BARU. Ini penyesuaian uji yang ada, bukan uji baru:

```ts
  /**
   * DOKTRINNYA BERUBAH di migrasi `tarif_dasar_di_atas_20`, dan uji ini berubah
   * bersamanya — bukan dihapus.
   *
   * Yang dulu dijaga: `di_atas_20` TIDAK BOLEH punya baris di sini, karena
   * nominalnya per kasus di `transport_khusus`. Itu benar untuk kebocoran yang
   * dilihat Ruling 6, dan salah untuk kebuntuan yang belum terlihat waktu itu:
   * `transport_khusus` berkunci `session_id`, sesi lahir sesudah lunas, dan
   * lunas menuntut tagihan yang tidak pernah bisa terbit.
   *
   * Yang dijaga SEKARANG: barisnya boleh ada, dan seluruh pagar uang lain
   * tabel ini TIDAK ikut longgar bersamanya — append-only tetap append-only.
   */
  it("menerima baris di_atas_20 sebagai tarif dasar", async () => {
    await expect(
      querySql(
        `insert into transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
           values ('di_atas_20', 99999, 88888, '2099-01-01')`,
      ),
    ).resolves.toBeDefined();

    await querySql(
      `delete from transport_rates where jenjang = 'di_atas_20' and berlaku_sejak = '2099-01-01'`,
    );
  });
```

Bila berkas itu tidak mengimpor `querySql` dengan nama itu, pakai nama yang sudah dipakai berkas tersebut — jangan menambah impor baru.

- [ ] **Step 6: Jalankan uji yang terdampak**

```bash
cd web && npx vitest run tests/transport-tarif-pengerasan.test.ts tests/transport-jarak.test.ts tests/owner-transport.test.ts tests/owner-rekap.test.ts tests/owner-rekap-halaman.test.ts tests/transport-saran.test.ts tests/transport-alamat-struktur.test.ts
```

Harapan: hijau. Yang paling mungkin merah adalah asersi yang mengharapkan `JENJANG_TARIF_RATE_CARD` berisi tepat 4 anggota, atau daftar "tarif belum ditetapkan" yang kini berisi satu jenjang lagi. Perbaiki asersinya agar mencerminkan lima jenjang — jangan mengecilkan konstantanya kembali.

- [ ] **Step 7: Jalankan suite penuh**

```bash
cd web && npm test 2>&1 | tail -30
```

Harapan: 0 gagal. `tests/money-firewall-struktural.test.ts` **wajib** hijau tanpa disentuh — migrasi ini tidak menambah kolom nominal ke mana pun.

- [ ] **Step 8: Commit**

```bash
cd web && git add supabase/migrations/20260914100000_tarif_dasar_di_atas_20.sql supabase/seed.sql src/lib/transport/tarif.ts tests/transport-tarif-pengerasan.test.ts
git commit -m "feat(transport): tarif dasar di_atas_20 & koordinat mitra seed

Membuka kebuntuan struktural: transport_khusus berkunci session_id, sesi
lahir sesudah lunas, lunas menuntut tagihan yang tidak pernah bisa terbit.
Rate card memberi tarif dasar; transport_khusus tetap menimpanya per kasus.

Mitra seed tanpa lat/lon adalah sebab langsung 'Total: menyusul dari tim'
di seluruh lingkungan pengembangan."
```

---

## Task 2: Rincian & sebab pada lapisan hitung

Membuat "kenapa totalnya tidak ada" jadi nilai bertipe, bukan tebakan.

**Files:**
- Modify: `web/src/lib/tagihan/pengajuan.ts`
- Modify (bila merah): `web/tests/tagihan-pengajuan.test.ts`

**Interfaces:**
- Consumes: `tarifTransportPadaTanggal()` yang kini melayani `di_atas_20` (Task 1).
- Produces:
  - `export type SebabTagihanTakLengkap = "mitra_tanpa_titik" | "alamat_tanpa_pin" | "tarif_varian_kosong" | "tarif_transport_kosong"`
  - `RincianTagihan` bertambah medan `sebab: SebabTagihanTakLengkap | null` dan `jenjang: JenjangTransport | null`
  - `hitungTagihanPengajuan()` input bertambah `sebabJenjangNull?: "mitra_tanpa_titik" | "alamat_tanpa_pin"`
  - `export const KALIMAT_SEBAB_ADMIN: Record<SebabTagihanTakLengkap, string>`
  - `export const KALIMAT_SEBAB_KLIEN: Record<SebabTagihanTakLengkap, string>`
  - Medan `menungguTarifKhusus` **dipertahankan** demi pemanggil lama, tetapi kini hanya benar bila tarif dasar `di_atas_20` sendiri belum ada.

- [ ] **Step 1: Tambahkan tipe sebab & peta kalimatnya**

Di `web/src/lib/tagihan/pengajuan.ts`, tepat sesudah blok `import`, sisipkan:

```ts
/**
 * KENAPA sebuah tagihan belum lengkap — sebagai nilai bertipe, bukan kalimat.
 *
 * Sebab dipisahkan dari kalimatnya karena satu sebab dibaca DUA orang dengan
 * kebutuhan berbeda: admin perlu tahu layar mana yang memperbaikinya, klien
 * perlu tahu apakah ia harus melakukan sesuatu (ia tidak). Menyimpan kalimatnya
 * saja berarti kalimat admin bocor ke layar klien, atau dua sumber kebenaran
 * lahir untuk keadaan yang sama.
 *
 * `mitra_tanpa_titik` dan `alamat_tanpa_pin` TIDAK bisa dibedakan fungsi murni
 * ini — keduanya sampai ke sini sebagai `jenjang === null` yang identik.
 * Pemanggilnya yang tahu koordinat mana yang hilang, dan ia menyebutkannya
 * lewat `sebabJenjangNull`.
 */
export type SebabTagihanTakLengkap =
  | "mitra_tanpa_titik"
  | "alamat_tanpa_pin"
  | "tarif_varian_kosong"
  | "tarif_transport_kosong";

/** Kalimat untuk ADMIN: menyebut akibat DAN layar yang memperbaikinya. */
export const KALIMAT_SEBAB_ADMIN: Record<SebabTagihanTakLengkap, string> = {
  mitra_tanpa_titik:
    "Bidan yang ditetapkan belum punya titik di peta, jadi jaraknya tidak bisa dihitung. Lengkapi di menu Mitra.",
  alamat_tanpa_pin:
    "Alamat permintaan ini belum berpin, jadi jaraknya tidak bisa dihitung. Jatuhkan pin di peta pada blok Alamat kunjungan di atas.",
  tarif_varian_kosong:
    "Belum ada tarif varian yang berlaku pada tanggal sesi ini. Owner menetapkannya di menu Tarif.",
  tarif_transport_kosong:
    "Belum ada tarif transport yang berlaku untuk jenjang jarak ini pada tanggal sesi. Owner menetapkannya di menu Transport.",
};

/**
 * Kalimat untuk KLIEN. Tidak satu pun menyebut nama layar internal atau
 * menyuruh klien melakukan sesuatu: tidak ada satu pun sebab di atas yang bisa
 * ia perbaiki sendiri, dan menyuruhnya mencoba hanya membuatnya merasa salah.
 */
export const KALIMAT_SEBAB_KLIEN: Record<SebabTagihanTakLengkap, string> = {
  mitra_tanpa_titik: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  alamat_tanpa_pin: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  tarif_varian_kosong: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  tarif_transport_kosong:
    "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
};
```

- [ ] **Step 2: Perluas `RincianTagihan`**

Ganti tipe `RincianTagihan` yang ada dengan:

```ts
export type RincianTagihan = {
  /** Harga layanan menurut varian & tanggal sesi. `null` = tarifnya belum ada. */
  layanan: number | null;
  /** Tarif transport menurut jenjang & tanggal sesi. */
  transport: number | null;
  /**
   * Jenjang jarak yang dipakai, supaya pemanggil bisa menampilkannya (mis.
   * ">10–15 km") tanpa menghitung ulang jaraknya sendiri — dua perhitungan
   * jarak yang harus sepakat sudah cukup satu pasang.
   */
  jenjang: JenjangTransport | null;
  /**
   * Sejak migrasi `tarif_dasar_di_atas_20`, ini TIDAK LAGI keadaan normal bagi
   * pengajuan jarak jauh. Ia sekarang berarti satu hal saja: tarif DASAR
   * `di_atas_20` sendiri belum pernah ditetapkan owner. Medannya dipertahankan
   * supaya pemanggil lama tidak perlu diubah serentak.
   */
  menungguTarifKhusus: boolean;
  /** Total yang harus dibayar. `null` bila salah satu bagiannya belum diketahui. */
  total: number | null;
  /** Terisi PERSIS ketika `total === null`. Lihat `SebabTagihanTakLengkap`. */
  sebab: SebabTagihanTakLengkap | null;
};
```

- [ ] **Step 3: Tulis ulang badan `hitungTagihanPengajuan()`**

Ganti tanda tangan & badan fungsinya (mulai dari `export function hitungTagihanPengajuan` sampai penutupnya) dengan:

```ts
export function hitungTagihanPengajuan(input: {
  variantId: string;
  /** Tanggal SESI, bukan tanggal hari ini — itulah yang mengunci tarifnya. */
  tanggal: string;
  jenjang: JenjangTransport | null;
  /**
   * Sebab `jenjang` kosong, disebutkan pemanggil karena hanya ia yang tahu
   * koordinat mana yang hilang. Bawaannya `alamat_tanpa_pin` — bukan pilihan
   * sembarang: mitra tanpa titik dicegah lebih awal oleh form mitra yang sudah
   * mewajibkan pin, sedangkan alamat tanpa pin adalah keadaan yang memang lahir
   * normal dari geocoding Malang yang sebagian besar gagal.
   */
  sebabJenjangNull?: "mitra_tanpa_titik" | "alamat_tanpa_pin";
  /** Nominal >20 km yang ditetapkan owner PER KASUS — MENIMPA tarif dasar. */
  transportKhusus?: number | null;
  tarif: readonly BarisTarif[];
  tarifTransport: readonly BarisTarifTransport[];
}): RincianTagihan {
  const {
    variantId,
    tanggal,
    jenjang,
    transportKhusus = null,
    sebabJenjangNull = "alamat_tanpa_pin",
  } = input;

  const barisTarif = tarifPadaTanggal(
    // `honorMitra` & `hargaCoret` diisi nilai netral: keduanya bagian bentuk
    // `TarifRingkas` tetapi tidak menyentuh perhitungan tagihan KLIEN sama
    // sekali. Honor mitra khususnya TIDAK BOLEH ikut dibaca di sini.
    input.tarif.map((t) => ({
      id: "",
      variantId: t.variantId,
      hargaKlien: t.hargaKlien,
      hargaCoret: null,
      honorMitra: 0,
      berlakuSejak: t.berlakuSejak,
    })),
    variantId,
    tanggal,
  );
  const layanan = barisTarif?.hargaKlien ?? null;

  // Jenjang belum diketahui: tagihan belum lengkap, dan itu bukan Rp0.
  if (jenjang === null) {
    return {
      layanan,
      transport: null,
      jenjang: null,
      menungguTarifKhusus: false,
      total: null,
      sebab: sebabJenjangNull,
    };
  }

  // PENIMPA DULU, BARU TARIF DASAR — dan urutannya hidup HANYA di sini.
  //
  // Sejak migrasi `tarif_dasar_di_atas_20`, `di_atas_20` punya baris rate card
  // seperti jenjang lain. `transport_khusus` tidak dibubarkan bersamanya: ia
  // jadi PENIMPA per kasus, supaya 80 km tidak tertagih sama dengan 25 km.
  // Kekhawatiran Ruling 6 ("dua sumber kebenaran untuk satu nominal") ditutup
  // dengan menetapkan urutannya di SATU cabang, bukan dengan meniadakan salah
  // satunya — dan cabang itu adalah tiga baris di bawah ini.
  const transport =
    transportKhusus ??
    tarifTransportPadaTanggal(
      input.tarifTransport.map((t) => ({
        id: "",
        jenjang: t.jenjang,
        tarifKlien: t.tarifKlien,
        honorMitra: 0,
        berlakuSejak: t.berlakuSejak,
      })),
      jenjang,
      tanggal,
    )?.tarifKlien ??
    null;

  // Sebab dipilih dengan urutan tetap: tarif layanan lebih dulu, karena itu
  // yang paling sering hilang (varian baru yang tarifnya belum ditetapkan) dan
  // karena admin hanya bisa menindak satu hal pada satu waktu.
  const sebab: SebabTagihanTakLengkap | null =
    layanan === null
      ? "tarif_varian_kosong"
      : transport === null
        ? "tarif_transport_kosong"
        : null;

  return {
    layanan,
    transport,
    jenjang,
    // Nilainya kini SEMPIT: ">20 km, dan tarif dasarnya pun belum ada".
    menungguTarifKhusus: jenjang === "di_atas_20" && transport === null,
    total: layanan === null || transport === null ? null : layanan + transport,
    sebab,
  };
}
```

- [ ] **Step 4: Perbarui dokblok berkas**

Di dokblok atas berkas, ganti butir yang menjelaskan `di_atas_20` sebagai "ketiadaan tarif" dengan:

```
 * `di_atas_20` PUNYA tarif dasar sejak migrasi `tarif_dasar_di_atas_20`, dan
 * `transport_khusus` menimpanya per kasus. Urutan itu hidup di SATU cabang di
 * bawah — jangan menuliskannya kedua kali di lapisan baca.
```

- [ ] **Step 5: Jalankan uji yang terdampak**

```bash
cd web && npx vitest run tests/tagihan-pengajuan.test.ts tests/passport-turunan.test.ts tests/admin-bayar.test.ts
```

Harapan: asersi lama yang mengharapkan `di_atas_20` selalu `total: null` kini merah. Sesuaikan asersinya ke perilaku baru: dengan baris tarif dasar tersedia, totalnya terisi; tanpa baris tarif dasar dan tanpa penimpa, `menungguTarifKhusus === true` dan `sebab === "tarif_transport_kosong"`.

- [ ] **Step 6: Kompilasi & suite penuh**

```bash
cd web && npx tsc --noEmit && npm test 2>&1 | tail -30
```

Harapan: 0 galat tipe, 0 uji gagal. Pemanggil yang belum mengisi medan baru tetap kompilasi karena keduanya hanya ditambahkan pada nilai balik.

- [ ] **Step 7: Commit**

```bash
cd web && git add src/lib/tagihan/pengajuan.ts tests/tagihan-pengajuan.test.ts
git commit -m "feat(tagihan): sebab bertipe & tarif dasar >20 km pada lapisan hitung

Penimpa per kasus menang atas tarif dasar, dan urutannya hidup di SATU
cabang. 'Kenapa totalnya tidak ada' kini nilai bertipe, bukan tebakan —
itulah yang membuat kegagalannya bisa ditampilkan, bukan senyap."
```

---

## Task 3: Lapisan baca memulangkan rincian

Menghapus bacaan yang tidak akan pernah cocok, dan membawa rincian ke kedua pemanggil.

**Files:**
- Modify: `web/src/lib/tagihan/baca.ts`
- Modify: `web/src/lib/admin/tagihan-pengajuan.ts`

**Interfaces:**
- Consumes: `RincianTagihan`, `SebabTagihanTakLengkap`, `hitungTagihanPengajuan({ sebabJenjangNull })` (Task 2).
- Produces: `BarisTagihanPengajuanAdmin` bertambah medan:
  ```ts
  hargaLayanan: string | null;   // sudah diformat rupiah
  hargaTransport: string | null; // sudah diformat rupiah
  labelJenjang: string | null;   // mis. ">10–15 km"
  sebab: SebabTagihanTakLengkap | null;
  ```
  `TagihanPengajuan.rincian` sudah bertipe `RincianTagihan` sehingga otomatis membawa `jenjang` & `sebab`.

- [ ] **Step 1: Hapus bacaan `transport_khusus` yang mati di `baca.ts`**

Di `web/src/lib/tagihan/baca.ts`, hapus blok:

```ts
    const { data: khusus } = await admin
      .from("transport_khusus")
      .select("tarif_klien")
      .eq("session_id", p.id)
      .maybeSingle<{ tarif_klien: number }>();
```

dan hapus baris `transportKhusus: khusus?.tarif_klien ?? null,` dari pemanggilan `hitungTagihanPengajuan`. Sisipkan komentar di tempatnya:

```ts
    // TIDAK ADA bacaan `transport_khusus` di sini, dan itu perbaikan cacat —
    // bukan kelalaian. Tabel itu ber-primary-key `session_id references
    // sessions(id)`, sementara `p.id` adalah id BOOKING REQUEST. Id itu tidak
    // akan pernah ada di `sessions`, jadi bacaan lamanya selalu memulangkan nol
    // baris — sebagai `null` yang terbaca wajar, bukan sebagai galat.
    //
    // Penimpa per kasus tetap berlaku untuk SESI (rekap owner membacanya).
    // Untuk PENGAJUAN, yang berlaku adalah tarif dasar `di_atas_20` dari
    // `transport_rates` yang sudah ikut terbaca di atas.
```

- [ ] **Step 2: Sebutkan sebab jenjang kosong di `baca.ts`**

Pada pemanggilan `hitungTagihanPengajuan` di berkas yang sama, tambahkan:

```ts
        sebabJenjangNull:
          titik?.lat == null || titik?.lon == null ? "mitra_tanpa_titik" : "alamat_tanpa_pin",
```

- [ ] **Step 3: Bawa rincian ke sisi admin**

Di `web/src/lib/admin/tagihan-pengajuan.ts`, tambahkan impor:

```ts
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import type { SebabTagihanTakLengkap } from "@/lib/tagihan/pengajuan";
```

(`LABEL_JENJANG` mungkin sudah terimpor sebagian; jangan menduplikasi impor.)

Perluas tipe `BarisTagihanPengajuanAdmin` dengan empat medan berikut, beserta komentarnya:

```ts
  /**
   * Rincian, sudah diformat rupiah di server. Nominal memang lewat berkas ini
   * dan itu sudah begitu sejak C2 (pesan WhatsApp tagihan dirakit dari sini).
   * Yang TIDAK pernah lewat, dan tidak boleh mulai lewat: `honor_mitra`.
   */
  hargaLayanan: string | null;
  hargaTransport: string | null;
  /** Mis. ">10–15 km". Dari `LABEL_JENJANG`, satu-satunya sumber labelnya. */
  labelJenjang: string | null;
  /**
   * Terisi PERSIS ketika `total === null`. Inilah yang mengubah kegagalan
   * senyap menjadi kalimat yang bisa ditindak admin.
   */
  sebab: SebabTagihanTakLengkap | null;
```

- [ ] **Step 4: Isi medan barunya**

Di perulangan `for (const p of data)`, ganti pemanggilan `hitungTagihanPengajuan` dan `hasil.push` menjadi:

```ts
    const mitraBertitik = p.partners?.lat != null && p.partners?.lon != null;

    const rincian = hitungTagihanPengajuan({
      variantId: p.variant_id,
      tanggal: p.tanggal,
      jenjang,
      sebabJenjangNull: mitraBertitik ? "alamat_tanpa_pin" : "mitra_tanpa_titik",
      tarif: barisTarif,
      tarifTransport: barisTransport,
    });

    hasil.push({
      permintaanId: p.id,
      namaKlien: p.clients?.nama ?? "Klien",
      namaLayanan: p.services?.nama ?? "Layanan",
      tanggal: formatTanggalID(p.tanggal),
      total: rincian.total === null ? null : formatRupiah(rincian.total),
      hargaLayanan: rincian.layanan === null ? null : formatRupiah(rincian.layanan),
      hargaTransport: rincian.transport === null ? null : formatRupiah(rincian.transport),
      labelJenjang: rincian.jenjang === null ? null : LABEL_JENJANG[rincian.jenjang],
      sebab: rincian.sebab,
      labelBayar:
        p.status_bayar === "lunas"
          ? "lunas"
          : p.status_bayar === "menunggu_verifikasi"
            ? "bukti masuk — perlu dicocokkan dengan mutasi"
            : `belum dibayar · ${labelSisaWaktu(p.tenggat)}`,
      adaBukti: Boolean(p.bukti_objek),
      bisaDiverifikasi: p.status_bayar === "menunggu_verifikasi",
    });
```

- [ ] **Step 5: Verifikasi pagar hak baca tetap utuh**

```bash
cd web && npx vitest run tests/tagihan-baca-hak.test.ts tests/money-firewall-struktural.test.ts
```

Harapan: hijau **tanpa menyentuh kedua berkas itu**. Bila `tagihan-baca-hak` merah, kemungkinan besar sebuah embed berpolicy staf tidak sengaja masuk ke query bersesi klien — perbaiki kodenya, jangan uji­nya.

- [ ] **Step 6: Suite penuh & commit**

```bash
cd web && npx tsc --noEmit && npm test 2>&1 | tail -30
cd web && git add src/lib/tagihan/baca.ts src/lib/admin/tagihan-pengajuan.ts
git commit -m "fix(tagihan): buang bacaan transport_khusus yang tidak pernah cocok

session_id merujuk sessions(id); yang dicari adalah id booking request.
Bacaan itu selalu nol baris — sebagai null yang terbaca wajar, bukan galat.
Lapisan baca kini memulangkan rincian & sebab ke kedua pemanggilnya."
```

---

## Task 4: Pesan WhatsApp berincian & gerbang penerbitan

Memperbaiki gejala yang dilaporkan, dan menutup jebakan tenggat 24 jam di atas tagihan tanpa angka.

**Files:**
- Modify: `web/src/lib/tagihan/pesan-tagihan.ts`
- Modify: `web/src/app/admin/sesi/aksi.ts` (`terbitkanTagihan`)
- Modify: `web/src/app/admin/sesi/page.tsx` (perakitan pesan)
- Modify: `web/tests/pesan-tagihan.test.ts`

**Interfaces:**
- Consumes: `BarisTagihanPengajuanAdmin.{hargaLayanan,hargaTransport,labelJenjang,sebab}` (Task 3); `KALIMAT_SEBAB_ADMIN` (Task 2).
- Produces: `pesanTagihan()` bertanda tangan baru dengan medan tambahan `hargaLayanan`, `hargaTransport`, `labelJenjang`.

- [ ] **Step 1: Rincian di pesan WhatsApp**

Ganti isi fungsi `pesanTagihan` di `web/src/lib/tagihan/pesan-tagihan.ts` (biarkan dokblok berkas apa adanya, hanya tambahkan satu paragraf yang menjelaskan rincian):

```ts
export function pesanTagihan(input: {
  namaKlien: string;
  namaLayanan: string;
  /** Sudah diformat untuk manusia, mis. "20 Mei 2027". */
  tanggal: string;
  /** Sudah diformat, mis. "09.00 WIB". */
  jam: string;
  /** Sudah diformat, mis. "Rp 395.000". `null` bila tarifnya belum ada. */
  hargaLayanan: string | null;
  /** Sudah diformat, mis. "Rp 25.000". `null` bila jenjangnya belum diketahui. */
  hargaTransport: string | null;
  /** Mis. ">10–15 km". `null` bila jenjangnya belum diketahui. */
  labelJenjang: string | null;
  /** Sudah diformat, mis. "Rp 420.000". `null` bila totalnya belum lengkap. */
  total: string | null;
  /** Sudah diformat, mis. "24 jam lagi". */
  sisaWaktu: string;
}): string {
  const {
    namaKlien,
    namaLayanan,
    tanggal,
    jam,
    hargaLayanan,
    hargaTransport,
    labelJenjang,
    total,
    sisaWaktu,
  } = input;

  // RINCIAN, bukan satu angka. Klien yang hanya menerima total tidak punya
  // cara memeriksa apa pun, dan pertanyaan "kok segini?" berakhir sebagai
  // percakapan WhatsApp yang dijawab admin satu per satu. Transport khususnya
  // WAJIB terlihat terpisah: ia berubah menurut jarak bidan ke alamat, dan
  // klien yang tidak tahu itu membacanya sebagai harga layanan yang naik.
  const baris: string[] = [];
  if (hargaLayanan) baris.push(`• Layanan: ${hargaLayanan}`);
  if (hargaTransport) {
    baris.push(`• Transport${labelJenjang ? ` (${labelJenjang})` : ""}: ${hargaTransport}`);
  }

  return [
    `Halo ${namaKlien}, bidan untuk sesi Anda sudah siap 🌸`,
    "",
    `Layanan: ${namaLayanan}`,
    `Jadwal: ${tanggal}, ${jam}`,
    ...(baris.length > 0 ? ["", ...baris] : []),
    total ? `Total: ${total}` : "Total: menyusul dari tim",
    "",
    `Mohon selesaikan pembayaran dalam ${sisaWaktu}, lalu unggah bukti transfernya di menu Bayar pada Passport Anda.`,
    "QRIS-nya ada di halaman yang sama — nominalnya diketik sendiri sesuai total di atas.",
    "",
    "Kalau lewat dari batas itu, jadwalnya kami lepas untuk klien lain — tapi Anda tetap bisa mengajukan ulang kapan saja.",
  ].join("\n");
}
```

Catatan: frasa "(sudah termasuk transport)" pada baris total **dihapus** — ia sekarang berlebihan sekaligus salah ketika baris transport tidak muncul.

- [ ] **Step 2: Perbarui `CONTOH` di ujinya**

Di `web/tests/pesan-tagihan.test.ts`, lengkapi konstanta `CONTOH` agar cocok dengan tanda tangan baru (penyesuaian, bukan uji baru):

```ts
const CONTOH = {
  namaKlien: "Ananda",
  namaLayanan: "Garbha Relief",
  tanggal: "20 Mei 2027",
  jam: "09.00 WIB",
  hargaLayanan: "Rp 174.000",
  hargaTransport: "Rp 20.000",
  labelJenjang: ">10–15 km",
  total: "Rp194.000",
  sisaWaktu: "24 jam lagi",
};
```

Uji `total: null` yang sudah ada tetap lulus: fallback "menyusul dari tim" dipertahankan.

- [ ] **Step 3: Rakit pesannya dengan rincian di `page.tsx`**

Di `web/src/app/admin/sesi/page.tsx`, ganti `totalPerPermintaan` dengan peta ke barisnya utuh:

```ts
  const tagihanAdmin = tab === "permintaan" ? await daftarTagihanPengajuanAdmin() : [];
  // Barisnya UTUH, bukan hanya totalnya: panel detail kini menampilkan rincian
  // dan sebab, dan pesan WhatsApp merangkai dari medan yang sama. Dua peta
  // untuk satu baris hanya menambah tempat keduanya bisa berselisih.
  const tagihanPerPermintaan = new Map(tagihanAdmin.map((t) => [t.permintaanId, t]));
```

Lalu ganti perakitan `tautanWaUntukLihat`:

```ts
  const tagihanLihat = barisLihat ? (tagihanPerPermintaan.get(barisLihat.id) ?? null) : null;

  const tautanWaUntukLihat =
    barisLihat &&
    barisLihat.status === PERMINTAAN_MENUNGGU_BAYAR &&
    nomorWaKlien(barisLihat.noHpKlien)
      ? tautanWaTagihan(
          nomorWaKlien(barisLihat.noHpKlien),
          pesanTagihan({
            namaKlien: barisLihat.namaKlien,
            namaLayanan: barisLihat.namaLayanan,
            tanggal: formatTanggalID(barisLihat.tanggal),
            jam: formatJam(jamDariDb(barisLihat.jamMulai)),
            hargaLayanan: tagihanLihat?.hargaLayanan ?? null,
            hargaTransport: tagihanLihat?.hargaTransport ?? null,
            labelJenjang: tagihanLihat?.labelJenjang ?? null,
            total: tagihanLihat?.total ?? null,
            sisaWaktu: labelSisaWaktu(barisLihat.tenggat),
          }),
        )
      : "";
```

- [ ] **Step 4: Beri `daftarTagihanPengajuanAdmin()` cabang satu-permintaan**

Gerbang di Step 5 harus menghitung total **sebelum** status berpindah ke
`menunggu_bayar`. Saringan status yang ada justru menyembunyikan baris yang
hendak diperiksa, jadi fungsi daftar perlu cabang yang mengabaikan status.

Di `web/src/lib/admin/tagihan-pengajuan.ts`, ubah tanda tangannya:

```ts
export async function daftarTagihanPengajuanAdmin(
  opsi: { buktiLama?: boolean; permintaanId?: string } = {},
): Promise<BarisTagihanPengajuanAdmin[]> {
  const { buktiLama = false, permintaanId } = opsi;
```

lalu ubah percabangan query yang ada (`if (buktiLama) { … } else { … }`) menjadi
tiga cabang, dengan cabang baru di depan:

```ts
  if (permintaanId) {
    // SATU permintaan, APA PUN statusnya. Dipakai gerbang `terbitkanTagihan()`,
    // yang harus tahu totalnya SEBELUM status berpindah ke `menunggu_bayar` —
    // saringan status di cabang ketiga justru menyembunyikan baris yang sedang
    // hendak diperiksa, dan gerbang yang tidak pernah menemukan barisnya adalah
    // gerbang yang tidak pernah menutup.
    q = q.eq("id", permintaanId);
  } else if (buktiLama) {
    // …isi cabang buktiLama yang sudah ada, tidak berubah…
  } else {
    // …isi cabang bawaan yang sudah ada, tidak berubah…
  }
```

- [ ] **Step 5: Gerbang penerbitan di `terbitkanTagihan()`**

Di `web/src/app/admin/sesi/aksi.ts`, tambahkan impor:

```ts
import { daftarTagihanPengajuanAdmin } from "@/lib/admin/tagihan-pengajuan";
import { KALIMAT_SEBAB_ADMIN } from "@/lib/tagihan/pengajuan";
```

Sisipkan gerbang ini di awal `terbitkanTagihan()`, **sebelum** perhitungan
`tenggat` dan sebelum `update` apa pun:

```ts
  // GERBANG: tagihan tanpa nominal tidak boleh terbit.
  //
  // Alasannya bukan kerapian. Fungsi ini memasang tenggat 24 jam, dan lewat
  // dari tenggat itu `batalkan_lewat_tenggat()` melepas slotnya. Tagihan tanpa
  // angka di atas tenggat 24 jam adalah jebakan: klien tidak pernah diberi tahu
  // berapa yang harus ia bayar, lalu kehilangan jadwalnya karena tidak
  // membayarnya.
  //
  // Diperiksa SEBELUM satu baris pun berubah, jadi tidak ada yang perlu
  // dikompensasi bila gerbangnya menutup. Dibaca lewat cabang `permintaanId`
  // (Step 4) karena baris ini BELUM `menunggu_bayar` — inilah fungsi yang
  // memindahkannya ke sana.
  const rincianAwal = (await daftarTagihanPengajuanAdmin({ permintaanId }))[0] ?? null;
  if (rincianAwal && rincianAwal.total === null) {
    return {
      ok: false,
      pesan: `Tagihan belum bisa terbit. ${
        rincianAwal.sebab
          ? KALIMAT_SEBAB_ADMIN[rincianAwal.sebab]
          : "Totalnya belum bisa dihitung."
      }`,
    };
  }
```

`rincianAwal` bisa `null` bila permintaannya tidak ditemukan sama sekali —
biarkan lolos ke `update` di bawahnya, yang memang sudah menangani "sudah
ditangani atau tidak ditemukan" dengan memeriksa jumlah baris terdampak.

- [ ] **Step 6: Verifikasi manual di layar**

```bash
cd web && npm run dev
```

Masuk sebagai admin, buka `/admin/sesi`, ambil satu permintaan sampai `mitra_siap`, tekan "Terbitkan tagihan". Harapan: berhasil, dan tombol "Kirim tagihan via WA" membuka pesan yang memuat baris `• Layanan:` dan `• Transport (…):` beserta `Total:` bernominal — **bukan** "menyusul dari tim".

Untuk menguji gerbangnya: hapus pin alamat permintaan lain lalu coba terbitkan. Harapan: ditolak dengan kalimat yang menyebut blok Alamat kunjungan.

- [ ] **Step 7: Suite penuh & commit**

```bash
cd web && npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -30
cd web && git add src/lib/tagihan/pesan-tagihan.ts src/lib/admin/tagihan-pengajuan.ts src/app/admin/sesi/aksi.ts src/app/admin/sesi/page.tsx tests/pesan-tagihan.test.ts
git commit -m "feat(tagihan): pesan WA berincian & gerbang penerbitan

Tagihan tanpa nominal tidak boleh terbit: tenggat 24 jam di atas tagihan
tanpa angka adalah jebakan — klien kehilangan slotnya karena tidak
membayar sesuatu yang jumlahnya tidak pernah ia terima."
```

---

## Task 5: Rincian tampil di layar admin & klien

**Files:**
- Modify: `web/src/app/admin/sesi/panel-permintaan.tsx`
- Modify: `web/src/app/admin/sesi/page.tsx` (oper prop baru)
- Modify: `web/src/app/passport/bayar/page.tsx`
- Modify: `web/src/app/passport/bayar/kartu-tagihan.tsx`

**Interfaces:**
- Consumes: `BarisTagihanPengajuanAdmin` (Task 3), `KALIMAT_SEBAB_ADMIN`/`KALIMAT_SEBAB_KLIEN` (Task 2), `TagihanPengajuan.rincian` (Task 3).
- Produces: `PanelPermintaan` menerima prop baru `tagihan: BarisTagihanPengajuanAdmin | null`.

- [ ] **Step 1: Blok Tagihan di panel admin**

Di `web/src/app/admin/sesi/panel-permintaan.tsx`, tambahkan impor:

```ts
import { KALIMAT_SEBAB_ADMIN } from "@/lib/tagihan/pengajuan";
import type { BarisTagihanPengajuanAdmin } from "@/lib/admin/tagihan-pengajuan";
```

Tambahkan `tagihan` ke daftar prop (destrukturisasi dan tipenya):

```ts
  /**
   * Rincian tagihan permintaan ini, `null` bila belum ada (mis. tab Sesi, atau
   * status yang belum menuntutnya). Nominal memang tampil di berkas ini: ia
   * sudah lewat halaman induknya sejak C2 untuk merakit pesan WhatsApp, dan
   * larangan `formatRupiah` yang dijaga uji menyasar `src/app/_shell/panel/**`
   * serta dasbor/agenda/tren — bukan berkas ini.
   */
  tagihan: BarisTagihanPengajuanAdmin | null;
```

Ganti seluruh `<section>` "Pembayaran" yang ada dengan:

```tsx
      <section>
        <p className="text-[12.5px] font-bold text-panel-muted">Pembayaran</p>
        <p className="mt-1 text-[12.5px] text-panel-ink">{labelBayar}</p>

        {tagihan && (
          <div className="mt-2 rounded-lg border border-panel-border px-3 py-2">
            {tagihan.total === null ? (
              /* SEBABNYA, bukan sekadar ketiadaannya. Tanpa kalimat ini admin
                 menerbitkan tagihan, menyalin pesan WhatsApp, mengirimnya, lalu
                 baru sadar nominalnya hilang — sesudah pesannya sampai. Itulah
                 bentuk kegagalan yang membuat fitur ini terlihat "selalu rusak"
                 padahal yang kurang hanya satu pin di peta. */
              <p className="text-[12px] font-semibold text-clay">
                {tagihan.sebab
                  ? KALIMAT_SEBAB_ADMIN[tagihan.sebab]
                  : "Totalnya belum bisa dihitung."}
              </p>
            ) : (
              <dl className="text-[12.5px]">
                <div className="flex justify-between">
                  <dt className="text-panel-muted">Layanan</dt>
                  <dd className="text-panel-ink">{tagihan.hargaLayanan}</dd>
                </div>
                <div className="mt-0.5 flex justify-between">
                  <dt className="text-panel-muted">
                    Transport{tagihan.labelJenjang ? ` · ${tagihan.labelJenjang}` : ""}
                  </dt>
                  <dd className="text-panel-ink">{tagihan.hargaTransport}</dd>
                </div>
                <div className="mt-1.5 flex justify-between border-t border-panel-border pt-1.5">
                  <dt className="font-bold text-panel-ink">Total</dt>
                  <dd className="font-bold text-panel-ink">{tagihan.total}</dd>
                </div>
              </dl>
            )}
          </div>
        )}
      </section>
```

- [ ] **Step 2: Oper prop `tagihan` dari halaman**

Di `web/src/app/admin/sesi/page.tsx`, pada elemen `<PanelPermintaan …>`, tambahkan:

```tsx
            tagihan={tagihanLihat}
```

(`tagihanLihat` sudah dirakit di Task 4 Step 3.)

- [ ] **Step 3: Kartu klien berincian**

Di `web/src/app/passport/bayar/kartu-tagihan.tsx`, ganti tipe prop `total` & `menungguTarifKhusus` dengan set berikut, lalu ganti blok penampil totalnya:

```ts
  /** Rupiah, sudah diformat di server. `null` bila bagian itu belum diketahui. */
  hargaLayanan: string | null;
  hargaTransport: string | null;
  /** Mis. ">10–15 km". */
  labelJenjang: string | null;
  total: string | null;
  /** Kalimat siap tampil bila `total === null`. Dirangkai di server. */
  kalimatBelumLengkap: string | null;
```

```tsx
      {total === null ? (
        <p className="mt-2 text-[13px] text-[#77321F]">
          {kalimatBelumLengkap ?? "Totalnya sedang dilengkapi tim PADMA."}
        </p>
      ) : (
        <dl className="mt-2 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Layanan</dt>
            <dd className="text-night">{hargaLayanan}</dd>
          </div>
          <div className="mt-0.5 flex justify-between">
            <dt className="text-ink-soft">
              Transport{labelJenjang ? ` · ${labelJenjang}` : ""}
            </dt>
            <dd className="text-night">{hargaTransport}</dd>
          </div>
          {/* `data-total` DIPERTAHANKAN di elemen totalnya. E2E
              tests/e2e/bayar-pengajuan.e2e.ts mencarinya, dan penanda itu
              justru yang dulu menangkap cacat embed RLS yang membuat setiap
              klien melihat "Totalnya sedang dilengkapi tim". */}
          <div className="mt-1.5 flex justify-between border-t border-black/10 pt-1.5">
            <dt className="font-bold text-night">Total</dt>
            <dd className="text-[15px] font-bold text-night" data-total>
              {total}
            </dd>
          </div>
        </dl>
      )}
```

- [ ] **Step 4: Rangkai propnya di halaman bayar**

Di `web/src/app/passport/bayar/page.tsx`, impor `formatRupiah`, `LABEL_JENJANG`, dan `KALIMAT_SEBAB_KLIEN`, lalu isi prop kartunya dari `t.rincian`:

```tsx
              hargaLayanan={t.rincian.layanan === null ? null : formatRupiah(t.rincian.layanan)}
              hargaTransport={
                t.rincian.transport === null ? null : formatRupiah(t.rincian.transport)
              }
              labelJenjang={t.rincian.jenjang === null ? null : LABEL_JENJANG[t.rincian.jenjang]}
              total={t.rincian.total === null ? null : formatRupiah(t.rincian.total)}
              kalimatBelumLengkap={t.rincian.sebab ? KALIMAT_SEBAB_KLIEN[t.rincian.sebab] : null}
```

Hapus prop `menungguTarifKhusus` dari pemanggilan itu bila masih ada. Sesuaikan pemformatan `total` yang sebelumnya sudah dilakukan di halaman ini agar tidak terformat dua kali.

- [ ] **Step 5: Verifikasi manual & E2E jalur bayar**

```bash
cd web && npm run test:e2e:bayar
```

Harapan: hijau; `[data-total]` masih ditemukan dan kini berisi nominal sungguhan. Bila skripnya mengasersi teks "Totalnya sedang dilengkapi", sesuaikan ke perilaku baru.

- [ ] **Step 6: Suite penuh & commit**

```bash
cd web && npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -30
cd web && git add src/app/admin/sesi/panel-permintaan.tsx src/app/admin/sesi/page.tsx src/app/passport/bayar/page.tsx src/app/passport/bayar/kartu-tagihan.tsx
git commit -m "feat(tagihan): rincian harga tampil di panel admin & kartu klien

Blok tagihan admin menyebut SEBAB ketika totalnya belum lengkap, lengkap
dengan layar yang memperbaikinya — itulah yang mengubah kegagalan senyap
jadi kegagalan yang bisa ditindak."
```

---

## Task 6: Email tagihan lewat Resend

**Files:**
- Create: `web/src/lib/email/kirim.ts`
- Create: `web/src/lib/tagihan/email-tagihan.ts`
- Create: `web/supabase/migrations/20260914110000_jejak_email_tagihan.sql`
- Modify: `web/src/app/admin/sesi/aksi.ts`
- Modify: `web/src/app/admin/sesi/aksi-permintaan.tsx`
- Modify: `web/src/app/admin/sesi/panel-permintaan.tsx`
- Modify: `web/.env.example`

**Interfaces:**
- Consumes: `daftarTagihanPengajuanAdmin({ permintaanId })` (Task 4).
- Produces:
  - `kirimEmail(input: { ke: string; subjek: string; html: string; teks: string }): Promise<{ ok: true; id: string } | { ok: false; sebab: string }>`
  - `subjekTagihan(input: { namaLayanan: string; tanggal: string }): string`
  - `emailTagihan(input: {...}): { html: string; teks: string }`
  - `kirimUlangEmailTagihan(permintaanId: string): Promise<Berhasil | Gagal>` (server action)

- [ ] **Step 1: Migrasi jejak email**

Buat `web/supabase/migrations/20260914110000_jejak_email_tagihan.sql`:

```sql
-- Kapan email tagihan terakhir BERHASIL terkirim untuk pengajuan ini.
--
-- Kenapa disimpan dan bukan sekadar nilai balik server action: admin yang
-- memuat ulang halaman kehilangan nilai balik itu, dan yang tersisa adalah
-- layar yang tidak bisa membedakan "email sudah sampai" dari "email tidak
-- pernah terkirim". Di atas tenggat 24 jam, perbedaan itu menentukan apakah
-- kliennya kehilangan slot.
--
-- NULL berarti belum pernah berhasil — termasuk ketika RESEND_API_KEY belum
-- terpasang. Bukan kolom nominal: money firewall memindai nama kolom terhadap
-- pola uang (harga/honor/tarif/biaya/bayar/total/…), dan tidak satu pun cocok.
alter table public.booking_requests
  add column email_tagihan_pada timestamptz null;

comment on column public.booking_requests.email_tagihan_pada is
  'Kapan email tagihan terakhir BERHASIL terkirim. NULL = belum pernah.';
```

Muat:

```bash
cd web && npx supabase migration up
```

- [ ] **Step 2: Modul kirim email**

Buat `web/src/lib/email/kirim.ts`:

```ts
import "server-only";

/**
 * SATU-SATUNYA jalur keluar email PADMA.
 *
 * `import "server-only"` bukan hiasan: `RESEND_API_KEY` tidak boleh punya satu
 * pun jalan ke bundel peramban, dan direktif ini membuat impor dari komponen
 * klien GAGAL DI BUILD alih-alih gagal diam-diam di produksi.
 *
 * ===== FUNGSI INI TIDAK PERNAH MELEMPAR =====
 * Pemanggilnya adalah `terbitkanTagihan()`, dan penerbitan tagihan tidak boleh
 * gagal karena penyedia email sedang bermasalah. Setiap galat — jaringan,
 * 4xx, 5xx, JSON yang tidak terbaca — berakhir sebagai `{ ok: false, sebab }`.
 * Pola yang sama persis dengan `geocodeAlamat()`, dan alasannya sama.
 *
 * ===== GAGAL TERTUTUP TERHADAP KONFIGURASI =====
 * Tanpa `RESEND_API_KEY` atau `EMAIL_PENGIRIM`, fungsi ini tidak mengirim apa
 * pun dan memulangkan sebab `env_kosong` — bukan diam-diam "berhasil". Env
 * yang hilang lalu terbaca sebagai sukses adalah persis kelas cacat yang sudah
 * dibayar di jalur video R2 (fix F3), dan di sini akibatnya lebih mahal:
 * seluruh klien berhenti menerima tagihan tanpa satu baris pun di log.
 *
 * Tanpa dependensi baru: Resend menerima HTTP biasa.
 */
const ENDPOINT = "https://api.resend.com/emails";

export type HasilKirim = { ok: true; id: string } | { ok: false; sebab: string };

export async function kirimEmail(input: {
  ke: string;
  subjek: string;
  html: string;
  /** WAJIB. Klien email yang memblokir HTML menampilkan bagian ini. */
  teks: string;
}): Promise<HasilKirim> {
  const kunci = process.env.RESEND_API_KEY;
  const dari = process.env.EMAIL_PENGIRIM;
  if (!kunci || !dari) {
    console.warn("[email] RESEND_API_KEY / EMAIL_PENGIRIM belum terpasang — tidak mengirim.");
    return { ok: false, sebab: "env_kosong" };
  }
  if (input.ke.trim() === "") {
    return { ok: false, sebab: "tujuan_kosong" };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kunci}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: dari,
        to: [input.ke],
        subject: input.subjek,
        html: input.html,
        text: input.teks,
      }),
    });

    if (!res.ok) {
      // Badan responsnya ikut dicatat: Resend menjelaskan penolakan domain yang
      // belum terverifikasi di sana, dan itu justru kegagalan yang paling
      // mungkin terjadi saat go-live.
      const isi = await res.text().catch(() => "");
      console.error(`[email] Resend menolak (${res.status}): ${isi.slice(0, 500)}`);
      return { ok: false, sebab: `http_${res.status}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id ?? "" };
  } catch (e) {
    console.error("[email] gagal menghubungi Resend:", e);
    return { ok: false, sebab: "jaringan" };
  }
}
```

- [ ] **Step 3: Perender email tagihan**

Buat `web/src/lib/tagihan/email-tagihan.ts`. **Nol impor** — dijaga pola yang sama dengan `pesan-tagihan.ts`:

```ts
/**
 * PERENDER EMAIL TAGIHAN.
 *
 * MURNI — tanpa satu pun impor, dengan alasan yang sama seperti
 * `pesan-tagihan.ts`: berkas ini diimpor dari `src/app/admin/sesi/**`, dan satu
 * impor bermodul Supabase di sini sudah cukup menyeret klien service role ke
 * bundel peramban.
 *
 * ===== KENAPA TENGGATNYA ABSOLUT, BUKAN "24 JAM LAGI" =====
 * Pesan WhatsApp dibaca dalam hitungan menit; email dibaca ulang berhari-hari
 * kemudian. "24 jam lagi" yang dibaca tiga hari sesudah dikirim adalah kalimat
 * yang berbohong kepada orang yang sedang mencari tahu apakah ia masih sempat.
 *
 * ===== KENAPA TEKS POLOS WAJIB =====
 * Klien email yang memblokir HTML menampilkan bagian teks. Tagihan yang tampil
 * kosong sama saja dengan tagihan yang tidak pernah terkirim — dan tenggatnya
 * tetap berjalan.
 *
 * Tidak ada honor mitra, tidak ada margin, tidak ada apa pun dari
 * `variant_rates` selain `harga_klien`.
 */

export function subjekTagihan(input: { namaLayanan: string; tanggal: string }): string {
  return `Tagihan sesi ${input.namaLayanan} — ${input.tanggal}`;
}

export function emailTagihan(input: {
  namaKlien: string;
  namaLayanan: string;
  /** Sudah diformat, mis. "20 Mei 2027". */
  tanggal: string;
  /** Sudah diformat, mis. "09.00 WIB". */
  jam: string;
  /** Sudah diformat, mis. "Rp 395.000". */
  hargaLayanan: string;
  hargaTransport: string;
  /** Mis. ">10–15 km". */
  labelJenjang: string;
  total: string;
  /** ABSOLUT, mis. "Rabu, 10 September 2026 pukul 14.30 WIB". */
  tenggatAbsolut: string;
  /** URL penuh ke halaman bayar, mis. "https://…/passport/bayar". */
  tautanBayar: string;
}): { html: string; teks: string } {
  const {
    namaKlien,
    namaLayanan,
    tanggal,
    jam,
    hargaLayanan,
    hargaTransport,
    labelJenjang,
    total,
    tenggatAbsolut,
    tautanBayar,
  } = input;

  const teks = [
    `Halo ${namaKlien},`,
    "",
    "Bidan untuk sesi Anda sudah siap. Berikut rincian tagihannya.",
    "",
    `Layanan : ${namaLayanan}`,
    `Jadwal  : ${tanggal}, ${jam}`,
    "",
    `Layanan            ${hargaLayanan}`,
    `Transport (${labelJenjang})  ${hargaTransport}`,
    `TOTAL              ${total}`,
    "",
    `Mohon selesaikan pembayaran paling lambat ${tenggatAbsolut}.`,
    `Bayar & unggah bukti transfer di: ${tautanBayar}`,
    "QRIS-nya ada di halaman yang sama — nominalnya diketik sendiri sesuai total di atas.",
    "",
    "Kalau lewat dari batas itu, jadwalnya kami lepas untuk klien lain — tapi Anda tetap bisa mengajukan ulang kapan saja.",
    "",
    "Terima kasih,",
    "Tim PADMA Wellness",
  ].join("\n");

  // Tabel + gaya sebaris: klien email mengabaikan <style> di <head> dan
  // sebagian besar aturan tata letak modern. Ini bukan HTML yang layak ditiru
  // di halaman web, dan memang tidak dipakai di sana.
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#22302A;line-height:1.6;max-width:520px">
  <p>Halo <b>${namaKlien}</b>,</p>
  <p>Bidan untuk sesi Anda sudah siap. Berikut rincian tagihannya.</p>
  <p style="margin:0 0 4px"><b>${namaLayanan}</b><br><span style="color:#5A6B62">${tanggal}, ${jam}</span></p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:6px 0;color:#5A6B62">Layanan</td><td style="padding:6px 0;text-align:right">${hargaLayanan}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6B62">Transport · ${labelJenjang}</td><td style="padding:6px 0;text-align:right">${hargaTransport}</td></tr>
    <tr><td style="padding:10px 0;border-top:1px solid #E4E0D6"><b>Total</b></td><td style="padding:10px 0;border-top:1px solid #E4E0D6;text-align:right"><b>${total}</b></td></tr>
  </table>
  <p>Mohon selesaikan pembayaran paling lambat <b>${tenggatAbsolut}</b>.</p>
  <p><a href="${tautanBayar}" style="display:inline-block;background:#C9A227;color:#2A2013;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">Bayar &amp; unggah bukti</a></p>
  <p style="color:#5A6B62;font-size:13px">QRIS-nya ada di halaman yang sama — nominalnya diketik sendiri sesuai total di atas. Kalau lewat dari batas itu, jadwalnya kami lepas untuk klien lain, tapi Anda tetap bisa mengajukan ulang kapan saja.</p>
  <p style="color:#5A6B62;font-size:13px">Terima kasih,<br>Tim PADMA Wellness</p>
</div>`;

  return { html, teks };
}
```

- [ ] **Step 4: `.env.example`**

Tambahkan di akhir `web/.env.example`:

```
# Resend — pengiriman email tagihan. Tanpa keduanya, tagihan tetap terbit dan
# tetap bisa dikirim lewat WhatsApp, tetapi TIDAK ADA email yang keluar dan
# sebabnya dicatat di log server (bukan gagal senyap).
#
# Domain pengirim WAJIB diverifikasi DNS sekali di dashboard Resend; sebelum
# itu Resend menolak setiap kiriman ke alamat selain milik pemilik akun — dan
# penolakan itu terlihat seperti "email tidak pernah sampai".
RESEND_API_KEY=isi-dari-dashboard-resend
EMAIL_PENGIRIM=PADMA Wellness <tagihan@padmawellnessid.com>

# Basis URL publik, dipakai tautan di dalam email (tautan relatif tidak berarti
# apa-apa di kotak masuk). Tanpa ini, tautan "Bayar" di email tidak dirender.
NEXT_PUBLIC_BASIS_URL=http://localhost:3000
```

- [ ] **Step 5: Sambungkan ke `terbitkanTagihan()` + aksi kirim ulang**

Di `web/src/app/admin/sesi/aksi.ts`, tambahkan impor:

```ts
import { kirimEmail } from "@/lib/email/kirim";
import { emailTagihan, subjekTagihan } from "@/lib/tagihan/email-tagihan";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
```

Tambahkan pembantu privat (bukan `export`, karena berkas `"use server"` hanya boleh mengekspor fungsi async — pembantu ini async, jadi boleh diekspor, tetapi tetap dibiarkan privat supaya permukaannya kecil):

```ts
/**
 * Mengirim email tagihan untuk satu permintaan. Memulangkan apakah berhasil.
 *
 * TIDAK PERNAH melempar dan TIDAK PERNAH menggagalkan pemanggilnya — lihat
 * dokblok `kirimEmail`. Tujuannya diambil dari `clients.email` baris pengajuan
 * itu, TIDAK PERNAH dari input: pelajaran yang sama yang dibayar tautan
 * WhatsApp yang dulu menunjuk nomor klinik alih-alih nomor klien.
 */
async function kirimEmailTagihan(permintaanId: string): Promise<boolean> {
  const daftar = await daftarTagihanPengajuanAdmin({ permintaanId });
  const t = daftar[0];
  if (!t || t.total === null || t.hargaLayanan === null || t.hargaTransport === null) {
    return false;
  }

  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("booking_requests")
    .select("tenggat, jam_mulai, clients ( nama, email )")
    .eq("id", permintaanId)
    .maybeSingle<{
      tenggat: string | null;
      jam_mulai: string;
      clients: { nama: string; email: string } | null;
    }>();

  const email = baris?.clients?.email ?? "";
  if (email === "") return false;

  const { html, teks } = emailTagihan({
    namaKlien: baris?.clients?.nama ?? t.namaKlien,
    namaLayanan: t.namaLayanan,
    tanggal: t.tanggal,
    jam: formatJam(jamDariDb(baris!.jam_mulai)),
    hargaLayanan: t.hargaLayanan,
    hargaTransport: t.hargaTransport,
    labelJenjang: t.labelJenjang ?? "",
    total: t.total,
    tenggatAbsolut: formatTenggatAbsolut(baris?.tenggat ?? null),
    tautanBayar: `${process.env.NEXT_PUBLIC_BASIS_URL ?? ""}/passport/bayar`,
  });

  const hasil = await kirimEmail({
    ke: email,
    subjek: subjekTagihan({ namaLayanan: t.namaLayanan, tanggal: t.tanggal }),
    html,
    teks,
  });

  if (hasil.ok) {
    await supabase
      .from("booking_requests")
      .update({ email_tagihan_pada: new Date().toISOString() })
      .eq("id", permintaanId);
  }
  return hasil.ok;
}

/**
 * Tenggat sebagai kalimat ABSOLUT dalam kalender Jakarta. Email dibaca ulang
 * berhari-hari kemudian; "24 jam lagi" di sana adalah kalimat yang berbohong.
 */
function formatTenggatAbsolut(iso: string | null): string {
  if (!iso) return "—";
  // `timeZone` WAJIB disebut. Tanpa itu Node memakai zona server — Vercel
  // berjalan di UTC, dan tenggat pukul 14.30 WIB akan tercetak 07.30 di email
  // klien. Bukan galat, hanya angka yang salah tujuh jam.
  const teks = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
  return `${teks} WIB`;
}
```

Pastikan `formatJam` dan `jamDariDb` sudah terimpor di berkas ini; bila belum, impor dari tempat yang sama dengan yang dipakai `page.tsx`.

Di akhir `terbitkanTagihan()`, **sesudah** `revalidatePath` terakhir dan sebelum `return { ok: true }`, sisipkan:

```ts
  // Email dikirim SESUDAH statusnya berpindah, dan kegagalannya TIDAK
  // menggagalkan penerbitan. Tagihannya sudah terbit dan tenggatnya sudah
  // berjalan; membatalkan itu karena penyedia email sedang bermasalah menukar
  // masalah kecil dengan masalah besar. Panel menampilkan status kirimnya dan
  // menyediakan tombol kirim ulang.
  await kirimEmailTagihan(permintaanId);
```

Lalu tambahkan server action baru di akhir berkas:

```ts
/** Mengirim ulang email tagihan. Dipakai ketika kiriman otomatisnya gagal. */
export async function kirimUlangEmailTagihan(
  permintaanId: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const ok = await kirimEmailTagihan(permintaanId);
  if (!ok) {
    return {
      ok: false,
      pesan:
        "Email tidak terkirim. Periksa alamat email klien di menu Klien, dan pastikan RESEND_API_KEY & domain pengirim sudah terpasang.",
    };
  }
  revalidatePath("/admin/sesi");
  return { ok: true };
}
```

- [ ] **Step 6: Tombol & status di panel**

Di `web/src/app/admin/sesi/aksi-permintaan.tsx`, tambahkan `kirimUlangEmailTagihan` ke impor dari `./aksi`, tambahkan prop `emailTerkirim: boolean` ke `TombolPermintaan`, lalu di dalam cabang `status === PERMINTAAN_MENUNGGU_BAYAR` tambahkan:

```tsx
          <button
            type="button"
            disabled={pending}
            onClick={() => jalankan(() => kirimUlangEmailTagihan(permintaanId))}
            className={KELAS_KEDUA}
          >
            {pending ? "Memproses…" : emailTerkirim ? "Kirim ulang email" : "Kirim email tagihan"}
          </button>
```

Di `panel-permintaan.tsx`, tambahkan prop `emailTerkirim: boolean` dan teruskan ke `TombolPermintaan`; tampilkan juga status di blok Pembayaran:

```tsx
            <p className="mt-1.5 text-[11.5px] text-panel-muted">
              {emailTerkirim
                ? "Email tagihan sudah terkirim ke klien."
                : "Email tagihan belum pernah terkirim — kirim manual dengan tombol di bawah."}
            </p>
```

Proyeksinya hidup di `src/lib/admin/permintaan.ts`. Di sana: tambahkan
`email_tagihan_pada` ke string `.select(...)`, tambahkan medannya ke
`BarisMentah`, dan tambahkan ke `BarisPermintaanDaftar` (konvensi berkas itu
camelCase — lihat `alamatLat`, `statusBayar`):

```ts
  /** Kapan email tagihan terakhir BERHASIL terkirim. `null` = belum pernah. */
  emailTagihanPada: string | null;
```

lalu petakan `emailTagihanPada: m.email_tagihan_pada` di perakit barisnya.

Di `page.tsx`, oper `emailTerkirim={barisLihat?.emailTagihanPada != null}`
(pakai `!=` longgar, supaya `undefined` ikut terbaca sebagai belum terkirim).

- [ ] **Step 7: Verifikasi**

```bash
cd web && npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -30
```

Verifikasi manual tanpa env: terbitkan satu tagihan dengan `RESEND_API_KEY` **tidak** diset. Harapan: tagihan tetap terbit, panel berbunyi "belum pernah terkirim", dan log server memuat `[email] RESEND_API_KEY / EMAIL_PENGIRIM belum terpasang`. Ini membuktikan sifat gagal-tertutupnya.

- [ ] **Step 8: Commit**

```bash
cd web && git add supabase/migrations/20260914110000_jejak_email_tagihan.sql src/lib/email/kirim.ts src/lib/tagihan/email-tagihan.ts src/app/admin/sesi/aksi.ts src/app/admin/sesi/aksi-permintaan.tsx src/app/admin/sesi/panel-permintaan.tsx src/app/admin/sesi/page.tsx .env.example
git commit -m "feat(email): tagihan terkirim otomatis lewat Resend

Kegagalan kirim tidak pernah menggagalkan penerbitan, dan env yang hilang
tidak pernah terbaca sebagai sukses. Jejaknya disimpan supaya admin yang
memuat ulang halaman tetap bisa membedakan 'sudah sampai' dari 'tidak
pernah terkirim' — di atas tenggat 24 jam, itu menentukan slot klien."
```

---

## Task 7: Katalog pesan layanan

**Files:**
- Create: `web/src/app/passport/ajukan/katalog.tsx`
- Create: `web/src/app/passport/ajukan/ringkasan.tsx`
- Modify: `web/src/app/passport/ajukan/page.tsx`
- Modify: `web/src/app/passport/ajukan/form.tsx`

**Interfaces:**
- Consumes: view `harga_publik` (sudah ada, sudah ber-grant), `labelVarian()`.
- Produces:
  ```ts
  export type VarianKatalogAjukan = {
    id: string;
    serviceId: string;
    label: string;          // dari labelVarian(); "" berarti varian baku
    hargaKlien: string | null;   // sudah diformat rupiah
    hargaCoret: string | null;
  };
  export type LayananKatalogAjukan = {
    id: string;
    nama: string;
    namaFase: string;       // mis. "Garbha · Masa Kehamilan"
    varian: VarianKatalogAjukan[];
  };
  ```

- [ ] **Step 1: Muat skill desain**

Panggil skill `frontend-design` **sebelum** menulis markup apa pun. Pemilik repo secara eksplisit meminta katalog yang "lebih bagus lagi designnya", bukan kartu polos. Ikuti arahan skill itu untuk tipografi, hierarki, dan ritme spasi; gunakan token warna yang sudah ada di repo (`night`, `ink-soft`, `gold`, `leaf`, `leaf-soft`, `clay`) — jangan memperkenalkan palet baru.

- [ ] **Step 2: Baca harga & fase di `page.tsx`**

Di `web/src/app/passport/ajukan/page.tsx`, tambahkan dua query ke `Promise.all` yang sudah ada:

```ts
    supabase.from("phases").select("id, nama_sanskrit, nama, urutan").order("urutan"),
    // View `harga_publik` — SUDAH ADA dan sudah dipakai landing sejak spec V4
    // §4.4 memutuskan harga klien tampil publik. Nol permukaan data baru, nol
    // pelonggaran money firewall: `honor_mitra` tidak pernah diproyeksikan
    // view ini, dan daftar kolomnya dikunci tests/harga-publik.test.ts.
    //
    // Dibaca lewat SESI PENGGUNA, bukan `bacaKatalog()` yang memakai anon key:
    // halaman ini berautentikasi, dan mencampur dua jenis klien Supabase dalam
    // satu halaman hanya menambah satu jalur yang bisa berselisih.
    supabase.from("harga_publik").select("variant_id, harga_klien, harga_coret, berlaku_sejak"),
```

Tambahkan juga `phase_id` ke proyeksi `services`. **Saringan `.eq("aktif", true)`
pada `services` DAN `service_variants` dipertahankan apa adanya** — varian yang
dinonaktifkan admin tidak boleh muncul kembali hanya karena tampilannya berubah,
dan harga varian mati yang tampil adalah harga yang tidak berlaku.

Rakit katalognya di server, di bawah blok `Promise.all`:

```ts
  // Harga yang BERLAKU HARI INI: `berlaku_sejak` terbesar yang masih ≤ hari
  // ini menurut kalender Jakarta. Aturannya sama persis dengan
  // `tarifPadaTanggal()` dan `tarifTransportPadaTanggal()`; ditulis di sini
  // karena bentuk barisnya berbeda (view, bukan tabel tarif) dan karena yang
  // dikunci di sini adalah HARI INI, bukan tanggal sesi — katalog memperlihatkan
  // harga saat memesan, sementara tagihan dikunci tanggal sesinya.
  const hariIni = hariIniJakarta();
  const hargaPerVarian = new Map<string, { harga: number; coret: number | null; sejak: string }>();
  for (const h of harga ?? []) {
    const sejak = h.berlaku_sejak as string;
    if (sejak > hariIni) continue;
    const ada = hargaPerVarian.get(h.variant_id as string);
    if (ada && ada.sejak >= sejak) continue;
    hargaPerVarian.set(h.variant_id as string, {
      harga: h.harga_klien as number,
      coret: (h.harga_coret as number | null) ?? null,
      sejak,
    });
  }

  const fasePerId = new Map((fase ?? []).map((f) => [f.id as string, f]));

  const katalog: LayananKatalogAjukan[] = (layanan ?? []).map((l) => {
    const f = fasePerId.get(l.phase_id as string);
    return {
      id: l.id as string,
      nama: l.nama as string,
      namaFase: f ? `${f.nama_sanskrit} · ${f.nama}` : "",
      varian: (varian ?? [])
        .filter((v) => v.service_id === l.id)
        .map((v) => {
          const h = hargaPerVarian.get(v.id);
          return {
            id: v.id,
            serviceId: v.service_id,
            // `labelVarian()` — SATU-SATUNYA perangkai label varian di proyek
            // ini. Varian baku memulangkan string kosong, dan itu SAH.
            label: labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format }),
            hargaKlien: h ? formatRupiah(h.harga) : null,
            hargaCoret: h?.coret != null ? formatRupiah(h.coret) : null,
          };
        }),
    };
  });
```

Impor yang perlu ditambahkan ke berkas ini: `formatRupiah` dari
`@/lib/rupiah-publik`. `hariIniJakarta` dan `labelVarian` sudah terimpor.

Urutan fase mengikuti `phases.urutan`; urutkan `katalog` dengan
`(a, b) => urutanFase(a) - urutanFase(b)` sebelum dioper, supaya kelompoknya
tampil dalam urutan perjalanan yang sama dengan landing.

- [ ] **Step 3: Komponen katalog**

Buat `web/src/app/passport/ajukan/katalog.tsx` sebagai komponen `"use client"`.
Tanda tangannya tetap, isinya digarap mengikuti skill `frontend-design`:

```tsx
"use client";

export type VarianKatalogAjukan = {
  id: string;
  serviceId: string;
  /** Dari `labelVarian()`. String kosong = varian baku, tampil "Standar". */
  label: string;
  /** Sudah diformat rupiah di server. `null` = tarifnya belum ditetapkan. */
  hargaKlien: string | null;
  hargaCoret: string | null;
};

export type LayananKatalogAjukan = {
  id: string;
  nama: string;
  /** Mis. "Garbha · Masa Kehamilan". String kosong bila fasenya tak terbaca. */
  namaFase: string;
  varian: VarianKatalogAjukan[];
};

export function Katalog({
  layanan,
  varianId,
  onPilih,
}: {
  layanan: LayananKatalogAjukan[];
  varianId: string;
  /**
   * SATU callback yang menyetel KEDUANYA. Bukan dua penyetel terpisah, dan itu
   * bukan selera: memilih varian dari layanan lain tanpa ikut menggeser
   * `layananId` menghasilkan kombinasi yang ditolak FK gabungan
   * (service_id, variant_id) di basis data — penolakan yang sampai ke klien
   * sebagai kalimat galat untuk kombinasi yang tidak pernah ia maksud.
   */
  onPilih: (serviceId: string, varianId: string) => void;
}) { /* … */ }
```

Wajib dipenuhi isinya:


- kelompok per fase (`namaFase` sebagai tajuk), kartu per layanan, varian
  sebagai tombol berkartu ber-`aria-pressed={v.id === varianId}`;
- target sentuh minimal 44 px, sejalan dengan sisa formulir;
- `hargaCoret` dirender dengan `line-through` dan `aria-label` yang menyebutnya harga sebelumnya, supaya pembaca layar tidak membacakan dua angka tanpa hubungan;
- varian ber-`label === ""` ditampilkan sebagai "Standar", persis seperti `<select>` yang digantikannya.

- [ ] **Step 4: Komponen ringkasan**

Buat `web/src/app/passport/ajukan/ringkasan.tsx` (`"use client"`), menerima `hargaLayanan: string | null` dan `namaTerpilih: string`:

```
Layanan     Rp 395.000
Transport   dihitung setelah bidan ditetapkan
Perkiraan   Rp 395.000 +
```

Kata **"Perkiraan"** dan tanda **`+`** wajib ada dan tidak boleh diganti "Total". Transport berasal dari domisili bidan ke alamat klien, dan bidannya belum dipilih saat memesan; menampilkan harga layanan sebagai "Total" adalah angka yang pasti berubah dan akan dibaca klien sebagai janji. Tulis alasan itu sebagai komentar di berkasnya.

- [ ] **Step 5: Pasang di `form.tsx`**

Ganti dua `<label>` berisi `<select name="layanan">` dan `<select name="varian">` dengan `<Katalog …>`, dan sisipkan `<Ringkasan …>` tepat di atas tombol kirim.

**Kontrak FormData TIDAK BOLEH berubah.** `fd.set("varian", varianId)` sudah dilakukan di handler; tambahkan `fd.set("layanan", layananId)` karena `<select name="layanan">` yang dulu menyediakannya kini tidak ada. Tanpa baris itu, `ajukanJadwal` menerima `layanan` kosong dan menolak setiap pengajuan.

Sisa medan (tanggal, jam, preferensi waktu, alamat, catatan) dipertahankan apa adanya, hanya ditata ulang ke dalam kelompok bertajuk "Kapan" dan "Ke mana" sesuai rancangan.

- [ ] **Step 6: Verifikasi**

```bash
cd web && npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -30
cd web && npm run test:e2e:passport && npm run test:e2e:funnel
```

Harapan: hijau. Bila skrip E2E memilih layanan lewat `<select>`, sesuaikan pemilihnya ke tombol katalog — itu penyesuaian, bukan uji baru.

Verifikasi manual: masuk sebagai klien dengan skrining hijau, buka `/passport/ajukan`, pilih varian dari layanan kedua, kirim. Harapan: pengajuan tersimpan dengan layanan **dan** varian yang benar (periksa di `/admin/sesi`), dan ringkasan menampilkan harga varian terpilih.

- [ ] **Step 7: Commit**

```bash
cd web && git add src/app/passport/ajukan/
git commit -m "feat(ajukan): pesan layanan jadi katalog berharga

Harga klien sudah tampil publik di landing sejak spec V4; klien yang sudah
masuk justru melihat lebih sedikit daripada pengunjung yang belum mendaftar.
Sumbernya view harga_publik yang sudah ada — nol permukaan data baru.

Kontrak FormData ke ajukanJadwal tidak berubah, jadi seluruh pagar server,
gerbang skrining tiga lapis, dan trigger basis data tetap utuh."
```

---

## Penutup: berkas tindak lanjut

- [ ] **Step 1: Tulis `docs/superpowers/2026-09-09-tagihan-email-katalog-tindak-lanjut.md`**

Isinya, mengikuti bentuk berkas tindak lanjut yang sudah ada:

- angka suite saat merge (`npm test`, E2E, `lint`, `build`);
- doktrin `di_atas_20` yang berubah beserta alasannya, supaya pembaca berikutnya tidak mengira constraint-nya hilang karena kelalaian;
- **yang perlu disiapkan sebelum produksi:** `RESEND_API_KEY` + `EMAIL_PENGIRIM` + verifikasi DNS domain pengirim; `NEXT_PUBLIC_BASIS_URL`; tarif `di_atas_20` ditetapkan owner lewat `/owner/transport`; **setiap mitra produksi wajib punya pin di peta**;
- **yang tidak diuji** — salin empat butir §4 spec apa adanya. Ini yang paling penting: ia satu-satunya catatan bahwa mode nol-uji dipilih sadar, dan apa harganya.

- [ ] **Step 2: Commit**

```bash
cd .. && git add docs/superpowers/2026-09-09-tagihan-email-katalog-tindak-lanjut.md
git commit -m "docs: tindak lanjut tagihan bernominal, email, & katalog"
```
