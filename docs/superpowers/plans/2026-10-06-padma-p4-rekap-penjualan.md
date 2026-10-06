# P4 — Rekap Penjualan & Riwayat Pembelian: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memberi owner satu layar rekap penjualan produk digital per bulan, dan memberi admin daftar nota penjualan plus riwayat pembelian per klien — semuanya baca-saja, di atas data yang sudah ada.

**Architecture:** Nol view gabungan baru dan nol penjumlahan di SQL. Lapisan data `src/lib/penjualan/` membaca `orders`, `pesanan_item_staf`, `notifikasi_pesanan`, dan `jejak_pesanan` dengan sesi pemanggil, lalu menjumlahkannya di TypeScript — doktrin yang sudah berlaku untuk margin PADMA di `/owner/rekap`. Satu migrasi menambahkan `product_id` ke view yang sudah ada supaya pengelompokan per produk berpegang pada identitas, bukan pada judul beku.

**Tech Stack:** Next.js 16 App Router (server components), Supabase/PostgREST, TypeScript, vitest (`environment: "node"`, nol jsdom — uji komponen memakai `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-10-02-padma-p4-rekap-penjualan-design.md`

## Global Constraints

Setiap tugas tunduk pada seluruh baris di bawah ini.

- **Nol service role.** Semua pembacaan P4 memakai `createServerSupabase()` (sesi pemanggil). Tidak ada satu pun `createAdminSupabase()` di kode produksi P4.
- **Nol tombol aksi.** Ketiga permukaan baca-saja. Tidak ada `"use server"`, tidak ada mutasi, tidak ada `revalidatePath`.
- **Nol literal status.** Himpunan status DITURUNKAN dari `@/lib/pesanan/status` (`PESANAN_BERUANG`, `PESANAN_MATI`, `PESANAN_TIDAK_AKTIF`). Nilai enum keenam yang kelak lahir harus ikut terbawa tanpa satu baris pun disunting.
- **`formatRupiah` diimpor dari `@/lib/rupiah-publik`**, bukan dari `@/lib/owner/rupiah`. Preseden dan alasannya ada di dokblok `src/app/admin/pesanan/tabel-pesanan.tsx:1-23`. Jalur `@/lib/owner/rupiah` adalah pintu wilayah owner; mengimpornya dari `src/app/admin/**` menyalahi batas yang sengaja dipasang.
- **Galat PostgREST DIBACA lalu DILEMPAR**, tidak pernah dibuang diam-diam. Pola: `if (hasil.error) throw hasil.error;`
- **Embed yang ditahan RLS memulangkan `null`, bukan galat.** Nilai yang tidak terbaca diteruskan apa adanya ke komponen, yang merendernya sebagai kegagalan baca yang TERLIHAT — bukan sel kosong.
- **Nol item terbaca → `null`, bukan `0`.** "Rp 0" yang diucapkan dengan yakin terbaca sebagai selisih. Nol yang sah (produk gratis) tetap punya itemnya.
- **Bulan dihitung lewat `bulanJakarta()`, tidak pernah `iso.slice(0, 7)`.** Stempel PostgREST adalah UTC; pembelian pukul 06.30 WIB tercatat 23.30Z hari sebelumnya.
- **Rute baru WAJIB masuk tabel rute `web/README.md`.** `tests/inventaris-rute.test.ts` memeriksa dua arah dan akan merah bila tidak.
- **Supabase lokal dipakai bersama sesi lain.** Jalankan uji BERLINGKUP (`npx vitest run tests/<berkas>`), jangan `npm test` penuh, dan jangan `supabase db reset` tanpa memberi tahu.
- Seluruh nama berkas, fungsi, tipe, dan teks UI dalam bahasa Indonesia, mengikuti repo.

## Review Focus

Lima kelas masukan yang tersirat di spec tetapi tidak otomatis teruji, paling mungkin menggigit lebih dulu:

1. **Bulan tanpa penjualan sama sekali di tengah deret 12 bulan** — harus muncul sebagai nol di grafik, bukan dilompati. Deret yang melompat membuat tren terbaca naik padahal datar. → diuji di Tugas 2 (`deretBulanTerakhir`) dan Tugas 5.
2. **Pesanan multi-item dari keranjang P2** — satu pesanan berisi tiga produk harus menghasilkan tiga baris di daftar admin tetapi dihitung sebagai SATU pembelian, dan ketiga produknya masuk ke tiga baris per-produk yang berbeda. → diuji di Tugas 3.
3. **Produk gratis (`harga_beku = 0`)** — barisnya harus muncul dengan Rp 0, bukan hilang karena dikira "tidak ada nominal". Yang membedakan nol sah dari nol palsu adalah ada/tidaknya item. → diuji di Tugas 3.
4. **Embed `clients` yang ditahan RLS** — nama dan PADMA ID kosong harus terlihat sebagai kegagalan baca di layar, bukan sebagai sel kosong yang terbaca "klien tanpa nama". → diuji di Tugas 6.
5. **Dua pesanan ber-`ditutup_pada` identik** — urutannya harus stabil antar muat ulang. `ditutup_pada` hanyalah `now()`; dua pesanan boleh memikul cap yang sama persis, dan urutan yang berubah sendiri di layar uang membuat pembacanya berhenti memercayai angkanya. → diuji di Tugas 3.

---

## Struktur Berkas

**Dibuat:**

| Berkas | Tanggung jawab |
|---|---|
| `web/supabase/migrations/20261006100000_pesanan_item_produk_id.sql` | Menambahkan `product_id` ke view `pesanan_item_staf` |
| `web/src/lib/penjualan/bulan.ts` | Kunci bulan Jakarta, label, deret, rentang ISO. Murni. |
| `web/src/lib/penjualan/hitung.ts` | Tipe baris, penggolongan, agregasi per bulan & per produk. Murni. |
| `web/src/lib/penjualan/baca.ts` | Pembacaan Supabase, penggabungan jadi `BarisPenjualan[]` |
| `web/src/app/owner/penjualan/page.tsx` | Layar rekap owner |
| `web/src/app/owner/penjualan/kartu-bulan.tsx` | Satu kartu bulan |
| `web/src/app/admin/penjualan/page.tsx` | Layar daftar nota admin |
| `web/src/app/admin/penjualan/tabel-penjualan.tsx` | Tabel nota |
| `web/src/app/admin/klien/[id]/kartu-pembelian.tsx` | Bagian riwayat pembelian per klien |
| `web/tests/penjualan-bulan.test.ts` | Uji murni `bulan.ts` |
| `web/tests/penjualan-hitung.test.ts` | Uji murni `hitung.ts` |
| `web/tests/penjualan-db.test.ts` | Uji ber-DB `baca.ts` + kolom view |
| `web/tests/penjualan-layar.test.tsx` | Uji render ketiga permukaan |

**Disunting:**

| Berkas | Perubahan |
|---|---|
| `web/tests/pesanan-akses-tiga-keadaan.test.ts:1018-1043` | enam kolom → tujuh |
| `web/src/app/owner/_shell/nav-owner.tsx` | entri `/owner/penjualan` |
| `web/src/app/admin/_shell/nav-admin.tsx` | entri `/admin/penjualan` |
| `web/src/app/admin/klien/[id]/page.tsx` | merender `<KartuPembelian>` |
| `web/README.md` | dua baris tabel rute |

---

## Task 1: Migrasi `product_id` pada `pesanan_item_staf`

**Files:**
- Create: `web/supabase/migrations/20261006100000_pesanan_item_produk_id.sql`
- Modify: `web/tests/pesanan-akses-tiga-keadaan.test.ts:1018-1043`

**Interfaces:**
- Consumes: tidak ada
- Produces: view `public.pesanan_item_staf` berkolom `(pesanan_id, kode, jenis, judul_beku, harga_beku, urutan, product_id)`. Tugas 4 membacanya.

- [ ] **Step 1: Sunting uji kolom supaya MERAH lebih dulu**

Di `web/tests/pesanan-akses-tiga-keadaan.test.ts`, ubah nama uji dan daftar kolomnya:

```ts
  it("staf melihat TUJUH kolom BERNOMINAL; klien tidak melihat baris apa pun", async () => {
```

dan daftar kolomnya (tetap urut alfabet, karena di-`.sort()`):

```ts
    expect(Object.keys(data![0]).sort()).toEqual([
      "harga_beku",
      "jenis",
      "judul_beku",
      "kode",
      "pesanan_id",
      "product_id",
      "urutan",
    ]);
```

Tambahkan satu assertion bahwa kolom barunya benar-benar membawa identitas produknya, tepat di bawah `expect(data![0].judul_beku).toBe("Kelas Menyusui");`:

```ts
    // Kolom ini SEBAB migrasi 20261006100000 ada: pengelompokan per produk
    // harus berpegang pada identitas, bukan pada judul beku yang pecah jadi
    // dua baris laporan saat produk diganti nama.
    expect(data![0].product_id).toBe(produk);
```

- [ ] **Step 2: Jalankan untuk memastikan MERAH**

```bash
cd web && npx vitest run tests/pesanan-akses-tiga-keadaan.test.ts -t "TUJUH kolom"
```

Diharapkan: GAGAL — larik yang dipulangkan masih enam kolom, `product_id` tidak ada.

- [ ] **Step 3: Tulis migrasinya**

Buat `web/supabase/migrations/20261006100000_pesanan_item_produk_id.sql`:

```sql
-- ===========================================================================
-- P4 (1/7) — pesanan_item_staf memikul product_id
-- ===========================================================================
-- Rekap penjualan mengelompokkan per PRODUK. Tanpa kolom ini satu-satunya
-- kunci yang tersedia adalah `judul_beku` — dan judul beku memang BEKU per
-- baris nota. Akibatnya satu produk yang pernah diganti namanya pecah menjadi
-- dua baris laporan, keduanya terlihat masuk akal, tanpa satu pun galat.
--
-- `create or replace view`, BUKAN drop + create. Dua alasan:
--   * ia mengizinkan penambahan kolom DI UJUNG daftar tanpa menjatuhkan hak;
--   * `drop view` menjatuhkan `grant select ... to authenticated` dan memaksa
--     baris itu ditulis ulang. Satu baris yang mudah terlupa — dan yang kalau
--     terlupa membuat layar staf kosong TANPA galat, karena hak yang hilang
--     di PostgREST berujung nol baris, bukan 42501, saat view-nya sendiri
--     masih ada.
--
-- `product_id` BUKAN kolom nominal: ia tidak cocok dengan satu pun pola di
-- `POLA_NOMINAL` (tests/money-firewall-struktural.test.ts). Karena itu
-- `KOLOM_UANG_VIEW_DIIZINKAN` TIDAK perlu disunting, dan bila uji money
-- firewall merah sesudah migrasi ini, itu tanda ada yang salah — bukan tanda
-- daftarnya perlu ditambah.
--
-- Nol perubahan pada `order_items`, nol perubahan pada hak, nol kolom baru di
-- tabel mana pun.
create or replace view public.pesanan_item_staf with (security_invoker = off) as
  select i.pesanan_id,
         o.kode,
         i.jenis,
         i.judul_beku,
         i.harga_beku,
         i.urutan,
         i.product_id
    from public.order_items i
    join public.orders o on o.id = i.pesanan_id
   where public.user_role() in ('admin', 'owner');

comment on view public.pesanan_item_staf is
  'Item pesanan BERNOMINAL untuk /admin/pesanan dan /admin/penjualan — tujuh '
  'kolom, predikat user_role() di dalam badannya. Anon tidak pernah. Inilah '
  'satu-satunya jalan harga beku keluar dari order_items. product_id ada demi '
  'pengelompokan per produk yang tidak pecah saat produk diganti nama.';
```

- [ ] **Step 4: Terapkan migrasi ke Supabase lokal**

```bash
cd web && npx supabase migration up --local
```

Diharapkan: migrasi `20261006100000` diterapkan tanpa galat. Bila Docker mati, hidupkan dulu (`npx supabase start`) — JANGAN `db reset`, basis data lokal dipakai bersama sesi lain.

- [ ] **Step 5: Jalankan uji untuk memastikan HIJAU**

```bash
cd web && npx vitest run tests/pesanan-akses-tiga-keadaan.test.ts
```

Diharapkan: SELURUH berkas hijau — termasuk uji anon `42501` dan uji klien nol-baris, yang membuktikan `create or replace` tidak menjatuhkan hak apa pun.

- [ ] **Step 6: Pastikan money firewall & hak TIDAK bergeser**

```bash
cd web && npx vitest run tests/money-firewall-struktural.test.ts tests/grant-anon.test.ts tests/struktur-rls.test.ts
```

Diharapkan: ketiganya HIJAU tanpa satu pun disunting. Bila salah satu merah, berhenti — itu tanda migrasinya menyimpang dari spec, bukan tanda ujinya perlu diubah.

- [ ] **Step 7: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20261006100000_pesanan_item_produk_id.sql web/tests/pesanan-akses-tiga-keadaan.test.ts
git commit -m "feat(penjualan): pesanan_item_staf memikul product_id

Pengelompokan per produk harus berpegang pada identitas. Dengan judul_beku
sebagai satu-satunya kunci, produk yang pernah diganti nama pecah jadi dua
baris laporan tanpa satu pun galat.

create or replace, bukan drop + create: drop menjatuhkan grant select dan
hak yang hilang berujung nol baris di PostgREST, bukan 42501."
```

---

## Task 2: `bulan.ts` — kunci bulan Jakarta

**Files:**
- Create: `web/src/lib/penjualan/bulan.ts`
- Test: `web/tests/penjualan-bulan.test.ts`

**Interfaces:**
- Consumes: tidak ada
- Produces:
  - `bulanJakarta(iso: string): string | null` — `"2026-10"`, `null` bila stempelnya tak sah
  - `labelBulan(kunci: string): string` — `"Oktober 2026"`
  - `labelBulanPendek(kunci: string): string` — `"Okt 26"`
  - `deretBulanTerakhir(sampai: string, banyak: number): string[]` — terlama lebih dulu
  - `rentangBulanJakarta(kunci: string): { mulai: string; sampai: string }` — ISO, batas atas EKSKLUSIF
  - `bulanSekarangJakarta(sekarang?: Date): string`
  - `stempelTanggalJakarta(iso: string): string` — `"15 Okt 2026"`, `"—"` bila tak sah

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/penjualan-bulan.test.ts`:

```ts
/**
 * PAGAR: pengelompokan bulan memakai kalender JAKARTA, bukan potongan string.
 *
 * Kelas kesalahannya sudah dibayar repo ini sekali, untuk TANGGAL, dan
 * dokblok `stempelJakarta` di `src/lib/owner/pekan.ts` mengejanya: stempel
 * yang dipulangkan PostgREST adalah UTC, dan peristiwa pukul 06.30 WIB
 * tercatat 23.30Z HARI SEBELUMNYA. Untuk tanggal itu memindahkan satu tanda
 * bayar; untuk BULAN ia memindahkan seluruh omzet sebuah pembelian ke bulan
 * pembukuan yang salah.
 */
import { describe, it, expect } from "vitest";
import {
  bulanJakarta,
  labelBulan,
  labelBulanPendek,
  deretBulanTerakhir,
  rentangBulanJakarta,
  bulanSekarangJakarta,
  stempelTanggalJakarta,
} from "@/lib/penjualan/bulan";

describe("bulanJakarta", () => {
  it("pembelian 06.30 WIB tanggal 1 masuk bulan BARU, bukan bulan sebelumnya", () => {
    // 2026-10-01 06:30 WIB === 2026-09-30 23:30 UTC
    expect(bulanJakarta("2026-09-30T23:30:00Z")).toBe("2026-10");
  });

  it("KONTROL NEGATIF: memotong string ISO memulangkan bulan yang SALAH", () => {
    // Tinggal di repo dengan sengaja. Sesudah fungsi di atas benar, temuan
    // nyatanya nol selamanya — dan pemindai yang rusak juga memulangkan nol.
    // Tanpa kontrol ini keduanya tidak bisa dibedakan.
    expect("2026-09-30T23:30:00Z".slice(0, 7)).toBe("2026-09");
    expect(bulanJakarta("2026-09-30T23:30:00Z")).not.toBe(
      "2026-09-30T23:30:00Z".slice(0, 7),
    );
  });

  it("pembelian siang hari jatuh di bulan yang sama di kedua zona", () => {
    expect(bulanJakarta("2026-10-15T05:00:00Z")).toBe("2026-10");
  });

  it("peristiwa 31 Des 20.00 WIB masih tahun yang sama", () => {
    // 2026-12-31 20:00 WIB === 2026-12-31 13:00 UTC
    expect(bulanJakarta("2026-12-31T13:00:00Z")).toBe("2026-12");
  });

  it("peristiwa 1 Jan 01.00 WIB sudah tahun BARU walau UTC-nya masih tahun lama", () => {
    // 2027-01-01 01:00 WIB === 2026-12-31 18:00 UTC
    expect(bulanJakarta("2026-12-31T18:00:00Z")).toBe("2027-01");
  });

  it("stempel tak sah memulangkan null, bukan bucket hantu", () => {
    expect(bulanJakarta("bukan tanggal")).toBeNull();
    expect(bulanJakarta("")).toBeNull();
  });
});

describe("deretBulanTerakhir", () => {
  it("memulangkan N bulan berurutan, terlama lebih dulu", () => {
    expect(deretBulanTerakhir("2026-03", 4)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("deretnya UTUH walau sebuah bulan tidak punya penjualan", () => {
    // Inilah sebab fungsi ini ada. Membangun sumbu-X dari bulan yang PUNYA
    // data membuat bulan kosong hilang dari grafik, dan tren yang sebenarnya
    // datar terbaca naik.
    const deret = deretBulanTerakhir("2026-10", 12);
    expect(deret).toHaveLength(12);
    expect(deret[0]).toBe("2025-11");
    expect(deret[11]).toBe("2026-10");
    // Tidak ada lompatan: setiap pasangan berurutan terpaut tepat satu bulan.
    for (let i = 1; i < deret.length; i++) {
      const [ta, ba] = deret[i - 1].split("-").map(Number);
      const [tb, bb] = deret[i].split("-").map(Number);
      expect(tb * 12 + bb - (ta * 12 + ba)).toBe(1);
    }
  });

  it("kunci tak sah melempar, tidak memulangkan deret hantu", () => {
    expect(() => deretBulanTerakhir("2026-13", 3)).toThrow();
    expect(() => deretBulanTerakhir("oktober", 3)).toThrow();
  });
});

describe("rentangBulanJakarta", () => {
  it("batas bawah inklusif dan batas atas EKSKLUSIF, keduanya +07:00", () => {
    expect(rentangBulanJakarta("2026-10")).toEqual({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
    });
  });

  it("Desember menyeberang tahun", () => {
    expect(rentangBulanJakarta("2026-12")).toEqual({
      mulai: "2026-12-01T00:00:00+07:00",
      sampai: "2027-01-01T00:00:00+07:00",
    });
  });

  it("rentangnya memulangkan pembelian 06.30 WIB tanggal 1 ke bulan yang benar", () => {
    // Pengikat antara rentang kueri dan pengelompokan: keduanya harus
    // menjawab sama untuk stempel yang sama, kalau tidak ada pembelian yang
    // tertarik kueri bulan X lalu dikelompokkan ke bulan Y.
    const stempel = "2026-09-30T23:30:00Z";
    const { mulai, sampai } = rentangBulanJakarta("2026-10");
    expect(Date.parse(stempel)).toBeGreaterThanOrEqual(Date.parse(mulai));
    expect(Date.parse(stempel)).toBeLessThan(Date.parse(sampai));
    expect(bulanJakarta(stempel)).toBe("2026-10");
  });
});

describe("label", () => {
  it("labelBulan memakai nama bulan Indonesia", () => {
    expect(labelBulan("2026-10")).toBe("Oktober 2026");
    expect(labelBulan("2027-01")).toBe("Januari 2027");
  });

  it("labelBulanPendek cukup pendek untuk sumbu grafik", () => {
    expect(labelBulanPendek("2026-10")).toBe("Okt 26");
  });

  it("kunci tak sah memulangkan tanda pisah, bukan 'Invalid Date'", () => {
    expect(labelBulan("entah")).toBe("—");
    expect(labelBulanPendek("entah")).toBe("—");
  });
});

describe("bulanSekarangJakarta", () => {
  it("memakai jam Jakarta, bukan jam proses", () => {
    expect(bulanSekarangJakarta(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10");
  });
});

describe("stempelTanggalJakarta", () => {
  it("memakai TANGGAL Jakarta, bukan tanggal UTC", () => {
    // Kesalahan yang sama dengan bulan, satu tingkat lebih halus: pembelian
    // 06.30 WIB tanggal 1 Oktober tercatat 30 September di UTC.
    expect(stempelTanggalJakarta("2026-09-30T23:30:00Z")).toBe("1 Okt 2026");
  });

  it("stempel tak sah memulangkan tanda pisah, bukan 'Invalid Date'", () => {
    expect(stempelTanggalJakarta("entah")).toBe("—");
  });
});
```

- [ ] **Step 2: Jalankan untuk memastikan MERAH**

```bash
cd web && npx vitest run tests/penjualan-bulan.test.ts
```

Diharapkan: GAGAL — `Failed to resolve import "@/lib/penjualan/bulan"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/penjualan/bulan.ts`:

```ts
// ============================================================================
// BULAN JAKARTA — kunci bucket rekap penjualan
// ============================================================================
// KENAPA TIDAK MEMOTONG STRING ISO.
//
// `src/lib/owner/pekan.ts` sudah mengeja kelas kesalahannya untuk TANGGAL:
// stempel yang dipulangkan PostgREST adalah UTC, dan peristiwa pukul 06.30
// WIB tercatat 23.30Z HARI SEBELUMNYA. `iso.slice(0, 7)` karena itu
// memulangkan "2026-09" untuk pembelian yang bagi pembelinya — dan bagi
// pembukuan PADMA — terjadi pada 1 Oktober.
//
// Untuk tanggal, kesalahan itu menggeser satu tanda bayar. Untuk BULAN ia
// memindahkan seluruh omzet sebuah pembelian ke bulan pembukuan yang salah,
// dan hanya terjadi pada pembelian di jendela 17.00–24.00 UTC di hari
// terakhir/pertama bulan — yaitu cukup jarang untuk tidak pernah ketahuan,
// dan cukup sering untuk selalu salah sedikit.
//
// `Intl` dipakai untuk MENERJEMAHKAN zona (satu-satunya cara benar), dan
// aritmatika bulannya memakai bilangan bulat murni — tidak ada `Date` yang
// ditambah-kurang, jadi tidak ada DST maupun ICU yang bisa menggesernya.

const ZONA = "Asia/Jakarta";

/** Offset Jakarta TETAP +07:00 — WIB tidak pernah mengenal DST. */
const OFFSET = "+07:00";

const POLA_KUNCI = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * `en-CA` memulangkan tanggal ber-pola ISO, tetapi yang dipungut di bawah
 * adalah BAGIAN-nya (`formatToParts`), bukan stringnya — jadi perubahan data
 * ICU pada pemisah atau urutan tidak bisa menggeser hasilnya diam-diam.
 */
const FMT_BAGIAN = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
});

const FMT_LABEL = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const FMT_LABEL_PENDEK = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  month: "short",
  year: "2-digit",
});

/**
 * Kunci bucket bulan menurut kalender Jakarta, mis. `"2026-10"`.
 *
 * `null` — bukan string kosong dan bukan lemparan — untuk stempel tak sah:
 * pemanggilnya menghitung uang, dan bucket hantu bernama `"NaN-NaN"` akan
 * mengumpulkan baris yang tidak pernah muncul di bulan mana pun.
 */
export function bulanJakarta(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;

  const bagian = FMT_BAGIAN.formatToParts(new Date(ms));
  const tahun = bagian.find((b) => b.type === "year")?.value;
  const bulan = bagian.find((b) => b.type === "month")?.value;
  if (!tahun || !bulan) return null;

  return `${tahun}-${bulan}`;
}

/** Bulan berjalan menurut jam JAKARTA, bukan jam proses (Vercel berjalan UTC). */
export function bulanSekarangJakarta(sekarang: Date = new Date()): string {
  return bulanJakarta(sekarang.toISOString()) ?? "";
}

function urai(kunci: string): { tahun: number; bulan: number } {
  const cocok = POLA_KUNCI.exec(kunci);
  if (!cocok) throw new Error(`Kunci bulan tak sah: ${kunci}`);
  return { tahun: Number(cocok[1]), bulan: Number(cocok[2]) };
}

function rakit(tahun: number, bulan: number): string {
  return `${String(tahun).padStart(4, "0")}-${String(bulan).padStart(2, "0")}`;
}

/**
 * `banyak` bulan berurutan yang BERAKHIR di `sampai`, terlama lebih dulu.
 *
 * Sumbu-X grafik dibangun dari SINI, bukan dari bulan yang kebetulan punya
 * data. Bulan tanpa penjualan yang hilang dari sumbu membuat tren yang
 * sebenarnya datar terbaca naik — dan grafik tren yang berbohong lebih buruk
 * daripada tidak ada grafik sama sekali.
 */
export function deretBulanTerakhir(sampai: string, banyak: number): string[] {
  let { tahun, bulan } = urai(sampai);
  const hasil: string[] = [];
  for (let i = 0; i < banyak; i++) {
    hasil.push(rakit(tahun, bulan));
    bulan -= 1;
    if (bulan === 0) {
      bulan = 12;
      tahun -= 1;
    }
  }
  return hasil.reverse();
}

/**
 * Rentang satu bulan sebagai stempel ber-offset Jakarta. Batas atas
 * EKSKLUSIF, jadi pemanggilnya memakai `.gte(mulai).lt(sampai)` — bukan
 * `.lte`, yang akan memungut pembelian tepat tengah malam tanggal 1 ke DUA
 * bulan sekaligus dan menghitung uangnya dua kali.
 */
export function rentangBulanJakarta(kunci: string): { mulai: string; sampai: string } {
  const { tahun, bulan } = urai(kunci);
  const tahunBerikut = bulan === 12 ? tahun + 1 : tahun;
  const bulanBerikut = bulan === 12 ? 1 : bulan + 1;
  return {
    mulai: `${rakit(tahun, bulan)}-01T00:00:00${OFFSET}`,
    sampai: `${rakit(tahunBerikut, bulanBerikut)}-01T00:00:00${OFFSET}`,
  };
}

/**
 * `timeZone: "UTC"` pada kedua formatter label BUKAN kelalaian: yang
 * diformat adalah tanggal buatan (hari ke-15 tengah malam UTC), bukan sebuah
 * peristiwa. Hari ke-15 dipilih supaya tidak ada offset zona mana pun yang
 * bisa menggesernya ke bulan tetangga.
 */
function keTanggalLabel(kunci: string): Date | null {
  const cocok = POLA_KUNCI.exec(kunci);
  if (!cocok) return null;
  return new Date(Date.UTC(Number(cocok[1]), Number(cocok[2]) - 1, 15));
}

export function labelBulan(kunci: string): string {
  const d = keTanggalLabel(kunci);
  return d === null ? "—" : FMT_LABEL.format(d);
}

export function labelBulanPendek(kunci: string): string {
  const d = keTanggalLabel(kunci);
  return d === null ? "—" : FMT_LABEL_PENDEK.format(d).replace(".", "");
}

const FMT_STEMPEL = new Intl.DateTimeFormat("id-ID", {
  timeZone: ZONA,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Label TANGGAL dari sebuah stempel waktu, mis. `"15 Okt 2026"`.
 *
 * Padanan `stempelJakarta` di `src/lib/owner/pekan.ts`, DISALIN ke sini
 * dengan sengaja alih-alih diimpor. Alasannya batas wilayah, bukan selera:
 * nol berkas di `src/app/admin/**` mengimpor dari `@/lib/owner/` hari ini,
 * dan `/admin/penjualan` tidak boleh menjadi yang pertama. Modul `penjualan`
 * dipakai KEDUA wilayah, jadi di sinilah tempat yang netral.
 *
 * Tanggalnya TIDAK boleh dipotong dari stringnya (`iso.slice(0, 10)`):
 * stempel itu UTC, dan pembelian pukul 06.30 WIB tercatat 23.30Z HARI
 * SEBELUMNYA.
 */
export function stempelTanggalJakarta(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return FMT_STEMPEL.format(new Date(ms)).replace(".", "");
}
```

- [ ] **Step 4: Jalankan untuk memastikan HIJAU**

```bash
cd web && npx vitest run tests/penjualan-bulan.test.ts
```

Diharapkan: seluruh uji LULUS. Bila `labelBulanPendek` memulangkan bentuk lain (mis. `"Okt 2026"`), sesuaikan ASSERTION-nya pada keluaran ICU yang sebenarnya — jangan memaksa formatnya dengan potongan string manual.

- [ ] **Step 5: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/penjualan/bulan.ts web/tests/penjualan-bulan.test.ts
git commit -m "feat(penjualan): kunci bulan menurut kalender Jakarta

Pembelian pukul 06.30 WIB tanggal 1 tercatat 23.30Z hari sebelumnya.
Memotong string ISO memindahkan omzetnya ke bulan pembukuan yang salah —
dan hanya untuk pembelian di jendela 17.00-24.00 UTC di pergantian bulan,
yaitu cukup jarang untuk tidak pernah ketahuan.

Kontrol negatif yang membuktikan itu tinggal di dalam ujinya."
```

---

## Task 3: `hitung.ts` — penggolongan & agregasi

**Files:**
- Create: `web/src/lib/penjualan/hitung.ts`
- Test: `web/tests/penjualan-hitung.test.ts`

**Interfaces:**
- Consumes: `bulanJakarta` dari Tugas 2; `StatusPesanan`, `PESANAN_MATI` dari `@/lib/pesanan/status`
- Produces:
  - `type ItemPenjualan = { productId: string | null; judulBeku: string; hargaBeku: number; urutan: number }`
  - `type BarisPenjualan = { pesananId: string; kode: string; status: StatusPesanan; lunasPada: string | null; uangPada: string | null; padmaId: string; namaKlien: string; pernahDikembalikan: boolean; lunasSetelahTutup: boolean; item: ItemPenjualan[] | null }`
  - `type Golongan = "omzet" | "dikembalikan" | "ditahan" | "lewat_tenggat" | "bukan_penjualan"`
  - `golongkan(b: BarisPenjualan): Golongan`
  - `tanggalUang(b: BarisPenjualan): string | null`
  - `nilaiBaris(b: BarisPenjualan): number | null`
  - `type RingkasProduk = { kunci: string; judul: string; banyak: number; nilai: number }`
  - `type Pengecualian = { golongan: Exclude<Golongan, "omzet" | "bukan_penjualan">; banyak: number; nilai: number }`
  - `type PenjualanBulan = { bulan: string; omzet: number; jumlahPembelian: number; perProduk: RingkasProduk[]; pengecualian: Pengecualian[] }`
  - `hitungPenjualan(baris: readonly BarisPenjualan[]): { bulan: PenjualanBulan[]; tanpaTanggal: number }`
  - `urutkanBaris(baris: readonly BarisPenjualan[]): BarisPenjualan[]`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/penjualan-hitung.test.ts`:

```ts
/**
 * Agregasi penjualan, DIUJI TANPA BASIS DATA.
 *
 * Seluruh keputusan "apa yang disebut terjual" hidup di modul murni ini,
 * justru supaya ia bisa diuji dengan fixture alih-alih dengan Supabase lokal
 * yang dipakai bersama sesi lain. Kalau sebuah aturan uang hanya bisa
 * dibuktikan dengan basis data yang menyala, ia akan jarang dibuktikan.
 */
import { describe, it, expect } from "vitest";
import {
  golongkan,
  hitungPenjualan,
  nilaiBaris,
  urutkanBaris,
  type BarisPenjualan,
} from "@/lib/penjualan/hitung";

/** Pesanan `lunas` bersih pada 15 Okt 2026, satu produk Rp 150.000. */
function barisDasar(ubah: Partial<BarisPenjualan> = {}): BarisPenjualan {
  return {
    pesananId: "p-1",
    kode: "PSN-261015-AAAAAA",
    status: "lunas",
    lunasPada: "2026-10-15T05:00:00Z",
    uangPada: "2026-10-15T05:00:00Z",
    padmaId: "PDM-0001",
    namaKlien: "Ibu A",
    pernahDikembalikan: false,
    lunasSetelahTutup: false,
    item: [{ productId: "prod-1", judulBeku: "Kelas Menyusui", hargaBeku: 150_000, urutan: 1 }],
    ...ubah,
  };
}

describe("golongkan", () => {
  it("lunas bersih adalah omzet", () => {
    expect(golongkan(barisDasar())).toBe("omzet");
  });

  it("lunas bertanda akses_tertahan TETAP omzet", () => {
    // Uangnya masuk dan terverifikasi; yang bermasalah pengantaran aksesnya.
    // Mengeluarkannya dari omzet berarti melaporkan pendapatan lebih kecil
    // dari yang benar-benar diterima.
    expect(golongkan(barisDasar({ status: "lunas" }))).toBe("omzet");
  });

  it("ditahan BUKAN omzet — uangnya ada di Midtrans, belum di PADMA", () => {
    expect(golongkan(barisDasar({ status: "ditahan", lunasPada: null }))).toBe("ditahan");
  });

  it("kedaluwarsa berjejak lunas_setelah_tutup masuk kelompoknya sendiri", () => {
    expect(
      golongkan(
        barisDasar({ status: "kedaluwarsa", lunasPada: null, lunasSetelahTutup: true }),
      ),
    ).toBe("lewat_tenggat");
  });

  it("kedaluwarsa BIASA bukan penjualan sama sekali", () => {
    expect(
      golongkan(barisDasar({ status: "kedaluwarsa", lunasPada: null, uangPada: null })),
    ).toBe("bukan_penjualan");
  });

  it("lunas yang pernah dikembalikan keluar dari omzet", () => {
    expect(golongkan(barisDasar({ pernahDikembalikan: true }))).toBe("dikembalikan");
  });

  it("JEBAKAN coalesce: sebab_tinjauan BUKAN sumber kebenaran refund", () => {
    // `sebab_tinjauan` ditulis `coalesce(o.sebab_tinjauan, v_sebab)`, jadi
    // alasan PERTAMA yang menang. Pesanan yang lebih dulu bertanda
    // `selisih_nominal` lalu kena chargeback tetap terbaca `selisih_nominal`
    // selamanya — dan saringan yang bersandar pada kolom itu akan
    // menghitungnya sebagai pendapatan.
    //
    // Fixture ini MENIRU keadaan itu: barisnya datang dari notifikasi
    // (`pernahDikembalikan: true`) meski kolom sebabnya menyebut hal lain.
    // Uji ini akan MERAH persis saat seseorang "menyederhanakan"
    // penggolongannya kembali ke `sebab_tinjauan`.
    const b = barisDasar({ pernahDikembalikan: true });
    expect(golongkan(b)).toBe("dikembalikan");
    expect(golongkan(b)).not.toBe("omzet");
  });
});

describe("nilaiBaris", () => {
  it("menjumlahkan harga beku seluruh item", () => {
    expect(
      nilaiBaris(
        barisDasar({
          item: [
            { productId: "a", judulBeku: "A", hargaBeku: 100_000, urutan: 1 },
            { productId: "b", judulBeku: "B", hargaBeku: 50_000, urutan: 2 },
          ],
        }),
      ),
    ).toBe(150_000);
  });

  it("produk GRATIS memulangkan nol, bukan null", () => {
    // Nol yang SAH tetap angka. Yang memisahkannya dari "tidak terbaca"
    // adalah ada/tidaknya item, bukan jumlahnya.
    expect(
      nilaiBaris(
        barisDasar({
          item: [{ productId: "g", judulBeku: "Panduan gratis", hargaBeku: 0, urutan: 1 }],
        }),
      ),
    ).toBe(0);
  });

  it("item yang TIDAK TERBACA memulangkan null, bukan nol", () => {
    expect(nilaiBaris(barisDasar({ item: null }))).toBeNull();
    expect(nilaiBaris(barisDasar({ item: [] }))).toBeNull();
  });
});

describe("hitungPenjualan", () => {
  it("menjumlahkan omzet per bulan dan menghitung pembelian, bukan item", () => {
    // Satu pesanan berisi TIGA produk adalah SATU pembelian. Keranjang P2
    // membuat bentuk ini biasa, bukan luar biasa.
    const hasil = hitungPenjualan([
      barisDasar({
        pesananId: "p-keranjang",
        item: [
          { productId: "a", judulBeku: "A", hargaBeku: 100_000, urutan: 1 },
          { productId: "b", judulBeku: "B", hargaBeku: 75_000, urutan: 2 },
          { productId: "c", judulBeku: "C", hargaBeku: 25_000, urutan: 3 },
        ],
      }),
    ]);

    expect(hasil.bulan).toHaveLength(1);
    expect(hasil.bulan[0].bulan).toBe("2026-10");
    expect(hasil.bulan[0].omzet).toBe(200_000);
    expect(hasil.bulan[0].jumlahPembelian).toBe(1);
    expect(hasil.bulan[0].perProduk).toHaveLength(3);
  });

  it("mengelompokkan per product_id, BUKAN per judul beku", () => {
    // Produk yang pernah diganti nama membekukan judul lama di nota lama.
    // Tanpa product_id keduanya pecah jadi dua baris laporan, dan keduanya
    // terlihat masuk akal.
    const hasil = hitungPenjualan([
      barisDasar({
        pesananId: "p-lama",
        kode: "PSN-260915-AAAAAA",
        lunasPada: "2026-10-01T05:00:00Z",
        item: [{ productId: "sama", judulBeku: "Judul LAMA", hargaBeku: 100_000, urutan: 1 }],
      }),
      barisDasar({
        pesananId: "p-baru",
        kode: "PSN-261015-BBBBBB",
        lunasPada: "2026-10-20T05:00:00Z",
        item: [{ productId: "sama", judulBeku: "Judul BARU", hargaBeku: 120_000, urutan: 1 }],
      }),
    ]);

    expect(hasil.bulan[0].perProduk).toHaveLength(1);
    expect(hasil.bulan[0].perProduk[0].banyak).toBe(2);
    expect(hasil.bulan[0].perProduk[0].nilai).toBe(220_000);
    // Judul yang DITAMPILKAN adalah yang TERBARU, karena itu nama produknya
    // hari ini — judul lama hanya hidup di nota lamanya.
    expect(hasil.bulan[0].perProduk[0].judul).toBe("Judul BARU");
  });

  it("pengecualian TIDAK ikut omzet, tetapi nilainya tercatat", () => {
    const hasil = hitungPenjualan([
      barisDasar(),
      barisDasar({ pesananId: "p-tahan", status: "ditahan", lunasPada: null }),
      barisDasar({
        pesananId: "p-tenggat",
        status: "kedaluwarsa",
        lunasPada: null,
        lunasSetelahTutup: true,
      }),
      barisDasar({ pesananId: "p-balik", pernahDikembalikan: true }),
    ]);

    const okt = hasil.bulan[0];
    expect(okt.omzet).toBe(150_000);
    expect(okt.jumlahPembelian).toBe(1);

    const per = Object.fromEntries(okt.pengecualian.map((p) => [p.golongan, p]));
    expect(per.ditahan).toEqual({ golongan: "ditahan", banyak: 1, nilai: 150_000 });
    expect(per.lewat_tenggat).toEqual({ golongan: "lewat_tenggat", banyak: 1, nilai: 150_000 });
    expect(per.dikembalikan).toEqual({ golongan: "dikembalikan", banyak: 1, nilai: 150_000 });
  });

  it("pengecualian TIDAK masuk rincian per produk", () => {
    const hasil = hitungPenjualan([
      barisDasar({ pesananId: "p-tahan", status: "ditahan", lunasPada: null }),
    ]);
    expect(hasil.bulan[0].omzet).toBe(0);
    expect(hasil.bulan[0].perProduk).toEqual([]);
  });

  it("pesanan 'ditahan' dikelompokkan menurut tanggal NOTIFIKASI, bukan lunas_pada", () => {
    // `ditahan` tidak pernah punya `lunas_pada` — statusnya tidak pernah
    // berpindah ke `lunas`. Tanpa jatuh ke `uangPada`, seluruh kelompok ini
    // tidak masuk bulan mana pun dan lenyap dari laporan.
    const hasil = hitungPenjualan([
      barisDasar({
        status: "ditahan",
        lunasPada: null,
        uangPada: "2026-08-20T05:00:00Z",
      }),
    ]);
    expect(hasil.bulan[0].bulan).toBe("2026-08");
    expect(hasil.bulan[0].pengecualian[0].golongan).toBe("ditahan");
  });

  it("baris tanpa tanggal apa pun DIHITUNG, tidak dibuang diam-diam", () => {
    const hasil = hitungPenjualan([
      barisDasar({ lunasPada: null, uangPada: null, status: "ditahan" }),
    ]);
    expect(hasil.tanpaTanggal).toBe(1);
    expect(hasil.bulan).toEqual([]);
  });

  it("bulan diurutkan TERBARU lebih dulu", () => {
    const hasil = hitungPenjualan([
      barisDasar({ pesananId: "a", lunasPada: "2026-08-10T05:00:00Z" }),
      barisDasar({ pesananId: "b", lunasPada: "2026-10-10T05:00:00Z" }),
      barisDasar({ pesananId: "c", lunasPada: "2026-09-10T05:00:00Z" }),
    ]);
    expect(hasil.bulan.map((b) => b.bulan)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("larik kosong memulangkan nol, bukan NaN", () => {
    const hasil = hitungPenjualan([]);
    expect(hasil.bulan).toEqual([]);
    expect(hasil.tanpaTanggal).toBe(0);
  });

  it("baris yang itemnya TIDAK TERBACA tidak merusak omzet jadi NaN", () => {
    const hasil = hitungPenjualan([barisDasar(), barisDasar({ pesananId: "x", item: null })]);
    expect(Number.isNaN(hasil.bulan[0].omzet)).toBe(false);
    expect(hasil.bulan[0].omzet).toBe(150_000);
  });
});

describe("urutkanBaris", () => {
  it("dua pesanan bercap waktu IDENTIK tetap berurutan stabil", () => {
    // `ditutup_pada` hanyalah `now()`; tidak ada batasan yang membuatnya unik
    // per pesanan. Untuk baris yang seri, urutan menurut tanggal saja tidak
    // menentukan apa pun — Postgres bebas memulangkan urutan mana saja, dan
    // daftar yang berganti urutan antar muat ulang membuat pembacanya
    // berhenti memercayai angkanya. `kode` dipilih sebagai pemecah seri
    // karena ia UNIK (constraint `orders_kode_unik`).
    const sama = "2026-10-15T05:00:00Z";
    const a = barisDasar({ pesananId: "p-a", kode: "PSN-261015-AAAAAA", lunasPada: sama });
    const b = barisDasar({ pesananId: "p-b", kode: "PSN-261015-BBBBBB", lunasPada: sama });

    expect(urutkanBaris([a, b]).map((x) => x.kode)).toEqual(
      urutkanBaris([b, a]).map((x) => x.kode),
    );
  });

  it("terbaru lebih dulu", () => {
    const lama = barisDasar({ kode: "PSN-260101-AAAAAA", lunasPada: "2026-01-01T05:00:00Z" });
    const baru = barisDasar({ kode: "PSN-261201-BBBBBB", lunasPada: "2026-12-01T05:00:00Z" });
    expect(urutkanBaris([lama, baru])[0].kode).toBe("PSN-261201-BBBBBB");
  });
});
```

- [ ] **Step 2: Jalankan untuk memastikan MERAH**

```bash
cd web && npx vitest run tests/penjualan-hitung.test.ts
```

Diharapkan: GAGAL — `Failed to resolve import "@/lib/penjualan/hitung"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/penjualan/hitung.ts`:

```ts
import { PESANAN_MATI, type StatusPesanan } from "@/lib/pesanan/status";
import { bulanJakarta } from "./bulan";

// ============================================================================
// AGREGASI PENJUALAN — murni, nol IO
// ============================================================================
// Seluruh keputusan "apa yang disebut terjual" hidup di sini dan hanya di
// sini. Itu bukan kerapian: aturan uang yang tersebar di beberapa `filter()`
// di beberapa komponen adalah aturan yang akan menyimpang di salah satunya,
// dan penyimpangan itu tidak akan terlihat sebagai galat melainkan sebagai
// dua layar yang menyebut angka berbeda untuk bulan yang sama.
//
// Penjumlahannya di TypeScript, bukan di SQL, dan itu mengikuti doktrin yang
// sudah tertulis di `src/app/owner/rekap/page.tsx`: sebuah view penjumlah
// dimiliki `postgres`, berjalan dengan hak PEMILIK, dan karenanya MELEWATI
// RLS.

export type ItemPenjualan = {
  /** null untuk item non-produk (P3 `jenis: 'sesi'`). */
  productId: string | null;
  judulBeku: string;
  hargaBeku: number;
  urutan: number;
};

export type BarisPenjualan = {
  pesananId: string;
  kode: string;
  status: StatusPesanan;
  /** Terisi HANYA pada transisi sungguhan ke `lunas`. */
  lunasPada: string | null;
  /** Cap notifikasi terakhir yang membawa uang. Satu-satunya tanggal yang
   *  dimiliki pesanan `ditahan` dan pesanan yang dibayar lewat tenggat. */
  uangPada: string | null;
  /** "" berarti embed-nya TIDAK terbaca, bukan "klien tanpa PADMA ID". */
  padmaId: string;
  /** "" berarti embed-nya TIDAK terbaca, bukan "klien tanpa nama". */
  namaKlien: string;
  /** Pernah menerima notifikasi refund/chargeback. Dibaca dari
   *  `notifikasi_pesanan`, TIDAK PERNAH dari `orders.sebab_tinjauan`. */
  pernahDikembalikan: boolean;
  /** Berjejak `lunas_setelah_tutup` di `jejak_pesanan`. */
  lunasSetelahTutup: boolean;
  /** null = itemnya TIDAK TERBACA. Larik kosong diperlakukan sama. */
  item: ItemPenjualan[] | null;
};

export type Golongan =
  | "omzet"
  | "dikembalikan"
  | "ditahan"
  | "lewat_tenggat"
  | "bukan_penjualan";

/**
 * URUTAN KLAUSA DI BAWAH ADALAH BAGIAN DARI ATURANNYA, bukan selera.
 *
 * `dikembalikan` diperiksa SEBELUM `omzet`: pesanan yang uangnya sudah keluar
 * lagi tetap berstatus `lunas` selamanya — webhook sengaja tidak
 * memindahkannya, karena repo ini tidak punya kebijakan refund dan menebaknya
 * di webhook lebih buruk daripada memanggil manusia. Memeriksa `lunas` lebih
 * dulu akan memungutnya sebagai pendapatan.
 */
export function golongkan(b: BarisPenjualan): Golongan {
  if (b.status === "lunas" && b.pernahDikembalikan) return "dikembalikan";
  if (b.status === "lunas") return "omzet";
  if (b.status === "ditahan") return "ditahan";
  // `PESANAN_MATI`, bukan literal "kedaluwarsa"/"dibatalkan": nilai enum baru
  // yang kelak diklasifikasikan mati ikut terbawa tanpa satu baris disunting.
  if (b.lunasSetelahTutup && PESANAN_MATI.includes(b.status)) return "lewat_tenggat";
  return "bukan_penjualan";
}

/**
 * Tanggal UANG MASUK, bukan tanggal pesanan dibuat.
 *
 * `lunasPada` lebih dulu karena ia yang paling tepat untuk omzet; `uangPada`
 * adalah satu-satunya yang dimiliki `ditahan` dan `lewat_tenggat`, yang
 * statusnya memang tidak pernah berpindah ke `lunas`.
 */
export function tanggalUang(b: BarisPenjualan): string | null {
  return b.lunasPada ?? b.uangPada;
}

/**
 * Nilai satu nota. `null` BERARTI TIDAK TERBACA, bukan nol rupiah.
 *
 * `pesanan_item_staf` bergerbang `user_role()` di dalam badan view-nya, jadi
 * bentuk ketidakterbacaannya adalah NOL BARIS — bukan galat yang bisa
 * dilempar di atas. "Rp 0" yang diucapkan dengan yakin tidak terbaca sebagai
 * data yang hilang melainkan sebagai angka. Produk gratis tetap punya
 * itemnya, jadi yang memisahkan keduanya adalah ada/tidaknya item.
 */
export function nilaiBaris(b: BarisPenjualan): number | null {
  if (b.item === null || b.item.length === 0) return null;
  return b.item.reduce((n, i) => n + i.hargaBeku, 0);
}

export type RingkasProduk = {
  /** `productId` bila ada, jatuh ke `judulBeku` untuk item tanpa produk. */
  kunci: string;
  judul: string;
  banyak: number;
  nilai: number;
};

export type Pengecualian = {
  golongan: Exclude<Golongan, "omzet" | "bukan_penjualan">;
  banyak: number;
  nilai: number;
};

export type PenjualanBulan = {
  bulan: string;
  omzet: number;
  /** PESANAN, bukan item. Satu keranjang berisi tiga produk adalah satu. */
  jumlahPembelian: number;
  perProduk: RingkasProduk[];
  pengecualian: Pengecualian[];
};

const URUT_PENGECUALIAN: Pengecualian["golongan"][] = [
  "ditahan",
  "lewat_tenggat",
  "dikembalikan",
];

/**
 * Terbaru lebih dulu, dengan `kode` sebagai PEMECAH SERI.
 *
 * Pemecah serinya bertugas STABILITAS, bukan makna. `lunas_pada` dan
 * `ditutup_pada` hanyalah `now()`; tidak ada batasan yang membuat keduanya
 * unik per pesanan, dan dua pesanan BOLEH memikul cap yang sama persis.
 * Untuk baris yang seri, urutan menurut tanggal saja tidak menentukan apa
 * pun — dan daftar uang yang berganti urutan antar muat ulang membuat
 * pembacanya berhenti memercayai seluruh angkanya. `kode` unik lewat
 * constraint `orders_kode_unik`.
 */
export function urutkanBaris(baris: readonly BarisPenjualan[]): BarisPenjualan[] {
  return [...baris].sort((a, b) => {
    const ta = tanggalUang(a) ?? "";
    const tb = tanggalUang(b) ?? "";
    if (ta !== tb) return tb.localeCompare(ta);
    return b.kode.localeCompare(a.kode);
  });
}

export function hitungPenjualan(baris: readonly BarisPenjualan[]): {
  bulan: PenjualanBulan[];
  tanpaTanggal: number;
} {
  type Ember = {
    omzet: number;
    jumlahPembelian: number;
    produk: Map<string, RingkasProduk>;
    pengecualian: Map<Pengecualian["golongan"], Pengecualian>;
  };

  const ember = new Map<string, Ember>();
  let tanpaTanggal = 0;

  // DIURUTKAN LEBIH DULU, dan itu bukan kerapian: judul produk yang
  // ditampilkan adalah judul dari nota TERBARU, dan "terbaru" hanya punya
  // arti bila barisnya sudah berurutan sebelum dilipat.
  for (const b of urutkanBaris(baris)) {
    const golongan = golongkan(b);
    if (golongan === "bukan_penjualan") continue;

    const tanggal = tanggalUang(b);
    const kunciBulan = tanggal === null ? null : bulanJakarta(tanggal);
    if (kunciBulan === null) {
      // TIDAK dibuang diam-diam. Baris tanpa tanggal yang lenyap tanpa jejak
      // membuat laporan yang jumlahnya tidak pernah bisa dicocokkan dengan
      // apa pun, dan tidak ada yang tahu kenapa.
      tanpaTanggal += 1;
      continue;
    }

    let e = ember.get(kunciBulan);
    if (e === undefined) {
      e = { omzet: 0, jumlahPembelian: 0, produk: new Map(), pengecualian: new Map() };
      ember.set(kunciBulan, e);
    }

    const nilai = nilaiBaris(b) ?? 0;

    if (golongan === "omzet") {
      e.omzet += nilai;
      e.jumlahPembelian += 1;
      for (const i of b.item ?? []) {
        const kunci = i.productId ?? i.judulBeku;
        const ada = e.produk.get(kunci);
        if (ada === undefined) {
          // Judul dari nota TERBARU, karena barisnya sudah terurut.
          e.produk.set(kunci, { kunci, judul: i.judulBeku, banyak: 1, nilai: i.hargaBeku });
        } else {
          ada.banyak += 1;
          ada.nilai += i.hargaBeku;
        }
      }
      continue;
    }

    const ada = e.pengecualian.get(golongan);
    if (ada === undefined) {
      e.pengecualian.set(golongan, { golongan, banyak: 1, nilai });
    } else {
      ada.banyak += 1;
      ada.nilai += nilai;
    }
  }

  const bulan: PenjualanBulan[] = [...ember.entries()]
    .map(([kunci, e]) => ({
      bulan: kunci,
      omzet: e.omzet,
      jumlahPembelian: e.jumlahPembelian,
      perProduk: [...e.produk.values()].sort(
        (a, b) => b.nilai - a.nilai || a.judul.localeCompare(b.judul),
      ),
      pengecualian: URUT_PENGECUALIAN.map((g) => e.pengecualian.get(g)).filter(
        (p): p is Pengecualian => p !== undefined,
      ),
    }))
    // Terbaru lebih dulu. Kunci `YYYY-MM` berurut secara leksikografis.
    .sort((a, b) => b.bulan.localeCompare(a.bulan));

  return { bulan, tanpaTanggal };
}
```

- [ ] **Step 4: Jalankan untuk memastikan HIJAU**

```bash
cd web && npx vitest run tests/penjualan-hitung.test.ts
```

Diharapkan: seluruh uji LULUS.

- [ ] **Step 5: Periksa tipe**

```bash
cd web && npx tsc --noEmit
```

Diharapkan: keluar dengan kode 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/penjualan/hitung.ts web/tests/penjualan-hitung.test.ts
git commit -m "feat(penjualan): penggolongan & agregasi, murni dan tanpa DB

Satu tempat untuk seluruh aturan 'apa yang disebut terjual'. Aturan uang
yang tersebar di beberapa filter() adalah aturan yang akan menyimpang di
salah satunya, dan penyimpangannya muncul sebagai dua layar yang menyebut
angka berbeda untuk bulan yang sama — bukan sebagai galat.

Penggolongan memeriksa 'dikembalikan' SEBELUM 'omzet': pesanan yang kena
chargeback tetap berstatus lunas selamanya."
```

---

## Task 4: `baca.ts` — pembacaan Supabase

**Files:**
- Create: `web/src/lib/penjualan/baca.ts`
- Test: `web/tests/penjualan-db.test.ts`

**Interfaces:**
- Consumes: `BarisPenjualan`, `ItemPenjualan` dari Tugas 3; `rentangBulanJakarta` dari Tugas 2; `PESANAN_BERUANG`, `PESANAN_MATI` dari `@/lib/pesanan/status`
- Produces:
  - `BATAS_BARIS_PENJUALAN: number` (= 500)
  - `bacaPenjualan(opsi: { mulai?: string; sampai?: string; clientId?: string; klien?: SupabaseClient }): Promise<{ baris: BarisPenjualan[]; terpotong: boolean }>` — `klien` HANYA dipakai uji; produksi membiarkannya kosong supaya sesi pemanggil yang dipakai

- [ ] **Step 1: Tulis uji ber-DB yang gagal**

Buat `web/tests/penjualan-db.test.ts`:

```ts
/**
 * `baca.ts` dengan basis data sungguhan — SEDIKIT uji, sengaja.
 *
 * Seluruh aturan agregasinya sudah diuji tanpa DB di
 * `tests/penjualan-hitung.test.ts`. Yang TIDAK bisa dibuktikan di sana hanya
 * dua hal, dan keduanya soal HAK: bahwa staf benar-benar memperoleh
 * barisnya, dan bahwa klien tidak. Yang kedua itulah yang menangkap kegagalan
 * embed-RLS-null — bentuk kegagalan yang sudah pernah dibayar repo ini, di
 * mana pembacaan yang ditahan RLS memulangkan NULL alih-alih galat sehingga
 * fiturnya mati diam-diam di sesi klien.
 *
 * Supabase lokal dipakai bersama sesi lain: jalankan berkas ini sendirian,
 * jangan `npm test` penuh.
 */
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const KLIEN_EMAIL = "klien@padma.test";
const bersihkan: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const f of bersihkan.splice(0)) await f();
});

async function semaiProdukLunas(slug: string, harga: number, judul: string) {
  const sb = createAdminSupabase();

  const { data: produk, error: eProduk } = await sb
    .from("digital_products")
    .insert({ slug, judul, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (eProduk) throw eProduk;

  const { data: klien, error: eKlien } = await sb
    .from("clients")
    .select("id")
    .limit(1)
    .single();
  if (eKlien) throw eKlien;

  const kode = `PSN-261006-${randomUUID().slice(0, 6).toUpperCase()}`;
  const { data: pesanan, error: ePesanan } = await sb
    .from("orders")
    .insert({
      kode,
      client_id: klien.id,
      status: "lunas",
      jumlah_item: 1,
      ditutup_pada: "2026-10-15T05:00:00Z",
      lunas_pada: "2026-10-15T05:00:00Z",
    })
    .select("id")
    .single();
  if (ePesanan) throw ePesanan;

  const { error: eItem } = await sb.from("order_items").insert({
    pesanan_id: pesanan.id,
    jenis: "produk_digital",
    product_id: produk.id,
    judul_beku: judul,
    harga_beku: harga,
    urutan: 1,
  });
  if (eItem) throw eItem;

  bersihkan.push(async () => {
    await sb.from("orders").delete().eq("id", pesanan.id);
    await sb.from("digital_products").delete().eq("id", produk.id);
  });

  return { pesananId: pesanan.id as string, produkId: produk.id as string, kode };
}

describe("bacaPenjualan", () => {
  it("admin memperoleh nota BESERTA nominal dan identitas produknya", async () => {
    const { kode, produkId } = await semaiProdukLunas(
      `p4-admin-${randomUUID().slice(0, 8)}`,
      150_000,
      "Kelas Menyusui",
    );

    const { bacaPenjualan } = await import("@/lib/penjualan/baca");
    const sb = await signInAs("admin@padma.test");

    const { baris } = await bacaPenjualan({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
      klien: sb,
    });

    const punya = baris.find((b) => b.kode === kode);
    expect(punya).toBeDefined();
    expect(punya!.item).not.toBeNull();
    expect(punya!.item![0].hargaBeku).toBe(150_000);
    expect(punya!.item![0].productId).toBe(produkId);
    // Embed klien terbaca: "" berarti RLS menahannya, dan di layar itu
    // dirender sebagai kegagalan baca.
    expect(punya!.padmaId).not.toBe("");
  });

  it("owner memperoleh baris yang sama", async () => {
    const { kode } = await semaiProdukLunas(
      `p4-owner-${randomUUID().slice(0, 8)}`,
      99_000,
      "Panduan MPASI",
    );

    const { bacaPenjualan } = await import("@/lib/penjualan/baca");
    const sb = await signInAs("owner@padma.test");

    const { baris } = await bacaPenjualan({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
      klien: sb,
    });

    expect(baris.some((b) => b.kode === kode)).toBe(true);
  });

  it("KLIEN tidak memperoleh nominal siapa pun — kosong, bukan galat", async () => {
    // Bentuk kegagalan yang dijaga: `pesanan_item_staf` bergerbang
    // `user_role()` DI DALAM badan view-nya, jadi sesi klien memperoleh NOL
    // BARIS, bukan 42501. Uji yang hanya memastikan "tidak melempar" akan
    // hijau sekalipun seluruh harga bocor.
    await semaiProdukLunas(`p4-klien-${randomUUID().slice(0, 8)}`, 150_000, "Kelas Menyusui");

    const { bacaPenjualan } = await import("@/lib/penjualan/baca");
    const sb = await signInAs(KLIEN_EMAIL);

    const { baris } = await bacaPenjualan({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
      klien: sb,
    });

    // Klien boleh melihat pesanannya SENDIRI lewat policy `orders`, tetapi
    // tidak satu pun nominal: view item-nya memulangkan nol baris.
    for (const b of baris) expect(b.item).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan untuk memastikan MERAH**

```bash
cd web && npx vitest run tests/penjualan-db.test.ts
```

Diharapkan: GAGAL — `Failed to resolve import "@/lib/penjualan/baca"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/penjualan/baca.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { PESANAN_BERUANG, PESANAN_MATI, type StatusPesanan } from "@/lib/pesanan/status";
import type { BarisPenjualan, ItemPenjualan } from "./hitung";

// ============================================================================
// PEMBACA PENJUALAN — nol service role
// ============================================================================
// Seluruhnya dibaca dengan SESI PEMANGGIL. Policy `"pesanan: staf baca"` dan
// predikat `user_role()` di dalam badan `pesanan_item_staf` yang memutuskan,
// jadi admin yang perannya dicabut kehilangan layar ini seketika tanpa satu
// baris kode pun berubah.
//
// Nominal DIPULANGKAN sebagai angka, bukan sebagai teks berformat:
// pemformatan tinggal di komponen, supaya modul ini tetap bisa dipakai
// pemanggil yang MENGHITUNG, bukan yang menampilkan.

/**
 * Batas baris per kueri — DIEKSPOR karena layarnya menyebut angkanya.
 *
 * Batas yang tidak diumumkan adalah batas yang berbohong: 500 baris yang
 * terpotong terlihat persis seperti 500 baris yang memang hanya segitu.
 * `/admin/pesanan` mengekspor `BATAS_BARIS` untuk alasan yang sama.
 */
export const BATAS_BARIS_PENJUALAN = 500;

/**
 * Status yang pernah memikul uang atau pernah menutup sebuah pesanan.
 *
 * DITURUNKAN dari himpunan `@/lib/pesanan/status`, bukan diketik ulang.
 * Alasannya sudah dibayar repo ini sekali: nilai enum baru membuat konstanta
 * tunggal salah DIAM-DIAM. Dengan daftar hard-coded di sini, nilai keenam
 * yang kelak lahir akan hilang dari laporan tanpa satu pun uji memerah.
 */
const STATUS_DIBACA: StatusPesanan[] = [...PESANAN_BERUANG, ...PESANAN_MATI];

/** Nilai `status_midtrans` yang berarti uang KELUAR lagi. */
const STATUS_KEMBALI = ["refund", "partial_refund", "chargeback", "partial_chargeback"];

type BarisOrders = {
  id: string;
  kode: string;
  status: StatusPesanan;
  lunas_pada: string | null;
  ditutup_pada: string | null;
  clients: { padma_id: string; nama: string } | null;
};

const KOLOM_ORDERS =
  "id, kode, status, lunas_pada, ditutup_pada, clients ( padma_id, nama )";

export async function bacaPenjualan(opsi: {
  /** ISO inklusif. Tanpa ini, seluruh riwayat dibaca (dibatasi BATAS_BARIS). */
  mulai?: string;
  /** ISO EKSKLUSIF. */
  sampai?: string;
  clientId?: string;
  /** Hanya untuk uji — produksi memakai sesi pemanggil. */
  klien?: SupabaseClient;
}): Promise<{ baris: BarisPenjualan[]; terpotong: boolean }> {
  const sb = opsi.klien ?? (await createServerSupabase());

  // --------------------------------------------------------------------
  // PUTARAN 1 — memilih pesanan mana yang masuk rentang
  // --------------------------------------------------------------------
  // DUA kueri, bukan satu `or(...)`. Satu `or` yang memuat `status.in.(…)`
  // menitipkan pemisahan koma-di-dalam-kurung kepada parser PostgREST, dan
  // salah tulis satu kurung di sana tidak menghasilkan galat melainkan
  // saringan yang DIAM-DIAM lebih longgar.
  //
  // Kueri (a) menyaring `ditutup_pada`, BUKAN `lunas_pada`, dan itu
  // disengaja: `lunas_pada` kosong untuk pesanan `ditahan`, sementara
  // `ditutup_pada` terisi untuk SETIAP pesanan tertutup (dijamin CHECK
  // `pesanan_tutup_bercap`). Untuk pesanan `lunas` keduanya IDENTIK — dua
  // kolom itu ditulis `now()` dalam satu pernyataan UPDATE yang sama
  // (`20260927100000_sebab_tinjauan_lestari.sql:506-513`).
  //
  // Kueri (b) menangkap pesanan yang uangnya mendarat di rentang ini padahal
  // pesanannya sudah ditutup lebih dulu — "bayar lewat tenggat". Pesanan itu
  // tidak pernah berpindah status, jadi `ditutup_pada`-nya menunjuk ke bulan
  // yang SALAH dan kueri (a) tidak akan pernah memungutnya ke bulan yang
  // benar.
  let kueriTutup = sb
    .from("orders")
    .select(KOLOM_ORDERS)
    .in("status", STATUS_DIBACA)
    .order("ditutup_pada", { ascending: false })
    .limit(BATAS_BARIS_PENJUALAN)
    .returns<BarisOrders[]>();
  if (opsi.mulai) kueriTutup = kueriTutup.gte("ditutup_pada", opsi.mulai);
  if (opsi.sampai) kueriTutup = kueriTutup.lt("ditutup_pada", opsi.sampai);
  if (opsi.clientId) kueriTutup = kueriTutup.eq("client_id", opsi.clientId);

  let kueriNotif = sb
    .from("notifikasi_pesanan")
    .select("pesanan_id, status_midtrans, nominal_diterima, diterima_pada")
    .not("pesanan_id", "is", null)
    .order("diterima_pada", { ascending: false })
    .limit(BATAS_BARIS_PENJUALAN);
  if (opsi.mulai) kueriNotif = kueriNotif.gte("diterima_pada", opsi.mulai);
  if (opsi.sampai) kueriNotif = kueriNotif.lt("diterima_pada", opsi.sampai);

  const [tutup, notifRentang] = await Promise.all([kueriTutup, kueriNotif]);
  // Galat DIBACA, bukan dibuang. Layar penjualan yang kosong karena kuerinya
  // gagal terlihat persis seperti bulan yang memang belum ada penjualannya —
  // dan di layar ini perbedaan itu adalah perkara uang.
  if (tutup.error) throw tutup.error;
  if (notifRentang.error) throw notifRentang.error;

  const perId = new Map<string, BarisOrders>();
  for (const b of tutup.data ?? []) perId.set(b.id, b);

  const idTambahan = [
    ...new Set(
      (notifRentang.data ?? [])
        .map((r) => r.pesanan_id as string)
        .filter((id) => id && !perId.has(id)),
    ),
  ];

  // --------------------------------------------------------------------
  // PUTARAN 2 — melengkapi barisnya
  // --------------------------------------------------------------------
  const idAwal = [...perId.keys()];
  if (idAwal.length === 0 && idTambahan.length === 0) {
    return { baris: [], terpotong: false };
  }

  const semuaId = [...idAwal, ...idTambahan];

  const [susulan, item, notif, jejak] = await Promise.all([
    idTambahan.length === 0
      ? Promise.resolve({ data: [] as BarisOrders[], error: null })
      : sb
          .from("orders")
          .select(KOLOM_ORDERS)
          .in("id", idTambahan)
          .in("status", STATUS_DIBACA)
          .returns<BarisOrders[]>(),
    sb
      .from("pesanan_item_staf")
      .select("pesanan_id, judul_beku, harga_beku, urutan, product_id")
      .in("pesanan_id", semuaId)
      .order("urutan", { ascending: true }),
    sb
      .from("notifikasi_pesanan")
      .select("pesanan_id, status_midtrans, diterima_pada")
      .in("pesanan_id", semuaId)
      .order("diterima_pada", { ascending: false })
      // PEMECAH SERI, tugasnya STABILITAS. `diterima_pada` hanyalah
      // `default now()`; dua baris BOLEH memikul cap yang sama persis.
      .order("id", { ascending: false }),
    sb
      .from("jejak_pesanan")
      .select("pesanan_id, kejadian")
      .in("pesanan_id", semuaId)
      .eq("kejadian", "lunas_setelah_tutup"),
  ]);
  if (susulan.error) throw susulan.error;
  if (item.error) throw item.error;
  if (notif.error) throw notif.error;
  if (jejak.error) throw jejak.error;

  for (const b of susulan.data ?? []) perId.set(b.id, b);

  const itemPer = new Map<string, ItemPenjualan[]>();
  for (const r of item.data ?? []) {
    const kunci = r.pesanan_id as string;
    const daftar = itemPer.get(kunci) ?? [];
    daftar.push({
      productId: (r.product_id as string | null) ?? null,
      judulBeku: r.judul_beku as string,
      hargaBeku: Number(r.harga_beku),
      urutan: Number(r.urutan),
    });
    itemPer.set(kunci, daftar);
  }

  const dikembalikan = new Set<string>();
  const uangPer = new Map<string, string>();
  for (const r of notif.data ?? []) {
    const kunci = r.pesanan_id as string;
    const status = (r.status_midtrans as string | null) ?? "";
    if (STATUS_KEMBALI.includes(status)) dikembalikan.add(kunci);
    // Notifikasi TERBARU yang menang — daftarnya sudah terurut turun.
    if (!uangPer.has(kunci)) uangPer.set(kunci, r.diterima_pada as string);
  }

  const setelahTutup = new Set((jejak.data ?? []).map((r) => r.pesanan_id as string));

  const baris: BarisPenjualan[] = [...perId.values()].map((b) => ({
    pesananId: b.id,
    kode: b.kode,
    status: b.status,
    lunasPada: b.lunas_pada,
    uangPada: uangPer.get(b.id) ?? b.ditutup_pada,
    // Embed yang ditahan RLS memulangkan NULL, bukan galat — pelajaran repo.
    // "" diteruskan apa adanya ke komponen, yang merendernya sebagai
    // kegagalan baca yang TERLIHAT, bukan sebagai sel kosong.
    padmaId: b.clients?.padma_id ?? "",
    namaKlien: b.clients?.nama ?? "",
    pernahDikembalikan: dikembalikan.has(b.id),
    lunasSetelahTutup: setelahTutup.has(b.id),
    // null KETIKA NOL ITEM, bukan larik kosong yang menjumlah jadi nol.
    item: itemPer.get(b.id) ?? null,
  }));

  return {
    baris,
    terpotong:
      (tutup.data ?? []).length >= BATAS_BARIS_PENJUALAN ||
      (notifRentang.data ?? []).length >= BATAS_BARIS_PENJUALAN,
  };
}
```

- [ ] **Step 4: Jalankan uji DB**

```bash
cd web && npx vitest run tests/penjualan-db.test.ts
```

Diharapkan: ketiga uji LULUS. Bila Docker mati, hidupkan dulu (`npx supabase start`) — JANGAN `db reset`.

Bila penyemaiannya gagal karena tabel `clients` kosong, semai satu klien lebih dulu lewat `createAdminSupabase()` di dalam `semaiProdukLunas`, dan daftarkan penghapusannya di `bersihkan` seperti baris lain.

- [ ] **Step 5: Periksa tipe**

```bash
cd web && npx tsc --noEmit
```

Diharapkan: keluar dengan kode 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/penjualan/baca.ts web/tests/penjualan-db.test.ts
git commit -m "feat(penjualan): pembaca Supabase, nol service role

Menyaring ditutup_pada, bukan lunas_pada: lunas_pada kosong untuk pesanan
ditahan, sementara ditutup_pada dijamin terisi CHECK pesanan_tutup_bercap.
Untuk pesanan lunas keduanya identik — ditulis now() dalam satu UPDATE.

Kueri kedua menangkap uang yang mendarat sesudah pesanannya ditutup;
pesanan itu tidak pernah berpindah status, jadi ditutup_pada-nya menunjuk
ke bulan yang salah."
```

---

## Task 5: Layar `/owner/penjualan`

**Files:**
- Create: `web/src/app/owner/penjualan/page.tsx`
- Create: `web/src/app/owner/penjualan/kartu-bulan.tsx`
- Modify: `web/src/app/owner/_shell/nav-owner.tsx`
- Modify: `web/README.md` (tabel rute, dekat baris `/owner/rekap`)
- Test: `web/tests/penjualan-layar.test.tsx`

**Interfaces:**
- Consumes: `bacaPenjualan` (Tugas 4), `hitungPenjualan`/`PenjualanBulan` (Tugas 3), `deretBulanTerakhir`/`labelBulan`/`labelBulanPendek`/`bulanSekarangJakarta`/`rentangBulanJakarta` (Tugas 2)
- Produces: `KartuBulan({ bulan }: { bulan: PenjualanBulan })`; konstanta `PER_HAL_BULAN = 6`

- [ ] **Step 1: Tulis uji render yang gagal**

Buat `web/tests/penjualan-layar.test.tsx`:

```tsx
/**
 * Render ketiga permukaan P4.
 *
 * Suite ini berjalan `environment: "node"` tanpa jsdom, jadi perkakasnya
 * `renderToStaticMarkup` — sama dengan seluruh uji panel lain.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KartuBulan } from "@/app/owner/penjualan/kartu-bulan";
import type { PenjualanBulan } from "@/lib/penjualan/hitung";

const BULAN_DASAR: PenjualanBulan = {
  bulan: "2026-10",
  omzet: 450_000,
  jumlahPembelian: 3,
  perProduk: [
    { kunci: "a", judul: "Kelas Menyusui", banyak: 2, nilai: 300_000 },
    { kunci: "b", judul: "Panduan MPASI", banyak: 1, nilai: 150_000 },
  ],
  pengecualian: [],
};

describe("KartuBulan", () => {
  it("membawa data-bulan supaya angkanya tidak tertukar antar kartu", () => {
    // Seluruh nominal di halaman ini tampak serupa. Tanpa penanda, sebuah
    // assertion (atau seorang pembaca) bisa membaca angka bulan lain sebagai
    // angka bulan yang sedang dilihatnya. Pola `data-pekan` di /owner/rekap
    // ada persis karena alasan ini.
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).toContain('data-bulan="2026-10"');
  });

  it("menampilkan omzet dan jumlah pembelian", () => {
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).toContain("Oktober 2026");
    expect(m).toContain("450.000");
    expect(m).toContain("3 pembelian");
  });

  it("merinci per produk", () => {
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).toContain("Kelas Menyusui");
    expect(m).toContain("Panduan MPASI");
  });

  it("TANPA pengecualian, kotak pengecualian tidak dirender sama sekali", () => {
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).not.toContain("perlu ditinjau");
  });

  it("nilai pengecualian dirender TERPISAH, tidak terjumlah ke omzet", () => {
    // Inilah keputusan yang dibeli seluruh desain ini: tidak ada pengurangan
    // dan tidak ada penjumlahan diam-diam. Nominal refund tidak pernah
    // disimpan, jadi menjumlah atau mengurangkannya berarti mengarang angka.
    const m = renderToStaticMarkup(
      <KartuBulan
        bulan={{
          ...BULAN_DASAR,
          pengecualian: [
            { golongan: "ditahan", banyak: 1, nilai: 150_000 },
            { golongan: "lewat_tenggat", banyak: 2, nilai: 220_000 },
          ],
        }}
      />,
    );
    // Omzetnya TIDAK berubah oleh kehadiran pengecualian.
    expect(m).toContain("450.000");
    expect(m).toContain("perlu ditinjau");
    expect(m).toContain("150.000");
    expect(m).toContain("220.000");
    // Dan tidak ada satu pun angka gabungan yang muncul.
    expect(m).not.toContain("820.000");
  });

  it("mengarahkan ke /admin/pesanan, tempat perkaranya diselesaikan", () => {
    const m = renderToStaticMarkup(
      <KartuBulan
        bulan={{
          ...BULAN_DASAR,
          pengecualian: [{ golongan: "ditahan", banyak: 1, nilai: 150_000 }],
        }}
      />,
    );
    expect(m).toContain("/admin/pesanan");
  });

  it("bulan tanpa penjualan tetap dirender, bukan dilompati", () => {
    const m = renderToStaticMarkup(
      <KartuBulan
        bulan={{ bulan: "2026-07", omzet: 0, jumlahPembelian: 0, perProduk: [], pengecualian: [] }}
      />,
    );
    expect(m).toContain('data-bulan="2026-07"');
    expect(m).toContain("Juli 2026");
  });
});
```

- [ ] **Step 2: Jalankan untuk memastikan MERAH**

```bash
cd web && npx vitest run tests/penjualan-layar.test.tsx
```

Diharapkan: GAGAL — `Failed to resolve import "@/app/owner/penjualan/kartu-bulan"`.

- [ ] **Step 3: Tulis `kartu-bulan.tsx`**

Buat `web/src/app/owner/penjualan/kartu-bulan.tsx`:

```tsx
import Link from "next/link";
import { formatRupiah } from "@/lib/owner/rupiah";
import { labelBulan } from "@/lib/penjualan/bulan";
import type { PenjualanBulan, Pengecualian } from "@/lib/penjualan/hitung";

/**
 * Kalimat untuk tiap kelompok pengecualian.
 *
 * Bertipe `Record<Pengecualian["golongan"], string>` — BUKAN objek biasa.
 * Tanpa anotasi itu, nilai golongan baru yang kelak lahir akan memulangkan
 * `undefined` di sini tanpa satu pun galat, dan kotaknya akan mencetak
 * "undefined" di sebelah sebuah nominal.
 */
const KALIMAT: Record<Pengecualian["golongan"], string> = {
  ditahan: "ditahan Midtrans — uangnya belum di PADMA",
  lewat_tenggat: "dibayar sesudah pesanannya ditutup",
  dikembalikan: "uangnya sudah dikembalikan",
};

/**
 * Satu kartu bulan — bentuk yang sama dengan `KartuPekan` di `/owner/rekap`.
 *
 * `data-bulan` membawa kunci bulannya. Ia bukan hiasan: seluruh nominal di
 * halaman ini tampak serupa antar bulan, dan tanpa penanda itu sebuah
 * assertion (atau seorang pembaca) bisa membaca angka bulan lain sebagai
 * angka bulan yang sedang dilihatnya.
 */
export function KartuBulan({ bulan }: { bulan: PenjualanBulan }) {
  return (
    <article
      data-bulan={bulan.bulan}
      className="mb-3.5 rounded-lg border border-panel-border bg-panel-surface px-5 py-5"
    >
      <h3 className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="text-[14px] font-bold text-panel-ink">{labelBulan(bulan.bulan)}</span>
        <span className="rounded-full border border-panel-border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider text-panel-muted">
          {`${bulan.jumlahPembelian} pembelian`}
        </span>
      </h3>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[12.5px] font-bold text-panel-muted">Omzet</span>
        <span className="font-mono text-[15px] text-leaf">{formatRupiah(bulan.omzet)}</span>
      </div>

      {bulan.perProduk.length === 0 ? (
        <p className="text-[11.5px] italic text-panel-muted">
          Belum ada produk terjual bulan ini.
        </p>
      ) : (
        <ul className="border-t border-panel-border pt-3">
          {bulan.perProduk.map((p) => (
            <li
              key={p.kunci}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1"
            >
              <span className="text-[12.5px] text-panel-ink">
                {p.judul}{" "}
                <span className="text-[11px] text-panel-muted">{`× ${p.banyak}`}</span>
              </span>
              <span className="font-mono text-[12.5px] text-panel-ink">
                {formatRupiah(p.nilai)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {bulan.pengecualian.length > 0 && (
        <div className="mt-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3">
          <b className="block text-[12px] text-clay">
            Perlu ditinjau — nilainya TIDAK ikut dihitung di omzet di atas.
          </b>
          <ul className="mt-1.5">
            {bulan.pengecualian.map((p) => (
              <li key={p.golongan} className="text-[11.5px] leading-relaxed text-panel-muted">
                <span className="font-semibold text-panel-ink">
                  {`${p.banyak} pesanan ${formatRupiah(p.nilai)}`}
                </span>
                {` — ${KALIMAT[p.golongan]}`}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11.5px] text-panel-muted">
            Diselesaikan di{" "}
            <Link href="/admin/pesanan" className="font-semibold text-leaf underline">
              /admin/pesanan
            </Link>
            , bukan di halaman ini.
          </p>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Jalankan uji render**

```bash
cd web && npx vitest run tests/penjualan-layar.test.tsx
```

Diharapkan: seluruh uji LULUS.

- [ ] **Step 5: Tulis `page.tsx`**

Buat `web/src/app/owner/penjualan/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { formatRupiah } from "@/lib/owner/rupiah";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { GrafikBatang } from "@/app/_shell/panel/grafik-batang";
import { bacaPenjualan } from "@/lib/penjualan/baca";
import { hitungPenjualan, type PenjualanBulan } from "@/lib/penjualan/hitung";
import {
  bulanSekarangJakarta,
  deretBulanTerakhir,
  labelBulan,
  labelBulanPendek,
  rentangBulanJakarta,
} from "@/lib/penjualan/bulan";
import { KartuBulan } from "./kartu-bulan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Penjualan" };

const BASIS = "/owner/penjualan";
const PER_HAL_BULAN = 6;
const BULAN_GRAFIK = 12;

export default async function PenjualanOwnerPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  // Saringan kosong: halaman ini hanya memakai `hal`. Rekap honor punya
  // saringan karena ada PEKERJAAN yang menempel di sana (honor belum
  // dibayar); penjualan tidak punya padanannya, dan kontrol tanpa tindakan
  // hanyalah kontrol yang harus dirawat.
  const param = uraikanParamDaftar(await searchParams, {});

  const sekarang = bulanSekarangJakarta();
  const deret = deretBulanTerakhir(sekarang, BULAN_GRAFIK);
  const { mulai } = rentangBulanJakarta(deret[0]);
  const { sampai } = rentangBulanJakarta(sekarang);

  const { baris, terpotong } = await bacaPenjualan({ mulai, sampai });
  const { bulan, tanpaTanggal } = hitungPenjualan(baris);

  const per = new Map(bulan.map((b) => [b.bulan, b]));

  // Sumbu-X dibangun dari DERET, bukan dari bulan yang punya data. Bulan
  // kosong yang hilang dari sumbu membuat tren yang sebenarnya datar terbaca
  // naik — dan grafik tren yang berbohong lebih buruk daripada tidak ada
  // grafik sama sekali.
  const titik = deret.map((kunci) => ({
    label: labelBulanPendek(kunci),
    keterangan: labelBulan(kunci),
    nilai: per.get(kunci)?.omzet ?? 0,
  }));

  const kosong: PenjualanBulan = {
    bulan: "",
    omzet: 0,
    jumlahPembelian: 0,
    perProduk: [],
    pengecualian: [],
  };
  const kartu = [...deret]
    .reverse()
    .map((kunci) => per.get(kunci) ?? { ...kosong, bulan: kunci });

  const awal = (param.hal - 1) * PER_HAL_BULAN;
  const halaman = kartu.slice(awal, awal + PER_HAL_BULAN);

  const omzetSetahun = bulan.reduce((n, b) => n + b.omzet, 0);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Penjualan</h1>
        <Bantuan judul="Tentang halaman ini">
          Dihitung dari pesanan produk digital yang berstatus <b>Lunas</b> dan tidak pernah
          menerima notifikasi pengembalian dana. Dikelompokkan menurut <b>bulan kalender
          Jakarta</b>, berdasarkan kapan uangnya masuk — bukan kapan pesanannya dibuat.
          Pesanan yang uangnya ditahan Midtrans, yang dibayar sesudah tenggat, atau yang
          dikembalikan <b>tidak ikut dijumlahkan</b>; ketiganya muncul sebagai baris terpisah
          di kartu bulannya. Angka di halaman ini adalah yang <b>ditagih dan dikonfirmasi
          Midtrans</b>, bukan yang mendarat di rekening setelah potongan biaya — untuk
          pencocokan dengan mutasi bank, ini titik awal, bukan titik akhir.
        </Bantuan>
      </header>

      <div className="mb-4 rounded-lg border border-panel-border bg-panel-surface px-5 py-4">
        <p className="text-[11.5px] text-panel-muted">{`Omzet ${BULAN_GRAFIK} bulan terakhir`}</p>
        <p className="font-mono text-[20px] text-leaf">{formatRupiah(omzetSetahun)}</p>
      </div>

      <GrafikBatang
        judul={`Omzet ${BULAN_GRAFIK} bulan terakhir`}
        data={titik}
        format={formatRupiah}
        labelKolomLabel="Bulan"
        labelKolomNilai="Omzet"
      />

      {terpotong && (
        <p className="mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay">
          Sebagian baris terpotong oleh batas kueri — angka di halaman ini belum lengkap.
        </p>
      )}

      {tanpaTanggal > 0 && (
        <p className="mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay">
          {`${tanpaTanggal} pesanan tidak punya tanggal uang masuk dan tidak masuk bulan mana pun. Periksa di /admin/pesanan.`}
        </p>
      )}

      {halaman.map((b) => (
        <KartuBulan key={b.bulan} bulan={b} />
      ))}

      <Paginasi basis={BASIS} param={param} total={kartu.length} perHal={PER_HAL_BULAN} />
    </main>
  );
}
```

- [ ] **Step 6: Tambahkan entri navigasi owner**

Di `web/src/app/owner/_shell/nav-owner.tsx`, sisipkan tepat sesudah baris `/owner/rekap`:

```tsx
  { href: "/owner/penjualan", label: "Penjualan", ikon: "rekap" },
```

Bila berkas itu memakai himpunan nama ikon bertipe sempit dan `"rekap"` tidak tersedia untuk entri kedua, pakai nama ikon lain yang SUDAH ada di berkas ikon — jangan menambahkan ikon baru dalam tugas ini.

- [ ] **Step 7: Daftarkan rute di README**

Di `web/README.md`, sisipkan tepat sesudah baris `/owner/rekap` di tabel rute:

```markdown
| `/owner/penjualan` | Owner | Rekap penjualan produk digital per bulan kalender Jakarta: omzet, rincian per produk, grafik 12 bulan; pesanan ditahan/bayar-lewat-tenggat/dikembalikan dicatat terpisah dan tidak ikut dijumlahkan |
```

- [ ] **Step 8: Jalankan uji rute dan tipe**

```bash
cd web && npx vitest run tests/inventaris-rute.test.ts tests/penjualan-layar.test.tsx && npx tsc --noEmit
```

Diharapkan: semuanya HIJAU dan `tsc` keluar dengan kode 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/app/owner/penjualan web/src/app/owner/_shell/nav-owner.tsx web/README.md web/tests/penjualan-layar.test.tsx
git commit -m "feat(penjualan): layar rekap owner per bulan

Sumbu-X grafik dibangun dari deret 12 bulan, bukan dari bulan yang punya
data: bulan kosong yang hilang dari sumbu membuat tren yang sebenarnya
datar terbaca naik.

Pengecualian dirender terpisah dan tidak pernah dijumlahkan ke omzet —
nominal refund tidak tersimpan, jadi menjumlah atau mengurangkannya
berarti mengarang angka."
```

---

## Task 6: Layar `/admin/penjualan`

**Files:**
- Create: `web/src/app/admin/penjualan/page.tsx`
- Create: `web/src/app/admin/penjualan/tabel-penjualan.tsx`
- Modify: `web/src/app/admin/_shell/nav-admin.tsx`
- Modify: `web/README.md`
- Modify: `web/tests/penjualan-layar.test.tsx` (menambah blok `describe`)

**Interfaces:**
- Consumes: `bacaPenjualan`, `BATAS_BARIS_PENJUALAN` (Tugas 4); `urutkanBaris`, `golongkan`, `nilaiBaris`, `BarisPenjualan` (Tugas 3); `bulan.ts` (Tugas 2)
- Produces: `TabelPenjualan({ baris }: { baris: readonly BarisPenjualan[] })`. `SARING_PENJUALAN` dan `PER_HAL_PENJUALAN = 25` tinggal LOKAL di `page.tsx` — Next 16 memperlakukan ekspor tak dikenal dari berkas rute sebagai permukaan tersendiri, dan tidak ada yang membutuhkannya dari luar

- [ ] **Step 1: Tulis uji render yang gagal**

Tambahkan ke `web/tests/penjualan-layar.test.tsx`:

```tsx
import { TabelPenjualan } from "@/app/admin/penjualan/tabel-penjualan";
import type { BarisPenjualan } from "@/lib/penjualan/hitung";

function notaDasar(ubah: Partial<BarisPenjualan> = {}): BarisPenjualan {
  return {
    pesananId: "p-1",
    kode: "PSN-261015-AAAAAA",
    status: "lunas",
    lunasPada: "2026-10-15T05:00:00Z",
    uangPada: "2026-10-15T05:00:00Z",
    padmaId: "PDM-0001",
    namaKlien: "Ibu A",
    pernahDikembalikan: false,
    lunasSetelahTutup: false,
    item: [{ productId: "a", judulBeku: "Kelas Menyusui", hargaBeku: 150_000, urutan: 1 }],
    ...ubah,
  };
}

describe("TabelPenjualan", () => {
  it("satu baris per ITEM, bukan per pesanan", () => {
    // Keranjang P2 membuat satu pesanan bisa memuat beberapa produk. Satu
    // baris per pesanan akan menyembunyikan produk kedua dan ketiga dari
    // daftar yang tujuannya justru memperlihatkan apa yang terjual.
    const m = renderToStaticMarkup(
      <TabelPenjualan
        baris={[
          notaDasar({
            item: [
              { productId: "a", judulBeku: "Kelas Menyusui", hargaBeku: 100_000, urutan: 1 },
              { productId: "b", judulBeku: "Panduan MPASI", hargaBeku: 75_000, urutan: 2 },
            ],
          }),
        ]}
      />,
    );
    expect(m).toContain("Kelas Menyusui");
    expect(m).toContain("Panduan MPASI");
    expect(m).toContain("100.000");
    expect(m).toContain("75.000");
  });

  it("embed klien yang TIDAK TERBACA dirender sebagai kegagalan yang terlihat", () => {
    // Pembacaan yang ditahan RLS memulangkan NULL, bukan galat. Sel kosong
    // terbaca sebagai "klien tanpa nama" — pernyataan yang salah tentang
    // data, dan yang tidak akan pernah diselidiki siapa pun.
    const m = renderToStaticMarkup(
      <TabelPenjualan baris={[notaDasar({ padmaId: "", namaKlien: "" })]} />,
    );
    expect(m).toContain("tidak terbaca");
  });

  it("item yang TIDAK TERBACA tidak dirender sebagai Rp 0", () => {
    const m = renderToStaticMarkup(<TabelPenjualan baris={[notaDasar({ item: null })]} />);
    expect(m).toContain("tidak terbaca");
    expect(m).not.toContain("Rp 0");
  });

  it("produk GRATIS dirender sebagai Rp 0, bukan disembunyikan", () => {
    const m = renderToStaticMarkup(
      <TabelPenjualan
        baris={[
          notaDasar({
            item: [{ productId: "g", judulBeku: "Panduan gratis", hargaBeku: 0, urutan: 1 }],
          }),
        ]}
      />,
    );
    expect(m).toContain("Panduan gratis");
    expect(m).toContain("Rp 0");
  });

  it("nota yang dikembalikan diberi catatan, tidak diam-diam terlihat normal", () => {
    const m = renderToStaticMarkup(
      <TabelPenjualan baris={[notaDasar({ pernahDikembalikan: true })]} />,
    );
    expect(m).toContain("dikembalikan");
  });

  it("daftar kosong memberi kalimat, bukan tabel kosong tanpa penjelasan", () => {
    const m = renderToStaticMarkup(<TabelPenjualan baris={[]} />);
    expect(m).toContain("Belum ada");
  });
});
```

- [ ] **Step 2: Jalankan untuk memastikan MERAH**

```bash
cd web && npx vitest run tests/penjualan-layar.test.tsx
```

Diharapkan: blok `TabelPenjualan` GAGAL dengan `Failed to resolve import`.

- [ ] **Step 3: Tulis `tabel-penjualan.tsx`**

Buat `web/src/app/admin/penjualan/tabel-penjualan.tsx`:

```tsx
import { formatRupiah } from "@/lib/rupiah-publik";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { stempelTanggalJakarta } from "@/lib/penjualan/bulan";
import { golongkan, tanggalUang, type BarisPenjualan } from "@/lib/penjualan/hitung";

/**
 * Daftar nota penjualan, SATU BARIS PER ITEM.
 *
 * Keranjang P2 membuat satu pesanan bisa memuat beberapa produk. Satu baris
 * per pesanan akan menyembunyikan produk kedua dan ketiga dari daftar yang
 * tujuannya justru memperlihatkan apa yang terjual.
 *
 * `formatRupiah` diimpor dari `@/lib/rupiah-publik`, BUKAN dari
 * `@/lib/owner/rupiah` — jalur kedua adalah pintu wilayah owner, dan
 * mengimpornya dari `src/app/admin/**` menyalahi batas yang sengaja dipasang
 * di dokblok modul itu. Preseden yang sama dipakai
 * `src/app/admin/pesanan/tabel-pesanan.tsx`, yang dokbloknya mencatat bahwa
 * nominal di layar staf adalah keputusan pemilik repo.
 */
const CATATAN: Partial<Record<ReturnType<typeof golongkan>, string>> = {
  dikembalikan: "uangnya dikembalikan",
  ditahan: "ditahan Midtrans",
  lewat_tenggat: "dibayar lewat tenggat",
};

export function TabelPenjualan({ baris }: { baris: readonly BarisPenjualan[] }) {
  if (baris.length === 0) {
    return (
      <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
        Belum ada penjualan pada periode ini.
      </p>
    );
  }

  return (
    <Tabel label="Daftar penjualan produk digital">
      <thead>
        <tr>
          <Th>Tanggal</Th>
          <Th>Kode</Th>
          <Th>Klien</Th>
          <Th>Produk</Th>
          <Th className="text-right">Nominal</Th>
          <Th>Catatan</Th>
        </tr>
      </thead>
      <tbody>
        {baris.map((b) => {
          const tanggal = tanggalUang(b);
          const catatan = CATATAN[golongkan(b)] ?? "";
          const klien =
            // "" BERARTI embed-nya tidak terbaca, bukan "klien tanpa nama".
            // Sel kosong terbaca sebagai pernyataan tentang data yang
            // sebenarnya tidak kita miliki.
            b.padmaId === "" && b.namaKlien === "" ? null : `${b.padmaId} · ${b.namaKlien}`;

          // null KETIKA ITEMNYA TIDAK TERBACA — bukan nol rupiah. Pesanan
          // tanpa item terbaca tetap dapat SATU baris, supaya ia tidak lenyap
          // dari daftar tanpa jejak.
          if (b.item === null || b.item.length === 0) {
            return (
              <tr key={b.pesananId} data-pesanan={b.pesananId}>
                <Td>{tanggal === null ? "—" : stempelTanggalJakarta(tanggal)}</Td>
                <Td className="font-mono text-[11.5px]">{b.kode}</Td>
                <Td>{klien ?? <i className="text-clay">tidak terbaca</i>}</Td>
                <Td colSpan={2}>
                  <i className="text-clay">Item tidak terbaca</i>
                </Td>
                <Td>{catatan}</Td>
              </tr>
            );
          }

          return b.item.map((i) => (
            <tr key={`${b.pesananId}-${i.urutan}`} data-pesanan={b.pesananId}>
              <Td>{tanggal === null ? "—" : stempelTanggalJakarta(tanggal)}</Td>
              <Td className="font-mono text-[11.5px]">{b.kode}</Td>
              <Td>{klien ?? <i className="text-clay">tidak terbaca</i>}</Td>
              <Td>{i.judulBeku}</Td>
              <Td className="text-right font-mono">{formatRupiah(i.hargaBeku)}</Td>
              <Td>{catatan}</Td>
            </tr>
          ));
        })}
      </tbody>
    </Tabel>
  );
}
```

Bila `Td` belum menerima `colSpan`, tambahkan prop opsional `colSpan?: number` pada `Td` di `web/src/app/_shell/panel/tabel.tsx` dan teruskan ke `<td>`. Itu satu-satunya perubahan yang boleh dilakukan pada berkas primitif itu dalam tugas ini.

- [ ] **Step 4: Jalankan uji render**

```bash
cd web && npx vitest run tests/penjualan-layar.test.tsx
```

Diharapkan: seluruh uji LULUS.

- [ ] **Step 5: Tulis `page.tsx`**

Buat `web/src/app/admin/penjualan/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { formatRupiah } from "@/lib/rupiah-publik";
import { uraikanParamDaftar, type ParamMentah, type SaringSah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { bacaPenjualan, BATAS_BARIS_PENJUALAN } from "@/lib/penjualan/baca";
import { golongkan, nilaiBaris, urutkanBaris, type BarisPenjualan } from "@/lib/penjualan/hitung";
import {
  bulanSekarangJakarta,
  deretBulanTerakhir,
  labelBulan,
  rentangBulanJakarta,
} from "@/lib/penjualan/bulan";
import { TabelPenjualan } from "./tabel-penjualan";

export const metadata = { title: "Penjualan" };

const BASIS = "/admin/penjualan";
const PER_HAL_PENJUALAN = 25;

/**
 * Periode sebagai DAFTAR PUTIH tetap, bukan bulan sembarang.
 *
 * `uraikanParamDaftar` menuntut daftar putih, dan bulan tidak bisa
 * dienumerasi. Empat pilihan ini menutupi dua pekerjaan nyata — tutup buku
 * bulanan ("bulan lalu") dan pemeriksaan berjalan ("bulan ini") — tanpa
 * mengarang kontrol yang harus dirawat.
 */
const SARING_PENJUALAN = {
  periode: ["bulan-ini", "bulan-lalu", "12-bulan", "semua"],
} as const satisfies SaringSah;

function rentangPeriode(periode: string): { mulai?: string; sampai?: string } {
  const sekarang = bulanSekarangJakarta();
  if (periode === "semua") return {};
  if (periode === "bulan-lalu") {
    const lalu = deretBulanTerakhir(sekarang, 2)[0];
    return rentangBulanJakarta(lalu);
  }
  if (periode === "12-bulan") {
    const deret = deretBulanTerakhir(sekarang, 12);
    return {
      mulai: rentangBulanJakarta(deret[0]).mulai,
      sampai: rentangBulanJakarta(sekarang).sampai,
    };
  }
  return rentangBulanJakarta(sekarang);
}

/**
 * Pencarian DI TYPESCRIPT, bukan di PostgREST.
 *
 * Barisnya sudah ditarik ke memori untuk dijumlahkan, jadi mencari di sana
 * gratis — dan ia bisa mencakup JUDUL PRODUK, yang lewat PostgREST mustahil
 * disaring dari `orders` karena judulnya hidup di kueri yang lain.
 */
function cocok(b: BarisPenjualan, cari: string): boolean {
  if (cari === "") return true;
  const q = cari.toLowerCase();
  if (b.kode.toLowerCase().includes(q)) return true;
  if (b.padmaId.toLowerCase().includes(q)) return true;
  if (b.namaKlien.toLowerCase().includes(q)) return true;
  return (b.item ?? []).some((i) => i.judulBeku.toLowerCase().includes(q));
}

export default async function PenjualanAdminPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_PENJUALAN);
  const periode = param.saring.periode ?? "bulan-ini";

  const { baris, terpotong } = await bacaPenjualan(rentangPeriode(periode));

  const cocokan = urutkanBaris(baris).filter((b) => cocok(b, param.cari));
  const awal = (param.hal - 1) * PER_HAL_PENJUALAN;
  const halaman = cocokan.slice(awal, awal + PER_HAL_PENJUALAN);

  // Hanya omzet yang dijumlahkan — pengecualian punya barisnya sendiri di
  // /owner/penjualan dan tidak boleh diam-diam masuk total mana pun.
  const total = cocokan
    .filter((b) => golongkan(b) === "omzet")
    .reduce((n, b) => n + (nilaiBaris(b) ?? 0), 0);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Penjualan</h1>
        <Bantuan judul="Tentang halaman ini">
          Daftar nota penjualan produk digital, <b>satu baris per produk</b> — satu pesanan
          keranjang berisi tiga produk tampil sebagai tiga baris. Pencarian mencakup kode
          pesanan, PADMA ID, nama klien, dan judul produk. Total di bawah hanya menjumlahkan
          nota yang <b>Lunas dan tidak dikembalikan</b>; nota yang ditahan, dibayar lewat
          tenggat, atau dikembalikan tetap tampil dengan catatannya tetapi tidak ikut
          dijumlahkan. Halaman ini <b>baca saja</b> — tindakan atas pesanan bermasalah ada di{" "}
          <b>/admin/pesanan</b>.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "periode",
            label: "Periode",
            bawaan: "bulan-ini",
            pilihan: [
              { nilai: "bulan-ini", label: labelBulan(bulanSekarangJakarta()) },
              { nilai: "bulan-lalu", label: labelBulan(deretBulanTerakhir(bulanSekarangJakarta(), 2)[0]) },
              { nilai: "12-bulan", label: "12 bulan" },
              { nilai: "semua", label: "Semua" },
            ],
          },
        ]}
        jumlah={halaman.length}
        total={cocokan.length}
        aksi={null}
      />

      <p className="mb-3 text-[12.5px] text-panel-muted">
        {"Total lunas pada periode ini: "}
        <b className="font-mono text-panel-ink">{formatRupiah(total)}</b>
      </p>

      {terpotong && (
        <p className="mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay">
          {`Hanya ${BATAS_BARIS_PENJUALAN} baris pertama yang dibaca — daftar dan total di halaman ini belum lengkap. Persempit periodenya.`}
        </p>
      )}

      <TabelPenjualan baris={halaman} />

      <Paginasi
        basis={BASIS}
        param={param}
        total={cocokan.length}
        perHal={PER_HAL_PENJUALAN}
      />
    </main>
  );
}
```

- [ ] **Step 6: Tambahkan entri navigasi admin**

Di `web/src/app/admin/_shell/nav-admin.tsx`, sisipkan tepat sesudah baris `/admin/pesanan`:

```tsx
  { href: "/admin/penjualan", label: "Penjualan", ikon: "bayar" },
