/**
 * Daftar putih, label, dan validator murni modul Produk Digital.
 *
 * TANPA `"use server"` dan tanpa impor server-only: berkas ini diimpor client
 * component (formulir admin & owner) SEKALIGUS server action dan halaman
 * publik. Direktif server action akan mengubah setiap konstanta di bawah
 * menjadi rujukan jaringan — pola yang sama sudah dijelaskan di
 * `src/app/admin/materi/status.ts`.
 */

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

export const PANJANG_KETERANGAN_MATERI_MAKS = 500;
// Cermin CHECK `masa_berlaku_bulan between 1 and 120` di migrasi 20261016100000.
export const MASA_BERLAKU_MAKS_BULAN = 120;

export const PESAN_PRODUK = {
  judulPendek: `Judul minimal ${PANJANG_JUDUL_MINIMAL} karakter.`,
  judulPanjang: `Judul maksimal ${PANJANG_JUDUL_MAKS} karakter.`,
  slugWajib: "Alamat produk tidak boleh kosong.",
  slugTidakSah: "Alamat produk hanya boleh huruf kecil, angka, dan tanda hubung.",
  jenisMateriTidakSah: "Jenis materi harus Video atau Artikel (PDF).",
  judulBabWajib: "Judul bab tidak boleh kosong.",
  judulBabPanjang: `Judul bab maksimal ${PANJANG_JUDUL_MAKS} karakter.`,
  keteranganPanjang: `Keterangan maksimal ${PANJANG_KETERANGAN_MATERI_MAKS} karakter.`,
  masaBerlakuTidakSah: `Masa berlaku harus 1–${MASA_BERLAKU_MAKS_BULAN} bulan atau 1–${MASA_BERLAKU_MAKS_BULAN / 12} tahun.`,
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

// ===== MATERI =====

export type JenisMateri = "video" | "pdf";

export const JENIS_MATERI: readonly JenisMateri[] = ["video", "pdf"];

// "Artikel", bukan "PDF": itu kata yang dipakai klien di etalase
// ("11 Video · 1 Artikel"). Di basis data nilainya tetap 'pdf'.
export const LABEL_JENIS_MATERI: Record<JenisMateri, string> = {
  video: "Video",
  pdf: "Artikel",
};

export function periksaJenisMateri(teks: string): Periksa<JenisMateri> {
  if (!(JENIS_MATERI as readonly string[]).includes(teks)) {
    return { ok: false, pesan: PESAN_PRODUK.jenisMateriTidakSah };
  }
  return { ok: true, nilai: teks as JenisMateri };
}

export function periksaJudulBab(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: false, pesan: PESAN_PRODUK.judulBabWajib };
  if (rapi.length > PANJANG_JUDUL_MAKS) return { ok: false, pesan: PESAN_PRODUK.judulBabPanjang };
  return { ok: true, nilai: rapi };
}

export function periksaKeteranganMateri(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi.length > PANJANG_KETERANGAN_MATERI_MAKS) {
    return { ok: false, pesan: PESAN_PRODUK.keteranganPanjang };
  }
  return { ok: true, nilai: rapi };
}

/** Video berisi bila berkasnya ada; PDF berisi bila halamannya ada (berkas utuh opsional). */
export function materiBerisi(
  jenis: JenisMateri,
  jumlahBerkas: number,
  jumlahHalaman: number,
): boolean {
  return jenis === "video" ? jumlahBerkas > 0 : jumlahHalaman > 0;
}

export function ringkasJumlahMateri(jenis: readonly JenisMateri[]): string {
  return JENIS_MATERI
    .map((j) => ({ j, n: jenis.filter((x) => x === j).length }))
    .filter(({ n }) => n > 0)
    .map(({ j, n }) => `${n} ${LABEL_JENIS_MATERI[j]}`)
    .join(" · ");
}

// ===== MASA BERLAKU =====

export function labelMasaBerlaku(bulan: number | null): string {
  if (bulan === null) return "Selamanya";
  if (bulan % 12 === 0) return `${bulan / 12} Tahun`;
  return `${bulan} Bulan`;
}

/** `satuan` dari form owner: "selamanya" | "bulan" | "tahun". Hasil dalam BULAN. */
export function periksaMasaBerlaku(satuan: string, jumlah: string): Periksa<number | null> {
  if (satuan === "selamanya") return { ok: true, nilai: null };
  if (satuan !== "bulan" && satuan !== "tahun") {
    return { ok: false, pesan: PESAN_PRODUK.masaBerlakuTidakSah };
  }
  const rapi = jumlah.trim();
  if (!/^\d+$/.test(rapi)) return { ok: false, pesan: PESAN_PRODUK.masaBerlakuTidakSah };
  const bulan = Number(rapi) * (satuan === "tahun" ? 12 : 1);
  if (bulan < 1 || bulan > MASA_BERLAKU_MAKS_BULAN) {
    return { ok: false, pesan: PESAN_PRODUK.masaBerlakuTidakSah };
  }
  return { ok: true, nilai: bulan };
}

export type StatusAkses =
  | { keadaan: "selamanya" }
  | { keadaan: "aktif"; sampai: string }
  | { keadaan: "habis"; sampai: string };

/**
 * Cermin syarat `akses_aktif` di SQL (`berlaku_sampai > now()`) — untuk
 * MENAMPILKAN status. Keputusan boleh-buka tetap milik basis data.
 */
export function statusAkses(berlakuSampai: string | null, sekarang: Date = new Date()): StatusAkses {
  if (berlakuSampai === null) return { keadaan: "selamanya" };
  return new Date(berlakuSampai).getTime() > sekarang.getTime()
    ? { keadaan: "aktif", sampai: berlakuSampai }
    : { keadaan: "habis", sampai: berlakuSampai };
}

const FORMAT_TANGGAL_AKSES = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

export function formatTanggalAkses(iso: string): string {
  return FORMAT_TANGGAL_AKSES.format(new Date(iso));
}
