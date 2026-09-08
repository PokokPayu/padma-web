import {
  jenjangPembatalan,
  akibatPembatalan,
  LABEL_JENJANG_PEMBATALAN,
  KALIMAT_AKIBAT,
} from "@/lib/pembatalan/jenjang";

/**
 * Apa yang admin lihat SEBELUM menekan (spec C3 P1).
 *
 * Murni, dan itu disengaja: ia dipanggil saat render di server maupun di
 * komponen klien, dan tidak boleh menyentuh basis data di kedua tempat. Yang
 * MEMUTUSKAN tetap fungsi Postgres — ini hanya menerangkan.
 */
export function ringkasanPembatalan(
  tanggal: string,
  jamMulai: string,
  sekarang: Date = new Date(),
): { jenjang: 1 | 2 | 3; label: string; kalimat: string } {
  const jenjang = jenjangPembatalan(tanggal, jamMulai, sekarang);
  return {
    jenjang,
    label: LABEL_JENJANG_PEMBATALAN[jenjang],
    kalimat: KALIMAT_AKIBAT[akibatPembatalan(jenjang)],
  };
}
