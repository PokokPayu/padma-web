# Transport, Alamat & Jarak — Runbook Deploy, Utang, dan Indeks Keputusan

**Spec:** `docs/superpowers/specs/2026-09-07-padma-transport-design.md`
**Rencana:** `docs/superpowers/plans/2026-09-07-padma-transport.md`

Berkas ini menyimpan tiga hal yang tidak tercatat di riwayat git: apa yang harus diketahui orang yang
men-deploy ini, utang yang sengaja ditunda beserta alasannya, dan **indeks keputusan** yang dirujuk
puluhan komentar di kode sebagai "Ruling N".

---

## Runbook deploy — baca sebelum menerapkan ke produksi

**1. Katalog tarif transport harus diisi SEBELUM sesi berjenjang pertama diselesaikan.**
Migrasi tidak membawa tarif apa pun. Sesi yang selesai sebelum owner mengisi rate card jatuh
"tak bertarif" dan **honor transportnya tidak terbayar** — lihat utang #6, tidak ada jalur retroaktif.
Isi keempat jenjang (`0_5`, `5_10`, `10_15`, `15_20`) di `/owner/transport` lebih dulu.

**2. `>20 km` sengaja TIDAK punya tarif otomatis.** Materi klien menulis ">20 km: konfirmasi admin",
dan itu berarti KETIADAAN tarif, bukan tarif bernilai besar. Nominalnya ditetapkan owner per sesi.
Sesi semacam itu muncul di antrean `/admin` dan tagihannya tertahan sampai owner mengisinya.

**3. Geocoding lewat Nominatim SEBAGIAN BESAR GAGAL untuk alamat Malang. Diukur, bukan
diperkirakan.** Ini yang paling penting dari seluruh runbook ini, dan ia tidak diketahui saat
rantai transport ditulis.

Pengukuran 7 September 2026 dengan 32 alamat berbentuk Malang: **26 gagal total**, 4 pulang
setingkat ruas jalan, 2 setingkat benda. Pemblokiran sudah disingkirkan sebagai penjelasan —
Nominatim menjawab HTTP 200 dengan array kosong. Mekanismenya:

- Nominatim menuntut SELURUH kata cocok, dan gagal total — bukan mundur ke jalannya — begitu ada
  satu kata yang tak dikenal. Akibatnya **semakin lengkap alamat ditulis, semakin besar
  kemungkinannya gagal**, kebalikan dari naluri siapa pun yang merancang formulir alamat.
- Saat berhasil pun **nomor rumahnya dibuang**: `Jl. Veteran No. 8` dan `Jl. Veteran` memulangkan
  koordinat yang identik. Presisi setingkat rumah tidak tersedia di OSM Malang.

