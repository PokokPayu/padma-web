# Kerangka & Bahasa Visual Panel Admin/Owner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti kerangka navigasi panel `/admin` dan `/owner` dari kartu tab horizontal menjadi sidebar gelap permanen + topbar + drawer, dengan bahasa visual panel yang baru — tanpa menyentuh skema, RLS, server action, maupun halaman yang dilihat klien.

**Architecture:** Primitif visual bersama lahir di `src/app/_shell/panel/` dan **buta soal peran** — tidak satu pun berkas di sana menyebut `"admin"`/`"owner"` atau mengimpor penjaga peran. Daftar menu tetap tinggal di `admin/_shell/nav-admin.tsx` dan `owner/_shell/nav-owner.tsx` masing-masing, yang kini merakit primitif alih-alih menggambar tab sendiri. Sidebar dirender **satu kali** sebagai elemen fixed yang bergeser (`-translate-x-full` → `translate-x-0`) di layar kecil, bukan dua kali untuk desktop dan drawer; itu menjaga jumlah `<nav>` dan `<a>` tetap dapat dikunci test dan mencegah tautan ganda.

**Tech Stack:** Next.js 16.3.3 (App Router), React 19.2.8, Tailwind CSS v4 (`@theme` di `globals.css`), Vitest 4 (`environment: "node"`, render lewat `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-09-05-padma-panel-admin-ui-design.md`

## Global Constraints

- **Tanpa dependensi baru.** Tidak ada `npm install` di seluruh rencana ini — termasuk jsdom dan testing-library. Konsekuensinya diakui di Task 6: perilaku drawer diuji lewat fungsi murni + asersi sumber, bukan simulasi klik.
- **Tanpa migration.** Tidak ada perubahan skema, RLS, atau server action.
- **Money firewall.** Panel admin tidak boleh memuat satu NOMINAL pun. Yang dilarang di `src/app/_shell/panel/` adalah nominal yang benar-benar dirender dan pemformatnya: pola `/Rp\s?\d/` dan `formatRupiah`. Kata "Rp" di dalam KOMENTAR yang menjelaskan kenapa sebuah ikon justru BUKAN lambang mata uang tidak termasuk — komentar semacam itu mendokumentasikan firewall, bukan menembusnya, dan `nav-admin.tsx` yang ada sekarang sudah memuatnya sambil tetap lulus `not.toMatch(/Rp\s?\d/)`. Constraint yang lebih ketat daripada test penegaknya tidak bisa diperiksa dan hanya melahirkan temuan palsu.
- **Service role terlarang** di `src/app/admin/**` (kecuali `src/app/admin/materi/unggah.ts`) dan di seluruh `src/app/owner/**`. Berlaku juga untuk `src/app/_shell/panel/**`.
- **Argumen penjaga peran tidak bergeser.** `src/app/admin/layout.tsx` tetap `await requireRole(["admin","owner"])` **tepat satu kali**; `src/app/owner/layout.tsx` tetap `await requireRole(["owner"])` **tepat satu kali**.
- **Primitif buta peran.** Tidak satu pun berkas di `src/app/_shell/panel/` boleh memuat string BERKUTIP `"admin"` / `"owner"` (yakni percabangan peran di dalam kode) atau mengimpor `requireRole`. Kata "admin"/"owner" di dalam prosa komentar tidak termasuk. Dikunci test di Task 6 dengan pola `/"(admin|owner)"/`.
- **Halaman klien tidak disentuh.** Tidak ada perubahan pada `src/app/passport/**`, `src/app/_landing/**`, `src/app/skrining/**`, dan token PADMA lama (`--color-paper`, `--color-gold`, `--color-night`, dst.) tetap ada di `globals.css`.
- **Bahasa Indonesia** untuk nama berkas, identifier, komentar, dan seluruh teks UI — mengikuti seluruh repo.
- Perintah test: `npm test` (seluruh suite), `npx vitest run tests/<berkas>` (satu berkas). Perintah lint: `npm run lint`. Build: `npm run build`.
- Supabase lokal harus hidup sebelum `npm test` (`npx supabase start`). Berkas test yang lahir di rencana ini sendiri tidak menyentuh DB, tapi `globalSetup` menyemai pengguna demo.

---

### Task 1: Token visual panel

**Files:**
- Modify: `web/src/app/globals.css`
- Test: `web/tests/panel-primitif.test.ts` (create)

**Interfaces:**
- Consumes: —
- Produces: utilitas Tailwind `bg-panel-bg`, `bg-panel-surface`, `border-panel-border`, `text-panel-ink`, `text-panel-muted`, `bg-panel-rail`, `text-panel-rail-ink`, `text-panel-rail-aktif` — dipakai seluruh task berikutnya.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/panel-primitif.test.ts`:

```ts
/**
 * Primitif kerangka panel staf (`src/app/_shell/panel/**`) dan token visualnya.
 *
 * Berkas ini tidak menyentuh basis data sama sekali: ia membaca sumber dan
 * merender komponen. Yang dijaga adalah tiga hal yang hilang tanpa error:
 *
 *  1. Token PADMA lama tidak boleh ikut terhapus saat token panel lahir —
 *     landing, skrining, dan /passport masih memakainya, dan hilangnya baru
 *     terlihat sebagai halaman klien yang berubah warna.
 *  2. Primitif panel wajib BUTA PERAN. Begitu satu berkas di sana tahu
 *     bedanya admin dan owner, pemisahan fisik money firewall berubah menjadi
 *     satu kondisional yang bisa salah tulis.
 *  3. Badge antrean hilang saat nol — alarm yang dinormalkan berhenti berarti.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

describe("token visual panel", () => {
  const css = baca("src/app/globals.css");

  it("token panel lahir di @theme", () => {
    for (const token of [
      "--color-panel-bg",
      "--color-panel-surface",
      "--color-panel-border",
      "--color-panel-ink",
      "--color-panel-muted",
      "--color-panel-rail",
      "--color-panel-rail-ink",
      "--color-panel-rail-aktif",
    ]) {
      expect(css, `${token} tidak ada`).toContain(token);
    }
  });

  it("token PADMA lama TETAP ada (landing, skrining & /passport memakainya)", () => {
    for (const token of [
      "--color-paper",
      "--color-paper-warm",
      "--color-night",
      "--color-pine",
      "--color-leaf",
      "--color-leaf-soft",
      "--color-gold",
      "--color-gold-bright",
      "--color-gold-pale",
      "--color-ink",
      "--color-ink-soft",
      "--color-clay",
    ]) {
      expect(css, `${token} ikut terhapus`).toContain(token);
    }
  });

  it("latar panel BUKAN krem paper — ruang kerja dan halaman klien memang beda", () => {
    expect(css).toMatch(/--color-panel-bg:\s*#f5f6f4/i);
    expect(css).not.toMatch(/--color-panel-bg:\s*var\(--color-paper\)/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: FAIL — `--color-panel-bg tidak ada`.

- [ ] **Step 3: Tambahkan token di `globals.css`**

Sisipkan blok berikut di dalam `@theme { ... }` yang sudah ada, tepat setelah baris `--color-clay: #a6472f;`:

```css
  /* ===== TOKEN PANEL STAF (/admin & /owner) =====
     Sengaja TERPISAH dari token PADMA di atas, bukan menimpanya. Landing,
     skrining, dan /passport tetap memakai krem-emas-serif; yang berganti
     bahasa visual hanya ruang kerja staf. Menimpa `--color-paper` akan
     mengubah warna halaman yang dilihat klien tanpa satu test pun merah. */
  --color-panel-bg: #f5f6f4;
  --color-panel-surface: #ffffff;
  --color-panel-border: #e4e7e3;
  --color-panel-ink: #1b1f1d;
  --color-panel-muted: #6b756e;
  /* Rail = sidebar gelap. Nilainya sama dengan --color-night, tetapi diberi
     nama sendiri supaya "warna sidebar" bisa digeser kelak tanpa menyeret
     seluruh halaman klien yang juga memakai night. */
  --color-panel-rail: #0a2b1f;
  --color-panel-rail-ink: #9db09e;
  --color-panel-rail-aktif: #f0e3c3;
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/globals.css tests/panel-primitif.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): token visual ruang kerja staf, terpisah dari token PADMA

Token panel lahir sebagai keluarga sendiri (--color-panel-*), bukan
menimpa --color-paper dkk. Menimpanya akan mengubah warna landing,
skrining, dan /passport tanpa satu test pun merah — dan halaman itulah
yang dilihat klien.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Peta ikon bersama

**Files:**
- Create: `web/src/app/_shell/panel/ikon.tsx`
- Test: `web/tests/panel-primitif.test.ts` (modify — tambah satu `describe`)

**Interfaces:**
- Consumes: `Lotus` dari `@/app/_landing/lotus` (sudah ada).
- Produces: `type NamaIkon` dan `<Ikon nama={...} className={...} />` — dipakai Task 3 (Sidebar), 4 (Topbar), 5 (BottomBar), 7 (nav admin), 8 (nav owner).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/panel-primitif.test.ts`:

Lebih dulu, lengkapi import di bagian atas berkas test — dipakai task ini dan seluruh task berikutnya:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
```

Lalu tambahkan di akhir berkas:

```ts
const { Ikon, NAMA_IKON } = await import("@/app/_shell/panel/ikon");

describe("peta ikon panel", () => {
  it("setiap nama ikon menghasilkan SVG", () => {
    for (const nama of NAMA_IKON) {
      const m = renderToStaticMarkup(createElement(Ikon, { nama }));
      expect(m, `ikon "${nama}" tidak merender svg`).toContain("<svg");
      // Ikon adalah bentuk, bukan informasi: labelnya hidup di teks tautan.
      expect(m, `ikon "${nama}" tidak aria-hidden`).toContain('aria-hidden="true"');
    }
  });

  it("teratai dipakai ulang dari komponen bersama, path-nya tidak disalin", () => {
    const sumber = baca("src/app/_shell/panel/ikon.tsx");
    expect(sumber).toMatch(/from\s+["']@\/app\/_landing\/lotus["']/);
    // Potongan path teratai milik komponen bersama; kemunculannya di sini
    // berarti path-nya disalin, dan dua salinan akan berpisah diam-diam.
    expect(sumber).not.toContain("M32 6 C37.5 13");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/ikon` tidak ditemukan.