```

- [ ] **Step 7: Daftarkan rute di README**

Di `web/README.md`, sisipkan tepat sesudah baris `/admin/pesanan`:

```markdown
| `/admin/penjualan` | Admin, Owner | Daftar nota penjualan produk digital, satu baris per produk; cari (kode, PADMA ID, nama klien, judul produk), saring periode, total hanya dari nota lunas yang tidak dikembalikan; BACA SAJA |
```

- [ ] **Step 8: Jalankan uji dan tipe**

```bash
cd web && npx vitest run tests/inventaris-rute.test.ts tests/penjualan-layar.test.tsx tests/admin-shell.test.ts && npx tsc --noEmit
```

Diharapkan: semuanya HIJAU. `tests/admin-shell.test.ts` ikut dijalankan karena ia memindai kerangka admin; entri nav baru tidak boleh memerahkannya.

- [ ] **Step 9: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/app/admin/penjualan web/src/app/admin/_shell/nav-admin.tsx web/README.md web/tests/penjualan-layar.test.tsx web/src/app/_shell/panel/tabel.tsx
git commit -m "feat(penjualan): daftar nota admin, satu baris per produk

Keranjang P2 membuat satu pesanan bisa memuat beberapa produk; satu baris
per pesanan akan menyembunyikan produk kedua dan ketiga dari daftar yang
tujuannya justru memperlihatkan apa yang terjual.

Batas baris dicetak di layar apa adanya: batas yang tidak diumumkan
adalah batas yang berbohong."
```

