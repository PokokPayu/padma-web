import { createServerSupabase } from "@/lib/supabase/server";
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
  client_id: string;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
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
        "jenjang, jenjang_sumber, jadwal_ulang_terpakai, alamat, client_id, " +
        "clients(nama, padma_id), services(nama), partners(nama), " +
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
