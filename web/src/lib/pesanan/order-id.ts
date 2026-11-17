/**
 * BENTUK `kode` PESANAN DAN `invoice_number` DOKU.
 *
 * Fungsi murni tanpa impor — dipakai rute server (checkout, webhook, cron)
 * DAN komponen peramban, jadi berkas ini sengaja TIDAK memanggil `server-only`.
 *
 * Kenapa bentuknya hidup di dua bahasa sekaligus, dan kenapa itu bukan
 * duplikasi yang bisa dihapus: `kode` DITERBITKAN oleh SQL (`buat_pesanan`),
 * sementara yang menyaring notifikasi masuk sebelum tanda tangannya dihitung
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
 * berikutnya. Pola ini dipakai untuk menyaring `kode` sebelum
 * pekerjaan lain dimulai, jadi flag `g` di sini berarti setiap notifikasi sah
 * KEDUA dijawab 400 — dan 400 memberi tahu gateway "sudah selesai, jangan
 * kirim lagi". Pesanan terkunci mati dengan uang yang sudah masuk, tanpa satu
 * pun galat. Kedua pola di berkas ini punya ujinya sendiri untuk itu.
 */
export const POLA_KODE_PESANAN = /^PSN-\d{6}-[0-9A-F]{6}$/;

/**
 * INVOICE DOKU: `kode` tanpa tanda hubung + satu digit percobaan 1..9.
 *
 * DOKU membatasi `invoice_number` pada alfanumerik, jadi tanda hubung dan titik
 * (bentuk `order_id` versi Midtrans) tidak bisa dipakai di sini. Sufiks
 * percobaan satu digit menjaga panjangnya 16 karakter, dan sufiks itulah yang
 * memberi jalan keluar ketika invoice sebelumnya sudah terbakar.
 *
 * TANPA flag `g` — lihat dokblok `POLA_KODE_PESANAN`.
 */
export const POLA_INVOICE_DOKU = /^PSN\d{6}[0-9A-F]{6}[1-9]$/;

/**
 * MELEMPAR bila `kode` atau `percobaan` tidak berbentuk benar: invoice cacat
 * tidak boleh sampai ke DOKU.
 */
export function rakitInvoice(kode: string, percobaan: number): string {
  if (!POLA_KODE_PESANAN.test(kode)) {
    throw new Error(`Kode pesanan tidak berbentuk PSN-YYMMDD-XXXXXX: ${kode}`);
  }
  if (!Number.isInteger(percobaan) || percobaan < 1 || percobaan > 9) {
    throw new Error(`Percobaan invoice di luar 1..9: ${percobaan}`);
  }
  return `${kode.replace(/-/g, "")}${percobaan}`;
}

/**
 * `null` untuk bentuk asing, dengan alasan yang sama seperti `rakitInvoice`:
 * tebakan bebas terhadap string dari luar bisa menjadikan sembarang teks
 * sebuah kode pesanan.
 */
export function uraiInvoice(invoice: string): { kode: string; percobaan: number } | null {
  if (!POLA_INVOICE_DOKU.test(invoice)) return null;
  return {
    kode: `PSN-${invoice.slice(3, 9)}-${invoice.slice(9, 15)}`,
    percobaan: Number(invoice.slice(15)),
  };
}
