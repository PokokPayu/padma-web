/**
 * Label, batas, dan validator MURNI modul Rate Card.
 *
 * Berkas server action hanya boleh mengekspor fungsi async, jadi setiap
 * konstanta dan validator yang dipakai bersama oleh formulir (client component)
 * dan server action tinggal di sini — pola yang sama dengan
 * `admin/layanan/status.ts` dan `admin/sesi/status.ts`. Berkas ini sendiri
 * sengaja BUKAN modul server action: ia diimpor client component, dan direktif
 * itu akan mengubah setiap konstanta di bawah menjadi rujukan jaringan.
 */

import { geserHari } from "@/lib/owner/pekan";

/**
 * Batas atas nominal — pagar terhadap SALAH KETIK, bukan aturan bisnis.
 *
 * Satu nol kelebihan pada `harga_klien` tidak menghasilkan satu pun error: ia
 * hanya membuat margin PADMA di beranda owner melonjak sepuluh kali lipat, dan
 * angka itu terlihat "benar" karena memang begitulah hasil perkaliannya. Sesi
 * PADMA berharga ratusan ribu rupiah; seratus juta per sesi sudah jauh di luar
 * segala kemungkinan sah.
 */
export const NOMINAL_MAKS = 100_000_000;

export type PeriksaNominal = { ok: true; nilai: number } | { ok: false; pesan: string };

/**
 * Memeriksa nominal sebagai TEKS sebelum ia menjadi angka.
 *
 * `Number("")` adalah 0 dan `Number(" 400000 ")` adalah 400000 — keduanya lolos
 * `Number.isInteger(n) && n >= 0` tanpa pernah menyerupai angka yang diketik
 * manusia. Nol rupiah yang lolos diam-diam bukan sekadar data kotor: ia ikut
 * menghitung honor setiap pekan sesudahnya, dan seorang bidan dibayar nol tanpa
 * satu pun baris merah di mana pun.
 *
 * `1e6` dan `400_000` sengaja ikut ditolak: keduanya sah bagi `Number()` tetapi
 * bukan sesuatu yang pernah diketik ke medan rupiah.
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
 * Memeriksa `berlaku_sejak` sebagai string YYYY-MM-DD.
 *
 * Regex saja tidak cukup: "2026-02-31" cocok dengan polanya dan tetap bukan
 * tanggal. Kesahihan kalendernya dibuktikan dengan PERJALANAN PULANG lewat
 * `geserHari(tgl, 0)` — aritmatika bilangan bulat murni di `lib/owner/pekan.ts`
 * yang mengembalikan bentuk kanonik. Bila hasilnya berbeda dari masukan,
 * tanggalnya tidak ada di kalender.
 *
 * `new Date(teks)` sengaja TIDAK dipakai untuk memeriksanya: ia menafsirkan
 * YYYY-MM-DD sebagai tengah malam UTC lalu dibaca dengan getter lokal, dan
 * itulah kelas bug yang membuat `mondayOf` prototipe meleset satu hari penuh
 * di zona barat.
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
 * Kalimat penolakan — satu-satunya daftar putihnya.
 *
 * Yang sampai ke layar pemiliknya tidak boleh berupa SQLSTATE. Kode-kode di
 * bawah lahir dari pagar basis data yang memang dirancang untuk modul ini, jadi
 * masing-masing punya terjemahannya sendiri; sisanya jatuh ke kalimat umum
 * ketimbang membocorkan pesan Postgres apa adanya.
 */
export const PESAN = {
  layananWajib: "Layanan wajib dipilih.",
  layananTakDikenal: "Layanan tidak dikenal. Pilih salah satu layanan yang ada.",
  honorMelebihiHarga: "Honor mitra tidak boleh melebihi harga klien.",
  kembar: "Sudah ada tarif untuk layanan ini pada tanggal tersebut.",
  mundur: "Tarif baru harus berlaku setelah tarif terakhir layanan ini",
  takWajar: "Nilai tarif tidak wajar.",
  gagal: "Gagal menyimpan tarif.",
  tidakTersimpan: "Tarif tidak tersimpan. Panel ini hanya untuk pemilik.",
} as const;

/**
 * Terjemahan kode Postgres yang mungkin muncul dari `service_rates`.
 *
 * Pagar basis datanya (UNIQUE per tanggal, CHECK nilai wajar, trigger penolak
 * tanggal mundur) adalah lapisan TERAKHIR — pemeriksaan di server action
 * berjalan lebih dulu supaya pesannya berupa kalimat. Terjemahan ini tetap ada
 * karena dua pemanggil serentak bisa lolos pemeriksaan aplikasi bersama-sama
 * dan hanya salah satu yang dimenangkan basis data.
 */
export function pesanKodePostgres(kode: string | undefined): string {
  if (kode === "23505") return PESAN.kembar;
  if (kode === "42501") return `${PESAN.mundur}.`;
  if (kode === "23514") return PESAN.takWajar;
  if (kode === "23503") return PESAN.layananTakDikenal;
  return PESAN.gagal;
}
