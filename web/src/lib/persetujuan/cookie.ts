import { VERSI_DOKUMEN } from "./versi";

/**
 * Cookie penitip persetujuan dari `/daftar` ke `/setelah-masuk`.
 *
 * Aman dipakai komponen klien: berkas ini tidak mengimpor apa pun dari sisi
 * server. Pembacanya (`catatPersetujuanDariCookie`) tinggal di `catat.ts`.
 *
 * Umur SATU HARI, bukan satu jam seperti `padma_lanjut`: tautan konfirmasi
 * email bisa dibuka berjam-jam kemudian. Bila ia dibuka di perangkat lain,
 * cookie ini tidak ikut — dan gerbang `/persetujuan` yang menangkapnya.
 */
export const COOKIE_SETUJU = "padma_setuju";
export const UMUR_COOKIE_SETUJU_DETIK = 86_400;

/** Dipanggil di peramban tepat sebelum `signUp` / `signInWithOAuth`. */
export function titipPersetujuanDiPeramban(): void {
  document.cookie = `${COOKIE_SETUJU}=${VERSI_DOKUMEN}; Path=/; Max-Age=${UMUR_COOKIE_SETUJU_DETIK}; SameSite=Lax`;
}
