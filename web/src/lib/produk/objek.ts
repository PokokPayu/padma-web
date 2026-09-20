import { ekstensiDariMime, type MimeVideo } from "@/lib/materi/video";

/**
 * Nama objek produk. Fungsi MURNI tanpa impor server-only — dipakai server
 * action (service role) maupun rute penyaji, dan diuji tanpa storage.
 *
 * Seluruhnya berbasis ID PRODUK, tidak pernah nama berkas kiriman: nama
 * berkas datang dari peramban dan bisa memuat `../` atau nama produk lain.
 * Id produk sudah unik, sudah dimiliki satu baris, dan tidak bisa dikarang —
 * path traversal karena itu tidak punya pintu masuk sama sekali. Alasan yang
 * sama persis sudah ditulis di `lib/bukti/kunci.ts`.
 *
 * Video menumpang bucket R2 yang SAMA dengan materi, dibedakan prefiks
 * `produk/`. Satu bucket, dua prefiks: kredensial, CORS, dan rotasi kunci
 * tidak perlu digandakan, sementara objeknya tetap tidak bisa tertukar.
 */
export function namaObjekVideoProduk(productId: string, mime: MimeVideo): string {
  const ext = ekstensiDariMime(mime);
  if (!ext) throw new Error(`MIME video tidak dikenal: ${mime}`);
  return `produk/${productId}/isi.${ext}`;
}

/** Bucket `produk-halaman` sudah memisahkan ruangnya, jadi tanpa prefiks lagi. */
export function namaObjekHalamanProduk(productId: string, halaman: number): string {
  return `${productId}/${halaman}.webp`;
}

/** Bucket `produk-berkas`: PDF utuh, sumber unduhan. */
export function namaObjekPdfProduk(productId: string): string {
  return `${productId}/isi.pdf`;
}
