/**
 * SATU-SATUNYA tempat di TypeScript yang tahu nama-nama status pesanan.
 *
 * Kenapa berkas ini lahir sebelum satu tabel pun: mengganti nilai enum adalah
 * perubahan yang gagal DIAM-DIAM. Kode yang membandingkan dengan nilai lama
 * tidak melempar apa pun — ia hanya berhenti cocok, dan untuk mesin PEMBAYARAN
 * bentuk kegagalannya adalah pesanan yang uangnya sudah masuk tapi tidak muncul
 * di layar siapa pun.
 *
 * Berkas ini MURNI: nol impor. Ia dipakai server action, route handler, DAN
 * komponen `"use client"` (tombol beli, Tugas 9) — satu impor Supabase di sini
 * sudah cukup menyeret klien service role ke bundel peramban (konvensi
 * `src/lib/auth/pesan-undangan.ts`).
 *
 * ===== HIMPUNAN, BUKAN KONSTANTA TUNGGAL =====
 * Keempat himpunan di bawah adalah pelajaran yang repo ini sudah bayar sekali:
 * nilai enum baru membuat konstanta tunggal salah diam-diam. `status === "lunas"`
 * benar hari ini dan salah begitu `ditahan` lahir; `PESANAN_BERUANG.includes(...)`
 * memaksa orang berikutnya memutuskan di mana nilai barunya masuk.
 *
 * ===== SATU TENGGAT UNTUK PRODUK DAN SESI (P3/B2) =====
 * `JAM_TENGGAT_BAYAR` (`src/lib/tagihan/tenggat.ts`) dulu memegang tenggat bayar
 * SESI dengan nilai yang sama. P1 sengaja tidak menyatukannya; P3 memindahkan
 * tagihan sesi ke mesin pesanan dan menyatukannya: `JAM_TENGGAT_PESANAN` kini
 * satu-satunya, dan konstanta lama dihapus.
 */

/**
 * Enum `order_status` — LIMA nilai, bukan enam.
 *
 * `ditinjau` sengaja tidak ada. Ia akan menjadi mekanisme tinjauan kedua yang
 * hidup berdampingan dengan `butuh_tinjauan_pada` tanpa satu pun kalimat yang
 * menyebut apa yang melahirkannya, dan pesanan yang masuk ke sana tidak punya
 * jalan pulang. Penanda tinjauan sekarang SATU, dan ia ortogonal terhadap
 * status.
 *
 * Urutannya mengikuti alur nyata (terbuka dulu, lalu ketiga keadaan akhir),
 * dan urutan itu MENGIKAT: `tests/pesanan-status-db.test.ts` membandingkannya
 * dengan `pg_enum` menurut `enumsortorder`, bukan menurut abjad.
 */
export const STATUS_PESANAN_SAH = [
  "menunggu_bayar",
  "ditahan",
  "lunas",
  "kedaluwarsa",
  "dibatalkan",
] as const;

export type StatusPesanan = (typeof STATUS_PESANAN_SAH)[number];

/**
 * Enum `order_item_source`.
 *
 * `sesi` lahir sekarang meski NOL penulis di P1 — preseden yang sama dengan
 * `entitlement_source.'beli'`. Yang membuatnya bukan kolom mati: `order_items`
 * membawa dua CHECK bercermin yang menjadikan nilai ini sah hanya bersama
 * `booking_request_id`, dan P3 tinggal mengisinya tanpa `alter table` pada
 * tabel uang yang sudah memuat nota nyata.
 */
export const SUMBER_ITEM_PESANAN = ["produk_digital", "sesi"] as const;

export type SumberItemPesanan = (typeof SUMBER_ITEM_PESANAN)[number];

/**
 * Enum `order_event` — 18 nilai, urut sama dengan `pg_enum`.
 *
 * Tidak ada kejadian "tinjauan dibuka": yang membukanya SELALU salah satu dari
 * keenam kejadian di `KEJADIAN_BUTUH_TINJAUAN`, dan nilai enum yang tidak punya
 * penulis adalah nilai yang pasti salah dibaca kelak.
 *
 * Dua nilai terakhir milik penyalur sesi (B3, migrasi 20261113140200), di
 * EKOR karena `alter type … add value` selalu menambah di akhir.
 * `penangan_belum_ada` sejak itu tidak punya penulis baru; nilainya tetap ada
 * karena nilai enum tidak bisa dicabut dan jejak lama boleh memuatnya.
 */
export const KEJADIAN_PESANAN_SAH = [
  "dibuat",
  "token_terbit",
  "notifikasi",
  "lunas",
  "ditahan",
  "kedaluwarsa",
  "dibatalkan",
  "selisih_nominal",
  "selisih_status",
  "lunas_setelah_tutup",
  "akses_terbit",
  "akses_sudah_ada",
  "akses_tertahan",
  "penangan_belum_ada",
  "diperiksa_ulang",
  "tinjauan_ditutup",
  "sesi_terkonfirmasi",
  "sesi_tertahan",
] as const;

export type KejadianPesanan = (typeof KEJADIAN_PESANAN_SAH)[number];

