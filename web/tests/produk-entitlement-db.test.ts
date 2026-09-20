import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signInAs } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Gerbang isi produk diuji dengan SESI KLIEN SUNGGUHAN, bukan service role.
 *
 * Alasannya sudah mahal sekali di repo ini: embed yang ditolak RLS memulangkan
 * `null`, BUKAN galat. Uji ber-service-role menembus seluruh RLS dan karena
 * itu buta sepenuhnya terhadap gerbang yang mati — fiturnya hijau di CI dan
 * kosong di produksi.
 */
describe("digital_entitlements sebagai gerbang isi", () => {
  let produkId: string;
  let clientId: string;

  beforeAll(async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Produk gerbang", slug: "produk-gerbang-uji", jenis: "pdf", aktif: true })
      .select("id").single();
    produkId = produk!.id;
    await svc.from("digital_product_pages")
      .insert({ product_id: produkId, halaman: 1, objek: `${produkId}/1.webp` });

    const klien = await signInAs("ananda@padma.test");
    const { data: user } = await klien.auth.getUser();
    const { data: baris } = await svc.from("clients")
      .select("id").eq("user_id", user.user!.id).single();
    clientId = baris!.id;
  });

  afterAll(async () => {
    await createAdminSupabase().from("digital_products").delete().eq("id", produkId);
  });

  it("tanpa entitlement, klien tidak melihat satu halaman pun", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien.from("digital_product_pages")
      .select("objek").eq("product_id", produkId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("dengan entitlement, halaman terbaca", async () => {
    const svc = createAdminSupabase();
    await svc.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "gratis" });

    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("digital_product_pages")
      .select("objek").eq("product_id", produkId);
    expect((data ?? []).length).toBe(1);
  });

  it("entitlement yang DICABUT menutup kembali gerbangnya", async () => {
    const svc = createAdminSupabase();
    await svc.from("digital_entitlements")
      .update({ dicabut_pada: new Date().toISOString() })
      .eq("client_id", clientId).eq("product_id", produkId);

    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("digital_product_pages")
      .select("objek").eq("product_id", produkId);
    expect(data).toEqual([]);

    await svc.from("digital_entitlements").delete()
      .eq("client_id", clientId).eq("product_id", produkId);
  });

  it("satu klien tidak bisa punya dua entitlement untuk produk yang sama", async () => {
    const svc = createAdminSupabase();
    await svc.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "gratis" });
    const { error } = await svc.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "beli" }).select("id");
    expect(error?.code).toBe("23505");
    await svc.from("digital_entitlements").delete()
      .eq("client_id", clientId).eq("product_id", produkId);
  });

  it("klien tidak bisa menerbitkan entitlement untuk dirinya sendiri", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "beli" }).select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("klien tidak melihat entitlement milik klien lain", async () => {
    const svc = createAdminSupabase();
    const { data: lain } = await svc.from("clients")
      .select("id").neq("id", clientId).limit(1).single();
    await svc.from("digital_entitlements")
      .insert({ client_id: lain!.id, product_id: produkId, sumber: "gratis" });

    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("digital_entitlements")
      .select("id").eq("product_id", produkId);
    expect(data).toEqual([]);

    await svc.from("digital_entitlements").delete()
      .eq("client_id", lain!.id).eq("product_id", produkId);
  });
});
