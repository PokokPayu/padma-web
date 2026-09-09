/**
 * Aturan berkas sertifikat — MURNI, tanpa jaringan dan tanpa basis data.
 *
 * Berdiri sendiri supaya aturan yang sama dipakai DUA sisi: komponen klien
 * memakainya untuk menolak berkas sebelum satu byte pun terkirim, dan server
 * action memakainya lagi sebelum menerbitkan URL unggah. Pemeriksaan di
 * peramban adalah kenyamanan; yang mengikat adalah pemeriksaan server, dan
 * keduanya hanya bisa sepakat kalau sumbernya satu.
 */
export const MIME_SERTIFIKAT = [
  "application/pdf",
  "image/jpeg",
  "image/webp",
] as const;

/** 5 MB — sama dengan `file_size_limit` bucket `sertifikat`. */
export const MAKS_BYTE_SERTIFIKAT = 5_242_880;

export function periksaBerkasSertifikat(
  nama: string,
  ukuran: number,
  mime: string,
): { ok: true } | { ok: false; pesan: string } {
  if (!(MIME_SERTIFIKAT as readonly string[]).includes(mime)) {
    return { ok: false, pesan: "Sertifikat harus PDF, JPEG, atau WEBP." };
  }
  if (ukuran <= 0) return { ok: false, pesan: `Berkas ${nama} kosong.` };
  if (ukuran > MAKS_BYTE_SERTIFIKAT) {
    return { ok: false, pesan: "Berkas maksimal 5 MB." };
  }
  return { ok: true };
}

/**
 * Path objek. Ditentukan SERVER — lihat komentar kolom `objek` di migrasi.
 *
 * Berakhiran tetap per MIME, bukan ekstensi dari nama berkas kiriman: nama
 * berkas datang dari peramban, dan "sertifikat.pdf.exe" adalah nama yang sah
 * menurut peramban.
 */
export function namaObjekSertifikat(
  clientId: string,
  sessionId: string,
  mime: string,
): string {
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/webp" ? "webp" : "jpg";
  return `${clientId}/${sessionId}.${ext}`;
}
