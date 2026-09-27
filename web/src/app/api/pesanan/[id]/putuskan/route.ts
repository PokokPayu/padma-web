import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * PUTUSAN STAF ATAS PESANAN `ditahan` (spec "Rekonsiliasi — Lapis 2").
 *
 * DUA putusan, bukan satu: "putuskan" yang hanya punya satu hasil bukan
 * putusan. Admin yang menemukan pembayaran kurang Rp 50.000 harus punya jalan
 * selain "berikan saja".
 *
 * ===== KENAPA INI BOLEH DIPARAMETERKAN, SEMENTARA VONIS MIDTRANS TIDAK =====
 * Vonis Midtrans memang tidak boleh diparameterkan — itulah kenapa pemeriksaan
 * ulang adalah rute yang MENANYAI Status API. Yang diputuskan di sini bukan
 * "apa kata Midtrans" melainkan "apa yang kita lakukan terhadap uang yang
 * sudah masuk", dan ia dicatat dengan nama pemutusnya. Karena itu RPC-nya
 * dipanggil dengan SESI PEMANGGIL, bukan service role: `putuskan_pesanan_ditahan`
 * bergerbang `user_role()` dan mengambil `padma_id` pemutus dari sesi itu.
 * Service role di sini akan membuat jejaknya menyebut mesin, bukan manusia —
 * dan jejak audit yang tidak menyebut manusia tidak berguna.
 */
const PUTUSAN_SAH = ["lunas", "dibatalkan"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const badan = (await request.json().catch(() => ({}))) as { putusan?: unknown };
  const putusan = typeof badan.putusan === "string" ? badan.putusan : "";
  // Disaring di sini JUGA, bukan hanya di RPC: dua pagar untuk satu lubang,
  // karena lubang ini memakan uang orang. RPC tetap pagar yang sesungguhnya —
  // pemeriksaan yang hanya hidup di rute bisa dilewati lewat PostgREST.
  if (!PUTUSAN_SAH.includes(putusan)) {
    return NextResponse.json(
      { pesan: "Putusan tidak dikenal." },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();
  const { error } = await sb.rpc("putuskan_pesanan_ditahan", {
    p_pesanan_id: id,
    p_putusan: putusan,
  });
  if (error) {
    // P0001 adalah galat yang KITA tulis untuk dibaca manusia; sisanya adalah
    // kalimat Postgres, dan admin tidak boleh melihat kode Postgres.
    const pesan =
      error.code === "P0001" ? error.message : "Putusan tidak bisa dijalankan atas pesanan ini.";
    return NextResponse.json({ pesan }, { status: 400 });
  }

  return NextResponse.json({ diputuskan: putusan });
}
