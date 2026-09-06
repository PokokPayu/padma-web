import { createClient } from "@supabase/supabase-js";
import { labelVarian, type FormatVarian } from "@/lib/varian";

export type VarianKatalog = {
  label: string;
  hargaKlien: number;
  hargaCoret: number | null;
};

export type LayananKatalog = {
  id: string;
  nama: string;
  varian: VarianKatalog[];
};

export type FaseKatalog = {
  id: string;
  namaSanskrit: string;
  nama: string;
  urutan: number;
  layanan: LayananKatalog[];
};

type BarisFase = { id: string; nama_sanskrit: string; nama: string; urutan: number };
type BarisLayanan = { id: string; nama: string; phase_id: string };
type BarisVarian = {
  id: string;
  service_id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
  urutan: number;
};
type BarisHarga = {
  variant_id: string;
  harga_klien: number;
  harga_coret: number | null;
  berlaku_sejak: string;
};

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
// Harga diambil lewat klien yang SAMA (view `harga_publik`) dengan alasan
// yang sama persis: anon tidak punya hak apa pun atas `variant_rates`, jadi
// bila `harga_publik` kehilangan grantnya, landing kehilangan harganya di
// test yang sama, bukan diam-diam kosong di produksi.
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
  const [{ data: fases }, { data: layanan }, { data: varian }, { data: harga }] =
    await Promise.all([
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
      // Aktif saja — sama seperti `services`: varian yang dinonaktifkan admin
      // tidak boleh muncul kembali di landing.
      supabase
        .from("service_variants")
        .select("id, service_id, label, durasi_menit, format, urutan")
        .eq("aktif", true)
        .returns<BarisVarian[]>(),
      // View sudah membuang tarif yang BELUM berlaku (bandingan kalender
      // Asia/Jakarta ada di definisi view) — yang tersisa untuk kita hanyalah
      // memilih baris ber-`berlaku_sejak` TERBESAR per varian di bawah.
      //
      // `.order()` DI SINI BUKAN KOSMETIK. `supabase/config.toml` menyetel
      // `max_rows = 1000`: PostgREST memotong bacaan tanpa `.limit()` di
      // angka itu, SENYAP — tidak ada error, tidak ada tanda "terpotong".
      // `variant_rates` bersifat APPEND-ONLY SELAMANYA (satu perubahan harga
      // = satu baris baru yang tidak pernah dihapus), jadi begitu tabelnya
      // melewati 1000 baris, Postgres bebas memulangkan subset SEWENANG-
      // WENANG. Tanpa urutan menurun di sini, subset itu bisa membuang justru
      // baris `berlaku_sejak` TERBARU sebuah varian — pemilihan "terbesar" di
      // JS di bawah lalu jatuh ke harga LAMA (atau varian itu hilang total
      // dari kartu bila SEMUA barisnya tersingkir), tanpa satu pun error yang
      // terlihat ganjil. Urutan menurun membuat baris terbaru tiap varian
      // SELALU masuk 1000 pertama walau riwayatnya sudah sangat panjang;
      // pemilihan max di JS di bawah tetap dipertahankan sebagai jaring
      // kedua, bukan pengganti. Dibuktikan pada skala nyata (>1000 baris) di
      // tests/landing-katalog.test.ts, bukan hanya diasumsikan dari kode ini.
      supabase
        .from("harga_publik")
        .select("variant_id, harga_klien, harga_coret, berlaku_sejak")
        .order("berlaku_sejak", { ascending: false })
        .returns<BarisHarga[]>(),
    ]);

  const hargaTerkini = new Map<string, BarisHarga>();
  for (const h of harga ?? []) {
    const ada = hargaTerkini.get(h.variant_id);
    if (!ada || h.berlaku_sejak > ada.berlaku_sejak) hargaTerkini.set(h.variant_id, h);
  }

  // `urutan` dulu, lalu label, lalu id — tie-break STABIL, pola yang sama
  // dengan `daftarKatalogAdmin()` (`lib/admin/katalog-admin.ts`): urutan yang
  // diserahkan ke PostgREST bersifat nondeterministik, dan varian baku (label
  // kosong, `urutan = 0` untuk seluruhnya) tanpa ini jatuh ke urutan baris
  // apa pun yang dikembalikan hari itu.
  const varianTersusun = [...(varian ?? [])].sort((a, b) => {
    const selisihUrutan = a.urutan - b.urutan;
    if (selisihUrutan !== 0) return selisihUrutan;
    const selisihLabel = a.label.localeCompare(b.label, "id");
    if (selisihLabel !== 0) return selisihLabel;
    return a.id.localeCompare(b.id);
  });

  // Varian tanpa tarif (belum diberi harga lewat rate card owner) disaring
  // diam-diam: tidak ada apa pun yang sah untuk dipajang ke pengunjung.
  function varianLayanan(serviceId: string): VarianKatalog[] {
    const hasil: VarianKatalog[] = [];
    for (const v of varianTersusun) {
      if (v.service_id !== serviceId) continue;
      const h = hargaTerkini.get(v.id);
      if (!h) continue;
      hasil.push({
        label: labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format }),
        hargaKlien: h.harga_klien,
        hargaCoret: h.harga_coret,
      });
    }
    return hasil;
  }

  return (fases ?? []).map((f) => ({
    id: f.id,
    namaSanskrit: f.nama_sanskrit,
    nama: f.nama,
    urutan: f.urutan,
    layanan: (layanan ?? [])
      .filter((s) => s.phase_id === f.id)
      .map((s) => ({ id: s.id, nama: s.nama, varian: varianLayanan(s.id) })),
  }));
}
