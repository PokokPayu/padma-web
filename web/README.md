# PADMA — Website v1

Homecare promil & perawatan perempuan. Spec: `../docs/superpowers/specs/2026-08-26-padma-v1-design.md`.

## Menjalankan (development)

Prasyarat: Node >= 20, Docker Desktop.

```bash
npm install
npx supabase start          # catat anon key & service_role key
cp .env.example .env.local  # isi ketiga nilai dari keluaran di atas
npx supabase db reset       # migration + seed master data
npm run seed:users          # user demo 3 peran
npm run dev
```

Akun demo (password semua `padma-dev-123`):
- owner@padma.test → /owner
- admin@padma.test → /admin
- ananda@padma.test → /passport

## Test

```bash
npm test
```

Test terpenting: `tests/rls-firewall.test.ts` — membuktikan admin/klien
tidak bisa menyentuh tabel uang (`service_rates`, `honor_marks`).

## Deploy

Vercel (root directory: `web/`) + Supabase hosted. Tautkan project:
`npx supabase link --project-ref <ref>` lalu `npx supabase db push`.
Google OAuth diaktifkan di Supabase Dashboard → Auth → Providers.
