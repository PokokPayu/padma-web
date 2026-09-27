/**
 * Pemicu Lapis 1b di sisi PERAMBAN.
 *
 * ===== KENAPA MODUL TERSENDIRI, BUKAN BADAN useEffect =====
 * `renderToStaticMarkup` tidak menjalankan efek, dan repo ini tidak punya jsdom
 * maupun testing-library — jadi logika yang tinggal di dalam `useEffect` hanya
 * bisa "diuji" dengan memindai teks sumbernya, dan uji semacam itu sudah
 * beberapa kali menipu repo ini. Dipisahkan begini, keputusannya jadi fungsi
 * biasa yang bisa dijalankan sungguhan.
 *
 * TANPA `server-only`: ia diimpor komponen `"use client"`.
 */

/**
 * Memanggil pemeriksaan satu kali, lalu menyegarkan HANYA bila ada yang
 * benar-benar berubah.
 *
 * Dua sifatnya yang mudah hilang saat disederhanakan:
 *
 *  • `segarkan()` bersyarat. Menyegarkan tanpa sebab berarti satu perjalanan
 *    server penuh setiap kali halaman etalase dibuka — halaman yang justru
 *    dirancang murah (`export const revalidate = 300`).
 *  • Galat ditelan. Server action yang gagal (jaringan klien putus, deploy
 *    berjalan) tidak boleh melahirkan unhandled rejection di konsol pengunjung
 *    yang cuma sedang melihat-lihat produk.
 */
export async function picuPeriksaSekali(
  periksa: () => Promise<{ diperiksa: number }>,
  segarkan: () => void,
): Promise<number> {
  let hasil: { diperiksa: number } | undefined;
  try {
    hasil = await periksa();
  } catch {
    return 0;
  }
  const jumlah = Number(hasil?.diperiksa ?? 0);
  if (!Number.isFinite(jumlah) || jumlah <= 0) return 0;
  segarkan();
  return jumlah;
}
