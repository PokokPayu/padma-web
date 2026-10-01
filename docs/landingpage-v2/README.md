# Handoff Website PADMA

Mockup HTML statis sebagai titik awal. Buka `index.html` di browser.

## Isi paket
- `index.html` — Beranda
- `layanan.html` — Layanan
- `tentang.html` — Tentang PADMA
- `digital-passport.html` — Digital Passport Journey (penjelasan untuk calon klien; aplikasi Passport tetap di `/masuk`)
- `images/` — ilustrasi & foto founder. Beranda & Layanan sementara memakai hero yang sama (`hero-ibu-bayi.png`); hero Beranda akan diganti ilustrasi baru.

## Integrasi dengan website lama (padmawellnessid.com)
- Yang diganti **hanya halaman utama (`/`)**. Halaman `/masuk`, `/skrining`, dan Digital Passport tetap.
- Tombol **Masuk** (header) → `/masuk`. Langkah **Cek Kesiapan Sesi** (alur PADMA Home) → `/skrining`.
- Hapus semua harga dari halaman utama. Harga hanya via WhatsApp / Highlight Instagram.
- Teks lama yang wajib dibuang: "Homecare Promil", "perawatan kesehatan perempuan", "mengikuti panduan ACOG & CDC", "Skrining Gratis", "evaluasi & rekomendasi bidan".

## Konsistensi Passport
- Satu nama di semua tempat: **Digital Passport Journey** (bukan "Digital Care Passport"). Samakan juga di dalam aplikasi.
- Isi sesuai sesi yang diikuti klien: eBook/panduan PDF (**hanya dibaca di web, tanpa tombol unduh**), printable sheet (bisa dicetak), video. (Ringkasan & sertifikat, bila ada, masuk sebagai printable sheet.)

## Gambar (WAJIB diganti versi resolusi tinggi)
Gambar di `images/` hanya potongan mockup (resolusi rendah, akan buram). Ganti dengan file asli **bernama sama**, ukuran minimal:

| File | Ukuran minimal (px) |
|---|---|
| founder.jpg | sudah resolusi tinggi (foto asli) |
| hero-ibu-bayi.png | 1040 × 892 |
| passport-hero.png | 1120 × 520 |
| cta-ibu-anak.png | 660 × 520 |
| alasan-1/2/3.png | 740 × 300 |
| passport-tanpa / passport-dengan.png | 400 × 300 |
| format-learn/live/home.png | 240 × 270 |
| fase-1 s/d fase-5.png | 300 × 256 |

- Simpan juga versi WebP (lebih ringan di HP), pakai `srcset` 1x/2x.
- Latar krem `#FBF6EE` atau transparan; jangan ada teks tertanam di gambar.

## Wajib dikerjakan programmer
1. **Nomor WhatsApp**: sudah terpasang `0877-7840-0200` (`wa.me/6287778400200`). Tes semua tombol WA.
2. **Kode sumber WA**: pesan otomatis website sudah berisi kata `WEBSITE`. Pakai pola yang sama untuk kanal lain (INSTAGRAM, TIKTOK, POSTER, kode affiliate).
3. **Mobile**: sudah ada responsif dasar, tapi header perlu menu hamburger dan semua halaman perlu dicek di HP.
4. **Halaman belum ada**: PADMA Learn, PADMA Live, PADMA Home, Testimoni, **Artikel** (link masih `#`). Artikel ditulis sendiri oleh owner: siapkan blog/CMS sederhana agar bisa menulis & menerbitkan tanpa coding.
5. **Testimoni**: blok di Beranda masih placeholder. Jangan tayang sebelum ada kutipan asli berizin.
6. Rapikan kode: style masih inline, sebaiknya dipindah ke CSS/komponen.

## Sosial media
- Footer: Follow Instagram & TikTok @padmawellness.id (sudah bertaut).

## Aturan konten (jangan diubah tanpa persetujuan)
- Tidak ada harga, durasi, promo, QR, atau link PDF di website. Semua lewat WhatsApp.
- Satu CTA utama: **Tanya Kelas & Pricelist**.
- PADMA non-klinis: jangan pakai kata "screening", "diagnosis", "pemeriksaan" untuk layanan PADMA.
- Profil mitra tidak ditampilkan. Detail mitra dikirim setelah booking terkonfirmasi.

## Gaya
| Token | Nilai |
|---|---|
| Hijau utama | `#0F4A3C` (footer `#0B3A2F`) |
| Teks judul | `#123F35` |
| Emas (tombol, aksen) | `#9A5F2A` |
| Krem latar | `#FBF6EE`, kartu `#FFFDF9`, garis `#EADFCD` |
| Font judul | Cormorant Garamond (600–700) |
| Font isi | Jost (400–600) |
| Font script | Parisienne (tagline saja) |
