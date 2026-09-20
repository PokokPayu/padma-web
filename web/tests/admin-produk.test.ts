import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { slugDariJudul } from "@/lib/produk/status";

const AKAR = path.resolve(__dirname, "..");
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

describe("master produk admin", () => {
  it("rute baru terdaftar di tabel rute README", () => {
    const readme = readFileSync(path.join(AKAR, "README.md"), "utf8");
    expect(readme).toContain("| `/admin/produk` |");
    expect(readme).toContain("| `/admin/produk/baru` |");
  });

  it("aksi produk tidak memakai service role", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/admin/produk/aksi.ts"), "utf8");
    expect(sumber).not.toContain("createAdminSupabase");
  });

  it("setiap server action memanggil requireRole", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/admin/produk/aksi.ts"), "utf8");
    const jumlahAction = (sumber.match(/^export async function /gm) ?? []).length;
    const jumlahGerbang = (sumber.match(/requireRole\(/g) ?? []).length;
    expect(jumlahGerbang).toBeGreaterThanOrEqual(jumlahAction);
  });

  it("admin bisa membuat produk, dan produknya lahir nonaktif", async () => {
    const admin = await signInAs("admin@padma.test");
    const slug = slugDariJudul("Uji Buat Produk");
    const { data, error } = await admin.from("digital_products")
      .insert({ judul: "Uji Buat Produk", slug, jenis: "pdf" })
      .select("id, aktif, boleh_unduh").single();
    expect(error).toBeNull();
    expect(data!.aktif).toBe(false);
    expect(data!.boleh_unduh).toBe(false);
    bersihkan.push(data!.id);
  });

  it("admin TIDAK bisa menetapkan harga", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji harga admin", slug: "uji-harga-admin", jenis: "pdf" })
      .select("id").single();
    bersihkan.push(produk!.id);

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 10_000 }).select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("admin MELIHAT harga lewat view staf", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji lihat harga", slug: "uji-lihat-harga", jenis: "pdf" })
      .select("id").single();
    bersihkan.push(produk!.id);
    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 75_000, harga_coret: 99_000 });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("produk_harga_staf")
      .select("harga, harga_coret").eq("product_id", produk!.id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ harga: 75_000, harga_coret: 99_000 });
  });

  // Brief asli memakai `klien@padma.test`, alamat yang tidak ada di seed
  // (`scripts/seed-users.ts`). `ananda@padma.test` adalah klien sungguhan
  // (peran klien) di seed itu — dipakai di sini sebagai gantinya.
  it("klien tidak melihat apa pun di view harga staf", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("produk_harga_staf").select("harga").limit(1);
    expect(data ?? []).toEqual([]);
  });
});
