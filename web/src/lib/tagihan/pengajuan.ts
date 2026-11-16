/**
 * SEBAB TAGIHAN PENGAJUAN BELUM LENGKAP / DITOLAK, beserta kalimatnya.
 *
 * Rumus harganya TIDAK lagi hidup di TS (P3/B7, spec §6.8). Angka tagihan
 * sesi dihitung satu kali, di SQL: `rincian_tagihan_permintaan` (staf) dan
 * `terbitkan_tagihan_sesi`, yang membekukannya menjadi item pesanan. Berkas ini
 * tinggal memegang NILAI sebab dan kalimat layarnya, supaya SQL tidak pernah
 * memegang teks tampilan.
 */

/**
 * KENAPA sebuah tagihan belum lengkap — sebagai nilai bertipe, bukan kalimat.
 *
 * Sebab dipisahkan dari kalimatnya karena satu sebab dibaca DUA orang dengan
 * kebutuhan berbeda: admin perlu tahu layar mana yang memperbaikinya, klien
 * perlu tahu apakah ia harus melakukan sesuatu (ia tidak). Menyimpan kalimatnya
 * saja berarti kalimat admin bocor ke layar klien, atau dua sumber kebenaran
 * lahir untuk keadaan yang sama.
 *
 * `mitra_tanpa_titik` dan `alamat_tanpa_pin` TIDAK bisa dibedakan fungsi murni
 * ini — keduanya sampai ke sini sebagai `jenjang === null` yang identik.
 * Pemanggilnya yang tahu koordinat mana yang hilang, dan ia menyebutkannya
 * lewat `sebabJenjangNull`.
 */
export type SebabTagihanTakLengkap =
  | "mitra_tanpa_titik"
  | "alamat_tanpa_pin"
  | "tarif_varian_kosong"
  | "tarif_transport_kosong";

/**
 * Sebab `terbitkan_tagihan_sesi` MENOLAK menerbitkan tagihan (B2). Empat sebab
 * tagihan-tak-lengkap di atas, ditambah lima keadaan yang hanya diketahui
 * fungsi SQL itu saat ia mengunci barisnya.
 *
 * Fungsi SQL melempar `message` = salah satu kunci ini dengan
 * `hint = 'sebab_tagihan'`; kalimatnya tetap tinggal di sini, supaya SQL tidak
 * pernah memegang teks layar.
 */
export type SebabTagihanDitolak =
  | SebabTagihanTakLengkap
  | "jam_kunjungan_lewat"
  | "bidan_nonaktif"
  | "uang_sudah_masuk"
  | "permintaan_tidak_siap"
  | "total_nol";

/** Kalimat untuk ADMIN: menyebut akibat DAN layar yang memperbaikinya. */
export const KALIMAT_SEBAB_ADMIN: Record<SebabTagihanDitolak, string> = {
  mitra_tanpa_titik:
    "Bidan yang ditetapkan belum punya titik di peta, jadi jaraknya tidak bisa dihitung. Lengkapi di menu Mitra.",
  alamat_tanpa_pin:
    "Alamat permintaan ini belum berpin, jadi jaraknya tidak bisa dihitung. Jatuhkan pin di peta pada blok Alamat kunjungan di atas.",
  tarif_varian_kosong:
    "Belum ada tarif varian yang berlaku pada tanggal sesi ini. Owner menetapkannya di menu Tarif.",
  tarif_transport_kosong:
    "Belum ada tarif transport yang berlaku untuk jenjang jarak ini pada tanggal sesi. Owner menetapkannya di menu Transport.",
  jam_kunjungan_lewat:
    "Jam kunjungan permintaan ini sudah lewat (waktu Jakarta), jadi tagihannya tidak bisa dibayar tepat waktu. Ubah tanggal atau jam kunjungannya lebih dulu.",
  bidan_nonaktif:
    "Bidan yang ditetapkan sudah nonaktif. Ganti bidannya lebih dulu, lalu terbitkan tagihannya.",
  uang_sudah_masuk:
    "Pembayaran untuk permintaan ini sudah masuk atau sedang diperiksa. Selesaikan dulu di menu Pesanan; tagihan kedua tidak diterbitkan.",
  permintaan_tidak_siap:
    "Permintaan sudah ditangani atau tidak ditemukan. Muat ulang halaman.",
  total_nol:
    "Total tagihan nol — Owner menetapkan tarif varian dan transport di menu Tarif/Transport.",
};

/**
 * Sebab penolakan dari galat RPC `terbitkan_tagihan_sesi`, atau `null` bila
 * galatnya BUKAN penolakan bersebab (galat sistem, jaringan, kendala lain).
 * Dicocokkan lewat `hint` DAN kunci yang dikenal: pesan galat Postgres lain
 * tidak pernah boleh menyamar menjadi kalimat admin.
 */
export function sebabTagihanDitolak(
  galat: { message?: string; hint?: string | null } | null,
): SebabTagihanDitolak | null {
  if (!galat || galat.hint !== "sebab_tagihan" || !galat.message) return null;
  return Object.prototype.hasOwnProperty.call(KALIMAT_SEBAB_ADMIN, galat.message)
    ? (galat.message as SebabTagihanDitolak)
    : null;
}

/**
 * Kalimat untuk KLIEN. Tidak satu pun menyebut nama layar internal atau
 * menyuruh klien melakukan sesuatu: tidak ada satu pun sebab di atas yang bisa
 * ia perbaiki sendiri, dan menyuruhnya mencoba hanya membuatnya merasa salah.
 */
export const KALIMAT_SEBAB_KLIEN: Record<SebabTagihanTakLengkap, string> = {
  mitra_tanpa_titik: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  alamat_tanpa_pin: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  tarif_varian_kosong: "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
  tarif_transport_kosong:
    "Totalnya sedang dilengkapi tim PADMA. Kami menghubungi Anda sebentar lagi.",
};
