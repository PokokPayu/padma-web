# PADMA — Transport, Alamat & Jarak — Design Doc

**Tanggal:** 7 September 2026
**Status:** menunggu review

## 1. Konteks

Materi klien memuat skema transport mitra yang belum punya satu bahan pun di skema hari ini:

| Jarak | Klien membayar |
|---|---|
| 0–5 km | **Rp0** (soft launch benefit) |
| >5–10 km | Rp10.000 |
| >10–15 km | Rp20.000 |
| >15–20 km | Rp30.000 |
| >20 km | konfirmasi admin |

Dengan satu detail yang tidak boleh hilang: pada 0–5 km klien dikenakan Rp0 tetapi **mitra tetap
menerima Rp10.000**; selisihnya ditanggung PADMA.

Hari ini `clients` tidak punya alamat rumah, `partners` tidak punya domisili, dan tidak ada konsep
jarak di mana pun. Tarif transport karena itu tidak bisa dihitung, dan tagihan sesi tidak pernah
lengkap.

Spec ini yang **kedua** dari empat. Urutannya ditukar dari rencana semula:

| Urutan | Spec | Keadaan |
|---|---|---|
| 1 | Varian layanan & harga bertingkat | **selesai**, ter-merge 7 Sep 2026 (`8a3ca4b`) |
| 2 | **Transport, alamat & jarak** (dokumen ini) | — |
| 3 | Paket bundling multi-layanan | menunggu dokumen ini |
| 4 | Rangkaian status, payment gateway, kredit & reschedule | — |

**Kenapa ditukar.** Brainstorming paket menghasilkan keputusan "klien membayar sesudah SELURUH mitra
ditentukan — harga paket + total transport, sekali bayar". Keputusan itu menuntut transport. Tanpa
dokumen ini lebih dulu, paket bisa dibangun tetapi tidak pernah bisa dikonfirmasi: tagihannya tidak
pernah lengkap. Menukar urutannya membuat paket lahir sudah bisa dipakai sejak hari pertama.

## 2. Batas Kejujuran — apa yang berubah dan apa yang tidak

**Yang berubah:**

- `clients`, `partners`, `booking_requests`, dan `sessions` memperoleh alamat beserta koordinatnya.
- Jenjang transport menjadi data operasional pada sesi; tarifnya hidup di tabel uang baru.
- Rekap honor Sabtu bertambah komponen transport.
- Panel admin memperoleh saran jenjang saat memilih mitra, beserta jalan menimpanya.
- Panel owner memperoleh rate card transport dan satu layar kecil untuk tarif khusus >20 km.
- Proyek ini memperoleh **panggilan HTTP keluar pertama di jalur tulis**: Nominatim.

**Yang TIDAK berubah, dan sengaja dijaga tidak berubah:**

- **Money firewall.** Tidak satu kolom nominal pun masuk `sessions`, `booking_requests`, `clients`,
  atau `partners`. Panel `/admin` tetap tidak memuat satu nominal pun; ia melihat JENJANG, bukan
  rupiah. Uji money firewall struktural yang sudah ada menegakkannya tanpa perubahan.
- **Pola tarif append-only.** `transport_rates` mengikuti `variant_rates` persis: insert baris baru,
  tidak pernah update, tanggal berlaku tidak boleh mundur, DELETE dicabut, hanya owner.
- **Tarif dibaca menurut TANGGAL SESI.** Menaikkan tarif transport bulan depan tidak menggeser rekap
  pekan yang honornya sudah dibayarkan.
- **Agregasi rekap tetap fungsi murni di TypeScript**, bukan view SQL — alasannya tertulis di puncak
  `lib/owner/rekap.ts` dan tidak berubah.

**Yang tidak dijamin:**

- **Geocoding OSM untuk alamat Indonesia tidak merata.** Nama jalan besar baik; gang, RT/RW, dan
  patokan sering meleset atau tidak ditemukan. Untuk granularitas 5 km itu sering memaafkan — tetapi
  tidak selalu, dan sistem ini dirancang dengan asumsi ia AKAN meleset.
- **Jarak yang dihitung adalah GARIS LURUS, bukan jarak jalan.** Jarak tempuh nyata biasanya 20–40%
  lebih jauh. Tidak ada pengali yang dipakai untuk mengoreksinya — lihat keputusan T5.
- **Tarif transport untuk pricelist asli belum pernah disebut klien** selain tabel di §1. Honor mitra
  Rp10.000 pada 0–5 km berasal dari materi klien; jenjang lain belum punya angka honor.

## 3. Keputusan yang disepakati

