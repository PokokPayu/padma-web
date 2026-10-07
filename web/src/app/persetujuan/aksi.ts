"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { catatPersetujuan } from "@/lib/persetujuan/catat";
import { tujuanPersetujuanAman } from "@/lib/persetujuan/tujuan";

/**
 * Persetujuan dari layar gerbang (spec 2026-10-06).
 *
 * `lanjut` disaring ULANG di sini, bukan dipercaya dari input tersembunyi —
 * form bisa dikirim siapa saja dengan isian apa saja. Versi dicap
 * `catatPersetujuan` dari konstanta; form tidak membawa nomor versi.
 */
export async function setujuiDokumen(formData: FormData): Promise<void> {
  const { userId } = await requireRole(["klien"]);
  const tujuan = tujuanPersetujuanAman(formData.get("lanjut"));
  const kembali = `/persetujuan?lanjut=${encodeURIComponent(tujuan)}`;

  if (formData.get("setuju") !== "ya") redirect(kembali);

  const supabase = await createServerSupabase();
  if (!(await catatPersetujuan(supabase, userId, "gerbang"))) redirect(`${kembali}&gagal=1`);

  redirect(tujuan);
}
