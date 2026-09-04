import { capWaktuDariKunci, epochDariCapWaktu } from "./nama-objek";

/** Spec B2. Naik-turunkan di sini, bukan tersebar di workflow. */
export const HARI_SIMPAN = 30;

const MS_PER_HARI = 24 * 60 * 60 * 1000;

/**
 * Memilih objek yang boleh dihapus.
 *
 * Ketidakpastian pada KUNCI berujung MEMPERTAHANKAN: kunci tak terbaca, cap
 * waktu mustahil, `sekarangEpochMs`/`hariSimpan` tidak masuk akal (NaN,
 * infinity, <= 0) — semuanya menghasilkan "jangan hapus".
 *
 * Untuk jam skew, fungsi ini HANYA menjaga arah MUNDUR: objek bercap waktu
 * di masa depan relatif `sekarangEpochMs` ditahan (guard `ms > sekarangEpochMs`
 * di bawah). Skew MAJU — jam mesin yang melompat ke depan — TIDAK dijaga di
 * sini: itu mendorong `batas` melewati seluruh cap waktu tersimpan, dan
 * fungsi murni ini akan memilih SEMUANYA untuk dihapus, karena `sekarang` dan
 * `batas` dipercaya apa adanya. Pagar untuk kasus itu ada satu lapis di atas
 * pemanggil, di `unggah.ts` (`MAKS_HAPUS_PER_JALAN`), yang menolak menghapus
 * bila jumlah objek yang terpilih tidak masuk akal untuk satu jalan normal.
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
