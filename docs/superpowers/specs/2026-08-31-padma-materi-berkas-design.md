# PADMA — Materi Berbasis Berkas (PDF & Video) — Design Doc

**Tanggal:** 31 Agustus 2026
**Status:** disepakati, menunggu rencana implementasi
**Merevisi:** keputusan #13 pada `2026-08-26-padma-v1-design.md`

## 1. Konteks

Keputusan #13 di design doc v1 berbunyi, apa adanya:

> E-book disimpan per-bab di database dan dirender in-app (**bukan file PDF**); video via embed terkunci domain (Vimeo) atau playback token berumur pendek (Cloudflare Stream), bukan YouTube unlisted.

Alasannya sah dan masih berlaku: bab teks di database berarti **tidak ada satu berkas pun yang bisa disebar**. Tetapi keputusan itu memindahkan seluruh biayanya ke operator — dan operator PADMA adalah orang awam. Menuntutnya memindahkan satu ebook utuh ke panel admin bab demi bab bukan beban kecil; itu pekerjaan yang secara realistis tidak akan pernah selesai, sehingga fitur materi praktis mati di tangan client.

Bentuk bahan yang benar-benar dimiliki client adalah **PDF** dan **berkas video**. Design ini menerima kenyataan itu, lalu memindahkan bebannya dari operator ke sistem: bahan masuk dalam bentuk aslinya, dan sistemlah yang mengubahnya menjadi sesuatu yang tidak bisa disebar utuh.

Keputusan #13 karena itu direvisi, **bukan dibatalkan**. Syarat intinya tidak bergeser satu pun: tidak ada unduhan, hanya bisa diakses di dalam aplikasi, dan setiap tampilan membawa identitas pembacanya.

## 2. Batas Kejujuran — Apa yang Bisa dan Tidak Bisa Dijamin

Bagian ini didahulukan karena seluruh design di bawah bergantung padanya, dan karena satu-satunya cara design ini gagal secara memalukan adalah bila ia dijual melebihi kemampuannya.

**Tidak mungkin dicapai oleh siapa pun, di platform mana pun.** Apa pun yang bisa dilihat pasien, bytenya sudah berada di perangkat pasien. Tangkapan layar dan rekam layar tidak bisa dicegah. Tidak ada rekayasa yang mengubah ini; klaim sebaliknya dari vendor mana pun adalah klaim palsu.

**Yang benar-benar dijamin design ini:**

1. Tidak ada satu berkas pun — PDF maupun MP4 — yang bisa diperoleh pasien lewat jalur normal maupun lewat DevTools. Tidak ada URL yang bisa ditempel ke orang lain.
2. Merebut isi ebook menuntut menyimpan halaman satu per satu secara manual, bukan satu klik.
3. Setiap halaman ebook yang tersebar **membawa nama dan PADMA ID akun yang membukanya**, dibakar ke dalam gambarnya — bukan lapisan CSS yang hilang saat disimpan. Kebocoran ebook karena itu bisa dilacak ke akun sumbernya.
4. PDF asli tidak pernah ada di server PADMA, sehingga tidak ada yang bisa bocor dari sana.

**Batas yang diterima secara sadar:**

- **Video hanya dilindungi terhadap pasien yang penasaran, bukan terhadap pasien yang punya alatnya.** Ini batas terbesar di seluruh design ini dan tidak boleh dihaluskan. Video disimpan sebagai satu berkas utuh di Cloudflare R2 dan disajikan lewat presigned URL berumur pendek. Klik kanan, tekan lama, tombol unduh pemutar, view-source, dan panel Elements semuanya ditutup (§7) — tetapi **satu ekstensi pengunduh video mengalahkan semuanya tanpa keahlian apa pun.** Menghalangi ekstensi menuntut video tersegmentasi atau DRM, yang justru dilepas saat memilih penyimpanan objek. **Jaminan "tidak ada berkas utuh yang bisa disalin" berlaku untuk ebook, TIDAK untuk video.**
- **Kebocoran video tidak bisa dilacak.** Membakar watermark per-pasien ke video berarti meng-encode ulang seluruh video untuk setiap pasien — tidak proporsional untuk satu klinik. Video memakai lapisan watermark di layar, yang hilang begitu videonya diunduh atau layarnya direkam.
- **Video tidak ditranskode, sehingga tidak ada kualitas adaptif.** Pasien di koneksi lambat menerima berkas dengan kualitas yang sama seperti pasien di koneksi cepat, dan akan tersendat. Ini konsekuensi langsung dari memilih penyimpanan objek alih-alih layanan streaming.
- **Halaman ebook adalah gambar, bukan teks.** Teksnya tidak bisa disalin, tidak bisa dicari, dan **tidak terbaca pembaca layar**. Ini kerugian aksesibilitas yang nyata, dan ia adalah konsekuensi langsung dari syarat "tidak boleh ada teks yang bisa disebar utuh" — dua hal itu tidak bisa dimiliki sekaligus. Judul dan deskripsi materi tetap berupa teks sungguhan.
- **Resolusi terkunci saat unggah.** Karena PDF asli tidak disimpan, merender ulang ke resolusi lebih tinggi menuntut admin mengunggah ulang.

## 3. Keputusan yang Disepakati

