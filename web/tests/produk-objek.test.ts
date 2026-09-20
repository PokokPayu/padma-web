import { describe, it, expect } from "vitest";
import {
  namaObjekVideoProduk, namaObjekHalamanProduk, namaObjekPdfProduk,
} from "@/lib/produk/objek";

const ID = "11111111-2222-3333-4444-555555555555";

describe("penamaan objek produk", () => {
  it("video bernama dari id produk dan ekstensi turunan MIME", () => {
    expect(namaObjekVideoProduk(ID, "video/mp4")).toBe(`produk/${ID}/isi.mp4`);
    expect(namaObjekVideoProduk(ID, "video/webm")).toBe(`produk/${ID}/isi.webm`);
  });

  it("prefiks `produk/` memisahkan bucket R2 dari objek materi", () => {
    expect(namaObjekVideoProduk(ID, "video/mp4").startsWith("produk/")).toBe(true);
  });

  it("halaman PDF bernomor, di dalam folder id produk", () => {
    expect(namaObjekHalamanProduk(ID, 7)).toBe(`${ID}/7.webp`);
  });

  it("PDF utuh bernama tetap", () => {
    expect(namaObjekPdfProduk(ID)).toBe(`${ID}/isi.pdf`);
  });
});
