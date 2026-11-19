/**
 * SATU-SATUNYA pembaca `NEXT_PUBLIC_BASIS_URL` (dikunci tests/basis-url.test.ts).
 *
 * Memulangkan ORIGIN situs (`https://padmawellnessid.com`, tanpa garis miring
 * akhir), atau `null` bila nilainya kosong ATAU salah bentuk. Ketiga pemakai
 * (URL kembali DOKU, tautan bayar di email tagihan, dan tautan Passport di
 * pesan WhatsApp admin) sudah menangani `null` sebagai "belum terpasang" dan
 * gagal tertutup dengan kalimat yang jelas.
 *
 * Kenapa bentuk diperiksa, bukan sekadar isi: 17 Nov 2026 proyek Vercel dev
 * memuat `padma-web-16ot.vercel.app` tanpa `https://`. Pembaca lama
 * meloloskannya, dan URL kembali DOKU menjadi path relatif: pembeli tidak
 * pulang ke aplikasi sesudah membayar. Yang diterima:
 *   - origin `https://`, tanpa path, query, atau fragmen;
 *   - `http://localhost` dan `http://127.0.0.1` untuk pengembangan lokal
 *     (nilai `.env.example`).
 */
const HOST_LOKAL = new Set(["localhost", "127.0.0.1"]);

export function basisUrlSitus(): string | null {
  const mentah = (process.env.NEXT_PUBLIC_BASIS_URL ?? "").trim().replace(/\/+$/, "");
  if (mentah === "") return null;
  let u: URL;
  try {
    u = new URL(mentah);
  } catch {
    return null;
  }
  const skemaSah = u.protocol === "https:" || (u.protocol === "http:" && HOST_LOKAL.has(u.hostname));
  if (!skemaSah) return null;
  if (u.pathname !== "/" || u.search !== "" || u.hash !== "") return null;
  return u.origin;
}
