# PADMA v1 — Plan 1: Fondasi, Skema & Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikasi Next.js + Supabase yang bisa di-deploy, dengan skema database lengkap + RLS money-firewall yang terbukti lewat test, dan ketiga peran (klien/admin/owner) bisa login lalu diarahkan ke shell dashboardnya masing-masing.

**Architecture:** Satu app Next.js (App Router) di folder `web/`, backend penuh di Supabase (Postgres+RLS, Auth, Storage). Uang hidup HANYA di tabel `service_rates` & `honor_marks` yang ditolak RLS untuk selain owner. Role dibaca dari tabel `profiles` (dibuat otomatis via trigger), guard dilakukan server-side di layout per-rute. Development & test memakai Supabase local stack (Docker) via Supabase CLI; skema dikelola sebagai file migration di repo.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind), @supabase/supabase-js v2 + @supabase/ssr, Supabase CLI (local stack), Vitest + tsx.

**Spec:** `docs/superpowers/specs/2026-08-26-padma-v1-design.md`

**Rencana lanjutan (di luar plan ini, ditulis setelah plan ini selesai):**
Plan 2 = Landing + Skrining publik + Inbox admin · Plan 3 = Panel Admin operasional · Plan 4 = Passport klien · Plan 5 = Panel Owner + E2E.

## Global Constraints

- Seluruh teks UI berbahasa **Indonesia**.
- **Money firewall struktural**: kolom uang hanya boleh ada di `service_rates` dan `honor_marks`; tabel `sessions`/`clients`/dll TIDAK BOLEH punya kolom nominal. RLS menolak akses non-owner ke kedua tabel uang.
- `SUPABASE_SERVICE_ROLE_KEY` hanya boleh dipakai di kode server (route handler / server action / script) — tidak pernah di komponen client.
- TypeScript `strict: true`; tidak ada `any` kecuali terpaksa dengan komentar alasan.
- App berada di subfolder `web/` (repo root berisi docs & prototipe). Semua perintah `npm`/`npx` dijalankan dari `web/` kecuali disebut lain.
- Node ≥ 20, Docker Desktop berjalan (untuk `supabase start`).
- Palet brand (dipakai mulai Plan 2, daftarkan sekarang sebagai token Tailwind): night `#0A2B1F`, pine `#11382A`, leaf `#2F6A48`, gold `#B58A3C`, gold-bright `#D9B36A`, paper `#FBF8F0`, clay `#A6472F`. Font: Marcellus (display), Plus Jakarta Sans (body), IBM Plex Mono (mono).
- Akun demo dev: `owner@padma.test` / `admin@padma.test` / `ananda@padma.test`, password semua `padma-dev-123`.

---

### Task 1: Scaffold Next.js + Vitest

**Files:**
- Create: `web/` (via create-next-app), `web/vitest.config.ts`, `web/tests/smoke.test.ts`
- Modify: `web/package.json` (script test), `web/tailwind.config.ts` — TIDAK ADA (Tailwind v4 pakai CSS); token brand masuk `web/src/app/globals.css`

**Interfaces:**
- Produces: struktur proyek `web/src/app/*`, alias import `@/*` → `web/src/*`, perintah `npm test` (vitest run), token warna CSS `--color-night` dst. yang dipakai Plan 2+.

- [ ] **Step 1: Scaffold app**

Dari repo root:
```bash
npx create-next-app@latest web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
cd web
```

- [ ] **Step 2: Pasang Vitest + tsx + dotenv**

```bash
npm i -D vitest tsx dotenv
```

Buat `web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Test RLS berbagi satu stack Supabase lokal — jalankan berurutan agar deterministik.
    fileParallelism: false,
    setupFiles: ["dotenv/config"],
    env: { DOTENV_CONFIG_PATH: ".env.local" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

Tambahkan di `web/package.json` bagian scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Token brand di globals.css**

Ganti isi `web/src/app/globals.css` dengan:
```css
@import "tailwindcss";

@theme {
  --color-night: #0a2b1f;
  --color-pine: #11382a;
  --color-leaf: #2f6a48;
  --color-leaf-soft: #e9f1e9;
  --color-gold: #b58a3c;
  --color-gold-bright: #d9b36a;
  --color-gold-pale: #f0e3c3;
  --color-paper: #fbf8f0;
  --color-paper-warm: #f5efe1;
  --color-ink: #1f2e26;
  --color-ink-soft: #5d6c61;
  --color-clay: #a6472f;
}

body {
  background: var(--color-paper);
  color: var(--color-ink);
}
```

- [ ] **Step 4: Smoke test gagal dulu**

Buat `web/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { APP_NAME } from "@/lib/constants";

describe("smoke", () => {
  it("konstanta aplikasi tersedia", () => {
    expect(APP_NAME).toBe("PADMA");
  });
});
```

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/constants'`

- [ ] **Step 5: Implementasi minimal**

Buat `web/src/lib/constants.ts`:
```ts
export const APP_NAME = "PADMA";
```

- [ ] **Step 6: Verifikasi test & build**

Run: `npm test` → Expected: PASS (1 test)
Run: `npm run build` → Expected: build sukses tanpa error TypeScript

- [ ] **Step 7: Commit**

Dari repo root:
```bash
git add web
git commit -m "feat(plan1): scaffold Next.js + Vitest + token brand"
```

