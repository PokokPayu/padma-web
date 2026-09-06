"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  PANJANG_DESKRIPSI_MAKS,
  periksaDurasiVarian,
  periksaFormatVarian,
  periksaJumlahSesi,
  periksaLabelVarian,
  periksaNama,
  periksaUrutanVarian,
} from "./status";

/**
 * Jalur tulis panel admin untuk katalog layanan, paket, & varian.
 *
 * Enam aturan yang mengikat berkas ini — berlaku sama untuk ketiganya:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action — bukan sekali di puncak modul. Katalog adalah teks yang dibaca
 *     SELURUH pengunjung landing; endpoint terbuka di sini adalah papan nama
 *     klinik yang bisa ditulis ulang siapa saja.
 *
 *  2. KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER. Karena itu ada enam
 *     action keadaan terpisah (`aktifkanLayanan`/`nonaktifkanLayanan`,
 *     `aktifkanPaket`/`nonaktifkanPaket`, `aktifkanVarian`/`nonaktifkanVarian`),
 *     masing-masing dengan nilai `aktif` tertulis mati. `perbarui*` pun sengaja
 *     tidak pernah membaca medan `aktif` dari FormData.
 *
 *  3. TIDAK ADA PENGHAPUSAN. Hak DELETE atas `services`/`packages`/
 *     `service_variants` sudah dicabut dari `authenticated` (migration
 *     cabut_hak_hapus_berlebih & varian_layanan): jawabannya 403/42501, bukan
 *     "0 baris". Menghapus baris layanan juga akan memutus `sessions.service_id`
 *     milik riwayat lama; menghapus varian memutus `sessions.variant_id` DAN
 *     baris tarif per varian (wilayah owner) yang menunjuknya — riwayat sesi
 *     maupun riwayat tarif sekaligus. Pensiun yang benar adalah `aktif =
 *     false`, dan hanya itu yang tersedia di sini.
 *
 *  4. `perbaruiPaket` DAN `perbaruiVarian` TIDAK PERNAH memindahkan barisnya
 *     ke layanan lain. Setiap baris `client_packages`/`sessions` yang sudah
 *     menunjuknya akan ikut berpindah arti — progres passport atau riwayat
 *     harga orang lain berganti layanan tanpa satu pun error.
 *
 *  5. UPDATE yang tertahan dijawab PostgREST 200 + []. Melaporkan "berhasil"
 *     tanpa memeriksa panjangnya adalah kebohongan senyap.
 *
 *  6. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `services: staf
 *     kelola`, `packages: staf kelola`, dan `service_variants: staf kelola`
 *     tidak pernah ikut diperiksa.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async — label, batas, dan
 * validator murni tinggal di `./status`.
 *
 * KHUSUS VARIAN — pagar yang BUKAN salah satu dari enam di atas: lihat
 * catatan panjang di `nonaktifkanVarian()` soal "varian aktif terakhir".
 * Pagar V3 ("setiap layanan wajib punya minimal satu varian") sendiri sudah
 * ditegakkan trigger basis data `trg_terbitkan_varian_baku` (migrasi
 * 20260906130000) — berkas ini TIDAK menduplikasinya.
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

// ---------------------------------------------------------------------------
// Varian
// ---------------------------------------------------------------------------
//
// Empat action di bawah SENGAJA seluruhnya menerima FormData — beda dari
// `aktifkanLayanan(id)`/`aktifkanPaket(id)` di atas yang menerima id telanjang.
// Alasannya bukan gaya: `nonaktifkanVarian` butuh membaca `service_id` varian
// itu SEBELUM menuliskan apa pun (untuk pagar "varian aktif terakhir" di
// bawah), dan bentuk FormData yang seragam untuk keempatnya membuat
// `perbaruiVarian` — yang jelas butuh lebih dari satu medan — tidak berdiri
// sendiri sebagai satu-satunya action varian berbentuk beda.

export async function buatVarian(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const serviceId = String(formData.get("service_id") ?? "").trim();
  const label = periksaLabelVarian(String(formData.get("label") ?? ""));
  const durasi = periksaDurasiVarian(String(formData.get("durasi_menit") ?? ""));
  const format = periksaFormatVarian(String(formData.get("format") ?? ""));
  const urutan = periksaUrutanVarian(String(formData.get("urutan") ?? ""));

  if (!label.ok) return { ok: false, pesan: `Label varian: ${label.pesan}` };
  if (!durasi.ok) return { ok: false, pesan: durasi.pesan };
  if (!format.ok) return { ok: false, pesan: format.pesan };
  if (!urutan.ok) return { ok: false, pesan: urutan.pesan };

  const supabase = await createServerSupabase();

  // Foreign key gabungan (service_id, variant_id) di `sessions` memang
  // menolak `service_id` yang tidak ada, tetapi pesannya kode Postgres —
  // bukan kalimat yang boleh dibaca admin klinik. Sama seperti `simpanPaket`.
  const { data: layanan } = await supabase
    .from("services")
    .select("id")
    .eq("id", serviceId)
    .maybeSingle();
  if (!layanan) {
    return { ok: false, pesan: "Layanan tidak ditemukan. Pilih layanan induknya." };
  }

  const { data, error } = await supabase
    .from("service_variants")
    .insert({
      service_id: serviceId,
      label: label.nilai,
      durasi_menit: durasi.nilai,
      format: format.nilai,
      urutan: urutan.nilai,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, pesan: "Gagal menyimpan varian." };

  segarkanKatalog();
  return { ok: true, id: data.id as string };
}

/**
 * Mengubah label, durasi, format, dan urutan tampil sebuah varian.
 *
 * `service_id` SENGAJA tidak pernah dibaca dari FormData — pelajaran yang
 * sama dengan `perbaruiPaket`: setiap baris `sessions` dan setiap baris tarif
 * per varian (wilayah owner) yang sudah menunjuk varian ini akan ikut
 * berpindah layanan, dan harga yang menempel padanya berganti arti tanpa
 * satu pun error.
 */
