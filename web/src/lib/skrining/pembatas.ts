/**
 * Rate limit rute PUBLIK `POST /api/skrining`.
 *
 * Kenapa berkas sendiri: temuan red team menunjukkan limiter versi pertama
 * memakai `request.headers.get("x-forwarded-for")` (nilai PALING KIRI) sebagai
 * kunci. Header itu sepenuhnya dikendalikan klien — cukup memutar nilainya dan
 * batas 5/60 detik hilang sama sekali (bukti: 12 permintaan -> 12x 201, 0x 429).
 * Karena baris skrining ditulis dengan SERVICE ROLE, bypass ini berarti tulis
 * tak-terautentikasi tanpa batas ke tabel data kesehatan.
 *
 * Dua koreksi:
 *
 *  1. HOP TERLUAR, BUKAN HOP PERTAMA. Klien hanya bisa MENAMBAH entri di kiri
 *     `X-Forwarded-For`; proxy tepercaya kita menambahkan alamat asli di kanan
 *     dan tidak bisa dihapus klien. Jadi kunci diambil dari kanan, sebanyak
 *     `PADMA_PROXY_TEPERCAYA` hop. Nilai 0 berarti "tidak ada proxy tepercaya":
 *     header diabaikan TOTAL, karena tidak ada satu pun entri yang layak
 *     dipercaya (lebih baik satu ember bersama daripada bypass gratis).
 *
 *  2. PAGAR GLOBAL LINTAS-KUNCI. Bahkan dengan hop yang benar, penyerang bisa
 *     punya banyak IP nyata — dan konfigurasi proxy bisa salah. Batas global
 *     per jendela memberi langit-langit yang tidak bergantung pada satu pun
 *     header kiriman klien.
 *
 * Catatan yang masih berlaku: Map ini per-proses. Di serverless multi-instance
 * ia hanya menahan penyalahgunaan kasual per instance; langkah berikutnya
 * adalah pembatas terpusat (tabel Postgres / Upstash). Pagar CHECK di DB dan
 * batas ukuran body di route sengaja dibuat agar tetap fail-closed tanpa itu.
 */

export const JENDELA_MS = 60_000;
export const MAKS_PER_JENDELA = 5;
/** Langit-langit lintas-IP: menahan penyerang yang memutar IP/XFF. */
export const MAKS_GLOBAL_PER_JENDELA = 30;

/** Kunci cadangan ketika tidak ada hop yang layak dipercaya. */
export const KUNCI_TANPA_HOP = "tanpa-hop-tepercaya";

const JEJAK = new Map<string, number[]>();
let JEJAK_GLOBAL: number[] = [];

/** Jumlah proxy tepercaya di depan aplikasi. Default 1 (Vercel/Nginx di depan). */
function proxyTepercaya(): number {
  const mentah = process.env.PADMA_PROXY_TEPERCAYA;
  if (mentah === undefined || mentah.trim() === "") return 1;
  const angka = Number.parseInt(mentah, 10);
  return Number.isFinite(angka) && angka > 0 ? angka : 0;
}

/**
 * Kunci rate limit yang TIDAK bisa dipilih penyerang.
 * Mengembalikan string non-kosong dalam segala keadaan.
 */
export function kunciPembatas(request: Request): string {
  const jumlahProxy = proxyTepercaya();
  if (jumlahProxy <= 0) return KUNCI_TANPA_HOP;

  const hop = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((bagian) => bagian.trim())
    .filter(Boolean);
  if (hop.length === 0) return KUNCI_TANPA_HOP;

  // Ambil hop yang ditulis proxy terdalam yang masih kita percayai.
  const indeks = Math.max(0, hop.length - jumlahProxy);
  return hop[indeks] || KUNCI_TANPA_HOP;
}

function saring(riwayat: number[], sekarang: number): number[] {
  return riwayat.filter((t) => sekarang - t < JENDELA_MS);
}

/** true = permintaan harus ditolak (429). Mencatat percobaan pada kedua lapis. */
export function terlaluSering(kunci: string): boolean {
  const sekarang = Date.now();

  const riwayat = saring(JEJAK.get(kunci) ?? [], sekarang);
  riwayat.push(sekarang);
  JEJAK.set(kunci, riwayat);

  JEJAK_GLOBAL = saring(JEJAK_GLOBAL, sekarang);
  JEJAK_GLOBAL.push(sekarang);

  return riwayat.length > MAKS_PER_JENDELA || JEJAK_GLOBAL.length > MAKS_GLOBAL_PER_JENDELA;
}

/** Hanya untuk test — mengosongkan kedua lapis jejak. */
export function resetPembatas(): void {
  JEJAK.clear();
  JEJAK_GLOBAL = [];
}
