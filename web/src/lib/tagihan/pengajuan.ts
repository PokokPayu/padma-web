import { tarifPadaTanggal } from "@/lib/owner/rekap";
import { tarifTransportPadaTanggal } from "@/lib/transport/tarif";
import type { JenjangTransport } from "@/lib/transport/jarak";

/**
 * TAGIHAN PENGAJUAN — DITURUNKAN, TIDAK DISIMPAN (spec C2 P2).
 *
 * Tidak ada kolom `total_tagihan` di mana pun, dan itu dua keputusan sekaligus:
 *
 *  1. **Money firewall.** Kolom nominal uang hanya boleh hidup di
 *     `variant_rates`, `honor_marks`, `transport_rates`, dan
 *     `transport_khusus`. `tests/money-firewall-struktural.test.ts` memindai
 *     SELURUH skema — termasuk tabel yang belum lahir — jadi menyimpan nominal
 *     di `booking_requests` akan merah, dan itu benar.
 *
 *  2. **Nominal turunan yang disimpan hanya menambah tempat untuk berselisih.**
 *     Begitu ada dua sumber untuk satu angka, salah satunya pasti salah suatu
 *     hari, dan tidak ada yang tahu yang mana.
 *
 * Konsekuensi yang DIINGINKAN: tarif dibaca menurut TANGGAL SESI, jadi
 * menaikkan tarif hari ini tidak menggeser satu pun tagihan yang sudah terbit.
 * Aturan yang sama sudah berlaku untuk honor mitra di rekap owner.
 *
 * Fungsi di berkas ini MURNI. Pembacaan barisnya milik pemanggil — halaman
 * server membacanya dengan sesi pengguna supaya RLS ikut memutuskan.
 */

export type BarisTarif = {
  variantId: string;
  hargaKlien: number;
  berlakuSejak: string;
};

export type BarisTarifTransport = {
  jenjang: JenjangTransport;
  tarifKlien: number;
  berlakuSejak: string;
};

export type RincianTagihan = {
  /** Harga layanan menurut varian & tanggal sesi. `null` = tarifnya belum ada. */
  layanan: number | null;
  /**
   * Tarif transport menurut jenjang & tanggal sesi.
   * `null` berarti dua hal berbeda, dan pemanggil WAJIB membedakannya lewat
   * `menungguTarifKhusus` di bawah.
   */
  transport: number | null;
  /**
   * Jenjang `di_atas_20` sengaja TIDAK punya tarif rate card: nominalnya
   * ditetapkan owner per kasus di `transport_khusus` ("konfirmasi admin"
   * berarti ketiadaan tarif). Tagihan untuk sesi seperti itu BELUM bisa
   * terbit — dan menampilkannya sebagai Rp0 adalah kebohongan yang membuat
   * klien membayar kurang lalu ditagih lagi.
   */
  menungguTarifKhusus: boolean;
  /** Total yang harus dibayar. `null` bila salah satu bagiannya belum diketahui. */
  total: number | null;
};

/**
 * Menghitung rincian tagihan satu pengajuan.
 *
 * `jenjang` NULL berarti jaraknya belum pernah diketahui — koordinat mitra atau
 * alamat klien belum lengkap. Itu BUKAN transport gratis: tagihannya belum
 * lengkap, dan admin menetapkan jenjangnya lebih dulu.
 */
export function hitungTagihanPengajuan(input: {
  variantId: string;
  /** Tanggal SESI, bukan tanggal hari ini — itulah yang mengunci tarifnya. */
  tanggal: string;
  jenjang: JenjangTransport | null;
  /** Nominal >20 km yang sudah ditetapkan owner untuk pengajuan ini, bila ada. */
  transportKhusus?: number | null;
  tarif: readonly BarisTarif[];
  tarifTransport: readonly BarisTarifTransport[];
}): RincianTagihan {
  const { variantId, tanggal, jenjang, transportKhusus = null } = input;

  const barisTarif = tarifPadaTanggal(
    // `honorMitra` & `hargaCoret` diisi nilai netral: keduanya bagian bentuk
    // `TarifRingkas` tetapi tidak menyentuh perhitungan tagihan KLIEN sama
    // sekali. Honor mitra khususnya TIDAK BOLEH ikut dibaca di sini — ia tidak
    // pernah keluar dari `variant_rates`, dan lapisan yang dilihat klien bukan
    // tempatnya lewat.
    input.tarif.map((t) => ({
      id: "",
      variantId: t.variantId,
      hargaKlien: t.hargaKlien,
      hargaCoret: null,
      honorMitra: 0,
      berlakuSejak: t.berlakuSejak,
    })),
    variantId,
    tanggal,
  );
  const layanan = barisTarif?.hargaKlien ?? null;

  // Jenjang belum diketahui: tagihan belum lengkap, dan itu bukan Rp0.
  if (jenjang === null) {
    return { layanan, transport: null, menungguTarifKhusus: false, total: null };
  }

  if (jenjang === "di_atas_20") {
    // Nominalnya milik owner per kasus. Bila sudah ditetapkan, ia dipakai apa
    // adanya; bila belum, tagihan menunggu — bukan nol.
    if (transportKhusus === null) {
      return { layanan, transport: null, menungguTarifKhusus: true, total: null };
    }
    return {
      layanan,
      transport: transportKhusus,
      menungguTarifKhusus: false,
      total: layanan === null ? null : layanan + transportKhusus,
    };
  }

  const barisTransport = tarifTransportPadaTanggal(
    input.tarifTransport.map((t) => ({
      id: "",
      jenjang: t.jenjang,
      tarifKlien: t.tarifKlien,
      honorMitra: 0,
      berlakuSejak: t.berlakuSejak,
    })),
    jenjang,
    tanggal,
  );
  const transport = barisTransport?.tarifKlien ?? null;

  return {
    layanan,
    transport,
    menungguTarifKhusus: false,
    total: layanan === null || transport === null ? null : layanan + transport,
  };
}
