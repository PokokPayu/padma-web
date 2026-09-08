import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import { COOKIE_UNDANGAN } from "@/lib/auth/link-client";
import { pastikanKlien } from "@/lib/auth/pastikan-klien";

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

  // Klien. Seluruh keputusan penautan — termasuk urutannya, yang justru
  // merupakan keamanannya — hidup di SATU tempat: `pastikanKlien`. Rute ini
  // sengaja tidak menyimpan cabang keamanannya sendiri; aturan yang disalin ke
  // dua tempat adalah aturan yang bisa berpisah diam-diam, dan begitulah kedua
  // celah penautan terdahulu lahir (lihat src/lib/auth/link-client.ts).
  const jar = await cookies();
  const token = jar.get(COOKIE_UNDANGAN)?.value ?? "";

  const tujuan = await pastikanKlien(user, token);

  const response = NextResponse.redirect(new URL(tujuan, url.origin));
  // Token dibuang apa pun hasilnya — sekali pakai berarti juga sekali coba.
  if (token) response.cookies.delete(COOKIE_UNDANGAN);
  return response;
}
