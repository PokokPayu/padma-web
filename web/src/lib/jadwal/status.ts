/**
 * SATU-SATUNYA tempat yang tahu nama-nama status pemesanan PADMA.
 *
 * Kenapa berkas ini ada, dan kenapa ia yang PERTAMA dikerjakan: mengganti nilai
 * enum adalah perubahan yang gagal DIAM-DIAM. Kode yang membandingkan dengan
 * nilai lama tidak melempar error — ia hanya berhenti cocok, dan akibatnya
 * berbentuk permintaan jadwal yang tidak pernah muncul di layar siapa pun
 * (spec C1 §"Risiko utama"). Perbandingan yang tersebar mustahil dijaga; yang
 * bisa dijaga hanyalah satu daftar dengan tipe yang mengikat.
 *
 * Berkas ini MURNI: tanpa satu pun impor. Ia dipakai server action, halaman
 * server, DAN komponen `"use client"` (blok antrean admin) — satu impor
 * Supabase di sini sudah cukup menyeret klien service role ke bundel peramban
 * (konvensi `src/lib/auth/pesan-undangan.ts`).
 *
 * ===== DUA OBJEK, RANTAI TERBELAH DI KONFIRMASI (spec J1) =====
 * Rantai yang diusulkan klien terbelah persis di `dikonfirmasi`: yang sebelumnya
 * adalah hidup sebuah PERMINTAAN, yang sesudahnya hidup sebuah SESI. Repo sudah
 * punya dua tabel itu dan pemisahannya sudah dikeraskan (migration
 * `20260829170000_sesi_dari_permintaan`: indeks unik supaya dua admin yang
 * menekan "Konfirmasi" bersamaan tidak melahirkan dua sesi). Karena itu rantai
 * dipasang pada dua objek, bukan dilebur jadi satu tabel berstatus panjang.
 *
 * ===== NAMA BERBAHASA INDONESIA =====
 * Usulan klien memakai `REQUESTED`/`MATCHING_MITRA`/`CONFIRMED`. Yang diadopsi
 * MODELNYA, bukan ejaannya: seluruh enum di repo ini berbahasa Indonesia
 * (`menunggu_verifikasi`, `terjadwal`, `belum`), dan menaruh `AWAITING_PAYMENT`
 * di sebelahnya membuat satu skema punya dua kosakata.
 *
 * ===== `menunggu_bayar` SEKARANG ADA (C2) =====
 * Ia sengaja TIDAK dibuat di C1 — nilai enum yang belum dipakai adalah keadaan
 * mati yang tidak satu pun kode tahu cara keluar darinya. C2 membuatnya
 * bersamaan dengan jalan masuk (terbitkan tagihan) dan DUA jalan keluarnya
 * (dibayar & diverifikasi, atau tenggatnya lewat).
 *
 * Bersamanya lahir `dibatalkan_tenggat`, yang sengaja BUKAN `dibatalkan_klien`:
 * nilai status adalah catatan tentang SIAPA, dan orang yang lupa membayar bukan
 * orang yang memutuskan membatalkan. Hanya batal-tenggat yang mengembalikan
 * skrining (spec C2 P5).
 */

/**
 * Enum `booking_status` sesudah C1.
 *
 * `ditolak` masih ada dan sengaja dipertahankan (spec J8): nilainya tidak
 * dihapus, hanya tidak lagi terjangkau dari layar mana pun. Menghapus nilai
 * enum yang pernah dipakai berarti kehilangan riwayat permintaan lama.
 */
export const STATUS_PERMINTAAN = [
  "diminta",
  "mencari_mitra",
  "mitra_siap",
  "menunggu_bayar",
  "dikonfirmasi",
  "dibatalkan_klien",
  "dibatalkan_tenggat",
  "ditolak",
] as const;

export type StatusPermintaan = (typeof STATUS_PERMINTAAN)[number];

/**
 * Keadaan yang berarti "masih di antrean" — inilah himpunan yang dihitung
 * `BATAS_PERMINTAAN_MENUNGGU` dan yang dijaga indeks dedup.
 *
 * Sebelum C1 himpunan ini hanya berisi satu nilai (`menunggu`), sehingga
 * perbandingannya bisa ditulis `eq("status", "menunggu")` di mana-mana. Sesudah
 * rantai diperpanjang ia berisi TIGA, dan setiap tempat yang lupa memperbarui
 * perbandingannya akan diam-diam menghitung antrean lebih pendek daripada yang
 * sebenarnya — artinya klien bisa melewati batasnya.
 */
