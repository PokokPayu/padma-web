import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { statusPersetujuan } from "@/lib/persetujuan/status";
import { terbitkanTautanBayar } from "@/lib/doku/tautan";
import {
  ambilTagihanPengajuanSatu,
  keadaanTagihanKlien,
  KALIMAT_KEADAAN_KLIEN,
  KEADAAN_BISA_DIBAYAR,
} from "@/lib/tagihan/baca";

/**
 * BAYAR TAGIHAN SESI dari Digital Passport (P3/B6, spec §6.3) — rute TIPIS.
 *
 * Badan permintaan TIDAK dibaca sama sekali. Yang menentukan pesanan mana,
 * berapa, dan apakah boleh dibayar semuanya dibaca di server dengan SESI
 * PEMANGGIL:
 *
 *   1. `tagihan_sesi_saya` (RPC, `auth.uid()`) memulangkan pengajuan itu hanya
 *      bila milik pemanggil — selain itu 409 "Tagihan tidak ditemukan.", sama
 *      untuk milik orang lain dan yang memang tidak ada.
 *   2. `keadaanTagihanKlien` — fungsi yang SAMA dengan yang memutuskan tombol
 *      Bayar di halaman — harus `bayar` atau `diproses`. Uang yang sudah masuk
 *      (predikat tunggal `uang_sudah_masuk_permintaan`, Ruling 1), `ditahan`,
 *      tinjauan, dan tenggat lewat semuanya berhenti di sini dengan 409:
 *      klien yang uangnya sudah masuk tidak pernah menerima tautan kedua.
 *   3. `terbitkanTautanBayar` membaca ulang pesanan lewat RLS sesi yang sama,
 *      memakai ulang tautan yang masih berlaku, dan meneruskan 409/502/503.
 *
 * Halaman kembali (`callback_url`) adalah halaman tagihan itu sendiri; ia tidak
 * membaca parameter apa pun dari DOKU (K11) dan menjalankan Lapis 1b.
 */
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ permintaan: string }> },
) {
  const { permintaan } = await params;

  const user = await penggunaSaatIni();
  if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });

  // Gerbang S&K yang sama dengan checkout produk: 403 + `kode`, bukan 409,
  // supaya tombol bisa membedakannya dari "tidak bisa dibayar".
  if (!(await statusPersetujuan(user.id)).sudahSetuju) {
    return NextResponse.json(
      { kode: "perlu_persetujuan", pesan: "Setujui Syarat & Ketentuan lebih dulu." },
      { status: 403 },
    );
  }

  let tagihan: Awaited<ReturnType<typeof ambilTagihanPengajuanSatu>>;
  try {
    tagihan = await ambilTagihanPengajuanSatu(permintaan);
  } catch (galat) {
    console.error("[tagihan] tagihan sesi tidak terbaca:", (galat as { code?: string })?.code);
    return NextResponse.json({ pesan: "Tagihan belum bisa dibaca. Coba lagi." }, { status: 502 });
  }
  if (!tagihan) {
    return NextResponse.json({ pesan: "Tagihan tidak ditemukan." }, { status: 409 });
  }

  const keadaan = keadaanTagihanKlien(tagihan);
  if (!KEADAAN_BISA_DIBAYAR.includes(keadaan) || tagihan.pesananId === null) {
    return NextResponse.json({ pesan: KALIMAT_KEADAAN_KLIEN[keadaan] }, { status: 409 });
  }

  const supabase = await createServerSupabase();
  const tautan = await terbitkanTautanBayar(
    supabase,
    tagihan.pesananId,
    `/passport/bayar/${tagihan.permintaanId}`,
  );
  if (!tautan.ok) {
    return NextResponse.json({ pesan: tautan.pesan }, { status: tautan.status });
  }
  return NextResponse.json({ url: tautan.url });
}
