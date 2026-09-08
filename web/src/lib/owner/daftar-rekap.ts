import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { ambilRekap } from "./data";
import type { RekapPekan } from "./rekap";

/**
 * Saring & paginasi untuk `/owner/rekap`.
 *
 * BATAS YANG HARUS DIKETAHUI: `ambilRekap()` membaca SELURUH sesi, tarif, dan
 * tanda bayar klinik lalu menghitung seluruh pekan di TypeScript. Paginasi di
 * sini memotong hasil yang SUDAH terhitung — ia memperbaiki layar dan biaya
 * render, BUKAN batas bacaan. Sama seperti `daftarTagihanAdmin()`
 * (`src/lib/admin/tagihan.ts:293-300`) dan `saringRateCard()`. Obatnya view
 * SQL, bukan berkas ini.
 *
 * Rekap TIDAK menjadi daftar objek karena diberi bilah ini: ia tetap laporan,
 * kartunya tetap utuh, dan tidak ada satu pun formulir yang pindah ke sini.
 */
export const PER_HAL_REKAP = 8;

export const SARING_REKAP = { honor: ["tuntas", "belum"] } as const satisfies SaringSah;

/**
 * Sebuah pekan "tuntas" bila SETIAP mitra di dalamnya sudah ditandai dibayar.
 *
 * Pekan TANPA mitra sengaja TIDAK tuntas. `[].every()` memulangkan `true`, dan
 * kalau dibiarkan, pekan yang belum sempat dihitung honornya akan lenyap dari
 * saringan "belum" — persis pekan yang paling perlu dilihat owner.
 */
export function pekanTuntas(p: RekapPekan): boolean {
  return p.perMitra.length > 0 && p.perMitra.every((m) => m.sudahDibayar);
}

export function saringRekap(
  rekap: readonly RekapPekan[],
  param: ParamDaftar,
): { baris: RekapPekan[]; total: number } {
  const cari = param.cari.toLowerCase();

  const cocok = rekap.filter((p) => {
    // Cari MENYARING PEKAN, tidak memangkas isinya. Margin dan total pekan
    // dihitung atas SELURUH mitra; kartu yang isinya ikut disaring akan
    // menampilkan angka yang tidak cocok dengan baris yang terlihat.
    if (cari !== "" && !p.perMitra.some((m) => m.nama.toLowerCase().includes(cari))) return false;
    if (param.saring.honor === "tuntas" && !pekanTuntas(p)) return false;
    if (param.saring.honor === "belum" && pekanTuntas(p)) return false;
    return true;
  });

  const { dari, sampai } = hitungRentang(param.hal, PER_HAL_REKAP);
  return { baris: cocok.slice(dari, sampai + 1), total: cocok.length };
}

/** Satu halaman kartu pekan untuk `/owner/rekap`. */
export async function ambilDaftarRekap(
  param: ParamDaftar,
): Promise<{ baris: RekapPekan[]; total: number }> {
  return saringRekap(await ambilRekap(), param);
}
