# PADMA — Tab Permintaan, Modal Detail, dan Koordinat yang Bisa Ditambal

**Tanggal:** 9 September 2026
**Pendahulu:** `docs/superpowers/specs/2026-09-08-padma-c2-pembayaran-design.md` (C2, ter-merge) dan
C3-a (`94d761d`). Rantai statusnya sudah lengkap; dokumen ini tidak menyentuh satu pun nilai enum.

**Sumber keputusan:** sesi brainstorming 9 September 2026, berangkat dari satu laporan bug —
dropdown bidan di antrean menampilkan "domisili belum diisi" untuk mitra yang domisilinya sudah
diisi.

---

## Masalah

### 1. Satu kalimat untuk dua sebab yang berbeda

`formatKm(km: number | null)` (`src/lib/jadwal/urutan-mitra.ts`) memulangkan `"domisili belum
diisi"` setiap kali jaraknya `null`. Tetapi `km` menjadi `null` karena **dua** sebab yang
berlainan (`urutkanMitraMenurutJarak`):

- `partners.lat/lon` kosong — domisili mitra memang belum diisi; atau
- koordinat tujuan kosong — yaitu `booking_requests.alamat_lat/alamat_lon` permintaan itu sendiri.

Sebab kedua **menuduh pihak yang salah**. Admin dikirim membetulkan data mitra yang sudah benar,
dan seluruh daftar bidan ikut berlabel sama sekaligus — karena tujuannya satu untuk semua.

### 2. Sebab kedua itu yang paling sering terjadi

Formulir pengajuan klien (`src/app/passport/ajukan/form.tsx`) **tidak punya pemilih peta**.
`booking_requests.alamat_lat` hanya terisi lewat dua jalan (`src/lib/passport/aksi.ts`):

- **warisan** dari `clients.alamat_lat`, dan itu menuntut teks alamat **identik persis**; atau
- **geocoding Nominatim**, yang untuk alamat Malang sebagian besar gagal — 26 dari 32 pada probe
  yang direkam di spec pemilih-lokasi.

Cukup klien menambah satu kata pada alamat kunjungan, warisan batal, Nominatim ditanya, gagal, dan
permintaannya lahir tanpa koordinat.

### 3. Akibatnya bukan hanya kalimat yang membingungkan

`konfirmasi_permintaan` menghitung jenjang transport dari `booking_requests.alamat_lat` ×
`partners.lat` (`supabase/migrations/20260912101000_status_bayar_pagar.sql`). Koordinat permintaan
yang kosong melahirkan **sesi tanpa jenjang transport** — `jenjang` NULL, `jenjang_sumber` NULL —
yang lalu menumpuk di StatTile "menunggu jenjang" dan harus ditetapkan tangan satu per satu. Dan
tidak ada satu pun layar tempat admin bisa memperbaiki koordinatnya **sebelum** konfirmasi.

### 4. Antrean dan daftar sesi berebut satu halaman

Antrean permintaan dirender sebagai blok bergaris emas di atas daftar sesi
(`src/app/admin/sesi/page.tsx`). Ia tidak bisa dicari, tidak bisa disaring, tidak dipaginasi, dan
setiap blok memuat seluruh detail sekaligus seluruh tombol. Halaman itu sendiri sudah melewati 400
baris dan memikul dua daftar dengan lapisan data yang berbeda.

### 5. Permintaan yang batal tidak punya riwayat di mana pun

Rantai terbelah di `dikonfirmasi`: yang dikonfirmasi menjadi **sesi** dan terlihat di daftar sesi.
Tiga status akhir lainnya — `dibatalkan_klien`, `dibatalkan_tenggat`, `ditolak` — tidak pernah
melahirkan sesi, dan antrean hanya menampilkan `STATUS_ANTRE`. Permintaan yang batal karena tenggat
bayar lewat **hilang dari seluruh panel**, dan tidak ada layar yang bisa menjawab "kenapa pengajuan
saya lenyap?".

---

## Keputusan

### K1 — Dua tab pada satu rute, bukan tujuan nav baru

`/admin/sesi` tetap satu rute, dengan bilah dua tab: **Permintaan** dan **Sesi**.

Alasan menolak tujuan nav tersendiri (`/admin/permintaan`): badge sidebar `permintaanMenunggu`
sudah menempel pada tujuan "Sesi", dan memisahkan rutenya berarti memecah satu pekerjaan berurutan
— permintaan yang dikonfirmasi *menjadi* sesi — ke dua tempat yang tidak saling melihat.

