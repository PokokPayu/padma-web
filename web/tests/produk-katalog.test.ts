import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { bacaProdukPublik, bacaProdukPerSlug } from "@/lib/produk/katalog";

const AKAR = path.resolve(__dirname, "..");
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

async function semaiProduk(slug: string, aktif: boolean, harga?: number, coret?: number) {
  const svc = createAdminSupabase();
  const { data } = await svc.from("digital_products")
    .insert({ judul: `Produk ${slug}`, slug, jenis: "pdf", aktif, urutan: 1 })
    .select("id").single();
  bersihkan.push(data!.id);
  if (harga !== undefined) {
    await svc.from("digital_product_prices")
      .insert({ product_id: data!.id, harga, harga_coret: coret ?? null });
  }
  return data!.id;
}

describe("katalog produk publik", () => {
  it("kedua rute etalase terdaftar di README", () => {
    const readme = readFileSync(path.join(AKAR, "README.md"), "utf8");
    expect(readme).toContain("| `/produk` |");
    expect(readme).toContain("| `/produk/[slug]` |");
  });

  it("dibaca dengan ANON KEY — bukan sesi pengguna, bukan service role", () => {
    const sumber = readFileSync(path.join(AKAR, "src/lib/produk/katalog.ts"), "utf8");
    expect(sumber).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(sumber).not.toContain("createServerSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });

  it("produk nonaktif tidak muncul di etalase", async () => {
    await semaiProduk("etalase-nonaktif", false, 50_000);
    const daftar = await bacaProdukPublik();
    expect(daftar.map((p) => p.slug)).not.toContain("etalase-nonaktif");
  });

  it("produk aktif muncul lengkap dengan harga dan coretnya", async () => {
    await semaiProduk("etalase-aktif", true, 75_000, 99_000);
    const daftar = await bacaProdukPublik();
    const produk = daftar.find((p) => p.slug === "etalase-aktif");
    expect(produk).toBeDefined();
    expect(produk!.harga).toBe(75_000);
    expect(produk!.hargaCoret).toBe(99_000);
  });

  it("produk aktif yang harganya BELUM ditetapkan tetap muncul, dengan harga null", async () => {
    await semaiProduk("etalase-tanpa-harga", true);
    const daftar = await bacaProdukPublik();
    const produk = daftar.find((p) => p.slug === "etalase-tanpa-harga");
    expect(produk).toBeDefined();
    expect(produk!.harga).toBeNull();
  });

  it("harga 0 dibedakan dari harga belum ditetapkan", async () => {
    await semaiProduk("etalase-gratis", true, 0);
    const daftar = await bacaProdukPublik();
    const produk = daftar.find((p) => p.slug === "etalase-gratis");
    expect(produk!.harga).toBe(0);
  });

  it("bacaProdukPerSlug memulangkan null untuk produk nonaktif", async () => {
    await semaiProduk("slug-nonaktif", false, 10_000);
    expect(await bacaProdukPerSlug("slug-nonaktif")).toBeNull();
  });

  it("bacaProdukPerSlug memulangkan null untuk slug yang tidak ada", async () => {
    expect(await bacaProdukPerSlug("slug-yang-tidak-pernah-ada")).toBeNull();
  });
});
