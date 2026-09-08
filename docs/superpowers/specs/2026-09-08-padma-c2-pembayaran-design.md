# PADMA C2 — Pembayaran sebagai Syarat Konfirmasi

**Tanggal:** 8 September 2026
**Pendahulu:** `docs/superpowers/specs/2026-09-08-padma-c1-fondasi-jadwal-design.md` — seluruh C1
sudah selesai dan ter-merge (C1-a `2ac03b8`, C1-b `23f0764`, C1-c `b087797`). Spec itu menyebut
isi C2 tetapi tidak merancangnya; dokumen ini yang merancangnya.

**Sumber keputusan:** keputusan pemilik repo 8 September 2026 atas empat pertanyaan yang tidak bisa
diturunkan dari kode — cara pencocokan uang, retensi bukti, perilaku tenggat, dan urutan kanal
pemberitahuan.

**Bagian dari tiga:** C1 membangun alur sampai jadwal terkunci. **C2 (dokumen ini)** menyisipkan
pembayaran sebagai syarat konfirmasi. C3 membangun pembatalan berjenjang waktu, jadwal ulang, dan
kredit layanan.

---

## Masalah

Sesudah C1, seorang admin bisa mengonfirmasi jadwal tanpa uang pernah berpindah. Pembayaran memang
ada di produk — halaman `/passport/bayar`, klaim "saya sudah bayar", verifikasi admin, jejak
beraktor — tetapi seluruhnya menempel pada **sesi yang sudah terjadwal**, yaitu sesudah komitmen
dibuat. Akibatnya tiga hal:

1. **Bidan tertahan pada pemesanan yang mungkin tidak pernah dibayar.** Begitu admin menetapkan
   bidan, orang itu terikat pada satu jadwal — dan tidak ada apa pun yang menuntut klien
   menyelesaikan bagiannya.
2. **Tidak ada tenggat.** Pengajuan bisa menganggur tanpa batas, dan satu-satunya yang
   membereskannya adalah admin yang kebetulan ingat.
3. **Uang masuk tidak bisa dicocokkan.** QRIS PADMA statis: ia tidak menyebut nominal dan tidak
   membawa nomor rujukan. Dua klien yang membayar jumlah sama di hari yang sama menghasilkan dua
   baris mutasi yang identik tanpa nama.

---

## Keputusan

### P1 — `menunggu_bayar` disisipkan antara `mitra_siap` dan `dikonfirmasi`

