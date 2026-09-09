"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

type Hasil = { ok: boolean; pesan: string };

/**
 * Menukar sebuah hak sesi menjadi sesi terjadwal yang lahir LUNAS.
 *
 * Sesi ADMIN sungguhan, bukan service role: `tukar_hak_sesi` menulis
 * `jejak_jadwal` beraktor, dan service role tidak punya `auth.uid()` sama
 * sekali. `src/app/admin/**` juga memang dilarang memuat service role
 * (`tests/admin-shell.test.ts`).
 *
 * Seluruh pagar — kepemilikan, keterpakaian, kedaluwarsa, keanggotaan jam
 * layanan, bentrok bidan, waktu minimal 2 jam dari sekarang — hidup DI DALAM
 * fungsi Postgres, bukan di sini. Yang ada di sini hanyalah penerjemah
 * kegagalannya menjadi kalimat.
 */
export async function tukarHakAdmin(formData: FormData): Promise<Hasil> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc("tukar_hak_sesi", {
    hak_id: String(formData.get("hak") ?? ""),
    tanggal_baru: String(formData.get("tanggal") ?? ""),
    jam_baru: String(formData.get("jam") ?? ""),
    mitra: String(formData.get("mitra") ?? ""),
  });

  if (error) return { ok: false, pesan: error.message };
  // NULL, bukan galat: hak tidak ditemukan, atau sudah ditukar penukaran lain.
  // Aksi yang hanya melihat `error` akan melaporkannya sebagai berhasil, dan
  // admin menutup layar yakin sesi penggantinya sudah ada.
  if (data === null) {
    return {
      ok: false,
      pesan: "Hak ini sudah ditukar atau tidak ditemukan lagi. Muat ulang halaman.",
    };
  }

  // Rute DINAMIS-nya, bukan halaman daftar: kartu "Kredit sesi (hak)" hidup di
  // `/admin/klien/[id]`, dan menyegarkan `/admin/klien` (daftar) meninggalkan
  // kartu itu menampilkan hak yang baru saja ditukar sampai halamannya dimuat
  // ulang dengan tangan. Bentuk `("/admin/klien/[id]", "page")` menyegarkan
  // SELURUH baris rute itu — Next tidak menerima path konkret berisi id untuk
  // rute dinamis tanpa memberitahunya bahwa itu memang rute, bukan berkas.
  revalidatePath("/admin/klien/[id]", "page");
  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return { ok: true, pesan: "Hak ditukar — sesi pengganti sudah terjadwal dan tercatat lunas." };
}
