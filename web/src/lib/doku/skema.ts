import { z } from "zod";

/**
 * Notifikasi webhook DOKU (Checkout non-SNAP).
 *
 * TIDAK `.strict()`, dan itu keputusan: bentuk badan berbeda per channel
 * [spec §4.2] dan DOKU menambah medan dari waktu ke waktu. Skema ketat menolak
 * notifikasi sah dengan 400, dan 400 berarti "jangan kirim lagi" — satu medan
 * baru akan mengunci pesanan yang uangnya sudah masuk. Medan asing diabaikan.
 *
 * `order.amount` angka ATAU string (VA = angka, gerai = string, QRIS =
 * `"20000.00"`); bentuk yang sebenarnya dinilai `normalisasiNominal`, bukan
 * Zod — nominal berdesimal bukan nol harus sampai ke mesin sebagai `null`
 * (ditahan), bukan mati di 400 sebagai badan yang "tak akan berubah".
 *
 * `channel` dan `service` opsional, begitu pula `original_request_id`
 * (QRIS tidak membawanya) dan `date`.
 */
export const SkemaNotifikasiDoku = z.object({
  order: z.object({
    invoice_number: z.string(),
    amount: z.union([z.number(), z.string()]),
  }),
  transaction: z.object({
    status: z.string(),
    original_request_id: z.string().optional(),
    date: z.string().optional(),
  }),
  channel: z.object({ id: z.string() }).optional(),
  service: z.object({ id: z.string() }).optional(),
});

export type NotifikasiDoku = z.infer<typeof SkemaNotifikasiDoku>;
