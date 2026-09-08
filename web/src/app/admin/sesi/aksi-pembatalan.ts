"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

type Berhasil = { ok: true };
type Gagal = { ok: false; pesan: string };

/**
 * Pembungkus RPC pembatalan (spec C3 P5).
 *
 * Ditulis dengan SESI ADMIN sungguhan, bukan service role: jejak audit harus
 * menyebut aktor yang nyata, dan service role tidak punya `auth.uid()` sama
 * sekali. `src/app/admin/**` juga memang dilarang memuat service role
 * (`tests/admin-shell.test.ts`).
 */
export async function batalkanSesiAdmin(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("batalkan_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    alasan: String(formData.get("alasan") ?? ""),
    darurat: formData.get("darurat") === "on",
  });

  if (error) return { ok: false, pesan: error.message };

  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return { ok: true };
}

export async function jadwalUlangSesiAdmin(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("jadwal_ulang_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    tanggal_baru: String(formData.get("tanggal") ?? ""),
    jam_baru: String(formData.get("jam") ?? ""),
  });

  if (error) return { ok: false, pesan: error.message };

  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return { ok: true };
}
