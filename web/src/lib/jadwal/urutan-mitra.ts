import { haversineKm, type Koordinat } from "@/lib/transport/jarak";

/**
 * Urutan mitra untuk layar penugasan admin (spec C1 J7).
 *
 * KEPUTUSANNYA TETAP DI TANGAN MANUSIA. Fungsi ini mengurutkan, tidak memilih.
 * Penugasan otomatis ditolak karena sistem tidak tahu cuti, jam kerja, maupun
 * kecocokan keahlian — ia hanya tahu jarak garis lurus, dan `lib/transport/
 * jarak.ts` sendiri sudah menulis bahwa 4,2 km ke seberang sungai bisa berarti
 * 9 km memutar.
 *
 * Murni dan tanpa impor Supabase: ia dipakai halaman server maupun diuji tanpa
 * basis data.
 */
export type MitraJarak = {
  id: string;
  nama: string;
  lat: number | null;
  lon: number | null;
};

export type MitraTerurut = MitraJarak & { km: number | null };

export function urutkanMitraMenurutJarak(
  mitra: readonly MitraJarak[],
  tujuan: Koordinat | null,
): MitraTerurut[] {
  const berjarak: MitraTerurut[] = mitra.map((m) => ({
    ...m,
    km:
      tujuan !== null && m.lat !== null && m.lon !== null
        ? haversineKm({ lat: m.lat, lon: m.lon }, tujuan)
        : null,
  }));

  // Salinan, bukan sortir di tempat: memutasi array milik pemanggil adalah
  // kejutan yang terbayar jauh dari sini.
  return [...berjarak].sort((a, b) => {
    // Mitra tanpa jarak SELALU di belakang — tetapi tetap ada. Membuangnya
    // berarti mitra yang domisilinya belum diisi tidak bisa ditugaskan sama
    // sekali, dan admin tidak akan pernah tahu kenapa namanya hilang.
    if (a.km === null && b.km === null) return a.nama.localeCompare(b.nama, "id");
    if (a.km === null) return 1;
    if (b.km === null) return -1;
    if (a.km !== b.km) return a.km - b.km;
    // Jarak yang persis sama diputus oleh nama, supaya urutannya tidak
    // berubah antar-muat halaman.
    return a.nama.localeCompare(b.nama, "id");
  });
}

/**
 * Jarak untuk dibaca manusia: satu angka desimal, koma sebagai pemisah.
 *
 * Sengaja TIDAK dibulatkan ke jenjang tarif. Admin yang tahu bahwa 4,2 km ke
 * seberang sungai berarti 9 km memutar yang memutuskan — dan angka yang sudah
 * dijadikan jenjang menyembunyikan justru bagian yang ia butuhkan.
 */
export function formatKm(km: number | null): string {
  if (km === null) return "domisili belum diisi";
  return `${km.toFixed(1).replace(".", ",")} km`;
}
