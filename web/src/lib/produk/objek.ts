import { ekstensiDariMime, type MimeVideo } from "@/lib/materi/video";
import type { Periksa } from "@/lib/produk/status";

/**
 * Nama objek storage isi produk, kini PER MATERI. Semuanya ditentukan server
 * dan dibandingkan ulang saat dicatat — peramban yang memilih path adalah
 * peramban yang bisa menimpa materi lain.
 */

export function namaObjekVideoMateri(productId: string, materiId: string, mime: MimeVideo): string {
  const ext = ekstensiDariMime(mime);
  if (!ext) throw new Error(`MIME video tidak dikenal: ${mime}`);
  return `produk/${productId}/${materiId}/isi.${ext}`;
}

export function namaObjekHalamanMateri(productId: string, materiId: string, halaman: number): string {
  return `${productId}/${materiId}/${halaman}.webp`;
}

export function namaObjekPdfMateri(productId: string, materiId: string): string {
  return `${productId}/${materiId}/isi.pdf`;
}

// ===== SAMPUL =====

export const MIME_SAMPUL = ["image/jpeg", "image/png", "image/webp"] as const;
export type MimeSampul = (typeof MIME_SAMPUL)[number];
export const MAKS_BYTE_SAMPUL = 2 * 1024 * 1024;

const EKSTENSI_SAMPUL: Record<MimeSampul, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function periksaBerkasSampul(mime: string, byte: number): Periksa<MimeSampul> {
  if (!(MIME_SAMPUL as readonly string[]).includes(mime)) {
    return { ok: false, pesan: "Sampul harus JPG, PNG, atau WebP." };
  }
  if (!Number.isFinite(byte) || byte <= 0) return { ok: false, pesan: "Berkas sampul kosong." };
  if (byte > MAKS_BYTE_SAMPUL) return { ok: false, pesan: "Sampul maksimal 2 MB." };
  return { ok: true, nilai: mime as MimeSampul };
}

/**
 * Nama UNIK per unggahan (`acak` = UUID dari server). Bucket `produk-sampul`
 * publik dan di-cache CDN: menimpa nama yang sama membuat pengunjung terus
 * melihat gambar lama.
 */
export function namaObjekSampul(
  productId: string,
  materiId: string | null,
  mime: MimeSampul,
  acak: string,
): string {
  const dasar = materiId ? `${productId}/${materiId}` : productId;
  return `${dasar}/sampul-${acak}.${EKSTENSI_SAMPUL[mime]}`;
}

const POLA_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function objekSampulSah(objek: string, productId: string, materiId: string | null): boolean {
  const dasar = materiId ? `${productId}/${materiId}` : productId;
  const pola = new RegExp(`^${dasar}/sampul-${POLA_UUID}\\.(jpg|png|webp)$`);
  return pola.test(objek);
}

export function urlSampulPublik(objek: string | null): string | null {
  if (!objek) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/produk-sampul/${objek}`;
}
