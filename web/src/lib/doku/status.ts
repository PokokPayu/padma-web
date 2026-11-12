/**
 * HIMPUNAN STATUS DOKU, dikelompokkan menurut akibatnya pada pesanan.
 *
 * Status DOKU dibandingkan sebagai HIMPUNAN BERNAMA, bukan string tunggal yang
 * tersebar di rute. Alasannya: satu status baru yang lupa dimasukkan ke cabang
 * yang benar akan jatuh diam-diam ke cabang lain. Dengan himpunan bernama,
 * `includes` pada satu tempat menentukan nasibnya.
 *
 * Murni TypeScript tanpa impor. Daftar SQL di migrasi harus memuat nilai yang
 * sama persis; sumber kebenaran tunggalnya tetap berkas ini.
 */

/** Pembayaran berhasil: pesanan menjadi lunas. */
export const STATUS_DOKU_LUNAS = ["SUCCESS"] as const;

/** Belum ada keputusan final dari DOKU. */
export const STATUS_DOKU_MENUNGGU = ["PENDING", "REDIRECT", "TIMEOUT", "FAILED"] as const;

/** Tagihan lewat masa berlaku. */
export const STATUS_DOKU_KEDALUWARSA = ["EXPIRED"] as const;

/** Dana dikembalikan, seluruhnya atau sebagian. */
export const STATUS_DOKU_REFUND = ["REFUNDED", "PARTIAL_REFUNDED"] as const;

/** Transaksi dibatalkan (void) oleh DOKU. */
export const STATUS_DOKU_ASING_DIKENAL = ["VOIDED"] as const;

/**
 * SINTETIS: bukan status dari DOKU. Hanya lahir dari Check Status ketika
 * DOKU memulangkan 404 untuk invoice yang diperiksa, dan nilainya tidak boleh
 * tertukar dengan status asli DOKU mana pun.
 */
export const STATUS_TIDAK_DITEMUKAN = "TIDAK_DITEMUKAN" as const;
