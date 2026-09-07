import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";

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

// `lat`/`lon` ikut dipulangkan untuk modul Sesi (`saranJenjang`, Task 7):
// domisili mitra adalah satu sisi jarak garis lurus yang ditampilkan admin
// saat memilih mitra untuk sesi baru. Keduanya nullable persis kolom aslinya
// — domisili yang belum digeocode bukan galat, ia berarti saran tidak muncul.
export type MitraPilihan = { id: string; nama: string; lat: number | null; lon: number | null };

type BarisPartner = {
  id: string;
  nama: string;
  no_hp: string;
  alamat: string;
  aktif: boolean;
};

/** Nilai saringan yang sah untuk daftar mitra — dipakai halaman DAN uji. */
export const SARING_MITRA: SaringSah = { aktif: ["ya", "tidak"] };

/**
 * Satu halaman daftar kelola mitra, beserta TOTAL baris yang cocok.
 *
 * Total dihitung lewat `count: "exact"` pada query yang sama, bukan dengan
 * menarik seluruh baris lalu mengukur panjangnya — menarik seluruh baris
 * adalah persis hal yang paginasi ini datang untuk hentikan.
 */
export async function ambilDaftarMitra(
  param: ParamDaftar,
): Promise<{ baris: BarisMitra[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("partners")
    .select("id, nama, no_hp, alamat, aktif", { count: "exact" })
    .order("aktif", { ascending: false })
    .order("nama");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");

  // `ilike` dengan `%` di kedua sisi: admin mengetik penggalan nama yang
  // diingatnya, bukan awalannya. Kata cari di-escape supaya `%` dan `_` yang
  // diketik manusia dicari sebagai huruf, bukan sebagai wildcard.
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("nama", `%${aman}%`);
  }

  // DUA QUERY, digabung di JS. Agregat tertanam PostgREST (`sessions(count)`)
  // tidak bisa disaring per-status tanpa mengubah arti gabungannya, dan
  // kegagalannya senyap: angkanya keluar, hanya saja menghitung sesi yang belum
  // terjadi sebagai kinerja.
  const [{ data: mitra, count }, { data: sesi }] = await Promise.all([
    q.range(dari, sampai).returns<BarisPartner[]>(),
    // Query sesi TIDAK ikut dipaginasi dan TIDAK ikut disaring: ia menghitung
    // kinerja SELURUH mitra, dan memotongnya akan mengecilkan angka kinerja
    // secara senyap — tidak ada galat, angkanya hanya salah.
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

  return {
    baris: (mitra ?? []).map((m) => ({
      id: m.id,
      nama: m.nama,
      noHp: m.no_hp,
      alamat: m.alamat,
      aktif: m.aktif,
      sesiSelesai: selesaiPer.get(m.id) ?? 0,
    })),
    total: count ?? 0,
  };
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
    .select("id, nama, lat, lon")
    .eq("aktif", true)
    .order("nama")
    .returns<MitraPilihan[]>();
  return data ?? [];
}
