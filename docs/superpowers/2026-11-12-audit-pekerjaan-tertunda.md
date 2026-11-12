# Audit pekerjaan tertunda PADMA

Diukur 12 Nov 2026 di `development` `71b7828`.

**Sumber yang diaudit:**
- 38 rencana di `plans/`
- 15 catatan `*-tindak-lanjut.md`
- `2026-09-07-ladder-geocoding-ditunda.md`
- ledger P4
- bagian ditunda / di luar cakupan dari 13 spec
- `web/README.md`
- `docs/landingpage-v2/`
- `documents/umpan-balik-klien/`

**Metode:** setiap butir dicocokkan dengan kode, migrasi, dan commit. Butir dianggap tertutup hanya kalau ada buktinya. Klaim yang paling berdampak di-spot-check ulang secara manual.

**Rujukan berkas:**
- Path kode relatif terhadap `web/`.
- Singkatan sumber:
  - `c1a`, `c1b`, `c1c`, `c2`, `c3a`, `tab`, `tag`, `fondasi`, `transport`, `varian`, `sapuan`, `e2e`, `owner` = `docs/superpowers/2026-09-0x-<nama>-tindak-lanjut.md`
  - `ledger` = `2026-10-06-padma-p4-ledger.md`

## 0. Rencana yang belum dieksekusi

Dari 38 rencana, 37 terbukti dieksekusi: berkas yang dijanjikan ada di repo, atau ada merge commit-nya. Beberapa migrasi yang tampak hilang ternyata hanya berganti nama atau cap waktu.

| Rencana | Status |
|---|---|
| **C3-b** klien batal/jadwal ulang dari Passport (`plans/2026-09-11-padma-c3b-mandiri-klien.md`) | Nol commit fitur. Harus ditinjau ulang oleh spec P3 (DOKU). |
| **C3-c** refund berbukti (`specs/2026-09-09-padma-c3-pembatalan-design.md` P9) | Belum ada rencana. Rinciannya di §2. |

## 1. Bug nyata (terverifikasi di kode)

| # | Bug | Bukti |
|---|---|---|
| B1 | Sesi yang dibuat admin lewat "+ Sesi baru" tidak menyalin alamat, sehingga Passport klien menampilkan "Tempat: —". Jalur konfirmasi permintaan menyalinnya. | `src/app/admin/sesi/aksi.ts` (insert tanpa `alamat*`) vs `20260909135000_konfirmasi_atomik.sql:94-103`; `passport/sesi/[id]/page.tsx:100` |
| B2 | View `sesi_menunggu_tarif_transport` hanya menyaring `dibatalkan_padma`. Sesi `dibatalkan_klien` >20 km ikut menyalakan alarm "menunggu tarif". Cacat ini diakui di komentar migrasi. | `20260914130000:92`, komentar :61-71 |
| B3 | Ambil produk gratis melewati gerbang persetujuan S&K. | `src/app/produk/[slug]/ambil.ts`: nol `persetujuan` |
| B4 | Tidak ada `error.tsx` di seluruh aplikasi. Satu galat baca memadamkan seluruh halaman, misalnya `/admin/klien/[id]` yang memuat riwayat pembelian di `Promise.all`. | `find src/app -name error.tsx` → 0 |
| B5 | Formulir sesi tidak menahan simpan saat seluruh varian sebuah layanan nonaktif. | `admin/sesi/form-sesi.tsx:115-116,326` (varian:66) |
| B6 | Teks UI basi menyuruh admin menekan tombol "Kelola isi" yang sudah dihapus. | `admin/materi/form-materi.tsx:118,158,227`, `aksi.ts:314,320` (e2e:126) |
| B7 | Geocoding yang gagal tersimpan permanen: tanpa TTL dan tanpa coba-lagi. "Tidak ditemukan" tidak dibedakan dari "gagal jaringan". | `lib/transport/geocode.ts:96-101,141-154` (transport:94) |
| B8 | Kontras `text-panel-muted` di atas `bg-panel-bg` hanya 4,41:1, di bawah AA 4,5:1. | `globals.css:27,31` (sapuan:191) |
| B9 | Palet klien lama di 12 berkas `/admin`, termasuk regresi di `/admin/klien/baru`. | `klien/form-klien.tsx:213,219,223` dan lainnya (sapuan:187, fondasi:78) |
| B10 | Baris "Transport · 0–5 km" tampil di Passport untuk jenjang yang gratis bagi klien. | `lib/passport/turunan.ts:213-216` (transport:103) |

## 2. Masuk cakupan P3 (pembayaran sesi lewat DOKU) — sudah dikirim ke sesi DOKU

- **Cron `/api/cron/tenggat` tidak pernah dijadwalkan.** Uji `pesanan-jadwal-actions.test.ts:91-96` sengaja melarangnya, karena menyalakannya membatalkan massal pengajuan lewat tenggat sejak September.
  - Akibatnya status `dibatalkan_tenggat` tidak punya penulis yang hidup.
  - Skrining klien tidak pernah dilepas, jadi klien harus skrining ulang.
  - Sumber: c2:120-128, Spec-C2:143-153.
