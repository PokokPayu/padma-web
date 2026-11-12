# Tugas sesi 2 — ganti payment gateway Midtrans → DOKU

Ditulis 12 Nov 2026 oleh sesi utama (`padma-c3`) untuk sesi kedua.
Kirim pertanyaan koordinasi ke sesi utama lewat `SendMessage` ke `padma-c3`.

## 1. Tujuan

Klien PADMA minta payment gateway diganti dari **Midtrans** ke **DOKU**.
Ganti seluruh integrasi Midtrans dengan DOKU **tanpa** mengubah mesin pesanan
di Postgres, kecuali bagian yang memang khusus Midtrans.

## 2. Fakta yang sudah diukur (jangan diselidiki ulang)

- **Midtrans belum pernah live.** Produksi masih menjalankan `origin/main` =
  `defda92` (10 Sep 2026). Seluruh kode pembayaran (P1-A, P1-B, P2 keranjang)
  hanya ada di `development` lokal, belum di-push. Skema produksi terakhir
  diukur 28 Sep berhenti di `20260915100000`, jadi migrasi P1 belum diterapkan
  di produksi. Akibatnya: **nol transaksi Midtrans yang perlu dimigrasi**, dan
  tidak ada alasan menjalankan dua gateway sekaligus.
- Fakta skema produksi di atas berumur 7 pekan. Sebelum merancang strategi
  migrasi, minta pemilik repo memastikan ulang. **Jangan query produksi sendiri.**
- Titik sentuh Midtrans di `web/` (dipetakan 12 Nov, di `development` `a7986a3`):
  - `src/lib/midtrans/*`: `adapter.ts` (Snap + Status API), `tanda-tangan.ts`
    (sha512), `skema.ts` (Zod), `konfig.ts`, `kode-jawaban.ts`,
    `snap-peramban.ts` (Snap.js di peramban)
  - Rute: `src/app/api/pembayaran/midtrans/route.ts` (webhook),
    `api/pesanan/checkout`, `api/pesanan/[id]/{periksa-ulang,putuskan,terbitkan-akses,tutup-tinjauan}`,
    `api/cron/pesanan`
  - Lapis 1b: `src/lib/pesanan/periksa-menggantung.ts`. Juga
    `lib/pesanan/{status,order-id}.ts`, `lib/auth/rahasia-mesin.ts`,
    `lib/admin/pesanan.ts`, `lib/penjualan/baca.ts`
  - Layar: `admin/pesanan/*`, `admin/penjualan/tabel-penjualan.tsx`,
    `owner/penjualan/*`, `passport/keranjang/*`, `produk/[slug]/{page,tombol-beli}.tsx`
  - Dokumen hukum: `_dokumen/isi-kebijakan-privasi.tsx` dan
    `_dokumen/isi-syarat-ketentuan.tsx` menyebut Midtrans sebagai pemroses
    pembayaran
  - Migrasi: RPC `terapkan_notifikasi_midtrans(...)` di
    `20260926140000_pesanan_webhook_rpc.sql`, kolom `status_midtrans`, plus
    `20260921120000`, `20260926110000..130000`, `20260927100000`,
    `20261016120000`
  - Env: `MIDTRANS_SERVER_KEY`, `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`, `MIDTRANS_PRODUKSI`
  - Penjadwal: `.github/workflows/rekonsiliasi-pesanan.yml` (blok `schedule`
    sengaja dikomentari sampai go-live)
  - 23 berkas uji menyebut Midtrans
  - `web/README.md` Fase 3 = checklist go-live Midtrans 8 langkah
- Bacaan wajib sebelum merancang:
  - `docs/superpowers/specs/2026-09-26-padma-inti-pembayaran-design.md`
  - `docs/superpowers/plans/2026-09-27-padma-p1a-mesin-basis-data.md`
  - `docs/superpowers/plans/2026-09-27-padma-p1b-permukaan-pembayaran.md`
  - `docs/superpowers/specs/2026-10-02-padma-p2-keranjang-design.md`

## 3. Invarian P1 yang WAJIB bertahan

