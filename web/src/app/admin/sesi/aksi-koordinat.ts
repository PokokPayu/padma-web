"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";
import { STATUS_ANTRE } from "@/lib/jadwal/status";

/**
 * Menaruh pin pada alamat sebuah PERMINTAAN.
 *
 * Kenapa layar ini ada: formulir pengajuan klien tidak punya pemilih peta, dan
 * `booking_requests.alamat_lat` hanya terisi lewat warisan alamat profil yang
 * IDENTIK persis atau lewat Nominatim — yang untuk alamat Malang sebagian
 * besar gagal (26 dari 32 pada probe spec pemilih-lokasi). Akibatnya bukan
 * sekadar label yang membingungkan: `konfirmasi_permintaan` menghitung jenjang
 * transport dari koordinat ini, jadi permintaan tanpa koordinat melahirkan sesi
 * tanpa jenjang yang harus ditetapkan tangan belakangan.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

export async function tetapkanKoordinatPermintaan(
  permintaanId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  // Parser yang SAMA dengan form mitra dan form klien, bukan yang kedua:
  // rentang lat/lon dan penolakan medan kosong sudah hidup di sana.
  const koordinat = koordinatDariFormData(formData);
  if (!koordinat) {
    return { ok: false, pesan: "Pin belum dijatuhkan di peta, atau koordinatnya tidak sah." };
  }

  const supabase = await createServerSupabase();

  // HANYA yang masih di antrean. Sesudah dikonfirmasi, sesinya sudah lahir
  // membawa SALINAN koordinat ini beserta jenjang yang dihitung darinya —
  // mengubah baris permintaan di titik itu tidak memperbaiki apa pun, ia hanya
  // membuat dua baris bercerita berbeda tentang tempat yang sama.
  //
  // `status` TIDAK ikut dalam payload: menaruh koordinat bukan langkah dalam
  // rantai, dan guard_booking_status memang hanya menjaga perpindahan status.
  const { data, error } = await supabase
    .from("booking_requests")
    .update({ alamat_lat: koordinat.lat, alamat_lon: koordinat.lon })
    .eq("id", permintaanId)
    .in("status", [...STATUS_ANTRE])
    .select("id");

  // UPDATE yang tertahan RLS dijawab PostgREST dengan 200 + [] — melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan senyap.
  if (error || (data ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Gagal menyimpan pin. Permintaan mungkin sudah dikonfirmasi atau dibatalkan.",
    };
  }

  revalidatePath("/admin/sesi");
  return { ok: true };
}
