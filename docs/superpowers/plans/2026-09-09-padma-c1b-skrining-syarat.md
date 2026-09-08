# PADMA C1-b — Skrining sebagai Syarat Setiap Pemesanan

> **Untuk pekerja agentik:** rencana ini RINGKAS atas permintaan pemilik repo — keputusan dan
> jebakan ditulis lengkap, kode rutin tidak. Yang tidak boleh diringkas: alasan di balik keputusan,
> dan daftar hal yang WAJIB diuji.

**Tujuan:** Menyambungkan dua ujung yang sekarang menganga — corong skrining di landing yang
berakhir di WhatsApp, dan pemesanan yang tidak pernah menuntut skrining sama sekali.

**Spec:** `docs/superpowers/specs/2026-09-08-padma-c1-fondasi-jadwal-design.md`, keputusan
**J3, J4, J5, J6, J9, J11**. (J1/J2/J7/J8/J13 sudah mendarat di C1-a, merge `2ac03b8`.)

**Cabang:** `c1b-skrining`, dari `main` `2ac03b8`.

---

## Global Constraints

Sama seperti C1-a, ditambah satu yang baru dan satu yang dicabut.

1. **JANGAN `npm run test:e2e:video` atau `test:e2e:semua`** — menyentuh bucket R2 produksi klien.
2. **JANGAN `supabase db push` ke produksi.** Migrasi masuk repo saja.
3. **Basis data lokal dipakai bersama sesi lain.** Umumkan sebelum `db reset`. Resep yang bekerja:
   `npx supabase db reset` → `docker start` container mati → `docker restart supabase_auth_web`.
   `npm run db:recover` RUSAK di mesin ini.
4. **DICABUT: kehati-hatian data produksi.** Aplikasi belum rilis (keputusan pemilik repo 8 Sep).
   Kolom wajib langsung `not null`; tidak ada backfill "demi keamanan"; tidak ada catatan yang
   menyuruh manusia membenarkan data sesudahnya. `db reset` menjalankan migrasi SEBELUM `seed.sql`,
   jadi tabel operasional kosong saat migrasi berjalan.
5. **BARU — data kesehatan.** `screenings.jawaban` memuat jawaban kesehatan. Setiap keputusan di
   rencana ini dinilai dengan satu pertanyaan: *bisakah ini membuat jawaban kesehatan orang lain
   muncul di Passport seseorang?* Bila jawabannya "mungkin", rancangannya salah.
6. `requireRole()` di DALAM setiap server action. Rute API publik memakai service role dan
   memvalidasi sendiri.
7. Jangan impor modul ber-service-role / `node:crypto` ke komponen `"use client"`.
8. Prop bernilai FUNGSI tidak boleh menyeberang dari berkas server ke komponen `"use client"` —
   dijaga `tests/pagar-batas-server-klien.test.ts`.
9. `tests/status-satu-sumber.test.ts` melarang literal status yang berganti nama di luar
   `lib/jadwal/status.ts`.
10. `tests/inventaris-rute.test.ts` menuntut setiap rute baru terdaftar di tabel README.
11. `next build` ikut men-typecheck `tests/` — fixture yang kehilangan medan baru menggagalkan build
    meski `npm test` hijau.

---

## Keputusan rancangan

### K1 — Token klaim tinggal di TABEL TERPISAH, bukan kolom `screenings`

Mengikuti `client_invites` apa adanya, dan bukan karena kerapian: migration
`20260828220000_undangan_penautan_klien` sudah **membuktikan di Postgres lokal** bahwa
`revoke select (kolom)` menuntut pencabutan SELECT tingkat tabel lebih dulu, dan begitu itu
dilakukan `select *` gagal `42501` untuk SEMUA peran — termasuk admin dan test. Rahasia karena itu
pindah ke tabelnya sendiri yang `anon` dan `authenticated` tidak punya hak apa pun atasnya.

Tabel: `screening_claims(screening_id pk → screenings, token_hash text unique, expires_at,
created_at, used_at, used_by)` + CHECK `(used_at is null) = (token_hash is not null)`.

