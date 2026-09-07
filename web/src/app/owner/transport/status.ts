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
import { JENJANG_SAH } from "@/app/admin/sesi/status";

// Daftar putih jenjang dipakai ULANG dari modul Sesi admin, BUKAN ditulis
// kedua kalinya di sini — persis kelas bug yang diperingatkan berulang kali
// di proyek ini ("dua definisi yang berpisah diam-diam").
//
// `LABEL_JENJANG` TIDAK di re-export lagi dari sini (Ruling 20, Task 9 fix
// round 1): pengimpornya (`owner/transport/page.tsx`) kini mengambilnya
// LANGSUNG dari `@/lib/transport/jarak`, SATU-SATUNYA sumber — re-export
// berantai lib → app/admin/sesi/status → app/owner/transport/status hanya
// menambah satu titik lagi yang bisa diam-diam berpisah dari sumbernya.
export { JENJANG_SAH };
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
  gagalKhusus: "Gagal menyimpan tarif khusus.",
} as const;

/**
 * Terjemahan kode Postgres yang mungkin muncul dari INSERT `transport_rates`
 * (rate card per jenjang). Pagarnya (UNIQUE per tanggal, trigger penolak
 * tanggal mundur, CHECK nilai wajar) adalah lapisan TERAKHIR — pemeriksaan di
 * server action berjalan lebih dulu supaya pesannya berupa kalimat.
 * Terjemahan ini tetap ada karena dua pemanggil serentak bisa lolos
 * pemeriksaan aplikasi bersama-sama dan hanya salah satu yang dimenangkan
 * basis data.
 */
export function pesanKodePostgres(kode: string | undefined): string {
  if (kode === "23505") return PESAN.kembar;
  if (kode === "42501") return `${PESAN.mundur}.`;
  if (kode === "23514") return PESAN.takWajar;
  return PESAN.gagal;
}

/**
 * Terjemahan kode Postgres yang mungkin muncul dari INSERT `transport_khusus`
 * (tarif PER SESI). SENGAJA terpisah dari `pesanKodePostgres()` di atas:
 * `transport_khusus` tidak punya kolom `berlaku_sejak` maupun trigger penolak
 * tanggal mundur sama sekali — kalimat "tarif baru harus berlaku setelah
 * tarif terakhir jenjang ini" (dipetakan dari 42501 di fungsi rate card) tidak
 * bermakna apa pun untuk sesi PER KASUS ini, dan memetakannya begitu saja ke
 * sini adalah menempelkan penjelasan yang salah pada kegagalan yang benar.
 *
 * 23505 (session_id kembar) sudah ditangkap TERPISAH di `tetapkanTarifKhusus`
 * SEBELUM memanggil fungsi ini, dengan pesan yang benar-benar menjelaskan
 * situasinya (`PESAN.sudahDitetapkan`) — cabang di sini hanya jaring pengaman
 * bila kode itu lolos dari pemeriksaan eksplisit tersebut.
 */
export function pesanKodePostgresKhusus(kode: string | undefined): string {
  if (kode === "23505") return PESAN.sudahDitetapkan;
  if (kode === "23514") return PESAN.takWajar;
  if (kode === "23503") return PESAN.sesiTakDikenal;
  return PESAN.gagalKhusus;
}