| # | Keputusan | Alasan |
|---|---|---|
| T1 | **Geocoding sekali saat alamat DISIMPAN**, bukan per pemesanan atau per pencocokan mitra | Alamat klien berubah jarang, domisili mitra hampir tidak pernah. Menyimpan koordinatnya sekali membuat jarak dihitung LOKAL saat admin bekerja — nol panggilan eksternal di jalur kritis, nol biaya, dan nol jalur gagal baru pada saat yang paling tidak boleh gagal. |
| T2 | **Nominatim (OpenStreetMap)**, bukan penyedia berbayar | Gratis tanpa kartu kredit maupun kunci API yang harus dirahasiakan. Batasnya — 1 permintaan per detik, wajib User-Agent yang mengidentifikasi aplikasi — jauh di atas kebutuhan PADMA, yang menyimpan alamat beberapa kali sehari. Penyedia berbayar menambah rahasia baru untuk dijaga demi ketepatan yang tetap tidak menyelesaikan masalah jarak-jalan. |
| T3 | **Jarak dihitung lokal dengan haversine, sebagai fungsi murni** | Tanpa I/O, tanpa jam, tanpa basis data — bisa diuji dengan puluhan kasus batas dalam milidetik. Pola yang sama dengan `lib/owner/rekap.ts`, dan di situlah kesalahan aritmetika paling mungkin bersembunyi. |
| T4 | **Otomatis dengan katup pengaman**: jenjang muncul sebagai SARAN, admin boleh menimpa, penimpaan DICATAT beserta alasan | Uang tidak boleh bergantung pada tebakan yang tidak punya jalan keluar. Geocoding yang meleset tanpa katup berarti salah tagih yang senyap. Riwayat penimpaan juga menjawab pertanyaan yang sekarang tidak bisa dijawab siapa pun: seberapa sering geocoding meleset, dan di wilayah mana. |
| T5 | **TIDAK ada pengali jarak-jalan.** Yang ditampilkan ke admin adalah jarak garis lurus apa adanya | Jarak tempuh memang 20–40% lebih jauh, tetapi angka pengalinya tebakan — dan tebakan yang ditanam di kode akan terbaca sebagai fakta oleh pembaca berikutnya. Admin klinik tahu bahwa 4,2 km garis lurus ke seberang sungai berarti 9 km memutar. Informasi diberikan, penilaian diserahkan kepada yang punya konteksnya. |
| T6 | **Kegagalan geocoding TIDAK PERNAH menggagalkan penyimpanan alamat** | Alamat adalah data operasional yang klien dan mitra butuhkan untuk datang ke tempat yang benar. Menolak menyimpannya karena OSM tidak mengenali sebuah gang menukar masalah kecil dengan masalah besar. Koordinat kosong berarti satu hal saja: jenjangnya tidak disarankan. |
| T7 | **Alamat default di klien + alamat per sesi** | Sesuai alur yang klien tulis ("alamat default dari Passport bisa otomatis terisi"), dan menjaga riwayat tetap jujur: klien pindah rumah tidak menulis ulang arti sesi-sesi lamanya. |
| T8 | **Sesi menyimpan JENJANG, bukan rupiah**; rupiah diturunkan dari `transport_rates` menurut tanggal sesi | Menjaga money firewall (nol kolom nominal di tabel operasional) DAN doktrin tarif historis sekaligus. Admin melihat "5–10 km" — data operasional yang memang ia butuhkan untuk memilih mitra terdekat — tanpa pernah melihat angkanya. |
| T9 | **Subsidi TIDAK disimpan**; ia diturunkan sebagai `honor_mitra − tarif_klien` | Materi klien menyebut tiga angka untuk 0–5 km, tetapi yang ketiga adalah selisih dua yang pertama. Menyimpannya berarti tiga angka yang bisa berselisih diam-diam, dan yang ketiga tidak punya cara diketahui salah. Satu sumber kebenaran membuat subsidi mustahil keliru. |
| T10 | **>20 km: sesi ditandai, tagihan TERTAHAN, owner menetapkan nominalnya per kasus** | "Konfirmasi admin" di materi klien bukan tarif, ia ketiadaan tarif. Menyerahkan nominalnya ke admin akan melanggar money firewall; menolak pengajuannya menutup pintu bagi klien yang mau membayar lebih. Owner adalah satu-satunya peran yang boleh menyentuh angka, jadi ia yang memutuskan. |
| T11 | **Batas jenjang: `0–5` termasuk 5,0 km; `>5–10` mulai 5,01** | Materi klien menulisnya persis begitu (`>5–10 km`). Ditetapkan eksplisit dan diuji sebagai kasus batas, bukan diserahkan pada pembulatan. |

## 4. Skema

### 4.1 Enum baru

