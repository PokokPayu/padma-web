import { createServerSupabase } from "@/lib/supabase/server";
import type { StatusPesanan } from "@/lib/pesanan/status";
import type { StatusPermintaan } from "@/lib/jadwal/status";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";

/**
 * MEMBACA TAGIHAN SESI MILIK KLIEN (P3/B6, spec §6.3, §7 sisi klien).
 *
 * ===== SATU RPC, SESI PEMANGGIL, NOL SERVICE ROLE =====
 * Tagihan sesi kini PESANAN berharga beku (`terbitkan_tagihan_sesi`, B2).
 * Yang dibaca klien adalah angka yang sama persis dengan yang ditagihkan DOKU
 * — `order_items.harga_beku` — bukan rumus tarif hari ini. `order_items` tidak
 * punya grant bagi `authenticated`, jadi bacaannya lewat RPC security definer
 * `tagihan_sesi_saya` yang memilih baris dari `auth.uid()`.
 *
 * Pembaca versi C2 menghitung ulang tagihan di TypeScript dari tarif yang
 * dibaca service role. Dua cacatnya hilang bersama pendekatan itu: angka di
 * layar bisa berbeda dari angka yang ditagih, dan halaman klien memegang
 * kunci service role untuk membaca `transport_rates` dan `partners`.
 *
 * Halaman detail, daftar, DAN rute bayar membaca RPC yang sama dan
 * menurunkan keadaannya lewat `keadaanTagihanKlien` yang sama. Tombol Bayar
 * tampil tepat ketika rute bayar menerimanya.
 *
 * Nominal memang sampai ke layar klien: ini tagihan miliknya sendiri, di
 * Passport miliknya sendiri (spec §6.7). Yang tidak pernah berubah: honor
 * mitra tidak pernah keluar dari `variant_rates`.
 */

export type ItemTagihan = { judul: string; harga: number };

export type TagihanPengajuan = {
  permintaanId: string;
  namaLayanan: string;
  tanggal: string;
  jamMulai: string;
  statusPermintaan: StatusPermintaan;
  /** Kolom warisan `booking_requests.status_bayar` (§7). */
  statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
  /** Pesanan TERBARU pengajuan ini; `null` untuk baris warisan QRIS. */
  pesananId: string | null;
  kode: string | null;
  statusPesanan: StatusPesanan | null;
  kedaluwarsaPada: string | null;
  butuhTinjauan: boolean;
  /** `uang_sudah_masuk_permintaan` — predikat tunggal (Ruling 1). */
  uangSudahMasuk: boolean;
  /** Pesanan terbuka dan tautannya dicatat dalam 30 menit terakhir. */
  tautanBaru: boolean;
  sesiId: string | null;
  /** Angka beku, urut sesuai `order_items.urutan`. Kosong untuk baris warisan. */
  items: ItemTagihan[];
  /** Jumlah `items`; `null` bila tidak ada pesanan. */
  total: number | null;
};

type BarisRpc = {
  permintaan_id: string;
  nama_layanan: string;
  tanggal: string;
  jam_mulai: string;
  status_permintaan: StatusPermintaan;
  status_bayar: TagihanPengajuan["statusBayar"];
  pesanan_id: string | null;
  kode: string | null;
  status_pesanan: StatusPesanan | null;
  kedaluwarsa_pada: string | null;
  butuh_tinjauan: boolean;
  uang_sudah_masuk: boolean;
  tautan_baru: boolean;
  sesi_id: string | null;
  items: ItemTagihan[] | null;
};

