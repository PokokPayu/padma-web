"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { STATUS_SAH, type StatusTindakLanjut } from "./status";

export async function ubahTindakLanjut(id: string, status: string) {
  await requireRole(["admin", "owner"]);
  if (!STATUS_SAH.includes(status as StatusTindakLanjut)) return;

  // RLS "screenings: staf" yang menjadi penjaga sesungguhnya — kita memakai
  // sesi pengguna (bukan service role) supaya haknya ikut diperiksa Postgres.
  // Hanya kolom status yang disentuh: hasil/flags/jawaban adalah rekaman
  // jawaban asli klien dan tidak boleh bisa diedit dari inbox.
  const supabase = await createServerSupabase();
  await supabase.from("screenings").update({ status_tindak_lanjut: status }).eq("id", id);
  revalidatePath("/admin/skrining");
}
