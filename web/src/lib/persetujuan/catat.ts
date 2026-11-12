import type { SupabaseClient } from "@supabase/supabase-js";
import { VERSI_DOKUMEN } from "./versi";
import { UMUR_COOKIE_SETUJU_DETIK } from "./cookie";

export type JalurPersetujuan = "daftar" | "gerbang";

/**
 * SATU-SATUNYA penulis `persetujuan_akun` di kode aplikasi.
 *
 * Ditulis dengan SESI KLIEN itu sendiri (policy insert `user_id =
 * auth.uid()`), bukan service role: persetujuan adalah tindakan pemilik akun.
 *
 * Mengembalikan boolean dan TIDAK PERNAH melempar — `/setelah-masuk`
 * memanggilnya di tengah login, dan gagal mencatat tidak boleh menggagalkan
 * login (gerbang menangkap klien itu nanti).
 *
 * Bentrok primary key (`23505`) = versi ini sudah tercatat = sukses. Cookie
 * daftar dan gerbang bisa mencatat versi yang sama dua kali, dan klik ganda
 * juga; tidak satu pun pantas membuat klien diminta setuju lagi.
 */
export async function catatPersetujuan(
  supabase: SupabaseClient,
  userId: string,
  jalur: JalurPersetujuan,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("persetujuan_akun")
      .insert({ user_id: userId, versi: VERSI_DOKUMEN, jalur });
    if (!error || error.code === "23505") return true;
    console.error("[persetujuan] gagal mencatat:", error.message);
    return false;
  } catch (e) {
    console.error("[persetujuan] gagal mencatat:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Dipanggil `/setelah-masuk` dengan nilai cookie `padma_setuju`.
 *
 * Cookie berversi LAMA tidak dicatat: pemiliknya mencentang teks yang sudah
 * diganti sejak itu, dan mencatatnya sebagai persetujuan versi baru adalah
 * memalsukan persetujuan. Gerbang akan memintanya membaca versi yang baru.
 *
 * ===== HANYA UNTUK AKUN YANG BARU LAHIR =====
 * Cookie ini tidak terikat identitas. Ia bisa tertinggal di peramban bersama —
 * signUp yang gagal, Google yang dibatalkan, konfirmasi email di perangkat
 * lain — lalu terbawa ke login orang LAIN dalam 24 jam. Karena cookie ini hanya
 * pernah dititipkan oleh form pendaftaran, akun yang lebih tua dari umur
 * cookie pasti bukan pemiliknya: persetujuannya tidak dicatat, dan gerbang
 * `/persetujuan` yang memintanya sendiri (temuan review akhir #1).
 */
export async function catatPersetujuanDariCookie(
  supabase: SupabaseClient,
  akun: { id: string; created_at?: string },
  nilaiCookie: string | undefined,
  sekarang: Date = new Date(),
): Promise<boolean> {
  if (nilaiCookie !== VERSI_DOKUMEN) return false;
  const lahir = akun.created_at ? Date.parse(akun.created_at) : Number.NaN;
  if (!Number.isFinite(lahir) || sekarang.getTime() - lahir > UMUR_COOKIE_SETUJU_DETIK * 1000) {
    return false;
  }
  return catatPersetujuan(supabase, akun.id, "daftar");
}
