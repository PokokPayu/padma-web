import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

/**
 * Masa berlaku di alur bayar (spec 2026-10-16, "Masa berlaku dalam alur
 * bayar"). Cabang penerbitan & webhook kembar TIDAK terlihat saat menguji
 * manual — butuh menunggu kedaluwarsa atau memalsukan notifikasi gateway.
 */
const svc = createAdminSupabase();
const KLIEN = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const produkUji: string[] = [];
let nomor = 0;

async function semaiProduk(harga: number, bulan: number | null): Promise<string> {
  nomor += 1;
  const { data, error } = await svc.from("digital_products")
    .insert({ judul: `PAD-UJI Masa ${nomor}`, slug: `pad-uji-masa-${nomor}-${Date.now()}`, aktif: true, masa_berlaku_bulan: bulan })
    .select("id").single();
  if (error) throw error;
  produkUji.push(data!.id);
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  return data!.id;
}

async function semaiPesananLunas(produkId: string, bulanBeku: number | null) {
  nomor += 1;
  const { data: o, error } = await svc.from("orders").insert({
    kode: `PSN-261016-${nomor.toString().padStart(6, "0")}`,
    client_id: ANANDA_CLIENT_ID,
    jumlah_item: 1,
    status: "lunas",
    lunas_pada: new Date().toISOString(),
    ditutup_pada: new Date().toISOString(),
  }).select("id").single();
  if (error) throw error;
  const { data: i, error: ei } = await svc.from("order_items").insert({
    pesanan_id: o!.id, jenis: "produk_digital", product_id: produkId,
    judul_beku: "Uji", harga_beku: 10_000, urutan: 1, masa_berlaku_bulan_beku: bulanBeku,
  }).select("id").single();
  if (ei) throw ei;
  return { pesananId: o!.id, itemId: i!.id };
}

async function entitlement(produkId: string) {
  const { data } = await svc.from("digital_entitlements")
    .select("berlaku_sampai, dicabut_pada, pesanan_id, sumber")
    .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", produkId).maybeSingle();
  return data;
}

/** Majukan waktu: akses habis semenit lalu. */
async function kedaluwarsakan(produkId: string): Promise<void> {
  const { error } = await svc.from("digital_entitlements")
    .update({ berlaku_sampai: new Date(Date.now() - 60_000).toISOString() })
    .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", produkId);
  if (error) throw error;
}

/**
 * Pola pembersihan yang SAMA dengan tests/pesanan-checkout-db.test.ts:
 * `pesanan_terbuka_satu_per_klien` adalah indeks unik GLOBAL, jadi sisa
 * pesanan Ananda dari run lain memerahkan setiap berkas uji pesanan. Jejak &
 * notifikasi dihapus lebih dulu karena FK-nya.
 */
async function bersihkan(): Promise<void> {
  await svc.from("cart_items").delete().eq("client_id", ANANDA_CLIENT_ID);
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);
  const { data: pesanan } = await svc.from("orders").select("id").eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) {
    await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
  }
}

beforeAll(bersihkan);
afterEach(bersihkan);

describe("terbitkan_akses_item", () => {
  it("(1) belum ada → berlaku_sampai = sekarang + durasi BEKU", async () => {
    const p = await semaiProduk(10_000, 3);
    const { itemId } = await semaiPesananLunas(p, 9);
    const { data } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(data).toBe("akses_terbit");
    const e = await entitlement(p);
    const selisihHari = (new Date(e!.berlaku_sampai!).getTime() - Date.now()) / 86_400_000;
    // 9 bulan beku, BUKAN 3 bulan produk.
    expect(selisihHari).toBeGreaterThan(260);
    expect(selisihHari).toBeLessThan(280);
  });

  it("(1) durasi beku NULL → selamanya", async () => {
    const p = await semaiProduk(10_000, null);
    const { itemId } = await semaiPesananLunas(p, null);
    await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect((await entitlement(p))!.berlaku_sampai).toBeNull();
  });

  it("(2b) kedaluwarsa → diperbarui; notifikasi kembar jatuh ke (2a)", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "gratis",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
    });
    const { pesananId, itemId } = await semaiPesananLunas(p, 1);

    const { data: pertama } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(pertama).toBe("akses_terbit");
    const e1 = await entitlement(p);
    expect(new Date(e1!.berlaku_sampai!).getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
    expect(e1!.pesanan_id).toBe(pesananId);
    // Diperbarui oleh PEMBELIAN: sumbernya kini 'beli', walau semula gratis.
    expect(e1!.sumber).toBe("beli");

    const { data: kedua } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(kedua).toBe("akses_sudah_ada");
    const e2 = await entitlement(p);
    expect(e2!.berlaku_sampai).toBe(e1!.berlaku_sampai);
  });

  it("satu pesanan, satu durasi: item yang terbit lewat (1) tidak memperbarui lagi sesudah habis", async () => {
    const p = await semaiProduk(10_000, 1);
    const { itemId } = await semaiPesananLunas(p, 1);
    const { data: pertama } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(pertama).toBe("akses_terbit");
    await kedaluwarsakan(p);
    const sebelum = (await entitlement(p))!.berlaku_sampai;

    // Tombol admin "Terbitkan akses" tampil untuk setiap pesanan lunas.
    const { data: ulang, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(error).toBeNull();
    expect(ulang).toBe("akses_sudah_ada");
    expect((await entitlement(p))!.berlaku_sampai).toBe(sebelum);
  });

  it("satu pesanan, satu durasi: item yang memperbarui lewat (2b) tidak memperbarui lagi sesudah habis", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
    });
    const { itemId } = await semaiPesananLunas(p, 1);
    const { data: pertama } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(pertama).toBe("akses_terbit");
    await kedaluwarsakan(p);
    const sebelum = (await entitlement(p))!.berlaku_sampai;

    const { data: ulang, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(error).toBeNull();
    expect(ulang).toBe("akses_sudah_ada");
    expect((await entitlement(p))!.berlaku_sampai).toBe(sebelum);
  });

  it("(3) dicabut tetap mati walau dibeli ulang", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
      dicabut_pada: new Date().toISOString(),
    });
    const { itemId } = await semaiPesananLunas(p, 1);
    const { data } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(data).toBe("akses_tertahan");
    expect((await entitlement(p))!.dicabut_pada).not.toBeNull();
  });
});

