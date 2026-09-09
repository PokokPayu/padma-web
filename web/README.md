# PADMA — Website v1

Homecare promil & perawatan perempuan. Spec: `../docs/superpowers/specs/2026-08-26-padma-v1-design.md`.

## Menjalankan (development)

Prasyarat: Node >= 20, Docker Desktop.

```bash
npm install
npx supabase start          # catat anon key & service_role key
cp .env.example .env.local  # isi tiga nilai Supabase dari keluaran di atas
npx supabase db reset       # migration + seed master data
npm run seed:users          # user demo 3 peran (untuk `npm run dev`; `npm test` seed sendiri)
npm run dev
```

`.env.local` juga punya empat nilai `R2_*` (bucket video privat Cloudflare R2,
lihat spec §12) yang BUKAN dari `supabase start` — isi dari dashboard
Cloudflare bila mengerjakan rantai video. Tanpanya, panel admin & reader video
tetap jalan sampai unggah/tonton video PERTAMA dicoba, lalu gagal dengan
galat yang tercatat di log server (bukan lagi senyap total).

### Bila `npx supabase db reset` gagal

Kegagalan di langkah ini hampir selalu berasal dari **stack Docker lokal**, bukan
dari isi repo — Docker daemon tersendat, tarikan image gagal, atau container
stack tertinggal di keadaan basi sesudah update CLI/Docker. Gejalanya berupa CLI
berhenti dengan `LegacyDbSetupError` (gagal menyiapkan container database) atau
`LegacyRestartServicesError` (gagal merestart storage/auth/realtime/pooler di
akhir reset).

Pemulihannya: bangun ulang stack lokal, lalu reset lagi.

```bash
npm run db:recover   # = npx supabase stop && npx supabase start && npx supabase db reset
```

Padanan manualnya, bila ingin melihat tiap langkah:

```bash
npx supabase stop && npx supabase start
npx supabase db reset
```

Sesudah itu lanjutkan dari `npm run seed:users` seperti biasa. Reset **tidak**
menghapus berkas migration atau `.env.local`, jadi aman diulang.

Akun demo (password semua `padma-dev-123`):
- owner@padma.test → /owner
- admin@padma.test → /admin
- ananda@padma.test → /passport (klien yang sudah diaktifkan)

Klien `Rina Hapsari` sengaja **belum** diaktifkan — ia bahan uji alur penautan.
`npm run seed:users` menjamin dua hal sekaligus untuknya: barisnya belum
bertuan, **dan** tidak ada akun auth yang sudah membuktikan alamat
`rina@padma.test` miliknya (akun sisa dari run test sebelumnya dihapus). Sejak
pendaftaran mandiri hidup, syarat kedua itu bagian dari fixture-nya — tanpa ia,
sebuah akun sisa yang terkonfirmasi akan menautkan barisnya pada login pertama.

**Ada DUA jalur penautan yang sah, dan keduanya menuntut bukti** (spec 8 Sep
2026, K1/K14). Yang tidak pernah cukup, dulu maupun sekarang, adalah email yang
sekadar *cocok* — itulah celah yang pernah membocorkan rekam medis (lihat spec
bagian 7 dan kepala `src/lib/auth/link-client.ts`):

1. **Tautan undangan sekali-pakai.** Di produksi dikirim admin via WhatsApp.
   Untuk dev, `npm run seed:users` mencetak tautannya:

   ```
   http://localhost:3000/aktivasi?token=undangan-dev-rina-...
   ```

   Buka tautan itu, lalu masuk sebagai `rina@padma.test` — barulah `/passport`
   menampilkan datanya.

