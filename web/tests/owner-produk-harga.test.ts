import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

async function produkUji(slug: string): Promise<string> {
  const { data } = await createAdminSupabase().from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf" }).select("id").single();
  bersihkan.push(data!.id);
  return data!.id;
}

describe("harga produk di panel owner", () => {
  it("rute terdaftar di README", () => {
    expect(readFileSync(path.join(AKAR, "README.md"), "utf8")).toContain("| `/owner/produk` |");
  });

  it("aksi owner dibuka requireRole(['owner'])", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/owner/produk/aksi.ts"), "utf8");
    expect(sumber).toContain(`requireRole(["owner"])`);
    expect(sumber).not.toContain("createAdminSupabase");
  });

  it("owner bisa menetapkan harga, dan harganya jadi BARIS BARU", async () => {
    const id = await produkUji("uji-owner-tetapkan");
    const owner = await signInAs("owner@padma.test");

    const { error: satu } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 100_000, berlaku_sejak: "2026-01-01" });
    expect(satu).toBeNull();

    const { error: dua } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 120_000, berlaku_sejak: "2026-02-01" });
    expect(dua).toBeNull();

    const { data } = await owner.from("digital_product_prices")
      .select("harga").eq("product_id", id);
    expect((data ?? []).length).toBe(2);
  });

  it("dua harga pada tanggal berlaku yang SAMA ditolak", async () => {
    const id = await produkUji("uji-owner-kembar");
    const owner = await signInAs("owner@padma.test");
    await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 10_000, berlaku_sejak: "2026-03-01" });
    const { error } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 20_000, berlaku_sejak: "2026-03-01" }).select("id");
    expect(error?.code).toBe("23505");
  });

  it("harga 0 sah dan berarti produk gratis", async () => {
    const id = await produkUji("uji-owner-gratis");
    const owner = await signInAs("owner@padma.test");
    const { error } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 0 });
    expect(error).toBeNull();

    const { data } = await owner.from("produk_harga_staf")
      .select("harga").eq("product_id", id).single();
    expect(data!.harga).toBe(0);
  });

  it("view publik memulangkan harga TERBARU yang sudah berlaku, bukan yang pertama", async () => {
    const svc = createAdminSupabase();
    const id = await produkUji("uji-owner-terbaru");
    await svc.from("digital_products").update({ aktif: true }).eq("id", id);
    await svc.from("digital_product_prices")
      .insert({ product_id: id, harga: 100_000, berlaku_sejak: "2026-01-01" });
    await svc.from("digital_product_prices")
      .insert({ product_id: id, harga: 80_000, berlaku_sejak: "2026-02-01" });

    const owner = await signInAs("owner@padma.test");
    const { data } = await owner.from("harga_produk_publik")
      .select("harga").eq("product_id", id).single();
    expect(data!.harga).toBe(80_000);
  });
});
