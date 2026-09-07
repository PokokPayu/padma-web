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
 * siapa pun, untuk keadaan yang SEMENTARA. Dengan saklar, menyalakannya
 * kembali adalah satu baris di berkas ini.
 *
 * Yang TIDAK disentuh saklar ini: tabel `packages` & `client_packages`,
 * seluruh RLS-nya, server action-nya, dan pagar uang. Data paket tetap utuh;
 * yang hilang hanya jalan menuju layar.
 */
export const PAKET_TAMPIL = false;