- [ ] **Step 3: Buat `web/src/app/_shell/panel/ikon.tsx`**

```tsx
import type { ReactElement } from "react";
import { Lotus } from "@/app/_landing/lotus";

/**
 * Satu peta ikon untuk kedua panel staf.
 *
 * Sebelum ini `nav-admin.tsx` dan `nav-owner.tsx` masing-masing punya fungsi
 * `Ikon` sendiri, dengan `Lotus` dibagi tetapi sisanya disalin. Dua salinan
 * ikon akan berpisah diam-diam: yang berubah cuma salah satu panel, dan tidak
 * ada yang merah.
 *
 * Setiap path di bawah membawa alasan bentuknya — sebagian besar dipindahkan
 * apa adanya dari kedua berkas nav lama, termasuk komentarnya.
 */
export const NAMA_IKON = [
  "lotus",
  "inbox",
  "user",
  "cal",
  "bayar",
  "mitra",
  "katalog",
  "materi",
  "setelan",
  "rekap",
  "tarif",
  "keluar",
  "menu",
] as const;

export type NamaIkon = (typeof NAMA_IKON)[number];

const PATH: Record<Exclude<NamaIkon, "lotus">, ReactElement> = {
  inbox: (
    <path
      d="M3.5 13.5h4.2l1.5 2.6h5.6l1.5-2.6h4.2M3.5 13.5 6 5.2h12L20.5 13.5v4.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
      strokeLinejoin="round"
    />
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" strokeLinecap="round" />
    </>
  ),
  cal: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 2.8v3.7M16 2.8v3.7" strokeLinecap="round" />
    </>
  ),
  // Kuitansi, bukan lambang mata uang: panel admin tidak pernah menampilkan
  // nominal, dan ikon "Rp" akan menjanjikan angka yang memang tidak ada.
  bayar: (
    <>
      <path
        d="M5.5 3.6h13v16.8l-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5-2.2-1.5-2.1 1.5z"
        strokeLinejoin="round"
      />
      <path d="M9 8.4h6M9 12.2h6" strokeLinecap="round" />
    </>
  ),
  mitra: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.6 20c1-3.2 3.4-4.8 6.4-4.8s5.4 1.6 6.4 4.8" strokeLinecap="round" />
      <path d="M16.4 5.2a3.2 3.2 0 0 1 0 5.9M18.4 20c-.4-1.7-1.1-3-2.1-3.9" strokeLinecap="round" />
    </>
  ),
  // Lapisan kartu katalog, bukan tag harga: modul Layanan mengelola nama &
  // susunan paket, sementara angka tarifnya tidak pernah singgah di panel admin.
  katalog: (
    <>
      <rect x="3.2" y="6.4" width="17.6" height="13.4" rx="2.4" />
      <path d="M6.6 3.4h10.8M4.9 10.4h14.2" strokeLinecap="round" />
    </>
  ),
  // Buku terbuka, bukan berkas/unduhan: materi PADMA sengaja hanya bisa dibaca
  // di dalam aplikasi — ikon berkas akan menjanjikan unduhan yang tidak ada.
  materi: (
    <>
      <path
        d="M12 6.4C10.3 5.1 8.3 4.5 5.6 4.5H3.4v13.2h2.2c2.7 0 4.7.6 6.4 1.9 1.7-1.3 3.7-1.9 6.4-1.9h2.2V4.5h-2.2c-2.7 0-4.7.6-6.4 1.9z"
        strokeLinejoin="round"
      />
      <path d="M12 6.4v13.2" strokeLinecap="round" />
    </>
  ),
  // Sekrup penyetel, bukan roda gigi: modul ini menyetel teks & nomor yang
  // dilihat publik, bukan menyimpan preferensi teknis.
  setelan: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path
        d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8"
        strokeLinecap="round"
      />
    </>
  ),
  // Batang grafik naik: rekap adalah angka yang dibandingkan antar pekan.
  rekap: (
    <>
      <path d="M3.6 20.4h16.8" strokeLinecap="round" />
      <rect x="5.4" y="12.4" width="3.6" height="6" rx="1.1" />
      <rect x="10.2" y="8.2" width="3.6" height="10.2" rx="1.1" />
      <rect x="15" y="4.4" width="3.6" height="14" rx="1.1" />
    </>
  ),
  // Kartu bertanda garis harga — "rate card", bukan lambang mata uang: nominal
  // rupiahnya ada di isi halaman, dan ikon "Rp" akan mengulanginya dua kali.
  tarif: (
    <>
      <rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.4" />
      <path d="M3.2 10.2h17.6M7 14.4h5.4M15.4 14.4h2.2" strokeLinecap="round" />
    </>
  ),
  // Panah keluar dari kotak: menegaskan tautannya MENINGGALKAN panel ini.
  keluar: (
    <>
      <path
        d="M13.4 4.6H5.6a1.6 1.6 0 0 0-1.6 1.6v12a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-7.8"
        strokeLinecap="round"
      />
      <path d="M14.2 4.6h5.2v5.2M19.4 4.6 11 13" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  menu: (
    <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
  ),
};

export function Ikon({ nama, className }: { nama: NamaIkon; className?: string }) {
  // Lambang teratai dipakai ulang dari komponen bersama — path SVG-nya
  // sengaja tidak disalin ke berkas ini.
  if (nama === "lotus") return <Lotus className={className} />;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      {PATH[nama]}
    </svg>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/ikon.tsx tests/panel-primitif.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): satu peta ikon untuk kedua panel staf

nav-admin dan nav-owner masing-masing punya fungsi Ikon sendiri, dengan
Lotus dibagi tapi sisanya disalin. Dua salinan berpisah diam-diam: yang
berubah cuma satu panel, dan tidak ada yang merah.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Sidebar + penanda aktif + badge

**Files:**
- Create: `web/src/app/_shell/panel/aktif.ts`
- Create: `web/src/app/_shell/panel/badge.tsx`
- Create: `web/src/app/_shell/panel/sidebar.tsx`
- Test: `web/tests/panel-primitif.test.ts` (modify)

**Interfaces:**
- Consumes: `Ikon`, `NamaIkon` (Task 2); token panel (Task 1).
- Produces:
  - `aktifkan(pathname: string, href: string, akar: string): boolean`
  - `<Badge jumlah={number} />` — `null` bila `jumlah <= 0`
  - `type ItemMenu = { href: string; label: string; ikon: NamaIkon; jumlah?: number }`
  - `type Tautan = { href: string; label: string; ikon: NamaIkon }`
  - `<Sidebar menu akar pathname namaPanel labelNav terbuka jalanKeluar? />`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/panel-primitif.test.ts`:

```ts
const { aktifkan } = await import("@/app/_shell/panel/aktif");
const { Badge } = await import("@/app/_shell/panel/badge");
const { Sidebar } = await import("@/app/_shell/panel/sidebar");

const MENU_UJI = [
  { href: "/uji", label: "Beranda", ikon: "lotus" as const },
  { href: "/uji/kotak", label: "Kotak", ikon: "inbox" as const, jumlah: 3 },
  { href: "/uji/orang", label: "Orang", ikon: "user" as const, jumlah: 0 },
];

function markupSidebar(pathname: string, tambahan: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(Sidebar, {
      menu: MENU_UJI,
      akar: "/uji",
      pathname,
      namaPanel: "Panel Uji",
      labelNav: "Menu panel uji",
      terbuka: false,
      ...tambahan,
    } as never),
  );
}

describe("aktifkan — penanda tujuan aktif", () => {
  it("akar hanya menyala pada kecocokan PERSIS", () => {
    expect(aktifkan("/uji", "/uji", "/uji")).toBe(true);
    // Tanpa perlakuan khusus, startsWith membuat akar menyala di SEMUA sub-rute
    // — "semua tab menyala" adalah bug yang paling gampang lolos.
    expect(aktifkan("/uji/kotak", "/uji", "/uji")).toBe(false);
  });

  it("sub-rute menyalakan tujuan induknya", () => {
    expect(aktifkan("/uji/kotak", "/uji/kotak", "/uji")).toBe(true);
    expect(aktifkan("/uji/kotak/123", "/uji/kotak", "/uji")).toBe(true);
  });

  it("kecocokan segmen, bukan awalan string", () => {
    // "/uji/kotakan" TIDAK boleh menyalakan "/uji/kotak".
    expect(aktifkan("/uji/kotakan", "/uji/kotak", "/uji")).toBe(false);
  });
});

describe("Badge antrean", () => {
  it("HILANG saat nol — alarm yang dinormalkan berhenti berarti", () => {
    expect(renderToStaticMarkup(createElement(Badge, { jumlah: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(Badge, { jumlah: -2 }))).toBe("");
  });

  it("menyebut jumlahnya untuk pembaca layar", () => {
    const m = renderToStaticMarkup(createElement(Badge, { jumlah: 4 }));
    expect(m).toContain('aria-label="4 menunggu"');
    expect(m).toContain(">4<");
  });
});

describe("Sidebar", () => {
  it("client component (butuh Link & kelas interaktif)", () => {
    const sumber = baca("src/app/_shell/panel/sidebar.tsx");
    expect(sumber.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("merender SATU nav berlabel, berisi satu tautan per tujuan", () => {
    const m = markupSidebar("/uji");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(1);
    expect(m).toContain('aria-label="Menu panel uji"');
    expect([...m.matchAll(/<a\b/g)]).toHaveLength(MENU_UJI.length);
    for (const item of MENU_UJI) {
      expect(m).toContain(`href="${item.href}"`);
      expect(m).toContain(item.label);
    }
  });

  it("hanya SATU tujuan aktif, dan bukan akar saat berada di sub-rute", () => {
    const m = markupSidebar("/uji/kotak");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/uji"') && !tag.includes("/uji/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("badge muncul hanya untuk tujuan yang punya antrean", () => {
    const m = markupSidebar("/uji");
    expect([...m.matchAll(/aria-label="\d+ menunggu"/g)]).toHaveLength(1);
    expect(m).toContain('aria-label="3 menunggu"');
  });

  it("tergeser keluar layar saat tertutup, dan masuk saat terbuka", () => {
    // Sidebar dirender SEKALI lalu digeser — bukan dirender dua kali untuk
    // desktop dan drawer. Dua salinan berarti tautan ganda dan fokus yang
    // bisa mendarat di elemen tak terlihat.
    expect(markupSidebar("/uji")).toContain("-translate-x-full");
    expect(markupSidebar("/uji", { terbuka: true })).toContain("translate-x-0");
    expect(markupSidebar("/uji")).toContain("lg:translate-x-0");
  });

  it("jalan keluar bukan tujuan: tidak pernah ber-aria-current", () => {
    const keluar = { href: "/luar", label: "Buka Panel Lain", ikon: "keluar" as const };
    for (const p of ["/uji", "/uji/kotak", "/uji/orang"]) {
      const m = markupSidebar(p, { jalanKeluar: keluar });
      expect(m).toContain('href="/luar"');
      for (const tag of m.match(/<a[^>]*>/g) ?? []) {
        if (tag.includes('href="/luar"')) {
          expect(tag).not.toContain('aria-current="page"');
        }
      }
    }
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/aktif` tidak ditemukan.

