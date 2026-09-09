# Sertifikat kunjungan — desain

Tanggal: 10 September 2026
Status: menunggu persetujuan pemilik repo

## Masalah

Badge "Pencapaian" di beranda passport hari ini adalah gambar mati. Ia terbit
begitu satu layanan pernah dijalani sampai selesai, lalu berhenti di situ: tidak
menyebut berapa kali klien datang, dan tidak menuju ke mana-mana.

Yang diminta:

1. Badge memuat **angka** jumlah kunjungan layanan itu.
2. Badge bisa **diketuk**, menuju sertifikat yang diunggah admin.
3. Halaman Materi klien bertambah **satu jenis** — sertifikat.
4. Admin bisa **mengunggah sertifikat** dari halaman detail sesi yang sudah
   selesai.

## Keputusan yang sudah diambil

Empat pertanyaan dijawab pemilik repo sebelum desain ini ditulis:

| Pertanyaan | Keputusan |
|---|---|
| Tempat menyimpan sertifikat | Tabel `certificates` sendiri, bukan nilai baru pada enum `material_type` |
| Tujuan ketukan badge | Sertifikat **terbaru** untuk layanan itu; halaman tetap terbuka meski belum ada |
| Kapan angka muncul di badge | Mulai kunjungan **ke-2** (×2, ×3, ×5…) |
| Format berkas | PDF, JPEG, atau WEBP; maksimal 5 MB |

Alasan tabel sendiri, karena inilah keputusan yang paling mahal untuk dibalik:
`materials` adalah data KATALOG — satu baris dipakai semua klien, dan haknya
diatur penugasan. Sertifikat adalah data MILIK SATU ORANG. Menempatkannya di
`materials` berarti setiap sertifikat menunggu satu penugasan yang benar, dan
satu salah-tugas membuat sertifikat klien A terbaca klien B. Tabel sendiri
membuat kepemilikannya menjadi kolom, bukan kebiasaan.

## Bentuk data

### Tabel `certificates`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid pk | |
| `session_id` | uuid unik, FK `sessions` | SATU sesi = paling banyak satu sertifikat |
| `client_id` | uuid, FK `clients` | Disalin dari sesinya saat dibuat |
| `service_id` | uuid, FK `services` | Disalin dari sesinya; dipakai badge mencari sertifikat layanan |
| `objek` | text | Nama objek di bucket `sertifikat` |
| `mime` | text | Ditulis server dari hasil unggah, bukan dari browser |
| `diunggah_oleh` | uuid, FK `auth.users` | Jejak staf |
| `created_at` | timestamptz | |

`client_id` dan `service_id` **disalin**, tidak dibaca lewat join saat
menampilkan. Sesi bisa dipindahkan ke layanan lain oleh admin, dan sertifikat
yang sudah dicetak atas nama satu layanan tidak boleh ikut berpindah nama.
Penyalinannya dilakukan **trigger**, bukan kode aplikasi: kolom yang boleh diisi
pengirim adalah kolom yang bisa dibohongi.

`session_id` **unik**. Unggahan kedua untuk sesi yang sama adalah PENGGANTIAN
(hapus objek lama, tulis baris baru) — bukan baris kedua yang membuat "sertifikat
terbaru" menjadi pertanyaan tanpa jawaban pasti.

### RLS

- `klien baca miliknya`: `select` bila `client_id` = klien milik `auth.uid()`.
  Pola dan ekspresinya menyalin policy `session_ratings`.
- `staf kelola`: `all` untuk peran admin/owner lewat `user_role()`.
- Klien **tidak punya** policy insert/update/delete. Sertifikat bukan sesuatu
  yang diterbitkan sendiri oleh penerimanya.

### Bucket `sertifikat`

Privat, `file_size_limit` 5 MB, `allowed_mime_types`
`['application/pdf','image/jpeg','image/webp']`, dan — mengikuti bucket
`materi-halaman` dan `bukti-bayar` — **tanpa satu pun policy di
`storage.objects`**. Tidak ada peran API yang bisa menukar path menjadi byte;
satu-satunya pintu adalah route handler kita, sesudah RLS memutuskan hak.

Nama objek ditentukan **server**: `<client_id>/<session_id>.<ext>`. Browser yang
memilih path adalah browser yang bisa menimpa sertifikat klien lain.

## Alur