/** TERBUKA — satu-satunya keadaan yang boleh menerima uang. */
export const PESANAN_TERBUKA: readonly StatusPesanan[] = ["menunggu_bayar"];

/** TIDAK AKTIF — sudah punya cap `ditutup_pada`, apa pun sebabnya. */
export const PESANAN_TIDAK_AKTIF: readonly StatusPesanan[] = [
  "ditahan",
  "lunas",
  "kedaluwarsa",
  "dibatalkan",
];

/**
 * BERUANG — uang sudah masuk.
 *
 * `ditahan` ikut, dan itu seluruh alasan status itu ada: "uang masuk tapi
 * jumlahnya tidak cocok" butuh keadaan AKHIR. Tanpanya pesanan itu
 * `menunggu_bayar` selamanya, diperiksa ulang setiap kali kliennya membuka
 * halaman DAN disapu penjadwal — kejadian yang seharusnya paling langka
 * menjadi kebisingan paling berisik yang tak pernah didengar.
 */
export const PESANAN_BERUANG: readonly StatusPesanan[] = ["lunas", "ditahan"];

/** MATI — boleh checkout ulang; tidak ada uang yang tertinggal di sini. */
export const PESANAN_MATI: readonly StatusPesanan[] = ["kedaluwarsa", "dibatalkan"];

/**
 * Kejadian yang WAJIB menyalakan `butuh_tinjauan_pada` + `sebab_tinjauan` pada
 * baris `orders`-nya, di transaksi yang sama dengan jejaknya.
 *
 * Aturannya tunggal dan mengikat, dan tanpa aturan itu dua kegagalan termahal
 * lolos dari jaring yang justru ada untuk mereka. `lunas_setelah_tutup` adalah
 * settlement yang mendarat pada pesanan `kedaluwarsa`/`dibatalkan`: statusnya
 * bukan `ditahan` dan bukan `lunas`, jadi ia tidak muncul di blok mana pun
 * meski uangnya sudah masuk. `akses_tertahan` sama: terminal, dan "terminal"
 * justru yang lolos.
 */
export const KEJADIAN_BUTUH_TINJAUAN: readonly KejadianPesanan[] = [
  "selisih_nominal",
  "selisih_status",
  "lunas_setelah_tutup",
  "akses_tertahan",
  "penangan_belum_ada",
  // Pesanan sesi lunas yang sesinya tidak bisa lahir (bidan nonaktif, jam
  // kunjungan lewat, pengajuan berubah, atau galat): uang masuk, sesi belum.
  "sesi_tertahan",
];

/**
 * Label layar untuk setiap status. `Record` bertipe penuh, bukan
 * `Partial<Record<...>>`: nilai enum baru yang lupa diberi label akan
 * memerahkan kompilator, bukan merender string kosong di panel staf.
 */
export const LABEL_STATUS_PESANAN: Record<StatusPesanan, string> = {
  menunggu_bayar: "Menunggu pembayaran",
  ditahan: "Ditahan — perlu diputuskan",
  lunas: "Lunas",
  kedaluwarsa: "Kedaluwarsa",
  dibatalkan: "Dibatalkan",
};

/**
 * Tenggat pesanan, dalam jam. SATU konstanta untuk DUA tempat: kolom
 * `orders.kedaluwarsa_pada` dan `expiry` di payload Snap.
 *
 * Tagihan sesi memakai angka yang sama di SQL: `interval '24 hours'` di
 * `terbitkan_tagihan_sesi` (migrasi 20261113140100), dengan batas jam
 * kunjungan Jakarta — `least(now() + 24 jam, jam kunjungan)`. Pengikatnya uji
 * tenggat di `tests/tagihan-sesi-db.test.ts`, yang menghitung harapannya dari
 * konstanta ini.
 *
 * Dua angka yang boleh berbeda adalah dua kegagalan simetris. Kolom lebih
 * pendek: kita berhenti bertanya sementara VA-nya masih bisa dibayar, dan
 * settlement mendarat pada pesanan yang sudah kita tutup. Kolom lebih panjang:
 * penyapu menanyai DOKU tentang transaksi yang tak akan pernah berubah.
 */
export const JAM_TENGGAT_PESANAN = 24;

/**
 * Pembatas Lapis 1b: satu pesanan tidak pernah ditanyakan ke Status API lebih
 * sering dari sekali per lima menit (`orders.diperiksa_pada`). Tanpanya satu
 * halaman yang di-refresh berkali-kali berubah jadi banjir permintaan.
 */
export const MENIT_JEDA_PERIKSA = 5;

/**
 * Margin terhadap jam DOKU sebelum jawaban Check Status yang belum final
 * (invoice tidak ditemukan, PENDING, REDIRECT, TIMEOUT, FAILED) boleh dibaca
 * sebagai kedaluwarsa. Bukan perpanjangan tenggat: vonis tetap dari gateway,
 * dan waktu lokal hanya memutuskan kapan berhenti bertanya. Dulu
 * `JAM_TENGGANG_404`; namanya dinetralkan karena kini berlaku juga untuk
 * status non-final, bukan hanya 404.
 */
export const JAM_TENGGANG_TANPA_VONIS = 1;
