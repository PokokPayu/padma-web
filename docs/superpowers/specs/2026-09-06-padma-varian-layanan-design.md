# PADMA — Varian Layanan & Pricelist Asli — Design Doc

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
| 1 | **Varian layanan & pricelist asli** (dokumen ini) | Prasyarat semuanya. Tanpa varian, harga paket dan tagihan tidak punya satuan. |
| 2 | Paket bundling multi-layanan | `package_items` menunjuk varian. |
| 3 | Transport, alamat klien, domisili mitra | Prasyarat penyelesaian pembayaran paket. |
| 4 | Rangkaian status, payment gateway, kredit & reschedule | Perubahan alur terbesar, paling akhir. |

## 2. Batas Kejujuran — apa yang berubah dan apa yang tidak

**Yang berubah:**

- Katalog memperoleh lapisan baru: layanan → **varian** → harga. Tarif pindah dari per-layanan
  menjadi per-varian.
- `service_rates` **dibubarkan**, digantikan dua tabel dengan batas keamanan berbeda.
- Harga klien menjadi **terbaca publik**. Honor mitra tetap owner-only.
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

- **Honor mitra untuk pricelist asli belum diketahui.** Klien belum pernah menyebut angkanya.
  Seed memakai angka yang ditandai jelas sebagai dummy; produksi harus diisi owner sebelum sesi
  pertama berbayar berjalan. Tarif tanpa honor membuat rekap owner menampilkan margin palsu.
- **Circle di spec ini baru berarti harga, belum berarti sesi rombongan.** Memilih Circle
  menghasilkan sesi satu-klien dengan tarif Circle. Bila di lapangan Circle memang diisi beberapa
  klien sekaligus, honor mitra per sesi dan rekap Sabtu akan salah hitung. Itu perlu spec sendiri.

## 3. Keputusan yang disepakati

| # | Keputusan | Alasan |
|---|---|---|
| V1 | **Varian sebagai daftar datar per layanan** — label bebas + durasi + format | Pola di pricelist tidak seragam: Garbha Relief punya 3 durasi tanpa format; Partner Lab durasi tunggal dengan Private/Circle; Flow Yoga punya 3 program × 2 format; Nurturing Academy punya "2 modul". Model "durasi × format" butuh dimensi ketiga dan tetap tidak memuat "modul". Memecah jadi ~25 baris layanan terpisah ditolak karena materi & skrining yang menempel per layanan ikut terduplikasi. |
| V2 | **`sessions`/`booking_requests` menyimpan `service_id` DAN `variant_id`, dikunci FK gabungan** | `service_variants` diberi `unique (service_id, id)`; sesi memakai `foreign key (service_id, variant_id)`. Database yang menjamin varian milik layanan itu — bukan kode. Alternatif "hanya `variant_id`" memaksa setiap query per-layanan dibongkar jadi join; alternatif "`variant_id` nullable" melahirkan cabang "varian kosong" yang hidup selamanya di tagihan, honor, dan margin. |
| V3 | **Setiap layanan wajib punya minimal satu varian** | Begitu "layanan tanpa varian" boleh ada, setiap perhitungan harga bercabang dua selamanya — cacat yang sama dengan yang ditolak di V2. Layanan berharga tunggal memakai varian berlabel kosong. |
| V4 | **Harga dan honor dipisah ke dua tabel** — `variant_rates` (baca publik) dan `variant_honor` (owner-only) | Harga ingin dipajang, honor tidak boleh bocor sama sekali; hari ini keduanya duduk di satu tabel yang owner-only, sementara migration katalog publik menyatakan tegas "tidak ada angka uang". Memisahkan tabel menjadikan batas keamanan sebagai **batas tabel** — tidak ada cara `select *` membocorkan honor. Alternatif hak-kolom ditolak: ia mematahkan `select *` untuk anon, dan sekali ada query publik yang lupa menyebut kolom, halamannya kosong tanpa error. |
| V5 | **`harga_coret` diisi manual, bukan dihitung `harga + 20.000`** | "+20rb" adalah keputusan pemasaran bulan ini, bukan hukum sistem. Sebagai rumus, ia jadi kode yang harus diubah saat soft launch berakhir; sebagai angka, ia cuma data. Form boleh menyediakan tombol isi-cepat `+20rb` — itu kenyamanan mengetik. |
| V6 | **Penetapan tarif lewat satu fungsi Postgres, atomik** | Harga dan honor kini di dua tabel. Bila harga tersimpan tapi honor gagal, margin salah tanpa satu pun error di layar. Dua `insert` berurutan dari server action tidak memberi jaminan itu. |
| V6a | **Invarian pasangan: setiap baris `variant_rates` punya `variant_honor` dengan `variant_id` dan `berlaku_sejak` yang sama** | Konsekuensi langsung V6, dan syarat agar `tarifPadaTanggal()` tetap punya SATU definisi. Bila kedua riwayat boleh bertanggal berbeda, "tarif yang berlaku" bercabang jadi dua pertanyaan — dan rate card bisa menampilkan margin dari pasangan yang tidak pernah berlaku bersamaan. |
| V7 | **Label "Soft Launch" ditulis di komponen, bukan `app_settings`** | Ia muncul bila `harga_coret` terisi dan hilang bila dikosongkan; itu sudah cukup sebagai sakelar. Menambah kunci pengaturan untuk teks yang belum pernah minta diubah hanya menambah tempat untuk salah. |
| V8 | **`service_rates` dijatuhkan, bukan dibiarkan berdampingan** | Dua sumber harga berarti satu di antaranya pasti basi tanpa ada yang tahu kapan. |
| V9 | **Katalog asli masuk `seed.sql` saja, bukan migrasi produksi** | Data pengembangan jadi realistis (varian bertingkat benar-benar teruji) tanpa menulis angka honor karangan ke database sungguhan. Produksi tetap diisi klien lewat panel, sesuai keputusan #12 spec v1. |
| V10 | **Layanan prekonsepsi (Sankalpa) & menopause (Sandhya) dibuang dari seed** | Keduanya tidak ada di pricelist soft launch. Katalog pengembangan mencerminkan apa yang benar-benar dijual; bila kelak dijual, admin menambahkannya lewat panel. Fase-nya sendiri tetap ada di tabel `phases`. |

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