export const STATUS_ANTRE: readonly StatusPermintaan[] = [
  "diminta",
  "mencari_mitra",
  "mitra_siap",
  // `menunggu_bayar` IKUT antrean (spec C2 P1): klien masih menunggu jawaban
  // PADMA — tepatnya menunggu jadwalnya terkunci — dan bidannya masih
  // tertahan. Mengeluarkannya berarti klien bisa menumpuk tagihan yang belum
  // dibayar tanpa pernah menabrak batas antrean.
  "menunggu_bayar",
];

/**
 * Keadaan asal yang sah untuk konfirmasi. Dipakai server action & uji supaya
 * nilainya tidak perlu ditulis literal di luar berkas ini (pagar
 * `tests/status-satu-sumber.test.ts` memang melarangnya).
 */
export const PERMINTAAN_SIAP_KONFIRMASI = "mitra_siap" satisfies StatusPermintaan;

/** Keadaan awal setiap permintaan baru. Ditulis mati di server, bukan dari peramban. */
export const PERMINTAAN_AWAL = "diminta" satisfies StatusPermintaan;

/** Satu-satunya tujuan yang boleh ditulis klien atas barisnya sendiri (spec J8). */
export const PERMINTAAN_DIBATALKAN_KLIEN = "dibatalkan_klien" satisfies StatusPermintaan;

export const LABEL_PERMINTAAN: Record<StatusPermintaan, string> = {
  diminta: "Diminta",
  mencari_mitra: "Mencari bidan",
  mitra_siap: "Bidan siap",
  menunggu_bayar: "Menunggu pembayaran",
  dikonfirmasi: "Dikonfirmasi",
  dibatalkan_klien: "Dibatalkan klien",
  dibatalkan_tenggat: "Batal — tenggat bayar lewat",
  ditolak: "Ditolak",
};

/**
 * Perpindahan yang SAH, sebagai peta dari keadaan asal ke daftar tujuan.
 *
 * Ditulis sebagai `Record<StatusPermintaan, …>` supaya TypeScript menolak build
 * begitu ada anggota enum yang tidak disebut — pola yang sama dengan
 * `LABEL_JENJANG` di `lib/transport/jarak.ts`.
 *
 * Catatan per baris, karena setiap panah di sini adalah keputusan:
 *
 *  - `mencari_mitra -> diminta` dan `mitra_siap -> mencari_mitra`: MUNDUR boleh.
 *    Mitra yang sudah dipilih bisa berhalangan sebelum konfirmasi, dan tanpa
 *    jalan mundur satu-satunya jalan keluar adalah membatalkan permintaan
 *    klien yang tidak melakukan kesalahan apa pun.
 *
 *  - `dikonfirmasi` TIDAK punya panah keluar sama sekali, termasuk panah mundur
 *    "pemulihan". Draf pertama rencana ini menyediakannya karena konfirmasi
 *    adalah dua tulisan (status permintaan, lalu baris sesi) dan tulisan kedua
 *    bisa gagal, meninggalkan permintaan tersangkut tanpa sesi. Jawaban yang
 *    dipilih bukan memperlebar mesin status melainkan MENGHILANGKAN kegagalan
 *    parsialnya: konfirmasi kini satu fungsi Postgres, satu transaksi (lihat
 *    migration `konfirmasi_atomik`). Mesin status tidak boleh melar untuk
 *    menampung operasi yang tidak atomik — operasinya yang dibuat atomik.
 *
 *  - Tidak ada panah dari `dikonfirmasi` ke `dibatalkan_klien`. Pembatalan sesi
 *    yang sudah terkonfirmasi menyangkut uang dan tenggat waktu; seluruhnya
 *    milik C3, dan ia bekerja pada `sessions`, bukan di sini (spec J8).
 */
