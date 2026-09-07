import { createServerSupabase } from "@/lib/supabase/server";
import { labelVarian, type FormatVarian } from "@/lib/varian";

/**
 * Lapisan data modul Layanan, Paket, & Varian.
 *
 * Satu tabel `services`, TIGA kebutuhan yang berlawanan — dan justru di
 * persimpangan itulah bug termahal proyek ini pernah lahir (`partner_publik`):
 *
 *   • Daftar KELOLA (halaman ini) harus memuat layanan nonaktif juga; kalau
 *     tidak, layanan yang dinonaktifkan karena salah klik tidak punya jalan
 *     kembali dari panel mana pun.
 *
 *   • Daftar PILIH (menjadwalkan sesi baru, wizard pengajuan klien) harus
 *     menyaring `aktif`; kalau tidak, layanan yang sudah dipensiunkan tetap
 *     ditawarkan tiap hari.
 *
 *   • Dan NAMA untuk riwayat tidak boleh menyaring apa pun. Policy
 *     `"services: baca"` untuk `authenticated` SENGAJA tidak menyebut `aktif`
 *     (filter itu hidup di policy terpisah yang menyasar `anon`). Memindahkan
 *     filter ke sana — atau melahirkan view penyaring — akan membuat satu klik
 *     "nonaktifkan" menghapus nama layanan dari riwayat sesi SELURUH klien,
 *     tanpa satu pun error. Itu persis bug `partner_publik` yang sudah dibayar.
 *
 * Seluruh pembacaan memakai SESI PENGGUNA (`createServerSupabase`), bukan
 * service role: di bawah service role `user_role()` mengembalikan 'klien' dan
 * `auth.uid()` NULL, sehingga angka tetap keluar sementara tidak satu pun pagar
 * ikut diperiksa.
 */

export type PaketKelola = {
  id: string;
  nama: string;
  jumlahSesi: number;
  aktif: boolean;
  /** Berapa baris `client_packages` yang menunjuk paket ini. */
  dipakai: number;
};

export type VarianKelola = {
  id: string;
  label: string;
  durasiMenit: number | null;
  format: FormatVarian | null;
  urutan: number;
  aktif: boolean;
  /** Berapa sesi yang sudah tercatat memakai varian ini. */
  sesiTercatat: number;
};

export type LayananKelola = {
  id: string;
  nama: string;
  deskripsi: string;
  aktif: boolean;
  /** Berapa sesi yang sudah tercatat memakai layanan ini. */
  sesiTercatat: number;
  paket: PaketKelola[];
  varian: VarianKelola[];
};

export type FaseKelola = {
  id: string;
  nama: string;
  namaSanskrit: string;
  urutan: number;
  layanan: LayananKelola[];
};

export type LayananPilihan = { id: string; nama: string };
export type VarianPilihan = { id: string; serviceId: string; nama: string };

type BarisFase = { id: string; nama: string; nama_sanskrit: string; urutan: number };
type BarisLayanan = {
  id: string;
  phase_id: string;
  nama: string;
  deskripsi: string;
  aktif: boolean;
};
type BarisPaket = {
  id: string;
  service_id: string;
  nama: string;
  jumlah_sesi: number;
  aktif: boolean;
};
type BarisVarian = {
  id: string;
  service_id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
  urutan: number;
  aktif: boolean;
};

/**
 * Seluruh katalog untuk halaman KELOLA — aktif maupun tidak, dikelompokkan per
 * fase seperti prototipe `vLayanan`.
 *
 * Enam query, digabung di JS. Agregat tertanam PostgREST (`sessions(count)`,
 * `client_packages(count)`) akan lebih ringkas dan gagal SENYAP: angkanya tetap
 * keluar, hanya saja dihitung dari baris yang RLS izinkan lewat jalur embed —
 * arah yang tidak pernah kita kendalikan. Peta-peta di bawah dihitung dari
 * baris yang benar-benar terbaca.
 */
