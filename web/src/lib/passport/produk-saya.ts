import { createServerSupabase } from "@/lib/supabase/server";
import type { JenisProduk } from "@/lib/produk/status";

export type ProdukDimiliki = {
  id: string;
  judul: string;
  slug: string;
  jenis: JenisProduk;
  bolehUnduh: boolean;
  sumber: string;
  diberikanPada: string;
};

type BarisEntitlement = {
  id: string;
  sumber: string;
  diberikan_pada: string;
  digital_products: {
    id: string;
    judul: string;
    slug: string;
    jenis: JenisProduk;
    boleh_unduh: boolean;
  } | null;
};

/**
 * Dibaca lewat SESI PENGGUNA, bukan service role, dan TANPA `.eq("client_id",
 * …)` — policy "entitlement: klien baca miliknya" (migration
 * `produk_entitlement`) sendiri yang menyaring lewat `auth.uid()`. Menambah
 * filter `client_id` di TypeScript di atasnya tidak menutup radius apa pun
 * (RLS sudah menutupnya), tapi membuka celah yang lain: bila `clientId` yang
 * dioper caller keliru atau gerbangnya sendiri yang mati, filter TypeScript
 * itu akan tetap menghasilkan daftar kosong yang terlihat identik dengan
 * "klien ini memang tidak punya apa-apa" — persis kegagalan senyap yang
 * dijelaskan di `ambilSertifikatLayanan`/`ambilSesiSatu` soal embed yang
 * ditolak RLS.
 *
 * `dicabut_pada` disaring di sini (bukan hanya lewat RLS) supaya entitlement
 * yang sudah dicabut admin tidak lagi muncul di "Pembelian saya" — halaman
 * ini adalah daftar akses AKTIF, bukan riwayat lengkap.
 *
 * Baris yang produknya tidak lagi terbaca dibuang, bukan ditampilkan dengan
 * judul kosong: embed yang ditolak RLS memulangkan `null`, bukan galat, dan
 * "Pembelian saya" tidak boleh menampilkan kartu tanpa nama.
 *
 * Yang TIDAK lagi termasuk di dalamnya: produk yang dinonaktifkan admin.
 * Policy "produk: pemilik entitlement baca" (migration `produk_akses_pemilik`)
 * membuat embed ini tetap terisi untuk pemegang entitlement yang hidup, tayang
 * atau tidak — `aktif = false` berarti berhenti dijual, bukan mencabut akses.
 * Penyaring di bawah karena itu kini hanya menjaga kasus sisa (mis. produknya
 * benar-benar dihapus di tengah pembacaan), bukan lagi diam-diam menjadi
 * pencabutan akses.
 */
export async function produkSaya(clientId: string): Promise<ProdukDimiliki[]> {
  // `clientId` diterima demi kesamaan bentuk dengan pembaca passport lain
  // (`ambilSesi`, `ambilPaket`, …) yang dipanggil dari page.tsx dengan
  // `klien.id` yang sama — tapi TIDAK dipakai memfilter query di sini,
  // lihat komentar di atas.
  void clientId;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("digital_entitlements")
    .select(
      "id, sumber, diberikan_pada, digital_products(id, judul, slug, jenis, boleh_unduh)",
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
      jenis: r.digital_products.jenis,
      bolehUnduh: r.digital_products.boleh_unduh,
      sumber: r.sumber,
      diberikanPada: r.diberikan_pada,
    }));
}