- [ ] **Step 3a: Buat `web/src/app/_shell/panel/aktif.ts`**

```ts
/**
 * Penanda tujuan aktif — satu untuk kedua panel.
 *
 * `pathname.startsWith(akar)` cocok untuk SELURUH sub-rute, jadi tujuan akar
 * ("Beranda") diperiksa dengan kesamaan persis. Tanpa itu, seluruh menu
 * menyala di setiap halaman dan penanda "kamu di sini" berhenti berarti.
 *
 * Perbandingan sub-rute memakai batas segmen (`${href}/`), bukan awalan
 * string: tanpa itu `/admin/klienbaru` akan menyalakan tab `/admin/klien`.
 */
export function aktifkan(pathname: string, href: string, akar: string): boolean {
  if (href === akar) return pathname === akar;
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 3b: Buat `web/src/app/_shell/panel/badge.tsx`**

```tsx
/**
 * Badge antrean. Sengaja HILANG saat nol: badge "0" yang selalu tampil
 * membuat panel terlihat selalu punya pekerjaan, dan alarm yang dinormalkan
 * berhenti dipercaya — termasuk saat ia benar.
 *
 * Angkanya SELALU datang sebagai prop dari server. Badge tidak pernah
 * menghitung apa pun sendiri.
 */
export function Badge({ jumlah }: { jumlah: number }) {
  if (jumlah <= 0) return null;
  return (
    <span
      aria-label={`${jumlah} menunggu`}
      className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-clay px-1.5 text-[10px] font-extrabold tabular-nums text-white"
    >
      {jumlah}
    </span>
  );
}
```

- [ ] **Step 3c: Buat `web/src/app/_shell/panel/sidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { Ikon, type NamaIkon } from "./ikon";
import { aktifkan } from "./aktif";
import { Badge } from "./badge";

/**
 * Satu tujuan di menu panel. `jumlah` sudah berupa ANGKA, bukan kunci ke
 * struktur antrean mana pun: primitif ini tidak boleh tahu bentuk data panel
 * yang memakainya, dan tidak boleh mengambil datanya sendiri.
 */
export type ItemMenu = {
  href: string;
  label: string;
  ikon: NamaIkon;
  jumlah?: number;
};

/** Tautan yang MENINGGALKAN panel ini — bukan tujuan, jadi tidak pernah aktif. */
export type Tautan = { href: string; label: string; ikon: NamaIkon };

/**
 * Sidebar gelap panel staf.
 *
 * Dirender SEKALI lalu digeser (`-translate-x-full` → `translate-x-0`), bukan
 * dirender dua kali untuk desktop dan drawer. Dua salinan berarti setiap
 * tautan hadir dua kali di DOM: fokus keyboard bisa mendarat di salinan yang
 * tidak terlihat, dan pembaca layar mengumumkan seluruh menu dua kali.
 */
