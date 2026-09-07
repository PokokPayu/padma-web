# Panel Staf — Fondasi Daftar & Dua Modul Percontohan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun bilah daftar, panel geser, dan paginasi sebagai primitif bersama, lalu membuktikan kedua pola lewat Mitra (panel geser) dan Klien (halaman detail).

**Architecture:** Seluruh keadaan daftar hidup di parameter URL. Pencarian dan saringan bekerja **tanpa satu baris JavaScript klien**: kotak cari adalah `<form method="get">`, chip saringan adalah `<Link>`. Hanya panel geser yang membutuhkan komponen klien, dan itu pun hanya untuk Escape dan klik overlay — isinya tetap dirender di server lalu dioper sebagai `children`, sehingga tidak ada fungsi yang menyeberangi batas server/klien dan isinya bisa diuji dengan `renderToStaticMarkup`.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase/PostgREST, Tailwind, Vitest (`environment: "node"`, tanpa jsdom).

**Spec:** `docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md`

## Global Constraints

- **Tanpa dependensi baru.** Tidak ada jsdom, testing-library, pustaka tabel, atau pustaka drawer. Mengikat sejak rencana panel pertama.
- **Primitif di `src/app/_shell/panel/**` WAJIB buta peran.** Pagarnya (`tests/panel-primitif.test.ts`, uji "BUTA PERAN") menuntut empat hal secara harfiah: tidak ada literal string `"admin"`/`"owner"` (regex `/"(admin|owner)"/i` — TANDA KUTIPNYA bagian dari pola, jadi kata di dalam komentar prosa tidak dilanggar), tidak ada `requireRole`, tidak ada `createAdminSupabase`, dan tidak ada `Rp <angka>` maupun `formatRupiah`. Tetap tulis komentar dengan "staf" alih-alih "admin" bila maksudnya siapa pun yang memakai panel — primitif ini dipakai panel admin DAN owner, jadi "staf" memang lebih tepat, bukan sekadar menghindari pagar.
- **Money firewall:** `/admin` tidak menampilkan satu nominal rupiah pun. Dijaga `tests/money-firewall-struktural.test.ts` yang memindai `information_schema` DAN teks sumber.
- **Berkas `"use server"` hanya boleh mengekspor fungsi async.** Konstanta dan validator sinkron tinggal di `status.ts` sebelahnya.
- **Fungsi tidak bisa dioper dari server component ke client component.** Oper string dan data biasa saja.
- **`params` dan `searchParams` di Next 16 adalah Promise.** Bentuk `searchParams`: `Promise<{ [key: string]: string | string[] | undefined }>` (`node_modules/next/dist/docs/01-app/`).
- **`npx tsc --noEmit` wajib bersih** sebelum tugas dianggap selesai — Vitest tidak memeriksa tipe. Ada SATU galat `LayoutProps` di `src/app/layout.tsx` yang sudah ada sebelum rencana ini; abaikan yang itu saja.
- Bahasa Indonesia untuk nama, komentar, dan pesan commit. Komentar menjelaskan KENAPA, bukan APA.

## Peta berkas

| Berkas | Tanggung jawab |
|---|---|
| `src/app/_shell/panel/daftar.ts` | **Baru.** Fungsi murni: menguraikan & membangun parameter URL, menghitung rentang paginasi. Tanpa React, tanpa I/O. |
| `src/app/_shell/panel/bilah-daftar.tsx` | **Baru.** Kotak cari (`<form method="get">`), chip saringan (`<Link>`), jumlah hasil, slot tombol "baru". |
| `src/app/_shell/panel/paginasi.tsx` | **Baru.** Tautan halaman sebelumnya/berikutnya + keterangan posisi. |
| `src/app/_shell/panel/panel-geser.tsx` | **Baru.** Komponen klien: overlay, Escape, fokus. Isinya diterima sebagai `children`. |
| `src/app/_shell/panel/bantuan.tsx` | **Baru.** Tombol "?" berisi penjelasan halaman (`<details>`, tanpa JS). |
| `src/lib/admin/mitra.ts` | **Diubah.** `ambilDaftarMitra()` menerima parameter cari/saring/halaman dan memulangkan total. |
| `src/app/admin/mitra/page.tsx` | **Diubah.** Bilah daftar + tabel + panel geser. Paragraf header pindah ke `Bantuan`. |
| `src/app/admin/mitra/form-mitra.tsx` | **Diubah.** Formulir tidak lagi mengatur buka/tutupnya sendiri; ia hanya formulir. |
| `src/lib/admin/klien.ts` | **Baru.** Query yang hari ini tertanam di `page.tsx`, dipindah supaya saringan & paginasinya bisa diuji. |
| `src/app/admin/klien/page.tsx` | **Diubah.** Bilah daftar + tabel yang barisnya menaut ke halaman detail. |

---

### Task 1: Fungsi murni parameter daftar

**Files:**
- Create: `web/src/app/_shell/panel/daftar.ts`
- Test: `web/tests/panel-daftar.test.ts`

**Interfaces:**
- Consumes: tidak ada.
- Produces:
  - `PER_HAL: 25`
  - `type ParamDaftar = { cari: string; saring: Readonly<Record<string, string>>; hal: number }`
  - `uraikanParamDaftar(sp, saringSah): ParamDaftar`
  - `hitungRentang(hal: number): { dari: number; sampai: number }`
  - `bangunQuery(param: ParamDaftar, ubahan: Record<string, string | number | null>): string`
  - `jumlahHalaman(total: number): number`

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/panel-daftar.test.ts
import { describe, it, expect } from "vitest";
import {
  PER_HAL, uraikanParamDaftar, hitungRentang, bangunQuery, jumlahHalaman,
} from "@/app/_shell/panel/daftar";

const SAH = { status: ["terjadwal", "selesai", "batal"] } as const;

describe("uraikanParamDaftar", () => {
  it("mengambil cari, saringan sah, dan halaman", () => {
    const p = uraikanParamDaftar({ cari: " ananda ", status: "selesai", hal: "3" }, SAH);
    expect(p).toEqual({ cari: "ananda", saring: { status: "selesai" }, hal: 3 });
  });

  it("MEMBUANG nilai saringan yang tidak ada di daftar sah", () => {
    // URL diketik manusia dan ditempel dari mana saja. Nilai asing yang lolos
    // ke `.eq()` bukan sekadar hasil kosong: ia hasil kosong yang TERLIHAT
    // seperti "memang tidak ada datanya".
    const p = uraikanParamDaftar({ status: "; drop table" }, SAH);
    expect(p.saring).toEqual({});
  });

  it("MEMBUANG nama saringan yang tidak dikenal", () => {
    const p = uraikanParamDaftar({ peran: "owner" }, SAH);
    expect(p.saring).toEqual({});
  });

  it("halaman jatuh ke 1 untuk nol, negatif, pecahan, dan bukan angka", () => {
    for (const hal of ["0", "-2", "1.5", "abc", ""]) {
      expect(uraikanParamDaftar({ hal }, SAH).hal).toBe(1);
    }
  });

  it("mengambil nilai PERTAMA bila parameter muncul berkali-kali", () => {
    // `?status=a&status=b` memberi array. Tanpa penanganan, `.eq()` menerima
    // array dan PostgREST menolaknya dengan galat yang tidak menyebut sebabnya.
    expect(uraikanParamDaftar({ status: ["selesai", "batal"] }, SAH).saring)
      .toEqual({ status: "selesai" });
  });

  it("cari yang hanya spasi dianggap kosong", () => {
    expect(uraikanParamDaftar({ cari: "   " }, SAH).cari).toBe("");
  });
});

describe("hitungRentang", () => {
  it("halaman 1 mulai dari 0", () => {
    expect(hitungRentang(1)).toEqual({ dari: 0, sampai: PER_HAL - 1 });
  });
  it("halaman 3 melompat dua halaman penuh", () => {
    expect(hitungRentang(3)).toEqual({ dari: 2 * PER_HAL, sampai: 3 * PER_HAL - 1 });
  });
});

describe("bangunQuery", () => {
  const param: ParamDaftar = { cari: "sri", saring: { status: "selesai" }, hal: 4 };

  it("mengubah satu saringan MENGEMBALIKAN halaman ke 1", () => {
    // Tanpa ini, menyaring dari halaman 4 mendarat di halaman 4 daftar baru —
    // yang hampir selalu kosong, dan terbaca sebagai "tidak ada datanya".
    expect(bangunQuery(param, { status: "batal" })).toBe("?cari=sri&status=batal");
  });

  it("berpindah halaman MEMPERTAHANKAN cari dan saringan", () => {
    expect(bangunQuery(param, { hal: 5 })).toBe("?cari=sri&status=selesai&hal=5");
  });

  it("nilai null MENGHAPUS parameternya", () => {
    expect(bangunQuery(param, { status: null })).toBe("?cari=sri");
  });

  it("halaman 1 tidak pernah muncul di URL", () => {
    expect(bangunQuery(param, { hal: 1 })).toBe("?cari=sri&status=selesai");
  });

  it("membuka panel geser MEMPERTAHANKAN halaman — `ubah` bukan saringan", () => {
    // Membuka baris di halaman 4 lalu menutupnya harus mengembalikan admin ke
    // halaman 4. Kalau `ubah` diperlakukan sebagai saringan, halamannya
    // di-reset ke 1 dan baris yang barusan diubah lenyap dari layar.
    expect(bangunQuery(param, { ubah: "abc" })).toBe("?cari=sri&status=selesai&hal=4&ubah=abc");
  });

  it("menutup panel geser MEMPERTAHANKAN halaman juga", () => {
    const terbuka: ParamDaftar = { cari: "sri", saring: {}, hal: 4 };
    expect(bangunQuery(terbuka, { ubah: null })).toBe("?cari=sri&hal=4");
  });

  it("memulangkan string kosong bila tidak ada parameter tersisa", () => {
    // Bukan "?" telanjang: href berakhiran "?" membuat Next memuat ulang rute
    // yang sama sebagai navigasi baru.
    expect(bangunQuery({ cari: "", saring: {}, hal: 1 }, {})).toBe("");
  });

  it("meng-encode spasi dan tanda baca pada kata cari", () => {
    expect(bangunQuery({ cari: "bidan sri&ratna", saring: {}, hal: 1 }, {}))
      .toBe("?cari=bidan+sri%26ratna");
  });
});

