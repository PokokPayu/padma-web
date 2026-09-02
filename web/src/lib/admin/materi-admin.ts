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
 *   • Daftar KELOLA membawa ISI-nya (jumlah halaman e-book, URL video).
 *     Halaman klien tidak boleh — halaman ini boleh, karena isinya persis
 *     yang sedang disunting. Pembatasnya bukan query melainkan RLS: policy
 *     "halaman: staf kelola" & "video: staf" hanya menjawab admin/owner.
 *     Karena itu lapisan ini WAJIB memakai sesi pengguna; di bawah service
 *     role `user_role()` mengembalikan 'klien' dan seluruh isi tetap keluar
 *     tanpa satu pun pagar diperiksa.
 *
 *   • `lengkap` dihitung di sini, sekali, dan dipakai halaman MAUPUN action.
 *     Materi bertipe `video` tanpa baris `material_videos` (atau `ebook`
 *     tanpa satu pun halaman) terkunci selamanya bagi setiap klien yang
 *     berhak — tanpa error — sementara kartunya berbunyi "Terbuka setelah
 *     layanan terkait selesai". Angka itulah yang membuat keadaan tersebut
 *     terlihat, bukan tertebak.
 *
 * Pengelompokan sejak Task 11: `materials.service_id` (satu materi, satu
 * layanan) sudah dihapus. Materi sekarang boleh menempel ke NOL ATAU LEBIH
 * layanan lewat `material_services`, jadi satu materi bisa muncul di bawah
 * lebih dari satu kelompok layanan sekaligus — dan materi yang layanannya
 * kosong tidak boleh menghilang begitu saja dari panel ini: ia dikumpulkan
 * di kelompok sentinel "Tanpa layanan" di akhir daftar, supaya keadaan
 * "hanya terbuka lewat penugasan" tetap terlihat, bukan tersembunyi.
 */

export type MateriKelola = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  aktif: boolean;
  /** Nol atau lebih — materi TANPA layanan sama sekali adalah keadaan SAH. */
  layananId: string[];
  /** Dari `material_pages`; isi e-book kini gambar halaman, bukan bab teks. */
  jumlahHalaman: number;
  /**
   * `material_videos.material_id` adalah PRIMARY KEY → relasi 1:1. Nilainya
   * URL atau `null`, TIDAK PERNAH array: `video.length === 0` selalu salah dan
   * akan membuat setiap materi video tampak belum punya isi.
   */
  videoUrl: string | null;
  /** `ebook` punya minimal satu halaman, atau `video` punya URL. */
  lengkap: boolean;
};

export type LayananMateri = {
  id: string;
  nama: string;
  aktif: boolean;
  materi: MateriKelola[];
};

export type LayananPilihanMateri = { id: string; nama: string };

/** Sentinel id kelompok "Tanpa layanan" — bukan uuid layanan sungguhan. */
export const TANPA_LAYANAN_ID = "tanpa-layanan";

type BarisMateri = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  aktif: boolean;
  // Embed AGREGAT (lihat dokblok fungsi), bukan isi: selalu tepat SATU objek
  // `{ count }`, tidak pernah larik baris `material_pages` sungguhan.
  material_pages: Array<{ count: number }>;
};
type BarisTautan = { material_id: string; service_id: string };
type BarisVideo = { material_id: string; url: string };
type BarisLayanan = { id: string; nama: string; aktif: boolean };

/**
 * Seluruh materi klinik, dikelompokkan di bawah layanan yang menautkannya.
 *
 * EMPAT query, digabung di JS.
 *
 * Jumlah halaman diambil lewat embed AGREGAT `material_pages(count)`, BUKAN
 * `material_pages(*)` atau query `select("material_id")` terpisah yang
 * menarik satu baris per halaman. Bedanya krusial, bukan kosmetik:
 *   • PostgREST (`db-max-rows`, 1000 di config.toml & container ini) memotong
 *     BARIS yang dikembalikan, tidak pernah nilai agregat. Query lama menarik
 *     satu baris `material_id` PER HALAMAN dari SELURUH klinik tanpa `.range()`
 *     — begitu total baris `material_pages` klinik melewati 1000 (kira-kira
 *     empat e-book penuh), halaman di luar 1000 pertama lenyap dari peta yang
 *     dibangun di JS, dan setiap materi yang barisnya jatuh sesudah potongan
 *     itu MELAPORKAN `jumlahHalaman: 0` -> `lengkap: false` di panel ini,
 *     padahal `aktifkanMateri` (yang memakai `count: "exact", head: true`
 *     BERSKOP satu materi — juga kebal dari `max_rows` karena tidak menarik
 *     baris sama sekali) tetap menjawab benar. Dua panel yang sama-sama
 *     membaca data yang sama, berbeda jawaban — dan yang salah adalah yang
 *     terlihat, yang mengundang admin mengunggah ulang materi yang sebenarnya
 *     sudah lengkap.
 *   • `material_pages(count)` TIDAK menarik `objek`/`halaman` sama sekali —
 *     hanya satu integer per materi, dihitung Postgres sendiri di balik RLS
 *     yang sama (`halaman: staf kelola` / `halaman: klien berhak`) yang sudah
 *     menyaring query lama. Ini BUKAN `materials(material_pages(*))` yang
 *     komentar versi sebelumnya sengaja menolak: itu menarik ISI (setiap
 *     `objek`, byte penuntun ke bucket privat) lewat arah embed yang RLS-nya
 *     tidak pernah diaudit terpisah. Agregat count tidak punya "isi" untuk
 *     bocor — cuma angka.
 *
 * Layanan diambil UTUH — termasuk yang sudah dipensiunkan. Materi milik layanan
 * nonaktif tetap harus bisa disunting; menyembunyikannya berarti isi yang
 * terlanjur terbit tidak punya satu pun layar yang bisa menariknya.
 */
