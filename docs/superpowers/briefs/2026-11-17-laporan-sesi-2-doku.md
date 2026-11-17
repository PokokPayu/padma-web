# Laporan sesi 2: DOKU menggantikan Midtrans + P3 tagihan sesi

Untuk: sesi utama (`padma-c3`) dan pemilik repo. Laporan ini menjawab §8 brief
`2026-11-12-tugas-sesi-2-doku.md`. Ditulis 17 Nov 2026.

**Status:** selesai dan siap di-merge oleh sesi utama. Belum di-push dan belum
di-merge ke `development` atau `main`.

## 1. Branch dan verifikasi

- Branch `feat/doku`, worktree `.worktrees/doku`. Pangkalnya `bf0195d` di
  `development`, dengan `development` sudah di-merge masuk sekali di `7f04d71`.
- Spec: `docs/superpowers/specs/2026-11-12-padma-doku-design.md`, disetujui
  pemilik 13 Nov.
- Rencana: `docs/superpowers/plans/2026-11-13-padma-doku-a-gateway.md`
  (A1–A12) dan `…-b-tagihan-sesi.md` (B1–B8).
- **Verifikasi akhir.** Instans lokal `web-doku` (port 547xx) dibangun ulang
  dari nol dengan `db reset --local` atas izin pemilik, lalu `seed:users`.
  Hasilnya:

  | Pemeriksaan | Hasil |
  |---|---|
  | `tsc` | 0 galat |
  | lint | 0 galat, 13 peringatan bawaan |
  | build | OK |
  | vitest | 4068 lulus, 6 gagal: hanya `materi-video-r2` ×6, merah bawaan karena R2 placeholder |
  | e2e `test:e2e:bayar` | 21/21, memakai kunci DOKU tiruan |

  Empat e2e basi lain tetap di luar cakupan.
- **Review.**
  - Tiap tugas direview satu per satu.
  - Seluruh branch direview oleh dua reviewer paralel, satu untuk gateway dan
    satu untuk P3, karena diff-nya 1,4 MB.
  - Sesudah itu ada dua putaran perbaikan, masing-masing diikuti review ulang
    yang terarah.
  - Vonis akhir: siap merge, 0 Critical dan 0 Important.

## 2. Commit (urut lama → baru)

