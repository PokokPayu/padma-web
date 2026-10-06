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

/**
 * Baris yang BOLEH tampil di layar nota admin.
 *
 * `order_items` dibekukan saat pesanan DIBUAT, bukan saat dibayar: sebuah
 * checkout yang ditinggalkan sudah memikul `harga_beku` lengkap. Ketika
 * tenggatnya lewat, pesanan itu menjadi `kedaluwarsa` dan tetap terbaca oleh
 * `bacaPenjualan` (STATUS_DIBACA memuat `PESANAN_MATI`), sehingga tanpa
 * saringan ini ia tercetak di tabel persis seperti penjualan yang sudah
 * dibayar — tanggal, kode, klien, judul, nominal, dan catatan KOSONG.
 * Checkout terlantar adalah keadaan pesanan yang paling sering terjadi, jadi
 * yang hilang bukan satu baris melainkan arti seluruh layarnya.
 *
 * Saringannya memakai `golongkan`, SATU-SATUNYA tempat aturan "apa yang
 * disebut terjual" hidup — bukan daftar status yang diketik ulang di sini dan
 * akan menyimpang dari `hitungPenjualan` pada nilai enum berikutnya.
 * `hitungPenjualan` sudah membuang golongan yang sama (`hitung.ts:173`); dua
 * layar admin inilah yang belum.
 *
 * Yang TETAP tampil adalah ketiga pengecualian yang memang punya catatannya
 * sendiri di `TabelPenjualan`: ditahan, dibayar lewat tenggat, dan
 * dikembalikan. Pesanan `kedaluwarsa` yang uangnya ternyata mendarat
 * (`lunasSetelahTutup`) termasuk yang kedua, dan ia justru WAJIB terlihat.
 */
export function notaTampil(baris: readonly BarisPenjualan[]): BarisPenjualan[] {
  return baris.filter((b) => golongkan(b) !== "bukan_penjualan");
}
