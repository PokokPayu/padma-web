import { createServerSupabase } from "@/lib/supabase/server";
import type { BabPublik } from "@/lib/produk/katalog";
import type { JenisMateri } from "@/lib/produk/status";

type BarisBab = {
  id: string; judul: string; urutan: number; created_at: string;
  digital_product_materials: Array<{
    id: string; judul: string; keterangan: string; jenis: JenisMateri;
    sampul_objek: string | null; pratinjau: boolean; urutan: number; created_at: string;
  }>;
};

function urut<T extends { urutan: number; created_at: string }>(a: T, b: T): number {
  return a.urutan - b.urutan || a.created_at.localeCompare(b.created_at);
}

/**
 * Daftar isi dengan SESI pengguna: produk tayang terbaca lewat policy publik,
 * produk nonaktif terbaca pemiliknya lewat `pernah_punya_produk`. Hanya
 * daftar — isinya tetap dijaga `boleh_buka_materi` di files/pages.
 */
export async function bacaIsiProduk(productId: string): Promise<BabPublik[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_sections")
    .select(
      "id, judul, urutan, created_at, digital_product_materials(id, judul, keterangan, jenis, sampul_objek, pratinjau, urutan, created_at)",
    )
    .eq("product_id", productId)
    .returns<BarisBab[]>();
  if (error) throw new Error(`Gagal membaca isi produk: ${error.message}`);

  return [...(data ?? [])].sort(urut).map((b) => ({
    id: b.id,
    judul: b.judul,
    materi: [...b.digital_product_materials].sort(urut).map((m) => ({
      id: m.id,
      judul: m.judul,
      keterangan: m.keterangan,
      jenis: m.jenis,
      sampulObjek: m.sampul_objek,
      pratinjau: m.pratinjau,
    })),
  }));
}
