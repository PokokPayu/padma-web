import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { terbitkanTokenSnap } from "@/lib/midtrans/adapter";
import { midtransProduksi } from "@/lib/midtrans/konfig";
import { rakitOrderId } from "@/lib/pesanan/order-id";
import { JAM_TENGGAT_PESANAN } from "@/lib/pesanan/status";

/**
 * CHECKOUT — rute TIPIS. Satu kalimat arsitektur, supaya tiga penyebutan tidak
 * berarti tiga mekanisme:
 *
 *   Rute ini memanggil RPC `buat_pesanan` DENGAN SESI PEMANGGIL — bukan server
 *   action, dan TIDAK PERNAH service role. RPC-lah yang memilih `client_id` dari
 *   `auth.uid()`, membekukan harga, menerbitkan `kode`, dan menolak pesanan
 *   terbuka kedua lewat unique parsial.
 *
 * Yang ada di sini hanyalah tiga hal yang memang tidak bisa hidup di SQL:
 * merakit `order_id` Midtrans, memanggil Snap, dan menerjemahkan galat basis
 * data menjadi kalimat yang dibaca pembeli.
 *
 * Nol halaman `/bayar/selesai` dan nol rute balik Snap: `onSuccess` di peramban
 * hanya memicu pembacaan ulang entitlement, dan ia BUKAN sumber kebenaran
 * pembayaran. Yang memutuskan lunas hanyalah notifikasi bertanda tangan.
 */
export const runtime = "nodejs";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BarisPesanan = {
  pesanan_id: string;
  kode: string;
  percobaan: number;
  nominal_tagih: number;
  judul: string;
};

export async function POST(request: Request) {
  const user = await penggunaSaatIni();
  if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });

  let badan: unknown;
  try {
    badan = await request.json();
  } catch {
    return NextResponse.json({ pesan: "Format tidak valid." }, { status: 400 });
  }
  const isi = (badan ?? {}) as { productId?: unknown; ulang?: unknown };
  const productId = typeof isi.productId === "string" ? isi.productId : "";
  if (!POLA_UUID.test(productId)) {
    return NextResponse.json({ pesan: "Produk tidak dikenali." }, { status: 400 });
  }
  // `ulang` dinaikkan HANYA ketika Snap menolak menerbitkan token dan
  // `order_id` lamanya sudah terbakar — bukan setiap kali halaman dibuka.
  const ulang = isi.ulang === true;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("buat_pesanan", {
    p_product_id: productId,
    p_ulang: ulang,
  });

  if (error) {
    // `P0001` adalah `raise exception` KITA, dan kalimatnya memang ditulis
    // untuk pembeli ("Selesaikan dulu pesanan yang terbuka...", "Anda sudah
    // memiliki produk ini..."). Kode galat lain diganti kalimat generik: pesan
    // Postgres mentah membocorkan nama constraint dan tidak berarti apa-apa
    // bagi siapa pun yang membacanya.
    const pesan =
      error.code === "P0001" ? error.message : "Pesanan tidak bisa dibuat sekarang.";
    return NextResponse.json({ pesan }, { status: 409 });
  }

  const baris = (data as BarisPesanan[] | null)?.[0];
  if (!baris) {
    return NextResponse.json({ pesan: "Pesanan tidak bisa dibuat sekarang." }, { status: 409 });
  }

  // `kode.percobaan` — Midtrans menolak `order_id` kembar SELAMANYA, dan sufiks
  // percobaan itulah satu-satunya jalan keluar ketika token gagal terbit.
  const orderId = rakitOrderId(baris.kode, baris.percobaan);

  const snap = await terbitkanTokenSnap({
    orderId,
    nominal: baris.nominal_tagih,
    judul: baris.judul,
    // Satu konstanta untuk kolom `kedaluwarsa_pada` DAN `expiry` Snap.
    kedaluwarsaJam: JAM_TENGGAT_PESANAN,
  });

  if (!snap.ok) {
    // 502, bukan 500: yang gagal adalah pihak ketiga, dan pesanannya SENGAJA
    // dibiarkan hidup supaya pembeli bisa mengulang dengan `ulang: true`.
    return NextResponse.json({ pesan: snap.pesan }, { status: 502 });
  }

  const { error: eCatat } = await supabase.rpc("catat_token_snap", {
    p_pesanan_id: baris.pesanan_id,
    p_token: snap.token,
  });
  if (eCatat) {
    // SENGAJA tidak menggagalkan checkout. Tokennya sudah terbit dan pembeli
    // sudah bisa membayar; yang hilang hanyalah catatan kita sendiri, dan
    // `snap_token` tidak pernah dipercaya sebagai bukti pembayaran oleh apa pun.
    console.error(`[pesanan] gagal mencatat token snap ${baris.pesanan_id}: ${eCatat.message}`);
  }

  return NextResponse.json({
    token: snap.token,
    kode: baris.kode,
    pesananId: baris.pesanan_id,
    // Dibaca di SERVER dan dipulangkan, karena `MIDTRANS_PRODUKSI` tidak
    // berprefix NEXT_PUBLIC_ dan peramban tidak bisa membacanya sendiri.
    produksi: midtransProduksi(),
  });
}
