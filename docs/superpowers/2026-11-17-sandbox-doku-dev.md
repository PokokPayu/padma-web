# Lingkungan uji sandbox DOKU di proyek dev

Ditulis 17 Nov 2026, lalu dikoreksi pada hari yang sama sesudah arsitektur
Vercel yang sebenarnya diketahui. Ini rincian langkah 1.5 runbook rilis
(`2026-11-17-runbook-rilis.md`) dan prasyarat README Fase 3 langkah 2 (uji asap
sandbox).

## Arsitektur yang sebenarnya

Draf pertama dokumen ini mengira dev memakai deploy *preview* dari proyek Vercel
produksi. Kenyataannya, produksi dan dev adalah **dua proyek Vercel terpisah**:

| | Proyek Vercel | Branch yang dibangun | Supabase | Akses |
|---|---|---|---|---|
| Produksi | proyek produksi (domain `padmawellnessid.com`) | `main` | `vtprvvwslclyqlunzuvj` | publik |
| Dev | `padma-web-16ot`, URL `https://padma-web-16ot.vercel.app` | `development`, sebagai deploy "Production" proyek dev | `mdtzrzwapuaalmsxomkm` (dev) | **publik, tanpa proteksi** |

Diverifikasi 17 Nov dari luar:
- Bundel JavaScript deploy dev memuat `mdtzrzwapuaalmsxomkm.supabase.co` dan
  tidak memuat ref produksi.
- `/persetujuan` ada, artinya kode `6c2a6ec` sudah ter-deploy.

Karena itu env dev hidup di scope **Production milik proyek dev**. Spec deploy
§6 ("env tidak dipasang di scope Preview") tetap berlaku untuk proyek
produksi dan tidak dilanggar.

## Prinsip

- **Kunci produksi tidak pernah masuk proyek Vercel dev.** Ini berlaku untuk
  Supabase produksi, DOKU produksi, R2 produksi, dan Resend.
- **Dev berisi data sintetis saja.** Dibangun dari migrasi
  (`supabase db reset --linked`, 17 Nov), bukan dari dump produksi.
- **Deploy dev publik.** Sandi seed `padma-dev-123` tertulis di repo publik
  (`scripts/seed-users.ts`), jadi sandi ketiga akun uji di dev **diganti ke
  nilai acak** pada 17 Nov.
  - Sandi barunya ada di `web/.env.akun-dev`, berkas lokal yang di-gitignore
    dengan mode 600.
  - Menjalankan ulang `npm run seed:users` ke dev mengembalikan sandi ke nilai
    publik, jadi sesudahnya sandi harus diganti lagi.
- **Repo tertaut ke dev** (`web/supabase/.temp/project-ref` =
  `mdtzrzwapuaalmsxomkm`). Setiap perintah `--linked` diawali pemeriksaan ref
  itu.

## Status per 17 Nov

| # | Langkah | Status |
|---|---|---|
| 1 | Proyek Supabase dev dihidupkan | Selesai (pemilik) |
| 2 | Dev di-reset: 116 migrasi, `seed.sql`, dan `seed:users`; isi sebelumnya hanya data sintetis | Selesai (agen, dengan izin) |
| 3 | `development` di-push (`6c2a6ec`), deploy dev Ready | Selesai |
| 4 | Sandi akun uji dev diganti | Selesai (agen) |
| 5 | Env proyek Vercel dev dipasang lewat REST API (token Vercel 1 hari dari pemilik), lalu redeploy | Selesai (agen) |
| 6 | Supabase dev → Auth: `site_url` dan `uri_allow_list` lewat Management API | Selesai (agen) |
| 7 | Notification URL di Back Office DOKU sandbox | Selesai untuk **QRIS saja** (pemilik, 17 Nov). URL notifikasi dipasang **per channel**, jadi channel lain di halaman Checkout tidak mengirim webhook; uji hanya dengan QRIS |

**Fakta Back Office yang terkonfirmasi** (dokumentasi resmi, dibaca 17 Nov):
- **Lokasi URL notifikasi:** Settings → Payment Settings, per channel
  (mis. QR Payment → QRIS Settings → Edit; Virtual Account → Configure), atau
  di halaman Webhook versi baru (Settings → Payment Settings → Webhook).
  Sumber: https://docs.doku.com/get-started/manage-business/set-up-integration/webhook-payment-notification
- **URL harus publik;** URL yang dilindungi login ditolak.
  Sumber: https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url
- **Simulator:** login `https://sandbox.doku.com/bo/login` → Settings →
  Payment Settings → **Simulator** → pilih metode yang sama dengan yang dipilih
  di Checkout → **Simulate**.
  Sumber: https://docs.doku.com/get-started/manage-business/set-up-integration/simulate-transactions
- **Belum dijelaskan dokumentasi:** apakah simulasi memicu notifikasi HTTP. Uji
  ini yang menjawabnya.
- **Untuk produksi** (runbook 2.8): URL notifikasi wajib dipasang di **setiap**
  channel yang aktif di Checkout. Channel yang terlewat hanya tertolong
  Lapis 1b/3.

