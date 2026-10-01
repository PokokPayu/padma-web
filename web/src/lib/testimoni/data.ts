import { createPublikSupabase } from "@/lib/supabase/publik";

// RLS `testimonials: baca publik` hanya membuka baris terbit, dan CHECK
// `testimonials_terbit_berizin` membuat baris terbit selalu berizin & bervideo.

type Baris = { id: string; nama: string; keterangan: string; kutipan: string };

export type TestimoniPublik = {
  id: string;
  nama: string;
  keterangan: string;
  kutipan: string;
  /** Rute stabil yang mengalihkan ke presigned GET R2 yang segar. */
  videoSrc: string;
};

export async function daftarTestimoniTerbit(): Promise<TestimoniPublik[]> {
  const { data, error } = await createPublikSupabase()
    .from("testimonials")
    .select("id, nama, keterangan, kutipan")
    .eq("terbit", true)
    .order("urutan", { ascending: true })
    .order("created_at", { ascending: false })
    .returns<Baris[]>();
  if (error) throw new Error(`Gagal membaca testimoni: ${error.message}`);
  return (data ?? []).map((b) => ({ ...b, videoSrc: `/api/testimoni/${b.id}/video` }));
}
