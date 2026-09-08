"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hapusObjekBukti } from "@/lib/bukti/hapus";
import { PERMINTAAN_MENUNGGU_BAYAR } from "@/lib/jadwal/status";

/**
 * Jalur tulis admin untuk tagihan PENGAJUAN (spec C2 P3, P4).
 *
 * `requireRole` ditulis DI DALAM setiap action: server action adalah endpoint
 * POST tersendiri yang tidak pernah melewati penjaga layout.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

/**
 * Menandai tagihan pengajuan LUNAS.
 *
 * Yang menandai adalah manusia yang sudah membuka mutasi rekening. Bukti yang
 * diunggah klien mempercepat pencocokan dan meninggalkan jejak — ia BUKAN
 * bukti, karena gambar bisa dipalsukan dan hasil sunting sama meyakinkannya
 * dengan yang asli.
 *
 * Memakai SESI PENGGUNA, bukan service role: di bawah service role `auth.uid()`
 * NULL dan jejak audit mencatat aktor kosong — tepat kebalikan dari alasan
 * tabel jejak itu dibuat.
 */
export async function verifikasiPengajuan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("booking_requests")
    .update({ status_bayar: "lunas" })
    .eq("id", permintaanId)
    .eq("status", PERMINTAAN_MENUNGGU_BAYAR)
    // Hanya dari `menunggu_verifikasi`: menandai lunas sesuatu yang buktinya
    // belum pernah masuk berarti melewati langkah yang seluruh rantai ini ada
    // untuk menegakkannya.
    .eq("status_bayar", "menunggu_verifikasi")
    .select("id");

  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Tagihan ini tidak sedang menunggu verifikasi." };
  }

  revalidatePath("/admin/bayar");
  revalidatePath("/admin/sesi");
  revalidatePath("/passport/bayar");
  return { ok: true };
}

/**
 * Menghapus bukti bayar (spec C2 P4).
 *
 * Bukti disimpan SAMPAI DIHAPUS MANUAL — keputusan pemilik repo. Tanpa tombol
 * ini, "manual" pada praktiknya berarti "tidak pernah", dan yang menumpuk
 * adalah tangkapan layar rekening orang.
 *
 * Menghapus bukti TIDAK menghapus jejak: siapa memverifikasi dan kapan tetap
 * tersimpan di tabel jejak status bayar.
 */
export async function hapusBukti(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  // Baris dibaca & ditulis dengan SESI ADMIN — policy "booking: staf" yang
  // memutuskan, dan jejak auditnya beraktor nyata. Hanya penghapusan OBJEK di
  // storage yang menuntut service role, dan ia hidup di `lib/bukti/hapus`.
  const supabase = await createServerSupabase();

  const { data: baris } = await supabase
    .from("booking_requests")
    .select("bukti_objek")
    .eq("id", permintaanId)
    .maybeSingle<{ bukti_objek: string | null }>();

  if (!baris?.bukti_objek) return { ok: false, pesan: "Tidak ada bukti untuk dihapus." };

  if (!(await hapusObjekBukti(baris.bukti_objek))) {
    return { ok: false, pesan: "Gagal menghapus berkas." };
  }

  // Rujukannya ikut dikosongkan. Baris yang menunjuk objek yang sudah tidak ada
  // membuat layar menawarkan "Lihat bukti" yang selalu 404.
  await supabase.from("booking_requests").update({ bukti_objek: null }).eq("id", permintaanId);

  revalidatePath("/admin/bayar");
  return { ok: true };
}