| # | Topik | Keputusan |
|---|---|---|
| M1 | Bentuk ebook | **PDF**, dirasterisasi menjadi gambar per halaman. Bab teks (`material_chapters`) dihapus seluruhnya |
| M2 | Tempat rasterisasi | **Browser admin** lewat PDF.js. Menghindari binary native (pdfium/poppler) yang merepotkan di Vercel serverless |
| M3 | PDF asli | **Tidak disimpan sama sekali.** Berkas yang paling tidak boleh bocor sebaiknya tidak pernah ada di server kita |
| M4 | Watermark ebook | **Dibakar per-pasien** ke dalam gambar halaman saat disajikan. Bukan lapisan CSS — lapisan CSS hilang saat gambar disimpan, sehingga kebocoran jadi tidak terlacak |
| M5 | Bentuk video | Diunggah admin dari panel PADMA, disimpan sebagai berkas di **Cloudflare R2** (bucket privat), disajikan lewat **presigned URL berumur pendek**. Bukan layanan streaming — lihat alasan & konsekuensinya di bawah tabel |
| M6 | Watermark video | Hanya lapisan di layar, dan ia hilang bila videonya diunduh. Lihat batas yang diterima di §2 |
| M7 | Jalur berkas besar | Unggahan **tidak menumpang server kita** — langsung dari browser admin ke Supabase Storage (gambar halaman) dan ke Cloudflare (video). Batas body request Vercel 4,5 MB |
| M8 | Materi terbuka | **Otomatis** bila ada sesi `selesai` pada salah satu layanan materi itu, **atau** di-assign eksplisit ke klien tersebut. Satu policy dengan OR |
| M9 | Materi ↔ Layanan | **Banyak-ke-banyak dan opsional.** `materials.service_id` dihapus, diganti `material_services`. Materi boleh lahir tanpa layanan — admin wajar ingin menumpuk bahan dulu |
| M10 | Materi tanpa layanan | Ditandai eksplisit di daftar admin (**"Tanpa layanan · hanya lewat assign"**), dan **tidak tampil** di daftar klien kecuali di-assign |

### Kenapa M8 mempertahankan jalur otomatis

Permintaan awalnya adalah penugasan manual saja. Jalur otomatis dipertahankan karena mode kegagalannya berbeda kelas: admin yang lupa meng-assign tidak menghasilkan error, peringatan, maupun gejala apa pun — hanya pasien yang diam-diam tidak pernah melihat materinya, dan tidak ada seorang pun yang tahu. Jalur otomatis adalah jaring untuk kelalaian itu; penugasan manual di atasnya memberi admin kendali penuh tanpa menghapus jaringnya.

### Kenapa M5 memilih penyimpanan objek, bukan layanan streaming

Pilihan awal design ini adalah Cloudflare **Stream**, yang mentranskode video menjadi HLS tersegmentasi sehingga tidak pernah ada satu berkas utuh yang bisa disalin. Itu satu-satunya cara jaminan "tidak bisa diunduh" bertahan penuh pada video. Biayanya ~$5–10/bulan.

Keputusan diubah ke **R2** secara sadar, dengan model ancaman yang dinyatakan terbuka: **yang perlu dihalangi adalah pasien awam, bukan pasien teknis.** Pasien yang tidak menemukan tombol unduh dan tidak mendapat menu klik-kanan sudah berhenti di situ, dan itu mencakup hampir seluruh pasien klinik. Pasien yang membuka DevTools berada di kategori berbeda dan tidak dianggap sebagai lawan yang harus dikalahkan.

Ganjarannya: R2 praktis gratis di skala PADMA — 10 GB penyimpanan gratis dan egress gratis, sementara video menyumbang ~40 GB egress sebulan yang justru akan mendorong tier Supabase naik bila di-host sendiri di sana.

### Kenapa video disajikan LANGSUNG dari R2, bukan diproksi

Video disajikan langsung: browser pasien mengambil berkasnya dari R2 lewat presigned URL, dan bytenya tidak pernah menyentuh server PADMA.

Alternatifnya adalah memproksi lewat route kita. Perbandingan biayanya perlu ditulis tepat, sebab mudah salah: **egress R2 gratis ke mana pun** — ke browser pasien maupun ke server kita. Memproksi tidak memindahkan biaya dari R2; ia **memunculkan biaya baru di Vercel** yang tadinya nol, yaitu bandwidth Vercel→pasien plus waktu eksekusi fungsi selama menyalurkan video.

Memproksi punya satu keunggulan nyata yang layak disebut: presigned URL bisa ditempel ke orang lain dan langsung bekerja, sementara URL yang diproksi menuntut cookie sesi pasien itu sehingga tidak berguna bagi orang lain.

Keunggulan itu tetap ditolak, dan alasannya bukan biaya semata: pasien yang bisa mengunduh berkasnya juga bisa **mengirim berkasnya**. Mencegah tautan tersebar tidak banyak gunanya bila berkasnya sendiri bisa tersebar. Di bawah model ancaman M5 — yang dihalangi pasien awam, bukan pasien teknis — kedua jalur berakhir di tempat yang sama, jadi yang lebih sederhana dan lebih murah yang menang.

