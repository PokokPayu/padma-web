import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * PEMBATAL TERJADWAL (spec C2 P6).
 *
 * Lapis PERTAMA dari dua. Lapis keduanya adalah evaluasi saat dibaca di layar
 * admin & Passport — dan lapis kedua itu bukan kemewahan: cron yang mati
 * membuat tenggat berhenti berlaku tanpa satu pun galat, dan bentuk
 * kegagalannya adalah bidan yang tertahan pada pemesanan yang seharusnya sudah
 * bebas.
 *
 * ===== KENAPA RAHASIA, BUKAN requireRole =====
 * Pemanggilnya mesin, bukan orang: tidak ada sesi, tidak ada peran. Yang
 * menjaganya rahasia bersama di header — dibandingkan dengan panjang tetap
 * supaya waktu bandingnya tidak membocorkan berapa karakter yang sudah cocok.
 *
 * Tanpa `CRON_SECRET` yang terpasang, rute ini MENOLAK semua orang. Fail-closed
 * disengaja: rute yang terbuka ketika konfigurasinya lupa dipasang adalah rute
 * yang bisa dipakai siapa pun untuk membatalkan pemesanan orang lain.
 */
export async function POST(request: Request) {
  const rahasia = process.env.CRON_SECRET ?? "";
  const dikirim = request.headers.get("authorization") ?? "";

  if (!rahasia || dikirim !== `Bearer ${rahasia}`) {
    return NextResponse.json({ pesan: "Tidak berwenang." }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("batalkan_lewat_tenggat");

  if (error) {
    return NextResponse.json({ pesan: "Gagal menjalankan." }, { status: 500 });
  }

  // Jumlahnya dipulangkan supaya penjadwal punya sesuatu untuk dicatat —
  // rute yang selalu menjawab "ok" tidak bisa dibedakan dari rute yang tidak
  // pernah menemukan apa pun.
  return NextResponse.json({ dibatalkan: data ?? 0 });
}
