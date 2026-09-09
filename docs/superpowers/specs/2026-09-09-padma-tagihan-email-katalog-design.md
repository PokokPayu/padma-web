# Tagihan bernominal, email tagihan, & katalog pesan layanan — desain

Tanggal: 9 September 2026
Status: disetujui pemilik repo, siap direncanakan.

Spec ini menutup satu cacat produk yang sudah lama terlihat sebagai gejala
("Total: menyusul dari tim" di setiap pesan WhatsApp tagihan), lalu memakai
pembukaannya untuk tiga pekerjaan yang bergantung pada angka yang sama:
menampilkan rincian harga di aplikasi, mengirim tagihan lewat email, dan
merombak halaman pesan layanan menjadi katalog berharga.

Spec yang mendahului dan tetap berlaku:
`2026-09-08-padma-c2-pembayaran-design.md` (rantai bayar),
`2026-09-07-padma-transport-design.md` (jenjang & tarif transport),
`2026-09-06-padma-varian-layanan-design.md` (tarif per varian).

---

## 1. Diagnosis — kenapa totalnya tidak pernah ada

`pesanTagihan()` (`src/lib/tagihan/pesan-tagihan.ts`) tidak bersalah. Ia
menerima `total: string | null` dan menulis "Total: menyusul dari tim" ketika
nilainya `null`. Yang salah ada di hulu, pada tiga lapisan yang terpisah dan
harus diperbaiki terpisah.

### 1.1 Mitra tidak punya koordinat — inilah penyebab "selalu"

`supabase/seed.sql:146` menyisipkan mitra hanya dengan `(id, nama, no_hp)`.
Tanpa `lat`/`lon`, `daftarTagihanPengajuanAdmin()` tidak pernah masuk cabang
penghitung jenjang, `hitungTagihanPengajuan()` memulangkan
`{ total: null }` lewat cabang `jenjang === null`, dan setiap pesan WhatsApp
kehilangan nominalnya.

Ini sudah tercatat sebagai utang produksi di
`docs/superpowers/2026-09-09-c2-tindak-lanjut.md` §"Yang perlu disiapkan
sebelum ini hidup di produksi" poin 3 — dan tidak pernah ditutup. Sebuah utang
yang ditulis tetapi tidak dijadwalkan pada praktiknya adalah utang yang
diputuskan untuk dilupakan.

### 1.2 Kegagalannya senyap di layar admin

Panel Permintaan tidak menampilkan total sama sekali. Urutan yang dialami admin:
terbitkan tagihan → salin pesan WhatsApp → kirim → baru sadar nominalnya
hilang, sesudah pesannya sampai ke klien. Tidak ada satu pun titik di layar
yang bisa memberi tahu lebih awal, dan tidak ada satu pun kalimat yang
menyebut sebabnya.

Ini kelas cacat yang SAMA dengan dua cacat C2 yang tercatat di berkas tindak
lanjutnya: fitur yang mati tanpa satu baris pun di log.

### 1.3 Jalur >20 km buntu secara struktural

`transport_khusus` (migrasi `20260907120000`) ber-primary-key
`session_id uuid references public.sessions(id)`. Tetapi `baca.ts` mencarinya
dengan **id permintaan**:

```ts
.from("transport_khusus").select("tarif_klien").eq("session_id", p.id)
```

`p.id` di sana adalah `booking_requests.id`. Id itu tidak akan pernah ada di
`sessions`, jadi bacaan ini selalu memulangkan nol baris — bukan sebagai galat,
melainkan sebagai `null` yang terbaca wajar. `daftarTagihanPengajuanAdmin()`
bahkan tidak membacanya sama sekali, sehingga seandainya nominalnya ada, kartu
klien akan berisi sementara pesan WhatsApp admin tetap kosong.

Di bawahnya ada kebuntuan yang lebih dalam, dan ia tidak bisa diperbaiki dengan
memperbaiki query:

```
pengajuan >20 km
  → tarifnya milik owner per kasus, disimpan per SESI
  → sesi baru lahir SESUDAH lunas (konfirmasi_permintaan menuntut status_bayar='lunas')
  → untuk lunas, tagihannya harus terbit
  → untuk terbit, tarifnya harus ada
  → tarifnya baru bisa ditetapkan kalau sesinya ada
```

