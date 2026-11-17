/**
 * Teks admin modul materi merujuk ke tempat yang benar-benar ada di layar.
 *
 * Tombol "Kelola isi" dihapus saat halaman detail materi lahir (Tugas 11);
 * unggahan isi kini hidup di Kartu "Isi" yang selalu tampil. Lima kalimat
 * yang dibaca admin — tiga di formulir, dua di pesan galat server action —
 * masih menyuruh menekan tombol itu, termasuk pesan sesudah unggahan PDF
 * gagal, yaitu saat admin paling butuh petunjuk yang benar.
 *
 * Komentar sengaja dikecualikan: dokblok yang menceritakan sejarah tombol itu
 * sah. Yang diperiksa hanya kode, tempat kalimat layar hidup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const MODUL = path.join(AKAR, "src/app/admin/materi");

function berkasModul(dir: string): string[] {
  return readdirSync(dir).flatMap((nama) => {
    const p = path.join(dir, nama);
    if (statSync(p).isDirectory()) return berkasModul(p);
    return /\.(ts|tsx)$/.test(nama) ? [p] : [];
  });
}

/** Membuang komentar blok dan komentar baris; string berisi `//` tidak relevan di sini. */
function tanpaKomentar(sumber: string): string {
  return sumber.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("modul materi — rujukan ke panel isi", () => {
  const semua = berkasModul(MODUL);

  it("memindai berkas modul yang sungguhan (bukan nol berkas)", () => {
    expect(semua.some((p) => p.endsWith("form-materi.tsx"))).toBe(true);
    expect(semua.some((p) => p.endsWith("aksi.ts"))).toBe(true);
  });

  it.each(semua.map((p) => [path.relative(AKAR, p), p]))(
    "%s tidak menyuruh admin menekan tombol \"Kelola isi\" yang sudah tidak ada",
    (_rel, p) => {
      expect(tanpaKomentar(readFileSync(p, "utf8"))).not.toMatch(/Kelola isi/);
    },
  );

  it("kartu yang dirujuk teks pengganti benar-benar ada di halaman detail", () => {
    const detail = readFileSync(path.join(MODUL, "[id]/page.tsx"), "utf8");
    expect(detail).toContain('<Kartu judul="Isi">');
    const form = tanpaKomentar(readFileSync(path.join(MODUL, "form-materi.tsx"), "utf8"));
    const aksi = tanpaKomentar(readFileSync(path.join(MODUL, "aksi.ts"), "utf8"));
    expect(form).toMatch(/kartu “Isi”/);
    expect(aksi).toMatch(/kartu “Isi”/);
  });
});
