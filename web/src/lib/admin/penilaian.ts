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

/**
 * Komentar untuk board owner — KRITIK DULU, bukan yang terbaru dulu.
 *
 * Klien memintanya begini (umpan balik 21 Sep 2026, butir 5): "Testimoni
 * masukkan ke board owner dong mas, klo ada komen masukan/ kritik langsung
 * tahu." Anak kalimat terakhir itulah spesifikasinya. Urutan kronologis
 * mengubur satu keluhan di bawah sepuluh pujian yang datang sesudahnya, dan
 * pemilik klinik baru menemukannya kalau ia menggulir — yaitu, kalau ia sudah
 * tahu ada yang perlu dicari.
 *
 * Yang diurutkan adalah bintang TERENDAH dari dua angkanya, bukan rata-rata.
 * Sesi yang layanannya bagus tetapi bidannya bermasalah punya rata-rata yang
 * tampak wajar — 5 dan 1 menjadi 3 — dan justru itu yang perlu dibaca manusia.
 * Aturan yang sama sudah dipegang saringan `rendah` di `ambilPenilaianTerbaru`.
 *
 * Penilaian tanpa komentar DIBUANG: bintang saja bukan testimoni, dan tren
 * bintang sudah punya kartunya sendiri di board yang sama. Kartu ini menjawab
 * pertanyaan yang lain — apa yang dikatakan orang.
 *
 * MURNI, dan karena itu bisa diuji tanpa Postgres. Pemanggilnya yang menarik
 * barisnya lewat `ambilPenilaianTerbaru` (sesi pengguna, RLS ikut berjalan).
 */
export function komentarKritikDulu(
  baris: readonly BarisPenilaian[],
  batas = 5,
): BarisPenilaian[] {
  return baris
    .filter((b) => b.komentar.trim() !== "")
    // Disalin lebih dulu oleh `.filter()` — `.sort()` memutasi di tempat, dan
    // memutasi masukan milik pemanggil adalah cara fungsi murni berhenti murni.
    .sort((a, b) => {
      const ta = Math.min(a.bintangLayanan, a.bintangBidan);
      const tb = Math.min(b.bintangLayanan, b.bintangBidan);
      if (ta !== tb) return ta - tb;
      // Bintang sama: yang terbaru di atas. `tanggal` YYYY-MM-DD, jadi urutan
      // leksikografis = urutan kronologis.
      return a.tanggal > b.tanggal ? -1 : a.tanggal < b.tanggal ? 1 : 0;
    })
    .slice(0, batas);
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
