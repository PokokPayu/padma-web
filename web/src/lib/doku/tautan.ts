import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { rakitInvoice } from "@/lib/pesanan/order-id";
import { buatPembayaranDoku } from "./adapter";
import { clientIdDoku, secretKeyDoku, urlKembali } from "./konfig";

/** Batas atas `payment_due_date` yang kita kirim (K12). */
const MENIT_MAKS = 1440;

type Hasil =
  | { ok: true; url: string }
  | { ok: false; status: 409 | 502 | 503; pesan: string };

/**
 * Menerbitkan (atau memakai ulang) tautan bayar DOKU untuk pesanan terbuka.
 *
 * Kepemilikan dibuktikan dengan membaca `orders` lewat `sesi`: RLS
 * "pesanan: klien baca miliknya" hanya meloloskan baris milik pemanggil.
 * Baru sesudah itu `order_items` dibaca lewat service role, karena tabel itu
 * tidak punya grant bagi `authenticated`. Nominal selalu dari `harga_beku`
 * di server, tidak pernah dari klien.
 */
export async function terbitkanTautanBayar(
  sesi: SupabaseClient,
  pesananId: string,
  pathKembali: string,
): Promise<Hasil> {
  const { data: pesanan, error } = await sesi
    .from("orders")
    .select("id, kode, percobaan, status, kedaluwarsa_pada, tautan_gateway")
    .eq("id", pesananId)
    .maybeSingle();
  if (error) {
    console.error("[doku] Pesanan tidak terbaca:", error.code);
    return { ok: false, status: 502, pesan: "Pesanan belum bisa dibaca. Coba lagi." };
  }
  // Bukan milik pemanggil dan tidak ada tampak sama (RLS): keduanya 409.
  if (!pesanan || pesanan.status !== "menunggu_bayar") {
    return { ok: false, status: 409, pesan: "Tagihan ini sudah tidak bisa dibayar." };
  }

  const sisaMs = Date.parse(pesanan.kedaluwarsa_pada) - Date.now();

  // Pakai ulang: klien menekan Bayar dua kali atau di dua tab. Tautan lama
  // dibuat dengan tenggat yang sama dengan kolom, jadi ia berlaku selama
  // kolomnya belum lewat. Memanggil DOKU lagi menghabiskan invoice.
  if (pesanan.tautan_gateway && sisaMs > 0) {
    return { ok: true, url: pesanan.tautan_gateway };
  }

  // Dibulatkan KE BAWAH: DOKU tidak boleh menerima uang sesudah kolom kita
  // tutup, jadi tenggatnya tidak boleh melebihi `kedaluwarsa_pada`. Sisa
  // < 60 detik = 0 menit = tidak ada tautan yang aman dibuat.
  const menit = Math.min(Math.floor(sisaMs / 60_000), MENIT_MAKS);
  if (menit < 1) {
    return { ok: false, status: 409, pesan: "Tagihan lewat tenggat." };
  }

  const callbackUrl = urlKembali(pathKembali);
  if (clientIdDoku() === "" || secretKeyDoku() === "" || callbackUrl === null) {
    return { ok: false, status: 503, pesan: "Pembayaran belum aktif. Hubungi tim PADMA." };
  }

  const { data: baris, error: eItem } = await createAdminSupabase()
    .from("order_items")
    .select("judul_beku, harga_beku")
    .eq("pesanan_id", pesanan.id)
    .order("urutan");
  if (eItem || !baris || baris.length === 0) {
    console.error("[doku] Item pesanan tidak terbaca.");
    return { ok: false, status: 502, pesan: "Pembayaran belum bisa dimulai. Coba lagi." };
  }
  const items = baris.map((b) => ({ nama: b.judul_beku as string, harga: b.harga_beku as number }));
  const nominal = items.reduce((s, i) => s + i.harga, 0);

  let invoice: string;
  try {
    invoice = rakitInvoice(pesanan.kode, pesanan.percobaan);
  } catch {
    console.error("[doku] Kode pesanan tidak berbentuk invoice.");
    return { ok: false, status: 502, pesan: "Pembayaran belum bisa dimulai. Hubungi tim PADMA." };
  }

  const hasil = await buatPembayaranDoku({
    invoice,
    nominal,
    items,
    menitBerlaku: menit,
    callbackUrl,
  });
  if (!hasil.ok) return { ok: false, status: 502, pesan: hasil.pesan };

  // Gagal mencatat tidak menggagalkan jawaban: tautannya sudah sah di DOKU dan
  // klien bisa membayar. Akibatnya hanya tekan Bayar berikutnya membuat ulang.
  const { error: eCatat } = await sesi.rpc("catat_tautan_gateway", {
    p_pesanan_id: pesanan.id,
    p_percobaan: pesanan.percobaan,
    p_tautan: hasil.url,
  });
  if (eCatat) console.error("[doku] Tautan tidak tercatat:", eCatat.code);

  return { ok: true, url: hasil.url };
}