2. **Email yang sudah terbukti.** Daftar sendiri di `/daftar` dengan email yang
   sama seperti yang terdaftar di PADMA, lalu **buka tautan konfirmasinya**
   (di dev, kotak surat lokal Mailpit: <http://localhost:54324>). Sesudah
   `email_confirmed_at` terisi, baris klien beremail sama ikut tertaut. Jalur
   ini sah **semata-mata** karena `[auth.email] enable_confirmations = true` di
   `supabase/config.toml`; mematikannya menghidupkan celah lama utuh seperti
   semula, dan `tests/konfirmasi-email-wajib.test.ts` memerahkan `npm test`
   bila ia berubah.

Masuk tanpa salah satu dari keduanya tidak membuka data siapa pun: email yang
belum dikonfirmasi berakhir di `/periksa-email`, dan akun yang tidak berhak atas
baris klien mana pun berakhir di `/akun-belum-terhubung`.

## Rute

PADMA v1 lengkap: **38 rute** (30 halaman + 8 route handler), tanpa satu pun
halaman placeholder. Tabel di bawah dijaga `tests/inventaris-rute.test.ts` —
rute baru yang lupa didaftarkan, dan baris yang menyebut rute yang sudah dihapus,
sama-sama membuat `npm test` MERAH.

| Rute | Akses | Isi |
|---|---|---|
| `/` | Publik | Landing: hero, 5 lini layanan (dari DB), cara kerja, teaser passport, pembanding |
| `/skrining` | Publik | Wizard skrining keselamatan; hasil dinilai server, disimpan via `POST /api/skrining` |
| `/masuk` | Publik | Login email+password & Google |
| `/daftar` | Publik | Pendaftaran mandiri: nama, email, WhatsApp, sandi & Google — fase TIDAK ditanyakan, datang dari skrining |
| `/lupa-sandi` | Publik | Kirim tautan pemulihan sandi; balasan SELALU sama entah emailnya terdaftar atau tidak (K6) |
| `/atur-sandi` | Publik (via tautan pemulihan) | Atur kata sandi baru sesudah `/auth/callback`; panjang minimum `PANJANG_SANDI_MIN` |
| `/passport` | Klien | Beranda passport: sampul, grid stempel paket, sesi berikutnya, pencapaian |
| `/passport/sesi` | Klien | Riwayat sesi + catatan & rekomendasi bidan (tertutup sampai diketuk) |
| `/passport/materi` | Klien | Daftar materi panduan; terkunci sampai layanan terkait dijalani |
| `/passport/materi/[id]` | Klien | Reader e-book/video berwatermark identitas, tanpa unduhan |
| `/passport/bayar` | Klien | STATUS tagihan (tanpa nominal) + klaim "saya sudah bayar" |
| `/passport/ajukan` | Klien | Ajukan jadwal: varian, tanggal, JAM, alamat — selalu berstatus `diminta`. Tanpa skrining hijau yang belum terpakai: ajakan skrining, bukan formulir |
| `/passport/profil` | Klien | Identitas akun, read-only; perubahan data lewat admin |
| `/passport/skrining` | Klien | Skrining keselamatan dari dalam Passport — wizard yang sama dengan corong publik, `client_id` terisi sejak awal |
| `/admin` | Admin, Owner | Dashboard antrean: skrining baru, permintaan jadwal, klaim pembayaran, klien belum aktif |
| `/admin/skrining` | Admin, Owner | Inbox skrining: verifikasi jawaban, ubah tindak lanjut, konversi menjadi klien |
| `/admin/klien` | Admin, Owner | Daftar klien: cari (nama & PADMA ID), saring aktivasi/paket, paginasi; baris menaut ke detail |
| `/admin/klien/baru` | Admin, Owner | Formulir klien baru (PADMA ID otomatis) — halaman tersendiri, bukan formulir di header daftar |
| `/admin/klien/[id]` | Admin, Owner | Detail klien, ubah data operasional, terbitkan tautan aktivasi + pesan WhatsApp, riwayat sesi bertaut ke detail sesi |
| `/admin/sesi` | Admin, Owner | Antrean permintaan (cari bidan → tetapkan bidan → konfirmasi), jadwalkan sesi, tandai selesai + catatan bidan |
| `/admin/sesi/[id]` | Admin, Owner | Detail satu sesi: skrining penopang (kode, hasil, jawaban berbendera), jadwal, bidan, jenjang, tindakan |
| `/admin/penilaian` | Admin, Owner | Penilaian sesi: dua angka TERPISAH (sesi & bidan), saringan bintang ≤ 3, komentar klien sebagai teks biasa |
| `/admin/mitra` | Admin, Owner | Daftar mitra/bidan, tambah/ubah, aktif–nonaktif |
| `/admin/bayar` | Admin, Owner | Verifikasi klaim pembayaran (tanpa nominal); tandai lunas / tolak klaim |
| `/admin/layanan` | Admin, Owner | Daftar layanan datar: cari, saring ketersediaan, paginasi; baris menaut ke detail |
| `/admin/layanan/[id]` | Admin, Owner | Detail layanan: data, varian, paket, dan materi terkait (bacaan) |
| `/admin/materi` | Admin, Owner | Daftar materi datar: cari, saring aktif/tipe/kelengkapan isi, paginasi; baris menaut ke detail |
| `/admin/materi/[id]` | Admin, Owner | Detail materi: metadata, isi (e-book/video), layanan tertaut, penugasan per klien |
| `/admin/pengaturan` | Admin, Owner | Nomor WhatsApp & teks publik; kunci terbatas registri `app_setting_keys` |
| `/owner` | Owner | Beranda pemilik: sesi selesai, honor yang jatuh tempo Sabtu, margin pekan berjalan |
| `/owner/rekap` | Owner | Rekap honor per mitra per pekan Senin–Minggu (tarif pada tanggal sesi) + tanda bayar |
| `/owner/tarif` | Owner | Rate card berriwayat: tarif baru = BARIS BARU, tarif lama tidak pernah berubah |
| `/owner/tarif/[variantId]` | Owner | Detail satu varian layanan: tarif ditetapkan di sini + seluruh riwayat tarifnya terbaca |
| `/owner/transport` | Owner | Rate card transport per jenjang jarak (berriwayat) + tarif khusus per sesi >20 km |
| `/akun-belum-terhubung` | Publik | Jalan buntu jujur: akun sah yang rekam kliennya tidak bisa ditentukan tanpa tim PADMA (alamat email sudah dimiliki akun lain, atau token undangan gagal dan tak ada baris beremail sama) — sebabnya sengaja tidak dibedakan di layar |
| `/periksa-email` | Publik | Menunggu konfirmasi email + kirim ulang tautan; konfirmasi inilah satu-satunya alasan penautan lewat email menjadi sah (K1) |

Rute non-halaman (route handler) — bagian permukaan serang yang sama, jadi
didaftarkan di sini juga, bukan hanya halaman yang punya tampilan:

| Rute | Akses | Isi |
|---|---|---|
| `/aktivasi` | Publik | GET tautan undangan: token dipindahkan dari URL ke cookie httpOnly berumur 1 jam, lalu diarahkan ke login — token tidak pernah ikut ke riwayat browser/Referer |
| `/setelah-masuk` | Terautentikasi | GET penyalur pasca-login menurut peran: owner → `/owner`, admin → `/admin`, klien → gerbang `pastikanKlien` (sudah tertaut → token undangan → email terbukti → baris klien baru) lalu `/passport`, `/periksa-email`, atau `/akun-belum-terhubung` |
| `/auth/callback` | Publik | GET callback OAuth Google & tautan pemulihan sandi: menukar `code` menjadi sesi, lalu meneruskan ke tujuan `next` — dibatasi daftar putih `tujuanAman` (K6), bukan dipakai mentah |
| `/auth/keluar` | Terautentikasi | POST logout (form, bukan tautan) lalu kembali ke `/masuk` |
| `/api/bukti` | Klien | POST unggah bukti bayar ke bucket **privat** `bukti-bayar` dengan service role; kepemilikan pengajuan dibaca lewat sesi, status berpindah ke `menunggu_verifikasi` — tidak pernah langsung `lunas` |
| `/api/bukti/[permintaan]` | Admin, Owner | GET bukti bayar. Bucket tanpa policy, jadi ini SATU-SATUNYA pintunya; `requireRole` di baris pertama, respons `private, no-store` |
| `/api/cron/tenggat` | Mesin | POST pembatal pengajuan yang lewat tenggat bayar. Dijaga `CRON_SECRET`, fail-closed bila secret tidak terpasang |
| `/api/skrining/akun` | Klien | POST skrining dari dalam Passport dengan **service role**; `client_id` diambil dari SESI, tidak pernah dari body. Pembatas berkunci `client_id`, terpisah dari ember anonim |
| `/api/skrining` | Publik | POST penyimpanan skrining dengan **service role** — `anon` tidak punya hak tabel pada `screenings`. Berlapis: rate limit → batas 16 KB body → skema Zod → penyaringan id soal → CHECK ukuran di DB |
| `/api/geocode` | Admin/Owner | POST alamat → koordinat untuk pemilih lokasi di peta panel staf. Ada supaya geocoding tetap di SERVER: `lib/transport/geocode.ts` memasang `server-only`, browser tidak bisa menyetel `User-Agent` yang dituntut Nominatim, dan cache serta jeda 1 permintaan/detik hidup di sisi server. Hasilnya hanya menggeser peta — tidak ada apa pun yang tersimpan dari rute ini |
| `/api/materi/[id]/halaman/[n]` | Klien | GET satu halaman e-book sebagai `image/webp` berwatermark identitas pembaca; hak diputuskan RLS lewat sesi klien SEBELUM service role menyentuh bucket privat `materi-halaman`; tidak berhak → 404 (bukan 401/403) |
| `/api/materi/[id]/video` | Klien | GET presigned URL berumur pendek untuk satu video di bucket privat R2; hak diputuskan query ber-RLS memakai sesi klien SEBELUM presigned URL diterbitkan, urutan yang mengikat karena membaliknya berarti menerbitkan tautan unduhan sebelum tahu siapa yang meminta; tidak berhak → 403. URL-nya tidak pernah dirender ke HTML — komponen `<video>` di halaman lahir tanpa `src`, lalu klien mengambilnya sesudah hidup |

Tidak ada satu pun nominal uang di rute `/admin/*` maupun `/passport/*`:
`service_rates` menjawab admin dengan HTTP 200 + `[]` (kosong senyap, bukan
error), dan panel admin tidak punya medan harga/honor mana pun. Sejak Plan 5,
pagar itu punya bukti di lapisan render juga — `npm run test:e2e:owner` memindai
HTML sembilan rute `/admin/**` dan enam rute `/passport/**` terhadap SELURUH
nominal rate card, dengan kontrol positif di `/owner/tarif` supaya "nol nominal"
tidak pernah hijau palsu karena pemindainya rusak.

Integritas tabel uang ditegakkan basis data, bukan hanya server action (migration
`20260830150000_pengerasan_tabel_uang`): `service_rates` dan `honor_marks`
bersifat **append-only** bagi peran API — tarif hanya boleh maju, nilainya wajib
wajar, `week_start` wajib Senin, `ditandai_oleh`/`dibayar_pada` direbut dari
payload, dan setiap UPDATE ditolak `42501`. Alasannya: pemegang JWT owner selalu
bisa memanggil PostgREST langsung dan melewati seluruh validator TypeScript.

Catatan keamanan: `anon` tidak punya hak tabel pada `screenings` — penyimpanan
skrining publik WAJIB lewat route handler dengan service role.

## Test

```bash
npm test
```

Tidak butuh langkah manual apa pun. `npm test` boleh dijalankan **langsung**
sesudah `npx supabase db reset`: `globalSetup` vitest (`tests/global-setup.ts`)
memanggil `seedUsers()` dari `scripts/seed-users.ts` sekali di awal run,
sehingga user demo selalu ada sebelum test pertama login. Seed-nya idempoten
(± 0,5 detik) — urutannya dijaga konfigurasi, bukan prosa di README.

`npm run seed:users` tetap ada untuk menyiapkan data demo bagi `npm run dev`.

Test yang menjaga keamanan:

- `tests/rls-firewall.test.ts` — membuktikan admin/klien tidak bisa menyentuh
  tabel uang (`service_rates`, `honor_marks`).
- `tests/penautan-undangan.test.ts` — mereproduksi eksploit "self-signup dengan
  email klien" dan membuktikan kegagalannya sampai lapisan data (penyerang
  membaca 0 baris `clients`/`sessions`), plus aturan token undangan: salah,
  kedaluwarsa, sudah dipakai, dan email tidak cocok semuanya ditolak.
