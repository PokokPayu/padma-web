import { createServerSupabase } from "@/lib/supabase/server";

/** Harus sama dengan kosakata `baca_keranjang()` (`20261002100000`). */
export type KeadaanItem = "siap" | "tidak_tersedia" | "gratis" | "sudah_dimiliki" | "diproses";

export type ItemKeranjang = {
  productId: string;
  judul: string;
  slug: string;
  harga: number | null;
  keadaan: KeadaanItem;
};

type Baris = {
  product_id: string;
  judul: string;
  slug: string;
  harga: number | null;
  keadaan: KeadaanItem;
};

/**
 * GAGAL TERTUTUP: galat dilempar, bukan dibaca sebagai keranjang kosong.
 * Keranjang kosong yang palsu menyembunyikan barang yang mau dibeli orang.
 */
export async function bacaKeranjang(): Promise<ItemKeranjang[]> {
  const sb = await createServerSupabase();
  const { data, error } = await sb.rpc("baca_keranjang");
  if (error) throw new Error(`Gagal membaca keranjang: ${error.message}`);
  return ((data ?? []) as Baris[]).map((b) => ({
    productId: b.product_id,
    judul: b.judul,
    slug: b.slug,
    harga: b.harga,
    keadaan: b.keadaan,
  }));
}

/**
 * Pesanan terbuka MILIK klien ini. Filter `client_id` WAJIB: `orders` punya
 * policy "pesanan: staf baca", jadi staf-yang-juga-klien tanpa filter ini
 * membaca pesanan terbuka klien lain — dan tombol batal di layar ini akan
 * menunjuk pesanan orang (rute batalnya menolak, tapi layarnya berbohong).
 */
export async function pesananTerbukaSaya(
  clientId: string,
): Promise<{ id: string; kode: string } | null> {
  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("orders")
    .select("id, kode")
    .eq("client_id", clientId)
    .eq("status", "menunggu_bayar")
    .maybeSingle<{ id: string; kode: string }>();
  if (error) throw new Error(`Gagal membaca pesanan terbuka: ${error.message}`);
  return data;
}

export async function hitungKeranjang(): Promise<number> {
  const sb = await createServerSupabase();
  const { count, error } = await sb
    .from("cart_items")
    .select("product_id", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}
