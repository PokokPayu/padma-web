import { PESANAN_BERUANG, PESANAN_TERBUKA, type StatusPesanan } from "@/lib/pesanan/status";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import {
  PERMINTAAN_MENUNGGU_BAYAR,
  STATUS_UBAH_PERMINTAAN,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

/**
 * KEADAAN TAGIHAN SATU PENGAJUAN, sebagai KATA — nol rupiah (P3/B5, spec §6.5).
 *
 * Layar `/admin/sesi` tidak pernah menampilkan nominal (money firewall). Yang
 * admin butuhkan adalah tahu DI MANA tagihan itu berada: terbuka, lewat
 * tenggat, ditutup, atau uangnya sudah masuk. Berkas ini menurunkan jawaban itu
 * dari `orders` + keberadaan sesi + kolom warisan `status_bayar`, dan
 * menurunkan DAFTAR TOMBOL dari jawaban yang sama, supaya layar tidak pernah
 * menawarkan tombol yang akan ditolak basis data.
 *
 * MURNI — tanpa impor basis data. Dipakai komponen klien (`aksi-permintaan`)
 * dan halaman server.
 */

export const KODE_KEADAAN_TAGIHAN = [
  /** Pengajuan belum/tidak lagi berstatus menunggu bayar. */
  "tidak_berlaku",
  /** Pesanan terbuka, tenggat belum lewat. */
  "terbuka",
  /** Tenggat pesanan terakhir lewat, belum ada uang. */
  "tenggat_lewat",
  /** `menunggu_bayar` tanpa pesanan terbuka dan tanpa uang: ditutup trigger. */
  "ditutup",
  /** Uang masuk tetapi perlu keputusan staf di /admin/pesanan. */
  "perlu_ditinjau",
  /** Pesanan lunas, sesinya belum lahir (bidan nonaktif, jam lewat, dst.). */
  "tertahan",
  /** Pesanan lunas dan sesi sudah ada. */
  "diterima",
  /** Baris warisan QRIS: lunas, tanpa pesanan. */
  "warisan_lunas",
  /** Baris warisan QRIS: bukti masuk, menunggu verifikasi. */
  "warisan_verifikasi",
  /** Baris warisan QRIS: belum dibayar. */
  "warisan_belum",
] as const;

export type KodeKeadaanTagihan = (typeof KODE_KEADAAN_TAGIHAN)[number];

export type PesananRingkas = {
  id: string;
  kode: string;
  status: StatusPesanan;
  dibuatPada: string;
  kedaluwarsaPada: string;
  butuhTinjauanPada: string | null;
};

export type KeadaanTagihan = {
  kode: KodeKeadaanTagihan;
  /** Satu kalimat untuk admin. Tanpa angka rupiah. */
  kalimat: string;
  /** Kode pesanan yang menentukan keadaan (untuk tautan ke /admin/pesanan). */
  kodePesanan: string | null;
  /** Uang untuk pengajuan ini sudah masuk (lihat Global Constraints P3). */
  uangMasuk: boolean;
};

const UANG_MASUK: readonly KodeKeadaanTagihan[] = [
  "perlu_ditinjau",
  "tertahan",
  "diterima",
  "warisan_lunas",
  "warisan_verifikasi",
];

function bangun(
  kode: KodeKeadaanTagihan,
  kalimat: string,
  kodePesanan: string | null = null,
): KeadaanTagihan {
  return { kode, kalimat, kodePesanan, uangMasuk: UANG_MASUK.includes(kode) };
}

/**
 * @param status status PENGAJUAN (bukan pesanan).
 * @param statusBayar kolom warisan `booking_requests.status_bayar`.
 * @param tenggat `booking_requests.tenggat` — dipakai baris warisan saja.
 */
export function keadaanTagihan(
  input: {
    status: StatusPermintaan;
    statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
    tenggat: string | null;
    pesanan: PesananRingkas[];
    adaSesi: boolean;
  },
  sekarang: Date = new Date(),
): KeadaanTagihan {
  const { status, statusBayar, tenggat, pesanan, adaSesi } = input;

  if (status !== PERMINTAAN_MENUNGGU_BAYAR) {
    return bangun(
      "tidak_berlaku",
      statusBayar === "lunas" || pesanan.some((p) => PESANAN_BERUANG.includes(p.status))
        ? "Pembayaran diterima"
        : "—",
    );
  }

  // Tanpa satu pun pesanan = baris WARISAN QRIS (sebelum DOKU). Setiap
  // penerbitan sejak B2 meninggalkan pesanan, jadi "menunggu_bayar tanpa
  // pesanan" tidak pernah berarti "tagihan ditutup".
  if (pesanan.length === 0) {
    if (statusBayar === "lunas") {
      return bangun("warisan_lunas", "Pembayaran diterima (jalur lama) — konfirmasi jadwal");
    }
    if (statusBayar === "menunggu_verifikasi") {
      return bangun("warisan_verifikasi", "Bukti masuk, menunggu verifikasi di menu Bayar");
    }
    const sisa = labelSisaWaktu(tenggat, sekarang);
    return bangun("warisan_belum", `Belum dibayar (tagihan lama)${sisa ? `, ${sisa}` : ""}`);
  }

  const urut = [...pesanan].sort((a, b) => b.dibuatPada.localeCompare(a.dibuatPada));
  const terbaru = urut[0];

  const lunas = urut.find((p) => p.status === "lunas");
  if (lunas) {
    return adaSesi
      ? bangun("diterima", "Pembayaran diterima", lunas.kode)
      : bangun("tertahan", "Pembayaran diterima — sesi tertahan", lunas.kode);
  }

  const perluTinjau = urut.find(
    (p) => PESANAN_BERUANG.includes(p.status) || p.butuhTinjauanPada !== null,
  );
  if (perluTinjau) {
    return bangun("perlu_ditinjau", "Pembayaran perlu ditinjau", perluTinjau.kode);
  }

  if (PESANAN_TERBUKA.includes(terbaru.status)) {
    if (Date.parse(terbaru.kedaluwarsaPada) <= sekarang.getTime()) {
      return bangun("tenggat_lewat", "Tenggat lewat", terbaru.kode);
    }
    return bangun(
      "terbuka",
      `Menunggu pembayaran, tenggat ${labelSisaWaktu(terbaru.kedaluwarsaPada, sekarang)}`,
      terbaru.kode,
    );
  }

  if (terbaru.status === "kedaluwarsa") {
    return bangun("tenggat_lewat", "Tenggat lewat", terbaru.kode);
  }

  return bangun("ditutup", "Tagihan ditutup — terbitkan ulang", terbaru.kode);
}

export type TombolPengajuan = {
  /** Tautan WhatsApp tagihan. */
  wa: boolean;
  /** "Kirim (ulang) email". */
  email: boolean;
  /** "Terbitkan ulang". */
  terbitUlang: boolean;
  /** "Batalkan pengajuan". */
  batalkan: boolean;
  /** "Ganti bidan" dalam `menunggu_bayar`. */
  gantiBidan: boolean;
  /** "Konfirmasi jadwal" — HANYA baris warisan lunas tanpa pesanan. */
  konfirmasi: boolean;
};

/** Tombol yang pantas ditawarkan untuk SATU keadaan. */
export function tombolUntuk(kode: KodeKeadaanTagihan): TombolPengajuan {
  const tak = {
    wa: false,
    email: false,
    terbitUlang: false,
    batalkan: false,
    gantiBidan: false,
    konfirmasi: false,
  };
  switch (kode) {
    case "terbuka":
      return { ...tak, wa: true, email: true, terbitUlang: true, batalkan: true, gantiBidan: true };
    case "tenggat_lewat":
    case "ditutup":
      return { ...tak, terbitUlang: true, batalkan: true, gantiBidan: true };
    case "warisan_belum":
      // TANPA WA dan email: keduanya berbunyi "Tagihan Anda sudah terbit, bayar
      // di Digital Passport", dan untuk baris warisan QRIS itu tidak benar.
      // Tindakannya (§7) "Terbitkan ulang" — klien baru melihatnya sebagai
      // tagihan DOKU sesudah itu.
      return { ...tak, terbitUlang: true, batalkan: true, gantiBidan: true };
    case "warisan_lunas":
      return { ...tak, konfirmasi: true };
    case "tertahan":
      return { ...tak, gantiBidan: true };
    default:
      return tak;
  }
}

/**
 * Apakah layar boleh menawarkan form ubah jadwal/alamat (dan kalimat "tekan
 * Ganti bidan") untuk pengajuan ini? SATU sumber gerbang yang sama dengan
 * `tombolUntuk`: sebelum tagihan terbit semua boleh; pada `menunggu_bayar`
 * hanya di keadaan yang tidak ditolak basis data (uang warisan sudah masuk,
 * atau pembayaran perlu ditinjau, menolak perubahan masukan harga).
 */
export function bolehUbahJadwal(status: StatusPermintaan, kode: KodeKeadaanTagihan): boolean {
  if (STATUS_UBAH_PERMINTAAN.includes(status)) return true;
  if (status !== PERMINTAAN_MENUNGGU_BAYAR) return false;
  return tombolUntuk(kode).gantiBidan;
}
