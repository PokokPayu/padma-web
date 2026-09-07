import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { daftarKatalogAdmin, type LayananKelola } from "@/lib/admin/katalog-admin";

/**
 * Lapisan data DAFTAR layanan.
 *
 * Sengaja terpisah dari `daftarKatalogAdmin()` (`@/lib/admin/katalog-admin`),
 * yang menarik SELURUH katalog bersarang tiga tingkat dalam enam query.
 * Daftar datar berpaginasi punya kebutuhan yang berbeda: satu halaman, angka
 * ringkas, tanpa anak. Memakai ulang fungsi bersarang itu berarti menarik
 * seluruh varian dan paket klinik hanya untuk menampilkan dua puluh lima nama.
 *
 * Halaman DETAIL (`ambilLayanan`) tetap memakai `daftarKatalogAdmin()`: di
 * sana anaknya memang yang dicari, dan menuliskan query keduanya di sini akan
 * melahirkan dua definisi "apa itu varian sebuah layanan" yang akan berpisah
 * diam-diam.
 */

export const SARING_LAYANAN = { aktif: ["ya", "tidak"] } as const satisfies SaringSah;

export type BarisLayananDaftar = {
  id: string;
  nama: string;
  deskripsi: string;
  namaFase: string;
  aktif: boolean;
  jumlahVarian: number;
  jumlahPaket: number;
  sesiTercatat: number;
};

type BarisDb = {
  id: string;
  nama: string;
  deskripsi: string;
  aktif: boolean;
  phase_id: string;
};

export async function ambilDaftarLayanan(
  param: ParamDaftar,
): Promise<{ baris: BarisLayananDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("services")
    .select("id, nama, deskripsi, aktif, phase_id", { count: "exact" })
    // Yang aktif di atas, lalu menurut nama: halaman ini dibaca dari atas ke
    // bawah untuk menjawab "apa yang sedang kami tawarkan".
    .order("aktif", { ascending: false })
    .order("nama");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("nama", `%${aman}%`);
  }

  const [{ data, count }, { data: fase }, { data: varian }, { data: paket }, { data: sesi }] =
    await Promise.all([
      q.range(dari, sampai).returns<BarisDb[]>(),
      supabase.from("phases").select("id, nama").returns<{ id: string; nama: string }[]>(),
      // Ketiga query hitung di bawah TIDAK dipaginasi dan tetap tunduk pada
      // `max_rows = 1000` PostgREST — kelas utang yang sama dengan #1 runbook
      // rencana 1, dicatat di sini supaya tidak diklaim sudah tertutup.
      supabase.from("service_variants").select("service_id").returns<{ service_id: string }[]>(),
      supabase.from("packages").select("service_id").returns<{ service_id: string }[]>(),
      supabase.from("sessions").select("service_id").returns<{ service_id: string }[]>(),
    ]);

  const labelFase = new Map((fase ?? []).map((f) => [f.id, f.nama]));
  const hitung = (baris: { service_id: string }[] | null) => {
    const peta = new Map<string, number>();
    for (const b of baris ?? []) peta.set(b.service_id, (peta.get(b.service_id) ?? 0) + 1);
    return peta;
  };
  const nVarian = hitung(varian);
  const nPaket = hitung(paket);
  const nSesi = hitung(sesi);

  return {
    baris: (data ?? []).map((l) => ({
      id: l.id,
      nama: l.nama,
      deskripsi: l.deskripsi,
      namaFase: labelFase.get(l.phase_id) ?? "—",
      aktif: l.aktif,
      jumlahVarian: nVarian.get(l.id) ?? 0,
      jumlahPaket: nPaket.get(l.id) ?? 0,
      sesiTercatat: nSesi.get(l.id) ?? 0,
    })),
    total: count ?? 0,
  };
}

export type LayananDetail = LayananKelola & { namaFase: string; faseId: string };

/**
 * Satu layanan beserta seluruh anaknya, atau `null` bila id-nya tidak ada.
 *
 * `null`, bukan lemparan: halaman detail memanggil `notFound()` sendiri, dan
 * itu memberi 404 yang benar alih-alih 500 untuk URL yang salah ketik.
 */
export async function ambilLayanan(id: string): Promise<LayananDetail | null> {
  const katalog = await daftarKatalogAdmin();
  for (const f of katalog) {
    const l = f.layanan.find((x) => x.id === id);
    if (l) return { ...l, namaFase: f.nama, faseId: f.id };
  }
  return null;
}
