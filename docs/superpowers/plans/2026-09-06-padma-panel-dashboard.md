# Dashboard & Grafik Panel Admin/Owner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah beranda `/admin` dan `/owner` dari deretan kartu angka menjadi dashboard sungguhan — stat tile, grafik tren, agenda, aktivitas terbaru, dan tabel mitra teraktif — di atas kerangka sidebar yang sudah jadi.

**Architecture:** Primitif isi halaman menyusul primitif kerangka di `src/app/_shell/panel/` dan tetap **buta peran**: `Kartu`, `StatTile`, `Tabel`, `GrafikBatang`, `GrafikGaris`. Kedua grafik ditulis sebagai SVG sendiri, tanpa library, dan **tidak pernah tahu soal rupiah** — keduanya menerima `format: (n: number) => string` sebagai prop, dan hanya halaman owner yang menyuntikkan `formatRupiah`. Panel admin mendapat satu berkas query baru (`lib/admin/tren.ts`) dan satu lagi untuk agenda (`lib/admin/agenda.ts`); panel owner **tidak butuh satu query pun yang baru** karena `ambilRekap()` sudah memulangkan seluruh pekan lengkap dengan marginnya.

**Tech Stack:** Next.js 16.3.3 (App Router), React 19.2.8, Tailwind CSS v4, Vitest 4 (`environment: "node"`, render lewat `renderToStaticMarkup`), SVG inline tanpa dependensi grafik.

**Spec:** `docs/superpowers/specs/2026-09-05-padma-panel-admin-ui-design.md` (§6 Dashboard, dan §4 baris `stat-tile`/`kartu`/`tabel`/`grafik-*` pada tabel berkas)

**Rencana sebelumnya:** `docs/superpowers/plans/2026-09-05-padma-panel-kerangka.md` — sudah selesai dan ter-merge (`ad2f58e`). Kerangka sidebar, topbar, drawer, bar bawah, dan token `--color-panel-*` sudah ada dan hijau.

## Global Constraints

- **Tanpa dependensi baru.** Tidak ada `npm install` di seluruh rencana ini — tidak ada library grafik, tidak ada jsdom, tidak ada testing-library.
- **Tanpa migration.** Tidak ada perubahan skema, RLS, atau server action.
- **Money firewall.** Dilarang di `src/app/_shell/panel/**` dan di `src/lib/admin/**`: pola `/Rp\s?\d/` dan `formatRupiah`. Komponen grafik menerima fungsi format sebagai prop; hanya `src/app/owner/**` yang boleh mengimpor `@/lib/owner/rupiah`. `src/lib/admin/tren.ts` dan `src/lib/admin/agenda.ts` tidak boleh menyentuh tabel `service_rates` maupun `honor_marks`.
- **Primitif buta peran.** Tidak satu pun berkas di `src/app/_shell/panel/` boleh memuat string berkutip `"admin"`/`"owner"` (dalam bentuk apa pun huruf besar-kecilnya) atau mengimpor `requireRole`. Pagar ini sudah ada di `tests/panel-primitif.test.ts` dan membaca direktori itu secara otomatis, jadi setiap berkas baru langsung ikut terjaga.
- **Service role terlarang** di `src/app/admin/**` (kecuali `src/app/admin/materi/unggah.ts`), di seluruh `src/app/owner/**`, dan di `src/lib/admin/**` maupun `src/lib/owner/**`. Semua bacaan lewat `createServerSupabase()` supaya RLS yang memutuskan.
- **Argumen penjaga peran tidak bergeser.** `src/app/admin/page.tsx` tetap `await requireRole(["admin","owner"])`; `src/app/owner/page.tsx` tetap `await requireRole(["owner"])`.
- **Warna grafik sudah tervalidasi — jangan diganti dengan taksiran.** Ketiga heks di `palet.ts` lolos `scripts/validate_palette.js` skill dataviz (lightness band, chroma floor, pemisahan CVD, ambang penglihatan normal). Mengganti salah satunya "supaya lebih cantik" tanpa menjalankan ulang validator adalah regresi aksesibilitas yang tidak menghasilkan error.
- **Sumbu Y grafik selalu mulai dari nol.** Sumbu terpotong membesar-besarkan selisih kecil; pada grafik yang dipakai memutuskan honor, itu bukan gaya melainkan berbohong.
- **Halaman klien tidak disentuh:** `src/app/passport/**`, `src/app/_landing/**`, `src/app/skrining/**`.
- **Bahasa Indonesia** untuk nama berkas, identifier, komentar, dan seluruh teks UI.
- Perintah: `npx vitest run tests/<berkas>` (satu berkas), `npm test` (seluruh suite), `npm run lint`, `npm run build`, `npx tsc --noEmit`.
- Supabase lokal harus hidup (`npx supabase start`) sebelum menjalankan test apa pun — `globalSetup` menyemai pengguna demo.

## Yang TIDAK dikerjakan rencana ini

Dinyatakan supaya tidak dikira terlewat; semuanya masuk rencana ketiga:

- Sapuan dua belas halaman isi (klien, sesi, bayar, mitra, layanan, materi, pengaturan, detail klien, rekap, tarif) ke primitif `Kartu`/`Tabel` yang lahir di sini. Sesudah rencana ini, halaman-halaman itu masih memakai kartu krem lamanya di dalam kerangka baru — keadaan antara yang disengaja dan terlihat.
- Logo baru di halaman Masuk & Aktivasi + favicon.
- Penyetelan ulang seluruh delapan skrip E2E.

---

### Task 1: Palet grafik tervalidasi, Kartu, dan StatTile

**Files:**
- Create: `web/src/app/_shell/panel/palet.ts`
- Create: `web/src/app/_shell/panel/kartu.tsx`
- Create: `web/src/app/_shell/panel/stat-tile.tsx`
- Test: `web/tests/panel-isi.test.ts` (create)

**Interfaces:**
- Consumes: token `--color-panel-*` dari `globals.css` (sudah ada).
- Produces:
  - `PALET_GRAFIK: readonly [string, string, string]` — tiga heks tervalidasi
  - `<Kartu judul? aksi? className?>{children}</Kartu>`
  - `<StatTile label nilai keterangan href? menuntut? />`

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/panel-isi.test.ts`:

```ts
/**
 * Primitif ISI halaman panel staf: Kartu, StatTile, Tabel, dan kedua grafik.
 *
 * Berkas ini tidak menyentuh basis data. Yang dijaga:
 *
 *  1. Warna grafik tetap heks yang SUDAH divalidasi. Palet kategorikal yang
 *     diganti berdasarkan selera tidak menghasilkan error apa pun — ia hanya
 *     berhenti terbaca oleh sebagian pembaca, diam-diam.
 *  2. Grafik tidak pernah tahu soal rupiah. Formatnya datang sebagai prop;
 *     satu `formatRupiah` yang diimpor di primitif bersama adalah undangan
 *     permanen untuk memunculkan nominal di panel admin.
 *  3. Sumbu Y mulai dari nol. Sumbu terpotong membesar-besarkan selisih kecil.
 *  4. Setiap grafik punya padanan tabel. Grafik yang hanya bisa dibaca dengan
 *     mata adalah grafik yang sebagian pemakainya tidak bisa baca sama sekali.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const { PALET_GRAFIK } = await import("@/app/_shell/panel/palet");
const { Kartu } = await import("@/app/_shell/panel/kartu");
const { StatTile } = await import("@/app/_shell/panel/stat-tile");

describe("palet grafik", () => {
  it("tiga heks, persis yang lolos validator", () => {
    // Dijalankan dengan scripts/validate_palette.js milik skill dataviz pada
    // 6 September 2026: lightness band PASS, chroma floor PASS, pemisahan CVD
    // PASS (terburuk ΔE 10.1 deutan), ambang penglihatan normal PASS (ΔE 23.8).
    // Angka-angka ini yang dikunci; menggantinya menuntut menjalankan ulang.
    expect(PALET_GRAFIK).toEqual(["#2e8b57", "#8c4a7d", "#c8952f"]);
  });

  it("tidak ada warna grafik yang ditulis ulang sebagai literal di komponen", () => {
    // Dua salinan heks akan berpisah pada perubahan berikutnya, dan yang
    // berpisah adalah warna yang divalidasi versus warna yang dipakai.
    for (const berkas of [
      "src/app/_shell/panel/grafik-batang.tsx",
      "src/app/_shell/panel/grafik-garis.tsx",
    ]) {
      let sumber = "";
      try {
        sumber = baca(berkas);
      } catch {
        continue; // berkasnya lahir di task berikutnya
      }
      for (const heks of PALET_GRAFIK) {
        expect(sumber, `${berkas} menyalin ${heks}`).not.toContain(heks);
      }
    }
  });
});

describe("Kartu", () => {
  it("tanpa judul: tidak merender kepala kosong", () => {
    const m = renderToStaticMarkup(
      createElement(Kartu, { children: createElement("p", null, "ISI") }),
    );
    expect(m).toContain("ISI");
    expect(m).not.toContain("<header");
  });

  it("dengan judul: kepala berisi judul dan aksinya", () => {
    const m = renderToStaticMarkup(
      createElement(Kartu, {
        judul: "Agenda hari ini",
        aksi: createElement("a", { href: "/x" }, "Semua"),
        children: createElement("p", null, "ISI"),
      }),
    );
    expect(m).toContain("<header");
    expect(m).toContain("Agenda hari ini");
    expect(m).toContain('href="/x"');
  });

  it("memakai bentuk kartu panel, bukan kartu klien", () => {
    const m = renderToStaticMarkup(
      createElement(Kartu, { children: null }),
    );
    expect(m).toContain("rounded-lg");
    expect(m).toContain("border-panel-border");
    expect(m).toContain("bg-panel-surface");
    expect(m).not.toContain("rounded-2xl");
  });
});

describe("StatTile", () => {
  function tile(tambahan: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(StatTile, {
        label: "Skrining baru",
        nilai: "3",
        keterangan: "Belum ditindaklanjuti",
        ...tambahan,
      } as never),
    );
  }

  it("angka bertujuan menjadi tautan; angka tanpa tujuan tidak", () => {
    // Angka tanpa modul yang bisa memadamkannya adalah alarm yang tidak bisa
    // dibersihkan — keadaan yang sempat nyata untuk "Klaim pembayaran".
    expect(tile({ href: "/admin/skrining" })).toContain('href="/admin/skrining"');
    expect(tile()).not.toContain("<a");
  });

  it("angka memakai tabular-nums supaya kolom angka tidak bergoyang", () => {
    expect(tile()).toContain("tabular-nums");
  });

  it("hanya angka yang MENUNTUT tindakan yang diwarnai clay", () => {
    // Semua angka berwarna merah = tidak ada yang berarti merah.
    expect(tile({ menuntut: true })).toContain("text-clay");
    expect(tile({ menuntut: false })).not.toContain("text-clay");
  });

  it("label & keterangan tetap tinta teks, bukan warna angka", () => {
    const m = tile({ menuntut: true });
    // Teks memakai token tinta; warna hanya menempel pada angkanya.
    expect(m).toContain("text-panel-muted");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/palet` tidak ditemukan.

- [ ] **Step 3a: Buat `web/src/app/_shell/panel/palet.ts`**

```ts
/**
 * Palet kategorikal grafik panel.
 *
 * Ketiga heks di bawah BUKAN pilihan selera: ia dijalankan lewat
 * `scripts/validate_palette.js` (skill dataviz) terhadap permukaan terang, dan
 * lolos lightness band, chroma floor, pemisahan CVD (terburuk ΔE 10,1 deutan),
 * serta ambang penglihatan normal (ΔE 23,8). Urutannya ikut divalidasi —
 * validator memeriksa PASANGAN BERSEBELAHAN, jadi menukar urutan mengubah
 * pasangan yang diperiksa.
 *
 * Warna PADMA sendiri (leaf #2f6a48, night #0a2b1f) sudah dicoba lebih dulu dan
 * GAGAL chroma floor — keduanya terbaca abu-abu sebagai tanda grafik. Karena
 * itu palet grafik hidup terpisah dari palet merek, dan bukan turunannya.
 *
 * Slot ketiga (#c8952f) berada sedikit di bawah kontras 3:1 terhadap permukaan
 * putih. Itu WARN, bukan pengecualian yang boleh diabaikan: kelegaannya wajib
 * berupa label langsung pada serinya dan padanan tabel — keduanya disediakan
 * `GrafikGaris`, dan angkanya juga tampil sebagai stat tile di halaman yang sama.
 */
