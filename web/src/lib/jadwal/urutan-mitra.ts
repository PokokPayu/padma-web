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

/**
 * Kenapa jarak tidak bisa dihitung. Dua sebab yang berbeda, dan sebelumnya
 * keduanya memulangkan kalimat yang SAMA — "domisili belum diisi" — sehingga
 * alamat permintaan yang gagal digeocode menuduh mitra yang datanya sudah
 * benar, dan menuduh SELURUH mitra sekaligus karena tujuannya satu untuk semua.
 */
export type SebabTanpaJarak = "alamat_permintaan" | "domisili_mitra";

export type MitraTerurut = MitraJarak & {
  km: number | null;
  /** Null ketika `km` ada. Selalu terisi ketika `km` null. */
  sebab: SebabTanpaJarak | null;
};

export function urutkanMitraMenurutJarak(
  mitra: readonly MitraJarak[],
  tujuan: Koordinat | null,
): MitraTerurut[] {
  const berjarak: MitraTerurut[] = mitra.map((m) => {
    // TUJUAN DIPERIKSA LEBIH DULU, dan urutan itu disengaja: bila alamat
    // permintaan tanpa koordinat, tidak satu pun mitra bisa dihitung jaraknya,
    // dan satu pin memperbaiki seluruh baris sekaligus. Menyebut domisili
    // mitra lebih dulu akan mengirim admin membetulkan sepuluh data mitra
    // untuk satu koordinat yang hilang.
    if (tujuan === null) return { ...m, km: null, sebab: "alamat_permintaan" as const };
    if (m.lat === null || m.lon === null) {
      return { ...m, km: null, sebab: "domisili_mitra" as const };
    }
    return { ...m, km: haversineKm({ lat: m.lat, lon: m.lon }, tujuan), sebab: null };
  });

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
 * Jarak untuk dibaca manusia: satu angka desimal, koma sebagai pemisah — atau
 * kalimat yang menyebut APA yang kurang dan pada siapa.
 *
 * Menerima barisnya, bukan `number | null`, dan itu yang menutup cacatnya:
 * dengan `null` sebagai satu-satunya masukan, sebab hilangnya jarak tidak
 * pernah sampai ke sini, dan pemanggil mana pun terpaksa menebak. Sekarang
 * tipenya yang menjaga, bukan disiplin.
 *
 * Sengaja TIDAK dibulatkan ke jenjang tarif. Admin yang tahu bahwa 4,2 km ke
 * seberang sungai berarti 9 km memutar yang memutuskan — dan angka yang sudah
 * dijadikan jenjang menyembunyikan justru bagian yang ia butuhkan.
 */
export function labelJarak(m: Pick<MitraTerurut, "km" | "sebab">): string {
  if (m.km !== null) return `${m.km.toFixed(1).replace(".", ",")} km`;
  if (m.sebab === "alamat_permintaan") return "alamat permintaan belum berkoordinat";
  return "domisili bidan belum diisi";
}