Lingkaran tertutup. Setiap klien yang tinggal lebih dari 20 km dari bidannya
tidak akan pernah bisa memesan.

---

## 2. Keputusan yang diambil

### 2.1 `di_atas_20` mendapat tarif dasar, penimpa per kasus tetap hidup

`transport_rates` punya constraint `transport_rates_bukan_per_kasus check
(jenjang <> 'di_atas_20')`. Constraint itu lahir dari review red-team (Ruling 6)
yang membuktikan doktrin ">20 km bukan tarif" tidak menghalangi apa pun selama
ia hanya hidup sebagai komentar tabel. Mencabutnya adalah membalik keputusan
yang sudah dibayar.

Yang diputuskan karena itu **bukan pembalikan, melainkan pelapisan**:

- `transport_rates` boleh memuat baris `di_atas_20` sebagai **tarif dasar**.
  Constraint `transport_rates_bukan_per_kasus` dicabut, dan alasannya ditulis
  di migrasinya sendiri supaya pencabutan itu tidak pernah terbaca sebagai
  kelalaian.
- `transport_khusus` **tetap hidup** sebagai penimpa per kasus milik owner, dan
  ia **menang** atas tarif dasar bila ada.

Kenapa dua-duanya, bukan salah satu:

- Tarif dasar yang membuka kebuntuan §1.3 — tagihan >20 km selalu bisa terbit.
- Penimpa yang menjaga kemampuan menagih 80 km berbeda dari 25 km. Tanpa itu,
  satu tarif tunggal untuk seluruh jarak ekstrem adalah kebohongan yang berbeda
  arah: klien 25 km membayar terlalu banyak, PADMA rugi pada klien 80 km.
- Layar owner (`/owner/transport`) dan perhitungan honor di
  `lib/owner/rekap.ts` tidak perlu dibongkar sama sekali.

Doktrin yang menggantikan doktrin lama, dan yang harus ditulis sebagai komentar
tabel: **"`di_atas_20` punya tarif dasar supaya tagihan bisa terbit; owner
menimpanya per kasus ketika jaraknya menuntut."** Bukan lagi "`di_atas_20`
adalah ketiadaan tarif".

### 2.2 Nominal tetap tidak pernah disimpan

Tidak berubah dari C2. Tidak ada kolom `total_tagihan` di mana pun; total
diturunkan dari tarif menurut **tanggal sesi**. Money firewall struktural
(`tests/money-firewall-struktural.test.ts`) tetap berlaku apa adanya, dan
pekerjaan ini tidak menambah satu pun nama tabel ke `TABEL_UANG`.

### 2.3 Tagihan tanpa nominal tidak boleh terbit

`terbitkanTagihan()` menolak menerbitkan tagihan yang totalnya belum diketahui,
dan kalimat penolakannya menyebut sebab yang bisa ditindak.

Alasannya bukan kerapian: `terbitkanTagihan()` memasang tenggat 24 jam, dan
lewat dari tenggat itu `batalkan_lewat_tenggat()` melepas slotnya. Tagihan
tanpa angka di atas tenggat 24 jam adalah jebakan — klien tidak diberi tahu
berapa yang harus ia bayar, lalu kehilangan jadwalnya karena tidak membayarnya.

### 2.4 Email tagihan dikirim otomatis lewat Resend

Otomatis saat tagihan terbit, bukan tombol manual. Tagihan yang tidak pernah
sampai adalah slot yang hangus 24 jam kemudian, dan "admin lupa" adalah bentuk
kegagalan yang paling sering terjadi.

Resend (HTTP API), bukan SMTP: koneksi SMTP dari fungsi serverless rapuh
(koneksi persisten, port yang bisa terblokir), dan Resend tidak menuntut satu
dependensi baru pun — cukup `fetch`.

Ini **tidak** membatalkan keputusan C2 tentang WhatsApp. WhatsApp tetap
siap-salin karena PADMA memang belum punya jalur kirimnya dan nada pesannya
sebaiknya tetap milik manusia. Email berbeda: jalurnya standar, isinya dokumen
(rincian tagihan yang perlu bisa dibuka ulang), dan klien memang butuh jejak
tertulis yang tidak tenggelam di percakapan.

### 2.5 Halaman pesan layanan menjadi katalog