**Umur token 2 jam** (spec J4). Tanpa batas itu, satu HP di ruang tunggu membuat orang kedua yang
mendaftar mewarisi skrining orang pertama lengkap dengan jawaban kesehatannya.

### K2 — Kode skrining TIDAK PERNAH menjadi kunci

`src/lib/skrining/kode.ts` sengaja membuat kode yang mudah dibacakan lewat telepon: prefiks semenit
+ sufiks 4 karakter, ~1 juta kemungkinan per menit. Itu tiket layanan pelanggan, bukan kredensial.
Menjadikannya kunci berarti orang bisa menebak kode orang lain lalu menyedot jawaban kesehatannya.

### K3 — Klien BOLEH BACA skrining miliknya, TIDAK BOLEH menulis

Policy SELECT baru: `client_id in (select id from clients where user_id = auth.uid())`. Passport
perlu tahu apakah ada skrining hijau yang belum terpakai.

TIDAK ada policy INSERT untuk klien. Skrining dari Passport ditulis rute terautentikasi ber-service
role, sama seperti rute publik — supaya `hasil`, `flags`, dan `kode` tetap ditentukan server dan
tidak pernah dikirim peramban. Bila peramban boleh mengirim `hasil`, seluruh gerbang runtuh menjadi
satu baris JSON.

### K4 — Pembatas laju: ember terpisah berkunci `client_id`

`lib/skrining/pembatas.ts` dirancang untuk corong anonim: 5/menit per IP dan **30/menit untuk
seluruh aplikasi**. Langit-langit global itu masuk akal ketika skrining peristiwa sekali seumur
corong; ia TIDAK masuk akal begitu skrining menjadi langkah wajib setiap pemesanan — 30 pemesanan
per menit di seluruh Indonesia adalah batas yang akan menabrak klinik yang sedang ramai.

Rute terautentikasi karena itu memakai ember terpisah berkunci `client_id` (identitas yang sudah
terbukti, bukan header kiriman peramban). Ember anonim TIDAK disentuh.

### K5 — Gerbang tiga lapis untuk `screening_id`

1. **Layar** — tanpa skrining hijau yang belum terpakai, `/passport/ajukan` menampilkan ajakan
   skrining, bukan formulir.
2. **Server action** `ajukanJadwal` menolak dengan kalimat yang bisa dibaca manusia.
3. **Basis data** — `guard_booking_skrining` menolak baris dari klien tanpa skrining hijau MILIKNYA
   yang belum terpakai, plus indeks unik `booking_requests(screening_id)`.

Lapis ketiga bukan hiasan: klien memegang policy INSERT dan bisa memanggil PostgREST langsung.
**Ini pelajaran C1-a yang tidak boleh diulang** — di sana gerbang jam saya taruh hanya di server
action, dan review menemukannya bisa dilewati satu panggilan API.

### K6 — Klaim menulis `client_id` DAN `phase_id`, tidak menyentuh nama/HP

Nama dan no. HP pada skrining **tidak** menimpa data akun (spec J4): keduanya diisi anonim dan bisa
saja milik orang yang menuliskannya, bukan pemilik akun. Yang berpindah hanya `client_id`, dan
`phase_id` bila masih kosong (J11).

Keempat fase pada skrining (`prekonsepsi`, `kehamilan`, `nifas`, `menopause`) memang id `phases`
yang sah — `newborn` sengaja tidak diskrining karena yang diskrining ibunya.

### K7 — Klaim berhasil MENYEBUT NAMA secara terbuka

"Skrining atas nama **X** telah disambungkan." Lapis kedua di belakang umur token: salah sambung
jadi TERLIHAT, bukan tersembunyi. Ini satu-satunya pertahanan terhadap perangkat bersama yang tidak
bergantung pada waktu.

### K8 — Skrining merah boleh diulang tanpa jeda (J9)

Tidak ada kode yang perlu ditulis; yang perlu dipastikan adalah tidak ada yang MENGHALANGI.
Menahannya menghukum orang yang salah pencet, sementara siapa pun yang berniat mengulang sampai
hijau toh bisa membuka jendela penyamaran. Yang menjaga adalah jejak: tiap hasil merah tersimpan
sebagai baris tersendiri dan muncul di inbox admin.

