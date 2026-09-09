"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { MIME_SERTIFIKAT, namaObjekSertifikat, periksaBerkasSertifikat } from "@/lib/sertifikat/berkas";

const BUCKET = "sertifikat";

type Gagal = { ok: false; pesan: string };

/**
 * Menerbitkan signed upload URL untuk SATU berkas sertifikat.
 *
 * Berkasnya tidak menumpang server kita — Vercel membatasi body request 4,5 MB
 * — jadi peramban admin mengunggah langsung ke Storage memakai token di bawah.
 * Polanya menyalin `terbitkanUrlUnggahHalaman()` di admin/materi.
 *
 * Sesi diperiksa lewat SESI PENGGUNA supaya RLS staf yang memutuskan, bukan
 * service role. Statusnya diperiksa di sini SEKALIGUS di trigger basis data:
 * yang di sini demi kalimat galat yang enak dibaca, yang di sana demi
 * kebenaran yang tidak bergantung pada layar mana pun.
 */
export async function terbitkanUrlUnggahSertifikat(
  sessionId: string,
  ukuran: number,
  mime: string,
): Promise<{ ok: true; objek: string; token: string } | Gagal> {
  await requireRole(["admin", "owner"]);

  const periksa = periksaBerkasSertifikat("sertifikat", ukuran, mime);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const { data: sesi } = await supabase
    .from("sessions")
    .select("id, client_id, status")
    .eq("id", sessionId)
    .maybeSingle<{ id: string; client_id: string; status: string }>();

  if (!sesi) return { ok: false, pesan: "Sesi tidak ditemukan." };
  if (sesi.status !== "selesai") {
    return { ok: false, pesan: "Sertifikat hanya untuk sesi yang sudah selesai." };
  }

  const objek = namaObjekSertifikat(sesi.client_id, sesi.id, mime);

  // `{ upsert: true }` WAJIB: mengunggah ulang sertifikat untuk sesi yang sama
  // adalah PENGGANTIAN, dan tanpa upsert penerbitan URL untuk path yang sudah
  // terisi ditolak sejak di sini — bukan saat peramban mem-PUT.
  const admin = createAdminSupabase();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(objek, { upsert: true });

  if (error || !data) return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
  return { ok: true, objek, token: data.token };
}

/**
 * Mencatat barisnya SESUDAH byte-nya mendarat.
 *
 * `objek` TIDAK diterima dari pemanggil — dihitung ulang di sini lewat
 * `namaObjekSertifikat()`, persis seperti di `terbitkanUrlUnggahSertifikat`.
 * Path penyimpanan adalah keputusan SERVER, bukan peramban: menerima `objek`
 * apa adanya dari klien berarti peramban bisa menunjuk (dan menimpa) sertifikat
 * milik sesi lain. Trigger `guard_sertifikat` menjaga `client_id`/`service_id`,
 * tapi tidak menjaga `objek` — penjagaan itu harus terjadi di sini.
 *
 * `upsert` pada `session_id`: satu sesi satu sertifikat (UNIQUE di basis data),
 * dan unggahan kedua mengganti yang lama. Objek lamanya tidak perlu dihapus
 * terpisah — `namaObjekSertifikat()` menghasilkan path yang sama untuk MIME
 * yang sama, dan `upsert: true` di Storage sudah menimpanya. Yang tersisa hanya
 * kasus MIME BERGANTI (pdf → jpg), dan objek lama itu dihapus di bawah.
 */
export async function catatSertifikat(
  sessionId: string,
  mime: string,
): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (!(MIME_SERTIFIKAT as readonly string[]).includes(mime)) {
    return { ok: false, pesan: "Sertifikat harus PDF, JPEG, atau WEBP." };
  }

  const supabase = await createServerSupabase();
  const { data: pengguna } = await supabase.auth.getUser();

  const { data: sesi } = await supabase
    .from("sessions")
    .select("id, client_id")
    .eq("id", sessionId)
    .maybeSingle<{ id: string; client_id: string }>();
  if (!sesi) return { ok: false, pesan: "Sesi tidak ditemukan." };

  const objek = namaObjekSertifikat(sesi.client_id, sesi.id, mime);

  const { data: lama } = await supabase
    .from("certificates")
    .select("objek")
    .eq("session_id", sessionId)
    .maybeSingle<{ objek: string }>();

  // `client_id` & `service_id` diisi apa adanya lalu DITULIS ULANG trigger
  // dari baris sesinya. Nilai di sini hanya memenuhi NOT NULL; yang tersimpan
  // adalah salinan yang dibuat basis data.
  const { error } = await supabase.from("certificates").upsert(
    {
      session_id: sessionId,
      client_id: "00000000-0000-0000-0000-000000000000",
      service_id: "00000000-0000-0000-0000-000000000000",
      objek,
      mime,
      diunggah_oleh: pengguna.user?.id ?? null,
    },
    { onConflict: "session_id" },
  );

  if (error) return { ok: false, pesan: "Gagal menyimpan sertifikat." };

  if (lama && lama.objek !== objek) {
    const admin = createAdminSupabase();
    await admin.storage.from(BUCKET).remove([lama.objek]);
  }

  revalidatePath(`/admin/sesi/${sessionId}`);
  return { ok: true };
}
