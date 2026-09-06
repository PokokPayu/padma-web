# Varian Layanan — Runbook Deploy & Utang Tindak Lanjut

**Ter-merge:** 7 September 2026, commit `8a3ca4b` (20 commit dari branch `varian-layanan`).
**Spec:** `docs/superpowers/specs/2026-09-06-padma-varian-layanan-design.md`
**Rencana:** `docs/superpowers/plans/2026-09-06-padma-varian-layanan.md`

Berkas ini menyimpan dua hal yang tidak tercatat di riwayat git: apa yang harus diketahui orang yang
men-deploy ini, dan utang yang sengaja ditunda dengan alasan tertulis.

## Runbook deploy — baca sebelum menerapkan ke produksi

**1. Migrasi dulu, lalu build, dalam satu jendela sesingkat mungkin.**
`sessions.variant_id` dan `booking_requests.variant_id` menjadi `NOT NULL`, dan `service_rates`
dijatuhkan. Tidak ada urutan yang bebas downtime.

- *Migrasi dulu (disarankan):* selama jendela itu kode LAMA masih hidup — landing, `/admin`, dan
  riwayat passport tetap bekerja; `/owner/tarif` merosot ke "—" di semua baris. Yang MATI: pengajuan
  jadwal klien, `jadwalkanSesi`, dan `konfirmasiPermintaan` — ketiganya menulis tanpa `variant_id`
  dan ditolak `23502`.
- *Build dulu:* semua di atas ditambah landing kehilangan harganya dan `/owner/tarif` gagal total.
  Lebih buruk.

Jadwalkan di jam sepi, dan beri tahu admin klinik bahwa "Jadwalkan sesi" dan konfirmasi permintaan
tidak bisa dipakai selama beberapa menit.

**2. Harga klinik menjadi terlihat di internet** begitu migrasi `20260906150000_harga_publik.sql`
diterapkan. Itu keputusan spec (V4) yang disengaja, bukan kebocoran. Honor mitra tidak ikut, dan dua
uji terpisah menjaganya.

**3. Katalog produksi harus diisi lengkap SEBELUM sesi berbayar pertama.**
Migrasi memberi setiap layanan lama satu varian baku berlabel kosong dan tarifnya terbawa apa adanya.
Tetapi 8 layanan + 22 varian pricelist asli **beserta honor mitranya** sengaja di luar ruang lingkup
(keputusan V10) — klien mengisinya lewat panel. Varian tanpa tarif disaring diam-diam dari landing,
dan sesinya jatuh "tak bertarif" di rekap owner. Layar `/owner/tarif` punya peringatan
"N varian aktif belum bertarif" yang harus dibaca sampai nol.

**4. `supabase/seed.sql` jangan pernah dijalankan di produksi.** Ia memuat
`update service_variants set aktif = false` untuk UUID seed pengembangan.

**5. `npm run test:e2e:owner` harus dijalankan pada basis data yang tidak dipakai checkout lain.**
`bersihkan()` menyapu berdasarkan awalan bersama `E2E-OWNR%`, jadi dua run yang bertumpang tindih
saling menghapus fixture di tengah jalan. Itu penyebab paling mungkin kegagalan langkah 5 yang
teramati saat pengembangan — bukan regresi varian; jalur tulis `honor_marks`
(`src/app/owner/rekap/aksi.ts`) tidak pernah disentuh branch ini.

## Utang tindak lanjut

Semua sudah ditriase review menyeluruh sebagai "boleh menyusul". Diurutkan menurut nilai.

