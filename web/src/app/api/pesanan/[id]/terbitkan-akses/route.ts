import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * TERBITKAN ULANG AKSES (Lapis 2).
 *
 * ===== KENAPA terbitkan_akses_item, BUKAN salurkan_pesanan =====
 * Penyalur di-key pada TRANSISI, bukan pada niat: ia hanya dipanggil dari
 * cabang `terapkan_notifikasi_midtrans` yang benar-benar memindahkan baris
 * (spec, "Kejadian dan penyaluran"). Memanggilnya dari sini akan membuat
 * kalimat itu tidak lagi benar, dan kalimat itulah yang membuat "lunas tanpa
 * akses" mustahil alih-alih sekadar jarang. Jadi tombol ini memanggil
 * `terbitkan_akses_item` LANGSUNG, satu per item.
 *
 * `order_items` lahir NOL GRANT dan NOL POLICY, jadi id itemnya hanya bisa
 * dibaca service role — dan view `pesanan_item_staf` sengaja tidak
 * memproyeksikan kolom id. Urutannya karena itu mengikat: peran diputuskan
 * `requireRole`, kepemilikan barisnya diputuskan RLS lewat sesi pemanggil,
 * BARU service role menyentuh `order_items`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const sb = await createServerSupabase();
  const { data: pesanan } = await sb
    .from("orders")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string }>();
  if (!pesanan) {
    return NextResponse.json({ pesan: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  // Tombolnya memang hanya dirender untuk baris `lunas`, tetapi rute adalah
  // endpoint MANDIRI: tanpa gerbang ini, satu curl sudah cukup memberikan
  // barang yang belum dibayar.
  if (pesanan.status !== "lunas") {
    return NextResponse.json(
      { pesan: "Akses hanya bisa diterbitkan untuk pesanan yang sudah lunas." },
      { status: 409 },
    );
  }

  const admin = createAdminSupabase();
  const { data: item, error: galatItem } = await admin
    .from("order_items")
    .select("id, jenis, urutan")
    .eq("pesanan_id", id)
    .order("urutan", { ascending: true })
    .returns<{ id: string; jenis: string; urutan: number }[]>();
  if (galatItem) {
    return NextResponse.json({ pesan: "Item pesanan tidak terbaca." }, { status: 500 });
  }
  if (!item || item.length === 0) {
    return NextResponse.json({ pesan: "Pesanan ini tidak punya item." }, { status: 404 });
  }

  const terbit: string[] = [];
  const belumAdaPenangan: number[] = [];
  for (const b of item) {
    // Jenis selain `produk_digital` belum punya penangan di P1 (spec:
    // penyaluran sesi lahir di P3). Dilaporkan, bukan ditebak — menebaknya
    // berarti menerbitkan akses produk untuk item yang bukan produk.
    if (b.jenis !== "produk_digital") {
      belumAdaPenangan.push(b.urutan);
      continue;
    }
    const { data, error } = await admin.rpc("terbitkan_akses_item", { p_item_id: b.id });
    if (error) {
      return NextResponse.json({ pesan: "Penerbitan akses gagal." }, { status: 500 });
    }
    terbit.push(String(data));
  }

  return NextResponse.json({ terbit, belumAdaPenangan });
}
