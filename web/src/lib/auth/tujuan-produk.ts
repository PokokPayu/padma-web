/**
 * "Kembali ke produk sesudah login" (spec P2) — dititipkan di cookie, bukan di
 * parameter URL, karena pola yang sama sudah selamat melewati ketiga jalur
 * masuk repo ini: email+sandi, Google (`/auth/callback` → `/setelah-masuk`),
 * dan pendaftaran + konfirmasi email (lihat `COOKIE_KLAIM`,
 * `lib/skrining/klaim.ts`).
 *
 * `tujuanAman()` (`./tujuan-aman.ts`) TIDAK dipakai: ia daftar izin path
 * persis, dan path ber-slug tidak bisa didaftar. Yang ini sengaja lebih sempit
 * lagi — hanya `/produk/<slug>`. Cookie ini ditulis peramban, jadi isinya
 * dianggap masukan musuh sampai lolos fungsi di bawah.
 */
export const COOKIE_LANJUT = "padma_lanjut";

const POLA_TUJUAN_PRODUK = /^\/produk\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function tujuanProdukAman(nilai: string | null | undefined): string | null {
  if (typeof nilai !== "string" || nilai.length > 120) return null;
  return POLA_TUJUAN_PRODUK.test(nilai) ? nilai : null;
}

/** Dipanggil di peramban tepat sebelum `router.push("/masuk")`. */
export function titipTujuanDiPeramban(path: string): void {
  if (tujuanProdukAman(path) === null) return;
  document.cookie = `${COOKIE_LANJUT}=${path}; Path=/; Max-Age=3600; SameSite=Lax`;
}