- `tests/penautan-kolom-terkunci.test.ts` — menutup jalur penautan terakhir yang
  masih melewati token: PATCH langsung `clients.user_id`/`linked_at` dengan JWT
  **admin/owner** (bukan service role). Vektor itu melewati seluruh gerbang
  token — termasuk "email harus cocok" — sehingga admin bisa mengikat akun
  ber-email asing ke baris klien mana pun dan membocorkan rekam medisnya tanpa
  jejak di `client_invites`. Kini ditolak DATABASE (42501) lewat trigger
  `trg_guard_client_link`, dibuktikan juga lewat koneksi SQL langsung sebagai
  peran `authenticated`. Kolom itu hanya boleh ditulis service role, yaitu
  `linkClientByInvite()`.
- `tests/passport-keamanan.test.ts`, `tests/passport-materi.test.ts`,
  `tests/passport-bayar-ajukan.test.ts`, `tests/passport-profil.test.ts` —
  pagar Digital Care Passport: klien tidak punya jalur UPDATE ke `sessions`,
  `client_packages`, `booking_requests`, maupun `clients` (semua perubahan lewat
  server action bernilai tujuan hardcoded), materi terkunci tidak mengirim isi
  bab/URL video, dan halaman profil tetap read-only. Ingat: PostgREST menjawab
  200 + `[]` untuk UPDATE yang tertahan RLS, jadi test wajib membaca ulang
  nilainya dengan service role — bukan menyimpulkan dari status HTTP.
