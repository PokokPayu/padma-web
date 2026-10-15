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
 *
 * Sejak spec 2026-10-16 ada pola KEDUA yang sama sempitnya: penampil materi
 * `/passport/produk/<slug>/<uuid>`, untuk pengunjung yang menekan "Lihat" pada
 * materi pratinjau sebelum login.
 */
export const COOKIE_LANJUT = "padma_lanjut";

const POLA_TUJUAN_PRODUK = /^\/produk\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POLA_TUJUAN_MATERI =
  /^\/passport\/produk\/[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function tujuanProdukAman(nilai: string | null | undefined): string | null {
  // 200: slug terpanjang (judul 120 karakter) + awalan + uuid masih muat;
  // apa pun yang lebih panjang bukan path yang pernah kita tulis.
  if (typeof nilai !== "string" || nilai.length > 200) return null;
  return POLA_TUJUAN_PRODUK.test(nilai) || POLA_TUJUAN_MATERI.test(nilai) ? nilai : null;
}

/** Dipanggil di peramban tepat sebelum `router.push("/masuk")`. */
export function titipTujuanDiPeramban(path: string): void {
  if (tujuanProdukAman(path) === null) return;
  document.cookie = `${COOKIE_LANJUT}=${path}; Path=/; Max-Age=3600; SameSite=Lax`;
}
