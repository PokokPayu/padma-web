export type Koordinat = { lat: number; lon: number };

export type JenjangTransport = "0_5" | "5_10" | "10_15" | "15_20" | "di_atas_20";

/** Jari-jari rata-rata Bumi dalam kilometer (IUGG mean radius). */
const JARI_JARI_BUMI_KM = 6371.0088;

function keRadian(derajat: number): number {
  return (derajat * Math.PI) / 180;
}

/**
 * Jarak GARIS LURUS antara dua titik di permukaan Bumi.
 *
 * Sengaja BUKAN jarak jalan. Jarak tempuh nyata biasanya 20–40% lebih jauh,
 * tetapi angka pengalinya tebakan — dan tebakan yang ditanam di sini akan
 * terbaca sebagai fakta oleh pembaca berikutnya. Yang dilakukan sistem ini
 * adalah menampilkan angka ini APA ADANYA kepada admin, lalu membiarkan orang
 * yang tahu bahwa 4,2 km ke seberang sungai berarti 9 km memutar untuk
 * memutuskan (spec T5).
 */
export function haversineKm(a: Koordinat, b: Koordinat): number {
  const dLat = keRadian(b.lat - a.lat);
  const dLon = keRadian(b.lon - a.lon);
  const lat1 = keRadian(a.lat);
  const lat2 = keRadian(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * JARI_JARI_BUMI_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Jarak → jenjang tarif.
 *
 * Batasnya ditulis PERSIS seperti materi klien: "0–5 km" lalu ">5–10 km".
 * Karena itu 5,0 km masih gratis dan 5,01 km sudah naik — perbandingannya
 * `<=`, bukan `<`. Menyerahkan batas ini pada pembulatan berarti dua klien
 * berjarak sama ditagih berbeda tergantung pembulatan hari itu.
 */
export function jenjangDariJarak(km: number): JenjangTransport {
  if (!Number.isFinite(km) || km < 0) {
    throw new Error(`Jarak tidak sah: ${km}`);
  }
  if (km <= 5) return "0_5";
  if (km <= 10) return "5_10";
  if (km <= 15) return "10_15";
  if (km <= 20) return "15_20";
  return "di_atas_20";
}
