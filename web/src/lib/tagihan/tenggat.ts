/**
 * TENGGAT BAYAR (spec C2 P5).
 *
 * Fungsi murni, tanpa impor: dipakai server action, halaman server, komponen
 * `"use client"` (kartu tagihan yang menghitung sisa waktu), dan diuji tanpa
 * basis data.
 */

// `JAM_TENGGAT_BAYAR` (24 jam, keputusan pemilik repo 8 September 2026)
// DISATUKAN dengan `JAM_TENGGAT_PESANAN` (`@/lib/pesanan/status`) di P3/B2:
// tagihan sesi kini pesanan, dan tenggatnya dipasang `terbitkan_tagihan_sesi`
// di SQL. Dua konstanta bernilai sama untuk satu tenggat adalah dua tempat
// yang suatu hari berselisih.

/**
 * Sisa waktu dalam JAM. Negatif berarti sudah lewat.
 *
 * Pecahan dipulangkan apa adanya — pembulatan di sini akan menggeser batas
 * yang menentukan apakah sebuah tagihan masih berlaku, dan pembulatan adalah
 * urusan lapisan tampilan.
 */
export function sisaJam(tenggat: string, sekarang: Date = new Date()): number {
  return (Date.parse(tenggat) - sekarang.getTime()) / 3_600_000;
}

/** "5 jam lagi" / "20 menit lagi" / "sudah lewat" — untuk dibaca klien. */
export function labelSisaWaktu(tenggat: string | null, sekarang: Date = new Date()): string {
  if (!tenggat) return "";
  const jam = sisaJam(tenggat, sekarang);
  if (jam <= 0) return "sudah lewat";
  if (jam < 1) return `${Math.max(1, Math.round(jam * 60))} menit lagi`;
  return `${Math.floor(jam)} jam lagi`;
}
