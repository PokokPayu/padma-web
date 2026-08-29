/**
 * Label & batas modul Layanan/Paket.
 *
 * Berkas server action hanya boleh mengekspor fungsi async, jadi setiap
 * konstanta dan validator murni yang dipakai bersama oleh formulir (client
 * component) dan server action tinggal di sini — pola yang sama dengan
 * `sesi/status.ts` dan `bayar/status.ts`. Berkas ini sendiri sengaja BUKAN
 * modul server action: ia diimpor client component, dan direktif itu akan
 * mengubah setiap konstanta di bawah menjadi rujukan jaringan.
 */

export const PANJANG_NAMA_MINIMAL = 2;
export const PANJANG_NAMA_MAKS = 120;
export const PANJANG_DESKRIPSI_MAKS = 500;

/**
 * Batas atas jumlah sesi per paket.
 *
 * Bukan aturan bisnis, melainkan pagar terhadap salah ketik: `jumlah_sesi`
 * menjadi jumlah kotak stempel yang dirender passport klien, jadi satu nol
 * kelebihan menghasilkan halaman dengan delapan puluh kotak kosong dan progres
 * yang tampak nyaris nol untuk klien yang sebenarnya hampir selesai.
 */
export const SESI_PAKET_MAKS = 60;

export const LABEL_AKTIF: Record<"true" | "false", string> = {
  true: "Aktif",
  false: "Nonaktif",
};

export type PeriksaAngka =
  | { ok: true; nilai: number }
  | { ok: false; pesan: string };

/**
 * Memeriksa `jumlah_sesi` sebagai TEKS sebelum ia menjadi angka.
 *
 * `Number("")` adalah 0 dan `Number(" 3 ")` adalah 3 — keduanya lolos dari
 * `Number.isInteger` tanpa pernah menyerupai angka yang diketik manusia.
 * Constraint `packages_jumlah_sesi_check` di basis data memang menolak nilai
 * <= 0, tetapi yang sampai ke layar admin klinik adalah kode 23514; pemeriksaan
 * di sini ada untuk KALIMAT-nya, bukan untuk menggantikan constraint itu.
 */
export function periksaJumlahSesi(mentah: string): PeriksaAngka {
  const teks = mentah.trim();
  if (!/^\d+$/.test(teks)) {
    return { ok: false, pesan: "Jumlah sesi harus berupa angka bulat." };
  }
  const nilai = Number(teks);
  if (nilai < 1) {
    return { ok: false, pesan: "Jumlah sesi minimal 1." };
  }
  if (nilai > SESI_PAKET_MAKS) {
    return { ok: false, pesan: `Jumlah sesi maksimal ${SESI_PAKET_MAKS}.` };
  }
  return { ok: true, nilai };
}

export type PeriksaNama = { ok: true; nilai: string } | { ok: false; pesan: string };

export function periksaNama(mentah: string): PeriksaNama {
  const nilai = mentah.trim();
  if (nilai.length < PANJANG_NAMA_MINIMAL) {
    return { ok: false, pesan: "Nama terlalu pendek." };
  }
  if (nilai.length > PANJANG_NAMA_MAKS) {
    return { ok: false, pesan: `Nama maksimal ${PANJANG_NAMA_MAKS} karakter.` };
  }
  return { ok: true, nilai };
}
