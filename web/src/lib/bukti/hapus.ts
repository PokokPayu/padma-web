import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * MENGHAPUS OBJEK BUKTI BAYAR dari bucket privat.
 *
 * Tinggal di `lib/`, bukan di server action, dan itu bukan kerapian:
 * `tests/admin-shell.test.ts` melarang service role hidup di dalam
 * `src/app/admin/**` kecuali titik yang disebut eksplisit. Alasannya masuk
 * akal — halaman & action admin adalah permukaan yang paling sering disunting,
 * dan kunci yang menembus seluruh RLS tidak boleh tersebar di sana.
 *
 * Service role memang dibutuhkan DI SINI: bucket `bukti-bayar` sengaja tidak
 * punya satu pun policy, jadi tidak ada peran API yang bisa menghapus
 * objeknya. Yang TIDAK memakai service role adalah tulisan ke
 * `booking_requests` — itu tetap lewat sesi admin sungguhan supaya jejak
 * auditnya beraktor nyata.
 */
export async function hapusObjekBukti(kunci: string): Promise<boolean> {
  const admin = createAdminSupabase();
  const { error } = await admin.storage.from("bukti-bayar").remove([kunci]);
  return !error;
}
