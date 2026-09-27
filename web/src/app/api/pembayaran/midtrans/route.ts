import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { serverKeyMidtrans } from "@/lib/midtrans/konfig";
import { hitungSidik, hitungTandaTangan, tandaTanganCocok } from "@/lib/midtrans/tanda-tangan";
import { SkemaNotifikasiMidtrans } from "@/lib/midtrans/skema";
import { KODE_JAWABAN, hasilRpcSah, type HasilWebhook } from "@/lib/midtrans/kode-jawaban";
import { POLA_ORDER_ID } from "@/lib/pesanan/order-id";

/**
 * WEBHOOK MIDTRANS — pintu masuk uang.
 *
 * Hidup di `src/app/api/**`, BUKAN `src/app/admin/**`, jadi larangan service
 * role (`tests/admin-shell.test.ts:605`) tidak tersentuh. Ia memang menulis
 * dengan service role: pemanggilnya Midtrans, tidak ada sesi dan tidak ada peran.
 *
 * POST saja. Tidak ada ekspor GET — penjadwalnya GitHub Actions dengan `curl`,
 * dan kita yang memilih verbanya.
 *
 * URUTANNYA MENGIKAT, dari yang paling murah dan paling membatasi:
 *   1. badan dibatasi 16 KB dengan pagar byte NYATA (`content-length` boleh bohong)
 *   2. MIDTRANS_SERVER_KEY kosong -> 503 (bukan 401, bukan 200)
 *   3. Zod, semua z.string(), TIDAK .strict()
 *   4. bentuk order_id disaring regex SEBELUM satu sha512 pun dihitung
 *   5. tanda tangan; tidak cocok -> penghitung harian naik, lalu 401
 *   6. sidik dihitung DI SINI (Node crypto) dan dikirim sebagai argumen RPC
 *   7-8. verifikasi jumlah, transisi, dan penyaluran — SEMUANYA di dalam RPC,
 *        satu transaksi. Insert sidik yang commit lebih dulu akan membuat retry
 *        Midtrans ditolak duplikat dan kegagalan sementara menjadi permanen.
 */
export const runtime = "nodejs";

/**
 * Notifikasi Midtrans terbesar jauh di bawah 2 KB. 16 KB sangat longgar dan
 * tetap menutup badan raksasa sebelum ia sampai ke `JSON.parse`.
 */
const MAKS_BYTE_BODY = 16 * 1024;

/**
 * Salinan lokal dari `src/app/api/skrining/route.ts:29-58` — fungsi di sana
 * sengaja tidak diekspor, dan rute skrining di luar cakupan tugas ini.
 * Pagarnya BYTE NYATA: `content-length` boleh bohong atau tidak ada, jadi
 * alirannya dibaca bertahap dan dibatalkan begitu melewati batas.
 */
async function bacaBodyTerbatas(request: Request, maks: number): Promise<string | null> {
  const dilaporkan = Number(request.headers.get("content-length"));
  if (Number.isFinite(dilaporkan) && dilaporkan > maks) return null;

  const aliran = request.body;
  if (!aliran) {
    const teks = await request.text();
    return new TextEncoder().encode(teks).byteLength > maks ? null : teks;
  }

  const pembaca = aliran.getReader();
  const pengurai = new TextDecoder("utf-8");
  let teks = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await pembaca.read();
      if (done) break;
      total += value.byteLength;
      if (total > maks) {
        await pembaca.cancel().catch(() => {});
        return null;
      }
      teks += pengurai.decode(value, { stream: true });
    }
  } finally {
    pembaca.releaseLock();
  }
  return teks + pengurai.decode();
}

/**
 * Badan jawaban menyebut HASILNYA, bukan hanya kodenya. Dua hasil bisa berbagi
 * satu kode HTTP (`duplikat`, `tanpa_efek`, `diterapkan`, dan
 * `pesanan_tidak_ada` semuanya 200), dan log Midtrans yang hanya mencatat "200"
 * tidak bisa membedakan "berhasil" dari "tidak ada yang bisa dilakukan".
 */
function jawab(hasil: HasilWebhook): NextResponse {
  return NextResponse.json({ hasil }, { status: KODE_JAWABAN[hasil] });
}