export async function daftarKatalogAdmin(): Promise<FaseKelola[]> {
  const supabase = await createServerSupabase();

  const [
    { data: fase },
    { data: layanan },
    { data: paket },
    { data: paketKlien },
    { data: sesi },
    { data: varian },
  ] = await Promise.all([
    supabase
      .from("phases")
      .select("id, nama, nama_sanskrit, urutan")
      .order("urutan")
      .returns<BarisFase[]>(),
    supabase
      .from("services")
      .select("id, phase_id, nama, deskripsi, aktif")
      // Yang aktif di atas, lalu menurut nama: halaman ini dibaca dari atas
      // ke bawah untuk menjawab "apa yang sedang kami tawarkan".
      .order("aktif", { ascending: false })
      .order("nama")
      .returns<BarisLayanan[]>(),
    supabase
      .from("packages")
      .select("id, service_id, nama, jumlah_sesi, aktif")
      .order("aktif", { ascending: false })
      .order("nama")
      .returns<BarisPaket[]>(),
    supabase
      .from("client_packages")
      .select("package_id")
      .returns<{ package_id: string }[]>(),
    // `variant_id` ikut ditarik supaya "berapa sesi memakai varian ini" bisa
    // dihitung tanpa query terpisah — persis pola `sesiPer` di bawahnya untuk
    // layanan.
    supabase
      .from("sessions")
      .select("service_id, variant_id")
      .returns<{ service_id: string; variant_id: string | null }[]>(),
    // Seluruh varian, aktif maupun tidak — kelola ≠ pilih, alasan yang sama
    // dengan `services`/`packages` di atas: varian yang dinonaktifkan karena
    // salah klik tetap harus punya jalan kembali dari layar ini.
    supabase
      .from("service_variants")
      .select("id, service_id, label, durasi_menit, format, urutan, aktif")
      .returns<BarisVarian[]>(),
  ]);

  const dipakaiPer = new Map<string, number>();
  for (const p of paketKlien ?? []) {
    dipakaiPer.set(p.package_id, (dipakaiPer.get(p.package_id) ?? 0) + 1);
  }
  const sesiPer = new Map<string, number>();
  const sesiPerVarian = new Map<string, number>();
  for (const s of sesi ?? []) {
    sesiPer.set(s.service_id, (sesiPer.get(s.service_id) ?? 0) + 1);
    if (s.variant_id !== null) {
      sesiPerVarian.set(s.variant_id, (sesiPerVarian.get(s.variant_id) ?? 0) + 1);
    }
  }

  const paketPerLayanan = new Map<string, PaketKelola[]>();
  for (const p of paket ?? []) {
    const daftar = paketPerLayanan.get(p.service_id) ?? [];
    daftar.push({
      id: p.id,
      nama: p.nama,
      jumlahSesi: p.jumlah_sesi,
      aktif: p.aktif,
      dipakai: dipakaiPer.get(p.id) ?? 0,
    });
    paketPerLayanan.set(p.service_id, daftar);
  }

  const varianPerLayanan = new Map<string, VarianKelola[]>();
  for (const v of varian ?? []) {
    const daftar = varianPerLayanan.get(v.service_id) ?? [];
    daftar.push({
      id: v.id,
      label: v.label,
      durasiMenit: v.durasi_menit,
      format: v.format,
      urutan: v.urutan,
      aktif: v.aktif,
      sesiTercatat: sesiPerVarian.get(v.id) ?? 0,
    });
    varianPerLayanan.set(v.service_id, daftar);
  }
  // `urutan` dulu, lalu label, lalu id — tie-break STABIL, pola yang sama
  // dengan `ambilRateCard()` (`@/lib/owner/data`): varian baku (label kosong,
  // `urutan = 0` untuk seluruhnya, baik hasil backfill maupun terbitan
  // trigger `trg_terbitkan_varian_baku`) tanpa ini jatuh ke urutan baris
  // PostgREST yang nondeterministik.
  for (const daftar of varianPerLayanan.values()) {
    daftar.sort((a, b) => {
      const selisihUrutan = a.urutan - b.urutan;
      if (selisihUrutan !== 0) return selisihUrutan;
      const selisihLabel = a.label.localeCompare(b.label, "id");
      if (selisihLabel !== 0) return selisihLabel;
      return a.id.localeCompare(b.id);
    });
  }

  return (fase ?? []).map((f) => ({
    id: f.id,
    nama: f.nama,
    namaSanskrit: f.nama_sanskrit,
    urutan: f.urutan,
    layanan: (layanan ?? [])
      .filter((l) => l.phase_id === f.id)
      .map((l) => ({
        id: l.id,
        nama: l.nama,
        deskripsi: l.deskripsi,
        aktif: l.aktif,
        sesiTercatat: sesiPer.get(l.id) ?? 0,
        paket: paketPerLayanan.get(l.id) ?? [],
        varian: varianPerLayanan.get(l.id) ?? [],
      })),
  }));
}

