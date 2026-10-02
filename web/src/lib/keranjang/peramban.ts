import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Acara di `window` yang menyala sesudah keranjang berubah dari tab ini —
 * supaya tautan "Keranjang (n)" di halaman yang sama ikut bergerak tanpa
 * muat ulang.
 */
export const ACARA_KERANJANG = "padma-keranjang-berubah";

/**
 * Jumlah item keranjang pemanggil, atau 0 tanpa sesi. RLS "keranjang: klien
 * baca miliknya" yang menyaring — tidak ada policy staf, jadi staf-yang-juga-
 * klien pun hanya menghitung miliknya sendiri.
 *
 * Galat dibaca sebagai 0: yang hilang hanyalah sebuah tautan, bukan uang.
 */
export async function hitungKeranjangDiPeramban(): Promise<number> {
  const sb = createBrowserSupabase();
  const { data: sesi } = await sb.auth.getSession();
  if (!sesi.session) return 0;
  const { count, error } = await sb
    .from("cart_items")
    .select("product_id", { count: "exact", head: true });
  if (error) {
    console.error(`[keranjang] hitungan tidak terbaca: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