### K2 — Bawaannya tab `permintaan`

`/admin/sesi` telanjang membuka tab Permintaan. Itu tab yang memuat pekerjaan yang menunggu
keputusan; daftar sesi adalah rujukan, bukan antrean.

Konsekuensinya **wajib** ikut dikerjakan, kalau tidak ada tautan yang mendarat di tab yang salah:

| Tautan | Menjadi |
|---|---|
| `src/app/admin/page.tsx` StatTile "menunggu jenjang" | `/admin/sesi?tab=sesi&status=selesai&jenjang=kosong` |
| `src/app/admin/page.tsx` "+ Sesi baru" | `/admin/sesi?tab=sesi` |
| `src/app/admin/page.tsx` "Buka Sesi" | `/admin/sesi?tab=sesi` |
| `src/app/admin/page.tsx` "Jadwalkan sesi" | `/admin/sesi?tab=sesi` |
| StatTile "Permintaan jadwal" & badge sidebar | tetap `/admin/sesi` — sudah benar |

Ditambah satu aturan turunan: **bila `ubah` ada di URL, tab jatuh ke `sesi`** apa pun bawaannya.
Panel itu milik daftar sesi, dan tautan `?ubah=<id>` yang tersimpan di riwayat browser seseorang
harus tetap membuka panelnya — bukan mendarat di tab permintaan dengan panel yang tidak punya
daftar induk.

### K3 — Parameter URL

| Parameter | Arti |
|---|---|
| `tab` | `permintaan` (bawaan) atau `sesi` |
| `cari`, `status`, `hal` | dipakai bersama, **ditafsir menurut tab aktif** — daftar putihnya beda (`SARING_PERMINTAAN` vs `SARING_SESI`) |
| `ubah` | panel ubah/buat **sesi** — tidak berubah |
| `lihat` | panel detail **permintaan** — baru |

**Pindah tab membuang saringan lama.** Tautan tab ditulis sebagai href bersih (`?tab=sesi`), tidak
mewarisi `cari`/`status`/`hal`: saringan tab sebelah tidak punya arti di sini, dan halaman 3 daftar
sesi bukan halaman 3 daftar permintaan.

**`tab` dan `lihat` wajib masuk `BUKAN_SARINGAN`** di `src/app/_shell/panel/daftar.ts`. Tanpa itu
`bangunQuery` memperlakukan keduanya sebagai saringan dan **mengembalikan halaman ke 1** — membuka
detail dari halaman 3 melempar admin ke halaman 1, dan baris yang barusan diklik lenyap begitu
panelnya ditutup. Ini persis alasan `ubah` sudah dikecualikan di sana.

### K4 — Lapisan data tersendiri: `src/lib/admin/permintaan.ts`

Modul baru meniru bentuk `ambilDaftarMitra`: `ambilDaftarPermintaan(param) → { baris, total }`,
dengan `count: "exact"` pada query yang sama — bukan menarik seluruh baris lalu mengukur
panjangnya. Query permintaan yang sekarang menempel di dalam `src/app/admin/sesi/page.tsx` pindah
ke sana.

Bacaan memakai **sesi pengguna** (`createServerSupabase`), bukan service role: di bawah service
role `user_role()` memulangkan `'klien'` dan tidak satu pun pagar ikut diperiksa.

Saringan `status`:

| Nilai | Himpunan |
|---|---|
| `menunggu` **(bawaan)** | `STATUS_ANTRE` |
| `riwayat` | **diturunkan**: `STATUS_PERMINTAAN` minus `STATUS_ANTRE` |
| `dikonfirmasi` / `dibatalkan_klien` / `dibatalkan_tenggat` / `ditolak` | satu status persis |

`riwayat` **dihitung dengan pengurangan, bukan ditulis sebagai daftar tangan.** Repo ini sudah
pernah membayar akibatnya: nilai enum baru membuat konstanta himpunan yang ditulis tangan salah
diam-diam, tanpa satu galat pun. Himpunan yang diturunkan dari `STATUS_PERMINTAAN` ikut benar
sendiri saat status kesembilan lahir.

Ini menutup Masalah 5: riwayat batal/tolak terjangkau, tanpa membuat tab ketiga yang 90% kodenya
sama dengan tab pertama.

### K5 — Daftar memakai primitif yang sudah ada

