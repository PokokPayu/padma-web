import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  terapkanJawabanMidtrans,
  type HasilPeriksaPesanan,
} from "@/lib/pesanan/periksa-menggantung";

export const runtime = "nodejs";

/**
 * PERIKSA ULANG — RUTE, BUKAN RPC BERPARAMETER STATUS (spec "Rekonsiliasi").
 *
 * Vonis Midtrans tidak boleh jadi parameter yang dikirim pemanggil bersesi,
 * atau admin mana pun bisa mencetak `lunas` dengan satu curl. Karena itu yang
 * dikirim dari layar hanyalah ID pesanan; yang menentukan hasilnya adalah
 * Status API Midtrans, dan jawabannya masuk lewat `terapkan_notifikasi_midtrans`
 * — fungsi yang tertutup bagi `authenticated` justru supaya begitu.
 *
 * Hidup di `src/app/api/**`, bukan `src/app/admin/**`: larangan service role
 * (`tests/admin-shell.test.ts:643`) tidak tersentuh.
 */
const PESAN: Record<HasilPeriksaPesanan, string> = {
  diterapkan: "Jawaban Midtrans diterapkan.",
  duplikat: "Notifikasi itu sudah pernah diproses sebelumnya.",
  tanpa_efek: "Tidak ada yang berubah — keadaan pesanan sudah sesuai jawaban Midtrans.",
  pesanan_tidak_ada: "Midtrans tidak mengenali nomor pesanan ini.",
  // Bukan kegagalan Midtrans, melainkan baris kita sendiri yang cacat — dan
  // kalimatnya harus menyuruh manusia melihat barisnya, bukan mencoba lagi.
  bentuk_order_id:
    "Nomor pesanan ini tidak berbentuk sah, jadi Midtrans tidak bisa ditanyai. Periksa barisnya.",
  belum_kedaluwarsa:
    "Midtrans belum mengenal transaksinya, dan tenggang satu jam sesudah tenggat belum lewat.",
  midtrans_tak_terjawab: "Midtrans tidak menjawab. Coba lagi beberapa saat lagi.",
  // Kalimat yang SAMA PERSIS dengan yang sudah dipilih `terbitkanTokenSnap`
  // (Tugas 8) untuk keadaan yang sama, dan sengaja TIDAK menyuruh mencoba
  // lagi: `MIDTRANS_SERVER_KEY` yang belum terpasang tidak berubah karena
  // tombolnya ditekan ulang. Satu-satunya tindakan yang menolong adalah
  // memanggil orang yang bisa memasang env-nya.
  kunci_belum_terpasang: "Pembayaran belum aktif. Hubungi tim PADMA.",
  galat_basis_data: "Jawaban Midtrans gagal diterapkan.",
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  // Barisnya dibaca dengan SESI PEMANGGIL — policy "pesanan: staf baca" yang
  // memutuskan, bukan perbandingan yang ditulis di sini. Service role baru
  // muncul di dalam `terapkanJawabanMidtrans`, sesudah haknya diputuskan RLS.
  const sb = await createServerSupabase();
  const { data: pesanan, error: galatPesanan } = await sb
    .from("orders")
    .select("id, kode, percobaan, kedaluwarsa_pada")
    .eq("id", id)
    .maybeSingle<{ id: string; kode: string; percobaan: number; kedaluwarsa_pada: string }>();

  // `error` DIBACA, tidak dibuang. PostgREST yang gagal memulangkan
  // `data: null` — bentuk yang SAMA PERSIS dengan "barisnya memang tidak
  // ada". Dilaporkan 404, staf pergi mencari pesanan yang dikiranya terhapus
  // sementara yang rusak adalah basis datanya; di jalur pembayaran, kegagalan
  // yang melapor sebagai hal lain lebih mahal daripada kegagalan yang melapor
  // sebagai dirinya sendiri. `bacaPesananStaf` sudah berargumen begitu lalu
  // MELEMPAR; rute tidak bisa melempar tanpa kehilangan `pesan`-nya, jadi ia
  // menjawab 500 dengan kalimat yang berbeda dari 404 di bawahnya.
  if (galatPesanan) {
    return NextResponse.json({ pesan: "Baris pesanan tidak terbaca." }, { status: 500 });
  }
  if (!pesanan) {
    return NextResponse.json({ pesan: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  const hasil = await terapkanJawabanMidtrans({
    id: pesanan.id,
    kode: pesanan.kode,
    percobaan: pesanan.percobaan,
    kedaluwarsaPada: pesanan.kedaluwarsa_pada,
  });

  // 502, bukan 200: "sudah diperiksa" untuk pemeriksaan yang tidak pernah
  // terjadi membuat staf berhenti memeriksanya.
  if (hasil === "midtrans_tak_terjawab") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 502 });
  }
  // 503, angka yang sama dengan jawaban rute webhook untuk keadaan yang sama
  // (`kunci_kosong`, Tugas 8), dan BUKAN 200 — `tombol-pesanan.tsx` hanya
  // menampilkan `pesan` ketika `res.ok` bernilai false, jadi 200 di sini
  // membuat kalimat "Pembayaran belum aktif" tidak pernah sampai ke layar dan
  // tombolnya terlihat berhasil. Bukan 502: tidak ada gerbang hulu yang gagal,
  // yang belum siap adalah SERVER INI.
  if (hasil === "kunci_belum_terpasang") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 503 });
  }
  // 500: yang rusak adalah baris kita, bukan pihak ketiga, dan tidak ada yang
  // bisa disembuhkan dengan menekan tombolnya lagi.
  if (hasil === "bentuk_order_id") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 500 });
  }
  if (hasil === "galat_basis_data") {
    return NextResponse.json({ hasil, pesan: PESAN[hasil] }, { status: 500 });
  }
  return NextResponse.json({ hasil, pesan: PESAN[hasil] });
}
