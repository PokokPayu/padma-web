import { capWaktuDariKunci, epochDariCapWaktu } from "./nama-objek";

/** Spec B2. Naik-turunkan di sini, bukan tersebar di workflow. */
export const HARI_SIMPAN = 30;

const MS_PER_HARI = 24 * 60 * 60 * 1000;

/**
 * Memilih objek yang boleh dihapus.
 *
 * SELURUH ketidakpastian berujung MEMPERTAHANKAN. Kunci tak terbaca, cap waktu
 * mustahil, jam kacau, konfigurasi aneh — semuanya menghasilkan "jangan hapus".
 * Kelebihan objek di R2 berbiaya beberapa megabyte; menghapus salinan sehat
 * terakhir tidak bisa dibatalkan.
 */
export function pilihObjekKedaluwarsa(
  kunci: readonly string[],
  sekarangEpochMs: number,
  hariSimpan: number = HARI_SIMPAN,
): string[] {
  if (!Number.isFinite(sekarangEpochMs)) return [];
  if (!Number.isFinite(hariSimpan) || hariSimpan <= 0) return [];

  const batas = sekarangEpochMs - hariSimpan * MS_PER_HARI;

  return kunci.filter((k) => {
    const cap = capWaktuDariKunci(k);
    if (cap === null) return false;
    const ms = epochDariCapWaktu(cap);
    if (ms === null) return false;
    if (ms > sekarangEpochMs) return false;
    return ms < batas;
  });
}
