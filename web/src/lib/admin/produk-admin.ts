import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { materiBerisi, type JenisMateri } from "@/lib/produk/status";

/**
 * Lapisan data modul Produk Digital — sisi admin.
 *
 * Sama seperti `materi-admin.ts`, berkas ini WAJIB memakai sesi pengguna
 * (`createServerSupabase()`), bukan service role: harga datang dari view
 * `produk_harga_staf`, yang di dalamnya sendiri memeriksa
 * `user_role() in ('admin','owner')` — di bawah service role `user_role()`
 * mengembalikan 'klien' dan viewnya tidak pernah menjawab apa pun.
 */

export type ProdukKelola = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  aktif: boolean;
  urutan: number;
  sampulObjek: string | null;
  masaBerlakuBulan: number | null;
  jenisMateri: JenisMateri[];
  /** Isi LENGKAP: minimal satu materi, dan setiap materi sudah berisi. Syarat tayang. */
  adaIsi: boolean;
  /** Dari view `produk_harga_staf`. null = owner belum menetapkan harga. */
  harga: number | null;
  hargaCoret: number | null;
};

export type MateriKelola = {
  id: string;
  judul: string;
  keterangan: string;
  jenis: JenisMateri;
  sampulObjek: string | null;
  pratinjau: boolean;
  bolehUnduh: boolean;
  adaBerkas: boolean;
  jumlahHalaman: number;
  berisi: boolean;
};

export type BabKelola = { id: string; judul: string; materi: MateriKelola[] };

export const SARING_PRODUK = {
  aktif: ["ya", "tidak"],
  isi: ["ada", "belum"],
} as const satisfies SaringSah;

// `digital_product_files.material_id` UNIQUE → PostgREST memperlakukannya
// one-to-one: embed `(count)` datang sebagai OBJEK `{ count }` (terukur: `{count:0}`
// tanpa baris), BUKAN array; `| null` dijaga untuk berjaga-jaga. Embed `(id)`
// datang sebagai objek atau `null`. `digital_product_pages` one-to-many → array.
type BarisMateriRingkas = {
  jenis: JenisMateri;
  digital_product_files: { count: number } | null;
  digital_product_pages: Array<{ count: number }>;
};

type BarisProduk = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  aktif: boolean;
  urutan: number;
  sampul_objek: string | null;
  masa_berlaku_bulan: number | null;
  digital_product_materials: BarisMateriRingkas[];
};
type BarisHarga = { product_id: string; harga: number; harga_coret: number | null };

const KOLOM_PRODUK =
  "id, judul, slug, deskripsi, aktif, urutan, sampul_objek, masa_berlaku_bulan, " +
  "digital_product_materials(jenis, digital_product_files(count), digital_product_pages(count))";

function lengkap(materi: BarisMateriRingkas[]): boolean {
  return (
    materi.length > 0 &&
    materi.every((m) =>
      materiBerisi(m.jenis, m.digital_product_files?.count ?? 0, m.digital_product_pages[0]?.count ?? 0),
    )
  );
}

function rakit(p: BarisProduk, h: BarisHarga | undefined | null): ProdukKelola {
  return {
    id: p.id,
    judul: p.judul,
    slug: p.slug,
    deskripsi: p.deskripsi,
    aktif: p.aktif,
    urutan: p.urutan,
    sampulObjek: p.sampul_objek,
    masaBerlakuBulan: p.masa_berlaku_bulan,
    jenisMateri: p.digital_product_materials.map((m) => m.jenis),
    adaIsi: lengkap(p.digital_product_materials),
    harga: h?.harga ?? null,
    hargaCoret: h?.harga_coret ?? null,
  };
}

export async function ambilDaftarProduk(
  param: ParamDaftar,
): Promise<{ baris: ProdukKelola[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("digital_products")
    .select(KOLOM_PRODUK, { count: "exact" })
    .order("urutan")
    .order("judul");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("judul", `%${aman}%`);
  }

  const { data: produk, count, error } = await q.range(dari, sampai).returns<BarisProduk[]>();
  if (error) throw new Error(`Gagal membaca daftar produk: ${error.message}`);

  const { data: harga, error: hargaError } = await supabase
    .from("produk_harga_staf")
    .select("product_id, harga, harga_coret")
    .returns<BarisHarga[]>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  const hargaPer = new Map((harga ?? []).map((h) => [h.product_id, h] as const));
  let baris = (produk ?? []).map((p) => rakit(p, hargaPer.get(p.id)));

  if (param.saring.isi) {
    const ingin = param.saring.isi === "ada";
    baris = baris.filter((p) => p.adaIsi === ingin);
  }

  return { baris, total: param.saring.isi ? baris.length : (count ?? 0) };
}

export async function ambilProduk(id: string): Promise<ProdukKelola | null> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("digital_products")
    .select(KOLOM_PRODUK)
    .eq("id", id)
    .maybeSingle<BarisProduk>();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!data) return null;

  const { data: harga, error: hargaError } = await supabase
    .from("produk_harga_staf")
    .select("product_id, harga, harga_coret")
    .eq("product_id", id)
    .maybeSingle<BarisHarga>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit(data, harga);
}

type BarisBab = {
  id: string;
  judul: string;
  digital_product_materials: Array<{
    id: string;
    judul: string;
    keterangan: string;
    jenis: JenisMateri;
    sampul_objek: string | null;
    pratinjau: boolean;
    boleh_unduh: boolean;
    urutan: number;
    created_at: string;
    // one-to-one (material_id UNIQUE) → objek atau null; halaman one-to-many → array.
    digital_product_files: { id: string } | null;
    digital_product_pages: Array<{ count: number }>;
  }>;
};

export async function ambilIsiProduk(productId: string): Promise<BabKelola[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_sections")
    .select(
      "id, judul, digital_product_materials(id, judul, keterangan, jenis, sampul_objek, pratinjau, boleh_unduh, urutan, created_at, digital_product_files(id), digital_product_pages(count))",
    )
    .eq("product_id", productId)
    .order("urutan")
    .order("created_at")
    .returns<BarisBab[]>();
  if (error) throw new Error(`Gagal membaca isi produk: ${error.message}`);

  return (data ?? []).map((b) => ({
    id: b.id,
    judul: b.judul,
    materi: [...b.digital_product_materials]
      .sort((x, y) => x.urutan - y.urutan || x.created_at.localeCompare(y.created_at))
      .map((m) => {
        const adaBerkas = m.digital_product_files !== null;
        const jumlahHalaman = m.digital_product_pages[0]?.count ?? 0;
        return {
          id: m.id,
          judul: m.judul,
          keterangan: m.keterangan,
          jenis: m.jenis,
          sampulObjek: m.sampul_objek,
          pratinjau: m.pratinjau,
          bolehUnduh: m.boleh_unduh,
          adaBerkas,
          jumlahHalaman,
          berisi: materiBerisi(m.jenis, adaBerkas ? 1 : 0, jumlahHalaman),
        };
      }),
  }));
}

export function isiLengkap(bab: BabKelola[]): boolean {
  const semua = bab.flatMap((b) => b.materi);
  return semua.length > 0 && semua.every((m) => m.berisi);
}
