import { LABEL_JENJANG, type JenjangTransport } from "@/lib/transport/jarak";

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

// `LABEL_JENJANG` sendiri kini hidup di `lib/transport/jarak.ts` (Ruling 20,
// Task 9 fix round 1) — SATU-SATUNYA sumber, diimpor di atas alih-alih
// ditulis di sini. `lib/` adalah lapisan domain; `app/` (berkas ini) lapisan
// presentasi, dan domain tidak boleh diimpor NILAINYA dari presentasi.
//
// Daftar putih di bawah tetap diturunkan dari kunci label, bukan ditulis dua
// kali — dua daftar nilai yang harus identik adalah persis jenis kesalahan
// yang sudah diperingatkan pre-flight rencana ini (JenjangTransport ↔ enum
// Postgres).
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