```sql
create type jenjang_transport as enum ('0_5','5_10','10_15','15_20','di_atas_20');
create type sumber_jenjang as enum ('otomatis','admin');
```

### 4.2 Alamat & koordinat

```sql
alter table public.clients
  add column alamat      text not null default '',
  add column alamat_lat  double precision null,
  add column alamat_lon  double precision null;

alter table public.partners
  add column alamat text not null default '',
  add column lat    double precision null,
  add column lon    double precision null;

alter table public.booking_requests
  add column alamat     text not null default '',
  add column alamat_lat double precision null,
  add column alamat_lon double precision null;

alter table public.sessions
  add column alamat        text not null default '',
  add column alamat_lat    double precision null,
  add column alamat_lon    double precision null,
  add column jenjang       jenjang_transport null,
  add column jenjang_sumber sumber_jenjang null,
  add column jenjang_alasan text not null default '';
```

Koordinat **nullable** dengan sengaja (T6). `jenjang` juga nullable: ia baru terisi saat mitra
ditentukan, dan sesi yang belum bermitra memang belum punya jenjang.

`jenjang_alasan` wajib terisi ketika `jenjang_sumber = 'admin'` — penimpaan tanpa alasan adalah
penimpaan yang tidak bisa dipelajari. Ditegakkan CHECK:

```sql
alter table public.sessions add constraint sessions_alasan_penimpaan
  check (jenjang_sumber is distinct from 'admin' or length(btrim(jenjang_alasan)) > 0);
```

### 4.3 `transport_rates` (tabel uang, owner-only)

```sql
create table public.transport_rates (
  id            uuid primary key default gen_random_uuid(),
  jenjang       jenjang_transport not null,
  tarif_klien   int not null,
  honor_mitra   int not null,
  berlaku_sejak date not null default current_date,
  constraint transport_rates_unik_per_tanggal unique (jenjang, berlaku_sejak),
  constraint transport_rates_nilai_wajar check (tarif_klien >= 0 and honor_mitra >= 0)
);
```

CHECK-nya sengaja **tidak** menuntut `honor_mitra <= tarif_klien` — berbeda dari `variant_rates`.
Justru sebaliknya yang normal di sini: pada 0–5 km klien membayar Rp0 sementara mitra menerima
Rp10.000. Selisih itu subsidi PADMA (T9), bukan kekeliruan.

Pagar lain dipindah apa adanya dari `variant_rates`: trigger penolak tarif retroaktif, trigger
penolak SETIAP `UPDATE` dari peran API, `revoke delete`, nol hak `anon`, RLS hanya owner.

`di_atas_20` **tidak pernah** punya baris di sini — tarifnya per kasus (T10).

### 4.4 `transport_khusus` (tabel uang, owner-only)

```sql
create table public.transport_khusus (
  session_id  uuid primary key references public.sessions(id) on delete cascade,
  tarif_klien int not null check (tarif_klien >= 0),
  honor_mitra int not null check (honor_mitra >= 0),
  ditetapkan_oleh uuid references auth.users(id),
  ditetapkan_pada timestamptz not null default now()
);
```

`ditetapkan_oleh` dan `ditetapkan_pada` **direbut dari payload** oleh trigger, mengikuti pola
`jaga_tanda_honor` — identitas penetap nominal adalah bukti, dan bukti yang bisa dikarang bukan bukti.

### 4.5 `geocode_cache`

```sql
create table public.geocode_cache (
  alamat_normal text primary key,
  lat           double precision null,
  lon           double precision null,
  sumber        text not null default 'nominatim',
  dicoba_pada   timestamptz not null default now()
);
```

Baris ber-`lat`/`lon` NULL adalah **kegagalan yang tercatat**, dan itu disengaja: tanpa mencatat
kegagalan, alamat yang tidak dikenali OSM akan ditanyakan ulang setiap kali form dibuka — pelanggaran
batas laju Nominatim yang lahir dari niat baik.

Bukan tabel uang; tetapi bukan katalog publik juga — `anon` tidak punya urusan dengannya.

## 5. Alur

### 5.1 Geocoding

Berjalan di **server action** yang menyimpan alamat — profil klien, pengajuan jadwal, penyuntingan
mitra. **Tidak pernah dari browser**: dari sana ia tak terkendali dan mengungkap pemakaian kita ke
pihak ketiga tanpa perlu.

Urutannya: normalkan alamat → cari di `geocode_cache` → bila tidak ada, tanya Nominatim (User-Agent
mengidentifikasi PADMA, maksimal 1 permintaan per detik) → simpan hasilnya, termasuk kegagalan.

