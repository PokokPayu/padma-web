import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export type AppRole = "klien" | "admin" | "owner";

export async function requireRole(allowed: AppRole[]) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/masuk");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nama")
    .eq("id", user.id)
    .single();
  const role = (profile?.role ?? "klien") as AppRole;

  if (!allowed.includes(role)) redirect("/setelah-masuk");
  return { userId: user.id, role, nama: profile?.nama ?? "" };
}