`/passport/ajukan` sekarang adalah tumpukan `<select>`. Klien memilih layanan
tanpa pernah melihat harganya, lalu menerima tagihan berhari-hari kemudian.
Padahal harga klien sudah **diputuskan tampil publik** (spec V4 §4.4) dan sudah
tampil di landing lewat view `harga_publik` — orang yang belum mendaftar
melihat lebih banyak daripada klien yang sudah masuk.

---

## 3. Perubahan per lapisan

### 3.1 Basis data

Satu migrasi baru:

1. `alter table public.transport_rates drop constraint transport_rates_bukan_per_kasus;`
   dengan komentar yang menjelaskan §2.1 — kenapa dicabut, dan apa yang
   menggantikannya.
2. `comment on table public.transport_khusus` diperbarui: dari "nominal >20 km"
   menjadi "penimpa per kasus atas tarif dasar `di_atas_20`".
Migrasi ini **tidak** menyisipkan baris tarif. Nominal adalah keputusan owner,
dan migrasi yang membawa angka uang menjadikan angka itu bagian dari skema —
tidak bisa diubah tanpa migrasi berikutnya, dan tercatat di riwayat git alih-alih
di `berlaku_sejak`. Barisnya masuk lewat dua jalur yang sudah ada:

- **pengembangan & demo:** `seed.sql`, bersama baris jenjang lainnya;
- **produksi:** panel owner `/owner/transport`, yang memang sudah menjadi
  satu-satunya layar penetapan tarif transport.

Sampai baris itu ada, pengajuan `di_atas_20` memulangkan
`menungguTarifKhusus: true` dan tagihannya ditolak terbit oleh §2.3 — dengan
kalimat yang menyebut sebabnya, bukan senyap.

Tabel append-only berjenjang: penyisipan ini menambah baris ber-`berlaku_sejak`,
tidak menimpa apa pun, dan tagihan yang sudah terbit tidak bergeser.

### 3.2 `seed.sql`

Mitra seed diberi `lat`/`lon` sungguhan di Malang. Ini yang membuat "Total:
menyusul dari tim" berhenti muncul di lingkungan pengembangan dan demo.

Catatan produksi yang tetap berlaku dan harus diulang di berkas tindak lanjut:
**setiap mitra produksi wajib punya titik di peta sebelum tagihan pertama
terbit.** Form mitra (`/admin/mitra`) sudah punya pemilih peta.

### 3.3 `src/lib/tagihan/pengajuan.ts` — `hitungTagihanPengajuan()`

Cabang `di_atas_20` berubah:

- `transportKhusus` ada → dipakai, `menungguTarifKhusus: false`.
- `transportKhusus` tidak ada → jatuh ke `tarifTransportPadaTanggal()` seperti
  jenjang lain.
- Keduanya tidak ada → `menungguTarifKhusus: true`, `total: null`. Keadaan ini
  sekarang berarti satu hal saja: **tarif dasar `di_atas_20` belum pernah
  ditetapkan owner** — bukan lagi keadaan normal yang dialami setiap pengajuan
  jarak jauh.

Fungsi ini tetap MURNI. Pembacaan barisnya tetap milik pemanggil.

### 3.4 `src/lib/tagihan/baca.ts` (klien) & `src/lib/admin/tagihan-pengajuan.ts` (admin)

- Bacaan `transport_khusus` di `baca.ts` **dihapus**: id permintaan tidak akan
  pernah cocok dengan `session_id`. Yang menggantikannya adalah tarif dasar dari
  `transport_rates` yang sudah dibaca fungsi yang sama.
- Kedua fungsi memulangkan **rincian**, bukan hanya total: `layanan`,
  `transport`, `jenjang`, `total`. Sisi admin memformatnya jadi string rupiah;
  sisi klien sudah memulangkan `RincianTagihan`.
- Sisi admin menambahkan **sebab** ketika total `null`, sebagai nilai bertipe
  bukan string bebas:
  - `mitra_tanpa_titik` — mitra belum punya `lat`/`lon`.
  - `alamat_tanpa_pin` — `booking_requests.alamat_lat/lon` kosong.
  - `tarif_varian_kosong` — tidak ada `variant_rates` yang berlaku pada tanggal
    sesi untuk varian itu.
  - `tarif_transport_kosong` — tidak ada `transport_rates` yang berlaku untuk
    jenjang itu pada tanggal sesi.

  Sebab dipisahkan dari kalimatnya supaya kalimat bisa berbeda antara layar
  admin dan layar klien tanpa dua sumber kebenaran.

