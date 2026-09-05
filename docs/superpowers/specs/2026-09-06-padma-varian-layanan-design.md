# PADMA — Varian Layanan & Harga Bertingkat — Design Doc

**Tanggal:** 6 September 2026
**Status:** menunggu review

## 1. Konteks

Klien mengirim dua catatan:

1. *"Itu harga soft launch ya mas, harga normal, ditambah 20 rb semua."*
2. *"Paket bundling dengan RS misal beli 1 paket isinya bbrp layanan, tapi yg beli 1 orang, nanti
   untuk penjadwalan di web bgmn? Krn layanan tdk selesai 1 waktu tapi bbrp waktu."*

Menelusuri keduanya ke dalam skema hari ini memunculkan temuan yang lebih besar dari catatannya
sendiri: **pricelist asli PADMA tidak muat di model data mana pun yang ada.** Di pricelist, satu
layanan punya banyak harga — Garbha Relief 139k/179k/219k untuk 60/90/120 menit; Garbha Partner Lab
179k Private dan 109k Circle. Skema hari ini: `services` tidak punya durasi maupun format, dan
`service_rates` menyimpan tepat satu harga per layanan.

Akibatnya catatan #1 tidak bisa ditutup sebelum ini dibereskan — "+20rb semua" berarti +20rb per
**baris harga**, dan baris-baris harga itu belum punya tempat. Catatan #2 juga menumpang di sini:
isi paket bundling ("Garbha Relief ×3") tidak bermakna sebelum jelas 60 atau 120 menit.

Pekerjaan dipecah jadi empat spec berurutan. Dokumen ini yang **pertama**:

| Urutan | Spec | Alasan urutan |
|---|---|---|
| 1 | **Varian layanan & harga bertingkat** (dokumen ini) | Prasyarat semuanya. Tanpa varian, harga paket dan tagihan tidak punya satuan. |
| 2 | Paket bundling multi-layanan | `package_items` menunjuk varian. |
| 3 | Transport, alamat klien, domisili mitra | Prasyarat penyelesaian pembayaran paket. |
| 4 | Rangkaian status, payment gateway, kredit & reschedule | Perubahan alur terbesar, paling akhir. |

## 2. Batas Kejujuran — apa yang berubah dan apa yang tidak

**Yang berubah:**

- Katalog memperoleh lapisan baru: layanan → **varian** → harga. Tarif pindah dari per-layanan
  menjadi per-varian.
- `service_rates` **dibubarkan**, digantikan `variant_rates` beserta seluruh pagarnya.
- Harga klien menjadi **terbaca publik lewat view berkolom sempit**. Honor mitra tetap owner-only
  dan tidak pernah masuk proyeksi view mana pun.
- `sessions` dan `booking_requests` menyimpan `variant_id`.
- Owner › Tarif berpindah dari daftar per-layanan ke per-varian, dengan medan baru "harga coret".
- Admin › Layanan memperoleh pengelolaan varian.
- Landing publik menampilkan harga.

**Yang TIDAK berubah, dan sengaja dijaga tidak berubah:**

- **`materials.service_id` tetap per layanan.** E-book Garbha Relief sama saja untuk 60 atau 120
  menit; menautkannya ke varian hanya melahirkan tiga salinan materi identik.
- **Semua query yang menyaring `service_id`** — agenda, tren sesi, gating materi, rekap owner —
  tidak diubah satu baris pun. Ini konsekuensi sengaja dari keputusan V2.
- **Money firewall.** Panel admin tetap tidak memuat satu nominal pun. Honor mitra tetap hanya
  hidup di `/owner` dan penolakannya tetap ditegakkan di level basis data.
- **Pola tarif append-only.** Mengubah harga tetap berarti `insert` baris baru bertanggal berlaku,
  tidak pernah `update` baris lama. Rekap honor membaca tarif yang berlaku pada tanggal sesi.
- **Hak hapus.** Tidak ada tombol hapus untuk varian maupun tarif; yang ada hanya `aktif = false`.

**Yang tidak dijamin:**

