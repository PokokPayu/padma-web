import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  // 303 WAJIB, jangan hapus statusnya. Tombol keluar sengaja
  // `<form method="post">` (lihat `_shell/tombol-keluar.tsx`), sementara
  // `NextResponse.redirect()` tanpa status memakai 307 — yang MEMPERTAHANKAN
  // method. Peramban lalu mem-POST ke `/masuk`, halaman yang hanya punya GET,
  // dan pemakai mendarat di HTTP 405 padahal sesinya sudah terhapus. Hanya 303
  // yang menurut definisinya menurunkan POST menjadi GET.
  return NextResponse.redirect(new URL("/masuk", new URL(request.url).origin), 303);
}
