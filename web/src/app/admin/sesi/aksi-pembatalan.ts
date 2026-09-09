"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  AKTOR_PEMBATALAN,
  LABEL_JENJANG_PEMBATALAN,
  KALIMAT_AKIBAT,
  type AktorPembatalan,
  type Akibat,
  type Jenjang,
} from "@/lib/pembatalan/jenjang";

/**
 * `pesan` ADA JUGA saat berhasil, dan itu inti perbaikannya: yang dibaca admin
 * sesudah menekan adalah keputusan BASIS DATA, bukan tebakan yang dihitung
 * layar sebelum menekan. Keduanya memakai ambang yang sama, tetapi hanya satu
 * dari keduanya yang menulis baris.
 */
type Berhasil = { ok: true; pesan: string };
type Gagal = { ok: false; pesan: string };

/**
 * Kalimat yang dipulangkan RPC ketika panggilannya tidak mengenai baris apa
 * pun.
 *
 * `batalkan_sesi` dan `jadwal_ulang_sesi` memulangkan NULL — bukan galat —
 * ketika barisnya tidak lagi `terjadwal` (klausa `and status = 'terjadwal'`
 * pada UPDATE-nya). Aksi yang hanya melihat `error` melaporkan panggilan
 * semacam itu sebagai BERHASIL: admin menutup panel yakin sesi sudah batal,
 * sementara barisnya tidak berubah sama sekali.
 */
const TIDAK_KENA =
  "Tidak ada yang berubah — sesi ini sudah tidak berstatus Terjadwal (mungkin sudah dibatalkan atau selesai di tab lain). Muat ulang halaman.";

type HasilBatal = {
  jenjang: Jenjang;
  akibat: Akibat;
  hak_id: string | null;
  status: string;
  oleh: AktorPembatalan;
};

/**
 * Pembungkus RPC pembatalan (spec C3 P5).
 *
 * Ditulis dengan SESI ADMIN sungguhan, bukan service role: jejak audit harus
 * menyebut aktor yang nyata, dan service role tidak punya `auth.uid()` sama
 * sekali. `src/app/admin/**` juga memang dilarang memuat service role
 * (`tests/admin-shell.test.ts`).
 *
 * `oleh` DIKIRIM EKSPLISIT dan divalidasi di sini juga, bukan hanya di basis
 * data: formulir yang kehilangan medannya (mis. tombol ditekan lewat jalur
 * lain) tidak boleh diam-diam jatuh ke salah satu aktor. Basis data menolaknya
 * juga — pagar ini hanya memberi kalimat yang lebih bisa ditindak.
 */
export async function batalkanSesiAdmin(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const oleh = String(formData.get("oleh") ?? "");
  if (!(AKTOR_PEMBATALAN as readonly string[]).includes(oleh)) {
    return {
      ok: false,
      pesan: "Pilih dulu siapa yang membatalkan — klien yang meminta, atau PADMA yang berhalangan.",
    };
  }

  const { data, error } = await supabase.rpc("batalkan_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    alasan: String(formData.get("alasan") ?? ""),
    darurat: formData.get("darurat") === "on",
    oleh,
  });

  if (error) return { ok: false, pesan: error.message };
  if (data === null) return { ok: false, pesan: TIDAK_KENA };

  const hasil = data as HasilBatal;

  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return {
    ok: true,
    // Jenjang & akibat datang dari nilai kembalian RPC — yang MEMUTUSKAN —
    // bukan dihitung ulang di sini. Menghitungnya ulang akan mengembalikan
    // tebakan layar dan menghapus satu-satunya kesempatan admin melihat kalau
    // keduanya berselisih.
    pesan:
      `Sesi dibatalkan. Jenjang ${hasil.jenjang} — ${LABEL_JENJANG_PEMBATALAN[hasil.jenjang]}. ` +
      `${KALIMAT_AKIBAT[hasil.akibat]}` +
      (hasil.hak_id ? " Hak sesi sudah terbit untuk klien." : ""),
  };
}

export async function jadwalUlangSesiAdmin(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const tanggal = String(formData.get("tanggal") ?? "");
  const jam = String(formData.get("jam") ?? "");

  const { data, error } = await supabase.rpc("jadwal_ulang_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    tanggal_baru: tanggal,
    jam_baru: jam,
  });

  if (error) return { ok: false, pesan: error.message };
  if (data === null) return { ok: false, pesan: TIDAK_KENA };

  const hasil = data as { jenjang: Jenjang; jatah_terpakai: boolean };

  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return {
    ok: true,
    pesan:
      `Sesi dipindah ke ${tanggal} ${jam}. Jenjang ${hasil.jenjang}.` +
      (hasil.jatah_terpakai
        ? " Jatah jadwal ulang gratis untuk pemesanan ini kini terpakai."
        : " Jatah jadwal ulang gratis belum terpakai."),
  };
}
