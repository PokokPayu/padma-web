"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hapusObjekVideo, urlUnggahVideo } from "@/lib/r2";
import { namaObjekVideo, objekVideoSah, periksaBerkasVideo, type MimeVideo } from "@/lib/materi/video";

// Jalur tulis testimoni. Pola sama dengan materi video: baris lahir dulu
// (unggahan butuh id-nya), video diunggah langsung dari peramban ke R2 lewat
// presigned PUT, lalu baru boleh terbit. Izin & terbit dijaga CHECK
// `testimonials_terbit_berizin` di basis data, bukan hanya di tombol ini.

type Gagal = { ok: false; pesan: string };

function segarkan(id?: string) {
  revalidatePath("/admin/testimoni");
  revalidatePath("/testimoni");
  if (id) revalidatePath(`/admin/testimoni/${id}`);
}

function bacaMedan(formData: FormData) {
  return {
    nama: String(formData.get("nama") ?? "").trim(),
    keterangan: String(formData.get("keterangan") ?? "").trim(),
    kutipan: String(formData.get("kutipan") ?? "").trim(),
    urutan: Number(formData.get("urutan") ?? 0),
  };
}

function periksaMedan(m: ReturnType<typeof bacaMedan>): string | null {
  if (m.nama.length < 2 || m.nama.length > 80) return "Nama tampil harus 2–80 karakter.";
  if (m.keterangan.length > 160) return "Keterangan maksimal 160 karakter.";
  if (m.kutipan.length > 500) return "Kutipan maksimal 500 karakter.";
  if (!Number.isInteger(m.urutan) || Math.abs(m.urutan) > 9999) return "Urutan harus bilangan bulat.";
  return null;
}

export async function buatTestimoni(formData: FormData): Promise<{ ok: true; id: string } | Gagal> {
  await requireRole(["admin", "owner"]);
  const nama = String(formData.get("nama") ?? "").trim();
  if (nama.length < 2 || nama.length > 80) return { ok: false, pesan: "Nama tampil harus 2–80 karakter." };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("testimonials").insert({ nama }).select("id").single();
  if (error || !data) return { ok: false, pesan: "Gagal membuat testimoni." };
  segarkan();
  return { ok: true, id: data.id as string };
}

export async function simpanTestimoni(id: string, formData: FormData): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const m = bacaMedan(formData);
  const salah = periksaMedan(m);
  if (salah) return { ok: false, pesan: salah };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("testimonials").update(m).eq("id", id).select("id");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Testimoni tidak ditemukan atau gagal disimpan." };
  segarkan(id);
  return { ok: true };
}

export async function konfirmasiIzinTestimoni(id: string): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("testimonials")
    .update({ izin_dikonfirmasi: true })
    .eq("id", id)
    .select("id");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal mencatat izin." };
  segarkan(id);
  return { ok: true };
}

export async function cabutIzinTestimoni(id: string): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  // Izin dicabut → testimoni ikut turun dalam satu UPDATE yang sama.
  const { data, error } = await supabase
    .from("testimonials")
    .update({ izin_dikonfirmasi: false, terbit: false })
    .eq("id", id)
    .select("id");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal mencabut izin." };
  segarkan(id);
  return { ok: true };
}

export async function terbitkanTestimoni(id: string): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("testimonials").update({ terbit: true }).eq("id", id).select("id");
  if (error?.code === "23514")
    return { ok: false, pesan: "Testimoni hanya bisa terbit setelah video terunggah dan izin keluarga dikonfirmasi." };
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal menerbitkan testimoni." };
  segarkan(id);
  return { ok: true };
}

export async function tarikTestimoni(id: string): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("testimonials").update({ terbit: false }).eq("id", id).select("id");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal menarik testimoni." };
  segarkan(id);
  return { ok: true };
}

export async function hapusTestimoni(id: string): Promise<{ ok: true; objekTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("testimonials").delete().eq("id", id).select("video_objek");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal menghapus testimoni." };
  segarkan();
  const objek = (data![0] as { video_objek: string | null }).video_objek;
  if (!objek) return { ok: true, objekTersisa: false };
  try {
    await hapusObjekVideo(objek);
    return { ok: true, objekTersisa: false };
  } catch {
    return { ok: true, objekTersisa: true };
  }
}

export async function terbitkanUrlUnggahTestimoni(
  id: string,
  mime: string,
  byte: number,
): Promise<{ ok: true; url: string; objek: string; mime: MimeVideo } | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return periksa;
  const supabase = await createServerSupabase();
  const { data: baris } = await supabase.from("testimonials").select("id").eq("id", id).maybeSingle();
  if (!baris) return { ok: false, pesan: "Testimoni tidak ditemukan." };
  const objek = namaObjekVideo(`testimoni/${id}`, periksa.nilai, randomUUID());
  try {
    const url = await urlUnggahVideo(objek, periksa.nilai, byte);
    return { ok: true, url, objek, mime: periksa.nilai };
  } catch (e) {
    console.error(`unggah testimoni gagal: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    return { ok: false, pesan: "Gagal menyiapkan unggahan." };
  }
}

export async function catatVideoTestimoni(
  id: string,
  objek: string,
  mime: MimeVideo,
): Promise<{ ok: true; objekLamaTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);
  if (!objekVideoSah(`testimoni/${id}`, objek, mime)) return { ok: false, pesan: "Objek video tidak sah." };
  const supabase = await createServerSupabase();
  const { data: lama } = await supabase
    .from("testimonials")
    .select("video_objek")
    .eq("id", id)
    .maybeSingle<{ video_objek: string | null }>();
  const { data, error } = await supabase
    .from("testimonials")
    .update({ video_objek: objek, video_mime: mime })
    .eq("id", id)
    .select("id");
  if (error || (data ?? []).length === 0) return { ok: false, pesan: "Gagal mencatat video." };
  segarkan(id);
  if (!lama?.video_objek || lama.video_objek === objek) return { ok: true, objekLamaTersisa: false };
  try {
    await hapusObjekVideo(lama.video_objek);
    return { ok: true, objekLamaTersisa: false };
  } catch {
    return { ok: true, objekLamaTersisa: true };
  }
}
