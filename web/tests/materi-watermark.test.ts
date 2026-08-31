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
});
