import type { SupabaseClient } from "@supabase/supabase-js";
import { VERSI_DOKUMEN } from "./versi";

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
 */
export async function catatPersetujuanDariCookie(
  supabase: SupabaseClient,
  userId: string,
  nilaiCookie: string | undefined,
): Promise<boolean> {
  if (nilaiCookie !== VERSI_DOKUMEN) return false;
  return catatPersetujuan(supabase, userId, "daftar");
}
