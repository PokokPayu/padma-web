import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Tanda tangan notifikasi Midtrans:
 *   sha512(order_id + status_code + gross_amount + serverKey)
 *
 * Keempatnya dirangkai APA ADANYA, tanpa pemisah, tanpa normalisasi. Itulah
 * kenapa skema notifikasi memakai `z.string()` dan bukan `z.coerce.number()`:
 * mengubah `"150000.00"` menjadi angka lalu kembali menghasilkan `"150000"`,
 * tanda tangannya tidak cocok, dan kegagalannya terlihat persis seperti
 * "Midtrans salah" — padahal kita yang mengubah bahan yang ditandatangani.
 */
export function hitungTandaTangan(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash("sha512")
    .update(orderId + statusCode + grossAmount + serverKey, "utf8")
    .digest("hex");
}

/**
 * Banding waktu-tetap.
 *
 * `timingSafeEqual` MELEMPAR ketika panjang kedua buffer berbeda — bukan
 * memulangkan false. Memanggilnya tanpa menyamakan panjang lebih dulu berarti
 * satu notifikasi bertanda tangan pendek menjatuhkan rute ke 500, dan 500
 * mengundang Midtrans mengirim ulang selamanya.
 *
 * Panjang yang dibandingkan di sini tidak membocorkan rahasia apa pun: kedua
 * sisi adalah sha512 heksadesimal, yaitu 128 karakter TETAP. Panjang yang
 * berbeda sudah berarti "bukan dari Midtrans" sebelum satu byte pun dibanding.
 */
export function tandaTanganCocok(dikirim: string, dihitung: string): boolean {
  const a = Buffer.from(dikirim, "utf8");
  const b = Buffer.from(dihitung, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sidik idempotensi — kunci `unique` di `notifikasi_pesanan`.
 *
 * Yang BUKAN sidik, dan kenapa: `order_id` saja atau `transaction_id` saja
 * adalah tebakan yang sangat wajar, dan keduanya memakan uang. Midtrans
 * mengirim BEBERAPA notifikasi per pesanan (`pending` lalu `settlement`, kadang
 * `capture` lalu `settlement`). Dengan sidik se-pesanan, notifikasi `pending`
 * mendarat duluan, mengunci barisnya, dan `settlement` ditolak sebagai
 * duplikat — pembeli membayar, uangnya masuk ke Midtrans, pesanannya tinggal
 * `menunggu_bayar` selamanya.
 *
 * `fraudStatus` ikut karena `capture`+`challenge` dan `capture`+`accept` adalah
 * DUA KEPUTUSAN BERBEDA atas transaksi yang sama.
 *
 * Dipisah `"|"` supaya dua bidang tetangga tidak bisa bertukar batas
 * ("ab"+"c" dan "a"+"bc" adalah string yang sama tanpa pemisah).
 */
export function hitungSidik(b: {
  orderId: string;
  statusCode: string;
  transactionStatus: string;
  fraudStatus: string;
  transactionId: string;
}): string {
  return createHash("sha256")
    .update(
      [b.orderId, b.statusCode, b.transactionStatus, b.fraudStatus, b.transactionId].join("|"),
      "utf8",
    )
    .digest("hex");
}