- `f116791` docs(spec): pembayaran PADMA lewat DOKU — tukar gateway + P3 tagihan sesi
- `7f04d71` Merge branch 'development' into feat/doku
- `8dc0301` docs(rencana): rencana A (tukar gateway DOKU) dan B (P3 tagihan sesi)
- `de80bdf` feat(doku): format invoice alfanumerik dan himpunan status DOKU
- `4811ba0` feat(pesanan): kolom netral-gateway dan catat_tautan_gateway
- `3bd7e44` feat(pesanan): terapkan_notifikasi_gateway dengan pemetaan DOKU dan penutupan cacat lunas-setelah-tutup
- `cca7fc8` fix(pesanan): tandai SUCCESS percobaan lain pada pesanan lunas sebagai kemungkinan bayar ganda
- `911840d` feat(doku): konfigurasi dan tanda tangan non-SNAP
- `b1ddb03` feat(doku): adapter Checkout & Check Status, penerbit tautan bayar
- `3b55faa` test(doku): bukti merah untuk uji A6, pesan tenggat persis, menit tanpa angka mati
- `1d5d0ee` feat(doku): webhook notifikasi pembayaran
- `2160d30` test(doku): perkuat uji webhook — batas 16 KB persis, galat kueri, FAILED menunggu_bayar
- `ef7371c` feat(doku): checkout produk mengarah ke halaman bayar DOKU
- `4b9f2ce` fix(doku): 200 tidak lagi membakar invoice; tombol terkunci sesudah alihan
- `7d5bfe8` feat(pesanan): rekonsiliasi memakai Check Status DOKU
- `c535851` refactor(doku): mencabut Midtrans dari kode, env, uji, dan README
- `ba2c6c2` fix(doku): uji untuk invarian P1 yang tercecer, label "ditahan" akurat, sisa Snap/Midtrans
- `2286e5d` docs(hukum): DOKU sebagai pemroses pembayaran; S&K pembayaran sesi lewat DOKU
- `4e37398` docs(spec): jawaban sandbox K7/K11, customer tidak wajib
- `14b1756` docs(spec): jawaban sandbox K6 (invoice ganda)
- `203efe2` feat(pesanan): jenis pesanan dan satu pesanan terbuka per pengajuan
- `f18c059` test(pesanan): penjaga deterministik atas definisi buat_pesanan_keranjang
- `a148035` feat(tagihan): tagihan sesi menjadi pesanan beku dengan harga dihitung di SQL
- `5c46388` fix(tagihan): kunci uang lewat jejak, urutan kunci pesanan->pengajuan, tolak total Rp0
- `8e3fb53` feat(sesi): lunas DOKU melahirkan sesi otomatis lewat penyalur tertutup
- `ff720ab` test(sesi): penggulungan sesudah tulisan dan urutan kunci penyalur dibuktikan
- `e06d123` feat(tagihan): pembatalan, ganti bidan, dan penjaga pengajuan bertagihan
- `48883ae` fix(tagihan): baris warisan beruang terkunci masukan harganya; tanpa geocode ulang saat menunggu_bayar
- `21227db` feat(admin): layar tagihan sesi tanpa nominal, penanda kabari bidan, jenis Sesi di pesanan
- `8cc0d98` fix(admin): panel ?lihat= terbuka lewat id, baris warisan tanpa WA, kalimat kebijakan, konfirmasi batal
- `1477130` feat(passport): bayar tagihan sesi lewat DOKU dari Digital Passport
- `c458c9b` refactor(tagihan): pensiunkan QRIS pengajuan, cron tenggat, dan rumus harga TS
- `31d109d` test(e2e): bayar-pengajuan lewat alur DOKU
- `f39b71e` docs(spec): §5.5 mencatat tinjauan bayar ganda lewat percobaan basi
- `38d942d` fix(gateway): bayar ganda dibandingkan dengan percobaan pelunas (F1)
- `471124d` fix(rekonsiliasi): percobaan lama dan pesanan tertutup ikut ditanyakan (F2)
- `33b377b` fix: perbaikan murah sebelum rilis (F3.1–F3.6)
- `3188ed2` test+docs: himpunan status SQL terikat ke TS; runbook warisan buntu; catatan spec (rekomendasi 8–10)
- `187241b` docs(rekonsiliasi): kasus terburuk anggaran Lapis 1b ditulis benar (≈40 s)
- `84797a7` fix(gateway): SUCCESS percobaan yang sudah tercatat tidak menandai lunas_setelah_tutup dua kali (I2)
- `ec05cf7` fix(rekonsiliasi): hanya vonis tutup yang menutup pesanan; sapuan tidak mengulang uang tercatat; kode cacat ditandai (I1, I2, M5)
- `3bac3c9` docs: penjadwal Lapis 3 wajib untuk rilis; celah M1/M2/M4 dicatat (M3, spec §5.6)
- `1244b41` docs(rekonsiliasi): dua komentar basi sesudah putaran 2
- (commit laporan ini)

## 3. Migrasi baru, berurutan

Semua berada sesudah `20261113100000` milik `development`.

1. `20261113130000_kolom_gateway_netral.sql`
2. `20261113130100_terapkan_notifikasi_gateway.sql`
3. `20261113130200_hapus_midtrans.sql`
4. `20261113140000_pesanan_jenis.sql`
5. `20261113140100_terbitkan_tagihan_sesi.sql`
6. `20261113140200_kejadian_sesi.sql`
7. `20261113140300_salurkan_sesi.sql`
8. `20261113140400_penjaga_pengajuan.sql`
9. `20261113140500_item_staf_pengajuan.sql`
10. `20261113140600_tagihan_sesi_saya.sql`
11. `20261113140700_pensiun_tenggat.sql`
12. `20261113140800_rekonsiliasi_percobaan_tutup.sql`

