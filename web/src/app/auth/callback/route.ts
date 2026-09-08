import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { tujuanAman } from "@/lib/auth/tujuan-aman";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  // `next` lewat query string, jadi lewat `tujuanAman` — daftar putih, bukan
  // dipakai mentah. Lihat komentar di tujuan-aman.ts untuk alasan open
  // redirect-nya.
  const tujuan = tujuanAman(url.searchParams.get("next"));
  return NextResponse.redirect(new URL(tujuan, url.origin));
}
