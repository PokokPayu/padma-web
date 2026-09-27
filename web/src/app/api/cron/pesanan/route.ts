import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { rahasiaMesinCocok } from "@/lib/auth/rahasia-mesin";
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
 * ===== ANGGARAN WAKTU: TIGA BATAS, DAN YANG MENGIKAT BUKAN YANG DIKIRA =====
 *
 * Versi pertama berkas ini beralasan dengan `timeout-minutes` job Actions (10
 * menit). Itu BUKAN batasnya. Yang mengikat adalah durasi FUNGSI VERCEL, di
 * paket Hobby yang sama yang sudah memaksa penjadwalnya keluar dari Vercel
 * Cron. Ketiganya, dari yang paling ketat:
 *
 *   1. Fungsi Vercel, Hobby + fluid compute (bawaan untuk proyek yang
 *      di-deploy sesudah 23 Apr 2025, termasuk PADMA): bawaan 300 s, MAKSIMUM
 *      300 s — tidak bisa dinaikkan tanpa pindah paket.
 *      (vercel.com/docs/functions/configuring-functions/duration, tabel
 *      "Duration limits", per 24 Agu 2026.)
 *   2. `--max-time` curl di workflow: 270 s, SENGAJA lebih besar daripada
 *      `maxDuration` di bawah supaya yang melaporkan kegagalan adalah 504 dari
 *      Vercel, bukan curl yang menyerah lebih dulu dan meninggalkan fungsinya
 *      tetap berjalan.
 *   3. `timeout-minutes: 10` job Actions: pagar terluar, tidak pernah tercapai.
 *
 * ARITMATIKANYA, supaya bisa diperiksa ulang tanpa menurunkannya lagi:
 *
 *     BATAS_SAPUAN (10 baris) × BATAS_MS adapter (10 s) = 100 s
 *     + 1 SELECT + 1 UPDATE cap + ≤10 RPC  ≈ 12 perjalanan basis data
 *     ------------------------------------------------------------
 *     kasus terburuk ≈ 160 s   <   maxDuration 240 s   <   batas Hobby 300 s
 *
 * Kasus terburuk itu berarti Midtrans mati total dan SETIAP panggilan habis
 * waktunya — keadaan yang tidak menyelesaikan apa pun betapapun lama ia
 * dibiarkan. Yang penting justru bahwa ia berhenti, bukan bahwa ia selesai.
 */
export const maxDuration = 240;

/**
 * Batas baris per jalan.
 *
 * SEPULUH, turun dari dua puluh. Dua puluh muat di kertas (200 s < 300 s) tapi
 * tanpa ruang untuk basis data yang lambat, dan sapuan yang dipotong di tengah
 * adalah sapuan yang barisnya SUDAH dicap tetapi belum ditanyakan.
 *
 * Yang membuat pemotongan itu tidak fatal — dan ini alasan kenapa sepuluh
 * sudah cukup, bukan sekadar menghibur diri: capnya hanya menahan baris selama
 * `MENIT_JEDA_PERIKSA` (5 menit), sementara kadensnya 15 menit. Baris yang
 * tercap tapi tidak sempat ditanyakan karena itu SUDAH layak lagi pada putaran
 * berikutnya, bukan tersembunyi sampai capnya basi.
 *
 * Kapasitasnya tetap longgar: 10 baris × 4 putaran/jam = 40 pesanan/jam, dan
 * urutan `diperiksa_pada nulls first` menjamin yang paling lama tidak
 * diperiksa selalu dapat giliran lebih dulu.
 */
const BATAS_SAPUAN = 10;

export async function POST(request: Request) {
  const rahasia = process.env.CRON_SECRET ?? "";
  const dikirim = request.headers.get("authorization") ?? "";

  // `!rahasia` DULU dan terpisah: itulah aturan fail-closed-nya, dan ia punya
  // ujinya sendiri. Bandingnya sendiri waktu-tetap — lihat `rahasiaMesinCocok`.
  if (!rahasia || !rahasiaMesinCocok(dikirim, `Bearer ${rahasia}`)) {
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
    const { diperiksa, dilewati } = await sapuPesananMenggantung(
      createAdminSupabase(),
      BATAS_SAPUAN,
      null,
    );
    // ===== DUA ANGKA, KARENA SATU ANGKA PUNYA DUA ARTI =====
    // `{diperiksa: 0}` sendirian berarti "tidak ada yang perlu disapu" DAN
    // "kesepuluh barisnya gagal" — dua keadaan yang menuntut dua tindakan
    // berbeda, dan yang kedua tidak menghasilkan galat di mana pun.
    // `dilewati` memisahkannya: sapuan sehat yang sepi pulang
    // `{0, 0}`, sapuan yang mati total pulang `{0, 10}`.
    //
    // Ini pasangan dari lubang yang sudah ditutup di sisi lain (server tanpa
    // kunci melaporkan "diperiksa: 20"): keduanya kelas yang sama — penjadwal
    // sakit yang terbaca persis seperti penjadwal sehat.
    return NextResponse.json({ diperiksa, dilewati });
  } catch (galat) {
    // SEBABNYA DICATAT. Tanpa baris ini, sapuan yang mati karena basis data
    // tidak meninggalkan satu jejak pun di mana pun: `sapuPesananMenggantung`
    // melempar tanpa mencatat pada KEDUA jalurnya (pemilihan baris gagal, dan
    // pencapan `diperiksa_pada` gagal), dan yang tersisa di luar hanyalah 500
    // di stderr curl, tiap lima belas menit, selamanya.
    //
    // Doktrinnya sudah tertulis di modul yang dipanggil rute ini — `kirimKeMesin`
    // mencatat galat RPC-nya, begitu juga penangkap per-baris di dalam sapuan,
    // keduanya dengan alasan "kegagalan senyap adalah yang termahal". Rute ini
    // mengikuti doktrin yang sama alih-alih jadi satu-satunya lubangnya.
    console.error(
      `[pesanan] sapuan Lapis 3 gagal: ${galat instanceof Error ? galat.message : String(galat)}`,
    );
    // 500, dan `curl --fail` di workflow menerjemahkannya jadi job MERAH.
    // Penyapu yang gagal dalam diam adalah penyapu yang tidak ada.
    return NextResponse.json({ pesan: "Gagal menjalankan." }, { status: 500 });
  }
}
