"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  PANJANG_DESKRIPSI_MAKS,
  periksaJumlahSesi,
  periksaNama,
} from "./status";

/**
 * Jalur tulis panel admin untuk katalog layanan & paket.
 *
 * Enam aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action — bukan sekali di puncak modul. Katalog adalah teks yang dibaca
 *     SELURUH pengunjung landing; endpoint terbuka di sini adalah papan nama
 *     klinik yang bisa ditulis ulang siapa saja.
 *
 *  2. KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER. Karena itu ada empat
 *     action keadaan terpisah (`aktifkanLayanan`/`nonaktifkanLayanan`,
 *     `aktifkanPaket`/`nonaktifkanPaket`), masing-masing dengan nilai `aktif`
 *     tertulis mati. `perbarui*` pun sengaja tidak pernah membaca medan `aktif`
 *     dari FormData.
 *
 *  3. TIDAK ADA PENGHAPUSAN. Hak DELETE atas `services`/`packages` sudah
 *     dicabut dari `authenticated` (migration cabut_hak_hapus_berlebih):
 *     jawabannya 403/42501, bukan "0 baris". Menghapus baris layanan juga akan
 *     memutus `sessions.service_id` milik riwayat lama. Pensiun yang benar
 *     adalah `aktif = false`, dan hanya itu yang tersedia di sini.
 *
 *  4. `perbaruiPaket` TIDAK PERNAH memindahkan paket ke layanan lain. Setiap
 *     baris `client_packages` yang sudah menunjuk paket ini akan ikut berpindah
 *     arti — progres passport orang lain berganti layanan tanpa satu pun error.
 *
 *  5. UPDATE yang tertahan dijawab PostgREST 200 + []. Melaporkan "berhasil"
 *     tanpa memeriksa panjangnya adalah kebohongan senyap.
 *
 *  6. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `services: staf
 *     kelola` dan `packages: staf kelola` tidak pernah ikut diperiksa.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async — label, batas, dan
 * validator murni tinggal di `./status`.
 */
type Gagal = { ok: false; pesan: string };
type Dibuat = { ok: true; id: string };
type Berhasil = { ok: true };

/**
 * Kanal yang membaca nama layanan. Landing dan wizard pengajuan klien membaca
 * tabel yang sama: layanan baru yang tidak merambat ke sana adalah layanan yang
 * tidak pernah ada bagi pengunjung.
 */
function segarkanKatalog() {
  revalidatePath("/admin/layanan");
  revalidatePath("/admin/sesi"); // daftar pilihan saat menjadwalkan
  revalidatePath("/"); // katalog landing publik
  revalidatePath("/passport/ajukan"); // wizard pengajuan jadwal klien
  revalidatePath("/passport"); // nama layanan di riwayat sesi
}

/**
 * Kanal yang membaca paket. `packages.jumlah_sesi` adalah PENYEBUT progres
 * passport: mengubahnya menggeser angka setiap klien yang paketnya sedang
 * berjalan, jadi halaman-halaman itu wajib ikut disegarkan.
 */
function segarkanPaket() {
  revalidatePath("/admin/layanan");
  revalidatePath("/passport"); // progres & grid stempel
  revalidatePath("/passport/bayar"); // label item tagihan
  revalidatePath("/admin/bayar"); // label item yang sama, sisi admin
}

async function periksaFase(faseId: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("phases")
    .select("id")
    .eq("id", faseId) // operator setara, tidak pernah pola
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// Layanan
// ---------------------------------------------------------------------------

export async function simpanLayanan(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const faseId = String(formData.get("phase_id") ?? "").trim();
  const nama = periksaNama(String(formData.get("nama") ?? ""));
  const deskripsi = String(formData.get("deskripsi") ?? "").trim();

  if (!nama.ok) return { ok: false, pesan: `Nama layanan: ${nama.pesan}` };
  if (deskripsi.length > PANJANG_DESKRIPSI_MAKS) {
    return { ok: false, pesan: `Deskripsi maksimal ${PANJANG_DESKRIPSI_MAKS} karakter.` };
  }
  // Foreign key memang menolak `phase_id` yang tidak ada, tetapi pesannya
  // adalah kode Postgres — bukan kalimat yang boleh dibaca admin klinik.
  if (!(await periksaFase(faseId))) {
    return { ok: false, pesan: "Fase tidak dikenal. Pilih salah satu fase yang ada." };
  }

  const supabase = await createServerSupabase();

  // `aktif` tidak ikut dikirim: kolomnya `default true` di basis data, dan
  // membiarkan default yang memutuskan berarti tidak ada satu pun jalan bagi
  // formulir untuk melahirkan layanan yang langsung nonaktif tanpa disadari.
  const { data, error } = await supabase
    .from("services")
    .insert({ phase_id: faseId, nama: nama.nilai, deskripsi })
    .select("id")
    .single();

  if (error || !data) return { ok: false, pesan: "Gagal menyimpan layanan." };

  segarkanKatalog();
  return { ok: true, id: data.id as string };
}

export async function perbaruiLayanan(
  id: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const faseId = String(formData.get("phase_id") ?? "").trim();
  const nama = periksaNama(String(formData.get("nama") ?? ""));
  const deskripsi = String(formData.get("deskripsi") ?? "").trim();

  if (!nama.ok) return { ok: false, pesan: `Nama layanan: ${nama.pesan}` };
  if (deskripsi.length > PANJANG_DESKRIPSI_MAKS) {
    return { ok: false, pesan: `Deskripsi maksimal ${PANJANG_DESKRIPSI_MAKS} karakter.` };
  }
  if (!(await periksaFase(faseId))) {
    return { ok: false, pesan: "Fase tidak dikenal. Pilih salah satu fase yang ada." };
  }

  const supabase = await createServerSupabase();

  // Hanya tiga kolom identitas yang pernah menyentuh basis data. Medan `aktif`
  // yang ikut dikirim browser diabaikan tanpa pernah masuk payload — keadaan
  // layanan punya action tersendiri.
  const { data, error } = await supabase
    .from("services")
    .update({ phase_id: faseId, nama: nama.nilai, deskripsi })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Layanan tidak ditemukan atau gagal diperbarui." };
  }

  segarkanKatalog();
  return { ok: true };
}

