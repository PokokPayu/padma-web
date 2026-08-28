import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  COOKIE_UNDANGAN,
  isClientLinked,
  linkClientByInvite,
} from "@/lib/auth/link-client";

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

  // Klien. Login kedua dan seterusnya tidak membawa token: yang menentukan
  // adalah `clients.user_id` yang sudah terbukti lewat aktivasi bertoken.
  // Penautan BARU hanya boleh terjadi dengan token undangan — mencocokkan email
  // saja pernah membuat siapa pun yang menebak alamat email klien merebut rekam
  // medisnya (lihat src/lib/auth/link-client.ts).
  const jar = await cookies();
  const token = jar.get(COOKIE_UNDANGAN)?.value ?? "";

  let linked = await isClientLinked(user.id);
  if (!linked && token) {
    linked = await linkClientByInvite(user.id, user.email ?? "", token);
  }

  const response = NextResponse.redirect(
    new URL(linked ? "/passport" : "/akun-belum-terhubung", url.origin),
  );
  // Token dibuang apa pun hasilnya — sekali pakai berarti juga sekali coba.
  if (token) response.cookies.delete(COOKIE_UNDANGAN);
  return response;
}
