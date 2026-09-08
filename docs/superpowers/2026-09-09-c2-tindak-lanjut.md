# C2 — pembayaran sebagai syarat konfirmasi: tindak lanjut

Spec: `docs/superpowers/specs/2026-09-08-padma-c2-pembayaran-design.md`
Selesai & ter-merge: 9 September 2026. Bagian C berikutnya: **C3**.

Suite saat merge: **2.457 uji unit, 163 berkas, 0 gagal**; **10 skrip E2E, 183
pemeriksaan, 0 gagal**; `npm run lint` 0 error; `npm run build` hijau.

## Yang sekarang berlaku

Rantai jadwal tidak lagi berakhir di konfirmasi admin. Urutannya:

```
diminta → mencari_mitra → mitra_siap → menunggu_bayar → dikonfirmasi
                                            ↓ (24 jam)
                                     dibatalkan_tenggat
```

`konfirmasi_permintaan()` hanya mengklaim baris yang `menunggu_bayar` **dan**
`status_bayar = 'lunas'`. Sesi yang lahir dari situ lahir sudah `lunas` — tanpa
itu klien menerima tagihan kedua untuk sesi yang sudah ia bayar.

Tenggatnya 24 jam, diisi server saat tagihan terbit. `batalkan_lewat_tenggat()`
idempoten, melewati baris yang sudah `lunas` (uangnya sudah masuk, admin hanya
belum sempat mengonfirmasi — yang hilang di sana bukan slot melainkan uang
orang), dan **mengembalikan skriningnya**. Batal-oleh-klien tidak
mengembalikan skrining: membatalkan adalah keputusan orang, dan kondisi
kesehatan bisa berubah di antara dua percobaan memesan (C1 J3). Tenggat yang
lewat bukan keputusan. Kedua uji itu sengaja berdampingan di
`tests/tenggat-bayar.test.ts` — pembedaan ini yang paling mudah hilang saat
kode dirapikan, karena keduanya sama-sama "batal".

## Dua cacat yang lolos uji unit dan baru tertangkap belakangan

Keduanya layak dibaca sebelum menulis lapisan baca yang baru.

### 1. Embed berpolicy staf ke query sesi klien memulangkan `null`, bukan galat

`ambilTagihanPengajuan` meng-embed `partners ( lat, lon )` ke query yang
dijalankan dengan sesi klien. `partners` berpolicy staf, dan PostgREST
memulangkan embed yang tidak berhak sebagai `null` — **tanpa** mengisi `error`.
Akibatnya jenjang transport selalu tak diketahui, total selalu `null`, dan
SETIAP klien melihat "Totalnya sedang dilengkapi tim PADMA". Fiturnya mati
sepenuhnya, tanpa satu baris pun di log.

Seluruh uji unit C2 membacanya dengan service role — yang justru menyembunyikan
persis pagar yang sedang salah dipakai. Cacatnya baru terlihat saat E2E jalur
penuh mencari `[data-total]` di layar klien sungguhan.

`tests/tagihan-baca-hak.test.ts` mengunci dua hal berpasangan: fakta haknya di
basis data (klien membaca `partners` sebagai nol baris, bukan galat) dan bentuk
query-nya di sumber (`baca.ts` tidak boleh menyebut embed `partners (`).

**Yang berlaku umum:** setiap kali sebuah pembacaan dengan sesi pengguna
meng-embed tabel yang policy-nya bukan milik pengguna itu, hasilnya adalah
fitur yang mati diam-diam. Bacalah kolomnya dengan service role secara
terpisah, dan biarkan RLS tetap memutuskan BARIS mana yang terlihat.

### 2. Pemilihan skrining adalah baca-lalu-tulis

Pengiriman pengajuan bersamaan bisa memilih baris skrining yang sama, dan yang
kalah di indeks unik parsial gagal dengan `23505` — padahal klien punya skrining
hijau lain yang bebas. Yang membatasi seharusnya kuota antrean, bukan balapan.
Sekarang kandidat dikumpulkan dulu lalu dicoba berurutan; hanya `23505` yang
melanjutkan perulangan.

## Keputusan yang diambil, beserta alasannya

- **Nominal diturunkan, tidak pernah disimpan.** Tidak ada kolom
  `total_tagihan` di mana pun: money firewall struktural memindai seluruh skema
  termasuk tabel yang belum lahir, dan nominal turunan yang disimpan hanya
  menambah tempat untuk berselisih. Tarif dibaca menurut **tanggal sesi**, jadi
  menaikkan tarif hari ini tidak menggeser satu pun tagihan yang sudah terbit.
- **Kolomnya `tenggat`, bukan `tenggat_bayar`.** Money firewall memindai nama
  kolom dengan regex yang memuat `bayar`; `tenggat_bayar` (timestamptz) ikut
  tersapu. Menamainya `tenggat` lebih murah daripada melonggarkan firewall.
- **Bucket `bukti-bayar` privat, TANPA satu pun policy.** Bukti transfer memuat
  data yang PADMA tidak minta: nama pemilik rekening, nomor rekening, sering
  kali saldo. Tanpa policy, `anon` maupun `authenticated` tidak bisa
  menyentuhnya sama sekali — hanya service role lewat rute bertanda
  `/api/bukti/[permintaan]`, yang memanggil `requireRole` sebelum menyentuh
  storage dan membalas dengan `private, no-store`. Kunci objek diturunkan dari
  id pengajuan, bukan dari nama berkas kiriman, sehingga path traversal tidak
  punya pintu masuk. SVG ditolak: ia dokumen yang bisa menjalankan skrip.
