"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { periksaHarga, periksaHargaCoretProduk, PESAN_PRODUK } from "@/lib/produk/status";

type Hasil = { ok: true } | { ok: false; pesan: string };

/**
 * Menetapkan harga produk. BARIS BARU, selalu.
 *
 * Polanya sama dengan `tetapkanTarif` di `owner/tarif/aksi.ts`, dan alasannya
 * juga sama: harga lama tetap berdiri sebagai bukti berapa yang berlaku pada
 * hari-hari yang sudah lewat. Sejak Tahap 2, nota pesanan membekukan harganya
 * sendiri — tetapi riwayat inilah yang menjawab "kenapa nota itu berbunyi
 * begitu".
 */
export async function tetapkanHargaProduk(formData: FormData): Promise<Hasil> {
  await requireRole(["owner"]);

  const productId = String(formData.get("produk") ?? "").trim();
  if (!productId) return { ok: false, pesan: "Produk wajib dipilih." };

  const harga = periksaHarga(String(formData.get("harga") ?? ""));
  if (!harga.ok) return { ok: false, pesan: harga.pesan };

  // Dibaca SESUDAH harga tervalidasi: batasnya relatif terhadap harga jual.
  const coret = periksaHargaCoretProduk(String(formData.get("harga_coret") ?? ""), harga.nilai);
  if (!coret.ok) return { ok: false, pesan: coret.pesan };

  // Medan tanggal kosong = berlaku mulai hari ini, menurut kalender JAKARTA.
  const mentahMulai = String(formData.get("mulai") ?? "").trim();
  const mulai = mentahMulai || hariIniJakarta();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai)) {
    return { ok: false, pesan: "Tanggal berlaku tidak sah." };
  }

  const supabase = await createServerSupabase();

  // Foreign key memang menolak produk yang tidak ada, tetapi pesannya adalah
  // kode Postgres — bukan kalimat yang boleh dibaca pemiliknya. Nilai
  // bukan-UUID pun mendarat di sini (PostgREST menjawab 22P02).
  const { data: produk } = await supabase
    .from("digital_products").select("id").eq("id", productId).maybeSingle();
  if (!produk) return { ok: false, pesan: "Produk tidak dikenal." };

  // Riwayat dibaca lewat RLS owner. Perbandingan tanggal = perbandingan
  // STRING; keduanya YYYY-MM-DD sehingga urutan leksikografisnya sudah
  // kronologis, dan tidak ada objek Date yang bisa menggesernya.
  const { data: riwayat, error: riwayatError } = await supabase
    .from("digital_product_prices").select("berlaku_sejak").eq("product_id", productId);
  if (riwayatError) return { ok: false, pesan: `Gagal membaca riwayat (${riwayatError.code}).` };

  const terpakai = (riwayat ?? []).map((r) => r.berlaku_sejak as string);
  if (terpakai.includes(mulai)) {
    return { ok: false, pesan: "Sudah ada harga yang berlaku mulai tanggal itu." };
  }
  const terakhir = terpakai.reduce<string | null>((maks, t) => (maks === null || t > maks ? t : maks), null);
  if (terakhir !== null && mulai < terakhir) {
    return { ok: false, pesan: `Tanggal berlaku tidak boleh mundur dari penetapan terakhir (${terakhir}).` };
  }

  const { data, error } = await supabase
    .from("digital_product_prices")
    .insert({
      product_id: productId,
      harga: harga.nilai,
      harga_coret: coret.nilai,
      berlaku_sejak: mulai,
    })
    .select("id");

  if (error?.code === "23514") return { ok: false, pesan: PESAN_PRODUK.coretLebihMurah };
  if (error) return { ok: false, pesan: `Harga gagal disimpan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Harga tidak tersimpan — hak akses ditolak." };

  revalidatePath("/owner/produk");
  revalidatePath("/admin/produk");
  revalidatePath("/produk");
  revalidatePath("/");
  return { ok: true };
}