function bentuk(b: BarisRpc): TagihanPengajuan {
  const items = b.items ?? [];
  return {
    permintaanId: b.permintaan_id,
    namaLayanan: b.nama_layanan,
    tanggal: b.tanggal,
    jamMulai: b.jam_mulai,
    statusPermintaan: b.status_permintaan,
    statusBayar: b.status_bayar,
    pesananId: b.pesanan_id,
    kode: b.kode,
    statusPesanan: b.status_pesanan,
    kedaluwarsaPada: b.kedaluwarsa_pada,
    butuhTinjauan: b.butuh_tinjauan,
    uangSudahMasuk: b.uang_sudah_masuk,
    tautanBaru: b.tautan_baru,
    sesiId: b.sesi_id,
    items,
    total: b.pesanan_id === null ? null : items.reduce((s, i) => s + i.harga, 0),
  };
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Seluruh tagihan sesi milik pemanggil.
 *
 * GALAT DIBACA, BUKAN DIBUANG (Ruling 26): `data ?? []` akan mengubah
 * kegagalan PostgREST menjadi "tidak ada tagihan", dan klien yang tenggatnya
 * berjalan melihat halaman bersih. Layar galat lebih jujur.
 */
export async function ambilTagihanPengajuan(): Promise<TagihanPengajuan[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("tagihan_sesi_saya");
  if (error) throw error;
  return ((data ?? []) as BarisRpc[]).map(bentuk);
}

/**
 * SATU tagihan milik pemanggil — untuk `/passport/bayar/[id]` dan rute bayar.
 * RPC yang sama dengan daftar, dengan saringan id; bukan kueri kedua.
 *
 * `null` berarti tidak ada, bukan miliknya, atau tidak lagi ditagihkan —
 * ketiganya berakhir sama di pemanggil, supaya keberadaan tagihan orang lain
 * tidak bocor. Id yang bukan uuid juga `null`: tanpa saringan ini PostgREST
 * menjawab 22P02 dan halaman jatuh ke layar galat.
 */
export async function ambilTagihanPengajuanSatu(
  permintaanId: string,
): Promise<TagihanPengajuan | null> {
  if (!POLA_UUID.test(permintaanId)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("tagihan_sesi_saya", {
    p_permintaan_id: permintaanId,
  });
  if (error) throw error;
  const baris = ((data ?? []) as BarisRpc[])[0];
  return baris ? bentuk(baris) : null;
}

/**
 * Keadaan tagihan dari sudut pandang KLIEN (tabel spec §6.3 dan §7).
 *
 * Dinamai `…Klien` dengan sengaja: `keadaanTagihan`/`KeadaanTagihan` di
 * `@/lib/tagihan/keadaan` adalah keadaan untuk STAF (`/admin/sesi`, tanpa
 * rupiah, dengan daftar tombol staf). Keduanya membaca fakta yang sama tetapi
 * menjawab pertanyaan berbeda.
 */
export type KeadaanTagihanKlien =
  | "bayar"
  | "diproses"
  | "lunas_sesi"
  | "lunas_tertahan"
  | "diperiksa"
  | "kedaluwarsa"
  | "warisan_dialihkan"
  | "warisan_bukti"
  | "warisan_lunas";

/** Keadaan yang menawarkan tombol Bayar, dan yang diterima rute bayar. */
export const KEADAAN_BISA_DIBAYAR: readonly KeadaanTagihanKlien[] = ["bayar", "diproses"];

/**
 * Fungsi MURNI. Urutan pemeriksaannya mengikat:
 *
 *   1. Tanpa pesanan = baris warisan QRIS (§7), dibedakan `status_bayar`.
 *   2. Pesanan terkini `lunas` — sesi lahir atau tertahan. Didahulukan atas
 *      tinjauan, karena penyalur menandai sesi tertahan sebagai tinjauan
 *      (`sesi_tertahan`) dan kalimat klien untuknya "jadwal sedang disiapkan".
 *   3. `ditahan`, tinjauan, ATAU uang sudah masuk (mis. di pesanan lama yang
 *      sudah ditutup) → diperiksa admin, tanpa tombol (§6.5). Diperiksa
 *      SEBELUM "pesanan terbuka", supaya klien yang uangnya sudah masuk tidak
 *      pernah disodori tagihan kedua.
 *   4. Pesanan terbuka: tenggat lewat → kedaluwarsa; tautan baru → diproses;
 *      selain itu bayar.
 *   5. Pesanan `kedaluwarsa` → kedaluwarsa.
 *   6. Pesanan terkini `dibatalkan` tanpa uang: tagihan ditutup karena masukan
 *      harganya berubah (bidan, jadwal, titik), dan admin wajib menerbitkan
 *      ulang (B4/B5). Kalimat yang benar untuk klien persis kalimat baris
 *      warisan `belum`: tagihannya dialihkan ke pembayaran baru yang akan
 *      dikirim admin. Karena itu ia memakai keadaan yang sama.
 */
export function keadaanTagihanKlien(
  t: TagihanPengajuan,
  sekarang: Date = new Date(),
): KeadaanTagihanKlien {
  if (t.pesananId === null || t.statusPesanan === null) {
    if (t.statusBayar === "lunas") return "warisan_lunas";
    if (t.statusBayar === "menunggu_verifikasi") return "warisan_bukti";
    return "warisan_dialihkan";
  }

  if (t.statusPesanan === "lunas") return t.sesiId ? "lunas_sesi" : "lunas_tertahan";

  if (t.statusPesanan === "ditahan" || t.butuhTinjauan || t.uangSudahMasuk) return "diperiksa";

  if (t.statusPesanan === "menunggu_bayar") {
    const tenggat = t.kedaluwarsaPada === null ? Number.NaN : Date.parse(t.kedaluwarsaPada);
    // Cap waktu yang tidak terurai tidak pernah dianggap masih bisa dibayar.
    if (!Number.isFinite(tenggat) || tenggat <= sekarang.getTime()) return "kedaluwarsa";
    return t.tautanBaru ? "diproses" : "bayar";
  }

  if (t.statusPesanan === "kedaluwarsa") return "kedaluwarsa";

  return "warisan_dialihkan";
}

/**
 * Satu kalimat per keadaan, untuk daftar, halaman detail, dan jawaban 409 rute
 * bayar. Kalimat §6.3/§7 ditulis verbatim.
 */
export const KALIMAT_KEADAAN_KLIEN: Record<KeadaanTagihanKlien, string> = {
  bayar: "Menunggu pembayaran.",
  diproses: "Pembayaran sedang diproses.",
  lunas_sesi: "Lunas.",
  lunas_tertahan: "Pembayaran diterima, jadwal sedang disiapkan admin.",
  diperiksa: "Pembayaran sedang diperiksa admin.",
  kedaluwarsa: "Tagihan kedaluwarsa. Admin akan menghubungi Anda.",
  warisan_dialihkan:
    "Tagihan Anda sedang dialihkan ke pembayaran baru; admin akan mengirimkannya.",
  warisan_bukti: "Bukti Anda sedang diperiksa admin.",
  warisan_lunas: "Pembayaran terverifikasi — jadwal Anda sedang dikunci tim.",
};

/** "Bayar dalam 5 jam lagi" — `null` bila tidak ada tenggat yang berjalan. */
export function kalimatSisaWaktu(t: TagihanPengajuan, sekarang: Date = new Date()): string | null {
  if (t.kedaluwarsaPada === null) return null;
  const sisa = labelSisaWaktu(t.kedaluwarsaPada, sekarang);
  return sisa === "" || sisa === "sudah lewat" ? null : `Bayar dalam ${sisa}`;
}
