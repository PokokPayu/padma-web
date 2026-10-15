import { describe, it, expect } from "vitest";
import { tujuanProdukAman } from "@/lib/auth/tujuan-produk";

const U = "0f8b2a4c-1d3e-4f5a-9b6c-7d8e9f0a1b2c";

describe("tujuanProdukAman — penampil materi (spec 2026-10-16)", () => {
  it("menerima penampil materi berslug + uuid", () => {
    expect(tujuanProdukAman(`/passport/produk/kelas-menyusui/${U}`)).toBe(`/passport/produk/kelas-menyusui/${U}`);
  });

  it("tetap menerima halaman produk", () => {
    expect(tujuanProdukAman("/produk/kelas-menyusui")).toBe("/produk/kelas-menyusui");
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil",
    "/passport/produk/x/bukan-uuid",
    `/passport/produk/x/../../admin`,
    `/passport/produk/x/${U}/lagi`,
    `/passport/produk/${U}`,
    `/passport/produk/X/${U}`,
    `/passport/produk/x/${U.toUpperCase()}`,
    `/passport/produk/x/${U}?a=1`,
    `/passport/admin/x/${U}`,
  ])("menolak %s", (nilai) => {
    expect(tujuanProdukAman(nilai)).toBeNull();
  });
});
