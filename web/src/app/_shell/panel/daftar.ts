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
  /**
   * Parameter yang IKUT TERBAWA di setiap tautan daftar ini, tanpa pernah
   * mengembalikan halaman ke 1 — pada `/admin/sesi` itu `tab`.
   *
   * OPSIONAL dengan sengaja: tujuh daftar lain (dan 80 literal `ParamDaftar`
   * di dalam uji) tidak punya parameter lengket, dan mewajibkan medan ini
   * berarti menyunting kedelapan puluhnya untuk menuliskan `{}` — diff besar
   * yang menyembunyikan perubahan yang sesungguhnya.
   */
  lengket?: Readonly<Record<string, string>>;
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
 *
 * `tab` dan `lihat` menyusul `ubah` dengan alasan yang sama: keduanya bukan
 * saringan. `lihat` membuka panel detail permintaan — membuka lalu menutupnya
 * dari halaman 3 tidak boleh memindahkan admin ke halaman 1, karena baris yang
 * barusan diklik justru lenyap dari layar. `tab` memilih daftar mana yang
 * tampil, dan berpindah tab sudah membuang saringannya lewat href bersih.
 */
const BUKAN_SARINGAN = new Set(["cari", "hal", "ubah", "tab", "lihat"]);

function nilaiTunggal(v: string | string[] | undefined): string {
  // `?status=a&status=b` memberi array. Diambil yang pertama, bukan
  // digabungkan: nilai gabungan tidak pernah cocok dengan daftar sah, jadi
  // saringannya diam-diam hilang alih-alih terbaca.
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export function uraikanParamDaftar(
  sp: ParamMentah,
  saringSah: SaringSah,
  lengketSah: SaringSah = {},
): ParamDaftar {
  const saring: Record<string, string> = {};
  for (const [nama, nilaiBoleh] of Object.entries(saringSah)) {
    const v = nilaiTunggal(sp[nama]).trim();
    // Daftar putih, bukan daftar hitam: nilai asing DIBUANG, tidak diteruskan
    // ke `.eq()`. Nilai asing yang lolos memulangkan nol baris, dan nol baris
    // tidak bisa dibedakan dari "memang belum ada datanya".
    if (v !== "" && nilaiBoleh.includes(v)) saring[nama] = v;
  }

  // Daftar putih yang sama seperti saringan: nilai `tab` asing dibuang, dan
  // halaman jatuh ke bawaannya alih-alih merender daftar yang tidak ada.
  const lengket: Record<string, string> = {};
  for (const [nama, nilaiBoleh] of Object.entries(lengketSah)) {
    const v = nilaiTunggal(sp[nama]).trim();
    if (v !== "" && nilaiBoleh.includes(v)) lengket[nama] = v;
  }

  const halMentah = nilaiTunggal(sp.hal).trim();
  const hal = /^\d+$/.test(halMentah) ? Number(halMentah) : 1;

  const result: ParamDaftar = {
    cari: nilaiTunggal(sp.cari).trim(),
    saring,
    hal: hal >= 1 ? hal : 1,
  };

  // Hanya sertakan lengket jika ada nilai — menjaga kompatibilitas dengan
  // daftar lain yang tidak punya parameter lengket.
  if (Object.keys(lengket).length > 0) {
    result.lengket = lengket;
  }

  return result;
}

/**
 * Rentang `.range()` PostgREST untuk sebuah halaman — keduanya inklusif.
 *
 * `perHal` bisa diberikan karena tidak setiap daftar panel berbentuk baris
 * tabel: `/owner/rekap` menampilkan KARTU pekan, yang tingginya berkali lipat
 * satu baris, dan 25 kartu sekaligus adalah halaman yang harus digulung jauh
 * untuk mencapai paginasinya sendiri. Bawaannya tetap `PER_HAL` supaya
 * ketujuh daftar yang sudah ada tidak berubah perilaku.
 */
export function hitungRentang(hal: number, perHal: number = PER_HAL): { dari: number; sampai: number } {
  const dari = (hal - 1) * perHal;
  return { dari, sampai: dari + perHal - 1 };
}

export function jumlahHalaman(total: number, perHal: number = PER_HAL): number {
  // Minimal 1: daftar kosong tetap "halaman 1 dari 1", bukan "1 dari 0".
  return Math.max(1, Math.ceil(total / perHal));
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

  // PALING AWAL supaya urutan parameternya stabil dan href bisa dicocokkan
  // sebagai string utuh. Daftar tanpa parameter lengket tidak berubah sama
  // sekali — `param.lengket` kosong menghasilkan nol iterasi.
  for (const [nama, nilai] of Object.entries(param.lengket ?? {})) {
    const dipakai = nama in ubahan ? ubahan[nama] : nilai;
    if (dipakai !== null && dipakai !== undefined && String(dipakai) !== "") {
      q.set(nama, String(dipakai));
    }
  }

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

  // `lihat` mengikuti `ubah`: ditulis paling akhir, dan hanya bila diminta.
  const lihat = "lihat" in ubahan ? ubahan.lihat : null;
  if (lihat !== null && lihat !== undefined && String(lihat) !== "") {
    q.set("lihat", String(lihat));
  }

  const s = q.toString();
  // String kosong, BUKAN "?" telanjang: href berakhiran "?" dianggap Next
  // sebagai rute berbeda dan memicu navigasi ulang tanpa perubahan apa pun.
  return s === "" ? "" : `?${s}`;
}