---

## Task 7: Riwayat pembelian di `/admin/klien/[id]`

**Files:**
- Create: `web/src/app/admin/klien/[id]/kartu-pembelian.tsx`
- Modify: `web/src/app/admin/klien/[id]/page.tsx`
- Modify: `web/tests/penjualan-layar.test.tsx`

**Interfaces:**
- Consumes: `TabelPenjualan` (Tugas 6), `bacaPenjualan` (Tugas 4), `urutkanBaris` (Tugas 3)
- Produces: `KartuPembelian({ clientId }: { clientId: string })` — server component async

- [ ] **Step 1: Tulis uji render yang gagal**

Tambahkan ke `web/tests/penjualan-layar.test.tsx`:

```tsx
import { BagianPembelian } from "@/app/admin/klien/[id]/kartu-pembelian";

describe("BagianPembelian", () => {
  it("memakai judul sejajar dengan Riwayat sesi", () => {
    const m = renderToStaticMarkup(<BagianPembelian baris={[notaDasar()]} />);
    expect(m).toContain("Riwayat pembelian");
  });

  it("klien tanpa pembelian memberi kalimat, bukan bagian kosong", () => {
    const m = renderToStaticMarkup(<BagianPembelian baris={[]} />);
    expect(m).toContain("Belum ada");
  });

  it("merender nota klien beserta nominalnya", () => {
    const m = renderToStaticMarkup(<BagianPembelian baris={[notaDasar()]} />);
    expect(m).toContain("Kelas Menyusui");
    expect(m).toContain("150.000");
  });
});
```