export const PALET_GRAFIK = ["#2e8b57", "#8c4a7d", "#c8952f"] as const;

/** Kisi & sumbu sengaja resesif: data yang menonjol, bukan rangkanya. */
export const WARNA_KISI = "#e4e7e3";
export const WARNA_TINTA_SUMBU = "#6b756e";
/** Permukaan kartu — dipakai sebagai cincin 2px pada penanda yang bertumpuk. */
export const WARNA_PERMUKAAN = "#ffffff";
```

- [ ] **Step 3b: Buat `web/src/app/_shell/panel/kartu.tsx`**

```tsx
import type { ReactNode } from "react";

/**
 * Permukaan isi panel staf: putih, bergaris 1px, radius 8px.
 *
 * Kepala hanya lahir bila ada `judul` atau `aksi` — kartu tanpa keduanya tidak
 * boleh menyisakan bilah kosong yang memakan tinggi tanpa memberi informasi.
 */
export function Kartu({
  judul,
  aksi,
  children,
  className = "",
}: {
  judul?: string;
  /** Tautan atau tombol di sisi kanan kepala, mis. "Lihat semua". */
  aksi?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-panel-border bg-panel-surface ${className}`}
    >
      {(judul || aksi) && (
        <header className="flex items-center justify-between gap-3 border-b border-panel-border px-4 py-3">
          {judul && (
            <h2 className="text-[13px] font-bold text-panel-ink">{judul}</h2>
          )}
          {aksi}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
```

- [ ] **Step 3c: Buat `web/src/app/_shell/panel/stat-tile.tsx`**

```tsx
import Link from "next/link";

/**
 * Satu angka besar berlabel.
 *
 * `href` opsional di sini, tetapi pemanggil di panel admin WAJIB mengisinya:
 * setiap angka antrean punya modul yang bisa memadamkannya, dan angka tanpa
 * tujuan adalah alarm yang tidak bisa dibersihkan. Angka owner (nominal pekan
 * berjalan) memang bukan antrean dan boleh tanpa tujuan.
 *
 * `menuntut` mewarnai angkanya clay. Sengaja bukan otomatis dari `nilai > 0`:
 * "3 sesi selesai" adalah kabar baik, "3 klaim menunggu" adalah pekerjaan, dan
 * hanya pemanggil yang tahu bedanya. Bila semua angka merah, tidak ada yang
 * berarti merah.
 */
export function StatTile({
  label,
  nilai,
  keterangan,
  href,
  menuntut = false,
}: {
  label: string;
  nilai: string;
  keterangan: string;
  href?: string;
  menuntut?: boolean;
}) {
  const isi = (
    <>
      <small className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.06em] text-panel-muted">
        {label}
      </small>
      <span
        className={`block text-[26px] font-bold leading-none tabular-nums ${
          menuntut ? "text-clay" : "text-panel-ink"
        }`}
      >
        {nilai}
      </span>
      <span className="mt-1.5 block text-[12px] text-panel-muted">
        {keterangan}
      </span>
    </>
  );

  const kelas =
    "block rounded-lg border border-panel-border bg-panel-surface px-4 py-4";

  if (!href) return <div className={kelas}>{isi}</div>;
  return (
    <Link href={href} className={`${kelas} transition hover:border-leaf/50`}>
      {isi}
    </Link>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: PASS (9 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/palet.ts src/app/_shell/panel/kartu.tsx src/app/_shell/panel/stat-tile.tsx tests/panel-isi.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): palet grafik tervalidasi, Kartu, dan StatTile

Warna grafik dijalankan lewat validator skill dataviz, bukan dipilih
dengan mata: leaf dan night milik PADMA sendiri GAGAL chroma floor —
keduanya terbaca abu-abu sebagai tanda grafik. Karena itu palet grafik
hidup terpisah dari palet merek, dan heksnya dikunci test.

StatTile tidak menyimpulkan "menuntut" dari nilai > 0: "3 sesi selesai"
kabar baik, "3 klaim menunggu" pekerjaan. Bila semua angka merah, tidak
ada yang berarti merah.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Tabel

**Files:**
- Create: `web/src/app/_shell/panel/tabel.tsx`
- Test: `web/tests/panel-isi.test.ts` (modify)

**Interfaces:**
- Consumes: token panel.
- Produces: `<Tabel label>{children}</Tabel>`, `<Th>`, `<Td>` — dipakai Task 7 (agenda admin) dan Task 9 (mitra owner).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/panel-isi.test.ts`:

```ts
const { Tabel, Th, Td } = await import("@/app/_shell/panel/tabel");

describe("Tabel", () => {
  function tabelUji() {
    return renderToStaticMarkup(
      createElement(
        Tabel,
        { label: "Agenda hari ini" },
        createElement(
          "thead",
          null,
          createElement("tr", null, createElement(Th, null, "Klien")),
        ),
        createElement(
          "tbody",
          null,
          createElement("tr", null, createElement(Td, null, "Ananda")),
        ),
      ),
    );
  }

  it("punya nama aksesibel — tabel tanpa nama tak bisa dilompati pembaca layar", () => {
    expect(tabelUji()).toContain('aria-label="Agenda hari ini"');
  });

  it("menggulung SENDIRI di sumbu X, bukan memaksa halaman ikut menggulung", () => {
    // Badan halaman tidak boleh pernah menggulung horizontal; tabel lebarlah
    // yang menggulung di dalam wadahnya.
    expect(tabelUji()).toContain("overflow-x-auto");
  });

  it("kepala kolom memakai scope, bukan sekadar tebal", () => {
    expect(tabelUji()).toContain('scope="col"');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/tabel` tidak ditemukan.

- [ ] **Step 3: Buat `web/src/app/_shell/panel/tabel.tsx`**

```tsx
import type { ReactNode } from "react";

/**
 * Pembungkus tabel panel.
 *
 * `overflow-x-auto` ada di WADAHNYA, bukan di badan halaman: tabel lebar harus
 * menggulung di dalam kartunya sendiri, sebab halaman yang ikut menggulung
 * horizontal memindahkan seluruh tata letak setiap kali satu kolom bertambah.
 *
 * `min-w` memaksa gulungan itu benar-benar terjadi di layar sempit alih-alih
 * memampatkan kolom sampai tak terbaca.
 */
export function Tabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={label}
        className="w-full min-w-[34rem] border-collapse text-left text-[13px]"
      >
        {children}
      </table>
    </div>
  );
}

/** Kepala kolom. `scope="col"` bukan hiasan: tanpa itu pembaca layar tidak
 *  bisa menyebut kolom mana yang sedang dibacakan pada baris ke-20. */
export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`border-b border-panel-border px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.05em] text-panel-muted ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <td className={`border-b border-panel-border/70 px-3 py-2.5 align-top text-panel-ink ${className}`}>
      {children}
    </td>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: PASS (12 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/tabel.tsx tests/panel-isi.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): pembungkus tabel dengan gulungan di wadahnya sendiri

overflow-x-auto ada di wadah tabel, bukan di badan halaman: halaman yang
ikut menggulung horizontal memindahkan seluruh tata letak setiap kali
satu kolom bertambah.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Dasar grafik + GrafikBatang

**Files:**
- Create: `web/src/app/_shell/panel/grafik-dasar.tsx`
- Create: `web/src/app/_shell/panel/grafik-batang.tsx`
- Test: `web/tests/panel-isi.test.ts` (modify)

**Interfaces:**
- Consumes: `PALET_GRAFIK`, `WARNA_KISI`, `WARNA_TINTA_SUMBU` (Task 1); `Tabel`, `Th`, `Td` (Task 2).
- Produces (seluruhnya dari `grafik-dasar.tsx`, dipakai juga oleh Task 4):
  - `GEOM` — `{ lebar, tinggi, pad: { atas, kanan, bawah, kiri } }` dan `PLOT` — `{ lebar, tinggi }`
  - `batasAtas(nilai: readonly number[]): number`
  - `skalaY(nilai: number, maks: number): number`
  - `pusatX(i: number, n: number): number`
  - `<Kisi maks format garis? />` — garis kisi + label sumbu Y
  - `<LabelX label />` — label sumbu X
  - dan dari `grafik-batang.tsx`: `type TitikBatang = { label: string; nilai: number }` serta `<GrafikBatang judul data format? warna? />`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/panel-isi.test.ts`:

```ts
const { batasAtas, GEOM, skalaY } = await import("@/app/_shell/panel/grafik-dasar");
const { GrafikBatang } = await import("@/app/_shell/panel/grafik-batang");

const DATA_BATANG = [
  { label: "1 Jul", nilai: 0 },
  { label: "8 Jul", nilai: 3 },
  { label: "15 Jul", nilai: 7 },
  { label: "22 Jul", nilai: 2 },
];

describe("batasAtas — sumbu Y", () => {
  it("selalu mulai dari nol dan naik ke kelipatan bulat", () => {
    expect(batasAtas([3])).toBe(4);
    expect(batasAtas([9])).toBe(12);
    expect(batasAtas([100])).toBe(100);
  });

  it("data kosong tetap punya kisi, bukan pembagian nol", () => {
    expect(batasAtas([])).toBe(4);
    expect(batasAtas([0, 0, 0])).toBe(4);
  });

  it("nilai negatif tidak menyeret batas ke bawah nol", () => {
    // Grafik batang panel ini menghitung kejadian; negatif tidak sah, tapi
    // membiarkannya memampatkan skala akan menyembunyikan seluruh data.
    expect(batasAtas([-5, 2])).toBe(4);
  });
});

describe("skalaY", () => {
  it("nol berada di garis dasar, maksimum di tepi atas area plot", () => {
    const dasar = GEOM.tinggi - GEOM.pad.bawah;
    expect(skalaY(0, 10)).toBeCloseTo(dasar, 5);
    expect(skalaY(10, 10)).toBeCloseTo(GEOM.pad.atas, 5);
  });
});

describe("GrafikBatang", () => {
  function batang(tambahan: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(GrafikBatang, {
        judul: "Sesi selesai per pekan",
        data: DATA_BATANG,
        ...tambahan,
      } as never),
    );
  }

  it("satu bentuk batang per titik data", () => {
    const m = batang();
    expect([...m.matchAll(/data-batang="/g)]).toHaveLength(DATA_BATANG.length);
  });

  it("batang bernilai nol tetap ada sebagai titik data, bukan lubang", () => {
    // Pekan tanpa sesi adalah informasi. Menghilangkannya membuat delapan
    // pekan terlihat seperti enam, dan trennya berbohong.
    const m = batang();
    expect(m).toContain('data-batang="0"');
  });

  it("seri tunggal TIDAK memakai legenda — judulnya sudah menamai serinya", () => {
    expect(batang()).not.toContain("<ul");
  });

  it("label langsung bersifat selektif, bukan angka di setiap batang", () => {
    // Angka di setiap batang mengubah grafik menjadi tabel yang sulit dibaca.
    const m = batang();
    expect([...m.matchAll(/data-label-langsung/g)].length).toBeLessThan(
      DATA_BATANG.length,
    );
    expect([...m.matchAll(/data-label-langsung/g)].length).toBeGreaterThan(0);
  });

  it("punya padanan tabel — grafik bukan satu-satunya jalan ke angkanya", () => {
    const m = batang();
    expect(m).toContain("<table");
    for (const t of DATA_BATANG) {
      expect(m).toContain(t.label);
    }
  });

  it("svg menamai dirinya untuk pembaca layar", () => {
    const m = batang();
    expect(m).toMatch(/<svg[^>]*role="img"/);
    expect(m).toMatch(/<svg[^>]*aria-label="[^"]+"/);
  });

  it("memakai warna slot pertama palet tervalidasi", () => {
    expect(batang()).toContain(PALET_GRAFIK[0]);
  });

  it("format nilai datang dari prop — grafik tidak tahu satuan apa pun", () => {
    const m = batang({ format: (n: number) => `${n} sesi` });
    expect(m).toContain("7 sesi");
  });

  it("tidak memuat nominal maupun pemformat rupiah", () => {
    const sumber = baca("src/app/_shell/panel/grafik-batang.tsx");
    expect(sumber).not.toMatch(/Rp\s?\d|formatRupiah/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/grafik-dasar` tidak ditemukan.

- [ ] **Step 3a: Buat `web/src/app/_shell/panel/grafik-dasar.tsx`**

```tsx
import { WARNA_KISI, WARNA_TINTA_SUMBU } from "./palet";

/**
 * Geometri bersama kedua grafik.
 *
 * SVG memakai `viewBox` dengan koordinat tetap dan `width="100%"`: grafiknya
 * ikut melebar mengikuti kartunya tanpa satu baris JavaScript pengukur, dan
 * tetap tajam di layar retina. Tinggi tetap supaya deretan kartu tidak
 * melompat-lompat saat datanya berubah.
 */
export const GEOM = {
  lebar: 640,
  tinggi: 210,
  pad: { atas: 18, kanan: 16, bawah: 30, kiri: 40 },
} as const;

export const PLOT = {
  lebar: GEOM.lebar - GEOM.pad.kiri - GEOM.pad.kanan,
  tinggi: GEOM.tinggi - GEOM.pad.atas - GEOM.pad.bawah,
} as const;

/**
 * Batas atas sumbu Y — SELALU dari nol.
 *
 * Sumbu yang dipotong di bawah membesar-besarkan selisih kecil; pada grafik
 * yang dipakai memutuskan honor, itu bukan gaya melainkan berbohong.
 *
 * Dibulatkan ke kelipatan empat supaya kisinya jatuh di angka bulat, dan
 * minimal empat supaya data yang seluruhnya nol tetap punya kisi alih-alih
 * memicu pembagian nol.
 */
export function batasAtas(nilai: readonly number[]): number {
  const maks = Math.max(0, ...nilai);
  return Math.max(4, Math.ceil(maks / 4) * 4);
}

/** Koordinat Y sebuah nilai. Nol = garis dasar, `maks` = tepi atas plot. */
export function skalaY(nilai: number, maks: number): number {
  const dasar = GEOM.tinggi - GEOM.pad.bawah;
  return dasar - (nilai / maks) * PLOT.tinggi;
}

/** Koordinat X titik ke-`i` dari `n` titik, di TENGAH slotnya. */
export function pusatX(i: number, n: number): number {
  const slot = PLOT.lebar / n;
  return GEOM.pad.kiri + slot * i + slot / 2;
}

/**
 * Kisi horizontal + label sumbu Y. Sengaja resesif — yang harus menonjol
 * adalah datanya, bukan rangkanya.
 */
export function Kisi({
  maks,
  format,
  garis = 4,
}: {
  maks: number;
  format: (n: number) => string;
  garis?: number;
}) {
  const nilai = Array.from({ length: garis + 1 }, (_, i) => (maks / garis) * i);
  return (
    <g aria-hidden="true">
      {nilai.map((v) => {
        const y = skalaY(v, maks);
        return (
          <g key={v}>
            <line
              x1={GEOM.pad.kiri}
              y1={y}
              x2={GEOM.lebar - GEOM.pad.kanan}
              y2={y}
              stroke={WARNA_KISI}
              strokeWidth={1}
            />
            <text
              x={GEOM.pad.kiri - 8}
              y={y + 3.5}
              textAnchor="end"
              fontSize={10}
              fill={WARNA_TINTA_SUMBU}
            >
              {format(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Label sumbu X. Pada layar sempit label diselang-seling supaya tidak
 *  bertabrakan — label yang saling menimpa lebih buruk daripada label yang
 *  lebih jarang. */
export function LabelX({ label }: { label: readonly string[] }) {
  const y = GEOM.tinggi - GEOM.pad.bawah + 16;
  const selang = label.length > 6 ? 2 : 1;
  return (
    <g aria-hidden="true">
      {label.map((t, i) =>
        i % selang === 0 || i === label.length - 1 ? (
          <text
            key={`${t}-${i}`}
            x={pusatX(i, label.length)}
            y={y}
            textAnchor="middle"
            fontSize={10}
            fill={WARNA_TINTA_SUMBU}
          >
            {t}
          </text>
        ) : null,
      )}
    </g>
  );
}
```

- [ ] **Step 3b: Buat `web/src/app/_shell/panel/grafik-batang.tsx`**

```tsx
"use client";

import { useState } from "react";
import { PALET_GRAFIK } from "./palet";
import { GEOM, PLOT, Kisi, LabelX, batasAtas, pusatX, skalaY } from "./grafik-dasar";
import { Tabel, Th, Td } from "./tabel";

export type TitikBatang = { label: string; nilai: number };

/**
 * Ujung batang dibulatkan 4px HANYA di sisi atas, dan tetap menempel di garis
 * dasar. `rx` pada <rect> membulatkan keempat sudut, sehingga dasarnya ikut
 * melengkung dan batang terlihat mengambang di atas sumbunya.
 */
function jalurBatang(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const dasar = y + h;
  return `M${x} ${dasar} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${dasar} Z`;
}

/**
 * Grafik batang seri tunggal.
 *
 * TIDAK ada legenda: satu seri sudah dinamai judulnya, dan kotak legenda
 * berisi satu baris hanya menambah perabot.
 *
 * `format` datang sebagai prop dan komponennya tidak tahu satuan apa pun —
 * itulah yang membuatnya boleh dipakai di panel admin, tempat nominal uang
 * tidak boleh singgah sama sekali.
 */
export function GrafikBatang({
  judul,
  data,
  format = (n) => String(n),
  warna = PALET_GRAFIK[0],
}: {
  judul: string;
  data: readonly TitikBatang[];
  format?: (n: number) => string;
  warna?: string;
}) {
  const [sorot, setSorot] = useState<number | null>(null);
  const nilai = data.map((d) => d.nilai);
  const maks = batasAtas(nilai);
  const slot = PLOT.lebar / Math.max(1, data.length);
  // Celah 2px antar batang: dua isian yang bersentuhan terbaca sebagai satu
  // bentuk panjang, bukan sebagai dua nilai.
  const lebarBatang = Math.max(2, slot - 2);
  const dasar = GEOM.tinggi - GEOM.pad.bawah;

  // Label langsung SELEKTIF: hanya batang tertinggi dan batang terakhir.
  // Angka di setiap batang mengubah grafik menjadi tabel yang sulit dibaca.
  const iTertinggi = nilai.reduce((a, v, i) => (v > nilai[a] ? i : a), 0);
  const berlabel = new Set([iTertinggi, data.length - 1]);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${GEOM.lebar} ${GEOM.tinggi}`}
        width="100%"
        height={GEOM.tinggi}
        role="img"
        aria-label={`${judul}. ${data
          .map((d) => `${d.label}: ${format(d.nilai)}`)
          .join(", ")}.`}
        onMouseLeave={() => setSorot(null)}
      >
        <Kisi maks={maks} format={(v) => format(Math.round(v))} />
        <LabelX label={data.map((d) => d.label)} />

        {data.map((d, i) => {
          const y = skalaY(d.nilai, maks);
          const x = GEOM.pad.kiri + slot * i + (slot - lebarBatang) / 2;
          return (
            <g key={`${d.label}-${i}`}>
              {/* Sasaran tunjuk setinggi plot: batang pendek tetap mudah
                  disorot, tanpa mengubah bentuk yang terlihat. */}
              <rect
                x={x}
                y={GEOM.pad.atas}
                width={lebarBatang}
                height={dasar - GEOM.pad.atas}
                fill="transparent"
                onMouseEnter={() => setSorot(i)}
              />
              <path
                data-batang={d.nilai}
                d={jalurBatang(x, y, lebarBatang, dasar - y)}
                fill={warna}
                opacity={sorot === null || sorot === i ? 1 : 0.45}
              />
              {berlabel.has(i) && d.nilai > 0 && (
                <text
                  data-label-langsung=""
                  x={x + lebarBatang / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="currentColor"
                  className="text-panel-ink"
                >
                  {format(d.nilai)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {sorot !== null && (
        <div
          role="presentation"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-panel-border bg-panel-surface px-2 py-1 text-[11.5px] font-bold text-panel-ink shadow-sm"
          style={{
            left: `${(pusatX(sorot, data.length) / GEOM.lebar) * 100}%`,
            top: `${(skalaY(data[sorot].nilai, maks) / GEOM.tinggi) * 100}%`,
          }}
        >
          {data[sorot].label}: {format(data[sorot].nilai)}
        </div>
      )}

      {/* Padanan tabel. Grafik yang hanya bisa dibaca dengan mata adalah
          grafik yang sebagian pemakainya tidak bisa baca sama sekali. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">
          Lihat sebagai tabel
        </summary>
        <div className="mt-2">
          <Tabel label={judul}>
            <thead>
              <tr>
                <Th>Pekan</Th>
                <Th className="text-right">Jumlah</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={`${d.label}-${i}`}>
                  <Td>{d.label}</Td>
                  <Td className="text-right tabular-nums">{format(d.nilai)}</Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: PASS (24 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/grafik-dasar.tsx src/app/_shell/panel/grafik-batang.tsx tests/panel-isi.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): dasar grafik SVG + grafik batang seri tunggal

Sumbu Y selalu mulai dari nol dan batang bernilai nol tetap dirender:
pekan tanpa sesi adalah informasi, dan menghilangkannya membuat delapan
pekan terlihat seperti enam.

Ujung batang dibulatkan hanya di sisi atas lewat path, bukan rx pada
rect — rx membulatkan keempat sudut sehingga batang terlihat mengambang
di atas sumbunya. Label langsung selektif (tertinggi + terakhir); angka
di setiap batang mengubah grafik menjadi tabel yang sulit dibaca.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: GrafikGaris

**Files:**
- Create: `web/src/app/_shell/panel/grafik-garis.tsx`
- Test: `web/tests/panel-isi.test.ts` (modify)

**Interfaces:**
- Consumes: `PALET_GRAFIK`, `WARNA_PERMUKAAN`, `grafik-dasar`, `tabel`.
- Produces: `<GrafikGaris judul label seri format />` dengan `seri: { nama: string; nilai: number[] }[]`.

- [ ] **Step 1: Tulis test yang gagal**

Lebih dulu, lengkapi impor palet di bagian atas berkas test — test di bawah memakai `WARNA_PERMUKAAN`, yang belum ikut diimpor pada Task 1:

```ts
const { PALET_GRAFIK, WARNA_PERMUKAAN } = await import("@/app/_shell/panel/palet");
```

(ganti baris impor palet yang sudah ada, jangan menambah baris kedua)

Lalu tambahkan di akhir berkas:

```ts
const { GrafikGaris } = await import("@/app/_shell/panel/grafik-garis");

const LABEL_PEKAN = ["1 Jul", "8 Jul", "15 Jul", "22 Jul"];
const SERI_UJI = [
  { nama: "Harga klien", nilai: [400000, 800000, 1200000, 900000] },
  { nama: "Honor mitra", nilai: [150000, 300000, 450000, 300000] },
  { nama: "Margin PADMA", nilai: [250000, 500000, 750000, 600000] },
];

describe("GrafikGaris", () => {
  function garis(tambahan: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(GrafikGaris, {
        judul: "Pendapatan, honor, dan margin",
        label: LABEL_PEKAN,
        seri: SERI_UJI,
        format: (n: number) => `Rp ${n.toLocaleString("id-ID")}`,
        ...tambahan,
      } as never),
    );
  }

  it("satu jalur per seri", () => {
    expect([...garis().matchAll(/data-seri="/g)]).toHaveLength(SERI_UJI.length);
  });

  it("legenda WAJIB ada untuk dua seri atau lebih", () => {
    const m = garis();
    for (const s of SERI_UJI) expect(m).toContain(s.nama);
    expect(m).toMatch(/<ul[^>]*aria-label="[^"]*"/);
  });

  it("identitas seri tidak pernah warna semata: tiap seri juga berlabel langsung", () => {
    expect([...garis().matchAll(/data-label-seri="/g)]).toHaveLength(SERI_UJI.length);
  });

  it("memakai ketiga slot palet tervalidasi, sesuai urutannya", () => {
    const m = garis();
    for (const heks of PALET_GRAFIK) expect(m).toContain(heks);
  });

  it("penanda bertumpuk diberi cincin permukaan supaya tidak menyatu", () => {
    // Dua titik yang bertumpuk tanpa cincin terbaca sebagai satu titik, dan
    // dua seri yang berpotongan menjadi satu garis putus.
    expect(garis()).toContain(WARNA_PERMUKAAN);
  });

  it("satu sumbu saja — tiga seri berbagi skala yang sama", () => {
    // Dua sumbu Y adalah kesalahan grafik nomor satu: ia bisa membuat dua
    // seri apa pun terlihat berkorelasi.
    const sumber = baca("src/app/_shell/panel/grafik-garis.tsx");
    expect([...sumber.matchAll(/batasAtas\(/g)]).toHaveLength(1);
  });

  it("punya padanan tabel berisi seluruh seri", () => {
    const m = garis();
    expect(m).toContain("<table");
    expect(m).toContain("Rp 1.200.000");
  });

  it("svg menamai dirinya untuk pembaca layar", () => {
    expect(garis()).toMatch(/<svg[^>]*role="img"/);
  });

  it("tidak mengimpor pemformat rupiah — formatnya selalu datang dari prop", () => {
    const sumber = baca("src/app/_shell/panel/grafik-garis.tsx");
    expect(sumber).not.toContain("formatRupiah");
    expect(sumber).not.toMatch(/Rp\s?\d/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: FAIL — modul `@/app/_shell/panel/grafik-garis` tidak ditemukan.

- [ ] **Step 3: Buat `web/src/app/_shell/panel/grafik-garis.tsx`**

```tsx
"use client";

import { useState } from "react";
import { PALET_GRAFIK, WARNA_PERMUKAAN, WARNA_TINTA_SUMBU } from "./palet";
import { GEOM, Kisi, LabelX, batasAtas, pusatX, skalaY } from "./grafik-dasar";
import { Tabel, Th, Td } from "./tabel";

export type SeriGaris = { nama: string; nilai: readonly number[] };

/**
 * Grafik garis banyak seri.
 *
 * SATU sumbu, selalu. Ketiga seri di panel owner adalah rupiah, jadi mereka
 * memang sebanding; grafik dua sumbu Y bisa membuat dua seri APA PUN terlihat
 * berkorelasi, dan itu kesalahan grafik yang paling sering merugikan.
 *
 * Identitas seri tidak pernah bergantung warna semata: ada legenda DAN label
 * langsung di ujung kanan tiap garis.
 *
 * `format` datang sebagai prop. Komponen ini tidak pernah tahu bahwa angkanya
 * rupiah — itulah yang menjaga money firewall tetap berlaku pada lapisan
 * primitif bersama.
 */
export function GrafikGaris({
  judul,
  label,
  seri,
  format,
}: {
  judul: string;
  label: readonly string[];
  seri: readonly SeriGaris[];
  format: (n: number) => string;
}) {
  const [sorot, setSorot] = useState<number | null>(null);
  const maks = batasAtas(seri.flatMap((s) => [...s.nilai]));
  const n = label.length;

  const warna = (i: number) => PALET_GRAFIK[i % PALET_GRAFIK.length];

  return (
    <div className="relative">
      <ul
        aria-label={`Legenda ${judul}`}
        className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5"
      >
        {seri.map((s, i) => (
          <li key={s.nama} className="flex items-center gap-1.5 text-[11.5px] font-bold text-panel-muted">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: warna(i) }}
            />
            {s.nama}
          </li>
        ))}
      </ul>

      <svg
        viewBox={`0 0 ${GEOM.lebar} ${GEOM.tinggi}`}
        width="100%"
        height={GEOM.tinggi}
        role="img"
        aria-label={`${judul}. ${seri
          .map((s) => `${s.nama} berakhir di ${format(s.nilai[s.nilai.length - 1] ?? 0)}`)
          .join(". ")}.`}
        onMouseLeave={() => setSorot(null)}
      >
        <Kisi maks={maks} format={format} />
        <LabelX label={label} />

        {/* Pita tunjuk per pekan: sasaran sorot jauh lebih besar daripada
            titiknya sendiri, sehingga tooltip tidak perlu diburu. */}
        {label.map((t, i) => (
          <rect
            key={`sasaran-${t}-${i}`}
            x={pusatX(i, n) - GEOM.lebar / (n * 2)}
            y={GEOM.pad.atas}
            width={GEOM.lebar / n}
            height={GEOM.tinggi - GEOM.pad.atas - GEOM.pad.bawah}
            fill="transparent"
            onMouseEnter={() => setSorot(i)}
          />
        ))}

        {sorot !== null && (
          <line
            aria-hidden="true"
            x1={pusatX(sorot, n)}
            y1={GEOM.pad.atas}
            x2={pusatX(sorot, n)}
            y2={GEOM.tinggi - GEOM.pad.bawah}
            stroke={WARNA_TINTA_SUMBU}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {seri.map((s, iSeri) => {
          const titik = s.nilai.map((v, i) => `${pusatX(i, n)},${skalaY(v, maks)}`);
          const akhir = s.nilai.length - 1;
          return (
            <g key={s.nama}>
              <polyline
                data-seri={s.nama}
                points={titik.join(" ")}
                fill="none"
                stroke={warna(iSeri)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {s.nilai.map((v, i) => (
                <circle
                  key={`${s.nama}-${i}`}
                  cx={pusatX(i, n)}
                  cy={skalaY(v, maks)}
                  r={4}
                  fill={warna(iSeri)}
                  // Cincin 2px berwarna permukaan: dua titik yang bertumpuk
                  // tanpa cincin terbaca sebagai satu titik.
                  stroke={WARNA_PERMUKAAN}
                  strokeWidth={2}
                />
              ))}
              {akhir >= 0 && (
                <text
                  data-label-seri={s.nama}
                  x={pusatX(akhir, n)}
                  y={skalaY(s.nilai[akhir], maks) - 9}
                  textAnchor="end"
                  fontSize={10}
                  fontWeight={700}
                  fill={warna(iSeri)}
                >
                  {s.nama}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {sorot !== null && (
        <div
          role="presentation"
          className="pointer-events-none absolute top-10 -translate-x-1/2 rounded-md border border-panel-border bg-panel-surface px-2.5 py-1.5 text-[11.5px] text-panel-ink shadow-sm"
          style={{ left: `${(pusatX(sorot, n) / GEOM.lebar) * 100}%` }}
        >
          <b className="block">{label[sorot]}</b>
          {seri.map((s, i) => (
            <span key={s.nama} className="mt-0.5 flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: warna(i) }}
              />
              {s.nama}: <b className="tabular-nums">{format(s.nilai[sorot] ?? 0)}</b>
            </span>
          ))}
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">
          Lihat sebagai tabel
        </summary>
        <div className="mt-2">
          <Tabel label={judul}>
            <thead>
              <tr>
                <Th>Pekan</Th>
                {seri.map((s) => (
                  <Th key={s.nama} className="text-right">
                    {s.nama}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {label.map((t, i) => (
                <tr key={`${t}-${i}`}>
                  <Td>{t}</Td>
                  {seri.map((s) => (
                    <Td key={s.nama} className="text-right tabular-nums">
                      {format(s.nilai[i] ?? 0)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/panel-isi.test.ts`
Expected: PASS (33 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/_shell/panel/grafik-garis.tsx tests/panel-isi.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): grafik garis banyak seri, satu sumbu

Satu sumbu Y, selalu: ketiga seri owner adalah rupiah dan memang
sebanding. Grafik dua sumbu bisa membuat dua seri APA PUN terlihat
berkorelasi.

Identitas seri tidak pernah warna semata — ada legenda DAN label
langsung di ujung tiap garis. Penanda diberi cincin 2px berwarna
permukaan supaya titik yang bertumpuk tidak terbaca sebagai satu titik.

Formatnya datang sebagai prop; komponen ini tidak pernah tahu angkanya
rupiah, dan itulah yang menjaga money firewall di lapisan primitif.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Tren sesi selesai per pekan

**Files:**
- Create: `web/src/lib/admin/tren.ts`
- Test: `web/tests/admin-tren.test.ts` (create)

**Interfaces:**
- Consumes: `createServerSupabase`, dan `awalPekan`/`geserHari`/`rentangPekan` dari `@/lib/owner/pekan` (matematika tanggal murni, nol nominal).
- Produces: `type TitikTren = { senin: string; rentang: string; jumlah: number }` dan `trenSesiSelesai(hariIni: string, pekan?: number): Promise<TitikTren[]>` — dipakai Task 7.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/admin-tren.test.ts`:

```ts
/**
 * Tren sesi selesai per pekan (`src/lib/admin/tren.ts`).
 *
 * Tiga kelas regresi yang tidak menghasilkan error:
 *
 *  1. Pekan kosong hilang. `hitungRekap` owner mengelompokkan sesi dan
 *     menghasilkan ember hanya untuk pekan yang PUNYA sesi. Bila tren admin
 *     meniru pola itu, delapan pekan akan tampil sebagai enam batang dan
 *     trennya berbohong tanpa satu pun angka yang salah.
 *  2. Service role. Di bawahnya `user_role()` mengembalikan 'klien' dan RLS
 *     tidak ikut diperiksa — angkanya tetap keluar, untuk siapa pun.
 *  3. Money firewall. Berkas ini tidak boleh menyentuh tabel uang sama sekali.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { awalPekan, geserHari } from "@/lib/owner/pekan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const admin = createAdminSupabase();

const KLIEN_UJI = "44444444-4444-4444-4444-4444444444f7";
const PADMA_ID_UJI = "PAD-UJI-0007";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const SESI = {
  pekanIni: "66666666-6666-6666-6666-6666666671f7",
  pekanIniDua: "66666666-6666-6666-6666-6666666672f7",
  duaPekanLalu: "66666666-6666-6666-6666-6666666673f7",
  terjadwal: "66666666-6666-6666-6666-6666666674f7",
  jauhLampau: "66666666-6666-6666-6666-6666666675f7",
};

const HARI_INI = hariIniJakarta();
const SENIN = awalPekan(HARI_INI);
const SENIN_DUA_LALU = geserHari(SENIN, -14);
// Di luar jendela 8 pekan — tidak boleh ikut terhitung.
const JAUH_LAMPAU = geserHari(SENIN, -70);

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("sessions").delete().eq("id", id);
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
}

const { trenSesiSelesai } = await import("@/lib/admin/tren");

type Titik = Awaited<ReturnType<typeof trenSesiSelesai>>[number];

let dasar: Titik[];
let sesudah: Titik[];

beforeAll(async () => {
  await bersihkan();
  ref.sesi = await signInAs("admin@padma.test");
  dasar = await trenSesiSelesai(HARI_INI);

  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Tren",
    email: "uji-tren@padma.test",
    phase_id: "prekonsepsi",
  });

  const dasarSesi = {
    client_id: KLIEN_UJI,
    service_id: SVC,
    partner_id: MITRA,
    status_bayar: "belum" as const,
    catatan: "",
    rekomendasi: "",
  };
  await admin.from("sessions").insert([
    { ...dasarSesi, id: SESI.pekanIni, tanggal: SENIN, status: "selesai" },
    { ...dasarSesi, id: SESI.pekanIniDua, tanggal: SENIN, status: "selesai" },
    { ...dasarSesi, id: SESI.duaPekanLalu, tanggal: SENIN_DUA_LALU, status: "selesai" },
    // Terjadwal, bukan selesai — tidak boleh ikut terhitung.
    { ...dasarSesi, id: SESI.terjadwal, tanggal: SENIN, status: "terjadwal" },
    { ...dasarSesi, id: SESI.jauhLampau, tanggal: JAUH_LAMPAU, status: "selesai" },
  ]);

  sesudah = await trenSesiSelesai(HARI_INI);
});

afterAll(bersihkan);

describe("trenSesiSelesai", () => {
  it("selalu memulangkan delapan pekan berurutan, termasuk yang kosong", () => {
    expect(sesudah).toHaveLength(8);
    for (let i = 1; i < sesudah.length; i++) {
      expect(sesudah[i].senin).toBe(geserHari(sesudah[i - 1].senin, 7));
    }
  });

  it("pekan berjalan adalah titik TERAKHIR, bukan pertama", () => {
    // Sumbu waktu membaca kiri ke kanan; pekan terbaru di kiri akan membuat
    // setiap tren terlihat terbalik.
    expect(sesudah[sesudah.length - 1].senin).toBe(SENIN);
  });

  it("menghitung hanya sesi berstatus selesai", () => {
    const iKini = sesudah.length - 1;
    expect(sesudah[iKini].jumlah).toBe(dasar[iKini].jumlah + 2);
  });

  it("menempatkan sesi pada pekannya sendiri", () => {
    const i = sesudah.findIndex((t) => t.senin === SENIN_DUA_LALU);
    expect(i).toBeGreaterThanOrEqual(0);
    const iDasar = dasar.findIndex((t) => t.senin === SENIN_DUA_LALU);
    expect(sesudah[i].jumlah).toBe(dasar[iDasar].jumlah + 1);
  });

  it("sesi di luar jendela tidak ikut terhitung", () => {
    expect(sesudah.some((t) => t.senin === JAUH_LAMPAU)).toBe(false);
    const total = sesudah.reduce((a, t) => a + t.jumlah, 0);
    const totalDasar = dasar.reduce((a, t) => a + t.jumlah, 0);
    // Tiga sesi selesai disisipkan, tetapi hanya tiga di dalam jendela...
    // dua pekan ini + satu dua pekan lalu = 3; yang jauh lampau di luar.
    expect(total).toBe(totalDasar + 3);
  });

  it("membawa label rentang pekan yang bisa dibaca manusia", () => {
    expect(sesudah[0].rentang).toMatch(/\d/);
  });

  it("jumlah pekan bisa diatur", async () => {
    expect(await trenSesiSelesai(HARI_INI, 4)).toHaveLength(4);
  });

  it("dihitung lewat sesi pengguna: klien tidak melihat tren siapa pun", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("ananda@padma.test");
    const milikKlien = await trenSesiSelesai(HARI_INI);
    ref.sesi = sebelumnya;
    // Klien hanya melihat sesinya sendiri; ia TIDAK boleh melihat sesi klien
    // uji di atas. Totalnya karena itu tidak boleh ikut bertambah tiga.
    const total = milikKlien.reduce((a, t) => a + t.jumlah, 0);
    const totalStaf = sesudah.reduce((a, t) => a + t.jumlah, 0);
    expect(total).toBeLessThan(totalStaf);
  });

  it("tidak ada service role, dan tidak menyentuh tabel uang", () => {
    const sumber = baca("src/lib/admin/tren.ts");
    expect(sumber).toContain("createServerSupabase");
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
    expect(sumber).not.toContain("service_rates");
    expect(sumber).not.toContain("honor_marks");
    expect(sumber).not.toMatch(/Rp\s?\d|formatRupiah/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/admin-tren.test.ts`
Expected: FAIL — modul `@/lib/admin/tren` tidak ditemukan.

- [ ] **Step 3: Buat `web/src/lib/admin/tren.ts`**

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { awalPekan, geserHari, rentangPekan } from "@/lib/owner/pekan";

export type TitikTren = {
  senin: string;   // YYYY-MM-DD
  rentang: string; // label manusia, mis. "1 – 7 Sep 2026"
  jumlah: number;
};

/**
 * Sesi SELESAI per pekan, `pekan` pekan terakhir, terlama di kiri.
 *
 * Emedernya DISIAPKAN LEBIH DULU untuk seluruh rentang, lalu diisi. Itu bukan
 * gaya: mengelompokkan baris yang ada saja — seperti `hitungRekap()` di panel
 * owner — menghasilkan ember hanya untuk pekan yang punya sesi, sehingga
 * delapan pekan tampil sebagai enam batang. Tidak ada satu angka pun yang
 * salah, tetapi trennya berbohong.
 *
 * Matematika tanggalnya dipakai ulang dari `@/lib/owner/pekan`. Impor itu
 * melintasi batas admin/owner, tetapi yang diimpor murni aritmatika kalender —
 * nol nominal, nol query — dan menyalinnya ke sini akan melahirkan definisi
 * "pekan" kedua yang bisa berpisah dari definisi yang dipakai menghitung honor.
 *
 * Memakai SESI PENGGUNA, bukan service role: RLS staf yang mengizinkan bacaan
 * ini, dan di bawah service role `user_role()` justru mengembalikan 'klien'.
 */
export async function trenSesiSelesai(
  hariIni: string,
  pekan = 8,
): Promise<TitikTren[]> {
  const seninKini = awalPekan(hariIni);
  const seninAwal = geserHari(seninKini, -7 * (pekan - 1));
  const mingguAkhir = geserHari(seninKini, 6);

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("sessions")
    // Hanya kolom tanggal: yang dibutuhkan hanya pengelompokannya, jadi tidak
    // ada satu baris data kesehatan pun yang perlu melintas ke server render.
    .select("tanggal")
    .eq("status", "selesai")
    .gte("tanggal", seninAwal)
    .lte("tanggal", mingguAkhir)
    .returns<{ tanggal: string }[]>();

  const ember = new Map<string, number>();
  for (let i = 0; i < pekan; i++) {
    ember.set(geserHari(seninAwal, i * 7), 0);
  }
  for (const baris of data ?? []) {
    const senin = awalPekan(baris.tanggal);
    const kini = ember.get(senin);
    if (kini !== undefined) ember.set(senin, kini + 1);
  }

  return [...ember].map(([senin, jumlah]) => ({
    senin,
    rentang: rentangPekan(senin),
    jumlah,
  }));
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/admin-tren.test.ts`
Expected: PASS (9 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/lib/admin/tren.ts tests/admin-tren.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): tren sesi selesai per pekan

Ember pekan disiapkan lebih dulu untuk seluruh rentang lalu diisi.
Mengelompokkan baris yang ada saja menghasilkan ember hanya untuk pekan
yang punya sesi — delapan pekan tampil sebagai enam batang, tanpa satu
angka pun yang salah, tetapi trennya berbohong.

Matematika tanggal dipakai ulang dari lib/owner/pekan (aritmatika
kalender murni, nol nominal): menyalinnya akan melahirkan definisi
"pekan" kedua yang bisa berpisah dari yang dipakai menghitung honor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Agenda hari ini & aktivitas terbaru

**Files:**
- Create: `web/src/lib/admin/agenda.ts`
- Test: `web/tests/admin-agenda.test.ts` (create)

**Interfaces:**
- Consumes: `createServerSupabase`.
- Produces:
  - `type SesiAgenda = { id: string; namaKlien: string; padmaId: string; namaLayanan: string; namaMitra: string; status: "terjadwal" | "selesai" }`
  - `agendaHariIni(hariIni: string): Promise<SesiAgenda[]>`
  - `type Aktivitas = { jenis: "skrining" | "permintaan"; teks: string; pada: string; href: string }`
  - `aktivitasTerbaru(batas?: number): Promise<Aktivitas[]>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/admin-agenda.test.ts`:

```ts
/**
 * Agenda hari ini & aktivitas terbaru (`src/lib/admin/agenda.ts`).
 *
 * Yang dijaga:
 *  1. "Hari ini" menurut kalender JAKARTA, bukan jam server — Vercel berjalan
 *     UTC, sehingga agenda akan bergeser satu hari selama tujuh jam setiap
 *     hari bila tanggalnya diambil dari `new Date()` di server.
 *  2. Sesi BATAL tidak muncul di agenda. Bidan yang datang ke rumah klien
 *     karena membaca baris yang sudah dibatalkan adalah kerugian nyata.
 *  3. Sesi pengguna, bukan service role.
 *  4. Money firewall — tidak menyentuh tabel uang.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const admin = createAdminSupabase();

const KLIEN_UJI = "44444444-4444-4444-4444-4444444444f8";
const PADMA_ID_UJI = "PAD-UJI-0008";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const SESI = {
  hariIni: "66666666-6666-6666-6666-6666666681f8",
  batalHariIni: "66666666-6666-6666-6666-6666666682f8",
  besok: "66666666-6666-6666-6666-6666666683f8",
};
const KODE_SKRINING = "PDM-UJI-AGENDA-0008";
const PERMINTAAN_UJI = "88888888-8888-8888-8888-8888888888f8";

const HARI_INI = hariIniJakarta();

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("sessions").delete().eq("id", id);
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("booking_requests").delete().eq("id", PERMINTAAN_UJI);
  await admin.from("screenings").delete().eq("kode", KODE_SKRINING);
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
}

const { agendaHariIni, aktivitasTerbaru } = await import("@/lib/admin/agenda");

beforeAll(async () => {
  await bersihkan();
  ref.sesi = await signInAs("admin@padma.test");

  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Agenda",
    email: "uji-agenda@padma.test",
    phase_id: "prekonsepsi",
  });

  const dasarSesi = {
    client_id: KLIEN_UJI,
    service_id: SVC,
    partner_id: MITRA,
    status_bayar: "belum" as const,
    catatan: "",
    rekomendasi: "",
  };
  await admin.from("sessions").insert([
    { ...dasarSesi, id: SESI.hariIni, tanggal: HARI_INI, status: "terjadwal" },
    { ...dasarSesi, id: SESI.batalHariIni, tanggal: HARI_INI, status: "batal" },
    { ...dasarSesi, id: SESI.besok, tanggal: "2027-12-24", status: "terjadwal" },
  ]);
  await admin.from("screenings").insert({
    kode: KODE_SKRINING,
    nama: "Uji Agenda Skrining",
    no_hp: "0812-0000-8888",
    fase: "prekonsepsi",
    jawaban: {},
    hasil: "hijau",
    status_tindak_lanjut: "baru",
  });
  await admin.from("booking_requests").insert({
    id: PERMINTAAN_UJI,
    client_id: KLIEN_UJI,
    service_id: SVC,
    tanggal: "2027-12-24",
    preferensi_waktu: "pagi",
    status: "menunggu",
  });
});

afterAll(bersihkan);

describe("agendaHariIni", () => {
  it("memuat sesi hari ini, dengan nama klien, layanan, dan mitranya", async () => {
    const agenda = await agendaHariIni(HARI_INI);
    const baris = agenda.find((s) => s.id === SESI.hariIni);
    expect(baris).toBeDefined();
    expect(baris!.namaKlien).toBe("Uji Agenda");
    expect(baris!.padmaId).toBe(PADMA_ID_UJI);
    expect(baris!.namaLayanan.length).toBeGreaterThan(0);
    expect(baris!.namaMitra.length).toBeGreaterThan(0);
  });

  it("sesi BATAL tidak muncul", async () => {
    const agenda = await agendaHariIni(HARI_INI);
    expect(agenda.some((s) => s.id === SESI.batalHariIni)).toBe(false);
  });

  it("sesi hari lain tidak muncul", async () => {
    const agenda = await agendaHariIni(HARI_INI);
    expect(agenda.some((s) => s.id === SESI.besok)).toBe(false);
  });

  it("tanggalnya datang sebagai argumen, tidak dibaca dari jam server", () => {
    // Vercel berjalan UTC; `new Date()` di dalam lapisan ini akan menggeser
    // agenda satu hari selama tujuh jam setiap hari.
    const sumber = baca("src/lib/admin/agenda.ts");
    expect(sumber).not.toContain("new Date()");
  });
});

describe("aktivitasTerbaru", () => {
  it("menggabungkan skrining masuk dan permintaan jadwal", async () => {
    const aktivitas = await aktivitasTerbaru(20);
    expect(aktivitas.some((a) => a.jenis === "skrining")).toBe(true);
    expect(aktivitas.some((a) => a.jenis === "permintaan")).toBe(true);
  });

  it("terbaru di atas", async () => {
    const aktivitas = await aktivitasTerbaru(20);
    for (let i = 1; i < aktivitas.length; i++) {
      expect(aktivitas[i - 1].pada >= aktivitas[i].pada).toBe(true);
    }
  });

  it("menghormati batas jumlah baris", async () => {
    expect((await aktivitasTerbaru(2)).length).toBeLessThanOrEqual(2);
  });

  it("setiap baris menautkan modul yang menanganinya", async () => {
    for (const a of await aktivitasTerbaru(20)) {
      expect(a.href.startsWith("/admin/")).toBe(true);
    }
  });
});

describe("pagar lapisan agenda", () => {
  it("sesi pengguna, tanpa service role, tanpa tabel uang", () => {
    const sumber = baca("src/lib/admin/agenda.ts");
    expect(sumber).toContain("createServerSupabase");
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
    expect(sumber).not.toContain("service_rates");
    expect(sumber).not.toContain("honor_marks");
    expect(sumber).not.toMatch(/Rp\s?\d|formatRupiah/);
  });

  it("klien tidak melihat agenda klinik", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("ananda@padma.test");
    const agenda = await agendaHariIni(HARI_INI);
    const aktivitas = await aktivitasTerbaru(20);
    ref.sesi = sebelumnya;
    expect(agenda.some((s) => s.id === SESI.hariIni)).toBe(false);
    // Skrining tidak pernah terbaca klien sama sekali.
    expect(aktivitas.some((a) => a.jenis === "skrining")).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/admin-agenda.test.ts`
Expected: FAIL — modul `@/lib/admin/agenda` tidak ditemukan.

- [ ] **Step 3: Buat `web/src/lib/admin/agenda.ts`**

```ts
import { createServerSupabase } from "@/lib/supabase/server";

export type SesiAgenda = {
  id: string;
  namaKlien: string;
  padmaId: string;
  namaLayanan: string;
  namaMitra: string;
  status: "terjadwal" | "selesai";
};

type BarisAgenda = {
  id: string;
  status: SesiAgenda["status"];
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
};

/**
 * Sesi yang dijadwalkan HARI INI.
 *
 * Tanggalnya datang sebagai ARGUMEN, tidak dibaca dari jam server: Vercel
 * berjalan UTC sementara klinik hidup di WIB, sehingga `new Date()` di sini
 * akan menggeser agenda satu hari selama tujuh jam setiap hari — dan
 * pergeseran itu tidak menghasilkan error apa pun.
 *
 * Sesi BATAL disaring. Bidan yang berangkat ke rumah klien karena membaca
 * baris yang sudah dibatalkan adalah kerugian nyata, bukan sekadar tampilan
 * yang keliru.
 */
export async function agendaHariIni(hariIni: string): Promise<SesiAgenda[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("sessions")
    .select("id, status, clients(nama, padma_id), services(nama), partners(nama)")
    .eq("tanggal", hariIni)
    .neq("status", "batal")
    .returns<BarisAgenda[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    namaKlien: r.clients?.nama ?? "Klien",
    padmaId: r.clients?.padma_id ?? "",
    namaLayanan: r.services?.nama ?? "Layanan",
    namaMitra: r.partners?.nama ?? "Mitra PADMA",
    status: r.status,
  }));
}

export type Aktivitas = {
  jenis: "skrining" | "permintaan";
  teks: string;
  /** ISO timestamp; dipakai mengurutkan, bukan ditampilkan apa adanya. */
  pada: string;
  href: string;
};

/**
 * Apa yang baru masuk ke klinik dari luar.
 *
 * Dua sumber saja — skrining dan permintaan jadwal — karena keduanyalah yang
 * DATANG SENDIRI dan menunggu jawaban admin. Klien baru dan sesi baru adalah
 * hasil tindakan admin sendiri; menampilkannya di sini membuat daftar ini
 * berisi gema pekerjaan yang baru saja dikerjakan.
 *
 * Penggabungan dan pengurutan dilakukan di JS: dua tabel tanpa relasi tidak
 * bisa diurutkan bersama oleh PostgREST tanpa membuat view, dan view berjalan
 * dengan hak pemiliknya sehingga MELEWATI RLS.
 */
export async function aktivitasTerbaru(batas = 6): Promise<Aktivitas[]> {
  const supabase = await createServerSupabase();

  const [skrining, permintaan] = await Promise.all([
    supabase
      .from("screenings")
      .select("kode, nama, created_at")
      .order("created_at", { ascending: false })
      .limit(batas)
      .returns<{ kode: string; nama: string; created_at: string }[]>(),
    supabase
      .from("booking_requests")
      .select("id, created_at, clients(nama), services(nama)")
      .order("created_at", { ascending: false })
      .limit(batas)
      .returns<
        {
          id: string;
          created_at: string;
          clients: { nama: string } | null;
          services: { nama: string } | null;
        }[]
      >(),
  ]);

  const gabungan: Aktivitas[] = [
    ...(skrining.data ?? []).map((r) => ({
      jenis: "skrining" as const,
      teks: `Skrining masuk dari ${r.nama}`,
      pada: r.created_at,
      href: "/admin/skrining",
    })),
    ...(permintaan.data ?? []).map((r) => ({
      jenis: "permintaan" as const,
      teks: `${r.clients?.nama ?? "Klien"} meminta jadwal ${r.services?.nama ?? "layanan"}`,
      pada: r.created_at,
      href: "/admin/sesi",
    })),
  ];

  // Perbandingan string ISO 8601 UTC = perbandingan kronologis.
  gabungan.sort((a, b) => (a.pada < b.pada ? 1 : a.pada > b.pada ? -1 : 0));
  return gabungan.slice(0, batas);
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/admin-agenda.test.ts`
Expected: PASS (10 test).

- [ ] **Step 5: Commit**

```bash
cd web && git add src/lib/admin/agenda.ts tests/admin-agenda.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): agenda hari ini & aktivitas terbaru

Tanggal datang sebagai argumen, tidak dibaca dari jam server: Vercel
berjalan UTC sementara klinik hidup di WIB, jadi new Date() akan
menggeser agenda satu hari selama tujuh jam setiap hari — tanpa
menghasilkan error apa pun.

Sesi batal disaring. Bidan yang berangkat ke rumah klien karena membaca
baris yang sudah dibatalkan adalah kerugian nyata.

Aktivitas hanya memuat dua sumber yang DATANG SENDIRI dan menunggu
jawaban admin; klien baru dan sesi baru adalah tindakan admin sendiri,
dan menampilkannya membuat daftar ini berisi gema pekerjaannya sendiri.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Dashboard admin

**Files:**
- Modify: `web/src/app/admin/page.tsx` (tulis ulang)
- Test: `web/tests/admin-shell.test.ts` (ganti `describe("dashboard antrean admin")`)

**Interfaces:**
- Consumes: `StatTile`, `Kartu`, `Tabel`/`Th`/`Td`, `GrafikBatang`; `hitungAntrean` (sudah ada), `trenSesiSelesai` (Task 5), `agendaHariIni`/`aktivitasTerbaru` (Task 6), `formatTanggalPendek`/`hariIniJakarta`/`formatTanggalID`.
- Produces: halaman `/admin` yang baru.

- [ ] **Step 1: Ganti blok test dashboard (akan MERAH)**

Di `web/tests/admin-shell.test.ts`, ganti seluruh isi `describe("dashboard antrean admin", ...)` dengan:

```ts
describe("dashboard admin", () => {
  const sumberDashboard = baca("src/app/admin/page.tsx");

  async function markupDashboard(): Promise<string> {
    const { default: AdminPage } = await import("@/app/admin/page");
    rute.kini = "/admin";
    return renderToStaticMarkup(await AdminPage());
  }

  it("tetap menautkan inbox skrining (pagar lama, jangan dilepas)", () => {
    expect(sumberDashboard).toContain('href="/admin/skrining"');
  });

  it("menampilkan keempat angka antrean apa adanya", async () => {
    const m = await markupDashboard();
    for (const [label, angka] of [
      ["Skrining baru", sesudah.skriningBaru],
      ["Permintaan jadwal", sesudah.permintaanMenunggu],
      ["Klaim pembayaran", sesudah.klaimMenunggu],
      ["Klien belum aktif", sesudah.klienBelumAktif],
    ] as const) {
      expect(m, `stat tile "${label}" tidak ada`).toContain(label);
      expect(m).toContain(`>${angka}<`);
    }
  });

  it("setiap angka antrean menautkan modul yang menanganinya", async () => {
    const m = await markupDashboard();
    for (const href of [
      "/admin/skrining",
      "/admin/klien",
      "/admin/sesi",
      "/admin/bayar",
    ]) {
      expect(m).toContain(`href="${href}"`);
    }
  });

  it("membawa grafik tren delapan pekan, lengkap dengan padanan tabelnya", async () => {
    const m = await markupDashboard();
    expect([...m.matchAll(/data-batang="/g)]).toHaveLength(8);
    expect(m).toContain("Lihat sebagai tabel");
  });

  it("membawa agenda hari ini dan aktivitas terbaru", async () => {
    const m = await markupDashboard();
    expect(m).toContain("Agenda hari ini");
    expect(m).toContain("Aktivitas terbaru");
  });

  it("aksi cepat menuju formulir yang sebenarnya, bukan tautan mati", async () => {
    const m = await markupDashboard();
    // Keduanya rute nyata yang sudah ada sejak panel operasional lahir.
    expect(m).toContain('href="/admin/klien"');
    expect(m).toContain('href="/admin/sesi"');
  });

  it("TIDAK ada nominal uang di dashboard (money firewall)", async () => {
    const m = await markupDashboard();
    expect(m).not.toMatch(/Rp\s?\d/);
    expect(sumberDashboard).not.toMatch(/Rp\s?\d/);
    expect(sumberDashboard).not.toContain("formatRupiah");
    expect(sumberDashboard).not.toContain("@/lib/owner/rupiah");
  });

  it("penjaga peran tepat satu kali dengan daftar peran persis", () => {
    expect([...sumberDashboard.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumberDashboard).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("hari ini menurut kalender Jakarta, bukan jam server", () => {
    expect(sumberDashboard).toContain("hariIniJakarta");
    expect(sumberDashboard).not.toContain("new Date()");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/admin-shell.test.ts`
Expected: FAIL — belum ada `data-batang`, "Agenda hari ini", maupun "Aktivitas terbaru".

- [ ] **Step 3: Tulis ulang `web/src/app/admin/page.tsx`**

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { hitungAntrean } from "@/lib/admin/antrean";
import { trenSesiSelesai } from "@/lib/admin/tren";
import { agendaHariIni, aktivitasTerbaru } from "@/lib/admin/agenda";
import { formatTanggalID, formatTanggalPendek, hariIniJakarta } from "@/lib/passport/waktu";
import { StatTile } from "@/app/_shell/panel/stat-tile";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { GrafikBatang } from "@/app/_shell/panel/grafik-batang";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Panel Admin" };

const TAUTAN_KECIL =
  "text-[12px] font-bold text-leaf underline underline-offset-4 transition hover:text-night";

export default async function AdminPage() {
  const { nama } = await requireRole(["admin", "owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  // Tanggalnya diteruskan sebagai argumen ke seluruh lapisan data supaya tidak
  // ada satu pun di antaranya yang membaca jam sistem sendiri.
  const hariIni = hariIniJakarta();

  const [antrean, tren, agenda, aktivitas] = await Promise.all([
    hitungAntrean(),
    trenSesiSelesai(hariIni),
    agendaHariIni(hariIni),
    aktivitasTerbaru(6),
  ]);

  const titikTren = tren.map((t) => {
    const { hari, bulan } = formatTanggalPendek(t.senin);
    return { label: `${hari} ${bulan}`, nilai: t.jumlah };
  });

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-panel-ink">Panel Admin</h1>
        <p className="mt-1 text-[13px] text-panel-muted">
          Halo, {nama}. Inilah yang menunggu ditangani hari ini · {formatTanggalID(hariIni)}
        </p>
      </header>

      {/* Keempat angka antrean. `menuntut` menyala hanya saat ada pekerjaan —
          bila semua angka merah, tidak ada yang berarti merah. */}
      <section
        aria-label="Antrean klinik"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          label="Skrining baru"
          nilai={String(antrean.skriningBaru)}
          keterangan="Belum ditindaklanjuti"
          href="/admin/skrining"
          menuntut={antrean.skriningBaru > 0}
        />
        <StatTile
          label="Permintaan jadwal"
          nilai={String(antrean.permintaanMenunggu)}
          keterangan="Menunggu konfirmasi"
          href="/admin/sesi"
          menuntut={antrean.permintaanMenunggu > 0}
        />
        <StatTile
          label="Klaim pembayaran"
          nilai={String(antrean.klaimMenunggu)}
          keterangan="Sesi & paket menunggu verifikasi"
          href="/admin/bayar"
          menuntut={antrean.klaimMenunggu > 0}
        />
        <StatTile
          label="Klien belum aktif"
          nilai={String(antrean.klienBelumAktif)}
          keterangan="Tautan aktivasi belum dipakai"
          href="/admin/klien"
          menuntut={antrean.klienBelumAktif > 0}
        />
      </section>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Kartu
          judul="Sesi selesai per pekan"
          className="xl:col-span-2"
          aksi={
            <Link href="/admin/sesi" className={TAUTAN_KECIL}>
              Buka Sesi
            </Link>
          }
        >
          <GrafikBatang
            judul="Sesi selesai delapan pekan terakhir"
            data={titikTren}
            format={(n) => `${n}`}
          />
        </Kartu>

        <Kartu judul="Aktivitas terbaru">
          {aktivitas.length === 0 ? (
            <p className="text-[12.5px] text-panel-muted">
              Belum ada skrining atau permintaan jadwal yang masuk.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {aktivitas.map((a, i) => (
                <li key={`${a.href}-${i}`} className="text-[12.5px] leading-snug">
                  <Link href={a.href} className="text-panel-ink hover:text-leaf">
                    {a.teks}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Kartu>
      </div>

      <div className="mt-4">
        <Kartu
          judul="Agenda hari ini"
          aksi={
            <Link href="/admin/sesi" className={TAUTAN_KECIL}>
              Jadwalkan sesi
            </Link>
          }
        >
          {agenda.length === 0 ? (
            <p className="text-[12.5px] text-panel-muted">
              Tidak ada sesi terjadwal hari ini.
            </p>
          ) : (
            <Tabel label="Sesi terjadwal hari ini">
              <thead>
                <tr>
                  <Th>Klien</Th>
                  <Th>Layanan</Th>
                  <Th>Mitra</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link href="/admin/klien" className="font-bold hover:text-leaf">
                        {s.namaKlien}
                      </Link>
                      <span className="ml-1.5 text-[11.5px] text-panel-muted">
                        {s.padmaId}
                      </span>
                    </Td>
                    <Td>{s.namaLayanan}</Td>
                    <Td>{s.namaMitra}</Td>
                    <Td>{s.status === "selesai" ? "Selesai" : "Terjadwal"}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/admin-shell.test.ts`
Expected: PASS seluruhnya.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/admin/page.tsx tests/admin-shell.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): dashboard — tren, agenda hari ini, aktivitas terbaru

Empat angka antrean tetap menjadi tautan ke modul yang memadamkannya;
`menuntut` hanya menyala saat ada pekerjaan, sebab bila semua angka
merah, tidak ada yang berarti merah.

Tanggal "hari ini" dihitung sekali menurut kalender Jakarta lalu
diteruskan ke setiap lapisan data, supaya tidak ada satu pun di antaranya
yang membaca jam sistem sendiri.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Deret pekan berurutan untuk grafik owner

**Files:**
- Modify: `web/src/lib/owner/rekap.ts` (tambah satu fungsi murni di akhir)
- Test: `web/tests/owner-rekap.test.ts` (tambah satu `describe`)

**Interfaces:**
- Consumes: `RekapPekan` (sudah ada), `awalPekan`/`geserHari`/`rentangPekan`.
- Produces: `deretPekanTerakhir(rekap: readonly RekapPekan[], hariIni: string, pekan?: number): RekapPekan[]` — dipakai Task 9.

**Kenapa ini ada:** `hitungRekap()` mengelompokkan sesi, sehingga pekan TANPA sesi tidak menghasilkan ember sama sekali. Grafik yang memakai `ambilRekap()` apa adanya akan melompati pekan sepi, dan sumbu waktunya berbohong — persis lubang yang sama sudah ditutup di sisi admin (Task 5), dan kini harus ditutup di sisi owner.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `web/tests/owner-rekap.test.ts`:

```ts
describe("deretPekanTerakhir — sumbu waktu tanpa lubang", () => {
  const { deretPekanTerakhir } = await import("@/lib/owner/rekap");
  const { awalPekan, geserHari } = await import("@/lib/owner/pekan");

  const HARI = "2026-09-06";
  const SENIN = awalPekan(HARI); // 2026-08-31

  /** Satu RekapPekan minimal — hanya medan yang dipakai grafik yang diisi. */
  function pekan(senin: string, harga: number, honor: number): RekapPekan {
    return {
      senin,
      rentang: senin,
      jumlahSesi: 1,
      perMitra: [],
      totalHonor: honor,
      totalHarga: harga,
      margin: harga - honor,
      sesiTakBertarif: [],
    };
  }

  it("memulangkan tepat `pekan` titik, terlama di kiri", () => {
    const hasil = deretPekanTerakhir([pekan(SENIN, 100, 40)], HARI, 4);
    expect(hasil).toHaveLength(4);
    expect(hasil[hasil.length - 1].senin).toBe(SENIN);
    for (let i = 1; i < hasil.length; i++) {
      expect(hasil[i].senin).toBe(geserHari(hasil[i - 1].senin, 7));
    }
  });

  it("pekan tanpa data menjadi NOL, bukan lompatan", () => {
    // Melompatinya membuat tiga pekan tampil sebagai dua titik dan sumbu
    // waktunya berbohong tanpa satu angka pun yang salah.
    const hasil = deretPekanTerakhir([pekan(SENIN, 100, 40)], HARI, 3);
    expect(hasil.slice(0, 2).every((p) => p.totalHarga === 0)).toBe(true);
    expect(hasil.slice(0, 2).every((p) => p.margin === 0)).toBe(true);
    expect(hasil.slice(0, 2).every((p) => p.jumlahSesi === 0)).toBe(true);
  });

  it("pekan yang ada dipakai apa adanya, tidak dihitung ulang", () => {
    const asli = pekan(SENIN, 900, 350);
    const hasil = deretPekanTerakhir([asli], HARI, 2);
    expect(hasil[1]).toBe(asli);
  });

  it("pekan di luar jendela diabaikan", () => {
    const jauh = pekan(geserHari(SENIN, -70), 5000, 1000);
    const hasil = deretPekanTerakhir([jauh, pekan(SENIN, 100, 40)], HARI, 3);
    expect(hasil.some((p) => p.totalHarga === 5000)).toBe(false);
  });

  it("rekap kosong tetap memulangkan deret penuh berisi nol", () => {
    const hasil = deretPekanTerakhir([], HARI, 8);
    expect(hasil).toHaveLength(8);
    expect(hasil.every((p) => p.totalHarga === 0)).toBe(true);
  });
});
```

Pastikan `RekapPekan` sudah ter-import di berkas test itu; bila belum, tambahkan ke baris import tipe yang sudah ada.

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/owner-rekap.test.ts`
Expected: FAIL — `deretPekanTerakhir` tidak ada.

- [ ] **Step 3: Tambahkan fungsi di akhir `web/src/lib/owner/rekap.ts`**

```ts
/**
 * `pekan` pekan berurutan sampai pekan berjalan, TERLAMA DI KIRI.
 *
 * `hitungRekap()` mengelompokkan sesi, jadi pekan yang tidak punya satu sesi
 * pun tidak menghasilkan ember sama sekali. Grafik yang memakai hasilnya apa
 * adanya akan MELOMPATI pekan sepi: delapan pekan tampil sebagai enam titik,
 * jarak antar titik menjadi tidak sama, dan garisnya berbohong tanpa satu
 * angka pun yang salah.
 *
 * Pekan kosong diisi nol, bukan dihilangkan — dan nol memang benar: tidak ada
 * sesi berarti tidak ada honor, tidak ada harga, tidak ada margin.
 *
 * Fungsi MURNI: tidak membaca jam sistem dan tidak menyentuh basis data.
 */
export function deretPekanTerakhir(
  rekap: readonly RekapPekan[],
  hariIni: string,
  pekan = 8,
): RekapPekan[] {
  const seninKini = awalPekan(hariIni);
  const adaNya = new Map(rekap.map((p) => [p.senin, p]));

  return Array.from({ length: pekan }, (_, i) => {
    const senin = geserHari(seninKini, -7 * (pekan - 1 - i));
    const punya = adaNya.get(senin);
    if (punya) return punya;
    return {
      senin,
      rentang: rentangPekan(senin),
      jumlahSesi: 0,
      perMitra: [],
      totalHonor: 0,
      totalHarga: 0,
      margin: 0,
      sesiTakBertarif: [],
    };
  });
}
```

Berkas ini sudah mengimpor `awalPekan` dan `rentangPekan` dari `./pekan`; tambahkan `geserHari` ke daftar impor yang sama — jangan menulis baris impor kedua.

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/owner-rekap.test.ts`
Expected: PASS seluruhnya.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/lib/owner/rekap.ts tests/owner-rekap.test.ts
git commit -m "$(cat <<'EOF'
feat(owner): deret pekan berurutan untuk sumbu waktu grafik

hitungRekap mengelompokkan sesi, jadi pekan tanpa sesi tidak menghasilkan
ember sama sekali. Grafik yang memakai hasilnya apa adanya melompati
pekan sepi: delapan pekan tampil sebagai enam titik, jarak antar titik
tidak lagi sama, dan garisnya berbohong tanpa satu angka pun yang salah.

Fungsi murni — tidak membaca jam sistem, tidak menyentuh basis data.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Dashboard owner

**Files:**
- Modify: `web/src/app/owner/page.tsx` (tulis ulang)
- Test: `web/tests/owner-kerangka.test.ts` (ganti `describe("beranda owner")`)

**Interfaces:**
- Consumes: `StatTile`, `Kartu`, `Tabel`/`Th`/`Td`, `GrafikGaris`; `ambilRekap` (sudah ada), `deretPekanTerakhir` (Task 8), `formatRupiah`.
- Produces: halaman `/owner` yang baru.

**Satu bacaan, bukan dua.** Halaman lama memakai `ringkasanPekanIni(hariIni)`, dan fungsi itu MEMANGGIL `ambilRekap()` di dalamnya. Karena halaman baru juga butuh `ambilRekap()` untuk grafiknya, memakai keduanya berarti membaca seluruh sesi, tarif, dan tanda bayar DUA KALI setiap kali beranda dibuka. Halaman ini karena itu memanggil `ambilRekap()` sekali saja, lalu mengambil pekan berjalan dari elemen TERAKHIR `deretPekanTerakhir(...)` — yang menurut definisinya memang pekan berjalan, dan sudah berisi nol bila pekan itu belum punya sesi. `RingkasanPekan` juga tidak memuat `perMitra` sama sekali, sedangkan tabel mitra membutuhkannya; `RekapPekan` memuatnya. `ringkasanPekanIni` TETAP ADA dan tetap diuji sebagai lapisan data — yang berubah hanya: halaman ini tidak lagi memanggilnya.

- [ ] **Step 1: Ganti blok test beranda owner (akan MERAH)**

Di `web/tests/owner-kerangka.test.ts`, ganti seluruh isi `describe("beranda owner", ...)` dengan:

```ts
describe("beranda owner", () => {
  const sumberBeranda = baca("src/app/owner/page.tsx");

  async function markupBeranda(): Promise<string> {
    const { default: OwnerPage } = await import("@/app/owner/page");
    rute.kini = "/owner";
    return renderToStaticMarkup(await OwnerPage());
  }

  it("judulnya mengikuti template `%s · PADMA` (bukan judul penuh sendiri)", () => {
    expect(sumberBeranda).toMatch(/metadata\s*=\s*\{\s*title:\s*"Panel Owner"\s*\}/);
  });

  it('teks "Panel Owner" tetap ada (dikunci tests/e2e/access-matrix.e2e.ts)', async () => {
    expect(await markupBeranda()).toContain("Panel Owner");
  });

  it("menampilkan ketiga angka pekan berjalan apa adanya", async () => {
    const m = await markupBeranda();
    expect(m).toContain("Sesi selesai pekan ini");
    expect(m).toContain("Honor dibayar Sabtu ini");
    expect(m).toContain("Margin PADMA pekan ini");
  });

  it("nominal HIDUP di sini — panel ini memang satu-satunya tempatnya", async () => {
    expect(await markupBeranda()).toMatch(/Rp\s?\d/);
  });

  it("grafik tren memuat delapan pekan dan ketiga serinya", async () => {
    const m = await markupBeranda();
    expect([...m.matchAll(/data-seri="/g)]).toHaveLength(3);
    expect([...m.matchAll(/data-label-seri="/g)]).toHaveLength(3);
    // Legenda WAJIB untuk dua seri atau lebih.
    expect(m).toMatch(/<ul[^>]*aria-label="Legenda/);
  });

  it("grafik punya padanan tabel", async () => {
    expect(await markupBeranda()).toContain("Lihat sebagai tabel");
  });

  it("menampilkan mitra teraktif pekan ini", async () => {
    expect(await markupBeranda()).toContain("Mitra teraktif pekan ini");
  });

  it("memperingatkan sesi tak bertarif, tidak menelannya diam-diam", () => {
    // Sesi yang lebih tua dari tarif paling awal layanannya adalah uang yang
    // hilang tanpa jejak; ia wajib tampil sebagai peringatan yang menautkan
    // langsung ke perbaikannya.
    expect(sumberBeranda).toContain("belum bertarif");
    expect(sumberBeranda).toContain('href="/owner/tarif"');
  });

  it("penjaga peran tepat satu kali dengan peran PERSIS owner", () => {
    expect([...sumberBeranda.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumberBeranda).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
  });

  it("hari ini menurut kalender Jakarta, bukan jam server", () => {
    expect(sumberBeranda).toContain("hariIniJakarta");
    expect(sumberBeranda).not.toContain("new Date()");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/owner-kerangka.test.ts`
Expected: FAIL — belum ada `data-seri`, legenda, maupun "Mitra teraktif pekan ini".

- [ ] **Step 3: Tulis ulang `web/src/app/owner/page.tsx`**

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilRekap } from "@/lib/owner/data";
import { deretPekanTerakhir } from "@/lib/owner/rekap";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, formatTanggalPendek, hariIniJakarta } from "@/lib/passport/waktu";
import { StatTile } from "@/app/_shell/panel/stat-tile";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { GrafikGaris } from "@/app/_shell/panel/grafik-garis";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Panel Owner" };

const TAUTAN_KECIL =
  "text-[12px] font-bold text-leaf underline underline-offset-4 transition hover:text-night";

export default async function OwnerPage() {
  const { nama } = await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();

  // SATU bacaan. `ringkasanPekanIni()` memanggil `ambilRekap()` di dalamnya,
  // jadi memakai keduanya berarti membaca seluruh sesi, tarif, dan tanda bayar
  // dua kali setiap beranda dibuka. Grafik pun tidak butuh query baru: rekap
  // ini sudah memuat SELURUH pekan lengkap dengan marginnya.
  const rekap = await ambilRekap();

  // Pekan sepi tidak punya ember sendiri di `hitungRekap()`; deretPekanTerakhir
  // mengisinya dengan nol supaya sumbu waktunya tidak berlubang.
  const deret = deretPekanTerakhir(rekap, hariIni, 8);
  // Elemen terakhir deret ADALAH pekan berjalan menurut definisinya, dan sudah
  // berisi nol bila pekan itu belum punya sesi sama sekali.
  const pekan = deret[deret.length - 1];
  const jumlahMitra = pekan.perMitra.length;
  const jumlahTakBertarif = pekan.sesiTakBertarif.length;

  const labelPekan = deret.map((p) => {
    const { hari, bulan } = formatTanggalPendek(p.senin);
    return `${hari} ${bulan}`;
  });

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-panel-ink">Panel Owner</h1>
        <p className="mt-1 text-[13px] text-panel-muted">
          Halo, {nama}. Ringkasan pekan berjalan · {formatTanggalID(hariIni)}
        </p>
      </header>

      <section
        aria-label={`Ringkasan pekan ${pekan.rentang}`}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <StatTile
          label="Sesi selesai pekan ini"
          nilai={String(pekan.jumlahSesi)}
          keterangan={
            pekan.jumlahSesi === 0
              ? "Selesaikan sesi di panel Admin — angka ini ikut bergerak."
              : `${jumlahMitra} mitra bekerja · ${pekan.rentang}`
          }
        />
        <StatTile
          label="Honor dibayar Sabtu ini"
          nilai={formatRupiah(pekan.totalHonor)}
          keterangan={`Dari sesi berstatus Selesai pekan ${pekan.rentang}`}
          href="/owner/rekap"
        />
        <StatTile
          label="Margin PADMA pekan ini"
          nilai={formatRupiah(pekan.margin)}
          keterangan="Harga klien − honor mitra"
        />
      </section>

      {/* Sesi yang lebih tua dari tarif paling awal layanannya TIDAK boleh
          dihitung nol diam-diam — itu uang yang hilang tanpa jejak. Ia muncul
          di sini sebagai peringatan yang menautkan langsung ke perbaikannya. */}
      {jumlahTakBertarif > 0 && (
        <p className="mt-3 rounded-lg border border-clay/35 bg-panel-surface px-4 py-3 text-[12.5px] leading-relaxed text-panel-ink">
          <b className="text-clay">
            {jumlahTakBertarif} sesi pekan ini belum bertarif.
          </b>{" "}
          Layanannya belum punya tarif yang berlaku pada tanggal sesi, jadi
          honornya belum ikut dihitung di angka mana pun di atas.{" "}
          <Link href="/owner/tarif" className="font-bold text-leaf underline underline-offset-4">
            Tetapkan tarifnya
          </Link>{" "}
          atau lihat rinciannya di{" "}
          <Link href="/owner/rekap" className="font-bold text-leaf underline underline-offset-4">
            Rekap &amp; Honor
          </Link>
          .
        </p>
      )}

      <div className="mt-4">
        <Kartu
          judul="Delapan pekan terakhir"
          aksi={
            <Link href="/owner/rekap" className={TAUTAN_KECIL}>
              Buka Rekap &amp; Honor
            </Link>
          }
        >
          <GrafikGaris
            judul="Harga klien, honor mitra, dan margin per pekan"
            label={labelPekan}
            seri={[
              { nama: "Harga klien", nilai: deret.map((p) => p.totalHarga) },
              { nama: "Honor mitra", nilai: deret.map((p) => p.totalHonor) },
              { nama: "Margin PADMA", nilai: deret.map((p) => p.margin) },
            ]}
            format={formatRupiah}
          />
        </Kartu>
      </div>

      <div className="mt-4">
        <Kartu judul="Mitra teraktif pekan ini">
          {pekan.perMitra.length === 0 ? (
            <p className="text-[12.5px] text-panel-muted">
              Belum ada sesi selesai pekan ini.
            </p>
          ) : (
            <Tabel label={`Mitra pekan ${pekan.rentang}`}>
              <thead>
                <tr>
                  <Th>Mitra</Th>
                  <Th className="text-right">Sesi</Th>
                  <Th className="text-right">Honor</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {[...pekan.perMitra]
                  .sort((a, b) => b.jumlahSesi - a.jumlahSesi)
                  .map((m) => (
                    <tr key={m.partnerId}>
                      <Td className="font-bold">{m.nama}</Td>
                      <Td className="text-right tabular-nums">{m.jumlahSesi}</Td>
                      <Td className="text-right tabular-nums">
                        {formatRupiah(m.totalHonor)}
                      </Td>
                      <Td>{m.sudahDibayar ? "Sudah dibayar" : "Belum dibayar"}</Td>
                    </tr>
                  ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-panel-muted">
        Honor dihitung dengan tarif yang berlaku <b>pada tanggal sesi</b>, jadi
        menaikkan tarif hari ini tidak menggeser satu angka pun di pekan yang
        sudah lewat.
      </p>
    </main>
  );
}
```

Medan `RekapPekan` yang dipakai halaman ini — `senin`, `rentang`, `jumlahSesi`, `perMitra`, `totalHonor`, `totalHarga`, `margin`, `sesiTakBertarif` — seluruhnya sudah ada di `src/lib/owner/rekap.ts` (terverifikasi). Jangan menambah medan baru ke lapisan data untuk mencocokkan halaman ini.

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/owner-kerangka.test.ts tests/owner-rekap-halaman.test.ts`
Expected: PASS keduanya.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/owner/page.tsx tests/owner-kerangka.test.ts
git commit -m "$(cat <<'EOF'
feat(owner): dashboard — tren delapan pekan & mitra teraktif

Grafik tidak butuh satu query pun yang baru: ambilRekap() sudah
memulangkan seluruh pekan lengkap dengan marginnya. Yang ditambahkan
hanya pengisian pekan sepi lewat deretPekanTerakhir.

Peringatan "sesi belum bertarif" tetap tampil apa adanya — itu uang yang
hilang tanpa jejak, dan tidak boleh tenggelam di dashboard yang lebih
ramai.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Verifikasi menyeluruh

**Files:**
- Modify: berkas mana pun yang ternyata masih merah

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: bukti bahwa dashboard baru tidak merusak apa pun di luar dirinya.

- [ ] **Step 1: Seluruh suite Vitest**

Run: `cd web && npm test`
Expected: seluruh berkas PASS.

Bila ada berkas lain yang merah, kemungkinan besar ia mengasersi bentuk beranda lama (mis. kelas `font-serif`, `rounded-2xl`, atau teks kartu yang berpindah). Untuk tiap kegagalan: baca komentar di atas test itu, putuskan apakah yang dijaga masih berlaku, lalu **perbarui asersinya tanpa melonggarkan maksudnya**. Jangan pernah menghapus test hanya karena bentuknya berubah, dan jangan pernah melonggarkan hitungan persis menjadi rentang.

- [ ] **Step 2: Lint**

Run: `cd web && npm run lint`
Expected: nol error.

- [ ] **Step 3: TypeScript**

Run: `cd web && npx tsc --noEmit`
Expected: nol error. Perhatikan khususnya prop `readonly` pada komponen grafik — array yang dipulangkan `map()` bukan `readonly`, dan sebaliknya.

- [ ] **Step 4: Build produksi**

Run: `cd web && npm run build`
Expected: sukses. Ini menangkap kesalahan batas server/client: kedua komponen grafik adalah client component yang menerima fungsi `format` sebagai prop DARI server component — fungsi tidak serializable melintasi batas itu, jadi bila build gagal di sini, pembungkusnya yang harus berubah (mis. grafik menerima array string yang sudah diformat), bukan pagarnya yang dilonggarkan. Laporkan bila terjadi; jangan diam-diam memindahkan `formatRupiah` ke dalam komponen bersama — itu menembus money firewall.

- [ ] **Step 5: E2E**

Run: `cd web && npm run test:e2e:admin && npm run test:e2e:owner && npm run test:e2e:pelengkap`
Expected: ketiganya lulus.

- [ ] **Step 6: Tangkapan layar**

Tulis skrip Playwright sekali pakai (Playwright sudah menjadi devDependency; `tests/e2e/` memuat contoh alur login). Ambil `/admin` dan `/owner` pada 1280×900 dan 390×844, plus satu tangkapan dengan tooltip grafik terlihat (arahkan penunjuk ke salah satu batang). Simpan PNG-nya ke direktori kerja rencana ini, sebutkan nama berkasnya di laporan, lalu HAPUS skripnya — ia tidak boleh ikut ter-commit.

Periksa pada tangkapan itu empat hal yang tidak dijaga satu pun test: grafik tidak terpotong di 390px; label sumbu X tidak saling menimpa; tooltip tidak keluar dari kartunya; dan tabel agenda menggulung di dalam kartunya, bukan memaksa halaman ikut menggulung.

- [ ] **Step 7: Commit perbaikan (bila ada)**

```bash
cd web && git add -A
git commit -m "$(cat <<'EOF'
test(dashboard): rapikan asersi yang tersisa setelah beranda berganti

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Bila tidak ada yang perlu di-commit, katakan demikian apa adanya — jangan membuat commit kosong.
