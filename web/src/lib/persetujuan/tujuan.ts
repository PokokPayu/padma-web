import { tujuanProdukAman } from "@/lib/auth/tujuan-produk";

/**
 * Ke mana `/persetujuan` memulangkan klien sesudah ia setuju.
 *
 * Pemberi `lanjut` hanya dua, keduanya di `/produk/[slug]`: tombol beli dan
 * server action ambil gratis. Karena itu whitelist-nya cukup regex ketat yang
 * sudah ada (`^/produk/<slug>$`) —
 * dipakai ulang, tidak disalin. Layout `/passport` tidak tahu path asalnya,
 * sehingga klien yang tertahan di sana kembali ke `/passport`. Semua yang lain
 * — termasuk `//evil.com`, skema apa pun, dan larik dari query string ganda —
 * jatuh ke `/passport`.
 */
export function tujuanPersetujuanAman(lanjut: unknown): string {
  return tujuanProdukAman(typeof lanjut === "string" ? lanjut : null) ?? "/passport";
}
