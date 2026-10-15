"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { periksaJudul, periksaSlug, slugDariJudul, PANJANG_DESKRIPSI_MAKS } from "@/lib/produk/status";
import { ambilIsiProduk, isiLengkap } from "@/lib/admin/produk-admin";

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
 *  2. PRODUK LAHIR NONAKTIF. Bab, materi, dan berkasnya (`[id]/aksi-isi.ts`,
 *     `[id]/unggah.ts`) dibuat SESUDAH `productId` ini ada, jadi `simpanProduk`
 *     TIDAK PERNAH mengirim `aktif` — default basis data (false) yang berlaku.
 *
 *  3. `aktifkanProduk` MENOLAK produk yang isinya belum lengkap. Tanpa itu, pagar (2) bisa
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
  deskripsi: string;
} {
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return { ok: false, pesan: judul.pesan };

  // Slug diambil dari medan bila diisi, kalau tidak diturunkan dari judul.
  const mentahSlug = String(formData.get("slug") ?? "").trim();
  const slug = periksaSlug(mentahSlug || slugDariJudul(judul.nilai));
  if (!slug.ok) return { ok: false, pesan: slug.pesan };

  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  if (deskripsi.length > PANJANG_DESKRIPSI_MAKS) {
    return { ok: false, pesan: `Deskripsi maksimal ${PANJANG_DESKRIPSI_MAKS} karakter.` };
  }

  return { ok: true, judul: judul.nilai, slug: slug.nilai, deskripsi };
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
 * Mengubah identitas produk (judul/slug/deskripsi/urutan).
 *
 * `aktif` dan harga sengaja tidak muncul di sini — keadaan tayang punya
 * action tersendiri (`aktifkanProduk`/`nonaktifkanProduk`), dan harga adalah
 * wilayah owner (Task 7).
 *
 * Jenis dan izin unduh bukan milik produk lagi: keduanya melekat pada MATERI
 * (`perbaruiMateri` di `[id]/aksi-isi.ts`).
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
 *
 * "Isi lengkap" (`isiLengkap`, `@/lib/admin/produk-admin`) berarti minimal satu
 * materi DAN setiap materi berisi menurut jenisnya (`materiBerisi`): video
 * lewat `digital_product_files`, PDF lewat `digital_product_pages`. Satu materi
 * kosong cukup untuk menolak — pembeli yang membuka bab dan menemukan materi
 * kosong adalah gembok yang tak pernah terbuka.
 */
export async function aktifkanProduk(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Produk setengah jadi di etalase lebih buruk daripada produk yang belum
  // ada: SETIAP materi wajib berisi, bukan sekadar "ada satu".
  const bab = await ambilIsiProduk(id);
  if (!isiLengkap(bab)) {
    return {
      ok: false,
      pesan: "Isi belum lengkap — produk butuh minimal satu materi, dan setiap materi harus sudah diunggah isinya.",
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

/**
 * Menarik produk dari etalase — BERHENTI DIJUAL, bukan mencabut akses.
 *
 * Pemegang entitlement yang belum dicabut TETAP membuka produk ini: kartunya
 * tetap ada di "Pembelian saya", readernya tetap terbuka, unduhannya tetap
 * jalan. Itu bukan sekadar niat yang ditulis di komentar ini — yang
 * menegakkannya adalah policy "produk: pemilik entitlement baca" (migration
 * `20260921160000_produk_akses_pemilik.sql`), karena spec menjanjikan masa
 * akses "Selamanya; admin tetap bisa mencabut" dan pencabutan punya tombolnya
 * SENDIRI: `digital_entitlements.dicabut_pada`. Satu action yang dipakai admin
 * untuk merapikan etalase tidak boleh diam-diam menjadi pencabutan massal.
 *
 * Yang berubah hanyalah etalase publik: `/produk`, `/produk/[slug]`, dan seksi
 * landing berhenti memajangnya, dan produk gratisnya tidak bisa diambil lagi.
 */
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
