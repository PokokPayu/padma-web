# C1-a — Catatan Tindak Lanjut

**Dikerjakan:** 8 September 2026, dari rencana
`docs/superpowers/plans/2026-09-08-padma-c1a-rantai-status-jam.md`
(spec `docs/superpowers/specs/2026-09-08-padma-c1-fondasi-jadwal-design.md`, keputusan J1, J2, J7,
J8, J13).

**Cabang:** `c1a-rantai-status`, bercabang dari `main` di `7e36a34`.

---

## Bukti, bukan klaim

| Perintah | Hasil |
|---|---|
| `npm test` | **147 berkas, 2.329 uji, 0 gagal** |
| `npm run build` | lolos, termasuk typecheck seluruh `src/` dan `tests/` |
| `npm run test:e2e` (access-matrix) | 22/22 |
| `npm run test:e2e:passport` | 21/21 |
| `npm run test:e2e:admin` | 26/26 |
| `npm run test:e2e:pelengkap` | 26/26 |
| `npm run test:e2e:owner` | 10/10 |
| `npm run test:e2e:daftar` | 14/14 |
| `npm run test:e2e:funnel` | 15/15 |
| `npm run test:e2e:materi` | 12/12 |
| `npm run test:e2e:video` | **TIDAK DIJALANKAN** — ia mengunggah lalu menghapus objek di bucket R2 **produksi** milik klien |

E2E dijalankan terhadap `npm run start` di **port 3100**, bukan 3000: port 3000 sedang dipakai sesi
kerja lain di mesin ini. Skripnya menghormati `E2E_BASE_URL`.

---

## Yang berubah, ringkas

- **Rantai status dua objek** (J1). `booking_status`: `menunggu`→`diminta`, ditambah
  `mencari_mitra`, `mitra_siap`, `dibatalkan_klien`. `session_status`: `batal`→`dibatalkan_padma`,
  ditambah `berjalan`, `tidak_hadir`. Kesahihan perpindahan ditegakkan trigger basis data, bukan
  hanya server action.
- **Jam sesi** (J2). Kolom `jam_mulai` (`time`, NOT NULL, tanpa bawaan) pada `booking_requests` dan
  `sessions`; daftar jam hidup di `app_settings.jam_layanan`; aritmatika tenggat memakai offset
  tetap `+07:00`.
- **Mitra terurut jarak** (J7), dipilih SEBELUM konfirmasi lewat kolom baru
  `booking_requests.partner_id`.
- **Konfirmasi menjadi satu transaksi Postgres** — lihat "keputusan yang diambil di jalan".
- **Pembatalan oleh klien + tombol tolak hilang** (J8).
- **J13** menjadi pagar yang bisa merah, bukan kesunyian.

---

## Keputusan yang diambil di jalan, dan ongkosnya bila salah

**1. Konfirmasi dipindah ke fungsi Postgres `konfirmasi_permintaan()`.**
Rencana awal menyahkan panah mundur permanen `dikonfirmasi → mitra_siap` sebagai jalur pemulihan.
Tinjauan penulis spec menolaknya dengan alasan yang lebih baik: jangan melebarkan mesin status untuk
menampung operasi yang tidak atomik — buat operasinya atomik. Sekarang status permintaan dan baris
sesi lahir dalam satu transaksi, dan `dikonfirmasi` menjadi keadaan akhir tanpa panah keluar.
**Ongkos bila salah:** jalur konfirmasi adalah jantung operasional; bila fungsinya cacat, tidak ada
sesi yang bisa terbit. Ditutup uji: dua konfirmasi bersamaan tetap melahirkan tepat satu sesi, dan
lompatan status ditolak bahkan saat ditembak langsung lewat SQL.

