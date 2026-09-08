import {
  jenjangPembatalan,
  akibatPembatalan,
  LABEL_JENJANG_PEMBATALAN,
  KALIMAT_AKIBAT,
  type AktorPembatalan,
  type Jenjang,
} from "@/lib/pembatalan/jenjang";

/**
 * Apa yang admin lihat SEBELUM menekan (spec C3 P1).
 *
 * Murni, dan itu disengaja: ia dipanggil saat render di server maupun di
 * komponen klien, dan tidak boleh menyentuh basis data di kedua tempat. Yang
 * MEMUTUSKAN tetap fungsi Postgres — ini hanya menerangkan.
 *
 * `pilihan.oleh` WAJIB, tanpa nilai bawaan. Jenjang sebuah pembatalan bukan
 * pertanyaan waktu saja: PADMA yang membatalkan SELALU jenjang 4, berapa pun
 * sisa waktunya. Ringkasan yang tidak tahu aktornya adalah ringkasan yang
 * menjanjikan akibat yang salah kepada admin, dan admin meneruskan janji itu
 * ke klien lewat telepon sebelum satu baris pun berubah.
 *
 * Ketiga cabang di bawah menyalin PERSIS urutan keputusan di `batalkan_sesi()`
 * (migrasi `20260913102000_rpc_pembatalan.sql`): aktor dulu, lalu darurat,
 * baru waktu.
 */
export function ringkasanPembatalan(
  tanggal: string,
  jamMulai: string,
  pilihan: { oleh: AktorPembatalan; darurat?: boolean },
  sekarang: Date = new Date(),
): { jenjang: Jenjang; label: string; kalimat: string } {
  const jenjang: Jenjang =
    pilihan.oleh === "padma" ? 4 : pilihan.darurat ? 1 : jenjangPembatalan(tanggal, jamMulai, sekarang);
  return {
    jenjang,
    label: LABEL_JENJANG_PEMBATALAN[jenjang],
    kalimat: KALIMAT_AKIBAT[akibatPembatalan(jenjang)],
  };
}
