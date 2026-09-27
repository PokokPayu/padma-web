import { z } from "zod";

/**
 * Notifikasi webhook Midtrans.
 *
 * SEMUA `z.string()`, tidak satu pun `z.coerce` — lihat dokblok
 * `hitungTandaTangan`: yang ditandatangani adalah string PERSIS seperti dikirim.
 *
 * TIDAK `.strict()`, dan itu keputusan, bukan kelalaian. Midtrans menambah
 * field ke payloadnya dari waktu ke waktu (`currency`, `merchant_id`,
 * `settlement_time`, `expiry_time`, …). Skema ketat akan menolak notifikasi sah
 * dengan 400 — dan 400 memberi tahu Midtrans "sudah selesai, jangan kirim lagi".
 * Satu field baru dari pihak ketiga akan MENGUNCI PESANAN MATI, dengan uang
 * yang sudah masuk. Field yang tidak kita kenal diabaikan.
 *
 * `fraud_status` opsional karena hanya ada pada transaksi kartu; `payment_type`
 * opsional karena Status API dan webhook tidak selalu sepakat mengirimkannya.
 */
export const SkemaNotifikasiMidtrans = z.object({
  order_id: z.string(),
  status_code: z.string(),
  /**
   * SATU-SATUNYA medan yang dibatasi bentuknya, dan alasannya bukan kerapian:
   * nilainya dikirim apa adanya sebagai `p_gross_amount numeric` ke RPC. Tanpa
   * batas ini, `gross_amount` yang bukan angka lolos sebagai string, PostgREST
   * gagal cast dengan `22P02`, rute menjawab **500**, dan Midtrans mengulang
   * notifikasi yang sama SELAMANYA — 500 adalah satu-satunya kelas yang
   * retry-nya benar-benar dianggap bisa menyembuhkan. Dengan batas ini ia
   * berhenti di 400 `skema_gagal`: badan yang tidak akan pernah berubah, dan
   * mengulanginya percuma.
   *
   * Tetap `z.string()`, bukan `z.coerce.number()`: yang ditandatangani adalah
   * string PERSIS seperti dikirim, dan yang meng-cast adalah basis data —
   * satu kali, ke tipe kolom yang sudah memutuskan presisinya.
   */
  gross_amount: z.string().regex(/^\d+(\.\d+)?$/),
  signature_key: z.string(),
  transaction_status: z.string(),
  transaction_id: z.string(),
  fraud_status: z.string().optional(),
  payment_type: z.string().optional(),
});

export type NotifikasiMidtrans = z.infer<typeof SkemaNotifikasiMidtrans>;
