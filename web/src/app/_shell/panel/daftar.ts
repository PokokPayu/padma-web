/**
 * Keadaan sebuah daftar panel — pencarian, saringan, halaman — sebagai fungsi
 * MURNI atas parameter URL.
 *
 * Semuanya hidup di URL, bukan di state komponen, dan itu keputusan spec (K2):
 * halaman bisa dirender penuh di server, tombol kembali browser bekerja seperti
 * yang orang harapkan, dan StatTile beranda bisa menaut LANGSUNG ke daftar yang
 * sudah tersaring alih-alih hanya memberi angka.
 *
 * Berkas ini sengaja tanpa React dan tanpa I/O supaya bisa diuji sebagai
 * aritmatika biasa — dan supaya aturan "mengubah saringan mengembalikan
 * halaman ke 1" punya satu tempat tinggal, bukan diulang di tiap halaman.
 */

/** Baris per halaman. 25 memenuhi layar laptop tanpa menggulung panjang. */
export const PER_HAL = 25;

export type ParamDaftar = {
  cari: string;
  saring: Readonly<Record<string, string>>;
  hal: number;
};

/** Bentuk `searchParams` Next 16 sesudah di-`await`. */
export type ParamMentah = Record<string, string | string[] | undefined>;

/** Nama saringan → daftar nilai yang boleh diterima. */
export type SaringSah = Readonly<Record<string, readonly string[]>>;

/**
 * Parameter yang BUKAN saringan.
 *
 * Bedanya bukan kosmetik: hanya perubahan pada SARINGAN yang mengembalikan
 * halaman ke 1. `hal` jelas dikecualikan; `ubah` dikecualikan karena membuka
 * lalu menutup sebuah baris tidak boleh memindahkan staf dari halamannya.
 */
const BUKAN_SARINGAN = new Set(["cari", "hal", "ubah"]);

function nilaiTunggal(v: string | string[] | undefined): string {
  // `?status=a&status=b` memberi array. Diambil yang pertama, bukan
  // digabungkan: nilai gabungan tidak pernah cocok dengan daftar sah, jadi
  // saringannya diam-diam hilang alih-alih terbaca.
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export function uraikanParamDaftar(sp: ParamMentah, saringSah: SaringSah): ParamDaftar {
  const saring: Record<string, string> = {};
  for (const [nama, nilaiBoleh] of Object.entries(saringSah)) {
    const v = nilaiTunggal(sp[nama]).trim();
    // Daftar putih, bukan daftar hitam: nilai asing DIBUANG, tidak diteruskan
    // ke `.eq()`. Nilai asing yang lolos memulangkan nol baris, dan nol baris
    // tidak bisa dibedakan dari "memang belum ada datanya".
    if (v !== "" && nilaiBoleh.includes(v)) saring[nama] = v;
  }

  const halMentah = nilaiTunggal(sp.hal).trim();
  const hal = /^\d+$/.test(halMentah) ? Number(halMentah) : 1;

  return {
    cari: nilaiTunggal(sp.cari).trim(),
    saring,
    hal: hal >= 1 ? hal : 1,
  };
}

/** Rentang `.range()` PostgREST untuk sebuah halaman — keduanya inklusif. */
export function hitungRentang(hal: number): { dari: number; sampai: number } {
  const dari = (hal - 1) * PER_HAL;
  return { dari, sampai: dari + PER_HAL - 1 };
}

export function jumlahHalaman(total: number): number {
  // Minimal 1: daftar kosong tetap "halaman 1 dari 1", bukan "1 dari 0".
  return Math.max(1, Math.ceil(total / PER_HAL));
}

/**
 * Membangun query string baru dari keadaan sekarang plus perubahan.
 *
 * `null` menghapus sebuah parameter. Halaman 1 dan nilai kosong tidak pernah
 * ditulis — URL terpendek yang mungkin, supaya yang tampil di bilah alamat
 * hanya hal yang benar-benar menyimpang dari bawaan.
 */
export function bangunQuery(
  param: ParamDaftar,
  ubahan: Record<string, string | number | null>,
): string {
  const q = new URLSearchParams();

  const cari = "cari" in ubahan ? ubahan.cari : param.cari;
  if (cari !== null && String(cari) !== "") q.set("cari", String(cari));

  const namaSaring = new Set([...Object.keys(param.saring), ...Object.keys(ubahan)]);
  for (const kunci of BUKAN_SARINGAN) namaSaring.delete(kunci);
  for (const nama of namaSaring) {
    const nilai = nama in ubahan ? ubahan[nama] : param.saring[nama];
    if (nilai !== null && nilai !== undefined && String(nilai) !== "") {
      q.set(nama, String(nilai));
    }
  }

  // MENGUBAH SARINGAN MENGEMBALIKAN HALAMAN KE 1, dan itu bukan kenyamanan:
  // menyaring dari halaman 4 mendarat di halaman 4 daftar BARU, yang hampir
  // selalu kosong — dan kosong terbaca sebagai "tidak ada datanya", bukan
  // sebagai "Anda sedang di halaman yang terlalu jauh".
  //
  // `hal` dan `ubah` dikecualikan dari aturan itu: keduanya bukan saringan.
  // Membuka sebuah baris di halaman 4 lalu menutupnya harus mengembalikan
  // staf ke halaman 4 — kalau `ubah` ikut me-reset halaman, baris yang
  // barusan diubah justru lenyap dari layar begitu panelnya ditutup.
  const menyentuhSaringan = Object.keys(ubahan).some((k) => !BUKAN_SARINGAN.has(k));
  const halDiminta = "hal" in ubahan ? Number(ubahan.hal ?? 1) : param.hal;
  const hal = menyentuhSaringan ? 1 : halDiminta;
  if (hal > 1) q.set("hal", String(hal));

  // `ubah` ditulis PALING AKHIR supaya urutan parameternya stabil, dan
  // uji href bisa mencocokkan string utuh alih-alih memeriksa potongan.
  const ubah = "ubah" in ubahan ? ubahan.ubah : null;
  if (ubah !== null && ubah !== undefined && String(ubah) !== "") {
    q.set("ubah", String(ubah));
  }

  const s = q.toString();
  // String kosong, BUKAN "?" telanjang: href berakhiran "?" dianggap Next
  // sebagai rute berbeda dan memicu navigasi ulang tanpa perubahan apa pun.
  return s === "" ? "" : `?${s}`;
}
