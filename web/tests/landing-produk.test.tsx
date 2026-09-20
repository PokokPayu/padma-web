import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProdukDigital } from "@/app/_landing/produk-digital";
import type { ProdukPublik } from "@/lib/produk/katalog";

function produk(ubah: Partial<ProdukPublik> = {}): ProdukPublik {
  return {
    id: "p1",
    judul: "Panduan Menyusui",
    slug: "panduan-menyusui",
    deskripsi: "Dari pelekatan sampai pumping.",
    jenis: "pdf",
    bolehUnduh: true,
    sampulObjek: null,
    harga: 75_000,
    hargaCoret: 99_000,
    ...ubah,
  };
}

describe("seksi produk digital di landing", () => {
  it("TIDAK dirender sama sekali saat belum ada produk tayang", () => {
    // Seksi kosong membuat PADMA terlihat seperti toko yang tutup, dan itu
    // pesan yang salah kepada pengunjung — persis alasan `lini-layanan.tsx`
    // menyaring fase tanpa layanan.
    expect(renderToStaticMarkup(<ProdukDigital produk={[]} />)).toBe("");
  });

  it("menampilkan harga jual dan harga coretnya", () => {
    const html = renderToStaticMarkup(<ProdukDigital produk={[produk()]} />);
    expect(html).toContain("Rp 75.000");
    expect(html).toContain("Rp 99.000");
    expect(html).toContain("<s");
  });

  it("produk gratis memakai kata Gratis, bukan Rp 0", () => {
    const html = renderToStaticMarkup(
      <ProdukDigital produk={[produk({ harga: 0, hargaCoret: null })]} />,
    );
    expect(html).toContain("Gratis");
    expect(html).not.toContain("Rp 0");
  });

  it("produk yang harganya belum ditetapkan tidak memajang Rp –", () => {
    // `formatRupiah(null as unknown as number)` memulangkan "Rp –", dan itu
    // kalimat yang tidak berarti apa pun bagi pengunjung. Cabang harga null
    // karena itu tidak boleh melewatinya sama sekali.
    const html = renderToStaticMarkup(
      <ProdukDigital produk={[produk({ harga: null, hargaCoret: null })]} />,
    );
    expect(html).not.toContain("Rp –");
  });

  it("menaut ke etalase penuh dan ke halaman produknya", () => {
    const html = renderToStaticMarkup(<ProdukDigital produk={[produk()]} />);
    expect(html).toContain('href="/produk"');
    expect(html).toContain('href="/produk/panduan-menyusui"');
  });

  it("komponennya SINKRON — datanya dioper masuk, bukan diambil sendiri", () => {
    // Komponen server `async` di dalam pohon halaman tidak bisa dirender
    // `renderToStaticMarkup`, dan seluruh suite ini merender halaman persis
    // begitu. Pengambilan data karena itu tetap milik halaman — pola yang
    // dipegang setiap komponen anak di repo ini.
    const sumber = readFileSync(
      path.resolve(__dirname, "../src/app/_landing/produk-digital.tsx"),
      "utf8",
    );
    expect(sumber).not.toMatch(/export\s+async\s+function\s+ProdukDigital/);
    expect(sumber).not.toContain("bacaProdukPublik");
  });
});
