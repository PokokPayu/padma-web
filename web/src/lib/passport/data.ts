import { cache } from "react";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { createServerSupabase } from "@/lib/supabase/server";
import { saringDaftarMateri } from "./materi-tampil";
import type { PaketRingkas, PayStatus, SesiRingkas, StatusSesi } from "./turunan";

export type KlienPassport = {
  id: string;
  padmaId: string;
  nama: string;
  email: string;
  noHp: string;
  faseId: string;
  faseNama: string;
  faseSanskrit: string;
};

type BarisKlien = {
  id: string;
  padma_id: string;
  nama: string;
  email: string;
  no_hp: string;
  phase_id: string;
  // Embed many-to-one PostgREST = OBJEK (atau null), bukan array.
  phases: { nama: string; nama_sanskrit: string } | null;
};

// SELURUH pembacaan passport memakai sesi pengguna: RLS yang menjadi penjaga,
// bukan UI. Service role DILARANG di jalur ini — ia menembus RLS dan akan
// mengirim isi materi terkunci ke RSC payload, tempat penyaringan UI tidak
// menolong apa pun.
// Di-cache karena layout DAN page sama-sama memanggilnya: layout butuh nama
// untuk header, page butuh id untuk memfilter data. Keduanya benar sebagai
// kode — tiap halaman harus berdiri sendiri, tidak boleh bergantung pada
// layout sudah mengambilnya — dan cache per-request yang membuatnya gratis.
export const ambilKlien = cache(async (): Promise<KlienPassport | null> => {
  const user = await penggunaSaatIni();
  if (!user) return null;

  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("clients")
    .select("id, padma_id, nama, email, no_hp, phase_id, phases(nama, nama_sanskrit)")
    .eq("user_id", user.id) // operator setara, tidak pernah pola
    .returns<BarisKlien[]>()
    .maybeSingle(); // maybeSingle: klien belum tertaut bukan error (PGRST116)
  if (!data) return null;

  return {
    id: data.id,
    padmaId: data.padma_id,
    nama: data.nama,
    email: data.email,
    noHp: data.no_hp,
    faseId: data.phase_id,
    faseNama: data.phases?.nama ?? "",
    faseSanskrit: data.phases?.nama_sanskrit ?? "",
  };
});

type BarisSesi = {
  id: string;
  tanggal: string;
  status: StatusSesi;
  catatan: string | null;
  rekomendasi: string | null;
  status_bayar: PayStatus;
  client_package_id: string | null;
  service_id: string;
  partner_id: string;
  services: { nama: string } | null;
};

type BarisMitra = { id: string; nama: string };

export async function ambilSesi(clientId: string): Promise<SesiRingkas[]> {
  const supabase = await createServerSupabase();

  // DUA QUERY, digabung di JS — sengaja TIDAK memakai embed PostgREST ke view
  // nama mitra. Embed ke sebuah VIEW bergantung pada inferensi relasi yang
  // tidak dijamin, dan kegagalannya SENYAP (nama bidan jadi null, atau dengan
  // `!inner` seluruh riwayat kosong tanpa error). Dua query selalu bekerja.
  const [{ data: sesi }, { data: mitra }] = await Promise.all([
    supabase
      .from("sessions")
      .select(
        "id, tanggal, status, catatan, rekomendasi, status_bayar, client_package_id, service_id, partner_id, services(nama)",
      )
      .eq("client_id", clientId) // eksplisit, walau RLS sudah menyaring
      // `tanggal` bertipe date dan sudah berupa string YYYY-MM-DD: urutannya
      // diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
      .order("tanggal", { ascending: false })
      .returns<BarisSesi[]>(),
    supabase.from("partner_publik").select("id, nama").returns<BarisMitra[]>(),
  ]);

  const namaMitraPer = new Map((mitra ?? []).map((m) => [m.id, m.nama]));

  return (sesi ?? []).map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    namaLayanan: r.services?.nama ?? "Layanan",
    namaMitra: namaMitraPer.get(r.partner_id) ?? "Tim PADMA",
    tanggal: r.tanggal,
    status: r.status,
    clientPackageId: r.client_package_id,
    catatan: r.catatan ?? "",
    rekomendasi: r.rekomendasi ?? "",
    statusBayar: r.status_bayar,
  }));
}

type BarisPaket = {
  id: string;
  status: string;
  status_bayar: PayStatus;
  packages: { nama: string; jumlah_sesi: number } | null;
};

