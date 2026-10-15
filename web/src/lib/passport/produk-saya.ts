import { createServerSupabase } from "@/lib/supabase/server";
import type { JenisMateri } from "@/lib/produk/status";

export type ProdukDimiliki = {
  id: string;
  judul: string;
  slug: string;
  sampulObjek: string | null;
  jenisMateri: JenisMateri[];
  sumber: string;
  diberikanPada: string;
  /** NULL = selamanya. Termasuk yang SUDAH lewat — layar menampilkan "habis". */
  berlakuSampai: string | null;
};

type BarisEntitlement = {
  id: string;
  sumber: string;
  diberikan_pada: string;
  berlaku_sampai: string | null;
  digital_products: {
    id: string;
    judul: string;
    slug: string;
    sampul_objek: string | null;
    digital_product_materials: Array<{ jenis: JenisMateri }>;
  } | null;
};

/**
 * Entitlement milik pemanggil yang belum dicabut, TERMASUK yang kedaluwarsa.
 *
 * Embed `digital_products` bergantung pada policy "produk: pemilik
 * entitlement baca" yang memakai `pernah_punya_produk` — BUKAN
 * `punya_produk`. Dengan `punya_produk`, produk NONAKTIF yang aksesnya habis
 * memulangkan `null` di sini (embed RLS tidak pernah melempar) dan hilang
 * diam-diam dari daftar.
 *
 * `clientId` tidak dipakai sebagai filter: RLS "klien baca miliknya" sudah
 * menyaring. Parameternya dipertahankan supaya pemanggil tetap eksplisit.
 */
export async function produkSaya(clientId: string): Promise<ProdukDimiliki[]> {
  void clientId;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("digital_entitlements")
    .select(
      "id, sumber, diberikan_pada, berlaku_sampai, digital_products(id, judul, slug, sampul_objek, digital_product_materials(jenis))",
    )
    .is("dicabut_pada", null)
    .order("diberikan_pada", { ascending: false })
    .returns<BarisEntitlement[]>();

  return (data ?? [])
    .filter((r): r is BarisEntitlement & { digital_products: NonNullable<BarisEntitlement["digital_products"]> } =>
      r.digital_products !== null,
    )
    .map((r) => ({
      id: r.digital_products.id,
      judul: r.digital_products.judul,
      slug: r.digital_products.slug,
      sampulObjek: r.digital_products.sampul_objek,
      jenisMateri: r.digital_products.digital_product_materials.map((m) => m.jenis),
      sumber: r.sumber,
      diberikanPada: r.diberikan_pada,
      berlakuSampai: r.berlaku_sampai,
    }));
}
