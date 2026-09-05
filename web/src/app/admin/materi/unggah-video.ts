"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { urlUnggahVideo, hapusObjekVideo } from "@/lib/r2";
import {
  periksaBerkasVideo, namaObjekVideo, objekVideoSah, type MimeVideo,
} from "@/lib/materi/video";

type Gagal = { ok: false; pesan: string };

/**
 * Menerbitkan presigned PUT untuk satu video.
 *
 * Path objeknya ditentukan DI SINI, bukan dikirim browser — browser yang
 * memilih path adalah browser yang bisa menimpa video materi lain. Batasnya
 * juga diperiksa DI SINI sebelum menandatangani: `ContentLength` memagari
 * ukuran PERSIS, jadi menandatangani lebih dulu berarti membiarkan angka
 * berapa pun lolos.
 */
export async function terbitkanUrlUnggahVideo(
  materiId: string,
  mime: string,
  byte: number,
): Promise<{ ok: true; url: string; objek: string; mime: MimeVideo } | Gagal> {
  await requireRole(["admin", "owner"]);

  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  // Materi harus ada, dan pemeriksaannya lewat sesi pengguna supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: materi } = await supabase
    .from("materials").select("id, tipe").eq("id", materiId).maybeSingle();
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };
  if (materi.tipe !== "video") {
    return { ok: false, pesan: "Materi ini bukan bertipe video." };
  }

  const objek = namaObjekVideo(materiId, periksa.nilai, randomUUID());
  try {
    const url = await urlUnggahVideo(objek, periksa.nilai, byte);
    return { ok: true, url, objek, mime: periksa.nilai };
  } catch (e) {
    // Log NAMA & PESAN galatnya saja (fix F3, video-r2 fix wave) — tidak
    // pernah URL (belum ada satu pun di titik ini) dan tidak pernah
    // kredensial. Tanpanya, kegagalan PRODUKSI PERTAMA — secret R2 salah
    // atau belum dipasang, lihat `wajib()` di `@/lib/r2` yang melempar di
    // titik inilah — membuat admin melihat "Coba lagi" selamanya sementara
    // log server kosong sama sekali, tanpa satu pun jejak untuk didiagnosis.
    const nama = e instanceof Error ? e.name : "GalatTidakDikenal";
    const pesan = e instanceof Error ? e.message : String(e);
    console.error(`menyiapkan unggahan video gagal: ${nama}: ${pesan}`);
    // Pesan ke KLIEN sengaja tidak membawa detail galat: galat SDK bisa
    // memuat endpoint dan bagian kredensial.
    return { ok: false, pesan: "Gagal menyiapkan unggahan video. Coba lagi." };
  }
}

/**
 * Mencatat objek video SESUDAH unggahannya sukses.
 *
 * Dipanggil hanya di akhir: bila unggahan gagal, fungsi ini tidak pernah jalan
 * dan materinya tampak "belum ada isi" di panel — bukan setengah terisi, yang
 * jauh lebih sulit disadari.
 */
export async function catatVideoMateri(
  materiId: string,
  objek: string,
  mime: MimeVideo,
): Promise<{ ok: true; objekLamaTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);

  // Objek yang dicatat harus berbentuk objek yang KITA terbitkan.
  if (!objekVideoSah(materiId, objek, mime)) {
    return { ok: false, pesan: "Nama objek video tidak sah." };
  }

  const supabase = await createServerSupabase();

  // Objek lama dibaca SEBELUM ditimpa; sesudah upsert, nilainya sudah hilang
  // dan objeknya akan yatim di R2 selamanya. Free tier hanya 10 GB.
  const { data: lama } = await supabase
    .from("material_videos").select("objek").eq("material_id", materiId).maybeSingle();

  const { data, error } = await supabase
    .from("material_videos")
    .upsert({ material_id: materiId, objek, mime }, { onConflict: "material_id" })
    .select("material_id");

  if (error) return { ok: false, pesan: "Gagal menyimpan video materi." };
  // PostgREST menjawab 200 + [] untuk tulisan yang ditolak RLS.
  if (!data || data.length === 0) {
    return { ok: false, pesan: "Tidak berwenang menyimpan video materi ini." };
  }

  // Penghapusan objek lama terjadi SESUDAH barisnya benar-benar berubah.
  // Urutan sebaliknya membuat kegagalan di sini meninggalkan baris yang
  // menunjuk objek yang sudah lenyap — pasien mendapat pemutar yang tidak
  // pernah jalan. Dengan urutan ini, mode gagal terburuknya hanyalah satu
  // objek yatim, dan itu dilaporkan, bukan disembunyikan.
  let objekLamaTersisa = false;
  if (lama?.objek && lama.objek !== objek) {
    try {
      await hapusObjekVideo(lama.objek);
    } catch {
      objekLamaTersisa = true;
    }
  }

  revalidatePath("/admin/materi");
  return { ok: true, objekLamaTersisa };
}
