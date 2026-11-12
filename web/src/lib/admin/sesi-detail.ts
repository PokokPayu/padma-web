import { createServerSupabase } from "@/lib/supabase/server";
import { jarakUntukSesi, koordinat } from "@/lib/transport/saran";
import type { BarisSesiDaftar } from "@/lib/admin/sesi";
import type { JenjangTransport } from "@/lib/transport/jarak";
import type { StatusSesi } from "@/app/admin/sesi/status";

/**
 * Lapisan data SATU sesi, untuk halaman `/admin/sesi/[id]`.
 *
 * Sesi pengguna (`createServerSupabase`), BUKAN service role — sama seperti
 * `ambilDaftarSesi`, tetapi di sini taruhannya lebih besar: halaman ini menarik
 * satu baris menurut id yang datang dari URL. Di bawah service role, id yang
 * ditebak seseorang memulangkan riwayat perawatan klien mana pun. Yang
 * mengizinkan bacaan ini adalah policy `sessions: staf` dan `screenings: staf`.
 *
 * NOL NOMINAL, sama seperti seluruh modul sesi: jenjang transport adalah data
 * LOGISTIK ("5–10 km"), rupiahnya tidak pernah menyeberang ke sini.
 */

/**
 * Skrining yang menopang sesi ini — hasil dua lompatan:
 * `sessions.booking_request_id` → `booking_requests.screening_id` →
 * `screenings`.
 */
export type SkriningPenopang = {
  id: string;
  kode: string;
  hasil: "hijau" | "merah";
  /** `created_at` mentah dari Postgres — pemformatannya milik halaman. */
  dibuatPada: string;
  /**
   * Jawaban "Ya" yang berbendera. Kosong berarti seluruh pertanyaan dijawab
   * "Tidak" — keadaan yang SAH dan berbeda artinya dari `skrining: null`.
   */
  flags: { id: string; level: string; teks: string }[];
};

export type DetailSesi = BarisSesiDaftar & {
  klienId: string;
  alamat: string;
  /**
   * Jarak GARIS LURUS mitra ke alamat sesi, dalam km — atau `null` bila salah
   * satu titiknya tidak ada (butir 2, umpan balik klien 21 Sep 2026).
   *
   * `null`, TIDAK PERNAH nol. Nol adalah jarak yang sah — mitra yang tinggal
   * di alamat yang sama — dan memakainya sebagai "tidak tahu" akan membuat
   * setiap sesi tanpa titik terbaca sebagai sesi paling dekat, yang berarti
   * jenjang transport termurah dan honor mitra terkecil.
   *
   * KENAPA ANGKA INI DITAMPILKAN. Klien melaporkan "jarak mitra - klien masih
   * 1-5 km semua". Diukur di basis data produksi 22 Sep 2026, jaraknya memang
   * 0,75 / 1,84 / 2,16 / 4,56 / 4,72 km — seluruh mitra terdaftar berada dalam
   * radius 7 km satu sama lain di Malang kota, jadi hitungannya BENAR. Yang
   * tidak ada adalah angkanya di layar: yang terlihat hanya label jenjang yang
   * sama berulang-ulang, dan label yang selalu sama tidak bisa dibedakan dari
   * nilai bawaan yang macet. Menampilkan km mentah mengembalikan bedanya.
   */
  jarakKm: number | null;
  /**
   * Titik mana yang dipakai `jarakKm` — alamat sesi ini sendiri, atau alamat
   * DEFAULT kliennya. Dibawa sampai ke layar karena keduanya bisa berbeda, dan
   * admin yang membaca "6,0 km" berhak tahu 6,0 km dari alamat yang mana.
   */
  jarakDari: "sesi" | "klien" | null;
  /**
   * Jenjang yang DISIRATKAN `jarakKm` — sengaja terpisah dari `jenjang` yang
   * TERSIMPAN, dan sengaja tidak menimpanya.
   *
   * Keduanya bisa berbeda dengan sah: jenjang tersimpan dibekukan saat sesi
   * dijadwalkan, sementara koordinat bisa berubah sesudahnya. Bisa juga
   * berbeda karena `jadwalkanSesi` menghitungnya dari alamat DEFAULT klien
   * sementara sesi punya alamatnya sendiri. Apa pun sebabnya, selisihnya
   * adalah selisih UANG — dan satu-satunya perlakuan jujur adalah
   * menampilkan keduanya, lalu membiarkan admin yang memutuskan.
   */
  jenjangHitung: JenjangTransport | null;
  /**
   * `null` berarti sesi ini tidak lahir dari pengajuan — dijadwalkan admin
   * langsung, sehingga memang tidak ada skrining yang menopangnya. Bukan
   * penanda kegagalan membaca.
   */
  skrining: SkriningPenopang | null;
};

