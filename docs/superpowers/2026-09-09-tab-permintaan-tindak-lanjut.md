# Tab Permintaan — Tindak Lanjut & Daftar Periksa Manual

**Tanggal:** 9 September 2026
**Spec:** `docs/superpowers/specs/2026-09-09-padma-tab-permintaan-design.md`
**Rencana:** `docs/superpowers/plans/2026-09-09-padma-tab-permintaan.md`
**Commit:** `141ac32` … `12e288f` (12 commit)

Dikerjakan dalam **mode nol uji baru** atas keputusan pemilik repo: pembuktian dilakukan manual demi
kecepatan. Dokumen ini adalah bagian yang tidak boleh ikut hilang bersama keputusan itu.

---

## A. Daftar periksa manual — WAJIB dijalankan sekali

Tanpa uji otomatis, inilah satu-satunya yang membuktikan pekerjaan ini benar.

1. `/admin/sesi` membuka tab **Permintaan**.
2. Klik **di mana saja pada satu baris** (bukan hanya nama klien) → panel geser terbuka. Escape dan
   klik overlay menutupnya, dan halaman tetap di halaman & saringan yang sama.
3. Buka permintaan **tanpa koordinat**: peringatan clay muncul, tombol **"Cari alamat di peta"**
   memindahkan peta ke alamat itu (bukan menjawab "Isi alamatnya lebih dulu"), pin bisa dijatuhkan,
   **Simpan pin** berhasil.
4. **BUTIR YANG PALING PENTING.** Sesudah pin dipasang, jalankan permintaan itu sampai **Konfirmasi
   jadwal**, lalu di tab Sesi pastikan sesinya lahir **dengan jenjang transport terisi** — bukan
   masuk saringan "Tanpa jenjang". Inilah pembuktian bahwa bug asal (`konfirmasi_permintaan`
   menghitung jenjang dari koordinat permintaan) benar-benar tertutup. Tidak ada uji otomatis yang
   menjaganya.
5. Chip **Menunggu** menyala saat halaman dibuka tanpa parameter. Chip **Riwayat** menampilkan
   permintaan `dibatalkan_klien` / `dibatalkan_tenggat` / `ditolak`.
6. Dari tab **Sesi**: mencari, menekan chip saringan, dan menekan "Berikutnya" semuanya **tetap di
   tab Sesi**.
7. Dari `/admin`: keempat tautan ke daftar sesi mendarat di tab **Sesi**; StatTile "Permintaan
   jadwal" dan badge sidebar mendarat di tab **Permintaan**.

---

## B. Lubang yang sengaja dibiarkan terbuka

Konsekuensi langsung dari mode nol uji baru. Ketiganya buta bagi pengujian manual.

1. **Uji RLS `tetapkanKoordinatPermintaan` di sesi klien.** Kebocoran tidak terlihat saat diklik
   sebagai admin. *Kabar baik dari review akhir:* trigger `guard_booking_klien_batal`
   (`20260909140000`) sudah menyebut `alamat_lat`/`alamat_lon` dalam daftar kolom tak-boleh-diubah,
   jadi klien yang memanggil PostgREST langsung ditolak di trigger — risikonya lebih kecil daripada
   yang spec kira, tetapi tetap tidak terbukti oleh uji.
2. **Uji `riwayat` sebagai komplemen turunan.** Tidak gagal sekarang; gagal saat nilai enum
   kesembilan lahir, dan gagalnya diam-diam.
3. **Uji rantai pin → sesi lahir dengan `jenjang`.** Digantikan oleh butir A.4 di atas.

---

## C. Utang yang tercatat, diurutkan menurut yang paling bisa menggigit

### C1 — Modul baca lain masih membuang `error` (kelas kegagalan 42703)

`ambilDaftarPermintaan` sudah diperbaiki (`885b86e`) sesudah bug nyata: embed menyebut kolom
`nama` padahal kolomnya `label`, PostgREST menolak **seluruh** query dengan 42703, dan karena
`error` dibuang, tab bawaan akan tampil kosong bagi setiap admin — diam-diam, selamanya.

