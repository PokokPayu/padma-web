import type { SupabaseClient } from "@supabase/supabase-js";
// Impor RELATIF, bukan alias `@/`: berkas ini dipakai juga oleh skrip e2e
// (`tsx tests/e2e/*.e2e.ts`) yang tidak mengenal alias vitest.
import { VERSI_DOKUMEN } from "../../src/lib/persetujuan/versi";

/**
 * Fixture: akun uji dianggap SUDAH menyetujui S&K + Kebijakan Privasi versi
 * berlaku, supaya layout `/passport` dan rute checkout tidak membelokkannya ke
 * `/persetujuan`. Lewat service role — ini setup, bukan alur pengguna.
 * Idempoten.
 */
export async function setujuiDokumenUntukUji(svc: SupabaseClient, userId: string): Promise<void> {
  const { error } = await svc
    .from("persetujuan_akun")
    .upsert(
      { user_id: userId, versi: VERSI_DOKUMEN, jalur: "gerbang" },
      { onConflict: "user_id,versi", ignoreDuplicates: true },
    );
  if (error) throw error;
}