**Wajib menghasilkan uji yang bisa merah**, bukan kesunyian — pelajaran J13 di C1-a.

---

## Tugas

Tiap tugas: uji dulu, jalankan sampai merah, implementasi, hijau, commit.

### T1 — Skema & gerbang basis data
`screening_claims`, `booking_requests.screening_id NOT NULL` + indeks unik, `guard_booking_skrining`,
policy SELECT klien atas `screenings`.
**Wajib diuji:** klien tanpa skrining hijau ditolak DB (ditembak langsung, pola
`money-firewall-struktural`); skrining milik orang lain ditolak; skrining MERAH ditolak; skrining
yang sudah dipakai pengajuan lain ditolak; klien membaca skriningnya sendiri dan mendapat NOL baris
milik orang lain; klien tidak punya hak INSERT; `screening_claims` tidak terbaca peran API mana pun.

### T2 — `lib/skrining/klaim.ts` + `tests/helpers/skrining.ts`
Token 32 byte CSPRNG, hash SHA-256, klaim atomik (`is("used_at", null)`), TTL 2 jam.
Helper uji menerbitkan skrining hijau untuk klien uji — dipakai ~18 titik insert yang akan merah.
**Wajib diuji:** token kedaluwarsa ditolak; sekali pakai; tidak bisa diklaim dua akun (dua panggilan
bersamaan → satu pemenang); nama akun TIDAK tertimpa; `phase_id` terisi hanya bila kosong.

### T3 — Rute publik menitipkan cookie + layar hasil hijau (J4, J5)
`POST /api/skrining` menerbitkan token klaim dan menitipkannya di cookie `httpOnly`.
Layar hasil: hijau → "Buat akun & pesan layanan" (`/daftar`) + tautan kecil ke `/masuk`; merah tetap
WhatsApp, tanpa perubahan.

### T4 — Klaim saat akun berdiri, plus sapaan bernama (J4, J11, K7)
Disisipkan di jalur yang sudah ada (`pastikan-klien` / `setelah-masuk`). Passport menampilkan
"Skrining atas nama X telah disambungkan".
**Wajib diuji:** cookie kedaluwarsa tidak menyambungkan apa pun; klaim gagal tidak pernah menggagalkan
pendaftaran (corong tidak boleh mati).

### T5 — `/passport/skrining` + rute terautentikasi + ember pembatas (J6)
Memakai ULANG komponen wizard yang ada. Rute `POST /api/skrining/akun` menulis dengan service role,
`client_id` terisi sejak awal. Ember pembatas berkunci `client_id`.
**Wajib diuji:** menghabiskan jatah satu klien tidak memengaruhi klien lain MAUPUN corong publik.
**README wajib diperbarui** — `tests/inventaris-rute.test.ts` menjaganya dua arah.

### T6 — Gerbang di `ajukanJadwal` + layar `/passport/ajukan` (J3, K5)
Tanpa skrining hijau: ajakan skrining, bukan formulir. Sapuan ~18 titik insert uji memakai helper T2.

### T7 — J9 sebagai pagar yang bisa merah
Uji: dua skrining merah berturut-turut untuk orang yang sama diterima; keduanya muncul sebagai baris
terpisah di inbox admin.

### T8 — E2E corong penuh + README
`tests/e2e/funnel-skrining.e2e.ts` ditulis ulang: skrining → daftar → pilih jam → admin cari bidan →
tetapkan → konfirmasi → sesi selesai. Skrip E2E lain dijalankan ulang satu per satu.

### T9 — Verifikasi & catatan tindak lanjut
`npm test`, `npm run lint`, `npm run build`, delapan skrip E2E. Catatan tindak lanjut memuat bukti
sungguhan, keputusan yang diambil di jalan, dan utang yang ditinggalkan.

---

## Di luar lingkup C1-b

- **J10 rating** dan **J12 QRIS** — C1-c.
- **`menunggu_bayar`, pencocokan uang masuk, notifikasi tiga kanal** — C2.
- **Pembatalan berjenjang waktu, jadwal ulang, kredit layanan** — C3.
- **Paket bundling** — utang terbuka menunggu klien; tetap di balik `PAKET_TAMPIL`.
