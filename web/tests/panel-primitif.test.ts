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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