### Admin mengunggah (halaman detail sesi)

Muncul hanya untuk sesi berstatus `selesai` — sertifikat kunjungan yang belum
terjadi adalah pernyataan yang tidak benar.

1. Admin memilih berkas di `/admin/sesi/[id]`.
2. Server action `terbitkanUrlUnggahSertifikat(sessionId)` — `requireRole(["admin","owner"])`,
   memeriksa sesi ada & `selesai` lewat SESI PENGGUNA (RLS staf yang memutuskan),
   lalu menerbitkan signed upload URL. Pola dan alasannya sama dengan
   `terbitkanUrlUnggahHalaman()`: berkas tidak menumpang server kita, karena
   Vercel membatasi body request 4,5 MB.
3. Browser mengunggah langsung ke Storage.
4. Server action `catatSertifikat(sessionId, objek, mime)` menulis barisnya.
   Bila sesi itu sudah punya sertifikat: objek lama dihapus, barisnya di-`update`.

### Klien membaca

Rute `GET /api/sertifikat/[sesi]` — kembaran `/api/bukti/[permintaan]`, dengan
satu perbedaan yang disengaja: penjaganya bukan `requireRole`, melainkan
kepemilikan. Baris dibaca lewat **sesi pengguna** sehingga policy RLS yang
menjawab; sertifikat milik orang lain memulangkan nol baris, dan rute menjawab
404 — bentuk yang sama dengan sertifikat yang memang belum ada, supaya rute ini
tidak bisa dipakai menghitung sertifikat orang lain.

Respons ber-`cache-control: private, no-store`.

## Layar

### Badge di beranda

`badgeDari()` kini memulangkan `{ serviceId, nama, jumlah }`. Angka tampil
sebagai lencana kecil di sudut bulatan badge **hanya bila `jumlah > 1`**.

Badge menjadi `<Link>` ke `/passport/sertifikat/[serviceId]` — SELALU, termasuk
saat sertifikatnya belum terbit. Badge yang kadang bisa diketuk dan kadang tidak
memaksa klien menebak aturannya.

### `/passport/sertifikat/[serviceId]` (baru)

Mencari sesi `selesai` TERBARU milik klien untuk layanan itu yang punya
sertifikat. Dua keadaan:

- **Ada**: judul layanan, tanggal kunjungan, penampil (`<img>` untuk gambar,
  `<embed>`/tautan unduh untuk PDF), dan tombol unduh.
- **Belum ada**: halaman tetap terbit dan berkata sertifikat diterbitkan tim
  PADMA setelah kunjungan; disebutkan berapa kali klien sudah menjalani layanan
  itu, supaya halamannya tetap membawa kabar tentang dirinya.

### Halaman Materi

Sertifikat tampil sebagai **jenis kartu ketiga** di samping e-book dan video,
dengan lambang dan label sendiri, di bagian terpisah bertajuk "Sertifikat" —
karena sumbernya memang berbeda: e-book dan video datang dari katalog, sertifikat
datang dari kunjungan klien sendiri. Kartunya menuju halaman sertifikat di atas.

Bagian ini **tidak muncul** bila klien belum punya satu pun sertifikat.

## Yang TIDAK dikerjakan

- Menerbitkan sertifikat otomatis pada kunjungan ke-5. Angka pada badge adalah
  hitungan, bukan gerbang; kapan sertifikat pantas terbit adalah keputusan klinik,
  dan belum ada aturannya dari klien.
- Membuat sertifikat sendiri (render PDF dari template). Admin mengunggah berkas
  jadi.
- Menghapus sertifikat oleh klien.

## Uji

Mengikuti mode cepat yang berlaku di sesi ini, uji baru dibatasi pada yang
menjaga **hak baca**, karena itu satu-satunya bagian yang salahnya tidak terlihat
mata:

1. Klien A tidak bisa `select` baris sertifikat klien B (RLS, lewat sesi
   pengguna sungguhan).
2. `GET /api/sertifikat/[sesi]` milik klien lain menjawab 404, bukan berkas.
3. `certificates` tanpa policy tulis bagi klien: `insert` oleh klien tetap nol
   baris.

Sisanya — angka badge, kartu materi, tampilan halaman — diverifikasi manual.
Yang menjadi buta karenanya: bentuk tampilan badge dan kartu materi baru.
