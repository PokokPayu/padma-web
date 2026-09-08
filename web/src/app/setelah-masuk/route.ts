import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import { COOKIE_UNDANGAN } from "@/lib/auth/link-client";
import { pastikanKlien } from "@/lib/auth/pastikan-klien";
import { COOKIE_KLAIM, klaimSkrining } from "@/lib/skrining/klaim";

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

  // SKRINING ANONIM DISAMBUNGKAN DI SINI (spec C1 J4).
  //
  // Hanya bila penautan akun BERHASIL (`tujuan === "/passport"`): sebelum itu
  // belum ada baris klien untuk dituju, dan menyambungkan data kesehatan ke
  // akun yang belum terbukti adalah persis bahaya yang seluruh gerbang di atas
  // ada untuk mencegahnya.
  //
  // Kegagalannya TIDAK PERNAH menggagalkan login — token basi, cookie dari
  // perangkat lain, atau skrining yang sudah diklaim orang lain semuanya
  // berakhir sebagai "tidak ada yang disambungkan", bukan sebagai pintu masuk
  // yang tertutup.
  const tokenKlaim = jar.get(COOKIE_KLAIM)?.value ?? "";
  let skriningTersambung: string | null = null;

  if (tokenKlaim && tujuan === "/passport") {
    const { data: klien } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();

    if (klien) {
      const hasil = await klaimSkrining(tokenKlaim, klien.id);
      if (hasil.ok) skriningTersambung = hasil.screeningId;
    }
  }

  // Yang dioper lewat URL adalah ID skriningnya, bukan namanya. Nama adalah
  // data pribadi dan URL bocor ke riwayat peramban, header Referer, dan log
  // proxy; id tidak berarti apa-apa bagi yang tidak bisa membacanya — dan
  // hanya pemiliknya yang bisa (policy "screenings: klien baca miliknya").
  const alamatTujuan = new URL(tujuan, url.origin);
  if (skriningTersambung) alamatTujuan.searchParams.set("skrining", skriningTersambung);

  const response = NextResponse.redirect(alamatTujuan);
  // Token dibuang apa pun hasilnya — sekali pakai berarti juga sekali coba.
  if (token) response.cookies.delete(COOKIE_UNDANGAN);
  if (tokenKlaim) response.cookies.delete(COOKIE_KLAIM);
  return response;
}
