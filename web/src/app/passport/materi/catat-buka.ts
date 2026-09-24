"use server";

import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Mencatat bahwa klien yang sedang masuk membuka sebuah materi.
 *
 * Butir 6 umpan balik klien 21 Sep 2026: "Cara tahu e book sdh diterima klien
 * gimana?" — sebelum ini, tidak bisa.
 *
 * Memakai SESI PENGGUNA, bukan service role. Itu bukan detail: RPC
 * `catat_buka_materi` menurunkan `client_id` dari `auth.uid()`, dan di bawah
 * service role `auth.uid()` adalah NULL sehingga fungsinya diam-diam tidak
 * melakukan apa pun — jejak yang tidak pernah lahir, tanpa satu pun galat.
 *
 * TIDAK melempar dan TIDAK memulangkan apa-apa. Pencatatan jejak tidak boleh
 * bisa merusak pembacaan materi: klien yang sedang hamil dan membuka
 * panduannya tidak peduli apakah angka di panel admin bertambah, dan layar
 * galat karena kegagalan mencatat adalah kerugian bersih.
 */
export async function catatBukaMateri(materiId: string): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.rpc("catat_buka_materi", { p_material_id: materiId });
}