Yang **belum** diperbaiki dan kini disandari panel ini:

- `pilihanMitra()` (`src/lib/admin/mitra.ts`) — gagal berarti layar berkata *"Belum ada mitra aktif.
  Tambahkan di menu Mitra lebih dulu."* Instruksi yang spesifik, dapat ditindak, **dan salah**.
- `daftarTagihanPengajuanAdmin()` — gagal berarti klien menerima tagihan WhatsApp **tanpa nominal**.
- `clients` select di `page.tsx` — pola `.then(({ data }) => data ?? [])` yang sama.

Ini utang paling berbahaya di daftar, karena bentuk kegagalannya adalah layar yang tampak benar.

### C2 — Pemilih peta di formulir pengajuan klien

`/passport/ajukan` masih tanpa pemilih peta. Koordinat tetap tidak terisi dari sumbernya, jadi
setiap permintaan baru yang alamatnya bukan salinan persis alamat profil akan lahir tanpa koordinat
dan menunggu ditambal admin. Pin admin adalah jaring pengaman, bukan penggantinya.

### C3 — Pin yang salah tidak bisa dikoreksi dari layar mana pun

Sesudah koordinat ada, pemilih pin hilang (sesuai spec K7). Akibatnya pin yang salah klik
menghasilkan `jenjang` yang **percaya diri dan salah**, bukan NULL — dan NULL-lah yang ditangkap
StatTile "menunggu jenjang". Obatnya ada di hilir (`tetapkanJenjang` pada sesinya), tetapi tidak ada
jalan memperbaiki pinnya sendiri.

### C4 — Lima tautan identik per baris tabel

Konsekuensi dari menjadikan seluruh baris dapat diklik dengan membungkus tiap sel. Pembaca layar
akan mengumumkan lima tautan berulang per baris. Penutupnya: satu tautan overlay yang menutupi
baris, bukan lima.

### C5 — Utang kecil lainnya

- `page.tsx`: `pilihanMitra()` dan `daftarTagihanPengajuanAdmin()` berjalan pada setiap render
  daftar Permintaan padahal hanya dipakai saat `?lihat=` terpasang. **Sengaja tidak diperbaiki** —
  mengetatkan syaratnya persis tempat bug nominal WhatsApp bisa kembali. Perbaiki hanya dengan uji
  yang menjaganya.
- `page.tsx`: `sp.tab === "sesi"` tidak lewat `nilaiTunggal`, jadi `?tab=sesi&tab=sesi` mendarat di
  tab yang salah.
- `admin/page.tsx`: empat href `?tab=sesi` ditulis tangan, bukan lewat `bangunQuery`.
- Logika escape kata cari kini terduplikasi di lima modul baca — kandidat helper `amankanKataCari`.
- `statusUntukSaring` menerima `string` dan meng-cast tanpa periksa; aman selama pemanggilnya satu.
- Urutan daftar `riwayat` mewarisi urutan antrean (tanggal menaik), sehingga pembatalan terlama
  tampil lebih dulu — kebalikan dari yang dicari admin saat menjawab "kenapa pengajuan saya hilang?".
- Cakupan assertion money-firewall menyempit: tautan WA bernominal kini hanya hidup di balik
  `?lihat=`, dan tidak ada assertion yang membuka panel.

---

## D. Pelajaran proses

**Reviewer per-tugas tidak diminta menjalankan berkas pagar.** Akibatnya Tugas 2 memerahkan
`tests/status-satu-sumber.test.ts` dan **lolos review**; baru ketahuan di Tugas 6. Lain kali, setiap
review tugas yang menyentuh nilai enum, batas server/klien, atau tautan harus menjalankan berkas
pagar yang relevan — bukan hanya membaca diff.

**Bug produksi tunggal di pekerjaan ini ditemukan oleh implementer yang memprobe query, bukan oleh
satu pun dari sembilan review kode.** Membaca kode tidak bisa membuktikan nama kolom.