export async function daftarMateriAdmin(): Promise<LayananMateri[]> {
  const supabase = await createServerSupabase();

  const [{ data: layanan }, { data: materi }, { data: tautan }, { data: video }] =
    await Promise.all([
      supabase
        .from("services")
        .select("id, nama, aktif")
        .order("aktif", { ascending: false })
        .order("nama")
        .returns<BarisLayanan[]>(),
      supabase
        .from("materials")
        .select("id, judul, tipe, deskripsi, aktif, material_pages(count)")
        .order("aktif", { ascending: false })
        .order("judul")
        .returns<BarisMateri[]>(),
      supabase
        .from("material_services")
        .select("material_id, service_id")
        .returns<BarisTautan[]>(),
      supabase
        .from("material_videos")
        .select("material_id, url")
        .returns<BarisVideo[]>(),
    ]);

  const layananPerMateri = new Map<string, string[]>();
  for (const t of tautan ?? []) {
    const daftar = layananPerMateri.get(t.material_id) ?? [];
    daftar.push(t.service_id);
    layananPerMateri.set(t.material_id, daftar);
  }

  const videoPer = new Map<string, string>();
  for (const v of video ?? []) videoPer.set(v.material_id, v.url);

  const materiById = new Map<string, MateriKelola>();
  for (const m of materi ?? []) {
    // Embed agregat: selalu satu objek `{ count }` (LEFT JOIN, bukan INNER —
    // materi tanpa satu pun halaman tetap menjawab `count: 0`, tidak pernah
    // larik kosong tanpa objek sama sekali).
    const jumlahHalaman = m.material_pages[0]?.count ?? 0;
    const url = videoPer.get(m.id) ?? null;
    materiById.set(m.id, {
      id: m.id,
      judul: m.judul,
      tipe: m.tipe,
      deskripsi: m.deskripsi,
      aktif: m.aktif,
      layananId: layananPerMateri.get(m.id) ?? [],
      jumlahHalaman,
      videoUrl: url,
      lengkap: m.tipe === "ebook" ? jumlahHalaman > 0 : url !== null,
    });
  }

  // Setiap layanan dapat materi-nya lewat FILTER pada daftar `materi` yang
  // sudah terurut judul — bukan lewat map service_id->material_id — supaya
  // urutan judul di dalam tiap kelompok ikut terwarisi tanpa sort kedua.
  const kelompok: LayananMateri[] = (layanan ?? []).map((l) => ({
    id: l.id,
    nama: l.nama,
    aktif: l.aktif,
    materi: (materi ?? [])
      .filter((m) => (layananPerMateri.get(m.id) ?? []).includes(l.id))
      .map((m) => materiById.get(m.id)!),
  }));

  // Kelompok sentinel di AKHIR daftar: materi yang sama sekali tidak menempel
  // ke layanan mana pun. Tanpa kelompok ini, materi seperti itu lenyap dari
  // panel — padahal ia tetap ada dan tetap bisa dibuka lewat penugasan.
  kelompok.push({
    id: TANPA_LAYANAN_ID,
    nama: "Tanpa layanan",
    aktif: true,
    materi: (materi ?? [])
      .filter((m) => (layananPerMateri.get(m.id) ?? []).length === 0)
      .map((m) => materiById.get(m.id)!),
  });

  return kelompok;
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

export type KlienPilihan = { id: string; nama: string; padmaId: string };

/**
 * Pilihan klien untuk panel penugasan — SELURUH baris `clients`, diurutkan
 * nama, TANPA menyaring `user_id`. `clients.user_id` boleh NULL (klien yang
 * didaftarkan tapi belum menukar tautan aktivasi), dan itu bukan alasan
 * untuk menyembunyikannya dari daftar pilih: penugasan sah dibuat sebelum
 * klien pernah login sama sekali — `material_assignments` hanya menyimpan
 * `client_id`, dan baru bermakna begitu `berhak_isi_materi()` dievaluasi
 * lewat `auth.uid()` klien itu SENDIRI saat ia benar-benar masuk. Menyaring
 * klien belum-aktivasi di sini hanya akan memaksa admin menugaskan materi
 * dalam urutan tertentu (aktivasi dulu, baru boleh assign) tanpa alasan
 * teknis apa pun.
 */
export async function pilihanKlien(): Promise<KlienPilihan[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("clients")
    .select("id, nama, padma_id")
    .order("nama")
    .returns<Array<{ id: string; nama: string; padma_id: string }>>();
  return (data ?? []).map((k) => ({ id: k.id, nama: k.nama, padmaId: k.padma_id }));
}
