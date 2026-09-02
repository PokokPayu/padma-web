// tests/materi-watermark.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { bakarWatermark } from "@/lib/materi/watermark";

async function gambarPolos(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 560, channels: 3, background: "#ffffff" },
  }).webp().toBuffer();
}

describe("watermark dibakar ke dalam gambar", () => {
  it("dua pasien berbeda menghasilkan byte yang BERBEDA", async () => {
    const polos = await gambarPolos();
    const a = await bakarWatermark(polos, "Ananda Putri", "PAD-2607-0012");
    const b = await bakarWatermark(polos, "Rina Hapsari", "PAD-2608-0019");
    // Inilah bukti bahwa watermark benar-benar DI DALAM gambar. Lapisan CSS
    // akan menghasilkan byte yang identik.
    expect(a.equals(b)).toBe(false);
  });

  it("hasilnya masih gambar WebP yang sah dan berukuran sama", async () => {
    const polos = await gambarPolos();
    const hasil = await bakarWatermark(polos, "Ananda Putri", "PAD-2607-0012");
    const meta = await sharp(hasil).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(560);
  });

  it("nama berisi karakter XML tidak merusak SVG watermark", async () => {
    const polos = await gambarPolos();
    // Nama diketik admin. Tanpa escaping, `<` menutup elemen SVG dan seluruh
    // penyajian halaman gagal — atau lebih buruk, menyisipkan elemen asing.
    const hasil = await bakarWatermark(polos, 'A <b>& "x" </text>', "PAD-1");
    const meta = await sharp(hasil).metadata();
    expect(meta.format).toBe("webp");
  });

  it("gambar yang bukan gambar ditolak, bukan menghasilkan keluaran rusak", async () => {
    await expect(bakarWatermark(Buffer.from("bukan gambar"), "A", "P")).rejects.toThrow();
  });

  it("nama berisi karakter kontrol C0 mentah tidak merusak SVG watermark (Fix 3)", async () => {
    const polos = await gambarPolos();
    // \x0B (vertical tab) BUKAN salah satu dari tiga karakter kontrol yang
    // XML 1.0 anggap legal (hanya tab \x09, LF \x0A, CR \x0D) — dan TIDAK
    // PUNYA representasi escaped yang sah (beda dari `<`/`&`/dst di atas,
    // yang punya entity). Sebelum Fix 3, satu karakter ini di `clients.nama`
    // membuat `sharp.composite` menolak SELURUH SVG-nya dan `bakarWatermark`
    // throw — untuk SETIAP halaman e-book klien itu, permanen.
    const hasil = await bakarWatermark(polos, "Nama\x0BRusak", "PAD-1");
    const meta = await sharp(hasil).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(560);
  });

  it("SETIAP karakter kontrol C0 ilegal (bukan hanya satu contoh) dibuang, bukan cuma satu titik kode yang dipilih khusus", async () => {
    const polos = await gambarPolos();
    // 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F — seluruh rentang C0 KECUALI tab/LF/CR
    // (yang legal di XML 1.0). Menguji satu-per-satu, bukan gabungan: gabungan
    // yang lolos tidak membuktikan SETIAP titik kode individual sudah aman —
    // satu yang lolos di antara 29 lainnya sudah cukup membuat produksi 500
    // permanen untuk pasien bernama itu.
    const ilegal = [
      ...Array.from({ length: 9 }, (_, i) => i), // 0x00-0x08
      0x0b,
      0x0c,
      ...Array.from({ length: 18 }, (_, i) => 0x0e + i), // 0x0e-0x1f
    ];
    for (const kode of ilegal) {
      const nama = `Nama${String.fromCharCode(kode)}Uji`;
      const hasil = await bakarWatermark(polos, nama, "PAD-1");
      const meta = await sharp(hasil).metadata();
      expect(meta.format, `kode 0x${kode.toString(16)} membuat SVG gagal`).toBe("webp");
    }
  });

  it("whitespace SAH (tab/LF/CR) tetap boleh lolos — bukan seluruh C0 yang dibuang, hanya yang ilegal", async () => {
    const polos = await gambarPolos();
    // \x09 \x0A \x0D adalah SATU-SATUNYA karakter kontrol yang XML 1.0 anggap
    // legal. Fix 3 wajib TIDAK ikut membuang ketiganya — kalau tidak, pagar
    // "dibuang, bukan di-escape" ini akan lolos meski implementasinya diam-diam
    // membuang SELURUH rentang 0x00-0x1F (termasuk yang sah), bukan hanya
    // yang XML larang.
    const hasil = await bakarWatermark(polos, "Nama\tTab\nBaris\rBalik", "PAD-1");
    const meta = await sharp(hasil).metadata();
    expect(meta.format).toBe("webp");
  });
});
