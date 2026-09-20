import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

async function semai(slug: string, harga: number, aktif = true): Promise<string> {
  const svc = createAdminSupabase();
  const { data } = await svc.from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif }).select("id").single();
  bersihkan.push(data!.id);
  await svc.from("digital_product_files")
    .insert({ product_id: data!.id, objek: `${data!.id}/isi.pdf`, mime: "application/pdf", byte: 1024 });
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga });
  return data!.id;
}

describe("ambil_produk_gratis", () => {
  it("menerbitkan entitlement untuk produk GRATIS", async () => {
    const id = await semai("gratis-sah", 0);
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).toBeNull();

    const { data } = await klien.from("digital_entitlements")
      .select("sumber").eq("product_id", id);
    expect((data ?? []).length).toBe(1);
    expect(data![0].sumber).toBe("gratis");
  });

  it("MENOLAK produk berbayar — ini bukan pintu belakang checkout", async () => {
    const id = await semai("berbayar-ditolak", 120_000);
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).not.toBeNull();

    const { data } = await klien.from("digital_entitlements")
      .select("id").eq("product_id", id);
    expect(data ?? []).toEqual([]);
  });

  it("MENOLAK produk yang belum ditayangkan", async () => {
    const id = await semai("gratis-belum-tayang", 0, false);
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).not.toBeNull();
  });

  it("MENOLAK produk yang harganya belum ditetapkan", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Tanpa harga", slug: "gratis-tanpa-harga", jenis: "pdf", aktif: true })
      .select("id").single();
    bersihkan.push(produk!.id);

    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: produk!.id });
    expect(error).not.toBeNull();
  });

  it("dipanggil dua kali tidak menggandakan apa pun", async () => {
    const id = await semai("gratis-dua-kali", 0);
    const klien = await signInAs("ananda@padma.test");
    await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).toBeNull();

    const { data } = await klien.from("digital_entitlements").select("id").eq("product_id", id);
    expect((data ?? []).length).toBe(1);
  });

  it("entitlement yang sudah DICABUT tidak dihidupkan lagi oleh pengambilan ulang", async () => {
    const svc = createAdminSupabase();
    const id = await semai("gratis-tercabut", 0);
    const klien = await signInAs("ananda@padma.test");
    await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    await svc.from("digital_entitlements")
      .update({ dicabut_pada: new Date().toISOString() }).eq("product_id", id);

    await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    const { data } = await klien.from("digital_entitlements")
      .select("dicabut_pada").eq("product_id", id).single();
    expect(data!.dicabut_pada).not.toBeNull();
  });

  it("pengunjung anon tidak bisa memanggilnya", async () => {
    const id = await semai("gratis-anon", 0);
    const { anonClient } = await import("./helpers/as-user");
    const { error } = await anonClient().rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).not.toBeNull();
  });
});