| # | Utang | Kenapa ditunda |
|---|---|---|
| 1 | **Paginasi penuh untuk `harga_publik` di `lib/katalog.ts`.** Perbaikan sekarang memakai `.order("berlaku_sejak", desc)`, yang menjamin baris terbaru masuk 1000 pertama untuk kasus realistis (riwayat satu varian memanjang) tetapi BUKAN untuk skenario skew lintas-varian. `ambilTarif()` di `lib/owner/data.ts` sudah memakai paginasi `.range()` penuh — pola itu yang seharusnya ditiru. | Risiko sangat kecil pada skala puluhan layanan; solusi sekarang tepat menyasar mekanisme kegagalan yang nyata. |
| 2 | **`ambilSesi()` (`lib/passport/data.ts`) menarik seluruh `service_variants` tanpa paginasi.** Pemotongan senyap `max_rows` menjatuhkan label klien ke varian baku — mode kegagalan yang uji parity dibuat untuk menutup. Kerjakan bersama #1. | Sama: katalog nyata masih puluhan baris. |
| 3 | **Kartu sesi passport belum menyebut varian** (`app/passport/_komponen/kartu-sesi.tsx`). Dua sesi layanan sama, tanggal sama, varian dan harga berbeda tampak identik di riwayat. Medannya sudah ada di `SesiRingkas`. | `/passport/bayar` sudah menyebutnya, jadi klien punya satu layar yang membedakan. |
| 4 | **Uji `menghitung berapa sesi yang memakai tiap varian`** (`tests/admin-layanan.test.ts`) LULUS HAMPA — membandingkan 0 dengan 0. Hapus blok `sesiPerVarian` di `katalog-admin.ts` dan uji tetap hijau. Butuh fixture sesi ber-varian. | Utang mutu uji, bukan cacat perilaku. |
| 5 | **Resep label `"<layanan> · <varian?> · <tanggal>"` terduplikasi** di `lib/passport/turunan.ts` dan `lib/admin/tagihan.ts`. Perangkai `labelVarian()` tunggal; lapisan di atasnya tidak. | Parity dikunci uji huruf-demi-huruf di `admin-bayar.test.ts`, jadi perpisahan senyap sudah tertutup. |
| 6 | **Empat konvensi tampilan varian baku hidup berdampingan:** `"Varian baku (mengikuti nama layanan)"`, `"Standar"` (dua tempat), dan `label === "" ? namaLayanan : label`. | Kosmetik; tidak ada yang salah, hanya tidak seragam. |
| 7 | **`tests/varian-pasangan-layanan.test.ts` memilih pasangan dengan `order by s.nama limit 1`** — nondeterministik soal varian mana yang terpilih. Asersinya tetap sahih untuk pasangan mana pun (klausa `join` menjamin keduanya saling memiliki), yang hilang hanya reproduksibilitas laporan kegagalan. Tambahkan `, v.urutan, v.id`. | Kebenaran ujinya tidak terancam. |
| 8 | **Komentar `form-varian.tsx:18-25` membenarkan duplikasi dengan "lingkaran impor" yang TIDAK ADA** — `form-layanan.tsx` tidak mengimpor apa pun dari sana. Hapus alasannya, pertahankan keputusannya. | Tidak memengaruhi satu baris perilaku. |
| 9 | **Komentar di `tests/harga-publik.test.ts`** kehilangan alasan kenapa "besok" dipilih: (a) itulah yang diuji, (b) `variant_rates_unik_per_tanggal` menolak tanggal yang sudah dipakai seed. | Satu kalimat. |
| 10 | **Pesan `nonaktifkanVarian` menyesatkan untuk varian yang SUDAH nonaktif**; `perbaruiVarian` bersemantik ganti-penuh sehingga pemanggil parsial berikutnya menghapus medan tanpa error. | `update aktif=false` idempoten; satu-satunya pemanggil selalu mengirim keempat medan. |
| 11 | **Penjagaan klien saat seluruh varian sebuah layanan nonaktif** — tombol simpan tetap aktif, penolakan baru datang dari server. Kerjakan bersama #10. | Degradasinya sopan. |
| 12 | **`bersihkan()` di skrip e2e menyapu berdasarkan awalan bersama**, bukan stempel run — dua run yang bertumpang tindih saling menghapus fixture. | Lihat runbook #5. |

## Catatan proses yang layak diingat

Kegagalan yang paling mahal sepanjang pengerjaan bukan bug kode, melainkan **jaminan yang hilang
tanpa satu pun asersi berubah merah**. Empat kali terjadi, dan semuanya tertangkap review:

- uji backfill `booking_requests` yang selalu memulangkan array kosong;
- sebelas asersi money firewall yang menunjuk nama tabel yang sudah tidak mungkin ada;
- `not.toContain(string)` atas array objek sesudah sebuah tipe berubah — dan `tsc` tidak
  menangkapnya karena `toContain` menerima `unknown`;
- komentar yang menyatakan jaminan yang sudah tidak berlaku, dua kali, ke dua arah berlawanan.

Pola yang sama akan muncul lagi pada perubahan tipe atau penghapusan tabel berikutnya.
