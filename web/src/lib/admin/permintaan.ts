import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import {
  STATUS_ANTRE,
  STATUS_PERMINTAAN,
  type StatusPermintaan,
} from "@/lib/jadwal/status";
import type { PreferensiWaktu } from "@/app/admin/sesi/status";

/**
 * Lapisan data daftar PERMINTAAN (tab pertama `/admin/sesi`).
 *
 * Terpisah dari `@/lib/admin/sesi` karena keduanya membaca TABEL yang berbeda
 * untuk OBJEK yang berbeda: rantai terbelah di `dikonfirmasi` — sebelumnya
 * hidup sebuah permintaan, sesudahnya hidup sebuah sesi. Menyatukan keduanya
 * dalam satu modul akan menggoda satu query melayani dua arti.
 *
 * Seluruh bacaan memakai SESI PENGGUNA, bukan service role: policy
 * `booking: staf` yang mengizinkannya, dan di bawah service role `user_role()`
 * memulangkan 'klien' sehingga tidak satu pun pagar ikut diperiksa.
 */

/** Nilai `tab` yang sah — daftar putih untuk parameter lengket. */
export const TAB_SESI = { tab: ["permintaan", "sesi"] } satisfies SaringSah;

/**
 * Dua nilai saringan yang BUKAN status — keduanya nama HIMPUNAN.
 *
 * Ditulis sebagai konstanta bernama, bukan literal di dalam
 * `SARING_PERMINTAAN`, karena "menunggu" pernah menjadi nilai enum
 * `booking_status` dan mati di C1. Literalnya berdampingan dengan kata
 * `status` terbaca — oleh manusia maupun oleh pagar
 * tests/status-satu-sumber.test.ts — sebagai status lama yang bangkit lagi.
 * Namanya menyatakan namespace-nya: ini nilai SARINGAN, dan
 * `statusUntukSaring` di bawah yang menerjemahkannya ke status sungguhan.
 */
export const SARING_MENUNGGU = "menunggu";
export const SARING_RIWAYAT = "riwayat";

/**
 * Saringan status. Dua nilai pertama adalah HIMPUNAN, sisanya satu status
 * persis.
 */
export const SARING_PERMINTAAN = {
  status: [SARING_MENUNGGU, SARING_RIWAYAT, ...STATUS_PERMINTAAN],
} satisfies SaringSah;

/**
 * Himpunan status untuk sebuah nilai saringan.
 *
 * `riwayat` DIHITUNG DENGAN PENGURANGAN, tidak pernah ditulis sebagai daftar
 * tangan. Repo ini sudah membayar akibatnya sekali: nilai enum baru membuat
 * konstanta himpunan tulisan tangan salah diam-diam, tanpa satu galat pun.
 * Ditulis begini, status kesembilan otomatis muncul di riwayat pada hari ia
 * lahir — yang mana memang artinya "bukan lagi menunggu".
 */
export function statusUntukSaring(nilai: string): readonly StatusPermintaan[] {
  if (nilai === SARING_RIWAYAT) {
    return STATUS_PERMINTAAN.filter((s) => !STATUS_ANTRE.includes(s));
  }
  if (nilai === "" || nilai === SARING_MENUNGGU) return STATUS_ANTRE;
  return [nilai as StatusPermintaan];
}

export type BarisPermintaanDaftar = {
  id: string;
  namaKlien: string;
  padmaId: string;
  noHpKlien: string;
  namaLayanan: string;
  /**
   * Label varian — kolomnya bernama `label`, BUKAN `nama` (lihat
   * migration 20260906100000_varian_layanan.sql). Salah menyebutnya membuat
   * PostgREST memulangkan galat 42703 untuk SELURUH query, bukan hanya untuk
   * kolom itu, sehingga daftarnya kosong tanpa satu pun pesan di layar.
   * Varian baku ber-label string kosong, dan itu SAH.
   */
  namaVarian: string | null;
  namaMitra: string | null;
  /** ISO `YYYY-MM-DD` mentah — pemformatannya milik halaman. */
  tanggal: string;
  /** 'HH:MM:SS' apa adanya dari Postgres. */
  jamMulai: string;
  preferensiWaktu: PreferensiWaktu;
  catatan: string;
  alamat: string;
  /** Nullable persis kolomnya: alamat tanpa koordinat bukan galat. */
  alamatLat: number | null;
  alamatLon: number | null;
  status: StatusPermintaan;
  statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  /** Kapan email tagihan terakhir BERHASIL terkirim. `null` = belum pernah. */
  emailTagihanPada: string | null;
};

