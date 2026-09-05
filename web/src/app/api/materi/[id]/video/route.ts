import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
// Impor namespace SENGAJA (bukan mengimpor fungsi terbit-URL langsung ke
// scope ini): nama fungsi itu harus hanya muncul secara tekstual di titik
// pemanggilan di bawah, SESUDAH query hak — lihat komentar di titik itu.
import * as r2 from "@/lib/r2";

// `@aws-sdk` butuh Node, bukan Edge.
export const runtime = "nodejs";

/**
 * Menerbitkan presigned GET untuk satu video — HANYA bila RLS mengizinkan.
 *
 * Urutannya mengikat: query ber-RLS memakai sesi pasien dijalankan LEBIH DULU,
 * dan presigned URL baru dibuat sesudah barisnya kembali. Membalik urutan ini
 * berarti menerbitkan tautan unduhan sebelum tahu siapa yang meminta.
 *
 * URL-nya tidak pernah dirender ke HTML: ia diambil komponen klien sesudah
 * halaman hidup, sehingga tidak muncul di view-source (Ctrl+U) — jalur termudah
 * yang tersisa bagi pasien awam.
 */
export async function GET(
  _permintaan: Request,
  konteks: { params: Promise<{ id: string }> },
) {
  const { id } = await konteks.params;

  const supabase = await createServerSupabase();
  const { data: sesi } = await supabase.auth.getUser();
  if (!sesi.user) {
    return NextResponse.json({ pesan: "Tidak masuk." }, { status: 403 });
  }

  const { data: baris } = await supabase
    .from("material_videos")
    .select("objek, mime")
    .eq("material_id", id)
    .maybeSingle();

  // RLS mengembalikan nol baris untuk pasien tanpa hak. Dibedakan dari 404
  // hanya di sisi kita; jawabannya sama-sama menolak.
  if (!baris) {
    return NextResponse.json({ pesan: "Tidak tersedia." }, { status: 403 });
  }

  try {
    // Hak sudah terbukti oleh query di atas — presigned URL baru diterbitkan
    // di sini, sesudahnya. Impor NAMESPACE `r2` (bukan mengimpor
    // `urlTontonVideo` langsung ke scope berkas ini) juga menjaga urutan ini
    // tekstual: baris di bawah ini adalah SATU-SATUNYA PEMANGGILAN fungsinya
    // di berkas ini — bukan satu-satunya baris yang MENYEBUT namanya, sebab
    // komentar ini sendiri menyebutnya dua baris di atas — dan pemanggilan
    // itu jatuh sesudah query di atas.
    const url = await r2.urlTontonVideo(baris.objek);
    return NextResponse.json(
      { url, mime: baris.mime },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // Log NAMA & PESAN galatnya saja (fix F3, video-r2 fix wave) — tidak
    // pernah presigned URL (tidak ada satu pun di scope catch ini: `url`
    // di atas ber-scope blok `try`) dan tidak pernah kredensial. Tanpanya,
    // kegagalan PRODUKSI PERTAMA — CORS bucket belum memuat domain produksi
    // (spec §13b A-5) atau secret R2 salah — tidak meninggalkan jejak apa
    // pun untuk didiagnosis, dan pasien hanya melihat "Gagal menyiapkan
    // video." selamanya.
    const nama = e instanceof Error ? e.name : "GalatTidakDikenal";
    const pesan = e instanceof Error ? e.message : String(e);
    console.error(`menerbitkan tonton video gagal: ${nama}: ${pesan}`);
    return NextResponse.json({ pesan: "Gagal menyiapkan video." }, { status: 500 });
  }
}