- **Keputusan `tidak_hadir`:** apakah tetap ditagih? Kode sekarang menagihnya (`lib/jadwal/status.ts:260`). Poster klien menulis "dana tidak kembali", tapi dua dokumen masih menulis "keputusan belum diambil" (c1a:87-90, c3a:232-235).
- **Paket bundling:** ada 4 pertanyaan ke klien, termasuk kapan paket dianggap lunas. `PAKET_TAMPIL = false` (Spec-C1:301-327).
- **Ganti QRIS dari panel** (c1c:51-53) dan **pencocokan mutasi rekening** (c2:106-108): kemungkinan gugur dengan DOKU.
- **Tagihan:** D1-D4 belum diuji (tag:157-170). E2E `test:e2e:bayar` rusak (tag:251-266). Uji money-firewall tidak pernah membuka panel `?lihat=` (tab:101-102).
- **Data produksi yang belum dipastikan** (butuh izin untuk query):
  - bucket `bukti-bayar`
  - env Resend, `EMAIL_PENGIRIM`, DNS, `NEXT_PUBLIC_BASIS_URL`
  - tarif `di_atas_20`
  - pin koordinat mitra
- **Isi C3-c menurut spec** (13 butir):
  1. Tabel `permintaan_refund` (`diminta`/`terkirim`, rekening, bukti, diproses_oleh/pada).
  2. Rekening menempel pada permintaan, bukan profil klien.
  3. Rekening dikosongkan otomatis saat `terkirim`.
  4. Klien mengisi rekening di formulir pembatalan; ini bergantung pada C3-b.
  5. Untuk jenjang 4, Passport meminta rekening.
  6. Rekening boleh dikoreksi selama `diminta`.
  7. Bukti disimpan di bucket privat tanpa policy, dibuka lewat rute bertanda `requireRole` dengan `private, no-store`.
  8. Admin mencocokkan nama pemilik rekening sebelum transfer.
  9. Nol kolom nominal; besaran diturunkan.
  10. Panel admin menampilkan refund tertunda beserta umurnya.
  11. Cakupan: jenjang 1 (termasuk darurat medis) dan jenjang 4.
  12. Uji untuk butir 3, 6, dan 7.
  13. E2E: rekening lenyap sesudah `terkirim`.
- **Celah C3-c yang harus diputuskan:**
  - **"Angka refund dicatat"** bertentangan dengan larangan kolom nominal (P9) dan dengan allowlist money firewall. Presedennya ada: `order_items.harga_beku`.
  - **Premis "besaran = yang sudah dibayar"** berubah dengan DOKU, karena angkanya bisa dibaca dari transaksi gateway.
  - **Kapan baris refund lahir tidak dirinci.** Atomisitas menyarankan lahir dalam transaksi yang sama dengan pembatalannya.
  - **Status hanya dua:** tidak ada "ditolak" atau "transfer gagal".

## 3. Fitur yang dijanjikan atau ditunda, belum dibangun