---

### Task 2: Supabase local stack + klien Supabase untuk Next.js

**Files:**
- Create: `web/supabase/config.toml` (via `supabase init`, lalu edit), `web/src/lib/supabase/server.ts`, `web/src/lib/supabase/client.ts`, `web/src/lib/supabase/admin.ts`, `web/src/middleware.ts`, `web/.env.example`, `web/tests/connection.test.ts`
- Modify: `web/.gitignore` (pastikan `.env*.local` terabaikan — bawaan create-next-app sudah ada)

**Interfaces:**
- Produces:
  - `createServerSupabase(): Promise<SupabaseClient>` (cookie-based, dipakai semua server component/action)
  - `createBrowserSupabase(): SupabaseClient` (dipakai komponen client, mis. form login)
  - `createAdminSupabase(): SupabaseClient` (service-role, HANYA server/script)
  - Middleware yang me-refresh sesi + redirect tak-login dari `/admin|/owner|/passport` ke `/masuk`

- [ ] **Step 1: Init Supabase & jalankan stack lokal**

```bash
npm i @supabase/supabase-js @supabase/ssr
npx supabase init
npx supabase start
```

Expected: keluaran berisi `API URL: http://127.0.0.1:54321`, `anon key: ...`, `service_role key: ...`.

- [ ] **Step 2: Konfigurasi auth lokal**

Di `web/supabase/config.toml`, pastikan/ubah bagian berikut:
```toml
[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]

[auth.email]
enable_signup = true
enable_confirmations = false

# Google OAuth diaktifkan di project hosted (Dashboard → Auth → Providers).
# Lokal cukup email+password; tombol Google tetap dirender dan berfungsi di hosted.
```

Restart agar config terbaca: `npx supabase stop && npx supabase start`

- [ ] **Step 3: File env**

Buat `web/.env.example`:
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=isi-dari-supabase-start
SUPABASE_SERVICE_ROLE_KEY=isi-dari-supabase-start
```

Salin jadi `web/.env.local` dan isi ketiga nilai dari keluaran `supabase start`.

- [ ] **Step 4: Tiga pembuat klien Supabase**

Buat `web/src/lib/supabase/server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Dipanggil dari Server Component (read-only) — aman diabaikan,
            // refresh cookie ditangani middleware.
          }
        },
      },
    },
  );
}
```

Buat `web/src/lib/supabase/client.ts`:
```ts
import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

Buat `web/src/lib/supabase/admin.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

// HANYA untuk server (route handler/server action) & script.
// Jangan pernah diimpor dari komponen client.
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

- [ ] **Step 5: Middleware sesi + proteksi rute**

Buat `web/src/middleware.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/admin", "/owner", "/passport"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED_PREFIXES.some((p) => path.startsWith(p));
  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/masuk";
    url.searchParams.set("lanjut", path);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
```

- [ ] **Step 6: Test koneksi (gagal dulu, lalu lolos)**

Buat `web/tests/connection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";

describe("koneksi supabase lokal", () => {
  it("service role bisa memanggil Auth Admin API", async () => {
    const admin = createAdminSupabase();
    const { data, error } = await admin.auth.admin.listUsers();
    expect(error).toBeNull();
    expect(Array.isArray(data.users)).toBe(true);
  });
});
```

Run: `npm test`
Expected: PASS (bila FAIL "fetch failed" → `npx supabase start` belum jalan atau `.env.local` belum diisi).

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(plan1): supabase local stack + klien server/browser/admin + middleware sesi"
```

---

### Task 3: Migration skema inti

**Files:**
- Create: `web/supabase/migrations/<timestamp>_init_schema.sql` (via `supabase migration new init_schema`)
- Test: `web/tests/schema.test.ts`

**Interfaces:**
- Produces: seluruh tabel & enum sesuai spec §5 (nama persis di SQL di bawah) — dipakai semua task & plan berikutnya. Tabel uang: `service_rates`, `honor_marks`. Tabel `sessions` TIDAK punya kolom nominal.

- [ ] **Step 1: Buat file migration**

```bash
npx supabase migration new init_schema
```

