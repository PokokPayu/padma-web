"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hapusObjekBukti } from "@/lib/bukti/hapus";

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
 * NULL dan `user_role()` 'klien', jadi gerbang staf RPC-nya menolak.
 *
 * Sejak P3/B4 lewat RPC `verifikasi_bukti_warisan`, bukan UPDATE REST: trigger
 * `guard_status_bayar_permintaan` menolak setiap tulisan `status_bayar` dari
 * peran API (§6.7). RPC itu KHUSUS baris warisan QRIS — `menunggu_bayar`,
 * `menunggu_verifikasi`, dan tanpa satu pun pesanan (§7); pengajuan yang
 * dibayar lewat DOKU ditolak dengan kalimatnya sendiri.
 */
export async function verifikasiPengajuan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("verifikasi_bukti_warisan", {
    p_permintaan_id: permintaanId,
  });

  if (error) {
    // P0001 adalah kalimat manusia yang ditulis RPC itu sendiri ("tidak
    // sedang menunggu verifikasi", "dibayar lewat DOKU"). Selain itu tidak
    // ada pesan Postgres mentah yang diteruskan.
    return {
      ok: false,
      pesan: error.code === "P0001" ? error.message : "Gagal memverifikasi pembayaran. Coba lagi.",
    };
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
