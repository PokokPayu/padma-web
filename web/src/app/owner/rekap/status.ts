/**
 * Label dan validator MURNI modul Rekap Honor.
 *
 * Berkas server action hanya boleh mengekspor fungsi async, jadi setiap
 * konstanta dan validator yang dipakai bersama oleh baris rekap (client
 * component) dan server action tinggal di sini — pola yang sama dengan
 * `owner/tarif/status.ts` dan `admin/sesi/status.ts`. Berkas ini sendiri
 * sengaja BUKAN modul server action: ia diimpor client component, dan direktif
 * itu akan mengubah setiap konstanta di bawah menjadi rujukan jaringan.
 */

import { awalPekan, geserHari, isoDow } from "@/lib/owner/pekan";

export type PeriksaPekan = { ok: true; nilai: string } | { ok: false; pesan: string };

/**
 * Memeriksa `week_start` sebuah tanda bayar.
 *
 * Tiga hal yang harus benar sekaligus, dan basis data hari ini tidak menjaga
 * satu pun di antaranya — `honor_marks` tidak punya CHECK selain PK, FK, dan
 * UNIQUE:
 *
 *  1. BENTUKNYA. Regex saja tidak cukup: "2024-02-31" cocok dengan polanya dan
 *     tetap bukan tanggal. Kesahihan kalendernya dibuktikan lewat perjalanan
 *     pulang `geserHari(tgl, 0)` — aritmatika bilangan bulat murni yang
 *     mengembalikan bentuk kanonik.
 *
 *  2. HARI SENIN. Bucket rekap SELALU berkunci pada Senin. Tanda bertanggal
 *     Rabu tidak akan pernah cocok dengan bucket mana pun: honornya terlihat
 *     "belum dibayar" selamanya sementara uangnya sudah ditransfer — dan
 *     tandanya TIDAK BISA DIHAPUS, karena DELETE atas `honor_marks` sudah
 *     dicabut dari peran aplikasi (owner pun dijawab 42501).
 *
 *  3. PEKANNYA SUDAH BERJALAN. Menandai pekan depan berarti menyatakan honor
 *     yang belum dikerjakan sudah dibayarkan. Karena tandanya tidak bisa
 *     dicabut, kekeliruan itu permanen. Pekan BERJALAN tetap boleh ditandai:
 *     gajian PADMA jatuh Sabtu, di dalam pekannya sendiri.
 *
 * `hariIni` diberikan pemanggil (action meneruskan `hariIniJakarta()`) supaya
 * validator ini tetap murni dan bisa diuji pada pekan mana pun.
 */
export function periksaPekan(mentah: string, hariIni: string): PeriksaPekan {
  const teks = mentah.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) {
    return { ok: false, pesan: PESAN.pekanTakSah };
  }
  let kanonik: string;
  try {
    kanonik = geserHari(teks, 0);
  } catch {
    return { ok: false, pesan: PESAN.pekanTakSah };
  }
  if (kanonik !== teks) {
    return { ok: false, pesan: `Pekan ${teks} tidak ada di kalender.` };
  }
  if (isoDow(teks) !== 1) {
    return { ok: false, pesan: PESAN.bukanSenin };
  }
  if (teks > awalPekan(hariIni)) {
    return { ok: false, pesan: PESAN.pekanBelumBerjalan };
  }
  return { ok: true, nilai: teks };
}

/**
 * Memeriksa bentuk id mitra sebelum ia menyentuh basis data.
 *
 * Nilai bukan-UUID dijawab PostgREST dengan `22P02` — kode Postgres, bukan
 * kalimat yang boleh dibaca pemilik klinik. Keberadaan mitranya sendiri
 * dipastikan action lewat pembacaan tabel `partners`.
 */
export function periksaMitra(mentah: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mentah.trim());
}

/**
 * Kalimat penolakan — satu-satunya daftar putihnya.
 *
 * Yang sampai ke layar pemiliknya tidak boleh berupa SQLSTATE.
 */
export const PESAN = {
  mitraWajib: "Mitra wajib dipilih.",
  mitraTakDikenal: "Mitra tidak dikenal. Muat ulang halaman rekap.",
  pekanTakSah: "Pekan tidak sah — honor selalu direkap per pekan (YYYY-MM-DD).",
  bukanSenin: "Pekan honor selalu dimulai hari Senin.",
  pekanBelumBerjalan:
    "Pekan itu belum berjalan — honornya belum bisa ditandai dibayar, dan tanda bayar tidak bisa dibatalkan.",
  gagal: "Gagal menandai pembayaran honor.",
  tidakTersimpan: "Tanda bayar tidak tersimpan. Panel ini hanya untuk pemilik.",
} as const;

/**
 * Terjemahan kode Postgres yang mungkin muncul dari `honor_marks`.
 *
 * `23505` sengaja TIDAK diterjemahkan sebagai kegagalan: penulisannya memakai
 * `ignoreDuplicates`, sehingga menandai dua kali tidak pernah sampai ke sini.
 * Bila toh muncul, artinya barisnya memang sudah ada — dan itu justru keadaan
 * yang diinginkan pemanggil.
 */
export function pesanKodePostgres(kode: string | undefined): string {
  if (kode === "23503") return PESAN.mitraTakDikenal;
  if (kode === "22P02") return PESAN.mitraTakDikenal;
  if (kode === "23514") return PESAN.bukanSenin;
  if (kode === "42501") return PESAN.tidakTersimpan;
  return PESAN.gagal;
}