export function Sidebar({
  menu,
  akar,
  pathname,
  namaPanel,
  labelNav,
  terbuka,
  jalanKeluar,
}: {
  menu: ItemMenu[];
  akar: string;
  pathname: string;
  namaPanel: string;
  labelNav: string;
  terbuka: boolean;
  jalanKeluar?: Tautan;
}) {
  return (
    <nav
      id="sidebar-panel"
      aria-label={labelNav}
      className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-panel-rail transition-transform duration-200 motion-reduce:transition-none lg:translate-x-0 ${
        terbuka ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        {/* Lambang tetap teratai VEKTOR, bukan logo raster dari klien: berkas
            logo itu berlatar hijau bertekstur tanpa transparansi dan teks
            melingkarnya hilang di bawah ~120px. Lihat §7 spec. */}
        <Ikon nama="lotus" className="h-7 w-7 shrink-0 text-gold-bright" />
        <span className="min-w-0">
          <span className="block text-[15px] font-extrabold tracking-[0.14em] text-gold-pale">
            PADMA
          </span>
          <span className="block truncate text-[11px] font-bold text-panel-rail-ink">
            {namaPanel}
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        {menu.map((m) => {
          const aktif = aktifkan(pathname, m.href, akar);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={aktif ? "page" : undefined}
              className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-bold transition ${
                aktif
                  ? "bg-white/10 text-panel-rail-aktif"
                  : "text-panel-rail-ink hover:bg-white/5 hover:text-panel-rail-aktif"
              }`}
            >
              {aktif && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-gold-bright"
                />
              )}
              <Ikon nama={m.ikon} className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1 truncate">{m.label}</span>
              <Badge jumlah={m.jumlah ?? 0} />
            </Link>
          );
        })}
      </div>

      {jalanKeluar && (
        <div className="border-t border-white/10 px-2.5 py-3">
          <Link
            href={jalanKeluar.href}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-bold text-gold-bright transition hover:bg-white/5"
          >
            <Ikon nama={jalanKeluar.ikon} className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{jalanKeluar.label}</span>
          </Link>
        </div>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: PASS (13 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/aktif.ts src/app/_shell/panel/badge.tsx src/app/_shell/panel/sidebar.tsx tests/panel-primitif.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): sidebar gelap, penanda aktif, dan badge antrean

Sidebar dirender SEKALI lalu digeser, bukan dua kali untuk desktop dan
drawer: dua salinan berarti setiap tautan hadir dua kali di DOM, fokus
keyboard bisa mendarat di salinan tak terlihat, dan pembaca layar
mengumumkan seluruh menu dua kali.

aktifkan() membandingkan batas segmen, bukan awalan string — tanpa itu
/admin/klienbaru menyalakan tab /admin/klien.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Topbar

**Files:**
- Create: `web/src/app/_shell/panel/topbar.tsx`
- Test: `web/tests/panel-primitif.test.ts` (modify)

**Interfaces:**
- Consumes: `Ikon` (Task 2), `MenuAkun` dari `@/app/_shell/menu-akun` (sudah ada).
- Produces: `<Topbar judul nama peran drawerBuka onToggleDrawer />`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/panel-primitif.test.ts`:

```ts
const { Topbar } = await import("@/app/_shell/panel/topbar");

function markupTopbar(tambahan: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(Topbar, {
      judul: "Klien",
      nama: "Admin PADMA",
      peran: "Admin",
      drawerBuka: false,
      onToggleDrawer: () => {},
      ...tambahan,
    } as never),
  );
}

describe("Topbar", () => {
  it("membawa identitas & jalan keluar lewat MenuAkun yang sudah ada", () => {
    const m = markupTopbar();
    // Frasa utuhnya hidup sebagai nama aksesibel tombol MenuAkun.
    expect(m).toContain("Masuk sebagai Admin PADMA · Admin");
    const sumber = baca("src/app/_shell/panel/topbar.tsx");
    expect(sumber).toMatch(/from\s+["']@\/app\/_shell\/menu-akun["']/);
    // Jalan keluar tidak boleh ditulis ulang di sini: logout WAJIB tetap
    // <form method="post"> supaya Client Cache pemakai sebelumnya terhapus.
    expect(sumber).not.toContain("/auth/keluar");
  });

  it("tombol drawer mengumumkan apa yang ia kendalikan dan keadaannya", () => {
    const tutup = markupTopbar();
    expect(tutup).toContain('aria-controls="sidebar-panel"');
    expect(tutup).toContain('aria-expanded="false"');
    expect(tutup).toContain('aria-label="Buka menu"');
    const buka = markupTopbar({ drawerBuka: true });
    expect(buka).toContain('aria-expanded="true"');
    expect(buka).toContain('aria-label="Tutup menu"');
  });

  it("tombol drawer hanya untuk layar kecil", () => {
    expect(markupTopbar()).toContain("lg:hidden");
  });

  it("menyebut tujuan yang sedang dibuka — di layar kecil sidebar tidak terlihat", () => {
    expect(markupTopbar({ judul: "Pembayaran" })).toContain("Pembayaran");
  });

  it("BUKAN <h1>: judul halaman milik halaman, bukan milik kerangka", () => {
    // Setiap halaman panel sudah merender <main><h1> sendiri. <h1> kedua di
    // kerangka membuat dua judul tingkat satu di setiap halaman.
    expect(markupTopbar()).not.toContain("<h1");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/topbar` tidak ditemukan.

- [ ] **Step 3: Buat `web/src/app/_shell/panel/topbar.tsx`**

```tsx
"use client";

import { MenuAkun } from "@/app/_shell/menu-akun";
import { Ikon } from "./ikon";

/**
 * Strip terang di atas area kerja: tombol drawer (hanya layar kecil), nama
 * tujuan yang sedang dibuka, dan identitas pemakai.
 *
 * `judul` disebut di sini karena di layar kecil sidebar tersembunyi — tanpa
 * itu tidak ada penanda "kamu di sini" sama sekali. Ia sengaja BUKAN <h1>:
 * setiap halaman panel sudah merender <main><h1> miliknya sendiri.
 *
 * Identitas & logout dipakai ulang dari `MenuAkun`, tidak ditulis ulang.
 * Logout di sana adalah <form method="post"> — navigasi dokumen penuh yang
 * menghapus Client Cache; menyalinnya sebagai tautan biasa akan meninggalkan
 * sisa data pemakai sebelumnya, dan di panel owner sisa itu berupa nominal.
 */
export function Topbar({
  judul,
  nama,
  peran,
  drawerBuka,
  onToggleDrawer,
}: {
  judul: string;
  nama: string;
  peran: string;
  drawerBuka: boolean;
  onToggleDrawer: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-panel-border bg-panel-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={onToggleDrawer}
        aria-controls="sidebar-panel"
        aria-expanded={drawerBuka}
        aria-label={drawerBuka ? "Tutup menu" : "Buka menu"}
        className="-ml-1.5 rounded-lg p-2 text-panel-muted transition hover:bg-black/5 hover:text-panel-ink lg:hidden"
      >
        <Ikon nama="menu" className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-panel-ink">
        {judul}
      </span>
      <MenuAkun nama={nama} peran={peran} />
    </header>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: PASS (18 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/topbar.tsx tests/panel-primitif.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): topbar dengan tombol drawer dan identitas pemakai

Judul tujuan disebut di topbar karena di layar kecil sidebar tersembunyi
— tanpa itu tidak ada penanda "kamu di sini" sama sekali. Sengaja bukan
<h1>: setiap halaman panel sudah merender h1 miliknya sendiri.

MenuAkun dipakai ulang, tidak ditulis ulang: logout di sana adalah
<form method="post"> yang menghapus Client Cache.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Bottom bar layar kecil

**Files:**
- Create: `web/src/app/_shell/panel/bottom-bar.tsx`
- Test: `web/tests/panel-primitif.test.ts` (modify)

**Interfaces:**
- Consumes: `ItemMenu`, `Tautan` (Task 3), `aktifkan`, `Badge`, `Ikon`.
- Produces: `<BottomBar menu akar pathname labelNav jalanKeluar? />`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/panel-primitif.test.ts`:

```ts
const { BottomBar } = await import("@/app/_shell/panel/bottom-bar");

function markupBottomBar(pathname: string, tambahan: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(BottomBar, {
      menu: MENU_UJI,
      akar: "/uji",
      pathname,
      labelNav: "Navigasi panel uji",
      ...tambahan,
    } as never),
  );
}

describe("BottomBar", () => {
  it("satu nav berlabel, hanya untuk layar kecil", () => {
    const m = markupBottomBar("/uji");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(1);
    expect(m).toContain('aria-label="Navigasi panel uji"');
    expect(m).toContain("lg:hidden");
  });

  it("memakai penanda aktif yang sama dengan sidebar", () => {
    const m = markupBottomBar("/uji/kotak");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/uji"') && !tag.includes("/uji/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("badge ikut tampil di sini — antrean tidak boleh hanya terlihat di desktop", () => {
    const m = markupBottomBar("/uji");
    expect(m).toContain('aria-label="3 menunggu"');
    expect([...m.matchAll(/aria-label="\d+ menunggu"/g)]).toHaveLength(1);
  });

  it("jalan keluar ikut tersedia dan tetap bukan tujuan aktif", () => {
    const keluar = { href: "/luar", label: "Buka Panel Lain", ikon: "keluar" as const };
    const m = markupBottomBar("/uji", { jalanKeluar: keluar });
    expect(m).toContain('href="/luar"');
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/luar"')) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/bottom-bar` tidak ditemukan.

- [ ] **Step 3: Buat `web/src/app/_shell/panel/bottom-bar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { Ikon } from "./ikon";
import { aktifkan } from "./aktif";
import { Badge } from "./badge";
import type { ItemMenu, Tautan } from "./sidebar";

/**
 * Bar bawah layar kecil.
 *
 * Ia BUKAN salinan seluruh menu: drawer sudah memuat semuanya. Yang tinggal
 * di sini hanya tujuan tersibuk, supaya staf yang bekerja dari HP tidak
 * kehilangan satu ketukan untuk pekerjaan yang paling sering dilakukan.
 *
 * Badge ikut tampil di sini: antrean yang hanya terlihat di desktop adalah
 * antrean yang tidak terlihat, sebab panel ini memang dipakai dari HP.
 */
export function BottomBar({
  menu,
  akar,
  pathname,
  labelNav,
  jalanKeluar,
}: {
  menu: ItemMenu[];
  akar: string;
  pathname: string;
  labelNav: string;
  jalanKeluar?: Tautan;
}) {
  return (
    <nav
      aria-label={labelNav}
      className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-gold/25 bg-panel-rail/95 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
    >
      {menu.map((m) => {
        const aktif = aktifkan(pathname, m.href, akar);
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={aktif ? "page" : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold ${
              aktif ? "text-gold-bright" : "text-panel-rail-ink"
            }`}
          >
            <span className="relative">
              <Ikon nama={m.ikon} className="h-[21px] w-[21px]" />
              <span className="absolute -right-2.5 -top-1.5">
                <Badge jumlah={m.jumlah ?? 0} />
              </span>
            </span>
            <span className="truncate">{m.label}</span>
          </Link>
        );
      })}

      {jalanKeluar && (
        <Link
          href={jalanKeluar.href}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold text-gold-pale"
        >
          <Ikon nama={jalanKeluar.ikon} className="h-[21px] w-[21px]" />
          <span className="truncate">{jalanKeluar.label}</span>
        </Link>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: PASS (22 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/bottom-bar.tsx tests/panel-primitif.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): bottom bar layar kecil untuk tujuan tersibuk

Bukan salinan seluruh menu — drawer sudah memuat semuanya. Badge ikut
tampil di sini: antrean yang hanya terlihat di desktop adalah antrean
yang tidak terlihat, sebab panel ini memang dipakai dari HP.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: KerangkaPanel — perakit + perilaku drawer

**Files:**
- Create: `web/src/app/_shell/panel/tutup-drawer.ts`
- Create: `web/src/app/_shell/panel/kerangka.tsx`
- Test: `web/tests/panel-primitif.test.ts` (modify)

**Interfaces:**
- Consumes: `Sidebar`, `Topbar`, `BottomBar`, `aktifkan`, `ItemMenu`, `Tautan`.
- Produces:
  - `pasangPenutup(dok: DokumenMinimal, tutup: () => void): () => void`
  - `<KerangkaPanel menu menuRingkas akar namaPanel labelSidebar labelBottomBar nama peran catatan jalanKeluar?>{children}</KerangkaPanel>` — dipakai Task 7 & 8.

**Batas yang diakui:** repo ini berjalan di `environment: "node"` tanpa jsdom, jadi klik dan tombol Escape sungguhan tidak bisa disimulasikan. Karena itu logika penutup diekstrak menjadi fungsi murni `pasangPenutup` yang diuji dengan dokumen palsu, dan penutupan-saat-rute-berganti dikunci lewat asersi sumber. Ini lubang yang disadari, bukan yang terlewat.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/panel-primitif.test.ts`:

```ts
const { pasangPenutup } = await import("@/app/_shell/panel/tutup-drawer");
const { KerangkaPanel } = await import("@/app/_shell/panel/kerangka");

/** Dokumen palsu: mencatat listener yang dipasang & dilepas. */
function dokumenPalsu() {
  const listener = new Map<string, (e: unknown) => void>();
  const dilepas: string[] = [];
  return {
    listener,
    dilepas,
    addEventListener: (jenis: string, fn: (e: unknown) => void) => {
      listener.set(jenis, fn);
    },
    removeEventListener: (jenis: string) => {
      dilepas.push(jenis);
    },
  };
}

describe("pasangPenutup — perilaku drawer", () => {
  it("Escape menutup drawer", () => {
    const dok = dokumenPalsu();
    let tertutup = 0;
    pasangPenutup(dok, () => (tertutup += 1));
    dok.listener.get("keydown")?.({ key: "Escape" });
    expect(tertutup).toBe(1);
  });

  it("tombol lain tidak menutup apa pun", () => {
    const dok = dokumenPalsu();
    let tertutup = 0;
    pasangPenutup(dok, () => (tertutup += 1));
    dok.listener.get("keydown")?.({ key: "a" });
    dok.listener.get("keydown")?.({ key: "Enter" });
    expect(tertutup).toBe(0);
  });

  it("melepas listener-nya saat dibersihkan — drawer bisa dibuka-tutup berkali-kali", () => {
    const dok = dokumenPalsu();
    const lepas = pasangPenutup(dok, () => {});
    lepas();
    expect(dok.dilepas).toContain("keydown");
  });
});

describe("KerangkaPanel", () => {
  const sumber = baca("src/app/_shell/panel/kerangka.tsx");

  function markupKerangka(pathname: string, tambahan: Record<string, unknown> = {}) {
    rute.kini = pathname;
    return renderToStaticMarkup(
      createElement(KerangkaPanel, {
        menu: MENU_UJI,
        menuRingkas: MENU_UJI.slice(1),
        akar: "/uji",
        namaPanel: "Panel Uji",
        labelSidebar: "Menu panel uji",
        labelBottomBar: "Navigasi panel uji",
        nama: "Pemakai Uji",
        peran: "Uji",
        catatan: "CATATAN-UJI",
        children: createElement("p", null, "ISI-UJI"),
        ...tambahan,
      } as never),
    );
  }

  it("merender isi halaman, sidebar, bottom bar, dan catatan kaki", () => {
    const m = markupKerangka("/uji");
    expect(m).toContain("ISI-UJI");
    expect(m).toContain("CATATAN-UJI");
    // Tepat dua nav: sidebar (yang sekaligus jadi drawer) + bottom bar.
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
  });

  it("judul topbar mengikuti tujuan yang sedang dibuka", () => {
    expect(markupKerangka("/uji/kotak")).toContain("Kotak");
    // Di luar seluruh tujuan, jatuh kembali ke nama panel — bukan string kosong.
    expect(markupKerangka("/uji/entah")).toContain("Panel Uji");
  });

  it("drawer tertutup saat rute berganti", () => {
    // Tanpa ini, mengetuk satu tujuan meninggalkan panel gelap menutupi
    // halaman yang baru saja dibuka. Dikunci lewat sumber: repo ini berjalan
    // tanpa jsdom, jadi klik sungguhan tidak bisa disimulasikan.
    expect(sumber).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*setBuka\(false\);?\s*\}\s*,\s*\[pathname\]\s*\)/);
  });

  it("BUKA PERAN: primitif panel tidak tahu bedanya admin dan owner", () => {
    // Begitu satu berkas di sini tahu peran, pemisahan fisik money firewall
    // berubah menjadi satu kondisional yang bisa salah tulis dalam satu
    // karakter — dan yang bocor adalah seluruh nominal PADMA.
    for (const berkas of [
      "src/app/_shell/panel/ikon.tsx",
      "src/app/_shell/panel/aktif.ts",
      "src/app/_shell/panel/badge.tsx",
      "src/app/_shell/panel/sidebar.tsx",
      "src/app/_shell/panel/topbar.tsx",
      "src/app/_shell/panel/bottom-bar.tsx",
      "src/app/_shell/panel/tutup-drawer.ts",
      "src/app/_shell/panel/kerangka.tsx",
    ]) {
      const isi = baca(berkas);
      expect(isi, `${berkas} menyebut peran`).not.toMatch(/"(admin|owner)"/);
      expect(isi, `${berkas} mengimpor penjaga peran`).not.toContain("requireRole");
      expect(isi, `${berkas} memakai service role`).not.toContain("createAdminSupabase");
      expect(isi, `${berkas} menyebut nominal`).not.toMatch(/Rp\s?\d|formatRupiah/);
    }
  });
});
```

Test di atas memakai `rute.kini`. Ubah baris import Vitest yang sudah ada di bagian atas berkas menjadi `import { describe, it, expect, vi } from "vitest";` (jangan menambah baris import kedua), lalu sisipkan mock berikut tepat di bawah blok import:

```ts
// usePathname hanya hidup di dalam App Router. `vi.mock` diangkat ke atas
// berkas oleh Vitest, jadi letaknya di sini tetap berlaku untuk seluruh
// `await import(...)` di atasnya.
const rute = vi.hoisted(() => ({ kini: "/uji" }));
vi.mock("next/navigation", () => ({
  usePathname: () => rute.kini,
}));
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/tutup-drawer` tidak ditemukan.

- [ ] **Step 3a: Buat `web/src/app/_shell/panel/tutup-drawer.ts`**

```ts
/**
 * Bentuk minimal `document` yang dibutuhkan penutup drawer.
 *
 * Dituliskan sebagai tipe sendiri supaya perilakunya bisa diuji dengan
 * dokumen palsu: suite ini berjalan di `environment: "node"` tanpa jsdom, dan
 * menambah jsdom hanya demi satu tombol Escape bukan tukar yang setara.
 */