Pagar C2 yang **tidak boleh longgar**: tabel berpolicy staf/owner tidak pernah
di-embed ke query bersesi klien. `partners`, `variant_rates`, dan
`transport_rates` tetap dibaca terpisah dengan service role.
`tests/tagihan-baca-hak.test.ts` menjaganya dan tetap harus hijau.

### 3.5 `src/lib/tagihan/pesan-tagihan.ts` — pesan WhatsApp

Dari satu baris total menjadi rincian:

```
Layanan: Prenatal Massage · 90 menit
Jadwal: 20 Mei 2027, 09.00 WIB

Layanan       Rp 395.000
Transport     Rp 25.000   (10–15 km)
Total         Rp 420.000
```

Lima unsur wajib C2 tidak berkurang: nama, layanan, kapan, berapa, sampai kapan.
Yang bertambah hanya rinciannya. Fallback "menyusul dari tim" **tetap ada** —
ia sekarang menandai keadaan yang seharusnya tidak pernah tercapai (§2.3
menolak menerbitkannya), bukan keadaan sehari-hari.

Berkas ini tetap MURNI, tanpa satu pun impor. Alasannya tidak berubah: ia
dipakai dari halaman yang merender komponen `"use client"`.

### 3.6 `src/lib/email/kirim.ts` — baru

```
POST https://api.resend.com/emails
Authorization: Bearer ${RESEND_API_KEY}
{ from, to, subject, html, text }
```

Sifat yang mengikat:

- `import "server-only"` — kunci API tidak boleh punya jalan ke bundel peramban.
- **Tidak pernah melempar.** Setiap galat berakhir sebagai nilai balik
  `{ ok: false, sebab }` yang dicatat ke log server. Pola yang sama dengan
  `geocodeAlamat()`, dan alasannya sama: penerbitan tagihan tidak boleh gagal
  karena penyedia email sedang bermasalah.
- **Gagal tertutup terhadap konfigurasi:** tanpa `RESEND_API_KEY` atau
  `EMAIL_PENGIRIM`, fungsi ini tidak mengirim apa pun dan mengembalikan sebab
  `env_kosong` — bukan diam-diam berhasil, dan bukan melempar. Kegagalan senyap
  di jalur email adalah persis kelas cacat R2 yang sudah pernah dibayar (fix F3).
- Tidak ada dependensi baru.

### 3.7 `src/lib/tagihan/email-tagihan.ts` — baru

Perender subject, HTML, dan teks polos. **Murni, tanpa satu pun impor**,
mengikuti pola `pesan-tagihan.ts` — dan diuji sebagai fungsi murni bila kelak
uji ditambahkan.

Isinya sama dengan pesan WhatsApp ditambah yang hanya masuk akal di email:

- rincian per baris (layanan, transport berjenjang, total);
- tenggat sebagai tanggal & jam yang absolut, bukan hanya "24 jam lagi" — email
  dibaca ulang berhari-hari kemudian, dan sisa waktu relatif akan berbohong;
- cara membayar (QRIS di `/passport/bayar`, nominal diketik sendiri);
- akibat bila tenggatnya lewat;
- tautan ke `/passport/bayar`.

Teks polos **wajib** ada berdampingan dengan HTML: klien email yang memblokir
HTML akan menampilkan bagian ini, dan tagihan yang tampil kosong sama saja
dengan tagihan yang tidak terkirim.

Tidak ada honor mitra, tidak ada margin, tidak ada apa pun dari `variant_rates`
selain `harga_klien`.

### 3.8 `src/app/admin/sesi/aksi.ts` — `terbitkanTagihan()`

Urutan baru:

1. Hitung rincian tagihan pengajuan itu.
2. Bila `total === null` → **tolak**, dengan kalimat dari `sebab` (§3.4).
   Belum ada baris yang berubah, jadi tidak ada yang perlu dikompensasi.
3. Update status ke `menunggu_bayar` + `tenggat` (tidak berubah).
4. Bila update mengenai 0 baris → berhenti seperti sekarang.
5. Kirim email. **Kegagalannya tidak menggagalkan langkah 3** — ia dicatat, dan
   nilai balik membawa penanda `emailTerkirim: boolean` supaya layar bisa jujur.

