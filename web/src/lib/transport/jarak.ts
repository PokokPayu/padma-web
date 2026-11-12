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

/**
 * Label JENJANG persis penulisan materi klien ("0–5 km" lalu ">5–10 km" dst).
 * `Record<JenjangTransport, …>` dipakai justru supaya daftar ini TIDAK BISA
 * diam-diam kehilangan satu jenjang atau punya nama yang menyimpang dari enum
 * `jenjang_transport` — TypeScript menolak build bila salah satu anggota tipe
 * itu tidak disebut di sini.
 *
 * SATU-SATUNYA sumber (Ruling 20, Task 9 fix round 1). Sebelumnya hidup di
 * `app/admin/sesi/status.ts` dan diimpor NILAINYA oleh `lib/passport/turunan.ts`
 * & `lib/admin/tagihan.ts` — pembalikan arah kebergantungan yang salah: `lib/`
 * adalah lapisan domain murni, `app/` lapisan presentasi Next.js, dan domain
 * tidak boleh bergantung pada presentasi. `app/admin/sesi/status.ts` (dan
 * pengimpor lain di bawah `app/`) sekarang mengimpor BALIK dari sini.
 */
export const LABEL_JENJANG: Record<JenjangTransport, string> = {
  "0_5": "0–5 km",
  "5_10": ">5–10 km",
  "10_15": ">10–15 km",
  "15_20": ">15–20 km",
  di_atas_20: ">20 km",
};

/**
 * Satu-satunya cara menulis jarak di layar: "4,6 km", atau "—" bila tidak
 * diketahui.
 *
 * KENAPA ADA. Klien melaporkan (umpan balik 21 Sep 2026, butir 2) bahwa "jarak
 * mitra - klien masih 1-5 km semua". Diukur di basis data produksi, jaraknya
 * memang 0,75–4,72 km: seluruh mitra terdaftar berada dalam radius 7 km satu
 * sama lain di Malang kota, sehingga jenjang "0–5 km" yang berulang itu BENAR.
 * Yang membuatnya terbaca sebagai kemacetan adalah ketiadaan angkanya — label
 * jenjang yang selalu sama tidak bisa dibedakan dari nilai bawaan yang tidak
 * pernah dihitung. Fungsi ini ada supaya angkanya muncul, dan muncul dengan
 * cara yang sama di setiap layar yang menampilkannya.
 *
 * SATU desimal, bukan tiga. Koordinatnya dibenarkan manusia lewat pin di peta,
 * dan haversine mengukur garis lurus — bukan jarak jalan. "4,558 km"
 * menjanjikan ketelitian yang tidak dimiliki angkanya.
 *
 * `null` dijawab "—", TIDAK PERNAH "0,0 km". Nol adalah jarak yang sah (mitra
 * di alamat yang sama), dan memakai nol sebagai "tidak tahu" membuat sesi
 * tanpa titik terbaca sebagai sesi paling dekat — jenjang termurah, honor
 * mitra terkecil.
 */
export function formatJarakKm(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return "—";
  return `${km.toFixed(1).replace(".", ",")} km`;
}