export type DokumenMinimal = {
  addEventListener: (jenis: string, fn: (e: never) => void) => void;
  removeEventListener: (jenis: string, fn: (e: never) => void) => void;
};

/**
 * Memasang jalan keluar keyboard untuk drawer, mengembalikan pembersihnya.
 *
 * Escape adalah satu-satunya jalan keluar bagi pemakai keyboard: overlay hanya
 * bisa diklik, dan tanpa ini drawer yang terbuka mengunci layar sampai
 * halaman dimuat ulang.
 */
export function pasangPenutup(dok: DokumenMinimal, tutup: () => void): () => void {
  const padaTombol = (e: { key: string }) => {
    if (e.key === "Escape") tutup();
  };
  dok.addEventListener("keydown", padaTombol as (e: never) => void);
  return () => dok.removeEventListener("keydown", padaTombol as (e: never) => void);
}
```

- [ ] **Step 3b: Buat `web/src/app/_shell/panel/kerangka.tsx`**

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, type ItemMenu, type Tautan } from "./sidebar";
import { BottomBar } from "./bottom-bar";
import { Topbar } from "./topbar";
import { aktifkan } from "./aktif";
import { pasangPenutup } from "./tutup-drawer";

/**
 * Kerangka satu panel staf: sidebar + topbar + bottom bar + area kerja.
 *
 * BUTA PERAN — komponen ini tidak tahu bedanya admin dan owner. Daftar menu,
 * nama panel, dan catatan kaki semuanya datang sebagai prop dari shell
 * masing-masing panel, yang memegang penjaga perannya sendiri. Itu bukan
 * kerapian yang dikorbankan: money firewall PADMA bersifat FISIK, dan satu
 * daftar menu bersama akan menguranginya menjadi satu kondisional peran.
 *
 * Area kerja sengaja bukan <main>: setiap halaman panel sudah merender
 * <main> miliknya sendiri, dan <main> bersarang bukan HTML yang sah.
 */
export function KerangkaPanel({
  menu,
  menuRingkas,
  akar,
  namaPanel,
  labelSidebar,
  labelBottomBar,
  nama,
  peran,
  catatan,
  jalanKeluar,
  children,
}: {
  menu: ItemMenu[];
  /** Tujuan tersibuk untuk bar bawah layar kecil; selebihnya lewat drawer. */
  menuRingkas: ItemMenu[];
  akar: string;
  namaPanel: string;
  labelSidebar: string;
  labelBottomBar: string;
  nama: string;
  peran: string;
  catatan: ReactNode;
  jalanKeluar?: Tautan;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [buka, setBuka] = useState(false);

  // Drawer tertutup setiap kali rute berganti. Tanpa ini, mengetuk satu tujuan
  // meninggalkan panel gelap menutupi halaman yang baru saja dibuka.
  useEffect(() => {
    setBuka(false);
  }, [pathname]);

  useEffect(() => {
    if (!buka) return;
    return pasangPenutup(document, () => setBuka(false));
  }, [buka]);

  // Di layar kecil sidebar tersembunyi, jadi topbar yang menyebut tujuan aktif.
  // Di luar seluruh tujuan, nama panel dipakai — bukan judul kosong.
  const judul = menu.find((m) => aktifkan(pathname, m.href, akar))?.label ?? namaPanel;

  return (
    <div className="min-h-screen bg-panel-bg lg:pl-60">
      <Sidebar
        menu={menu}
        akar={akar}
        pathname={pathname}
        namaPanel={namaPanel}
        labelNav={labelSidebar}
        terbuka={buka}
        jalanKeluar={jalanKeluar}
      />

      {buka && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setBuka(false)}
          className="fixed inset-0 z-30 bg-night/45 lg:hidden"
        />
      )}

      <Topbar
        judul={judul}
        nama={nama}
        peran={peran}
        drawerBuka={buka}
        onToggleDrawer={() => setBuka((v) => !v)}
      />

      <div className="px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {children}
        <div className="mt-10 border-t border-panel-border pt-4 text-[11.5px] leading-relaxed text-panel-muted">
          {catatan}
        </div>
      </div>

      <BottomBar
        menu={menuRingkas}
        akar={akar}
        pathname={pathname}
        labelNav={labelBottomBar}
        jalanKeluar={jalanKeluar}
      />
    </div>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-primitif.test.ts`
Expected: PASS (30 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/tutup-drawer.ts src/app/_shell/panel/kerangka.tsx tests/panel-primitif.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): KerangkaPanel — perakit sidebar, topbar, drawer, bottom bar

Buta peran: daftar menu, nama panel, dan catatan kaki datang sebagai
prop dari shell masing-masing panel. Money firewall PADMA bersifat
FISIK; satu daftar menu bersama akan menguranginya jadi satu kondisional
peran yang bisa salah tulis dalam satu karakter.

Perilaku Escape diekstrak ke fungsi murni pasangPenutup supaya bisa
diuji tanpa jsdom — repo ini berjalan di environment "node".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Shell panel admin

**Files:**
- Modify: `web/src/app/admin/_shell/nav-admin.tsx` (tulis ulang isinya)
- Modify: `web/src/app/admin/layout.tsx`
- Test: `web/tests/admin-shell.test.ts` (tulis ulang bagian `describe("navigasi admin")` dan asersi bentuk di `describe("layout admin")`)

**Interfaces:**
- Consumes: `KerangkaPanel` (Task 6), `ItemMenu` (Task 3).
- Produces: `<NavAdmin antrean={antrean} nama peran>{children}</NavAdmin>` — layout kini membungkus `children` dengannya.

- [ ] **Step 1: Tulis ulang test navigasi admin (akan MERAH)**

Di `web/tests/admin-shell.test.ts`, ganti seluruh isi `describe("navigasi admin", ...)` dengan:

```ts
describe("navigasi admin", () => {
  const sumberNav = baca("src/app/admin/_shell/nav-admin.tsx");

  it("client component (butuh usePathname lewat KerangkaPanel)", () => {
    expect(sumberNav.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("memuat sembilan tujuan berbahasa Indonesia di sidebar", () => {
    const m = markupNav("/admin");
    const tujuan = [
      ["/admin", "Beranda"],
      ["/admin/skrining", "Inbox"],
      ["/admin/klien", "Klien"],
      ["/admin/sesi", "Sesi"],
      ["/admin/bayar", "Bayar"],
      ["/admin/mitra", "Mitra"],
      ["/admin/layanan", "Layanan"],
      ["/admin/materi", "Materi"],
      ["/admin/pengaturan", "Setelan"],
    ];
    for (const [href, label] of tujuan) {
      expect(m).toContain(`href="${href}"`);
      expect(m).toContain(label);
    }
    // Sembilan tautan sidebar + empat tautan bar bawah. Dikunci PERSIS:
    // tujuan yang lahir tanpa memperbarui daftar di atas akan lolos dari
    // seluruh assertion `toContain` tanpa satu pun test merah.
    expect([...m.matchAll(/<a\b/g)]).toHaveLength(9 + 4);
  });

  it("bar bawah memuat empat tujuan tersibuk, bukan salinan seluruh menu", () => {
    const m = markupNav("/admin");
    // Empat tujuan tersibuk hadir DUA kali (sidebar + bar bawah);
    // sisanya sekali, hanya di sidebar yang di layar kecil jadi drawer.
    for (const href of ["/admin/skrining", "/admin/klien", "/admin/sesi", "/admin/bayar"]) {
      expect([...m.matchAll(new RegExp(`href="${href}"`, "g"))], href).toHaveLength(2);
    }
    for (const href of ["/admin/mitra", "/admin/layanan", "/admin/materi", "/admin/pengaturan"]) {
      expect([...m.matchAll(new RegExp(`href="${href}"`, "g"))], href).toHaveLength(1);
    }
  });

  it("menyediakan sidebar DAN bar bawah, masing-masing berlabel", () => {
    const m = markupNav("/admin");
    // Sidebar dirender sekali dan menjadi drawer di layar kecil; bar bawah
    // adalah nav kedua. Tiga nav berarti sidebar tersalin dua kali.
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect([...m.matchAll(/aria-label="[^"]+"/g)].length).toBeGreaterThanOrEqual(2);
    expect(m).toContain("lg:hidden"); // bar bawah & tombol drawer
    expect(m).toContain("lg:translate-x-0"); // sidebar menetap di layar besar
  });

  it("badge HILANG saat antrean nol (alarm tidak dinormalkan)", () => {
    const m = markupNav("/admin", NOL);
    expect(m).not.toContain("menunggu");
    expect(m).not.toMatch(/>0</);
  });

  it("badge menampilkan angka nyata untuk tiap tujuan yang punya antrean", () => {
    const m = markupNav("/admin", {
      skriningBaru: 3,
      permintaanMenunggu: 5,
      klaimMenunggu: 9,
      klienBelumAktif: 7,
    });
    // Keempat tujuan berbadge ada di sidebar DAN bar bawah -> dua kali.
    expect([...m.matchAll(/aria-label="3 menunggu"/g)]).toHaveLength(2); // Inbox
    expect([...m.matchAll(/aria-label="7 menunggu"/g)]).toHaveLength(2); // Klien
    expect([...m.matchAll(/aria-label="5 menunggu"/g)]).toHaveLength(2); // Sesi
    expect([...m.matchAll(/aria-label="9 menunggu"/g)]).toHaveLength(2); // Bayar
    for (const tag of m.match(/<a[^>]*>[\s\S]*?<\/a>/g) ?? []) {
      if (tag.includes('aria-label="9 menunggu"')) {
        expect(tag).toContain('href="/admin/bayar"');
      }
    }
  });

  it("badge nol tetap hilang walau tujuan lain punya antrean", () => {
    const m = markupNav("/admin", { ...NOL, skriningBaru: 2 });
    expect([...m.matchAll(/aria-label="\d+ menunggu"/g)]).toHaveLength(2);
  });

  it("angka badge datang dari prop, bukan literal di dalam nav", () => {
    // Nav adalah client component: ia tidak boleh mengambil datanya sendiri,
    // dan tidak boleh menuliskan angka antrean sebagai konstanta.
    expect(sumberNav).not.toContain("hitungAntrean");
    expect(sumberNav).toContain("antrean[");
  });

  it("hanya SATU tujuan yang aktif di beranda", () => {
    const m = markupNav("/admin");
    // Beranda hanya ada di sidebar (bukan tujuan bar bawah), jadi satu.
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(1);
  });

  it("sub-rute menyalakan tujuannya sendiri, bukan Beranda", () => {
    const m = markupNav("/admin/skrining");
    // Inbox hadir di sidebar dan bar bawah -> dua penanda aktif.
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/admin"') && !tag.includes("/admin/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("rute anak (detail klien) tetap menyalakan tujuan Klien", () => {
    const m = markupNav(`/admin/klien/${KLIEN_UJI}`);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/admin/klien"')) {
        expect(tag).toContain('aria-current="page"');
      }
    }
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("tidak ada nominal uang di navigasi (money firewall)", () => {
    const m = markupNav("/admin", {
      skriningBaru: 1,
      permintaanMenunggu: 1,
      klaimMenunggu: 1,
      klienBelumAktif: 1,
    });
    expect(m).not.toMatch(/Rp\s?\d/);
    expect(sumberNav).not.toMatch(/Rp\s?\d/);
  });
});
```

Ubah juga helper `markupNav` di berkas yang sama supaya meneruskan `children` (NavAdmin kini membungkus isi halaman):

```ts
function markupNav(pathname: string, antrean: Antrean = NOL): string {
  rute.kini = pathname;
  return renderToStaticMarkup(
    createElement(NavAdmin, {
      antrean,
      nama: "Admin PADMA",
      peran: "Admin",
      children: null,
    }),
  );
}
```

Dan di `describe("layout admin")`, ganti dua asersi bentuk berikut:

```ts
  it("mengambil antrean di server lalu meneruskannya ke nav sebagai prop", () => {
    expect(sumberLayout).toMatch(
      /import\s*\{[^}]*\bhitungAntrean\b[^}]*\}\s*from\s*["']@\/lib\/admin\/antrean["']/,
    );
    expect(sumberLayout).toContain("await hitungAntrean()");
    expect(sumberLayout).toMatch(/<NavAdmin\s+antrean=\{antrean\}/);
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).not.toContain("hitungAntrean");
  });

  it("benar-benar merender navigasi di sekitar isi halaman", async () => {
    const { default: AdminLayout } = await import("@/app/admin/layout");
    rute.kini = "/admin";
    const m = renderToStaticMarkup(
      await AdminLayout({ children: createElement("p", null, "ISI-UJI") }),
    );
    expect(m).toContain("ISI-UJI");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect(m).toContain('href="/admin/skrining"');
  });
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/admin-shell.test.ts`
Expected: FAIL pada `describe("navigasi admin")` — markup lama masih berupa tab, jumlah `<a>` 18 bukan 13.

- [ ] **Step 3a: Tulis ulang `web/src/app/admin/_shell/nav-admin.tsx`**

Ganti SELURUH isi berkas dengan:

```tsx
"use client";

import type { ReactNode } from "react";
import { KerangkaPanel } from "@/app/_shell/panel/kerangka";
import type { ItemMenu } from "@/app/_shell/panel/sidebar";
import type { Antrean } from "@/lib/admin/antrean";

// `badge` menunjuk medan Antrean yang dipakai, bukan angkanya — supaya satu
// sumber angka (server) tidak pernah tersalin ulang sebagai literal di UI.
const MENU: Array<Omit<ItemMenu, "jumlah"> & { badge?: keyof Antrean }> = [
  { href: "/admin", label: "Beranda", ikon: "lotus" },
  { href: "/admin/skrining", label: "Inbox", ikon: "inbox", badge: "skriningBaru" },
  { href: "/admin/klien", label: "Klien", ikon: "user", badge: "klienBelumAktif" },
  { href: "/admin/sesi", label: "Sesi", ikon: "cal", badge: "permintaanMenunggu" },
  // Label sengaja "Bayar", bukan "Pembayaran": bar bawah layar kecil memuat
  // empat tujuan berdampingan dan label panjang akan terpotong justru di
  // tujuan yang paling perlu dikenali. Judul halamannya tetap "Pembayaran".
  { href: "/admin/bayar", label: "Bayar", ikon: "bayar", badge: "klaimMenunggu" },
  { href: "/admin/mitra", label: "Mitra", ikon: "mitra" },
  // Judul halamannya "Layanan & Paket"; labelnya dipendekkan agar sidebar
  // tidak memaksa satu tujuan menjadi dua baris.
  { href: "/admin/layanan", label: "Layanan", ikon: "katalog" },
  // Judul halamannya "Materi Panduan".
  { href: "/admin/materi", label: "Materi", ikon: "materi" },
  // Judul halamannya "Pengaturan".
  { href: "/admin/pengaturan", label: "Setelan", ikon: "setelan" },
];

// Empat tujuan tersibuk klinik — dan tepat keempatnya yang punya antrean.
// Sisanya tetap terjangkau lewat drawer.
const RINGKAS = ["/admin/skrining", "/admin/klien", "/admin/sesi", "/admin/bayar"];

/**
 * Shell panel admin: daftar menu + perakitnya.
 *
 * Daftar menu SENGAJA tinggal di sini, bukan di primitif bersama. Menu owner
 * memuat tujuan yang seluruhnya berisi nominal (Rekap, Tarif); menyatukan
 * kedua daftar akan mengubah pemisahan fisik money firewall menjadi satu
 * kondisional peran yang bisa salah tulis dalam satu karakter.
 *
 * Angka antrean datang sebagai prop dari layout — komponen ini tidak pernah
 * mengambil datanya sendiri.
 */
export function NavAdmin({
  antrean,
  nama,
  peran,
  children,
}: {
  antrean: Antrean;
  nama: string;
  peran: string;
  children: ReactNode;
}) {
  const menu: ItemMenu[] = MENU.map((m) => ({
    href: m.href,
    label: m.label,
    ikon: m.ikon,
    jumlah: m.badge ? antrean[m.badge] : 0,
  }));

  return (
    <KerangkaPanel
      menu={menu}
      menuRingkas={menu.filter((m) => RINGKAS.includes(m.href))}
      akar="/admin"
      namaPanel="Panel Admin"
      labelSidebar="Menu panel admin"
      labelBottomBar="Navigasi panel admin"
      nama={nama}
      peran={peran}
      catatan={
        <>
          <b className="text-panel-ink">Money firewall</b> — tidak ada angka
          uang di panel ini. Nominal hanya hidup di panel Owner, dan
          penolakannya ditegakkan di level basis data.
        </>
      }
    >
      {children}
    </KerangkaPanel>
  );
}
```

- [ ] **Step 3b: Ubah `web/src/app/admin/layout.tsx`**

Ganti bagian `return (...)` (dan hapus catatan kaki yang kini hidup di dalam `NavAdmin`) sehingga berkasnya menjadi:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { hitungAntrean } from "@/lib/admin/antrean";
import { NavAdmin } from "./_shell/nav-admin";

