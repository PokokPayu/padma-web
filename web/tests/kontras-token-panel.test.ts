/**
 * Kontras token teks panel staf terhadap latar yang benar-benar dipakai.
 *
 * `text-panel-muted` dipakai di 70-an berkas `/admin` & `/owner`, di atas
 * `bg-panel-bg` (latar halaman) dan `bg-panel-surface` (kartu). Nilai lamanya
 * (#6b756e) hanya 4,41:1 di atas `panel-bg` — di bawah WCAG AA 4,5:1 untuk
 * teks normal, dan teks muted di panel ini sebagian besar berukuran 11–13px.
 *
 * Dibaca dari `globals.css` sungguhan, bukan disalin ke sini: mengubah token
 * ke nilai yang gagal memerahkan uji ini.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");

function token(nama: string): string {
  const m = new RegExp(`--color-${nama}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!m) throw new Error(`token --color-${nama} tidak ditemukan`);
  return m[1];
}

/** Luminans relatif WCAG 2.x. */
function luminans(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rasio(a: string, b: string): number {
  const [terang, gelap] = [luminans(a), luminans(b)].sort((x, y) => y - x);
  return (terang + 0.05) / (gelap + 0.05);
}

describe("rumus kontras (kontrol)", () => {
  it("hitam di atas putih = 21:1, dan nilai lama muted memang 4,41:1", () => {
    expect(rasio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(rasio("#6b756e", "#f5f6f4")).toBeCloseTo(4.41, 2);
  });
});

describe("token teks panel staf memenuhi WCAG AA (4,5:1)", () => {
  const PASANGAN: Array<[teks: string, latar: string]> = [
    ["panel-muted", "panel-bg"],
    ["panel-muted", "panel-surface"],
    ["panel-ink", "panel-bg"],
    ["panel-ink", "panel-surface"],
    ["panel-rail-ink", "panel-rail"],
    ["panel-rail-aktif", "panel-rail"],
  ];

  it.each(PASANGAN)("%s di atas %s", (teks, latar) => {
    expect(rasio(token(teks), token(latar))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("salinan warna muted di luar CSS", () => {
  it("tinta sumbu grafik = token panel-muted, bukan salinan yang bisa berpisah", async () => {
    const { WARNA_TINTA_SUMBU } = await import("@/app/_shell/panel/palet");
    expect(WARNA_TINTA_SUMBU.toLowerCase()).toBe(token("panel-muted").toLowerCase());
  });
});