- [ ] **Step 2: Jalankan untuk memastikan MERAH**

```bash
cd web && npx vitest run tests/penjualan-layar.test.tsx
```

Diharapkan: blok `BagianPembelian` GAGAL dengan `Failed to resolve import`.

- [ ] **Step 3: Tulis `kartu-pembelian.tsx`**

Buat `web/src/app/admin/klien/[id]/kartu-pembelian.tsx`:

```tsx
import { bacaPenjualan } from "@/lib/penjualan/baca";
import { urutkanBaris, type BarisPenjualan } from "@/lib/penjualan/hitung";
import { TabelPenjualan } from "@/app/admin/penjualan/tabel-penjualan";

/**
 * Bagian MURNI — dipisah dari pengambilan datanya supaya bisa dirender di
 * uji tanpa Supabase. `KartuPembelian` di bawah yang melakukan IO-nya.
 */
export function BagianPembelian({ baris }: { baris: readonly BarisPenjualan[] }) {
  return (
    <section className="rounded-lg border border-panel-border bg-panel-surface p-5">
      <h2 className="mb-3 font-serif text-lg text-panel-ink">Riwayat pembelian</h2>
      {baris.length === 0 ? (
        <p className="text-[13px] italic text-panel-muted">
          Belum ada pembelian produk digital.
        </p>
      ) : (
        <TabelPenjualan baris={baris} />
      )}
    </section>
  );
}

/**
 * Riwayat pembelian satu klien — TANPA batas periode.
 *
 * Batasnya datang dari kliennya sendiri: seorang klien punya puluhan
 * pembelian, bukan puluhan ribu. Inilah layar yang dibuka admin saat sedang
 * menelepon klien, dan menyaringnya per bulan di sana akan membuat
 * pertanyaan "saya sudah pernah beli ini belum" butuh tiga klik.
 */
export async function KartuPembelian({ clientId }: { clientId: string }) {
  const { baris } = await bacaPenjualan({ clientId });
  return <BagianPembelian baris={urutkanBaris(baris)} />;
}
```

