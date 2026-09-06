import { haversineKm, jenjangDariJarak, type Koordinat, type JenjangTransport } from "./jarak";

/**
 * SARAN jenjang untuk admin — bukan keputusan.
 *
 * Memulangkan `null` bila salah satu koordinat kosong, dan itu bukan galat:
 * geocoding yang gagal berarti sistem tidak punya pendapat, dan admin memilih
 * sendiri tanpa satu pun pesan merah (spec T4, T6).
 *
 * `jarakKm` ikut dipulangkan supaya layar bisa menampilkannya APA ADANYA.
 * Itu bagian dari desainnya: jarak garis lurus yang terlihat memberi admin
 * bahan untuk menilai kapan angkanya menyesatkan — 4,2 km ke seberang sungai
 * berarti 9 km memutar — dan penilaian itu memang miliknya, bukan milik kita.
 */
export function saranJenjang(
  mitra: Koordinat | null,
  sesi: Koordinat | null,
): { jarakKm: number; jenjang: JenjangTransport } | null {
  if (!mitra || !sesi) return null;
  const jarakKm = haversineKm(mitra, sesi);
  return { jarakKm, jenjang: jenjangDariJarak(jarakKm) };
}