type BarisDb = {
  id: string;
  tanggal: string;
  jam_mulai: string;
  status: StatusSesi;
  catatan: string;
  rekomendasi: string;
  client_package_id: string | null;
  jenjang: JenjangTransport | null;
  jenjang_sumber: "otomatis" | "admin" | null;
  jadwal_ulang_terpakai: boolean;
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
  client_id: string;
  clients: { nama: string; padma_id: string; alamat_lat: number | null; alamat_lon: number | null } | null;
  services: { nama: string } | null;
  partners: { nama: string; lat: number | null; lon: number | null } | null;
  booking_requests: {
    screenings: {
      id: string;
      kode: string;
      hasil: "hijau" | "merah";
      created_at: string;
      flags: { id: string; level: string; teks: string }[];
    } | null;
  } | null;
};

export async function ambilDetailSesi(id: string): Promise<DetailSesi | null> {
  const supabase = await createServerSupabase();

  // Operator SETARA, tidak pernah pola: operator pola akan membuat id berisi
  // `%` cocok dengan baris sesi mana pun.
  const { data } = await supabase
    .from("sessions")
    .select(
      "id, tanggal, jam_mulai, status, catatan, rekomendasi, client_package_id, " +
        "jenjang, jenjang_sumber, jadwal_ulang_terpakai, alamat, alamat_lat, alamat_lon, client_id, " +
        "clients(nama, padma_id, alamat_lat, alamat_lon), services(nama), " +
        "partners(nama, lat, lon), " +
        "booking_requests(screenings(id, kode, hasil, created_at, flags))",
    )
    .eq("id", id)
    .maybeSingle<BarisDb>();

  if (!data) return null;

  const s = data.booking_requests?.screenings ?? null;

  return {
    id: data.id,
    klienId: data.client_id,
    namaKlien: data.clients?.nama ?? "Klien",
    padmaId: data.clients?.padma_id ?? "—",
    namaLayanan: data.services?.nama ?? "Layanan",
    // Mitra dibaca dari tabel `partners` (hak staf), BUKAN dari view
    // `partner_publik` — alasan yang sama persis seperti di `ambilDaftarSesi`.
    namaMitra: data.partners?.nama ?? "Tim PADMA",
    tanggal: data.tanggal,
    jamMulai: data.jam_mulai,
    status: data.status,
    dalamPaket: data.client_package_id !== null,
    catatan: data.catatan,
    rekomendasi: data.rekomendasi,
    jenjang: data.jenjang,
    jenjangSumber: data.jenjang_sumber,
    jadwalUlangTerpakai: data.jadwal_ulang_terpakai,
    alamat: data.alamat,
    ...jarakUntukSesi({
      mitra: koordinat(data.partners?.lat, data.partners?.lon),
      alamatSesi: koordinat(data.alamat_lat, data.alamat_lon),
      alamatKlien: koordinat(data.clients?.alamat_lat, data.clients?.alamat_lon),
    }),
    skrining: s
      ? {
          id: s.id,
          kode: s.kode,
          hasil: s.hasil,
          dibuatPada: s.created_at,
          // `flags` adalah jsonb: baris lama bisa memulangkan apa pun, dan
          // `.map` atas non-array melempar di tengah render halaman.
          flags: Array.isArray(s.flags) ? s.flags : [],
        }
      : null,
  };
}
