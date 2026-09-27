/**
 * BENTUK `kode` PESANAN DAN `order_id` MIDTRANS.
 *
 * Fungsi murni tanpa impor — dipakai rute server (checkout, webhook, cron)
 * DAN komponen peramban, jadi berkas ini sengaja TIDAK memanggil `server-only`.
 *
 * Kenapa bentuknya hidup di dua bahasa sekaligus, dan kenapa itu bukan
 * duplikasi yang bisa dihapus: `kode` DITERBITKAN oleh SQL (`buat_pesanan`),
 * sementara yang menyaring notifikasi masuk sebelum satu sha512 pun dihitung
 * adalah TypeScript. Dua bentuk yang berselisih berarti webhook menolak
 * notifikasi yang sah — uang masuk, pesanan tidak bergerak, dan tidak ada
 * galat di mana pun. Karena itu `tests/pesanan-checkout-db.test.ts`
 * mencocokkan `kode` HASIL RPC ke regex di bawah, bukan ke salinannya sendiri.
 */

/**
 * `PSN-YYMMDD-XXXXXX`, XXXXXX = enam heksadesimal HURUF BESAR.
 *
 * TANPA flag `g`, dan itu bukan gaya: `RegExp.test()` pada regex ber-`g`
 * menyimpan `lastIndex` dan memulangkan false BERGANTIAN pada pemanggilan
 * berikutnya. Pola ini dipakai rute webhook untuk menyaring `order_id` sebelum
 * satu sha512 pun dihitung, jadi flag `g` di sini berarti setiap notifikasi sah
 * KEDUA dijawab 400 — dan 400 memberi tahu Midtrans "sudah selesai, jangan
 * kirim lagi". Pesanan terkunci mati dengan uang yang sudah masuk, tanpa satu
 * pun galat. Kedua pola di berkas ini punya ujinya sendiri untuk itu.
 */
export const POLA_KODE_PESANAN = /^PSN-\d{6}-[0-9A-F]{6}$/;

/**
 * `kode` + titik + percobaan 1..9 — inilah `order_id` yang dikenal Midtrans.
 *
 * Midtrans menolak `order_id` kembar SELAMANYA; sufiks percobaan itulah jalan
 * keluar ketika token gagal terbit dan order_id-nya sudah terbakar.
 *
 * TANPA flag `g` — lihat dokblok `POLA_KODE_PESANAN`.
 */
export const POLA_ORDER_ID = /^PSN-\d{6}-[0-9A-F]{6}\.[1-9]$/;

/**
 * MELEMPAR, bukan memulangkan string cacat.
 *
 * `percobaan` 10 akan menghasilkan `...A1B2C3.10`, yang TIDAK cocok dengan
 * `POLA_ORDER_ID` — dan rute webhook membuang notifikasi yang bentuknya tidak
 * cocok sebelum menyentuh basis data. Kegagalan yang dilempar di sini
 * berhenti di checkout; kegagalan yang diloloskan berhenti di uang.
 */
export function rakitOrderId(kode: string, percobaan: number): string {
  if (!POLA_KODE_PESANAN.test(kode)) {
    throw new Error(`Kode pesanan tidak berbentuk PSN-YYMMDD-XXXXXX: ${kode}`);
  }
  if (!Number.isInteger(percobaan) || percobaan < 1 || percobaan > 9) {
    throw new Error(`Percobaan pesanan di luar 1..9: ${percobaan}`);
  }
  return `${kode}.${percobaan}`;
}

/**
 * `null` untuk bentuk asing — pemanggilnya yang memutuskan kodenya (400 di
 * webhook). Tebakan "ambil saja bagian sebelum titik" akan menjadikan
 * `../../etc/passwd` sebuah kode pesanan.
 */
export function uraiOrderId(orderId: string): { kode: string; percobaan: number } | null {
  if (!POLA_ORDER_ID.test(orderId)) return null;
  const pisah = orderId.lastIndexOf(".");
  return {
    kode: orderId.slice(0, pisah),
    percobaan: Number(orderId.slice(pisah + 1)),
  };
}