Isi file `web/supabase/migrations/*_init_schema.sql`:
```sql
-- ===== ENUMS =====
create type app_role as enum ('klien','admin','owner');
create type session_status as enum ('terjadwal','selesai','batal');
create type pay_status as enum ('belum','menunggu_verifikasi','lunas');
create type screening_result as enum ('hijau','merah');
create type screening_followup as enum ('baru','dihubungi','jadi_klien','ditolak');
create type package_status as enum ('aktif','selesai','berhenti');
create type material_type as enum ('ebook','video');
create type booking_status as enum ('menunggu','dikonfirmasi','ditolak');
create type waktu_pref as enum ('pagi','siang','sore');

-- ===== PROFIL & PERAN =====
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null default 'klien',
  nama text not null default '',
  created_at timestamptz not null default now()
);

-- ===== MASTER DATA =====
create table phases (
  id text primary key,              -- 'prekonsepsi' | 'kehamilan' | 'nifas' | 'menopause' | 'newborn'
  nama_sanskrit text not null,      -- Sankalpa, Garbha, ...
  nama text not null,               -- label Indonesia
  urutan int not null
);

create table services (
  id uuid primary key default gen_random_uuid(),
  phase_id text not null references phases(id),
  nama text not null,
  deskripsi text not null default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

create table packages (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  nama text not null,
  jumlah_sesi int not null check (jumlah_sesi > 0),
  aktif boolean not null default true
);

create table partners (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  no_hp text not null default '',
  aktif boolean not null default true
);

create table app_settings (
  key text primary key,
  value text not null
);

-- ===== KLIEN & OPERASIONAL =====
create table clients (
  id uuid primary key default gen_random_uuid(),
  padma_id text not null unique,
  nama text not null,
  email text not null unique,
  no_hp text not null default '',
  phase_id text not null references phases(id),
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index clients_user_id_idx on clients(user_id);
create index clients_email_lower_idx on clients (lower(email));

create table client_packages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  package_id uuid not null references packages(id),
  tanggal_mulai date not null default current_date,
  status package_status not null default 'aktif',
  status_bayar pay_status not null default 'belum'
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  service_id uuid not null references services(id),
  client_package_id uuid references client_packages(id),
  partner_id uuid not null references partners(id),
  tanggal date not null,
  status session_status not null default 'terjadwal',
  catatan text not null default '',
  rekomendasi text not null default '',
  -- hanya relevan untuk sesi lepas; sesi dalam paket ikut status paketnya
  status_bayar pay_status not null default 'belum',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_client_idx on sessions(client_id);
create index sessions_tanggal_idx on sessions(tanggal);

create table screenings (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  no_hp text not null,
  fase text not null,
  jawaban jsonb not null,
  hasil screening_result not null,
  flags jsonb not null default '[]',
  status_tindak_lanjut screening_followup not null default 'baru',
  client_id uuid references clients(id),
  created_at timestamptz not null default now()
);

create table booking_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  service_id uuid not null references services(id),
  tanggal date not null,
  preferensi_waktu waktu_pref not null,
  catatan text not null default '',
  status booking_status not null default 'menunggu',
  created_at timestamptz not null default now()
);

-- ===== MATERI (tanpa file — konten per-bab di DB, keputusan #13) =====
create table materials (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  judul text not null,
  tipe material_type not null,
  deskripsi text not null default '',
  video_url text,                    -- penyedia terproteksi (Vimeo/CF Stream), bukan file
  aktif boolean not null default true
);

create table material_chapters (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  urutan int not null,
  judul text not null,
  isi text not null default ''
);

-- ===== TABEL UANG (hanya owner — RLS di migration berikutnya) =====
create table service_rates (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  harga_klien int not null,
  honor_mitra int not null,
  berlaku_sejak date not null default current_date
);
create index service_rates_lookup_idx on service_rates(service_id, berlaku_sejak desc);

create table honor_marks (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  week_start date not null,
  dibayar_pada timestamptz not null default now(),
  ditandai_oleh uuid references auth.users(id),
  unique (partner_id, week_start)
);
```

- [ ] **Step 2: Test skema (gagal dulu)**

Buat `web/tests/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";

const TABLES = [
  "profiles", "phases", "services", "packages", "partners", "app_settings",
  "clients", "client_packages", "sessions", "screenings", "booking_requests",
  "materials", "material_chapters", "service_rates", "honor_marks",
] as const;

describe("skema database", () => {
  it.each(TABLES)("tabel %s ada", async (table) => {
    const admin = createAdminSupabase();
    const { error } = await admin.from(table).select("*").limit(0);
    expect(error).toBeNull();
  });
});
```

Run: `npm test -- tests/schema.test.ts`
Expected: FAIL — relation does not exist.

- [ ] **Step 3: Terapkan migration**

```bash
npx supabase db reset
```
Expected: `Applying migration ..._init_schema.sql` tanpa error.

- [ ] **Step 4: Verifikasi test lolos**

Run: `npm test -- tests/schema.test.ts`
Expected: PASS (15 tabel).

- [ ] **Step 5: Commit**

```bash
git add web/supabase web/tests/schema.test.ts
git commit -m "feat(plan1): migration skema inti (15 tabel, uang terpisah di service_rates/honor_marks)"
```

---

### Task 4: Migration RLS + trigger profil + seed master data

**Files:**
- Create: `web/supabase/migrations/<timestamp>_rls_policies.sql`, `web/supabase/seed.sql`

**Interfaces:**
- Produces:
  - Fungsi SQL `public.user_role() returns app_role` — dipakai semua policy & bisa dipakai query lain.
  - Trigger `handle_new_user`: setiap user auth baru otomatis punya baris `profiles` (role default `klien`).
  - Policy: klien = baris miliknya; admin = CRUD operasional; owner = semua; tabel uang = owner saja; `screenings` insert hanya via service-role (server).
  - Seed: 5 fase, 10 layanan dummy, tarif, 1 paket, 2 mitra, `app_settings.nomor_wa`.

- [ ] **Step 1: Buat migration RLS**

```bash
npx supabase migration new rls_policies
```

