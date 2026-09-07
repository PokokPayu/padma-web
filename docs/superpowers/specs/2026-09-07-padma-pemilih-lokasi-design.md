# PADMA — Pemilih Lokasi di Peta — Design Doc

**Tanggal:** 7 September 2026
**Status:** menunggu review
**Menindaklanjuti:** `docs/superpowers/specs/2026-09-07-padma-transport-design.md`
**Runbook terdampak:** `docs/superpowers/2026-09-07-transport-tindak-lanjut.md` §Runbook 3–4, utang #1 & #2

## 1. Konteks

Rantai transport sudah selesai dan ter-merge. Jenjang jarak — yang menentukan tarif klien dan honor
mitra — dihitung dari koordinat, dan koordinat itu didapat dengan menanyakan alamat ke Nominatim
(OpenStreetMap). Sampai dokumen ini ditulis, alamat yang pernah dicoba hanyalah alamat karangan di
dalam berkas uji.

Pengukuran pertama dengan alamat berbentuk Malang, 7 September 2026, memberi angka berikut:

| Hasil | Jumlah dari 32 |
|---|---|
| Koordinat setingkat benda (`building`, `amenity`) | 2 |
| Koordinat setingkat ruas jalan (`road`) | 4 |
| Titik tengah wilayah (`village`, `suburb`, …) | 0 |
| **Gagal — tidak ada jawaban sama sekali** | **26** |

Pemblokiran sudah disingkirkan sebagai penjelasan: alamat yang gagal dijawab Nominatim dengan
**HTTP 200 berisi array kosong**, bukan penolakan. OSM memang tidak tahu.

Mekanismenya lebih penting daripada angkanya. Nominatim menuntut seluruh kata cocok, dan gagal
**total** — bukan mundur ke jalannya — begitu ada satu kata yang tak dikenal:

```
Jl. Besar Ijen No. 77, Oro-oro Dowo, Klojen, Kota Malang  → kosong
Jl. Besar Ijen No. 77, Klojen, Kota Malang                → kosong
Jl. Besar Ijen No. 77, Kota Malang                        → kosong
Jl. Besar Ijen, Kota Malang                               → ketemu (road)
```

Artinya **semakin lengkap alamat ditulis, semakin besar kemungkinannya gagal** — kebalikan dari
naluri siapa pun yang merancang formulir alamat. Dan keberhasilannya pun tidak bisa ditebak: dari
lima jalan yang diuji berpasangan, tiga mati ketika nomor rumah ditambahkan, dua selamat.

Yang menutup perkara: **saat berhasil pun, nomor rumahnya dibuang.** `Jl. Veteran No. 8` dan
`Jl. Veteran` memulangkan koordinat yang identik. Presisi setingkat rumah tidak tersedia di OSM
Malang, berapa pun rapi alamatnya ditulis.

### 1.1 Rancangan yang ditolak, dan kenapa

Rancangan pertama menjawab ini dengan **membuat ketidakpastiannya terlihat**: pertanyaan bertingkat
ke Nominatim (alamat penuh → tanpa nomor rumah → jalan + kota), nilai enum ketiga `perkiraan` pada
`sumber_jenjang`, dan kolom presisi merambat di empat tabel.

Rancangan itu dibuang. Ia bekerja keras untuk **menandai** tebakan, sementara persoalan sebenarnya
adalah bahwa angka yang menentukan uang tidak boleh berupa tebakan sama sekali. Menjatuhkan pin di
peta menghapus ketidakpastiannya — ada manusia yang melihat titiknya dan membenarkannya — dengan
pekerjaan yang lebih sedikit, bukan lebih banyak.

Konsekuensinya seluruh perangkat itu tidak jadi dibangun: tidak ada ladder, tidak ada nilai enum
baru, tidak ada kolom presisi, tidak ada penghapusan baris `geocode_cache`.

### 1.2 Amandemen — ladder dihidupkan kembali, dibatasi setingkat jalan

§1.1 membuang geocoding bertingkat. Bagian ini menghidupkannya kembali dalam bentuk yang lebih
sempit, dan mencatat kenapa alasan pembuangannya tidak lagi berlaku utuh.

Alasan §1.1 berbunyi: pin menghapus ketidakpastian dengan pekerjaan lebih sedikit, jadi menandai
tebakan tidak sepadan. Itu benar untuk jalur staf — di sana ada admin yang melihat peta pada saat
alamat diisi. Jalur klien tidak punya admin pada momen itu, dan justru keputusan §1 "layar klien:
nol perubahan" yang membuatnya begitu. Keputusan itu dipertahankan: klien tetap mengetik teks,
tanpa peta, tanpa pin.

