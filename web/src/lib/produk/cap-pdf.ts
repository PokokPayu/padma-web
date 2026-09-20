import "server-only";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * Nama & email pembeli diketik manusia, jadi keduanya data tak tepercaya di
 * konteks dokumen yang akan dibakar.
 *
 * Karakter kontrol C0 mentah, KECUALI tab/LF/CR, DIBUANG — bukan di-escape.
 * Tidak ada bentuk escaped yang sah bagi mereka, dan satu nama yang memuat
 * salah satunya membuat pencapan throw untuk SETIAP unduhan pembeli itu,
 * permanen, tanpa satu pun jejak di layar yang menunjuk penyebabnya (nama
 * pembeli). Alasan yang sama persis sudah ditulis panjang di
 * `lib/materi/watermark.ts`.
 */
export function bersihkanNamaCap(teks: string): string {
  let hasil = "";
  for (const huruf of teks) {
    const kode = huruf.codePointAt(0)!;
    const kontrolTerlarang = kode < 0x20 && kode !== 0x09 && kode !== 0x0a && kode !== 0x0d;
    if (!kontrolTerlarang && kode !== 0x7f) hasil += huruf;
  }
  return hasil;
}

/**
 * Satu berkas tercap per pembeli, bukan satu per unduhan.
 *
 * Mencap PDF tebal setiap kali tombol diklik adalah kerja CPU yang berulang
 * tanpa guna; menyimpannya membuat unduhan kedua dan seterusnya hanya
 * berbiaya satu tanda tangan.
 */
export function objekPdfPembeli(productId: string, clientId: string): string {
  return `${productId}/pembeli/${clientId}.pdf`;
}

/**
 * Membakar identitas pembeli KE DALAM setiap halaman PDF.
 *
 * Dibakar, bukan dilapiskan: lapisan CSS hilang begitu berkasnya disimpan,
 * dan kebocoran yang tidak menunjuk sumbernya sama saja dengan tidak ada
 * proteksi sama sekali.
 */
export async function capPdfPembeli(
  pdf: Uint8Array,
  nama: string,
  email: string,
): Promise<Uint8Array> {
  const dok = await PDFDocument.load(pdf);
  const font = await dok.embedFont(StandardFonts.Helvetica);
  const teks = `${bersihkanNamaCap(nama)} - ${bersihkanNamaCap(email)} - PADMA`;

  for (const halaman of dok.getPages()) {
    const { width, height } = halaman.getSize();
    halaman.drawText(teks, {
      x: width * 0.1,
      y: height * 0.35,
      size: 16,
      font,
      color: rgb(0.42, 0.47, 0.44),
      opacity: 0.18,
      rotate: degrees(30),
    });
  }
  return dok.save();
}
