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
    // Diikat pada BADAN fungsi, bukan seluruh berkas: `indexOf` atas seluruh
    // sumber menemukan baris IMPORT (selalu berurutan sesi lalu admin di
    // bagian atas berkas), sehingga asersinya hanya mencerminkan urutan
    // IMPOR dan tetap hijau walau kedua PEMANGGILAN di dalam GET ditukar —
    // persis properti yang seharusnya ia jaga. Fix round 1 (Task 10):
    // ditemukan vacuous lewat pembacaan manual (posisi 9 vs 71 adalah baris
    // import, panggilan sungguhan ada di posisi ~1920). Pola perbaikannya
    // sama dengan tests/materi-route-halaman.test.ts.
    const posisiFungsi = sumber.indexOf("export async function GET");
    // Guard anti-hampa: slice kosong berarti test ini TIDAK MEMBANDINGKAN
    // apa pun dan lolos untuk alasan yang salah — harus gagal keras, bukan
    // diam-diam hijau.
    expect(posisiFungsi, `${rute}: "export async function GET" tidak ditemukan`).toBeGreaterThan(-1);
    const badan = sumber.slice(posisiFungsi);
    const posisiSesi = badan.indexOf("createServerSupabase(");
    expect(posisiSesi).toBeGreaterThan(-1);
    const posisiService = badan.indexOf("createAdminSupabase(");
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

  /**
   * Fix round 1 (Task 10): `drawText` dengan `StandardFonts.Helvetica`
   * (encoding WinAnsi, cakupan cuma Latin-1) MELEMPAR untuk karakter di luar
   * jangkauannya — nama Tionghoa, Vietnam berdiakritik, dst. Tanpa perbaikan
   * ini, pembeli SAH yang namanya memuat karakter semacam itu tidak akan
   * PERNAH bisa mengunduh produk yang ia MILIKI: kelas kegagalan permanen
   * yang sama dengan yang dicegah `bersihkanNamaCap` untuk karakter kontrol,
   * kali ini soal encoding font, bukan soal karakter kontrol.
   */
  it("tidak pernah throw untuk nama Tionghoa murni, dan hasilnya tetap PDF valid", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { capPdfPembeli } = await import("@/lib/produk/cap-pdf");

    const dok = await PDFDocument.create();
    dok.addPage();
    const asli = await dok.save();

    // "李明": TIDAK PUNYA padanan Latin sama sekali (beda dari "Nguyễn" yang
    // masih punya dasar Latin lewat NFKD) — inilah kasus yang sebelum
    // perbaikan ini membuat capPdfPembeli throw untuk SETIAP unduhan pembeli
    // ini, permanen.
    const tercap = await capPdfPembeli(asli, "李明", "pembeli@padma.test", "PDM-0042");

    // Tidak throw sampai baris di atas sudah membuktikan syarat pertama.
    // Dokumennya sendiri harus tetap PDF yang valid dan bisa dibuka ulang —
    // bukti bahwa `drawText` benar-benar terpanggil dengan teks yang sudah
    // dijinakkan, bukan gagal senyap di tengah jalan.
    const hasilDok = await PDFDocument.load(tercap);
    expect(hasilDok.getPageCount()).toBe(1);
  });

  it("nama Vietnam berdiakritik tetap ber-representasi WinAnsi sesudah NFKD", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    // Membuktikan alasan NFKD di komentar `amanWinAnsi` lewat pdf-lib
    // sendiri, bukan cuma memercayai komentarnya: "Nguyễn" mentah GAGAL
    // di-encode WinAnsi, tapi dasarnya sesudah NFKD + buang diakritik
    // gabungan ("Nguyen") BERHASIL — inilah yang membuat nama itu tetap
    // TERBACA di stempel alih-alih dibuang sepenuhnya seperti nama
    // Tionghoa di uji sebelumnya.
    const dok = await PDFDocument.create();
    const font = await dok.embedFont(StandardFonts.Helvetica);
    expect(() => font.encodeText("Nguyễn")).toThrow();
    const dilepasDiakritik = "Nguyễn".normalize("NFKD").replace(/[̀-ͯ]/g, "");
    expect(dilepasDiakritik).toBe("Nguyen");
    expect(() => font.encodeText(dilepasDiakritik)).not.toThrow();
  });

  it("nama DAN email sama-sama tak ber-representasi WinAnsi tetap tidak throw", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { capPdfPembeli } = await import("@/lib/produk/cap-pdf");

    const dok = await PDFDocument.create();
    dok.addPage();
    const asli = await dok.save();

    // Kasus paling ekstrem: nama DAN email (secara hipotetis) sama-sama
    // tak ber-representasi WinAnsi. Garis pertahanan terakhirnya adalah
    // `idCadangan` (PADMA ID) — string ASCII yang selalu ber-representasi
    // WinAnsi — sehingga stempelnya TIDAK PERNAH kosong maupun throw.
    await expect(
      capPdfPembeli(asli, "李明", "李明@例え.jp", "PDM-0099"),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
