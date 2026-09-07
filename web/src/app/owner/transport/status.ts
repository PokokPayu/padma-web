/**
 * Label, batas, dan validator MURNI modul Transport — rate card per jenjang
 * jarak (`transport_rates`) dan tarif khusus >20 km per sesi
 * (`transport_khusus`).
 *
 * Berkas server action hanya boleh mengekspor fungsi async, jadi setiap
 * konstanta dan validator yang dipakai bersama oleh formulir (client
 * component) dan server action tinggal di sini — pola yang sama dengan
 * `owner/tarif/status.ts`, `admin/layanan/status.ts`, dan `admin/sesi/status.ts`.
 * Berkas ini sendiri sengaja BUKAN modul server action.
 */

import { geserHari } from "@/lib/owner/pekan";
import { JENJANG_TARIF_RATE_CARD } from "@/lib/transport/tarif";
import { LABEL_JENJANG, JENJANG_SAH } from "@/app/admin/sesi/status";

// Label & daftar putih jenjang dipakai ULANG dari modul Sesi admin, BUKAN
// ditulis kedua kalinya di sini. `LABEL_JENJANG` di sana sudah dijaga tipe
// `Record<JenjangTransport, string>`, yang berarti TypeScript menolak build
// bila satu anggota enum `jenjang_transport` hilang; menyalinnya ke berkas
// ini akan melahirkan DUA daftar berlabel yang bisa berbeda nama pada
// perubahan berikutnya — persis kelas bug yang diperingatkan berulang kali
// di proyek ini ("dua definisi yang berpisah diam-diam").
export { LABEL_JENJANG, JENJANG_SAH };
export { JENJANG_TARIF_RATE_CARD };

/**
 * Batas atas nominal — pagar terhadap SALAH KETIK, bukan aturan bisnis.
 * Nilainya sama persis dengan rate card varian (`owner/tarif/status.ts`):
 * tarif transport tetap tarif per sesi, bukan kelas nominal yang berbeda.
 */
export const NOMINAL_MAKS = 100_000_000;

export type PeriksaNominal = { ok: true; nilai: number } | { ok: false; pesan: string };

/**
 * Memeriksa nominal sebagai TEKS sebelum ia menjadi angka. Logika PERSIS sama
 * dengan `periksaNominal` di `owner/tarif/status.ts` — lihat komentarnya untuk
 * alasan lengkap kenapa `Number("")`, `"1e6"`, dan `"400_000"` semua ditolak.
 */
export function periksaNominal(mentah: string, label: string): PeriksaNominal {
  const teks = mentah.trim();
  if (!/^\d+$/.test(teks)) {
    return { ok: false, pesan: `${label} harus berupa angka rupiah bulat, tanpa titik atau koma.` };
  }
  const nilai = Number(teks);
  if (!Number.isSafeInteger(nilai)) {
    return { ok: false, pesan: `${label} terlalu besar untuk dihitung dengan tepat.` };
  }
  if (nilai > NOMINAL_MAKS) {
    return {
      ok: false,
      pesan: `${label} maksimal Rp ${NOMINAL_MAKS.toLocaleString("id-ID")} — periksa kembali jumlah nolnya.`,
    };
  }
  return { ok: true, nilai };
}

export type PeriksaTanggal = { ok: true; nilai: string } | { ok: false; pesan: string };

/**
 * Memeriksa `berlaku_sejak` sebagai string YYYY-MM-DD. Logika PERSIS sama
 * dengan `periksaTanggal` di `owner/tarif/status.ts` — kesahihan kalendernya
 * dibuktikan lewat perjalanan pulang `geserHari(tgl, 0)`, bukan `new Date()`.
 */
export function periksaTanggal(mentah: string): PeriksaTanggal {
  const teks = mentah.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) {
    return { ok: false, pesan: "Tanggal berlaku harus berbentuk YYYY-MM-DD." };
  }
  let kanonik: string;
  try {
    kanonik = geserHari(teks, 0);
  } catch {
    return { ok: false, pesan: "Tanggal berlaku tidak sah." };
  }
  if (kanonik !== teks) {
    return { ok: false, pesan: `Tanggal berlaku ${teks} tidak ada di kalender.` };
  }
  return { ok: true, nilai: teks };
}

/**
 * Kalimat penolakan — satu-satunya daftar putihnya. Yang sampai ke layar
 * pemiliknya tidak boleh berupa SQLSTATE.
 */
export const PESAN = {
  // --- Rate card (tetapkanTarifTransport) ---
  jenjangWajib: "Jenjang wajib dipilih.",
  jenjangTakDikenal: "Jenjang tidak dikenal. Pilih salah satu jenjang yang tersedia.",
  jenjangPerKasus:
    "Jenjang >20 km bukan tarif rate card — nominalnya ditetapkan owner per kasus lewat daftar sesi menunggu, bukan lewat formulir ini.",
  kembar: "Sudah ada tarif untuk jenjang ini pada tanggal tersebut.",
  mundur: "Tarif baru harus berlaku setelah tarif terakhir jenjang ini",
  takWajar: "Nilai tarif tidak wajar.",
  gagal: "Gagal menyimpan tarif.",
  tidakTersimpan: "Tarif tidak tersimpan. Panel ini hanya untuk pemilik.",

  // --- Tarif khusus (tetapkanTarifKhusus) ---
  sesiWajib: "Sesi wajib dipilih.",
  sesiTakDikenal: "Sesi tidak dikenal.",
  sesiBukanDiAtas20:
    "Sesi ini tidak berjenjang di atas 20 km — tarif khusus hanya berlaku untuk jenjang itu.",
  sudahDitetapkan: "Sesi ini sudah punya tarif khusus, dan tidak bisa diubah lewat formulir ini.",
  tidakTersimpanKhusus: "Tarif khusus tidak tersimpan. Panel ini hanya untuk pemilik.",
} as const;

/**
 * Terjemahan kode Postgres yang mungkin muncul dari `transport_rates`.
 * Pagarnya (UNIQUE per tanggal, trigger penolak tanggal mundur, CHECK nilai
 * wajar) adalah lapisan TERAKHIR — pemeriksaan di server action berjalan
 * lebih dulu supaya pesannya berupa kalimat. Terjemahan ini tetap ada karena
 * dua pemanggil serentak bisa lolos pemeriksaan aplikasi bersama-sama dan
 * hanya salah satu yang dimenangkan basis data.
 */
export function pesanKodePostgres(kode: string | undefined): string {
  if (kode === "23505") return PESAN.kembar;
  if (kode === "42501") return `${PESAN.mundur}.`;
  if (kode === "23514") return PESAN.takWajar;
  return PESAN.gagal;
}
