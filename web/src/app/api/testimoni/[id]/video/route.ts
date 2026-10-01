import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import * as r2 from "@/lib/r2";

// `@aws-sdk` butuh Node, bukan Edge.
export const runtime = "nodejs";

/**
 * Video testimoni: alihkan ke presigned GET R2 yang segar.
 *
 * Halaman /testimoni di-cache (revalidate), jadi presigned URL tidak boleh
 * dirender ke HTML — ia bisa kedaluwarsa sebelum halaman diregenerasi. Elemen
 * <video> menunjuk rute stabil ini; rute menerbitkan URL baru tiap diminta.
 *
 * Hak dibuktikan query ber-RLS lebih dulu: pengunjung anon hanya melihat
 * testimoni terbit (policy `baca publik`), staf juga melihat draf untuk
 * pratinjau di panel.
 */
export async function GET(_permintaan: Request, konteks: { params: Promise<{ id: string }> }) {
  const { id } = await konteks.params;

  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("testimonials")
    .select("video_objek")
    .eq("id", id)
    .maybeSingle<{ video_objek: string | null }>();

  if (!baris?.video_objek) {
    return NextResponse.json({ pesan: "Tidak tersedia." }, { status: 404 });
  }

  try {
    const url = await r2.urlTontonVideo(baris.video_objek);
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "no-store" } });
  } catch (e) {
    const nama = e instanceof Error ? e.name : "GalatTidakDikenal";
    const pesan = e instanceof Error ? e.message : String(e);
    console.error(`menerbitkan video testimoni gagal: ${nama}: ${pesan}`);
    return NextResponse.json({ pesan: "Gagal menyiapkan video." }, { status: 500 });
  }
}