- `tests/struktur-rls.test.ts` — invarian struktural: TIDAK ADA tabel `public`
  tanpa row level security, dan satu-satunya tabel ber-RLS tanpa policy adalah
  `client_invites` (sengaja terkunci mati — token undangan tersimpan sebagai
  SHA-256 dan tidak boleh terbaca peran API mana pun). Tabel baru lahir TANPA
  RLS dan `authenticated` mendapat SELECT/INSERT/UPDATE secara default;
  kelalaian itu dulu lolos seluruh suite karena tidak ada yang menjaganya.
- `tests/inventaris-rute.test.ts` — tabel rute README dicocokkan dua arah
  dengan `src/app`. Rute yang tidak terdaftar adalah rute yang luput dari audit
  permukaan serang — persis nasib `/aktivasi` (penukar token undangan) dan
  `/api/skrining` (penulis ber-service-role) sebelum test ini ada. Sekaligus
  menjaga skrip E2E tetap terangkai ke `test:e2e:semua`: skrip yang ada tetapi
  tidak terangkai adalah skrip yang tidak pernah dijalankan siapa pun.
- `tests/access-matrix-layouts.test.ts` — membaca sumber tiap layout
  terproteksi dan menegaskan daftar peran `requireRole([...])` persis sesuai
  matriks: `/admin` → `["admin","owner"]`, `/owner` → `["owner"]`,
  `/passport` → `["klien"]`. Mengubah daftar peran di layout mana pun membuat
  `npm test` MERAH. (`tests/require-role.test.ts` hanya menguji fungsinya
  dengan argumen mock, jadi tidak menangkap salah tulis di layout.)

