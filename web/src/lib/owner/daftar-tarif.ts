import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { ambilRateCard, type BarisRateCard } from "./data";

/**
 * Cari, saring, dan paginasi untuk `/owner/tarif`.
 *
 * BATAS YANG HARUS DIKETAHUI: paginasi di sini memotong daftar yang SUDAH
 * TERBACA SELURUHNYA oleh `ambilRateCard()`. Ia memperbaiki layar dan biaya
 * render, BUKAN batas bacaan — `ambilRateCard()` membaca `phases`,
 * `services`, `service_variants`, dan seluruh riwayat `variant_rates` apa
 * adanya, dan `max_rows = 1000` di `supabase/config.toml` tetap berlaku bagi
 * bacaan yang tidak dipaginasi di sana. Sama persis dengan yang sudah dicatat
 * `daftarTagihanAdmin()` (`src/lib/admin/tagihan.ts:293-300`). Obatnya view
 * SQL, bukan berkas ini.
 *
 * Menyaring di JS di sini BUKAN kelalaian kedua: `ambilRateCard()` memang
 * harus membaca seluruh riwayat tarif apa pun yang terjadi, karena rekap
 * pekan lama mencocokkan tarif ke TANGGAL SESI. Tidak ada saringan yang bisa
 * dipindahkan ke PostgREST tanpa merusak sifat itu.
 */
export const SARING_TARIF = {
  tarif: ["bertarif", "belum"],
  aktif: ["ya", "tidak"],
} as const satisfies SaringSah;

export type HalamanRateCard = { baris: BarisRateCard[]; total: number };

/**
 * Fungsi MURNI: kartu apa adanya → satu halaman hasil.
 *
 * `total` adalah jumlah baris yang COCOK dengan saringan, bukan jumlah
 * seluruh rate card. Bilah daftar menampilkan "menampilkan N dari TOTAL", dan
 * total yang menghitung baris tersaring-keluar membuat owner mengira ada
 * varian yang hilang.
 */
export function saringRateCard(
  kartu: readonly BarisRateCard[],
  param: ParamDaftar,
): HalamanRateCard {
  const cari = param.cari.toLowerCase();

  const cocok = kartu.filter((b) => {
    if (cari !== "") {
      const teks = `${b.namaLayanan} ${b.labelVarian}`.toLowerCase();
      if (!teks.includes(cari)) return false;
    }
    // "belum bertarif" adalah PEKERJAAN, bukan kabar: sesi pada varian itu
    // muncul di rekap sebagai tak-bertarif dan honornya tidak ikut dihitung
    // di angka mana pun. Saringan ini yang membuat pekerjaan itu bisa
    // dikumpulkan dalam satu klik alih-alih dicari dengan mata.
    if (param.saring.tarif === "belum" && b.berlaku !== null) return false;
    if (param.saring.tarif === "bertarif" && b.berlaku === null) return false;
    if (param.saring.aktif === "ya" && !b.aktif) return false;
    if (param.saring.aktif === "tidak" && b.aktif) return false;
    return true;
  });

  // `sampai` inklusif, sama seperti `.range()` PostgREST yang ditirunya.
  const { dari, sampai } = hitungRentang(param.hal);
  return { baris: cocok.slice(dari, sampai + 1), total: cocok.length };
}

/** Satu halaman rate card untuk `/owner/tarif`. */
export async function ambilDaftarTarif(
  param: ParamDaftar,
  hariIni: string,
): Promise<HalamanRateCard> {
  return saringRateCard(await ambilRateCard(hariIni), param);
}

/**
 * Satu varian beserta tarif berlaku dan SELURUH riwayatnya, untuk
 * `/owner/tarif/[variantId]`.
 *
 * Sengaja memakai `ambilRateCard()` yang sama, bukan query sendiri: aturan
 * "tarif mana yang berlaku" hidup di `tarifPadaTanggal()` dan dipakai bersama
 * oleh rate card dan rekap honor. Menulis ulang aturan itu di sini akan
 * melahirkan dua definisi yang berpisah diam-diam pada perubahan berikutnya —
 * dan perpisahan itu berbentuk layar yang menampilkan satu angka sementara
 * honor dibayarkan dengan angka lain.
 *
 * `null` berarti varian itu tidak ada; halaman menjawabnya dengan `notFound()`.
 */
export async function ambilVarianTarif(
  variantId: string,
  hariIni: string,
): Promise<BarisRateCard | null> {
  const kartu = await ambilRateCard(hariIni);
  return kartu.find((b) => b.variantId === variantId) ?? null;
}
