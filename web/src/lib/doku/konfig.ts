import { basisUrlSitus } from "@/lib/basis-url";

/**
 * Pemilihan lingkungan dan alamat DOKU — satu tempat, dan hanya satu.
 *
 * SENGAJA bukan `NODE_ENV`: pratinjau Vercel berjalan dengan
 * `NODE_ENV=production` dan akan menembak DOKU PRODUKSI, yaitu uang sungguhan
 * dari lingkungan yang dibuat untuk coba-coba. Yang memilih adalah env
 * terpisah, dan HANYA nilai `"true"` persis — bukan `"1"`, bukan `"TRUE"`.
 * Env yang salah ketik harus jatuh ke sandbox.
 *
 * TANPA `server-only`: modul ini murni dan tidak menyentuh rahasia selain
 * lewat fungsi `secretKeyDoku()`, yang hanya boleh dipanggil dari server.
 */

/** Rute webhook kita; juga nilai `Request-Target` yang ditandatangani DOKU. */
export const PATH_WEBHOOK_DOKU = "/api/pembayaran/doku";

/** Buat tautan pembayaran (Checkout non-SNAP). */
export const PATH_BUAT_PEMBAYARAN = "/checkout/v1/payment";

/** `true` hanya untuk nilai `"true"` persis. Apa pun selain itu = sandbox. */
export function dokuProduksi(): boolean {
  return process.env.DOKU_PRODUKSI === "true";
}

/**
 * `""` bila tidak terpasang — penelepon yang memutuskan artinya. Webhook
 * memutuskan 503; adapter menolak menerbitkan tautan.
 */
export function clientIdDoku(): string {
  return process.env.DOKU_CLIENT_ID ?? "";
}

/** `""` bila tidak terpasang; lihat `clientIdDoku`. */
export function secretKeyDoku(): string {
  return process.env.DOKU_SECRET_KEY ?? "";
}

export function basisApiDoku(): string {
  return dokuProduksi() ? "https://api.doku.com" : "https://api-sandbox.doku.com";
}

/** Path Check Status; invoice di-encode supaya tidak bisa menyisipkan segmen. */
export function pathStatusDoku(invoice: string): string {
  return `/orders/v1/status/${encodeURIComponent(invoice)}`;
}

/**
 * URL absolut tujuan kembali pembeli. `null` bila `NEXT_PUBLIC_BASIS_URL`
 * kosong ATAU salah bentuk (lihat `basisUrlSitus()`): penelepon yang
 * memutuskan, bukan menebak host. Basisnya sudah berupa origin tanpa garis
 * miring akhir, jadi `//passport/...` tidak mungkin lahir.
 */
export function urlKembali(path: string): string | null {
  const basis = basisUrlSitus();
  return basis === null ? null : `${basis}${path}`;
}
