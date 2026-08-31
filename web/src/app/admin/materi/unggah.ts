"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { namaObjekHalaman, MAKS_HALAMAN } from "@/lib/materi/rasterisasi";

const BUCKET = "materi-halaman";

type Gagal = { ok: false; pesan: string };

export type Unggahan = { halaman: number; objek: string; token: string };

/**
 * Menerbitkan signed upload URL untuk seluruh halaman sekaligus.
 *
 * Berkasnya TIDAK menumpang server kita: Vercel membatasi body request 4,5 MB,
 * dan satu ebook bisa ratusan halaman. Browser admin mengunggah langsung ke
 * Storage memakai token di bawah.
 *
 * Path setiap objek ditentukan DI SINI, bukan dikirim browser. Browser yang
 * memilih path adalah browser yang bisa menimpa objek materi lain.
 */
export async function terbitkanUrlUnggahHalaman(
  materiId: string,
  jumlahHalaman: number,
): Promise<{ ok: true; unggahan: Unggahan[] } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (!Number.isInteger(jumlahHalaman) || jumlahHalaman < 1) {
    return { ok: false, pesan: "Jumlah halaman tidak sah." };
  }
  if (jumlahHalaman > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }

  // Materi harus ada, dan pemeriksaannya lewat sesi pengguna supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: materi } = await supabase
    .from("materials").select("id").eq("id", materiId).maybeSingle();
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };

  const admin = createAdminSupabase();

  // Objek lama dibersihkan lebih dulu: unggahan sebelumnya yang gagal di tengah
  // meninggalkan sampah, dan halaman lama yang tersisa akan bercampur dengan
  // yang baru bila PDF penggantinya lebih pendek.
  const { data: lama } = await admin.storage.from(BUCKET).list(materiId);
  if (lama && lama.length > 0) {
    await admin.storage
      .from(BUCKET)
      .remove(lama.map((o) => `${materiId}/${o.name}`));
  }

  const unggahan: Unggahan[] = [];
  for (let halaman = 1; halaman <= jumlahHalaman; halaman++) {
    const objek = namaObjekHalaman(materiId, halaman);
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(objek);
    if (error || !data) {
      return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
    }
    unggahan.push({ halaman, objek, token: data.token });
  }
  return { ok: true, unggahan };
}

/**
 * Mencatat seluruh halaman SEKALIGUS, sesudah semua unggahan sukses.
 *
 * Dipanggil sekali di akhir, bukan per halaman: bila unggahan gagal di tengah,
 * fungsi ini tidak pernah jalan dan materinya tampak "belum ada isi" di panel —
 * bukan setengah terisi, yang jauh lebih sulit disadari.
 */
export async function catatHalamanMateri(
  materiId: string,
  halaman: Array<{ halaman: number; objek: string; lebar: number; tinggi: number }>,
): Promise<{ ok: true; jumlah: number } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (halaman.length === 0) return { ok: false, pesan: "Tidak ada halaman." };
  if (halaman.length > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }
  // Objek yang dicatat harus objek yang KITA namai. Nama lain berarti browser
  // menunjuk objek yang bukan miliknya.
  for (const h of halaman) {
    if (h.objek !== namaObjekHalaman(materiId, h.halaman)) {
      return { ok: false, pesan: "Nama objek halaman tidak sah." };
    }
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("ganti_halaman_materi", {
    p_material_id: materiId,
    p_halaman: halaman,
  });
  if (error) return { ok: false, pesan: "Gagal menyimpan halaman materi." };

  revalidatePath("/admin/materi");
  return { ok: true, jumlah: (data as number) ?? 0 };
}