Catatan:

- `20261113140800` disunting di tempat pada putaran perbaikan kedua. Ia belum
  pernah keluar dari worktree dan hanya pernah diterapkan ke `web-doku`, lalu
  dibangun ulang dari nol. Kalau ada lingkungan lain yang sempat menerapkannya
  dari worktree ini, terapkan ulang dari versi final.
- Urutan penerapan di produksi, bersama migrasi lain yang menunggu (termasuk
  ranjau `pekan_sabtu_jumat`), adalah wewenang sesi utama: README Fase 3
  butir 5.
- Jangan pakai `db push`.

## 4. Perlu konfirmasi DOKU (spec §4.3)

| # | Pertanyaan | Keadaan |
|---|---|---|
| K1 | Kapan QRIS menjadi Active | Terbuka. Pemilik melapor **akun DOKU produksi siap** pada 17 Nov; jawaban rincinya belum masuk spec |
| K2 | Checkout tersedia, dan QRIS tampil di Checkout | Terbuka. Ini penghalang terbesar: bila "tidak", adapter harus pindah ke Direct API (SNAP) |
| K3 | Satu Notification URL atau satu per grup kanal | Terbuka. Pasang di **setiap** grup kanal |
| K4 | Bisakah satu invoice SUCCESS dua kali | Terbuka. **Sengaja tidak ditandai** (Ruling B14): satu invoice yang dibayar lewat dua halaman DOKU belum memicu tinjauan |
| K5 | SUCCESS sesudah `payment_due_date` | Sudah tertangkap sebagai `lunas_setelah_tutup` |
| K6 | Pemakaian ulang `invoice_number` | **Terjawab di sandbox:** duplikat diterima, nominal terakhir yang menang. Perilaku produksi belum diukur |
| K7 | Check Status untuk invoice tak dikenal, dan rate limit-nya | **Terjawab sebagian di sandbox:** HTTP 404 `{error}`. Rate limit belum diukur |
| K8 | Kapan pengiriman ulang webhook berhenti, timeout, daftar IP | Terbuka |
| K9 | Format notifikasi untuk kanal "VA SNAP" | Terbuka; relevan bila VA dinyalakan |
| K10 | Notifikasi kedaluwarsa Checkout | Jangan dinyalakan. Rekonsiliasi F2a bergantung pada fitur ini **mati** (spec §5.6 M4) |
| K11 | `auto_redirect` wajib atau tidak | **Terjawab di sandbox:** tidak wajib |
| K12 | Batas atas `payment_due_date` | Terbuka; kita mengirim ≤ 1440 menit |
| K13 | Cakupan Cancel Order API | Terbuka; desain tidak bergantung padanya |
| K14 | Apakah `order.status` aktif | Terbuka; opsional |

## 5. Langkah go-live yang butuh tangan manusia (README Fase 3)

1. **DOKU.** QRIS Active (K1), Checkout dikonfirmasi tersedia (K2), dan jawaban
   email DOKU dimasukkan ke spec.
2. **Sandbox.** Bayar lewat simulator DOKU di **deploy preview Vercel** (ngrok
   dilarang DOKU). Pastikan webhook mengubah pesanan produk **dan** pesanan
   sesi. Langkah ini belum pernah dilakukan dan butuh login Back Office.
3. **Back Office produksi.**
   - Notification URL `https://<domain>/api/pembayaran/doku` dipasang di setiap
     grup kanal.
   - Recover Abandoned Cart **mati**.
   - Notifikasi kedaluwarsa **jangan** dinyalakan.
4. **Env Vercel Production.**
   - Isi `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_PRODUKSI=true` (harus
     persis `true`), `NEXT_PUBLIC_BASIS_URL`, dan `CRON_SECRET`.
   - Tidak boleh ada env Midtrans yang tersisa.
   - Fluid Compute tetap menyala (`maxDuration` 240).
   - Kunci produksi **hanya** di Vercel, tidak di `.env.local` mana pun.