`Tabel`/`Th`/`Td`, `BilahDaftar`, `Paginasi` — nol primitif daftar baru. Kolom: Klien · Layanan ·
Tanggal & jam · Status (pil) · keadaan bayar. **Seluruh baris** adalah tautan ke
`?tab=permintaan&lihat=<id>`; tidak ada tombol aksi di baris.

Aksi sengaja tidak ada di daftar: setiap keputusan pada permintaan — menetapkan bidan, menerbitkan
tagihan, mengonfirmasi — bergantung pada hal yang tidak muat di satu baris (catatan klien, alamat,
jarak bidan). Tombol yang bisa ditekan tanpa melihat itu adalah tombol yang mengundang keputusan
buta.

### K6 — Detail memakai `PanelGeser`, bukan modal baru

`src/app/_shell/panel/panel-geser.tsx` sudah `role="dialog" aria-modal="true"`, buka-tutupnya
ditentukan URL, Escape dan klik overlay sudah jalan, dan **isinya dirender di server**. Yang
terakhir bukan detail gaya: suite proyek ini berjalan **tanpa jsdom**, jadi isi panel yang hanya
lahir setelah hidrasi tidak bisa diuji sama sekali.

`hrefTutup` = URL sekarang tanpa `lihat`, sehingga menutup panel mengembalikan admin ke halaman dan
saringan yang sama.

Isi panel, dari atas:

1. **Ringkasan** — klien + PADMA ID, layanan & varian, tanggal, jam, alternatif waktu, catatan
   klien apa adanya.
2. **Alamat kunjungan** — dua cabang, lihat K7.
3. **Keadaan bayar** + tautan WA tagihan (sudah dirakit di server; tidak berubah).
4. **Aksi menurut status**, pindah utuh dari `BlokPermintaan`: `Cari bidan` → pemilih bidan +
   `Tetapkan bidan` → `Terbitkan tagihan` → `Konfirmasi` (hanya bila lunas) + `Ganti bidan`.

`BlokPermintaan` dibongkar: bagian penyaji menjadi server-rendered di dalam panel; yang benar-benar
butuh klien (tombol, `useTransition`, pemilih bidan) tinggal sebagai satu komponen klien kecil.

Tombol "Tolak" tetap **tidak ada** (spec C1 J8) — pembongkaran ini tidak membuka kembali jalan
menuju `tolakPermintaan`.

### K7 — Pin alamat permintaan bisa ditambal dari panel

Cabang **berkoordinat**: alamat, `Pin: −7,958938, 112,655447`, peta kecil.

Cabang **tanpa koordinat**: kalimat yang menyebut **akibatnya**, bukan hanya keadaannya — "Alamat
ini belum berkoordinat. Jarak ke bidan tidak bisa dihitung, dan sesi yang lahir darinya tidak akan
punya jenjang transport." Di bawahnya `src/app/_shell/pemilih-lokasi.tsx` — komponen yang sama
persis dengan yang dipakai form mitra dan form klien — dan tombol Simpan pin.

Server action baru `tetapkanKoordinatPermintaan(permintaanId, formData)`, dengan empat pagar yang
sudah menjadi pola di repo ini:

1. `requireRole(["admin", "owner"])`.
2. Koordinat divalidasi lewat `koordinatDariFormData` yang sudah ada — bukan parser kedua.
3. **Hanya untuk permintaan yang masih di `STATUS_ANTRE`.** Sesudah dikonfirmasi, sesinya sudah
   lahir membawa salinan koordinat dan jenjangnya sudah tersimpan; mengubah koordinat permintaan di
   titik itu tidak memperbaiki apa pun, hanya membuat dua baris bercerita beda.
4. UPDATE diperiksa **jumlah barisnya**, bukan hanya `error`. PostgREST menjawab update yang
   tertahan RLS dengan `200 + []`, dan melaporkannya sebagai keberhasilan adalah kebohongan senyap
   (pola yang sama sudah tertulis di `src/app/admin/mitra/aksi.ts`).

**Status tidak ikut berubah** saat pin disimpan: menaruh koordinat bukan langkah dalam rantai, dan
`guard_booking_status` tidak tersentuh karena `status` tidak masuk payload. RLS mengizinkannya lewat
policy `booking: staf` (`for all`) yang sudah ada — tidak ada migrasi dalam pekerjaan ini.

