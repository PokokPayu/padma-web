# Ladder geocoding — ditunda sampai pemilih lokasi mendarat

**Tanggal:** 7 September 2026
**Status:** ~~ditunda~~ **SUDAH DIKERJAKAN 7 September 2026** — commit `93d4899`.

> Berkas ini disimpan sebagai riwayat keputusan, bukan sebagai pekerjaan yang menunggu. Kedua
> prasyaratnya terpenuhi: pemilih lokasi mendarat di `main` (`98f5298`), lalu ladder menyusul.
> Teks amandemen §1.2 di bawah kini SUDAH berlaku dan sudah masuk ke spec pemilih-lokasi —
> jangan memasukkannya untuk kedua kalinya.
>
> Satu hal yang diverifikasi sesudah berkas ini ditulis: angka 19% -> 72% di bawah diukur dengan
> skrip `sed`, bukan dengan kode. Sesudah ladder dibangun, pengukurannya diulang memakai
> `variasiAlamat()` yang dipakai produksi dan hasilnya SAMA PERSIS — 6/32 lalu 23/32, nol
> penolakan wilayah, 70 tembakan untuk 32 alamat. Klaim di dokumen ini karena itu menggambarkan
> kode yang berjalan, bukan alat ukur yang sudah dibuang.
**Terkait:** `specs/2026-09-07-padma-pemilih-lokasi-design.md` §1.1, `2026-09-07-transport-tindak-lanjut.md` utang #2

## Kenapa berkas ini ada

Geocoding bertingkat sempat diputuskan dikerjakan **sebelum** rencana pemilih-lokasi, lalu
ditunda. Pengukurannya sudah terlanjur dilakukan dan argumennya sudah matang; membuangnya ke dalam
riwayat percakapan berarti orang berikutnya mengulang pekerjaan yang sama. Berkas ini menyimpannya
utuh, termasuk teks amandemen yang sudah disetujui tetapi belum berlaku.

## Keputusan

Ladder **tidak dibangun sekarang**. Ia dikerjakan sesudah pemilih lokasi (pin) mendarat, sebagai
satu pekerjaan bersama penutupan utang #2.

### Alasan 1 — hari ini `null` gagal-tertutup, ladder mengubahnya jadi default senyap

Koordinat kosong punya arti tunggal yang sudah tertulis di migration `alamat_dan_koordinat`:
jenjangnya tidak disarankan, admin memilih sendiri. Ladder mengubah banyak `null` menjadi saran
ber-`jenjang_sumber='otomatis'` yang tampak pasti.

Selama admin belum melihat pin di atas peta, tebakan setingkat jalan tidak terlihat sebagai
tebakan. Sesudah pin ada, ia terlihat DAN bisa dikoreksi pada saat jenjang dihitung — momen yang
menurut Ruling 11 memang saat perhitungannya terjadi. Urutan "pin dulu, ladder kemudian" karena
itu bukan sekadar rapi: ia yang membuat tebakan ladder selalu lewat di depan mata manusia.

### Alasan 2 — alasan mendahulukan ladder sudah kedaluwarsa

Ladder didahulukan supaya berkas uji rencana pemilih-lokasi ditulis dengan
`toHaveBeenCalledTimes(n)` yang benar sejak awal, alih-alih dilonggarkan belakangan. Task 3
rencana itu (`3309038`) sudah mendarat beserta `tests/geocode-route.test.ts`, sehingga
keuntungannya sebagian besar hilang — sementara ongkos menahan Task 2 dan Task 5 terus berjalan.

### Alasan 3 — menunda tidak menunda manfaat

Tanpa penutupan utang #2, ladder tidak menolong satu pun alamat yang sudah terlanjur gagal:
`geocode_cache` menyimpan kegagalan secara permanen tanpa TTL, dan cache menjawab sebelum
Nominatim disentuh. Keduanya satu pekerjaan, sebesar itu juga kapan pun dikerjakan.

## Rancangan yang disepakati (untuk dipakai nanti apa adanya)

- `geocodeAlamat()` mencoba tiga tingkat: alamat penuh → tanpa nomor rumah → jalan + kota.
- Hasil setingkat wilayah (`village`, `suburb`, `city`, dan sejenisnya) **ditolak** → `null`.
- Tidak ada enum baru, tidak ada kolom presisi, tidak ada perambatan ke tabel mana pun. Seluruh
  aturan hidup di dalam satu fungsi.
- Utang #2 ditutup bersamaan: baris `geocode_cache` yang mencatat kegagalan harus bisa dibatalkan,
  kalau tidak ladder tidak berlaku bagi alamat yang sudah pernah gagal.
- Batas 1 permintaan/detik berlaku PER TINGKAT, sehingga alamat yang gagal di semua tingkat adalah
  yang paling lambat.

### Angka tembakan Nominatim yang diminta rencana pemilih-lokasi

Untuk berkas uji yang menghitung panggilan:

| Skenario | Tembakan |
|---|---|
| (a) ketemu di percobaan pertama | 1 |
| (b) baru ketemu sesudah dikupas | 2 atau 3, tergantung tingkat keberapa |
| (c) gagal di seluruh tingkat | 3 |

**Diperiksa sesudah rencana pemilih-lokasi selesai (commit `96ea4cf`): tidak ada satu pun
assertion di sana yang perlu disesuaikan.** Seluruh stub di `tests/geocode-route.test.ts`,
`transport-pin-menang`, dan `transport-warisan-koordinat` menjawab ketemu pada panggilan pertama —
skenario (a), yang bernilai 1 di bawah ladder mana pun. Dua assertion sisanya
`not.toHaveBeenCalled()`, yang justru MENGUAT bila ladder ada. Skenario (b) dan (c) tidak pernah
tersentuh uji-uji itu.