- **Pricelist asli tidak ikut masuk repo** (V10). Katalog produksi tetap diisi klien lewat panel,
  dan honor mitra untuk harga-harga itu belum pernah disebut klien. Tarif tanpa honor membuat rekap
  owner menampilkan margin palsu, jadi pengisiannya harus lengkap sebelum sesi berbayar pertama.
- **Circle di spec ini baru berarti harga, belum berarti sesi rombongan.** Memilih Circle
  menghasilkan sesi satu-klien dengan tarif Circle. Bila di lapangan Circle memang diisi beberapa
  klien sekaligus, honor mitra per sesi dan rekap Sabtu akan salah hitung. Itu perlu spec sendiri.

## 3. Keputusan yang disepakati

| # | Keputusan | Alasan |
|---|---|---|
| V1 | **Varian sebagai daftar datar per layanan** — label bebas + durasi + format | Pola di pricelist tidak seragam: Garbha Relief punya 3 durasi tanpa format; Partner Lab durasi tunggal dengan Private/Circle; Flow Yoga punya 3 program × 2 format; Nurturing Academy punya "2 modul". Model "durasi × format" butuh dimensi ketiga dan tetap tidak memuat "modul". Memecah jadi ~25 baris layanan terpisah ditolak karena materi & skrining yang menempel per layanan ikut terduplikasi. |
| V2 | **`sessions`/`booking_requests` menyimpan `service_id` DAN `variant_id`, dikunci FK gabungan** | `service_variants` diberi `unique (service_id, id)`; sesi memakai `foreign key (service_id, variant_id)`. Database yang menjamin varian milik layanan itu — bukan kode. Alternatif "hanya `variant_id`" memaksa setiap query per-layanan dibongkar jadi join; alternatif "`variant_id` nullable" melahirkan cabang "varian kosong" yang hidup selamanya di tagihan, honor, dan margin. |
| V3 | **Setiap layanan wajib punya minimal satu varian** | Begitu "layanan tanpa varian" boleh ada, setiap perhitungan harga bercabang dua selamanya — cacat yang sama dengan yang ditolak di V2. Layanan berharga tunggal memakai varian berlabel kosong. |
| V4 | **Satu tabel `variant_rates` (harga + harga coret + honor), harga dipajang lewat VIEW berkolom sempit `harga_publik` dengan `security_invoker = off`** | Harga ingin dipajang, honor tidak boleh bocor. Memecahnya jadi dua tabel terdengar lebih aman, tetapi mematikan `check (honor_mitra <= harga_klien)` — CHECK lintas-tabel tidak ada, jadi ia turun pangkat jadi trigger yang menengok tabel sebelah dan benar hanya bila urutan insert benar, plus satu trigger lagi untuk menjaga pasangannya. Tiga pagar terbukti menjadi lima pagar yang lebih lemah. View berkolom sempit adalah pola yang SUDAH berlaku di proyek ini untuk persoalan yang sama persis (`partner_publik`, `pengerasan_admin.sql`): view itulah batas kolomnya. Penolakan view di `lib/owner/rekap.ts` menyasar view AGREGAT yang diam-diam melewati RLS — bukan view sempit yang sengaja menjadi pagar. |
| V5 | **`harga_coret` diisi manual, bukan dihitung `harga + 20.000`** | "+20rb" adalah keputusan pemasaran bulan ini, bukan hukum sistem. Sebagai rumus, ia jadi kode yang harus diubah saat soft launch berakhir; sebagai angka, ia cuma data. Form boleh menyediakan tombol isi-cepat `+20rb` — itu kenyamanan mengetik. |
| V6 | **Seluruh pagar uang `service_rates` dipindah APA ADANYA ke `variant_rates`** — `unique (variant_id, berlaku_sejak)`, `check (harga_klien >= 0 and honor_mitra >= 0 and honor_mitra <= harga_klien)`, `guard_tarif_maju`, `kunci_riwayat_tarif` | Pagar-pagar itu lahir dari temuan red team dengan bukti tertulis; mengganti tabelnya tanpa memindahkan pagarnya berarti membayar ulang temuan yang sama. Karena harga dan honor tetap satu baris, penetapan tarif atomik dengan sendirinya — tidak perlu fungsi Postgres khusus maupun invarian pasangan. |
| V7 | **Label "Soft Launch" ditulis di komponen, bukan `app_settings`** | Ia muncul bila `harga_coret` terisi dan hilang bila dikosongkan; itu sudah cukup sebagai sakelar. Menambah kunci pengaturan untuk teks yang belum pernah minta diubah hanya menambah tempat untuk salah. |
| V8 | **`service_rates` dijatuhkan, bukan dibiarkan berdampingan** | Dua sumber harga berarti satu di antaranya pasti basi tanpa ada yang tahu kapan. |
| V9 | **Seed tetap memakai 10 layanan dummy yang ada — UUID dan namanya tidak disentuh** — tetapi tiga layanan yang TIDAK pernah disebut berkas uji mana pun (`…107`, `…108`, `…109`) diberi varian bertingkat | Data pengembangan butuh contoh varian bertingkat, kalau tidak bug tampilan varian baru ketahuan di produksi. Tapi 25 berkas uji menyebut UUID layanan seed — yang terbanyak justru `…101` dengan 14 kemunculan — sehingga mengganti katalog seed memerahkan seperempat suite yang isinya tidak berhubungan dengan varian. Memilih tiga layanan yang tidak dirujuk siapa pun memberi contoh bertingkat dengan radius nol. |
| V10 | **Pricelist asli TIDAK masuk repo pada spec ini** | Keputusan #12 spec v1 tetap berlaku: klien mengisi katalognya sendiri lewat panel saat live. Memasukkan 8 layanan + 22 varian asli menuntut pembongkaran ~25 berkas uji dari UUID keras menjadi pencarian lewat fixture bersama — perbaikan yang sah, tetapi pekerjaan tersendiri yang menyentuh berkas jauh di luar ruang lingkup varian. Honor mitra untuk harga-harga itu juga belum pernah disebut klien. |

