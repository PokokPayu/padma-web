/**
 * `baca.ts` dengan basis data sungguhan — SEDIKIT uji, sengaja.
 *
 * Seluruh aturan agregasinya sudah diuji tanpa DB di
 * `tests/penjualan-hitung.test.ts`. Yang TIDAK bisa dibuktikan di sana hanya
 * dua hal, dan keduanya soal HAK: bahwa staf benar-benar memperoleh
 * barisnya, dan bahwa klien tidak. Yang kedua itulah yang menangkap kegagalan
 * embed-RLS-null — bentuk kegagalan yang sudah pernah dibayar repo ini, di
 * mana pembacaan yang ditahan RLS memulangkan NULL alih-alih galat sehingga
 * fiturnya mati diam-diam di sesi klien.
 *
 * Supabase lokal dipakai bersama sesi lain: jalankan berkas ini sendirian,
 * jangan `npm test` penuh.
 */
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

// `klien@padma.test` tidak ada di seed (`scripts/seed-users.ts`);
// `ananda@padma.test` adalah klien sungguhan di sana.
const KLIEN_EMAIL = "ananda@padma.test";
const bersihkan: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const f of bersihkan.splice(0)) await f();
});

async function semaiProdukLunas(
  slug: string,
  harga: number,
  judul: string,
  clientId?: string,
) {
  const sb = createAdminSupabase();

  const { data: produk, error: eProduk } = await sb
    .from("digital_products")
    .insert({ slug, judul, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (eProduk) throw eProduk;

  let idKlien = clientId;
  if (!idKlien) {
    const { data: klien, error: eKlien } = await sb
      .from("clients")
      .select("id")
      .limit(1)
      .single();
    if (eKlien) throw eKlien;
    idKlien = klien.id as string;
  }

  const kode = `PSN-261006-${randomUUID().slice(0, 6).toUpperCase()}`;
  const { data: pesanan, error: ePesanan } = await sb
    .from("orders")
    .insert({
      kode,
      client_id: idKlien,
      status: "lunas",
      jumlah_item: 1,
      ditutup_pada: "2026-10-15T05:00:00Z",
      lunas_pada: "2026-10-15T05:00:00Z",
    })
    .select("id")
    .single();
  if (ePesanan) throw ePesanan;

  const { error: eItem } = await sb.from("order_items").insert({
    pesanan_id: pesanan.id,
    jenis: "produk_digital",
    product_id: produk.id,
    judul_beku: judul,
    harga_beku: harga,
    urutan: 1,
  });
  if (eItem) throw eItem;

  bersihkan.push(async () => {
    await sb.from("orders").delete().eq("id", pesanan.id);
    await sb.from("digital_products").delete().eq("id", produk.id);
  });

  return { pesananId: pesanan.id as string, produkId: produk.id as string, kode };
}

describe("bacaPenjualan", () => {
  it("admin memperoleh nota BESERTA nominal dan identitas produknya", async () => {
    const { kode, produkId } = await semaiProdukLunas(
      `p4-admin-${randomUUID().slice(0, 8)}`,
      150_000,
      "Kelas Menyusui",
    );

    const { bacaPenjualan } = await import("@/lib/penjualan/baca");
    const sb = await signInAs("admin@padma.test");

    const { baris } = await bacaPenjualan({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
      klien: sb,
    });

    const punya = baris.find((b) => b.kode === kode);
    expect(punya).toBeDefined();
    expect(punya!.item).not.toBeNull();
    expect(punya!.item![0].hargaBeku).toBe(150_000);
    expect(punya!.item![0].productId).toBe(produkId);
    // Embed klien terbaca: "" berarti RLS menahannya, dan di layar itu
    // dirender sebagai kegagalan baca.
    expect(punya!.padmaId).not.toBe("");
  });

  it("owner memperoleh baris yang sama", async () => {
    const { kode } = await semaiProdukLunas(
      `p4-owner-${randomUUID().slice(0, 8)}`,
      99_000,
      "Panduan MPASI",
    );

    const { bacaPenjualan } = await import("@/lib/penjualan/baca");
    const sb = await signInAs("owner@padma.test");

    const { baris } = await bacaPenjualan({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
      klien: sb,
    });

    expect(baris.some((b) => b.kode === kode)).toBe(true);
  });

  it("KLIEN tidak memperoleh nominal siapa pun — kosong, bukan galat", async () => {
    // Bentuk kegagalan yang dijaga: `pesanan_item_staf` bergerbang
    // `user_role()` DI DALAM badan view-nya, jadi sesi klien memperoleh NOL
    // BARIS, bukan 42501. Uji yang hanya memastikan "tidak melempar" akan
    // hijau sekalipun seluruh harga bocor.
    const sb = await signInAs(KLIEN_EMAIL);
    const { data: auth } = await sb.auth.getUser();
    // Pesanan dipasang pada klien YANG LOGIN, supaya `baris` tidak kosong
    // dan uji ini tidak hijau karena menemukan apa-apa.
    const { data: milikku, error: eMilik } = await createAdminSupabase()
      .from("clients")
      .select("id")
      .eq("user_id", auth.user!.id)
      .single();
    if (eMilik) throw eMilik;
    await semaiProdukLunas(
      `p4-klien-${randomUUID().slice(0, 8)}`,
      150_000,
      "Kelas Menyusui",
      milikku.id as string,
    );

    const { bacaPenjualan } = await import("@/lib/penjualan/baca");

    const { baris } = await bacaPenjualan({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
      klien: sb,
    });

    // Klien boleh melihat pesanannya SENDIRI lewat policy `orders`, tetapi
    // tidak satu pun nominal: view item-nya memulangkan nol baris.
    expect(baris.length).toBeGreaterThan(0);
    for (const b of baris) expect(b.item).toBeNull();
  });
});
