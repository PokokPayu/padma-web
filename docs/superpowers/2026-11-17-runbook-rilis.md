# Runbook rilis PADMA: `development` → produksi

Ditulis 17 Nov 2026 oleh sesi utama (`padma-c3`). Rilis ini membawa SEMUA yang
ditahan sejak 12 Nov sekaligus:
- produk digital (berbab dan masa berlaku), keranjang, dan rekap penjualan P4;
- S&K dan persetujuan;
- pekan honor Sabtu–Jumat;
- artikel dan testimoni;
- gateway DOKU, termasuk pembayaran sesi (P3);
- perbaikan audit B1–B6 dan B8.

Langkah teknis DOKU yang rinci ada di `web/README.md` §Deploy → Fase 3. Runbook
ini adalah urutan besarnya dan menutup celah yang tidak ada di sana.

**Siapa yang mengerjakan:** semua langkah yang menulis ke produksi (migrasi,
push, env, SQL) dikerjakan **pemilik repo**. Agen tidak menjalankan
`db push`, tidak menulis ke produksi, dan hanya membaca agregat produksi
dengan izin eksplisit.

## 0. Fakta terukur (17 Nov 2026)

| Hal | Nilai | Cara mengukur |
|---|---|---|
| Proyek produksi | "Padma Wellness App", ref `vtprvvwslclyqlunzuvj`, `ap-southeast-1` (Singapura), ACTIVE_HEALTHY | `supabase projects list` |
| Proyek dev | "dev-padma-web", ref `mdtzrzwapuaalmsxomkm`, Singapura, **INACTIVE** (di-pause) | idem |
| Proyek yang tertaut ke repo (`web/supabase/.temp/project-ref`) | **DEV**, bukan produksi. Brief DOKU dan rencana DOKU-A yang menyebut "repo ter-link ke produksi" sudah basi | berkas itu |
| Migrasi produksi | 75, terakhir `20260915100000` | `migration list` |
| Migrasi tertunda | **41**, dari `20260920100000` sampai `20261113140800` (Lampiran A). Tanpa celah urutan, dan tidak ada versi produksi yang hilang dari repo | dibandingkan dengan `development` `57da0c7` |
| `honor_marks` | **0 baris**, jadi ranjau `pekan_sabtu_jumat` tidak aktif hari ini | kueri B1 |
| Tagihan QRIS warisan (`booking_requests.status = 'menunggu_bayar'`) | **3**, semuanya lewat tenggat: 2 `belum` dan 1 `lunas` | kueri B2 |
| Kode produksi | `origin/main` = `defda92` (10 Sep). `main` lokal +8 commit (landing v2), seluruhnya sudah ada di `development`. `origin/development` tertinggal 120 commit, tanpa divergensi | `git rev-list` |
| Backup | `.github/workflows/backup-db.yml`: blok `schedule:` **masih dikomentari**. Free tier Supabase tidak membuat backup harian. Riwayat run dan secret GitHub tidak bisa dicek dari mesin ini (`gh` tidak terpasang) | berkas workflow |

**Risiko migrasi terhadap data produksi: rendah.** Dari 41 migrasi, yang
mengevaluasi baris lama saat diterapkan hanya tiga:
- constraint `screenings_*` di `20260920100000`, atas kolom yang lahir di
  migrasi yang sama sehingga semuanya `null`;
- guard `pekan_sabtu_jumat` atas `honor_marks`, yang berisi 0 baris;
- constraint `orders`/`notifikasi_pesanan`, tabel yang lahir di rilis ini juga.

Sisanya menambah objek baru.

## 1. Kerjakan SEKARANG, tanpa menunggu hari rilis

1. **Satu klien sudah membayar tetapi jadwalnya belum dikonfirmasi.**
   - Pengajuan itu `menunggu_bayar` dengan `status_bayar = 'lunas'`, dan
     tenggatnya sudah lewat.
   - Admin membukanya di `/admin` produksi hari ini dan menekan "Konfirmasi
     jadwal", atau menghubungi kliennya bila tanggalnya sudah lewat.
   - Ini uang klien yang sudah masuk; jangan dibiarkan menunggu rilis.
2. **Backup produksi: data kesehatan sungguhan sejak sekitar 21 Sep, dan
   kemungkinan belum pernah di-backup.** Selesaikan empat langkah backup
   mandiri (memori `padma-backup-mandiri`, `docs/runbook-pemulihan.md`):
   1. secret `SUPABASE_DB_URL` (session pooler);
   2. token R2 berlingkup `padma-backup`;
   3. kunci `age`, dengan kunci privat di password manager;
   4. run manual, latihan dekripsi, lalu hidupkan `schedule:`.

   Bila belum sempat, setidaknya ambil satu dump manual sekarang dan simpan
   terenkripsi.
