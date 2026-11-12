import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { clientIdDoku, secretKeyDoku, PATH_WEBHOOK_DOKU } from "@/lib/doku/konfig";
import {
  hitungDigest,
  hitungSidikDoku,
  hitungTandaTangan,
  rakitKomponenTandaTangan,
  tandaTanganCocok,
} from "@/lib/doku/tanda-tangan";
import { normalisasiNominal } from "@/lib/doku/nominal";
import { SkemaNotifikasiDoku } from "@/lib/doku/skema";
import { KODE_JAWABAN, hasilRpcSah, type HasilWebhook } from "@/lib/doku/kode-jawaban";
import { POLA_INVOICE_DOKU } from "@/lib/pesanan/order-id";

/**
 * WEBHOOK DOKU — pintu masuk uang. Porting rute Midtrans; urutannya mengikat,
 * dari yang paling murah dan paling membatasi (spec §5.4):
 *   1. badan dibatasi 16 KB dengan pagar byte NYATA, dibaca sebagai teks mentah
 *   2. DOKU_CLIENT_ID atau DOKU_SECRET_KEY kosong -> 503 (bukan 401, bukan 200)
 *   3. JSON + Zod non-strict + keempat header wajib
 *   4. bentuk invoice disaring regex SEBELUM satu HMAC pun dihitung
 *   5. tanda tangan, waktu-tetap; salah -> penghitung harian naik, lalu 401
 *   6. nominal dinormalisasi; sidik dihitung DI SINI dan dikirim ke RPC
 *   7. satu RPC, satu transaksi (`terapkan_notifikasi_gateway`)
 *
 * Hidup di `src/app/api/**`, jadi larangan service role di `src/app/admin/**`
 * tidak tersentuh. Pemanggilnya DOKU: tidak ada sesi dan tidak ada peran.
 * POST saja; tanpa ekspor GET.
 *
 * KENAPA DIGEST DARI BYTE MENTAH: DOKU menandatangani string yang ia kirim.
 * `JSON.stringify(JSON.parse(teks))` mengubah spasi dan urutan kunci, jadi
 * notifikasi sah ditolak 401 hanya karena formatnya.
 *
 * KENAPA TANPA CEK SELISIH `Request-Timestamp`: belum pasti apakah kirim ulang
 * ditandatangani ulang dengan cap waktu baru; menolak yang "basi" berarti
 * menolak uang sungguhan. Replay sudah dinetralkan idempotensi sidik.
 *
 * KENAPA 503 BILA KUNCI KOSONG: 2xx/4xx memberi tahu DOKU "selesai" dan
 * notifikasinya tak pernah datang lagi. CATATAN: DOKU hanya mengirim ulang
 * TIGA kali (+30 menit, +6 jam, +12 jam) [spec §4.2, S17], bukan berulang
 * seperti Midtrans. 503/500 karena itu hanya keterlambatan dengan jendela
 * sempit; Lapis 1b (Check Status berkala) dan Lapis 3 penyelamat sesungguhnya.
 */
export const runtime = "nodejs";

/**
 * Notifikasi DOKU terbesar jauh di bawah 2 KB. 16 KB sangat longgar dan
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
 * Badan jawaban menyebut HASILNYA, bukan hanya kodenya: `duplikat`,
 * `tanpa_efek`, `diterapkan`, dan `pesanan_tidak_ada` semuanya 200.
 */
function jawab(hasil: HasilWebhook): NextResponse {
  return NextResponse.json({ hasil }, { status: KODE_JAWABAN[hasil] });
}

