import { createClient } from "@supabase/supabase-js";

export type FaseKatalog = {
  id: string;
  namaSanskrit: string;
  nama: string;
  urutan: number;
  layanan: string[];
};

type BarisFase = { id: string; nama_sanskrit: string; nama: string; urutan: number };
type BarisLayanan = { id: string; nama: string; phase_id: string };

// Katalog dibaca dengan ANON KEY, bukan sesi pengguna: isinya materi pemasaran
// yang sama untuk semua pengunjung, dan policy "baca publik" (migration
// baca_publik_katalog) yang mengizinkannya. Sengaja TIDAK memakai
// `createServerSupabase()`:
//   * `cookies()` hanya bermakna di dalam request scope — di luar itu (test,
//     prerender statis) ia melempar "called outside a request scope";
//   * membaca cookie akan membuat landing publik ikut dynamic tanpa alasan,
//     padahal katalognya tidak bergantung siapa yang membuka.
// Service role TIDAK dipakai di sini justru supaya policy baca publik benar-
// benar teruji: bila policy-nya hilang, landing kosong akan tertangkap test.
function klienPublik() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Katalog ini data dummy (keputusan #12); client menggantinya lewat panel admin.
export async function bacaKatalog(): Promise<FaseKatalog[]> {
  const supabase = klienPublik();
  const [{ data: fases }, { data: layanan }] = await Promise.all([
    supabase
      .from("phases")
      .select("id, nama_sanskrit, nama, urutan")
      .order("urutan")
      .returns<BarisFase[]>(),
    supabase
      .from("services")
      .select("id, nama, phase_id")
      .eq("aktif", true)
      .returns<BarisLayanan[]>(),
  ]);

  return (fases ?? []).map((f) => ({
    id: f.id,
    namaSanskrit: f.nama_sanskrit,
    nama: f.nama,
    urutan: f.urutan,
    layanan: (layanan ?? []).filter((s) => s.phase_id === f.id).map((s) => s.nama),
  }));
}
