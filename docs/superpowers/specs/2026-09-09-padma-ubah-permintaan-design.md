# PADMA — Menghubungi Klien & Mengubah Permintaan dari Panel Detail

**Tanggal:** 9 September 2026
**Pendahulu:** `docs/superpowers/specs/2026-09-09-padma-tab-permintaan-design.md` (ter-merge,
`141ac32`…`12e288f`). Dokumen ini menambah kemampuan ke panel detail yang dibangun di sana.

**Sumber keputusan:** permintaan pemilik repo 9 September 2026 — tiga kemampuan di panel detail
permintaan: menghubungi klien, mengubah alamat, mengubah tanggal & jam. Empat keputusan yang tidak
bisa diturunkan dari kode diambil pemilik repo dalam sesi yang sama (K1, K2, K4, K6).

**Mode pengerjaan:** **NOL UJI BARU**, sama seperti pekerjaan sebelumnya, atas keputusan pemilik
repo demi kecepatan. Pembuktian dilakukan manual. Konsekuensinya dicatat di bagian "Lubang yang
sengaja dibiarkan terbuka" — bukan diserahkan kepada ingatan.

---

## Masalah

Panel detail permintaan bisa membaca dan bisa memajukan status, tetapi tidak bisa **memperbaiki**
apa pun kecuali koordinat. Tiga kebuntuan nyata:

1. **Admin tidak punya jalan menghubungi klien** kecuali permintaan itu kebetulan berstatus
   `menunggu_bayar` — hanya di sana tombol WhatsApp muncul, dan isinya khusus tagihan. Untuk segala
   hal lain admin harus keluar ke modul Klien mencari nomornya.
2. **Alamat yang tidak terdeteksi tidak bisa dicocokkan.** Admin hanya bisa menjatuhkan pin; teks
   alamatnya sendiri tidak bisa disunting. Padahal alamat yang gagal digeocode sering gagal karena
   penulisannya — dan yang tahu bentuk tulisan yang dikenali OSM adalah admin, bukan klien.
3. **Jam yang diminta klien tidak bisa digeser.** Rantai C1 sudah menyediakan `preferensi_waktu`
   sebagai *alternatif bila jam yang diminta tidak bisa*, tetapi tidak ada satu pun layar yang bisa
   menuliskan hasil kesepakatannya. Satu-satunya jalan sekarang adalah membatalkan dan meminta klien
   mengajukan ulang.

---

## Keputusan

### K1 — Boleh diubah sampai SEBELUM tagihan terbit

Himpunan status yang mengizinkan perubahan: **`diminta`, `mencari_mitra`, `mitra_siap`**.
`menunggu_bayar` **di luar**.

Ini himpunan BARU, bukan `STATUS_ANTRE` (yang memuat empat status termasuk `menunggu_bayar`). Ia
ditulis sebagai konstanta bernama di `src/lib/jadwal/status.ts` — **jangan** menuliskannya sebagai
daftar literal di server action. Repo ini sudah membayar sekali untuk himpunan status yang ditulis
tangan di tempat pemakaian.

Alasan batasnya di situ: begitu tagihan terbit, nominal transport sudah dihitung, pesannya sudah
dikirim ke klien, dan tenggat 24 jam sudah berjalan. Mengubah tanggal atau alamat sesudah itu
membuat tagihan yang sudah ada di tangan klien tidak lagi benar — tanpa satu pun galat.

Sebaliknya, di ketiga status yang diizinkan **tidak ada nominal basi yang tertinggal**: jenjang
transport baru dihitung `konfirmasi_permintaan` pada saat konfirmasi, dari koordinat yang berlaku
saat itu.

### K2 — Bidan yang sudah ditetapkan TIDAK dilepas otomatis

Pada `mitra_siap`, mengubah tanggal/jam/alamat **mempertahankan** bidan, dan panel menampilkan
peringatan bahwa penetapan itu dibuat untuk jadwal & alamat sebelumnya.

Sistem tidak tahu jadwal, cuti, atau kesediaan bidan — `lib/jadwal/urutan-mitra.ts` sudah menuliskan
bahwa ia mengurutkan, tidak memilih. Melepas orang dari penugasan berdasarkan pengetahuan yang tidak
dimiliki sistem adalah keputusan yang tidak berhak ia ambil. Tombol "Ganti bidan" sudah ada di layar
yang sama bila admin memutuskan begitu.

### K3 — Satu formulir, bukan tiga kontrol