**Kapan keputusan ini layak ditinjau ulang:** bila kelak jaminan video perlu diperkuat, jalan yang benar adalah pindah ke layanan streaming yang memecah video menjadi segmen (Cloudflare Stream / Bunny Stream), **bukan** memproksi R2. Memproksi menambah biaya untuk perlindungan yang hampir tidak bertambah.

**Gambar halaman ebook TIDAK ikut ke R2**, dan alasannya bukan konsistensi yang setengah-setengah. Egress gratis R2 tidak memberi apa pun untuk gambar halaman, sebab bytenya selalu mengalir lewat route kita untuk dibakari watermark — di mana pun ia disimpan, egress-nya adalah storage→server, bukan storage→pasien. Membiarkannya di Supabase Storage juga menjaga satu sifat berharga: **rantai ebook bisa dikerjakan tanpa kredensial pihak ketiga sama sekali.**

### Kenapa M10 mengubah tampilan klien

Klien saat ini melihat kartu **semua** materi termasuk yang terkunci, bertuliskan "Terbuka setelah layanan terkait selesai". Itu penggoda yang disengaja. Untuk materi tanpa layanan, kalimat itu menjadi bohong — tidak ada layanan terkait yang bisa dijalani untuk membukanya. Karena itu:

- Materi **punya ≥1 layanan** → tetap tampil sebagai kartu terkunci. Penggodanya masih benar.
- Materi **tanpa layanan** → hanya tampil bila di-assign ke klien itu.

Efek sampingnya sehat: judul materi yang belum diperuntukkan bagi siapa pun tidak ikut terpampang ke seluruh klien.

## 4. Model Data

### Yang dihapus

- `material_chapters` — seluruh tabel, beserta RPC pengganti hapus-per-baris miliknya, policy-nya, panel penulisan bab di admin, dan reader per-bab di passport.
- `materials.service_id` — kolom `not null` yang mengunci satu materi ke satu layanan.

### Yang lahir

```sql
-- Gambar per halaman ebook. Menyimpan PATH, bukan URL.
create table material_pages (
  material_id uuid not null references materials(id) on delete cascade,
  halaman     int  not null check (halaman >= 1),
  objek       text not null,                     -- kunci objek di bucket
  lebar       int  not null check (lebar  > 0),
  tinggi      int  not null check (tinggi > 0),
  primary key (material_id, halaman)
);

-- Materi ↔ Layanan: banyak-ke-banyak, boleh nol baris.
create table material_services (
  material_id uuid not null references materials(id) on delete cascade,
  service_id  uuid not null references services(id) on delete cascade,
  primary key (material_id, service_id)
);

-- Penugasan eksplisit ke pasien tertentu.
create table material_assignments (
  material_id     uuid not null references materials(id) on delete cascade,
  client_id       uuid not null references clients(id)   on delete cascade,
  ditugaskan_oleh uuid not null references profiles(id),
  ditugaskan_pada timestamptz not null default now(),
  primary key (material_id, client_id)
);
```

`ditugaskan_oleh` mengikuti pola `honor_marks.ditandai_oleh` dan `jejak_status_bayar.aktor_id`: keputusan yang membuka rekam medis atau konten berbayar selalu menyebut siapa pelakunya.

### Yang berubah

```sql
alter table material_videos rename column url to objek;
alter table material_videos add  column mime text not null default 'video/mp4'
  check (mime in ('video/mp4', 'video/webm'));
```

Kolomnya berhenti menjadi URL dan menjadi **kunci objek di bucket R2** — bentuk yang sama dengan `material_pages.objek`, dan dengan alasan yang sama: kunci objek tanpa hak akses bucket tidak berguna bagi siapa pun, sementara URL yang terbaca lewat RLS langsung menjadi tautan siap sebar.

Namanya sengaja `objek`, bukan `stream_uid`. Nama kedua itu menyebut vendor dan teknologi yang tidak lagi dipakai, dan nama yang berbohong tentang isinya adalah bug yang menunggu — kelas kesalahan yang persis sudah terjadi di proyek ini lewat `materials.video_url`.

`mime` disimpan karena tanpa transkode, berkas datang apa adanya: peramban perlu diberi tahu tipenya, dan `check` constraint-nya menjaga agar hanya dua tipe yang benar-benar didukung `<video>` yang bisa masuk.

### Kenapa `material_pages` menyimpan path, bukan URL

Baris `material_pages` **terbaca klien** lewat RLS — ia harus tahu jumlah halaman dan dimensinya untuk menata layar tanpa melompat. Bila yang tersimpan adalah URL bertanda tangan, satu baris yang terbaca langsung menjadi tautan siap sebar.

Ini bukan kekhawatiran teoretis: kelas bug yang persis sama sudah pernah terjadi di proyek ini lewat `materials.video_url`, yang membocorkan URL video layanan yang belum pernah dijalani klien. Path tanpa hak akses bucket tidak berguna bagi siapa pun, dan bucket-nya memang tidak memberi hak apa pun kepada `authenticated`.

### Migrasi data

Setiap baris `materials` yang ada sekarang menghasilkan satu baris `material_services` dari `service_id` lamanya, sebelum kolom itu dihapus. Tidak ada materi yang berubah arti. Isi `material_chapters` **hilang** — itu konsekuensi M1 yang disepakati; konten demo diganti PDF dummy.

