import { createAdminSupabase } from "@/lib/supabase/admin";

// `app_settings` sengaja tertutup untuk anon (migration cabut_grant_anon_berlebih),
// jadi nomor WA hanya bisa dibaca dari server dengan service role.
export async function bacaPengaturan() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .eq("key", "nomor_wa")
    .maybeSingle();

  const link = (data?.value ?? "6287778400200").replace(/\D/g, "");
  return { nomorWaLink: link, nomorWaTampilan: keFormatLokal(link) };
}

// 6287778400200 -> 0877-7840-0200
function keFormatLokal(internasional: string): string {
  const lokal = internasional.startsWith("62")
    ? "0" + internasional.slice(2)
    : internasional;
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}