describe("jumlahHalaman", () => {
  it("nol baris tetap satu halaman", () => {
    expect(jumlahHalaman(0)).toBe(1);
  });
  it("tepat sepenuh halaman tidak melahirkan halaman kosong berikutnya", () => {
    expect(jumlahHalaman(PER_HAL)).toBe(1);
    expect(jumlahHalaman(PER_HAL + 1)).toBe(2);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/panel-daftar.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/_shell/panel/daftar"`

- [ ] **Step 3: Tulis implementasinya**

```ts
// web/src/app/_shell/panel/daftar.ts
/**
 * Keadaan sebuah daftar panel — pencarian, saringan, halaman — sebagai fungsi
 * MURNI atas parameter URL.
 *
 * Semuanya hidup di URL, bukan di state komponen, dan itu keputusan spec (K2):
 * halaman bisa dirender penuh di server, tombol kembali browser bekerja seperti
 * yang orang harapkan, dan StatTile beranda bisa menaut LANGSUNG ke daftar yang
 * sudah tersaring alih-alih hanya memberi angka.
 *
 * Berkas ini sengaja tanpa React dan tanpa I/O supaya bisa diuji sebagai
 * aritmatika biasa — dan supaya aturan "mengubah saringan mengembalikan
 * halaman ke 1" punya satu tempat tinggal, bukan diulang di tiap halaman.
 */

/** Baris per halaman. 25 memenuhi layar laptop tanpa menggulung panjang. */
export const PER_HAL = 25;

export type ParamDaftar = {
  cari: string;
  saring: Readonly<Record<string, string>>;
  hal: number;
};

/** Bentuk `searchParams` Next 16 sesudah di-`await`. */
export type ParamMentah = Record<string, string | string[] | undefined>;

/** Nama saringan → daftar nilai yang boleh diterima. */
export type SaringSah = Readonly<Record<string, readonly string[]>>;

/**
 * Parameter yang BUKAN saringan.
 *
 * Bedanya bukan kosmetik: hanya perubahan pada SARINGAN yang mengembalikan
 * halaman ke 1. `hal` jelas dikecualikan; `ubah` dikecualikan karena membuka
 * lalu menutup sebuah baris tidak boleh memindahkan admin dari halamannya.
 */
const BUKAN_SARINGAN = new Set(["cari", "hal", "ubah"]);

function nilaiTunggal(v: string | string[] | undefined): string {
  // `?status=a&status=b` memberi array. Diambil yang pertama, bukan
  // digabungkan: nilai gabungan tidak pernah cocok dengan daftar sah, jadi
  // saringannya diam-diam hilang alih-alih terbaca.
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export function uraikanParamDaftar(sp: ParamMentah, saringSah: SaringSah): ParamDaftar {
  const saring: Record<string, string> = {};
  for (const [nama, nilaiBoleh] of Object.entries(saringSah)) {
    const v = nilaiTunggal(sp[nama]).trim();
    // Daftar putih, bukan daftar hitam: nilai asing DIBUANG, tidak diteruskan
    // ke `.eq()`. Nilai asing yang lolos memulangkan nol baris, dan nol baris
    // tidak bisa dibedakan dari "memang belum ada datanya".
    if (v !== "" && nilaiBoleh.includes(v)) saring[nama] = v;
  }

  const halMentah = nilaiTunggal(sp.hal).trim();
  const hal = /^\d+$/.test(halMentah) ? Number(halMentah) : 1;

  return {
    cari: nilaiTunggal(sp.cari).trim(),
    saring,
    hal: hal >= 1 ? hal : 1,
  };
}

/** Rentang `.range()` PostgREST untuk sebuah halaman — keduanya inklusif. */
export function hitungRentang(hal: number): { dari: number; sampai: number } {
  const dari = (hal - 1) * PER_HAL;
  return { dari, sampai: dari + PER_HAL - 1 };
}

export function jumlahHalaman(total: number): number {
  // Minimal 1: daftar kosong tetap "halaman 1 dari 1", bukan "1 dari 0".
  return Math.max(1, Math.ceil(total / PER_HAL));
}

/**
 * Membangun query string baru dari keadaan sekarang plus perubahan.
 *
 * `null` menghapus sebuah parameter. Halaman 1 dan nilai kosong tidak pernah
 * ditulis — URL terpendek yang mungkin, supaya yang tampil di bilah alamat
 * hanya hal yang benar-benar menyimpang dari bawaan.
 */
export function bangunQuery(
  param: ParamDaftar,
  ubahan: Record<string, string | number | null>,
): string {
  const q = new URLSearchParams();

  const cari = "cari" in ubahan ? ubahan.cari : param.cari;
  if (cari !== null && String(cari) !== "") q.set("cari", String(cari));

  const namaSaring = new Set([...Object.keys(param.saring), ...Object.keys(ubahan)]);
  for (const kunci of BUKAN_SARINGAN) namaSaring.delete(kunci);
  for (const nama of namaSaring) {
    const nilai = nama in ubahan ? ubahan[nama] : param.saring[nama];
    if (nilai !== null && nilai !== undefined && String(nilai) !== "") {
      q.set(nama, String(nilai));
    }
  }

  // MENGUBAH SARINGAN MENGEMBALIKAN HALAMAN KE 1, dan itu bukan kenyamanan:
  // menyaring dari halaman 4 mendarat di halaman 4 daftar BARU, yang hampir
  // selalu kosong — dan kosong terbaca sebagai "tidak ada datanya", bukan
  // sebagai "Anda sedang di halaman yang terlalu jauh".
  //
  // `hal` dan `ubah` dikecualikan dari aturan itu: keduanya bukan saringan.
  // Membuka sebuah baris di halaman 4 lalu menutupnya harus mengembalikan
  // admin ke halaman 4 — kalau `ubah` ikut me-reset halaman, baris yang
  // barusan diubah justru lenyap dari layar begitu panelnya ditutup.
  const menyentuhSaringan = Object.keys(ubahan).some((k) => !BUKAN_SARINGAN.has(k));
  const halDiminta = "hal" in ubahan ? Number(ubahan.hal ?? 1) : param.hal;
  const hal = menyentuhSaringan ? 1 : halDiminta;
  if (hal > 1) q.set("hal", String(hal));

  // `ubah` ditulis PALING AKHIR supaya urutan parameternya stabil, dan
  // uji href bisa mencocokkan string utuh alih-alih memeriksa potongan.
  const ubah = "ubah" in ubahan ? ubahan.ubah : null;
  if (ubah !== null && ubah !== undefined && String(ubah) !== "") {
    q.set("ubah", String(ubah));
  }

  const s = q.toString();
  // String kosong, BUKAN "?" telanjang: href berakhiran "?" dianggap Next
  // sebagai rute berbeda dan memicu navigasi ulang tanpa perubahan apa pun.
  return s === "" ? "" : `?${s}`;
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/panel-daftar.test.ts`
Expected: PASS (17 uji)

- [ ] **Step 5: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/app/_shell/panel/daftar.ts web/tests/panel-daftar.test.ts
git commit -m "feat(panel): keadaan daftar sebagai fungsi murni atas parameter URL"
```

---

### Task 2: Primitif bilah daftar

**Files:**
- Create: `web/src/app/_shell/panel/bilah-daftar.tsx`
- Test: `web/tests/panel-bilah-daftar.test.tsx`

**Interfaces:**
- Consumes: `ParamDaftar`, `bangunQuery` dari `daftar.ts`.
- Produces: `<BilahDaftar basis param kelompok jumlah total aksi />` dan `type KelompokSaring = { nama: string; label: string; pilihan: readonly { nilai: string; label: string; menuntut?: boolean }[] }`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
// web/tests/panel-bilah-daftar.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BilahDaftar, type KelompokSaring } from "@/app/_shell/panel/bilah-daftar";
import type { ParamDaftar } from "@/app/_shell/panel/daftar";

const KELOMPOK: KelompokSaring[] = [
  {
    nama: "status",
    label: "Status",
    pilihan: [
      { nilai: "terjadwal", label: "Terjadwal" },
      { nilai: "selesai", label: "Selesai" },
    ],
  },
];

const KOSONG: ParamDaftar = { cari: "", saring: {}, hal: 1 };

function render(param: ParamDaftar, total = 40, jumlah = 25) {
  return renderToStaticMarkup(
    <BilahDaftar
      basis="/admin/sesi"
      param={param}
      kelompok={KELOMPOK}
      jumlah={jumlah}
      total={total}
      aksi={<a href="/admin/sesi?ubah=baru">+ Sesi baru</a>}
    />,
  );
}

describe("BilahDaftar", () => {
  it("kotak cari adalah FORM GET — bekerja tanpa JavaScript sama sekali", () => {
    // Ini bukan preferensi gaya. Suite ini berjalan tanpa jsdom, jadi apa pun
    // yang hanya hidup lewat onChange TIDAK BISA DIUJI di sini sama sekali.
    const m = render(KOSONG);
    expect(m).toContain('method="get"');
    expect(m).toContain('action="/admin/sesi"');
    expect(m).toContain('name="cari"');
  });

  it("membawa saringan aktif sebagai input tersembunyi supaya tidak hilang saat mencari", () => {
    const m = render({ cari: "", saring: { status: "selesai" }, hal: 1 });
    expect(m).toContain('type="hidden"');
    expect(m).toContain('name="status"');
    expect(m).toContain('value="selesai"');
  });

  it("TIDAK membawa halaman ke dalam form cari", () => {
    // Mencari dari halaman 3 harus mendarat di halaman 1 hasil baru.
    const m = render({ cari: "", saring: {}, hal: 3 });
    expect(m).not.toContain('name="hal"');
  });

  it("chip saringan menaut ke query yang benar, dan chip aktif menaut untuk MEMATIKANNYA", () => {
    const m = render({ cari: "", saring: { status: "selesai" }, hal: 1 });
    expect(m).toContain('href="/admin/sesi?status=terjadwal"');
    // "Selesai" sedang menyala, jadi tautannya melepasnya — bukan memasangnya lagi.
    expect(m).toContain('href="/admin/sesi"');
  });

  it("menyebut jumlah yang tampil DAN total, bukan salah satunya saja", () => {
    // "40 mitra" pada halaman berisi 25 baris membuat admin mengira ada yang hilang.
    expect(render(KOSONG, 40, 25)).toContain("25 dari 40");
  });

  it("merender slot aksi apa adanya", () => {
    expect(render(KOSONG)).toContain("+ Sesi baru");
  });

  it("menandai chip menuntut secara berbeda", () => {
    const kelompok: KelompokSaring[] = [{
      nama: "jenjang", label: "Jenjang",
      pilihan: [{ nilai: "kosong", label: "Tanpa jenjang", menuntut: true }],
    }];
    const m = renderToStaticMarkup(
      <BilahDaftar basis="/admin/sesi" param={KOSONG} kelompok={kelompok}
        jumlah={0} total={0} aksi={null} />,
    );
    expect(m).toContain("text-clay");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/panel-bilah-daftar.test.tsx`
Expected: FAIL — modul belum ada

- [ ] **Step 3: Tulis implementasinya**

```tsx
// web/src/app/_shell/panel/bilah-daftar.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { bangunQuery, type ParamDaftar } from "./daftar";

export type PilihanSaring = {
  nilai: string;
  label: string;
  /** Mewarnai chip clay — untuk saringan yang menunjuk PEKERJAAN, bukan kabar. */
  menuntut?: boolean;
};

export type KelompokSaring = {
  nama: string;
  label: string;
  pilihan: readonly PilihanSaring[];
};

/**
 * Bilah di atas setiap daftar panel: cari, saring, jumlah, tombol baru.
 *
 * Tidak ada satu baris JavaScript klien di sini, dan itu disengaja. Kotak cari
 * adalah `<form method="get">` biasa; chip saringan adalah `<Link>` biasa.
 * Akibatnya bilah ini bekerja sebelum hidrasi selesai, dan — yang menentukan
 * bagi proyek ini — SELURUH perilakunya bisa diuji dengan
 * `renderToStaticMarkup`, satu-satunya perkakas render yang dimiliki suite
 * yang berjalan tanpa jsdom.
 */
export function BilahDaftar({
  basis,
  param,
  kelompok,
  jumlah,
  total,
  aksi,
}: {
  /** Path halaman tanpa query, mis. "/admin/mitra". */
  basis: string;
  param: ParamDaftar;
  kelompok: readonly KelompokSaring[];
  /** Baris yang tampil di halaman ini. */
  jumlah: number;
  /** Baris yang cocok dengan saringan, seluruh halaman. */
  total: number;
  aksi: ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Saringan aktif dibawa sebagai input tersembunyi: tanpa ini, mencari
            sesuatu akan diam-diam melepas saringan yang sedang menyala, dan
            hasilnya terbaca sebagai "pencariannya salah". `hal` sengaja TIDAK
            dibawa — pencarian baru selalu mulai dari halaman pertama. */}
        <form method="get" action={basis} className="flex min-w-[12rem] flex-1 items-center">
          {Object.entries(param.saring).map(([nama, nilai]) => (
            <input key={nama} type="hidden" name={nama} value={nilai} />
          ))}
          <input
            type="search"
            name="cari"
            defaultValue={param.cari}
            placeholder="Cari…"
            aria-label="Cari di daftar ini"
            className="h-9 w-full rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px] text-panel-ink"
          />
        </form>

        {kelompok.map((k) =>
          k.pilihan.map((p) => {
            const menyala = param.saring[k.nama] === p.nilai;
            // Chip yang menyala menaut untuk MELEPAS dirinya. Chip yang hanya
            // bisa dipasang adalah saringan yang tidak bisa dibatalkan tanpa
            // mengetik ulang URL.
            const href = `${basis}${bangunQuery(param, { [k.nama]: menyala ? null : p.nilai })}`;
            return (
              <Link
                key={`${k.nama}:${p.nilai}`}
                href={href}
                aria-pressed={menyala}
                className={`rounded-full border px-3 py-1.5 text-[12px] font-bold ${
                  menyala
                    ? "border-panel-ink bg-panel-ink text-panel-surface"
                    : `border-panel-border bg-panel-surface ${p.menuntut ? "text-clay" : "text-panel-muted"}`
                }`}
              >
                {p.label}
              </Link>
            );
          }),
        )}

        <span className="ml-auto">{aksi}</span>
      </div>

      {/* Dua angka, selalu. "40 mitra" pada halaman berisi 25 baris membuat
          admin mengira ada yang hilang; "25 dari 40" tidak pernah begitu. */}
      <p className="mt-2 text-[12px] text-panel-muted">
        Menampilkan {jumlah} dari {total}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/panel-bilah-daftar.test.tsx`
Expected: PASS (7 uji)

- [ ] **Step 5: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/app/_shell/panel/bilah-daftar.tsx web/tests/panel-bilah-daftar.test.tsx
git commit -m "feat(panel): bilah daftar tanpa JavaScript klien"
```

---

### Task 3: Primitif paginasi

**Files:**
- Create: `web/src/app/_shell/panel/paginasi.tsx`
- Test: `web/tests/panel-paginasi.test.tsx`

**Interfaces:**
- Consumes: `bangunQuery`, `jumlahHalaman`, `ParamDaftar`.
- Produces: `<Paginasi basis param total />`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
// web/tests/panel-paginasi.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PER_HAL, type ParamDaftar } from "@/app/_shell/panel/daftar";

const p = (hal: number): ParamDaftar => ({ cari: "sri", saring: { aktif: "ya" }, hal });

const render = (hal: number, total: number) =>
  renderToStaticMarkup(<Paginasi basis="/admin/mitra" param={p(hal)} total={total} />);

describe("Paginasi", () => {
  it("TIDAK dirender sama sekali bila semuanya muat satu halaman", () => {
    // Bilah paginasi berisi "1 dari 1" adalah perabot yang tidak menjawab apa pun.
    expect(render(1, PER_HAL)).toBe("");
  });

  it("menyembunyikan Sebelumnya di halaman pertama dan Berikutnya di halaman terakhir", () => {
    const awal = render(1, PER_HAL * 3);
    expect(awal).not.toContain("Sebelumnya");
    expect(awal).toContain("Berikutnya");

    const akhir = render(3, PER_HAL * 3);
    expect(akhir).toContain("Sebelumnya");
    expect(akhir).not.toContain("Berikutnya");
  });

  it("tautannya MEMPERTAHANKAN cari dan saringan", () => {
    // Paginasi yang melupakan saringan mengembalikan admin ke daftar penuh
    // pada klik pertama — dan tidak ada yang memberitahunya.
    const m = render(2, PER_HAL * 3);
    expect(m).toContain("cari=sri");
    expect(m).toContain("aktif=ya");
    expect(m).toContain("hal=3");
  });

  it("menyebut posisi halaman", () => {
    expect(render(2, PER_HAL * 3)).toContain("Halaman 2 dari 3");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/panel-paginasi.test.tsx`
Expected: FAIL — modul belum ada

- [ ] **Step 3: Tulis implementasinya**

```tsx
// web/src/app/_shell/panel/paginasi.tsx
import Link from "next/link";
import { bangunQuery, jumlahHalaman, type ParamDaftar } from "./daftar";

/**
 * Sebelumnya / Berikutnya, bukan deretan nomor halaman.
 *
 * Nomor halaman berguna ketika orang mengingat "data itu ada di halaman 7".
 * Di panel ini urutan daftar berubah setiap hari, jadi yang diingat orang
 * adalah NAMANYA — dan untuk itu pencarian lebih cepat daripada nomor mana pun.
 */
export function Paginasi({
  basis,
  param,
  total,
}: {
  basis: string;
  param: ParamDaftar;
  total: number;
}) {
  const halaman = jumlahHalaman(total);
  if (halaman <= 1) return null;

  const hal = Math.min(param.hal, halaman);

  return (
    <nav aria-label="Navigasi halaman" className="mt-4 flex items-center gap-3">
      {hal > 1 && (
        <Link
          href={`${basis}${bangunQuery(param, { hal: hal - 1 })}`}
          className="rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-ink"
        >
          ‹ Sebelumnya
        </Link>
      )}
      <span className="text-[12px] text-panel-muted">
        Halaman {hal} dari {halaman}
      </span>
      {hal < halaman && (
        <Link
          href={`${basis}${bangunQuery(param, { hal: hal + 1 })}`}
          className="rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-ink"
        >
          Berikutnya ›
        </Link>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/panel-paginasi.test.tsx`
Expected: PASS (4 uji)

- [ ] **Step 5: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/app/_shell/panel/paginasi.tsx web/tests/panel-paginasi.test.tsx
git commit -m "feat(panel): paginasi yang mempertahankan cari & saringan"
```

---

### Task 4: Primitif panel geser

**Files:**
- Create: `web/src/app/_shell/panel/panel-geser.tsx`
- Test: `web/tests/panel-geser.test.tsx`

**Interfaces:**
- Consumes: `pasangPenutup(dok, tutup)` dari `./tutup-drawer`.
- Produces: `<PanelGeser judul hrefTutup>{children}</PanelGeser>`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
// web/tests/panel-geser.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const rute = vi.hoisted(() => ({ didorong: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (h: string) => rute.didorong.push(h) }),
}));

const { PanelGeser } = await import("@/app/_shell/panel/panel-geser");

describe("PanelGeser", () => {
  it("merender ISI yang dioper dari server", () => {
    // Inilah alasan panel ini menerima `children` alih-alih mengambil datanya
    // sendiri: isinya dirender di server, jadi ia bisa diuji di sini.
    const m = renderToStaticMarkup(
      <PanelGeser judul="Ubah mitra" hrefTutup="/admin/mitra">
        <p>Bidan Ratna</p>
      </PanelGeser>,
    );
    expect(m).toContain("Bidan Ratna");
    expect(m).toContain("Ubah mitra");
  });

  it("punya jalan keluar yang bisa DIKLIK, bukan hanya Escape", () => {
    const m = renderToStaticMarkup(
      <PanelGeser judul="Ubah" hrefTutup="/admin/mitra?hal=2"><i /></PanelGeser>,
    );
    // Tautan tutup memakai href, bukan onClick: pemakai bisa membukanya di tab
    // baru, dan ia tetap bekerja bila JavaScript gagal dimuat.
    expect(m).toContain('href="/admin/mitra?hal=2"');
  });

  it("mengumumkan dirinya sebagai dialog bernama", () => {
    // Tanpa role & label, pembaca layar membacakannya sebagai tumpukan teks
    // biasa di ujung halaman, tanpa kabar bahwa sesuatu terbuka.
    const m = renderToStaticMarkup(
      <PanelGeser judul="Ubah mitra" hrefTutup="/x"><i /></PanelGeser>,
    );
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
    expect(m).toContain('aria-label="Ubah mitra"');
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/panel-geser.test.tsx`
Expected: FAIL — modul belum ada

- [ ] **Step 3: Tulis implementasinya**

```tsx
// web/src/app/_shell/panel/panel-geser.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { pasangPenutup } from "./tutup-drawer";

/**
 * Panel geser dari kanan untuk mengubah SATU baris.
 *
 * Komponen ini klien, tetapi ISINYA tidak: `children` dirender di server dan
 * dioper masuk sudah jadi. Itu yang membuat formulir di dalamnya bisa diuji
 * dengan `renderToStaticMarkup` — suite proyek ini berjalan tanpa jsdom, jadi
 * apa pun yang hanya lahir setelah hidrasi tidak bisa diuji sama sekali.
 *
 * Yang benar-benar butuh klien hanya dua: tombol Escape, dan klik pada
 * overlay. Keduanya jalan keluar; keduanya tidak punya padanan server.
 *
 * Terbuka/tertutupnya ditentukan URL (`?ubah=<id>`), bukan state. Karena itu
 * tombol kembali browser menutup panel seperti yang orang harapkan, dan sebuah
 * baris yang sedang diubah bisa dikirim sebagai tautan.
 */
export function PanelGeser({
  judul,
  hrefTutup,
  children,
}: {
  judul: string;
  /** Alamat halaman TANPA `?ubah` — ke sinilah Escape dan overlay menuju. */
  hrefTutup: string;
  children: ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    // `pasangPenutup` lahir di rencana panel pertama untuk drawer navigasi,
    // lengkap dengan tipe dokumen minimal supaya bisa diuji dengan dokumen
    // palsu. Dipakai ulang di sini, bukan ditulis kedua kalinya.
    return pasangPenutup(document, () => router.push(hrefTutup));
  }, [router, hrefTutup]);

  return (
    <>
      <Link
        href={hrefTutup}
        aria-label="Tutup panel"
        className="fixed inset-0 z-40 bg-black/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={judul}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-panel-border bg-panel-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-panel-border px-4 py-3">
          <h2 className="text-[13px] font-bold text-panel-ink">{judul}</h2>
          <Link href={hrefTutup} className="text-[13px] font-bold text-panel-muted">
            Tutup
          </Link>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </>
  );
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/panel-geser.test.tsx`
Expected: PASS (3 uji)

- [ ] **Step 5: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/app/_shell/panel/panel-geser.tsx web/tests/panel-geser.test.tsx
git commit -m "feat(panel): panel geser yang isinya dirender di server"
```

---

### Task 5: Tombol bantuan & penutupan utang uji primitif

**Files:**
- Create: `web/src/app/_shell/panel/bantuan.tsx`
- Modify: `web/tests/panel-primitif.test.ts`
- Test: `web/tests/panel-bantuan.test.tsx`

**Interfaces:**
- Produces: `<Bantuan judul>{children}</Bantuan>`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
// web/tests/panel-bantuan.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Bantuan } from "@/app/_shell/panel/bantuan";

describe("Bantuan", () => {
  it("penjelasannya ADA di markup meski tersembunyi — bukan dibuang", () => {
    // Spec K5: teksnya dipertahankan apa adanya, sebagian memuat pembedaan
    // yang pernah hilang dan mahal. Yang berubah cuma ia tidak lagi memakan
    // ruang setiap hari.
    const m = renderToStaticMarkup(
      <Bantuan judul="Tentang halaman Mitra">Mitra adalah data, bukan pengguna aplikasi.</Bantuan>,
    );
    expect(m).toContain("Mitra adalah data, bukan pengguna aplikasi.");
  });

  it("memakai <details> — terbuka tanpa JavaScript", () => {
    const m = renderToStaticMarkup(<Bantuan judul="X">isi</Bantuan>);
    expect(m).toContain("<details");
    expect(m).toContain("<summary");
  });

  it("mulai TERTUTUP", () => {
    // Kalau ia mulai terbuka, tidak ada satu pun masalah yang terpecahkan.
    expect(renderToStaticMarkup(<Bantuan judul="X">isi</Bantuan>)).not.toContain("open");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/panel-bantuan.test.tsx`
Expected: FAIL — modul belum ada

- [ ] **Step 3: Tulis implementasinya**

```tsx
// web/src/app/_shell/panel/bantuan.tsx
import type { ReactNode } from "react";

/**
 * Penjelasan halaman yang bisa dibuka saat dibutuhkan.
 *
 * Sebelumnya tiap halaman panel membuka diri dengan paragraf empat baris.
 * Berguna di hari pertama, kebisingan di hari ketiga puluh — dan panel ini
 * dibuka setiap hari.
 *
 * Teksnya TIDAK dibuang, hanya dilipat: sebagian memuat pembedaan yang pernah
 * hilang dan mahal (mis. "nonaktif" tidak berarti nama mitra lenyap dari
 * riwayat klien). `<details>` dipilih karena ia melipat tanpa JavaScript sama
 * sekali, dan isinya tetap terbaca pencarian halaman browser.
 */
export function Bantuan({ judul, children }: { judul: string; children: ReactNode }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">
        {judul}
      </summary>
      <div className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-panel-muted">
        {children}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Tutup utang uji hampa di `panel-primitif.test.ts`**

Cari fungsi `berkasPanel()` (sekitar baris 36) dan sisipkan penjagaan ini ke dalam blok `it` yang memakainya (sekitar baris 464), sebagai baris PERTAMA di dalam `it`:

```ts
    // Tanpa ini, seluruh badan test lolos hampa bila direktori primitif
    // dipindah atau namanya berubah: `for (const berkas of [])` tidak pernah
    // menjalankan satu asersi pun, dan hijaunya terbaca seperti bukti.
    expect(berkasPanel().length).toBeGreaterThan(0);
```

- [ ] **Step 5: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/panel-bantuan.test.tsx tests/panel-primitif.test.ts`
Expected: PASS

- [ ] **Step 6: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/app/_shell/panel/bantuan.tsx web/tests/panel-bantuan.test.tsx web/tests/panel-primitif.test.ts
git commit -m "feat(panel): penjelasan halaman dilipat ke tombol bantuan"
```

---

### Task 6: Lapisan data Mitra menerima cari, saring, halaman

**Files:**
- Modify: `web/src/lib/admin/mitra.ts`
- Test: `web/tests/admin-mitra.test.ts` (tambahkan describe baru; berkasnya sudah ada)

**Interfaces:**
- Consumes: `PER_HAL`, `hitungRentang`, `ParamDaftar` dari `@/app/_shell/panel/daftar`.
- Produces: `ambilDaftarMitra(param: ParamDaftar): Promise<{ baris: BarisMitra[]; total: number }>` — **bentuk kembaliannya BERUBAH** dari array menjadi objek.
- `SARING_MITRA: SaringSah = { aktif: ["ya", "tidak"] }` diekspor dari `lib/admin/mitra.ts` supaya halaman dan uji memakai daftar sah yang sama.

- [ ] **Step 1: Tulis uji yang gagal**

**Fixture WAJIB — seed hanya punya DUA mitra, keduanya aktif.** Tanpa fixture di bawah, uji
"menyaring nonaktif" gagal karena tidak ada satu pun mitra nonaktif, dan uji paginasi LULUS
HAMPA: dengan 2 baris, halaman 2 selalu kosong, sehingga `b.baris.some(...)` memulangkan
`false` tanpa membuktikan apa pun.

```ts
// tambahkan ke web/tests/admin-mitra.test.ts
const UJI_AKTIF = Array.from({ length: 25 }, (_, i) =>
  `33333333-3333-3333-3333-3333330000${String(i).padStart(2, "0")}`);
const UJI_NONAKTIF = "33333333-3333-3333-3333-333333000099";
const UJI_SEMUA = [...UJI_AKTIF, UJI_NONAKTIF];

// Awalan "ZZ" menaruhnya di URUTAN TERAKHIR menurut nama, sehingga dua mitra
// seed tetap di halaman 1 dan uji lain yang mengandalkan mereka tidak bergeser.
beforeAll(async () => {
  await admin.from("partners").delete().in("id", UJI_SEMUA);
  await admin.from("partners").insert([
    ...UJI_AKTIF.map((id, i) => ({
      id, nama: `ZZUji Mitra ${String(i).padStart(2, "0")}`, no_hp: "", aktif: true,
    })),
    { id: UJI_NONAKTIF, nama: "ZZUji Mitra Nonaktif", no_hp: "", aktif: false },
  ]);
});

// Mitra fixture sengaja TANPA sesi, jadi menghapusnya tidak pernah memutus
// `sessions.partner_id` milik baris lain.
afterAll(async () => {
  await admin.from("partners").delete().in("id", UJI_SEMUA);
});

describe("daftar mitra — cari, saring, halaman", () => {
  it("menyaring menurut ketersediaan", async () => {
    const { baris } = await ambilDaftarMitra({ cari: "", saring: { aktif: "tidak" }, hal: 1 });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((m) => !m.aktif)).toBe(true);
  });

  it("mencari menurut nama, tidak peduli besar kecil huruf", async () => {
    const { baris } = await ambilDaftarMitra({ cari: "sri", saring: {}, hal: 1 });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((m) => m.nama.toLowerCase().includes("sri"))).toBe(true);
  });

  it("total menghitung SELURUH baris yang cocok, bukan hanya yang tampil", async () => {
    // Ini yang membuat "25 dari 40" mungkin. Total yang ikut terpotong halaman
    // membuat paginasi berhenti di halaman 2 selamanya.
    const { baris, total } = await ambilDaftarMitra({ cari: "", saring: {}, hal: 1 });
    expect(total).toBeGreaterThanOrEqual(baris.length);
  });

  it("halaman kedua BERISI, dan TIDAK mengulang baris halaman pertama", async () => {
    const a = await ambilDaftarMitra({ cari: "", saring: {}, hal: 1 });
    const b = await ambilDaftarMitra({ cari: "", saring: {}, hal: 2 });
    // Halaman 2 HARUS berisi. Tanpa asersi ini, seluruh uji lulus hampa pada
    // basis data yang isinya kurang dari satu halaman: `[].some(...)` selalu
    // `false`, dan hijaunya terbaca seperti bukti.
    expect(b.baris.length).toBeGreaterThan(0);
    expect(a.baris.length).toBe(PER_HAL);
    const idA = new Set(a.baris.map((m) => m.id));
    expect(b.baris.some((m) => idA.has(m.id))).toBe(false);
  });

  it("jumlah sesi selesai TETAP benar saat daftarnya dipaginasi", async () => {
    // Jebakannya: query sesi dulu menarik SEMUA sesi lalu menghitungnya di JS.
    // Bila paginasi diterapkan pada query mitra saja, angka kinerja tetap
    // benar — tetapi bila seseorang kelak ikut memaginasi query sesi, angka
    // itu mengecil diam-diam tanpa satu pun uji merah. Uji ini yang merah.
    const { baris } = await ambilDaftarMitra({ cari: "sri", saring: {}, hal: 1 });
    const target = baris[0];
    const { count } = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("partner_id", target.id)
      .eq("status", "selesai");
    expect(target.sesiSelesai).toBe(count);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/admin-mitra.test.ts`
Expected: FAIL — `ambilDaftarMitra` belum menerima argumen dan memulangkan array

- [ ] **Step 3: Ubah implementasinya**

Ganti `ambilDaftarMitra` di `web/src/lib/admin/mitra.ts` dengan ini (komentar besar di kepala berkas soal tiga kebutuhan berlawanan **dipertahankan apa adanya**):

```ts
import { hitungRentang, type ParamDaftar } from "@/app/_shell/panel/daftar";

/** Nilai saringan yang sah untuk daftar mitra — dipakai halaman DAN uji. */
export const SARING_MITRA = { aktif: ["ya", "tidak"] } as const;

/**
 * Satu halaman daftar kelola mitra, beserta TOTAL baris yang cocok.
 *
 * Total dihitung lewat `count: "exact"` pada query yang sama, bukan dengan
 * menarik seluruh baris lalu mengukur panjangnya — menarik seluruh baris
 * adalah persis hal yang paginasi ini datang untuk hentikan.
 */
export async function ambilDaftarMitra(
  param: ParamDaftar,
): Promise<{ baris: BarisMitra[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("partners")
    .select("id, nama, no_hp, alamat, aktif", { count: "exact" })
    .order("aktif", { ascending: false })
    .order("nama");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");

  // `ilike` dengan `%` di kedua sisi: admin mengetik penggalan nama yang
  // diingatnya, bukan awalannya. Kata cari di-escape supaya `%` dan `_` yang
  // diketik manusia dicari sebagai huruf, bukan sebagai wildcard.
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("nama", `%${aman}%`);
  }

  const [{ data: mitra, count }, { data: sesi }] = await Promise.all([
    q.range(dari, sampai).returns<BarisPartner[]>(),
    // Query sesi TIDAK ikut dipaginasi dan TIDAK ikut disaring: ia menghitung
    // kinerja seluruh mitra, dan memotongnya akan mengecilkan angka kinerja
    // secara senyap.
    supabase
      .from("sessions")
      .select("partner_id")
      .eq("status", "selesai")
      .returns<{ partner_id: string }[]>(),
  ]);

  const selesaiPer = new Map<string, number>();
  for (const s of sesi ?? []) {
    selesaiPer.set(s.partner_id, (selesaiPer.get(s.partner_id) ?? 0) + 1);
  }

  return {
    baris: (mitra ?? []).map((m) => ({
      id: m.id,
      nama: m.nama,
      noHp: m.no_hp,
      alamat: m.alamat,
      aktif: m.aktif,
      sesiSelesai: selesaiPer.get(m.id) ?? 0,
    })),
    total: count ?? 0,
  };
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/admin-mitra.test.ts`
Expected: PASS

- [ ] **Step 5: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/lib/admin/mitra.ts web/tests/admin-mitra.test.ts
git commit -m "feat(mitra): daftar menerima cari, saringan, dan halaman"
```

---

### Task 7: Halaman Mitra memakai bilah daftar & panel geser

**Files:**
- Modify: `web/src/app/admin/mitra/page.tsx`
- Modify: `web/src/app/admin/mitra/form-mitra.tsx`
- Test: `web/tests/admin-mitra-halaman.test.tsx` (baru)

**Interfaces:**
- Consumes: `BilahDaftar`, `Paginasi`, `PanelGeser`, `Bantuan`, `uraikanParamDaftar`, `SARING_MITRA`, `ambilDaftarMitra`.
- Produces: rute `/admin/mitra?ubah=<id>` dan `/admin/mitra?ubah=baru`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
// web/tests/admin-mitra-halaman.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => "admin" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const { default: HalamanMitra } = await import("@/app/admin/mitra/page");

const render = async (sp: Record<string, string>) =>
  renderToStaticMarkup(await HalamanMitra({ searchParams: Promise.resolve(sp) }));

describe("halaman /admin/mitra", () => {
  it("TIDAK ada formulir di dalam sel tabel lagi", async () => {
    // Inti keluhan klien. Formulir di dalam <td> membuat baris memuai dan
    // kolom melenceng; uji ini yang menjaganya tidak kembali.
    const m = await render({});
    expect(m).not.toMatch(/<td[^>]*>[\s\S]*?<input[^>]*name="nama"/);
  });

  it("menampilkan bilah cari dan tombol mitra baru", async () => {
    const m = await render({});
    expect(m).toContain('name="cari"');
    expect(m).toContain("ubah=baru");
  });

  it("TIDAK merender panel geser tanpa ?ubah", async () => {
    expect(await render({})).not.toContain('role="dialog"');
  });

  it("merender panel geser BERISI DATA baris saat ?ubah=<id>", async () => {
    const daftar = await render({});
    const id = /href="\/admin\/mitra\?ubah=([0-9a-f-]{36})"/.exec(daftar)?.[1];
    expect(id).toBeDefined();

    const m = await render({ ubah: id! });
    expect(m).toContain('role="dialog"');
    // Nilai baris ikut masuk — inilah bukti panelnya dirender di SERVER
    // dengan datanya sudah lengkap, bukan mengambil ulang setelah terbuka.
    expect(m).toMatch(/name="nama"[^>]*value="/);
  });

  it("?ubah dengan id yang tidak ada TIDAK melempar dan TIDAK membuka panel", async () => {
    // URL ditempel dan diketik ulang. Baris yang sudah dihapus tidak boleh
    // menjatuhkan seluruh halaman.
    const m = await render({ ubah: "00000000-0000-0000-0000-000000000000" });
    expect(m).not.toContain('role="dialog"');
  });

  it("panel geser menutup ke URL yang MEMPERTAHANKAN pencarian", async () => {
    // Dicari lebih dulu, BARU dibuka: sebuah baris hanya bisa dibuka bila ia
    // ada di halaman yang sedang tampil. Membuka id dari halaman lain menutup
    // panel — itu perilaku yang disengaja, dan uji "id tidak ada" di atas yang
    // menjaganya. Aljabar halaman sendiri sudah diuji di tests/panel-daftar.
    const daftar = await render({ cari: "sri" });
    const id = /href="\/admin\/mitra\?cari=sri&amp;ubah=([0-9a-f-]{36})"/.exec(daftar)?.[1];
    expect(id).toBeDefined();

    const m = await render({ cari: "sri", ubah: id! });
    expect(m).toContain('href="/admin/mitra?cari=sri"');
  });

  it("penjelasan halaman ada, tetapi terlipat", async () => {
    const m = await render({});
    expect(m).toContain("Mitra adalah data, bukan pengguna aplikasi");
    expect(m).toContain("<details");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/admin-mitra-halaman.test.tsx`
Expected: FAIL — halaman belum menerima `searchParams`

- [ ] **Step 3: Tulis ulang `page.tsx`**

```tsx
// web/src/app/admin/mitra/page.tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarMitra, SARING_MITRA } from "@/lib/admin/mitra";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormMitra } from "./form-mitra";

export const metadata = { title: "Mitra" };

const BASIS = "/admin/mitra";

function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Aktif" : "Nonaktif"}
    </span>
  );
}

export default async function DaftarMitraPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_MITRA);
  const { baris, total } = await ambilDaftarMitra(param);

  // `ubah` sengaja TIDAK lewat `uraikanParamDaftar`: ia bukan saringan
  // berdaftar-putih melainkan sebuah id, dan kesahihannya dibuktikan dengan
  // menemukan barisnya di bawah — bukan dengan mencocokkan pola.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const barisUbah = ubah === "baru" ? null : baris.find((m) => m.id === ubah);
  // Panel hanya terbuka bila ada yang benar-benar bisa ditampilkan. Id yang
  // sudah dihapus atau berada di halaman lain menutup panel, bukan membuka
  // panel kosong yang formulirnya tidak menunjuk apa pun.
  const panelTerbuka = ubah === "baru" || barisUbah !== undefined;
  // Menutup = alamat yang sama TANPA `ubah`. Cari, saringan, dan halaman ikut
  // terbawa, jadi admin melanjutkan dari tempat ia berhenti.
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Mitra</h1>
        <Bantuan judul="Tentang halaman ini">
          Mitra adalah data, bukan pengguna aplikasi — bidan melapor lewat WhatsApp dan
          admin yang mencatat. Mitra yang berhenti melayani cukup dinonaktifkan; namanya
          tetap menempel pada sesi yang sudah dijalaninya.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "aktif",
            label: "Ketersediaan",
            pilihan: [
              { nilai: "ya", label: "Aktif" },
              { nilai: "tidak", label: "Nonaktif" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href={`${BASIS}?ubah=baru`}
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Mitra baru
          </Link>
        }
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Tidak ada mitra yang cocok dengan pencarian ini.
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar mitra">
            <thead>
              <tr>
                <Th>Nama</Th><Th>Kontak</Th><Th>Kinerja</Th><Th>Status</Th><Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((m) => (
                <tr key={m.id}>
                  <Td><b>{m.nama}</b></Td>
                  <Td>{m.noHp || "—"}</Td>
                  {/* Angka kinerja hanya jumlah sesi selesai. Honor mitra
                      adalah wilayah owner dan tidak pernah singgah di sini. */}
                  <Td className="font-mono text-[12.5px]">{m.sesiSelesai} sesi selesai</Td>
                  <Td><PillAktif aktif={m.aktif} /></Td>
                  <Td>
                    <Link
                      href={`${BASIS}${bangunQuery(param, { ubah: m.id })}`}
                      className="text-[12px] font-bold text-panel-ink underline"
                    >
                      Ubah
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />

      {panelTerbuka && (
        <PanelGeser
          judul={barisUbah ? `Ubah ${barisUbah.nama}` : "Mitra baru"}
          hrefTutup={hrefTutup}
        >
          <FormMitra mitra={barisUbah ?? null} hrefTutup={hrefTutup} />
        </PanelGeser>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Sederhanakan `form-mitra.tsx`**

Formulir tidak lagi mengurus buka/tutupnya sendiri — itu urusan URL sekarang. Ganti `FormMitraBaru` dan `AksiMitra` dengan satu `FormMitra`:

```tsx
// web/src/app/admin/mitra/form-mitra.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aktifkanMitra, nonaktifkanMitra, perbaruiMitra, simpanMitra } from "./aksi";

const KELAS_MEDAN =
  "mt-1 min-h-[38px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px]";
const KELAS_LABEL = "block text-[12px] font-bold text-panel-muted";

export type MitraForm = {
  id: string; nama: string; noHp: string; alamat: string; aktif: boolean;
};

/**
 * Satu formulir untuk membuat DAN mengubah.
 *
 * Sebelumnya ada dua komponen yang masing-masing menyimpan `terbuka`/`ubah`
 * sendiri, dan keduanya merender formulir di tempat yang berbeda — satu di
 * header halaman, satu di dalam sel tabel. Sekarang yang menentukan terbuka
 * atau tidak adalah URL, jadi komponen ini tinggal menjadi formulir saja.
 */
export function FormMitra({
  mitra,
  hrefTutup,
}: {
  /** `null` berarti mitra baru. */
  mitra: MitraForm | null;
  hrefTutup: string;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = mitra ? await perbaruiMitra(mitra.id, fd) : await simpanMitra(fd);
          if (r.ok) {
            setPesan(null);
            // Menutup panel DENGAN kembali ke daftar yang sama — cari dan
            // halaman ikut, jadi admin melanjutkan dari tempat ia berhenti.
            router.push(hrefTutup);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="grid gap-3"
    >
      <label>
        <span className={KELAS_LABEL}>Nama mitra</span>
        <input name="nama" type="text" required minLength={2}
          defaultValue={mitra?.nama ?? ""}
          placeholder="mis. Bidan Sri Wahyuni" className={KELAS_MEDAN} />
      </label>
      <label>
        <span className={KELAS_LABEL}>No. WhatsApp</span>
        <input name="no_hp" type="tel" defaultValue={mitra?.noHp ?? ""}
          placeholder="08xx" className={KELAS_MEDAN} />
      </label>
      <label>
        <span className={KELAS_LABEL}>Domisili (opsional, bisa diisi menyusul)</span>
        <textarea name="alamat" rows={2} defaultValue={mitra?.alamat ?? ""}
          placeholder="Alamat domisili mitra" className={KELAS_MEDAN} />
        {/* Domisili ini digeocoding lewat Nominatim (OSM) untuk jarak garis
            lurus ke klien — lisensi ODbL mewajibkan atribusi tampak di layar
            yang memakai hasilnya, bukan cukup di komentar kode. */}
        <span className="mt-1 block text-[11px] text-panel-muted">
          Lokasi diperkirakan lewat data © OpenStreetMap contributors.
        </span>
      </label>

      {pesan && <p className="text-[12.5px] font-semibold text-clay">{pesan}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-panel-ink px-4 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60">
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        {/* Dua action terpisah, bukan satu action bernilai `!aktif`: keadaan
            tujuan tidak pernah menyeberang batas server sebagai data. */}
        {mitra && (
          <button type="button" disabled={pending}
            onClick={() =>
              mulai(async () => {
                const r = mitra.aktif
                  ? await nonaktifkanMitra(mitra.id)
                  : await aktifkanMitra(mitra.id);
                if (r.ok) router.push(hrefTutup);
                else setPesan(r.pesan);
              })
            }
            className="rounded-lg border border-panel-border px-4 py-2 text-[12.5px] font-bold text-panel-ink">
            {mitra.aktif ? "Nonaktifkan" : "Aktifkan"}
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/admin-mitra-halaman.test.tsx tests/admin-mitra.test.ts tests/panel-primitif.test.ts`
Expected: PASS

- [ ] **Step 6: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/app/admin/mitra web/tests/admin-mitra-halaman.test.tsx
git commit -m "feat(mitra): bilah daftar & panel geser menggantikan formulir dalam sel"
```

---

### Task 8: Lapisan data Klien dipindah keluar dari halaman

**Files:**
- Create: `web/src/lib/admin/klien.ts`
- Modify: `web/src/app/admin/klien/page.tsx` (hanya bagian pengambilan data)
- Test: `web/tests/admin-klien-data.test.ts` (baru)

**Interfaces:**
- Produces:
  - `type BarisKlienDaftar = { id: string; padmaId: string; nama: string; email: string; namaFase: string; aktif: boolean; paketAktif: string | null; sesiSelesai: number }`
  - `ambilDaftarKlien(param: ParamDaftar): Promise<{ baris: BarisKlienDaftar[]; total: number }>`
  - `SARING_KLIEN = { aktivasi: ["aktif", "belum"], paket: ["ada"] } as const`

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/admin-klien-data.test.ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));

const { ambilDaftarKlien } = await import("@/lib/admin/klien");
const admin = createAdminSupabase();

beforeAll(async () => { ref.sesi = await signInAs("admin@padma.test"); });

describe("ambilDaftarKlien", () => {
  it("mencari menurut nama DAN PADMA ID", async () => {
    // PADMA ID adalah yang dibacakan klien lewat telepon; nama adalah yang
    // diingat admin. Keduanya harus menemukan baris yang sama.
    const lewatNama = await ambilDaftarKlien({ cari: "ananda", saring: {}, hal: 1 });
    expect(lewatNama.baris.length).toBeGreaterThan(0);
    const target = lewatNama.baris[0];

    const lewatId = await ambilDaftarKlien({ cari: target.padmaId, saring: {}, hal: 1 });
    expect(lewatId.baris.map((k) => k.id)).toContain(target.id);
  });

  it("menyaring klien yang BELUM aktivasi", async () => {
    const { baris } = await ambilDaftarKlien({ cari: "", saring: { aktivasi: "belum" }, hal: 1 });
    expect(baris.every((k) => !k.aktif)).toBe(true);
  });

  it("total tidak ikut terpotong halaman", async () => {
    const { baris, total } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(total).toBeGreaterThanOrEqual(baris.length);
  });

  it("hanya paket BERSTATUS AKTIF yang menjadi identitas baris", async () => {
    // Paket lama tidak menggantikan gambaran "sedang menjalani apa".
    const { baris } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    for (const k of baris.filter((b) => b.paketAktif !== null)) {
      const { data } = await admin
        .from("client_packages")
        .select("status")
        .eq("client_id", k.id)
        .eq("status", "aktif");
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });

  it("TIDAK memulangkan satu pun nominal rupiah", async () => {
    // Money firewall: /admin tidak melihat angka uang. Paket dipulangkan
    // sebagai NAMA, bukan harganya.
    const { baris } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(JSON.stringify(baris)).not.toMatch(/harga|nominal|honor/i);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/admin-klien-data.test.ts`
Expected: FAIL — `@/lib/admin/klien` belum ada

- [ ] **Step 3: Tulis `lib/admin/klien.ts`**

Pindahkan keempat query dari `page.tsx` ke sini apa adanya — termasuk komentar-komentarnya — lalu tambahkan cari, saring, paginasi:

```ts
// web/src/lib/admin/klien.ts
import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar } from "@/app/_shell/panel/daftar";

export const SARING_KLIEN = {
  aktivasi: ["aktif", "belum"],
  paket: ["ada"],
} as const;

export type BarisKlienDaftar = {
  id: string;
  padmaId: string;
  nama: string;
  email: string;
  namaFase: string;
  /** `user_id` sudah terisi — tautan aktivasi sudah ditukarkan. */
  aktif: boolean;
  paketAktif: string | null;
  sesiSelesai: number;
};

type BarisKlien = {
  id: string; padma_id: string; nama: string; email: string;
  phase_id: string | null; user_id: string | null;
};
type BarisPaket = {
  client_id: string;
  packages: { nama: string; jumlah_sesi: number } | null;
};

/**
 * Satu halaman daftar klien.
 *
 * Dipindah keluar dari `page.tsx` supaya saringan dan paginasinya bisa diuji
 * tanpa merender halaman — saringan yang memulangkan baris yang salah adalah
 * cacat DATA, dan menguji cacat data lewat markup berarti membuktikannya
 * dengan cara yang paling tidak langsung.
 *
 * Sesi pengguna, bukan service role: policy `clients: staf` yang mengizinkan
 * daftar ini terbaca, dan itulah yang ingin ikut teruji.
 */
export async function ambilDaftarKlien(
  param: ParamDaftar,
): Promise<{ baris: BarisKlienDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("clients")
    .select("id, padma_id, nama, email, phase_id, user_id", { count: "exact" })
    .order("created_at", { ascending: false });

  if (param.saring.aktivasi === "aktif") q = q.not("user_id", "is", null);
  if (param.saring.aktivasi === "belum") q = q.is("user_id", null);

  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    // PADMA ID dibacakan klien lewat telepon; nama yang diingat admin. Satu
    // kotak cari harus menemukan keduanya, jadi `or` — bukan dua kotak.
    q = q.or(`nama.ilike.%${aman}%,padma_id.ilike.%${aman}%`);
  }

  const [{ data: klien, count }, { data: fase }, { data: paket }, { data: sesiSelesai }] =
    await Promise.all([
      q.range(dari, sampai).returns<BarisKlien[]>(),
      supabase.from("phases").select("id, nama").returns<{ id: string; nama: string }[]>(),
      // Hanya paket yang masih berjalan yang menjadi identitas baris klien;
      // paket lama tidak menggantikan gambaran "sedang menjalani apa".
      supabase
        .from("client_packages")
        .select("client_id, status, packages ( nama, jumlah_sesi )")
        .eq("status", "aktif")
        .returns<BarisPaket[]>(),
      // Sesi dihitung di sini, bukan lewat agregat tertanam PostgREST: filter
      // pada sumber tertanam mengubah arti gabungannya dan gampang menghitung
      // sesi milik klien lain tanpa error apa pun.
      supabase
        .from("sessions")
        .select("client_id")
        .eq("status", "selesai")
        .returns<{ client_id: string }[]>(),
    ]);

  const labelFase = new Map((fase ?? []).map((f) => [f.id, f.nama]));
  const paketAktif = new Map((paket ?? []).map((p) => [p.client_id, p.packages?.nama ?? null]));
  const selesaiPer = new Map<string, number>();
  for (const s of sesiSelesai ?? []) {
    selesaiPer.set(s.client_id, (selesaiPer.get(s.client_id) ?? 0) + 1);
  }

  let baris = (klien ?? []).map((k) => ({
    id: k.id,
    padmaId: k.padma_id,
    nama: k.nama,
    email: k.email,
    namaFase: k.phase_id ? (labelFase.get(k.phase_id) ?? "—") : "—",
    aktif: k.user_id !== null,
    paketAktif: paketAktif.get(k.id) ?? null,
    sesiSelesai: selesaiPer.get(k.id) ?? 0,
  }));

  // Saringan "punya paket berjalan" dikerjakan di JS, bukan SQL, dan itu
  // disengaja: paket hidup di tabel lain, dan menyaringnya lewat `in` atas
  // daftar id akan pecah begitu daftar klien melewati batas panjang URL
  // PostgREST. Konsekuensinya jujur dan disebut di sini: total tidak ikut
  // menyempit, jadi saringan ini menyaring HALAMAN, bukan seluruh daftar.
  // Menutupnya menuntut view SQL sendiri — pekerjaan rencana berikutnya.
  if (param.saring.paket === "ada") baris = baris.filter((k) => k.paketAktif !== null);

  return { baris, total: count ?? 0 };
}
```

- [ ] **Step 4: Sambungkan `page.tsx` ke lapisan baru**

Di `web/src/app/admin/klien/page.tsx`, hapus keempat query beserta `createServerSupabase`, lalu ganti dengan:

```tsx
const { baris, total } = await ambilDaftarKlien(param);
```

Tabelnya tetap seperti sekarang; sumber datanya saja yang berganti nama medan (`k.padmaId`, `k.namaFase`, `k.aktif`, `k.paketAktif`, `k.sesiSelesai`).

- [ ] **Step 5: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/admin-klien-data.test.ts tests/admin-klien.test.ts`
Expected: PASS

- [ ] **Step 6: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/lib/admin/klien.ts web/src/app/admin/klien/page.tsx web/tests/admin-klien-data.test.ts
git commit -m "feat(klien): lapisan data dipindah keluar halaman, menerima cari & halaman"
```

---

### Task 9: Halaman Klien memakai bilah daftar & baris yang menaut

**Files:**
- Modify: `web/src/app/admin/klien/page.tsx`
- Create: `web/src/app/admin/klien/baru/page.tsx`
- Test: `web/tests/admin-klien-halaman.test.tsx` (baru)

**Interfaces:**
- Consumes: `ambilDaftarKlien`, `SARING_KLIEN`, `BilahDaftar`, `Paginasi`, `Bantuan`, dan `FormKlienBaru` yang sudah ada di `web/src/app/admin/klien/form-klien.tsx`.
- Produces: rute `/admin/klien/baru`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
// web/tests/admin-klien-halaman.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => "admin" }));

const { default: HalamanKlien } = await import("@/app/admin/klien/page");

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await HalamanKlien({ searchParams: Promise.resolve(sp) }));

describe("halaman /admin/klien", () => {
  it("setiap baris menaut ke halaman detailnya", async () => {
    // Pola B: klien punya isi turunan (riwayat sesi, paket, akses materi),
    // jadi barisnya membuka halaman, bukan panel geser.
    const m = await render();
    expect(m).toMatch(/href="\/admin\/klien\/[0-9a-f-]{36}"/);
  });

  it("TIDAK ada panel geser di modul ini", async () => {
    expect(await render()).not.toContain('role="dialog"');
  });

  it("punya bilah cari dan chip aktivasi", async () => {
    const m = await render();
    expect(m).toContain('name="cari"');
    expect(m).toContain("aktivasi=belum");
  });

  it("pencarian menyempitkan tabel yang dirender", async () => {
    const semua = await render();
    const disaring = await render({ cari: "ananda" });
    const hitung = (s: string) => (s.match(/href="\/admin\/klien\/[0-9a-f-]{36}"/g) ?? []).length;
    expect(hitung(disaring)).toBeLessThan(hitung(semua));
    expect(hitung(disaring)).toBeGreaterThan(0);
  });

  it("penjelasan halaman terlipat, bukan hilang", async () => {
    expect(await render()).toContain("<details");
  });

  it("TIDAK menampilkan satu nominal rupiah pun", async () => {
    expect(await render()).not.toMatch(/Rp\s?\d/);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/admin-klien-halaman.test.tsx`
Expected: FAIL — halaman belum menerima `searchParams`

- [ ] **Step 3: Ubah `page.tsx`**

Bagian yang berubah: impor, tanda tangan fungsi, penguraian parameter, bilah, paginasi, dan
kolom nama menjadi tautan. `PillAktivasi` yang sudah ada di berkas ini dipertahankan apa adanya.

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarKlien, SARING_KLIEN } from "@/lib/admin/klien";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";

export default async function DaftarKlienPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_KLIEN);
  const { baris, total } = await ambilDaftarKlien(param);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Klien</h1>
        <Bantuan judul="Tentang halaman ini">
          &ldquo;Belum aktif&rdquo; berarti tautan aktivasi belum ditukarkan: passport-nya
          belum bisa dibuka siapa pun, termasuk oleh klien yang sudah dikirimi pesan
          sambutan.
        </Bantuan>
      </header>

      <BilahDaftar
        basis="/admin/klien"
        param={param}
        kelompok={[
          {
            nama: "aktivasi",
            label: "Aktivasi",
            pilihan: [
              { nilai: "aktif", label: "Aktif" },
              { nilai: "belum", label: "Belum aktivasi", menuntut: true },
            ],
          },
          { nama: "paket", label: "Paket", pilihan: [{ nilai: "ada", label: "Punya paket" }] },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href="/admin/klien/baru"
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Klien baru
          </Link>
        }
      />
      <div className="rounded-lg border border-panel-border bg-panel-surface">
        <Tabel label="Daftar klien">
          <thead>
            <tr>
              <Th>Nama</Th><Th>PADMA ID</Th><Th>Fase</Th>
              <Th>Paket</Th><Th>Sesi</Th><Th>Aktivasi</Th>
            </tr>
          </thead>
          <tbody>
            {baris.map((k) => (
              <tr key={k.id}>
                <Td>
                  {/* Barisnya sendiri yang menaut — pola B. Tidak ada kolom
                      "Aksi" berisi tombol Ubah, karena yang dibuka adalah
                      halaman klien itu, bukan formulirnya saja. */}
                  <Link href={`/admin/klien/${k.id}`} className="font-bold text-panel-ink underline">
                    {k.nama}
                  </Link>
                </Td>
                <Td className="font-mono text-[12.5px]">{k.padmaId}</Td>
                <Td>{k.namaFase}</Td>
                <Td>{k.paketAktif ?? "—"}</Td>
                <Td className="font-mono text-[12.5px]">{k.sesiSelesai}</Td>
                <Td><PillAktivasi aktif={k.aktif} /></Td>
              </tr>
            ))}
          </tbody>
        </Tabel>
      </div>

      <Paginasi basis="/admin/klien" param={param} total={total} />
    </main>
  );
}
```

- [ ] **Step 4: Buat rute `/admin/klien/baru`**

Tombol "+ Klien baru" menuju halaman, bukan panel geser — klien adalah pola B. Rute
ini belum ada; `FormKlienBaru` yang dipakainya sudah ada dan tidak diubah.

Segmen statis `baru/` menang atas `[id]/` di App Router, jadi `/admin/klien/baru`
tidak akan pernah tertangkap sebagai id — tetapi karena keduanya bertetangga, uji di
Step 1 menjaganya agar tetap begitu.

```tsx
// web/src/app/admin/klien/baru/page.tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { FormKlienBaru } from "../form-klien";

export const metadata = { title: "Klien baru" };

export default async function KlienBaruPage() {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data: fase } = await supabase
    .from("phases")
    .select("id, nama")
    .order("urutan")
    .returns<{ id: string; nama: string }[]>();

  return (
    <main className="max-w-2xl">
      <Link href="/admin/klien" className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Klien
      </Link>
      <h1 className="mb-4 mt-2 text-[18px] font-bold text-panel-ink">Klien baru</h1>
      <FormKlienBaru fase={fase ?? []} />
    </main>
  );
}
```

Tambahkan uji ini ke `web/tests/admin-klien-halaman.test.tsx`:

```tsx
it("rute /admin/klien/baru merender formulir, bukan halaman detail id 'baru'", async () => {
  const { default: Baru } = await import("@/app/admin/klien/baru/page");
  const m = renderToStaticMarkup(await Baru());
  expect(m).toContain('name="nama"');
  expect(m).toContain("Kembali ke Klien");
});
```

- [ ] **Step 5: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/admin-klien-halaman.test.tsx tests/admin-klien.test.ts`
Expected: PASS

- [ ] **Step 6: Periksa tipe & commit**

```bash
npx tsc --noEmit
git add web/src/app/admin/klien web/tests/admin-klien-halaman.test.tsx
git commit -m "feat(klien): bilah daftar, paginasi, dan baris yang menaut ke detail"
```

---

### Task 10: E2E kedua modul & verifikasi menyeluruh

**Files:**
- Modify: `web/tests/e2e/admin-operasional.e2e.ts` dan `web/tests/e2e/admin-pelengkap.e2e.ts` (langkah mana pun yang menekan tombol lama)

**Interfaces:**
- Consumes: seluruh perilaku Task 1–9.

- [ ] **Step 1: Temukan langkah e2e yang menargetkan susunan lama**

```bash
grep -n "Mitra baru\|Ubah\|form-mitra\|Simpan mitra" web/tests/e2e/*.e2e.ts
```

Setiap langkah yang menekan "Ubah" lalu mengisi medan **di dalam baris** harus diubah: sekarang "Ubah" adalah tautan yang membuka `?ubah=<id>`, dan medannya hidup di dalam `[role="dialog"]`.

- [ ] **Step 2: Ubah langkah mitra menjadi alur panel geser**

```ts
// Pola baru: klik tautan Ubah, tunggu dialognya, isi di dalam dialog.
await page.getByRole("link", { name: "Ubah" }).first().click();
const panel = page.getByRole("dialog");
await panel.getByLabel("Nama mitra").fill("Bidan Uji E2E");
await panel.getByRole("button", { name: "Simpan" }).click();
// Panel menutup dengan kembali ke daftar — dialognya harus BENAR-BENAR hilang,
// bukan sekadar tersembunyi.
await expect(page.getByRole("dialog")).toHaveCount(0);
```

- [ ] **Step 3: Tambahkan satu langkah baru — cari & saring bekerja tanpa JavaScript**

```ts
// Bilah cari adalah <form method="get">. Langkah ini membuktikannya berjalan
// sebagai navigasi biasa, bukan sebagai state klien.
await page.getByLabel("Cari di daftar ini").fill("sri");
await page.keyboard.press("Enter");
await expect(page).toHaveURL(/\/admin\/mitra\?cari=sri/);
await page.getByRole("link", { name: "Nonaktif" }).click();
await expect(page).toHaveURL(/cari=sri/);
await expect(page).toHaveURL(/aktif=tidak/);
```

- [ ] **Step 4: Verifikasi menyeluruh**

Perintah TERPISAH, jangan digabung, jangan di-background:

```bash
npm run db:recover
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Lalu, dengan dev server hidup dan basis data yang tidak dipakai proses lain, satu per satu:

```bash
npm run test:e2e
npm run test:e2e:funnel
npm run test:e2e:passport
npm run test:e2e:admin
npm run test:e2e:pelengkap
npm run test:e2e:owner
npm run test:e2e:materi
```

`npm run test:e2e:video` **JANGAN dijalankan** — ia mengunggah dan menghapus objek di bucket Cloudflare R2 sungguhan milik pemilik produk.

- [ ] **Step 5: Commit**

```bash
git add web/tests/e2e
git commit -m "test(e2e): alur panel geser & bilah cari menggantikan susunan lama"
```

---

## Verifikasi penutup

- [ ] `npm test` hijau seluruhnya
- [ ] Tujuh skrip e2e hijau (video dikecualikan)
- [ ] `npx tsc --noEmit` bersih kecuali galat `LayoutProps` pra-ada
- [ ] `npm run lint` tanpa error, `npm run build` berhasil
- [ ] `/admin/mitra` dibuka manual: cari, saring, paginasi, panel geser buka-tutup, tombol kembali browser menutup panel
- [ ] `/admin/klien` dibuka manual: baris menaut ke detail, cari menemukan lewat nama DAN PADMA ID
- [ ] Kedua halaman: **nol nominal rupiah**