Isi:
```sql
-- ===== HELPER PERAN =====
create or replace function public.user_role()
returns app_role
language sql stable security definer set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()), 'klien'::app_role);
$$;

-- ===== TRIGGER: auto-buat profil untuk user baru =====
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nama)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== AKTIFKAN RLS DI SEMUA TABEL =====
alter table profiles enable row level security;
alter table phases enable row level security;
alter table services enable row level security;
alter table packages enable row level security;
alter table partners enable row level security;
alter table app_settings enable row level security;
alter table clients enable row level security;
alter table client_packages enable row level security;
alter table sessions enable row level security;
alter table screenings enable row level security;
alter table booking_requests enable row level security;
alter table materials enable row level security;
alter table material_chapters enable row level security;
alter table service_rates enable row level security;
alter table honor_marks enable row level security;

-- ===== PROFILES =====
create policy "profil: baca sendiri atau staf" on profiles for select
  using (id = auth.uid() or user_role() in ('admin','owner'));
create policy "profil: staf kelola" on profiles for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- ===== MASTER DATA (baca: semua user login; tulis: staf) =====
create policy "phases: baca" on phases for select using (auth.uid() is not null);
create policy "services: baca" on services for select using (auth.uid() is not null);
create policy "packages: baca" on packages for select using (auth.uid() is not null);
create policy "services: staf kelola" on services for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "packages: staf kelola" on packages for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "phases: staf kelola" on phases for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "partners: staf" on partners for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "settings: staf" on app_settings for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- ===== KLIEN & OPERASIONAL =====
create policy "clients: milik sendiri" on clients for select
  using (user_id = auth.uid());
create policy "clients: staf" on clients for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "client_packages: milik sendiri" on client_packages for select
  using (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "client_packages: staf" on client_packages for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "sessions: milik sendiri" on sessions for select
  using (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "sessions: staf" on sessions for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- screenings: publik TIDAK boleh insert langsung (lewat server action + service role);
-- hanya staf yang boleh membaca/mengubah.
create policy "screenings: staf" on screenings for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "booking: klien baca miliknya" on booking_requests for select
  using (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "booking: klien ajukan" on booking_requests for insert
  with check (exists (select 1 from clients c where c.id = client_id and c.user_id = auth.uid()));
create policy "booking: staf" on booking_requests for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

-- ===== MATERI: meta terbaca user login; ISI bab hanya bila ada sesi selesai =====
create policy "materials: baca meta" on materials for select using (auth.uid() is not null);
create policy "materials: staf kelola" on materials for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

create policy "chapters: staf" on material_chapters for all
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));
create policy "chapters: klien dgn sesi selesai" on material_chapters for select
  using (exists (
    select 1
    from materials m
    join sessions s on s.service_id = m.service_id and s.status = 'selesai'
    join clients c on c.id = s.client_id
    where m.id = material_id and c.user_id = auth.uid()
  ));

-- ===== TABEL UANG: HANYA OWNER (money firewall) =====
create policy "rates: hanya owner" on service_rates for all
  using (user_role() = 'owner') with check (user_role() = 'owner');
create policy "honor: hanya owner" on honor_marks for all
  using (user_role() = 'owner') with check (user_role() = 'owner');
```

- [ ] **Step 2: Seed master data**

Buat `web/supabase/seed.sql`:
```sql
insert into phases (id, nama_sanskrit, nama, urutan) values
  ('prekonsepsi','Sankalpa','Prekonsepsi / Promil',1),
  ('kehamilan','Garbha','Kehamilan',2),
  ('nifas','Purnama','Nifas & Menyusui',3),
  ('menopause','Sandhya','Menopause',4),
  ('newborn','Shishu','Newborn Care',5);

-- Katalog DUMMY (keputusan #12) — client mengganti sendiri lewat panel saat live.
insert into services (id, phase_id, nama) values
  ('11111111-1111-1111-1111-111111111101','prekonsepsi','Sankalpa Fertility Massage'),
  ('11111111-1111-1111-1111-111111111102','prekonsepsi','PADMA Flow Yoga - Prekonsepsi'),
  ('11111111-1111-1111-1111-111111111103','prekonsepsi','Konsultasi Nutrisi Prekonsepsi'),
  ('11111111-1111-1111-1111-111111111104','kehamilan','Garbha Relief Massage'),
  ('11111111-1111-1111-1111-111111111105','kehamilan','Prenatal Gentle Yoga'),
  ('11111111-1111-1111-1111-111111111106','nifas','Lactation Hero'),
  ('11111111-1111-1111-1111-111111111107','nifas','Purnama Recovery Massage'),
  ('11111111-1111-1111-1111-111111111108','menopause','Sandhya Balance Care'),
  ('11111111-1111-1111-1111-111111111109','newborn','Shishu Parent Touch'),
  ('11111111-1111-1111-1111-111111111110','newborn','Baby Massage Class');

insert into service_rates (service_id, harga_klien, honor_mitra) values
  ('11111111-1111-1111-1111-111111111101',425000,190000),
  ('11111111-1111-1111-1111-111111111102',250000,100000),
  ('11111111-1111-1111-1111-111111111103',300000,130000),
  ('11111111-1111-1111-1111-111111111104',350000,150000),
  ('11111111-1111-1111-1111-111111111105',275000,110000),
  ('11111111-1111-1111-1111-111111111106',450000,200000),
  ('11111111-1111-1111-1111-111111111107',400000,175000),
  ('11111111-1111-1111-1111-111111111108',375000,160000),
  ('11111111-1111-1111-1111-111111111109',400000,180000),
  ('11111111-1111-1111-1111-111111111110',300000,125000);

insert into packages (id, service_id, nama, jumlah_sesi) values
  ('22222222-2222-2222-2222-222222222201','11111111-1111-1111-1111-111111111101','Sankalpa Prima',8);

insert into partners (id, nama, no_hp) values
  ('33333333-3333-3333-3333-333333333301','Bidan Sri Wahyuni','0811-0000-0001'),
  ('33333333-3333-3333-3333-333333333302','Bidan Dewi Lestari','0811-0000-0002');

insert into app_settings (key, value) values ('nomor_wa','6287778400200');
```

