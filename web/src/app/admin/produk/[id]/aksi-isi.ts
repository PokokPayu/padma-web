"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hapusObjekVideo } from "@/lib/r2";
import {
  periksaJudul, periksaJudulBab, periksaKeteranganMateri, periksaJenisMateri,
} from "@/lib/produk/status";
import { periksaBerkasSampul, namaObjekSampul, objekSampulSah } from "@/lib/produk/objek";
import { hapusSalinanPembeli } from "@/lib/produk/salinan-pembeli";

type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };
type Arah = "naik" | "turun";
type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

const BUCKET_SAMPUL = "produk-sampul";
const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";

function segarkan(productId: string) {
  revalidatePath(`/admin/produk/${productId}`);
  revalidatePath("/admin/produk");
  // Detail publik memuat daftar bab/materi dan pratinjaunya.
  revalidatePath("/produk/[slug]", "page");
}

async function produkDariBab(supabase: Supabase, sectionId: string): Promise<string | null> {
  const { data } = await supabase
    .from("digital_product_sections").select("product_id").eq("id", sectionId).maybeSingle();
  return data?.product_id ?? null;
}

/**
 * Menukar posisi satu baris dengan tetangganya, lalu menulis ulang `urutan`
 * SELURUH saudara menjadi 0..n-1. Menulis ulang semuanya (bukan cuma dua
 * baris) menyembuhkan urutan kembar dari data lama — tanpa itu, dua baris
 * ber-urutan 0 tidak pernah bisa ditukar.
 */
async function geser(
  supabase: Supabase,
  tabel: "digital_product_sections" | "digital_product_materials",
  kolomInduk: "product_id" | "section_id",
  induk: string,
  id: string,
  arah: Arah,
): Promise<Berhasil | Gagal> {
  const { data, error } = await supabase
    .from(tabel).select("id").eq(kolomInduk, induk).order("urutan").order("created_at");
  if (error) return { ok: false, pesan: `Gagal membaca urutan (${error.code}).` };
  const ids = (data ?? []).map((r) => r.id as string);
  const i = ids.indexOf(id);
  const j = arah === "naik" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];

  for (const [urutan, baris] of ids.entries()) {
    const { error: e } = await supabase.from(tabel).update({ urutan }).eq("id", baris);
    if (e) return { ok: false, pesan: `Gagal menyimpan urutan (${e.code}).` };
  }
  return { ok: true };
}

// ===== BAB =====

