/**
 * Tujuan redirect sesudah pertukaran kode di `/auth/callback` (spec 8 Sep
 * 2026, keputusan K6) — fungsi MURNI, tanpa I/O, supaya diuji langsung tanpa
 * memutar server.
 *
 * DAFTAR PUTIH, bukan daftar hitam. Parameter tujuan yang diterima mentah
 * dari query string adalah open redirect: penyerang mengirim tautan
 * `resetPasswordForEmail` yang SAH ke korban, korban membukanya, GoTrue
 * menukar kodenya jadi sesi seperti biasa — tetapi lompatan terakhirnya
 * diarahkan ke situs tiruan penyerang yang tinggal menampilkan formulir
 * "atur sandi baru" palsu. Sesi itu tetap punya sesi asli PADMA di cookie;
 * yang dicuri hanya sandi barunya, langsung dari tangan korban.
 *
 * Memfilter "yang berbahaya" tidak pernah cukup: setiap penulis daftar hitam
 * lupa satu bentuk. `//jahat.com` bukan path, ia protocol-relative URL yang
 * dibaca peramban sebagai host baru. `/\jahat.com` lolos pemeriksaan
 * `startsWith("//")` tetapi sebagian peramban tetap memperlakukan `\` seperti
 * `/` di awal URL. `http:/\jahat.com` adalah varian ejaan skema yang sama.
 * `https://padma.test.jahat.com` lolos pemeriksaan `includes("padma")`
 * karena subdomain sungguhan boleh mengandung apa saja. Daftar PUTIH tidak
 * bisa ketinggalan satu pun bentuk itu — apa pun yang bukan string yang
 * disebut literal di sini otomatis jatuh ke tujuan baku, termasuk rute
 * internal yang sah tapi belum didaftarkan (dan rute yang belum lahir saat
 * berkas ini ditulis).
 */
const DIIZINKAN = new Set(["/atur-sandi", "/setelah-masuk"]);

export const TUJUAN_BAKU = "/setelah-masuk";

export function tujuanAman(next: string | null): string {
  return next !== null && DIIZINKAN.has(next) ? next : TUJUAN_BAKU;
}
