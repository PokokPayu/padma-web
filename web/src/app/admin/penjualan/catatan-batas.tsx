import { BATAS_BARIS_PENJUALAN } from "@/lib/penjualan/baca";

const GAYA =
  "mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay";

/**
 * Pengumuman batas baris — DIPISAH dari halamannya supaya bisa dirender di uji
 * tanpa Supabase, pola yang sama dengan `PeringatanData` di /owner/penjualan.
 *
 * Batas yang tidak diumumkan adalah batas yang berbohong: daftar yang
 * terpotong tepat di batasnya terlihat persis seperti daftar yang memang hanya
 * sepanjang itu. Karena itu angkanya WAJIB "dicetak di layar apa adanya" —
 * dari `BATAS_BARIS_PENJUALAN`, dan tidak pernah sebagai angka yang diketik
 * ulang di berkas ini (termasuk di komentar ini; uji sumbernya mengunci itu).
 *
 * Dua keadaan, dua kalimat:
 *
 * - `terpotong` — batasnya benar-benar tersentuh. Daftarnya DAN totalnya belum
 *   lengkap, dan itu harus dikatakan.
 * - periode "semua" tanpa terpotong — belum tersentuh, tetapi pembacanya baru
 *   saja meminta SELURUH riwayat dan berhak tahu bahwa permintaan itu memang
 *   punya atap. Tanpa kalimat ini, instansi yang barisnya masih di bawah batas
 *   tidak pernah menyebut angkanya sama sekali, lalu suatu hari melewatinya.
 *
 * Periode berjangka (bulan ini, bulan lalu, 12 bulan) sengaja diam selama
 * batasnya tidak tersentuh: di sana rentangnyalah yang menjelaskan isi daftar,
 * dan peringatan permanen yang tidak pernah berlaku adalah peringatan yang
 * berhenti dibaca.
 *
 * Angkanya datang dari `BATAS_BARIS_PENJUALAN`, TIDAK PERNAH dari literal:
 * dua angka yang boleh berbeda adalah layar yang suatu hari mengumumkan batas
 * yang bukan batasnya.
 */
export function CatatanBatas({
  periode,
  terpotong,
}: {
  periode: string;
  terpotong: boolean;
}) {
  if (terpotong) {
    return (
      <p data-batas="terpotong" className={GAYA}>
        {`Hanya ${BATAS_BARIS_PENJUALAN} baris pertama yang dibaca — daftar dan total di halaman ini belum lengkap. Persempit periodenya.`}
      </p>
    );
  }

  if (periode === "semua") {
    return (
      <p data-batas="semua" className="mb-3 text-[11.5px] text-panel-muted">
        {`Halaman ini membaca paling banyak ${BATAS_BARIS_PENJUALAN} baris per kueri. Batas itu belum tersentuh, jadi daftar dan total di bawah lengkap.`}
      </p>
    );
  }

  return null;
}