| Fitur | Sumber | Catatan |
|---|---|---|
| Tombol cabut akses / beri akses manual produk digital | produk-digital spec:315-316,357-358 (Tahap 3) | Rem darurat kini hanya lewat service role |
| Halaman PADMA Learn, PADMA Live, PADMA Home | landingpage-v2/README.md:43 | Belum ditautkan di header |
| **Printable sheet** dijanjikan di situs, tidak ada di aplikasi | landingpage-v2/README.md:20; `page.tsx:60`, `digital-passport/page.tsx:33` | Situs menjanjikan fitur yang tidak ada |
| Produk digital di landing (permintaan klien #7) | produk-digital spec:18,264-268 | Bertentangan dengan aturan handoff "tanpa harga"; perlu keputusan |
| Riwayat skrining + menu skrining di Passport | c1b:135-142 | |
| Sertifikat otomatis per N kunjungan, PDF dari template | sertifikat spec:143-148 | Menunggu aturan klinik |
| Ekspor CSV / nota PDF penjualan | P4 spec:307-312 | Menunggu kolom dari akuntan |
| Hak subjek data UU PDP: hapus akun, anonimisasi, unduh data, riwayat persetujuan | S&K spec:515-520 | Di luar cakupan S&K |
| Akun/panel mitra (bidan), notifikasi penilaian rendah, kalender ketersediaan bidan | v1 spec:200, c1c:57-59, Spec-C3:264-267 | Fase 2 |
| Tombol darurat "bidan sudah berangkat" (>20 km) | Spec-C3:97-103 | Bersyarat |
| Jejak `jejak_permintaan`, pemeriksaan pra-sesi, promo | tab:154, Spec-C1:352-354 | |
| Lainnya di luar cakupan | P2, produk digital, produk berbab, panel daftar | Keranjang tamu, kupon, langganan, wishlist, rating produk, progres tonton, beli per materi, urut kolom, aksi massal |

## 4. Rilis & tindakan manual (di luar yang sudah diketahui)

- **Fluid Compute** wajib menyala di Vercel. Kalau mati, build gagal karena `maxDuration = 240` (README:447-450).
- **Konfirmasi region Supabase produksi.** Kebijakan privasi menulis "Singapura", sedangkan spec backup menyebut Seoul (S&K spec:477-479).
- **Tiga prasyarat rilis S&K:** uji asap insert `persetujuan_akun` di produksi, beri tahu klien PADMA, daftarkan URL S&K/KP di dasbor gateway dan OAuth Google (S&K spec:486-495).
- **Empat pertanyaan terbuka S&K:**
  1. Lama refund.
  2. Usia minimal 18.
  3. Waktu tanggap 3×24 jam.
  4. Persetujuan skrining yang diisikan orang lain.
- **Langkah Fase 2 deploy yang tidak terlihat dari repo**, minta pemilik memastikan:
  - hapus proyek Seoul;
  - rotasi R2;
  - SMTP Resend dan batas `email_sent`;
  - R2 `AllowedOrigins` dan URL Auth;
  - `nomor_wa`, tarif transport, dan katalog asli;
  - uji asap dua jalur akun.
- **Risiko yang diterima sadar:** ketentuan Vercel Hobby melarang pemakaian komersial (deploy spec:41-45). Migrasi produksi masih manual.
- **`materi-video.e2e.ts` belum pernah dijalankan**, karena menulis ke bucket R2 klien (e2e:52-94).

## 5. Utang teknis (dikelompokkan)

- **Tanpa CI sama sekali.** Workflow hanya `backup-db` dan `rekonsiliasi-pesanan`. Tidak ada `tsc`, vitest, maupun e2e di CI (e2e:142-144, ledger R21).
- **Pemotongan senyap `max_rows = 1000`.** Kueri tanpa `.range()` di:
  - `mitra.ts:109-113,143-151`
  - `klien.ts:80-105`
  - `layanan.ts:66-71`
  - `katalog-admin.ts:129-178`
  - `tagihan.ts:135,141,323-332`
  - `katalog.ts:104-108`
  - `passport/data.ts:174-221`
  - `owner/data.ts:212-375`
  - `daftar-tarif.ts:60`
  - `daftar-rekap.ts:50`
  - `owner/transport/page.tsx:55`
  - `penilaian.ts:142`
  - `admin/penjualan/page.tsx:88`
  - Sumber: fondasi:74, sapuan:184, varian:56-57, owner #3/#5, c1a:181, c1c:60-62.
- **Saringan per halaman, bukan per daftar:** "punya paket" (`klien.ts:150-174`) dan `isi=belum` di Materi (`materi-admin.ts:291-334`).
- **Uji hampa atau lemah:**
  - jumlah sesi per varian (`admin-layanan.test.ts:521-535`)
  - `owner-transport.test.ts:189,210-211`
  - `varian-pasangan-layanan` nondeterministik
  - pagar identitas melewatkan `.not(...)`
  - negatif `paket-tersembunyi` mungkin masih hampa (`:273`)
  - uji B1-B3 permintaan (tab:41-48)
  - uji radius dan aturan tayang produk berbab (produk-bab spec:441-443)
  - 13 rute `/admin` di luar crawl `owner.e2e` (e2e:296-312)
- **Mutu kode:**
  - `pilihanMitra()` dan query clients membuang `error`
  - helper `amankanKataCari` belum ada (regex tersalin di 8 modul)
  - `potongHalaman` belum ada
  - `hal` dijepit di dua tempat
  - resep label varian terduplikasi
  - `PanelPermintaan` 278 baris
  - `tungguGiliran()` geocode per proses
  - rate limit skrining per proses
  - seed idempoten hanya per hari
  - ~48 berkas uji terikat UUID seed
- **Keputusan UI yang menggantung:**
  - label `KelompokSaring` tidak dirender
  - saringan tanggal Sesi berupa preset, bukan rentang (menyimpang dari K3)
  - saringan hasil skrining di URL
  - tombol "+ baru" tidak seragam
  - konvensi varian baku tiga bentuk
  - koreksi `transport_khusus` satu arah
  - transport sesi berpaket ditanggung PADMA
  - tarif tidak bisa retroaktif
  - kartu Passport belum menyebut varian
- **P4 minor:** 20 butir dari ledger (`bulan.ts`, `hitung`, `baca`, `/owner/penjualan`, `/admin/penjualan`, riwayat klien). Sudah termasuk pagar nominal di detail klien yang akan merah begitu fixture punya pembelian.
- **Dokumen basi:**
  - README `/`, `/produk`, `/admin/produk`, dan "keenam skrip"
  - deploy spec :352 tentang lupa-sandi
  - judul ladder:116
  - e2e:377
  - daftar sapuan:187
  - transport runbook #2

## 6. Tidak pasti (butuh data produksi atau konfirmasi manusia)

- Katalog 8 layanan + 22 varian, honor, dan rate card transport di produksi (transport:14-17, varian:30-35, c1a:184-185).
- Checklist manual yang tidak tercatat pernah dijalankan: tab:17-33, rencana ubah-permintaan (10 butir), tag:174-204, transport:109-112, sertifikat spec:162-163.
- Ukuran gambar fase/alasan di bawah minimum handoff, padahal sudah dipotong lingkaran atas pilihan pemilik.
- Logo vektor dari klien belum ada.
