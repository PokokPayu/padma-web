import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (p: string) => readFileSync(path.join(AKAR, p), "utf8");

const RUTE = [
  "src/app/api/produk/[id]/video/route.ts",
  "src/app/api/produk/[id]/halaman/[n]/route.ts",
  "src/app/api/produk/[id]/unduh/route.ts",
];

/**
 * Rute penyaji adalah endpoint MANDIRI: layout `/passport` tidak menjaganya,
 * dan itu sudah dibuktikan di repo ini dengan mem-POST server action panel
 * admin dari rute lain. Seluruh pemeriksaannya karena itu harus ada di dalam
 * berkas rutenya sendiri — dan itulah yang diperiksa sebagai TEKS SUMBER di
 * sini, karena satu `if` yang terhapus tidak terlihat oleh uji perilaku yang
 * hanya menembak jalur bahagia.
 */
describe("gerbang isi produk", () => {
  it.each(RUTE)("%s menolak dengan 404, tidak pernah 401/403", (rute) => {
    const sumber = baca(rute);
    expect(sumber).toContain("status: 404");
    expect(sumber).not.toContain("status: 401");
    expect(sumber).not.toContain("status: 403");
  });

  it.each(RUTE)("%s memutuskan hak lewat SESI pengguna sebelum service role", (rute) => {
    const sumber = baca(rute);
    const posisiSesi = sumber.indexOf("createServerSupabase");
    expect(posisiSesi).toBeGreaterThan(-1);
    const posisiService = sumber.indexOf("createAdminSupabase");
    if (posisiService > -1) expect(posisiService).toBeGreaterThan(posisiSesi);
  });

  it.each(RUTE)("%s mengambil path objek dari BARIS, bukan dari parameter URL", (rute) => {
    const sumber = baca(rute);
    // Parameter rute hanya dipakai sebagai kunci query (.eq), tidak pernah
    // dirakit menjadi path storage.
    expect(sumber).toContain(".eq(");
    expect(sumber).not.toMatch(/from\((["'`])(produk-halaman|produk-berkas)\1\)[\s\S]{0,80}\$\{id\}/);
  });

  it("rute unduh memakai umur tanda tangan unduh, bukan umur tonton", () => {
    const sumber = baca("src/app/api/produk/[id]/unduh/route.ts");
    expect(sumber).toContain("urlUnduhBerkas");
    expect(sumber).not.toContain("UMUR_TONTON_DETIK");
  });

  it("rute unduh menolak produk yang boleh_unduh-nya mati", () => {
    expect(baca("src/app/api/produk/[id]/unduh/route.ts")).toContain("boleh_unduh");
  });

  it("umur unduh benar-benar 15 menit", async () => {
    const { UMUR_UNDUH_DETIK } = await import("@/lib/r2");
    expect(UMUR_UNDUH_DETIK).toBe(15 * 60);
  });

  it("empat rute baru terdaftar di README", () => {
    const readme = baca("README.md");
    expect(readme).toContain("| `/api/produk/[id]/video` |");
    expect(readme).toContain("| `/api/produk/[id]/halaman/[n]` |");
    expect(readme).toContain("| `/api/produk/[id]/unduh` |");
    expect(readme).toContain("| `/passport/produk/[slug]` |");
  });
});

describe("cap PDF pembeli", () => {
  it("membuang karakter kontrol C0 dari nama sebelum dibakar", async () => {
    const { bersihkanNamaCap } = await import("@/lib/produk/cap-pdf");
    // C0 mentah DIBUANG, bukan di-escape: tidak ada bentuk escaped yang sah
    // baginya. Satu nama yang memuatnya membuat pencapan melempar untuk
    // SETIAP unduhan pembeli itu, permanen, tanpa satu pun jejak di layar
    // yang menunjuk penyebabnya. Alasan lengkapnya di lib/materi/watermark.ts.
    const vertikalTab = String.fromCharCode(11);
    expect(bersihkanNamaCap(`Ibu${vertikalTab}Sari`)).toBe("IbuSari");
    // Tab, LF, dan CR adalah tiga karakter kontrol yang SAH — dibiarkan.
    expect(bersihkanNamaCap("Ibu\tSari")).toBe("Ibu\tSari");
  });

  it("objek PDF tercap dipisahkan per pembeli", async () => {
    const { objekPdfPembeli } = await import("@/lib/produk/cap-pdf");
    expect(objekPdfPembeli("prod-1", "klien-9")).toBe("prod-1/pembeli/klien-9.pdf");
  });
});
