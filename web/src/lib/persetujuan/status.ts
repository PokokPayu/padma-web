import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { VERSI_DOKUMEN } from "./versi";

export type StatusPersetujuan = {
  /** Sudah menyetujui versi yang berlaku sekarang. */
  sudahSetuju: boolean;
  /** Pernah menyetujui versi apa pun — membedakan "baru" dari "diperbarui". */
  pernahSetuju: boolean;
};

/**
 * SATU-SATUNYA pembaca `persetujuan_akun`. Dipakai layout `/passport`,
 * halaman `/persetujuan`, dan rute checkout — lewat `statusPersetujuan`.
 *
 * ===== GAGAL-TERBUKA, DAN ITU DISENGAJA =====
 * Galat baca dicatat lalu dianggap SUDAH setuju. Gerbang ini pencatat
 * persetujuan, bukan batas keamanan (spec 2026-10-06). Kebalikannya —
 * gagal-tertutup — mengubah satu migrasi yang terlambat diterapkan menjadi
 * SELURUH klien terkunci di layar `/persetujuan`, yang penulisannya gagal
 * karena sebab yang sama. Klien yang lolos gerbang hari ini akan ditahan lagi
 * pada kunjungan berikutnya begitu tabelnya terbaca.
 */
export async function bacaStatusPersetujuan(
  supabase: SupabaseClient,
  userId: string,
): Promise<StatusPersetujuan> {
  const { data, error } = await supabase
    .from("persetujuan_akun")
    .select("versi")
    .eq("user_id", userId);
  if (error) {
    console.error("[persetujuan] status tidak terbaca, gerbang dibuka:", error.message);
    return { sudahSetuju: true, pernahSetuju: true };
  }
  const versi = ((data ?? []) as { versi: string }[]).map((b) => b.versi);
  return { sudahSetuju: versi.includes(VERSI_DOKUMEN), pernahSetuju: versi.length > 0 };
}

/** Dibungkus `cache`: layout dan halaman di request yang sama membaca SEKALI. */
export const statusPersetujuan = cache(
  async (userId: string): Promise<StatusPersetujuan> =>
    bacaStatusPersetujuan(await createServerSupabase(), userId),
);
