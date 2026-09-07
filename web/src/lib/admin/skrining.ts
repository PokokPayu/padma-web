import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { STATUS_SAH } from "@/app/admin/skrining/status";
import type { BarisSkrining } from "@/app/admin/skrining/tabel-inbox";

/**
 * Lapisan data inbox skrining.
 *
 * Sesi pengguna, bukan service role: policy `screenings: staf` yang
 * mengizinkan bacaan ini. Jalur TULIS skrining publik (`/api/skrining`) memang
 * memakai service role — dua jalur berbeda dari satu tabel, dan yang ini
 * bukan jalur itu.
 */

/**
 * Nilai saringan yang sah untuk inbox skrining.
 *
 * `tindak` DITURUNKAN dari `STATUS_SAH`, bukan ditulis ulang: dua daftar nilai
 * yang harus selalu identik adalah cara paling mudah menampilkan chip yang
 * tidak pernah mencocokkan apa pun.
 */
export const SARING_SKRINING = {
  tindak: STATUS_SAH,
  hasil: ["hijau", "merah"],
} as const satisfies SaringSah;

export async function ambilDaftarSkrining(
  param: ParamDaftar,
): Promise<{ baris: BarisSkrining[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("screenings")
    // `client_id` ikut dibaca supaya inbox bisa membedakan calon klien yang
    // sudah didaftarkan dari yang belum — tanpa kolom itu, satu-satunya kabar
    // bahwa seseorang sudah punya PADMA ID adalah ingatan admin.
    .select(
      "id, kode, nama, no_hp, fase, hasil, status_tindak_lanjut, created_at, flags, client_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id");

  if (param.saring.tindak) q = q.eq("status_tindak_lanjut", param.saring.tindak);
  if (param.saring.hasil) q = q.eq("hasil", param.saring.hasil);

  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    // Kode dibacakan lewat WhatsApp; nama diingat admin. Satu kotak cari
    // harus menemukan keduanya. `kode` BUKAN kolom identitas otorisasi — ia
    // tidak pernah menjadi kunci `.eq()` yang menentukan baris siapa yang
    // boleh dibaca; RLS `screenings: staf` yang melakukannya.
    q = q.or(`kode.ilike.%${aman}%,nama.ilike.%${aman}%`);
  }

  const { data, count } = await q.range(dari, sampai).returns<BarisSkrining[]>();
  return { baris: data ?? [], total: count ?? 0 };
}