export async function ambilPaket(clientId: string): Promise<PaketRingkas[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("client_packages")
    .select("id, status, status_bayar, packages(nama, jumlah_sesi)")
    .eq("client_id", clientId)
    .eq("status", "aktif")
    .returns<BarisPaket[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    nama: r.packages?.nama ?? "Paket",
    jumlahSesi: r.packages?.jumlah_sesi ?? 0,
    statusBayar: r.status_bayar,
  }));
}

export type TipeMateri = "ebook" | "video";

export type MateriRingkas = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  namaLayanan: string;
  terbuka: boolean;
  jumlahHalaman: number;
  /**
   * M10: materi TANPA satu pun layanan hanya boleh tampil bila memang sudah
   * terbuka (mis. di-assign eksplisit) — lihat `saringDaftarMateri` di
   * `./materi-tampil`. Kartu terkunci menjanjikan "jalani layanan ini,
   * materinya terbuka"; janji itu bohong untuk materi yang tidak punya
   * layanan sama sekali.
   */
  punyaLayanan: boolean;
};

type BarisLayananNama = { id: string; nama: string };

type BarisMateriDaftar = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  // `material_pages` = one-to-many → ARRAY (kosong saat terkunci ATAU saat
  // berhak tapi isinya belum diunggah admin — daftar tidak perlu membedakan
  // keduanya, hanya reader yang perlu, lewat RPC `berhak_isi_materi`).
  material_pages: Array<{ halaman: number }>;
  // `material_videos.material_id` adalah PRIMARY KEY → one-to-one → OBJEK/null.
  // `video.length === 0` selalu salah di sini.
  material_videos: { material_id: string } | null;
  // Many-to-many lewat tabel penghubung, BOLEH KOSONG (materi tanpa layanan
  // sama sekali, hanya terbuka lewat material_assignments).
  material_services: Array<{ service_id: string }>;
};

// Daftar materi: DILARANG menyebut `isi` atau `url` — halaman daftar tidak
// boleh pernah membawa isi materi ke RSC payload. Keterbukaan disimpulkan dari
// ADA/TIDAKNYA baris tergating yang dikembalikan RLS, bukan dari kolom apa pun.
export async function ambilDaftarMateri(): Promise<MateriRingkas[]> {
  const supabase = await createServerSupabase();

  // DUA QUERY, digabung di JS — pola yang sama dipakai `ambilSesi` untuk nama
  // mitra. `materials -> services` kini punya DUA jalur (langsung lewat
  // `materials.service_id`, dan lewat `material_services`), dan sejak materi
  // boleh berlayanan-jamak itu membuat PostgREST menolak embed `services`
  // LANGSUNG dari `materials` dengan PGRST201 kecuali diberi hint FK eksplisit
  // (`services!materials_service_id_fkey`). Hint itu SENGAJA tidak dipakai
  // lagi: ia menyebut nama constraint FK `materials.service_id`, dan kolom itu
  // rencananya dihapus — hint yang menyebut FK yang sudah tak ada akan
  // mematahkan query ini. Membaca nama layanan lewat `material_services`
  // (id layanan diambil sebagai array, namanya digabung di JS) menghindari
  // ambiguitas itu sekaligus tetap tidak bergantung pada embed ke view.
  const [{ data }, { data: layanan }] = await Promise.all([
    supabase
      .from("materials")
      .select(
        "id, judul, tipe, deskripsi, material_pages(halaman), material_videos(material_id), material_services(service_id)",
      )
      // Policy pages/chapters/videos kini ikut mengevaluasi materials.aktif
      // (migration gating_materi_hormati_aktif), sehingga ISI materi yang
      // ditarik memang berhenti dijawab basis data. Baris `materials` sendiri
      // TETAP terbaca setiap pengguna login — menutupnya akan mengulangi bug
      // partner_publik — jadi menghilangkan KARTU-nya tetap tanggung jawab
      // query ini.
      .eq("aktif", true)
      .order("judul")
      .returns<BarisMateriDaftar[]>(),
    supabase.from("services").select("id, nama").returns<BarisLayananNama[]>(),
  ]);

  const namaLayananPer = new Map((layanan ?? []).map((s) => [s.id, s.nama]));

  const daftar: MateriRingkas[] = (data ?? []).map((m) => {
    const halaman = m.material_pages ?? [];
    const video = m.material_videos;
    const layananId = (m.material_services ?? []).map((ms) => ms.service_id);
    // Satu materi kini bisa punya beberapa layanan — gabungkan namanya, atau
    // string kosong bila tidak ada satu pun (materi murni-assignment).
    const namaLayanan = layananId
      .map((id) => namaLayananPer.get(id))
      .filter((nama): nama is string => Boolean(nama))
      .join(", ");
    return {
      id: m.id,
      judul: m.judul,
      tipe: m.tipe,
      deskripsi: m.deskripsi,
      namaLayanan,
      terbuka: m.tipe === "ebook" ? halaman.length > 0 : video !== null,
      jumlahHalaman: halaman.length,
      punyaLayanan: layananId.length > 0,
    };
  });

  // M10 — lihat komentar `saringDaftarMateri` di `./materi-tampil`.
  return saringDaftarMateri(daftar);
}

