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
 * `di_atas_20` PUNYA tarif dasar sejak migrasi `tarif_dasar_di_atas_20`, dan
 * `transport_khusus` menimpanya per kasus. Urutan itu hidup di SATU cabang di
 * bawah — jangan menuliskannya kedua kali di lapisan baca.
 *
 * Fungsi di berkas ini MURNI. Pembacaan barisnya milik pemanggil — halaman
 * server membacanya dengan sesi pengguna supaya RLS ikut memutuskan.
 */

/**
 * KENAPA sebuah tagihan belum lengkap — sebagai nilai bertipe, bukan kalimat.
 *
 * Sebab dipisahkan dari kalimatnya karena satu sebab dibaca DUA orang dengan
 * kebutuhan berbeda: admin perlu tahu layar mana yang memperbaikinya, klien
 * perlu tahu apakah ia harus melakukan sesuatu (ia tidak). Menyimpan kalimatnya
 * saja berarti kalimat admin bocor ke layar klien, atau dua sumber kebenaran
 * lahir untuk keadaan yang sama.
 *
 * `mitra_tanpa_titik` dan `alamat_tanpa_pin` TIDAK bisa dibedakan fungsi murni
 * ini — keduanya sampai ke sini sebagai `jenjang === null` yang identik.
 * Pemanggilnya yang tahu koordinat mana yang hilang, dan ia menyebutkannya
 * lewat `sebabJenjangNull`.
 */
export type SebabTagihanTakLengkap =
  | "mitra_tanpa_titik"
  | "alamat_tanpa_pin"
  | "tarif_varian_kosong"
  | "tarif_transport_kosong";

/** Kalimat untuk ADMIN: menyebut akibat DAN layar yang memperbaikinya. */
export const KALIMAT_SEBAB_ADMIN: Record<SebabTagihanTakLengkap, string> = {
  mitra_tanpa_titik:
    "Bidan yang ditetapkan belum punya titik di peta, jadi jaraknya tidak bisa dihitung. Lengkapi di menu Mitra.",
  alamat_tanpa_pin:
    "Alamat permintaan ini belum berpin, jadi jaraknya tidak bisa dihitung. Jatuhkan pin di peta pada blok Alamat kunjungan di atas.",
  tarif_varian_kosong:
    "Belum ada tarif varian yang berlaku pada tanggal sesi ini. Owner menetapkannya di menu Tarif.",
  tarif_transport_kosong:
    "Belum ada tarif transport yang berlaku untuk jenjang jarak ini pada tanggal sesi. Owner menetapkannya di menu Transport.",
};

/**
 * Kalimat untuk KLIEN. Tidak satu pun menyebut nama layar internal atau
 * menyuruh klien melakukan sesuatu: tidak ada satu pun sebab di atas yang bisa
 * ia perbaiki sendiri, dan menyuruhnya mencoba hanya membuatnya merasa salah.
 */
export const KALIMAT_SEBAB_KLIEN: Record<SebabTagihanTakLengkap, string> = {
  mitra_tanpa_titik: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  alamat_tanpa_pin: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  tarif_varian_kosong: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  tarif_transport_kosong:
    "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
};

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
  /** Tarif transport menurut jenjang & tanggal sesi. */
  transport: number | null;
  /**
   * Jenjang jarak yang dipakai, supaya pemanggil bisa menampilkannya (mis.
   * ">10–15 km") tanpa menghitung ulang jaraknya sendiri — dua perhitungan
   * jarak yang harus sepakat sudah cukup satu pasang.
   */
  jenjang: JenjangTransport | null;
  /**
   * Sejak migrasi `tarif_dasar_di_atas_20`, ini TIDAK LAGI keadaan normal bagi
   * pengajuan jarak jauh. Ia sekarang berarti satu hal saja: tarif DASAR
   * `di_atas_20` sendiri belum pernah ditetapkan owner. Medannya dipertahankan
   * supaya pemanggil lama tidak perlu diubah serentak.
   */
  menungguTarifKhusus: boolean;
  /** Total yang harus dibayar. `null` bila salah satu bagiannya belum diketahui. */
  total: number | null;
  /** Terisi PERSIS ketika `total === null`. Lihat `SebabTagihanTakLengkap`. */
  sebab: SebabTagihanTakLengkap | null;
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
  /**
   * Sebab `jenjang` kosong, disebutkan pemanggil karena hanya ia yang tahu
   * koordinat mana yang hilang. Bawaannya `alamat_tanpa_pin` — bukan pilihan
   * sembarang: mitra tanpa titik dicegah lebih awal oleh form mitra yang sudah
   * mewajibkan pin, sedangkan alamat tanpa pin adalah keadaan yang memang lahir
   * normal dari geocoding Malang yang sebagian besar gagal.
   */
  sebabJenjangNull?: "mitra_tanpa_titik" | "alamat_tanpa_pin";
  /** Nominal >20 km yang ditetapkan owner PER KASUS — MENIMPA tarif dasar. */
  transportKhusus?: number | null;
  tarif: readonly BarisTarif[];
  tarifTransport: readonly BarisTarifTransport[];
}): RincianTagihan {
  const {
    variantId,
    tanggal,
    jenjang,
    transportKhusus = null,
    sebabJenjangNull = "alamat_tanpa_pin",
  } = input;

  const barisTarif = tarifPadaTanggal(
    // `honorMitra` & `hargaCoret` diisi nilai netral: keduanya bagian bentuk
    // `TarifRingkas` tetapi tidak menyentuh perhitungan tagihan KLIEN sama
    // sekali. Honor mitra khususnya TIDAK BOLEH ikut dibaca di sini.
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
    return {
      layanan,
      transport: null,
      jenjang: null,
      menungguTarifKhusus: false,
      total: null,
      sebab: sebabJenjangNull,
    };
  }

  // PENIMPA DULU, BARU TARIF DASAR — dan urutannya hidup HANYA di sini.
  //
  // Sejak migrasi `tarif_dasar_di_atas_20`, `di_atas_20` punya baris rate card
  // seperti jenjang lain. `transport_khusus` tidak dibubarkan bersamanya: ia
  // jadi PENIMPA per kasus, supaya 80 km tidak tertagih sama dengan 25 km.
  // Kekhawatiran Ruling 6 ("dua sumber kebenaran untuk satu nominal") ditutup
  // dengan menetapkan urutannya di SATU cabang, bukan dengan meniadakan salah
  // satunya — dan cabang itu adalah tiga baris di bawah ini.
  const transport =
    transportKhusus ??
    tarifTransportPadaTanggal(
      input.tarifTransport.map((t) => ({
        id: "",
        jenjang: t.jenjang,
        tarifKlien: t.tarifKlien,
        honorMitra: 0,
        berlakuSejak: t.berlakuSejak,
      })),
      jenjang,
      tanggal,
    )?.tarifKlien ??
    null;

  // Sebab dipilih dengan urutan tetap: tarif layanan lebih dulu, karena itu
  // yang paling sering hilang (varian baru yang tarifnya belum ditetapkan) dan
  // karena admin hanya bisa menindak satu hal pada satu waktu.
  const sebab: SebabTagihanTakLengkap | null =
    layanan === null
      ? "tarif_varian_kosong"
      : transport === null
        ? "tarif_transport_kosong"
        : null;

  return {
    layanan,
    transport,
    jenjang,
    // Nilainya kini SEMPIT: ">20 km, dan tarif dasarnya pun belum ada".
    menungguTarifKhusus: jenjang === "di_atas_20" && transport === null,
    total: layanan === null || transport === null ? null : layanan + transport,
    sebab,
  };
}
