# Panel Owner (Rencana 3B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyapu tiga halaman isi panel owner (`/owner/rekap`, `/owner/tarif`, `/owner/transport`) ke pola daftar & formulir spec 7 Sep — palet `panel-*`, keadaan daftar di URL, dan tidak ada lagi formulir yang hidup di dalam sel tabel.

**Architecture:** Kerangka panel owner (`layout.tsx` + `_shell/nav-owner.tsx`) SUDAH memakai `KerangkaPanel` sejak rencana 1; yang belum tersentuh hanya badan ketiga halamannya. Ketiganya diperlakukan **sesuai sifat masing-masing**, bukan seragam: Tarif adalah daftar objek dan mendapat perlakuan penuh (daftar datar + rute detail `/owner/tarif/[variantId]`), Rekap adalah laporan dan tetap berbentuk kartu (hanya menambah saring + paginasi), Transport adalah tabel empat jenjang tetap yang tidak butuh cari/saring tetapi formulirnya tetap harus keluar dari sel tabel (panel geser). Lapisan datanya tidak ditulis ulang: `ambilRateCard()` dan `ambilRekap()` sudah memulangkan seluruh baris, jadi cari/saring/paginasi ditambahkan sebagai **fungsi murni di atas hasil yang sudah terbaca** — sama seperti `daftarTagihanAdmin()`, dan dengan batasan yang sama (memperbaiki layar, bukan batas bacaan).

**Tech Stack:** Next.js App Router (Server Components), React 19, Tailwind v4 (token `--color-panel-*`), Supabase (RLS, sesi pengguna), Vitest + `renderToStaticMarkup` (tanpa jsdom), Playwright untuk E2E.

**Spec:** `docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md` (K7 — "Panel owner ikut"). Runbook pendahulunya yang WAJIB dibaca: `docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md` dan `docs/superpowers/2026-09-07-panel-fondasi-tindak-lanjut.md`.

## Global Constraints

Setiap tugas di bawah ini tunduk pada seluruh butir berikut. Tidak satu pun boleh dilanggar tanpa persetujuan pemilik repo.

1. **Tanpa dependensi baru.** Tidak ada jsdom, tidak ada testing-library, tidak ada pustaka grafik. Suite berjalan `environment: "node"`.
2. **Apa pun yang hanya hidup lewat `onChange` tidak bisa diuji sama sekali.** Kotak cari adalah `<form method="get">`, chip saringan adalah `<Link>`. Keadaan daftar hidup di URL (`?cari=`, `?<saring>=`, `?hal=`, `?ubah=`), bukan di state React.
3. **Fungsi TIDAK bisa dioper dari Server Component ke Client Component.** Kelas cacat ini sudah menggigit tiga kali dan sekali lolos ke `main`. Pagarnya sudah ada: `web/tests/pagar-batas-server-klien.test.ts`. Jangan melemahkannya.
4. **Money firewall dipisah FISIK.** Primitif di `src/app/_shell/panel/` WAJIB buta peran — dijaga `tests/panel-primitif.test.ts`. Jangan menambahkan satu pun kondisional peran ke sana.
5. **Setiap server action di bawah `/owner` memanggil `requireRole(["owner"])` sendiri di baris pertamanya.** `layout.tsx` TIDAK menjaga server action — sudah dibuktikan dengan mem-POST action panel admin dari rute lain.
6. **Tarif INSERT-ONLY, tanda bayar sekali-permanen.** Tidak ada satu pun UPDATE/DELETE baru atas `variant_rates`, `transport_rates`, `transport_khusus`, atau `honor_marks` di rencana ini. Rencana ini menyentuh TAMPILAN, bukan aturan uang.
7. **Vitest tidak mengecek tipe.** `npx tsc --noEmit` wajib. Galat `LayoutProps`/`PageProps` **bukan permanen** — `npm run build` meregenerasi tipe rute dan galatnya hilang.
8. **Setiap tugas menjalankan `npm run lint`, bukan hanya `tsc --noEmit`.** Empat galat lint pernah lolos satu gelombang penuh karena brief hanya meminta `tsc`.
9. **`sed` bawaan macOS mendiamkan `\b` tanpa galat.** Sapuan palet lewat `sed` wajib diverifikasi dengan pola grep yang TIDAK memakai `\b`, atau pakai `gsed`.
10. **Basis data Supabase lokal dipakai bersama antar sesi kerja.** Koordinasikan dengan pemilik repo sebelum menjalankan `npm test` penuh.
11. **`npm run test:e2e:video` dan `npm run test:e2e:semua` DILARANG** — keduanya mengunggah ke bucket Cloudflare R2 PRODUKSI milik klien. `npm run test:e2e:owner` AMAN dan WAJIB di Task 9.
12. **Palet grafik di `src/app/_shell/panel/palet.ts` dikunci uji.** Jangan mengganti heksnya.
13. **Serif keluar dari panel staf.** Judul halaman panel memakai `text-[18px] font-bold text-panel-ink`, bukan `font-serif text-2xl text-night`. Serif tetap hidup di landing, skrining, `/passport`.
14. **Klien belum pernah rilis.** Tidak ada data produksi yang perlu dijaga; jangan merancang migrasi demi melindunginya. Rencana ini memang tidak menyentuh basis data sama sekali.

## Deviasi dari huruf spec — dicatat, bukan disembunyikan

