import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Banding RAHASIA MESIN (header `Authorization` rute cron) dalam waktu tetap.
 *
 * ===== KENAPA BUKAN `!==` =====
 * `!==` atas string berhenti pada karakter pertama yang berbeda, jadi lamanya
 * membanding membocorkan berapa karakter awal yang sudah cocok. Dua rute di
 * repo ini dijaga rahasia bersama tanpa sesi dan tanpa peran
 * (`/api/cron/tenggat`, `/api/cron/pesanan`), dan yang kedua menembakkan
 * permintaan ke Midtrans dengan service role lintas klien. Keterpaparannya
 * lewat HTTPS memang rendah — derau jaringan jauh lebih besar daripada selisih
 * beberapa nanodetik — tapi harganya satu panggilan fungsi, dan dokblok
 * `/api/cron/tenggat` sudah MENJANJIKAN banding panjang-tetap sejak rute itu
 * lahir. Janji yang tidak ditepati kode lebih buruk daripada janji yang tidak
 * pernah dibuat: pembaca berikutnya berhenti memeriksa.
 *
 * ===== KENAPA DI-HASH DULU, BUKAN `timingSafeEqual` LANGSUNG =====
 * `timingSafeEqual` MELEMPAR ketika panjang kedua buffer berbeda — bukan
 * memulangkan false. Memanggilnya mentah berarti satu header sepanjang beda
 * satu karakter menjatuhkan rute ke 500, dan 500 pada rute cron berarti job
 * MERAH tiap lima belas menit untuk permintaan yang seharusnya cukup dijawab
 * 401.
 *
 * Jalan keluar yang biasa dipakai — banding panjang lebih dulu, lalu
 * `timingSafeEqual` — dipakai `tandaTanganCocok()`
 * (`src/lib/midtrans/tanda-tangan.ts`) dan BENAR di sana: kedua sisinya sha512
 * heksadesimal, 128 karakter TETAP, jadi panjangnya bukan rahasia. Di sini
 * tidak: panjang `CRON_SECRET` adalah properti rahasianya sendiri, dan
 * memungutnya dari sebuah pra-banding adalah kebocoran yang tidak perlu ada.
 * Karena itu fungsi ini TIDAK memanggil `tandaTanganCocok` — ia bukan tanda
 * tangan, dan alasan keamanan yang ditulis di dokblok fungsi itu tidak berlaku
 * untuk rahasia yang panjangnya bebas.
 *
 * Meng-hash kedua sisi lebih dulu menyelesaikan keduanya sekaligus: sha256
 * selalu 32 bita, jadi tidak ada lemparan panjang DAN tidak ada panjang yang
 * bocor.
 */
export function rahasiaMesinCocok(dikirim: string, diharapkan: string): boolean {
  // FAIL-CLOSED terhadap penyalahgunaan. Pemanggil hari ini sudah menolak
  // rahasia kosong lebih dulu (dan punya ujinya sendiri untuk itu), tapi
  // fungsi yang memulangkan `true` untuk `("", "")` adalah ranjau bagi
  // pemanggil BERIKUTNYA yang lupa memasang pagar itu.
  if (diharapkan === "") return false;

  const a = createHash("sha256").update(dikirim, "utf8").digest();
  const b = createHash("sha256").update(diharapkan, "utf8").digest();
  return timingSafeEqual(a, b);
}