Konsekuensi operasionalnya langsung: **penghitung "Sesi selesai tanpa jenjang" (runbook #4) bukan
jalur pengecualian, ia jalur utama** — dan setiap sesi di dalamnya adalah honor transport yang
belum terbayar. Utang #1 dan #2 karena itu jauh lebih mendesak daripada yang tertulis di tabelnya.

Alatnya ada di `web/scripts/probe-geocode.ts` bila perlu diukur ulang untuk kota lain.

**SUDAH DITANGANI (7 Sep 2026).** Formulir klien dan mitra di panel staf kini memuat PEMILIH
LOKASI DI PETA: admin menjatuhkan pin, dan koordinat itu MENGALAHKAN geocoding — Nominatim tidak
ditanyai sama sekali ketika pin ada. Geocoding turun pangkat menjadi penggeser peta; gagal pun
tidak menghentikan apa pun karena petanya tetap bisa diklik. Pengajuan klien yang alamatnya tidak
diubah mewarisi koordinat profil yang sudah dipin admin, sehingga jalur pengajuan — yang paling
ramai — ikut tertolong tanpa satu pun perubahan di layar klien. Rancangan dan alasannya:
`docs/superpowers/specs/2026-09-07-padma-pemilih-lokasi-design.md`.

Yang TIDAK berubah: bila admin tidak menjatuhkan pin, jalur geocoding lama berlaku utuh, dengan
angka kegagalan di atas. Penghitung "Sesi selesai tanpa jenjang" (runbook #4) karena itu tetap
perlu dibaca — ia kembali menjadi jalur pengecualian, bukan jalur utama.

Geocoding bertingkat (mengupas alamat sampai "jalan + kota", yang menaikkan keberhasilan 19% ->
72%) DITUNDA, bukan dibatalkan — lihat `docs/superpowers/2026-09-07-ladder-geocoding-ditunda.md`
beserta seluruh pengukuran dan prasyaratnya.

**3b. Nominatim juga punya batas 1 permintaan per detik.** Konsekuensi yang harus diketahui sebelum
trafik naik:
- Batas itu ditegakkan per PROSES, bukan per akun. Di lingkungan serverless setiap instance punya
  jatahnya sendiri, sehingga batas sesungguhnya bisa terlampaui tanpa satu pun galat di sisi kita
  (utang #7).
- Melampaui batas berisiko IP diblokir. Bila itu terjadi, setiap alamat baru gagal digeocoding, dan
  kegagalan itu **langsung memberi makan lubang jenjang-null** — lihat runbook #4.
- Atribusi "© OpenStreetMap contributors" adalah kewajiban lisensi ODbL, bukan pilihan desain. Ia
  wajib tampak di setiap layar yang menampilkan hasilnya, dan dijaga
  `web/tests/transport-atribusi.test.ts`.

**4. Kegagalan geocoding TIDAK pernah menghalangi penyimpanan alamat — dan itu disengaja.** Alamat
tetap tersimpan, koordinatnya kosong, dan jenjangnya `null`. Admin dapat menetapkan jenjang manual
lewat laci "ubah jenjang" di `/admin/sesi`. **Panel `/admin` menampilkan penghitung "Sesi selesai
tanpa jenjang" — angka itu harus dibaca sampai nol setiap pekan**, karena setiap sesi di dalamnya
adalah honor transport yang tidak terbayar.

**5. Kegagalan geocoding disimpan PERMANEN.** `geocode_cache` mencatat kegagalan tanpa masa
kedaluwarsa. Satu gangguan jaringan sesaat mengunci sebuah alamat selamanya sampai barisnya dihapus
manual. Ini utang #2 dan paling layak dikerjakan lebih dulu.

**6. `web/supabase/seed.sql` jangan pernah dijalankan di produksi.**

**7. `npm run test:e2e:video` menyentuh bucket Cloudflare R2 SUNGGUHAN** bila kredensial R2 ada di
`.env.local`. Ia mengunggah lalu menghapus objek uji. Jalankan hanya dengan sadar.

---

## Utang tindak lanjut

Semua sudah ditriase review menyeluruh sebagai "boleh menyusul". Diurutkan menurut nilai.

| # | Utang | Kenapa ditunda |
|---|---|---|
| 1 | **Daftar tersendiri untuk antrean "sesi tanpa jenjang".** Hari ini hanya ADA ANGKA di `/admin` plus tautan ke `/admin/sesi`; admin masih harus memindai daftar untuk menemukan barisnya. Bandingkan `>20 km` yang punya halaman berisi daftarnya. **TURUN PRIORITAS (7 Sep 2026):** dengan pemilih lokasi, jenjang kosong kembali menjadi pengecualian, bukan jalur utama. | Angkanya sudah menghentikan kelas kegagalan yang sesungguhnya — honor yang hilang **senyap**. Menemukan barisnya kini merepotkan, bukan mustahil. |
| 2 | **Coba-ulang geocoding yang gagal.** `geocode_cache.dicoba_pada` sudah ditulis tetapi tidak pernah dibaca siapa pun. Butuh TTL, atau tombol "coba lagi", atau minimal memisahkan "alamat tidak ditemukan" dari "gagal menghubungi Nominatim" — keduanya kini diperlakukan sama dan sama-sama permanen. **TURUN PRIORITAS (7 Sep 2026):** kegagalan geocoding tidak lagi menentukan koordinat ketika admin menjatuhkan pin. | Alamat tetap tersimpan dan jenjangnya bisa ditetapkan manual, jadi tidak ada yang buntu total. |
| 3 | **Klien tidak pernah melihat rincian transport `>20 km`**, bahkan sesudah owner menetapkan nominalnya. Sisi admin sudah menampilkannya. Menutupnya butuh view sempit ber-RLS "sesi milik sendiri" yang memulangkan KEBERADAAN baris, bukan nominal. | Halaman tagihan klien memang tidak menampilkan nominal apa pun (nominal via WhatsApp), jadi yang hilang adalah satu baris keterangan, bukan angka. |
| 4 | **Jalur koreksi `transport_khusus` yang sah.** Hari ini hanya service role: UPDATE ditolak trigger, DELETE dicabut. Bila jenjang sesi dikoreksi keluar dari `>20 km`, baris tarif khususnya menjadi YATIM — lenyap dari antrean, diabaikan rekap, dan berlaku lagi diam-diam bila jenjangnya dikembalikan. | Koreksi jenjang keluar dari `>20 km` adalah kejadian langka; belum ada keputusan antara pola "fakta baru" (ala `honor_marks`) vs penulisan ulang. |
| 5 | **Transport untuk sesi BERPAKET tidak ditagihkan ke siapa pun.** Honornya tetap dibayarkan kepada mitra, tarif kliennya sengaja TIDAK menambah `totalHarga` supaya margin tidak memuat pendapatan hantu. PADMA menanggungnya. | Menunggu spec paket bundling; menagihnya sekarang berarti menebak bentuk tagihan paket. |
| 6 | **Tarif retroaktif tidak mungkin.** Sesi yang lebih tua dari tarif transport paling awal jatuh tak-bertarif PERMANEN, dan `guard_tarif_transport_maju` menolak tanggal mundur bahkan dari owner. | Perilaku yang SAMA sudah diterima untuk tarif varian — konsekuensi seragam dari rate card append-only, bukan lubang khusus transport. Melebarkannya keputusan tingkat spec. |
| 7 | **`tungguGiliran()` bukan antrean sungguhan** dan tidak teruji: dua pemanggil serentak melanggar batas 1 req/detik persis pada kasus yang mestinya ia cegah, dan state-nya per-proses. `vitest.config.ts` menyetel jedanya ke 0 dan `geocode.ts` membaca env itu sekali saat modul dimuat, jadi tidak ada uji yang bisa menyalakannya kembali tanpa `resetModules`. | Volume geocoding masih rendah; risikonya naik bersama trafik, bukan sekarang. |
| 8 | **`sessions.alamat` / `alamat_lat` / `alamat_lon` ditulis SATU dari DUA jalur, dibaca NOL jalur.** `konfirmasiPermintaan` menyalinnya, `jadwalkanSesi` tidak, dan tidak ada pembacanya. Konsumen pertama di masa depan akan menemukan separuh sesi beralamat kosong. | Alasan spec (riwayat alamat tetap jujur saat klien pindah) belum berlaku untuk apa pun hari ini. Perbaiki bersama konsumen pertamanya. |
| 9 | **Idempotensi `seed.sql` hanya per hari** — menjalankannya di hari berbeda menyisipkan baris "perubahan tarif" palsu. Paritas dengan blok `variant_rates`; perbaiki keduanya sekaligus. | Seed hanya untuk pengembangan. |
| 10 | **`tests/e2e/owner.e2e.ts` belum menyentuh `/owner/transport`** maupun StatTile transport; paginasi `.range()` di `ambilSesiMenungguTarif()` belum diuji pada skala >1000 baris. | Keduanya tertutup uji integrasi tingkat basis data. |
| 11 | **Baris "Transport · 0–5 km" tampil untuk sesuatu yang gratis.** Klien melihat rincian lalu bertanya nominalnya via WhatsApp — subsidi yang justru ingin ditonjolkan malah jadi tanya-jawab. | Kosmetik; tidak ada angka yang salah. |

---

## Verifikasi yang tersisa di tangan pemilik produk

Dua butir menuntut mata manusia di browser dan **belum pernah diperiksa**:

- Buka `/admin` sebagai admin biasa: jenjang terlihat, dan **nol nominal transport** di mana pun.
- Buka `/owner`: rate card terisi, dan subsidi 0–5 km tampil sebagai selisih Rp10.000.
- **SUDAH DIPERIKSA (7 Sep 2026):** pemilih lokasi di `/admin/mitra` dan `/admin/klien` — peta
  tergambar, atribusi Leaflet terbaca, pin bisa dijatuhkan & digeser, dan koordinat yang tersimpan
  adalah angka pin, bukan hasil geocoding.

Ditambah `npm run test:e2e:video`, yang tidak dijalankan karena menyentuh bucket R2 produksi.

---

## Indeks keputusan ("Ruling N")

Puluhan komentar di kode merujuk "Ruling N". Nomor itu lahir saat pengerjaan; daftar di bawah adalah
satu-satunya tempat rujukannya berlabuh. Yang dicatat hanyalah keputusan yang membentuk kode.

| N | Keputusan | Kenapa |
|---|---|---|
| 6 | `di_atas_20` TIDAK boleh punya baris `transport_rates` — ditegakkan CHECK, bukan komentar | "Tidak pernah ada barisnya" yang hidup sebagai kalimat akan dilanggar oleh penulis berikutnya |
| 9 | Kegagalan geocoding tidak pernah menghalangi penyimpanan alamat | Alamat Indonesia sering tidak dikenal OSM; menolak simpan berarti menolak pekerjaan yang sah |
| 11 | Jenjang diisi otomatis saat sesi LAHIR, di kedua jalur pembuatan sesi | Di sanalah mitra ditugaskan — jarak baru bisa dihitung pada saat itu |
| 12 | Admin memperoleh angka antrean `>20 km` yang BENAR, bukan 0 | Gerbang peran yang memulangkan 0 membuat badge yang tak bisa dipadamkan; yang dilindungi adalah NOMINAL, dan view sempit sudah melindunginya |
| 13 | Hak view dicabut dari `public, anon, authenticated` SEBELUM `grant select` | Hak bawaan Supabase berlaku untuk VIEW juga, dan `grant` MENAMBAH alih-alih menggantikan |
| 14 | Sesi tak bertarif memakai `sesiTakBertarif` + medan `sebab`, bukan bendera per-mitra baru | Dua indikator "tertunda" yang berarti hampir sama akan berpisah diam-diam |
| 16 | Transport adalah MEDAN rincian pada item sesi, bukan item tagihan kedua | Satu sesi punya SATU status bayar; dua item ber-`id` sama melahirkan dua tombol bayar, badge yang berselisih, dan kunci React kembar |
| 17 | `>20 km` tanpa tarif khusus tidak menghasilkan rincian transport; sisi admin memverifikasinya lewat ANTI-JOIN ke view (boolean, bukan nominal) | Menagih nominal yang belum ditetapkan siapa pun adalah cacat uang |
| 18 | Transport sesi berpaket: honor dibayarkan, tarif klien TIDAK menambah `totalHarga` | Margin harus mencerminkan uang yang benar-benar akan datang |
| 19 | Celah tarif retroaktif didokumentasikan, tidak diperbaiki | Seragam dengan tarif varian; melebarkannya keputusan tingkat spec |
| 20 | `LABEL_JENJANG` tinggal di `lib/transport/jarak.ts` | `lib/` mengimpor nilai dari `app/` adalah pembalikan arah kebergantungan |
| 21 | Klien tidak pernah melihat rincian `>20 km` | Halaman tagihan klien tidak menampilkan nominal sama sekali, jadi tidak ada "tarif diketahui" untuk dijadikan gerbang |
| 22 | Uji atribusi OSM membuktikan atribusi sampai ke MARKUP | Uji pemindai teks sumber HIJAU walau atribusinya cuma di komentar — dan atribusi di komentar tidak memenuhi lisensi apa pun |
| 24 | Antrean "sesi selesai tanpa jenjang" | `jenjang = null` punya DUA sumber, dan yang kedua (geocoding gagal pada sesi baru) lahir sesudah keputusan aslinya ditulis |
| 25 | `daftarTagihanAdmin()` gagal TERTUTUP saat query view gagal | Gagal terbuka berarti setiap sesi `>20 km` tertagih seolah sudah bertarif |
| 26 | `hitungAntrean()` degradasi ke 0, tidak melempar | Ia dipanggil di layout `/admin`; satu galat baca menjatuhkan tiga halaman sekaligus. Badge salah lebih baik daripada panel mati |

---

## Catatan proses yang layak diingat

Kegagalan paling mahal sepanjang pengerjaan sama persis dengan rencana sebelumnya: **jaminan yang
hilang tanpa satu pun asersi berubah merah.** Yang baru dan layak diingat:

- **Dua kali yang menangkap cacat baru adalah PAGAR LAMA proyek, bukan uji yang ditulis untuk fitur
  ini** — sekali uji struktural yang memindai seluruh view di skema, sekali pemindai jejak yatim
  yang menyapu seluruh basis data. Keduanya tidak pernah ikut dalam sapuan uji terarah mana pun.
  Konsekuensinya: menjalankan suite PENUH bukan formalitas, ia satu-satunya tempat uji berskop
  global berjalan.
- **Sebuah keputusan yang benar bisa menjadi salah tanpa disentuh.** "Jangan hukum sesi ber-jenjang
  kosong" benar ketika ditulis; satu tugas kemudian melahirkan sumber kedua jenjang kosong, dan
  komentar yang membenarkannya tidak ikut diperbarui. Tidak ada uji yang bisa memerah untuk ini —
  hanya membaca seluruh perubahan sekaligus yang menemukannya.
- **Uji yang paling berbahaya adalah yang namanya menjanjikan lebih dari yang dibuktikannya.**
  Dua ditemukan di branch ini: satu "ADMIN tidak memperoleh nominal transport" yang tetap hijau
  walau kebocoran total diperkenalkan, satu lagi batas jenjang yang membiarkan mutasi `<=` → `<`
  lolos sepenuhnya.
