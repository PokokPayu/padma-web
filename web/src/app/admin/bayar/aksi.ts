"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ASAL_SAH_LUNAS, ASAL_SAH_TOLAK } from "./status";
import { SESI_DIBATALKAN } from "@/lib/jadwal/status";

/**
 * Jalur tulis keputusan pembayaran — satu-satunya tempat status uang berubah
 * atas kehendak manusia di panel admin.
 *
 * Lima aturan yang mengikat berkas ini:
 *
 *  1. KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER. Prototipe memakai
 *     `<select onchange="ubahStatusBayar(id, this.value)">` — status dikirim
 *     dari browser. Bentuk celah itu sudah pernah tembus di proyek ini, jadi
 *     ada DUA action dengan nilai tertulis mati, dan tombolnya dirender
 *     bersyarat menurut status barisnya.
 *
 *  2. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis di dalam jalur
 *     ini — tanpa itu, klien yang login bisa melunasi tagihannya sendiri.
 *
 *  3. SESI PENGGUNA, BUKAN SERVICE ROLE. Inilah alasan modul ini ada: trigger
 *     `catat_jejak_status_bayar` merekam `auth.uid()` dan `user_role()`. Di
 *     bawah service role jejaknya tetap terbit, tetapi berbunyi
 *     `aktor_id: null, peran_aktor: 'service_role'` — bukti yang tidak menyebut
 *     siapa pun, yaitu bukan bukti.
 *
 *  4. SARINGAN DAFTAR IKUT KE DALAM `WHERE`. Sesi berpaket dan sesi batal bukan
 *     tagihan; keduanya tidak muncul di daftar, dan bila id-nya tetap di-POST
 *     jawabannya tetap penolakan. Tampilan bukan pagar.
 *
 *  5. UPDATE YANG TERTAHAN DIJAWAB 200 + []. Melaporkan sukses tanpa memeriksa
 *     panjangnya berarti admin melihat "Lunas" untuk baris yang tidak berubah
 *     sama sekali — dan klien tetap ditagih.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async; daftar putih dan
 * labelnya tinggal di `status.ts`.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

async function ubahStatus(
  jenis: "paket" | "sesi",
  id: string,
  tujuan: "lunas" | "belum",
  asalSah: readonly string[],
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Dua cabang ditulis penuh, bukan satu query dengan nama tabel dinamis:
  // syarat "masih menjadi tagihan" berbeda untuk paket dan sesi, dan yang
  // dinamis hanya akan mengaburkan perbedaan itu pada perubahan berikutnya.
  const { data, error } =
    jenis === "paket"
      ? await supabase
          .from("client_packages")
          .update({ status_bayar: tujuan })
          .eq("id", id)
          .eq("status", "aktif")
          .in("status_bayar", asalSah)
          .select("id")
      : await supabase
          .from("sessions")
          .update({ status_bayar: tujuan })
          .eq("id", id)
          .is("client_package_id", null) // sesi berpaket bukan tagihan
          .neq("status", SESI_DIBATALKAN)
          .in("status_bayar", asalSah)
          .select("id");

  if (error) {
    return { ok: false, pesan: "Gagal memperbarui status pembayaran. Coba lagi." };
  }
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Status item sudah berubah atau bukan tagihan yang bisa diubah. Muat ulang halaman.",
    };
  }

  revalidatePath("/admin/bayar");
  revalidatePath("/admin"); // badge antrean di dashboard & navigasi
  revalidatePath("/passport/bayar"); // klien melihat hasilnya tanpa menunggu
  return { ok: true };
}

/**
 * Bukti sudah cocok dengan mutasi rekening → item dinyatakan LUNAS.
 *
 * Sah dari 'menunggu_verifikasi' (klien mengklaim lewat passport) maupun dari
 * 'belum' — banyak klien transfer lalu melapor langsung lewat WhatsApp tanpa
 * pernah menekan tombol klaim.
 */
export async function tandaiLunas(
  jenis: "paket" | "sesi",
  id: string,
): Promise<Berhasil | Gagal> {
  return ubahStatus(jenis, id, "lunas", ASAL_SAH_LUNAS);
}

/**
 * Bukti tidak cocok → klaim dikembalikan ke 'belum' supaya klien bisa
 * mengklaim ulang setelah pembayarannya benar-benar masuk.
 *
 * Hanya dari 'menunggu_verifikasi': baris 'belum' tidak sedang mengklaim apa
 * pun, dan "menolak" baris 'lunas' adalah pemutaran mundur — rekonsiliasi yang
 * tidak boleh terjadi lewat satu klik.
 */
export async function tolakKlaim(
  jenis: "paket" | "sesi",
  id: string,
): Promise<Berhasil | Gagal> {
  return ubahStatus(jenis, id, "belum", ASAL_SAH_TOLAK);
}
