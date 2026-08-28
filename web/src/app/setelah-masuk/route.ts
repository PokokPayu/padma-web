import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { linkClientByEmail } from "@/lib/auth/link-client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/masuk", url.origin));

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role ?? "klien";

  if (role === "owner") return NextResponse.redirect(new URL("/owner", url.origin));
  if (role === "admin") return NextResponse.redirect(new URL("/admin", url.origin));

  const linked = await linkClientByEmail(user.id, user.email ?? "");
  return NextResponse.redirect(
    new URL(linked ? "/passport" : "/akun-belum-terhubung", url.origin),
  );
}
