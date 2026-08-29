# PADMA — Website v1

Homecare promil & perawatan perempuan. Spec: `../docs/superpowers/specs/2026-08-26-padma-v1-design.md`.

## Menjalankan (development)

Prasyarat: Node >= 20, Docker Desktop.

```bash
npm install
npx supabase start          # catat anon key & service_role key
cp .env.example .env.local  # isi ketiga nilai dari keluaran di atas
npx supabase db reset       # migration + seed master data
npm run seed:users          # user demo 3 peran (untuk `npm run dev`; `npm test` seed sendiri)
npm run dev
```

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

Klien `Rina Hapsari` sengaja **belum** diaktifkan — ia bahan uji alur aktivasi.
Akun klien tidak bisa lagi tertaut hanya karena emailnya cocok (celah yang
membocorkan rekam medis; lihat spec bagian 7): penautan wajib lewat tautan
undangan sekali-pakai yang di produksi dikirim admin via WhatsApp. Untuk dev,
`npm run seed:users` mencetak tautannya:

```
http://localhost:3000/aktivasi?token=undangan-dev-rina-...
```

Buka tautan itu, lalu masuk sebagai `rina@padma.test` — barulah `/passport`
menampilkan datanya. Masuk tanpa tautan berakhir di `/akun-belum-terhubung`.

## Rute

| Rute | Akses | Isi |
|---|---|---|
| `/` | Publik | Landing: hero, 5 lini layanan (dari DB), cara kerja, teaser passport, pembanding |
| `/skrining` | Publik | Wizard skrining keselamatan; hasil dinilai server, disimpan via `POST /api/skrining` |
| `/masuk` | Publik | Login email+password & Google |
| `/passport` | Klien | Beranda passport: sampul, grid stempel paket, sesi berikutnya, pencapaian |
| `/passport/sesi` | Klien | Riwayat sesi + catatan & rekomendasi bidan (tertutup sampai diketuk) |
| `/passport/materi` | Klien | Daftar materi panduan; terkunci sampai layanan terkait dijalani |
| `/passport/materi/[id]` | Klien | Reader e-book/video berwatermark identitas, tanpa unduhan |
| `/passport/bayar` | Klien | STATUS tagihan (tanpa nominal) + klaim "saya sudah bayar" |
| `/passport/ajukan` | Klien | Ajukan jadwal — selalu berstatus `menunggu` |
| `/passport/profil` | Klien | Identitas akun, read-only; perubahan data lewat admin |
| `/admin` | Admin, Owner | Dashboard admin |
| `/admin/skrining` | Admin, Owner | Inbox skrining: verifikasi jawaban, ubah tindak lanjut |
| `/owner` | Owner | Rate card & rekap honor (Plan 5) |

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
- `tests/access-matrix-layouts.test.ts` — membaca sumber tiap layout
  terproteksi dan menegaskan daftar peran `requireRole([...])` persis sesuai
  matriks: `/admin` → `["admin","owner"]`, `/owner` → `["owner"]`,
  `/passport` → `["klien"]`. Mengubah daftar peran di layout mana pun membuat
  `npm test` MERAH. (`tests/require-role.test.ts` hanya menguji fungsinya
  dengan argumen mock, jadi tidak menangkap salah tulis di layout.)

### E2E (opsional, di luar `npm test`)

```bash
npm run dev               # terminal lain
npm run test:e2e:semua    # ketiga skrip di bawah, berurutan
```

- `npm run test:e2e` — matriks akses peran lewat browser sungguhan (Playwright).
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

Catatan untuk ketiga skrip: klik beruntun pada wizard/kartu harus menunggu
render berikutnya (mis. `Pertanyaan N dari`). Tombol jawaban adalah simpul DOM
yang sama di semua pertanyaan, sehingga dua klik di frame yang sama memakai
`indeks` lama — satu jawaban tertelan dan skenarionya merah secara acak.

## Deploy

Vercel (root directory: `web/`) + Supabase hosted. Tautkan project:
`npx supabase link --project-ref <ref>` lalu `npx supabase db push`.
Google OAuth diaktifkan di Supabase Dashboard → Auth → Providers.