Alamat, tanggal, jam, dan peta menjadi **satu** formulir dengan satu tombol Simpan, ditangani satu
server action `perbaruiPermintaan`. `tetapkanKoordinatPermintaan` dilebur ke dalamnya dan dihapus.

Alasan menolak tiga kontrol terpisah: dua tempat yang sama-sama menulis `alamat_lat` dengan aturan
berbeda adalah bentuk yang melahirkan "dua baris bercerita beda tentang tempat yang sama" — cacat
yang spec sebelumnya sudah tulis penjagaannya di K7.

Dua akibat sampingan yang diinginkan:

- **Peta jadi selalu tersedia**, tidak lagi hanya saat koordinat kosong. Ini menutup utang yang
  tercatat di `docs/superpowers/2026-09-09-tab-permintaan-tindak-lanjut.md` §C3: pin salah klik
  saat ini tidak bisa dikoreksi dari layar mana pun, dan pin yang salah menghasilkan jenjang
  transport yang **percaya diri dan salah**, bukan NULL yang akan tertangkap StatTile.
- **`<input type="hidden" name="alamat">` dihapus.** Ia dipasang di gelombang perbaikan terakhir
  agar tombol "Cari alamat di peta" menemukan alamatnya; dengan textarea `name="alamat"` yang
  sungguhan di dalam form, penambal itu tidak diperlukan lagi.

### K4 — Alamat berubah → koordinat lama dibuang, lalu geocode sekali

Aturan koordinat, mengikuti konvensi **PIN MENANG** yang sudah hidup di `src/app/admin/mitra/aksi.ts`:

| Keadaan | Koordinat yang disimpan |
|---|---|
| Admin menjatuhkan/memindahkan pin | Pin itu. Nominatim **tidak** ditanya sama sekali. |
| Tanpa pin, teks alamat **berubah** | Koordinat lama **dibuang**, `geocodeAlamat` dicoba sekali. Gagal → NULL, dan peringatan "belum berkoordinat" kembali muncul. |
| Tanpa pin, teks alamat **sama** | Koordinat lama dipertahankan apa adanya. |

Koordinat lama dibuang saat alamat berubah karena ia menandai **tempat lain**. Mempertahankannya
berarti jarak — dan karenanya jenjang transport — dihitung untuk lokasi yang bukan alamat kunjungan,
dan hasilnya keluar rapi tanpa satu pun galat.

Menanyakan Nominatim untuk alamat yang pinnya sudah dijatuhkan hanya membakar kuota gratis milik
pihak lain; pada volume nyata itulah yang memicu pemblokiran.

### K5 — `preferensi_waktu` TIDAK ikut bisa diubah

Ia preferensi milik klien atas alternatif waktu, bukan milik admin. Mengubahnya berarti menulis
ulang jawaban orang lain atas pertanyaan yang tidak pernah diajukan lagi kepadanya.

Ia juga bagian dari kunci indeks dedup (lihat K7), sehingga mengubahnya diam-diam mengubah baris
mana yang dianggap kembar.

### K6 — "Hubungi klien" membuka percakapan KOSONG

Tautan `https://wa.me/<nomor>` tanpa teks apa pun. Admin menulis sendiri.

Template yang menyebut kebijakan ditolak: repo ini sudah dua kali salah menuliskan kebijakan
pembatalan dari ingatan, dan sebuah pesan siap-tempel yang menyebut aturan adalah cara tercepat
mengulanginya. Tombol tagihan tetap bertemplat karena nominal dan sisa waktunya **dihitung server**,
bukan diingat manusia.

Tersedia di **semua** status, termasuk permintaan yang sudah batal — menghubungi klien tidak pernah
berbahaya, dan justru permintaan yang batal karena tenggat itulah yang paling perlu dijelaskan.

Nomornya lewat `nomorWaKlien`, yang sengaja **tanpa nomor cadangan** klinik. Bila nomornya tidak
sah, tombolnya hilang dan **digantikan kalimat yang terlihat** — pola yang sudah dipakai tombol
tagihan. Tombol yang hilang diam-diam membuat layar rusak terlihat sama persis dengan layar benar.

### K7 — Bentrok indeks dedup dijawab sebagai kalimat

`booking_requests_antrean_unik` unik pada `(client_id, service_id, tanggal, preferensi_waktu)` untuk
status pra-konfirmasi. Mengubah tanggal bisa menabraknya bila klien punya permintaan lain yang
serupa.

PostgREST menjawabnya `23505`. Itu **wajib** ditangkap dan diterjemahkan: *"Klien ini sudah punya
permintaan lain untuk layanan dan tanggal yang sama."* Tanpa terjemahan, admin membaca kode Postgres
dan menyimpulkan sistemnya rusak.