### 4.3 `variant_rates` (baru, baca publik)

```sql
create table variant_rates (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references service_variants(id),
  harga_klien   int not null,
  harga_coret   int null,
  berlaku_sejak date not null default current_date
);
create index variant_rates_lookup_idx on variant_rates(variant_id, berlaku_sejak desc);
```

`harga_coret` NULL = tampil polos. Terisi = tampil dicoret dengan badge Soft Launch.

### 4.4 `variant_honor` (baru, owner-only)

```sql
create table variant_honor (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references service_variants(id),
  honor_mitra   int not null,
  berlaku_sejak date not null default current_date
);
create index variant_honor_lookup_idx on variant_honor(variant_id, berlaku_sejak desc);
```

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

- RLS aktif di ketiga tabel baru.
- `service_variants`: baca publik untuk `anon` dengan `aktif = true` (menyusul policy `services`),
  kelola untuk staf.
- `variant_rates`: `grant select to anon` + policy baca publik. **Tanpa** hak tulis untuk anon.
  Tulis hanya owner.
- `variant_honor`: `to authenticated`, `user_role() = 'owner'` saja. Tidak ada grant apa pun ke
  `anon`.
- `revoke delete` dari `authenticated` untuk ketiganya.
- Stempel waktu + pemicu `updated_at` untuk `service_variants`.
- Jejak audit untuk `variant_rates` dan `variant_honor`, menyusul apa yang sekarang menempel pada
  `service_rates`.

## 5. Alur & antarmuka

### 5.1 Admin › Layanan — mengelola varian

Varian adalah **katalog, bukan uang**: nama, durasi, format, urutan, aktif. Admin boleh mengubahnya
dan tidak melihat satu nominal pun di layar ini. Tidak ada tombol hapus; varian yang pernah dipakai
sesi hanya bisa dinonaktifkan.

Validasi: layanan tidak boleh kehilangan varian aktif terakhirnya (V3).

