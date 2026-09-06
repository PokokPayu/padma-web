import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * Batas kerahasiaan harga publik adalah DAFTAR KOLOM view ini.
 *
 * Karena itu daftarnya dikunci sebagai assertion, bukan sekadar dipercayakan
 * pada niat: menambahkan `honor_mitra` ke proyeksi adalah satu baris ketikan,
 * dan tanpa uji ini ia lolos tanpa satu pun assertion berubah merah.
 */
describe("view harga_publik", () => {
  it("kolomnya PERSIS empat — honor_mitra tidak ada", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'harga_publik'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "variant_id",
      "harga_klien",
      "harga_coret",
      "berlaku_sejak",
    ]);
  });

  it("anon boleh membacanya, dan mendapat baris", async () => {
    const { data, error } = await anonClient().from("harga_publik").select("variant_id").limit(1);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("anon tetap tidak bisa menyentuh variant_rates langsung", async () => {
    const { error } = await anonClient().from("variant_rates").select("harga_klien").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("tarif yang belum berlaku tidak bocor ke pengunjung", async () => {
    const svc = createAdminSupabase();
    const { data: varian } = await svc.from("service_variants").select("id").limit(1);
    const variantId = varian![0].id as string;

    const besok = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { data: sisip, error: sisipError } = await svc
      .from("variant_rates")
      .insert({
        variant_id: variantId,
        harga_klien: 12_345_678,
        honor_mitra: 0,
        berlaku_sejak: besok,
      })
      .select("id")
      .single();
    expect(sisipError).toBeNull();

    try {
      const { data } = await anonClient()
        .from("harga_publik")
        .select("harga_klien")
        .eq("variant_id", variantId);
      expect((data ?? []).map((b) => b.harga_klien)).not.toContain(12_345_678);
    } finally {
      // Baris masa depan ini dibuat lewat service role di luar transaksi uji
      // manapun (harus SETELAH insert asli agar guard_tarif_varian_maju tidak
      // ikut menolaknya sebagai "mundur"). Tanpa pembersihan ini, ia bertahan
      // di database bersama dan meracuni test lain di suite yang sama — baris
      // kedua per variant_id membuat trigger pagar tarif bereaksi berbeda pada
      // UPDATE tanpa filter (mis. tests/varian-tarif-pengerasan.test.ts).
      await svc.from("variant_rates").delete().eq("id", sisip!.id);
    }
  });
});
