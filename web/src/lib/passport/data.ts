import { cache } from "react";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { createServerSupabase } from "@/lib/supabase/server";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import type { FormatVarian } from "@/lib/varian";
import type { JenjangTransport } from "@/lib/transport/jarak";
import { saringDaftarMateri } from "./materi-tampil";
import type { PaketRingkas, PayStatus, SesiRingkas, StatusSesi } from "./turunan";
import { STATUS_ANTRE } from "@/lib/jadwal/status";

export type KlienPassport = {
  id: string;
  padmaId: string;
  nama: string;
  email: string;
  noHp: string;
  // Alamat rumah: bahan pengisi otomatis formulir pengajuan jadwal DAN medan
  // yang boleh disunting klien sendiri di /passport/profil. Koordinatnya
  // sengaja TIDAK ikut — layar klien tidak pernah memerlukannya, dan yang
  // tidak dikirim tidak bisa bocor.
  alamat: string;
  // Ketiganya boleh KOSONG, dan kosongnya berarti "belum ditentukan" — bukan
  // data hilang. Baris klien yang lahir dari pendaftaran mandiri belum punya
  // fase karena fase datang dari skrining pertama yang tersambung (migration
  // `fase_klien_boleh_kosong`). `faseId` dibuat `string | null` supaya
  // kompilator memaksa setiap layar memutuskan apa yang ditampilkannya;
  // `faseNama`/`faseSanskrit` tetap string karena embed-nya sudah diratakan
  // ke "" di bawah — yang menandakan kosong adalah `faseId`.
  faseId: string | null;
  faseNama: string;
  faseSanskrit: string;
};

type BarisKlien = {
  id: string;
  padma_id: string;
  nama: string;
  email: string;
  no_hp: string;
  alamat: string;
  // Nullable sejak migration `fase_klien_boleh_kosong`: klien yang mendaftar
  // sendiri belum punya fase sampai skrining pertamanya tersambung.
  phase_id: string | null;
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
    .select("id, padma_id, nama, email, no_hp, alamat, phase_id, phases(nama, nama_sanskrit)")
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
    alamat: data.alamat,
    faseId: data.phase_id,
    faseNama: data.phases?.nama ?? "",
    faseSanskrit: data.phases?.nama_sanskrit ?? "",
  };
});

type BarisSesi = {
  id: string;
  tanggal: string;
  jam_mulai: string;
  status: StatusSesi;
  catatan: string | null;
  rekomendasi: string | null;
  status_bayar: PayStatus;
  client_package_id: string | null;
  service_id: string;
  variant_id: string;
  partner_id: string;
  jenjang: JenjangTransport | null;
  services: { nama: string } | null;
};

type BarisMitra = { id: string; nama: string };

type BarisVarianSesi = {
  id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
};

// Varian baku (label kosong, durasi & format NULL) — jatuh-tempo bila
// `variant_id` sesi entah kenapa tidak ditemukan di katalog varian (tidak
// pernah terjadi lewat jalur tulis manapun sejak `service_variants` melarang
// DELETE, tetapi `labelVarian()` tetap butuh sesuatu untuk dipanggil).
const VARIAN_BAKU = { label: "", durasiMenit: null, format: null } as const;

