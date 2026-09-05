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
    // di sini, sesudahnya. `r2.urlTontonVideo` (bukan impor langsung) juga
    // menjaga urutan ini tekstual: baris ini adalah SATU-SATUNYA tempat nama
    // fungsinya muncul di berkas ini, dan itu jatuh sesudah query di atas.
    const url = await r2.urlTontonVideo(baris.objek);
    return NextResponse.json(
      { url, mime: baris.mime },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ pesan: "Gagal menyiapkan video." }, { status: 500 });
  }
}
