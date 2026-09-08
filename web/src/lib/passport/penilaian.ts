/**
 * JENDELA PENILAIAN (spec C1 J10).
 *
 * Kartu penilaian muncul di beranda Passport sesudah sesi selesai, dan
 * **hilang sendiri setelah 30 hari**. Ia bisa diabaikan dan tidak menghadang
 * apa pun.
 *
 * Kenapa ada batasnya sama sekali: penilaian yang diminta berbulan-bulan
 * sesudahnya bukan lagi ingatan tentang sesi itu, melainkan kesan umum tentang
 * PADMA — dan kesan umum tidak bisa dijawab siapa pun. Angka yang tidak bisa
 * ditindak lebih buruk daripada tidak ada angka, karena ia tetap masuk ke
 * rata-rata seseorang.
 *
 * Fungsi murni, tanpa impor: dipakai halaman server dan diuji tanpa DOM
 * maupun basis data.
 */

/** Sesudah ini kartunya hilang sendiri. */
export const JENDELA_NILAI_HARI = 30;

/**
 * Apakah sesi bertanggal `tanggal` masih boleh dinilai pada hari `hariIni`.
 *
 * Keduanya string 'YYYY-MM-DD' menurut kalender Jakarta — perbandingannya
 * memakai selisih HARI, bukan `Date.getTime()` atas dua tengah malam yang
 * berbeda zona. Server berjalan UTC; menghitungnya dengan jam mesin akan
 * menggeser batas sehari untuk sebagian pemakai.
 */
export function masihBisaDinilai(
  tanggal: string,
  hariIni: string,
  jendelaHari: number = JENDELA_NILAI_HARI,
): boolean {
  // Sesi masa depan tidak pernah "sudah lewat" — dan sesi yang belum terjadi
  // memang tidak bisa dinilai. Pemeriksaan status `selesai` ada di pemanggil
  // dan di basis data; ini hanya menjaga jendelanya.
  if (tanggal > hariIni) return false;

  const selisih = Math.round(
    (Date.parse(`${hariIni}T00:00:00Z`) - Date.parse(`${tanggal}T00:00:00Z`)) / 86_400_000,
  );
  return selisih <= jendelaHari;
}
