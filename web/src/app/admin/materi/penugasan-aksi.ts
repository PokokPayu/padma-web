"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

type Hasil = { ok: true } | { ok: false; pesan: string };

/**
 * Membuka satu materi untuk satu pasien, terlepas dari layanan yang ia jalani.
 *
 * `ditugaskan_oleh` SENGAJA tidak dikirim dari sini: trigger
 * `trg_paksa_aktor_penugasan` mengisinya dari `auth.uid()`. Mengirimnya dari
 * kode berarti membuat aktornya bisa dipalsukan oleh siapa pun yang bisa
 * memanggil action ini.
 */
export async function tugaskanMateri(materiId: string, clientId: string): Promise<Hasil> {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("material_assignments")
    .insert({ material_id: materiId, client_id: clientId })
    .select("material_id");

  if (error) {
    if (error.code === "23505") return { ok: false, pesan: "Pasien ini sudah ditugaskan." };
    return { ok: false, pesan: "Gagal menugaskan materi." };
  }
  // PostgREST menjawab 200 + [] untuk tulis yang ditolak RLS, bukan error.
  if (!data || data.length === 0) return { ok: false, pesan: "Penugasan ditolak." };

  revalidatePath("/admin/materi");
  return { ok: true };
}

export async function cabutTugasMateri(materiId: string, clientId: string): Promise<Hasil> {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("material_assignments")
    .delete()
    .eq("material_id", materiId)
    .eq("client_id", clientId)
    .select("material_id");

  if (error) return { ok: false, pesan: "Gagal mencabut penugasan." };
  if (!data || data.length === 0) return { ok: false, pesan: "Penugasan tidak ditemukan." };

  revalidatePath("/admin/materi");
  return { ok: true };
}
