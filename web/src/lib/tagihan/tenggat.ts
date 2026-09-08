/**
 * TENGGAT BAYAR (spec C2 P5, P6).
 *
 * Fungsi murni, tanpa impor: dipakai server action, halaman server, komponen
 * `"use client"` (kartu tagihan yang menghitung sisa waktu), dan diuji tanpa
 * basis data.
 */

/** 24 jam sejak tagihan terbit. Keputusan pemilik repo 8 September 2026. */
export const JAM_TENGGAT_BAYAR = 24;

/**
 * Sisa waktu dalam JAM. Negatif berarti sudah lewat.
 *
 * Pecahan dipulangkan apa adanya — pembulatan di sini akan menggeser batas
 * yang menentukan apakah pengajuan seseorang dibatalkan, dan pembulatan adalah
 * urusan lapisan tampilan.
 */
export function sisaJam(tenggat: string, sekarang: Date = new Date()): number {
  return (Date.parse(tenggat) - sekarang.getTime()) / 3_600_000;
}

/**
 * Sudah lewat tenggat?
 *
 * Dipakai DUA lapis (spec C2 P6): pembatal terjadwal, DAN evaluasi saat dibaca.
 * Lapis kedua bukan kemewahan — cron yang mati membuat tenggat berhenti
 * berlaku tanpa satu pun galat, dan bentuk kegagalannya adalah bidan yang
 * tertahan pada pemesanan yang seharusnya sudah bebas.
 *
 * `tenggat` NULL berarti tagihannya belum terbit, dan yang belum terbit tidak
 * bisa lewat tenggat.
 */
export function sudahLewatTenggat(
  tenggat: string | null | undefined,
  sekarang: Date = new Date(),
): boolean {
  if (!tenggat) return false;
  return sisaJam(tenggat, sekarang) <= 0;
}

/** "5 jam lagi" / "20 menit lagi" / "sudah lewat" — untuk dibaca klien. */
export function labelSisaWaktu(tenggat: string | null, sekarang: Date = new Date()): string {
  if (!tenggat) return "";
  const jam = sisaJam(tenggat, sekarang);
  if (jam <= 0) return "sudah lewat";
  if (jam < 1) return `${Math.max(1, Math.round(jam * 60))} menit lagi`;
  return `${Math.floor(jam)} jam lagi`;
}