- [ ] **Step 4: Rendernya di halaman klien**

Di `web/src/app/admin/klien/[id]/page.tsx`, tambahkan impor di dekat impor `KartuHak`:

```tsx
import { KartuPembelian } from "./kartu-pembelian";
```

dan sisipkan pemanggilannya tepat SESUDAH blok `</section>` penutup "Riwayat sesi" (sekitar baris 241):

```tsx
      <KartuPembelian clientId={klien.id} />
```

Sesuaikan nama variabel `klien.id` dengan nama yang benar-benar dipakai berkas itu untuk id kliennya.

- [ ] **Step 5: Jalankan uji dan tipe**

```bash
cd web && npx vitest run tests/penjualan-layar.test.tsx && npx tsc --noEmit
```

Diharapkan: seluruh uji LULUS dan `tsc` keluar dengan kode 0.

- [ ] **Step 6: Jalankan seluruh uji P4 beserta pagar yang bisa tersentuh**

```bash
cd web && npx vitest run \
  tests/penjualan-bulan.test.ts \
  tests/penjualan-hitung.test.ts \
  tests/penjualan-layar.test.tsx \
  tests/penjualan-db.test.ts \
  tests/pesanan-akses-tiga-keadaan.test.ts \
  tests/money-firewall-struktural.test.ts \
  tests/grant-anon.test.ts \
  tests/struktur-rls.test.ts \
  tests/inventaris-rute.test.ts \
  tests/admin-pesanan.test.tsx \
  tests/admin-shell.test.ts \
  tests/owner-kerangka.test.ts
```

Diharapkan: SEMUANYA HIJAU. Bila `money-firewall-struktural`, `grant-anon`, atau `struktur-rls` merah, berhenti dan laporkan — ketiganya seharusnya tidak tersentuh P4, dan kemerahannya berarti implementasinya menyimpang dari spec.

- [ ] **Step 7: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/app/admin/klien web/tests/penjualan-layar.test.tsx
git commit -m "feat(penjualan): riwayat pembelian di halaman klien

Tanpa batas periode: batasnya datang dari kliennya sendiri. Inilah layar
yang dibuka admin saat sedang menelepon klien, dan menyaringnya per bulan
membuat 'saya sudah pernah beli ini belum' butuh tiga klik.

Bagian murni dipisah dari pengambilan datanya supaya bisa dirender di uji
tanpa Supabase."
```