**2. `jenjang_sumber` TIDAK menjadi parameter RPC.**
Sebelum ada RPC, jalur konfirmasi aman dari klaim palsu bukan karena penjaga melainkan karena ia
tidak pernah membaca masukan pemanggil. Menjadikannya RPC menghapus sifat itu. Satu-satunya pagar
yang ada (`sessions_alasan_penimpaan`) hanya menuntut alasan ketika sumbernya `'admin'` — tidak ada
apa pun yang memaksa `'otomatis'` jujur. Fungsi menuliskannya sendiri.
**Ongkos bila salah:** admin bisa mencatat jenjang pilihan tangan sebagai hitungan otomatis, dan
rekap transport owner membacanya sebagai angka yang tidak pernah diperiksa siapa pun.

**3. CHECK `partner_id` memakai daftar eksplisit, bukan perbandingan urutan enum.**
`status >= 'mitra_siap'` akan ikut menuntut mitra pada `dibatalkan_klien` — termasuk pembatalan dari
`diminta` yang memang tidak pernah punya mitra. Urutan enum ditentukan urusan lain, jadi pagar yang
bersandar padanya berubah arti setiap kali ada nilai baru disisipkan.

**4. Baris lama diberi `jam_mulai = '09:00'`.**
Itu **bukan** jam sesi mereka yang sebenarnya — data itu memang tidak pernah ada, dan tidak ada
nilai yang bisa membuatnya ada. **Bila di produksi sudah ada sesi atau pengajuan sungguhan, jamnya
wajib dibenarkan manusia sesudah migrasi diterapkan.** Ini satu-satunya butir di dokumen ini yang
menuntut tindakan di luar kode.

**5. `terjadwal → selesai` tetap sah tanpa lewat `berjalan`.**
Akun dan panel mitra belum ada, jadi `berjalan` ditandai admin dan akan sering dilewati. Memaksa
lewat `berjalan` berarti memaksa admin berbohong tentang jam, atau membuat sesi yang benar-benar
terjadi tidak pernah bisa ditandai selesai.

**6. `SESI_DIBATALKAN` hanya mengecualikan `dibatalkan_padma`, bukan juga `tidak_hadir`.**
Query yang dulu menulis `.neq("status", "batal")` (agenda, tagihan, klaim bayar) perilakunya
DIPERTAHANKAN persis. Apakah sesi yang kliennya tidak hadir tetap ditagih adalah keputusan C3 yang
belum diambil; mengubahnya diam-diam di sini akan mendahului keputusan itu.

---

## Dua kesalahan yang saya buat dan cara ia ketahuan

Ditulis karena keduanya instruktif, bukan untuk kelengkapan.

**1. Menulis ulang `klaim_sudah_bayar` "dari ingatan".** `create or replace function` mengganti
seluruh badan — dan saya kehilangan empat hal sekaligus: validasi `jenis` di luar `'paket'/'sesi'`,
`limit 1`, filter `p.status = 'aktif'`, dan tipe kembaliannya. Akibat terparahnya: argumen `jenis`
yang tak dikenal diam-diam diperlakukan sebagai klaim PAKET. Ketahuan lewat
`passport-bayar-ajukan.test.ts`. **Jebakan ini sudah tertulis sebagai peringatan di berkas migrasi
saya sendiri, dan tetap saya langgar.** Yang benar: salin definisi aslinya apa adanya, ubah hanya
yang memang berubah.

**2. Salah menyebut nama view.** Aslinya `sesi_menunggu_tarif_transport`; saya menulis
`sesi_menunggu_tarif`. Akibatnya BUKAN galat: Postgres dengan patuh **melahirkan view baru** yang
tidak dipakai siapa pun, sementara view yang benar-benar rusak tetap rusak. Yang menangkapnya bukan
uji yang menyasar keduanya, melainkan pagar `admin-pengerasan` — view baru itu lahir dengan hak
tulis bawaan Supabase untuk `authenticated`. Tanpa pagar itu, view hantu ini akan hidup diam-diam.

**Pagar yang meloloskan keduanya sudah diperlebar.**
`tests/rantai-status-db.test.ts` semula hanya memindai `booking_status` dan hanya bentuk bercast
(`'menunggu'::booking_status`). Ia buta terhadap `s.status <> 'batal'` tanpa cast, dan buta terhadap
VIEW sama sekali. Kini ia menyasar katanya, mencakup kedua enum, dan memindai fungsi maupun view.