export async function POST(request: Request) {
  // 1.
  const teks = await bacaBodyTerbatas(request, MAKS_BYTE_BODY);
  if (teks === null) return jawab("badan_terlalu_besar");

  // 2.
  const serverKey = serverKeyMidtrans();
  if (serverKey === "") {
    console.error("[midtrans] MIDTRANS_SERVER_KEY belum dipasang — notifikasi ditunda.");
    return jawab("kunci_kosong");
  }

  // 3.
  let mentah: unknown;
  try {
    mentah = JSON.parse(teks);
  } catch {
    return jawab("skema_gagal");
  }
  const urai = SkemaNotifikasiMidtrans.safeParse(mentah);
  if (!urai.success) return jawab("skema_gagal");
  const n = urai.data;

  // 4. Nol sentuhan basis data, nol sha512, untuk bentuk yang tidak mungkin milik kita.
  if (!POLA_ORDER_ID.test(n.order_id)) return jawab("bentuk_order_id");

  // 5.
  const dihitung = hitungTandaTangan(n.order_id, n.status_code, n.gross_amount, serverKey);
  if (!tandaTanganCocok(n.signature_key, dihitung)) {
    // Satu angka per hari, NOL teks penyerang. Kegagalan mencatat tidak boleh
    // mengubah jawabannya: yang penting 401-nya sampai.
    try {
      await createAdminSupabase().rpc("catat_notifikasi_ditolak");
    } catch {
      console.error("[midtrans] gagal mencatat notifikasi ditolak.");
    }
    return jawab("tanda_tangan_salah");
  }

  // 6. Sesudah tanda tangan lolos, tidak sebelumnya.
  const sidik = hitungSidik({
    orderId: n.order_id,
    statusCode: n.status_code,
    transactionStatus: n.transaction_status,
    fraudStatus: n.fraud_status ?? "",
    transactionId: n.transaction_id,
  });

  // 7-8. Satu panggilan, satu transaksi. (9) ada di bawah, sesudah hasilnya
  // diketahui.
  //
  // `p_gross_amount` dikirim sebagai STRING persis seperti yang ditandatangani.
  // Mengubahnya menjadi angka di TypeScript berarti pembulatan JavaScript ikut
  // menentukan verifikasi jumlah; yang meng-cast-nya adalah basis data, satu
  // kali, ke tipe kolom yang memang sudah memutuskan presisinya.
  const { data, error } = await createAdminSupabase().rpc("terapkan_notifikasi_midtrans", {
    p_order_id: n.order_id,
    p_transaction_status: n.transaction_status,
    p_fraud_status: n.fraud_status ?? "",
    p_transaction_id: n.transaction_id,
    p_payment_type: n.payment_type ?? "",
    p_gross_amount: n.gross_amount,
    p_sidik: sidik,
    p_sumber: "webhook",
  });

  if (error) {
    // SATU-SATUNYA kelas yang retry benar-benar menyembuhkan.
    console.error(`[midtrans] RPC gagal untuk ${n.order_id}: ${error.message}`);
    return jawab("galat");
  }

  const hasil = typeof data === "string" ? data : "";
  if (!hasilRpcSah(hasil)) {
    console.error(`[midtrans] RPC memulangkan nilai tak dikenal: ${JSON.stringify(data)}`);
    return jawab("galat");
  }

  // 9. `pesanan_tidak_ada` adalah SATU-SATUNYA keluaran yang menjawab "sudah
  // selesai" kepada Midtrans tanpa menulis apa pun ke basis data: bukan baris
  // `orders`, bukan `jejak_pesanan`, bukan `notifikasi_pesanan` (RPC keluar
  // sebelum insert sidik), dan bukan penghitung tanda tangan salah. Padahal
  // tanda tangannya SAH — artinya uang itu sungguhan milik kita — lalu kita
  // membuang notifikasinya dan menyuruh Midtrans berhenti mengirim.
  //
  // Notifikasi bertanda tangan sah yang kita buang tidak boleh lebih sunyi
  // daripada notifikasi bertanda tangan palsu. Satu angka per hari, nol teks
  // disimpan — dan angka itu yang kelak menyalakan alarm saat seseorang
  // "merapikan" pencarian pesanan menjadi kode+percobaan, atau menurunkan
  // `upper(...)` di penerbit kode.
  if (hasil === "pesanan_tidak_ada") {
    console.error(`[midtrans] order_id bertanda tangan sah tapi tak dikenal: ${n.order_id}`);
    try {
      await createAdminSupabase().rpc("catat_notifikasi_tak_dikenal");
    } catch {
      // Kegagalan mencatat tidak boleh mengubah jawabannya.
      console.error("[midtrans] gagal mencatat notifikasi tak dikenal.");
    }
  }

  return jawab(hasil);
}
