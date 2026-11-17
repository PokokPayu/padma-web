import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { terbitkanTautanBayar } from "@/lib/doku/tautan";
import { statusPersetujuan } from "@/lib/persetujuan/status";

/**
 * CHECKOUT — rute TIPIS. Satu kalimat arsitektur, supaya tiga penyebutan tidak
 * berarti tiga mekanisme:
 *
 *   Rute ini memanggil RPC `buat_pesanan_keranjang` DENGAN SESI PEMANGGIL — bukan server
 *   action, dan TIDAK PERNAH service role. RPC-lah yang memilih `client_id` dari
 *   `auth.uid()`, membekukan harga, menerbitkan `kode`, dan menolak pesanan
 *   terbuka kedua lewat unique parsial.
 *
 * Yang ada di sini hanyalah dua hal yang memang tidak bisa hidup di SQL:
 * meminta tautan bayar DOKU (`terbitkanTautanBayar`) dan menerjemahkan galat
 * basis data menjadi kalimat yang dibaca pembeli.
 *
 * Peramban dialihkan ke `url` yang dipulangkan. Nol halaman `/bayar/selesai`:
 * halaman tujuan kembali tidak dipercaya dan tidak menerbitkan apa pun. Yang
 * memutuskan lunas hanyalah notifikasi bertanda tangan.
 */
export const runtime = "nodejs";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BarisPesanan = {
  pesanan_id: string;
  kode: string;
  percobaan: number;
  nominal_tagih: number;
  judul: string;
  jumlah_item: number;
};

export async function POST(request: Request) {
  const user = await penggunaSaatIni();
  if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });

  // PERSETUJUAN S&K (spec 2026-10-06). Tombol beli di /produk/[slug] bisa
  // dicapai tanpa pernah membuka /passport, jadi gerbang layout tidak pernah
  // melihat pembeli ini. 403 + `kode`, BUKAN 409: 409 sudah berarti "pesanan
  // terbuka" dan "gagal membuat pesanan" di rute ini, dan `mintaCheckout`
  // harus bisa membedakannya.
  if (!(await statusPersetujuan(user.id)).sudahSetuju) {
    return NextResponse.json(
      { kode: "perlu_persetujuan", pesan: "Setujui Syarat & Ketentuan lebih dulu." },
      { status: 403 },
    );
  }

  let badan: unknown;
  try {
    badan = await request.json();
  } catch {
    return NextResponse.json({ pesan: "Format tidak valid." }, { status: 400 });
  }
  const isi = (badan ?? {}) as { productId?: unknown; productIds?: unknown; ulang?: unknown };
  // Dua bentuk badan: `productId` (tombol "Beli sekarang") dan `productIds`
  // (keranjang, P2). Keduanya mendarat di RPC yang sama.
  const productIds: unknown[] = Array.isArray(isi.productIds)
    ? isi.productIds
    : typeof isi.productId === "string"
      ? [isi.productId]
      : [];
  if (
    productIds.length === 0 ||
    productIds.length > 20 ||
    !productIds.every((id) => typeof id === "string" && POLA_UUID.test(id))
  ) {
    return NextResponse.json({ pesan: "Produk tidak dikenali." }, { status: 400 });
  }
  // `ulang` dinaikkan HANYA ketika DOKU menolak menerbitkan tautan dan
  // invoice lamanya sudah terbakar — bukan setiap kali halaman dibuka.
  const ulang = isi.ulang === true;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("buat_pesanan_keranjang", {
    p_product_ids: productIds,
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

  // Kepemilikan dibuktikan di dalam `terbitkanTautanBayar` (RLS lewat sesi
  // pemanggil). 409/502/503 diteruskan apa adanya: pesanannya SENGAJA dibiarkan
  // hidup supaya pembeli bisa mengulang dengan `ulang: true`.
  const tautan = await terbitkanTautanBayar(supabase, baris.pesanan_id, "/passport/produk");
  if (!tautan.ok) {
    return NextResponse.json({ pesan: tautan.pesan }, { status: tautan.status });
  }

  return NextResponse.json({
    url: tautan.url,
    kode: baris.kode,
    pesananId: baris.pesanan_id,
  });
}
