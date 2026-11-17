# Lingkungan uji sandbox DOKU di proyek dev

Ditulis 17 Nov 2026. Ini rincian langkah 1.5 runbook rilis
(`2026-11-17-runbook-rilis.md`) dan prasyarat README Fase 3 langkah 2 (uji asap
sandbox di deploy preview Vercel).

**Masalahnya:** spec deploy §6 sengaja tidak memasang env di scope Preview,
supaya kode yang belum di-review tidak menulis ke database pasien. Akibatnya
deploy preview tidak tersambung ke database mana pun, dan uji sandbox DOKU
tidak punya tempat.

**Jawabannya:** Preview disambungkan ke proyek **dev**, bukan produksi, dan
hanya ke kunci **sandbox** DOKU.

## Prinsip

- **Kunci produksi tidak pernah masuk scope Preview.** Ini berlaku untuk
  Supabase produksi, DOKU produksi, R2 produksi, dan Resend.
- **Dev berisi data sintetis saja.** Dibangun dari migrasi
  (`supabase db reset --linked`), bukan dari dump produksi. README
  ("Membangun lingkungan lain") menjelaskan bahwa restore dump menghasilkan
  hak lebih luas daripada sumbernya.
- **Akun uji dev bersandi `padma-dev-123`, dan sandi itu tertulis di repo
  publik** (`scripts/seed-users.ts`). Karena itu preview **tetap di balik
  Vercel Deployment Protection**. Lihat langkah 5.
- **Repo tertaut ke dev** (`web/supabase/.temp/project-ref` =
  `mdtzrzwapuaalmsxomkm`). Setiap perintah `--linked` diawali pemeriksaan ref
  itu.

## Langkah

| # | Langkah | Siapa |
|---|---|---|
| 1 | Hidupkan proyek **dev-padma-web** (`mdtzrzwapuaalmsxomkm`) dari dasbor Supabase (Restore project). CLI di mesin ini tidak punya perintahnya | Pemilik |
| 2 | Periksa isi dev (jumlah baris tabel inti), lalu `supabase db reset --linked` dan `seed:users` ke dev. Rinciannya di bawah | Agen, dengan izin pemilik |
| 3 | Supabase dev → Authentication → URL Configuration: Site URL = alias preview branch `development`; Redirect URLs = alias itu + `/**` | Pemilik |
| 4 | Vercel → Settings → Environment Variables, scope **Preview**, dibatasi ke branch `development` bila dasbor menawarkannya. Daftarnya di bawah | Pemilik |
| 5 | Vercel → Deployment Protection untuk preview **tetap menyala**. Webhook DOKU masuk lewat Protection Bypass for Automation (lihat "Webhook dan proteksi") | Pemilik |
| 6 | `git push origin development`. Vercel membangun preview, lalu catat URL alias branch-nya. Bila URL alias baru diketahui sesudah build pertama, isi `NEXT_PUBLIC_BASIS_URL` lalu redeploy, karena nilai `NEXT_PUBLIC_*` dibakukan saat build | Agen dengan izin pemilik, atau pemilik |
| 7 | Back Office DOKU **sandbox**: Notification URL = `<alias>/api/pembayaran/doku` (plus parameter bypass, lihat di bawah); Recover Abandoned Cart mati | Pemilik |
| 8 | Uji asap: dua skenario di bawah | Pemilik di peramban; agen memeriksa database dev |

### Langkah 2: yang dijalankan agen

```bash
cd web
cat supabase/.temp/project-ref          # HARUS mdtzrzwapuaalmsxomkm (dev)
npx supabase db query --linked "select count(*) from public.clients"   # dll.: lapor isi dev dulu
npx supabase db reset --linked          # skema dari 116 migrasi + seed.sql
```

- `seed:users` dijalankan dengan URL dan service role key **dev** sebagai env
  proses (dotenv tidak menimpa env yang sudah terpasang). `.env.local` tidak
  disunting.
- Kuncinya diambil dengan `supabase projects api-keys --project-ref
  mdtzrzwapuaalmsxomkm` langsung ke env proses, tanpa dicetak.
- Skrip ini **tidak punya pagar anti-produksi**, jadi URL target diperiksa
  memuat `mdtzrzwapuaalmsxomkm` sebelum skrip berjalan.

### Langkah 4: env Preview