## 4. Skema

### 4.1 Enum baru

```sql
create type varian_format as enum ('private','circle');
```

### 4.2 `service_variants` (baru)

```sql
create table service_variants (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references services(id),
  label         text not null default '',
  durasi_menit  int null check (durasi_menit is null or durasi_menit > 0),
  format        varian_format null,
  urutan        int not null default 0,
  aktif         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (service_id, id)          -- penopang FK gabungan V2, urutan kolom
                                   -- sengaja sama dengan klausa REFERENCES
);
create index service_variants_service_idx on service_variants(service_id, urutan);
```

`label` menampung apa pun yang membedakan varian di luar durasi & format: `"Basic"`, `"Couple"`,
`"2 modul"`, atau kosong. Tampilan dirangkai dari ketiganya: `Basic · 60 menit · Private`,
`60 menit · 2 modul`, `90 menit`.

### 4.3 `variant_rates` (baru) — pengganti `service_rates`

```sql
create table variant_rates (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references service_variants(id),
  harga_klien   int not null,
  harga_coret   int null,
  honor_mitra   int not null,
  berlaku_sejak date not null default current_date,
  constraint variant_rates_unik_per_tanggal unique (variant_id, berlaku_sejak),
  constraint variant_rates_nilai_wajar check (
    harga_klien >= 0 and honor_mitra >= 0 and honor_mitra <= harga_klien
    and (harga_coret is null or harga_coret >= harga_klien)
  )
);
create index variant_rates_lookup_idx on variant_rates(variant_id, berlaku_sejak desc);
```

`harga_coret` NULL = tampil polos. Terisi = tampil dicoret dengan badge Soft Launch. Syarat
`harga_coret >= harga_klien` ikut di CHECK yang sama: harga coret yang lebih murah dari harga jual
bukan promo, ia salah ketik yang tampil ke pengunjung sebagai kenaikan harga.

Pagar yang dipindah dari `service_rates` (V6), dengan `service_id` diganti `variant_id`:

