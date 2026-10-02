import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { rakitOrderId } from "@/lib/pesanan/order-id";

/**
 * Titik buta 2 (spec P2, "Pengujian"): gerbang P1 dijalankan PER PRODUK di
 * dalam larik. Keranjang tiga produk dengan satu yang sudah dimiliki adalah
 * jalur tagih-dua-kali, dan ia jarang dicoba dengan tangan.
 */

const KLIEN_EMAIL = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

type BarisPesanan = {
  pesanan_id: string;
  kode: string;
  percobaan: number;
  nominal_tagih: number;
  judul: string;
  jumlah_item: number;
};

const svc = createAdminSupabase();
const produkUji: string[] = [];

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: true })
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

afterEach(bersihkan);
beforeAll(bersihkan);

async function keranjang(ids: string[]) {
  const klien = await signInAs(KLIEN_EMAIL);
  return klien.rpc("buat_pesanan_keranjang", { p_product_ids: ids });
}

async function cacahPesanan(): Promise<number> {
  const { count } = await svc
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ANANDA_CLIENT_ID);
  return count ?? 0;
}

describe("buat_pesanan_keranjang — gerbang per produk", () => {
  it("satu produk yang SUDAH dimiliki menolak seluruh larik, menyebut judulnya, nol pesanan lahir", async () => {
    const t = Date.now();
    const a = await semaiProduk(`kp-a-${t}`, 100_000);
    const b = await semaiProduk(`kp-b-${t}`, 50_000);
    const c = await semaiProduk(`kp-c-${t}`, 75_000);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: b, sumber: "beli",
    });

    const { error } = await keranjang([a, b, c]);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(`Anda sudah memiliki "Uji kp-b-${t}" — hapus dari keranjang.`);
    expect(await cacahPesanan()).toBe(0);
  });

  it("satu produk BERUANG (lunas tanpa akses hidup) menolak larik dengan kalimat tinjauan", async () => {
    // Bentuk persis uji `akses_tertahan` P1: entitlement lama DICABUT, lalu
    // pesanan baru lunas → status lunas, nol entitlement hidup. Gerbang
    // entitlement diam; gerbang beruang yang wajib menyala.
    const t = Date.now();
    const a = await semaiProduk(`kp-br-a-${t}`, 120_000);
    const c = await semaiProduk(`kp-br-c-${t}`, 75_000);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: a,
      sumber: "beli",
      dicabut_pada: new Date("2026-09-01T00:00:00Z").toISOString(),
    });
    const { data: satu, error: eSatu } = await keranjang([a]);
    expect(eSatu).toBeNull();
    const p = (satu as BarisPesanan[])[0];
    const settlement = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: rakitOrderId(p.kode, p.percobaan),
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-kp-beruang",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120_000,
      p_sidik: randomUUID(),
    });
    expect(settlement.data).toBe("diterapkan");

    const { error } = await keranjang([c, a]);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(
      `Pembayaran Anda untuk "Uji kp-br-a-${t}" sedang ditinjau staf — hapus dari keranjang.`,
    );
  });

  it("pesanan terbuka dicocokkan sebagai HIMPUNAN; kembar dibuang; isi lain ditolak", async () => {
    const t = Date.now();
    const a = await semaiProduk(`kp-h-a-${t}`, 100_000);
    const b = await semaiProduk(`kp-h-b-${t}`, 50_000);
    const c = await semaiProduk(`kp-h-c-${t}`, 75_000);

    const { data: d1, error: e1 } = await keranjang([a, b, a]);
    expect(e1).toBeNull();
    const pertama = (d1 as BarisPesanan[])[0];
    expect(pertama.jumlah_item).toBe(2);
    expect(pertama.nominal_tagih).toBe(150_000);
    expect(pertama.judul).toBe(`Uji kp-h-a-${t}`);

    const { data: d2, error: e2 } = await keranjang([b, a]);
    expect(e2).toBeNull();
    expect((d2 as BarisPesanan[])[0].pesanan_id).toBe(pertama.pesanan_id);

    const { error: e3 } = await keranjang([a, c]);
    expect(e3?.code).toBe("P0001");
    expect(e3?.message).toBe(
      `Selesaikan dulu pesanan ${pertama.kode} yang masih terbuka, atau batalkan lebih dulu.`,
    );
    expect(await cacahPesanan()).toBe(1);
  });
});