describe("gerbang beli", () => {
  it("produk dengan akses AKTIF ditolak keranjang", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli",
      berlaku_sampai: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("tambah_ke_keranjang", { p_product_id: p });
    expect(error?.message).toMatch(/sudah memiliki/);
  });

  it("produk KEDALUWARSA dengan pesanan lunas lama bisa dibeli lagi", async () => {
    const p = await semaiProduk(10_000, 1);
    const { itemId } = await semaiPesananLunas(p, 1);
    await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    // Majukan waktu: akses habis.
    await svc.from("digital_entitlements")
      .update({ berlaku_sampai: new Date(Date.now() - 60_000).toISOString() })
      .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", p);

    const klien = await signInAs(KLIEN);
    const { data: menunggu } = await klien.rpc("punya_pesanan_menunggu", { p_product_id: p });
    expect(menunggu).toBe(false);
    const { error } = await klien.rpc("tambah_ke_keranjang", { p_product_id: p });
    expect(error).toBeNull();
    const { data: isi } = await klien.rpc("baca_keranjang");
    expect((isi ?? []).find((r: { product_id: string }) => r.product_id === p)?.keadaan).toBe("siap");
  });

  it("siklus kedua: beli → habis → beli ulang (pesanan BARU) → habis → bisa dibeli lagi", async () => {
    const p = await semaiProduk(10_000, 1);
    const a = await semaiPesananLunas(p, 1);
    expect((await svc.rpc("terbitkan_akses_item", { p_item_id: a.itemId })).data).toBe("akses_terbit");
    await kedaluwarsakan(p);

    const b = await semaiPesananLunas(p, 1);
    expect((await svc.rpc("terbitkan_akses_item", { p_item_id: b.itemId })).data).toBe("akses_terbit");
    await kedaluwarsakan(p);

    const klien = await signInAs(KLIEN);
    const { data: menunggu } = await klien.rpc("punya_pesanan_menunggu", { p_product_id: p });
    expect(menunggu).toBe(false);
    const { error } = await klien.rpc("tambah_ke_keranjang", { p_product_id: p });
    expect(error).toBeNull();
  });

  it("pesanan lunas yang aksesnya TERTAHAN tetap menggantung", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli", dicabut_pada: new Date().toISOString(),
    });
    const { itemId } = await semaiPesananLunas(p, 1);
    await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    // diberikan_pada SESUDAH pesanan dibuat: tanpa ini uji tetap hijau walau
    // syarat `dicabut_pada is null` dihapus, karena baris yang dicabut sudah
    // gugur oleh syarat waktu.
    const { error: eUbah } = await svc.from("digital_entitlements")
      .update({ diberikan_pada: new Date(Date.now() + 60_000).toISOString() })
      .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", p);
    expect(eUbah).toBeNull();
    const klien = await signInAs(KLIEN);
    const { data } = await klien.rpc("punya_pesanan_menunggu", { p_product_id: p });
    expect(data).toBe(true);
  });

  it("buat_pesanan membekukan masa berlaku produk ke order_items", async () => {
    const p = await semaiProduk(10_000, 6);
    const klien = await signInAs(KLIEN);
    const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: p });
    expect(error).toBeNull();
    const pesananId = (data as Array<{ pesanan_id: string }>)[0].pesanan_id;
    const { data: item } = await svc.from("order_items")
      .select("masa_berlaku_bulan_beku").eq("pesanan_id", pesananId).single();
    expect(item!.masa_berlaku_bulan_beku).toBe(6);
  });
});

describe("ambil_produk_gratis", () => {
  it("kedaluwarsa → diperbarui dengan durasi produk; dicabut → tidak", async () => {
    const p = await semaiProduk(0, 2);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "gratis",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
    });
    const klien = await signInAs(KLIEN);
    const { error: e1 } = await klien.rpc("ambil_produk_gratis", { p_product_id: p });
    expect(e1).toBeNull();
    const e = await entitlement(p);
    expect(new Date(e!.berlaku_sampai!).getTime()).toBeGreaterThan(Date.now() + 50 * 86_400_000);

    await svc.from("digital_entitlements")
      .update({ berlaku_sampai: new Date(Date.now() - 60_000).toISOString(), dicabut_pada: new Date().toISOString() })
      .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", p);
    const { error: e2 } = await klien.rpc("ambil_produk_gratis", { p_product_id: p });
    expect(e2).toBeNull();
    expect(new Date((await entitlement(p))!.berlaku_sampai!).getTime()).toBeLessThan(Date.now());
  });

  it("akses yang masih berjalan tidak diperpanjang", async () => {
    const p = await semaiProduk(0, 2);
    const besok = new Date(Date.now() + 86_400_000).toISOString();
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "gratis", berlaku_sampai: besok,
    });
    const sebelum = (await entitlement(p))!.berlaku_sampai;
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: p });
    expect(error).toBeNull();
    expect((await entitlement(p))!.berlaku_sampai).toBe(sebelum);
  });
});
