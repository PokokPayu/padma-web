/**
 * Konstanta & fungsi MURNI rantai rasterisasi.
 *
 * Sengaja tanpa DOM dan tanpa PDF.js: berkas ini diimpor server action,
 * client component, DAN Vitest. Kode yang menyentuh canvas tinggal di
 * `./pdf-klien.ts` yang hanya diimpor client component.
 */

/** Lebar sasaran gambar halaman. Lebar baca passport `max-w-3xl` (768px) pada
 *  perangkat DPR 2 menuntut ~1536px; 1600 memberi sedikit ruang. */
export const LEBAR_RASTER = 1600;

/** Kualitas WebP. 0,82 adalah titik di mana teks masih tajam sementara satu
 *  halaman tetap ~200-400 KB. */
export const KUALITAS_WEBP = 0.82;

/**
 * KOPLING KE `max_rows` PostgREST — baca ini sebelum menaikkannya.
 *
 * Reader pasien membaca halaman lewat EMBED PostgREST
 * (`materials -> material_pages`), dan embed itu ikut dipotong `max_rows`
 * (1000 di config.toml maupun default Supabase cloud). Diuji empiris dengan
 * materi 1200 halaman: hanya halaman 1..1000 yang kembali, TANPA error.
 *
 * Jadi 300 bukan angka bebas. Menaikkannya melewati `max_rows` membuat pasien
 * diam-diam kehilangan halaman akhir sebuah e-book — tidak ada yang merah,
 * tidak ada yang menandai, dan reader tetap tampak bekerja. Bila batas ini
 * perlu naik melewati 1000, embed-nya harus diganti query berpaginasi lebih
 * dulu.
 */
export const MAKS_HALAMAN = 300;
export const MAKS_BYTE_PDF = 60 * 1024 * 1024;

/** Unggahan bersamaan. Empat menjaga koneksi rumahan tidak kehabisan bandwidth
 *  sampai unggahan saling menggagalkan, sementara 300 halaman tetap selesai
 *  dalam waktu wajar. */
export const KONKURENSI_UNGGAH = 4;

export type Periksa<T> = { ok: true; nilai: T } | { ok: false; pesan: string };

/**
 * Padding empat digit BUKAN kosmetik: tanpa itu, `storage.list()` mengurutkan
 * "10" sebelum "2" dan penghapusan objek lama akan melewatkan halaman.
 */
export function namaObjekHalaman(materialId: string, halaman: number): string {
  return `${materialId}/${String(halaman).padStart(4, "0")}.webp`;
}

export function periksaBerkasPdf(namaBerkas: string, byte: number): Periksa<true> {
  if (!namaBerkas.toLowerCase().endsWith(".pdf")) {
    return { ok: false, pesan: "Berkas harus PDF." };
  }
  if (byte > MAKS_BYTE_PDF) {
    const mb = Math.round(MAKS_BYTE_PDF / (1024 * 1024));
    return { ok: false, pesan: `PDF maksimal ${mb} MB.` };
  }
  if (byte === 0) return { ok: false, pesan: "Berkas PDF kosong." };
  return { ok: true, nilai: true };
}
