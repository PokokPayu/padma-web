"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { bacaProdukPerSlug } from "@/lib/produk/katalog";

/**
 * `punya` BUKAN salinan dari `ok`. RPC `ambil_produk_gratis` memakai
 * `on conflict do nothing` supaya pengambilan ulang tidak menghidupkan kembali
 * entitlement yang sudah DICABUT admin — artinya ia menjawab "tidak ada galat"
 * untuk klien yang justru sedang tidak berhak. Melaporkan "berhasil, produk
 * sudah masuk" kepada orang itu adalah kebohongan yang baru ketahuan saat ia
 * mengklik dan menemukan halaman kosong. Karena itu kepemilikannya DIBACA
 * ULANG sesudah RPC, dari predikat yang sama yang menjaga isinya.
 */
type Hasil = { ok: true; punya: boolean } | { ok: false; pesan: string };

/**
 * TIDAK memakai requireRole: produk gratis diambil oleh KLIEN, dan klien
 * adalah peran bawaan setiap akun. Yang dituntut di sini adalah "ada sesi",
 * dan sisanya — produknya tayang, harganya nol, client_id-nya siapa —
 * diputuskan RPC di basis data, bukan di sini. Pemeriksaan yang hanya hidup
 * di server action bisa dilewati dengan satu panggilan langsung ke PostgREST.
 *
 * Repo ini TIDAK punya parameter pengalihan pasca-login (`?lanjut=` atau
 * sejenisnya): `/masuk` tidak membaca query string apa pun, dan
 * `/setelah-masuk` selalu mengarahkan menurut peran (`pastikanKlien`),
 * mengabaikan URL asal sepenuhnya. Menambahkan `?lanjut=` di sini tanpa
 * mengubah kedua berkas itu hanya melahirkan parameter mati — janji
 * "kembali ke sini" yang tidak pernah ditepati. Karena itu pengunjung anon
 * diarahkan ke `/masuk` polos; sesudah masuk ia mendarat di `/passport`
 * seperti biasa dan bisa mengambil produknya lagi dari sana.
 */
export async function ambilProdukGratis(slug: string): Promise<Hasil> {
  const user = await penggunaSaatIni();
  if (!user) redirect("/masuk");

  const produk = await bacaProdukPerSlug(slug);
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("ambil_produk_gratis", { p_product_id: produk.id });
  if (error) return { ok: false, pesan: "Produk ini tidak bisa diambil gratis." };

  // Predikat yang SAMA dengan yang menjaga isi produk (`punya_produk`, dipakai
  // policy berkas & halaman), bukan predikat kedua yang bisa berbeda. Galatnya
  // dibaca, tidak dibuang: RPC yang gagal memulangkan `null`, dan menganggap
  // null sebagai "tidak punya" tetap jujur — yang tidak boleh adalah
  // menganggapnya "punya".
  const { data: punya } = await supabase.rpc("punya_produk", { p_product_id: produk.id });

  revalidatePath("/passport/produk");
  revalidatePath(`/produk/${slug}`);
  return { ok: true, punya: punya === true };
}
