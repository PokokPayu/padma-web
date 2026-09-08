/**
 * KUNCI OBJEK BUKTI BAYAR (spec C2 P3).
 *
 * Fungsi murni tanpa impor — dipakai rute unggah (service role) dan rute baca
 * (staf), dan diuji tanpa storage.
 */

/** Batas yang ditegakkan bucket. Ditulis di sini agar peramban bisa menolak lebih awal. */
export const MAKS_BYTE_BUKTI = 2 * 1024 * 1024;

export const JENIS_BUKTI_SAH = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Kunci objek untuk satu pengajuan.
 *
 * Berbasis id pengajuan, BUKAN nama berkas kiriman: nama berkas datang dari
 * peramban dan bisa memuat `../` atau nama orang lain. Id pengajuan sudah unik,
 * sudah dimiliki satu klien, dan tidak bisa dikarang — path traversal karena
 * itu tidak punya pintu masuk sama sekali.
 *
 * Ekstensi diturunkan dari JENIS yang sudah divalidasi, bukan dari nama berkas.
 */
export function kunciBukti(permintaanId: string, jenis: string): string {
  const ext = jenis === "image/png" ? "png" : jenis === "image/webp" ? "webp" : "jpg";
  return `${permintaanId}/bukti.${ext}`;
}

export function jenisBuktiSah(jenis: string): boolean {
  return (JENIS_BUKTI_SAH as readonly string[]).includes(jenis);
}
