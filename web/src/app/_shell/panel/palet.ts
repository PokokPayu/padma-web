/**
 * Palet kategorikal grafik panel.
 *
 * Ketiga heks di bawah BUKAN pilihan selera: ia dijalankan lewat
 * `scripts/validate_palette.js` (skill dataviz) terhadap permukaan terang, dan
 * lolos lightness band, chroma floor, pemisahan CVD (terburuk ΔE 10,1 deutan),
 * serta ambang penglihatan normal (ΔE 23,8). Urutannya ikut divalidasi —
 * validator memeriksa PASANGAN BERSEBELAHAN, jadi menukar urutan mengubah
 * pasangan yang diperiksa.
 *
 * Warna PADMA sendiri (leaf #2f6a48, night #0a2b1f) sudah dicoba lebih dulu dan
 * GAGAL chroma floor — keduanya terbaca abu-abu sebagai tanda grafik. Karena
 * itu palet grafik hidup terpisah dari palet merek, dan bukan turunannya.
 *
 * Slot ketiga (#c8952f) berada sedikit di bawah kontras 3:1 terhadap permukaan
 * putih. Itu WARN, bukan pengecualian yang boleh diabaikan: kelegaannya wajib
 * berupa label langsung pada serinya dan padanan tabel — keduanya disediakan
 * `GrafikGaris`, dan angkanya juga tampil sebagai stat tile di halaman yang sama.
 */
export const PALET_GRAFIK = ["#2e8b57", "#8c4a7d", "#c8952f"] as const;

/** Kisi & sumbu sengaja resesif: data yang menonjol, bukan rangkanya. */
export const WARNA_KISI = "#e4e7e3";
export const WARNA_TINTA_SUMBU = "#6b756e";
/** Permukaan kartu — dipakai sebagai cincin 2px pada penanda yang bertumpuk. */
export const WARNA_PERMUKAAN = "#ffffff";