/**
 * Pilihan layanan untuk MENJADWALKAN sesi baru — hanya yang aktif.
 *
 * Dipakai modul Sesi. Ditaruh di sini, bukan di modul itu, supaya satu-satunya
 * definisi "layanan yang masih ditawarkan" hidup berdampingan dengan daftar
 * kelola yang mengubahnya — persis pola `pilihanMitra()` di `@/lib/admin/mitra`.
 */
export async function pilihanLayanan(): Promise<LayananPilihan[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("services")
    .select("id, nama")
    .eq("aktif", true)
    .order("nama")
    .returns<LayananPilihan[]>();
  return data ?? [];
}

export type FasePilihan = { id: string; nama: string };

/**
 * Pilihan fase untuk formulir layanan (baru & ubah) — hanya id & nama.
 *
 * Dipisah dari `daftarKatalogAdmin()` untuk alasan yang sama dengan
 * `pilihanLayanan()`/`pilihanVarian()` di bawah: formulir hanya butuh nama
 * dan id fase, bukan seluruh katalog bersarang enam-query. Sebelum fungsi ini
 * ada, `/admin/layanan/[id]` memanggil `daftarKatalogAdmin()` DUA KALI per
 * render — sekali lewat `ambilLayanan()` untuk data layanannya sendiri, sekali
 * lagi HANYA untuk daftar pilihan fase ini — yang berarti seluruh tabel
 * `sessions` klinik terbaca dua kali, dari dua snapshot yang bisa berbeda di
 * bawah penulisan konkuren, untuk menampilkan satu layanan.
 */
export async function pilihanFase(): Promise<FasePilihan[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("phases")
    .select("id, nama")
    .order("urutan")
    .returns<FasePilihan[]>();
  return data ?? [];
}

type BarisVarianPilihan = {
  id: string;
  service_id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
};

/**
 * Pilihan varian untuk MENJADWALKAN sesi baru — hanya yang aktif, dari layanan
 * apa pun (disaring per layanan terpilih di klien, sama seperti wizard klien
 * `/passport/ajukan`). Alasan yang sama dengan `pilihanLayanan()`: sesi wajib
 * menunjuk varian yang benar-benar masih ditawarkan.
 */
export async function pilihanVarian(): Promise<VarianPilihan[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("service_variants")
    .select("id, service_id, label, durasi_menit, format")
    .eq("aktif", true)
    .order("urutan")
    .returns<BarisVarianPilihan[]>();
  return (data ?? []).map((v) => ({
    id: v.id,
    serviceId: v.service_id,
    // Varian baku (label kosong) tampil sebagai "Standar" di sini — pilihan
    // ini WAJIB selalu punya teks tampilan, beda dari `labelVarian()` yang
    // sengaja memulangkan string kosong untuk dirangkai layar lain.
    nama: labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format }) || "Standar",
  }));
}
