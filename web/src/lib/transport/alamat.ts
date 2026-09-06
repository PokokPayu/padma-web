/**
 * Bentuk kanonik sebuah alamat, dipakai sebagai KUNCI CACHE geocoding.
 *
 * Sengaja konservatif: hanya huruf kecil dan perataan spasi. Normalisasi yang
 * lebih agresif — membuang "Jl.", menyeragamkan "No." — menggabungkan alamat
 * yang MIRIP menjadi satu kunci, dan dua rumah berbeda yang berbagi koordinat
 * adalah salah tagih yang tidak akan pernah terlihat.
 */
export function normalkanAlamat(teks: string): string {
  return teks.trim().toLowerCase().replace(/\s+/g, " ");
}
