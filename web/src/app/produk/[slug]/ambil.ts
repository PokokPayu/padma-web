"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { bacaProdukPerSlug } from "@/lib/produk/katalog";

type Hasil = { ok: true } | { ok: false; pesan: string };

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

  revalidatePath("/passport/produk");
  revalidatePath(`/produk/${slug}`);
  return { ok: true };
}