- **Gambar dikecilkan di peramban** (1200 px, JPEG 0,7) sebelum dikirim — bukan
  sekadar hemat penyimpanan, melainkan menurunkan ketajaman detail yang PADMA
  tidak butuhkan. Batas ukurannya tetap ditegakkan bucket, karena pengecilan di
  sisi klien adalah kenyamanan dan kenyamanan bisa dilewati. Jalur kanvasnya
  hanya teruji lewat E2E — `createImageBitmap` tidak ada di vitest.
- **Notifikasi WhatsApp = pesan siap-salin, bukan kiriman otomatis.** PADMA
  belum punya jalur kirim WhatsApp, dan menambahkannya berarti satu penyedia
  baru beserta jalur kegagalannya — sementara admin memang sudah punya
  percakapan berjalan dengan klien itu.
- **Tombol "Konfirmasi jadwal" tidak dirender sebelum lunas.** Basis data sudah
  menolaknya, tapi tombol yang pasti ditolak adalah cara tercepat membuat admin
  berhenti memercayai layarnya. Tiga gerbang itu diuji di E2E pada tiga keadaan
  berbeda (`mitra_siap`, `menunggu_bayar` belum bayar, bukti terkirim belum
  diverifikasi).
- **Penulisan baris verifikasi memakai sesi admin sungguhan**, bukan service
  role, supaya jejak auditnya menyebut aktor yang nyata. Penghapusan objek
  storage-nya dipindah ke `src/lib/bukti/hapus.ts` — `src/app/admin/**` tidak
  boleh memuat service role (`tests/admin-shell.test.ts`).

## Yang TIDAK dikerjakan, dan sebabnya

- **Pencocokan otomatis mutasi rekening.** QRIS PADMA statis; tidak ada webhook
  yang bisa dicocokkan. Verifikasi tetap manual, dan spec memang memutuskan
  begitu.
- **Penghapusan bukti terjadwal.** Bukti disimpan **sampai dihapus manual**
  (keputusan owner). Yang ada hanya saringan "Bukti lunas > 90 hari" di
  `/admin/bayar` supaya admin bisa menemukan yang layak disapu. Bila kelak
  ingin otomatis, sapuannya milik cron — bukan trigger.
- **Tarif >20 km.** `di_atas_20` sengaja tidak punya baris rate card:
  nominalnya ditetapkan owner per kasus di `transport_khusus`. Tagihan seperti
  itu belum bisa terbit, dan menampilkannya sebagai Rp0 adalah kebohongan yang
  membuat klien membayar kurang lalu ditagih lagi.

## Yang perlu disiapkan sebelum ini hidup di produksi

1. **Cron tenggat.** `/api/cron/tenggat` sudah ada, memanggil
   `batalkan_lewat_tenggat()`, dan sudah dijaga rahasia bersama `CRON_SECRET`
   dengan sifat *fail-closed*: tanpa env itu terpasang, rute ini menolak SEMUA
   orang. Jadi ada dua hal yang harus dipasang di Vercel, dan urutannya tidak
   bebas — **env `CRON_SECRET` dulu, jadwalnya kemudian**; dibalik, setiap
   panggilan terjadwal hanya menghasilkan 401 yang senyap. Selama jadwalnya
   belum hidup, tidak ada pengajuan yang pernah batal otomatis dan slotnya
   tertahan selamanya. Lapis kedua (evaluasi tenggat saat dibaca di layar)
   menutupi tampilannya, bukan pelepasan slotnya.
2. **Bucket `bukti-bayar` di proyek Supabase produksi.** Ia lahir dari migrasi,
   jadi `db push` sudah cukup — tapi pastikan batas 2 MB & daftar mime-nya ikut
   terbawa.
3. **Koordinat mitra.** Mitra seed tidak punya `lat`/`lon`, dan tanpa koordinat
   mitra jenjang transport tak bisa dihitung sehingga total tagihan `null`.
   Setiap mitra produksi wajib punya titik di peta sebelum tagihan pertama
   terbit.

## Catatan untuk siapa pun yang menyentuh ini berikutnya

- `ALTER TYPE ... ADD VALUE` tidak bisa **dipakai** di transaksi yang sama
  (`55P04`) — karena itu nilai enum baru hidup di migrasi terpisah dari yang
  memakainya. `RENAME VALUE` tidak kena aturan itu. View menyimpan OID enum
  sehingga ikut berganti sendiri saat di-*rename*; badan fungsi plpgsql adalah
  TEXT dan tidak.
- Menghapus sesi C2 wajib ikut menyapu `jejak_status_bayar`-nya: sesi lahir
  `lunas`, jadi trigger pencatat menulis satu baris, dan tabel jejak sengaja
  tanpa foreign key (cascade akan menghapus tepat bukti yang menjelaskan
  penghapusan). `tests/jejak-yatim.test.ts` akan merah di suite yang sama
  sekali tidak menyentuh pembayaran.
