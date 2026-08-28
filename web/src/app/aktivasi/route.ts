import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { COOKIE_UNDANGAN } from "@/lib/auth/link-client";

/**
 * Titik masuk tautan aktivasi dari pesan sambutan WhatsApp:
 *   /aktivasi?token=<token undangan>
 *
 * Tugasnya cuma satu: memindahkan token dari URL ke cookie httpOnly, lalu
 * mengarahkan ke login. Alasannya:
 *   - token tidak lagi ikut di URL halaman-halaman berikutnya (riwayat browser,
 *     Referer, log akses server);
 *   - klien boleh login dengan cara apa pun (email+sandi atau Google OAuth yang
 *     memutar lewat callback) tanpa token harus dititipkan di query string
 *     sepanjang perjalanan itu.
 *
 * Umur cookie sengaja pendek (1 jam): cukup untuk menyelesaikan login, tidak
 * cukup untuk tertinggal di perangkat bersama. Token itu sendiri tetap sekali
 * pakai dan berumur terbatas di sisi server.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();

  if (!token) {
    // Tautan tanpa token bukan error mentah — arahkan ke halaman ramah.
    return NextResponse.redirect(new URL("/akun-belum-terhubung", url.origin));
  }

  // Sudah login? Langsung ke /setelah-masuk supaya penautan terjadi sekarang.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const response = NextResponse.redirect(
    new URL(user ? "/setelah-masuk" : "/masuk", url.origin),
  );
  response.cookies.set(COOKIE_UNDANGAN, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
  return response;
}
