// Daftar putih & label modul Pembayaran.
//
// Berkas terpisah karena modul `"use server"` (aksi.ts) HANYA boleh mengekspor
// fungsi async — satu konstanta di sana sudah cukup menggagalkan `next build`.
// Preseden yang diikuti: `admin/sesi/status.ts` dan `admin/skrining/status.ts`.

import type { PayStatus } from "@/lib/passport/turunan";

export const LABEL_BAYAR: Record<PayStatus, string> = {
  belum: "Belum dibayar",
  menunggu_verifikasi: "Menunggu verifikasi",
  lunas: "Lunas",
};

// Kelas pill disimpan bersama labelnya supaya keduanya tidak pernah berpisah:
// pill hijau bertuliskan "Belum dibayar" adalah kebohongan yang lolos review.
export const KELAS_PILL: Record<PayStatus, string> = {
  belum: "bg-clay/10 text-clay",
  menunggu_verifikasi: "bg-[#F7EDD3] text-[#8A6A1B]",
  lunas: "bg-leaf-soft text-leaf",
};

/**
 * LAPIS PERTAMA PENEGAKAN TRANSISI. Lapis kedua ada di klausa `WHERE` tiap
 * action (`.in("status_bayar", ...)`), lapis ketiga di trigger basis data.
 *
 * Tiga lapis bukan kemewahan: policy `"sessions: staf"` adalah `FOR ALL`, dan
 * yang benar-benar dijaga trigger hanya DUA kelas transisi — `lunas -> apa pun`
 * dan INSERT berstatus non-'belum'. Enam dari sembilan kombinasi tidak dijaga
 * basis data sama sekali, jadi penegakannya harus hidup di aplikasi.
 *
 * `lunas -> apa pun` sengaja TIDAK ada di daftar mana pun: membalik status
 * sesudah rekap pekan berjalan adalah rekonsiliasi, bukan toggle. DB pun
 * menolaknya (42501) — dan admin tidak boleh melihat kode Postgres.
 */
export const ASAL_SAH_LUNAS: PayStatus[] = ["belum", "menunggu_verifikasi"];

// Menolak klaim hanya masuk akal bila ada klaim yang bisa ditolak. Baris
// 'belum' tidak sedang mengklaim apa pun; menolaknya adalah operasi kosong
// yang tetap menulis satu baris jejak audit palsu.
export const ASAL_SAH_TOLAK: PayStatus[] = ["menunggu_verifikasi"];