export type HalamanMateri = { halaman: number; lebar: number; tinggi: number };

export type MateriDetail = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  namaLayanan: string;
  halaman: HalamanMateri[];
  videoUrl: string | null;
  /**
   * Dari RPC `berhak_isi_materi` (security definer) — SATU sumber kebenaran
   * yang sama dipakai policy RLS `material_pages`/`material_chapters`/
   * `material_videos`. Tanpa ini, "tidak berhak" dan "berhak tapi isinya
   * belum diunggah admin" terlihat identik dari sisi query: keduanya nol
   * baris. Pasien yang sebenarnya berhak akan dibohongi kalimat "terbuka
   * setelah layanan terkait Anda jalani".
   */
  berhak: boolean;
};

type BarisMateriDetail = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  material_pages: HalamanMateri[];
  material_videos: { url: string } | null;
  material_services: Array<{ service_id: string }>;
};

export async function ambilMateriDetail(materialId: string): Promise<MateriDetail | null> {
  const supabase = await createServerSupabase();
  const [{ data }, { data: layanan }, { data: berhak }] = await Promise.all([
    supabase
      .from("materials")
      .select(
        // Lihat komentar panjang di `ambilDaftarMateri` — hint FK
        // `services!materials_service_id_fkey` SENGAJA tidak dipakai lagi di
        // sini juga, dengan alasan yang sama.
        "id, judul, tipe, deskripsi, material_pages(halaman, lebar, tinggi), material_videos(url), material_services(service_id)",
      )
      .eq("id", materialId)
      .eq("aktif", true) // reader pun wajib menyaring sendiri
      .returns<BarisMateriDetail[]>()
      .maybeSingle(),
    supabase.from("services").select("id, nama").returns<BarisLayananNama[]>(),
    // Parameternya hanya id materi — tidak bergantung pada hasil query
    // manapun di atas, jadi aman dipanggil paralel lewat `Promise.all`.
    supabase.rpc("berhak_isi_materi", { p_material_id: materialId }),
  ]);
  if (!data) return null;

  const namaLayananPer = new Map((layanan ?? []).map((s) => [s.id, s.nama]));
  const namaLayanan = (data.material_services ?? [])
    .map((ms) => namaLayananPer.get(ms.service_id))
    .filter((nama): nama is string => Boolean(nama))
    .join(", ");

  // Halaman yang terkunci tidak dikembalikan RLS sama sekali — array kosong,
  // bukan isi tersensor. Diurutkan menaik di JS karena embed PostgREST tidak
  // menjamin urutan tanpa `.order()` eksplisit; komparator MEMBALAS 0 untuk
  // elemen setara — komparator yang membalas 1 untuk itu sudah pernah jadi
  // bug nyata di repo ini (menghapus/menggeser baris yang seharusnya diam).
  const halaman = [...(data.material_pages ?? [])].sort((a, b) => a.halaman - b.halaman);

  return {
    id: data.id,
    judul: data.judul,
    tipe: data.tipe,
    deskripsi: data.deskripsi,
    namaLayanan,
    halaman,
    videoUrl: data.material_videos?.url ?? null,
    berhak: berhak === true,
  };
}

export type PermintaanRingkas = {
  id: string;
  namaLayanan: string;
  tanggal: string;
  preferensiWaktu: string;
  status: string;
};

type BarisPermintaan = {
  id: string;
  tanggal: string;
  preferensi_waktu: string;
  status: string;
  services: { nama: string } | null;
};

export async function ambilPermintaanJadwal(clientId: string): Promise<PermintaanRingkas[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("booking_requests")
    .select("id, tanggal, preferensi_waktu, status, services(nama)")
    .eq("client_id", clientId)
    .eq("status", "menunggu")
    .order("tanggal")
    .returns<BarisPermintaan[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    namaLayanan: r.services?.nama ?? "Layanan",
    tanggal: r.tanggal,
    preferensiWaktu: r.preferensi_waktu,
    status: r.status,
  }));
}
