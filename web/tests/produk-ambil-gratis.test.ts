import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const bersihkan: string[] = [];

/** Klien seed yang sudah tertaut — dipakai kasus "tetap hijau sesudah revoke". */
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

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

  /**
   * PAGAR TERHADAP PENAMBALAN MIGRASI KEENAM.
   *
   * Migrasi `20260926150000_entitlement_tambal.sql` mencabut INSERT & UPDATE
   * `digital_entitlements` dari `authenticated`. Kesimpulan bahwa pencabutan
   * itu AMAN bersandar pada satu kata kunci di satu baris migrasi:
   * `ambil_produk_gratis` adalah `security definer`, sehingga ia berjalan
   * dengan hak pemiliknya dan tidak ikut kehilangan apa pun.
   *
   * Kasus ini mengubah kesimpulan itu menjadi bukti. Ia juga akan MERAH bila
   * penambalan ditulis sebagai `revoke all ... from authenticated` alih-alih
   * `revoke insert, update`: klien akan kehilangan SELECT, dan pembacaan
   * entitlement di bawah memulangkan nol baris — kelas kesalahan yang grep
   * nama tabel buta terhadapnya.
   */
  it("alur ambil gratis TETAP hijau sesudah hak tulis authenticated dicabut", async () => {
    const svc = createAdminSupabase();
    const id = await semai("gratis-sesudah-tambal", 0);
    const klien = await signInAs("ananda@padma.test");

    // Pintu LANGSUNG memang tertutup untuk setiap peran API.
    const langsung = await klien
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: id, sumber: "gratis" })
      .select("id");
    expect(langsung.error).not.toBeNull();

    // Pintu yang SAH tetap terbuka.
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).toBeNull();

    // Dan klien tetap bisa MEMBACA miliknya — tanpa ini, "Pembelian saya"
    // kosong untuk semua orang dan tidak satu pun uji lain menangkapnya.
    const { data, error: eBaca } = await klien
      .from("digital_entitlements")
      .select("sumber")
      .eq("product_id", id);
    expect(eBaca).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(data![0].sumber).toBe("gratis");

    const { data: lewatSvc } = await svc
      .from("digital_entitlements")
      .select("pesanan_id")
      .eq("product_id", id)
      .single();
    // Entitlement gratis TIDAK menunjuk pesanan mana pun — dan invarian
    // rekonsiliasi memang hanya berlaku untuk sumber='beli'.
    expect(lewatSvc!.pesanan_id).toBeNull();
  });
});
