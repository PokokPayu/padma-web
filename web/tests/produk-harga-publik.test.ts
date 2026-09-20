import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { anonClient, signInAs } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Batas kerahasiaan harga produk adalah DAFTAR KOLOM kedua view ini — sama
 * persis dengan yang dijaga `tests/harga-publik.test.ts` untuk `harga_publik`.
 * Daftarnya dikunci sebagai assertion karena menambah kolom ke proyeksi view
 * adalah satu baris ketikan yang tidak memerahkan apa pun.
 */
describe("harga produk digital", () => {
  it("harga_produk_publik berkolom PERSIS empat", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'harga_produk_publik'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "product_id", "harga", "harga_coret", "berlaku_sejak",
    ]);
  });

  it("anon boleh membaca view, tapi TIDAK tabel dasarnya", async () => {
    const { error: viewErr } = await anonClient()
      .from("harga_produk_publik").select("product_id").limit(1);
    expect(viewErr).toBeNull();

    const { error: tabelErr } = await anonClient()
      .from("digital_product_prices").select("harga").limit(1);
    expect(tabelErr?.code).toBe("42501");
  });

  it("klien login juga tidak bisa menyentuh tabel harga langsung", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.from("digital_product_prices").select("harga").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("harga yang belum berlaku tidak bocor ke pengunjung", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji harga", slug: "uji-harga-masa-depan", jenis: "pdf", aktif: true })
      .select("id").single();

    // Kalender JAKARTA, bukan UTC — view memakai `(now() at time zone
    // 'Asia/Jakarta')::date`, dan pada 00:00-06:59 WIB "besok" versi UTC
    // sudah sama dengan hari ini versi Jakarta.
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
    const besok = fmt.format(new Date(Date.now() + 86_400_000));

    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 99_000, berlaku_sejak: besok });

    const { data } = await anonClient()
      .from("harga_produk_publik").select("harga").eq("product_id", produk!.id);
    expect(data).toEqual([]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("harga coret yang lebih murah dari harga jual DITOLAK basis data", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji coret", slug: "uji-coret-murah", jenis: "pdf" })
      .select("id").single();

    const { error } = await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 100_000, harga_coret: 50_000 })
      .select("id");
    expect(error?.code).toBe("23514");

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("harga tidak bisa disunting maupun dihapus lewat peran API", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji riwayat", slug: "uji-riwayat-harga", jenis: "pdf" })
      .select("id").single();
    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 50_000 });

    const owner = await signInAs("owner@padma.test");
    const { data: ubah } = await owner.from("digital_product_prices")
      .update({ harga: 1 }).eq("product_id", produk!.id).select("id");
    expect(ubah ?? []).toEqual([]);

    const { data: hapus } = await owner.from("digital_product_prices")
      .delete().eq("product_id", produk!.id).select("id");
    expect(hapus ?? []).toEqual([]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });
});
