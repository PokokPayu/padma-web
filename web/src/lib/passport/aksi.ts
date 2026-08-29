"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { BATAS_PERMINTAAN_MENUNGGU } from "./batas";
import { hariIniJakarta } from "./waktu";

/**
 * SATU-SATUNYA jalur tulis milik klien.
 *
 * Server action adalah endpoint POST tersendiri: ia dapat dipanggil tanpa
 * melewati UI, sehingga penjaga di `src/app/passport/layout.tsx` TIDAK berlaku
 * di sini. `requireRole(["klien"])` karena itu ditulis di dalam action.
 *
 * Parameter action sengaja TIDAK memuat status tujuan. Begitu status datang
 * dari browser, seluruh rancangan runtuh: verifikasi manual admin bisa
 * dilompati klien sendiri. Nilai tujuan selalu hardcoded di berkas ini.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

async function klienSaatIni(): Promise<string | null> {
  await requireRole(["klien"]);

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Identitas klien selalu diturunkan dari SESI, tidak pernah dari parameter —
  // itulah yang membuat filter kepemilikan di bawah bermakna.
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function klaimSudahBayar(
  jenis: "paket" | "sesi",
  id: string,
): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  // Service role dipakai HANYA untuk menulis satu kolom status, dengan filter
  // kepemilikan eksplisit + syarat status asal. Karena service role menembus
  // RLS, kedua filter inilah satu-satunya pagar yang tersisa.
  const admin = createAdminSupabase();
  const tabel = jenis === "paket" ? "client_packages" : "sessions";
  const { data, error } = await admin
    .from(tabel)
    .update({ status_bayar: "menunggu_verifikasi" })
    .eq("id", id)
    .eq("client_id", clientId) // kepemilikan
    .eq("status_bayar", "belum") // hanya dari 'belum'; keputusan berikutnya milik admin
    .select("id");

  if (error) return { ok: false, pesan: "Gagal memproses." };
  // UPDATE yang tertahan menghasilkan 0 baris TANPA error — jangan melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya.
  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Item tidak ditemukan atau statusnya sudah berubah." };
  }

  revalidatePath("/passport/bayar");
  return { ok: true };
}

const WAKTU_SAH = ["pagi", "siang", "sore"];

export async function ajukanJadwal(formData: FormData): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  const serviceId = String(formData.get("layanan") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const waktu = String(formData.get("waktu") ?? "");
  const catatan = String(formData.get("catatan") ?? "").slice(0, 300);

  // Kolom `tanggal` bertipe date dan hidup sebagai string YYYY-MM-DD di
  // seluruh aplikasi — bentuknya diperiksa apa adanya, tanpa aritmatika Date
  // (server berjalan UTC, mesin dev WIB).
  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return { ok: false, pesan: "Lengkapi layanan dan tanggal." };
  }
  if (!WAKTU_SAH.includes(waktu)) {
    return { ok: false, pesan: "Preferensi waktu tidak sah." };
  }

  // Perbandingan STRING, bukan aritmatika Date: kolom `tanggal` bertipe date
  // dan hidup sebagai 'YYYY-MM-DD'. "Hari ini" diambil dari kalender Jakarta —
  // server berjalan UTC, jadi jam mesin akan salah hari selama 7 jam setiap
  // hari. Regex di atas hanya memeriksa RUPA tanggal; ini yang memeriksa NILAI
  // (red team meloloskan 2020-01-01 lewat celah itu).
  if (tanggal < hariIniJakarta()) {
    return { ok: false, pesan: "Tanggal sudah lewat. Pilih tanggal mulai hari ini." };
  }

  const supabase = await createServerSupabase();

  // Layanan harus AKTIF. Foreign key hanya menolak service_id yang TIDAK ADA,
  // sedangkan formulir menyaring `aktif` di UI — dan server action adalah
  // endpoint POST tersendiri yang tidak pernah melewati UI itu.
  const { data: layanan } = await supabase
    .from("services")
    .select("id")
    .eq("id", serviceId)
    .eq("aktif", true)
    .maybeSingle();
  if (!layanan) {
    return { ok: false, pesan: "Layanan tidak tersedia untuk saat ini." };
  }

  // Pembatas antrean. Penegak sebenarnya ada di basis data (trigger
  // guard_booking_pembatas + unique index booking_requests_antrean_unik),
  // karena klien memegang policy INSERT dan bisa memanggil PostgREST langsung.
  // Dua pemeriksaan di bawah ada untuk PESAN yang bisa dibaca manusia, bukan
  // sebagai pagar — pagarnya sudah dipasang sebelum lapisan ini.
  const { count } = await supabase
    .from("booking_requests")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "menunggu");
  if ((count ?? 0) >= BATAS_PERMINTAAN_MENUNGGU) {
    return {
      ok: false,
      pesan: `Masih ada ${BATAS_PERMINTAAN_MENUNGGU} permintaan yang menunggu jawaban tim PADMA. Tunggu kabarnya dulu, ya.`,
    };
  }

  const { data: kembar } = await supabase
    .from("booking_requests")
    .select("id")
    .eq("client_id", clientId)
    .eq("service_id", serviceId)
    .eq("tanggal", tanggal)
    .eq("preferensi_waktu", waktu)
    .eq("status", "menunggu")
    .limit(1);
  if ((kembar ?? []).length > 0) {
    return { ok: false, pesan: "Permintaan yang sama sudah terkirim dan sedang diproses." };
  }

  // Insert memakai SESI PENGGUNA, bukan service role: RLS + trigger
  // guard_booking_status menjadi lapis kedua di belakang nilai hardcoded ini.
  // Nilai apa pun yang ikut dikirim browser di FormData diabaikan — hanya
  // empat medan di bawah yang pernah menyentuh basis data.
  const { error } = await supabase.from("booking_requests").insert({
    client_id: clientId,
    service_id: serviceId,
    tanggal,
    preferensi_waktu: waktu,
    catatan,
    status: "menunggu", // hardcoded; trigger DB menolak nilai lain dari klien
  });
  if (error) return { ok: false, pesan: "Gagal mengirim permintaan." };

  revalidatePath("/passport");
  return { ok: true };
}
