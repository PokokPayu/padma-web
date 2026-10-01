"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { POLA_SLUG, slugDariJudul } from "@/lib/artikel/urai";

// Jalur tulis artikel. Sama seperti modul lain: requireRole di DALAM setiap
// action, sesi pengguna (RLS staf), dan status terbit tidak pernah dibaca dari
// FormData — terbit/tarik adalah dua action terpisah.

type Gagal = { ok: false; pesan: string };

function segarkan(slug?: string) {
  revalidatePath("/admin/artikel");
  revalidatePath("/artikel");
  if (slug) revalidatePath(`/artikel/${slug}`);
}

export async function buatArtikel(formData: FormData): Promise<{ ok: true; id: string } | Gagal> {
  await requireRole(["admin", "owner"]);
  const judul = String(formData.get("judul") ?? "").trim();
  if (judul.length < 2) return { ok: false, pesan: "Judul terlalu pendek." };
  const dasar = slugDariJudul(judul) || "artikel";

  const supabase = await createServerSupabase();
  // Slug bentrok → tambahkan angka. Lima percobaan cukup untuk judul kembar.
  for (let n = 1; n <= 5; n++) {
    const slug = n === 1 ? dasar : `${dasar.slice(0, 76)}-${n}`;
    const { data, error } = await supabase.from("articles").insert({ judul, slug }).select("id").single();
    if (data) {
      segarkan();
      return { ok: true, id: data.id as string };
    }
    if (error?.code !== "23505") break;
  }
  return { ok: false, pesan: "Gagal membuat artikel." };
}

export async function simpanArtikel(id: string, formData: FormData): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const judul = String(formData.get("judul") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const kategori = String(formData.get("kategori") ?? "").trim();
  const isi = String(formData.get("isi") ?? "");

  if (judul.length < 2 || judul.length > 200) return { ok: false, pesan: "Judul harus 2–200 karakter." };
  if (!POLA_SLUG.test(slug) || slug.length > 80)
    return { ok: false, pesan: "Alamat (slug) hanya boleh huruf kecil, angka, dan tanda hubung." };
  if (kategori.length > 60) return { ok: false, pesan: "Kategori maksimal 60 karakter." };
  if (isi.length > 60000) return { ok: false, pesan: "Isi artikel terlalu panjang." };

  const supabase = await createServerSupabase();
  const { data: lama } = await supabase.from("articles").select("slug").eq("id", id).maybeSingle<{ slug: string }>();
  const { data, error } = await supabase
    .from("articles")
    .update({ judul, slug, kategori, isi })
    .eq("id", id)
    .select("id");
  if (error?.code === "23505") return { ok: false, pesan: "Alamat (slug) itu sudah dipakai artikel lain." };
  if (error?.code === "23514")
    return { ok: false, pesan: "Artikel yang sudah terbit wajib punya kategori dan isi. Tarik dulu bila ingin mengosongkan." };
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Artikel tidak ditemukan atau gagal disimpan." };
  segarkan(slug);
  if (lama && lama.slug !== slug) revalidatePath(`/artikel/${lama.slug}`);
  return { ok: true };
}

export async function terbitkanArtikel(id: string): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("articles")
    .select("slug, diterbitkan_pada")
    .eq("id", id)
    .maybeSingle<{ slug: string; diterbitkan_pada: string | null }>();
  if (!baris) return { ok: false, pesan: "Artikel tidak ditemukan." };
  // Tanggal terbit pertama dipertahankan: menarik lalu menerbitkan ulang
  // untuk membetulkan salah ketik tidak memindahkan artikel ke urutan teratas.
  const { data, error } = await supabase
    .from("articles")
    .update({ terbit: true, diterbitkan_pada: baris.diterbitkan_pada ?? new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error?.code === "23514") return { ok: false, pesan: "Lengkapi kategori dan isi artikel sebelum menerbitkan." };
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal menerbitkan artikel." };
  segarkan(baris.slug);
  return { ok: true };
}

export async function tarikArtikel(id: string): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("articles").update({ terbit: false }).eq("id", id).select("slug");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal menarik artikel." };
  segarkan((data![0] as { slug: string }).slug);
  return { ok: true };
}

export async function hapusArtikel(id: string): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("articles").delete().eq("id", id).select("slug");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal menghapus artikel." };
  segarkan((data![0] as { slug: string }).slug);
  return { ok: true };
}