## 5. Penyimpanan Berkas

### Bucket

```
materi-halaman   public = false
                 allowed_mime_types = ["image/webp", "image/jpeg"]
                 file_size_limit    = 5MiB   (per objek; satu halaman ~200-400 KB)
```

Objeknya dinamai `{material_id}/{halaman:0>4}.webp`.

Bucket ini privat **dan sengaja tidak diberi policy `storage.objects` untuk peran `authenticated`**. Artinya pasien yang mengetahui path-nya tetap tidak bisa mengambil objeknya; hanya route handler kita, dengan service role, yang bisa. Ini pagar pertama dan yang paling murah.

`storage.file_size_limit` global di `config.toml` **tidak perlu diubah** dari 50 MiB, karena video tidak pernah menyentuh Supabase.

### Video

Byte video tidak pernah masuk Supabase maupun server PADMA. Ia tinggal di bucket R2 privat:

```
padma-materi-video   (R2, privat — TIDAK punya public bucket URL maupun custom domain publik)
                     objek: {material_id}/{acak}.{ext}   (nama acak, bukan nama berkas admin)
                     hanya MIME video/mp4 & video/webm yang diterima
                     maksimum 500 MB per berkas
```

Bucket ini **tidak boleh** diberi akses publik dalam bentuk apa pun. Satu-satunya jalan masuk adalah presigned URL yang diterbitkan server kita.

Yang tersimpan di basis data hanya `material_videos.objek` (kunci objek, bukan URL) dan `mime`.

Nama objeknya **acak, bukan nama berkas yang diunggah admin**. Nama asli sering memuat hal yang tidak perlu ikut tersebar — judul draf, nama orang, nomor revisi — dan nama acak juga menutup kemungkinan menebak objek lain di bucket yang sama.

## 6. Alur Unggah (Panel Admin)

### Ebook (PDF)

1. Admin memilih berkas PDF di formulir materi. Berkas **tidak** dikirim ke server.
2. Browser admin memuat PDF secara lokal dengan PDF.js, lalu merender setiap halaman ke `<canvas>` dengan lebar sasaran **1600 px** (cukup tajam untuk lebar baca passport `max-w-3xl` pada perangkat DPR 2), lalu mengekspornya sebagai WebP kualitas 0,82. Bila `canvas.toBlob("image/webp")` menghasilkan null, jatuh ke JPEG 0,85.
3. Batas yang ditegakkan di browser sebelum apa pun terkirim: **maksimum 300 halaman** dan **PDF maksimum 60 MB**. Melampauinya ditolak dengan pesan yang menyebut angkanya, bukan digantung.
4. Satu server action menerbitkan **N signed upload URL sekaligus**. Path setiap objek ditentukan **server**, tidak pernah dikirim browser — browser yang memilih path berarti browser yang bisa menimpa objek materi lain. Server terlebih dulu menghapus objek lama materi itu.
5. Browser mengunggah gambar-gambar itu langsung ke Supabase Storage, **maksimum 4 unggahan bersamaan**, dengan progress yang terlihat. Empat dipilih agar koneksi rumahan yang lambat tidak kehabisan bandwidth sampai unggahan saling menggagalkan, sementara 300 halaman tetap selesai dalam waktu yang wajar.
6. Setelah **seluruh** unggahan sukses, satu server action memanggil RPC `ganti_halaman_materi(p_material_id, p_halaman jsonb)` yang dalam satu transaksi menghapus baris lama materi itu lalu menyisipkan seluruh baris baru.

Kegagalan di tengah karena itu tidak pernah menghasilkan materi setengah terisi: bila langkah 5 gagal, langkah 6 tidak pernah jalan, dan materinya tampak "belum ada isi" di panel admin. Objek yang sudah terunggah menjadi sampah yang dibersihkan oleh percobaan berikutnya (langkah 4). Ini utang yang diterima sadar, bukan yang terlewat.

**Catatan radius hapus.** Proyek ini pernah kehilangan seluruh bab materi karena satu filter tautologis (`?urutan=gte.0`), dan pelajarannya adalah RPC baris tunggal. `ganti_halaman_materi` menghapus banyak baris sekaligus, tapi radiusnya dibatasi **parameter wajib** `p_material_id`, bukan filter yang bisa dibuat tautologis dari luar. Itu perbedaan yang menentukan, dan test wajib membuktikan bahwa memanggilnya tidak pernah menyentuh materi lain.

### Video

1. Admin memilih berkas video. Browser menolak lebih dulu apa pun yang bukan `video/mp4` atau `video/webm`, atau yang lebih besar dari **500 MB**, dengan pesan yang menyebut angkanya.
2. Browser **memeriksa posisi atom `moov`** pada MP4 dengan membaca struktur box di awal berkas. Bila `moov` berada di akhir (bukan "faststart"), admin **diperingatkan** — bukan diblokir — bahwa video akan lambat mulai diputar karena peramban harus mengunduh seluruh berkas dulu. Karena design ini tidak mentranskode apa pun, ini satu-satunya kesempatan menangkap masalah itu, dan membiarkannya lolos berarti pasien melihat pemutar yang menggantung tanpa sebab yang jelas.
3. Server action `requireRole(["admin","owner"])` menerbitkan **presigned PUT URL** ke R2 untuk objek yang **path-nya ditentukan server**, lalu browser mengunggah berkas langsung ke URL itu. Berkasnya tidak menumpang server kita.
4. Setelah unggahan sukses, satu server action menyimpan nama objek + MIME ke `material_videos`.

