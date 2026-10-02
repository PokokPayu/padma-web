import { describe, it, expect } from "vitest";
import { tujuanProdukAman } from "@/lib/auth/tujuan-produk";

describe("tujuanProdukAman — hanya path produk di situs ini", () => {
  it("menerima path produk berslug sah", () => {
    expect(tujuanProdukAman("/produk/panduan-nifas")).toBe("/produk/panduan-nifas");
    expect(tujuanProdukAman("/produk/e-book-2")).toBe("/produk/e-book-2");
  });

  it.each([
    null,
    undefined,
    "",
    "//situs-lain.com",
    "https://situs-lain.com/produk/x",
    "/produk/",
    "/produk/../admin",
    "/produk/x/y",
    "/produk/x?y=1",
    "/produk/Huruf-Besar",
    "/produk/-x",
    "/admin",
    `/produk/${"a".repeat(200)}`,
  ])("menolak %s", (nilai) => {
    expect(tujuanProdukAman(nilai)).toBeNull();
  });
});