export async function perbaruiVarian(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const id = String(formData.get("varian") ?? "").trim();
  const label = periksaLabelVarian(String(formData.get("label") ?? ""));
  const durasi = periksaDurasiVarian(String(formData.get("durasi_menit") ?? ""));
  const format = periksaFormatVarian(String(formData.get("format") ?? ""));
  const urutan = periksaUrutanVarian(String(formData.get("urutan") ?? ""));

  if (!label.ok) return { ok: false, pesan: `Label varian: ${label.pesan}` };
  if (!durasi.ok) return { ok: false, pesan: durasi.pesan };
  if (!format.ok) return { ok: false, pesan: format.pesan };
  if (!urutan.ok) return { ok: false, pesan: urutan.pesan };

  const supabase = await createServerSupabase();

  // Hanya empat kolom identitas/tampilan yang pernah menyentuh basis data di
  // sini. `service_id` yang ikut dikirim browser diabaikan tanpa pernah masuk
  // payload di atas — dan tanpa `.eq("service_id", ...)` di WHERE, karena
  // varian yang mau diubah sudah cukup diidentifikasi oleh `id`-nya sendiri.
  const { data, error } = await supabase
    .from("service_variants")
    .update({
      label: label.nilai,
      durasi_menit: durasi.nilai,
      format: format.nilai,
      urutan: urutan.nilai,
    })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Varian tidak ditemukan atau gagal diperbarui." };
  }

  segarkanKatalog();
  return { ok: true };
}

/**
 * Menonaktifkan varian: ia berhenti ditawarkan untuk sesi & pengajuan jadwal
 * baru. Sesi yang sudah menunjuknya tetap menyebutnya apa adanya — policy
 * baca `service_variants: baca terautentikasi` sengaja tidak menyaring
 * `aktif`, pola yang sama dengan `nonaktifkanLayanan`.
 *
 * PAGAR DI BAWAH INI ("layanan tidak boleh kehilangan varian aktif terakhir")
 * ADALAH PEMERIKSAAN APLIKASI, BUKAN PAGAR BASIS DATA — beda dari V3 spec
 * ("setiap layanan wajib punya minimal satu varian") yang sudah ditegakkan
 * trigger `trg_terbitkan_varian_baku` (migrasi 20260906130000). Trigger itu
 * hanya menjamin varian SELALU LAHIR saat layanan lahir; ia tidak — dan tidak
 * bisa tanpa trigger keduanya sendiri — menjamin masih ada varian AKTIF
 * sesudah admin menonaktifkan satu per satu lewat action ini.
 *
 * Konsekuensinya SADAR, bukan lupa: POST langsung ke /rest/v1/service_variants
 * (atau service role mana pun) bisa melewati pemeriksaan di bawah dan
 * menonaktifkan varian aktif terakhir sebuah layanan. Itu diterima DI SINI —
 * beda dari pagar uang di modul `owner/tarif` yang selalu ditegakkan basis
 * data — karena akibatnya bukan uang maupun riwayat yang rusak: layanan tanpa
 * varian aktif hanya berhenti bisa dipesan (setiap perhitungan harga jatuh ke
 * cabang "tak bertarif" yang sudah ditangani `ambilRateCard()` sejak Task 4),
 * dan admin selalu bisa mengaktifkannya kembali dari layar yang sama. Tidak
 * ada baris yang hilang, tidak ada nominal yang salah tagih.
 */
export async function nonaktifkanVarian(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const id = String(formData.get("varian") ?? "").trim();
  const supabase = await createServerSupabase();

  const { data: varian } = await supabase
    .from("service_variants")
    .select("id, service_id")
    .eq("id", id)
    .maybeSingle();
  if (!varian) return { ok: false, pesan: "Varian tidak ditemukan." };

  const { count } = await supabase
    .from("service_variants")
    .select("id", { count: "exact", head: true })
    .eq("service_id", varian.service_id)
    .eq("aktif", true)
    .neq("id", id);
  if (!count) {
    return {
      ok: false,
      pesan:
        "Tidak bisa menonaktifkan varian terakhir yang aktif pada layanan ini. " +
        "Aktifkan varian lain dulu, atau nonaktifkan layanannya sekalian.",
    };
  }

  const { data, error } = await supabase
    .from("service_variants")
    .update({ aktif: false })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menonaktifkan varian." };
  }

  segarkanKatalog();
  return { ok: true };
}

export async function aktifkanVarian(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const id = String(formData.get("varian") ?? "").trim();
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("service_variants")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal mengaktifkan varian." };
  }

  segarkanKatalog();
  return { ok: true };
}
