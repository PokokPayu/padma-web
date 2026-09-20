import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import type { JenisProduk } from "@/lib/produk/status";

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
  jenis: JenisProduk;
  bolehUnduh: boolean;
  aktif: boolean;
  urutan: number;
  /** Ada berkas terunggah. Produk tanpa isi tidak boleh diaktifkan. */
  adaIsi: boolean;
  /** Dari view `produk_harga_staf`. null = owner belum menetapkan harga. */
  harga: number | null;
  hargaCoret: number | null;
};

export const SARING_PRODUK = {
  aktif: ["ya", "tidak"],
  jenis: ["video", "pdf"],
  isi: ["ada", "belum"],
} as const satisfies SaringSah;

type BarisProduk = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  jenis: JenisProduk;
  boleh_unduh: boolean;
  aktif: boolean;
  urutan: number;
  // Embed AGREGAT, selalu tepat satu objek `{ count }` (LEFT JOIN) — bukan
  // larik berkas sungguhan. Sama alasannya dengan `material_pages(count)` di
  // materi-admin.ts: PostgREST memotong BARIS pada `max_rows`, tidak pernah
  // nilai agregat.
  digital_product_files: Array<{ count: number }>;
};
type BarisHarga = { product_id: string; harga: number; harga_coret: number | null };

/**
 * Satu halaman daftar produk, datar — dengan harga dari view staf.
 *
 * DUA query digabung di JS, sama bentuknya dengan `ambilDaftarMateri`:
 * satu untuk baris produk (dengan hitungan berkas agregat), satu untuk harga
 * lewat `produk_harga_staf`. Menggabung keduanya lewat satu embed langsung
 * atas view tidak dipakai di sini karena `produk_harga_staf` bukan tabel
 * fisik dengan FK yang bisa PostgREST tautkan otomatis lewat embed.
 */
export async function ambilDaftarProduk(
  param: ParamDaftar,
): Promise<{ baris: ProdukKelola[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("digital_products")
    .select(
      "id, judul, slug, deskripsi, jenis, boleh_unduh, aktif, urutan, digital_product_files(count)",
      { count: "exact" },
    )
    .order("urutan")
    .order("judul");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");
  if (param.saring.jenis) q = q.eq("jenis", param.saring.jenis);
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("judul", `%${aman}%`);
  }

  const { data: produk, count, error } = await q.range(dari, sampai).returns<BarisProduk[]>();
  // GALAT DIBACA, BUKAN DIBUANG: `data ?? []` menyamakan kegagalan PostgREST
  // dengan "tidak ada produk", dan admin tidak bisa membedakan keduanya dari
  // layar kosong.
  if (error) throw new Error(`Gagal membaca daftar produk: ${error.message}`);

  const { data: harga, error: hargaError } = await supabase
    .from("produk_harga_staf")
    .select("product_id, harga, harga_coret")
    .returns<BarisHarga[]>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  const hargaPer = new Map((harga ?? []).map((h) => [h.product_id, h] as const));

  let baris: ProdukKelola[] = (produk ?? []).map((p) => {
    const adaIsi = (p.digital_product_files[0]?.count ?? 0) > 0;
    const h = hargaPer.get(p.id);
    return {
      id: p.id,
      judul: p.judul,
      slug: p.slug,
      deskripsi: p.deskripsi,
      jenis: p.jenis,
      bolehUnduh: p.boleh_unduh,
      aktif: p.aktif,
      urutan: p.urutan,
      adaIsi,
      harga: h?.harga ?? null,
      hargaCoret: h?.harga_coret ?? null,
    };
  });

  // Saringan "isi" dikerjakan di JS: `adaIsi` bukan kolom, ia dihitung dari
  // embed agregat. Konsekuensinya jujur — `total` ikut dilaporkan sebagai
  // jumlah yang benar-benar tampil sesudah saringan JS ini, sama seperti
  // saringan "belum ada isi" di `ambilDaftarMateri`.
  if (param.saring.isi) {
    const ingin = param.saring.isi === "ada";
    baris = baris.filter((p) => p.adaIsi === ingin);
  }

  return { baris, total: param.saring.isi ? baris.length : (count ?? 0) };
}

/** Satu produk, atau `null` bila id-nya tidak ada. */
export async function ambilProduk(id: string): Promise<ProdukKelola | null> {
  const supabase = await createServerSupabase();

  // GALAT DIBACA, BUKAN DIBUANG: `data ?? null` menyamakan kegagalan PostgREST
  // dengan "produk tidak ada", dan kedua kalimat itu tidak bisa dibedakan di
  // layar admin.
  const { data, error } = await supabase
    .from("digital_products")
    .select("id, judul, slug, deskripsi, jenis, boleh_unduh, aktif, urutan, digital_product_files(id)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!data) return null;

  const { data: harga, error: hargaError } = await supabase
    .from("produk_harga_staf")
    .select("harga, harga_coret")
    .eq("product_id", id)
    .maybeSingle();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return {
    id: data.id,
    judul: data.judul,
    slug: data.slug,
    deskripsi: data.deskripsi,
    jenis: data.jenis as JenisProduk,
    bolehUnduh: data.boleh_unduh,
    aktif: data.aktif,
    urutan: data.urutan,
    adaIsi: (data.digital_product_files ?? []).length > 0,
    harga: harga?.harga ?? null,
    hargaCoret: harga?.harga_coret ?? null,
  };
}
