/**
 * Peta hasil webhook -> kode HTTP (tabel yang sama dengan P1).
 *
 *   4xx = badan yang TIDAK AKAN PERNAH berubah; mengulanginya percuma.
 *   200 = tidak ada lagi yang tersisa untuk disembuhkan.
 *   503 = salah KITA, sementara (kunci belum terpasang).
 *   500 = galat basis data; satu-satunya kelas yang retry benar-benar menyembuhkan.
 *
 * CATATAN PENTING: DOKU hanya mengirim ulang TIGA kali (+30 menit, +6 jam,
 * +12 jam) [spec §4.2, S17] — bukan berulang tanpa henti seperti Midtrans.
 * 503 dan 500 tetap "keterlambatan", tetapi jendelanya sempit; Lapis 1b
 * (Check Status berkala) dan Lapis 3 adalah penyelamat yang sesungguhnya.
 *
 * `kunci_kosong` yang paling mudah salah: 2xx/4xx memberi tahu DOKU "sudah
 * selesai" dan notifikasinya tidak datang lagi; 503 membuat env yang lupa
 * dipasang berakhir sebagai keterlambatan, bukan uang yang hilang.
 *
 * `pesanan_tidak_ada`: tanda tangan sah tetapi invoice tidak menunjuk pesanan
 * mana pun (mis. basis data di-reset). Kelas 200: tak ada yang bisa
 * disembuhkan dengan mengulang; yang wajib adalah penghitung `tak_dikenal`.
 */
export type HasilWebhook =
  | "badan_terlalu_besar"
  | "kunci_kosong"
  | "skema_gagal"
  | "bentuk_invoice"
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
  bentuk_invoice: 400,
  tanda_tangan_salah: 401,
  duplikat: 200,
  tanpa_efek: 200,
  diterapkan: 200,
  pesanan_tidak_ada: 200,
  galat: 500,
};

/** Himpunan TERTUTUP yang boleh dipulangkan `terapkan_notifikasi_gateway`. */
const HASIL_RPC = new Set<string>(["diterapkan", "duplikat", "tanpa_efek", "pesanan_tidak_ada"]);

/**
 * Nilai balik RPC yang tidak dikenal harus menjadi 500, bukan diam-diam 200.
 * Tanpa penjaga ini, satu nilai enum baru di SQL yang lupa dipetakan akan
 * terbaca sebagai `KODE_JAWABAN[undefined]` — yaitu `undefined` — dan
 * `NextResponse.json(..., { status: undefined })` menjawab 200. Pesanan yang
 * gagal diproses akan dilaporkan "selesai" ke DOKU.
 */
export function hasilRpcSah(nilai: string): nilai is HasilWebhook {
  return HASIL_RPC.has(nilai);
}
