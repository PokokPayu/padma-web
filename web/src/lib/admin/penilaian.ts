import { createServerSupabase } from "@/lib/supabase/server";

/**
 * PENILAIAN UNTUK STAF (spec C1 J10).
 *
 * Dibaca dengan SESI PENGGUNA, bukan service role: policy "penilaian: staf
 * baca" yang memutuskan, dan itu berarti admin yang perannya dicabut kehilangan
 * aksesnya seketika tanpa satu baris kode pun berubah.
 *
 * TIDAK ADA view agregat di basis data — angka tren di bawah dihitung di sini,
 * dari baris yang sudah lolos RLS. View agregat persis yang dulu membocorkan
 * rate card lengkap ke admin di repo ini: ia melewati RLS dan menyajikan angka
 * yang sudah dijumlahkan tanpa satu pun pagar per-baris.
 */

export type BarisPenilaian = {
  id: string;
  sessionId: string;
  tanggal: string;
  namaKlien: string;
  namaMitra: string;
  namaLayanan: string;
  bintangLayanan: number;
  bintangBidan: number;
  komentar: string;
};

type BarisDb = {
  id: string;
  session_id: string;
  created_at: string;
  bintang_layanan: number;
  bintang_bidan: number;
  komentar: string;
  clients: { nama: string } | null;
  partners: { nama: string } | null;
  service_variants: { label: string; services: { nama: string } | null } | null;
};

/**
 * Penilaian terbaru untuk layar admin.
 *
 * `rendah` menyaring bintang ≤ 3 pada SALAH SATU dari dua angka — bukan
 * rata-ratanya. Sesi yang layanannya bagus tetapi bidannya bermasalah punya
 * rata-rata yang tampak wajar, dan justru itu yang perlu dibaca manusia.
 */
export async function ambilPenilaianTerbaru(opsi: { rendah?: boolean; batas?: number } = {}) {
  const { rendah = false, batas = 50 } = opsi;
  const supabase = await createServerSupabase();

  let q = supabase
    .from("session_ratings")
    .select(
      "id, session_id, created_at, bintang_layanan, bintang_bidan, komentar, " +
        "clients ( nama ), partners ( nama ), service_variants ( label, services ( nama ) )",
    )
    .order("created_at", { ascending: false })
    // `.limit()` selalu ada: tanpa itu layar ini tumbuh tanpa batas dan
    // `max_rows = 1000` PostgREST yang diam-diam memotongnya (utang #1 di
    // catatan panel 7 Sep).
    .limit(batas);

  if (rendah) {
    q = q.or("bintang_layanan.lte.3,bintang_bidan.lte.3");
  }

  const { data } = await q.returns<BarisDb[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    tanggal: r.created_at.slice(0, 10),
    namaKlien: r.clients?.nama ?? "Klien",
    namaMitra: r.partners?.nama ?? "Bidan",
    namaLayanan: r.service_variants?.services?.nama ?? "Layanan",
    bintangLayanan: r.bintang_layanan,
    bintangBidan: r.bintang_bidan,
    komentar: r.komentar,
  })) satisfies BarisPenilaian[];
}

export type TrenPenilaian = { nama: string; jumlah: number; rata: number };

/**
 * Tren untuk owner: DUA kolom terpisah, per bidan dan per layanan.
 *
 * Terpisah, bukan satu tabel bergabung — itu seluruh gunanya. Pertanyaan yang
 * dijawab layar ini adalah "orangnya atau layanannya?", dan satu angka
 * gabungan justru menghapus pertanyaan itu.
 */
export async function ambilTrenPenilaian(): Promise<{
  perBidan: TrenPenilaian[];
  perLayanan: TrenPenilaian[];
}> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("session_ratings")
    .select(
      "bintang_layanan, bintang_bidan, partners ( nama ), service_variants ( services ( nama ) )",
    )
    .limit(1000)
    .returns<
      {
        bintang_layanan: number;
        bintang_bidan: number;
        partners: { nama: string } | null;
        service_variants: { services: { nama: string } | null } | null;
      }[]
    >();

  const bidan = new Map<string, number[]>();
  const layanan = new Map<string, number[]>();

  for (const r of data ?? []) {
    const nb = r.partners?.nama ?? "Bidan";
    const nl = r.service_variants?.services?.nama ?? "Layanan";
    // Bintang BIDAN masuk ke tren bidan, bintang LAYANAN ke tren layanan.
    // Menukarnya adalah kesalahan yang tidak akan pernah terlihat dari
    // angkanya — dan yang akibatnya menyalahkan orang yang salah.
    bidan.set(nb, [...(bidan.get(nb) ?? []), r.bintang_bidan]);
    layanan.set(nl, [...(layanan.get(nl) ?? []), r.bintang_layanan]);
  }

  const susun = (m: Map<string, number[]>): TrenPenilaian[] =>
    [...m.entries()]
      .map(([nama, nilai]) => ({
        nama,
        jumlah: nilai.length,
        // Dibulatkan satu desimal HANYA untuk tampilan. Tidak ada keputusan
        // yang diambil dari angka ini oleh mesin — ia bahan percakapan.
        rata: Math.round((nilai.reduce((a, b) => a + b, 0) / nilai.length) * 10) / 10,
      }))
      .sort((a, b) => a.rata - b.rata || a.nama.localeCompare(b.nama, "id"));

  return { perBidan: susun(bidan), perLayanan: susun(layanan) };
}
