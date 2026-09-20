import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { anonClient, signInAs } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Skema produk digital, diperiksa STRUKTURAL.
 *
 * Yang dijaga bukan sekadar "tabelnya ada", melainkan tiga keputusan yang
 * mudah hilang tanpa satu pun assertion berubah merah: produk baru lahir
 * TIDAK aktif, unduhan TERTUTUP secara bawaan, dan pengunjung anon hanya
 * boleh melihat produk yang aktif.
 */
describe("skema digital_products", () => {
  it("produk baru lahir nonaktif dan tidak boleh diunduh", async () => {
    const kolom = await querySql<{ column_name: string; column_default: string | null }>(
      `select column_name, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'digital_products'`,
    );
    const bawaan = new Map(kolom.map((k) => [k.column_name, k.column_default]));
    expect(bawaan.get("aktif")).toBe("false");
    expect(bawaan.get("boleh_unduh")).toBe("false");
  });

  it("tidak ada satu pun kolom nominal di tabel produk", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'digital_products'`,
    );
    const nominal = kolom
      .map((k) => k.column_name)
      .filter((n) => /(^|_)(harga|price|tarif|biaya)(_|$)/.test(n));
    expect(nominal).toEqual([]);
  });

  it("slug unik — dua produk tidak boleh berbagi alamat publik", async () => {
    const svc = createAdminSupabase();
    const a = await svc.from("digital_products")
      .insert({ judul: "Uji A", slug: "uji-slug-kembar", jenis: "pdf" }).select("id").single();
    expect(a.error).toBeNull();
    const b = await svc.from("digital_products")
      .insert({ judul: "Uji B", slug: "uji-slug-kembar", jenis: "pdf" }).select("id");
    expect(b.error?.code).toBe("23505");
    await svc.from("digital_products").delete().eq("id", a.data!.id);
  });

  it("anon hanya melihat produk AKTIF", async () => {
    const svc = createAdminSupabase();
    const { data: dibuat } = await svc.from("digital_products")
      .insert({ judul: "Belum tayang", slug: "belum-tayang-uji", jenis: "pdf", aktif: false })
      .select("id").single();

    const { data, error } = await anonClient()
      .from("digital_products").select("id").eq("id", dibuat!.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await svc.from("digital_products").update({ aktif: true }).eq("id", dibuat!.id);
    const { data: sesudah } = await anonClient()
      .from("digital_products").select("id").eq("id", dibuat!.id);
    expect((sesudah ?? []).length).toBe(1);

    await svc.from("digital_products").delete().eq("id", dibuat!.id);
  });

  it("klien biasa tidak bisa menulis produk", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.from("digital_products")
      .insert({ judul: "Nakal", slug: "nakal-uji", jenis: "pdf" }).select("id");
    expect(error).not.toBeNull();
  });

  it("admin boleh menulis produk", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("digital_products")
      .insert({ judul: "Dari admin", slug: "dari-admin-uji", jenis: "video" }).select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    await createAdminSupabase().from("digital_products").delete().eq("id", data![0].id);
  });
});