- `unique (variant_id, berlaku_sejak)` — tanpanya `tarifPadaTanggal()` memilih salah satu baris
  kembar sewenang-wenang, dan honor yang dibayarkan bergantung pada urutan baris hari itu.
- `guard_tarif_maju` — menolak `berlaku_sejak` yang tidak maju, dari peran API saja. Tarif
  retroaktif menggeser rekap pekan yang honornya sudah dibayarkan.
- `kunci_riwayat_tarif` — menolak SETIAP `UPDATE` dari peran API. Tabel ini append-only.
- Verba `DELETE` dicabut dari `authenticated`.

Ketiganya memakai gerbang `current_user not in ('anon','authenticated','authenticator')` yang sama,
sehingga seed, migrasi, dan fixture test yang berjalan sebagai `postgres`/`service_role` tetap bisa
menyemai tanggal lampau.

### 4.4 `harga_publik` (view baru, dibaca `anon`)

```sql
create view public.harga_publik with (security_invoker = off) as
  select variant_id, harga_klien, harga_coret, berlaku_sejak
    from public.variant_rates
   where berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date;

revoke all on public.harga_publik from public, anon, authenticated;
grant select on public.harga_publik to anon, authenticated;
```

Tiga hal yang disengaja:

- **`security_invoker = off`** — view berjalan sebagai pemiliknya, jadi ia melewati RLS
  `variant_rates`. Itulah gunanya: pengunjung memang tidak punya, dan tidak boleh punya, hak baca
  atas tabel dasarnya. Pola yang sama dengan `partner_publik`.
- **Kolom `honor_mitra` tidak ada di proyeksi.** Batas kerahasiaannya adalah daftar kolom view ini,
  dan daftar itu dikunci sebagai assertion (§7, P5) supaya penambahan kolom di kemudian hari tidak
  bisa lolos diam-diam.
- **`where berlaku_sejak <= hari ini (Jakarta)`** — tarif yang belum berlaku tidak bocor ke
  pengunjung. Kalendernya Jakarta, bukan `current_date` yang UTC, mengikuti aturan yang sudah
  dipakai `jaga_tanda_honor`.

`variant_rates` sendiri tetap tertutup bagi `anon` di level HAK TABEL — tidak ada `grant` apa pun.
Jadi harga terbaca publik **hanya** lewat view ini, tidak pernah lewat tabelnya.

### 4.5 Perubahan tabel yang ada

```sql
alter table sessions          add column variant_id uuid;
alter table booking_requests  add column variant_id uuid;
-- setelah backfill (§6):
alter table sessions          alter column variant_id set not null;
alter table sessions          add constraint sessions_varian_milik_layanan
  foreign key (service_id, variant_id) references service_variants (service_id, id);
-- idem booking_requests
```

`drop table service_rates` — beserta pemicu jejak audit yang menempel padanya; lihat §6 langkah 6.

### 4.6 Pengerasan

Mengikuti pola yang sudah berlaku di proyek:

- RLS aktif di `service_variants` dan `variant_rates`.
- `service_variants`: baca publik untuk `anon` dengan `aktif = true` (menyusul policy `services`),
  kelola untuk staf. `grant select to anon`, tanpa hak tulis.
- `variant_rates`: policy `"rates: hanya owner"` dipindah apa adanya. **Tanpa** grant apa pun ke
  `anon` — harga publik lewat view §4.4 saja.
- `harga_publik`: `revoke all from public` lebih dulu, baru `grant select` eksplisit. Aturan [F]
  migration `fail_closed_sequence_fungsi` berlaku untuk objek baru.
- `revoke delete on variant_rates from authenticated`; idem `service_variants`.
- Stempel waktu + pemicu `updated_at` untuk `service_variants`.
- **Tidak ada jejak audit yang perlu dipindah.** Diverifikasi: `service_rates` hanya memiliki dua
  pemicu, `trg_guard_tarif_maju` dan `trg_kunci_riwayat_tarif`, keduanya dari
  `pengerasan_tabel_uang`. `catat_status_bayar` menempel pada `sessions`/`client_packages`, bukan
  pada tabel tarif.
