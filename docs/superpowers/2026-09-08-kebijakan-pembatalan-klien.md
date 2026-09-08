# Kebijakan Pembatalan — Keputusan Klien

**Tanggal dicatat:** 8 September 2026
**Sumber:** poster klien "Kebijakan Pembatalan & Jadwal Ulang" (diterima 8 September 2026),
dikonfirmasi ulang lewat percakapan pemilik hari yang sama.
**Status:** keputusan klien yang SUDAH BULAT. Ini bukan rancangan — ia bahan yang akan
diargumentasikan oleh spec C3.

> **Kenapa berkas ini ada.** Isi kebijakan ini sebelumnya tidak tertulis di mana pun. Spec C1 hanya
> menyimpan dua ambangnya ("≥ 24 jam", "< 2 jam") sebagai alasan struktural mengapa sesi wajib punya
> jam, plus dua nilai enum `dibatalkan_klien` dan `dibatalkan_padma`. Akibatnya kebijakannya hidup
> hanya di percakapan, dan dua kali disalahsebutkan dari ingatan — sekali sebagai "refund tidak ada
> sama sekali", padahal refund ADA dan justru jenjang teratasnya.

## Empat jenjang

| # | Keadaan | Yang diterima klien |
|---|---|---|
| 1 | Klien membatalkan **≥ 24 jam** sebelum sesi | **Uang kembali** |
| 2 | Klien membatalkan **2–24 jam** sebelum sesi | **Kredit** — hak satu sesi, bukan uang |
| 3 | Klien membatalkan **< 2 jam** sebelum sesi | **Hangus penuh** |
| 4 | **PADMA atau mitra** yang membatalkan | **Uang kembali penuh** |

## Dua hal yang membentuk implementasinya

**Kredit BUKAN nominal.** Keputusan pemilik, ditegaskan dua kali: kredit hanya berbentuk **hak satu
sesi untuk layanan yang sama**, dan **tidak bisa dipindahkan ke layanan lain** — pembatasan terakhir
diminta pemilik sendiri "agar lebih mudah". Jadi jenjang 2 tidak pernah menyentuh tabel uang; ia
menerbitkan objek hak sesi. Ini pula objek yang akan dipakai paket bila paket kelak dibuka (lihat
"Utang terbuka" §1 di spec C1): satu hak dan sepuluh hak adalah mekanisme yang sama.

**Ambangnya dihitung dari `tanggal + jam` di zona Asia/Jakarta**, memakai `hariIniJakarta()` yang
sudah ada. Vercel berjalan UTC; menghitungnya dengan kalender mesin akan menggeser batas tujuh jam,
dan pergeseran itu berbentuk uang klien yang hangus sehari lebih awal. Inilah alasan struktural
mengapa jam mulai sesi (J2) harus mendarat di C1 sebelum C3 bisa dimulai sama sekali.

## Yang MASIH terbuka — jangan dikira sudah dijawab

1. **No-show.** Klien tidak ada di tempat ketika mitra sudah datang. Apakah ia jenjang tersendiri,
   atau diperlakukan sama dengan jenjang 3 (hangus penuh)? Bedanya nyata: pada no-show, mitra sudah
   menempuh perjalanan dan honornya sudah timbul.
2. **Separuh poster yang lain: JADWAL ULANG.** Poster klien berjudul "Pembatalan **& Jadwal
   Ulang**", tetapi hanya sisi pembatalannya yang tercatat di sini. Aturan jadwal ulang — berapa kali
   boleh, sampai berapa jam sebelum sesi, apakah berbiaya — belum pernah dibicarakan dan belum
   tertulis di mana pun.
3. **Mekanisme pengembalian uang.** Pembayaran masuk manual lewat QRIS; pengembaliannya juga manual,
   dan belum diputuskan siapa yang mengeksekusi, dalam berapa lama, serta apa yang dicatat sistem
   sebagai buktinya. Ini urusan C2/C3, bukan C1.

## Ketergantungan

C3 tidak bisa dimulai sebelum:

- **C1** — jam mulai sesi (J2). Tanpa jam, tidak ada titik untuk menghitung 24 jam dan 2 jam.
- **C2** — catatan pembayaran. Sistem harus tahu apa yang sudah dibayar sebelum bisa mengembalikan
  uangnya atau menerbitkan hak penggantinya.
