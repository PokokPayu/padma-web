/**
 * PEMULIH BFCACHE untuk tombol yang mengalihkan peramban ke halaman bayar DOKU.
 *
 * Tombol bayar mengunci dirinya sesudah alihan dimulai (`dialihkan = true`):
 * `useTransition` sudah kembali tidak sibuk begitu `location.assign`
 * dipanggil, padahal peramban masih memuat DOKU. Pembeli yang lalu menekan
 * Back mendapat halaman yang DIPULIHKAN dari back/forward cache — bukan
 * dimuat ulang — dan keadaan React-nya beku persis seperti saat ditinggalkan:
 * tombolnya macet pada "Menyiapkan pembayaran..." tanpa jalan keluar selain
 * memuat ulang halaman.
 *
 * Satu-satunya isyarat peramban untuk pemulihan itu adalah `pageshow` dengan
 * `persisted === true`. Muat biasa (`persisted === false`) tidak memanggil
 * pemulih: keadaannya memang baru.
 *
 * MURNI, nol impor: dipakai komponen `"use client"`. Menerima `EventTarget`
 * apa pun supaya bisa diuji tanpa jsdom.
 *
 * @returns pelepas pendengar — kembalikan dari `useEffect` sebagai cleanup.
 */
export function pasangPemulihBfcache(sasaran: EventTarget, pulihkan: () => void): () => void {
  const dengar = (e: Event) => {
    if ((e as Event & { persisted?: boolean }).persisted === true) pulihkan();
  };
  sasaran.addEventListener("pageshow", dengar);
  return () => sasaran.removeEventListener("pageshow", dengar);
}