- `tests/money-firewall-struktural.test.ts`: `TABEL_UANG` menjadi `variant_rates` + `honor_marks`,
  dan view `harga_publik` didaftarkan sebagai **pengecualian yang dijelaskan** — bukan pelebaran
  diam-diam. Komentarnya menyebut alasannya: harga klien memang diputuskan tampil publik; honor
  mitra tetap tidak pernah keluar dari `variant_rates`.

## 5. Alur & antarmuka

### 5.1 Admin › Layanan — mengelola varian

Varian adalah **katalog, bukan uang**: nama, durasi, format, urutan, aktif. Admin boleh mengubahnya
dan tidak melihat satu nominal pun di layar ini. Tidak ada tombol hapus; varian yang pernah dipakai
sesi hanya bisa dinonaktifkan.

Validasi: layanan tidak boleh kehilangan varian aktif terakhirnya (V3).

### 5.2 Owner › Tarif — per varian

Daftar berpindah dari per-layanan menjadi per-varian. `FormTarif` bertambah satu medan:

| Medan | Kolom |
|---|---|
| Harga klien | `variant_rates.harga_klien` |
| Harga coret (opsional) | `variant_rates.harga_coret` |
| Honor mitra | `variant_rates.honor_mitra` |

Ketiganya satu baris, satu `insert` — atomik tanpa perlu fungsi Postgres khusus (V6). Aturan yang
sudah berlaku di `tetapkanTarif()` tidak berubah: INSERT-only, tanggal berlaku tidak boleh mundur,
honor tidak boleh melebihi harga, dan hasil `insert` diperiksa panjangnya karena INSERT yang
tertahan RLS dijawab PostgREST sebagai 200 + `[]`.

Satu validator baru di `status.ts`: harga coret, bila diisi, tidak boleh lebih kecil dari harga
klien — pesannya kalimat, dan CHECK basis data tetap menjadi lapisan terakhir.

Tombol isi-cepat `+20rb` mengisi medan harga coret dari harga klien di sisi klien saja; ia tidak
pernah menjadi aturan server (V5).

### 5.3 Landing publik

Kartu layanan memuat daftar varian aktif beserta harga:

```
Garbha Relief · Pijat relaksasi bumil
  60 menit     Rp159.000  Rp139.000  Soft Launch
  90 menit     Rp199.000  Rp179.000  Soft Launch
  120 menit    Rp239.000  Rp219.000  Soft Launch
```

Harga berlaku = baris `variant_rates` dengan `berlaku_sejak` terbesar yang tidak melewati hari ini
menurut kalender Jakarta. Aturan ini sudah dipakai rekap owner; tidak ada aturan baru.

### 5.4 Passport › ajukan jadwal

Klien memilih **varian**, bukan layanan. Ini juga pijakan yang dibutuhkan spec paket bundling.

## 6. Migrasi & data

Satu berkas migrasi, langkah berurutan — urutannya tidak bisa dibalik. Cap waktu ditulis MANUAL dan
lebih besar dari berkas migrasi terakhir; `supabase migration new` memakai jam dinding dan pernah
menyelipkan migrasi ke tengah riwayat sehingga `db reset` gagal.

1. Buat `varian_format` dan `service_variants` beserta pengerasannya.
2. Untuk **tiap** layanan yang ada, terbitkan satu varian baku (label kosong, durasi & format NULL).
3. Buat `variant_rates` beserta seluruh pagar §4.3.
4. Salin tiap baris `service_rates` → `variant_rates`, dipetakan ke varian baku layanannya, dengan
   `berlaku_sejak` **dipertahankan apa adanya** dan `harga_coret` NULL. Riwayat tarif adalah bukti
   berapa honor yang seharusnya dibayarkan pekan lalu; ia tidak boleh dibulatkan ke hari migrasi.
   Penyalinan ini berjalan sebagai `postgres`, jadi `guard_tarif_maju` melewatkannya — persis
   gerbang peran yang sudah ada, bukan pengecualian baru.