type BarisMentah = {
  id: string;
  tanggal: string;
  jam_mulai: string;
  preferensi_waktu: PreferensiWaktu;
  catatan: string;
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
  status: StatusPermintaan;
  status_bayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  email_tagihan_pada: string | null;
  clients: { nama: string; padma_id: string; no_hp: string } | null;
  services: { nama: string } | null;
  service_variants: { label: string } | null;
  partners: { nama: string } | null;
};

export async function ambilDaftarPermintaan(
  param: ParamDaftar,
): Promise<{ baris: BarisPermintaanDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  // `clients!inner` karena kata cari menyaring NAMA KLIEN, dan menyaring kolom
  // tabel tertanam menuntut join dalam. Aman: `client_id` NOT NULL sejak skema
  // awal, jadi join dalam tidak membuang satu baris pun.
  let q = supabase
    .from("booking_requests")
    .select(
      "id, tanggal, jam_mulai, preferensi_waktu, catatan, alamat, alamat_lat, alamat_lon, " +
        "status, status_bayar, tenggat, email_tagihan_pada, " +
        "clients!inner ( nama, padma_id, no_hp ), services ( nama ), " +
        "service_variants ( label ), partners ( nama )",
      { count: "exact" },
    )
    // Disalin ke array biasa: `.in()` menolak `readonly string[]`.
    .in("status", [...statusUntukSaring(param.saring.status ?? "")])
    // Yang paling dekat tanggalnya paling mendesak dijawab.
    .order("tanggal", { ascending: true })
    .order("created_at", { ascending: true });

  if (param.cari !== "") {
    // `%` dan `_` yang diketik manusia dicari sebagai HURUF, bukan wildcard.
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("clients.nama", `%${aman}%`);
  }

  // GALAT DIBACA, BUKAN DIBUANG. Query yang ditolak PostgREST memulangkan
  // `data: null`, dan `data ?? []` mengubahnya menjadi layar kosong yang
  // tidak bisa dibedakan dari "memang belum ada permintaan hari ini". Persis
  // itu yang terjadi saat embed `service_variants` menyebutkan kolom yang salah:
  // 42703 menolak SELURUH query, dan tab bawaan panel ini akan kosong bagi
  // setiap admin tanpa satu pun tanda. Layar 500 yang berisik lebih jujur
  // daripada daftar kosong yang berbohong.
  const { data, count, error } = await q.range(dari, sampai).returns<BarisMentah[]>();
  if (error) throw error;

  return {
    baris: (data ?? []).map((p) => ({
      id: p.id,
      // Embed yang tertahan RLS pulang sebagai NULL, bukan galat — jadi setiap
      // nama tertanam punya jalan mundur yang terbaca manusia. Tanpa itu,
      // policy yang salah muncul di layar sebagai "undefined".
      namaKlien: p.clients?.nama ?? "Klien",
      padmaId: p.clients?.padma_id ?? "",
      noHpKlien: p.clients?.no_hp ?? "",
      namaLayanan: p.services?.nama ?? "Layanan",
      namaVarian: p.service_variants?.label ?? null,
      namaMitra: p.partners?.nama ?? null,
      tanggal: p.tanggal,
      jamMulai: p.jam_mulai,
      preferensiWaktu: p.preferensi_waktu,
      catatan: p.catatan,
      alamat: p.alamat,
      alamatLat: p.alamat_lat,
      alamatLon: p.alamat_lon,
      status: p.status,
      statusBayar: p.status_bayar,
      tenggat: p.tenggat,
      emailTagihanPada: p.email_tagihan_pada,
    })),
    total: count ?? 0,
  };
}