### 5.2 Owner › Tarif — per varian

Daftar berpindah dari per-layanan menjadi per-varian. `FormTarif` bertambah satu medan:

| Medan | Tabel tujuan |
|---|---|
| Harga klien | `variant_rates.harga_klien` |
| Harga coret (opsional) | `variant_rates.harga_coret` |
| Honor mitra | `variant_honor.honor_mitra` |

Ketiganya ditulis oleh **satu fungsi Postgres** dalam satu transaksi dengan `berlaku_sejak` yang
sama (V6). Tombol isi-cepat `+20rb` mengisi medan harga coret dari harga klien di sisi klien saja —
ia tidak pernah menjadi aturan server.

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

Satu berkas migrasi, langkah berurutan — urutannya tidak bisa dibalik:

1. Buat `varian_format`, `service_variants`, `variant_rates`, `variant_honor`.
2. Untuk **tiap** layanan yang ada, terbitkan satu varian baku (label kosong, durasi & format NULL).
3. Pindahkan tiap baris `service_rates` → `variant_rates` (`harga_klien`, `harga_coret` NULL) +
   `variant_honor` (`honor_mitra`), dengan `berlaku_sejak` **dipertahankan apa adanya**. Riwayat
   tarif adalah bukti berapa honor yang seharusnya dibayarkan pekan lalu; ia tidak boleh dibulatkan
   ke hari migrasi.
4. Isi `sessions.variant_id` dan `booking_requests.variant_id` dengan varian baku layanannya.
5. Pasang `NOT NULL` + FK gabungan.
6. Pindahkan pemicu jejak audit dari `service_rates` ke tabel baru, lalu `drop table service_rates`.
   Menjatuhkan tabel yang punya pemicu bukan sekadar `drop` — pemicunya harus punya rumah baru
   lebih dulu.
7. Pengerasan §4.6.

### 6.1 Seed katalog asli (V9, V10)

8 layanan, 22 varian. `harga_coret` = `harga_klien` + 20.000 untuk seluruh baris.
`honor_mitra` diisi angka **dummy bertanda**, karena klien belum menyebutkannya.

| Layanan | Fase | Varian | Harga |
|---|---|---|---|
| Garbha Relief | kehamilan | 60 menit | 139.000 |
| | | 90 menit | 179.000 |
| | | 120 menit | 219.000 |
| Garbha Partner Lab | kehamilan | 90 menit · Private | 179.000 |
| | | 90 menit · Circle | 109.000 |
| Garbha Flow Yoga | kehamilan | Basic · 60 menit · Private | 139.000 |
| | | Basic · 60 menit · Circle | 99.000 |
| | | Complete · 120 menit · Private | 219.000 |
| | | Complete · 120 menit · Circle | 119.000 |
| | | Couple · 120 menit · Private | 219.000 |
| | | Couple · 120 menit · Circle | 119.000 |
| Shishu Parents Touch | newborn | 90 menit · Private | 179.000 |
| | | 90 menit · Circle | 109.000 |
| Shishu Nurturing Academy | newborn | 60 menit · 2 modul | 139.000 |
| | | 120 menit · 3 modul | 219.000 |
| Purnama Rest | nifas | 60 menit | 139.000 |
| | | 90 menit | 179.000 |
| | | 120 menit | 219.000 |
| Lactation Hero + Partner Comfort Touch | nifas | 120 menit · Private | 219.000 |
| | | 120 menit · Circle | 119.000 |
| Return to Work | nifas | 120 menit · Private | 219.000 |
| | | 120 menit · Circle | 119.000 |

Layanan prekonsepsi dan menopause di seed lama dibuang (V10); `phases` tidak disentuh.

## 7. Pengujian

Test-first, mengikuti pola berkas uji yang sudah ada.

**Pagar — wajib diuji langsung ke database.** Pagar yang hanya diuji lewat kode aplikasi akan lolos
begitu ada jalur lain yang menyentuh tabel yang sama.