Arsitektur P1 sudah ditinjau menyeluruh. Yang diganti adapter-nya, bukan
jaminannya.

1. Verifikasi nominal, transisi status, dan penerbitan akses terjadi dalam
   **satu transaksi di dalam RPC**, tidak pernah di TypeScript.
2. Idempotensi notifikasi lewat `unique (sidik)`.
3. Webhook berlapis: batas ukuran body → kunci terpasang (kosong = 503 agar
   gateway mengirim ulang) → validasi skema → bentuk nomor pesanan →
   **verifikasi tanda tangan waktu-tetap** → RPC.
4. Tiga lapis rekonsiliasi tetap ada: webhook, Lapis 1b (periksa saat halaman
   dibuka), dan Lapis 3 (cron menanyakan status ke gateway). Vonis status
   **selalu datang dari gateway**, tidak pernah dari badan permintaan klien.
5. Kasus `lunas_setelah_tutup` (settlement terlambat sesudah pesanan
   kedaluwarsa) dan celah tagih-dua-kali yang ditemukan review P1-A tidak boleh
   terbuka lagi.
6. Keputusan klien yang tidak berubah: tidak ada refund; `aktif = false`
   berarti berhenti dijual, bukan mencabut akses; harga hanya diatur owner.

## 4. Keputusan yang harus diambil BERSAMA pemilik repo (fase brainstorming)

1. **Cakupan.** Hasil tes klien 21 Sep butir 1 (asli:
   `documents/umpan-balik-klien/2026-09-21-hasil-tes.md`) meminta *semua*
   pembayaran lewat gateway, termasuk sesi, plus notifikasi WA dan status bayar
   otomatis. P1 sekarang hanya mencakup produk digital; pembayaran sesi masih
   QRIS manual. Tanyakan: tukar gateway untuk produk digital saja dulu, atau
   sekaligus pembayaran sesi? **Rekomendasi:** tukar 1:1 untuk produk digital
   dulu, lalu pembayaran sesi dan WA sebagai spec terpisah.
2. **Produk DOKU yang dipakai.** Misalnya halaman bayar ter-hosting (setara
   Snap) atau API langsung per metode, dan apakah lewat API berstandar SNAP BI
   atau API non-SNAP. Tentukan dari dokumentasi resmi DOKU dan dari apa yang
   aktif di akun merchant klien.
3. **Strategi migrasi.** Pilihannya: (a) migrasi maju baru yang menamai ulang
   ke nama netral gateway, misalnya `status_gateway` dan
   `terapkan_notifikasi_gateway`, atau (b) menyunting migrasi P1 yang belum
   pernah sampai produksi. **Rekomendasi: (a).** Migrasi lama sudah diterapkan
   di instans lokal dan uji bergantung pada riwayatnya.
4. **Midtrans dihapus total.** Rekomendasi: ya, tanpa mode dua-gateway.
5. **Data yang dibutuhkan dari klien:** akun merchant DOKU, kredensial
   **sandbox**, metode bayar yang aktif, dan siapa yang mendaftarkan URL
   notifikasi di dasbor DOKU.

## 5. Aturan akurasi DOKU

- **Jangan menulis detail API DOKU dari ingatan.** Format tanda tangan, header,
  bentuk payload notifikasi, kode status, batas panjang nomor invoice, URL
  sandbox, dan perilaku pengiriman ulang notifikasi semuanya diambil dari
  dokumentasi resmi DOKU, dan setiap klaim di spec ditulis beserta URL
  sumbernya.
- Kalau dokumentasi ambigu, tulis **"perlu konfirmasi DOKU"** di spec. Jangan
  menebak perilakunya.
- Pemetaan status DOKU → status pesanan PADMA ditulis sebagai **tabel lengkap**
  di spec, termasuk status yang belum pernah terjadi. Pelajaran P1: aturan yang
  hanya dijelaskan dengan kalimat lolos dari tujuh review per-tugas.
- Batas panjang dan karakter nomor pesanan di `lib/pesanan/order-id.ts` dibuat
  untuk Midtrans. Cocokkan ulang dengan batas DOKU.

## 6. Cara kerja

