import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sapuPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";

export const runtime = "nodejs";

/**
 * LAPIS 3 — PENYAPU PESANAN MENGGANTUNG (spec 26 Sep 2026, "Rekonsiliasi").
 *
 * PENYAPU SISA, bukan jaring utama, dan itu disengaja walau kadensnya rapat.
 * Jaring utamanya Lapis 1b (pemeriksaan saat halaman dibuka) karena ia dipicu
 * oleh orang yang paling butuh: yang baru membayar lalu kembali mencari
 * produknya. Yang ditangkap di sini hanyalah pesanan milik orang yang tidak
 * pernah membuka halamannya lagi.
 *
 * Alasannya bukan kehematan: tidak satu pun penjadwal menjamin ketepatan
 * waktu. Dokumentasi GitHub Actions sendiri menyatakan jadwal bisa tertunda
 * saat beban tinggi dan sebagian job antre bisa DIBUANG — terutama di awal
 * setiap jam. Desain yang menggantungkan uang orang pada ketepatan penjadwal
 * akan salah di penjadwal mana pun.
 *
 * ===== KENAPA POST, DAN KENAPA TIDAK ADA GET =====
 * Keharusan mengekspor GET lahir dari Vercel Cron yang memanggil GET.
 * Penjadwalnya di sini GitHub Actions dengan `curl` — kita yang memilih
 * verbanya, jadi bentuknya sama dengan `/api/cron/tenggat` (POST di baris 22
 * berkas itu). Tidak ada `vercel.json` yang perlu lahir, dan tidak ada jebakan
 * "salah taruh di akar repo lalu gagal dalam diam".
 *
 * ===== KENAPA RAHASIA, BUKAN requireRole =====
 * Pemanggilnya mesin: tidak ada sesi, tidak ada peran. Tanpa `CRON_SECRET`
 * terpasang, rute ini MENOLAK semua orang — fail-closed persis seperti rute
 * tenggat. Rute publik yang menembakkan permintaan ke Midtrans bisa dipanggil
 * siapa pun berulang kali, dan ongkosnya dibayar akun merchant PADMA.
 * Nilainya hidup sebagai GitHub Secret, bukan di repo: repo ini PUBLIK, jadi
 * itu syarat, bukan kehati-hatian umum.
 */

/**
 * Batas baris per jalan.
 *
 * Dua puluh, bukan "semua": satu jalan berarti sampai dua puluh perjalanan
 * bolak-balik ke Status API Midtrans secara berurutan, dan job Actions yang
 * kehabisan waktu tidak menyelesaikan apa pun. Kadens lima belas menit berarti
 * tunggakan yang lebih panjang tetap habis dalam beberapa putaran — dan urutan
 * `diperiksa_pada nulls first` menjamin yang paling lama tidak diperiksa selalu
 * dapat giliran lebih dulu.
 */
const BATAS_SAPUAN = 20;

export async function POST(request: Request) {
  const rahasia = process.env.CRON_SECRET ?? "";
  const dikirim = request.headers.get("authorization") ?? "";

  if (!rahasia || dikirim !== `Bearer ${rahasia}`) {
    return NextResponse.json({ pesan: "Tidak berwenang." }, { status: 401 });
  }

  try {
    // Service role sebagai PEMILIH: itulah satu-satunya perbedaan dengan Lapis
    // 1b, yang mengoper sesi pemanggil dan karena itu hanya melihat pesanannya
    // sendiri. Jalur penerapannya sesudah pemilihan sama persis — satu
    // keputusan, satu bacaan.
    // `null` sebagai argumen ketiga DITULIS EKSPLISIT, bukan dibiarkan default:
    // ia yang membedakan Lapis 3 dari Lapis 1b. Lapis 1b mengoper `client_id`
    // pemanggil supaya radiusnya tidak bergantung pada kebetulan bahwa
    // pemanggilnya bukan staf; Lapis 3 memang lintas klien, dan itu keputusan
    // yang harus terlihat di tempat ia diambil.
    const { diperiksa } = await sapuPesananMenggantung(
      createAdminSupabase(),
      BATAS_SAPUAN,
      null,
    );
    // Jumlahnya dipulangkan supaya penjadwal punya sesuatu untuk dicatat —
    // rute yang selalu menjawab "ok" tidak bisa dibedakan dari rute yang tidak
    // pernah menemukan apa pun.
    return NextResponse.json({ diperiksa });
  } catch {
    // 500, dan `curl --fail` di workflow menerjemahkannya jadi job MERAH.
    // Penyapu yang gagal dalam diam adalah penyapu yang tidak ada.
    return NextResponse.json({ pesan: "Gagal menjalankan." }, { status: 500 });
  }
}