### E2E (opsional, di luar `npm test`)

```bash
npm run dev               # terminal lain
npm run test:e2e:semua    # seluruh skrip di bawah, berurutan
```

- `npm run test:e2e` — matriks akses peran lewat browser sungguhan (Playwright).
  Skenario 5-nya menguji penautan akun klien dari KEDUA sisinya: penyamar yang
  mendaftar sendiri dengan menebak alamat email seorang klien tertahan tanpa
  sesi, sementara pemilik sah — lewat email terkonfirmasi maupun lewat tautan
  undangan — masuk ke Passport-nya. Tanpa paruh kedua, "tidak melihat data"
  bisa berarti tembok yang menolak semua orang.
- `npm run test:e2e:daftar` — pendaftaran mandiri utuh: formulir `/daftar` →
  `/periksa-email` → **tautan konfirmasi diambil dari kotak surat lokal**
  (Mailpit, <http://localhost:54324>) dan dibuka di browser yang sama →
  `/passport`. Termasuk paruh negatifnya pada akun yang sama: sebelum tautan itu
  dibuka, tidak ada baris klien yang lahir dan Passport tidak terbuka. Skenario
  keduanya jalur K14 — klien yang datanya sudah dibuat admin mendaftar sendiri
  dan tertaut ke barisnya yang SUDAH ADA, bukan mendapat baris kedua. Akun &
  baris yang dibuatnya dihapus lagi di akhir run, jadi aman diulang.
- `npm run test:e2e:funnel` — funnel calon klien: landing (katalog dari DB) →
  wizard skrining → hasil tersimpan → muncul di inbox admin. Termasuk pagar
  keselamatan: demam pada fase **kehamilan** wajib memicu merah-urgent + blok
  darurat **119**, dan kode skrining tidak boleh bocor ke URL. Skrip ini
  membaca teks yang benar-benar terlihat (`innerText`), bukan `textContent` —
  `textContent` ikut memungut payload RSC di dalam `<script>` sehingga
  pemeriksaan "119" bisa lolos palsu. Entri uji yang dibuatnya dihapus lagi di
  akhir run (lewat service role), jadi aman diulang.
- `npm run test:e2e:passport` — Digital Care Passport klien: sampul & progres
  6/8 sesi, nama bidan (bukti view `partner_publik` terbaca), catatan bidan yang
  baru muncul sesudah kartunya diketuk, gating materi (isi bab & URL video tidak
  pernah ikut ke halaman daftar; materi terkunci tetap ditolak meski URL-nya
  diketik langsung), watermark reader tanpa aksi unduh, klaim bayar yang hanya
  bisa `belum → menunggu_verifikasi`, permintaan jadwal yang selalu `menunggu`,
  dan bottom bar 390px tanpa scroll horizontal. Status bayar & permintaan jadwal
  yang disentuhnya dikembalikan ke keadaan seed di awal DAN di akhir run, jadi
  aman diulang.
- `npm run test:e2e:admin` — rantai operasional klinik dalam SATU alur: admin
  masuk → membuat klien baru (PADMA ID otomatis, status "Belum aktif") →
  menerbitkan tautan aktivasi → klien membuka tautan itu di browser lain, masuk,
  dan mendarat di `/passport` (barisnya berubah menjadi "Aktif" di panel admin)
  → admin menjadwalkan sesi lalu menandainya selesai dengan catatan &
  rekomendasi bidan → klien membaca catatan itu di `/passport/sesi` dan badge
  pertamanya terbit. Tiap potongan sudah punya test unit; yang hanya bisa
  dibuktikan di sini adalah SAMBUNGANNYA. Seluruh data ujinya beremail
  `e2e-admin-<timestamp>@padma.test` dan dihapus lewat service role di awal DAN
  di akhir run (baris klien dulu, baru akun auth — `clients.user_id` menunjuk
  `auth.users` tanpa `on delete`), jadi aman diulang dan tidak menggeser
  hitungan yang di-assert `npm test`.
- `npm run test:e2e:pelengkap` — rantai UANG & KONTEN yang lahir di Plan 3B:
  klien menekan "Saya sudah bayar" → badge "Klaim pembayaran" di `/admin`
  menyala dan kartunya DIKLIK menuju `/admin/bayar` → admin menandai lunas →
  klien melihat "Lunas" di passport-nya; lalu nomor WhatsApp, alamat, & jam
  operasional diubah di `/admin/pengaturan` dan diperiksa merambat ke `/skrining`
  (halaman statis penuh — tanpa `revalidatePath("/skrining")` wizardnya memakai
  nomor lama sampai deploy berikutnya) serta ke footer landing; terakhir sebuah
  materi dinonaktifkan dan babnya dibaca **lewat REST langsung**, bukan sekadar
  dicek hilang dari layar. Yang hanya bisa dibuktikan di sini:
  `jejak_status_bayar.peran_aktor` berbunyi `admin` dengan `aktor_id` akun yang
  benar-benar menekan tombolnya — bukan `service_role`/NULL, yaitu bukti yang
  tidak menyebut siapa pun. Fixture-nya sengaja memuat satu paket berisi sesi,
  supaya ketiadaan "tagihan hantu" (sesi anggota paket yang punya baris tagihan
  sendiri) benar-benar diuji, dan supaya angka badge dibandingkan dengan jumlah
  baris yang benar-benar bisa diverifikasi. Data ujinya berpenanda
  `e2e-pelengkap-` / `E2E-PLKP`; `app_settings` dikembalikan persis dan baris
  `jejak_status_bayar` dihapus manual (tabel itu sengaja tanpa FK sehingga tidak
  ikut cascade — jejak yatim pernah menumpuk lintas run).
- `npm run test:e2e:owner` — panel OWNER, satu-satunya layar yang menampilkan
  nominal: `/owner` menampilkan ringkasan pekan → `/owner/rekap` mengelompokkan
  honor per mitra per pekan dengan tarif **pada tanggal sesi** → `/owner/tarif`
  menetapkan tarif baru sebagai **baris baru** (baris lama diperiksa utuh lewat
  service role) → rekap pekan yang sudah lewat dibuktikan **tidak bergeser** →
  "Tandai dibayar" melahirkan satu `honor_marks` ber-`week_start` Senin dan
  ber-`ditandai_oleh` uid OWNER, lalu tombolnya lenyap dan tandanya bertahan
  sesudah muat ulang (tidak ada jalur pembatalan) → owner mengklik jalan pulang
  ke `/admin`. Ditutup pemindaian money firewall di lapisan render: admin
  ditolak di `/owner`, dan HTML sembilan rute `/admin/**` + enam rute
  `/passport/**` tidak memuat satu pun nominal rate card — dengan **kontrol
  positif** yang menuntut nominal yang sama TERBACA di `/owner/tarif`, karena
  assertion "nol nominal" yang selectornya rusak akan hijau tanpa menguji apa
  pun. Sesi fixture-nya sengaja ditaruh di pekan LALU: kalau di pekan berjalan,
  pembuktian "rekap lama tidak bergeser" akan merah setiap hari Senin. Data
  ujinya berpenanda `e2e-owner-` / `E2E-OWNR` dan dibersihkan lewat service role
  di awal DAN di akhir run.

Catatan untuk keenam skrip: klik beruntun pada wizard/kartu harus menunggu
render berikutnya (mis. `Pertanyaan N dari`). Tombol jawaban adalah simpul DOM
yang sama di semua pertanyaan, sehingga dua klik di frame yang sama memakai
`indeks` lama — satu jawaban tertelan dan skenarionya merah secara acak.

## Deploy

Runbook lengkap beserta alasan tiap keputusan ada di
`docs/superpowers/specs/2026-09-07-padma-deploy-produksi-design.md` (direvisi
8 September 2026). Ringkasannya di sini supaya urutannya tidak perlu diingat.

Domain produksi: **`padmawellnessid.com`**. Vercel dengan **root directory
`web/`** — akar repo tidak berisi `package.json`. Fungsi di region `sin1`,
Supabase di Singapore.

**Fase 0 — basis data, sebelum menyentuh Vercel**

```bash
npx supabase link --project-ref <ref-proyek-baru>
npx supabase db push          # seluruh migrasi, termasuk penanam `phases`
```

`db push` **tidak** menjalankan `seed.sql`. Itu memang benar untuk katalog —
klien mengisinya sendiri lewat panel — tetapi `phases` bukan katalog melainkan
data acuan yang dirujuk kode, jadi ia ditanam lewat migrasi
`20260908120000_tanam_fase_acuan.sql`. Jangan mengembalikannya ke `seed.sql`.

**Fase 1 — Vercel:** import repo, pasang env produksi (lihat §6 spec), deploy.

**Fase 2 — sesudah domain tertempel dan sertifikatnya terbit**

1. **SMTP — penghalang rilis.** Tanpa ini tidak seorang pun bisa menyelesaikan
   pendaftaran: konfirmasi email berdiri di jalur utama, dan layanan bawaan
   Supabase hanya cukup untuk mencoba. Resend: verifikasi domain, terbitkan API
   key, isi Supabase → Auth → SMTP Settings (`smtp.resend.com`, port 465, user
   `resend`, sender `noreply@padmawellnessid.com`), lalu naikkan batas
   `email_sent`.
2. Supabase → Auth → URL Configuration: Site URL dan Redirect URLs menunjuk
   **domain final**, bukan URL `.vercel.app`.
3. Google OAuth: origin ke domain, redirect URI ke
   `https://<ref>.supabase.co/auth/v1/callback` — **bukan** ke Vercel.
4. Cloudflare R2: tambahkan domain ke `AllowedOrigins` bucket `padma`.
5. Isi data lewat panel: `nomor_wa`, tarif transport, katalog layanan asli.
   **Jangan** jalankan `npm run seed:users` — itu akun dev bersandi seragam.

**Verifikasi rilis** adalah uji asap manual, bukan E2E: skrip E2E menulis lewat
service role, dan mengarahkannya ke produksi berarti skrip uji memegang basis
data pasien. Yang membuktikan rilis berhasil ada di §9 spec — termasuk satu
pendaftaran sungguhan ke alamat di luar tim yang emailnya benar-benar tiba dan
tautannya benar-benar membuka akun. Kaki itu tidak pernah bisa diuji otomatis.
