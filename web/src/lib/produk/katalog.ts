import { createClient } from "@supabase/supabase-js";
import type { JenisMateri } from "@/lib/produk/status";

/**
 * Katalog publik dibaca dengan ANON KEY supaya policy baca publik benar-benar
 * teruji: daftar bab & materi hanya terbaca untuk produk tayang, isinya
 * (files/pages) tidak pernah.
 */
export type ProdukPublik = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  sampulObjek: string | null;
  masaBerlakuBulan: number | null;
  jenisMateri: JenisMateri[];
  harga: number | null;
  hargaCoret: number | null;
};

export type MateriPublik = {
  id: string;
  judul: string;
  keterangan: string;
  jenis: JenisMateri;
  sampulObjek: string | null;
  pratinjau: boolean;
};

export type BabPublik = { id: string; judul: string; materi: MateriPublik[] };

function klienPublik() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type BarisProduk = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  sampul_objek: string | null;
  masa_berlaku_bulan: number | null;
  digital_product_materials: Array<{ jenis: JenisMateri }>;
};
type BarisHarga = { product_id: string; harga: number; harga_coret: number | null };
type BarisMateri = {
  id: string; judul: string; keterangan: string; jenis: JenisMateri;
  sampul_objek: string | null; pratinjau: boolean; urutan: number; created_at: string;
};
type BarisBab = {
  id: string; judul: string; urutan: number; created_at: string;
  digital_product_materials: BarisMateri[];
};

const KOLOM_PRODUK =
  "id, judul, slug, deskripsi, sampul_objek, masa_berlaku_bulan, digital_product_materials(jenis)";

function urut<T extends { urutan: number; created_at: string }>(a: T, b: T): number {
  return a.urutan - b.urutan || a.created_at.localeCompare(b.created_at);
}

function rakit(produk: BarisProduk[], harga: BarisHarga[]): ProdukPublik[] {
  const peta = new Map(harga.map((h) => [h.product_id, h]));
  return produk.map((p) => {
    const h = peta.get(p.id);
    return {
      id: p.id,
      judul: p.judul,
      slug: p.slug,
      deskripsi: p.deskripsi,
      sampulObjek: p.sampul_objek,
      masaBerlakuBulan: p.masa_berlaku_bulan,
      jenisMateri: p.digital_product_materials.map((m) => m.jenis),
      harga: h?.harga ?? null,
      hargaCoret: h?.harga_coret ?? null,
    };
  });
}

export async function bacaProdukPublik(batas?: number): Promise<ProdukPublik[]> {
  const supabase = klienPublik();

  let q = supabase
    .from("digital_products")
    .select(KOLOM_PRODUK)
    .order("urutan", { ascending: true })
    .order("created_at", { ascending: false });
  if (batas !== undefined) q = q.limit(batas);

  const { data: produk, error } = await q.returns<BarisProduk[]>();
  if (error) throw new Error(`Gagal membaca etalase produk: ${error.message}`);
  if ((produk ?? []).length === 0) return [];

  const { data: harga, error: hargaError } = await supabase
    .from("harga_produk_publik")
    .select("product_id, harga, harga_coret")
    .in("product_id", produk!.map((p) => p.id))
    .returns<BarisHarga[]>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit(produk!, harga ?? []);
}

export async function bacaProdukPerSlug(
  slug: string,
): Promise<(ProdukPublik & { bab: BabPublik[] }) | null> {
  const supabase = klienPublik();
  const { data: produk, error } = await supabase
    .from("digital_products")
    .select(KOLOM_PRODUK)
    .eq("slug", slug)
    .maybeSingle<BarisProduk>();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!produk) return null;

  const [{ data: harga, error: hargaError }, { data: bab, error: babError }] = await Promise.all([
    supabase
      .from("harga_produk_publik")
      .select("product_id, harga, harga_coret")
      .eq("product_id", produk.id)
      .returns<BarisHarga[]>(),
    supabase
      .from("digital_product_sections")
      .select(
        "id, judul, urutan, created_at, digital_product_materials(id, judul, keterangan, jenis, sampul_objek, pratinjau, urutan, created_at)",
      )
      .eq("product_id", produk.id)
      .returns<BarisBab[]>(),
  ]);
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);
  if (babError) throw new Error(`Gagal membaca daftar materi: ${babError.message}`);

  return {
    ...rakit([produk], harga ?? [])[0],
    bab: [...(bab ?? [])].sort(urut).map((b) => ({
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
    })),
  };
}
