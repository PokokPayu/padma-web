import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Lapisan data modul Layanan & Paket.
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

export type LayananKelola = {
  id: string;
  nama: string;
  deskripsi: string;
  aktif: boolean;
  /** Berapa sesi yang sudah tercatat memakai layanan ini. */
  sesiTercatat: number;
  paket: PaketKelola[];
};

export type FaseKelola = {
  id: string;
  nama: string;
  namaSanskrit: string;
  urutan: number;
  layanan: LayananKelola[];
};

export type LayananPilihan = { id: string; nama: string };

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

/**
 * Seluruh katalog untuk halaman KELOLA — aktif maupun tidak, dikelompokkan per
 * fase seperti prototipe `vLayanan`.
 *
 * Empat query, digabung di JS. Agregat tertanam PostgREST (`sessions(count)`,
 * `client_packages(count)`) akan lebih ringkas dan gagal SENYAP: angkanya tetap
 * keluar, hanya saja dihitung dari baris yang RLS izinkan lewat jalur embed —
 * arah yang tidak pernah kita kendalikan. Dua peta di bawah dihitung dari
 * baris yang benar-benar terbaca.
 */
export async function daftarKatalogAdmin(): Promise<FaseKelola[]> {
  const supabase = await createServerSupabase();

  const [{ data: fase }, { data: layanan }, { data: paket }, { data: paketKlien }, { data: sesi }] =
    await Promise.all([
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
      supabase.from("sessions").select("service_id").returns<{ service_id: string }[]>(),
    ]);

  const dipakaiPer = new Map<string, number>();
  for (const p of paketKlien ?? []) {
    dipakaiPer.set(p.package_id, (dipakaiPer.get(p.package_id) ?? 0) + 1);
  }
  const sesiPer = new Map<string, number>();
  for (const s of sesi ?? []) {
    sesiPer.set(s.service_id, (sesiPer.get(s.service_id) ?? 0) + 1);
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