/**
 * Menonaktifkan layanan: ia berhenti muncul di katalog landing dan berhenti
 * ditawarkan saat menjadwalkan sesi baru.
 *
 * Yang TIDAK terjadi — dan pernah terjadi pada mitra: namanya hilang dari
 * riwayat sesi seluruh klien. Policy `"services: baca"` untuk `authenticated`
 * sengaja tidak menyebut `aktif`; filter itu hidup di policy terpisah yang
 * menyasar `anon`. Jangan pernah memindahkannya, dan jangan pernah melahirkan
 * view penyaring — itu mengulangi persis bug `partner_publik`.
 */
export async function nonaktifkanLayanan(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("services")
    .update({ aktif: false })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menonaktifkan layanan." };
  }

  segarkanKatalog();
  return { ok: true };
}

export async function aktifkanLayanan(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("services")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal mengaktifkan layanan." };
  }

  segarkanKatalog();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Paket
// ---------------------------------------------------------------------------

export async function simpanPaket(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const layananId = String(formData.get("service_id") ?? "").trim();
  const nama = periksaNama(String(formData.get("nama") ?? ""));
  const jumlah = periksaJumlahSesi(String(formData.get("jumlah_sesi") ?? ""));

  if (!nama.ok) return { ok: false, pesan: `Nama paket: ${nama.pesan}` };
  if (!jumlah.ok) return { ok: false, pesan: jumlah.pesan };

  const supabase = await createServerSupabase();

  const { data: layanan } = await supabase
    .from("services")
    .select("id")
    .eq("id", layananId)
    .maybeSingle();
  if (!layanan) {
    return { ok: false, pesan: "Layanan tidak ditemukan. Pilih layanan induknya." };
  }

  const { data, error } = await supabase
    .from("packages")
    .insert({ service_id: layananId, nama: nama.nilai, jumlah_sesi: jumlah.nilai })
    .select("id")
    .single();

  if (error || !data) return { ok: false, pesan: "Gagal menyimpan paket." };

  segarkanPaket();
  return { ok: true, id: data.id as string };
}

/**
 * Mengubah nama & jumlah sesi paket.
 *
 * `service_id` SENGAJA tidak pernah dibaca dari formulir: setiap baris
 * `client_packages` yang sudah menunjuk paket ini akan ikut berpindah layanan,
 * dan progres passport orang lain berganti arti tanpa satu pun error.
 *
 * `jumlah_sesi` adalah penyebut progres passport. Memperkecilnya menggeser
 * angka setiap klien yang paketnya sedang berjalan; `progresPaket()` sudah
 * membatasi persennya pada 100 supaya tidak lahir "200%", tetapi keputusan
 * mengubahnya tetap milik admin — karena itu formulirnya memperingatkan lebih
 * dulu, lengkap dengan berapa klien yang sedang memakai paket ini.
 */
export async function perbaruiPaket(
  id: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const nama = periksaNama(String(formData.get("nama") ?? ""));
  const jumlah = periksaJumlahSesi(String(formData.get("jumlah_sesi") ?? ""));

  if (!nama.ok) return { ok: false, pesan: `Nama paket: ${nama.pesan}` };
  if (!jumlah.ok) return { ok: false, pesan: jumlah.pesan };

  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("packages")
    .update({ nama: nama.nilai, jumlah_sesi: jumlah.nilai })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Paket tidak ditemukan atau gagal diperbarui." };
  }

  segarkanPaket();
  return { ok: true };
}

export async function nonaktifkanPaket(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("packages")
    .update({ aktif: false })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menonaktifkan paket." };
  }

  segarkanPaket();
  return { ok: true };
}

export async function aktifkanPaket(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("packages")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal mengaktifkan paket." };
  }

  segarkanPaket();
  return { ok: true };
}