Tidak ada tahap pemrosesan asinkron: begitu unggahan selesai, videonya siap ditonton. Ini penyederhanaan nyata dibanding layanan streaming — dan sekaligus alasan tidak ada kualitas adaptif.

**Verifikasi API R2 adalah tugas implementasi pertama rantai video.** R2 memakai API yang kompatibel dengan S3, dan bentuk presigned URL beserta perilaku Range request-nya harus dipastikan terhadap bucket sungguhan sebelum sisanya dibangun. Tanpa kredensial ia tidak bisa diuji, jadi detail di dokumen ini tunduk pada hasil spike itu.

## 7. Alur Baca (Passport Pasien)

### Ebook

Halaman reader mengambil daftar halaman lewat query ber-RLS (`material_pages`), sehingga ia tahu jumlah halaman dan dimensi setiap halaman untuk menata layar tanpa melompat. Ia lalu merender `<img>` per halaman secara lazy, menunjuk route berikut.

`GET /api/materi/[id]/halaman/[n]` — route handler, runtime **Node** (bukan Edge; `sharp` butuh Node):

1. Ambil pengguna. Tidak ada → **404**, bukan 401. Route ini tidak boleh mengonfirmasi bahwa materinya ada.
2. Query `material_pages` untuk `(id, n)` **memakai sesi pengguna itu**, bukan service role. **RLS-lah hakim haknya, bukan `if` di kode kita.** Tidak ada baris → 404.
3. Baru sesudah hak terbukti: service role mengunduh objek pada `objek` dari baris yang diloloskan RLS itu.
4. Bakar watermark identitas pasien ke dalam gambar dengan `sharp`: teks `<nama> · <PADMA ID>` berulang secara diagonal (-24°), opasitas **0,08**, tinggi huruf **1,6% lebar halaman** sehingga terbaca setara di halaman ukuran apa pun. Sudut, opasitas, dan bunyi teksnya sengaja sama dengan komponen `Watermark` yang sudah ada, supaya tampilannya tidak berubah bagi pasien — yang berubah hanya bahwa kini ia ada **di dalam** gambar, bukan di atasnya.
5. Kirim `image/webp` dengan `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.

Urutan langkah 2 dan 3 mengikat: service role menyentuh storage **hanya sesudah** basis data memutuskan.

`private, no-store` juga bukan kehati-hatian berlebihan. Watermark-nya per-pasien; satu header cache yang salah membuat CDN Vercel menyajikan halaman ber-watermark pasien A kepada pasien B. Itu kebocoran rekam identitas, bukan bug tampilan. `s-maxage` **tidak boleh** pernah muncul di route ini, dan test menjaganya.

Deterrent tambahan di layar, yang jujur disebut deterrent: menu klik-kanan dimatikan, gambar tidak bisa di-drag, teks tidak bisa diseleksi.

### Video

Server component **memeriksa hak lewat query ber-RLS ke `material_videos`** — sama seperti route halaman ebook, RLS-lah hakimnya. Hanya sesudah barisnya kembali, ia menerbitkan **presigned GET URL** ke R2 untuk objek pada baris itu, lalu merender `<video>` yang menunjuk URL tersebut, ditumpuk lapisan watermark identitas pasien.

Video disajikan **langsung dari R2 ke pasien**, tidak diproksi. Itu memang yang membuatnya gratis, dan sekaligus yang membuat URL-nya bisa ditemukan lewat DevTools — konsekuensi yang diterima di §2.

**Umur presigned URL: 2 jam.** Kompromi dua arahnya perlu disebut terbuka. Terlalu pendek, URL kedaluwarsa di tengah tontonan dan pemutar berhenti tanpa sebab yang jelas bagi pasien, terutama bila ia mem-pause lama. Terlalu panjang, URL yang tersebar bisa dipakai siapa pun selama sisa umurnya. Dua jam menampung satu sesi menonton berikut jeda, sambil menutup jendelanya dalam hitungan jam, bukan hari. URL diterbitkan ulang setiap kali halaman reader dibuka, jadi pasien yang memuat ulang selalu mendapat yang baru.

**URL tidak boleh ikut ter-render ke HTML.** Elemen `<video>` dirender **tanpa** atribut `src`. URL-nya diambil komponen klien sesudah halaman hidup, lalu dipasang lewat **properti** `video.src`, bukan atribut. Dua akibatnya penting: URL tidak pernah muncul di **view-source** (Ctrl+U), dan karena properti tidak menulis balik ke DOM, ia juga **tidak muncul di panel Elements DevTools**. Ia hanya hidup di memori JS dan di tab Network.

Ini menutup jalur termudah yang tersisa. Merender `<video src="...">` dari server membuat URL bisa ditemukan dengan Ctrl+U lalu Ctrl+F — tiga langkah, tanpa perlu tahu apa itu DevTools.

**Pengerasan pemutar**, yang jujur disebut deterrent dan bukan proteksi:

- `controlsList="nodownload"` menghilangkan tombol unduh dari pemutar bawaan Chrome & Edge.
- `disablePictureInPicture` menutup jalur pintas yang sering dilupakan.
- Menu klik-kanan pada elemen `<video>` dimatikan. Ini yang menutup **"Save Video As…"** di Firefox dan Safari, yang tidak menghormati `controlsList` — tanpa ini, pertahanan terhadap pasien awam justru bocor tepat di dua peramban itu.
- `-webkit-touch-callout: none` menutup menu tekan-lama di peramban seluler, yang di sebagian Android menawarkan "unduh video".

### Tangga usaha: apa yang harus dilakukan seseorang untuk mendapat videonya

Bagian ini ada supaya jaminannya tidak pernah dibaca lebih besar daripada kenyataannya.

| Cara | Berhasil | Keahlian yang dibutuhkan |
|---|---|---|
| Klik kanan / tekan lama | Tidak | — |
| Tombol unduh di pemutar | Tidak | — |
| View-source (Ctrl+U) atau panel Elements | Tidak | — ditutup oleh pemasangan `src` lewat properti |
| **Ekstensi pengunduh video** | **Ya** | **Nol** |
| DevTools → tab Network | Ya | Sedang |
| Rekam layar | Ya | Nol, kualitas turun |

**Baris keempat adalah batas sesungguhnya, dan ia tidak bisa ditutup.** Ekstensi pengunduh membaca elemen media di halaman lalu menawarkan tombol unduh; pasien yang tidak paham teknis sama sekali, tetapi kebetulan sudah memasang ekstensi semacam itu, mendapat videonya dengan satu klik. Memproksi lewat server kita tidak menolong — permintaan ekstensi berasal dari peramban yang sama dan membawa cookie sesi pasien itu.

Satu-satunya hal yang benar-benar menghalangi ekstensi adalah video tersegmentasi (HLS) atau DRM, dan keduanya dilepas saat M5 memilih penyimpanan objek. Jadi kalimat yang benar tentang video adalah: **aman terhadap pasien yang penasaran, tidak aman terhadap pasien yang sudah punya alatnya.**

## 8. Keamanan

Pagar di bawah sebagian besar adalah pelajaran mahal dari proyek ini sendiri, bukan daftar praktik umum.

- **Route handler adalah endpoint POST/GET mandiri.** Layout dan page tidak menjaganya — sudah terbukti di proyek ini dengan mem-POST server action panel admin dari rute lain dan mutasinya berhasil. Auth dan pemeriksaan hak karena itu berada **di dalam** route halaman itu sendiri.
- **Path objek tidak pernah datang dari parameter.** Route menerima `material_id` dan nomor halaman saja; path diambil dari baris yang diloloskan RLS. Menerima path dari luar berarti menerima path traversal dan IDOR sekaligus.
- **Bucket privat tanpa policy untuk `authenticated`.** Path yang bocor tetap tidak bisa ditukar menjadi byte.
- **Tabel baru lahir tanpa RLS, dan `authenticated` mendapat SELECT/INSERT/UPDATE secara default.** Ketiga tabel baru harus mengaktifkan RLS dan mencabut grant default itu secara eksplisit di migrasinya. Ini sudah pernah terlewat di proyek ini.
- **Grant kolom mengikat pada KEHADIRAN kolom di payload, sementara trigger mengikat pada PERUBAHAN NILAI.** Pelajaran ini berlaku di sini: mengamankan `material_assignments.ditugaskan_oleh` dilakukan dengan trigger yang memaksanya `= auth.uid()`, bukan dengan mencabut grant kolom — mencabut grant kolom sudah tiga kali mematahkan `select *` di proyek ini.
- **PostgREST menjawab HTTP 200 + `[]` untuk UPDATE yang ditolak RLS**, bukan error. Setiap action penugasan wajib `.select("id")` dan memeriksa panjangnya.
- **Kunci R2 tidak pernah ber-prefix `NEXT_PUBLIC_`.** Ia bisa membaca dan menghapus seluruh pustaka video; ia hanya hidup di server.
- **Presigned URL adalah tautan unduhan, dan diperlakukan sebagai rahasia berumur pendek.** Ia tidak boleh masuk log, tidak boleh masuk pesan galat yang tampil ke pasien, dan tidak boleh disimpan di basis data. Yang tersimpan hanya kunci objeknya; URL-nya lahir per permintaan dan mati bersama umurnya.
- **Hak video diperiksa lewat RLS sebelum URL diterbitkan.** Presigned URL dibuat service role, jadi ia menembus segala pagar — karena itu ia hanya boleh dibuat sesudah query ber-RLS mengembalikan barisnya. Urutan ini sama mengikatnya dengan urutan pada route halaman ebook.
- **Bucket R2 tidak boleh punya akses publik dalam bentuk apa pun** — bukan public bucket URL, bukan custom domain publik. Satu setelan itu saja akan membuat seluruh pustaka video terbuka untuk siapa pun tanpa satu pun baris kode berubah.
- **Money firewall.** Tidak satu pun kolom baru memuat kata yang dipindai `tests/money-firewall-struktural.test.ts` (`bayar|harga|honor|tarif|biaya|total|nominal|amount|price|fee|rate|cost|payment`). Ini diperiksa, bukan diasumsikan.
- **`material_assignments` tidak boleh dibaca klien sama sekali.** Ia hanya perlu dievaluasi di dalam policy isi materi. Klien tidak butuh tahu alasan materinya terbuka, dan tidak memberi hak baca berarti satu permukaan lebih sedikit.
- **`material_services` boleh dibaca setiap pengguna login**, persis seperti `materials.service_id` yang digantikannya. Tidak ada perluasan keterbukaan di sini — hanya bentuknya yang berubah.

### Bentuk policy isi materi

`material_pages` dan `material_videos` memakai policy klien yang **identik**, satu policy dengan OR:

```
materials.aktif  AND  (
    ada sesi `selesai` milik klien ini pada salah satu service di material_services
 OR ada baris material_assignments untuk materi ini dan klien ini
)
```

Satu policy, satu tempat untuk diaudit. Staf (admin/owner) kelola penuh; `anon` tidak punya hak tabel sama sekali.

Catatan yang tidak boleh hilang: `materials.aktif` **wajib** ikut dievaluasi di dalam policy isi, bukan hanya disaring di query aplikasi. Ini sudah pernah salah di proyek ini — policy yang tidak melihat `aktif` membuat materi yang ditarik admin tetap punya isi yang terbaca lewat REST.

## 9. Tampilan

### Panel admin

- **Daftar materi** — menandai materi tanpa layanan dengan label **"Tanpa layanan · hanya lewat assign"**, dan menandai materi tanpa isi (0 halaman / belum ada objek video) sebagai **"Belum ada isi"**. Keduanya keadaan yang harus terlihat, bukan tersembunyi.
- **Formulir materi** — judul, tipe, deskripsi, **pilihan layanan berganda yang opsional**, dan medan isi sesuai tipe: input PDF untuk ebook, input video untuk video. Formulir tetap satu langkah (metadata + isi bersama), mengikuti alasan yang sudah tercatat di formulir yang ada: materi yang tersimpan tanpa isi terkunci selamanya tanpa satu pun error.
- **Penugasan pasien** — di halaman materi: daftar pasien yang di-assign, plus pencarian untuk menambah. Ditampilkan juga (bacaan saja) pasien yang sudah otomatis berhak lewat layanan, supaya admin tidak meng-assign ulang sesuatu yang sudah terbuka.
- **Halaman layanan** — daftar bacaan "materi yang termasuk layanan ini", supaya konfigurasinya bisa dilihat dari sisi layanan meski dikelola dari sisi materi.

### Passport pasien

- **Daftar materi** — mengikuti M10.
- **Reader ebook** — halaman berurutan, lazy-load, dengan penunjuk "halaman n dari N". Watermark sudah ada di dalam gambar.
- **Reader video** — elemen `<video>` yang dikeraskan (`controlsList="nodownload"`, `disablePictureInPicture`, menu klik-kanan dimatikan) + lapisan watermark identitas.

## 10. Error Handling & Empty State

| Keadaan | Perilaku |
|---|---|
| PDF > 60 MB atau > 300 halaman | Ditolak di browser sebelum apa pun terkirim, dengan pesan yang menyebut angka batasnya |
| PDF gagal dibaca PDF.js (rusak/terenkripsi) | Pesan yang menyebut sebabnya; tidak ada yang tersimpan |
| Unggahan gagal di tengah | Tidak ada baris halaman tercatat; materi berstatus "Belum ada isi" di panel admin. Admin mengulang dari awal |
| Materi tanpa isi dibuka pasien yang berhak | Halaman ramah "isi materi sedang disiapkan", bukan 404 dan bukan reader kosong |
| Berkas video bukan MP4/WebM, atau > 500 MB | Ditolak di browser sebelum apa pun terkirim, dengan pesan yang menyebut batasnya |
| MP4 tanpa faststart (`moov` di akhir) | Admin **diperingatkan**, tidak diblokir: video akan lambat mulai diputar |
| Pasien tidak berhak membuka route halaman | 404, tanpa membedakan "tidak ada" dari "tidak berhak" |
| R2 tidak bisa dihubungi saat menerbitkan presigned URL | Reader menampilkan galat yang bisa dicoba ulang; sisa passport tetap jalan. Pesan galatnya **tidak memuat URL maupun kunci objek** |
| Presigned URL kedaluwarsa di tengah tontonan | Pemutar berhenti; pasien memuat ulang halaman dan mendapat URL baru. Disebut di UI sebagai saran memuat ulang, bukan dibiarkan diam |

## 11. Testing

**Unit / integrasi (Vitest, terhadap Postgres lokal):**

- Watermark: dua pasien berbeda pada halaman yang sama menghasilkan **byte yang berbeda**. Ini bukti bahwa watermark benar-benar dibakar, bukan lapisan CSS.
- Header: route halaman mengirim tepat `private, no-store`, dan **tidak pernah** memuat `s-maxage`.
- Path: route tidak pernah memakai nilai dari input sebagai path objek.
- Gating: klien tanpa sesi `selesai` dan tanpa assignment mendapat **0 baris** `material_pages` lewat REST; sesudah di-assign, mendapat barisnya. Diuji lewat REST, bukan lewat UI.
- `materials.aktif = false` menutup isi lewat REST, sementara baris `materials`-nya tetap terbaca (menghindari kelas bug `partner_publik`).
- RPC `ganti_halaman_materi` tidak pernah menyentuh baris materi lain.
- Aturan tampilan daftar M10: materi tanpa layanan dan tanpa assignment tidak muncul di daftar klien.
- RLS aktif dan grant default `authenticated` tercabut pada ketiga tabel baru.
- Money firewall struktural tetap hijau.

**E2E (Playwright, browser sungguhan):**

Rantai penuh: admin mengunggah PDF kecil yang dibuat oleh test itu sendiri → pasien tanpa hak menerima **404** di route halaman → admin meng-assign → pasien menerima **200** → dua pasien berbeda menerima gambar ber-byte berbeda → **URL storage langsung ke objeknya gagal**.

Video dipisahkan ke skrip tersendiri yang **melewatkan dirinya** bila kredensial R2 tidak ada, supaya suite tetap bisa jalan di mesin tanpa akun Cloudflare. Yang dibuktikannya: pasien tanpa hak **tidak pernah menerima presigned URL** (bukan sekadar tidak melihat pemutar), pasien berhak menerima URL yang benar-benar bisa diputar, dan objek R2 **tidak bisa diambil tanpa tanda tangan**.

Satu test yang wajib ada dan mudah terlupa: **presigned URL tidak boleh muncul di log server maupun di pesan galat.** Ia tautan unduhan; membocorkannya ke log berarti membocorkan videonya ke siapa pun yang bisa membaca log.

## 12. Env & Konfigurasi

Seluruhnya **server-only**; tidak satu pun ber-prefix `NEXT_PUBLIC_`.

| Variabel | Guna |
|---|---|
| `R2_ACCOUNT_ID` | Akun Cloudflare pemilik bucket |
| `R2_BUCKET_VIDEO` | Nama bucket video (privat) |
| `R2_ACCESS_KEY_ID` | Kunci akses S3-compatible |
| `R2_SECRET_ACCESS_KEY` | Rahasia akses S3-compatible |

Kunci R2 di atas bisa membaca **dan menghapus** seluruh pustaka video, jadi ia hanya hidup di server. Bila Cloudflare mengizinkan, terbitkan token yang dilingkup hanya ke bucket ini — bukan token akun penuh.

Dependensi baru: `pdfjs-dist` (browser admin, rasterisasi), `sharp` (server, membakar watermark), dan klien S3 untuk R2 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) — hanya dipakai rantai video.

## 13. Catatan Lingkup untuk Rencana Implementasi

Design ini sengaja menutupi dua rantai yang **saling bebas**, dan keduanya sebaiknya menjadi dua rencana implementasi terpisah:

1. **Rantai ebook PDF** — migrasi model data (termasuk pembongkaran `material_chapters` dan `materials.service_id`), bucket, rasterisasi di browser admin, route halaman ber-watermark, reader pasien, penugasan, dan aturan tampilan M10. Rantai ini **tidak butuh kredensial pihak ketiga mana pun**, jadi ia bisa selesai dan terbukti utuh lebih dulu.
2. **Rantai video R2** — spike API S3-compatible, presigned PUT untuk unggah, presigned GET untuk tonton, pemeriksaan `moov`, pengerasan pemutar. Rantai ini **terhenti tanpa akun Cloudflare + bucket R2**, jadi menaruhnya di rencana yang sama akan membuat seluruh pekerjaan menunggu satu kredensial — walaupun kredensialnya gratis.

Urutannya: rantai 1 lebih dulu. Model data dan penugasan yang dibangun di sana dipakai ulang oleh rantai 2, dan `material_videos` yang ada sekarang tetap berfungsi dengan URL penyedia sampai rantai 2 dikerjakan.

## 14. Di Luar Scope

- Watermark per-pasien yang dibakar ke dalam **video** — butuh encode ulang per pasien.
- **Transkode video & kualitas adaptif (HLS/DASH).** Butuh ffmpeg; konsekuensinya pasien di koneksi lambat tersendat, dan videonya tetap satu berkas utuh. Inilah yang ditukar demi biaya nol di M5. Jalan naiknya dijelaskan di §3: pindah ke layanan streaming, bukan menambal R2.
- **Thumbnail video otomatis.** Layanan streaming menghasilkannya sendiri; penyimpanan objek tidak. Pemutar memakai frame pertama.
- Unggah video multipart untuk berkas > 500 MB.
- Cache gambar ber-watermark per (materi, halaman, pasien). Sengaja tidak dulu; ditambahkan hanya bila pemrosesan gambar terbukti menjadi masalah nyata.
- Lapisan teks ebook untuk pencarian & pembaca layar — ditolak sadar di §2 karena mengembalikan teks yang bisa disebar utuh.
- Merender ulang PDF ke resolusi lain tanpa unggah ulang — konsekuensi M3.
- Assign massal ("assign ke semua pasien yang sudah menjalani layanan X").
- Pustaka materi lintas klinik, versi materi, dan riwayat baca pasien.
