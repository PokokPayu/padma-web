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

/**
 * Penyedia video yang diizinkan.
 *
 * Bukan preferensi vendor: materi video adalah satu-satunya isi berbayar yang
 * meninggalkan aplikasi, jadi ia hanya boleh dititipkan pada penyedia yang bisa
 * dikunci domain (Vimeo) atau ditandatangani (Cloudflare Stream).
 *
 * PENTING — status pagar basis data sejak migrasi objek-R2 (Task 1,
 * `20260904120000_materi_video_r2.sql`): constraint DB yang dulu menegakkan
 * hal yang sama, `material_videos_host_terproteksi`, SUDAH DICABUT di
 * migrasi itu. Alasannya bukan keputusan keamanan, melainkan kontradiksi
 * matematis: constraint itu menuntut `objek ~ '^https://...'`, sementara
 * kolom `objek` (sejak migrasi yang sama) wajib TIDAK PERNAH berbentuk URL
 * — tidak ada string yang bisa memenuhi keduanya sekaligus.
 *
 * Sampai Task 6 selesai, `POLA_URL_VIDEO` di bawah ini adalah SATU-SATUNYA
 * penjaga — bukan lagi salinan sepadan dari sebuah constraint DB yang juga
 * menjaga. Siapa pun yang login sebagai admin/owner bisa menulis `objek`
 * sembarang langsung lewat PostgREST (`PATCH /rest/v1/material_videos`),
 * tanpa pernah melewati fungsi ini — lihat catatan yang sama di migrasi
 * `20260904120000` dan di `tests/admin-pengerasan.test.ts`.
 *
 * Task 6 mengembalikan pagar DB ini dalam BENTUK BARU: check yang
 * memvalidasi bentuk KUNCI OBJEK (mis. `{material_id}/{acak}.{ext}`), bukan
 * host URL — jangan melonggarkan pola di bawah dengan asumsi DB masih
 * menjaga sampai penggantinya itu terpasang.
 */
export const PENYEDIA_VIDEO = "Vimeo atau Cloudflare Stream";

const POLA_URL_VIDEO: RegExp[] = [
  /^https:\/\/(player\.)?vimeo\.com\/\S+$/,
  /^https:\/\/[a-z0-9-]+\.cloudflarestream\.com\/\S+$/,
];

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

/**
 * URL video.
 *
 * `https://vimeo.com.jahat.id/...` adalah bentuk serangan yang paling gampang
 * lolos dari pemeriksaan "mengandung vimeo.com", jadi polanya diikat pada AWAL
 * string sampai garis miring pertama — persis seperti constraint basis data.
 */
export function periksaUrlVideo(mentah: string): Periksa<string> {
  const nilai = mentah.trim();
  if (nilai.length === 0) {
    return { ok: false, pesan: `URL video wajib diisi — ${PENYEDIA_VIDEO}.` };
  }
  if (!POLA_URL_VIDEO.some((p) => p.test(nilai))) {
    return {
      ok: false,
      pesan: `URL video hanya boleh dari ${PENYEDIA_VIDEO} (penyedia yang bisa dikunci domain). Contoh: https://vimeo.com/123456789`,
    };
  }
  return { ok: true, nilai };
}

