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

---

# Tambahan — Hubungi Klien & Ubah Permintaan (commit `bc65298`…`a028d13`)

**Spec:** `docs/superpowers/specs/2026-09-09-padma-ubah-permintaan-design.md`
**Rencana & daftar periksa manual lengkap (10 butir):** `docs/superpowers/plans/2026-09-09-padma-ubah-permintaan.md`

## Bug yang nyaris lolos, dan kenapa ia nyaris lolos

`PemilihLokasi` menyemai state-nya dari prop `awal` dan merender state itu **langsung ke input
tersembunyi `lat`/`lon`**. Selama peta hanya muncul ketika koordinat kosong, `awal` selalu `null`
dan itu tidak berbahaya. Begitu peta dibuat **selalu tersedia**, medan tersembunyi jadi terisi sejak
cat pertama tanpa admin menyentuh apa pun — sehingga setiap penyimpanan terlihat seperti membawa
pin, dan cabang "alamat berubah → geocode ulang" **tidak pernah tercapai**.

Bentuk kegagalannya: admin menulis ulang alamat ke jalan yang berbeda, menekan Simpan, layar berkata
"Perubahan tersimpan." Yang tersimpan adalah **alamat baru dengan koordinat lama** — dan itu menjadi
jenjang transport yang salah dengan percaya diri saat konfirmasi.

Ditemukan hanya oleh review menyeluruh, sesudah tiga review per-tugas melewatkannya. Sebabnya: ia
lahir dari **interaksi** antara dua tugas yang masing-masing benar — Tugas 2 membuat peta selalu ada,
Tugas 1 mengandalkan "ada pin berarti manusia memilihnya". Tidak ada diff tunggal yang salah.

Ditutup dengan bendera `pin_disentuh` (`a028d13`).

## Utang baru

- **`pin_disentuh` adalah kontrak privat** antara `PemilihLokasi` dan `perbaruiPermintaan`, nilainya
  `"1"` vs `""`, tanpa konstanta bersama. Form mitra & klien sengaja mengabaikannya. Siapa pun yang
  menyentuh salah satu sisi sendirian perlu tahu ini.
- **Tanggal lampau boleh disimpan bila tidak berubah** (agar permintaan basi masih bisa dikoreksi
  alamatnya). Aturannya: ditolak hanya bila berbeda dari tanggal tersimpan.
- **`<input type="date">` tanpa atribut `min`** — peramban tidak mencegah memilih tanggal lampau;
  server yang menolaknya.
- **`PanelPermintaan` tumbuh besar** — blok ubah-alamat kandidat komponen tersendiri.

## Lubang yang sengaja dibiarkan (dari spec)

- **L1** — tidak ada jejak siapa mengubah apa. Penutupnya tabel `jejak_permintaan` tersendiri.
- **L2** — validasi tanggal & jam untuk admin **hanya** hidup di TypeScript; `guard_booking_pembatas`
  berbunyi `if user_role() = 'klien'`. Penutupnya memperluas guard itu ke peran staf — sebuah migrasi.
- **L3** — nol uji baru. Yang tanpa penjaga: ketiga cabang PIN MENANG (termasuk bendera
  `pin_disentuh` yang baru), penolakan tanggal lampau & jam di luar jam layanan, penerjemahan 23505,
  penolakan `menunggu_bayar`, dan RLS di sesi klien.

---

# Tambahan — Harga Klien di Master Layanan (commit `005325c`…`7d4491e`)

**Spec:** `docs/superpowers/specs/2026-09-09-padma-harga-di-master-layanan-design.md`

## Keadaan basis data lokal

Migrasi `20260914120000_harga_klien_untuk_staf.sql` **diterapkan tangan lewat psql**, bukan lewat
`supabase migration up`: DB lokal dipakai bersama sesi lain yang sudah menerapkan migrasi dari
branch-nya sendiri (`tagihan-email-katalog`), sehingga riwayat berkas tidak cocok. Versinya sudah
dicatat di `supabase_migrations.schema_migrations`, dan `revoke`/`grant`-nya diterapkan dalam
urutan yang sama dengan isi berkas. **Pada basis data bersih, berkas migrasinya berlaku apa adanya.**

## Dua pagar struktural yang nyaris terlewat

Ditemukan hanya oleh review menyeluruh, yang **memprobe skema hidup** alih-alih membaca diff:

1. `tests/money-firewall-struktural.test.ts` memindai `information_schema` seluruh BASE TABLE **dan
   VIEW** untuk kolom bernuansa uang, dengan pengecualian yang dulu terpaku ke satu nama view.
   View baru memerahkannya — itu memang tugasnya. Diperbaiki dengan pengecualian **kedua yang
   dipersempit ke pasangan (view, kolom)**, sehingga `honor_mitra` yang kelak masuk view itu tetap
   memerahkan pagar.
2. `tests/admin-pengerasan.test.ts` menuntut `anon`/`authenticated` tidak memegang verba tulis pada
   VIEW mana pun. Supabase memberi hak **penuh** atas setiap objek baru di `public`, jadi `grant`
   tanpa `revoke` di depannya diam-diam memberi INSERT/UPDATE/TRIGGER. Pola yang sama sudah pernah
   memerahkan pagar itu sekali sebelumnya.

**Pelajaran proses:** reviewer per-tugas hanya diminta menjalankan berkas uji modulnya sendiri.
Perubahan yang menyentuh **skema atau hak akses** wajib menjalankan pagar struktural repo —
`money-firewall-struktural`, `admin-pengerasan`, `grant-anon` — bukan hanya uji modulnya.

## Utang baru

- `hargaCoret` ditarik dan dibawa sampai ke prop halaman, tetapi tidak dirender.
- Query `varian_harga_staf` tidak dipaginasi; di atas `max_rows = 1000` harga diam-diam jadi "—".
  Sudah diberi komentar, belum diperbaiki.
- `formatRupiah` kini masuk ke `src/app/admin/layanan/[id]/page.tsx` — pengecualian pertama yang
  disengaja terhadap catatan di `src/lib/rupiah-publik.ts`, dan itu belum tercatat di sana.
