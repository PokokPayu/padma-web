/**
 * Peta hasil webhook -> kode HTTP.
 *
 * "Retry Midtrans sebagai lapis nol" hanya berarti bila setiap keluaran punya
 * kodenya sendiri. Yang dijaga peta ini:
 *   4xx = badan yang TIDAK AKAN PERNAH berubah; mengulanginya percuma.
 *   200 = tidak ada lagi yang tersisa untuk disembuhkan.
 *   503 = salah KITA, sementara; Midtrans wajib mengirim ulang.
 *   500 = satu-satunya kelas yang retry benar-benar menyembuhkan.
 *
 * Yang paling mudah salah adalah `kunci_kosong`. 2xx/4xx di sana memberi tahu
 * Midtrans "sudah selesai" dan notifikasi itu tidak pernah datang lagi; 503
 * membuat env yang lupa dipasang berakhir sebagai KETERLAMBATAN, bukan sebagai
 * uang yang hilang.
 *
 * `pesanan_tidak_ada` TIDAK ada di tabel peta kode jawaban spec. Ia lahir
 * karena rute harus menangani "tanda tangan sah, tetapi `order_id` tidak
 * menunjuk pesanan mana pun" — mis. pesanan sandbox lama, atau basis data yang
 * di-reset. Ia masuk kelas 200: tanda tangannya sah, jadi ini memang dari
 * Midtrans, dan tidak ada apa pun yang bisa disembuhkan dengan mengulang.
 */
export type HasilWebhook =
  | "badan_terlalu_besar"
  | "kunci_kosong"
  | "skema_gagal"
  | "bentuk_order_id"
  | "tanda_tangan_salah"
  | "duplikat"
  | "tanpa_efek"
  | "diterapkan"
  | "pesanan_tidak_ada"
  | "galat";

export const KODE_JAWABAN: Record<HasilWebhook, number> = {
  badan_terlalu_besar: 400,
  kunci_kosong: 503,
  skema_gagal: 400,
  bentuk_order_id: 400,
  tanda_tangan_salah: 401,
  duplikat: 200,
  tanpa_efek: 200,
  diterapkan: 200,
  pesanan_tidak_ada: 200,
  galat: 500,
};

/** Himpunan TERTUTUP yang boleh dipulangkan `terapkan_notifikasi_midtrans`. */
const HASIL_RPC = new Set<string>(["diterapkan", "duplikat", "tanpa_efek", "pesanan_tidak_ada"]);

/**
 * Nilai balik RPC yang tidak dikenal harus menjadi 500, bukan diam-diam 200.
 * Tanpa penjaga ini, satu nilai enum baru di SQL yang lupa dipetakan akan
 * terbaca sebagai `KODE_JAWABAN[undefined]` — yaitu `undefined` — dan
 * `NextResponse.json(..., { status: undefined })` menjawab 200. Pesanan yang
 * gagal diproses akan dilaporkan "selesai" ke Midtrans.
 */
export function hasilRpcSah(nilai: string): nilai is HasilWebhook {
  return HASIL_RPC.has(nilai);
}
