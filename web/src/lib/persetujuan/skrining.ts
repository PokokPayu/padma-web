import { VERSI_DOKUMEN } from "./versi";

/**
 * Dua kolom persetujuan untuk SETIAP insert `screenings`.
 *
 * Spec 2026-10-06, revisi 1: tidak ada trigger. Yang menegakkan aturan untuk
 * baris baru adalah (a) `SkemaSkriningPublik` yang mewajibkan
 * `setuju_privasi: true`, (b) fungsi ini — dipakai KEDUA rute skrining — dan
 * (c) `tests/skrining-persetujuan.test.ts` yang menuntut setiap
 * insert ke tabel `screenings` di `src/` memanggilnya. (Pola harfiahnya sengaja
 * tidak ditulis di sini — uji itu memindai komentar juga.)
 */
export function capPersetujuanSkrining(sekarang: Date = new Date()): {
  persetujuan_versi: string;
  persetujuan_pada: string;
} {
  return { persetujuan_versi: VERSI_DOKUMEN, persetujuan_pada: sekarang.toISOString() };
}
