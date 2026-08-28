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
- `tests/access-matrix-layouts.test.ts` — membaca sumber tiap layout
  terproteksi dan menegaskan daftar peran `requireRole([...])` persis sesuai
  matriks: `/admin` → `["admin","owner"]`, `/owner` → `["owner"]`,
  `/passport` → `["klien"]`. Mengubah daftar peran di layout mana pun membuat
  `npm test` MERAH. (`tests/require-role.test.ts` hanya menguji fungsinya
  dengan argumen mock, jadi tidak menangkap salah tulis di layout.)

### E2E (opsional, di luar `npm test`)

```bash
npm run dev        # terminal lain
npm run test:e2e   # matriks akses lewat browser sungguhan (Playwright)
```

## Deploy

Vercel (root directory: `web/`) + Supabase hosted. Tautkan project:
`npx supabase link --project-ref <ref>` lalu `npx supabase db push`.
Google OAuth diaktifkan di Supabase Dashboard → Auth → Providers.