- [ ] **Step 3: Terapkan & verifikasi manual**

```bash
npx supabase db reset
```
Expected: kedua migration + seed berjalan tanpa error.

Verifikasi cepat: `npm test -- tests/schema.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add web/supabase
git commit -m "feat(plan1): RLS money-firewall, trigger profil, seed master data dummy"
```

---

### Task 5: Script seed pengguna & data demo

**Files:**
- Create: `web/scripts/seed-users.ts`
- Modify: `web/package.json` (script `seed:users`)

**Interfaces:**
- Consumes: `createAdminSupabase()` dari Task 2; id seed (services `...101`, package `...201`, partners `...301/302`) dari Task 4.
- Produces: user auth `owner@padma.test`(owner) / `admin@padma.test`(admin) / `ananda@padma.test`(klien, tertaut ke clients), klien `Ananda Putri PAD-2607-0012` (+paket & 2 sesi) dan `Rina Hapsari PAD-2608-0019` (belum tertaut user — bahan test penautan Task 7). Idempoten (aman dijalankan ulang).

- [ ] **Step 1: Tulis script**

Buat `web/scripts/seed-users.ts`:
```ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PASSWORD = "padma-dev-123";

async function ensureUser(email: string, nama: string, role: "klien" | "admin" | "owner") {
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: nama },
    });
    if (error) throw error;
    user = data.user;
  }
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: user!.id, role, nama });
  if (pErr) throw pErr;
  return user!;
}

async function main() {
  await ensureUser("owner@padma.test", "Pemilik PADMA", "owner");
  await ensureUser("admin@padma.test", "Admin PADMA", "admin");
  const ananda = await ensureUser("ananda@padma.test", "Ananda Putri", "klien");

  // Klien tertaut (Ananda) + klien belum tertaut (Rina, bahan test penautan).
  const { error: cErr } = await admin.from("clients").upsert(
    [
      {
        id: "44444444-4444-4444-4444-444444444401",
        padma_id: "PAD-2607-0012",
        nama: "Ananda Putri",
        email: "ananda@padma.test",
        no_hp: "0812-3456-7890",
        phase_id: "prekonsepsi",
        user_id: ananda.id,
      },
      {
        id: "44444444-4444-4444-4444-444444444402",
        padma_id: "PAD-2608-0019",
        nama: "Rina Hapsari",
        email: "rina@padma.test",
        no_hp: "0857-0000-1111",
        phase_id: "kehamilan",
        user_id: null,
      },
    ],
    { onConflict: "padma_id" },
  );
  if (cErr) throw cErr;

  const { error: cpErr } = await admin.from("client_packages").upsert(
    {
      id: "55555555-5555-5555-5555-555555555501",
      client_id: "44444444-4444-4444-4444-444444444401",
      package_id: "22222222-2222-2222-2222-222222222201",
      tanggal_mulai: "2026-07-06",
      status_bayar: "lunas",
    },
    { onConflict: "id" },
  );
  if (cpErr) throw cpErr;

  const { error: sErr } = await admin.from("sessions").upsert(
    [
      {
        id: "66666666-6666-6666-6666-666666666601",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-07-08",
        status: "selesai",
        catatan: "Sesi perkenalan; pemetaan kondisi awal.",
        rekomendasi: "Jaga tidur 7-8 jam; mulai catat siklus.",
      },
      {
        id: "66666666-6666-6666-6666-666666666602",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-09-04",
        status: "terjadwal",
      },
    ],
    { onConflict: "id" },
  );
  if (sErr) throw sErr;

  console.log("Seed pengguna & data demo selesai.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Tambahkan script di `web/package.json`:
```json
"seed:users": "tsx scripts/seed-users.ts"
```

- [ ] **Step 2: Jalankan & verifikasi**

Run: `npm run seed:users`
Expected: `Seed pengguna & data demo selesai.`
Jalankan sekali lagi → tetap sukses (idempoten).

- [ ] **Step 3: Commit**

```bash
git add web/scripts web/package.json
git commit -m "feat(plan1): seed user demo 3 peran + data klien contoh"
```

---

### Task 6: Test RLS money-firewall (test terpenting proyek)

**Files:**
- Create: `web/tests/helpers/as-user.ts`, `web/tests/rls-firewall.test.ts`

**Interfaces:**
- Consumes: user seed Task 5; skema & policy Task 3–4.
- Produces: `signInAs(email): Promise<SupabaseClient>` — dipakai ulang test plan berikutnya.

- [ ] **Step 1: Helper login test**

Buat `web/tests/helpers/as-user.ts`:
```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "padma-dev-123",
  });
  if (error) throw new Error(`Gagal login ${email}: ${error.message}`);
  return client;
}

export function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}
```

- [ ] **Step 2: Tulis test firewall (gagal bila policy salah)**

Buat `web/tests/rls-firewall.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signInAs, anonClient } from "./helpers/as-user";