5. Isi `sessions.variant_id` dan `booking_requests.variant_id` dengan varian baku layanannya.
6. Pasang `NOT NULL` + FK gabungan pada kedua tabel.
7. Buat view `harga_publik` beserta grant-nya (§4.4).
8. `drop table service_rates`, sesudah kode berhenti membacanya. Kedua pemicunya
   (`trg_guard_tarif_maju`, `trg_kunci_riwayat_tarif`) ikut jatuh bersama tabelnya, dan kedua
   fungsinya dibersihkan terpisah karena hanya tabel itu yang memakainya. Tidak ada jejak audit
   yang perlu dipindahkan — lihat §4.6.

### 6.1 Seed — contoh varian bertingkat (V9, V10)

Seed tidak diganti. Sepuluh layanan dummy, UUID dan namanya tetap. Yang ditambahkan hanya varian
untuk tiga layanan yang **tidak dirujuk satu berkas uji pun** — diverifikasi dengan
`grep -rl '…111107' tests` dan seterusnya, ketiganya nol:

| Layanan seed | Varian yang disemai | Dimensi yang diuji |
|---|---|---|
| `…111107` Purnama Recovery Massage | 60 menit · 90 menit · 120 menit | durasi bertingkat, tanpa format |
| `…111109` Shishu Parent Touch | 90 menit · Private, 90 menit · Circle | format, durasi tunggal |
| `…111108` Sandhya Balance Care | varian baku (label kosong) | layanan berharga tunggal |

Tujuh layanan lain memperoleh varian baku dari migrasi (§6 langkah 2), jadi seluruh seed tetap
memenuhi V3 tanpa satu pun perubahan pada baris `services`.

Tarif untuk varian tambahan disemai dengan `harga_coret` terisi pada sebagian baris saja, supaya
kedua cabang tampilan (dicoret / polos) ada di data pengembangan.

Pricelist asli PADMA — 8 layanan, 22 varian, harga soft launch beserta harga normalnya — tetap
menjadi pekerjaan pengisian katalog oleh klien lewat panel, di luar repo (V10).

## 7. Pengujian

Test-first, mengikuti pola berkas uji yang sudah ada.

**Pagar — wajib diuji langsung ke database** lewat `querySql`/`dalamTransaksiRollback`
(`tests/helpers/db.ts`). Pagar yang hanya diuji lewat kode aplikasi akan lolos begitu ada jalur lain
yang menyentuh tabel yang sama — dan REST selalu jalur lain itu.

| # | Uji | Menyusul pola |
|---|---|---|
| P1 | FK gabungan menolak sesi bervarian milik layanan lain | — (inti V2) |
| P2 | `anon` tidak memegang hak tabel maupun hak KOLOM apa pun atas `variant_rates` | `grant-anon.test.ts` |
| P3 | `anon` hanya memegang `SELECT` atas `service_variants` dan view `harga_publik` — tanpa hak tulis | `grant-anon.test.ts` |
| P4 | `revoke delete` pada `service_variants` dan `variant_rates` | `hak-hapus-berlebih.test.ts` |
| P5 | Daftar kolom view `harga_publik` **persis** `variant_id, harga_klien, harga_coret, berlaku_sejak` — `honor_mitra` tidak ada | `money-firewall-struktural.test.ts` |
| P6 | `guard_tarif_maju` menolak `berlaku_sejak` mundur lewat REST sebagai owner; `kunci_riwayat_tarif` menolak setiap `UPDATE` lewat REST sebagai owner | `owner-pengerasan.test.ts` |
| P7 | CHECK menolak `honor_mitra > harga_klien` dan `harga_coret < harga_klien` | `owner-pengerasan.test.ts` |
| P8 | View menahan tarif bertanggal masa depan: baris ber-`berlaku_sejak` besok tidak muncul bagi `anon` | — |

**Perilaku:**