export async function POST(request: Request) {
  // 1.
  const teks = await bacaBodyTerbatas(request, MAKS_BYTE_BODY);
  if (teks === null) return jawab("badan_terlalu_besar");

  // 2.
  const clientId = clientIdDoku();
  const secretKey = secretKeyDoku();
  if (clientId === "" || secretKey === "") {
    console.error("[doku] DOKU_CLIENT_ID/DOKU_SECRET_KEY belum dipasang — notifikasi ditunda.");
    return jawab("kunci_kosong");
  }

  // 3.
  let mentah: unknown;
  try {
    mentah = JSON.parse(teks);
  } catch {
    return jawab("skema_gagal");
  }
  const urai = SkemaNotifikasiDoku.safeParse(mentah);
  if (!urai.success) return jawab("skema_gagal");
  const n = urai.data;

  const clientIdKiriman = request.headers.get("client-id");
  const requestId = request.headers.get("request-id");
  const requestTimestamp = request.headers.get("request-timestamp");
  const signature = request.headers.get("signature");
  // Hilang (null) = 400; hadir tetapi kosong (`Signature: ""`) lolos ke
  // langkah 5 dan menjadi 401, bukan 400 — ia ada, hanya salah.
  if (
    clientIdKiriman === null ||
    requestId === null ||
    requestTimestamp === null ||
    signature === null
  ) {
    return jawab("skema_gagal");
  }

  // 4. Nol sentuhan basis data, nol HMAC, untuk bentuk yang bukan milik kita
  // (termasuk invoice gaya Midtrans `PSN-…-….1`).
  if (!POLA_INVOICE_DOKU.test(n.order.invoice_number)) return jawab("bentuk_invoice");

  // 5. Digest dari byte MENTAH (lihat dokblok atas). `Client-Id` kiriman harus
  // sama dengan milik kita; keduanya dibandingkan waktu-tetap, dan Client-Id
  // yang dipakai menghitung tanda tangan adalah MILIK KITA.
  const komponen = rakitKomponenTandaTangan({
    clientId,
    requestId,
    requestTimestamp,
    requestTarget: PATH_WEBHOOK_DOKU,
    digest: hitungDigest(teks),
  });
  const dihitung = hitungTandaTangan(komponen, secretKey);
  const cocok = tandaTanganCocok(signature, dihitung) && tandaTanganCocok(clientIdKiriman, clientId);
  if (!cocok) {
    // ===== KENAPA `error` DIBACA, DAN KENAPA TANPA try/catch =====
    // `supabase-js` `.rpc()` TIDAK MELEMPAR pada kegagalan; ia memulangkan
    // `{ error }`. `try/catch` di sini cabang mati, dan `error` yang tidak
    // dibaca membuat alarm banjir notifikasi palsu gagal dalam senyap. Satu
    // angka per hari, NOL teks penyerang; kegagalan mencatat tidak mengubah
    // jawabannya, tetapi wajib terlihat.
    const { error: galatCatat } = await createAdminSupabase().rpc("catat_notifikasi_ditolak");
    if (galatCatat) {
      console.error(`[doku] gagal mencatat notifikasi ditolak: ${galatCatat.message}`);
    }
    return jawab("tanda_tangan_salah");
  }

  // 6. Sesudah tanda tangan lolos. `pembeda` = digest badan mentah: kirim
  // ulang dengan byte identik -> sidik sama; status berbeda -> sidik berbeda.
  const sidik = hitungSidikDoku({
    sumber: "webhook",
    invoice: n.order.invoice_number,
    status: n.transaction.status,
    pembeda: hitungDigest(teks),
  });

  // 7. `p_nominal` null (pecahan bukan nol, dsb.) dibaca mesin sebagai nominal
  // tidak cocok -> ditahan, tidak pernah dibulatkan menjadi lunas.
  const { data, error } = await createAdminSupabase().rpc("terapkan_notifikasi_gateway", {
    p_invoice: n.order.invoice_number,
    p_status: n.transaction.status,
    p_transaksi_id: n.transaction.original_request_id ?? "",
    p_kanal: n.channel?.id ?? n.service?.id ?? "",
    p_nominal: normalisasiNominal(n.order.amount),
    p_sidik: sidik,
    p_sumber: "webhook",
  });

  if (error) {
    console.error(`[doku] RPC gagal untuk ${n.order.invoice_number}: ${error.message}`);
    return jawab("galat");
  }

  const hasil = typeof data === "string" ? data : "";
  if (!hasilRpcSah(hasil)) {
    console.error(`[doku] RPC memulangkan nilai tak dikenal: ${JSON.stringify(data)}`);
    return jawab("galat");
  }

  // `pesanan_tidak_ada` adalah satu-satunya keluaran yang menjawab "selesai"
  // tanpa menulis apa pun, padahal tanda tangannya SAH — uang itu milik kita.
  // Notifikasi sah yang dibuang tidak boleh lebih sunyi daripada yang palsu:
  // satu angka per hari. `error` dibaca tanpa try/catch (alasan di langkah 5).
  if (hasil === "pesanan_tidak_ada") {
    console.error(`[doku] invoice bertanda tangan sah tapi tak dikenal: ${n.order.invoice_number}`);
    const { error: galatCatat } = await createAdminSupabase().rpc("catat_notifikasi_tak_dikenal");
    if (galatCatat) {
      console.error(`[doku] gagal mencatat notifikasi tak dikenal: ${galatCatat.message}`);
    }
  }

  return jawab(hasil);
}