describe("MONEY FIREWALL — tabel uang hanya untuk owner", () => {
  it("admin TIDAK bisa membaca service_rates (0 baris)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("service_rates").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin TIDAK bisa menulis service_rates (error 42501)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.from("service_rates").insert({
      service_id: "11111111-1111-1111-1111-111111111101",
      harga_klien: 1,
      honor_mitra: 1,
    });
    expect(error?.code).toBe("42501");
  });

  it("admin TIDAK bisa membaca honor_marks", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data } = await admin.from("honor_marks").select("*");
    expect(data).toHaveLength(0);
  });

  it("klien TIDAK bisa membaca service_rates", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("service_rates").select("*");
    expect(data).toHaveLength(0);
  });

  it("owner BISA membaca service_rates (seed 10 baris)", async () => {
    const owner = await signInAs("owner@padma.test");
    const { data, error } = await owner.from("service_rates").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });
});

describe("Isolasi data klien", () => {
  it("klien hanya melihat baris clients miliknya", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("clients").select("padma_id");
    expect(data).toHaveLength(1);
    expect(data![0].padma_id).toBe("PAD-2607-0012");
  });

  it("klien hanya melihat sesi miliknya", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("sessions").select("id");
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it("klien TIDAK bisa mengubah sesi", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien
      .from("sessions")
      .update({ status: "selesai" })
      .eq("id", "66666666-6666-6666-6666-666666666602")
      .select();
    expect(data).toHaveLength(0); // update tersaring RLS: 0 baris berubah
  });

  it("admin bisa membaca semua clients", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data } = await admin.from("clients").select("id");
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Anonim", () => {
  it("anon tidak melihat clients", async () => {
    const { data } = await anonClient().from("clients").select("*");
    expect(data).toHaveLength(0);
  });

  it("anon TIDAK bisa insert screenings langsung", async () => {
    const { error } = await anonClient().from("screenings").insert({
      kode: "PDM-TEST-0001",
      nama: "X",
      no_hp: "0",
      fase: "prekonsepsi",
      jawaban: {},
      hasil: "hijau",
    });
    expect(error?.code).toBe("42501");
  });
});
```

- [ ] **Step 3: Jalankan**

Run: `npm test -- tests/rls-firewall.test.ts`
Expected: PASS semua. Bila ada yang gagal → perbaiki policy di migration Task 4 (`npx supabase db reset && npm run seed:users` setelah edit), BUKAN melonggarkan test.

- [ ] **Step 4: Commit**

```bash
git add web/tests
git commit -m "test(plan1): bukti RLS money-firewall & isolasi data klien"
```

---

### Task 7: Halaman login, callback OAuth, penautan klien by email

**Files:**
- Create: `web/src/app/masuk/page.tsx`, `web/src/app/masuk/form-masuk.tsx`, `web/src/app/auth/callback/route.ts`, `web/src/app/auth/keluar/route.ts`, `web/src/app/setelah-masuk/route.ts`, `web/src/app/akun-belum-terhubung/page.tsx`, `web/src/lib/auth/link-client.ts`
- Test: `web/tests/link-client.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase`/`createBrowserSupabase`/`createAdminSupabase` (Task 2), skema (Task 3), user seed (Task 5 — Rina = klien belum tertaut).
- Produces:
  - `linkClientByEmail(userId: string, email: string): Promise<boolean>` — true bila ada baris clients yang tertaut.
  - Rute `/setelah-masuk` — satu pintu pasca-login: tautkan klien → redirect sesuai peran (`owner→/owner`, `admin→/admin`, `klien→/passport`, klien tanpa data → `/akun-belum-terhubung`).

- [ ] **Step 1: Test penautan (gagal dulu)**

Buat `web/tests/link-client.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { linkClientByEmail } from "@/lib/auth/link-client";

const admin = createAdminSupabase();
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";
let createdUserId: string | null = null;

afterAll(async () => {
  // bersihkan: lepaskan tautan & hapus user uji agar test idempoten
  await admin.from("clients").update({ user_id: null }).eq("id", RINA_CLIENT_ID);
  if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
});

describe("penautan akun klien by email", () => {
  it("user baru dengan email klien terdaftar otomatis tertaut", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: "rina@padma.test",
      password: "padma-dev-123",
      email_confirm: true,
    });
    expect(error).toBeNull();
    createdUserId = data.user!.id;

    const linked = await linkClientByEmail(data.user!.id, "rina@padma.test");
    expect(linked).toBe(true);

    const { data: c } = await admin
      .from("clients").select("user_id").eq("id", RINA_CLIENT_ID).single();
    expect(c!.user_id).toBe(data.user!.id);
  });

  it("email tanpa data klien mengembalikan false", async () => {
    const linked = await linkClientByEmail(createdUserId!, "tidak-ada@padma.test");
    expect(linked).toBe(false);
  });
});
```

Run: `npm test -- tests/link-client.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth/link-client'`

- [ ] **Step 2: Implementasi penautan**

