import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";

/**
 * PEMBATALAN MANDIRI.
 *
 * Bukan hiasan: satu klien hanya boleh punya SATU pesanan terbuka (unique
 * parsial `pesanan_terbuka_satu_per_klien`), jadi tanpa tombol ini orang yang
 * berubah pikiran soal produk harus menunggu 24 jam.
 *
 * Yang bisa disalahgunakan pemanggil hanyalah pesanannya SENDIRI: RPC memilih
 * barisnya dari `auth.uid()` dan hanya menerima pesanan `menunggu_bayar`. Ia
 * merusak checkoutnya sendiri, bukan milik orang lain — dan `snap_token` tidak
 * pernah dipercaya sebagai bukti pembayaran oleh apa pun.
 *
 * `dibatalkan: false` BUKAN galat. Ia jawaban jujur untuk "tidak ada pesanan
 * yang cocok dengan itu milik Anda" — dan menjawabnya 404 justru akan memberi
 * tahu pemanggil pesanan siapa yang ada.
 */
export const runtime = "nodejs";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await penggunaSaatIni();
  if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });

  if (!POLA_UUID.test(id)) {
    return NextResponse.json({ pesan: "Pesanan tidak dikenali." }, { status: 409 });
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("batalkan_pesanan_saya", { p_pesanan_id: id });

  if (error) {
    const pesan =
      error.code === "P0001" ? error.message : "Pesanan ini tidak bisa dibatalkan.";
    return NextResponse.json({ pesan }, { status: 409 });
  }

  return NextResponse.json({ dibatalkan: data === true });
}