---

## Fakta terverifikasi yang menghemat waktu orang berikutnya

**`ALTER TYPE ... ADD VALUE` dan 55P04.** Diprobe langsung di Postgres lokal (transaksi rollback),
bukan diingat:

- `add value` lalu **MEMAKAI** nilai itu di transaksi yang sama gagal
  `55P04 unsafe use of new value`. Penambahannya sendiri **boleh** di dalam transaksi — aturan
  "tidak boleh di dalam transaksi" adalah Postgres **sebelum v12**.
- `rename value` lalu memakai nilai barunya di transaksi yang sama **BERHASIL**.

Supabase CLI menjalankan tiap berkas migrasi dalam transaksinya sendiri. Aturan praktisnya: seluruh
`add value` boleh berbagi SATU berkas, asal berkas itu tidak menyentuh nilai barunya — tanpa cast
literal, tanpa CHECK, tanpa indeks berpredikat. Hanya PEMAKAIAN yang wajib pindah ke berkas
berikutnya.

**Nama constraint yang lahir INLINE.** `app_setting_keys.bentuk` dibuat sebagai
`check (...)` inline tanpa nama, sehingga Postgres menamainya `app_setting_keys_bentuk_check`.
Rencana menebaknya `app_setting_keys_bentuk` — tebakan itu salah, dan `drop constraint if exists`
atas nama karangan akan diam-diam tidak mengenai apa pun lalu `add` bentrok.

**`next build` ikut men-typecheck `tests/`.** Fixture uji yang kehilangan medan baru tidak
memerahkan `npm test` (vitest tidak men-typecheck) tetapi MENGGAGALKAN build.

**Tipe `LayoutProps` hanya ada sesudah build.** Di worktree baru yang belum pernah di-build,
`npx tsc --noEmit` melaporkan `Cannot find name 'LayoutProps'` di `src/app/layout.tsx`. Itu bukan
cacat kode — ia tipe yang di-generate Next. Hilang sendiri sesudah `npm run build`.

---

## Yang perlu diketahui C1-b sebelum ia mulai

**1. Migrasi `screening_id NOT NULL` wajib BERTAHAP.** C1-a menaruh baris `booking_requests` di
seed dan di puluhan titik uji. `set not null` langsung akan menolak pada `db reset` karena baris
lama tidak punya skrining, dan kegagalannya akan terlihat seperti masalah lain sama sekali.
Urutannya: tambah kolom nullable → backfill (atau hapus baris uji lama) → baru `set not null`.

**2. Berkas uji yang sudah disentuh C1-a untuk `jam_mulai` akan disentuh lagi untuk
`screening_id`** — 30 berkas, daftar lengkapnya ada di commit `de5daf7`.

**3. `tests/status-satu-sumber.test.ts` memindai SELURUH `src/`** dan akan memerahkan literal status
apa pun yang ditulis di luar `lib/jadwal/status.ts`. Kalau C1-b menambah keadaan, tambahkan
konstanta bernama di modul itu, jangan menulis literalnya.

**4. `tests/e2e/funnel-skrining.e2e.ts` masih hijau** — ia berakhir di WhatsApp. C1-b yang mengubah
layar hasil skrining wajib menulisnya ulang sampai ke pemesanan.

---

## Utang yang sengaja ditinggalkan

- **Halaman `/admin/sesi` menampilkan seluruh antrean tanpa paginasi** untuk blok permintaan. Sama
  seperti sebelum C1 — tidak diperburuk, tidak diperbaiki.
- **`max_rows = 1000` di `lib/admin/mitra.ts`** (utang #1 di
  `docs/superpowers/2026-09-07-panel-fondasi-tindak-lanjut.md`) tidak disentuh. `pilihanMitra()`
  yang kini dipakai pengurutan jarak mewarisi batas yang sama.
- **Katalog produksi masih data karangan** dan honor mitra untuk jenjang transport di atas 0–5 km
  belum pernah diisi. Keduanya utang terbuka yang menunggu klien, bukan pekerjaan kode.
