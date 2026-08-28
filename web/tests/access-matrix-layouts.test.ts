/**
 * Penjagaan matriks peran pada SUMBER layout terproteksi.
 *
 * Kenapa test ini ada: `tests/require-role.test.ts` menguji fungsi requireRole
 * dengan argumen buatan (mock), BUKAN argumen yang benar-benar dipakai tiap
 * layout. Jadi bila seseorang salah menulis `requireRole(["owner","admin"])`
 * di src/app/owner/layout.tsx, seluruh unit test tetap hijau dan regresi
 * keamanan lolos diam-diam. `tests/e2e/access-matrix.e2e.ts` menutup celah itu
 * lewat browser sungguhan, tapi berada di luar `npm test` (butuh server dev +
 * Playwright).
 *
 * Test ini membaca berkas layout apa adanya dan menegaskan daftar peran yang
 * diizinkan PERSIS sesuai matriks. Mengubah daftar peran di layout mana pun
 * membuat test ini MERAH.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");

/** Matriks resmi: rute terproteksi -> peran yang boleh membukanya. */
const MATRIKS: Array<{ rute: string; berkas: string; peran: string[] }> = [
  { rute: "/admin", berkas: "src/app/admin/layout.tsx", peran: ["admin", "owner"] },
  { rute: "/owner", berkas: "src/app/owner/layout.tsx", peran: ["owner"] },
  { rute: "/passport", berkas: "src/app/passport/layout.tsx", peran: ["klien"] },
];

/**
 * Ambil daftar peran dari satu-satunya pemanggilan requireRole([...]) di
 * sumber. Sengaja parsing sederhana: bila bentuk panggilannya berubah (mis.
 * daftar peran dipindah ke variabel), test gagal dan memaksa peninjauan ulang
 * alih-alih diam-diam berhenti menjaga apa pun.
 */
function peranDiSumber(sumber: string, berkas: string): string[] {
  const semua = [...sumber.matchAll(/requireRole\(\s*\[([^\]]*)\]\s*\)/g)];
  expect(
    semua.length,
    `${berkas} harus memanggil requireRole([...]) tepat satu kali (ditemukan ${semua.length})`,
  ).toBe(1);
  return [...semua[0][1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}

describe("matriks peran — argumen requireRole nyata di tiap layout", () => {
  for (const { rute, berkas, peran } of MATRIKS) {
    it(`${rute} hanya boleh dibuka peran ${JSON.stringify(peran)}`, () => {
      const sumber = readFileSync(path.join(AKAR, berkas), "utf8");
      expect(peranDiSumber(sumber, berkas)).toEqual(peran);
    });
  }

  it("setiap layout terproteksi benar-benar mengimpor requireRole", () => {
    for (const { berkas } of MATRIKS) {
      const sumber = readFileSync(path.join(AKAR, berkas), "utf8");
      expect(sumber, `${berkas} tidak mengimpor requireRole`).toMatch(
        /import\s*\{[^}]*\brequireRole\b[^}]*\}\s*from\s*["']@\/lib\/auth\/require-role["']/,
      );
    }
  });

  it("guard-nya di-await (tanpa await, redirect tidak menghentikan render)", () => {
    for (const { berkas } of MATRIKS) {
      const sumber = readFileSync(path.join(AKAR, berkas), "utf8");
      expect(sumber, `${berkas} memanggil requireRole tanpa await`).toMatch(
        /await\s+requireRole\(/,
      );
    }
  });
});
