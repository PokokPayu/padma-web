# Kebijakan Pembatalan & Jadwal Ulang — Keputusan Klien

**Tanggal dicatat:** 8 September 2026
**Sumber:** poster klien "KEBIJAKAN PEMBATALAN & JADWAL ULANG", disalin utuh dari gambar aslinya.
**Status:** keputusan klien yang SUDAH BULAT. Ini bukan rancangan — ia bahan yang akan
diargumentasikan oleh spec C3.

> **Kenapa berkas ini ada.** Isi kebijakan ini sebelumnya tidak tertulis di mana pun dalam repo.
> Spec C1 hanya menyimpan dua ambangnya ("≥ 24 jam", "< 2 jam") sebagai alasan struktural mengapa
> sesi wajib punya jam, plus dua nilai enum pembatalan — bukan konsekuensinya bagi klien. Akibatnya
> pemilik harus mengirim ulang posternya berkali-kali, dan isinya tetap disalahsebutkan dari
> ingatan. Berkas ini menutup lubang itu. **Jangan meringkasnya dari ingatan; baca dari sini.**

## Empat jenjang

| # | Keadaan | Yang berlaku |
|---|---|---|
| 1 | **≥ 24 jam** sebelum sesi | **Refund 100%** ATAU **reschedule gratis** |
| 2 | **2–24 jam** sebelum sesi | **Reschedule gratis 1×.** Bila memilih batal: dana menjadi **kredit layanan, berlaku 30 hari** |
| 3 | **< 2 jam**, ATAU **mitra sudah berangkat**, ATAU **no-show** | **Dana tidak dapat dikembalikan.** Jadwal ulang dihitung sebagai **pemesanan baru** |
| 4 | **PADMA** yang membatalkan | **Refund 100%** ATAU **reschedule prioritas tanpa biaya tambahan** |

**Pengecualian — keadaan darurat medis.** Persalinan dan rawat inap **ditinjau untuk reschedule
tanpa penalti**. Kata "ditinjau" ada di poster aslinya dan dipertahankan di sini: ini keputusan
manusia per kasus, bukan aturan yang dijalankan sistem sendiri.

## Empat hal yang membentuk implementasinya

**Jadwal ulang bukan lawan dari pembatalan — ia hidup di SETIAP jenjang.** Tiga jenjang pertama
masing-masing menawarkan bentuk jadwal ulang yang berbeda (gratis, gratis sekali, atau tidak sama
sekali), dan jenjang 4 menawarkan yang berprioritas. Merancang pembatalan tanpa jadwal ulang berarti
merancang separuh kebijakan.

**Jenjang 3 tidak semata soal waktu.** "Mitra sudah berangkat" adalah KEADAAN, bukan ambang jam — ia
bisa terpicu jauh sebelum dua jam. Karena itu sistem menuntut penanda berangkat yang sungguhan, dan
karena itu pula "penanda berangkat & no-show" sudah terdaftar sebagai pekerjaan C3 di spec C1.

**Kredit BUKAN nominal, dan ia kedaluwarsa.** Keputusan pemilik, ditegaskan berulang: kredit hanya
berbentuk **hak satu sesi untuk layanan yang sama**, **tidak bisa dipindahkan ke layanan lain**
("agar lebih mudah" — permintaan pemilik). Poster menambahkan masa berlakunya: **30 hari**. Jadi
jenjang 2 tidak pernah menyentuh tabel uang; ia menerbitkan objek hak sesi bertanggal kedaluwarsa.
Objek yang sama akan dipakai paket bila paket kelak dibuka (lihat "Utang terbuka" §1 spec C1): satu
hak dan sepuluh hak adalah mekanisme yang sama.

**Ambang waktunya dihitung dari `tanggal + jam` di zona Asia/Jakarta**, memakai `hariIniJakarta()`
yang sudah ada. Vercel berjalan UTC; menghitungnya dengan kalender mesin menggeser batas tujuh jam,
dan pergeseran itu berbentuk uang klien yang hangus sehari lebih awal. Inilah alasan struktural
mengapa jam mulai sesi (J2) harus mendarat di C1 sebelum C3 bisa dimulai sama sekali.

## Yang masih terbuka

1. **"Reschedule gratis 1×" — sekali per apa?** Per pemesanan, atau per klien per periode? Dan bila
   klien sudah memakai jatah itu lalu ingin menjadwal ulang lagi di jendela 2–24 jam, apakah ia
   jatuh ke aturan batal (kredit 30 hari) atau ke aturan jenjang 3 (pemesanan baru)?
2. **Mekanisme pengembalian uang.** Pembayaran masuk manual lewat QRIS, jadi pengembaliannya juga
   manual. Belum diputuskan siapa yang mengeksekusi, dalam berapa lama, dan apa yang dicatat sistem
   sebagai buktinya.
3. **Kredit 30 hari dihitung sejak kapan** — sejak pembatalan, atau sejak tanggal sesi yang batal?
   Keduanya masuk akal dan hasilnya berbeda sampai berhari-hari.

## Ketergantungan

C3 tidak bisa dimulai sebelum:

- **C1** — jam mulai sesi (J2), plus penanda berangkat & no-show. Tanpa jam tidak ada titik hitung;
  tanpa penanda berangkat, jenjang 3 hanya terpicu separuh.
- **C2** — catatan pembayaran. Sistem harus tahu apa yang sudah dibayar sebelum bisa
  mengembalikannya atau menerbitkan hak penggantinya.
