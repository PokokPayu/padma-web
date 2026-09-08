import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * MEMBACA BUKTI BAYAR — STAF SAJA (spec C2 P3).
 *
 * Bucket `bukti-bayar` tidak punya satu pun policy, jadi tidak ada peran API
 * yang bisa menukar path menjadi byte. Rute inilah satu-satunya pintunya, dan
 * `requireRole` di baris pertama yang menjaganya — bukan ketidaktahuan orang
 * atas nama objeknya.
 *
 * Klien TIDAK bisa membaca lewat sini, termasuk buktinya sendiri. Ia baru saja
 * mengunggahnya; yang ia butuhkan adalah kepastian bahwa buktinya diterima,
 * dan itu sudah dijawab keadaan tagihannya. Membuka rute baca untuk klien
 * berarti menambah permukaan tanpa menambah kegunaan.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ permintaan: string }> },
) {
  await requireRole(["admin", "owner"]);

  const { permintaan } = await params;
  const admin = createAdminSupabase();

  const { data: baris } = await admin
    .from("booking_requests")
    .select("bukti_objek")
    .eq("id", permintaan)
    .maybeSingle<{ bukti_objek: string | null }>();

  if (!baris?.bukti_objek) {
    return NextResponse.json({ pesan: "Bukti tidak ada." }, { status: 404 });
  }

  const { data: berkas, error } = await admin.storage
    .from("bukti-bayar")
    .download(baris.bukti_objek);
  if (error || !berkas) {
    return NextResponse.json({ pesan: "Bukti tidak terbaca." }, { status: 404 });
  }

  return new NextResponse(berkas, {
    headers: {
      "content-type": berkas.type || "image/jpeg",
      // `private`: respons ini milik satu staf pada satu permintaan, dan tidak
      // boleh disimpan CDN mana pun lalu disajikan ke orang lain.
      "cache-control": "private, no-store",
    },
  });
}
