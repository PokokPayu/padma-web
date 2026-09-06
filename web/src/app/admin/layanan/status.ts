import type { FormatVarian } from "@/lib/varian";

/**
 * Label & batas modul Layanan/Paket/Varian.
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

// ---------------------------------------------------------------------------
// Varian
// ---------------------------------------------------------------------------

/**
 * Label varian TEKS BEBAS, dan boleh KOSONG — beda dengan nama layanan/paket.
 * `labelVarian()` (`@/lib/varian`) sudah menerima string kosong sebagai
 * varian baku; memaksa panjang minimal di sini akan membuat admin tidak
 * pernah bisa membuat varian tak bernama lewat formulir, padahal trigger
 * `trg_terbitkan_varian_baku` justru melahirkannya begitu setiap layanan lahir.
 */
export const PANJANG_LABEL_VARIAN_MAKS = 60;

export type PeriksaLabelVarian = { ok: true; nilai: string } | { ok: false; pesan: string };

export function periksaLabelVarian(mentah: string): PeriksaLabelVarian {
  const nilai = mentah.trim();
  if (nilai.length > PANJANG_LABEL_VARIAN_MAKS) {
    return { ok: false, pesan: `Label maksimal ${PANJANG_LABEL_VARIAN_MAKS} karakter.` };
  }
  return { ok: true, nilai };
}

/**
 * Pagar salah ketik, bukan aturan bisnis: sesi klinik nyata berdurasi menit
 * hingga beberapa jam. Angka yang jauh lebih besar dari itu (mis. "9000")
 * lebih mungkin jari yang keseleo daripada layanan yang sungguh sepanjang itu.
 */
export const DURASI_VARIAN_MAKS_MENIT = 480;

/**
 * Pagar salah ketik untuk kolom urutan tampil — bukan batas jumlah varian.
 */
export const URUTAN_VARIAN_MAKS = 999;

export type PeriksaDurasiVarian =
  | { ok: true; nilai: number | null }
  | { ok: false; pesan: string };

/**
 * Durasi BOLEH kosong (varian yang tidak dibedakan durasinya, mis. per
 * program). String kosong memulangkan `null`, bukan 0 — 0 menit bukan durasi
 * yang sah untuk sesi apa pun, dan constraint `service_variants` di basis
 * data pun menolaknya (`durasi_menit is null or durasi_menit > 0`).
 */
export function periksaDurasiVarian(mentah: string): PeriksaDurasiVarian {
  const teks = mentah.trim();
  if (teks === "") return { ok: true, nilai: null };
  if (!/^\d+$/.test(teks)) {
    return { ok: false, pesan: "Durasi harus berupa angka bulat menit, atau dikosongkan." };
  }
  const nilai = Number(teks);
  if (nilai < 1) {
    return { ok: false, pesan: "Durasi minimal 1 menit." };
  }
  if (nilai > DURASI_VARIAN_MAKS_MENIT) {
    return { ok: false, pesan: `Durasi maksimal ${DURASI_VARIAN_MAKS_MENIT} menit.` };
  }
  return { ok: true, nilai };
}

export type PeriksaFormatVarian =
  | { ok: true; nilai: FormatVarian | null }
  | { ok: false; pesan: string };

/**
 * Format BOLEH kosong (varian yang tidak dibedakan Private/Circle-nya).
 * Nilai selain itu ditolak DI SINI dengan kalimat manusia — constraint
 * `varian_format` di basis data memang menolaknya juga, tetapi pesannya kode
 * Postgres, bukan kalimat yang boleh dibaca admin klinik.
 */
export function periksaFormatVarian(mentah: string): PeriksaFormatVarian {
  const teks = mentah.trim();
  if (teks === "") return { ok: true, nilai: null };
  if (teks === "private" || teks === "circle") return { ok: true, nilai: teks };
  return { ok: false, pesan: "Format varian harus Private, Circle, atau dikosongkan." };
}

/**
 * Urutan tampil, wajib angka non-negatif. Kosong jatuh ke 0 — nilai yang sama
 * dengan default kolomnya di basis data — supaya formulir "varian baru" tidak
 * memaksa admin mengisi urutan hanya untuk menaruhnya di paling depan.
 */
export function periksaUrutanVarian(mentah: string): PeriksaAngka {
  const teks = mentah.trim();
  if (teks === "") return { ok: true, nilai: 0 };
  if (!/^\d+$/.test(teks)) {
    return { ok: false, pesan: "Urutan harus berupa angka bulat non-negatif." };
  }
  const nilai = Number(teks);
  if (nilai > URUTAN_VARIAN_MAKS) {
    return { ok: false, pesan: `Urutan maksimal ${URUTAN_VARIAN_MAKS}.` };
  }
  return { ok: true, nilai };
}
