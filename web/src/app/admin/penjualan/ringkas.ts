import { golongkan, nilaiBaris, type BarisPenjualan } from "@/lib/penjualan/hitung";

/**
 * Total nota yang dijumlahkan di layar admin.
 *
 * Hanya baris golongan `omzet` yang masuk. `nilaiBaris` memulangkan `null`
 * untuk item yang TIDAK TERBACA dan `0` untuk produk yang memang gratis;
 * keduanya tidak boleh bercampur. Baris `null` dihitung di `tanpaNilai` dan
 * tidak menyumbang apa pun ke `total`, supaya layar bisa MENGATAKAN bahwa
 * totalnya kurang alih-alih mencetak angka yang diam-diam terlalu kecil.
 */
export function ringkasNota(baris: readonly BarisPenjualan[]): {
  total: number;
  tanpaNilai: number;
} {
  let total = 0;
  let tanpaNilai = 0;
  for (const b of baris) {
    if (golongkan(b) !== "omzet") continue;
    const nilai = nilaiBaris(b);
    if (nilai === null) tanpaNilai += 1;
    else total += nilai;
  }
  return { total, tanpaNilai };
}