Tiga hal di bawah ini menyimpang dari bacaan paling harfiah K7 dan arah awal. Semuanya diputuskan pemilik repo **sebelum satu baris kode ditulis**, dan dicatat di sini supaya tidak ditemukan sebagai kejutan oleh reviewer berikutnya (pelajaran utang #9/#10/#11 runbook sapuan).

- **D1 — Formulir tarif transport ikut pindah ke panel geser.** Arah awal berbunyi "tabel empat jenjangnya dibiarkan". Yang dibiarkan adalah **cari/saring/paginasi**-nya (tidak masuk akal untuk empat baris tetap); formulirnya tetap dipindah, karena keluhan inti klien adalah formulir di dalam sel tabel dan di halaman ini keluhan itu masih terjadi persis.
- **D2 — `/owner/rekap` memakai 8 kartu per halaman, bukan `PER_HAL = 25`.** Kartu pekan jauh lebih tinggi daripada baris tabel. Ini memaksa primitif `hitungRentang`/`jumlahHalaman`/`Paginasi` menerima ukuran halaman (Task 1) — perubahan kecil pada primitif bersama, bukan cabang kedua.
- **D3 — Riwayat tarif pindah dari `<details>` di baris daftar ke halaman detail `/owner/tarif/[variantId]`.** Riwayat adalah daftar anak, dan aturan repo berbunyi "punya daftar anak → halaman detail". Konsekuensinya riwayat tidak lagi terbaca dari daftar; sebagai gantinya ia selalu terender penuh di detail, bukan terlipat.

## Yang SENGAJA tidak dibuka di rencana ini

- **`max_rows = 1000` pada query hitung.** `ambilRateCard()`, `ambilRekap()`, dan kawan-kawannya membaca seluruh tabel lalu menyaring di JS. Paginasi yang ditambahkan rencana ini memotong daftar yang **sudah** terbaca — ia memperbaiki layar dan biaya render, BUKAN batas bacaan. Obatnya view SQL, rencana tersendiri (utang #1 runbook sapuan). Setiap fungsi baru di rencana ini WAJIB menyalin peringatan itu sebagai komentar di sumbernya.
- **Label `KelompokSaring` yang tidak pernah dirender** (utang #5). Menampilkannya mengubah tata letak bilah di tujuh halaman sekaligus.
- **Logo & favicon** (K8) — asetnya belum ada dari klien.

---

### Task 1: Primitif daftar menerima ukuran halaman

Rekap memakai 8 kartu per halaman (D2). Hari ini `hitungRentang`, `jumlahHalaman`, dan `Paginasi` mengunci `PER_HAL = 25` di dalam badannya, jadi ukuran lain mustahil tanpa menyalin ketiganya.

**Files:**
- Modify: `web/src/app/_shell/panel/daftar.ts:68-75`
- Modify: `web/src/app/_shell/panel/paginasi.tsx:11-30`
- Test: `web/tests/panel-daftar.test.ts`, `web/tests/panel-paginasi.test.tsx`

**Interfaces:**
- Consumes: —
- Produces:
  - `hitungRentang(hal: number, perHal?: number): { dari: number; sampai: number }` — `perHal` default `PER_HAL`
  - `jumlahHalaman(total: number, perHal?: number): number` — `perHal` default `PER_HAL`
  - `<Paginasi basis param total perHal?>` — `perHal?: number`, default `PER_HAL`

- [ ] **Step 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/panel-daftar.test.ts`, di dalam `describe` yang sudah menaungi `hitungRentang`/`jumlahHalaman` (kalau belum ada, buat `describe("ukuran halaman yang bisa diatur")`):

```ts
it("hitungRentang menghormati ukuran halaman yang diberikan", () => {
  // Bawaan tidak berubah — 25 baris per halaman.
  expect(hitungRentang(1)).toEqual({ dari: 0, sampai: 24 });
  expect(hitungRentang(3)).toEqual({ dari: 50, sampai: 74 });
  // Ukuran lain: kartu pekan rekap, 8 per halaman.
  expect(hitungRentang(1, 8)).toEqual({ dari: 0, sampai: 7 });
  expect(hitungRentang(3, 8)).toEqual({ dari: 16, sampai: 23 });
});

it("jumlahHalaman menghormati ukuran halaman yang diberikan", () => {
  expect(jumlahHalaman(0)).toBe(1);
  expect(jumlahHalaman(26)).toBe(2);
  expect(jumlahHalaman(0, 8)).toBe(1);
  expect(jumlahHalaman(8, 8)).toBe(1);
  expect(jumlahHalaman(9, 8)).toBe(2);
  expect(jumlahHalaman(24, 8)).toBe(3);
});
```

Tambahkan ke `web/tests/panel-paginasi.test.tsx`:

```ts
it("Paginasi memakai ukuran halaman yang diberikan untuk menghitung jumlah halaman", () => {
  const param = { cari: "", saring: {}, hal: 1 };
  // 9 baris, 8 per halaman => 2 halaman => "Berikutnya" harus ada.
  const markup = renderToStaticMarkup(
    createElement(Paginasi, { basis: "/owner/rekap", param, total: 9, perHal: 8 }),
  );
  expect(markup).toContain("Halaman 1 dari 2");
  expect(markup).toContain("Berikutnya");

  // 9 baris pada ukuran BAWAAN (25) hanya satu halaman => komponen tidak
  // merender apa pun. Ini yang membuktikan `perHal` sungguh dipakai, bukan
  // diabaikan diam-diam.
  const bawaan = renderToStaticMarkup(
    createElement(Paginasi, { basis: "/owner/rekap", param, total: 9 }),
  );
  expect(bawaan).toBe("");
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/panel-daftar.test.ts tests/panel-paginasi.test.tsx
```
Diharapkan: FAIL — `hitungRentang(1, 8)` masih memulangkan `{ dari: 0, sampai: 24 }`, dan `Paginasi` menolak prop `perHal` (galat tipe di `tsc`, di runtime prop-nya diabaikan sehingga "Halaman 1 dari 2" tidak muncul).

- [ ] **Step 3: Implementasi minimal**

Di `web/src/app/_shell/panel/daftar.ts`, ganti kedua fungsi:

```ts
/**
 * Rentang `.range()` PostgREST untuk sebuah halaman — keduanya inklusif.
 *
 * `perHal` bisa diberikan karena tidak setiap daftar panel berbentuk baris
 * tabel: `/owner/rekap` menampilkan KARTU pekan, yang tingginya berkali lipat
 * satu baris, dan 25 kartu sekaligus adalah halaman yang harus digulung jauh
 * untuk mencapai paginasinya sendiri. Bawaannya tetap `PER_HAL` supaya
 * ketujuh daftar yang sudah ada tidak berubah perilaku.
 */
export function hitungRentang(hal: number, perHal: number = PER_HAL): { dari: number; sampai: number } {
  const dari = (hal - 1) * perHal;
  return { dari, sampai: dari + perHal - 1 };
}

export function jumlahHalaman(total: number, perHal: number = PER_HAL): number {
  // Minimal 1: daftar kosong tetap "halaman 1 dari 1", bukan "1 dari 0".
  return Math.max(1, Math.ceil(total / perHal));
}
```

Di `web/src/app/_shell/panel/paginasi.tsx`, tambahkan prop dan teruskan:

```tsx
export function Paginasi({
  basis,
  param,
  total,
  perHal,
}: {
  basis: string;
  param: ParamDaftar;
  total: number;
  /** Ukuran halaman daftar ini. Bawaan `PER_HAL` — lihat `hitungRentang`. */
  perHal?: number;
}) {
  const halaman = jumlahHalaman(total, perHal);
  if (halaman <= 1) return null;
```

Sisa badan komponen tidak berubah.

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/panel-daftar.test.ts tests/panel-paginasi.test.tsx && npx tsc --noEmit && npm run lint
```
Diharapkan: PASS, `tsc` bersih, lint 0 error.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/_shell/panel/daftar.ts web/src/app/_shell/panel/paginasi.tsx web/tests/panel-daftar.test.ts web/tests/panel-paginasi.test.tsx
git commit -m "feat(panel): hitungRentang/jumlahHalaman/Paginasi menerima ukuran halaman"
```

---

### Task 2: Lapisan cari/saring/paginasi rate card

Fungsi MURNI dulu, halaman menyusul di Task 3. Dipisah karena inilah satu-satunya bagian modul Tarif yang bisa diuji sebagai aritmatika biasa, tanpa render dan tanpa basis data.

**Files:**
- Create: `web/src/lib/owner/daftar-tarif.ts`
- Test: `web/tests/owner-daftar-tarif.test.ts` (baru)

**Interfaces:**
- Consumes: `hitungRentang` (Task 1); `ambilRateCard(hariIni)` dan tipe `BarisRateCard` dari `@/lib/owner/data` (sudah ada).
- Produces:
  - `SARING_TARIF` — `{ tarif: ["bertarif", "belum"], aktif: ["ya", "tidak"] }`
  - `type HalamanRateCard = { baris: BarisRateCard[]; total: number }`
  - `saringRateCard(kartu: readonly BarisRateCard[], param: ParamDaftar): HalamanRateCard` — MURNI
  - `ambilDaftarTarif(param: ParamDaftar, hariIni: string): Promise<HalamanRateCard>`
  - `ambilVarianTarif(variantId: string, hariIni: string): Promise<BarisRateCard | null>`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/owner-daftar-tarif.test.ts`:

```ts
/**
 * Cari, saring, dan paginasi rate card — sebagai ARITMATIKA, bukan render.
 *
 * Berkas ini sengaja tidak menyentuh basis data dan tidak merender satu pun
 * komponen: `saringRateCard()` adalah fungsi murni, dan bentuk itulah yang
 * membuat aturan "varian belum bertarif adalah PEKERJAAN, bukan kabar" bisa
 * diuji tanpa satu baris JavaScript klien.
 */
import { describe, it, expect } from "vitest";
import type { BarisRateCard } from "@/lib/owner/data";
import { saringRateCard, SARING_TARIF } from "@/lib/owner/daftar-tarif";
import { uraikanParamDaftar } from "@/app/_shell/panel/daftar";

function varian(n: Partial<BarisRateCard> & { variantId: string }): BarisRateCard {
  return {
    serviceId: "svc",
    namaLayanan: "Pijat Nifas",
    labelVarian: "",
    namaFase: "Nifas",
    aktif: true,
    berlaku: null,
    riwayat: [],
    ...n,
  };
}

const TARIF_BERLAKU = {
  id: "r1",
  hargaKlien: 150_000,
  hargaCoret: null,
  honorMitra: 90_000,
  margin: 60_000,
  berlakuSejak: "2026-01-01",
  berlakuSekarang: true,
  belumBerlaku: false,
};

const KARTU: BarisRateCard[] = [
  varian({ variantId: "a", namaLayanan: "Pijat Nifas", labelVarian: "60 menit", berlaku: TARIF_BERLAKU }),
  varian({ variantId: "b", namaLayanan: "Pijat Nifas", labelVarian: "90 menit" }),
  varian({ variantId: "c", namaLayanan: "Senam Hamil", labelVarian: "", aktif: false, berlaku: TARIF_BERLAKU }),
];

const param = (sp: Record<string, string>) => uraikanParamDaftar(sp, SARING_TARIF);

describe("saringRateCard", () => {
  it("tanpa parameter memulangkan seluruh baris apa adanya", () => {
    const { baris, total } = saringRateCard(KARTU, param({}));
    expect(baris.map((b) => b.variantId)).toEqual(["a", "b", "c"]);
    expect(total).toBe(3);
  });

  it("cari mencocokkan nama layanan MAUPUN label varian, tanpa peduli huruf besar-kecil", () => {
    expect(saringRateCard(KARTU, param({ cari: "senam" })).baris.map((b) => b.variantId)).toEqual(["c"]);
    expect(saringRateCard(KARTU, param({ cari: "90 MENIT" })).baris.map((b) => b.variantId)).toEqual(["b"]);
  });

  it("saring tarif=belum hanya menyisakan varian tanpa tarif berlaku", () => {
    const { baris, total } = saringRateCard(KARTU, param({ tarif: "belum" }));
    expect(baris.map((b) => b.variantId)).toEqual(["b"]);
    // `total` adalah jumlah yang COCOK, bukan jumlah seluruh rate card —
    // bilah daftar menampilkan "menampilkan N dari TOTAL", dan total yang
    // salah membuat owner mengira ada baris yang hilang.
    expect(total).toBe(1);
  });

  it("saring aktif=tidak menyisakan varian layanan yang sudah tidak ditawarkan", () => {
    expect(saringRateCard(KARTU, param({ aktif: "tidak" })).baris.map((b) => b.variantId)).toEqual(["c"]);
  });

  it("cari dan saring berlaku BERSAMAAN, bukan saling menggantikan", () => {
    const { baris } = saringRateCard(KARTU, param({ cari: "pijat", tarif: "belum" }));
    expect(baris.map((b) => b.variantId)).toEqual(["b"]);
  });

  it("nilai saringan asing dibuang, bukan diteruskan sebagai penyaring", () => {
    // Daftar putih `uraikanParamDaftar` yang membuangnya. Nilai asing yang
    // lolos memulangkan nol baris, dan nol baris tidak bisa dibedakan dari
    // "memang belum ada datanya".
    expect(saringRateCard(KARTU, param({ tarif: "entah" })).total).toBe(3);
  });

  it("memotong menurut halaman, dan total tetap jumlah yang COCOK", () => {
    const banyak = Array.from({ length: 30 }, (_, i) =>
      varian({ variantId: `v${i}`, labelVarian: `${i} menit` }),
    );
    const h1 = saringRateCard(banyak, param({}));
    expect(h1.baris).toHaveLength(25);
    expect(h1.total).toBe(30);
    const h2 = saringRateCard(banyak, param({ hal: "2" }));
    expect(h2.baris).toHaveLength(5);
    expect(h2.total).toBe(30);
  });

  it("halaman di luar jangkauan memulangkan daftar kosong, bukan melempar", () => {
    expect(saringRateCard(KARTU, param({ hal: "9" })).baris).toEqual([]);
  });

  it("urutan asli ambilRateCard dipertahankan — fase, lalu aktif, lalu abjad", () => {
    // Urutan itu ditetapkan `ambilRateCard()` dan berarti sesuatu bagi
    // pembacanya (urutan perjalanan klien). Menyaring tidak boleh mengacaknya.
    const { baris } = saringRateCard(KARTU, param({ cari: "" }));
    expect(baris).toEqual(KARTU);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/owner-daftar-tarif.test.ts
```
Diharapkan: FAIL — `Cannot find module '@/lib/owner/daftar-tarif'`.

- [ ] **Step 3: Implementasi minimal**

Buat `web/src/lib/owner/daftar-tarif.ts`:

```ts
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { ambilRateCard, type BarisRateCard } from "./data";

/**
 * Cari, saring, dan paginasi untuk `/owner/tarif`.
 *
 * BATAS YANG HARUS DIKETAHUI: paginasi di sini memotong daftar yang SUDAH
 * TERBACA SELURUHNYA oleh `ambilRateCard()`. Ia memperbaiki layar dan biaya
 * render, BUKAN batas bacaan — `ambilRateCard()` membaca `phases`,
 * `services`, `service_variants`, dan seluruh riwayat `variant_rates` apa
 * adanya, dan `max_rows = 1000` di `supabase/config.toml` tetap berlaku bagi
 * bacaan yang tidak dipaginasi di sana. Sama persis dengan yang sudah dicatat
 * `daftarTagihanAdmin()` (`src/lib/admin/tagihan.ts:293-300`). Obatnya view
 * SQL, bukan berkas ini.
 *
 * Menyaring di JS di sini BUKAN kelalaian kedua: `ambilRateCard()` memang
 * harus membaca seluruh riwayat tarif apa pun yang terjadi, karena rekap
 * pekan lama mencocokkan tarif ke TANGGAL SESI. Tidak ada saringan yang bisa
 * dipindahkan ke PostgREST tanpa merusak sifat itu.
 */
export const SARING_TARIF = {
  tarif: ["bertarif", "belum"],
  aktif: ["ya", "tidak"],
} as const satisfies SaringSah;

export type HalamanRateCard = { baris: BarisRateCard[]; total: number };

/**
 * Fungsi MURNI: kartu apa adanya → satu halaman hasil.
 *
 * `total` adalah jumlah baris yang COCOK dengan saringan, bukan jumlah
 * seluruh rate card. Bilah daftar menampilkan "menampilkan N dari TOTAL", dan
 * total yang menghitung baris tersaring-keluar membuat owner mengira ada
 * varian yang hilang.
 */
export function saringRateCard(
  kartu: readonly BarisRateCard[],
  param: ParamDaftar,
): HalamanRateCard {
  const cari = param.cari.toLowerCase();

  const cocok = kartu.filter((b) => {
    if (cari !== "") {
      const teks = `${b.namaLayanan} ${b.labelVarian}`.toLowerCase();
      if (!teks.includes(cari)) return false;
    }
    // "belum bertarif" adalah PEKERJAAN, bukan kabar: sesi pada varian itu
    // muncul di rekap sebagai tak-bertarif dan honornya tidak ikut dihitung
    // di angka mana pun. Saringan ini yang membuat pekerjaan itu bisa
    // dikumpulkan dalam satu klik alih-alih dicari dengan mata.
    if (param.saring.tarif === "belum" && b.berlaku !== null) return false;
    if (param.saring.tarif === "bertarif" && b.berlaku === null) return false;
    if (param.saring.aktif === "ya" && !b.aktif) return false;
    if (param.saring.aktif === "tidak" && b.aktif) return false;
    return true;
  });

  // `sampai` inklusif, sama seperti `.range()` PostgREST yang ditirunya.
  const { dari, sampai } = hitungRentang(param.hal);
  return { baris: cocok.slice(dari, sampai + 1), total: cocok.length };
}

/** Satu halaman rate card untuk `/owner/tarif`. */
export async function ambilDaftarTarif(
  param: ParamDaftar,
  hariIni: string,
): Promise<HalamanRateCard> {
  return saringRateCard(await ambilRateCard(hariIni), param);
}

/**
 * Satu varian beserta tarif berlaku dan SELURUH riwayatnya, untuk
 * `/owner/tarif/[variantId]`.
 *
 * Sengaja memakai `ambilRateCard()` yang sama, bukan query sendiri: aturan
 * "tarif mana yang berlaku" hidup di `tarifPadaTanggal()` dan dipakai bersama
 * oleh rate card dan rekap honor. Menulis ulang aturan itu di sini akan
 * melahirkan dua definisi yang berpisah diam-diam pada perubahan berikutnya —
 * dan perpisahan itu berbentuk layar yang menampilkan satu angka sementara
 * honor dibayarkan dengan angka lain.
 *
 * `null` berarti varian itu tidak ada; halaman menjawabnya dengan `notFound()`.
 */
export async function ambilVarianTarif(
  variantId: string,
  hariIni: string,
): Promise<BarisRateCard | null> {
  const kartu = await ambilRateCard(hariIni);
  return kartu.find((b) => b.variantId === variantId) ?? null;
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/owner-daftar-tarif.test.ts && npx tsc --noEmit && npm run lint
```
Diharapkan: 9 uji PASS, `tsc` bersih, lint 0 error.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/owner/daftar-tarif.ts web/tests/owner-daftar-tarif.test.ts
git commit -m "feat(owner): lapisan cari/saring/paginasi rate card"
```

---

### Task 3: `/owner/tarif` menjadi daftar datar berpalet panel

Formulir dan riwayat KELUAR dari halaman ini (keduanya pindah ke rute detail di Task 4). Yang tersisa: bilah cari + dua kelompok chip + tabel panel + paginasi, dengan baris yang menaut ke detailnya — pola yang sama persis dengan `/admin/layanan`.

**Files:**
- Modify: `web/src/app/owner/tarif/page.tsx` (tulis ulang badannya)
- Modify: `web/tests/owner-tarif.test.ts:173`, `:847-925` (describe "halaman rate card")
- Test: `web/tests/owner-tarif.test.ts`

**Interfaces:**
- Consumes: `ambilDaftarTarif`, `SARING_TARIF` (Task 2); `uraikanParamDaftar`, `ParamMentah`, `bangunQuery`; `BilahDaftar`, `Paginasi`, `Bantuan`, `Tabel`, `Th`, `Td`.
- Produces: rute `/owner/tarif` menerima `?cari=`, `?tarif=bertarif|belum`, `?aktif=ya|tidak`, `?hal=`; setiap baris menaut ke `/owner/tarif/<variantId>` (dikonsumsi Task 4 dan Task 9).

- [ ] **Step 1: Tulis uji yang gagal**

Di `web/tests/owner-tarif.test.ts`, ganti isi `describe("halaman rate card (/owner/tarif)")` menjadi daftar. Uji riwayat/`<details>` dan uji formulir **dipindah**, bukan dihapus — keduanya lahir kembali di Task 4 menargetkan halaman detail. Uji "TIDAK ada tombol Hapus", "judul mengandalkan template", "menjaga perannya sendiri", dan uji DELETE 42501 **tetap di sini apa adanya**.

```ts
describe("halaman rate card (/owner/tarif) — daftar datar", () => {
  const halaman = (sp: Record<string, string> = {}) =>
    TarifPage({ searchParams: Promise.resolve(sp) });

  let markup = "";

  beforeAll(async () => {
    ref.sesi = sesiOwner;
    markup = renderToStaticMarkup(await halaman());
  });

  it("menampilkan nama layanan beserta nominal yang berlaku", () => {
    expect(markup).toContain("PAD-UJI Tarif Layanan Mundur");
    expect(markup).toContain(`Rp ${HARGA_BARU.toLocaleString("id-ID")}`);
    expect(markup).toContain(`Rp ${HONOR_BARU.toLocaleString("id-ID")}`);
  });

  it("menampilkan margin per varian (harga klien − honor mitra)", () => {
    expect(markup).toContain(`Rp ${(HARGA_BARU - HONOR_BARU).toLocaleString("id-ID")}`);
  });

  it("menampilkan tanggal berlaku tarif, bukan hanya angkanya", () => {
    expect(markup).toMatch(/berlaku/i);
  });

  it("setiap baris menaut ke halaman tarif varian itu", () => {
    // Barisnya sendiri yang menaut — pola B. Tidak ada kolom "Aksi" berisi
    // tombol: yang dibuka adalah varian itu beserta RIWAYAT tarifnya.
    expect(markup).toContain(`href="/owner/tarif/${VARIAN_MUNDUR}"`);
  });

  it("TIDAK ada formulir penetapan tarif di halaman daftar", () => {
    // Inilah keluhan klien yang ditutup rencana ini: formulir di dalam sel
    // tabel. Ia tidak dipindahkan setengah — ia tidak lagi ada di sini.
    expect(markup).not.toContain('name="harga"');
    expect(markup).not.toContain('name="mulai"');
    expect(sumberHalaman).not.toContain("FormTarif");
  });

  it("TIDAK ada riwayat tarif di halaman daftar — riwayat milik halaman detail", () => {
    expect(markup).not.toContain("<details");
  });

  it("bilah daftar menyediakan kotak cari dan chip saringan", () => {
    expect(markup).toContain('name="cari"');
    expect(markup).toContain("href=\"/owner/tarif?tarif=belum\"");
    expect(markup).toContain("href=\"/owner/tarif?aktif=tidak\"");
  });

  it("cari menyaring baris yang tampil, bukan sekadar menyorotnya", async () => {
    const hasil = renderToStaticMarkup(await halaman({ cari: "PAD-UJI Tarif Layanan Mundur" }));
    expect(hasil).toContain("PAD-UJI Tarif Layanan Mundur");
    // Kalimat "Menampilkan N dari TOTAL" ikut menyempit — pencarian yang
    // hanya menyorot akan meninggalkan angka totalnya utuh.
    expect(hasil).toMatch(/Menampilkan 1 dari 1/);
  });

  it("saring tarif=belum mengumpulkan varian yang belum bertarif", async () => {
    const hasil = renderToStaticMarkup(await halaman({ tarif: "belum" }));
    // Varian uji yang SUDAH bertarif tidak boleh ikut terjaring.
    expect(hasil).not.toContain("PAD-UJI Tarif Layanan Mundur");
  });

  it("halaman kosong menjelaskan sebabnya, bukan sekadar diam", async () => {
    const hasil = renderToStaticMarkup(await halaman({ cari: "tidak ada varian bernama begini" }));
    expect(hasil).toMatch(/tidak ada varian yang cocok/i);
  });

  it("judul mengandalkan template `%s · PADMA`", () => {
    expect(sumberHalaman).toMatch(/metadata\s*=\s*\{\s*title:\s*"[^"]+"\s*\}/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("halaman menjaga perannya sendiri dengan requireRole(['owner'])", () => {
    expect(sumberHalaman).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    expect(sumberHalaman).not.toContain('"admin"');
  });

  it("TIDAK ada tombol/label Hapus — DELETE memang sudah dicabut", () => {
    expect(sumberHalaman).not.toMatch(/>\s*Hapus/);
    expect(markup).not.toMatch(/>\s*Hapus/);
  });
});
```

Catatan untuk implementer: `VARIAN_MUNDUR` sudah ada sebagai konstanta di berkas uji ini. Uji lama `"memperingatkan bahwa tarif baru TIDAK mengubah rekap pekan lalu"` dan `"menyediakan form penetapan tarif…"` yang membaca `sumberForm` **dipindah ke Task 4**; hapus dari describe ini dan jangan biarkan `sumberForm` menjadi variabel tak terpakai (lint akan menangkapnya — ia masih dipakai `describe("berkas server action rate card")`, periksa dulu sebelum menghapus baris 177).

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/owner-tarif.test.ts
```
Diharapkan: FAIL — `TarifPage` belum menerima `searchParams`, tidak ada `href="/owner/tarif/…"`, dan `name="harga"` masih ada di markup.

- [ ] **Step 3: Implementasi minimal**

Tulis ulang `web/src/app/owner/tarif/page.tsx`:

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarTarif, SARING_TARIF } from "@/lib/owner/daftar-tarif";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Rate Card" };

const BASIS = "/owner/tarif";

export default async function TarifPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();
  const param = uraikanParamDaftar(await searchParams, SARING_TARIF);
  const { baris, total } = await ambilDaftarTarif(param, hariIni);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Rate Card</h1>
        <Bantuan judul="Tentang halaman ini">
          Harga ke klien &amp; honor mitra per sesi, berlaku {formatTanggalID(hariIni)}. Angka ini
          hidup hanya di panel Owner — tidak satu pun layar lain di PADMA pernah menampilkannya.
          Tarif tidak pernah ditimpa, hanya <b>ditambah</b>: setiap penetapan melahirkan satu baris
          baru bertanggal berlaku, dan rekap honor memakai tarif yang berlaku <b>pada tanggal
          sesi</b> — jadi menaikkan tarif hari ini tidak menggeser satu angka pun di pekan yang
          sudah lewat, termasuk pekan yang honornya sudah dibayarkan. Tarif lama tidak bisa dihapus
          maupun disunting; basis data menolaknya, bahkan untuk pemilik. Salah ketik diperbaiki
          dengan menetapkan tarif baru.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "tarif",
            label: "Tarif",
            pilihan: [
              { nilai: "bertarif", label: "Sudah bertarif" },
              // `menuntut` mewarnai chip clay: varian tanpa tarif adalah
              // PEKERJAAN, bukan kabar — sesi yang sudah selesai padanya
              // muncul di rekap sebagai tak-bertarif dan honornya tidak ikut
              // dihitung di angka mana pun.
              { nilai: "belum", label: "Belum bertarif", menuntut: true },
            ],
          },
          {
            nama: "aktif",
            label: "Ketersediaan",
            pilihan: [
              { nilai: "ya", label: "Ditawarkan" },
              { nilai: "tidak", label: "Tidak ditawarkan" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Varian baru lahir di panel Admin (`/admin/layanan/[id]`), bukan di
        // sini: halaman ini menetapkan HARGA varian yang sudah ada, dan tidak
        // pernah menciptakan katalog.
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {param.cari === "" && Object.keys(param.saring).length === 0
            ? "Belum ada varian layanan di katalog. Varian lahir di panel Admin."
            : "Tidak ada varian yang cocok dengan pencarian ini."}
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Rate card layanan">
            <thead>
              <tr>
                <Th>Layanan</Th><Th>Harga klien</Th><Th>Honor mitra</Th>
                <Th>Margin</Th><Th>Berlaku sejak</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b) => {
                const t = b.berlaku;
                // Varian baku (label kosong) jatuh ke nama layanannya —
                // keputusan tampilan ini milik layar, sesuai kontrak
                // `labelVarian()`.
                const nama = b.labelVarian === "" ? b.namaLayanan : b.labelVarian;
                return (
                  <tr key={b.variantId}>
                    <Td>
                      <Link
                        href={`${BASIS}/${b.variantId}`}
                        className="font-bold text-panel-ink underline"
                      >
                        {nama}
                      </Link>
                      <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                        {b.namaFase}
                        {b.labelVarian !== "" && ` · ${b.namaLayanan}`}
                        {!b.aktif && " · tidak ditawarkan lagi"}
                      </span>
                    </Td>
                    <Td className="font-mono text-[13px]">{t ? formatRupiah(t.hargaKlien) : "—"}</Td>
                    <Td className="font-mono text-[13px]">{t ? formatRupiah(t.honorMitra) : "—"}</Td>
                    {/* Margin adalah angka PADMA. Ia DIHITUNG, tidak pernah
                        disimpan: kolom nominal turunan akan hidup di dalam
                        sebuah VIEW milik postgres yang berjalan dengan hak
                        pemilik dan karenanya MELEWATI RLS. */}
                    <Td className="font-mono text-[13px] text-leaf">
                      {t ? formatRupiah(t.margin) : "—"}
                    </Td>
                    <Td>
                      {t ? (
                        formatTanggalID(t.berlakuSejak)
                      ) : (
                        <span className="text-clay">Belum bertarif</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />
    </main>
  );
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/owner-tarif.test.ts && npx tsc --noEmit && npm run lint
```
Diharapkan: PASS. Kalau `tsc` mengeluh soal `PageProps`, jalankan `npm run build` sekali — tipe rute diregenerasi dan galatnya hilang (Global Constraint 7).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/owner/tarif/page.tsx web/tests/owner-tarif.test.ts
git commit -m "feat(owner): /owner/tarif jadi daftar datar berpalet panel"
```

---

### Task 4: Rute baru `/owner/tarif/[variantId]`

Rumah baru bagi formulir penetapan tarif dan riwayat penuh. Formulirnya berhenti menyembunyikan diri di balik tombol: halaman ini memang dibuka untuk menetapkan tarif.

**Files:**
- Create: `web/src/app/owner/tarif/[variantId]/page.tsx`
- Modify: `web/src/app/owner/tarif/form-tarif.tsx` (buang state `terbuka`, sapu palet)
- Test: `web/tests/owner-tarif.test.ts` (describe baru)

**Interfaces:**
- Consumes: `ambilVarianTarif` (Task 2); `tetapkanTarif` dari `../aksi` (tidak berubah); `NOMINAL_MAKS` dari `../status` (tidak berubah).
- Produces: `<FormTarif variantId namaLayanan hariIni hargaSekarang honorSekarang hargaCoretSekarang />` — **prop tidak berubah sama sekali**, hanya perilaku bukanya.

- [ ] **Step 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/owner-tarif.test.ts`, sesudah describe daftar. Tambahkan pula impornya di dekat baris 173:

```ts
const { default: TarifVarianPage } = await import("@/app/owner/tarif/[variantId]/page");
const sumberDetail = baca("src/app/owner/tarif/[variantId]/page.tsx");
```

```ts
describe("halaman tarif varian (/owner/tarif/[variantId])", () => {
  let markup = "";

  beforeAll(async () => {
    ref.sesi = sesiOwner;
    markup = renderToStaticMarkup(
      await TarifVarianPage({ params: Promise.resolve({ variantId: VARIAN_MUNDUR }) }),
    );
  });

  it("menyediakan form penetapan tarif dengan medan tanggal berlaku", () => {
    expect(markup).toContain('name="varian"');
    expect(markup).toContain('name="harga"');
    expect(markup).toContain('name="honor"');
    expect(markup).toContain('name="mulai"');
  });

  it("formulir langsung terbuka — halaman ini memang dibuka untuk menetapkan tarif", () => {
    // Sebelumnya formulir bersembunyi di balik tombol "Tarif baru" DI DALAM
    // sel tabel. Di halaman sendiri, tombol itu hanya menambah satu klik ke
    // satu-satunya hal yang bisa dilakukan di sini.
    expect(sumberForm).not.toContain("useState(false)");
    expect(markup).not.toMatch(/>\s*Tarif baru\s*</);
  });

  it("riwayat tarif TERENDER penuh, bukan terlipat di balik details", () => {
    // Riwayat adalah bukti berapa honor yang seharusnya dibayarkan pada
    // pekan-pekan yang sudah lewat. Bukti yang hanya muncul setelah seseorang
    // mengklik adalah bukti yang bisa terlewat.
    expect(markup).not.toContain("<details");
    expect(markup).toMatch(/Riwayat/i);
    expect(markup).toContain(`Rp ${HARGA_LAMA.toLocaleString("id-ID")}`);
  });

  it("memperingatkan bahwa tarif baru TIDAK mengubah rekap pekan lalu", () => {
    const teks = markup + sumberForm;
    expect(teks).toMatch(/pekan/i);
    expect(teks).toMatch(/tidak (akan )?meng(ubah|geser)/i);
  });

  it("menaut kembali ke daftar rate card", () => {
    expect(markup).toContain('href="/owner/tarif"');
  });

  it("varian yang tidak ada dijawab notFound(), bukan halaman kosong", async () => {
    await expect(
      TarifVarianPage({
        params: Promise.resolve({ variantId: "00000000-0000-0000-0000-000000000000" }),
      }),
    ).rejects.toThrow("NOTFOUND");
  });

  it("halaman menjaga perannya sendiri dengan requireRole(['owner'])", () => {
    expect(sumberDetail).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    expect(sumberDetail).not.toContain('"admin"');
  });

  it("TIDAK ada tombol/label Hapus — DELETE memang sudah dicabut", () => {
    expect(sumberDetail).not.toMatch(/>\s*Hapus/);
    expect(markup).not.toMatch(/>\s*Hapus/);
  });
});
```

Catatan: mock `next/navigation` di berkas uji ini sudah membuat `notFound()` melempar `"NOTFOUND"` (baris ~78) — tidak perlu ditambah.

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/owner-tarif.test.ts
```
Diharapkan: FAIL — modul `@/app/owner/tarif/[variantId]/page` belum ada.

- [ ] **Step 3: Implementasi minimal**

Buat `web/src/app/owner/tarif/[variantId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilVarianTarif } from "@/lib/owner/daftar-tarif";
import type { TarifRiwayat } from "@/lib/owner/data";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { FormTarif } from "../form-tarif";

// Judul mengandalkan template `%s · PADMA` di root layout. Sengaja STATIS:
// judul dinamis menuntut `generateMetadata` yang akan membaca rate card untuk
// KEDUA kalinya per kunjungan — dan `ambilRateCard()` membaca seluruh riwayat
// tarif klinik sekali jalan.
export const metadata = { title: "Tarif varian" };

/**
 * Satu baris riwayat tarif.
 *
 * Terender penuh, tidak terlipat: riwayat adalah bukti berapa honor yang
 * seharusnya dibayarkan pada pekan-pekan yang sudah lewat, dan halaman ini
 * ADALAH tempatnya — berbeda dari daftar rate card, tempat ia dulu terlipat di
 * balik `<details>` karena tidak muat.
 */
function BarisRiwayat({ tarif }: { tarif: TarifRiwayat }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-panel-border py-2 last:border-b-0">
      <span className="font-mono text-[12px] text-panel-muted">
        {formatTanggalID(tarif.berlakuSejak)}
        {tarif.berlakuSekarang && (
          <b className="ml-2 rounded-full bg-leaf-soft px-2 py-0.5 text-[10.5px] font-extrabold text-leaf">
            berlaku sekarang
          </b>
        )}
        {tarif.belumBerlaku && (
          <b className="ml-2 rounded-full border border-panel-border px-2 py-0.5 text-[10.5px] font-extrabold text-panel-muted">
            belum berlaku
          </b>
        )}
      </span>
      <span className="text-[12.5px] text-panel-ink">
        Harga {formatRupiah(tarif.hargaKlien)} · Honor {formatRupiah(tarif.honorMitra)} ·{" "}
        <span className="text-leaf">Margin {formatRupiah(tarif.margin)}</span>
      </span>
    </li>
  );
}

export default async function TarifVarianPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  await requireRole(["owner"]);

  const { variantId } = await params;
  const hariIni = hariIniJakarta();
  const varian = await ambilVarianTarif(variantId, hariIni);
  // `notFound()`, bukan halaman kosong: id yang salah ketik yang dijawab
  // "belum ada tarif" akan mengundang owner menetapkan tarif ke varian yang
  // tidak ada, dan penolakannya baru datang dari basis data sebagai kode.
  if (varian === null) notFound();

  const nama = varian.labelVarian === "" ? varian.namaLayanan : varian.labelVarian;
  const t = varian.berlaku;

  return (
    <main>
      <header className="mb-4">
        <Link href="/owner/tarif" className="text-[12px] font-bold text-panel-muted">
          ‹ Rate Card
        </Link>
        <h1 className="mt-1 text-[18px] font-bold text-panel-ink">{nama}</h1>
        <p className="mt-0.5 text-[12px] text-panel-muted">
          {varian.namaFase}
          {varian.labelVarian !== "" && ` · ${varian.namaLayanan}`}
          {!varian.aktif && " · tidak ditawarkan lagi"}
        </p>
      </header>

      <section className="mb-5 rounded-lg border border-panel-border bg-panel-surface p-4">
        <h2 className="mb-2 text-[13px] font-bold text-panel-ink">
          Berlaku {formatTanggalID(hariIni)}
        </h2>
        {t === null ? (
          <p className="text-[13px] text-clay">
            Belum bertarif — sesi yang sudah selesai pada varian ini muncul di rekap sebagai{" "}
            <b>tak bertarif</b>, dan honornya belum ikut dihitung di angka mana pun.
          </p>
        ) : (
          <p className="font-mono text-[13.5px] text-panel-ink">
            Harga {formatRupiah(t.hargaKlien)} · Honor {formatRupiah(t.honorMitra)} ·{" "}
            <span className="text-leaf">Margin {formatRupiah(t.margin)}</span> · sejak{" "}
            {formatTanggalID(t.berlakuSejak)}
          </p>
        )}
      </section>

      <section className="mb-5 rounded-lg border border-panel-border bg-panel-surface p-4">
        <h2 className="mb-3 text-[13px] font-bold text-panel-ink">Tetapkan tarif baru</h2>
        <FormTarif
          variantId={varian.variantId}
          namaLayanan={nama}
          hariIni={hariIni}
          hargaSekarang={t?.hargaKlien ?? null}
          honorSekarang={t?.honorMitra ?? null}
          hargaCoretSekarang={t?.hargaCoret ?? null}
        />
      </section>

      <section className="rounded-lg border border-panel-border bg-panel-surface p-4">
        <h2 className="mb-1 text-[13px] font-bold text-panel-ink">
          Riwayat tarif ({varian.riwayat.length})
        </h2>
        {/* Ketiadaan tombol hapus bukan kelalaian, dan alasannya ditulis di
            layar supaya tidak ada yang menambahkannya sebagai "kenyamanan
            kecil": hak DELETE atas `variant_rates` sudah dicabut, bahkan untuk
            pemilik. Baris lama adalah satu-satunya bukti berapa honor yang
            seharusnya dibayarkan pada pekan-pekan yang sudah lewat. */}
        <p className="mb-3 text-[12px] leading-relaxed text-panel-muted">
          Tarif lama tidak bisa dihapus maupun disunting — basis data menolaknya, bahkan untuk
          pemilik. Salah ketik diperbaiki dengan menetapkan tarif baru.
        </p>
        {varian.riwayat.length === 0 ? (
          <p className="text-[13px] italic text-panel-muted">Belum pernah ditetapkan.</p>
        ) : (
          <ul>
            {varian.riwayat.map((r) => (
              <BarisRiwayat key={r.id} tarif={r} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

Lalu ubah `web/src/app/owner/tarif/form-tarif.tsx`: buang tombol pembuka dan state `terbuka`, dan sapu paletnya. Konkretnya —

1. Ganti keempat konstanta kelas di atas berkas:

```tsx
const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px] text-panel-ink";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-muted disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60";
```

2. Hapus `const [terbuka, setTerbuka] = useState(false);` dan SELURUH blok `if (!terbuka) { … }`. Hapus `useState` dari daftar impor **hanya bila** `pesan` juga berhenti memakainya — ia masih memakainya, jadi impornya tetap.

3. Hapus tombol "Batal" di ekor formulir (ia hanya menutup formulir yang kini tidak bisa ditutup) dan ganti dengan tautan kembali:

```tsx
      <span className="flex gap-2">
        <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Simpan tarif"}
        </button>
      </span>
```

4. Ganti `className` formulirnya dan kedua paragraf peringatan:

```tsx
      className="grid w-full gap-2.5"
```

```tsx
      <p className="text-[12px] leading-relaxed text-clay">
```
(dua kemunculan — teksnya tidak berubah)

5. Pada blok sukses, ganti `setTerbuka(false)` dengan penanda sukses:

```tsx
          const r = await tetapkanTarif(fd);
          if (r.ok) {
            setPesan(null);
            setSukses(true);
          } else {
            setSukses(false);
            setPesan(r.pesan);
          }
```
dengan `const [sukses, setSukses] = useState(false);` di dekat state lain, dan di atas tombol simpan:

```tsx
      {sukses && (
        <p className="text-[12px] font-semibold text-leaf">
          Tarif baru tersimpan sebagai baris baru. Riwayat di bawah ikut bertambah.
        </p>
      )}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/owner-tarif.test.ts && npx tsc --noEmit && npm run lint
```
Diharapkan: PASS. Jalankan `npm run build` bila `tsc` mengeluh soal `PageProps` rute baru.

- [ ] **Step 5: Commit**

```bash
git add "web/src/app/owner/tarif/[variantId]/page.tsx" web/src/app/owner/tarif/form-tarif.tsx web/tests/owner-tarif.test.ts
git commit -m "feat(owner): halaman tarif varian dengan formulir & riwayat penuh"
```

---

### Task 5: Lapisan cari/saring/paginasi rekap honor

Rekap tetap laporan berbentuk kartu — yang ditambahkan hanya cara memilih pekan mana yang tampil. Fungsi murni dulu, halaman di Task 6.

**Files:**
- Create: `web/src/lib/owner/daftar-rekap.ts`
- Test: `web/tests/owner-daftar-rekap.test.ts` (baru)

**Interfaces:**
- Consumes: `hitungRentang` (Task 1); tipe `RekapPekan`, `BarisMitra` dari `@/lib/owner/rekap`; `ambilRekap()` dari `@/lib/owner/data`.
- Produces:
  - `PER_HAL_REKAP = 8`
  - `SARING_REKAP` — `{ honor: ["tuntas", "belum"] }`
  - `pekanTuntas(p: RekapPekan): boolean`
  - `saringRekap(rekap: readonly RekapPekan[], param: ParamDaftar): { baris: RekapPekan[]; total: number }`
  - `ambilDaftarRekap(param: ParamDaftar): Promise<{ baris: RekapPekan[]; total: number }>`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/owner-daftar-rekap.test.ts`:

```ts
/**
 * Saring & paginasi rekap honor — sebagai ARITMATIKA, bukan render.
 *
 * Satu aturan di berkas ini menyangkut uang, bukan tata letak: sebuah pekan
 * hanya "tuntas" bila SETIAP mitra di dalamnya sudah ditandai dibayar. Pekan
 * tanpa mitra sama sekali TIDAK tuntas — ia kosong, dan menyebut kekosongan
 * sebagai keberesan akan menyembunyikan pekan yang honornya belum sempat
 * dihitung.
 */
import { describe, it, expect } from "vitest";
import type { BarisMitra, RekapPekan } from "@/lib/owner/rekap";
import { pekanTuntas, saringRekap, SARING_REKAP, PER_HAL_REKAP } from "@/lib/owner/daftar-rekap";
import { uraikanParamDaftar } from "@/app/_shell/panel/daftar";

function mitra(nama: string, sudahDibayar: boolean): BarisMitra {
  return {
    partnerId: `p-${nama}`,
    nama,
    jumlahSesi: 1,
    jumlahTakBertarif: 0,
    totalHonor: 100_000,
    sudahDibayar,
    dibayarPada: sudahDibayar ? "2026-01-10T00:00:00.000Z" : null,
    adaSesiSesudahDitandai: false,
  };
}

function pekan(senin: string, perMitra: BarisMitra[]): RekapPekan {
  return {
    senin,
    rentang: senin,
    jumlahSesi: perMitra.length,
    perMitra,
    totalHonor: 0,
    totalHarga: 0,
    margin: 0,
    sesiTakBertarif: [],
  };
}

const TUNTAS = pekan("2026-01-05", [mitra("Bidan Ayu", true), mitra("Bidan Sari", true)]);
const SEBAGIAN = pekan("2026-01-12", [mitra("Bidan Ayu", true), mitra("Bidan Sari", false)]);
const KOSONG = pekan("2026-01-19", []);
const REKAP = [KOSONG, SEBAGIAN, TUNTAS];

const param = (sp: Record<string, string>) => uraikanParamDaftar(sp, SARING_REKAP);

describe("pekanTuntas", () => {
  it("tuntas hanya bila SETIAP mitra sudah ditandai dibayar", () => {
    expect(pekanTuntas(TUNTAS)).toBe(true);
    expect(pekanTuntas(SEBAGIAN)).toBe(false);
  });

  it("pekan tanpa mitra TIDAK tuntas — kosong bukan beres", () => {
    expect(pekanTuntas(KOSONG)).toBe(false);
  });
});

describe("saringRekap", () => {
  it("tanpa parameter memulangkan seluruh pekan dalam urutan aslinya", () => {
    const { baris, total } = saringRekap(REKAP, param({}));
    expect(baris.map((p) => p.senin)).toEqual(["2026-01-19", "2026-01-12", "2026-01-05"]);
    expect(total).toBe(3);
  });

  it("honor=belum menyisakan pekan yang masih punya honor belum ditandai", () => {
    const { baris, total } = saringRekap(REKAP, param({ honor: "belum" }));
    expect(baris.map((p) => p.senin)).toEqual(["2026-01-19", "2026-01-12"]);
    expect(total).toBe(2);
  });

  it("honor=tuntas menyisakan pekan yang seluruh honornya sudah ditandai", () => {
    expect(saringRekap(REKAP, param({ honor: "tuntas" })).baris.map((p) => p.senin)).toEqual([
      "2026-01-05",
    ]);
  });

  it("cari mencocokkan nama mitra, dan menyisakan KARTU pekannya UTUH", () => {
    const { baris } = saringRekap(REKAP, param({ cari: "sari" }));
    expect(baris.map((p) => p.senin)).toEqual(["2026-01-12", "2026-01-05"]);
    // Kartunya tidak dipangkas: margin dan total pekan dihitung atas SELURUH
    // mitra, jadi kartu yang isinya disaring akan menampilkan angka yang tidak
    // cocok dengan baris yang terlihat.
    expect(baris[0].perMitra).toHaveLength(2);
  });

  it("memotong 8 kartu per halaman, bukan 25", () => {
    expect(PER_HAL_REKAP).toBe(8);
    const banyak = Array.from({ length: 20 }, (_, i) =>
      pekan(`2026-02-${String(i + 1).padStart(2, "0")}`, [mitra("Bidan Ayu", false)]),
    );
    const h1 = saringRekap(banyak, param({}));
    expect(h1.baris).toHaveLength(8);
    expect(h1.total).toBe(20);
    const h3 = saringRekap(banyak, param({ hal: "3" }));
    expect(h3.baris).toHaveLength(4);
  });

  it("halaman di luar jangkauan memulangkan daftar kosong, bukan melempar", () => {
    expect(saringRekap(REKAP, param({ hal: "9" })).baris).toEqual([]);
  });
});
```

Catatan: bila nama medan `BarisMitra` berbeda dari yang ditulis di atas, **perbaiki uji mengikuti tipe yang sungguhan ada** (`src/lib/owner/rekap.ts`), jangan mengubah tipenya.

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/owner-daftar-rekap.test.ts
```
Diharapkan: FAIL — `Cannot find module '@/lib/owner/daftar-rekap'`.

- [ ] **Step 3: Implementasi minimal**

Buat `web/src/lib/owner/daftar-rekap.ts`:

```ts
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { ambilRekap } from "./data";
import type { RekapPekan } from "./rekap";

/**
 * Saring & paginasi untuk `/owner/rekap`.
 *
 * BATAS YANG HARUS DIKETAHUI: `ambilRekap()` membaca SELURUH sesi, tarif, dan
 * tanda bayar klinik lalu menghitung seluruh pekan di TypeScript. Paginasi di
 * sini memotong hasil yang SUDAH terhitung — ia memperbaiki layar dan biaya
 * render, BUKAN batas bacaan. Sama seperti `daftarTagihanAdmin()`
 * (`src/lib/admin/tagihan.ts:293-300`) dan `saringRateCard()`. Obatnya view
 * SQL, bukan berkas ini.
 *
 * Rekap TIDAK menjadi daftar objek karena diberi bilah ini: ia tetap laporan,
 * kartunya tetap utuh, dan tidak ada satu pun formulir yang pindah ke sini.
 */
export const PER_HAL_REKAP = 8;

export const SARING_REKAP = { honor: ["tuntas", "belum"] } as const satisfies SaringSah;

/**
 * Sebuah pekan "tuntas" bila SETIAP mitra di dalamnya sudah ditandai dibayar.
 *
 * Pekan TANPA mitra sengaja TIDAK tuntas. `[].every()` memulangkan `true`, dan
 * kalau dibiarkan, pekan yang belum sempat dihitung honornya akan lenyap dari
 * saringan "belum" — persis pekan yang paling perlu dilihat owner.
 */
export function pekanTuntas(p: RekapPekan): boolean {
  return p.perMitra.length > 0 && p.perMitra.every((m) => m.sudahDibayar);
}

export function saringRekap(
  rekap: readonly RekapPekan[],
  param: ParamDaftar,
): { baris: RekapPekan[]; total: number } {
  const cari = param.cari.toLowerCase();

  const cocok = rekap.filter((p) => {
    // Cari MENYARING PEKAN, tidak memangkas isinya. Margin dan total pekan
    // dihitung atas SELURUH mitra; kartu yang isinya ikut disaring akan
    // menampilkan angka yang tidak cocok dengan baris yang terlihat.
    if (cari !== "" && !p.perMitra.some((m) => m.nama.toLowerCase().includes(cari))) return false;
    if (param.saring.honor === "tuntas" && !pekanTuntas(p)) return false;
    if (param.saring.honor === "belum" && pekanTuntas(p)) return false;
    return true;
  });

  const { dari, sampai } = hitungRentang(param.hal, PER_HAL_REKAP);
  return { baris: cocok.slice(dari, sampai + 1), total: cocok.length };
}

/** Satu halaman kartu pekan untuk `/owner/rekap`. */
export async function ambilDaftarRekap(
  param: ParamDaftar,
): Promise<{ baris: RekapPekan[]; total: number }> {
  return saringRekap(await ambilRekap(), param);
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/owner-daftar-rekap.test.ts && npx tsc --noEmit && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/owner/daftar-rekap.ts web/tests/owner-daftar-rekap.test.ts
git commit -m "feat(owner): lapisan saring & paginasi rekap honor"
```

---

### Task 6: `/owner/rekap` disapu ke palet panel, tetap berbentuk kartu

**Files:**
- Modify: `web/src/app/owner/rekap/page.tsx`
- Modify: `web/src/app/owner/rekap/tabel-rekap.tsx` (palet saja)
- Modify: `web/tests/owner-rekap-halaman.test.ts:228-231`, `:515-597`
- Test: `web/tests/owner-rekap-halaman.test.ts`

**Interfaces:**
- Consumes: `ambilDaftarRekap`, `SARING_REKAP`, `PER_HAL_REKAP` (Task 5); `BarisHonorMitra` (tidak berubah prop-nya).
- Produces: rute `/owner/rekap` menerima `?cari=`, `?honor=tuntas|belum`, `?hal=`.

- [ ] **Step 1: Tulis uji yang gagal**

Di `web/tests/owner-rekap-halaman.test.ts`, ganti helper render agar menerima parameter:

```ts
async function renderHalaman(sp: Record<string, string> = {}): Promise<string> {
  ref.sesi = sesiOwner;
  return renderToStaticMarkup(await RekapPage({ searchParams: Promise.resolve(sp) }));
}
```

Lalu tambahkan ke `describe("halaman rekap honor (/owner/rekap)")` — uji yang sudah ada di sana **tetap**, ini tambahan:

```ts
  it("bilah daftar menyediakan kotak cari dan chip saring honor", async () => {
    const markup = await renderHalaman();
    expect(markup).toContain('name="cari"');
    expect(markup).toContain('href="/owner/rekap?honor=belum"');
    expect(markup).toContain('href="/owner/rekap?honor=tuntas"');
  });

  it("kartu pekan TETAP kartu — rekap laporan, bukan daftar berformulir", async () => {
    const markup = await renderHalaman();
    // `data-pekan` membawa Senin pekannya, dan tanpa penanda itu sebuah
    // assertion (atau seorang pembaca) bisa membaca angka pekan lain sebagai
    // angka pekan yang sedang dilihatnya.
    expect(markup).toContain("data-pekan=");
    // Tidak ada tabel daftar dan tidak ada panel geser di halaman ini.
    expect(sumberHalaman).not.toContain("PanelGeser");
    expect(sumberHalaman).not.toContain("@/app/_shell/panel/tabel");
  });

  it("cari menyaring PEKAN dan meninggalkan kartunya utuh", async () => {
    const markup = await renderHalaman({ cari: NAMA_MITRA });
    expect(markup).toContain(NAMA_MITRA);
    expect(markup).toMatch(/Menampilkan \d+ dari \d+/);
  });

  it("saring honor=tuntas menyembunyikan pekan yang masih punya honor belum ditandai", async () => {
    const markup = await renderHalaman({ honor: "tuntas" });
    // Pekan uji belum ditandai dibayar, jadi ia tidak boleh muncul.
    expect(markup).not.toContain(NAMA_MITRA);
  });

  it("paginasi memakai delapan kartu per halaman, bukan dua puluh lima", () => {
    expect(sumberHalaman).toContain("PER_HAL_REKAP");
    expect(sumberHalaman).toMatch(/perHal=\{PER_HAL_REKAP\}/);
  });

  it("tidak ada satu pun token palet lama tersisa di kedua berkas", () => {
    for (const sumber of [sumberHalaman, sumberTabel]) {
      expect(sumber).not.toMatch(/\b(?:text|bg|border|hover:text|hover:bg)-(?:night|paper|gold-pale)\b/);
      expect(sumber).not.toContain("bg-white");
      expect(sumber).not.toContain("font-serif");
    }
  });
```

Catatan: `NAMA_MITRA` sudah ada sebagai konstanta di berkas uji ini — bila namanya berbeda, pakai konstanta mitra uji yang sungguhan ada.

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/owner-rekap-halaman.test.ts
```
Diharapkan: FAIL — `RekapPage` belum menerima `searchParams`, tidak ada `name="cari"`, dan palet lama masih ada.

- [ ] **Step 3: Implementasi minimal**

Di `web/src/app/owner/rekap/page.tsx`:

1. Ganti blok impor menjadi:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarRekap, PER_HAL_REKAP, SARING_REKAP } from "@/lib/owner/daftar-rekap";
import type { RekapPekan } from "@/lib/owner/rekap";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID } from "@/lib/passport/waktu";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { BarisHonorMitra } from "./tabel-rekap";

const BASIS = "/owner/rekap";
```

2. Di `KartuPekan`, sapu paletnya — struktur, komentar, dan `data-pekan` TIDAK berubah:

- `<article>`: `mb-3.5 rounded-lg border border-panel-border bg-panel-surface px-5 py-5`
- judul pekan: `text-[14px] font-bold text-panel-ink` (buang `font-serif`)
- lencana jumlah sesi: `rounded-full border border-panel-border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider text-panel-muted`
- paragraf "Honor yang harus dibayar": `text-panel-muted`
- baris margin: `border-t border-panel-border`, label `text-panel-muted`, nominal tetap `text-leaf`
- kotak sesi tak bertarif: `rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3`, isi `text-panel-muted`, penekanan `text-panel-ink`

3. Ganti badan `RekapPage`:

```tsx
export default async function RekapPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_REKAP);
  // Seluruh agregasinya dihitung di TypeScript (`lib/owner/rekap.ts`), bukan
  // oleh SQL. Sebuah view penjumlah dimiliki `postgres`, berjalan dengan hak
  // PEMILIK, dan karenanya MELEWATI RLS.
  const { baris, total } = await ambilDaftarRekap(param);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Rekap &amp; Honor</h1>
        <Bantuan judul="Tentang halaman ini">
          Dihitung otomatis dari sesi berstatus <b>Selesai</b>, dengan tarif yang berlaku{" "}
          <b>pada tanggal sesi</b> — jadi menaikkan tarif hari ini tidak menggeser satu angka pun di
          pekan yang sudah lewat. Jadwal gajian: Sabtu. Tanda bayar bersifat{" "}
          <b>sekali dan permanen</b>: basis data menolak mencabutnya, bahkan untuk pemilik, karena
          tanda itu adalah bukti bahwa seorang mitra sudah menerima uangnya. Periksa jumlahnya
          sebelum menandai.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "honor",
            label: "Honor",
            pilihan: [
              // Pekan yang masih punya honor belum ditandai adalah PEKERJAAN —
              // uang yang belum berpindah tangan, bukan sekadar kabar.
              { nilai: "belum", label: "Belum tuntas", menuntut: true },
              { nilai: "tuntas", label: "Sudah tuntas" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Pekan tidak dibuat dari panel mana pun — ia lahir dari sesi yang
        // diselesaikan di panel Admin.
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {param.cari === "" && Object.keys(param.saring).length === 0
            ? "Belum ada sesi selesai. Angka di halaman ini bergerak begitu sesi diselesaikan di panel Admin."
            : "Tidak ada pekan yang cocok dengan pencarian ini."}
        </p>
      ) : (
        baris.map((p) => <KartuPekan key={p.senin} pekan={p} />)
      )}

      <Paginasi basis={BASIS} param={param} total={total} perHal={PER_HAL_REKAP} />
    </main>
  );
}
```

Paragraf peringatan "tanda bayar sekali dan permanen" yang dulu berdiri sebagai kotak emas sudah dipindahkan ke `<Bantuan>` di atas — jangan tinggalkan salinannya.

4. Di `web/src/app/owner/rekap/tabel-rekap.tsx`, sapu palet saja (logika, komentar, dan perilaku TIDAK berubah):

- `KELAS_TOMBOL`: `shrink-0 rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60`
- `KELAS_LUNAS`: `shrink-0 rounded-lg border border-leaf/40 bg-leaf-soft px-3 py-1.5 text-[12px] font-bold text-leaf`
- pembungkus baris: `border-b border-panel-border`
- nama mitra: `text-panel-ink`; keterangan sesi: `text-panel-muted`; nominal: `text-panel-ink`
- kotak peringatan sesi susulan: `mt-1.5 rounded-lg border border-clay/35 bg-panel-bg px-3 py-2 text-[11.5px] leading-relaxed text-clay`

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/owner-rekap-halaman.test.ts tests/owner-kerangka.test.ts && npx tsc --noEmit && npm run lint
```
`owner-kerangka.test.ts` ikut dijalankan karena ia memakai `ringkasanPekanIni()` sebagai orakel independen atas angka beranda — kalau sapuan ini tanpa sengaja menggeser satu angka, di sanalah ketahuan.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/owner/rekap/page.tsx web/src/app/owner/rekap/tabel-rekap.tsx web/tests/owner-rekap-halaman.test.ts
git commit -m "feat(owner): /owner/rekap dapat saring honor, paginasi 8 kartu, palet panel"
```

---

### Task 7: `/owner/transport` — formulir keluar dari sel tabel, daftar sesi dipaginasi

Tabel empat jenjang TIDAK diberi cari/saring (empat baris tetap; deviasi D1 hanya menyangkut formulirnya). Yang berubah: kolom "Tetapkan" jadi tautan `?ubah=<jenjang>`, kartu sesi >20 km jadi tautan `?ubah=sesi-<id>`, keduanya membuka panel geser; daftar sesi menunggu dipaginasi; palet disapu.

**Files:**
- Modify: `web/src/app/owner/transport/page.tsx`
- Modify: `web/src/app/owner/transport/form-tarif-transport.tsx` (buang state `terbuka` pada `FormTarifTransport`, sapu palet keduanya)
- Modify: `web/tests/owner-transport.test.ts:656-684`
- Test: `web/tests/owner-transport.test.ts`

**Interfaces:**
- Consumes: `uraikanParamDaftar`, `bangunQuery`, `hitungRentang`, `PER_HAL`; `PanelGeser`, `Paginasi`, `Bantuan`, `Tabel`, `Th`, `Td`; `ambilTarifTransport`, `ambilSesiMenungguTarif` (tidak berubah); `JENJANG_TARIF_RATE_CARD`, `LABEL_JENJANG`.
- Produces: rute `/owner/transport` menerima `?hal=` dan `?ubah=<jenjang>|sesi-<id>`.

- [ ] **Step 1: Tulis uji yang gagal**

Ganti `describe("halaman transport (/owner/transport)")` di `web/tests/owner-transport.test.ts` menjadi:

```ts
describe("halaman transport (/owner/transport)", () => {
  const halaman = (sp: Record<string, string> = {}) => {
    ref.sesi = sesiOwner;
    return TransportPage({ searchParams: Promise.resolve(sp) });
  };

  it("menampilkan label jenjang, nominal, dan daftar sesi menunggu", async () => {
    const markup = renderToStaticMarkup(await halaman());
    expect(markup).toContain("0–5 km");
    expect(markup).toContain("Rp 10.000");
    expect(markup).not.toContain(">20 km</b>"); // di_atas_20 bukan baris rate card
    expect(markup).toContain("Uji Transport Owner"); // SESI.jauh menunggu
  });

  it("TIDAK ada formulir di dalam sel tabel — hanya tautan pembuka panel", async () => {
    const markup = renderToStaticMarkup(await halaman());
    // Inilah keluhan klien yang ditutup rencana ini. Medan formulir hanya
    // boleh muncul saat panelnya memang diminta lewat URL.
    expect(markup).not.toContain('name="tarif"');
    expect(markup).toContain('href="/owner/transport?ubah=0_5"');
  });

  it("?ubah=<jenjang> membuka panel geser berisi formulir jenjang itu", async () => {
    const markup = renderToStaticMarkup(await halaman({ ubah: "0_5" }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('name="jenjang"');
    expect(markup).toContain('name="tarif"');
    expect(markup).toContain('name="mulai"');
    // Panel tertutup kembali ke halaman TANPA `?ubah`.
    expect(markup).toContain('href="/owner/transport"');
  });

  it("?ubah=sesi-<id> membuka panel geser berisi formulir tarif khusus", async () => {
    const markup = renderToStaticMarkup(await halaman({ ubah: `sesi-${SESI.jauh}` }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('name="sesi"');
    expect(markup).toContain("Uji Transport Owner");
  });

  it("?ubah asing TIDAK membuka panel apa pun", async () => {
    // Daftar putih, bukan daftar hitam: `ubah` datang dari URL, dan panel yang
    // terbuka atas nilai asing akan merender formulir yang menunjuk jenjang
    // atau sesi yang tidak ada.
    for (const nilai of ["di_atas_20", "sesi-00000000-0000-0000-0000-000000000000", "../admin"]) {
      const markup = renderToStaticMarkup(await halaman({ ubah: nilai }));
      expect(markup, `?ubah=${nilai}`).not.toContain('role="dialog"');
    }
  });

  it("daftar sesi menunggu tarif dipaginasi", async () => {
    const markup = renderToStaticMarkup(await halaman());
    expect(sumberHalaman).toContain("Paginasi");
    expect(markup).toMatch(/Menampilkan \d+ dari \d+/);
  });

  it("tidak ada satu pun token palet lama tersisa di kedua berkas", () => {
    for (const sumber of [sumberHalaman, sumberForm]) {
      expect(sumber).not.toMatch(/\b(?:text|bg|border|hover:text|hover:bg)-(?:night|paper|gold-pale)\b/);
      expect(sumber).not.toContain("bg-white");
      expect(sumber).not.toContain("font-serif");
    }
  });

  it("judul mengandalkan template `%s · PADMA`", () => {
    expect(sumberHalaman).toMatch(/metadata\s*=\s*\{\s*title:\s*"[^"]+"\s*\}/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("halaman menjaga perannya sendiri dengan requireRole(['owner'])", () => {
    expect(sumberHalaman).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    expect(sumberHalaman).not.toContain('"admin"');
  });

  it("navigasi owner menautkan modul ini", () => {
    expect(baca("src/app/owner/_shell/nav-owner.tsx")).toContain('href: "/owner/transport"');
  });

  it("TIDAK ada tombol/label Hapus — DELETE memang sudah dicabut", () => {
    for (const sumber of [sumberHalaman, sumberForm]) {
      expect(sumber).not.toMatch(/>\s*Hapus/);
    }
  });
});
```

Catatan: `SESI.jauh` sudah ada sebagai fixture di berkas uji ini (dipakai `describe("ambilSesiMenungguTarif")`). Nilai jenjang `"0_5"` harus dicek terhadap `JENJANG_TARIF_RATE_CARD` yang sungguhan di `src/lib/transport/tarif.ts` — pakai nilai pertama daftar itu apa adanya, jangan mengarangnya.

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/owner-transport.test.ts
```
Diharapkan: FAIL — `TransportPage` belum menerima `searchParams`, `name="tarif"` masih terender di daftar, tidak ada `role="dialog"`.

- [ ] **Step 3: Implementasi minimal**

Di `web/src/app/owner/transport/page.tsx`:

1. Impor tambahan:

```tsx
import Link from "next/link";
import { uraikanParamDaftar, bangunQuery, hitungRentang, type ParamMentah } from "@/app/_shell/panel/daftar";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";

const BASIS = "/owner/transport";
```
Buang `const KELAS_TH = …` (digantikan `<Th>`).

2. Badan halaman:

```tsx
export default async function TransportPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  const sp = await searchParams;
  // Tidak ada saringan di halaman ini: empat jenjang adalah tabel TETAP, dan
  // menyaring empat baris adalah bilah yang lebih besar daripada isinya.
  // `uraikanParamDaftar` tetap dipakai demi `hal` — dan demi satu tempat yang
  // sama untuk aturan "halaman minimal 1".
  const param = uraikanParamDaftar(sp, {});
  const hariIni = hariIniJakarta();
  const [tarif, menunggu] = await Promise.all([
    ambilTarifTransport(hariIni),
    ambilSesiMenungguTarif(),
  ]);

  const cariTarif = (jenjang: (typeof JENJANG_TARIF_RATE_CARD)[number]): BarisTarifTransport | null =>
    tarif.find((t) => t.jenjang === jenjang) ?? null;

  // Paginasi memotong daftar yang SUDAH terbaca seluruhnya oleh
  // `ambilSesiMenungguTarif()` — memperbaiki layar, bukan batas bacaan.
  // Fungsi itu sendiri sudah dipaginasi terhadap `max_rows` di lapisan
  // datanya; yang di sini murni tampilan.
  const { dari, sampai } = hitungRentang(param.hal);
  const halamanMenunggu = menunggu.slice(dari, sampai + 1);

  // DAFTAR PUTIH. `ubah` datang dari URL: panel yang terbuka atas nilai asing
  // merender formulir yang menunjuk jenjang atau sesi yang tidak ada, dan
  // penolakannya baru datang dari basis data sebagai kode Postgres.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const jenjangDibuka = JENJANG_TARIF_RATE_CARD.find((j) => j === ubah) ?? null;
  const sesiDibuka = ubah.startsWith("sesi-")
    ? (menunggu.find((s) => s.id === ubah.slice("sesi-".length)) ?? null)
    : null;
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Transport</h1>
        <Bantuan judul="Tentang halaman ini">
          Tarif transport ke klien &amp; honor mitra per jenjang jarak, berlaku{" "}
          {formatTanggalID(hariIni)}. Sama seperti Rate Card layanan: tarif transport tidak pernah
          ditimpa, hanya <b>ditambah</b>, dan tarif lama tidak bisa dihapus maupun disunting —
          basis data menolaknya, bahkan untuk pemilik, karena baris lama adalah bukti berapa honor
          yang seharusnya dibayarkan pada sesi-sesi yang sudah lewat. Jenjang{" "}
          <b>di atas 20 km</b> sengaja tidak muncul di tabel: nominalnya bukan tarif rate card,
          melainkan konfirmasi PER SESI yang ditetapkan di bagian bawah halaman ini.
        </Bantuan>
      </header>

      <div className="rounded-lg border border-panel-border bg-panel-surface">
        <Tabel label="Rate card transport per jenjang jarak">
          <thead>
            <tr>
              <Th>Jenjang jarak</Th><Th>Tarif klien</Th><Th>Honor mitra</Th>
              <Th>Subsidi PADMA</Th><Th>Berlaku sejak</Th><Th>Tetapkan</Th>
            </tr>
          </thead>
          <tbody>
            {JENJANG_TARIF_RATE_CARD.map((jenjang) => {
              const b = cariTarif(jenjang);
              return (
                <tr key={jenjang}>
                  <Td><b className="text-panel-ink">{LABEL_JENJANG[jenjang]}</b></Td>
                  <Td className="font-mono text-[13px]">{b ? formatRupiah(b.tarifKlien) : "—"}</Td>
                  <Td className="font-mono text-[13px]">{b ? formatRupiah(b.honorMitra) : "—"}</Td>
                  {/* Subsidi DIHITUNG, tidak pernah disimpan sebagai kolom —
                      lihat komentar `BarisTarifTransport` di lib/owner/data.ts. */}
                  <Td className="font-mono text-[13px] text-leaf">
                    {b ? formatRupiah(b.subsidi) : "—"}
                  </Td>
                  <Td>
                    {b ? formatTanggalID(b.berlakuSejak) : <span className="text-clay">Belum bertarif</span>}
                  </Td>
                  <Td>
                    <Link
                      href={`${BASIS}${bangunQuery(param, { ubah: jenjang })}`}
                      className="font-bold text-panel-ink underline"
                    >
                      {b === null ? "Tetapkan tarif" : "Tarif baru"}
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabel>
      </div>

      <section aria-label="Sesi menunggu tarif khusus" className="mt-8">
        <h2 className="text-[15px] font-bold text-panel-ink">
          Sesi &gt;20 km menunggu tarif khusus
        </h2>
        <p className="mt-1 max-w-2xl text-[12.5px] text-panel-muted">
          Materi klien menulis &quot;&gt;20 km: konfirmasi admin&quot; — bukan tarif, melainkan
          ketiadaan tarif. Setiap sesi di bawah ini butuh nominal yang Anda tetapkan SENDIRI, per
          kasus.
        </p>
        <p className="mt-2 text-[12px] text-panel-muted">
          Menampilkan {halamanMenunggu.length} dari {menunggu.length}
        </p>

        {menunggu.length === 0 ? (
          <p className="mt-3 rounded-lg border border-panel-border bg-panel-surface p-4 text-[13px] italic text-panel-muted">
            Tidak ada sesi &gt;20 km yang menunggu tarif khusus.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {halamanMenunggu.map((s) => (
              <li key={s.id} className="rounded-lg border border-panel-border bg-panel-surface p-4">
                <p className="text-[13px] text-panel-ink">
                  <b>{s.namaKlien}</b> · {formatTanggalID(s.tanggal)}
                </p>
                <Link
                  href={`${BASIS}${bangunQuery(param, { ubah: `sesi-${s.id}` })}`}
                  className="mt-1 inline-block text-[12.5px] font-bold text-panel-ink underline"
                >
                  Tetapkan tarif khusus
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Paginasi basis={BASIS} param={param} total={menunggu.length} />
      </section>

      {jenjangDibuka !== null && (
        <PanelGeser judul={`Tarif ${LABEL_JENJANG[jenjangDibuka]}`} hrefTutup={hrefTutup}>
          <FormTarifTransport
            jenjang={jenjangDibuka}
            labelJenjang={LABEL_JENJANG[jenjangDibuka]}
            hariIni={hariIni}
            tarifSekarang={cariTarif(jenjangDibuka)?.tarifKlien ?? null}
            honorSekarang={cariTarif(jenjangDibuka)?.honorMitra ?? null}
          />
        </PanelGeser>
      )}

      {sesiDibuka !== null && (
        <PanelGeser judul={`Tarif khusus · ${sesiDibuka.namaKlien}`} hrefTutup={hrefTutup}>
          <FormTarifKhusus sessionId={sesiDibuka.id} namaKlien={sesiDibuka.namaKlien} />
        </PanelGeser>
      )}
    </main>
  );
}
```

3. Di `web/src/app/owner/transport/form-tarif-transport.tsx`: hapus `const [terbuka, setTerbuka] = useState(false);` dan blok `if (!terbuka) { … }` pada `FormTarifTransport` (`FormTarifKhusus` sudah tanpa toggle); hapus tombol "Batal" pada `FormTarifTransport`; sapu palet dengan pemetaan yang sama seperti Task 4 (`border-black/15`→`border-panel-border`, `bg-white`→`bg-panel-surface`, `text-ink-soft`→`text-panel-muted`, `bg-night`→`bg-panel-ink`, `text-gold-pale`→`text-panel-surface`, pembungkus `border-gold bg-[#FDFAF1]` dibuang karena isinya kini sudah berada di dalam panel geser). Kalimat peringatan `text-clay` tetap.

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/owner-transport.test.ts && npx tsc --noEmit && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/owner/transport/page.tsx web/src/app/owner/transport/form-tarif-transport.tsx web/tests/owner-transport.test.ts
git commit -m "feat(owner): formulir transport pindah ke panel geser, daftar sesi dipaginasi"
```

---

### Task 8: Pagar palet untuk seluruh `/owner`, dan sisa beranda owner

Tanpa pagar, "bersih hari ini" hanya berarti diperiksa dengan mata satu kali. Utang #4 runbook sapuan lahir persis begitu di `/admin` — enam berkas berpalet lama yang tidak ada satu pun uji menyebutnya.

**Files:**
- Modify: `web/src/app/owner/page.tsx:17`
- Modify: `web/tests/panel-primitif.test.ts` (tambah satu `it` di `describe("token visual panel")`)
- Test: `web/tests/panel-primitif.test.ts`

**Interfaces:**
- Consumes: `berkasSumber(rel)` dan `baca(rel)` yang sudah ada di berkas uji itu.
- Produces: pagar permanen — setiap berkas baru di bawah `src/app/owner` yang memakai token pra-panel akan MERAH.

- [ ] **Step 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/panel-primitif.test.ts`, di dalam `describe("token visual panel")`:

```ts
  it("tidak ada berkas di src/app/owner yang memakai palet PRA-PANEL", () => {
    // Utang #4 runbook sapuan lahir karena tidak ada satu pun uji yang
    // menyebut enam berkas /admin berpalet lama: bersihnya panel hari itu
    // adalah hasil pemeriksaan mata satu kali, bukan pagar. Panel owner
    // disapu tuntas di rencana 3B, dan pagar ini yang menjaganya tetap begitu.
    //
    // `leaf` dan `clay` SENGAJA tidak dilarang: keduanya aksen sah di era
    // panel (pill aktif/nonaktif, chip `menuntut`), dipakai juga oleh halaman
    // /admin yang sudah disapu. Yang dilarang adalah permukaan & tinta era
    // KLIEN — night, paper, gold-pale, putih telanjang, garis hitam beropasitas
    // — plus serif, yang sudah keluar dari panel staf.
    const TERLARANG: [RegExp, string][] = [
      [/\b(?:text|bg|border|hover:text|hover:bg|from|to)-(?:night|paper|gold-pale)\b/, "token era klien"],
      [/\bbg-white\b/, "putih telanjang — pakai bg-panel-surface"],
      [/\bborder-black\/\d/, "garis hitam beropasitas — pakai border-panel-border"],
      [/\bfont-serif\b/, "serif sudah keluar dari panel staf"],
    ];

    const berkas = berkasSumber("src/app/owner");
    // Anti-hampa: direktori yang dipindah atau salah tulis akan berhenti
    // dipindai diam-diam, dan ujinya lolos tanpa memeriksa apa pun.
    expect(berkas.length, "tidak ada berkas di src/app/owner").toBeGreaterThan(0);

    const galat: string[] = [];
    for (const b of berkas) {
      const isi = baca(b);
      for (const [pola, sebab] of TERLARANG) {
        const temuan = isi.match(new RegExp(pola, "g"));
        if (temuan) galat.push(`${b}: ${[...new Set(temuan)].join(", ")} — ${sebab}`);
      }
    }
    expect(galat, "palet pra-panel tersisa di panel owner").toEqual([]);
  });
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

```bash
cd web && npx vitest run tests/panel-primitif.test.ts
```
Diharapkan: FAIL dengan setidaknya `src/app/owner/page.tsx: hover:text-night`. Bila Task 3/4/6/7 sudah mendarat, hanya itu yang tersisa; bila ada temuan lain, perbaiki di Step 3 dan **catat berkasnya di pesan commit** — itu berarti sapuan sebelumnya melewatkan sesuatu.

- [ ] **Step 3: Implementasi minimal**

Di `web/src/app/owner/page.tsx` baris 17, ganti:

```tsx
  "text-[12px] font-bold text-leaf underline underline-offset-4 transition hover:text-panel-ink";
```

Perbaiki temuan lain yang muncul dengan pemetaan yang sama: `night`→`panel-ink`, `paper`→`panel-bg`, `gold-pale`→`panel-surface`, `bg-white`→`bg-panel-surface`, `border-black/1x`→`border-panel-border`, `font-serif` dibuang.

**Verifikasi sapuan wajib pakai grep TANPA `\b`** (Global Constraint 9):

```bash
cd web && grep -rn "text-night\|bg-night\|bg-paper\|text-gold-pale\|bg-white\|border-black/\|font-serif" src/app/owner/ || echo "bersih"
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

```bash
cd web && npx vitest run tests/panel-primitif.test.ts tests/pagar-cetakan.test.ts && npx tsc --noEmit && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/owner/page.tsx web/tests/panel-primitif.test.ts
git commit -m "test(panel): pagar palet pra-panel untuk seluruh src/app/owner"
```

---

### Task 9: E2E owner mengikuti rute baru, lalu DIJALANKAN

`tests/e2e/owner.e2e.ts` adalah satu-satunya hal yang membuktikan pagar crawl money-firewall sungguhan bekerja, bukan sekadar tertulis benar. Dua pemeriksaannya menargetkan formulir yang kini sudah pindah.

**Files:**
- Modify: `web/tests/e2e/owner.e2e.ts` (pemeriksaan 3 dan 8)
- Test: `npm run test:e2e:owner` (skrip ini AMAN — hanya Supabase lokal, membersihkan fixture-nya sendiri)

**Interfaces:**
- Consumes: rute `/owner/tarif/<variantId>` (Task 4); `idVarian`, `NAMA_LAYANAN`, `HARGA_*`, `HONOR_*` yang sudah ada di skrip.
- Produces: —

- [ ] **Step 1: Ubah pemeriksaan 3 — formulirnya kini di halaman detail**

Di blok `// ================= 3. Rate card: tarif baru = BARIS BARU =============`, ganti bagian pembacaan + pengisian formulir (jangan sentuh blok verifikasi basis data di bawahnya):

```ts
      const page = await buka(owner, "/owner/tarif");
      const sebelum = await teksTerlihat(page);
      const tampilLama =
        sebelum.includes(HARGA_LAMA.toLocaleString("id-ID")) &&
        sebelum.includes(HONOR_LAMA.toLocaleString("id-ID"));

      // DAFTAR → DETAIL. Sejak rencana 3B formulir tidak lagi hidup di dalam
      // sel tabel: barisnya menaut ke `/owner/tarif/<variantId>`, dan formulir
      // di sana sudah terbuka tanpa tombol pembuka. Mengklik tautannya (bukan
      // langsung `buka()` ke URL detail) sekaligus membuktikan tautan barisnya
      // memang ada dan menuju tempat yang benar.
      await page.getByRole("link", { name: new RegExp(NAMA_LAYANAN) }).first().click();
      await tungguIsi(page);
      await page.getByLabel(`Harga klien ${NAMA_LAYANAN}`).fill(String(HARGA_BARU));
      await page.getByLabel(`Honor mitra ${NAMA_LAYANAN}`).fill(String(HONOR_BARU));
      await page.getByLabel(`Tanggal berlaku tarif ${NAMA_LAYANAN}`).fill(HARI_INI);
      await page.getByRole("button", { name: "Simpan tarif" }).click();
      await tungguIsi(page);
      await page.waitForTimeout(600);
```

Catatan: label `aria-label` formulir memakai nama yang dioper prop `namaLayanan`. Di halaman detail prop itu diisi `nama` (label varian bila ada, jatuh ke nama layanan bila varian baku) — periksa fixture E2E-nya: bila varian ujinya BER-LABEL, `NAMA_LAYANAN` tidak akan cocok dan label yang benar adalah label variannya. **Ukur, jangan asumsikan**: jalankan skripnya dan baca pesan gagalnya sebelum menebak.

- [ ] **Step 2: Ubah pemeriksaan 8 — kontrol positif pindah ke halaman detail**

Sesudah rencana ini, daftar rate card hanya menampilkan tarif yang BERLAKU; `HARGA_LAMA`/`HONOR_LAMA` hanya hidup di riwayat, dan riwayat kini ada di halaman detail. Kontrol positif karena itu harus membuka detailnya — dan itu membuatnya lebih kuat, bukan lebih lemah: keempat nominal terbaca di satu halaman.

```ts
    let pemindaiBekerja = false;
    {
      // Keempat nominal (dua lama dari riwayat, dua baru dari tarif berlaku)
      // hidup di HALAMAN DETAIL varian sejak rencana 3B — daftar rate card
      // hanya menampilkan tarif yang berlaku hari ini.
      const page = await buka(owner, `/owner/tarif/${idVarian}`);
      const html = await page.content();
      await page.close();
      const temuan = [HARGA_LAMA, HONOR_LAMA, HARGA_BARU, HONOR_BARU]
        .map((n) => memuatNominal(html, n))
        .filter((t): t is string => t !== null);
      pemindaiBekerja = temuan.length === 4;
      catat(
        "8. KONTROL POSITIF: pemindai nominal MENEMUKAN keempat angka di /owner/tarif/<varian>",
        pemindaiBekerja,
        `ditemukan: ${JSON.stringify(temuan)}`,
      );
    }
```

- [ ] **Step 3: Jalankan skripnya sungguhan**

```bash
cd web && npm run build && npm run start &
# tunggu server siap di localhost:3000, lalu:
cd web && npm run test:e2e:owner
```
Diharapkan: **10/10 pemeriksaan lolos**. `npm run start` (bukan `npm run dev`) di atas build yang baru — itu prasyarat yang tertulis di runbook sapuan butir 7.

Bila salah satu merah, JANGAN melonggarkan assertion-nya. Baca pesan gagalnya, perbaiki halaman atau selektornya, jalankan ulang.

- [ ] **Step 4: Rekam hasilnya**

Salin sepuluh baris keluaran `catat()` apa adanya — keluaran itu masuk ke runbook di Task 10, bukan diringkas jadi "semua hijau".

- [ ] **Step 5: Commit**

```bash
git add web/tests/e2e/owner.e2e.ts
git commit -m "test(e2e): pemeriksaan rate card mengikuti rute /owner/tarif/[variantId]"
```

---

### Task 10: Verifikasi menyeluruh dan runbook penutup

Tugas ini TIDAK memperbaiki kode. Bila salah satu perintah merah, rencana berhenti di sini dan temuannya dilaporkan — bukan ditambal diam-diam di tugas verifikasi.

**Files:**
- Create: `docs/superpowers/2026-09-09-panel-owner-tindak-lanjut.md`
- Test: seluruh suite

**Interfaces:**
- Consumes: hasil Task 1–9.
- Produces: runbook penutup rencana 3B.

- [ ] **Step 1: Koordinasikan basis data, lalu jalankan suite penuh**

Supabase lokal dipakai bersama antar sesi kerja (Global Constraint 10). Konfirmasi ke pemilik repo sebelum menjalankan, lalu:

```bash
cd web && npm test 2>&1 | tail -30
```
Catat angka persisnya: berapa berkas, berapa uji, berapa merah.

- [ ] **Step 2: Build, tipe, lint**

```bash
cd web && npm run build && npx tsc --noEmit && npm run lint
```
Diharapkan: build sukses, `tsc` tanpa keluaran, lint 0 error.

- [ ] **Step 3: Buka keempat halaman di peramban sungguhan**

`renderToStaticMarkup` TIDAK punya batas server/klien — satu cacat "Functions cannot be passed directly to Client Components" pernah lolos 191 uji hijau, tiga review, dan `npm run build` sekaligus, dan hanya ketahuan saat halamannya dibuka. Rencana ini menambah satu rute baru dan memindahkan tiga formulir ke Client Component, jadi langkah ini WAJIB:

```bash
cd web && npm run start
```
Buka sebagai owner, dan pastikan tidak ada halaman yang crash:
- `/owner` (beranda)
- `/owner/rekap`, lalu `?honor=belum`, `?hal=2`, dan satu pencarian nama mitra
- `/owner/tarif`, lalu `?tarif=belum`, lalu klik satu baris ke detailnya
- `/owner/tarif/<variantId>` — tetapkan satu tarif sungguhan dan pastikan riwayat bertambah
- `/owner/transport`, lalu `?ubah=<jenjang>` dan `?ubah=sesi-<id>` (bila ada sesi menunggu)

- [ ] **Step 4: Tulis runbook**

Buat `docs/superpowers/2026-09-09-panel-owner-tindak-lanjut.md` mengikuti bentuk `docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md`, memuat:

1. **Tabel "apa yang berubah"** — satu baris per halaman, kolom Sebelum/Sesudah.
2. **Runbook "baca sebelum meneruskan"** — termasuk: tiga deviasi D1–D3 dan alasannya; kewajiban menjalankan `npm run test:e2e:owner` bagi siapa pun yang menambah rute `/owner`; dan pagar palet baru di `tests/panel-primitif.test.ts` beserta apa yang SENGAJA tidak dilarangnya (`leaf`, `clay`).
3. **Verifikasi menyeluruh** — angka persis dari Step 1–3, plus sepuluh baris keluaran E2E dari Task 9. Tulis apa adanya; jangan meringkas jadi "semua hijau".
4. **Tabel utang** — sekurangnya: paginasi JS di atas daftar yang sudah terbaca (`saringRateCard`, `saringRekap`, potongan daftar sesi transport) yang memperbaiki layar dan bukan batas bacaan; utang #5 (label `KelompokSaring`) yang kini menyentuh dua halaman owner juga; dan apa pun yang ditemukan implementer di sepanjang jalan.
5. **Cacat yang lahir dari teks rencana ini sendiri** — rencana sapuan melahirkan SEPULUH, semuanya ditangkap implementer/reviewer dan nol oleh penulisnya. Catat berapa yang lahir dari rencana ini, apa saja, dan siapa yang menangkapnya.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/2026-09-09-panel-owner-tindak-lanjut.md
git commit -m "docs(owner): runbook, verifikasi, dan utang penutup rencana 3B"
```

---

## Catatan penutup untuk pelaksana

- **Urutan mengikat:** Task 1 sebelum 2/5/7. Sesudah itu tiga jalur bisa berjalan terpisah — Tarif (2→3→4), Rekap (5→6), Transport (7) — tetapi Task 8 harus SESUDAH ketiganya (pagar palet akan merah selama satu halaman pun belum disapu), Task 9 sesudah Task 4 dan 7, Task 10 paling akhir.
- **Kerjakan di worktree terpisah.** `.worktrees/c2-pembayaran` sedang aktif untuk pekerjaan lain, dan Supabase lokal dipakai bersama. Gunakan `superpowers:using-git-worktrees` untuk membuat cabang `panel-owner`.
- **Setiap brief tugas wajib meminta `npm run lint`,** bukan hanya `tsc --noEmit` — empat galat lint pernah lolos satu gelombang penuh karena brief hanya meminta `tsc`.
- **Rencana ini bisa salah.** Sepuluh cacat lahir dari teks rencana sapuan, dan seluruhnya ditangkap implementer atau reviewer — nol oleh penulisnya. Bila sebuah langkah di atas bertentangan dengan kode yang sungguhan ada, **kodelah yang benar**: hentikan, laporkan, jangan paksakan teks rencana ini menjadi kenyataan.
