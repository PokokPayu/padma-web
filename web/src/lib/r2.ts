import "server-only";
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MimeVideo } from "./materi/video";

/**
 * Umur presigned URL tonton: 2 jam (spec §7).
 *
 * Kompromi dua arahnya perlu disebut terbuka. Terlalu pendek, URL kedaluwarsa
 * di tengah tontonan dan pemutar berhenti tanpa sebab yang jelas bagi pasien,
 * terutama bila ia mem-pause lama. Terlalu panjang, URL yang tersebar bisa
 * dipakai siapa pun selama sisa umurnya.
 */
export const UMUR_TONTON_DETIK = 2 * 60 * 60;

/** Umur URL unggah: cukup untuk satu unggahan 200 MB di koneksi lambat. */
const UMUR_UNGGAH_DETIK = 60 * 60;

function wajib(nama: string): string {
  const nilai = process.env[nama];
  if (!nilai) throw new Error(`Env ${nama} belum dipasang.`);
  return nilai;
}

export function bucketVideo(): string {
  return wajib("R2_BUCKET_VIDEO");
}

function klien(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${wajib("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: wajib("R2_ACCESS_KEY_ID"),
      secretAccessKey: wajib("R2_SECRET_ACCESS_KEY"),
    },
  });
}

/**
 * Presigned PUT yang MENGIKAT path, MIME, dan ukuran.
 *
 * `signableHeaders` bukan hiasan: tanpa `content-type` di dalamnya, tanda
 * tangan hanya mengikat `host`, dan R2 menerima unggahan ber-MIME apa pun
 * dengan HTTP 200 — terbukti empiris di spike (§13b A-1). MIME itulah yang
 * kelak masuk `material_videos.mime` dan dipakai elemen <video>.
 *
 * `ContentLength` memagari ukuran PERSIS, bukan maksimum: R2 menolak badan
 * yang lebih besar MAUPUN lebih kecil. Pemeriksaan "≤ 200 MB" karena itu harus
 * dilakukan pemanggil SEBELUM memanggil fungsi ini.
 */
export async function urlUnggahVideo(
  objek: string,
  mime: MimeVideo,
  byte: number,
): Promise<string> {
  return getSignedUrl(
    klien(),
    new PutObjectCommand({
      Bucket: bucketVideo(), Key: objek, ContentType: mime, ContentLength: byte,
    }),
    { expiresIn: UMUR_UNGGAH_DETIK, signableHeaders: new Set(["content-type"]) },
  );
}

export async function urlTontonVideo(objek: string): Promise<string> {
  return getSignedUrl(
    klien(),
    new GetObjectCommand({ Bucket: bucketVideo(), Key: objek }),
    { expiresIn: UMUR_TONTON_DETIK },
  );
}

export async function hapusObjekVideo(objek: string): Promise<void> {
  await klien().send(
    new DeleteObjectCommand({ Bucket: bucketVideo(), Key: objek }),
  );
}
