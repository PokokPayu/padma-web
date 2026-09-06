import type { JenjangTransport } from "@/lib/transport/jarak";

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

// Status SESI (enum `session_status`) — berbeda dari status PERMINTAAN di atas.
// Keduanya sengaja tidak digabung: permintaan yang `ditolak` dan sesi yang
// `batal` terdengar mirip tetapi hidup di tabel berbeda, dan menyatukan
// labelnya adalah cara paling mudah menampilkan status yang salah.
export const STATUS_SESI_SAH = ["terjadwal", "selesai", "batal"] as const;

export type StatusSesi = (typeof STATUS_SESI_SAH)[number];

export const LABEL_STATUS_SESI: Record<StatusSesi, string> = {
  terjadwal: "Terjadwal",
  selesai: "Selesai",
  batal: "Batal",
};

// Label JENJANG persis penulisan materi klien ("0–5 km" lalu ">5–10 km" dst,
// lihat `jenjangDariJarak` di `lib/transport/jarak.ts`). `Record<JenjangTransport, …>`
// dipakai justru supaya daftar ini TIDAK BISA diam-diam kehilangan satu jenjang
// atau punya nama yang menyimpang dari enum `jenjang_transport` — TypeScript
// menolak build bila salah satu anggota tipe itu tidak disebut di sini.
export const LABEL_JENJANG: Record<JenjangTransport, string> = {
  "0_5": "0–5 km",
  "5_10": ">5–10 km",
  "10_15": ">10–15 km",
  "15_20": ">15–20 km",
  di_atas_20: ">20 km",
};

// Daftar putih diturunkan dari kunci label, bukan ditulis dua kali — dua
// daftar nilai yang harus identik adalah persis jenis kesalahan yang sudah
// diperingatkan pre-flight rencana ini (JenjangTransport ↔ enum Postgres).
export const JENJANG_SAH = Object.keys(LABEL_JENJANG) as JenjangTransport[];

/**
 * Alasan penimpaan admin — divalidasi sebagai fungsi MURNI (pola yang sama
 * dengan `periksaAlamat` di modul Passport/Klien/Mitra), supaya server action
 * bisa memulangkan KALIMAT ("Alasan penimpaan wajib diisi…") dan bukan sekadar
 * kode galat CHECK basis data. CHECK `sessions_alasan_penimpaan` tetap ada
 * sebagai lapisan TERAKHIR, bukan satu-satunya.
 *
 * Panjang minimal kecil (5 karakter) sengaja bukan nol: penimpaan tanpa alasan
 * adalah penimpaan yang tidak bisa dipelajari (spec T4), dan satu-dua huruf
 * seperti "ya" atau "ok" tidak menjawab pertanyaan yang kelak diajukan siapa
 * pun yang membaca riwayatnya: seberapa sering geocoding meleset, dan kenapa.
 */
export function periksaAlasanPenimpaan(
  mentah: string,
): { ok: true; nilai: string } | { ok: false; pesan: string } {
  const teks = mentah.trim();
  if (teks.length < 5) {
    return {
      ok: false,
      pesan: "Alasan penimpaan wajib diisi — tuliskan kenapa jenjang ini berbeda dari saran.",
    };
  }
  return { ok: true, nilai: teks };
}