export async function tambahBab(productId: string, judul: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaJudulBab(judul);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const { count } = await supabase
    .from("digital_product_sections").select("id", { count: "exact", head: true }).eq("product_id", productId);
  const { data, error } = await supabase
    .from("digital_product_sections")
    .insert({ product_id: productId, judul: periksa.nilai, urutan: count ?? 0 })
    .select("id");
  if (error) return { ok: false, pesan: `Bab gagal ditambahkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Bab tidak tersimpan — hak akses ditolak." };

  segarkan(productId);
  return { ok: true };
}

export async function ubahJudulBab(sectionId: string, judul: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaJudulBab(judul);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_sections").update({ judul: periksa.nilai }).eq("id", sectionId).select("product_id");
  if (error) return { ok: false, pesan: `Bab gagal diubah (${error.code}).` };
  if (!data?.[0]) return { ok: false, pesan: "Bab tidak ditemukan." };

  segarkan(data[0].product_id);
  return { ok: true };
}

export async function geserBab(sectionId: string, arah: Arah): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const productId = await produkDariBab(supabase, sectionId);
  if (!productId) return { ok: false, pesan: "Bab tidak ditemukan." };

  const r = await geser(supabase, "digital_product_sections", "product_id", productId, sectionId, arah);
  if (r.ok) segarkan(productId);
  return r;
}

export async function hapusBab(sectionId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const productId = await produkDariBab(supabase, sectionId);
  if (!productId) return { ok: false, pesan: "Bab tidak ditemukan." };

  const { error } = await supabase.rpc("hapus_bab_produk", { p_section_id: sectionId });
  if (error) return { ok: false, pesan: error.message };

  segarkan(productId);
  return { ok: true };
}

// ===== MATERI =====

export async function tambahMateri(sectionId: string, formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return judul;
  const keterangan = periksaKeteranganMateri(String(formData.get("keterangan") ?? ""));
  if (!keterangan.ok) return keterangan;
  const jenis = periksaJenisMateri(String(formData.get("jenis") ?? ""));
  if (!jenis.ok) return jenis;

  const supabase = await createServerSupabase();
  const productId = await produkDariBab(supabase, sectionId);
  if (!productId) return { ok: false, pesan: "Bab tidak ditemukan." };

  const { count } = await supabase
    .from("digital_product_materials").select("id", { count: "exact", head: true }).eq("section_id", sectionId);
  const { data, error } = await supabase
    .from("digital_product_materials")
    .insert({
      section_id: sectionId,
      product_id: productId,
      judul: judul.nilai,
      keterangan: keterangan.nilai,
      jenis: jenis.nilai,
      urutan: count ?? 0,
    })
    .select("id");
  if (error) return { ok: false, pesan: `Materi gagal ditambahkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Materi tidak tersimpan — hak akses ditolak." };

  segarkan(productId);
  return { ok: true };
}

export async function perbaruiMateri(materiId: string, formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return judul;
  const keterangan = periksaKeteranganMateri(String(formData.get("keterangan") ?? ""));
  if (!keterangan.ok) return keterangan;
  const jenis = periksaJenisMateri(String(formData.get("jenis") ?? ""));
  if (!jenis.ok) return jenis;

  const supabase = await createServerSupabase();
  const { data: kini, error: kiniError } = await supabase
    .from("digital_product_materials")
    .select("product_id, jenis, digital_product_files(id), digital_product_pages(count)")
    .eq("id", materiId)
    .maybeSingle<{
      product_id: string;
      jenis: string;
      digital_product_files: { id: string } | null; // one-to-one (material_id UNIQUE)
      digital_product_pages: Array<{ count: number }>;
    }>();
  if (kiniError) return { ok: false, pesan: `Gagal membaca materi (${kiniError.code}).` };
  if (!kini) return { ok: false, pesan: "Materi tidak ditemukan." };

  // Isi yang sudah terunggah terikat pada jenisnya (video di R2, PDF sebagai
  // halaman). Mengganti jenis tanpa melepas isi akan meninggalkan objek yatim
  // dan materi yang tak pernah terbuka.
  const adaIsi = kini.digital_product_files !== null || (kini.digital_product_pages[0]?.count ?? 0) > 0;
  if (kini.jenis !== jenis.nilai && adaIsi) {
    return { ok: false, pesan: "Jenis materi tidak bisa diubah setelah isinya diunggah. Lepas isinya lebih dulu." };
  }

  const { data, error } = await supabase
    .from("digital_product_materials")
    .update({
      judul: judul.nilai,
      keterangan: keterangan.nilai,
      jenis: jenis.nilai,
      pratinjau: formData.get("pratinjau") === "on",
      boleh_unduh: formData.get("boleh_unduh") === "on",
    })
    .eq("id", materiId)
    .select("id");
  if (error) return { ok: false, pesan: `Materi gagal diperbarui (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Materi tidak ditemukan atau hak akses ditolak." };

  segarkan(kini.product_id);
  return { ok: true };
}

export async function geserMateri(materiId: string, arah: Arah): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data: m } = await supabase
    .from("digital_product_materials").select("section_id, product_id").eq("id", materiId).maybeSingle();
  if (!m) return { ok: false, pesan: "Materi tidak ditemukan." };

  const r = await geser(supabase, "digital_product_materials", "section_id", m.section_id, materiId, arah);
  if (r.ok) segarkan(m.product_id);
  return r;
}

export async function hapusMateri(
  materiId: string,
): Promise<{ ok: true; objekTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data: m } = await supabase
    .from("digital_product_materials")
    .select("product_id, digital_products(aktif)")
    .eq("id", materiId)
    .maybeSingle<{ product_id: string; digital_products: { aktif: boolean } | null }>();
  if (!m) return { ok: false, pesan: "Materi tidak ditemukan." };

  if (m.digital_products?.aktif) {
    const { count } = await supabase
      .from("digital_product_materials").select("id", { count: "exact", head: true }).eq("product_id", m.product_id);
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        pesan: "Ini materi terakhir produk yang sedang tayang. Nonaktifkan produknya dulu.",
      };
    }
  }

  const { data: objek, error } = await supabase.rpc("hapus_materi_produk", { p_material_id: materiId });
  if (error) return { ok: false, pesan: `Materi gagal dihapus (${error.code}).` };

  const admin = createAdminSupabase();
  let objekTersisa = false;
  const per = (asal: string) =>
    ((objek ?? []) as Array<{ asal: string; objek: string }>).filter((o) => o.asal === asal).map((o) => o.objek);

  for (const o of per("video")) {
    try { await hapusObjekVideo(o); } catch { objekTersisa = true; }
  }
  for (const [bucket, daftar] of [
    [BUCKET_BERKAS, per("pdf")],
    [BUCKET_HALAMAN, per("halaman")],
    [BUCKET_SAMPUL, per("sampul")],
  ] as const) {
    if (daftar.length === 0) continue;
    const { error: e } = await admin.storage.from(bucket).remove(daftar);
    if (e) objekTersisa = true;
  }
  if (await hapusSalinanPembeli(admin, m.product_id, materiId)) objekTersisa = true;

  segarkan(m.product_id);
  return { ok: true, objekTersisa };
}

// ===== SAMPUL (produk bila materiId null, materi bila terisi) =====

async function sampulLama(
  supabase: Supabase,
  productId: string,
  materiId: string | null,
): Promise<{ ada: boolean; objek: string | null; productId: string; materiId: string | null }> {
  // Id kanonis (huruf kecil) diambil dari BARIS, bukan dari argumen: bentuk
  // UUID non-kanonis dari klien tetap cocok di Postgres, tetapi tidak boleh
  // ikut masuk ke nama objek.
  const { data } = materiId
    ? await supabase.from("digital_product_materials").select("id, product_id, sampul_objek")
        .eq("id", materiId).eq("product_id", productId).maybeSingle()
    : await supabase.from("digital_products").select("id, sampul_objek").eq("id", productId).maybeSingle();
  const baris = data as { id: string; product_id?: string; sampul_objek: string | null } | null;
  return {
    ada: baris !== null,
    objek: baris?.sampul_objek ?? null,
    productId: materiId ? (baris?.product_id ?? productId) : (baris?.id ?? productId),
    materiId: materiId ? (baris?.id ?? materiId) : null,
  };
}

export async function terbitkanUrlSampul(
  productId: string,
  materiId: string | null,
  mime: string,
  byte: number,
): Promise<{ ok: true; objek: string; token: string } | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaBerkasSampul(mime, byte);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const lama = await sampulLama(supabase, productId, materiId);
  if (!lama.ada) return { ok: false, pesan: "Produk atau materi tidak ditemukan." };

  const objek = namaObjekSampul(lama.productId, lama.materiId, periksa.nilai, randomUUID());
  const { data, error } = await createAdminSupabase().storage
    .from(BUCKET_SAMPUL)
    .createSignedUploadUrl(objek);
  if (error || !data) return { ok: false, pesan: "Gagal menyiapkan unggahan sampul. Coba lagi." };
  return { ok: true, objek, token: data.token };
}

export async function catatSampul(
  productId: string,
  materiId: string | null,
  objek: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  if (!objekSampulSah(objek, productId, materiId)) return { ok: false, pesan: "Nama objek sampul tidak sah." };

  const supabase = await createServerSupabase();
  const lama = await sampulLama(supabase, productId, materiId);
  if (!lama.ada) return { ok: false, pesan: "Produk atau materi tidak ditemukan." };

  const { data, error } = materiId
    ? await supabase.from("digital_product_materials").update({ sampul_objek: objek })
        .eq("id", materiId).eq("product_id", productId).select("id")
    : await supabase.from("digital_products").update({ sampul_objek: objek }).eq("id", productId).select("id");
  if (error) return { ok: false, pesan: `Sampul gagal dicatat (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Sampul tidak tersimpan — hak akses ditolak." };

  // Objek lama dihapus SESUDAH baris menunjuk yang baru: gagal hapus hanya
  // meninggalkan sampah, bukan sampul yang patah.
  if (lama.objek && lama.objek !== objek) {
    await createAdminSupabase().storage.from(BUCKET_SAMPUL).remove([lama.objek]);
  }

  segarkan(productId);
  return { ok: true };
}