Kegagalan apa pun — jaringan, batas laju, alamat tak dikenal — berakhir sama: alamat tersimpan,
koordinat kosong, tidak ada galat yang sampai ke pengguna (T6).

### 5.2 Admin memilih mitra

Layar menampilkan tiga hal berdampingan: jarak garis lurus yang dihitung, jenjang yang disarankan,
dan pemilih jenjang yang bisa diubah. Bila salah satu koordinat kosong, saran tidak muncul dan admin
memilih sendiri — tanpa pesan galat, karena itu bukan kesalahan.

Menyimpan pilihan yang berbeda dari saran mengisi `jenjang_sumber = 'admin'` dan menuntut alasan.

### 5.3 Tagihan & rekap

Tagihan sesi = harga varian + tarif transport menurut `transport_rates` pada **tanggal sesi**. Untuk
`di_atas_20`, tagihan **tertahan** sampai owner mengisi `transport_khusus`, dan sesi tertahan itu
muncul di antrean admin — antrean yang tidak menampilkannya berarti pekerjaan yang hilang.

Rekap Sabtu menambahkan `transport_rates.honor_mitra` (atau `transport_khusus.honor_mitra`) menurut
tanggal sesi. Subsidi PADMA muncul sebagai selisih yang dihitung, bukan kolom (T9).

### 5.4 Owner › Tarif transport

Rate card kedua, bentuknya sama dengan rate card varian: daftar per jenjang, tetapkan tarif baru
sebagai BARIS BARU bertanggal berlaku, tanpa tombol hapus. Ditambah satu daftar kecil sesi
`di_atas_20` yang menunggu nominal.

## 6. Pengujian

**Fungsi murni — tanpa basis data, tanpa jaringan:**

| # | Uji |
|---|---|
| M1 | Haversine: jarak yang diketahui, titik identik, jarak sangat kecil, lintas belahan |
| M2 | Pemetaan jarak → jenjang, dengan kasus batas EKSPLISIT: 5,0 km → `0_5`; 5,01 km → `5_10`; 20,0 km → `15_20`; 20,01 km → `di_atas_20` (T11) |
| M3 | Normalisasi alamat: dua ketikan yang secara wajar sama menghasilkan kunci cache yang sama |

**Pagar — wajib diuji langsung ke basis data:**

| # | Uji |
|---|---|
| P1 | `transport_rates` append-only: tarif mundur ditolak, UPDATE ditolak, DELETE dicabut — dari peran API, owner sekalipun |
| P2 | `transport_rates` & `transport_khusus`: nol hak `anon` (tabel maupun kolom), RLS hanya owner |
| P3 | `transport_khusus.ditetapkan_oleh`/`ditetapkan_pada` direbut dari payload |
| P4 | CHECK menolak `jenjang_sumber = 'admin'` tanpa alasan |
| P5 | Nol kolom nominal di `sessions`, `booking_requests`, `clients`, `partners` — ditegakkan uji money firewall struktural yang sudah ada |
| P6 | `geocode_cache` tertutup bagi `anon` |

**Perilaku:**

| # | Uji |
|---|---|
| B1 | Geocoding gagal → alamat TETAP tersimpan, koordinat kosong, jenjang tidak disarankan, admin tetap bisa menetapkan |
| B2 | Alamat yang sama tidak ditanyakan dua kali; alamat yang GAGAL juga tercatat dan tidak diulang |
| B3 | Menaikkan tarif transport tidak menggeser rekap pekan lalu |
| B4 | `di_atas_20` menahan tagihan sampai owner mengisi, DAN sesinya muncul di antrean admin |
| B5 | Rekap Sabtu memuat honor transport; subsidi 0–5 km terhitung sebagai selisih |
| B6 | Panel `/admin` menampilkan jenjang, nol rupiah transport |
| B7 | Panggilan Nominatim tidak pernah dari browser, mengirim User-Agent, dibatasi 1/detik |

## 7. Kewajiban non-teknis

Data OpenStreetMap menuntut **atribusi**. Layar mana pun yang menampilkan hasil geocoding harus
memuat "© OpenStreetMap contributors".

## 8. Di luar ruang lingkup

- **Paket bundling multi-layanan** — spec berikutnya; prasyaratnya lengkap sesudah dokumen ini.
- **Rangkaian status baru**, payment gateway, kredit layanan 30 hari, jatah reschedule.
- **Circle sebagai sesi rombongan** — hari ini Circle baru berarti harga.
- **Jarak jalan sungguhan lewat routing API.** Yang dibangun garis lurus + penilaian admin (T5).
- **Pengisian tarif transport produksi.** Honor mitra untuk jenjang selain 0–5 km belum pernah
  disebut klien.
