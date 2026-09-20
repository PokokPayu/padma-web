/**
 * Daftar putih, label, dan validator murni modul Produk Digital.
 *
 * TANPA `"use server"` dan tanpa impor server-only: berkas ini diimpor client
 * component (formulir admin & owner) SEKALIGUS server action dan halaman
 * publik. Direktif server action akan mengubah setiap konstanta di bawah
 * menjadi rujukan jaringan — pola yang sama sudah dijelaskan di
 * `src/app/admin/materi/status.ts`.
 */

export type JenisProduk = "video" | "pdf";

export const JENIS_SAH: JenisProduk[] = ["video", "pdf"];

export const LABEL_JENIS: Record<JenisProduk, string> = {
  video: "Video",
  pdf: "PDF",
};

export type Periksa<T> = { ok: true; nilai: T } | { ok: false; pesan: string };

export const PANJANG_JUDUL_MINIMAL = 2;
export const PANJANG_JUDUL_MAKS = 120;
export const PANJANG_DESKRIPSI_MAKS = 2000;

/**
 * Batas atas harga. Bukan kesopanan: satu salah ketik nol membuat produk
 * Rp 990.000 terpajang Rp 990.000.000, dan tidak ada yang menahannya selain
 * angka ini.
 */
export const HARGA_MAKS = 50_000_000;

export const PESAN_PRODUK = {
  judulPendek: `Judul minimal ${PANJANG_JUDUL_MINIMAL} karakter.`,
  judulPanjang: `Judul maksimal ${PANJANG_JUDUL_MAKS} karakter.`,
  slugWajib: "Alamat produk tidak boleh kosong.",
  slugTidakSah: "Alamat produk hanya boleh huruf kecil, angka, dan tanda hubung.",
  jenisTidakSah: "Jenis produk harus Video atau PDF.",
  hargaWajib: "Harga wajib diisi. Produk gratis diisi 0.",
  hargaTidakSah: "Harga harus bilangan bulat rupiah, tanpa titik atau koma.",
  hargaTerlaluBesar: `Harga maksimal Rp ${HARGA_MAKS.toLocaleString("id-ID")}.`,
  coretTidakSah: "Harga coret harus bilangan bulat rupiah.",
  coretLebihMurah:
    "Harga coret tidak boleh lebih murah atau sama dengan harga jual — itu terbaca sebagai kenaikan harga, bukan diskon.",
} as const;

export function periksaJudul(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi.length < PANJANG_JUDUL_MINIMAL) return { ok: false, pesan: PESAN_PRODUK.judulPendek };
  if (rapi.length > PANJANG_JUDUL_MAKS) return { ok: false, pesan: PESAN_PRODUK.judulPanjang };
  return { ok: true, nilai: rapi };
}

/**
 * Judul → alamat publik.
 *
 * Memulangkan string KOSONG bila judulnya tidak menyisakan satu pun huruf
 * atau angka, bukan "-" atau "". Slug "-" lolos regex yang lebih longgar dan
 * melahirkan alamat `/produk/-` yang tidak bisa dibaca siapa pun; string
 * kosong sebaliknya ditolak `periksaSlug` dengan kalimat yang jelas.
 */
export function slugDariJudul(judul: string): string {
  return judul
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function periksaSlug(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: false, pesan: PESAN_PRODUK.slugWajib };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rapi)) {
    return { ok: false, pesan: PESAN_PRODUK.slugTidakSah };
  }
  return { ok: true, nilai: rapi };
}

export function periksaJenis(teks: string): Periksa<JenisProduk> {
  if (!(JENIS_SAH as string[]).includes(teks)) {
    return { ok: false, pesan: PESAN_PRODUK.jenisTidakSah };
  }
  return { ok: true, nilai: teks as JenisProduk };
}

/**
 * Harga. Medan KOSONG ditolak, dan itu disengaja: "gratis" dan "belum
 * ditetapkan" adalah dua keadaan berbeda, dan medan yang lupa diisi tidak
 * boleh diam-diam menjadi produk gratis.
 */
export function periksaHarga(teks: string): Periksa<number> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: false, pesan: PESAN_PRODUK.hargaWajib };
  if (!/^\d+$/.test(rapi)) return { ok: false, pesan: PESAN_PRODUK.hargaTidakSah };
  const nilai = Number(rapi);
  if (!Number.isSafeInteger(nilai)) return { ok: false, pesan: PESAN_PRODUK.hargaTidakSah };
  if (nilai > HARGA_MAKS) return { ok: false, pesan: PESAN_PRODUK.hargaTerlaluBesar };
  return { ok: true, nilai };
}

/**
 * Harga coret adalah angka PEMASARAN: harga sebelum diskon. Kosong = tidak ada
 * coret. Yang tidak sah adalah coret yang lebih murah ATAU SAMA — yang pertama
 * terbaca sebagai kenaikan harga, yang kedua memajang badge diskon nol rupiah.
 */
export function periksaHargaCoretProduk(teks: string, harga: number): Periksa<number | null> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: true, nilai: null };
  if (!/^\d+$/.test(rapi)) return { ok: false, pesan: PESAN_PRODUK.coretTidakSah };
  const nilai = Number(rapi);
  if (!Number.isSafeInteger(nilai)) return { ok: false, pesan: PESAN_PRODUK.coretTidakSah };
  if (nilai > HARGA_MAKS) return { ok: false, pesan: PESAN_PRODUK.hargaTerlaluBesar };
  if (nilai <= harga) return { ok: false, pesan: PESAN_PRODUK.coretLebihMurah };
  return { ok: true, nilai };
}
