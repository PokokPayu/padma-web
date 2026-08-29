// Daftar putih & label modul Sesi.
//
// Berkas terpisah karena modul `"use server"` (aksi.ts) HANYA boleh mengekspor
// fungsi async — satu konstanta di sana sudah cukup menggagalkan `next build`.
// Preseden yang diikuti: `admin/skrining/status.ts`.
//
// Memisahkannya juga membuat UI dan server memakai satu sumber yang sama:
// preferensi waktu yang bisa muncul di antrean persis nilai enum `waktu_pref`
// di basis data, dan status permintaan persis enum `booking_status`.

export const WAKTU_SAH = ["pagi", "siang", "sore"] as const;

export type PreferensiWaktu = (typeof WAKTU_SAH)[number];

export const LABEL_WAKTU: Record<PreferensiWaktu, string> = {
  pagi: "Pagi",
  siang: "Siang",
  sore: "Sore",
};

export const STATUS_PERMINTAAN_SAH = [
  "menunggu",
  "dikonfirmasi",
  "ditolak",
] as const;

export type StatusPermintaan = (typeof STATUS_PERMINTAAN_SAH)[number];

export const LABEL_STATUS_PERMINTAAN: Record<StatusPermintaan, string> = {
  menunggu: "Menunggu",
  dikonfirmasi: "Dikonfirmasi",
  ditolak: "Ditolak",
};
