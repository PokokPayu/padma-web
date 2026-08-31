import { cache } from "react";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { createServerSupabase } from "@/lib/supabase/server";
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
  jumlahBab: number;
};

type BarisMateriDaftar = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  services: { nama: string } | null;
  // `material_chapters` = one-to-many → ARRAY (kosong saat terkunci).
  material_chapters: Array<{ id: string }>;
  // `material_videos.material_id` adalah PRIMARY KEY → one-to-one → OBJEK/null.
  // `video.length === 0` selalu salah di sini.
  material_videos: { material_id: string } | null;
};

// Daftar materi: DILARANG menyebut `isi` atau `url` — halaman daftar tidak
// boleh pernah membawa isi materi ke RSC payload. Keterbukaan disimpulkan dari
// ADA/TIDAKNYA baris tergating yang dikembalikan RLS, bukan dari kolom apa pun.
export async function ambilDaftarMateri(): Promise<MateriRingkas[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("materials")
    .select(
      "id, judul, tipe, deskripsi, services(nama), material_chapters(id), material_videos(material_id)",
    )
    // Policy chapters/videos kini ikut mengevaluasi materials.aktif (migration
    // gating_materi_hormati_aktif), sehingga ISI materi yang ditarik memang
    // berhenti dijawab basis data. Baris `materials` sendiri TETAP terbaca
    // setiap pengguna login — menutupnya akan mengulangi bug partner_publik —
    // jadi menghilangkan KARTU-nya tetap tanggung jawab query ini.
    .eq("aktif", true)
    .order("judul")
    .returns<BarisMateriDaftar[]>();

  return (data ?? []).map((m) => {
    const bab = m.material_chapters ?? [];
    const video = m.material_videos;
    return {
      id: m.id,
      judul: m.judul,
      tipe: m.tipe,
      deskripsi: m.deskripsi,
      namaLayanan: m.services?.nama ?? "",
      terbuka: m.tipe === "ebook" ? bab.length > 0 : video !== null,
      jumlahBab: bab.length,
    };
  });
}

export type BabMateri = { id: string; urutan: number; judul: string; isi: string };

export type MateriDetail = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  namaLayanan: string;
  bab: BabMateri[];
  videoUrl: string | null;
};

type BarisMateriDetail = {
  id: string;
  judul: string;
  tipe: TipeMateri;
  deskripsi: string;
  services: { nama: string } | null;
  material_chapters: BabMateri[];
  material_videos: { url: string } | null;
};

export async function ambilMateriDetail(materialId: string): Promise<MateriDetail | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("materials")
    .select(
      "id, judul, tipe, deskripsi, services(nama), material_chapters(id, urutan, judul, isi), material_videos(url)",
    )
    .eq("id", materialId)
    .eq("aktif", true) // reader pun wajib menyaring sendiri
    .returns<BarisMateriDetail[]>()
    .maybeSingle();
  if (!data) return null;

  // Bab yang terkunci tidak dikembalikan RLS sama sekali — array kosong, bukan
  // isi tersensor. Tidak ada yang perlu disaring di sini.
  const bab = [...(data.material_chapters ?? [])].sort((a, b) => a.urutan - b.urutan);

  return {
    id: data.id,
    judul: data.judul,
    tipe: data.tipe,
    deskripsi: data.deskripsi,
    namaLayanan: data.services?.nama ?? "",
    bab,
    videoUrl: data.material_videos?.url ?? null,
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