1. Worktree sendiri: `git worktree add .worktrees/doku -b feat/doku development`.
   Tunggu sesi utama menyatakan `development` hijau; ujung terakhirnya `a7986a3`
   atau sesudahnya.
2. **Supabase lokal sendiri:**
   - Di `web/supabase/config.toml` worktree: `project_id = "web-doku"` dan geser
     semua port `543xx` → `547xx`, lalu
     `git update-index --skip-worktree web/supabase/config.toml`.
   - `.env.local` worktree diarahkan ke `:54721`/`:54722`, dan nilai `R2_*`
     diisi placeholder supaya uji tidak menulis ke bucket R2 klien.
   - Jalankan `npm ci` dan `npx next typegen` sebelum `tsc`.
   - Port `54321` dipegang CleanMyMac. Jangan matikan aplikasi itu, dan jangan
     memakai instans `web`, `web-p4`, atau `web-sk`.
3. Alur superpowers: brainstorming bersama pemilik repo → spec di
   `docs/superpowers/specs/2026-11-xx-padma-doku-design.md` (disetujui pemilik)
   → rencana → TDD per tugas → **review seluruh branch** di akhir. Review
   per-tugas tidak menggantikan review seluruh branch.
4. Setiap uji baru harus **dibuktikan bisa merah**: mutasi kodenya dan tunjukkan
   ujinya gagal. Di proyek ini uji yang hijau karena alasan yang salah sudah
   berkali-kali ditemukan.
5. Saat sebuah aturan hidup di dua tempat (SQL dan TS), periksa apakah keduanya
   bisa **melihat data yang sama**, bukan hanya menulis kalimat yang sama.
   Misalnya `order_items` tidak punya grant untuk `authenticated`.
6. Merah bawaan di `development` yang BUKAN urusan tugas ini:
   `hak-hapus-berlebih` (articles/testimonials) dan `materi-video-r2` ×6
   (R2 placeholder) — diukur 12 Nov di `a7986a3`: 3552 hijau, 7 merah — plus 5
   skrip e2e basi (lihat
   `funnel-skrining`, `admin-operasional`, `bayar-pengajuan`, `passport`,
   `owner`). Bandingkan dengan `development` sebelum menuduh kode baru.

## 7. Larangan

- **Jangan `supabase db push`.** Repo ter-link ke project PRODUKSI
  (`supabase/.temp/project-ref`). Selalu pakai `--local`.
- Jangan query atau menulis ke Supabase produksi. Datanya data kesehatan klien
  sungguhan.
- Jangan `git push` dan jangan merge ke `development` atau `main`. **Sesi utama
  yang merge** sesudah branch selesai dan diverifikasi.
- Kredensial DOKU hanya di `.env.local`, tidak pernah di-commit, ditulis ke
  log, atau dimasukkan ke uji. Uji memakai token tiruan dan nama klien sintetis.
- Jangan menyentuh area di luar cakupan: pekan honor Sabtu–Jumat, S&K selain
  penyebutan nama gateway, P4 rekap selain label "Midtrans".

## 8. Hasil yang diserahkan

- Branch `feat/doku` berisi:
  - adapter DOKU
  - webhook baru (misalnya `/api/pembayaran/doku`)
  - checkout dan peramban (pengganti Snap.js)
  - Lapis 1b dan Lapis 3 memakai API status DOKU
  - migrasi maju
  - label layar
  - nol sisa kata "midtrans" di `src/`, kecuali komentar sejarah yang disengaja
- Suite penuh hanya merah bawaan, `tsc` 0, lint 0 error, `npm run build` hijau.
- `web/README.md` Fase 3 ditulis ulang untuk DOKU: env, URL notifikasi, uji
  asap sandbox, dan penjadwal.
- Teks kebijakan privasi dan S&K mengganti Midtrans → DOKU. Tandai sebagai
  perubahan yang ikut **review hukum** (`VERSI_DOKUMEN` belum final).
- Ringkasan akhir untuk sesi utama:
  - commit-commit di branch
  - migrasi baru dan urutannya
  - hal yang masih "perlu konfirmasi DOKU"
  - langkah go-live yang butuh tangan manusia