Artinya kekhawatiran "ladder akan memerahkan berkas uji rencana pemilih-lokasi" — yang menjadi
alasan awal mendahulukan ladder — ternyata tidak berdasar sejak awal. Dicatat di sini supaya orang
berikutnya tidak mengulang penjadwalan yang sama demi menghindari masalah yang tidak ada.

## Pengukuran (7 September 2026)

Alat: `web/scripts/probe-geocode.ts` — tidak menyentuh `geocode_cache`, aman diulang.
Metode: 32 alamat berbentuk Malang dikupas ke bentuk "jalan + kota", ditanya ulang `limit=5`.

| Hasil | Jumlah |
|---|---|
| Ketemu | 23 dari 32 (dari 6 — 19% → 72%) |
| Ditolak karena setingkat wilayah | 0 |
| Tetap gagal | 9 |
| Ambigu (kandidat kedua sejenis, berjarak >2 km) | 0 dari 23 |

**Presisi rumah tidak pernah tercapai:** 0 dari 30 alamat berbentuk hunian. Dua keberhasilan
berkelas `building`/`amenity` pada pengukuran awal adalah landmark kontrol positif (Universitas
Brawijaya, RSSA), bukan alamat rumah. Kelas presisi yang sudah dikirim hari ini karena itu memang
"jalan, paling bagus" — ladder berbatas jalan memberi kelas yang SAMA untuk lebih banyak alamat.

**Risiko yang sesungguhnya tersisa:** dari 23 jawaban, **7 mendarat dalam 1 km dari batas jenjang**
5/10/15/20 km; terdekat 0,05 km. Ambiguitas bisa diukur dan ternyata nol; paparan batas jenjang
tidak bisa dihilangkan desain apa pun — hanya bisa diterima sadar. Itulah keberatan terkuat
terhadap ladder, bukan ambiguitas.

**Dua peringatan yang mengikat angka di atas:**

- Daftar alamatnya **dikarang** dari pengetahuan umum Malang, bukan alamat klien PADMA. Persentase
  absolutnya lunak; yang keras adalah mekanismenya (tangga pengupasan), karena ia memakai
  jalan-jalan yang jelas nyata.
- Angka 7-dari-23 memakai titik acuan Alun-Alun Malang yang dipilih sembarang. Paparan terhadap
  batas jenjang tergantung domisili mitra sungguhan. Ia **ilustrasi paparan, bukan konstanta**.

## Teks amandemen §1.1 — disetujui, BELUM berlaku

Teks di bawah sudah ditinjau dan disetujui pemilik spec pemilih-lokasi tanpa bantahan. Ia
**belum** dimasukkan ke spec karena menggambarkan perilaku yang belum dibangun. Masukkan sebagai
§1.2 pada saat ladder benar-benar dikerjakan.

> **§1.2 Amandemen — ladder dihidupkan kembali, dibatasi setingkat jalan**
>
> §1.1 membuang geocoding bertingkat. Bagian ini menghidupkannya kembali dalam bentuk yang lebih
> sempit, dan mencatat kenapa alasan pembuangannya tidak lagi berlaku utuh.
>
> Alasan §1.1 berbunyi: pin menghapus ketidakpastian dengan pekerjaan lebih sedikit, jadi menandai
> tebakan tidak sepadan. Itu benar untuk jalur staf — di sana ada admin yang melihat peta pada saat
> alamat diisi. Jalur klien tidak punya admin pada momen itu, dan justru keputusan §1 "layar klien:
> nol perubahan" yang membuatnya begitu. Keputusan itu dipertahankan: klien tetap mengetik teks,
> tanpa peta, tanpa pin.
>
> Keberatan yang paling konkret dan paling mudah diuji terhadap ladder bukan presisi melainkan
> **ambiguitas** — mengupas token membuang justru informasi yang membedakan, dan Malang punya
> banyak jalan bernama dasar sama di kecamatan berbeda ("Jalan Ijen" vs "Jl. Besar Ijen"
> memulangkan dua jalan berbeda; "Stasiun Malang" memulangkan "Jalan Stasiun Blimbing" yang meleset
> 3 km). Keberatan itu diukur, dan pada bentuk "jalan + kota" hasilnya nol dari 23. Ia dicabut
> karena datanya tidak mendukungnya — dicatat di sini, bukan dihapus, supaya pembaca berikutnya
> tahu apa yang sudah dicoba dan kenapa runtuh.
>
> Aturan tolak-wilayah tidak pernah menyala sekali pun (0 dari 32). Ia tetap dipasang: ongkosnya
> nol dan ia menahan kelas kegagalan paling berbahaya — titik tengah kelurahan yang tampak seperti
> alamat. Tetapi bukan ia yang menaikkan angka keberhasilan.

## Yang harus dilakukan saat pekerjaan ini diambil

1. Baca berkas ini, lalu `specs/2026-09-07-padma-pemilih-lokasi-design.md` §1 dan §1.1.
2. Pastikan pemilih lokasi (pin) sudah mendarat di `main`. Kalau belum, alasan penundaan masih
   berlaku dan pekerjaan ini belum boleh diambil.
3. Kerjakan ladder + utang #2 sebagai SATU pekerjaan.
4. Masukkan teks §1.2 di atas ke spec pemilih-lokasi pada commit yang sama.
5. Berkas uji rencana pemilih-lokasi TIDAK perlu disesuaikan — sudah diperiksa terhadap commit
   `96ea4cf`; lihat catatan di bawah tabel tembakan. Tetap jalankan suite penuh, tentu saja.