| # | Uji |
|---|---|
| B1 | `tetapkanTarif()` menolak harga coret yang lebih kecil dari harga klien, dengan kalimat — bukan SQLSTATE |
| B2 | Pemilihan harga berlaku: baris bertanggal masa depan diabaikan; baris terbaru ≤ hari ini dipakai |
| B3 | `harga_coret` NULL → tanpa badge; terisi → harga dicoret + badge Soft Launch |
| B4 | Migrasi: setiap sesi lama punya `variant_id` yang layanannya cocok |
| B5 | Migrasi: cacah `variant_rates` sama persis dengan cacah `service_rates` sebelum dijatuhkan, dan tiap `berlaku_sejak` terbawa apa adanya |
| B6 | Landing hanya menampilkan varian `aktif`, urut `urutan` |
| B7 | Layanan tidak bisa kehilangan varian aktif terakhirnya (V3) |
| B8 | Panel admin tidak memuat nominal — asersi money firewall yang sudah ada tetap hijau |
| B9 | Rekap honor mencocokkan tarif ke sesi lewat `variant_id`, dan `tarifPadaTanggal()` tetap satu definisi yang dipakai bersama rate card |

## 8. Berkas terdampak

Ditelusuri lewat pembacaan `service_rates` dan `harga_klien`/`honor_mitra` di `web/src`.

| Berkas | Perubahan |
|---|---|
| `src/lib/owner/data.ts` | `ambilTarif()` membaca `variant_rates` dan ikut membawa `harga_coret`. `ambilRateCard()` mendaftar per varian, bukan per layanan. |
| `src/lib/owner/rekap.ts` | Pencocokan tarif ke sesi berpindah dari `service_id` ke `variant_id`. `tarifPadaTanggal()` tetap satu definisi. |
| `src/app/owner/tarif/aksi.ts` | Menulis ke `variant_rates`, memvalidasi varian (bukan layanan), dan memeriksa harga coret. INSERT-only tetap. |
| `src/app/owner/tarif/form-tarif.tsx` | Medan `harga_coret` + tombol isi-cepat `+20rb`. Komentar tentang `service_rates` dimutakhirkan ke tabel penggantinya. |
| `src/app/owner/tarif/status.ts` `page.tsx` | Validator harga coret + kalimatnya; baris daftar per varian. |
| `src/app/admin/layanan/*` | Pengelolaan varian (§5.1). |
| `src/app/passport/bayar/page.tsx` | Komentar rujukan tabel; harga sesi dibaca lewat varian. |
| `src/lib/owner/rupiah.ts` | Komentar rujukan tabel. Aturan rupiah bulat tidak berubah. |
| `src/lib/admin/tagihan.ts` | Label sesi menyertakan varian. |
| Landing katalog | Menampilkan varian + harga (§5.3). |

Berkas uji yang asersinya ikut berubah: `landing-katalog`, `admin-layanan`, `grant-anon`,
`hak-hapus-berlebih`, `money-firewall-struktural`, `owner-pengerasan`, `owner-tarif`, `owner-rekap`. **Maksud** di balik tiap asersi dijaga; yang ditulis ulang adalah
bentuknya, dan tiap penulisan ulang wajib menjelaskan di komentar apa yang tetap dijaga.

## 9. Di luar ruang lingkup

Disebut eksplisit supaya tidak dikira sudah beres:

- **Paket bundling multi-layanan** — spec berikutnya, bergantung pada dokumen ini.
- **Transport, alamat klien, domisili mitra, tarif berjenjang, subsidi 0–5 km.**
- **Rangkaian status baru** (`MATCHING_MITRA`, `AWAITING_PAYMENT`, `IN_PROGRESS`, …), payment
  gateway, kredit layanan 30 hari, jatah reschedule.
- **Circle sebagai sesi rombongan** — lihat §2 "Yang tidak dijamin".
- **Pengisian katalog asli ke repo** beserta pelepasan ~25 berkas uji dari UUID seed yang
  ditulis keras (V10). Pekerjaan tersendiri; sah, tapi bukan bagian dari varian.
