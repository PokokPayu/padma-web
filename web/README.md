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
- ananda@padma.test → /passport

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

Dua test yang menjaga keamanan:

- `tests/rls-firewall.test.ts` — membuktikan admin/klien tidak bisa menyentuh
  tabel uang (`service_rates`, `honor_marks`).
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