3. **DOKU** (README Fase 3 langkah 1):
   - K1: QRIS berstatus Active.
   - K2: Checkout dengan QRIS. Ini pemblokir terbesar.
   - Sisa pertanyaan terbuka di spec DOKU §4.3: K3, K4, K5, K8, K9, K10, K12,
     K13, K14.
4. **Teks hukum:**
   - review hukum S&K dan Kebijakan Privasi, yang kini memuat klausul
     pembayaran sesi lewat DOKU;
   - jawab empat pertanyaan terbuka S&K (lama proses refund, usia minimal 18,
     waktu tanggap 3×24 jam, persetujuan skrining yang diisikan orang lain);
   - tetapkan tanggal final `VERSI_DOKUMEN`.
5. **Tutup celah lingkungan uji sandbox.**
   - README Fase 3 langkah 2 meminta uji asap di **deploy preview Vercel**,
     tetapi spec deploy §6 sengaja **tidak** memasang env di scope Preview.
     Akibatnya preview tidak tersambung ke database mana pun.
   - Usulan:
     1. Hidupkan lagi proyek dev (`mdtzrzwapuaalmsxomkm`) dari dasbor.
     2. Bangun ulang dari migrasi, bukan dari dump (README, "Membangun
        lingkungan lain"). Pastikan ref yang tertaut memang dev sebelum
        perintah apa pun.
     3. Pasang env scope **Preview** di Vercel yang menunjuk ke dev, plus kunci
        **sandbox** DOKU dan `NEXT_PUBLIC_BASIS_URL` = URL alias branch
        `development`.
     4. Push `development`, lalu jalankan uji simulator sesuai README Fase 3
        langkah 2.
   - Kunci produksi tidak pernah dipasang di scope Preview.
6. **Siapkan env Produksi Vercel lebih awal** (README Fase 3 langkah 4). Kode
   lama tidak membacanya, jadi aman dipasang sebelum rilis:
   - pasang `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_PRODUKSI=true` (persis),
     `NEXT_PUBLIC_BASIS_URL=https://padmawellnessid.com`, dan `CRON_SECRET`;
   - pastikan tidak ada env Midtrans;
   - pastikan Fluid Compute menyala;
   - pasang juga `CRON_SECRET` yang sama sebagai **GitHub Secret**.
7. **Pastikan Fase 2 deploy sudah tuntas.** Ini tidak terlihat dari repo:
   - SMTP Resend;
   - Auth Site URL dan Redirect URL di domain final;
   - R2 `AllowedOrigins` memuat domain produksi;
   - rotasi kunci R2 bila pernah terpapar.

## 2. Hari rilis (urutan mengikat)

Pilih jam sepi. Antara langkah 2.5 (migrasi) dan 2.6 (deploy), kode lama
berjalan di atas skema baru. Jendela itu dibuat sependek mungkin, dan
unggah bukti QRIS dimatikan sejak rilis.

1. **Beri tahu klien PADMA** (prasyarat rilis S&K #2). Sesudah rilis, setiap
   klien bertemu layar persetujuan S&K satu kali.
2. **Ukur ulang.** Jalankan kueri Lampiran B, dengan izin. Berhenti bila ada
   yang menyimpang:
   - migrasi terakhir produksi masih `20260915100000`;
   - B1 (`honor_marks` bukan Sabtu) **= 0**. Bila tidak nol, migrasi
     `pekan_sabtu_jumat` akan **ditolak**. Baca komentar di migrasi itu dan
     putuskan barisnya satu per satu sebelum lanjut. Jangan menggeser
     tanggalnya;
   - B2 dicatat sebagai daftar kerja langkah 2.10.
3. **Backup dan bukti pulih.** Dump produksi, lalu pulihkan ke tempat lain
   (instans lokal) dan hitung baris tabel inti. Yang membuktikan backup adalah
   pemulihannya, bukan berkasnya. Simpan terenkripsi.
4. **Commit rilis di `development`,** lalu suite penuh hijau dengan hanya merah
   bawaan `materi-video-r2`:
   - isi tanggal final `VERSI_DOKUMEN` (`web/src/lib/persetujuan/versi.ts`);
   - buka komentar blok `schedule:` di
     `.github/workflows/rekonsiliasi-pesanan.yml`, dan **hapus** uji
     `it("blok schedule LAHIR DIKOMENTARI")` di
     `web/tests/pesanan-jadwal-actions.test.ts` (README Fase 3 langkah 7,
     WAJIB). Sampai jadwal ini hidup, pesanan yang ditutup tidak punya
     rekonsiliasi sama sekali;
   - bila langkah 1.2 tuntas, hidupkan juga `schedule:` di `backup-db.yml`.
5. **Terapkan 41 migrasi, dengan sengaja.**
   - Repo tertaut ke DEV, jadi target produksi selalu ditulis eksplisit lewat
     `--db-url`, memakai connection string **session pooler** produksi:
     ```bash
     cd web
     npx supabase db push --db-url "<session-pooler-produksi>" --dry-run
     ```
   - Daftar dry-run harus **persis** Lampiran A: 41 baris, pertama
     `20260920100000`, terakhir `20261113140800`. Bila berbeda, berhenti.
   - Sesudah cocok, jalankan perintah yang sama tanpa `--dry-run`.
   - Bila satu migrasi gagal, CLI berhenti di situ:
     - jangan deploy kode;
     - baca galatnya;
     - perbaiki lewat migrasi baru, atau pulihkan dari backup 2.3.
   - Sesudahnya, `migration list` terakhir = `20261113140800`, total 116.
6. **Deploy kode:**
   ```bash
   git checkout main && git merge --ff-only development
   git push origin development main
   ```
   Vercel membangun `main`. Bila build gagal karena batas durasi fungsi,
   periksa Fluid Compute (langkah 1.6).
7. **Uji asap tanpa uang:**
   - beranda, `/produk`, `/masuk`;
   - satu akun klien uji melewati layar persetujuan, lalu baris
     `persetujuan_akun` lahir (prasyarat rilis S&K #1);
   - `/admin`, `/admin/sesi`, `/admin/bayar`, `/owner`, `/owner/penjualan`
     terbuka tanpa layar galat.
8. **Back Office DOKU produksi** (README Fase 3 langkah 3):
   - Notification URL `https://padmawellnessid.com/api/pembayaran/doku` untuk
     **setiap** kelompok channel aktif;
   - Recover Abandoned Cart **mati**;
   - notifikasi kedaluwarsa tetap mati;
   - daftarkan juga URL S&K/KP di dasbor DOKU dan layar persetujuan OAuth
     Google (prasyarat rilis S&K #3).
9. **Rekonsiliasi:** jalankan `rekonsiliasi-pesanan.yml` sekali secara manual
   dan pastikan run-nya hijau.
10. **Peralihan tiga tagihan QRIS warisan** (README Fase 3 langkah 6). Admin
    memutuskan satu per satu, tanpa pembatalan massal:
    - 2 × `belum`: "Terbitkan ulang" lewat DOKU bila klien masih ingin, atau
      "Batalkan pengajuan";
    - 1 × `lunas`: bila belum dituntaskan di langkah 1.1, "Konfirmasi jadwal";
    - baris `menunggu_verifikasi` yang muncul sejak hari ini mengikuti README
      langkah 6a.
11. **Transaksi asli bernominal kecil:** satu produk digital dan, bila
    memungkinkan, satu tagihan sesi. Pastikan webhook mengubah status, akses
    terbit, dan `/admin/penjualan` mencatatnya.

## 3. Sesudah rilis

- Pantau `/admin/pesanan` dan run rekonsiliasi selama sepekan pertama.
- Begitu baris warisan habis, hapus jalur warisan (tab verifikasi, tombol
  konfirmasi lama, `konfirmasi_permintaan`) sebagai pekerjaan terpisah.
- Latihan dekripsi backup tiap kuartal.
- Rotasi Secret Key DOKU bila pernah tertempel di chat, issue, atau log
  (README Fase 3 langkah 9).
- Perbaiki klaim "repo ter-link ke produksi" di
  `docs/superpowers/briefs/2026-11-12-tugas-sesi-2-doku.md` dan
  `docs/superpowers/plans/2026-11-13-padma-doku-a-gateway.md`.
- Sesudah rilis DOKU: C3-b dan C3-c (keputusan pemilik 13 Nov), lalu bug B7
  dan B9 dari audit.

## 4. Rencana mundur

- **Sebelum 2.5:** belum ada yang berubah di produksi. Batalkan saja.
- **2.5 gagal di tengah:** migrasi sebelum titik gagal sudah tercatat. Kode
  lama masih jalan. Pilihannya:
  - perbaiki lewat migrasi baru, lalu lanjutkan;
  - pulihkan dari backup 2.3 bila skemanya rusak. Tulisan sejak backup hilang,
    dan itulah alasan jendela waktunya dibuat sepi.
- **Sesudah 2.6, kode baru bermasalah:**
  - perbaiki maju (fix-forward) lebih aman daripada kembali ke deploy lama.
    `defda92` berjalan di atas skema yang sudah berubah, dan jalur QRIS lamanya
    sudah dipagari migrasi P3;
  - Instant Rollback Vercel hanya untuk keadaan darurat sambil perbaikan
    disiapkan.
- **Pembayaran DOKU bermasalah sesudah go-live:**
  - kosongkan `DOKU_CLIENT_ID` di Vercel dan redeploy. Pesanan tetap lahir,
    tetapi tautan bayar tidak terbit: pembeli menerima 503 "Pembayaran belum
    aktif. Hubungi tim PADMA." (`src/lib/doku/tautan.ts:61-63`), dan pesanan
    yang terbuka bisa diulang sesudah kunci dipasang lagi;
  - webhook yang kuncinya kosong menjawab 503, sehingga DOKU mengirim ulang
    nanti, bukan kehilangan notifikasi;
  - uang yang sudah masuk tetap tercatat lewat rekonsiliasi sesudah kunci
    dipasang lagi.

## Lampiran A. 41 migrasi tertunda (urutan penerapan)

1. `20260920100000_usia_kehamilan_skrining`
2. `20260921100000_produk_digital`
3. `20260921110000_produk_harga`
4. `20260921120000_produk_entitlement`
5. `20260921130000_produk_hapus_isi`
6. `20260921140000_produk_harga_grant`
7. `20260921150000_ambil_produk_gratis`
8. `20260921160000_produk_akses_pemilik`
9. `20260921170000_harga_produk_publik_hanya_tayang`
10. `20260922100000_pekan_sabtu_jumat`, yaitu ranjau honor (kueri B1 harus 0)
11. `20260924100000_materi_jejak_buka`
12. `20260926100000_pesanan_enum`
13. `20260926110000_pesanan_tabel`
14. `20260926120000_pesanan_jejak`
15. `20260926130000_pesanan_rpc`
16. `20260926140000_pesanan_webhook_rpc`
17. `20260926150000_entitlement_tambal`
18. `20260927100000_sebab_tinjauan_lestari`
19. `20261001100000_artikel_testimoni`
20. `20261002100000_keranjang_tabel`
21. `20261002110000_keranjang_pesanan`
22. `20261006100000_pesanan_item_produk_id`
23. `20261006120000_persetujuan_dokumen`
24. `20261016100000_produk_bab_materi`
25. `20261016110000_produk_akses_masa_berlaku`
26. `20261016120000_produk_masa_berlaku_pesanan`
27. `20261016130000_produk_komentar_tabel`
28. `20261112100000_hapus_artikel_testimoni_rpc`
29. `20261113100000_menunggu_tarif_tanpa_batal_klien`
30. `20261113130000_kolom_gateway_netral`
31. `20261113130100_terapkan_notifikasi_gateway`
32. `20261113130200_hapus_midtrans`
33. `20261113140000_pesanan_jenis`
34. `20261113140100_terbitkan_tagihan_sesi`
35. `20261113140200_kejadian_sesi`
36. `20261113140300_salurkan_sesi`
37. `20261113140400_penjaga_pengajuan`
38. `20261113140500_item_staf_pengajuan`
39. `20261113140600_tagihan_sesi_saya`
40. `20261113140700_pensiun_tenggat`
41. `20261113140800_rekonsiliasi_percobaan_tutup`

## Lampiran B. Kueri agregat produksi (hanya hitungan, dengan izin pemilik)

Dijalankan lewat Management API. Setiap kueri menyertakan migrasi terakhir
sebagai bukti bahwa yang menjawab adalah produksi, bukan dev yang tertaut ke
repo:

```bash
npx supabase db query --project-ref vtprvvwslclyqlunzuvj --linked \
  --output-format json "<sql>"
```

**B1, ranjau honor** (harus 0 sebelum langkah 2.5):

```sql
select (select max(version) from supabase_migrations.schema_migrations) as migrasi_terakhir,
       count(*) filter (where extract(isodow from week_start) <> 6) as tanda_bukan_sabtu,
       count(*) as total
  from public.honor_marks;
```

**B2, tagihan QRIS warisan** (daftar kerja langkah 2.10):

```sql
select (select max(version) from supabase_migrations.schema_migrations) as migrasi_terakhir,
       b.status_bayar, (b.tenggat < now()) as lewat_tenggat, count(*) as jumlah
  from public.booking_requests b
 where b.status = 'menunggu_bayar'
 group by b.status_bayar, (b.tenggat < now());
```

Sesudah 2.5, `migrasi_terakhir` menjadi `20261113140800`.