### K8 — Validasi tanggal & jam hidup di server action, dan HANYA di sana

`guard_booking_pembatas` memeriksa tanggal-tidak-di-masa-lalu dan jam-termasuk-jam-layanan **hanya
untuk klien** — badannya dibuka `if user_role() = 'klien'`. Untuk admin, basis data tidak memeriksa
apa pun.

Karena itu `perbaruiPermintaan` **wajib** memeriksa keduanya sendiri:

- **Tanggal tidak boleh di masa lalu menurut kalender Asia/Jakarta**, bukan menurut jam server
  (Vercel berjalan UTC; antara 17:00–24:00 UTC tanggal Jakarta sudah besok). Pakai `hariIniJakarta()`.
- **Jam harus salah satu jam layanan**, dibaca dari `bacaPengaturan().jamLayanan`.

Komentar di server action wajib menyebut bahwa ini **satu-satunya** pagarnya, supaya orang berikutnya
tidak mengira ada jaring di bawahnya.

### K9 — Empat pagar penulisan yang sudah menjadi pola repo

1. `requireRole(["admin", "owner"])`.
2. Baris dibaca lebih dulu — alamat lama dibutuhkan untuk memutuskan perlu geocode ulang atau tidak.
3. UPDATE dibatasi `.in("status", STATUS_UBAH_PERMINTAAN)`.
4. Hasil UPDATE diperiksa **jumlah barisnya**, bukan hanya `error` — PostgREST menjawab update yang
   tertahan RLS dengan `200 + []`.

`status` **tidak pernah** masuk payload: mengubah jadwal bukan langkah dalam rantai, dan
`guard_booking_status` karenanya tidak tersentuh.

Tidak ada migrasi. Policy `booking: staf` (`for all`) sudah menampung seluruh tulisan ini.

---

## Lubang yang sengaja dibiarkan terbuka

Ditulis di sini supaya tidak ada yang mengira sudah beres.

### L1 — Tidak ada jejak siapa mengubah apa

Admin bisa mengubah tanggal yang diminta klien tanpa meninggalkan bekas. `jejak_jadwal` tidak bisa
menampungnya tanpa migrasi: `sesi_id` NOT NULL dan `tindakan` dibatasi ke
`batal`/`jadwal_ulang`/`tukar_hak`, sementara permintaan pra-konfirmasi belum punya sesi.

Keputusan pemilik repo: ditunda. Ia berubah bila klinik pernah berselisih dengan klien soal "saya
tidak pernah minta tanggal itu" — pada saat itu, penutupnya adalah tabel `jejak_permintaan`
tersendiri, bukan memperlebar `jejak_jadwal`.

### L2 — Sesudah ini, admin bisa menulis tanggal apa pun yang lolos dua pemeriksaan TypeScript

Tidak ada trigger, constraint, atau policy yang menahannya (K8). Jalur tulis kedua ke
`booking_requests` yang kelak lupa memanggil pemeriksaan yang sama akan gagal **senyap**: permintaan
berjadwal di masa lalu, atau di jam klinik tutup, tanpa satu pun galat.

Penutupnya adalah memperluas `guard_booking_pembatas` ke peran staf — sebuah migrasi, di luar
cakupan yang dipilih.

### L3 — Nol uji baru

Konsekuensi mode cepat. Yang tetap dikerjakan: memperbarui uji lama yang pecah, `npx tsc --noEmit`,
`npm run lint`. Yang tidak akan ada penjaganya:

- perilaku PIN MENANG dan ketiga cabang K4;
- penolakan tanggal masa lalu dan jam di luar jam layanan (L2 membuat ini lebih menggigit —
  satu-satunya pagarnya tidak punya uji);
- penerjemahan 23505;
- penolakan untuk status `menunggu_bayar`;
- RLS di sesi klien.

Pembuktiannya ada di daftar periksa manual yang menyertai rencana implementasi.

---

## Bukan bagian dari pekerjaan ini

- **Melepas bidan otomatis** saat jadwal berubah — ditolak di K2.
- **Mengubah layanan atau varian** permintaan. Itu mengubah tarif dan katalog, bukan logistik.
- **Memberi tahu klien otomatis** saat admin mengubah jadwalnya. Tombol "Hubungi klien" ada tepat di
  sebelahnya dan admin yang memutuskan kalimatnya — sejalan dengan K6.
- **Memperluas `guard_booking_pembatas` ke staf** — lihat L2.
