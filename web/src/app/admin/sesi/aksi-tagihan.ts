"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { adaTagihanTerbuka, KALIMAT_TAGIHAN_DITUTUP } from "@/lib/tagihan/terbuka";

/**
 * Aksi admin atas pengajuan yang tagihannya pesanan sesi DOKU (P3/B4, spec
 * §6.5, §6.7).
 *
 * Aturan yang mengikat berkas ini sama dengan `aksi.ts`:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI, jadi
 *     `requireRole(["admin","owner"])` ditulis di dalam SETIAP action.
 *  2. Sesi pengguna, bukan service role: RPC di bawah bergerbang
 *     `user_role()`, yang di bawah service role selalu 'klien'.
 *  3. Keadaan tujuan tidak pernah menjadi parameter. Pembatalan selalu ke
 *     `dibatalkan_tenggat`, tertulis mati di fungsi SQL-nya.
 *
 * Seluruh aturan uang hidup di basis data (migrasi `20261113140400`):
 *  - pembatalan ditolak bila uang untuk pengajuan itu sudah masuk — penjaganya
 *    trigger yang berlaku untuk SEMUA peran, termasuk RPC di bawah;
 *  - pesanan terbuka ditutup trigger begitu pengajuan batal atau bidannya
 *    berganti;
 *  - kunci diambil berurutan pesanan -> pengajuan, sama dengan webhook DOKU,
 *    supaya pembatalan yang berbalapan dengan pelunasan tidak deadlock.
 * Berkas ini hanya menerjemahkan hasilnya menjadi kalimat.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true; pesan?: string };

/**
 * Galat RPC -> kalimat admin. P0001 adalah kalimat manusia yang ditulis
 * fungsi SQL B4 sendiri (termasuk "Pembayaran pengajuan ini sudah masuk dan
 * sedang diperiksa admin."), jadi diteruskan apa adanya. Kode lain — galat
 * sistem, deadlock yang dideteksi Postgres, jaringan — tidak pernah diteruskan
 * mentah.
 */
function kalimatGalat(error: { code?: string; message?: string }, cadangan: string): string {
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "42501") return "Hanya admin atau owner yang boleh melakukan ini.";
  return cadangan;
}

function segarkanLayar(): void {
  revalidatePath("/admin/sesi");
  revalidatePath("/admin/pesanan");
  revalidatePath("/admin");
  revalidatePath("/passport");
  revalidatePath("/passport/bayar");
}

/**
 * "Batalkan pengajuan" (§6.5): `menunggu_bayar` -> `dibatalkan_tenggat`,
 * skrining DILEPAS, pesanan terbuka ditutup di transaksi yang sama. Berlaku
 * juga untuk baris warisan tanpa pesanan (§7). Satu baris per klik — tidak ada
 * pembatalan massal.
 */
export async function batalkanPengajuanStaf(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("batalkan_pengajuan_staf", {
    p_permintaan_id: permintaanId,
  });
  if (error) {
    return { ok: false, pesan: kalimatGalat(error, "Gagal membatalkan pengajuan. Coba lagi.") };
  }

  segarkanLayar();
  return { ok: true };
}

/**
 * "Ganti bidan" selama `menunggu_bayar`, tanpa mundur ke `mencari_mitra`.
 *
 * Pesanan yang masih terbuka ditutup (harga dihitung dari titik bidan, jadi
 * tagihan wajib diterbitkan ulang). Pada pengajuan TERTAHAN — pesanan lunas,
 * sesi belum lahir karena bidannya nonaktif — pesanan lunasnya tidak disentuh
 * dan harganya tetap beku; sesudahnya admin menekan "Terbitkan akses / Buat
 * sesi" di `/admin/pesanan` (§6.4).
 */
export async function gantiBidanMenungguBayar(
  permintaanId: string,
  partnerId: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Dibaca sebelum RPC: pesanan terbuka ditutup di dalamnya, dan admin harus
  // TAHU tagihannya perlu diterbitkan ulang (Ruling 10.2).
  const terbukaSebelum = await adaTagihanTerbuka(supabase, permintaanId);

  const { error } = await supabase.rpc("ganti_bidan_permintaan", {
    p_permintaan_id: permintaanId,
    p_partner_id: partnerId,
  });
  if (error) {
    return { ok: false, pesan: kalimatGalat(error, "Gagal mengganti bidan. Coba lagi.") };
  }

  segarkanLayar();
  if (terbukaSebelum && !(await adaTagihanTerbuka(supabase, permintaanId))) {
    return { ok: true, pesan: KALIMAT_TAGIHAN_DITUTUP };
  }
  return { ok: true };
}

/**
 * "Sudah dikabari" (§6.7): mengosongkan penanda `kabari_bidan_sejak` yang
 * dipasang penyalur sesi saat sesi lahir otomatis dari pesanan lunas.
 *
 * Idempoten: menekan dua kali tetap berhasil. Baris yang tidak terlihat
 * (tidak ada, atau RLS menahannya) dijawab PostgREST 200 + [], jadi jumlah
 * barisnya diperiksa.
 */
export async function tandaiSudahDikabari(sesiId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .update({ kabari_bidan_sejak: null })
    .eq("id", sesiId)
    .select("id");

  if (error) return { ok: false, pesan: "Gagal menyimpan tanda. Coba lagi." };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Sesi tidak ditemukan." };

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  return { ok: true };
}
