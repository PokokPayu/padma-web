"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { bacaProdukPerSlug } from "@/lib/produk/katalog";
import { COOKIE_LANJUT } from "@/lib/auth/tujuan-produk";
import { statusPersetujuan } from "@/lib/persetujuan/status";

/**
 * `punya` BUKAN salinan dari `ok`. RPC `ambil_produk_gratis` hanya MEMPERBARUI
 * baris yang sudah ada bila entitlementnya kedaluwarsa dan TIDAK dicabut
 * (`on conflict ... do update ... where dicabut_pada is null and berlaku_sampai
 * <= now()`); sisanya dibiarkan apa adanya, sehingga entitlement yang DICABUT
 * admin tidak hidup kembali lewat pengambilan ulang. Artinya RPC menjawab
 * "tidak ada galat" untuk klien yang justru sedang tidak berhak. Melaporkan
 * "berhasil, produk sudah masuk" kepada orang itu adalah kebohongan yang baru
 * ketahuan saat ia mengklik dan menemukan halaman kosong. Karena itu
 * kepemilikannya DIBACA ULANG sesudah RPC, dari predikat yang sama yang menjaga
 * isinya.
 */
type Hasil = { ok: true; punya: boolean } | { ok: false; pesan: string };

/**
 * TIDAK memakai requireRole: produk gratis diambil oleh KLIEN, dan klien
 * adalah peran bawaan setiap akun. Yang dituntut di sini adalah "ada sesi",
 * dan sisanya — produknya tayang, harganya nol, client_id-nya siapa —
 * diputuskan RPC di basis data, bukan di sini. Pemeriksaan yang hanya hidup
 * di server action bisa dilewati dengan satu panggilan langsung ke PostgREST.
 *
 * Pengunjung anon dititipi tujuan `/produk/<slug>` di cookie `padma_lanjut`
 * (lihat `lib/auth/tujuan-produk.ts`), lalu diarahkan ke `/masuk`;
 * `/setelah-masuk` memulangkannya ke sini.
 *
 * Klien yang belum menyetujui S&K versi berlaku diarahkan ke `/persetujuan`
 * dengan `lanjut=/produk/<slug>`, sejajar dengan checkout (spec 2026-10-06):
 * tombol ini juga bisa dicapai tanpa pernah membuka `/passport`, jadi gerbang
 * layout passport tidak pernah melihatnya. Sama seperti di checkout, ini
 * pencatat persetujuan, bukan batas keamanan.
 */
export async function ambilProdukGratis(slug: string): Promise<Hasil> {
  const user = await penggunaSaatIni();
  if (!user) {
    // Dititipkan di cookie yang sama dengan tombol beli (spec P2); dibaca
    // dan dihapus oleh `/setelah-masuk`. Pengunjung mendarat lagi di produk
    // ini dan menekan "Ambil gratis" sekali lagi — tidak ada pengambilan
    // yang berjalan otomatis sesudah login.
    (await cookies()).set(COOKIE_LANJUT, `/produk/${slug}`, {
      path: "/",
      maxAge: 3600,
      sameSite: "lax",
    });
    redirect("/masuk");
  }

  const produk = await bacaProdukPerSlug(slug);
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };

  // Sesudah produk ditemukan: slug yang dirakit ke `lanjut` adalah slug dari
  // basis data, bukan masukan peramban.
  if (!(await statusPersetujuan(user.id)).sudahSetuju) {
    redirect(`/persetujuan?lanjut=${encodeURIComponent(`/produk/${produk.slug}`)}`);
  }

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