`revalidatePath` tidak berubah.

### 3.9 `src/app/admin/sesi/panel-permintaan.tsx` — blok Tagihan

Blok baru di panel detail permintaan:

- rincian & total, atau
- bila belum lengkap: kalimat yang menyebut sebabnya dan menunjuk layar yang
  memperbaikinya (pemilih pin sudah ada di panel yang sama; titik mitra ada di
  `/admin/mitra`).
- status email: terkirim / gagal, dengan tombol **"Kirim ulang email"**.

Money firewall: berkas ini **tidak** termasuk yang dijaga larangan `formatRupiah`
(`tests/panel-isi.test.ts`, `tests/panel-primitif.test.ts`,
`tests/admin-shell.test.ts`, `tests/admin-agenda.test.ts`,
`tests/admin-tren.test.ts` menyasar `src/app/_shell/panel/**` dan
dasbor/agenda/tren/hak-tukar). Nominal memang sudah lewat halaman ini sejak C2
untuk merakit pesan WhatsApp. Yang tetap terlarang dan tidak dilanggar
pekerjaan ini: honor mitra, margin, dan tabel uang mana pun selain lewat
`harga_klien`/`tarif_klien` yang sudah diturunkan di server.

### 3.10 `src/app/passport/bayar/kartu-tagihan.tsx`

Dari satu angka total menjadi rincian berbaris, dengan total tetap sebagai
elemen paling tebal. `data-total` **dipertahankan** — E2E
`tests/e2e/bayar-pengajuan.e2e.ts` mencarinya, dan penanda itu justru yang dulu
menangkap cacat embed RLS.

Dua kalimat keadaan tak lengkap yang ada sekarang dipertahankan bentuknya,
tetapi kalimat ">20 km ditetapkan tim" tidak lagi jadi jalur normal.

### 3.11 `src/app/passport/ajukan/` — katalog

Bentuknya: kelompok per fase Sanskrit → kartu layanan → varian sebagai pilihan
berkartu dengan durasi, format, harga, dan harga coret. Ringkasan biaya
menempel di bawah:

```
Layanan     Rp 395.000
Transport   dihitung setelah bidan ditetapkan
Perkiraan   Rp 395.000 +
```

Kata "Perkiraan" dan tanda `+` disengaja: transport belum bisa diketahui saat
memesan karena ia berasal dari domisili bidan yang belum dipilih. Menampilkan
harga layanan sebagai "Total" adalah angka yang akan berubah, dan klien akan
membacanya sebagai janji.

Yang **tidak** berubah:

- Kontrak `FormData` ke `ajukanJadwal` — `layanan`, `varian`, `tanggal`, `jam`,
  `waktu`, `alamat`, `catatan`. Seluruh pagar server, gerbang skrining tiga
  lapis, dan trigger basis data tetap utuh tanpa disentuh.
- `export const dynamic = "force-dynamic"` dan larangan cache di
  `src/app/passport/**` (`tests/passport-shell.test.ts`).
- Perangkaian label lewat `labelVarian()` — satu-satunya perangkai label varian
  di proyek ini.

Sumber harga: view `harga_publik`, yang sudah ada, sudah ber-grant, dan sudah
dipakai landing. Nol permukaan data baru, nol pelonggaran money firewall.
Halaman ini berautentikasi, jadi ia membacanya lewat sesi pengguna seperti
query katalognya yang lain — bukan lewat `bacaKatalog()` yang memakai anon key
untuk halaman publik.

Desain visualnya digarap dengan skill `frontend-design`; spec ini menetapkan
struktur dan isinya, bukan estetikanya.

### 3.12 `.env.example`

```
# Resend — pengiriman email tagihan. Tanpa keduanya, tagihan tetap terbit dan
# tetap bisa dikirim lewat WhatsApp, tetapi TIDAK ADA email yang keluar dan
# sebabnya dicatat di log server (bukan gagal senyap).
# Domain pengirim wajib diverifikasi DNS sekali di dashboard Resend; sebelum
# itu Resend menolak setiap kiriman ke alamat selain milik pemilik akun.
RESEND_API_KEY=isi-dari-dashboard-resend
EMAIL_PENGIRIM=PADMA Wellness <tagihan@padmawellnessid.com>
```

---

## 4. Pengujian