Nilai enumnya **sengaja belum dibuat di C1** ("menyiapkan nilai enum yang belum dipakai berarti
menaruh keadaan mati di dalam basis data yang tidak satu pun kode tahu cara keluar darinya"). C2
membuatnya sekaligus memberi jalan masuk dan jalan keluarnya.

Rantai lengkapnya menjadi:

```
diminta → mencari_mitra → mitra_siap → menunggu_bayar → dikonfirmasi
```

dengan `dibatalkan_klien` tetap terjangkau dari keempat keadaan sebelum `dikonfirmasi`, dan dua
panah baru:

- `menunggu_bayar → mencari_mitra` — admin melepas bidan (bidannya berhalangan) tanpa membatalkan
  pengajuan klien;
- `menunggu_bayar → dibatalkan_tenggat` — lihat P5.

**Tagihan terbit tepat pada perpindahan `mitra_siap → menunggu_bayar`**, bukan lebih awal. Alasannya
struktural dan sudah ditulis di C1 J7: tarif transport berasal dari domisili MITRA ke alamat KLIEN,
jadi total tidak bisa diketahui sebelum bidannya dipilih.

### P2 — Nominal tagihan TIDAK disimpan; ia diturunkan

Money firewall repo ini membatasi kolom nominal uang pada `variant_rates`, `honor_marks`,
`transport_rates`, dan `transport_khusus`, dan `tests/money-firewall-struktural.test.ts` memindai
SELURUH skema — termasuk tabel yang belum lahir. Menyimpan `total_tagihan` pada `booking_requests`
akan memerahkannya, dan itu benar: nominal turunan yang disimpan hanya menambah tempat untuk
berselisih.

Tagihan karena itu **dihitung saat dibaca**, dari `variant_rates` menurut tanggal sesi ditambah
`transport_rates` menurut jenjang — persis cara `hitungRekap()` bekerja. Konsekuensi yang
diinginkan: menaikkan tarif hari ini tidak menggeser satu pun tagihan yang sudah terbit.

Yang ditambahkan ke `booking_requests` hanyalah **keadaan**, bukan angka:

| Kolom | Isi |
|---|---|
| `status_bayar` | enum `pay_status` yang sudah ada (`belum` / `menunggu_verifikasi` / `lunas`) |
| `bukti_objek` | kunci objek bukti bayar di bucket privat; NULL bila belum diunggah |
| `tenggat_bayar` | `timestamptz`, diisi saat tagihan terbit |

`status_bayar` sudah dikecualikan eksplisit oleh money firewall karena ia **keadaan, bukan nominal**
— dan pengecualian itu diikat ke TIPE: `status_bayar int` tetap akan merah.

### P3 — Klien mengunggah bukti; admin tetap mencocokkan sendiri

Tiga cara dipertimbangkan. **Kode unik pada nominal** (Rp179.000 → Rp179.187) ditolak karena
membuat nominal aneh dan menuntut penjagaan agar tiga digit itu tidak bentrok antar tagihan aktif.
**Klaim tanpa bukti** ditolak karena dua klien yang membayar jumlah sama di hari yang sama tidak
bisa dibedakan sama sekali.

Yang dipilih: **klien mengunggah bukti transfer**, dan admin tetap membuka mutasi rekening untuk
mencocokkan. Unggahan mempercepat pencocokan dan meninggalkan jejak; ia **tidak** menggantikan
pemeriksaan — gambar bisa dipalsukan, dan rancangan yang menganggapnya bukti adalah rancangan yang
bisa ditipu satu tangkapan layar hasil sunting.

**Bukti transfer memuat data yang PADMA tidak minta.** Tangkapan layar m-banking lazimnya
menampilkan nama pemilik rekening, nomor rekening, dan sering kali saldo tersisa. Karena itu:

- **Bucket privat tanpa satu pun policy** pada `storage.objects` — hanya service role lewat rute
  kita sendiri, sesudah RLS memutuskan hak. Pola ini sudah terbukti di bucket `materi-halaman`.
- **Dikecilkan di peramban sebelum dikirim** (lebar maksimum 1.200px, JPEG kualitas 0,7). Menghemat
  penyimpanan sekaligus menurunkan ketajaman detail yang tidak diperlukan. Perkiraan: ~120 KB per
  bukti, ~12 MB per bulan pada 100 pemesanan.
- **Layar unggah menyarankan menutup saldo** sebelum memotret.
- Batas ukuran dan jenis berkas ditegakkan di bucket, bukan hanya di peramban.

### P4 — Bukti disimpan sampai dihapus manual

Keputusan pemilik repo. Retensi otomatis (mis. 90 hari) ditawarkan dan ditolak.

Konsekuensinya dipikul terbuka: **tanpa alat, "hapus manual" pada praktiknya berarti "tidak
pernah"**, dan yang menumpuk adalah data rekening orang. Karena itu dua hal WAJIB ada, dan bukan
sebagai tambahan opsional:

- tombol **hapus bukti** per baris di panel admin;
- saringan **"lunas lebih dari 90 hari"** di daftar pembayaran, supaya yang layak dibersihkan bisa
  ditemukan tanpa menelusuri satu per satu.

Menghapus bukti **tidak** menghapus jejak: siapa memverifikasi dan kapan tetap tersimpan di tabel
jejak status bayar yang sudah ada.

### P5 — Tenggat 24 jam, lalu batal otomatis — dan skriningnya DIKEMBALIKAN

Keputusan pemilik repo: 24 jam sejak tagihan terbit, lalu pengajuan dibatalkan otomatis.

Nilai enum barunya **`dibatalkan_tenggat`**, bukan menumpang `dibatalkan_klien`. Sebabnya sama
dengan alasan `batal` diganti `dibatalkan_padma` di C1: nilai status adalah **catatan tentang siapa**,
dan klien yang lupa membayar tidak sama dengan klien yang memutuskan membatalkan. Menumpangkannya
membuat setiap laporan dan setiap layar salah menyebut apa yang terjadi.

**Skrining yang menopang pengajuan itu DIKEMBALIKAN** (`screening_id` dilepas menjadi NULL pada
pembatalan karena tenggat). Ini pengecualian yang disengaja atas C1 J3 ("skrining yang menopang
pengajuan yang dibatalkan tidak hidup kembali"): aturan itu ditulis untuk klien yang membatalkan
sendiri — sebuah keputusan. Tenggat yang lewat bukan keputusan; memaksa orang mengulang seluruh
wizard skrining karena telat sehari adalah hukuman yang tidak dimaksudkan siapa pun.

Karena `booking_requests.screening_id` NOT NULL sejak C1-b, kolom itu menjadi **nullable** — dan
gerbangnya berpindah: yang menuntut skrining bukan lagi "kolomnya wajib" melainkan
`guard_booking_skrining` yang sudah ada, ditambah syarat bahwa pengajuan berstatus antrean wajib
punya skrining. Indeks unik `booking_requests(screening_id)` menjadi **parsial**
(`where screening_id is not null`) supaya skrining yang dilepas benar-benar bebas dipakai lagi.

### P6 — Batal otomatis: cron HARIAN plus evaluasi saat dibaca

Dua lapis, karena satu lapis saja gagal diam-diam:

1. **Rute cron** yang menjalankan satu fungsi Postgres pembatal. Repo sudah memakai penjadwal untuk
   backup, jadi ini bukan infrastruktur baru.
2. **Evaluasi saat dibaca** — antrean admin dan Passport memperlakukan pengajuan yang tenggatnya
   lewat sebagai sudah batal, bahkan sebelum cron menyentuhnya.

Lapis kedua bukan kemewahan: cron yang mati membuat tenggat berhenti berlaku tanpa satu pun galat,
dan bentuk kegagalannya adalah bidan yang tertahan pada pemesanan yang seharusnya sudah bebas.

### P7 — Pemberitahuan DUA kanal dulu; email menyusul

Spec C1 menyebut tiga kanal. Dikerjakan sekarang **dua**:

- **WhatsApp siap-kirim** — admin menekan tombol, pesan lengkap dengan nama, layanan, tanggal, jam,
  total, dan batas waktu tersalin siap tempel. Pola yang sudah ada persis: pesan sambutan aktivasi
  di `lib/auth/pesan-undangan.ts`.
- **Keadaan di Passport** — kartu tagihan dengan sisa waktu, tombol unggah bukti, dan kalimat yang
  menyebut apa yang terjadi bila lewat.

**Email otomatis DITUNDA** ke bagiannya sendiri. Repo ini hanya bisa mengirim email lewat GoTrue
(konfirmasi akun); mengirim "tagihan Anda terbit" menuntut penyedia terpisah — satu dependensi baru,
satu secret baru, dan satu jalur kegagalan baru yang harus dijaga. Menundanya bukan melupakannya:
ia ditulis di sini supaya tidak hilang.

---

## Di luar ruang lingkup C2

- **Payment gateway** — ditolak untuk sekarang (keputusan klien, tercatat di spec C1). Pembayaran
  tetap manual: QRIS lalu diverifikasi admin.
- **Email otomatis** — lihat P7.
- **Pembatalan berjenjang waktu, jadwal ulang, kredit layanan** — C3. Kebijakannya sudah tersalin
  utuh di `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md`; **baca dari sana, jangan
  meringkas dari ingatan.**
- **Pengembalian dana** — bagian dari C3, karena ia hanya masuk akal bersama kebijakan pembatalan.
- **Paket bundling** — tetap di balik saklar `PAKET_TAMPIL`; utang terbuka menunggu klien.

---

## Konsekuensi yang sudah diketahui

- **`screening_id` menjadi nullable** menyentuh gerbang C1-b, indeks uniknya, dan uji yang
  mengasersikan kolom itu wajib. Perubahan ini yang paling mudah salah, karena melonggarkan kolom
  adalah cara paling mudah membuka kembali lubang yang baru saja ditutup.
- **Rantai status bertambah satu keadaan** — setiap layar yang membaca status permintaan ikut
  tersentuh. Pelajaran C1-a berlaku: pusatkan di `lib/jadwal/status.ts`, jangan sebar.
- **`/admin/bayar` sekarang punya dua sumber**: tagihan sesi (yang sudah ada) dan tagihan pengajuan
  (baru). Keduanya tidak boleh dilebur menjadi satu daftar tanpa penanda — admin harus tahu mana
  yang menahan jadwal dan mana yang tidak.
- **Bucket bukti bayar** menambah satu permukaan penyimpanan yang wajib tertutup total dari peran
  API, dan satu rute bertanda untuk membacanya.

---

## Pengujian

Mengikuti disiplin yang sudah berlaku, tanpa perkakas baru.

- **Perpindahan status** — setiap panah baru diuji sah, setiap lompatan ditolak DB, termasuk yang
  ditembak langsung lewat SQL.
- **Tagihan tidak pernah menyimpan nominal** — money firewall struktural tetap hijau, dan satu uji
  menyebut tabel pengajuan eksplisit.
- **Tagihan dihitung dengan tarif pada TANGGAL SESI** — menaikkan tarif sesudah tagihan terbit tidak
  menggeser angkanya.
- **Bukti bayar** — bucket tertutup untuk `anon` dan `authenticated`; hanya rute bertanda yang bisa
  menukar path menjadi byte; klien lain mendapat nol.
- **Tenggat** — pengajuan yang lewat tenggat diperlakukan batal walau cron belum berjalan; cron yang
  berjalan dua kali tidak membatalkan apa pun dua kali.
- **Skrining dikembalikan pada batal-tenggat, TIDAK dikembalikan pada batal-klien** — dua uji
  berdampingan, karena inilah pembedaan yang paling mudah hilang saat kode dirapikan.
- **E2E** — corong penuh diperluas: pesan → tagihan terbit → unggah bukti → admin verifikasi →
  jadwal terkunci.
