import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

/**
 * Enam keadaan akses, diuji dengan SESI KLIEN SUNGGUHAN. Kegagalan RLS pulang
 * sebagai `[]`, bukan galat, sehingga uji ber-service-role buta terhadapnya.
 */
const svc = createAdminSupabase();
const KLIEN = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

let produkId: string;
let materiTerkunci: string;
let materiPratinjau: string;

async function bacaHalaman(email: string | null, materiId: string) {
  const sb = email ? await signInAs(email) : anonClient();
  const { data } = await sb.from("digital_product_pages").select("objek").eq("material_id", materiId);
  return data ?? [];
}

async function pasangEntitlement(opsi: { berlakuSampai: string | null; dicabut?: boolean }) {
  await svc.from("digital_entitlements").delete()
    .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", produkId);
  const { error } = await svc.from("digital_entitlements").insert({
    client_id: ANANDA_CLIENT_ID,
    product_id: produkId,
    sumber: "gratis",
    berlaku_sampai: opsi.berlakuSampai,
    dicabut_pada: opsi.dicabut ? new Date().toISOString() : null,
  });
  if (error) throw error;
}

beforeAll(async () => {
  const { data: p, error } = await svc.from("digital_products")
    .insert({ judul: "PAD-UJI Akses Materi", slug: "pad-uji-akses-materi", aktif: true })
    .select("id").single();
  if (error) throw error;
  produkId = p!.id;
  const { data: bab } = await svc.from("digital_product_sections")
    .insert({ product_id: produkId, judul: "Bab" }).select("id").single();
  const { data: m1 } = await svc.from("digital_product_materials")
    .insert({ section_id: bab!.id, product_id: produkId, judul: "Terkunci", jenis: "pdf" })
    .select("id").single();
  const { data: m2 } = await svc.from("digital_product_materials")
    .insert({ section_id: bab!.id, product_id: produkId, judul: "Pratinjau", jenis: "pdf", pratinjau: true })
    .select("id").single();
  materiTerkunci = m1!.id;
  materiPratinjau = m2!.id;
  await svc.rpc("ganti_halaman_materi_produk", { p_material_id: materiTerkunci, p_halaman: [{ halaman: 1, objek: "a/1.webp" }] });
  await svc.rpc("ganti_halaman_materi_produk", { p_material_id: materiPratinjau, p_halaman: [{ halaman: 1, objek: "b/1.webp" }] });
});

afterAll(async () => {
  await svc.from("digital_entitlements").delete().eq("product_id", produkId);
  await svc.from("digital_products").delete().eq("id", produkId);
});

describe("boleh_buka_materi lewat RLS halaman", () => {
  it("1. pemilik aktif (selamanya) membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: null });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toHaveLength(1);
  });

  it("2. pemilik yang masa berlakunya masih jalan membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toHaveLength(1);
  });

  it("3. pemilik KEDALUWARSA tidak membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: new Date(Date.now() - 60_000).toISOString() });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toEqual([]);
  });

  it("4. pemilik DICABUT tidak membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: null, dicabut: true });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toEqual([]);
  });

  it("5. non-pembeli yang login membuka materi PRATINJAU tapi tidak yang terkunci", async () => {
    await svc.from("digital_entitlements").delete().eq("product_id", produkId);
    expect(await bacaHalaman(KLIEN, materiPratinjau)).toHaveLength(1);
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toEqual([]);
  });

  it("6. anon tidak membuka apa pun, termasuk pratinjau", async () => {
    expect(await bacaHalaman(null, materiPratinjau)).toEqual([]);
  });

  it("pratinjau produk NONAKTIF tertutup bagi non-pembeli", async () => {
    await svc.from("digital_products").update({ aktif: false }).eq("id", produkId);
    expect(await bacaHalaman(KLIEN, materiPratinjau)).toEqual([]);
    await svc.from("digital_products").update({ aktif: true }).eq("id", produkId);
  });
});

describe("punya_produk & pernah_punya_produk", () => {
  it("punya_produk false saat kedaluwarsa, pernah_punya_produk tetap true", async () => {
    await pasangEntitlement({ berlakuSampai: new Date(Date.now() - 60_000).toISOString() });
    const klien = await signInAs(KLIEN);
    const { data: punya } = await klien.rpc("punya_produk", { p_product_id: produkId });
    const { data: pernah } = await klien.rpc("pernah_punya_produk", { p_product_id: produkId });
    expect(punya).toBe(false);
    expect(pernah).toBe(true);
  });

  it("pemilik kedaluwarsa tetap membaca baris produk NONAKTIF lewat embed", async () => {
    await svc.from("digital_products").update({ aktif: false }).eq("id", produkId);
    const klien = await signInAs(KLIEN);
    const { data } = await klien.from("digital_entitlements")
      .select("product_id, digital_products(judul)")
      .eq("product_id", produkId)
      .single();
    expect(data?.digital_products).not.toBeNull();
    await svc.from("digital_products").update({ aktif: true }).eq("id", produkId);
  });

  it("akses_aktif tidak bisa dipanggil pemegang sesi", async () => {
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("akses_aktif", { p_client_id: ANANDA_CLIENT_ID, p_product_id: produkId });
    expect(error).not.toBeNull();
  });
});