export const PERPINDAHAN_PERMINTAAN: Record<StatusPermintaan, readonly StatusPermintaan[]> = {
  diminta: ["mencari_mitra", "dibatalkan_klien"],
  mencari_mitra: ["mitra_siap", "diminta", "dibatalkan_klien"],
  // `mitra_siap -> dikonfirmasi` DIHAPUS di C2, dan itu seluruh inti C2:
  // konfirmasi tidak lagi bisa terjadi tanpa uang berpindah. Jalannya kini
  // wajib lewat `menunggu_bayar`.
  mitra_siap: ["menunggu_bayar", "mencari_mitra", "dibatalkan_klien"],
  menunggu_bayar: [
    "dikonfirmasi",
    // Mundur melepas bidan tanpa membatalkan pengajuan klien — bidannya bisa
    // berhalangan sementara kliennya tidak melakukan kesalahan apa pun.
    "mencari_mitra",
    "dibatalkan_klien",
    "dibatalkan_tenggat",
  ],
  dikonfirmasi: [],
  dibatalkan_klien: [],
  dibatalkan_tenggat: [],
  ditolak: [],
};

export function bolehPindahPermintaan(dari: StatusPermintaan, ke: StatusPermintaan): boolean {
  return PERPINDAHAN_PERMINTAAN[dari].includes(ke);
}

/**
 * Enum `session_status` sesudah C1.
 *
 * `batal` lama berganti nama menjadi `dibatalkan_padma` (spec J1): sesudah C3
 * ada dua pihak yang bisa membatalkan sesi, dan "batal" tidak menyebut siapa.
 */
export const STATUS_SESI = [
  "terjadwal",
  "berjalan",
  "selesai",
  "tidak_hadir",
  "dibatalkan_padma",
] as const;

export type StatusSesi = (typeof STATUS_SESI)[number];

export const LABEL_SESI: Record<StatusSesi, string> = {
  terjadwal: "Terjadwal",
  berjalan: "Berjalan",
  selesai: "Selesai",
  tidak_hadir: "Tidak hadir",
  dibatalkan_padma: "Dibatalkan PADMA",
};

/**
 * `terjadwal -> selesai` sengaja TETAP sah, berdampingan dengan
 * `terjadwal -> berjalan -> selesai`.
 *
 * Alasannya bukan kelonggaran melainkan kenyataan: akun dan panel mitra belum
 * ada (spec "Di luar ruang lingkup"), sehingga tidak ada seorang pun yang
 * menekan "berangkat" pada saat yang tepat. `berjalan` ditandai admin, dan
 * admin klinik sekecil ini akan sering melewatinya. Memaksa lewat `berjalan`
 * berarti memaksa admin berbohong tentang jam, atau membuat sesi yang benar
 * terjadi tidak pernah bisa ditandai selesai.
 */
export const PERPINDAHAN_SESI: Record<StatusSesi, readonly StatusSesi[]> = {
  terjadwal: ["berjalan", "selesai", "tidak_hadir", "dibatalkan_padma"],
  berjalan: ["selesai", "tidak_hadir"],
  selesai: [],
  tidak_hadir: [],
  dibatalkan_padma: [],
};

export function bolehPindahSesi(dari: StatusSesi, ke: StatusSesi): boolean {
  return PERPINDAHAN_SESI[dari].includes(ke);
}

/**
 * Satu-satunya keadaan sesi yang berarti "tidak jadi terjadi karena PADMA".
 *
 * Dipakai query yang selama ini menulis `.neq("status", "batal")` — mengecualikan
 * sesi yang dibatalkan dari agenda, tagihan, dan hitungan antrean. Sengaja TIDAK
 * ikut mengecualikan `tidak_hadir`: apakah sesi yang kliennya tidak hadir tetap
 * ditagih adalah keputusan C3 yang belum diambil, dan mengubah perilakunya
 * diam-diam di sini akan mendahului keputusan itu.
 */
export const SESI_DIBATALKAN = "dibatalkan_padma" satisfies StatusSesi;

/** Keadaan "sedang dicarikan bidan" — dipakai server action admin (spec J7). */
export const PERMINTAAN_DICARIKAN = "mencari_mitra" satisfies StatusPermintaan;

/** Tagihan sudah terbit, jadwal belum terkunci (spec C2 P1). */
export const PERMINTAAN_MENUNGGU_BAYAR = "menunggu_bayar" satisfies StatusPermintaan;

/**
 * Batal karena tenggat bayar lewat — BUKAN `dibatalkan_klien`.
 *
 * Perbedaannya bukan kosmetik: yang satu keputusan orang, yang satu kelalaian
 * waktu, dan hanya yang KEDUA yang mengembalikan skrining (spec C2 P5).
 */
export const PERMINTAAN_BATAL_TENGGAT = "dibatalkan_tenggat" satisfies StatusPermintaan;