5. **Migrasi.** Backup produksi dulu, lalu buktikan bisa dipulihkan. Terapkan
   migrasi dengan sengaja; urutannya ditentukan sesi utama. Tidak `db push`.
6. **Peralihan (spec §7).**
   - Baris warisan QRIS diputuskan admin satu per satu.
   - Tidak ada pembatalan massal.
   - Ada runbook untuk dua jenis baris warisan yang buntu.
   - Jumlah baris warisan diukur dengan query agregat produksi, hanya atas izin
     pemilik.
7. **Penjadwal Lapis 3 wajib.** Hidupkan blok `schedule` di
   `.github/workflows/rekonsiliasi-pesanan.yml`; saat ini masih dikomentari.
   Pasang juga `CRON_SECRET` di GitHub Secrets, lalu hapus uji penanda
   `it("blok schedule LAHIR DIKOMENTARI")`. **Sampai penjadwal hidup,
   pesanan yang sudah ditutup tidak direkonsiliasi sama sekali.**
8. **Teks hukum.** S&K dan Kebijakan Privasi menyebut DOKU dan butuh review
   hukum. Pemilik juga memutuskan kenaikan `VERSI_DOKUMEN`.
9. **Rotasi kunci** bila Secret Key pernah terpapar.

Sesudah go-live, uji asap produksi dengan satu transaksi kecil sungguhan untuk
mengukur K4 dan K6 di produksi.

## 6. Residu yang diterima (tidak diperbaiki; tercatat di spec §5.6 atau di sini)

- **M1.** Pesanan percobaan-1 yang `catat_tautan_gateway`-nya gagal tidak ikut
  disapu. Penyebab gagalnya: race P0002 dengan terbit ulang staf, atau penolakan
  non-https.
- **M2.** Pesanan `lunas` tidak disapu. Bayar kedua di percobaan lain yang
  webhook-nya hilang tetap senyap. Celah ini sudah ada sebelum branch.
- **M4.** EXPIRED lewat webhook melewati F2a. Aman selama K10 mati.
- Pesanan terbuka yang satu percobaan lamanya tak pernah terjawab akan tetap
  `menunggu_bayar` tanpa tanda staf; ia hanya muncul di hitungan `dilewati`.
  Klien masih bisa membatalkannya.
- Urutan "SUCCESS dulu" di F2a dihapus bersamaan dengan "berhenti pada galat
  pertama". Saat ini tidak ada galat persisten yang realistis.
- Staf masih bisa PATCH langsung `menunggu_bayar → dikonfirmasi`. Tidak ada UI
  untuk itu, dan hasilnya tanda `sesi_tertahan`, bukan kegagalan senyap.
- Kueri "dipantau" `/admin/pesanan` dibatasi 200 baris. Batas ini sudah ada
  sebelum branch; pesanan sesi membuatnya lebih cepat penuh.
- 404 sesudah klien membayar pengajuan yang sudah dibatalkan. Sesuai spec
  ("seperti sekarang").
- Minor lain hasil triase review akhir ada di ledger SDD. Tidak satu pun
  menyentuh uang.

## 7. Keputusan pemilik dalam sesi ini

- C3-b dan C3-c **ditunda ke sesudah rilis DOKU** (13 Nov). Spec §6.9 hanya
  mencatat penyesuaiannya.
- Refund tetap manual, dan jalur 2 (sesi jadwal admin) tidak berubah.
- `db reset --local` di `web-doku` diizinkan (17 Nov).
- Akun DOKU produksi siap (17 Nov).

## 8. Insiden proses

- **16 Nov.** Dua sesi controller sempat mengerjakan B7 bersamaan di worktree
  yang sama. Pemilik memilih sesi ini dan sesi lain dihentikan. Worktree
  dirapikan sebelum B7 di-commit.
- **17 Nov sekitar 00:47 WIB.** Implementer B8 sekali menjalankan
  `pkill -f vitest`. Perintah itu bisa ikut menghentikan vitest sesi lain di
  mesin ini, misalnya `src/pos` proyek lain. Tidak diulang sesudah ditegur.