Pemilik repo memilih **mode nol uji baru** demi kecepatan.

Yang tetap wajib dikerjakan, dan yang **bukan** uji baru: menjaga suite yang ada
tetap hijau. Berkas berikut hampir pasti merah dan harus disesuaikan pada
perubahan perilaku yang memang disengaja:

- `tests/pesan-tagihan.test.ts` — bentuk pesan berubah.
- `tests/tagihan-pengajuan.test.ts` — cabang `di_atas_20` berubah.
- `tests/transport-tarif-pengerasan.test.ts` — constraint dicabut.
- Sisa dari 10 berkas yang menyentuh `di_atas_20`
  (`passport-turunan`, `owner-transport`, `transport-saran`, `admin-bayar`,
  `owner-rekap-halaman`, `transport-jarak`, `owner-rekap`,
  `transport-alamat-struktur`) diperiksa satu per satu, bukan diasumsikan aman.

`tests/money-firewall-struktural.test.ts` dan `tests/tagihan-baca-hak.test.ts`
**tidak boleh disesuaikan** — keduanya menjaga batas yang pekerjaan ini tidak
berhak menggeser. Bila salah satunya merah, yang salah adalah kodenya.

### Yang jadi buta bagi pengujian manual

Ditulis di sini supaya tidak diklaim sebaliknya kelak:

1. **Tarif menurut tanggal.** Menaikkan tarif hari ini tidak boleh menggeser
   tagihan yang sudah terbit. Ini hanya terlihat dengan dua baris tarif
   ber-`berlaku_sejak` berbeda dan satu tagihan bertanggal lama — keadaan yang
   tidak akan tercipta sendiri saat mengklik layar.
2. **Kegagalan kirim email yang tertelan.** Fungsi kirim sengaja tidak melempar.
   Menguji manual berarti sengaja merusak `RESEND_API_KEY` dan membaca log —
   langkah yang tidak akan dilakukan siapa pun secara rutin.
3. **Kebocoran nominal ke permukaan admin yang salah.** Yang menjaganya adalah
   pemindai sumber, dan mode ini tidak menambah pemindai untuk berkas baru.
4. **Rincian sisi klien vs sisi admin berselisih.** C2 mengunci kesamaan label
   klien & admin lewat uji parity; rincian nominal yang baru tidak punya
   pasangan seperti itu.

---

## 5. Risiko

| Risiko | Bentuk kegagalannya | Yang menahan |
|---|---|---|
| Constraint `di_atas_20` dicabut, lalu kelak ada yang mengira tarif dasar itu satu-satunya sumber | Klien 80 km ditagih sama dengan klien 21 km | Komentar tabel diperbarui; `transport_khusus` tetap menang; layar owner tetap ada |
| Email terkirim ke alamat yang salah | Rincian tagihan seseorang sampai ke orang lain | Tujuan diambil dari `clients.email` baris pengajuan itu, tidak pernah dari input — pola yang sama dengan `nomorWaKlien` yang dulu salah menunjuk nomor klinik |
| Domain Resend belum terverifikasi saat go-live | Setiap tagihan gagal terkirim, senyap bagi klien | Status kirim tampil di panel admin + tombol kirim ulang; sebab dicatat di log |
| Katalog menampilkan harga varian yang tidak aktif | Klien memesan sesuatu berdasar harga yang tidak berlaku | Saringan `aktif` yang sudah ada dipertahankan pada `services` **dan** `service_variants` |
| Perkiraan dibaca klien sebagai total final | Klien terkejut saat tagihan sungguhan datang | Kata "Perkiraan", tanda `+`, dan baris transport yang eksplisit menyebut belum dihitung |

---

## 6. Urutan pengerjaan yang disarankan

1. Basis data & seed (§3.1, §3.2) — tanpa ini tidak ada yang bisa diverifikasi
   di layar.
2. Lapisan hitung & baca (§3.3, §3.4) — sumber angka untuk semua yang lain.
3. Pesan WhatsApp & gerbang penerbitan (§3.5, §3.8) — memperbaiki gejala yang
   dilaporkan.
4. Tampilan admin & klien (§3.9, §3.10).
5. Email (§3.6, §3.7, §3.12) — berdiri di atas rincian yang sudah jadi.
6. Katalog pesan layanan (§3.11) — paling terpisah, paling aman dikerjakan
   terakhir.