export async function ambilSesi(clientId: string): Promise<SesiRingkas[]> {
  const supabase = await createServerSupabase();

  // TIGA QUERY, digabung di JS — sengaja TIDAK memakai embed PostgREST ke
  // view nama mitra maupun ke `service_variants`. Embed ke sebuah VIEW
  // bergantung pada inferensi relasi yang tidak dijamin, dan kegagalannya
  // SENYAP (nama bidan jadi null, atau dengan `!inner` seluruh riwayat kosong
  // tanpa error). `service_variants` pun tidak bisa di-embed langsung dari
  // `sessions`: FK-nya gabungan (service_id, variant_id), dan PostgREST butuh
  // hint constraint untuk embed semacam itu — pola yang sama dipakai
  // `daftarTagihanAdmin()` (`@/lib/admin/tagihan`). Query terpisah selalu
  // bekerja.
  const [{ data: sesi }, { data: mitra }, { data: varian }] = await Promise.all([
    supabase
      .from("sessions")
      .select(
        "id, tanggal, jam_mulai, status, catatan, rekomendasi, status_bayar, client_package_id, service_id, variant_id, partner_id, jenjang, services(nama)",
      )
      .eq("client_id", clientId) // eksplisit, walau RLS sudah menyaring
      // `tanggal` bertipe date dan sudah berupa string YYYY-MM-DD: urutannya
      // diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
      .order("tanggal", { ascending: false })
      .returns<BarisSesi[]>(),
    supabase.from("partner_publik").select("id, nama").returns<BarisMitra[]>(),
    // Katalog varian saja — RLS "service_variants: baca terautentikasi"
    // menjawab TRUE untuk siapa pun yang login, jadi baris ini tetap ada bagi
    // klien walau variannya sendiri sudah dinonaktifkan admin sesudahnya.
    supabase
      .from("service_variants")
      .select("id, label, durasi_menit, format")
      .returns<BarisVarianSesi[]>(),
  ]);

  const namaMitraPer = new Map((mitra ?? []).map((m) => [m.id, m.nama]));
  const varianPerId = new Map((varian ?? []).map((v) => [v.id, v] as const));

  return (sesi ?? []).map((r) => {
    const v = varianPerId.get(r.variant_id);
    return {
      id: r.id,
      serviceId: r.service_id,
      namaLayanan: r.services?.nama ?? "Layanan",
      namaMitra: namaMitraPer.get(r.partner_id) ?? "Tim PADMA",
      tanggal: r.tanggal,
      jamMulai: r.jam_mulai,
      status: r.status,
      clientPackageId: r.client_package_id,
      catatan: r.catatan ?? "",
      rekomendasi: r.rekomendasi ?? "",
      statusBayar: r.status_bayar,
      jenjang: r.jenjang,
      varian: v
        ? { label: v.label, durasiMenit: v.durasi_menit, format: v.format }
        : VARIAN_BAKU,
    };
  });
}

type BarisPaket = {
  id: string;
  status: string;
  status_bayar: PayStatus;
  packages: { nama: string; jumlah_sesi: number } | null;
};

export async function ambilPaket(clientId: string): Promise<PaketRingkas[]> {
  // GERBANG SAKLAR (K11). Dipasang di batas data, bukan di tiap tempat render:
  // kedua pemanggilnya — beranda Passport dan halaman Bayar klien — adalah
  // jalur TAMPILAN, dan keduanya sudah punya cabang "klien tanpa paket" yang
  // benar. Beranda jatuh ke kartu "Perjalanan Anda" (page.tsx), tagihan hanya
  // berisi sesi lepas. Menggerbang di sini menghemat dua belas suntingan
  // tampilan dan menutup jalur yang mungkin ditambahkan kemudian.
  if (!PAKET_TAMPIL) return [];

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
  // lagi: ia menyebut nama constraint FK `materials.service_id`, dan Task 11
  // menghapus kolom itu beserta constraint-nya — hint yang menyebut FK yang
  // sudah tak ada akan mematahkan query ini. Membaca nama layanan lewat
  // `material_services` (id layanan diambil sebagai array, namanya digabung
  // di JS) menghindari ambiguitas itu sekaligus tetap tidak bergantung pada
  // embed ke view.
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
  /** Kunci objek R2 (`material_videos.objek`) atau `null` — BUKAN URL; lihat
   *  presigned GET yang diterbitkan `/api/materi/[id]/video` sesudah RLS
   *  meloloskan baris ini. */
  objekVideo: string | null;
  /**
   * Dari RPC `berhak_isi_materi` (security definer) — SATU sumber kebenaran
   * yang sama dipakai policy RLS `material_pages`/`material_videos`. Tanpa
   * ini, "tidak berhak" dan "berhak tapi isinya
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
  material_videos: { objek: string } | null;
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
        "id, judul, tipe, deskripsi, material_pages(halaman, lebar, tinggi), material_videos(objek), material_services(service_id)",
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
    objekVideo: data.material_videos?.objek ?? null,
    berhak: berhak === true,
  };
}

export type PermintaanRingkas = {
  id: string;
  namaLayanan: string;
  tanggal: string;
  /** 'HH:MM:SS' apa adanya dari Postgres — dipendekkan `jamDariDb()`. */
  jamMulai: string;
  preferensiWaktu: string;
  status: string;
};

type BarisPermintaan = {
  id: string;
  tanggal: string;
  jam_mulai: string;
  preferensi_waktu: string;
  status: string;
  services: { nama: string } | null;
};

export async function ambilPermintaanJadwal(clientId: string): Promise<PermintaanRingkas[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("booking_requests")
    .select("id, tanggal, jam_mulai, preferensi_waktu, status, services(nama)")
    .eq("client_id", clientId)
    .in("status", STATUS_ANTRE)
    .order("tanggal")
    .returns<BarisPermintaan[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    namaLayanan: r.services?.nama ?? "Layanan",
    tanggal: r.tanggal,
    jamMulai: r.jam_mulai,
    preferensiWaktu: r.preferensi_waktu,
    status: r.status,
  }));
}
