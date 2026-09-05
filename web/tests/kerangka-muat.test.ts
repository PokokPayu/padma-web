/**
 * Kerangka muat (skeleton) ketiga panel.
 *
 * Sebelum ini tidak ada satu pun `loading.tsx` di repo: berpindah halaman
 * berarti menatap halaman lama sampai isi baru tiba. Test ini menjaga tiga hal
 * yang mudah hilang diam-diam saat seseorang merapikan berkas nanti:
 *
 *   1. Ketiga panel benar-benar punya `loading.tsx`.
 *   2. Kerangkanya mengumumkan dirinya ke pembaca layar, dan blok-blok abunya
 *      TIDAK ikut terbaca sebagai isi.
 *   3. Denyutnya berhenti bagi pemakai yang menyetel "kurangi gerak".
 *
 * Hanya membaca berkas dan merender komponen — tidak butuh DB maupun server.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Blok, KartuSkeleton, HalamanSkeleton } from "@/app/_shell/skeleton";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const PANEL = ["admin", "owner", "passport"] as const;

describe("kerangka muat — keberadaan di tiap panel", () => {
  it.each(PANEL)("panel %s punya loading.tsx", (panel) => {
    expect(existsSync(path.join(AKAR, `src/app/${panel}/loading.tsx`))).toBe(
      true,
    );
  });

  it.each(PANEL)("loading.tsx panel %s memakai kerangka bersama", (panel) => {
    const sumber = baca(`src/app/${panel}/loading.tsx`);
    expect(sumber).toContain("HalamanSkeleton");
    expect(sumber).toMatch(/from\s+["']@\/app\/_shell\/skeleton["']/);
    // Label wajib diisi — itulah satu-satunya yang terdengar pembaca layar.
    expect(sumber).toMatch(/label="[^"]+"/);
  });
});

describe("kerangka muat — perilaku", () => {
  it("mengumumkan dirinya sebagai status, bukan sebagai isi", () => {
    const m = renderToStaticMarkup(
      createElement(HalamanSkeleton, { label: "Memuat passport…" }),
    );
    expect(m).toContain('role="status"');
    expect(m).toContain('aria-live="polite"');
    expect(m).toContain("Memuat passport…");
    // Teks statusnya hanya untuk pembaca layar.
    expect(m).toContain("sr-only");
  });

  // Kontrak dengan lapisan E2E. Sejak loading.tsx ada, Next memindahkan URL
  // seketika lalu menyusulkan isi, sehingga menunggu "networkidle" saja bisa
  // selesai ketika layar masih berisi kerangka — persis yang sempat membuat
  // pemeriksaan 2b di admin-pelengkap merah. `tests/e2e/_tunggu.ts` menunggu
  // penanda ini HILANG. Menghapusnya akan membuat keenam skrip E2E menggantung
  // sampai timeout, jauh dari tempat sebabnya.
  it("membawa penanda yang ditunggu skrip E2E", () => {
    const m = renderToStaticMarkup(
      createElement(HalamanSkeleton, { label: "Memuat…" }),
    );
    expect(m).toContain('data-kerangka="muat"');
    expect(baca("tests/e2e/_tunggu.ts")).toContain('data-kerangka="muat"');
  });

  it("blok abunya disembunyikan dari pembaca layar", () => {
    const m = renderToStaticMarkup(createElement(Blok, {}));
    expect(m).toContain('aria-hidden="true"');
  });

  it("setiap blok abu di dalam kartu juga aria-hidden", () => {
    const m = renderToStaticMarkup(createElement(KartuSkeleton, { baris: 4 }));
    const blok = [...m.matchAll(/<span\b[^>]*class="[^"]*animate-pulse/g)];
    const tersembunyi = [...m.matchAll(/aria-hidden="true"/g)];
    // 1 judul + 4 baris = 5 blok, dan SEMUANYA tersembunyi.
    expect(blok).toHaveLength(5);
    expect(tersembunyi.length).toBeGreaterThanOrEqual(blok.length);
  });

  it("denyut berhenti saat pemakai menyetel kurangi gerak", () => {
    const m = renderToStaticMarkup(createElement(Blok, {}));
    expect(m).toContain("animate-pulse");
    expect(m, "denyut tidak dihentikan untuk prefers-reduced-motion").toContain(
      "motion-reduce:animate-none",
    );
  });

  it("HalamanSkeleton meneruskan varian ke SETIAP kartunya", () => {
    // Penerusan `varian` adalah satu-satunya baris yang menghubungkan
    // loading.tsx dengan bentuk kartu. Tanpa test ini, menghapusnya membuat
    // kedua panel staf diam-diam kembali ke bentuk kartu klien — dan tidak
    // ada satu pun test yang merah.
    const m = renderToStaticMarkup(
      createElement(HalamanSkeleton, {
        label: "Memuat panel…",
        kartu: 3,
        varian: "panel" as const,
      }),
    );
    // Setiap KartuSkeleton yang di-render menempatkan KARTU[varian] pada
    // divnya sekali, jadi kartu=3 berarti 3x rounded-lg.
    expect([...m.matchAll(/rounded-lg/g)]).toHaveLength(3);
    expect(m).toContain("border-panel-border");
    expect(m).toContain("bg-panel-surface");
    expect(m).not.toContain("rounded-2xl");
  });

  it("HalamanSkeleton tanpa varian tetap pakai bentuk klien", () => {
    const m = renderToStaticMarkup(
      createElement(HalamanSkeleton, {
        label: "Memuat halaman…",
        kartu: 2,
      }),
    );
    // Default klien: kartu=2 berarti 2x rounded-2xl.
    expect([...m.matchAll(/rounded-2xl/g)]).toHaveLength(2);
    expect(m).toContain("border-black/10");
    expect(m).toContain("bg-white");
    expect(m).not.toContain("rounded-lg");
  });

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
});
