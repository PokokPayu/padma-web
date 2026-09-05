/**
 * Daftar putih, label, dan validator murni modul Materi.
 *
 * Berkas server action hanya boleh mengekspor fungsi async, jadi setiap
 * konstanta dan validator yang dipakai bersama oleh formulir (client component)
 * dan server action tinggal di sini — pola yang sama dengan `sesi/status.ts`,
 * `bayar/status.ts`, dan `layanan/status.ts`. Berkas ini sendiri sengaja BUKAN
 * modul server action: ia diimpor client component, dan direktif itu akan
 * mengubah setiap konstanta di bawah menjadi rujukan jaringan.
 */

export type TipeMateri = "ebook" | "video";

/**
 * Daftar putih tipe materi. Ia bukan sekadar penyalinan enum `material_type`:
 * setiap tipe di sini punya bentuk ISI yang berbeda, dan seluruh modul
 * memutuskan "materi ini lengkap atau tidak" berdasarkan tipenya.
 */
export const TIPE_SAH: TipeMateri[] = ["ebook", "video"];

export const LABEL_TIPE: Record<TipeMateri, string> = {
  ebook: "E-Book",
  video: "Video",
};

/** Kalimat yang menjelaskan ISI apa yang wajib menyertai tiap tipe. */
export const LABEL_ISI: Record<TipeMateri, string> = {
  ebook: "satu berkas PDF",
  video: "satu URL video",
};

export const PANJANG_JUDUL_MINIMAL = 2;
export const PANJANG_JUDUL_MAKS = 120;
export const PANJANG_DESKRIPSI_MAKS = 500;

export type Periksa<T> = { ok: true; nilai: T } | { ok: false; pesan: string };

export function periksaJudul(mentah: string): Periksa<string> {
  const nilai = mentah.trim();
  if (nilai.length < PANJANG_JUDUL_MINIMAL) return { ok: false, pesan: "Judul terlalu pendek." };
  if (nilai.length > PANJANG_JUDUL_MAKS) {
    return { ok: false, pesan: `Judul maksimal ${PANJANG_JUDUL_MAKS} karakter.` };
  }
  return { ok: true, nilai };
}

export function periksaTipe(mentah: string): Periksa<TipeMateri> {
  const nilai = mentah.trim();
  if (!(TIPE_SAH as string[]).includes(nilai)) {
    return { ok: false, pesan: "Tipe materi hanya boleh E-Book atau Video." };
  }
  return { ok: true, nilai: nilai as TipeMateri };
}

export function periksaDeskripsi(mentah: string): Periksa<string> {
  const nilai = mentah.trim();
  if (nilai.length > PANJANG_DESKRIPSI_MAKS) {
    return { ok: false, pesan: `Deskripsi maksimal ${PANJANG_DESKRIPSI_MAKS} karakter.` };
  }
  return { ok: true, nilai };
}