Keberatan yang paling konkret dan paling mudah diuji terhadap ladder bukan presisi melainkan
**ambiguitas** — mengupas token membuang justru informasi yang membedakan, dan Malang punya
banyak jalan bernama dasar sama di kecamatan berbeda ("Jalan Ijen" vs "Jl. Besar Ijen"
memulangkan dua jalan berbeda; "Stasiun Malang" memulangkan "Jalan Stasiun Blimbing" yang meleset
3 km). Keberatan itu diukur, dan pada bentuk "jalan + kota" hasilnya nol dari 23. Ia dicabut
karena datanya tidak mendukungnya — dicatat di sini, bukan dihapus, supaya pembaca berikutnya
tahu apa yang sudah dicoba dan kenapa runtuh.

Aturan tolak-wilayah tidak pernah menyala sekali pun (0 dari 32). Ia tetap dipasang: ongkosnya
nol dan ia menahan kelas kegagalan paling berbahaya — titik tengah kelurahan yang tampak seperti
alamat. Tetapi bukan ia yang menaikkan angka keberhasilan.

Yang dibangun, 7 September 2026: `variasiAlamat()` di `lib/transport/alamat.ts` (fungsi murni,
tiga tingkat, varian kembar dibuang supaya alamat sederhana tetap berbiaya satu permintaan), dan
penolakan `addresstype` setingkat wilayah di `geocodeAlamat()`. Tidak ada enum baru, tidak ada
kolom presisi, tidak ada perambatan ke tabel mana pun — seluruh aturan hidup di dalam dua fungsi
itu. Migrasi `20260907170000` membatalkan baris kegagalan lama, karena tanpa itu ladder tidak
pernah berlaku bagi alamat yang paling membutuhkannya (utang #2).

Yang TIDAK berubah: pin tetap menang. Ladder hanya bekerja ketika admin tidak menjatuhkan pin,
atau saat menekan "Cari alamat di peta" — dan di situ hasilnya lewat di depan mata manusia sebelum
menjadi uang. Itulah yang membuat urutan pin-dulu-ladder-kemudian bukan sekadar penjadwalan,
melainkan syarat.

## 2. Batas Kejujuran — apa yang berubah dan apa yang tidak

**Yang berubah:**

- Formulir klien dan formulir mitra di panel staf memperoleh peta pemilih lokasi.
- Koordinat yang dijatuhkan manusia mengalahkan koordinat hasil geocoding.
- Pengajuan klien mewarisi koordinat yang sudah dibenarkan admin, bila alamatnya tidak diubah.

**Yang TIDAK berubah:**

- **Layar klien: nol perubahan.** Klien tetap mengetik alamat sebagai teks. Tidak ada peta, tidak
  ada pin, tidak ada langkah tambahan di formulir pengajuan.
- Skema basis data: tidak ada tabel, kolom, enum, atau policy RLS baru.
- Seluruh alur uang: rate card, tarif khusus `>20 km`, tagihan, rekap honor — tidak disentuh.
- `normalkanAlamat()`, `geocode_cache`, dan batas 1 permintaan/detik: tidak disentuh.
- **Jarak tetap garis lurus.** `haversineKm` dipertahankan apa adanya, termasuk keputusan di
  `jarak.ts` untuk tidak memasang pengali jalan tempuh. Pin yang sempurna memperbaiki
  KOORDINATNYA, bukan arti jaraknya — klien 4,2 km di seberang sungai tetap terbaca 4,2 km.
  Laci "ubah jenjang" tetap punya alasan untuk ada.

## 3. Keputusan yang disepakati

| # | Keputusan | Kenapa |
|---|---|---|
| 1 | Peta hanya di panel staf; layar klien tidak berubah | Pin dijatuhkan admin saat mengonfirmasi permintaan — momen yang menurut Ruling 11 memang saat jenjang dihitung. Menambah peta di formulir klien menaruh rintangan pada satu-satunya layar yang dihadapi orang awam |
| 2 | Tombol "gunakan lokasi saat ini" hanya untuk staf | Ditekan klien yang sedang tidak di rumah, ia menyimpan lokasi yang salah TANPA penanda apa pun — dan terlihat disengaja. Kegagalan geocoding setidaknya berisik; ini diam |
| 3 | Pencarian alamat tetap berjalan di server | `geocode.ts` memasang `server-only` dengan alasan tertulis; browser juga tidak bisa menyetel `User-Agent` yang dituntut kebijakan Nominatim, dan batas lajunya jadi tak terkendali |
| 4 | Ubin peta dari `tile.openstreetmap.org` | Tanpa akun, tanpa kunci API. Volume pemakaian hanyalah staf yang sedang mengisi alamat. Sumber ubin hidup sebagai SATU titik konfigurasi supaya bisa dipindahkan tanpa mengubah rancangan |
| 5 | Geocoding dipertahankan sebagai penggeser peta, bukan dihapus | Ia masih menghemat pekerjaan pada alamat yang memang dikenal OSM. Yang dicabut hanyalah wewenangnya menentukan koordinat yang menentukan uang |
| 6 | `display_name` dari Nominatim tidak ditampilkan | Pin di atas peta adalah umpan balik yang lebih jujur daripada sebaris teks, dan menampilkannya menuntut kolom baru di `geocode_cache` untuk keadaan cache-hit |

## 4. Komponen & Alur

### 4.1 Komponen peta — `src/app/_shell/panel/pemilih-lokasi.tsx`

Komponen klien, dipakai bersama oleh formulir klien dan formulir mitra. Menambah satu dependensi
npm (`leaflet`); proyek belum punya peta apa pun hari ini.

Isinya: peta Leaflet berubin OSM, satu marker yang bisa digeser, klik peta memindahkan marker,
tombol "cari alamat" (memanggil §4.2), tombol "gunakan lokasi saat ini" (`navigator.geolocation`),
dan dua kotak lat/lon *read-only* sebagai umpan balik angka.

Tidak ada tombol "simpan lokasi" tersendiri. Koordinatnya hidup sebagai `input type="hidden"` di
dalam formulir yang sudah ada, dan tersimpan pada submit yang sama dengan alamatnya — satu tombol
simpan, satu keadaan, tidak ada lokasi yang tersimpan setengah jalan.

### 4.2 Pencarian alamat — `src/app/api/geocode/route.ts`

Route handler bergerbang peran `admin`/`owner`, meneruskan ke `geocodeAlamat()` yang sudah ada.
Cache, batas laju, dan `User-Agent` yang sah semuanya tetap berlaku tanpa disalin ulang.
Memulangkan `{ lat, lon } | null`. Hasilnya HANYA menggeser peta; tidak ada apa pun yang tersimpan
dari langkah ini.

### 4.3 Aturan "pin menang"

Pada `buatKlien`/`simpanMitra` dan padanan perbaruinya (`perbaruiKlien`, `perbaruiMitra`):

- **Ada koordinat di FormData** → koordinat itu yang disimpan, dan `geocodeAlamat()` **tidak
  dipanggil sama sekali**.
- **Tidak ada koordinat** → perilaku hari ini dipertahankan utuh: server action menggeocode sendiri.

Konsekuensi yang disengaja: tidak ada satu pun keadaan yang menjadi lebih buruk daripada hari ini.
Koordinat tetap `null`-able — tidak menjatuhkan pin **tidak boleh** menggagalkan penyimpanan
alamat, sesuai Ruling 9.

### 4.4 Tambalan jalur pengajuan klien

Tanpa bagian ini, peta tidak menyentuh jalur yang kemungkinan besar paling ramai. Sesi punya dua
jalur lahir, dan koordinat kliennya datang dari tempat berbeda:

| Jalur | Sumber koordinat klien | Tertolong peta tanpa tambalan? |
|---|---|---|
| `jadwalkanSesi` (admin menjadwalkan langsung) | `clients.alamat_lat/lon` | ya |
| `konfirmasiPermintaan` (dari pengajuan klien) | `booking_requests.alamat_lat/lon` | **tidak** |

`ajukanJadwal` menggeocode ulang teks yang klien ketik dan tidak pernah melirik koordinat yang
sudah dipin admin di kartu klien. `konfirmasiPermintaan` lalu menyalinnya apa adanya ke sesi.

**Tambalannya:** di `ajukanJadwal`, sebelum menggeocode — bila alamat yang diajukan sama persis
dengan alamat profil klien (dibandingkan lewat `normalkanAlamat()` yang sudah ada), pakai
`clients.alamat_lat/lon` alih-alih bertanya ke Nominatim. Formulir pengajuan sudah terisi otomatis
dari profil klien, jadi mayoritas pengajuan mewarisi pin yang sudah dibenarkan admin. Nol perubahan
di layar klien, dan satu permintaan Nominatim lebih sedikit.

**Ketegangan yang harus tercatat, bukan diselundupkan.** Spec transport §T6 sengaja melarang
`konfirmasiPermintaan` mengambil ulang alamat dari profil klien, supaya klien yang memesan untuk
alamat lain tidak diam-diam dikirimi mitra ke rumahnya. Tambalan ini tidak melanggar maksud itu:
ia hanya berlaku ketika teks alamatnya **identik**, sehingga tidak ada alamat yang berubah — yang
diwarisi hanyalah jawaban atas pertanyaan yang sudah pernah dijawab manusia. Perbandingannya harus
tetap konservatif; melonggarkannya mengembalikan bahaya yang T6 cegah.

## 5. Pengujian

| Yang dijaga | Bentuk uji |
|---|---|
| Pin mengalahkan geocoding | Server action dengan koordinat di FormData tidak memanggil Nominatim sama sekali |
| Pin kosong tidak menggagalkan simpan | Alamat tanpa koordinat tetap tersimpan, koordinat `null` (Ruling 9 tetap hidup) |
| Route geocode tertutup bagi bukan-staf | Peran `klien` dan anonim ditolak |
| Pewarisan koordinat pengajuan | Alamat identik → koordinat profil terpakai, Nominatim tidak dipanggil; alamat diubah satu huruf → jatuh kembali ke geocoding |
| **Atribusi OSM pada peta** | lihat §5.1 |

### 5.1 Jebakan atribusi

`tests/transport-atribusi.test.ts` membuktikan atribusi dengan **memindai teks JSX**. Atribusi peta
Leaflet datang dari opsi JavaScript (`attribution: '© OpenStreetMap contributors'`), bukan teks
JSX — sehingga uji itu akan tetap **hijau** sementara ada layar baru yang menampilkan data OSM
tanpa dijaga siapa pun.

Ini persis kelas kegagalan yang dicatat di runbook transport: jaminan hilang tanpa satu pun asersi
berubah merah. Ujinya wajib diperluas untuk mencakup komponen peta, dengan bentuk bukti yang sesuai
sumbernya — bukan pemindai teks JSX yang akan berbohong di sini.

## 6. Kewajiban non-teknis

- **Atribusi ODbL** tetap wajib tampil di layar, kini juga di dalam peta itu sendiri.
- **Kebijakan pemakaian ubin berbeda dari kewajiban atribusi.** `tile.openstreetmap.org` adalah
  layanan sukarela yang melarang pemakaian berat. Volume PADMA hari ini jauh di bawah ambang itu,
  tetapi ini keputusan sadar (Keputusan 4), bukan sesuatu yang gratis selamanya. Bila pemakaian
  naik, sumber ubin dipindahkan ke penyedia berkuota — satu titik konfigurasi, satu URL.
- Larangan mengunduh ubin secara massal atau memuat-awal berlaku; peta hanya dimuat saat staf
  membuka formulir alamat.

## 7. Di luar ruang lingkup

- Peta pada layar klien mana pun.
- Pemilih pin di layar konfirmasi permintaan (§4.4 menyelesaikannya tanpa layar baru).
- Jarak tempuh jalan sebagai pengganti garis lurus — keputusan tingkat spec, bukan di sini.
- Penggeocodean ulang alamat lama yang tersimpan tanpa koordinat. Baris lama tetap tanpa koordinat
  sampai ada yang membuka dan menyematkan pinnya; sesi yang terlanjur lahir darinya tetap muncul di
  penghitung "sesi selesai tanpa jenjang".
- Menampilkan `display_name` Nominatim (Keputusan 6).

## 8. Akibat pada utang yang sudah tercatat

| Utang di runbook transport | Status sesudah dokumen ini |
|---|---|
| #1 Daftar tersendiri "sesi tanpa jenjang" | **Turun prioritas.** Ia kembali jadi jalur pengecualian, bukan jalur utama |
| #2 Coba-ulang geocoding yang gagal | **Turun prioritas.** Kegagalan geocoding tidak lagi menentukan koordinat |
| Runbook §3 (batas laju sebagai risiko utama) | **Menyesatkan, perlu diperbarui.** Risiko sesungguhnya adalah cakupan data OSM di Malang, bukan batas lajunya |
| Runbook §4 (kegagalan geocoding memberi makan lubang jenjang-null) | Masih benar, tetapi jauh lebih jarang terpicu |
