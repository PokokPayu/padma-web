// Next.js 16: konvensi `middleware.ts` sudah deprecated dan diganti `proxy.ts`
// (fungsi diekspor sebagai `proxy`). Perilakunya sama: refresh sesi Supabase
// di setiap request + tolak akses rute terproteksi bila belum login.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/admin", "/owner", "/passport"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Pemeriksaan OPTIMISTIK, sengaja tidak memverifikasi JWT ke server Auth.
  //
  // `getUser()` memanggil server Auth lewat jaringan (~53ms) setiap kali, dan
  // proxy berjalan di SETIAP request — termasuk prefetch <Link>. Satu layar
  // passport punya lima tautan di tab bar, jadi sekadar menampilkannya dulu
  // membayar lima kali panggilan itu. Dokumentasi Next.js melarang ini secara
  // eksplisit: proxy hanya boleh membaca sesi dari cookie, dan bukan tempat
  // otorisasi. `getSession()` membaca cookie secara lokal tanpa jaringan.
  //
  // Penyegaran token tetap harus di sini: Server Component tidak boleh menulis
  // cookie, jadi hanya proxy yang bisa menyimpan refresh token yang berotasi.
  // `getSession()` menyegarkan sendiri saat token kedaluwarsa — sekali per jam,
  // bukan sekali per request.
  //
  // Cookie palsu atau sesi basi lolos dari sini, lalu ditolak requireRole()
  // yang memverifikasi sungguhan. Itu memang pembagian tugas yang dimaksud.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED_PREFIXES.some((p) => path.startsWith(p));
  if (needsAuth && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/masuk";
    url.searchParams.set("lanjut", path);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)",
  ],
};
