import { createClient } from "@supabase/supabase-js";
import type { JenisProduk } from "@/lib/produk/status";

export type ProdukPublik = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  jenis: JenisProduk;
  bolehUnduh: boolean;
  sampulObjek: string | null;
  /** null = owner belum menetapkan harga. 0 = GRATIS. Dua keadaan berbeda. */
  harga: number | null;
  hargaCoret: number | null;
};

// Etalase dibaca dengan ANON KEY, bukan sesi pengguna — alasannya sama persis
// dengan `lib/katalog.ts`, dan ketiganya masih berlaku:
//   * `cookies()` hanya bermakna di dalam request scope; di luar itu (test,
//     prerender statis) ia melempar "called outside a request scope";
//   * membaca cookie membuat etalase publik ikut dynamic tanpa alasan —
//     isinya sama untuk semua pengunjung;
//   * service role TIDAK dipakai JUSTRU supaya policy "baca publik yang
//     aktif" benar-benar teruji: bila policy itu hilang, etalase kosong
//     tertangkap di test, bukan diam-diam kosong di produksi.
function klienPublik() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type BarisProduk = {
  id: string; judul: string; slug: string; deskripsi: string;
  jenis: JenisProduk; boleh_unduh: boolean; sampul_objek: string | null;
};
type BarisHarga = { product_id: string; harga: number; harga_coret: number | null };

function rakit(produk: BarisProduk[], harga: BarisHarga[]): ProdukPublik[] {
  const peta = new Map(harga.map((h) => [h.product_id, h]));
  return produk.map((p) => {
    const h = peta.get(p.id);
    return {
      id: p.id,
      judul: p.judul,
      slug: p.slug,
      deskripsi: p.deskripsi,
      jenis: p.jenis,
      bolehUnduh: p.boleh_unduh,
      sampulObjek: p.sampul_objek,
      // `?? null` di sini AMAN dan tidak menyembunyikan kegagalan: galat
      // query sudah dilempar di atas, jadi ketiadaan baris di sini benar-benar
      // berarti "owner belum menetapkan harga".
      harga: h?.harga ?? null,
      hargaCoret: h?.harga_coret ?? null,
    };
  });
}

export async function bacaProdukPublik(batas?: number): Promise<ProdukPublik[]> {
  const supabase = klienPublik();

  // RLS "produk: baca publik yang aktif" yang menyaring, bukan `.eq("aktif",
  // true)` di sini — filter di TypeScript akan tetap hijau seandainya
  // policy-nya hilang, dan itu persis kegagalan yang tidak boleh senyap.
  let q = supabase
    .from("digital_products")
    .select("id, judul, slug, deskripsi, jenis, boleh_unduh, sampul_objek")
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
  // Dibaca lewat klien yang SAMA, dan galatnya dilempar: bila
  // `harga_produk_publik` kehilangan grantnya, etalase kehilangan harganya di
  // test yang sama — bukan diam-diam tampil "harga belum ditetapkan" untuk
  // seluruh katalog di produksi.
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit(produk!, harga ?? []);
}

export async function bacaProdukPerSlug(slug: string): Promise<ProdukPublik | null> {
  const supabase = klienPublik();
  const { data: produk, error } = await supabase
    .from("digital_products")
    .select("id, judul, slug, deskripsi, jenis, boleh_unduh, sampul_objek")
    .eq("slug", slug)
    .maybeSingle<BarisProduk>();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!produk) return null;

  const { data: harga, error: hargaError } = await supabase
    .from("harga_produk_publik")
    .select("product_id, harga, harga_coret")
    .eq("product_id", produk.id)
    .returns<BarisHarga[]>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit([produk], harga ?? [])[0];
}
