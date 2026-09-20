// SUMBER KEBENARAN TUNGGAL batas trimester kehamilan.
// Dipakai klien (menyalakan tombol trimester dari minggu yang diketik) dan
// server (menurunkan ulang trimester sebelum menyimpan) — seperti bank-soal.ts,
// dua sisi satu berkas, karena dua salinan angka batas adalah dua kesempatan
// layar dan basis data menyebut trimester yang berbeda untuk orang yang sama.
//
// ANGKANYA KONVENSI OBSTETRI BAKU, bukan rentang bertumpuk (0-14, 14-28) yang
// sempat beredar: satu minggu tidak boleh menjadi milik dua trimester.
//
// Usia kehamilan di sini MURNI INFORMASI untuk tim — ia tidak pernah ikut
// menentukan hasil hijau/merah. Penilaian keselamatan tetap sepenuhnya milik
// bank soal. Bila kelak trimester memang harus mempengaruhi triase, itu
// perubahan kebijakan klinis yang butuh aturan tertulis dari PADMA dulu.

export type Trimester = 1 | 2 | 3;

/** Batas atas wajar. 42, bukan 40: kehamilan lewat waktu itu nyata dan
 *  formulir keselamatan tidak boleh menolak orang yang sedang menjalaninya. */
export const MINGGU_MAKS = 42;

export type RentangTrimester = {
  nomor: Trimester;
  label: string;
  /** inklusif */ mulai: number;
  /** inklusif */ selesai: number;
};

export const RENTANG_TRIMESTER: readonly RentangTrimester[] = [
  { nomor: 1, label: "Trimester 1", mulai: 0, selesai: 13 },
  { nomor: 2, label: "Trimester 2", mulai: 14, selesai: 27 },
  { nomor: 3, label: "Trimester 3", mulai: 28, selesai: MINGGU_MAKS },
] as const;

/**
 * Trimester dari usia kehamilan dalam minggu, atau `null` bila angkanya di
 * luar rentang wajar / bukan bilangan bulat.
 *
 * Sengaja TIDAK menebak: angka yang tidak masuk akal harus ditolak formulir
 * dan skema, bukan dibulatkan diam-diam ke trimester terdekat.
 */
export function trimesterDari(minggu: number): Trimester | null {
  if (!Number.isInteger(minggu)) return null;
  const cocok = RENTANG_TRIMESTER.find((r) => minggu >= r.mulai && minggu <= r.selesai);
  return cocok ? cocok.nomor : null;
}

export type IsianUsiaKehamilan = {
  minggu: number | null;
  trimester: Trimester | null;
};

export const USIA_KOSONG: IsianUsiaKehamilan = { minggu: null, trimester: null };

/**
 * Mengubah ketikan mentah kotak "… minggu" menjadi SATU fakta.
 *
 * Angka di luar rentang tetap dipegang apa adanya — menghapusnya di bawah jari
 * orang yang sedang mengetik "4" menuju "40" adalah medan yang mustahil diisi —
 * tetapi tanpa trimester, dan skema menolaknya bila sempat terkirim.
 */
export function bacaMinggu(teks: string): IsianUsiaKehamilan {
  const bersih = teks.trim();
  if (bersih === "") return USIA_KOSONG;
  const angka = Number(bersih);
  if (!Number.isInteger(angka)) return USIA_KOSONG;
  return { minggu: angka, trimester: trimesterDari(angka) };
}