Buat `web/src/lib/auth/link-client.ts`:
```ts
import { createAdminSupabase } from "@/lib/supabase/admin";

// Menautkan auth user ke baris clients yang emailnya sama & belum tertaut.
// Dipanggil dari server (rute /setelah-masuk) — memakai service role
// karena user klien tidak punya hak update pada tabel clients.
export async function linkClientByEmail(
  userId: string,
  email: string,
): Promise<boolean> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("clients")
    .update({ user_id: userId })
    .ilike("email", email)
    .is("user_id", null)
    .select("id");
  if (error) throw error;
  if (data.length > 0) return true;
  // Sudah tertaut sebelumnya juga dihitung sukses.
  const { data: existing } = await admin
    .from("clients").select("id").eq("user_id", userId).limit(1);
  return (existing ?? []).length > 0;
}
```

Run: `npm test -- tests/link-client.test.ts` → Expected: PASS.

- [ ] **Step 3: Rute pasca-login & keluar**

Buat `web/src/app/setelah-masuk/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { linkClientByEmail } from "@/lib/auth/link-client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/masuk", url.origin));

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role ?? "klien";

  if (role === "owner") return NextResponse.redirect(new URL("/owner", url.origin));
  if (role === "admin") return NextResponse.redirect(new URL("/admin", url.origin));

  const linked = await linkClientByEmail(user.id, user.email ?? "");
  return NextResponse.redirect(
    new URL(linked ? "/passport" : "/akun-belum-terhubung", url.origin),
  );
}
```

Buat `web/src/app/auth/callback/route.ts` (untuk Google OAuth & magic link reset):
```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/setelah-masuk", url.origin));
}
```

Buat `web/src/app/auth/keluar/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/masuk", new URL(request.url).origin));
}
```

- [ ] **Step 4: Halaman /masuk**

Buat `web/src/app/masuk/page.tsx`:
```tsx
import { FormMasuk } from "./form-masuk";

export const metadata = { title: "Masuk — PADMA" };

export default function MasukPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper-warm px-4">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8">
        <h1 className="font-serif text-2xl text-night mb-1">Masuk ke PADMA</h1>
        <p className="text-sm text-ink-soft mb-6">
          Akun dibuat oleh tim PADMA saat Anda menjadi klien. Masuk dengan
          email yang terdaftar.
        </p>
        <FormMasuk />
      </div>
    </main>
  );
}
```

Buat `web/src/app/masuk/form-masuk.tsx`:
```tsx
"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function FormMasuk() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const supabase = createBrowserSupabase();

  async function masukEmail(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);
    setPesan(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setPesan("Email atau kata sandi salah. Coba lagi, atau hubungi admin PADMA.");
      setSibuk(false);
      return;
    }
    window.location.assign("/setelah-masuk");
  }

  async function masukGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <form onSubmit={masukEmail} className="space-y-4">
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Email</span>
        <input
          type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Kata sandi</span>
        <input
          type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      {pesan && <p className="text-sm text-clay">{pesan}</p>}
      <button
        type="submit" disabled={sibuk}
        className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale disabled:opacity-50"
      >
        {sibuk ? "Memproses..." : "Masuk"}
      </button>
      <button
        type="button" onClick={masukGoogle}
        className="w-full rounded-lg border border-black/15 bg-white py-3 font-bold"
      >
        Masuk dengan Google
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Halaman akun belum terhubung**

Buat `web/src/app/akun-belum-terhubung/page.tsx`:
```tsx
export const metadata = { title: "Akun belum terhubung — PADMA" };

export default function AkunBelumTerhubungPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper-warm px-4 text-center">
      <div className="max-w-md">
        <h1 className="font-serif text-2xl text-night mb-3">
          Akun Anda belum terhubung
        </h1>
        <p className="text-sm text-ink-soft mb-6">
          Email ini belum terdaftar sebagai klien PADMA. Hubungi tim PADMA via
          WhatsApp agar akun Anda didaftarkan, lalu masuk kembali dengan email
          yang sama.
        </p>
        <form action="/auth/keluar" method="post">
          <button className="rounded-lg border border-black/15 px-5 py-2.5 font-bold">
            Keluar
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Verifikasi manual + build**

1. `npm run dev`, buka `http://localhost:3000/masuk`.
2. Login `admin@padma.test` / `padma-dev-123` → diarahkan ke `/admin` (404 dulu — shell dibuat Task 8; yang penting redirect-nya benar).
3. `curl -X POST http://localhost:3000/auth/keluar -i` → 3xx ke `/masuk`.
4. `npm run build` → sukses.
5. `npm test` → semua PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src web/tests
git commit -m "feat(plan1): login email+Google, callback, keluar, penautan klien by email"
```

---

### Task 8: Guard peran + shell dashboard 3 peran

**Files:**
- Create: `web/src/lib/auth/require-role.ts`, `web/src/app/admin/layout.tsx`, `web/src/app/admin/page.tsx`, `web/src/app/owner/layout.tsx`, `web/src/app/owner/page.tsx`, `web/src/app/passport/layout.tsx`, `web/src/app/passport/page.tsx`
- Modify: `web/src/app/page.tsx` (placeholder landing → link /masuk)

**Interfaces:**
- Consumes: `createServerSupabase` (Task 2), `profiles` (Task 3).
- Produces: `requireRole(allowed: Array<"klien"|"admin"|"owner">): Promise<{ userId: string; role: string; nama: string }>` — melempar `redirect()` bila tak berhak; dipakai semua layout terproteksi di Plan 2–5. Aturan: owner boleh membuka `/admin`; admin TIDAK boleh membuka `/owner`; klien hanya `/passport`.

- [ ] **Step 1: Implementasi requireRole**

Buat `web/src/lib/auth/require-role.ts`:
```ts
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export type AppRole = "klien" | "admin" | "owner";

