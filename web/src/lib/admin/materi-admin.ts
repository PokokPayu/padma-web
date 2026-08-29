import { createServerSupabase } from "@/lib/supabase/server";
import type { TipeMateri } from "@/app/admin/materi/status";

/**
 * Lapisan data modul Materi.
 *
 * Tiga hal yang membedakannya dari daftar materi klien
 * (`ambilDaftarMateri` di `@/lib/passport/data`) — dan ketiganya disengaja:
 *
 *   • Daftar KELOLA memuat materi NONAKTIF juga. Kalau tidak, materi yang
 *     ditarik karena salah klik tidak punya jalan kembali dari panel mana pun.
 *
 *   • Daftar KELOLA membawa ISI-nya (judul bab, URL video). Halaman klien tidak
 *     boleh — halaman ini boleh, karena isinya persis yang sedang disunting.
 *     Pembatasnya bukan query melainkan RLS: policy "chapters: staf" &
 *     "video: staf" hanya menjawab admin/owner. Karena itu lapisan ini WAJIB
 *     memakai sesi pengguna; di bawah service role `user_role()` mengembalikan
 *     'klien' dan seluruh isi tetap keluar tanpa satu pun pagar diperiksa.
 *
 *   • `lengkap` dihitung di sini, sekali, dan dipakai halaman MAUPUN action.
 *     Materi bertipe `video` tanpa baris `material_videos` (atau `ebook` tanpa
 *     bab) terkunci selamanya bagi setiap klien yang berhak — tanpa error —
 *     sementara kartunya berbunyi "Terbuka setelah layanan terkait selesai".
 *     Angka itulah yang membuat keadaan tersebut terlihat, bukan tertebak.
 */

export type BabKelola = { id: string; urutan: number; judul: string; isi: string };

export type MateriKelola = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  aktif: boolean;
  layananId: string;
  bab: BabKelola[];
  /**
   * `material_videos.material_id` adalah PRIMARY KEY → relasi 1:1. Nilainya
   * URL atau `null`, TIDAK PERNAH array: `video.length === 0` selalu salah dan
   * akan membuat setiap materi video tampak belum punya isi.
   */
  videoUrl: string | null;
  /** `ebook` punya minimal satu bab, atau `video` punya URL. */
  lengkap: boolean;
};

export type LayananMateri = {
  id: string;
  nama: string;
  aktif: boolean;
  materi: MateriKelola[];
};

export type LayananPilihanMateri = { id: string; nama: string };

type BarisMateri = {
  id: string;
  service_id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  aktif: boolean;
};
type BarisBab = { id: string; material_id: string; urutan: number; judul: string; isi: string };
type BarisVideo = { material_id: string; url: string };
type BarisLayanan = { id: string; nama: string; aktif: boolean };

/**
 * Seluruh materi klinik, dikelompokkan di bawah layanan asalnya.
 *
 * Empat query, digabung di JS. Embed PostgREST (`materials(material_chapters(*))`)
 * akan lebih ringkas dan gagal SENYAP: isinya tetap keluar, hanya saja disaring
 * lewat jalur embed yang arah RLS-nya tidak pernah kita kendalikan. Peta di
 * bawah dibangun dari baris yang benar-benar terbaca.
 *
 * Layanan diambil UTUH — termasuk yang sudah dipensiunkan. Materi milik layanan
 * nonaktif tetap harus bisa disunting; menyembunyikannya berarti isi yang
 * terlanjur terbit tidak punya satu pun layar yang bisa menariknya.
 */
export async function daftarMateriAdmin(): Promise<LayananMateri[]> {
  const supabase = await createServerSupabase();

  const [{ data: layanan }, { data: materi }, { data: bab }, { data: video }] =
    await Promise.all([
      supabase
        .from("services")
        .select("id, nama, aktif")
        .order("aktif", { ascending: false })
        .order("nama")
        .returns<BarisLayanan[]>(),
      supabase
        .from("materials")
        .select("id, service_id, judul, tipe, deskripsi, aktif")
        .order("aktif", { ascending: false })
        .order("judul")
        .returns<BarisMateri[]>(),
      supabase
        .from("material_chapters")
        .select("id, material_id, urutan, judul, isi")
        .order("urutan")
        .returns<BarisBab[]>(),
      supabase
        .from("material_videos")
        .select("material_id, url")
        .returns<BarisVideo[]>(),
    ]);

  const babPer = new Map<string, BabKelola[]>();
  for (const b of bab ?? []) {
    const daftar = babPer.get(b.material_id) ?? [];
    daftar.push({ id: b.id, urutan: b.urutan, judul: b.judul, isi: b.isi });
    babPer.set(b.material_id, daftar);
  }
  const videoPer = new Map<string, string>();
  for (const v of video ?? []) videoPer.set(v.material_id, v.url);

  const materiPer = new Map<string, MateriKelola[]>();
  for (const m of materi ?? []) {
    const isiBab = babPer.get(m.id) ?? [];
    const url = videoPer.get(m.id) ?? null;
    const daftar = materiPer.get(m.service_id) ?? [];
    daftar.push({
      id: m.id,
      judul: m.judul,
      tipe: m.tipe,
      deskripsi: m.deskripsi,
      aktif: m.aktif,
      layananId: m.service_id,
      bab: isiBab,
      videoUrl: url,
      lengkap: m.tipe === "ebook" ? isiBab.length > 0 : url !== null,
    });
    materiPer.set(m.service_id, daftar);
  }

  // Layanan tanpa materi sengaja tetap ditampilkan: itulah satu-satunya tempat
  // admin melihat bahwa sebuah layanan belum punya materi sama sekali.
  return (layanan ?? []).map((l) => ({
    id: l.id,
    nama: l.nama,
    aktif: l.aktif,
    materi: materiPer.get(l.id) ?? [],
  }));
}

/**
 * Pilihan layanan induk saat mendaftarkan materi baru — hanya yang aktif.
 *
 * Sengaja tidak memakai ulang `pilihanLayanan()` di `@/lib/admin/katalog-admin`
 * hanya demi berhemat satu fungsi: keduanya kebetulan sama HARI INI, dan
 * menyatukannya membuat perubahan aturan di satu modul merambat diam-diam ke
 * modul lain. Yang dipakai bersama adalah tabelnya, bukan keputusannya.
 */
export async function pilihanLayananMateri(): Promise<LayananPilihanMateri[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("services")
    .select("id, nama")
    .eq("aktif", true)
    .order("nama")
    .returns<LayananPilihanMateri[]>();
  return data ?? [];
}
