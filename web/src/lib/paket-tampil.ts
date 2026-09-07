/**
 * SAKLAR TAMPILAN PAKET (spec 8 Sep 2026, keputusan K11).
 *
 * Klien meminta seluruh tampilan paket hilang dari layar klien maupun staf
 * selama pertanyaan tentang paket bundling masih terbuka — terutama catatan
 * klien 6 September: "beli 1 paket isinya beberapa layanan, tapi yang beli 1
 * orang, penjadwalannya bagaimana?"
 *
 * Kenapa saklar dan bukan pembongkaran: paket menyentuh 31 berkas sumber dan
 * 27 berkas test. Membongkarnya berarti menulis ulang 27 test yang sudah hijau
 * supaya hijau lagi dalam bentuk lain — kerja besar yang hasilnya tak terlihat
 * siapa pun, untuk keadaan yang SEMENTARA. Dengan saklar, menyalakan KODENYA
 * kembali adalah satu baris di berkas ini — tapi itu bukan seluruh ongkos
 * menyalakan ulang, dan berkas ini sebelumnya berbohong soal itu. Sisa
 * ongkosnya, supaya siapa pun yang menyalakan saklar ini tahu persis apa yang
 * masih harus dikerjakan tangan:
 *
 *   1. `src/app/_landing/passport-teaser.tsx` menulis ulang tiga string
 *      TANPA memeriksa `PAKET_TAMPIL` sama sekali (halaman publik — lihat
 *      komentar di berkas itu untuk alasannya: copy pemasaran yang berubah
 *      sendiri mengikuti feature flag lebih buruk daripada copy yang jujur
 *      hari ini). Menyalakan saklar TIDAK mengembalikan copy paket di teaser;
 *      itu perlu disunting manual, dan illustrasinya dirancang ulang dari
 *      awal (baris "Paket aktif" & "Progres · x dari y sesi" sengaja diganti
 *      "Sesi berikutnya" & "Sejak").
 *   2. Tujuh berkas test menulis assertion yang HANYA benar selagi saklar ini
 *      mati, dan akan merah begitu `PAKET_TAMPIL` bernilai true —
 *      `tests/paket-tersembunyi.test.tsx`, `tests/admin-klien.test.ts`,
 *      `tests/admin-bayar.test.ts`, `tests/admin-layanan.test.ts`,
 *      `tests/admin-shell.test.ts`, `tests/passport-bayar-ajukan.test.ts`,
 *      dan `tests/passport-beranda.test.ts`. Ketujuhnya perlu dibalik tangan
 *      demi tangan sebelum suite hijau lagi dengan saklar menyala.
 *
 * Yang TIDAK disentuh saklar ini: tabel `packages` & `client_packages`,
 * seluruh RLS-nya, server action-nya, dan pagar uang. Data paket tetap utuh;
 * yang hilang hanya jalan menuju layar.
 */
export const PAKET_TAMPIL = false;
