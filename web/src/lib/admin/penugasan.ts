import { createServerSupabase } from "@/lib/supabase/server";

export type PasienRingkas = { clientId: string; nama: string; padmaId: string };

type BarisAssign = { client_id: string; clients: { nama: string; padma_id: string } | null };
type BarisOtomatis = { client_id: string; clients: { nama: string; padma_id: string } | null };

/**
 * Siapa yang bisa membuka materi ini, dipisah menurut SEBABNYA.
 *
 * `otomatis` ditampilkan bacaan saja: tanpanya, admin akan meng-assign ulang
 * pasien yang materinya memang sudah terbuka, lalu bingung kenapa tidak ada
 * yang berubah.
 */
export async function daftarPenugasan(materiId: string): Promise<{
  ditugaskan: PasienRingkas[];
  otomatis: PasienRingkas[];
}> {
  const supabase = await createServerSupabase();

  const [{ data: assign }, { data: layanan }, { data: materi }] = await Promise.all([
    supabase
      .from("material_assignments")
      .select("client_id, clients(nama, padma_id)")
      .eq("material_id", materiId)
      .returns<BarisAssign[]>(),
    supabase
      .from("material_services")
      .select("service_id")
      .eq("material_id", materiId)
      .returns<{ service_id: string }[]>(),
    supabase.from("materials").select("aktif").eq("id", materiId).maybeSingle(),
  ]);

  // `otomatis` MENDUPLIKASI dengan sengaja cabang otomatis milik
  // `berhak_isi_materi()` (migration 20260831110000_materi_penugasan.sql):
  // fungsi itu mensyaratkan `m.aktif = true` SEBELUM kedua cabangnya
  // dievaluasi, jadi materi nonaktif tidak pernah membuka isinya untuk siapa
  // pun — apa pun sesi yang pernah selesai. Tanpa syarat yang sama di sini,
  // panel ini akan menyatakan seorang klien "berhak otomatis" pada materi
  // yang sudah dinonaktifkan admin, padahal `berhak_isi_materi` sudah
  // menjawab false untuknya — bukan lubang keamanan (RLS tetap dijaga fungsi
  // yang sungguhan), tapi panel yang berbohong ke admin.
  //
  // Duplikasi dua cabang aturan yang sama di dua tempat AMAN hanya karena ada
  // tes yang merah begitu keduanya berbeda pendapat — bukan komentar ini.
  // Lihat tests/materi-penugasan-lib.test.ts.
  const idLayanan = materi?.aktif ? (layanan ?? []).map((l) => l.service_id) : [];
  let otomatis: PasienRingkas[] = [];
  if (idLayanan.length > 0) {
    const { data } = await supabase
      .from("sessions")
      .select("client_id, clients(nama, padma_id)")
      .eq("status", "selesai")
      .in("service_id", idLayanan)
      .returns<BarisOtomatis[]>();
    const unik = new Map<string, PasienRingkas>();
    for (const r of data ?? []) {
      if (!r.clients) continue;
      unik.set(r.client_id, {
        clientId: r.client_id, nama: r.clients.nama, padmaId: r.clients.padma_id,
      });
    }
    otomatis = [...unik.values()].sort((a, b) => a.nama.localeCompare(b.nama));
  }

  const ditugaskan = (assign ?? [])
    .filter((a) => a.clients)
    .map((a) => ({
      clientId: a.client_id, nama: a.clients!.nama, padmaId: a.clients!.padma_id,
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama));

  return { ditugaskan, otomatis };
}
