"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";
import { bersihkanAlamat } from "./status";

/**
 * Jalur tulis panel admin untuk data mitra.
 *
 * Tiga aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action — bukan sekali di puncak modul.
 *
 *  2. KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER. Karena itu ada dua action
 *     terpisah, `aktifkanMitra` dan `nonaktifkanMitra`, masing-masing dengan
 *     nilai `aktif` tertulis mati di dalamnya. Satu action ber-parameter
 *     `aktif: boolean` akan terlihat lebih ringkas dan mengulang persis cacat
 *     yang dulu meloloskan "klien menyetujui permintaan jadwalnya sendiri":
 *     nilai keadaan datang dari luar, dan yang tersisa hanyalah harapan bahwa
 *     pemanggilnya jujur. `perbaruiMitra` pun sengaja tidak pernah membaca
 *     medan `aktif` dari FormData.
 *
 *  3. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `partners: staf`
 *     tidak pernah ikut diperiksa. Yang mengizinkan tulis di sini adalah RLS
 *     staf, dan itu memang yang diuji.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async. Konstanta apa pun
 * yang perlu dibagi ke UI wajib tinggal di modul lain.
 */
type Gagal = { ok: false; pesan: string };
type Dibuat = { ok: true; id: string };
type Berhasil = { ok: true };

const PANJANG_NAMA_MINIMAL = 2;

export async function simpanMitra(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const nama = String(formData.get("nama") ?? "").trim();
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const alamat = bersihkanAlamat(String(formData.get("alamat") ?? ""));

  if (nama.length < PANJANG_NAMA_MINIMAL) {
    return { ok: false, pesan: "Nama mitra terlalu pendek." };
  }

  const supabase = await createServerSupabase();

  // Geocoding TIDAK PERNAH menggagalkan penyimpanan mitra (spec T6).
  // `geocodeAlamat` sudah menelan setiap galatnya dan memulangkan null; domisili
  // mitra pun BOLEH kosong (terisi menyusul).
  // PIN MENANG. Bila admin sudah menjatuhkan titik di peta, koordinat itu yang
  // dipakai dan Nominatim TIDAK ditanyai sama sekali — menanyakan alamat yang
  // jawabannya sudah pasti dibuang hanya membakar kuota gratis milik pihak
  // lain, dan pada volume nyata itulah yang memicu pemblokiran.
  //
  // Tanpa pin, jalur lama berlaku utuh: geocoding boleh gagal, dan kegagalannya
  // tidak pernah menggagalkan penyimpanan alamat (Ruling 9).
  const pin = koordinatDariFormData(formData);
  const koordinat = pin ?? (await geocodeAlamat(alamat));

  // `aktif` tidak ikut dikirim: kolomnya `default true` di basis data, dan
  // membiarkan default yang memutuskan berarti tidak ada satu pun jalan bagi
  // formulir untuk melahirkan mitra yang langsung nonaktif tanpa disadari.
  const { data, error } = await supabase
    .from("partners")
    .insert({ nama, no_hp: noHp, alamat, lat: koordinat?.lat ?? null, lon: koordinat?.lon ?? null })
    .select("id")
    .single();

  if (error || !data) return { ok: false, pesan: "Gagal menyimpan mitra." };

  revalidatePath("/admin/mitra");
  return { ok: true, id: data.id as string };
}

export async function perbaruiMitra(
  id: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const nama = String(formData.get("nama") ?? "").trim();
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const alamat = bersihkanAlamat(String(formData.get("alamat") ?? ""));

  if (nama.length < PANJANG_NAMA_MINIMAL) {
    return { ok: false, pesan: "Nama mitra terlalu pendek." };
  }

  const supabase = await createServerSupabase();

  // Geocoding TIDAK PERNAH menggagalkan penyimpanan (spec T6) — lihat `simpanMitra`.
  // PIN MENANG — lihat alasan lengkapnya di simpanMitra.
  const pin = koordinatDariFormData(formData);
  const koordinat = pin ?? (await geocodeAlamat(alamat));

  // Medan `aktif` yang ikut dikirim browser diabaikan tanpa pernah masuk
  // payload — keadaan mitra punya action tersendiri.
  const { data, error } = await supabase
    .from("partners")
    .update({ nama, no_hp: noHp, alamat, lat: koordinat?.lat ?? null, lon: koordinat?.lon ?? null })
    .eq("id", id)
    .select("id");

  // UPDATE yang tertahan RLS dijawab PostgREST dengan 200 + [] — melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan senyap.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal memperbarui mitra." };
  }

  revalidatePath("/admin/mitra");
  return { ok: true };
}

/**
 * Menonaktifkan mitra: ia berhenti ditawarkan saat menjadwalkan sesi baru.
 *
 * Yang TIDAK terjadi — dan dulu terjadi: namanya hilang dari riwayat sesi
 * seluruh klien. `partner_publik` sekarang tidak menyaring `aktif`, sehingga
 * catatan bidan yang sudah berlalu tetap bernama. Baris mitra karena itu tidak
 * pernah dihapus, hanya dinonaktifkan.
 */
export async function nonaktifkanMitra(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("partners")
    .update({ aktif: false })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menonaktifkan mitra." };
  }

  revalidatePath("/admin/mitra");
  return { ok: true };
}

export async function aktifkanMitra(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("partners")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal mengaktifkan mitra." };
  }

  revalidatePath("/admin/mitra");
  return { ok: true };
}
