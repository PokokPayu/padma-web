/**
 * Konstanta & fungsi MURNI rantai video.
 *
 * Sengaja tanpa I/O dan tanpa `@aws-sdk`: berkas ini diimpor server action,
 * client component, DAN Vitest. Yang menyentuh jaringan tinggal di `@/lib/r2`.
 */
import type { Periksa } from "./rasterisasi";

/**
 * Batas 200 MB, dan angkanya bukan soal kapasitas penyimpanan.
 *
 * Design ini menolak transkode (spec §14), jadi berkas yang diunggah admin
 * adalah berkas yang ditonton pasien. Video dari ponsel modern gampang
 * melewati 1 GB, yang berarti admin TETAP harus mengompres berapa pun batas
 * yang dipilih. Tugas batas ini karena itu bukan menampung berkas mentah,
 * melainkan menolak cepat dengan instruksi yang jelas — dan 200 MB menampung
 * ~15 menit pada 720p, di atas kebutuhan materi edukasi klinik, sementara satu
 * kegagalan unggah berbiaya menit alih-alih sejam.
 */
export const MAKS_BYTE_VIDEO = 200 * 1024 * 1024;

export const MIME_VIDEO = ["video/mp4", "video/webm"] as const;
export type MimeVideo = (typeof MIME_VIDEO)[number];

const EKSTENSI: Record<MimeVideo, "mp4" | "webm"> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** UUID v4 apa pun versinya — yang dijaga bentuknya, bukan versinya. */
const POLA_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ekstensiDariMime(mime: string): "mp4" | "webm" | null {
  return (MIME_VIDEO as readonly string[]).includes(mime)
    ? EKSTENSI[mime as MimeVideo]
    : null;
}

/**
 * Nama objeknya ACAK, bukan nama berkas yang diunggah admin. Nama asli sering
 * memuat hal yang tidak perlu ikut tersebar — judul draf, nama orang, nomor
 * revisi — dan nama acak juga menutup kemungkinan menebak objek lain di bucket
 * yang sama.
 */
export function namaObjekVideo(
  materialId: string,
  mime: MimeVideo,
  acak: string,
): string {
  return `${materialId}/${acak}.${EKSTENSI[mime]}`;
}

export function periksaBerkasVideo(
  mime: string,
  byte: number,
): Periksa<MimeVideo> {
  if (ekstensiDariMime(mime) === null) {
    return { ok: false, pesan: "Video harus MP4 atau WebM." };
  }
  if (!Number.isFinite(byte) || byte <= 0) {
    return { ok: false, pesan: "Berkas video kosong." };
  }
  if (byte > MAKS_BYTE_VIDEO) {
    const mb = Math.round(MAKS_BYTE_VIDEO / (1024 * 1024));
    const punya = Math.round(byte / (1024 * 1024));
    return {
      ok: false,
      pesan:
        `Video ${punya} MB melebihi batas ${mb} MB. ` +
        `Ekspor ulang di 720p lalu unggah lagi.`,
    };
  }
  return { ok: true, nilai: mime as MimeVideo };
}

/**
 * Objek yang dicatat browser harus berbentuk objek yang KITA terbitkan.
 *
 * Bagian acaknya dibuat server dan tidak bisa dihitung ulang di sini, jadi yang
 * diperiksa adalah BENTUKNYA: materi yang sama, satu segmen, UUID, dan
 * ekstensi yang cocok dengan MIME-nya. Tanpa pagar ini, browser bisa mencatat
 * objek video materi lain sebagai miliknya.
 */
export function objekVideoSah(
  materialId: string,
  objek: string,
  mime: MimeVideo,
): boolean {
  const awalan = `${materialId}/`;
  if (!objek.startsWith(awalan)) return false;
  const sisa = objek.slice(awalan.length);
  if (sisa.includes("/")) return false;
  const titik = sisa.lastIndexOf(".");
  if (titik <= 0) return false;
  const acak = sisa.slice(0, titik);
  const ext = sisa.slice(titik + 1);
  return POLA_UUID.test(acak) && ext === EKSTENSI[mime];
}
