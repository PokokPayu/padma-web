import { LABEL_JENJANG, type JenjangTransport } from "./jarak";

// ============================================================================
// TARIF TRANSPORT — "berlaku pada tanggal X", dihitung SEKALI untuk seluruh
// aplikasi
// ============================================================================
// Fungsi murni di berkas ini lahir di Task 8 (rate card transport owner),
// BUKAN di Task 9 (honor sesi) walau Task 9-lah yang membayarkan honornya.
// Alasannya: rate card owner (`ambilTarifTransport()` di `lib/owner/data.ts`)
// sudah lebih dulu perlu tahu "tarif jenjang mana yang SEDANG berlaku" untuk
// menandainya di layar — persis kebutuhan yang sama yang nanti dipakai
// honor sesi. Menuliskan aturan "berlaku_sejak terbesar yang ≤ tanggal" dua
// kali di dua berkas berbeda (satu di sini, satu lagi ditulis ulang dari nol
// oleh Task 9) akan melahirkan DUA DEFINISI yang berpisah diam-diam pada
// perubahan berikutnya — dan perpisahan itu berbentuk rate card yang
// menampilkan satu angka sementara honor mitra dibayarkan dengan angka lain.
// Task 9 karena itu WAJIB mengimpor fungsi ini, bukan menulis ulang.

export type TarifTransportRingkas = {
  id: string;
  jenjang: JenjangTransport;
  tarifKlien: number;
  honorMitra: number;
  berlakuSejak: string; // YYYY-MM-DD
};

/**
 * Jenjang yang boleh punya baris `transport_rates`.
 *
 * `di_atas_20` BERGABUNG di migrasi `tarif_dasar_di_atas_20`. Doktrin lama
 * (">20 km adalah KETIADAAN tarif, nominalnya per kasus di `transport_khusus`")
 * benar untuk masalah yang dilihatnya dan salah untuk yang belum terlihat:
 * `transport_khusus` berkunci `session_id`, sesi baru lahir sesudah lunas, dan
 * lunas menuntut tagihan yang tidak pernah bisa terbit. Setiap klien >20 km
 * tersangkut permanen.
 *
 * Yang berlaku sekarang: rate card memberi tarif DASAR supaya tagihan selalu
 * bisa terbit; `transport_khusus` tetap menimpanya per kasus bila owner
 * menetapkannya. Urutannya ditetapkan di SATU tempat —
 * `hitungTagihanPengajuan()` di `lib/tagihan/pengajuan.ts`.
 *
 * Konstanta ini menggerakkan layar owner (`/owner/transport` merender satu
 * kartu per anggota), penjagaan `simpanTarifTransport()`, dan daftar
 * "tarif belum ditetapkan" di `lib/owner/data.ts`. Menambah `di_atas_20` di
 * sini karena itu sekaligus memberi owner layar untuk menetapkannya.
 *
 * ===== KENAPA DITURUNKAN, BUKAN DITULIS ULANG (Ruling 26) =====
 * Sesudah `di_atas_20` bergabung, daftar ini beranggota IDENTIK dengan seluruh
 * enum `jenjang_transport` — dan daftar yang ditulis manual di sini akan
 * berpisah diam-diam dari enumnya pada anggota berikutnya yang lahir. Itu
 * bukan risiko teoretis: gerbang KEDUA di `simpanTarifTransport()`
 * (`app/owner/transport/aksi.ts`) yang dulu menolak `di_atas_20` sudah
 * DICABUT ATAS DASAR kedua daftar itu identik. Bila keduanya berpisah lagi,
 * yang hilang adalah satu-satunya penjaga yang tersisa.
 *
 * Diturunkan dari `LABEL_JENJANG` (`@/lib/transport/jarak`) — bukan dari
 * enumnya langsung, karena TypeScript tidak bisa menghitung anggota union
 * tipe pada waktu jalan. `LABEL_JENJANG` bertipe `Record<JenjangTransport,
 * string>`, jadi anggota enum yang lahir tanpa label akan ditolak KOMPILATOR
 * di berkas itu, dan daftar ini ikut lengkap tanpa disentuh. Urutan kunci
 * objek literal string non-numerik di JS adalah urutan penulisan, dan itulah
 * urutan terdekat-ke-terjauh yang dikunci
 * `tests/transport-alamat-struktur.test.ts`.
 */
export const JENJANG_TARIF_RATE_CARD: readonly JenjangTransport[] = Object.keys(
  LABEL_JENJANG,
) as JenjangTransport[];

/**
 * Tarif transport yang BERLAKU pada `tgl` untuk satu JENJANG: `berlaku_sejak`
 * terbesar yang masih ≤ `tgl`. Memulangkan `null` bila jenjang itu lebih tua
 * dari tarif paling awalnya — dan `null` itu WAJIB dilaporkan pemanggilnya,
 * bukan dijadikan 0.
 *
 * SEJAJAR PERSIS dengan `tarifPadaTanggal()` di `lib/owner/rekap.ts` (aturan
 * yang sama untuk tarif VARIAN) — pola perbandingannya sengaja ditulis ulang
 * di sini, bukan digeneralisasi jadi satu fungsi generik: tabel sumbernya
 * berbeda (`variant_rates` dikunci per `variantId`, `transport_rates` dikunci
 * per `jenjang`), dan memaksakan satu fungsi generik untuk keduanya hanya
 * memindahkan kerumitan ke pemanggil tanpa mengurangi risiko drift — risiko
 * driftnya justru sudah ditutup dengan cara lain: kedua fungsi ini SAMA-SAMA
 * jadi satu-satunya sumber kebenaran bagi domainnya masing-masing.
 *
 * Perbandingan tanggal = perbandingan string; keduanya YYYY-MM-DD sehingga
 * urutan leksikografis = urutan kronologis.
 */
export function tarifTransportPadaTanggal(
  tarif: readonly TarifTransportRingkas[],
  jenjang: JenjangTransport,
  tgl: string,
): TarifTransportRingkas | null {
  let terpilih: TarifTransportRingkas | null = null;
  for (const t of tarif) {
    if (t.jenjang !== jenjang) continue;
    if (t.berlakuSejak > tgl) continue;
    if (terpilih === null || t.berlakuSejak > terpilih.berlakuSejak) {
      terpilih = t;
      continue;
    }
    // Seri. UNIQUE (jenjang, berlaku_sejak) — `transport_rates_unik_per_tanggal`
    // — menolaknya di basis data untuk data yang lahir lewat peran API, tetapi
    // fungsi MURNI ini tidak boleh diam-diam bergantung pada urutan baris yang
    // dipulangkan pemanggilnya (fixture uji/service role tidak tunduk pada
    // constraint itu). Dipecah dengan `id` supaya hasilnya deterministik.
    if (t.berlakuSejak === terpilih.berlakuSejak && t.id < terpilih.id) {
      terpilih = t;
    }
  }
  return terpilih;
}
