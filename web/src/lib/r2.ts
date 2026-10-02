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

/**
 * NILAINYA yang dioper, bukan namanya — dan itu bukan selera.
 *
 * Bentuk sebelumnya menerima NAMA env lalu mengindeks `process.env` dengan
 * variabel itu. Akibatnya keempat env R2 TIDAK TERLIHAT oleh pagar
 * `tests/env-terdokumentasi.test.ts`, yang menuntut setiap env yang dibaca
 * `src/` punya barisnya sendiri di `.env.example` — ia hanya mengenali bentuk
 * harfiah. Keempatnya kebetulan terdokumentasi, karena seseorang menulisnya,
 * bukan karena ada yang menuntutnya.
 *
 * (Bentuk terlarang itu sengaja dieja dengan kata di sini, bukan dengan
 * lambangnya: pagar `env dibaca secara harfiah` memindai per baris tanpa
 * memisahkan komentar dari kode, dan menulis contohnya akan memerahkannya.
 * Pemindai yang sadar komentar butuh tahu soal `//`, blok, dan string —
 * kerumitan yang tidak sebanding dengan satu kalimat yang bisa ditulis ulang.)
 *
 * `nama` tetap dioper supaya pesan galatnya menyebut env mana yang kosong.
 * Pengulangannya disengaja: ia harga yang dibayar agar pembacaannya harfiah.
 */
function wajib(nama: string, nilai: string | undefined): string {
  if (!nilai) throw new Error(`Env ${nama} belum dipasang.`);
  return nilai;
}

export function bucketVideo(): string {
  return wajib("R2_BUCKET_VIDEO", process.env.R2_BUCKET_VIDEO);
}

function klien(): S3Client {
  const akun = wajib("R2_ACCOUNT_ID", process.env.R2_ACCOUNT_ID);
  return new S3Client({
    region: "auto",
    endpoint: `https://${akun}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: wajib("R2_ACCESS_KEY_ID", process.env.R2_ACCESS_KEY_ID),
      secretAccessKey: wajib(
        "R2_SECRET_ACCESS_KEY",
        process.env.R2_SECRET_ACCESS_KEY,
      ),
    },
    // SDK v3 sejak 3.729 menandatangani checksum CRC32 secara bawaan. Untuk
    // presigned PUT, checksum itu dihitung dari badan KOSONG (`AAAAAA==`) lalu
    // ikut masuk URL, dan berkas sungguhan yang diunggah peramban tidak cocok
    // dengannya. Checksum hanya bila operasinya memang mewajibkan.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
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

/**
 * Umur presigned URL UNDUH: 15 menit — sengaja jauh lebih pendek dari
 * `UMUR_TONTON_DETIK`.
 *
 * Kompromi keduanya berjalan ke arah yang berbeda. URL tonton harus bertahan
 * selama orang mem-pause, jadi ia panjang. URL unduh cukup bertahan selama
 * unduhannya, dan setiap menit tambahan adalah menit di mana tautan yang
 * tersalin ke grup percakapan masih bisa dipakai siapa pun yang membukanya.
 */
export const UMUR_UNDUH_DETIK = 15 * 60;

export async function urlUnduhBerkas(objek: string, namaBerkas: string): Promise<string> {
  return getSignedUrl(
    klien(),
    new GetObjectCommand({
      Bucket: bucketVideo(),
      Key: objek,
      // Memaksa peramban MENGUNDUH alih-alih memutar di tab, dan menamai
      // berkasnya dengan judul produk — bukan dengan UUID yang tak berarti
      // apa pun di folder Unduhan pembeli.
      ResponseContentDisposition: `attachment; filename="${namaBerkas}"`,
    }),
    { expiresIn: UMUR_UNDUH_DETIK },
  );
}

export async function hapusObjekVideo(objek: string): Promise<void> {
  await klien().send(
    new DeleteObjectCommand({ Bucket: bucketVideo(), Key: objek }),
  );
}
