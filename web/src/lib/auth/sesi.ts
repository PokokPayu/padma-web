import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Identitas request, diambil sekali saja.
 *
 * `auth.getUser()` bukan pembacaan cookie: ia memanggil server Auth lewat
 * jaringan untuk memverifikasi tanda tangan JWT. Terukur ~53ms sekali panggil,
 * sementara satu query database hanya 3-5ms. Satu navigasi ke /passport/sesi
 * dulu memanggilnya empat kali — proxy, requireRole di layout, ambilKlien di
 * layout, lalu ambilKlien lagi di page — jadi ~200ms habis untuk memverifikasi
 * token yang sama berulang-ulang.
 *
 * `cache()` React memoisasi PER RENDER REQUEST. Cakupannya terbukti sempit: di
 * luar konteks render (mis. Vitest) ia tidak memoisasi sama sekali, sehingga
 * hasilnya tidak mungkin bocor antar request atau antar pengguna. Verifikasi
 * tetap terjadi sungguhan — yang hilang cuma pengulangannya dalam satu request.
 *
 * Pakai helper ini, jangan panggil `auth.getUser()` langsung di kode halaman.
 */
export const penggunaSaatIni = cache(async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Baris `profiles` milik pengguna request ini. Sumber tunggal peran. */
export const profilSaatIni = cache(async () => {
  const user = await penggunaSaatIni();
  if (!user) return null;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("profiles")
    .select("role, nama")
    .eq("id", user.id)
    .single();
  return data as { role: string; nama: string } | null;
});