| # | Uji | Menyusul pola |
|---|---|---|
| P1 | FK gabungan menolak sesi bervarian milik layanan lain | — (inti V2) |
| P2 | `variant_rates` terbaca `anon`; `variant_honor` ditolak `anon` **dan** ditolak `admin` | `grant-anon.test.ts` |
| P3 | `revoke delete` pada ketiga tabel baru | `hak-hapus-berlebih.test.ts` |
| P4 | Tidak ada hak tulis `anon` pada tabel baru | `grant-anon.test.ts` |

**Perilaku:**

| # | Uji |
|---|---|
| B1 | Penetapan tarif atomik: paksa penulisan honor gagal → harga **tidak** ikut tersimpan (inti V6; tanpa uji ini fungsi Postgres-nya hanya dekorasi) |
| B2 | Pemilihan harga berlaku: baris bertanggal masa depan diabaikan; baris terbaru ≤ hari ini dipakai |
| B3 | `harga_coret` NULL → tanpa badge; terisi → harga dicoret + badge Soft Launch |
| B4 | Migrasi: setiap sesi lama punya `variant_id` yang layanannya cocok |
| B5 | Migrasi: cacah `variant_rates` sama persis dengan cacah `service_rates` sebelum dijatuhkan |
| B6 | Landing hanya menampilkan varian `aktif`, urut `urutan` |
| B7 | Layanan tidak bisa kehilangan varian aktif terakhirnya (V3) |
| B8 | Panel admin tidak memuat nominal — asersi money firewall yang sudah ada tetap hijau |
| B9 | Invarian pasangan V6a: setiap `variant_rates` punya `variant_honor` bertanggal sama — diuji setelah migrasi DAN setelah penetapan tarif dari form |

## 8. Berkas terdampak

Ditelusuri lewat pembacaan `service_rates` dan `harga_klien`/`honor_mitra` di `web/src`.

| Berkas | Perubahan |
|---|---|
| `src/lib/owner/data.ts` | `ambilTarif()` membaca dua tabel dan menggabungkannya per (`variant_id`, `berlaku_sejak`) — invarian V6a yang membuat penggabungan ini tidak ambigu. `ambilRateCard()` mendaftar per varian, bukan per layanan. |
| `src/lib/owner/rekap.ts` | Pencocokan tarif ke sesi berpindah dari `service_id` ke `variant_id`. `tarifPadaTanggal()` tetap satu definisi. |
| `src/app/owner/tarif/aksi.ts` | `tetapkanTarif()` memanggil fungsi Postgres (V6), bukan `insert` ke satu tabel. |
| `src/app/owner/tarif/form-tarif.tsx` | Medan `harga_coret` + tombol isi-cepat `+20rb`. Komentar tentang `service_rates` dimutakhirkan ke tabel penggantinya. |
| `src/app/owner/tarif/status.ts` `page.tsx` | Baris daftar per varian. |
| `src/app/admin/layanan/*` | Pengelolaan varian (§5.1). |
| `src/app/passport/bayar/page.tsx` | Komentar rujukan tabel; harga sesi dibaca lewat varian. |
| `src/lib/owner/rupiah.ts` | Komentar rujukan tabel. Aturan rupiah bulat tidak berubah. |
| `src/lib/admin/tagihan.ts` | Label sesi menyertakan varian. |
| Landing katalog | Menampilkan varian + harga (§5.3). |

Berkas uji yang asersinya ikut berubah: `landing-katalog`, `admin-layanan`, dan berkas uji owner
yang menyentuh rate card. **Maksud** di balik tiap asersi dijaga; yang ditulis ulang adalah
bentuknya, dan tiap penulisan ulang wajib menjelaskan di komentar apa yang tetap dijaga.

## 9. Di luar ruang lingkup

Disebut eksplisit supaya tidak dikira sudah beres:

- **Paket bundling multi-layanan** — spec berikutnya, bergantung pada dokumen ini.
- **Transport, alamat klien, domisili mitra, tarif berjenjang, subsidi 0–5 km.**
- **Rangkaian status baru** (`MATCHING_MITRA`, `AWAITING_PAYMENT`, `IN_PROGRESS`, …), payment
  gateway, kredit layanan 30 hari, jatah reschedule.
- **Circle sebagai sesi rombongan** — lihat §2 "Yang tidak dijamin".