export async function requireRole(allowed: AppRole[]) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/masuk");

  const { data: profile } = await supabase
    .from("profiles").select("role, nama").eq("id", user.id).single();
  const role = (profile?.role ?? "klien") as AppRole;

  if (!allowed.includes(role)) redirect("/setelah-masuk");
  return { userId: user.id, role, nama: profile?.nama ?? "" };
}
```

- [ ] **Step 2: Layout & shell per peran**

Buat `web/src/app/admin/layout.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["admin", "owner"]); // owner = superset admin
  return <>{children}</>;
}
```

Buat `web/src/app/admin/page.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "Panel Admin — PADMA" };

export default async function AdminPage() {
  const { nama } = await requireRole(["admin", "owner"]);
  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl text-night">Panel Admin</h1>
      <p className="text-ink-soft mt-2">
        Halo, {nama}. Modul inbox skrining, klien, dan sesi dibangun di Plan 2–3.
      </p>
      <form action="/auth/keluar" method="post" className="mt-6">
        <button className="rounded-lg border border-black/15 px-4 py-2 font-bold">
          Keluar
        </button>
      </form>
    </main>
  );
}
```

Buat `web/src/app/owner/layout.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["owner"]);
  return <>{children}</>;
}
```

Buat `web/src/app/owner/page.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "Panel Owner — PADMA" };

export default async function OwnerPage() {
  const { nama } = await requireRole(["owner"]);
  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl text-night">Panel Owner</h1>
      <p className="text-ink-soft mt-2">
        Halo, {nama}. Rate card & rekap honor dibangun di Plan 5.
      </p>
      <form action="/auth/keluar" method="post" className="mt-6">
        <button className="rounded-lg border border-black/15 px-4 py-2 font-bold">
          Keluar
        </button>
      </form>
    </main>
  );
}
```

Buat `web/src/app/passport/layout.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export default async function PassportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["klien"]);
  return <>{children}</>;
}
```

Buat `web/src/app/passport/page.tsx`:
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "Digital Care Passport — PADMA" };

export default async function PassportPage() {
  await requireRole(["klien"]);
  const supabase = await createServerSupabase();
  const { data: klien } = await supabase
    .from("clients").select("nama, padma_id").limit(1).single();

  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl text-night">Digital Care Passport</h1>
      <p className="text-ink-soft mt-2">
        {klien ? `${klien.nama} · ${klien.padma_id}` : "Memuat..."} — isi
        passport dibangun di Plan 4.
      </p>
      <form action="/auth/keluar" method="post" className="mt-6">
        <button className="rounded-lg border border-black/15 px-4 py-2 font-bold">
          Keluar
        </button>
      </form>
    </main>
  );
}
```

Ganti isi `web/src/app/page.tsx`:
```tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-paper">
      <h1 className="font-serif text-3xl tracking-[0.3em] text-night">PADMA</h1>
      <p className="text-ink-soft text-sm">
        Landing publik dibangun di Plan 2.
      </p>
      <Link href="/masuk" className="rounded-lg bg-night px-5 py-2.5 font-bold text-gold-pale">
        Masuk
      </Link>
    </main>
  );
}
```

- [ ] **Step 3: Verifikasi manual matriks akses**

Dengan `npm run dev`:
1. `ananda@padma.test` → `/passport` menampilkan "Ananda Putri · PAD-2607-0012"; buka `/admin` → terlempar ke `/setelah-masuk` → balik ke `/passport`. ✓
2. `admin@padma.test` → `/admin` tampil; buka `/owner` → terlempar balik ke `/admin`. ✓
3. `owner@padma.test` → `/owner` tampil; buka `/admin` → tampil (owner superset). ✓
4. Tanpa login buka `/passport` → redirect `/masuk`. ✓

- [ ] **Step 4: Build & seluruh test**

Run: `npm run build` → sukses.
Run: `npm test` → semua PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(plan1): guard peran server-side + shell dashboard 3 peran"
```

---

### Task 9: README & verifikasi akhir Plan 1

**Files:**
- Create: `web/README.md`

**Interfaces:**
- Produces: instruksi menjalankan proyek yang bisa diikuti developer baru tanpa bertanya.

- [ ] **Step 1: Tulis README**

Buat `web/README.md`:
```markdown
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
```

- [ ] **Step 2: Verifikasi dari nol (simulasi developer baru)**

```bash
npx supabase db reset && npm run seed:users && npm test && npm run build
```
Expected: seluruh rangkaian sukses.

- [ ] **Step 3: Commit**

```bash
git add web/README.md
git commit -m "docs(plan1): README setup & verifikasi akhir fondasi"
```

---

## Definition of Done — Plan 1

- [ ] `npm test` hijau, termasuk `rls-firewall.test.ts` (admin & klien terbukti tidak bisa membaca/menulis tabel uang).
- [ ] Tiga akun demo login dan mendarat di dashboard perannya; matriks akses Task 8 Step 3 terpenuhi.
- [ ] `npm run build` sukses.
- [ ] Skema 15 tabel + seed dummy sesuai spec §5 & keputusan #12.
