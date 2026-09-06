import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Lapisan data modul Mitra.
 *
 * Satu tabel, DUA kebutuhan yang berlawanan — dan justru di situ cacatnya
 * pernah lahir:
 *
 *   • Daftar KELOLA (halaman ini) harus memuat mitra nonaktif juga; kalau
 *     tidak, seorang bidan yang dinonaktifkan karena salah klik tidak punya
 *     jalan kembali dari panel mana pun.
 *
 *   • Daftar PILIH (menjadwalkan sesi baru) harus menyaring `aktif`; kalau
 *     tidak, bidan yang sudah berhenti tetap ditawarkan tiap hari.
 *
 *   • Dan NAMA untuk riwayat (view `partner_publik`) tidak boleh menyaring apa
 *     pun. Penyaringan di sanalah yang dulu membuat satu klik "nonaktifkan"
 *     mengubah nama bidan di riwayat SELURUH klien menjadi "Tim PADMA", tanpa
 *     satu pun error. Jangan pernah memindahkan filter `aktif` ke view itu.
 *
 * Seluruh bacaan memakai SESI PENGGUNA (`createServerSupabase`), bukan service
 * role: policy `partners: staf` yang mengizinkannya, dan di bawah service role
 * `user_role()` justru mengembalikan 'klien' sehingga tidak satu pun pagar ikut
 * diperiksa.
 */

export type BarisMitra = {
  id: string;
  nama: string;
  noHp: string;
  alamat: string;
  aktif: boolean;
  sesiSelesai: number;
};

export type MitraPilihan = { id: string; nama: string };

type BarisPartner = {
  id: string;
  nama: string;
  no_hp: string;
  alamat: string;
  aktif: boolean;
};

/** Semua mitra — aktif maupun tidak — beserta jumlah sesi yang sudah selesai. */
export async function ambilDaftarMitra(): Promise<BarisMitra[]> {
  const supabase = await createServerSupabase();

  // DUA QUERY, digabung di JS. Agregat tertanam PostgREST (`sessions(count)`)
  // tidak bisa disaring per-status tanpa mengubah arti gabungannya, dan
  // kegagalannya senyap: angkanya keluar, hanya saja menghitung sesi yang belum
  // terjadi sebagai kinerja.
  const [{ data: mitra }, { data: sesi }] = await Promise.all([
    supabase
      .from("partners")
      .select("id, nama, no_hp, alamat, aktif")
      .order("aktif", { ascending: false })
      .order("nama")
      .returns<BarisPartner[]>(),
    supabase
      .from("sessions")
      .select("partner_id")
      .eq("status", "selesai")
      .returns<{ partner_id: string }[]>(),
  ]);

  const selesaiPer = new Map<string, number>();
  for (const s of sesi ?? []) {
    selesaiPer.set(s.partner_id, (selesaiPer.get(s.partner_id) ?? 0) + 1);
  }

  return (mitra ?? []).map((m) => ({
    id: m.id,
    nama: m.nama,
    noHp: m.no_hp,
    alamat: m.alamat,
    aktif: m.aktif,
    sesiSelesai: selesaiPer.get(m.id) ?? 0,
  }));
}

/**
 * Pilihan mitra untuk MENJADWALKAN sesi baru — hanya yang aktif.
 *
 * Dipakai modul Sesi. Ditaruh di sini, bukan di modul itu, supaya satu-satunya
 * definisi "mitra yang masih melayani" hidup berdampingan dengan daftar kelola
 * yang mengubahnya.
 */
export async function pilihanMitra(): Promise<MitraPilihan[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("partners")
    .select("id, nama")
    .eq("aktif", true)
    .order("nama")
    .returns<MitraPilihan[]>();
  return data ?? [];
}
