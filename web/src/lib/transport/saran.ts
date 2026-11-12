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

/**
 * Jarak & jenjang untuk SATU sesi, dari ketiga titik yang mungkin ada.
 *
 * Alamat SESI menang atas alamat default klien ketika keduanya ada: alamat
 * sesi adalah tempat bidan benar-benar datang. Fallback ke alamat klien tetap
 * dipertahankan karena `jadwalkanSesi` memang menghitung jenjangnya dari sana
 * — tanpa fallback itu, sesi yang dijadwalkan admin (yang lazimnya tidak punya
 * titik sendiri) akan menampilkan "—" padahal jenjangnya jelas berasal dari
 * suatu tempat, dan layar yang berkata "tidak tahu" atas angka yang sebenarnya
 * diketahui menyembunyikan asal-usul uang.
 *
 * `jarakDari` ikut dipulangkan supaya layar bisa MENYEBUT alamat mana yang
 * dipakai. Dua sumber koordinat yang bisa berbeda, ditampilkan sebagai satu
 * angka tanpa keterangan, adalah cara paling rapi untuk menyesatkan orang yang
 * mempercayainya.
 *
 * Fungsi ini MURNI dan tidak mengenal bentuk baris basis data: pemanggil yang
 * memetakan kolomnya. Itu disengaja — lapisan daftar dan lapisan detail
 * menarik kolom yang berbeda, dan keduanya harus sampai ke jawaban yang sama.
 */
export function jarakUntukSesi(titik: {
  mitra: Koordinat | null;
  alamatSesi: Koordinat | null;
  alamatKlien: Koordinat | null;
}): {
  jarakKm: number | null;
  jarakDari: "sesi" | "klien" | null;
  jenjangHitung: JenjangTransport | null;
} {
  const kosong = { jarakKm: null, jarakDari: null, jenjangHitung: null } as const;
  if (!titik.mitra) return kosong;

  const dariSesi = titik.alamatSesi !== null;
  const tujuan = titik.alamatSesi ?? titik.alamatKlien;
  const saran = saranJenjang(titik.mitra, tujuan);
  if (!saran) return kosong;

  return {
    jarakKm: saran.jarakKm,
    jarakDari: dariSesi ? "sesi" : "klien",
    jenjangHitung: saran.jenjang,
  };
}

/** Merakit `Koordinat` dari sepasang kolom yang boleh null. Null bila salah satunya kosong. */
export function koordinat(lat: number | null | undefined, lon: number | null | undefined): Koordinat | null {
  return lat != null && lon != null ? { lat, lon } : null;
}
