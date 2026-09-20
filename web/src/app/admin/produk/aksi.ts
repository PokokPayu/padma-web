"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  periksaJudul,
  periksaSlug,
  periksaJenis,
  slugDariJudul,
  PANJANG_DESKRIPSI_MAKS,
} from "@/lib/produk/status";

/**
 * Jalur tulis panel admin untuk master produk digital.
 *
 * Aturan yang mengikat berkas ini, sama seperti `admin/materi/aksi.ts`:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action.
 *
 *  2. PRODUK LAHIR NONAKTIF. Berkasnya (Task 6) diunggah lewat komponen
 *     tersendiri SESUDAH `productId` ini ada, jadi `simpanProduk` TIDAK
 *     PERNAH mengirim `aktif` — default basis data (false) yang berlaku.
 *
 *  3. `aktifkanProduk` MENOLAK produk tanpa berkas. Tanpa itu, pagar (2) bisa
 *     dilewati hanya dengan satu klik lanjutan pada produk yang isinya belum
 *     ada.
 *
 *  4. HARGA TIDAK PERNAH DISENTUH DI SINI. `digital_product_prices` adalah
 *     wilayah owner (Task 7) — RLS-nya sendiri sudah menolak admin menulis,
 *     tapi berkas ini juga tidak pernah mencoba: medan harga tidak muncul di
 *     satu pun `FormData` yang dibaca di bawah.
 *
 *  5. UPDATE/INSERT yang tertahan RLS dijawab PostgREST 200 + []. Melaporkan
 *     "berhasil" tanpa memeriksa panjangnya adalah kebohongan senyap.
 *
 *  6. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan policy "produk: staf" tidak pernah ikut
 *     diperiksa.
 */
type Gagal = { ok: false; pesan: string };
type Dibuat = { ok: true; id: string };
type Berhasil = { ok: true };

function segarkanProduk() {
  revalidatePath("/admin/produk");
  revalidatePath("/produk");
}

/** Medan bersama `simpanProduk` dan `perbaruiProduk`, sudah tervalidasi. */
function periksaMedanProduk(formData: FormData): Gagal | {
  ok: true;
  judul: string;
  slug: string;
  jenis: "video" | "pdf";
  deskripsi: string;
  bolehUnduh: boolean;
} {
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return { ok: false, pesan: judul.pesan };

  const jenis = periksaJenis(String(formData.get("jenis") ?? ""));
  if (!jenis.ok) return { ok: false, pesan: jenis.pesan };

  // Slug diambil dari medan bila diisi, kalau tidak diturunkan dari judul.
  const mentahSlug = String(formData.get("slug") ?? "").trim();
  const slug = periksaSlug(mentahSlug || slugDariJudul(judul.nilai));
  if (!slug.ok) return { ok: false, pesan: slug.pesan };

  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  if (deskripsi.length > PANJANG_DESKRIPSI_MAKS) {
    return { ok: false, pesan: `Deskripsi maksimal ${PANJANG_DESKRIPSI_MAKS} karakter.` };
  }

  const bolehUnduh = formData.get("boleh_unduh") === "on";

  return { ok: true, judul: judul.nilai, slug: slug.nilai, jenis: jenis.nilai, deskripsi, bolehUnduh };
}

/**
 * Mendaftarkan produk baru.
 *
 * `aktif` sengaja TIDAK dikirim: default basis data (false) yang berlaku.
 * Produk tanpa berkas tidak boleh terpajang, dan berkasnya baru bisa
 * diunggah sesudah barisnya ada (Task 6).
 */
export async function simpanProduk(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const medan = periksaMedanProduk(formData);
  if (!medan.ok) return medan;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_products")
    .insert({
      judul: medan.judul,
      slug: medan.slug,
      deskripsi: medan.deskripsi,
      jenis: medan.jenis,
      boleh_unduh: medan.bolehUnduh,
    })
    .select("id");

  if (error?.code === "23505") {
    return { ok: false, pesan: `Alamat "${medan.slug}" sudah dipakai produk lain.` };
  }
  if (error) return { ok: false, pesan: `Produk gagal disimpan (${error.code}).` };
  // 200 + [] berarti RLS menahan barisnya tanpa melempar galat apa pun.
  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Produk tidak tersimpan — hak akses ditolak." };
  }

  segarkanProduk();
  return { ok: true, id: data![0].id };
}

/**
 * Mengubah identitas produk (judul/slug/deskripsi/boleh_unduh/urutan).
 *
 * `aktif` dan harga sengaja tidak muncul di sini — keadaan tayang punya
 * action tersendiri (`aktifkanProduk`/`nonaktifkanProduk`), dan harga adalah
 * wilayah owner (Task 7).
 */
export async function perbaruiProduk(id: string, formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const medan = periksaMedanProduk(formData);
  if (!medan.ok) return medan;

  const urutanMentah = String(formData.get("urutan") ?? "0").trim();
  const urutan = /^-?\d+$/.test(urutanMentah) ? Number(urutanMentah) : 0;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_products")
    .update({
      judul: medan.judul,
      slug: medan.slug,
      deskripsi: medan.deskripsi,
      jenis: medan.jenis,
      boleh_unduh: medan.bolehUnduh,
      urutan,
    })
    .eq("id", id)
    .select("id");

  if (error?.code === "23505") {
    return { ok: false, pesan: `Alamat "${medan.slug}" sudah dipakai produk lain.` };
  }
  if (error) return { ok: false, pesan: `Produk gagal diperbarui (${error.code}).` };
  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Produk tidak ditemukan atau hak akses ditolak." };
  }

  segarkanProduk();
  return { ok: true };
}

/**
 * Menayangkan produk.
 *
 * Produk tanpa isi yang terpajang di etalase adalah janji yang tidak bisa
 * ditepati: pengunjung membuka halamannya dan tidak menemukan apa pun.
 */
export async function aktifkanProduk(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data: berkas, error: berkasError } = await supabase
    .from("digital_product_files")
    .select("id")
    .eq("product_id", id);
  if (berkasError) return { ok: false, pesan: `Gagal memeriksa isi (${berkasError.code}).` };
  if ((berkas ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Produk belum punya berkas — unggah isinya dulu sebelum ditayangkan.",
    };
  }

  const { data, error } = await supabase
    .from("digital_products")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, pesan: `Gagal menayangkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Produk tidak ditemukan." };

  segarkanProduk();
  return { ok: true };
}

/** Menarik produk dari etalase. Baris & isinya tetap ada, hanya tidak terpajang. */
export async function nonaktifkanProduk(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("digital_products")
    .update({ aktif: false })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, pesan: `Gagal menonaktifkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Produk tidak ditemukan." };

  segarkanProduk();
  return { ok: true };
}