// JEBAKAN: tiga berkas test mem-parse berkas ini — access-matrix-layouts,
// admin-inbox, dan admin-shell — dan semuanya menuntut penjaga peran dipanggil
// TEPAT SATU KALI dengan daftar peran persis ["admin","owner"]. Nama & peran
// pemakai diambil dari nilai kembalian panggilan itu; jangan menambah
// pemanggilan kedua hanya untuk memperoleh identitas.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nama, role } = await requireRole(["admin", "owner"]); // owner = superset admin

  // Antrean diambil di server lalu diturunkan sebagai prop: nav adalah client
  // component dan tidak boleh menyentuh data sendiri.
  const antrean = await hitungAntrean();

  // Kerangka panel (sidebar, topbar, bar bawah) hidup di dalam NavAdmin, yang
  // kini MEMBUNGKUS isi halaman alih-alih berdiri di atasnya. Catatan money
  // firewall ikut pindah ke sana supaya ia selalu berada di kaki area kerja.
  return (
    <NavAdmin
      antrean={antrean}
      nama={nama}
      peran={role === "owner" ? "Owner" : "Admin"}
    >
      {children}
    </NavAdmin>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/admin-shell.test.ts tests/access-matrix-layouts.test.ts tests/admin-inbox.test.ts`
Expected: PASS ketiganya.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/admin/_shell/nav-admin.tsx src/app/admin/layout.tsx tests/admin-shell.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): shell panel admin jadi sidebar + topbar + drawer

Daftar menu tetap tinggal di nav-admin, bukan pindah ke primitif
bersama: menu owner memuat tujuan yang seluruhnya berisi nominal, dan
menyatukan kedua daftar akan mengubah pemisahan fisik money firewall
menjadi satu kondisional peran.

Asersi bentuk di admin-shell.test.ts ditulis ulang (jumlah nav & tautan
berubah karena sidebar tidak lagi tersalin untuk mobile); yang dikunci
mati tidak bergeser — badge hilang saat nol, satu tujuan aktif per rute,
requireRole tepat sekali dengan peran persis, nol nominal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Shell panel owner

**Files:**
- Modify: `web/src/app/owner/_shell/nav-owner.tsx` (tulis ulang isinya)
- Modify: `web/src/app/owner/layout.tsx`
- Test: `web/tests/owner-kerangka.test.ts` (tulis ulang `describe("navigasi owner")` + satu asersi bentuk di `describe("layout owner")`)

**Interfaces:**
- Consumes: `KerangkaPanel` (Task 6), `ItemMenu`, `Tautan` (Task 3).
- Produces: `<NavOwner nama>{children}</NavOwner>`.

- [ ] **Step 1: Tulis ulang test navigasi owner (akan MERAH)**

Di `web/tests/owner-kerangka.test.ts`, ubah helper `markupNav` menjadi:

```ts
function markupNav(pathname: string): string {
  rute.kini = pathname;
  return renderToStaticMarkup(
    createElement(NavOwner, { nama: "Pemilik PADMA", children: null }),
  );
}
```

lalu ganti seluruh isi `describe("navigasi owner", ...)` dengan:

```ts
describe("navigasi owner", () => {
  const sumberNav = baca("src/app/owner/_shell/nav-owner.tsx");

  it("client component (butuh usePathname lewat KerangkaPanel)", () => {
    expect(sumberNav.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("memuat tiga tujuan berbahasa Indonesia", () => {
    const m = markupNav("/owner");
    for (const [href, label] of [
      ["/owner", "Beranda"],
      ["/owner/rekap", "Rekap"],
      ["/owner/tarif", "Tarif"],
    ]) {
      expect(m).toContain(`href="${href}"`);
      expect(m).toContain(label);
    }
  });

  it("menyediakan sidebar DAN bar bawah, masing-masing berlabel", () => {
    const m = markupNav("/owner");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect([...m.matchAll(/aria-label="[^"]+"/g)].length).toBeGreaterThanOrEqual(2);
    expect(m).toContain("lg:hidden");
    expect(m).toContain("lg:translate-x-0");
    // Panel owner hanya punya tiga tujuan, jadi bar bawah memuat KETIGANYA —
    // tidak ada yang perlu diringkas.
    expect([...m.matchAll(/href="\/owner\/rekap"/g)]).toHaveLength(2);
  });

  it("JALAN PULANG: owner punya tautan klik ke /admin di sidebar dan bar bawah", () => {
    // Sebelum Task 3 rencana owner ada NOL tautan dari /owner ke /admin walau
    // owner adalah superset admin — satu-satunya jalan adalah mengetik URL.
    const m = markupNav("/owner");
    expect([...m.matchAll(/href="\/admin"/g)]).toHaveLength(2);
    expect(m).toContain("Buka Panel Admin");
  });

  it("jumlah tautan dikunci persis (tujuan baru tidak boleh lolos diam-diam)", () => {
    const m = markupNav("/owner");
    // Tiga tujuan × dua nav + dua tautan jalan pulang.
    expect([...m.matchAll(/<a\b/g)]).toHaveLength(3 * 2 + 2);
  });

  it("hanya SATU tujuan yang aktif per nav di beranda", () => {
    const m = markupNav("/owner");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("sub-rute menyalakan tujuannya sendiri, bukan Beranda", () => {
    const m = markupNav("/owner/rekap");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/owner"') && !tag.includes("/owner/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("tautan /admin tidak pernah ditandai sebagai tujuan aktif", () => {
    for (const p of ["/owner", "/owner/rekap", "/owner/tarif"]) {
      for (const tag of markupNav(p).match(/<a[^>]*>/g) ?? []) {
        if (tag.includes('href="/admin"')) {
          expect(tag).not.toContain('aria-current="page"');
        }
      }
    }
  });
});
```

Di `describe("layout owner")`, ganti satu test bentuk ini:

```ts
  it("benar-benar merender navigasi di sekitar isi halaman", async () => {
    const { default: OwnerLayout } = await import("@/app/owner/layout");
    rute.kini = "/owner";
    const m = renderToStaticMarkup(
      await OwnerLayout({ children: createElement("p", null, "ISI-UJI") }),
    );
    expect(m).toContain("ISI-UJI");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect(m).toContain('href="/owner/rekap"');
    expect(m).toContain('href="/admin"');
  });
```

(isinya sama; ia lolos apa adanya begitu Step 3 selesai — jalankan untuk memastikan, jangan dihapus.)

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/owner-kerangka.test.ts`
Expected: FAIL pada `describe("navigasi owner")` — `NavOwner` belum menerima `children`, markup masih berupa tab.

- [ ] **Step 3a: Tulis ulang `web/src/app/owner/_shell/nav-owner.tsx`**

Ganti SELURUH isi berkas dengan:

```tsx
"use client";

import type { ReactNode } from "react";
import { KerangkaPanel } from "@/app/_shell/panel/kerangka";
import type { ItemMenu, Tautan } from "@/app/_shell/panel/sidebar";

const MENU: ItemMenu[] = [
  { href: "/owner", label: "Beranda", ikon: "lotus" },
  // Prototipe menamainya "Rekap & Honor" dan "Rate Card"; labelnya
  // dipendekkan agar sidebar tidak memaksa satu tujuan menjadi dua baris.
  // Judul halamannya tetap panjang.
  { href: "/owner/rekap", label: "Rekap", ikon: "rekap" },
  { href: "/owner/tarif", label: "Tarif", ikon: "tarif" },
];

// JALAN PULANG. Owner adalah SUPERSET admin — ia berhak membuka seluruh panel
// operasional — tetapi sebelum ini tidak ada satu pun tautan klik dari /owner
// ke /admin (terverifikasi: 0 tautan). Satu-satunya jalan adalah mengetik URL
// sendiri, yang berarti fitur itu praktis tidak ada bagi pemilik klinik.
//
// Sengaja BUKAN anggota MENU: ia bukan tujuan panel owner dan tidak pernah
// boleh ikut menyala sebagai `aria-current`. Ia jalan keluar, dan tampil
// berbeda supaya terbaca demikian.
const PULANG: Tautan = { href: "/admin", label: "Buka Panel Admin", ikon: "keluar" };

/**
 * Shell panel owner.
 *
 * Panel ini hanya punya tiga tujuan, jadi bar bawah layar kecil memuat
 * KETIGANYA — tidak ada yang perlu diringkas seperti di panel admin.
 *
 * Daftar menu SENGAJA tinggal di sini, terpisah dari daftar admin: kedua
 * tujuan di bawah (Rekap, Tarif) berisi seluruh nominal PADMA, dan satu
 * daftar bersama akan mengubah pemisahan fisik money firewall menjadi satu
 * kondisional peran.
 */
export function NavOwner({ nama, children }: { nama: string; children: ReactNode }) {
  return (
    <KerangkaPanel
      menu={MENU}
      menuRingkas={MENU}
      akar="/owner"
      namaPanel="Panel Owner"
      labelSidebar="Menu panel owner"
      labelBottomBar="Navigasi panel owner"
      nama={nama}
      peran="Owner"
      jalanKeluar={PULANG}
      catatan={
        <>
          {/* Kebalikan persis dari catatan di panel admin ("tidak ada angka
              uang di panel ini"). Keduanya menjelaskan sisi yang sama dari
              satu firewall, dan owner perlu tahu bahwa yang ia lihat di sini
              memang tidak pernah sampai ke layar siapa pun yang lain. */}
          <b className="text-panel-ink">Money firewall</b> — panel inilah
          satu-satunya tempat nominal uang hidup. Admin dan klien tidak pernah
          melihat angka di halaman ini, dan penolakannya ditegakkan di level
          basis data.
        </>
      }
    >
      {children}
    </KerangkaPanel>
  );
}
```

- [ ] **Step 3b: Ubah `web/src/app/owner/layout.tsx`**

Ganti bagian `return (...)` sehingga berkasnya menjadi:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { NavOwner } from "./_shell/nav-owner";

// JEBAKAN: `tests/access-matrix-layouts.test.ts` dan
// `tests/owner-kerangka.test.ts` mem-parse berkas ini dan menuntut penjaga
// peran dipanggil TEPAT SATU KALI dengan daftar peran PERSIS ["owner"].
//
// Menyalin shell admin membawa serta daftar peran admin+owner miliknya — dan
// itu bukan kelonggaran kecil: seluruh nominal PADMA (rate card, honor, margin)
// akan terbuka untuk admin dalam satu karakter perubahan. Nama pemakai diambil
// dari nilai kembalian panggilan yang sama; jangan menambah pemanggilan kedua
// hanya untuk memperoleh identitas.
//
// Perlu diingat pula bahwa layout ini TIDAK menjaga server action: dibuktikan
// dengan mem-POST action panel admin dari rute lain sebagai admin, dan
// mutasinya berhasil. Karena itu SETIAP server action di bawah /owner wajib
// memanggil penjaga peran yang sama sendiri di baris pertamanya.
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nama } = await requireRole(["owner"]);

  // Kerangka panel (sidebar, topbar, bar bawah) hidup di dalam NavOwner, yang
  // kini MEMBUNGKUS isi halaman. Catatan money firewall ikut pindah ke sana.
  return <NavOwner nama={nama}>{children}</NavOwner>;
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/owner-kerangka.test.ts tests/access-matrix-layouts.test.ts`
Expected: PASS keduanya.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/owner/_shell/nav-owner.tsx src/app/owner/layout.tsx tests/owner-kerangka.test.ts
git commit -m "$(cat <<'EOF'
feat(owner): shell panel owner jadi sidebar + topbar + drawer

Bar bawah memuat ketiga tujuan, bukan diringkas seperti panel admin —
panel ini memang hanya punya tiga. "Buka Panel Admin" tetap BUKAN
anggota menu: ia jalan keluar, dan tidak pernah boleh ikut menyala
sebagai aria-current.

Daftar menu tetap terpisah dari daftar admin: kedua tujuannya (Rekap,
Tarif) berisi seluruh nominal PADMA.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Kerangka muat mengikuti bentuk kartu baru

**Files:**
- Modify: `web/src/app/_shell/skeleton.tsx`
- Modify: `web/src/app/admin/loading.tsx`
- Modify: `web/src/app/owner/loading.tsx`
- Test: `web/tests/kerangka-muat.test.ts`

**Interfaces:**
- Consumes: token panel (Task 1).
- Produces: `<HalamanSkeleton label kartu? baris? varian? />` dengan `varian: "panel" | "klien"` (default `"klien"`).

**Kenapa bervarian, bukan diganti:** `skeleton.tsx` dipakai bertiga — `/admin`, `/owner`, dan `/passport`. Mengganti bentuk kartunya begitu saja akan menyeret panel klien ikut berubah, padahal `/passport` sengaja tetap memakai bahasa visual lama.

- [ ] **Step 1: Tulis test yang gagal**

Di `web/tests/kerangka-muat.test.ts`, ganti test terakhir (`"bentuknya meniru kartu asli panel, bukan kotak sembarang"`) dengan dua test berikut:

```ts
  it("bentuk varian klien tetap meniru kartu lama (/passport tidak ikut berubah)", () => {
    const m = renderToStaticMarkup(createElement(KartuSkeleton, {}));
    // Kelas yang sama dipakai kartu sungguhan di /passport; kerangka yang
    // tidak sebentuk membuat tata letak melompat saat isi datang.
    expect(m).toContain("rounded-2xl");
    expect(m).toContain("border-black/10");
    expect(m).toContain("bg-white");
  });

  it("bentuk varian panel meniru kartu ruang kerja staf yang baru", () => {
    const m = renderToStaticMarkup(
      createElement(KartuSkeleton, { varian: "panel" as const }),
    );
    // Radius turun ke 8px dan garisnya token panel — persis kartu di
    // /admin & /owner sesudah perombakan.
    expect(m).toContain("rounded-lg");
    expect(m).toContain("border-panel-border");
    expect(m).toContain("bg-panel-surface");
    expect(m).not.toContain("rounded-2xl");
  });

  it("loading.tsx panel staf memakai varian panel, /passport tidak", () => {
    for (const panel of ["admin", "owner"]) {
      expect(baca(`src/app/${panel}/loading.tsx`)).toContain('varian="panel"');
    }
    expect(baca("src/app/passport/loading.tsx")).not.toContain("varian");
  });
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/kerangka-muat.test.ts`
Expected: FAIL — `rounded-lg` tidak ditemukan; `varian="panel"` tidak ada di `loading.tsx`.

- [ ] **Step 3a: Ubah `web/src/app/_shell/skeleton.tsx`**

Ganti `KartuSkeleton` dan `HalamanSkeleton` dengan versi bervarian (biarkan `Blok` apa adanya):

```tsx
/**
 * Bentuk kartu berbeda antara panel staf dan panel klien.
 *
 * `/admin` & `/owner` memakai bahasa visual ruang kerja (radius 8px, garis
 * token panel); `/passport` tetap memakai bahasa visual PADMA yang lama.
 * Satu bentuk untuk keduanya berarti salah satunya melompat saat isi datang.
 */
export type VarianKerangka = "panel" | "klien";

const KARTU: Record<VarianKerangka, string> = {
  panel: "rounded-lg border border-panel-border bg-panel-surface p-5",
  klien: "rounded-2xl border border-black/10 bg-white p-6",
};

/** Kartu: satu judul + `baris` baris teks. */
export function KartuSkeleton({
  baris = 3,
  varian = "klien",
  className = "",
}: {
  baris?: number;
  varian?: VarianKerangka;
  className?: string;
}) {
  return (
    <div className={`${KARTU[varian]} ${className}`}>
      <Blok className="h-5 w-2/5" />
      <div className="mt-5 grid gap-3">
        {Array.from({ length: baris }, (_, i) => (
          <Blok
            key={i}
            // Baris terakhir sengaja lebih pendek — paragraf sungguhan memang
            // jarang berhenti pas di tepi kanan.
            className={`h-3.5 ${i === baris - 1 ? "w-1/2" : "w-full"}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Kerangka satu halaman panel.
 *
 * `label` dibacakan pembaca layar lewat `role="status"`; blok-bloknya sendiri
 * `aria-hidden`, sehingga yang terdengar adalah "Memuat ..." — bukan deretan
 * elemen kosong tanpa makna.
 */
export function HalamanSkeleton({
  label,
  kartu = 2,
  baris = 4,
  varian = "klien",
}: {
  label: string;
  kartu?: number;
  baris?: number;
  varian?: VarianKerangka;
}) {
  return (
    // `data-kerangka` adalah pegangan test E2E: sejak loading.tsx ada, Next
    // memindahkan URL seketika lalu menyusulkan isi, sehingga menunggu URL atau
    // "networkidle" saja bisa selesai ketika layar masih berisi kerangka ini.
    // Penanda inilah yang ditunggu HILANG. Sengaja atribut data tersendiri,
    // bukan role="status", supaya status lain yang mungkin lahir kelak (mis.
    // pesan hasil simpan pada form) tidak ikut membekukan test.
    <div role="status" aria-live="polite" data-kerangka="muat">
      <span className="sr-only">{label}</span>
      <div className="grid gap-3.5">
        {Array.from({ length: kartu }, (_, i) => (
          <KartuSkeleton
            key={i}
            varian={varian}
            baris={i === 0 ? baris : Math.max(2, baris - 2)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3b: Ubah kedua `loading.tsx`**

`web/src/app/admin/loading.tsx`:

```tsx
import { HalamanSkeleton } from "@/app/_shell/skeleton";

// Panel admin didominasi tabel panjang (klien, sesi, pembayaran), jadi kartu
// pertamanya diberi baris paling banyak.
export default function Memuat() {
  return (
    <HalamanSkeleton label="Memuat panel admin…" kartu={3} baris={5} varian="panel" />
  );
}
```

`web/src/app/owner/loading.tsx`:

```tsx
import { HalamanSkeleton } from "@/app/_shell/skeleton";

// Panel owner lebih ringkas: ringkasan pekan lalu satu-dua kartu angka.
export default function Memuat() {
  return (
    <HalamanSkeleton label="Memuat panel owner…" kartu={2} baris={4} varian="panel" />
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/kerangka-muat.test.ts`
Expected: PASS (semua, termasuk penanda `data-kerangka="muat"` dan `motion-reduce:animate-none` yang tidak boleh hilang).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/skeleton.tsx src/app/admin/loading.tsx src/app/owner/loading.tsx tests/kerangka-muat.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): kerangka muat bervarian panel vs klien

skeleton.tsx dipakai bertiga. Mengganti bentuk kartunya begitu saja akan
menyeret /passport ikut berubah, padahal panel klien sengaja tetap
memakai bahasa visual lama.

Penanda data-kerangka="muat" dan motion-reduce:animate-none tidak
bergerak — keduanya kontrak dengan lapisan E2E dan dengan pemakai yang
menyetel "kurangi gerak".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Verifikasi menyeluruh

**Files:**
- Modify: berkas mana pun yang ternyata masih merah (tak terduga di muka)

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: bukti bahwa kerangka baru tidak merusak apa pun di luar dirinya.

- [ ] **Step 1: Jalankan SELURUH suite Vitest**

Run: `cd web && npm test`
Expected: seluruh berkas PASS.

Bila ada berkas lain yang merah, kemungkinan besar ia mengasersi kelas atau struktur shell lama (mis. `max-w-6xl`, `bg-paper`, `sm:flex`). Untuk tiap kegagalan: baca komentar di atas test itu, putuskan apakah yang dijaga masih berlaku, lalu **perbarui asersinya tanpa melonggarkan maksudnya**. Jangan pernah menghapus test hanya karena bentuknya berubah.

- [ ] **Step 2: Lint**

Run: `cd web && npm run lint`
Expected: nol error.

- [ ] **Step 3: Build produksi**

Run: `cd web && npm run build`
Expected: build sukses. Ini menangkap kesalahan batas server/client component — `KerangkaPanel` adalah client component yang menerima `children` hasil render server, dan itu sah; tetapi meneruskan fungsi non-serializable dari server ke client tidak.

- [ ] **Step 4: E2E panel staf**

Run: `cd web && npm run test:e2e:admin && npm run test:e2e:owner`
Expected: keduanya lulus. `tests/e2e/owner.e2e.ts` mengklik tautan bernama "Buka Panel Admin" — tautan itu sengaja dipertahankan namanya di Task 8.

- [ ] **Step 5: Periksa mata sendiri di peramban**

Run: `cd web && npm run dev`, lalu buka `/admin` dan `/owner`. Periksa empat hal yang tidak dijaga satu pun test:
1. Sidebar menetap di layar lebar dan tidak menutupi isi (`lg:pl-60` cocok dengan `w-60`).
2. Di lebar 390px: sidebar tersembunyi, ☰ membukanya, mengetuk satu tujuan menutupnya lagi.
3. Bar bawah tidak menutupi isi terakhir halaman (`pb-28`).
4. Badge antrean muncul di sidebar dan bar bawah dengan angka yang sama.

- [ ] **Step 6: Commit perbaikan (bila ada) & catat hasilnya**

```bash
cd web && git add -A
git commit -m "$(cat <<'EOF'
test(panel): rapikan asersi yang tersisa setelah kerangka berganti

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Bila tidak ada perbaikan yang perlu di-commit, lewati langkah ini dan katakan demikian apa adanya — jangan membuat commit kosong.

---

## Yang TIDAK dikerjakan rencana ini

Dinyatakan di sini supaya tidak dikira terlewat. Semuanya masuk rencana kedua (langkah 5–9 spec):

- Dashboard admin: `src/lib/admin/tren.ts`, grafik batang, agenda hari ini, aktivitas terbaru, aksi cepat.
- Dashboard owner: grafik garis tiga seri dari `ambilRekap()`, tabel mitra teraktif.
- Primitif isi halaman: `stat-tile.tsx`, `kartu.tsx`, `tabel.tsx`, `grafik-batang.tsx`, `grafik-garis.tsx`.
- Sapuan sembilan halaman isi admin dan tiga halaman owner ke primitif baru — sesudah rencana ini, halaman-halaman itu masih memakai kartu krem lamanya di dalam kerangka baru. Itu keadaan antara yang disengaja dan terlihat.
- Logo baru di halaman Masuk & Aktivasi + favicon.
- Penyetelan ulang seluruh delapan skrip E2E.
