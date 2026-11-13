import type { SupabaseClient } from "@supabase/supabase-js";
import { PESANAN_TERBUKA } from "@/lib/pesanan/status";

/**
 * Kalimat untuk admin saat sebuah perubahan MENUTUP tagihan yang sedang
 * terbuka (P3/B5, Ruling 10.2). Trigger `tutup_pesanan_sesi_terbuka` menutup
 * pesanan begitu masukan harganya (bidan, tanggal, jam, titik alamat) berubah;
 * tanpa kalimat ini admin menekan Simpan, melihat "tersimpan", dan tidak tahu
 * klien kini memegang tagihan yang tidak bisa dibayar lagi.
 */
export const KALIMAT_TAGIHAN_DITUTUP =
  "Tagihan yang sedang terbuka ditutup karena harga berubah — terbitkan ulang tagihannya.";

/**
 * Apakah pengajuan ini punya pesanan sesi TERBUKA? Dibaca dengan sesi staf
 * (policy `pesanan: staf baca`). Galat dilempar: jawaban "tidak ada" yang
 * sebenarnya "gagal membaca" akan menyembunyikan kalimat di atas.
 */
export async function adaTagihanTerbuka(
  supabase: SupabaseClient,
  permintaanId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("booking_request_id", permintaanId)
    .in("status", [...PESANAN_TERBUKA]);
  if (error) throw error;
  return (count ?? 0) > 0;
}
