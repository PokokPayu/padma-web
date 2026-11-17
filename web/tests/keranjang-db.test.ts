import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { rakitInvoice } from "@/lib/pesanan/order-id";
import {
  EMAIL_KLIEN_KEDUA,
  KLIEN_KEDUA_ID,
  siapkanKlienKedua,
  bongkarKlienKedua,
} from "./helpers/klien-kedua";

/**
 * Dua titik yang BUTA bagi pengujian manual (spec P2, "Pengujian"):
 *   1. RLS `cart_items` — kegagalannya pulang sebagai `[]`, dan keranjang
 *      kosong tidak terlihat rusak.
 *   3. Trigger pembersihan lewat jalur WEBHOOK — webhook tidak menyala di
 *      sandbox lokal, jadi tidak ada orang yang akan melihatnya bekerja.
 */

const KLIEN_EMAIL = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

const svc = createAdminSupabase();
const produkUji: string[] = [];

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc
    .from("digital_product_prices")
    .insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  if (eHarga) throw eHarga;
  return data!.id;
}

// Urutan hapus didikte foreign key — lihat dokblok `bersihkan()` di
// tests/pesanan-checkout-db.test.ts. `cart_items` ikut lenyap lewat cascade
// produk, tapi dihapus eksplisit supaya sisa run gagal tidak menumpuk.
async function bersihkan(): Promise<void> {
  await svc.from("cart_items").delete().in("client_id", [ANANDA_CLIENT_ID, KLIEN_KEDUA_ID]);
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

afterEach(bersihkan);
beforeAll(async () => {
  await bersihkan();
  await siapkanKlienKedua();
});
afterAll(bongkarKlienKedua);

describe("cart_items — RLS lewat sesi klien", () => {
  it("klien membaca keranjangnya sendiri dan NOL baris klien lain", async () => {
    const a = await semaiProduk(`krj-rls-a-${Date.now()}`, 100_000);
    const b = await semaiProduk(`krj-rls-b-${Date.now()}`, 50_000);
    const { error: eSemai } = await svc.from("cart_items").insert([
      { client_id: ANANDA_CLIENT_ID, product_id: a },
      { client_id: KLIEN_KEDUA_ID, product_id: b },
    ]);
    expect(eSemai).toBeNull();

    const ananda = await signInAs(KLIEN_EMAIL);
    const { data, error } = await ananda.from("cart_items").select("product_id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.product_id)).toEqual([a]);

    const kedua = await signInAs(EMAIL_KLIEN_KEDUA);
    const { data: dataKedua } = await kedua.from("cart_items").select("product_id");
    expect((dataKedua ?? []).map((r) => r.product_id)).toEqual([b]);
  });

  it("insert langsung lewat PostgREST DITOLAK — penulisan hanya lewat RPC", async () => {
    const a = await semaiProduk(`krj-rls-ins-${Date.now()}`, 100_000);
    const ananda = await signInAs(KLIEN_EMAIL);
    const { error } = await ananda
      .from("cart_items")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: a });
    expect(error?.code).toBe("42501");
  });

  it("tambah_ke_keranjang menolak produk yang sudah dimiliki, dan baca_keranjang melihat isinya", async () => {
    const a = await semaiProduk(`krj-rpc-a-${Date.now()}`, 100_000);
    const b = await semaiProduk(`krj-rpc-b-${Date.now()}`, 50_000);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: b, sumber: "beli",
    });

    const ananda = await signInAs(KLIEN_EMAIL);
    expect((await ananda.rpc("tambah_ke_keranjang", { p_product_id: a })).error).toBeNull();
    // Kedua kali: diam, bukan galat.
    expect((await ananda.rpc("tambah_ke_keranjang", { p_product_id: a })).error).toBeNull();
    const ditolak = await ananda.rpc("tambah_ke_keranjang", { p_product_id: b });
    expect(ditolak.error?.message).toBe("Anda sudah memiliki produk ini.");

    const { data, error } = await ananda.rpc("baca_keranjang");
    expect(error).toBeNull();
    expect((data as { product_id: string; keadaan: string }[]).map((r) => [r.product_id, r.keadaan]))
      .toEqual([[a, "siap"]]);
  });
});

describe("trigger pembersihan — lewat webhook NYATA", () => {
  it("settlement yang menerbitkan akses menghapus produk itu dari keranjang", async () => {
    const a = await semaiProduk(`krj-trg-${Date.now()}`, 120_000);
    const ananda = await signInAs(KLIEN_EMAIL);
    expect((await ananda.rpc("tambah_ke_keranjang", { p_product_id: a })).error).toBeNull();

    const { data: pesanan, error: ePesanan } = await ananda.rpc("buat_pesanan", { p_product_id: a });
    expect(ePesanan).toBeNull();
    const baris = (pesanan as { kode: string; percobaan: number }[])[0];

    const settlement = await svc.rpc("terapkan_notifikasi_gateway", {
      p_invoice: rakitInvoice(baris.kode, baris.percobaan),
      p_status: "SUCCESS",
      p_transaksi_id: "trx-keranjang-bersih",
      p_kanal: "bank_transfer",
      p_nominal: 120_000,
      p_sidik: randomUUID(),
    });
    expect(settlement.error).toBeNull();
    expect(settlement.data).toBe("diterapkan");

    const { data: sisa } = await svc
      .from("cart_items")
      .select("product_id")
      .eq("client_id", ANANDA_CLIENT_ID);
    expect(sisa).toEqual([]);
  });
});
