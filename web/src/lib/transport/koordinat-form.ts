import type { Koordinat } from "./jarak";

/**
 * Koordinat yang DIJATUHKAN MANUSIA di peta, dibaca dari FormData.
 *
 * Terpisah dari `geocodeAlamat` dengan sengaja: yang ini tidak pernah
 * menyentuh jaringan, tidak pernah gagal, dan tidak pernah menebak. Ia hanya
 * menjawab satu pertanyaan — apakah orang yang mengisi formulir ini sudah
 * menunjuk sebuah titik, dan apakah titik itu masuk akal sebagai koordinat.
 *
 * `Number("")` adalah 0, BUKAN NaN, dan {0,0} adalah titik yang sah di Teluk
 * Guinea. Medan kosong karena itu ditolak SEBELUM dikonversi; menyerahkannya
 * pada pemeriksaan rentang di bawah akan meloloskan setiap formulir yang
 * petanya tidak pernah disentuh sebagai "pin di Teluk Guinea" — koordinat
 * palsu yang terlihat sengaja, lalu melahirkan jenjang `di_atas_20` untuk
 * setiap klien Malang.
 */
export function koordinatDariFormData(formData: FormData): Koordinat | null {
  const latTeks = String(formData.get("lat") ?? "").trim();
  const lonTeks = String(formData.get("lon") ?? "").trim();
  if (latTeks === "" || lonTeks === "") return null;

  const lat = Number(latTeks);
  const lon = Number(lonTeks);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;

  return { lat, lon };
}
