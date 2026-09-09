import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * MEMBACA SERTIFIKAT — PEMILIKNYA SAJA.
 *
 * Kembaran `/api/bukti/[permintaan]`, dengan satu perbedaan yang disengaja:
 * penjaganya BUKAN `requireRole`, melainkan kepemilikan. Barisnya dibaca lewat
 * SESI PENGGUNA, jadi policy "sertifikat: klien baca miliknya" yang menjawab —
 * sertifikat orang lain memulangkan nol baris.
 *
 * Nol baris dan berkas-yang-belum-ada menjawab hal yang SAMA (404). Itu bukan
 * kemalasan: dua kalimat berbeda akan mengubah rute ini menjadi alat menghitung
 * sertifikat orang lain.
 *
 * Bucket `sertifikat` tidak punya satu pun policy, jadi hanya service role
 * (baris `createAdminSupabase` di bawah) yang bisa menukar path jadi byte — dan
 * ia baru dipanggil SESUDAH RLS memutuskan hak di atas.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sesi: string }> },
) {
  const { sesi } = await params;

  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("certificates")
    .select("objek, mime")
    .eq("session_id", sesi)
    .maybeSingle<{ objek: string; mime: string }>();

  if (!baris) {
    return NextResponse.json({ pesan: "Sertifikat tidak ada." }, { status: 404 });
  }

  const admin = createAdminSupabase();
  const { data: berkas, error } = await admin.storage
    .from("sertifikat")
    .download(baris.objek);

  if (error || !berkas) {
    return NextResponse.json({ pesan: "Sertifikat tidak terbaca." }, { status: 404 });
  }

  return new NextResponse(berkas, {
    headers: {
      "content-type": baris.mime || "application/pdf",
      // `private`: respons ini milik satu klien, dan tidak boleh disimpan CDN
      // mana pun lalu disajikan ke orang lain.
      "cache-control": "private, no-store",
    },
  });
}
