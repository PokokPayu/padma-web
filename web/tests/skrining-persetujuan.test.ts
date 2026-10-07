/**
 * Persetujuan eksplisit atas data kesehatan di skrining (spec 2026-10-06) — MURNI.
 *
 * Tiga lapis, karena TIDAK ada trigger di `screenings` (spec revisi 1):
 *   1. Skema bersama menolak kiriman tanpa `setuju_privasi: true`.
 *   2. SETIAP insert `screenings` di src/ memakai `capPersetujuanSkrining()` —
 *      jalur ketiga di masa depan tertangkap di sini, bukan di produksi.
 *   3. Wizard tidak bisa dimulai tanpa centang, dan centangnya sampai ke body.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkemaSkriningPublik } from "@/lib/skrining/skema";
import { Wizard } from "@/app/skrining/wizard";
import { JANGKAR_PERSETUJUAN } from "@/app/_dokumen/bagian";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

function semuaBerkas(dir: string): string[] {
  return readdirSync(path.join(AKAR, dir)).flatMap((n) => {
    const rel = path.join(dir, n);
    if (statSync(path.join(AKAR, rel)).isDirectory()) return semuaBerkas(rel);
    return /\.(ts|tsx)$/.test(n) ? [rel] : [];
  });
}

const DASAR = { nama: "Sinta", no_hp: "081234567890", fase: "prekonsepsi", jawaban: { fever: false } };

describe("skema — persetujuan wajib", () => {
  it("menolak kiriman tanpa setuju_privasi", () => {
    expect(SkemaSkriningPublik.safeParse(DASAR).success).toBe(false);
  });

  it("menolak setuju_privasi: false", () => {
    expect(SkemaSkriningPublik.safeParse({ ...DASAR, setuju_privasi: false }).success).toBe(false);
  });

  it("menerima setuju_privasi: true", () => {
    expect(SkemaSkriningPublik.safeParse({ ...DASAR, setuju_privasi: true }).success).toBe(true);
  });
});

describe("STRUKTURAL: setiap insert screenings mencap persetujuan", () => {
  // TANPA flag `g` untuk `.test()`: regex global menyimpan `lastIndex` antar
  // pemanggilan, dan berkas berikutnya bisa terlewat diam-diam. Versi global
  // dibuat terpisah, hanya untuk MENGHITUNG.
  const POLA_INSERT = /\.from\(\s*["']screenings["']\s*\)\s*\.insert\(/;
  const POLA_INSERT_SEMUA = new RegExp(POLA_INSERT.source, "g");
  const berkasInsert = semuaBerkas("src").filter((b) => POLA_INSERT.test(baca(b)));

  it("ada tepat dua penulis skrining hari ini (rute publik & rute akun)", () => {
    expect(berkasInsert.sort()).toEqual([
      path.join("src", "app", "api", "skrining", "akun", "route.ts"),
      path.join("src", "app", "api", "skrining", "route.ts"),
    ]);
  });

  it.each(berkasInsert)("%s: jumlah insert = jumlah capPersetujuanSkrining()", (berkas) => {
    const sumber = baca(berkas);
    const insert = [...sumber.matchAll(POLA_INSERT_SEMUA)].length;
    const cap = [...sumber.matchAll(/\.\.\.capPersetujuanSkrining\(\)/g)].length;
    expect(cap, `${berkas}: ${insert} insert, ${cap} cap`).toBe(insert);
  });
});

describe("wizard — centang persetujuan data kesehatan", () => {
  const sumber = baca("src/app/skrining/wizard.tsx");
  const markup = renderToStaticMarkup(createElement(Wizard, { nomorWaLink: "6287778400200" }));

  it("layar pembuka memuat centang TERPISAH dengan tautan ke bagian data kesehatan", () => {
    expect(markup).toContain("memproses data kesehatan yang saya isi di skrining ini");
    expect(markup).toContain(`href="${JANGKAR_PERSETUJUAN.dataKesehatan}"`);
    expect(markup).toMatch(/href="\/kebijakan-privasi#data-kesehatan"[^>]*target="_blank"/);
    // Dua centang: "jujur" yang lama + persetujuan yang baru.
    expect([...markup.matchAll(/type="checkbox"/g)]).toHaveLength(2);
  });

  it("tombol Mulai mensyaratkan centang persetujuan", () => {
    // Sebaris, bukan `[^)]*`: ekspresinya memuat `nama.trim()`, dan kelas
    // karakter itu berhenti di `)` pertama.
    expect(sumber).toMatch(/const bolehMulai = Boolean\(.*\bsetujuPrivasi\b.*\);/);
  });

  it("centangnya sampai ke body kiriman", () => {
    expect(sumber).toContain("setuju_privasi: setujuPrivasi");
  });
});