| Variabel | Nilai | Sumber |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mdtzrzwapuaalmsxomkm.supabase.co` | proyek dev |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key **dev** | Supabase dev → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key **dev** | idem; jangan pernah kunci produksi |
| `DOKU_CLIENT_ID` | Client ID **sandbox** | Back Office DOKU sandbox |
| `DOKU_SECRET_KEY` | Secret Key **sandbox** | idem |
| `DOKU_PRODUKSI` | `false` | nilai selain `true` persis = sandbox |
| `NEXT_PUBLIC_BASIS_URL` | URL alias preview branch `development` | Vercel → Deployments → branch `development` → Domains |
| `CRON_SECRET` | nilai acak baru, **beda** dari produksi | untuk memicu Lapis 3 secara manual |
| `PADMA_PROXY_TEPERCAYA` | `1` | sama dengan produksi (Vercel = 1 proxy) |
| `NOMINATIM_USER_AGENT` | sama dengan produksi | pencarian alamat |

**Sengaja dikosongkan:**
- `R2_*`: unggah dan tonton video mati, dan preview tidak boleh menulis ke
  bucket klien.
- `RESEND_API_KEY` dan `EMAIL_PENGIRIM`: tagihan tetap terbit tanpa email, dan
  sebabnya tercatat di log.

### Webhook dan proteksi

Preview yang dilindungi Vercel Authentication menolak POST dari DOKU. Ada dua
jalan, dicoba berurutan:

1. **Protection Bypass for Automation.**
   - Aktifkan di Vercel → Deployment Protection. Vercel menerbitkan sebuah
     rahasia.
   - Pasang Notification URL sandbox sebagai
     `<alias>/api/pembayaran/doku?x-vercel-protection-bypass=<rahasia>`.
   - **Perlu dibuktikan di uji ini:** spec DOKU (§ notifikasi, [S14]) hanya
     menyebut `Request-Target` = *path* URL notifikasi. Kode kita menandatangani
     path tetap `/api/pembayaran/doku` tanpa query (`route.ts:148`).
   - Bila DOKU ikut menandatangani query string, webhook menjawab 401 tanda
     tangan, dan log Vercel menunjukkannya. Itu jawaban untuk butir "perlu
     konfirmasi DOKU", bukan bug yang perlu ditambal di produksi, karena URL
     produksi tidak memakai query.
2. **Cadangan bila jalan 1 gagal.**
   - Matikan proteksi preview HANYA selama jendela uji.
   - Sebelumnya, ganti sandi akun `admin@`, `owner@`, dan `ananda@padma.test`
     di dev ke nilai acak yang disimpan di password manager.
   - Nyalakan lagi proteksinya sesudah uji.

### Langkah 8: skenario uji asap

| Skenario | Langkah | Yang dibuktikan |
|---|---|---|
| A. Produk digital | Seed tidak membuat produk digital, jadi buat dulu satu: `admin@padma.test` di `/admin/produk`, harga ditetapkan `owner@padma.test` di `/owner/produk`, lalu tayangkan. Sebagai `ananda@padma.test`: setujui S&K, buka `/produk/<slug>`, Beli, bayar di simulator DOKU sandbox | Checkout menerbitkan tautan; webhook mengubah pesanan menjadi lunas; akses terbit di `/passport/produk`; `/admin/penjualan` mencatatnya |
| B. Tagihan sesi (P3) | Klien mengajukan jadwal; admin menerbitkan tagihan di `/admin/sesi`; klien membayar dari `/passport/bayar/[id]` lewat simulator | Webhook mengubah pesanan sesi; sesi tersalur; status di Passport dan panel admin berubah sendiri |
| C. Lapis 3 | `curl -H "Authorization: Bearer $CRON_SECRET" <alias>/api/cron/pesanan` (lewat parameter bypass juga) | Rekonsiliasi berjalan dan menjawab ringkasan |

Agen memeriksa hasilnya langsung di database dev (`db query --linked`, data
sintetis) dan log rute.

## Sesudah uji

- Catat jawaban K-butir yang terjawab di spec DOKU §4.3, terutama soal query
  string di `Request-Target`.
- Biarkan dev menyala selama fase uji. Supabase mem-pause proyek free tier yang
  lama tidak dipakai.
- Env Preview tetap menunjuk ke dev. **Jangan pernah** menyalinnya ke scope
  Production.
