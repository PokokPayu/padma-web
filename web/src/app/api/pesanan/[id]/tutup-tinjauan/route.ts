import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * TUTUP TINJAUAN (Lapis 2).
 *
 * Mengosongkan `butuh_tinjauan_pada` + `sebab_tinjauan` dan melahirkan jejak
 * `tinjauan_ditutup`. Ia TIDAK menyentuh status sama sekali — itulah keuntungan
 * membuang nilai enum `ditinjau` dari desain.
 *
 * Dan justru karena ia tidak menyentuh status, RPC-nya MENOLAK baris `ditahan`
 * (P0001). Tanpa penolakan itu, satu klik menghasilkan pesanan `ditahan`
 * ber-`butuh_tinjauan_pada is null`: uang pembeli sudah di tangan Midtrans,
 * aksesnya tidak pernah terbit, dan barisnya lolos dari klausa penanda
 * sekaligus dari jaring `lunas`. Kalimat penolakannya diteruskan apa adanya ke
 * layar karena ia menyuruh memakai tombol yang benar.
 *
 * Sesi pemanggil, bukan service role: RPC-nya bergerbang `user_role()` dan
 * mencatat siapa yang menutup.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const sb = await createServerSupabase();
  const { error } = await sb.rpc("tutup_tinjauan", { p_pesanan_id: id });
  if (error) {
    const pesan =
      error.code === "P0001" ? error.message : "Tinjauan tidak bisa ditutup untuk pesanan ini.";
    return NextResponse.json({ pesan }, { status: 400 });
  }

  return NextResponse.json({ ditutup: true });
}