### K8 — `formatKm` diganti bentuknya supaya tidak bisa menuduh

Fungsi penggantinya menerima **kedua sisi**, bukan satu `number | null`:

| Keadaan | Teks |
|---|---|
| keduanya ada | `4,2 km` |
| `partners.lat/lon` kosong | `domisili bidan belum diisi` |
| koordinat permintaan kosong | `alamat permintaan belum berkoordinat` |

Karena `null` tidak lagi cukup sebagai masukan, tidak ada jalan bagi pemanggil baru untuk kehilangan
informasi sebabnya. Itu dijaga tipe, bukan disiplin.

Kasus ketiga praktis tidak akan terlihat lagi di dalam panel: bila alamatnya tanpa koordinat, admin
melihat pemilih pin di bagian yang sama — kalimatnya berdampingan dengan alatnya.

Mitra tanpa domisili **tetap ada di daftar**, di urutan paling belakang. Membuangnya berarti bidan
yang domisilinya belum diisi tidak bisa ditugaskan sama sekali, dan admin tidak akan pernah tahu
kenapa namanya hilang.

---

## Bukan bagian dari pekerjaan ini

- **Pemilih peta di formulir pengajuan klien** (`/passport/ajukan`). Menaruh koordinat dari
  sumbernya lebih baik daripada menambalnya di hilir, tetapi itu mengubah alur yang dilihat klien
  dan menuntut keputusan tersendiri. Pin admin di K7 adalah jaring pengaman, bukan penggantinya.
- **Tujuan nav `/admin/permintaan`** — ditolak di K1.
- **Migrasi basis data.** Tidak ada. Policy dan trigger yang ada sudah menampung K7.
- **Memberi tahu klien** saat koordinat pengajuannya ditambal admin. Alamat teksnya tidak berubah;
  yang berubah hanya titik di peta.

---

## Risiko

| Risiko | Penangkalnya |
|---|---|
| `tab`/`lihat` lupa dimasukkan `BUKAN_SARINGAN` → paginasi lompat ke 1 saat panel dibuka | Uji di `panel-daftar.test.ts` (K3) |
| Bawaan tab berubah → tautan beranda mendarat di tab salah | Tabel K2 dikerjakan sebagai satu tugas, dengan uji href |
| `riwayat` ditulis sebagai daftar tangan lalu rot saat enum tumbuh | Diturunkan dengan pengurangan (K4), dan diuji sebagai komplemen |
| Isi panel ditulis sebagai komponen klien → tidak bisa diuji tanpa jsdom | K6: penyaji di server, klien hanya untuk tombol |
| `tetapkanKoordinatPermintaan` lolos RLS di uji karena memakai service role | Uji wajib memakai sesi klien; sesi ber-service-role buta terhadap kegagalan RLS |

---

## Rencana uji

Semua tanpa jsdom, mengikuti pola suite yang ada.

**Murni**
- `urutan-mitra.test.ts`: tiga keluaran label (K8); mitra tanpa domisili tetap ada, di urutan
  belakang.
- `panel-daftar.test.ts`: `tab` dan `lihat` tidak mengembalikan halaman ke 1; pindah tab membuang
  saringan.

**Lapisan data**
- `ambilDaftarPermintaan`: bawaan memulangkan tepat `STATUS_ANTRE`; `riwayat` memulangkan tepat
  komplemennya; `total` benar saat hasilnya dipaginasi; kata cari diperlakukan sebagai huruf, bukan
  wildcard SQL.

**Server action**
- `tetapkanKoordinatPermintaan`: menyimpan pin yang sah; menolak koordinat di luar rentang; menolak
  permintaan yang sudah `dikonfirmasi`; **ditolak untuk sesi klien**.
- Uji rantai: sesudah pin dipasang, `konfirmasi_permintaan` melahirkan sesi **dengan** `jenjang` dan
  `jenjang_sumber = 'otomatis'`, bukan NULL. Inilah uji yang membuktikan bug asalnya tertutup.

**Render (`renderToStaticMarkup`)**
- Baris daftar menaut ke `?tab=permintaan&lihat=<id>`.
- Panel memuat peringatan koordinat + pemilih pin saat koordinatnya kosong, dan peta + pin saat ada.
- Tombol yang muncul cocok dengan status; tidak ada tombol "Tolak".
- Pagar `tests/pagar-batas-server-klien.test.ts` tetap hijau sesudah `BlokPermintaan` dibongkar.