**Isi langkah 5:**
- Env baru: `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY` (sensitive), dan
  `DOKU_PRODUKSI=false`. Kunci diambil dari env worktree DOKU, yang
  `DOKU_PRODUKSI`-nya `false`.
- Env baru lainnya: `CRON_SECRET` (sensitive; salinannya di
  `web/.env.akun-dev`) dan `PADMA_PROXY_TEPERCAYA=1`.
- Diperbaiki: `NEXT_PUBLIC_BASIS_URL`, yang sebelumnya
  `padma-web-16ot.vercel.app` **tanpa `https://`**. `urlKembali()`
  (`src/lib/doku/konfig.ts:55`) menyambung nilainya apa adanya, sehingga URL
  kembali dari DOKU menjadi relatif. Nilai produksi wajib diawali `https://`.

**Bukti sesudah redeploy:**
- webhook `POST {}` → `400 skema_gagal`, sebelumnya `503 kunci_kosong`;
- cron tanpa rahasia → 401;
- cron dengan rahasia → `200 {"diperiksa":0,"dilewati":0}`.

**Temuan yang belum ditindak** (keputusan pemilik):
- Proyek dev memegang `R2_*` dan `RESEND_API_KEY`. Nilainya bertipe
  sensitive dan tidak terbaca.
- Bila `R2_BUCKET_VIDEO` sama dengan bucket produksi klien, unggahan dari dev
  mendarat di bucket klien.
- Resend dari dev mengirim ke alamat `@padma.test` yang tidak ada. Pantulannya
  merusak reputasi domain pengirim.

## Yang tersisa untuk pemilik

1. ~~Env proyek Vercel `padma-web-16ot`~~ **selesai 17 Nov** (lihat status di
   atas). Tabel ini tetap sebagai acuan bila proyek dev dibangun ulang.

   | Variabel | Nilai |
   |---|---|
   | `DOKU_CLIENT_ID` | Client ID **sandbox** |
   | `DOKU_SECRET_KEY` | Secret Key **sandbox** |
   | `DOKU_PRODUKSI` | `false` |
   | `NEXT_PUBLIC_BASIS_URL` | `https://padma-web-16ot.vercel.app` |
   | `CRON_SECRET` | nilai acak, **beda** dari produksi |
   | `PADMA_PROXY_TEPERCAYA` | `1` |
   | `NOMINATIM_USER_AGENT` | sama dengan produksi |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | sudah menunjuk ke dev (terverifikasi) |

   **Sengaja kosong:**
   - `R2_*`, supaya tidak menulis ke bucket klien;
   - `RESEND_API_KEY` dan `EMAIL_PENGIRIM`, karena tagihan tetap terbit tanpa
     email.
2. ~~Supabase dev → URL Configuration~~ **selesai 17 Nov.**
3. **Back Office DOKU sandbox:**
   - Notification URL = `https://padma-web-16ot.vercel.app/api/pembayaran/doku`.
     Tanpa parameter apa pun, karena deploy dev publik dan tidak butuh bypass
     proteksi;
   - Recover Abandoned Cart mati.

Cara memeriksa langkah 1 sesudah redeploy: `POST {}` ke webhook harus berubah
dari `503 kunci_kosong` menjadi galat validasi (400). Agen bisa menjalankan
probe ini.

## Skenario uji asap

Akun dan sandinya ada di `web/.env.akun-dev`.

| Skenario | Langkah | Yang dibuktikan |
|---|---|---|
| A. Produk digital | Seed tidak membuat produk digital, jadi buat dulu satu: `admin@padma.test` di `/admin/produk`, harga ditetapkan `owner@padma.test` di `/owner/produk`, lalu tayangkan. Sebagai `ananda@padma.test`: setujui S&K, buka `/produk/<slug>`, Beli, bayar di simulator DOKU sandbox | Checkout menerbitkan tautan; webhook mengubah pesanan menjadi lunas; akses terbit di `/passport/produk`; `/admin/penjualan` mencatatnya |
| B. Tagihan sesi (P3) | `ananda@` mengajukan jadwal; admin menerbitkan tagihan di `/admin/sesi`; klien membayar dari `/passport/bayar/[id]` lewat simulator | Webhook mengubah pesanan sesi; sesi tersalur; status di Passport dan panel admin berubah sendiri |
| C. Lapis 3 | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://padma-web-16ot.vercel.app/api/cron/pesanan`. Rute ini hanya menerima POST; GET dijawab 405 | Rekonsiliasi berjalan dan menjawab ringkasan |

Agen memeriksa hasilnya langsung di database dev (`db query --linked`, data
sintetis).

## Sesudah uji

- Catat jawaban K-butir yang terjawab di spec DOKU §4.3.
- Biarkan dev menyala selama fase uji. Supabase mem-pause proyek free tier yang
  lama tidak dipakai.
- **Jangan pernah** menyalin env proyek Vercel dev ke proyek produksi.
