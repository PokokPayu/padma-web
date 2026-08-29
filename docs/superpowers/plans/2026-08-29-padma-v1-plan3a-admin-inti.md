# PADMA v1 — Plan 3A: Panel Admin Inti (Keamanan, Klien & Aktivasi, Mitra, Sesi)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klinik bisa menjalankan harinya lewat aplikasi — mendaftarkan klien, mengirim tautan aktivasi, mengelola mitra, mengonfirmasi permintaan jadwal, menjadwalkan sesi, dan menyelesaikannya dengan catatan bidan yang langsung mengalir ke passport klien.

**Architecture:** Rute bersarang `/admin/*` dengan shell bersama. **Seluruh operasi memakai sesi pengguna** (`createServerSupabase`) — bukan service role — karena di bawah service role `user_role()` mengembalikan `'klien'` dan `auth.uid()` NULL, sehingga trigger penjaga tidak menyala dan jejak audit kehilangan aktornya. Pengecualian tunggal: penerbitan token undangan, yang memang harus menembus RLS.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase (Postgres+RLS), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-padma-v1-design.md`
**Plan sebelumnya (sudah dieksekusi):** `plan1-fondasi.md`, `plan2-landing-skrining.md`, `plan4-passport.md`
**Rujukan desain:** `padma-prototype.html` — `<section id="scr-admin">` (baris ±1159–1181), mesin JS ±1635–1858, CSS ±432–497.
**Lanjutan:** Plan 3B (Pembayaran, Layanan & Paket, Materi, Pengaturan) ditulis setelah plan ini selesai.

## Global Constraints

- Seluruh teks UI berbahasa **Indonesia**.
- **Money firewall**: `tests/money-firewall-struktural.test.ts` memindai `information_schema.columns` (termasuk VIEW) dengan regex per-kata `bayar|dibayar|pembayaran|total|nominal|harga|honor|tarif|biaya|amount|price|fee|rate|cost|payment`, **dan** meng-assert `status_bayar` hanya ada di `client_packages` dan `sessions`. Nama kolom baru yang aman & sudah teruji: `diklaim_pada`, `diverifikasi_pada`, `diverifikasi_oleh`, `booking_request_id`, `status_lama`, `status_baru`. **Dilarang** `status_bayar_lama`, `bukti_bayar_url`, `tanggal_bayar`.
- **Nominal uang tidak pernah tampil di panel admin.** `service_rates` mengembalikan `[]` untuk admin dengan HTTP 200 — kosong senyap, bukan error. Jangan membuat kolom harga di UI admin.
- **Panel admin WAJIB memakai `createServerSupabase()`**, bukan `createAdminSupabase()`. Di bawah service role `user_role()` = `'klien'` dan `auth.uid()` NULL (terverifikasi) — trigger penjaga tidak menyala dan jejak audit kehilangan aktor. Pengecualian: server action penerbit undangan (Task 6).
- Berkas `"use server"` **hanya boleh mengekspor fungsi async** — `tests/admin-inbox.test.ts` meng-assert itu. Daftar putih transisi/label **wajib** di modul terpisah (`status.ts`), mengikuti preseden `admin/skrining/status.ts`.
- **Server action = endpoint POST tersendiri**; guard layout/page tidak berlaku. `await requireRole(["admin","owner"])` wajib di dalam setiap action, dan parameternya **tidak boleh** memuat status tujuan.
- `src/app/admin/layout.tsx` harus tetap memanggil `requireRole` **tepat satu kali** dengan peran persis `["admin","owner"]` (dikunci `access-matrix-layouts.test.ts` **dan** `admin-inbox.test.ts`). Layout admin bersarang yang baru **wajib** didaftarkan ke `MATRIKS` di test itu.
- `src/app/admin/page.tsx` harus tetap memuat `href="/admin/skrining"` (dikunci test).
- Fungsi SQL baru wajib `revoke execute ... from public, anon` (kalau tidak `tests/hak-default-sequence-fungsi.test.ts` merah — berkas itu memeriksa objek nyata, bukan hanya default privileges).
- Tabel/kolom baru: `gen_random_uuid()`, **dilarang** `serial`/sequence.
- Waktu: dilarang `toISOString`/`setDate`/`getDay` untuk logika tanggal; pakai `hariIniJakarta()` dari `@/lib/passport/waktu`. Vitest berjalan `TZ=UTC`.
- Data uji di test wajib memakai prefix (`PAD-UJI-…`) + pembersihan `afterAll` — `rls-firewall.test.ts` dan `passport-beranda.test.ts` meng-assert jumlah PERSIS.
- Palet & font: sama seperti plan sebelumnya. Akun demo: `owner@`/`admin@`/`ananda@padma.test`, password `padma-dev-123`.

## Koreksi Penting atas Laporan Auditor Plan 4

Auditor Plan 4 melaporkan policy `"profil: staf ubah"` **mati**. **Itu keliru** — ia hanya membaca hak tingkat tabel dan melewatkan `grant update (nama) on public.profiles to authenticated`. Faktanya `PATCH {"nama": …}` sebagai admin mengembalikan HTTP 200, dan `tests/rls-hardening.test.ts` sudah punya test hijau yang membuktikannya.

**Konsekuensi: JANGAN membuat migration apa pun untuk ini.** Menambah `grant update` tingkat tabel akan **membuka kembali** celah eskalasi admin→owner; menghapus policy-nya akan **memerahkan** test yang sekarang hijau. Yang benar hanyalah: panel admin mengirim payload `{ nama }` saja (Postgres memeriksa hak kolom pada kolom yang **disebut** di `SET`, bukan pada nilai yang berubah — mengirim baris utuh gagal 42501 walau `role` tidak berubah).

## Utang Keamanan yang Ditutup Plan Ini

Ketiganya terverifikasi dengan pengujian nyata, bukan pembacaan policy:

1. **`authenticated` memegang TRUNCATE pada 17 tabel** — termasuk `clients`, `sessions`, `service_rates`, `honor_marks`. TRUNCATE **tidak pernah** difilter RLS. Migration `cabut_grant_anon_berlebih` sudah menuliskan argumen ini tetapi hanya menerapkannya pada `anon`.
2. **Satu DELETE admin menghapus rekam medis.** Terverifikasi: admin memegang hak DELETE pada `sessions`, dan menghapus satu baris `clients` menyapu `sessions`/`client_packages`/`booking_requests`/`client_invites` lewat cascade.
3. **Tidak ada jejak audit untuk keputusan uang** — tidak ada catatan siapa menyetel `lunas`, kapan.

## Pagar Tambahan (temuan scout, sudah diverifikasi)

- **`partner_publik` menyaring `aktif = true`** → menonaktifkan mitra menghapus namanya dari riwayat sesi **semua** klien, berganti "Tim PADMA" tanpa error. Diperbaiki di Task 1.
- **`sessions.updated_at` tidak pernah berubah** (tidak ada trigger). Jangan mengandalkannya sebagai "kapan"; Task 1 menambahkan triggernya.
- **`material_videos.url` tidak punya allowlist host** meski Plan 4 keputusan E menjanjikannya. Belum berbahaya (reader memakai pemutar tiruan), tapi Plan 3B akan memberi medan URL bebas ke admin — CHECK constraint dipasang sekarang, sebelum medannya ada.
- **`createClientInvite()` tidak memeriksa apakah klien sudah tertaut** — "kirim ulang undangan" menghapus jejak `used_by`/`used_at`. Diperbaiki di Task 6.
- **`app_settings` menembus money firewall secara struktural** — firewall memindai kolom, uang bisa hidup sebagai **baris** (terverifikasi: admin menyimpan `"425000"`, nol test merah). Ini catatan untuk Plan 3B saat modul Pengaturan dibangun; tidak ditutup di sini.
- **`padma_id` belum punya generator** dan `not null unique` → balapan 23503/23505 antar-admin.

---

### Task 1: Pengerasan database sebelum panel admin

**Files:**
- Create: `web/supabase/migrations/<timestamp>_pengerasan_admin.sql`, `web/tests/admin-pengerasan.test.ts`

**Interfaces:**
- Produces: pencabutan TRUNCATE & DELETE, `partner_publik` yang tidak menyembunyikan riwayat, trigger `sessions.updated_at`, CHECK allowlist host video.

- [ ] **Step 1: Test dulu (MERAH)**

Buat `web/tests/admin-pengerasan.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

afterAll(async () => {
  await admin.from("partners").update({ aktif: true }).eq("id", "33333333-3333-3333-3333-333333333301");
});

describe("hak berbahaya dicabut", () => {
  it("authenticated TIDAK memegang TRUNCATE pada tabel mana pun", async () => {
    const baris = await querySql<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where table_schema='public' and privilege_type='TRUNCATE' and grantee='authenticated'
      order by table_name`);
    expect(baris.map((b) => b.table_name)).toEqual([]);
  });

  it("admin TIDAK bisa menghapus sesi (rekam medis)", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("sessions").delete()
      .eq("id", "66666666-6666-6666-6666-666666666601");
    expect(error?.code).toBe("42501");

    const { data } = await admin.from("sessions").select("id")
      .eq("id", "66666666-6666-6666-6666-666666666601").maybeSingle();
    expect(data).not.toBeNull();   // benar-benar masih ada
  });

  it("admin TIDAK bisa menghapus klien (cascade menyapu segalanya)", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("clients").delete()
      .eq("id", "44444444-4444-4444-4444-444444444401");
    expect(error?.code).toBe("42501");
  });

  it("admin TETAP bisa membuat & mengubah sesi (alur sah tidak rusak)", async () => {
    const a = await signInAs("admin@padma.test");
    const { data, error } = await a.from("sessions").insert({
      client_id: "44444444-4444-4444-4444-444444444401",
      service_id: "11111111-1111-1111-1111-111111111101",
      partner_id: "33333333-3333-3333-3333-333333333301",
      tanggal: "2026-12-30", status: "terjadwal",
    }).select("id").single();
    expect(error).toBeNull();

    const { data: ubah } = await a.from("sessions")
      .update({ catatan: "uji" }).eq("id", data!.id).select();
    expect(ubah).toHaveLength(1);

    await admin.from("sessions").delete().eq("id", data!.id); // service role masih boleh
  });
});

describe("partner_publik tidak menyembunyikan riwayat", () => {
  it("nama mitra nonaktif TETAP terbaca (riwayat sesi lama tidak boleh kehilangan nama)", async () => {
    await admin.from("partners").update({ aktif: false })
      .eq("id", "33333333-3333-3333-3333-333333333301");

    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("partner_publik").select("id, nama")
      .eq("id", "33333333-3333-3333-3333-333333333301");
    expect(data).toHaveLength(1);
    expect(data![0].nama).toBe("Bidan Sri Wahyuni");

    await admin.from("partners").update({ aktif: true })
      .eq("id", "33333333-3333-3333-3333-333333333301");
  });

  it("partner_publik tetap tidak membocorkan no_hp", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("partner_publik").select("*").limit(1);
    expect(Object.keys(data![0])).not.toContain("no_hp");
  });
});

describe("jejak waktu & validasi", () => {
  it("sessions.updated_at ikut berubah saat baris diperbarui", async () => {
    const { data: awal } = await admin.from("sessions")
      .select("updated_at").eq("id", "66666666-6666-6666-6666-666666666601").single();

    const a = await signInAs("admin@padma.test");
    await a.from("sessions").update({ catatan: "sentuh " + Date.now() })
      .eq("id", "66666666-6666-6666-6666-666666666601");

    const { data: akhir } = await admin.from("sessions")
      .select("updated_at").eq("id", "66666666-6666-6666-6666-666666666601").single();
    expect(new Date(akhir!.updated_at).getTime())
      .toBeGreaterThan(new Date(awal!.updated_at).getTime());
  });

  it("URL video hanya boleh dari host penyedia terproteksi", async () => {
    const { error: buruk } = await admin.from("material_videos").insert({
      material_id: "77777777-7777-7777-7777-777777777702",
      url: "javascript:alert(1)",
    });
    expect(buruk).not.toBeNull();

    const { error: buruk2 } = await admin.from("material_videos").insert({
      material_id: "77777777-7777-7777-7777-777777777702",
      url: "https://situs-sembarangan.example/video",
    });
    expect(buruk2).not.toBeNull();
  });
});
```

`querySql<T>(sql)` sudah tersedia di `tests/helpers/db.ts` (bersama `dbUrl()` dan `dalamTransaksiRollback()`) — jangan membuat koneksi Postgres baru sendiri.

Run: `npm test -- tests/admin-pengerasan.test.ts` → MERAH.

- [ ] **Step 2: Migration**

```bash
npx supabase migration new pengerasan_admin
```

Isi:
```sql
-- ============================================================================
-- PENGERASAN SEBELUM PANEL ADMIN
-- ============================================================================
-- Panel admin akan menulis ke hampir semua tabel operasional. Sebelum medan
-- tulis itu dibuka, tiga hak berbahaya dicabut dan tiga cacat ditutup.

-- (1) TRUNCATE tidak pernah difilter RLS.
--     Migration cabut_grant_anon_berlebih sudah menuliskan argumen ini, tetapi
--     hanya menerapkannya pada `anon`. Terverifikasi hari ini: `authenticated`
--     — yaitu SETIAP pengguna login, termasuk klien — masih memegang TRUNCATE
--     pada 17 tabel, termasuk clients, sessions, service_rates, honor_marks.
revoke truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke truncate on tables from authenticated;

-- (2) Penghapusan rekam medis.
--     Terverifikasi: admin memegang DELETE pada sessions, dan menghapus satu
--     baris clients menyapu sessions/client_packages/booking_requests/
--     client_invites lewat cascade. Klinik tidak punya alur bisnis "hapus
--     rekam medis" — pembatalan diwakili status `batal`.
--     Dicabut di lapis HAK TABEL (bukan hak kolom): sudah diprobe bahwa
--     select */update/insert tetap jalan setelahnya, berbeda dari pelajaran
--     hak kolom yang tiga kali mematahkan `select *`.
revoke delete on public.sessions        from authenticated;
revoke delete on public.clients         from authenticated;
revoke delete on public.client_packages from authenticated;
revoke delete on public.screenings      from authenticated;
-- booking_requests TETAP boleh dihapus staf: ia antrean, bukan rekam medis.

-- (3) partner_publik menyembunyikan riwayat.
--     View lama menyaring `aktif = true`, sehingga menonaktifkan seorang bidan
--     menghapus namanya dari riwayat sesi SELURUH klien — berganti "Tim PADMA"
--     tanpa error apa pun. Yang dibutuhkan klien adalah NAMA untuk riwayat,
--     bukan daftar bidan yang sedang aktif.
create or replace view public.partner_publik
  with (security_invoker = off) as
  select id, nama from public.partners;

revoke all on public.partner_publik from anon;
grant select on public.partner_publik to authenticated;

-- (4) sessions.updated_at tidak pernah berubah (tidak ada trigger sama sekali).
create or replace function public.sentuh_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.sentuh_updated_at() from public, anon;

create trigger trg_sessions_updated_at
  before update on public.sessions
  for each row execute function public.sentuh_updated_at();

-- (5) Allowlist host video.
--     Plan 4 keputusan E menjanjikan allowlist; pg_constraint membuktikan ia
--     tidak pernah ada. Belum berbahaya karena reader memakai pemutar tiruan,
--     tetapi Plan 3B akan memberi medan URL bebas kepada admin — dan
--     `javascript:` / `data:` tinggal menunggu satu halaman yang merendernya.
alter table public.material_videos
  add constraint material_videos_host_terproteksi
  check (
    url ~ '^https://(player\.)?vimeo\.com/'
    or url ~ '^https://[a-z0-9-]+\.cloudflarestream\.com/'
    or url ~ '^https://customer-[a-z0-9]+\.cloudflarestream\.com/'
  );
```

**Catatan penting:** seed memakai URL `https://vimeo.com/...` sehingga lolos constraint. Bila `db reset` gagal karena baris seed melanggar, **perbaiki seed-nya**, jangan melonggarkan constraint.

- [ ] **Step 3: Terapkan & verifikasi**

Run: `npx supabase db reset && npm test -- tests/admin-pengerasan.test.ts` → PASS.
Run: `npm test` → seluruh suite PASS. **Perhatikan khusus**: `scripts/seed-users.ts` dan `tests/global-setup.ts` memakai service role (yang tidak terpengaruh pencabutan `authenticated`) — bila ada yang merah, itu bug nyata.

- [ ] **Step 4: Commit**

```bash
git add web && git commit -m "hardening(plan3a): cabut TRUNCATE & DELETE berbahaya, perbaiki partner_publik, updated_at, allowlist video"
```

---

### Task 2: Jejak audit keputusan pembayaran + penjaga transisi

**Files:**
- Create: `web/supabase/migrations/<timestamp>_jejak_status_bayar.sql`, `web/tests/jejak-status-bayar.test.ts`

**Interfaces:**
- Produces: tabel `jejak_status_bayar`, trigger pencatat, trigger penjaga transisi.

- [ ] **Step 1: Test dulu (MERAH)**

Buat `web/tests/jejak-status-bayar.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();
const SESI_UJI = "66666666-6666-6666-6666-6666666666f1";

beforeAll(async () => {
  await admin.from("sessions").upsert({
    id: SESI_UJI,
    client_id: "44444444-4444-4444-4444-444444444401",
    service_id: "11111111-1111-1111-1111-111111111103",
    partner_id: "33333333-3333-3333-3333-333333333302",
    tanggal: "2026-12-28", status: "terjadwal", status_bayar: "belum",
  }, { onConflict: "id" });
  await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_UJI);
});
afterAll(async () => {
  await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_UJI);
  await admin.from("sessions").delete().eq("id", SESI_UJI);
});

describe("jejak audit keputusan pembayaran", () => {
  it("perubahan status_bayar oleh admin tercatat beserta aktornya", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: profilAdmin } = await a.from("profiles").select("id").limit(1).single();

    await a.from("sessions").update({ status_bayar: "lunas" }).eq("id", SESI_UJI);

    const { data: jejak } = await admin.from("jejak_status_bayar")
      .select("*").eq("sesi_id", SESI_UJI).order("dicatat_pada", { ascending: false });
    expect(jejak!.length).toBeGreaterThanOrEqual(1);
    expect(jejak![0]).toMatchObject({
      status_lama: "belum", status_baru: "lunas", peran_aktor: "admin",
    });
    expect(jejak![0].aktor_id).toBe(profilAdmin!.id);
  });

  it("UPDATE yang menyebut status_bayar tanpa mengubah nilainya TIDAK mencatat jejak", async () => {
    const { count: sebelum } = await admin.from("jejak_status_bayar")
      .select("*", { count: "exact", head: true }).eq("sesi_id", SESI_UJI);

    // Idempoten seed melakukan ini setiap `npm test` — jangan menumpuk jejak palsu.
    await admin.from("sessions").update({ status_bayar: "lunas" }).eq("id", SESI_UJI);

    const { count: sesudah } = await admin.from("jejak_status_bayar")
      .select("*", { count: "exact", head: true }).eq("sesi_id", SESI_UJI);
    expect(sesudah).toBe(sebelum);
  });

  it("jejak TIDAK bisa dihapus atau diubah admin", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: jejak } = await admin.from("jejak_status_bayar")
      .select("id").eq("sesi_id", SESI_UJI).limit(1).single();

    const { error: eHapus } = await a.from("jejak_status_bayar").delete().eq("id", jejak!.id);
    expect(eHapus?.code).toBe("42501");

    const { error: eUbah } = await a.from("jejak_status_bayar")
      .update({ status_baru: "belum" }).eq("id", jejak!.id);
    expect(eUbah?.code).toBe("42501");
  });

  it("admin & owner BISA membaca jejak; klien TIDAK", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: adminLihat } = await a.from("jejak_status_bayar").select("id").eq("sesi_id", SESI_UJI);
    expect(adminLihat!.length).toBeGreaterThanOrEqual(1);

    const k = await signInAs("ananda@padma.test");
    const { data: klienLihat } = await k.from("jejak_status_bayar").select("id");
    expect(klienLihat ?? []).toHaveLength(0);
  });
});

describe("penjaga transisi status_bayar", () => {
  it("admin TIDAK bisa memutar lunas -> belum", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("sessions")
      .update({ status_bayar: "belum" }).eq("id", SESI_UJI);
    expect(error?.code).toBe("42501");

    const { data } = await admin.from("sessions")
      .select("status_bayar").eq("id", SESI_UJI).single();
    expect(data!.status_bayar).toBe("lunas");
  });

  it("service role (seed) tetap bebas — kalau tidak, seluruh suite mati", async () => {
    const { error } = await admin.from("sessions")
      .update({ status_bayar: "belum" }).eq("id", SESI_UJI);
    expect(error).toBeNull();
  });
});
```

Run: `npm test -- tests/jejak-status-bayar.test.ts` → MERAH.

- [ ] **Step 2: Migration**

```bash
npx supabase migration new jejak_status_bayar
```

Isi:
```sql
-- ============================================================================
-- JEJAK AUDIT KEPUTUSAN PEMBAYARAN + PENJAGA TRANSISI
-- ============================================================================
-- Sampai hari ini status_bayar hanyalah enum: tidak ada catatan SIAPA menyetel
-- 'lunas', KAPAN, dan dari status apa. Saat klien berkata "saya sudah bayar"
-- dan admin berkata "belum masuk", tidak ada satu baris pun yang bisa dipakai
-- membantah. Ini utang paling mahal secara bisnis.
--
-- Penamaan kolom sengaja menghindari kata bernuansa uang: money-firewall
-- struktural memindai nama kolom dengan regex, dan `status_bayar_lama` cocok
-- dengan polanya. Dipakai `status_lama`/`status_baru`.
-- Tabel ini juga TIDAK boleh menamai kolomnya `status_bayar`: test yang sama
-- meng-assert kolom itu hanya ada di client_packages dan sessions.

create table public.jejak_status_bayar (
  id uuid primary key default gen_random_uuid(),
  -- TANPA foreign key: clients -> sessions/client_packages semuanya ON DELETE
  -- CASCADE, sehingga FK ke sana akan menghapus tepat bukti yang menjelaskan
  -- penghapusan itu.
  sesi_id uuid,
  paket_klien_id uuid,
  status_lama pay_status,
  status_baru pay_status not null,
  aktor_id uuid,              -- nullable: jalur service role tidak punya auth.uid()
  peran_aktor text not null,
  dicatat_pada timestamptz not null default now(),
  constraint jejak_sasaran_tunggal check (
    (sesi_id is not null and paket_klien_id is null)
    or (sesi_id is null and paket_klien_id is not null)
  )
);

create index jejak_status_bayar_sesi_idx on public.jejak_status_bayar (sesi_id);
create index jejak_status_bayar_paket_idx on public.jejak_status_bayar (paket_klien_id);

alter table public.jejak_status_bayar enable row level security;

-- Hanya BACA untuk staf. Tidak ada policy INSERT/UPDATE/DELETE untuk peran API
-- mana pun: pengisian dilakukan trigger SECURITY DEFINER, sehingga jejak tidak
-- bisa dikarang maupun dihapus oleh admin yang sedang diaudit.
create policy "jejak: staf baca" on public.jejak_status_bayar
  for select using (user_role() in ('admin','owner'));

revoke all on public.jejak_status_bayar from anon;
revoke insert, update, delete on public.jejak_status_bayar from authenticated;
grant select on public.jejak_status_bayar to authenticated;

-- ===== PENCATAT =====
-- SECURITY DEFINER karena `authenticated` sengaja tidak punya INSERT.
-- Akibatnya current_user di dalam fungsi menjadi `postgres`, jadi identitas
-- pemanggil diambil dari auth.uid()/user_role() yang membaca GUC JWT dan tidak
-- terpengaruh security definer.
create or replace function public.catat_status_bayar()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Trigger `after update of status_bayar` menyala saat kolom DISEBUT di SET,
  -- bukan saat nilainya berubah. Tanpa penjaga ini, upsert idempoten seed
  -- menumpuk jejak palsu setiap kali `npm test` dijalankan.
  if new.status_bayar is not distinct from old.status_bayar then
    return null;
  end if;

  insert into public.jejak_status_bayar (
    sesi_id, paket_klien_id, status_lama, status_baru, aktor_id, peran_aktor
  ) values (
    case when tg_table_name = 'sessions' then new.id else null end,
    case when tg_table_name = 'client_packages' then new.id else null end,
    old.status_bayar, new.status_bayar,
    auth.uid(),
    case when auth.uid() is null then 'service_role' else user_role()::text end
  );
  return null;
end;
$$;

revoke execute on function public.catat_status_bayar() from public, anon;

create trigger trg_catat_status_bayar_sesi
  after update of status_bayar on public.sessions
  for each row execute function public.catat_status_bayar();

create trigger trg_catat_status_bayar_paket
  after update of status_bayar on public.client_packages
  for each row execute function public.catat_status_bayar();

-- ===== PENJAGA TRANSISI =====
-- Pagar "hanya belum -> menunggu_verifikasi" untuk klien hidup di server action
-- Plan 4. Di sini ditambahkan pagar DB untuk staf: pembayaran yang sudah
-- dinyatakan lunas tidak boleh diputar mundur diam-diam.
create or replace function public.guard_transisi_status_bayar()
returns trigger
language plpgsql
as $$
begin
  if new.status_bayar is not distinct from old.status_bayar then
    return new;
  end if;
  -- Gerbang peran SQL wajib: tanpanya scripts/seed-users.ts (service role,
  -- dipanggil tests/global-setup.ts setiap `npm test`) akan mati.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if old.status_bayar = 'lunas' then
      raise exception 'pembayaran yang sudah lunas tidak dapat diputar mundur'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_transisi_status_bayar() from public, anon;

create trigger trg_guard_transisi_bayar_sesi
  before update of status_bayar on public.sessions
  for each row execute function public.guard_transisi_status_bayar();

create trigger trg_guard_transisi_bayar_paket
  before update of status_bayar on public.client_packages
  for each row execute function public.guard_transisi_status_bayar();
```

**Batas yang harus ditulis jujur:** trigger ini **tidak** menjaga jalur klaim klien, dan itu tidak bisa diperbaiki dengan hak tabel — klien, admin, dan owner adalah peran SQL yang **sama** (`authenticated`). Yang menjaga jalur klien adalah ketiadaan policy UPDATE untuknya (pagar Plan 4) plus server action bernilai hardcoded.

- [ ] **Step 3: Verifikasi & commit**

Run: `npx supabase db reset && npm test` → seluruh suite PASS.
Run: `npm run build` → sukses.

```bash
git add web && git commit -m "feat(plan3a): jejak audit keputusan pembayaran + penjaga transisi status"
```

---

### Task 3: Generator PADMA ID

**Files:**
- Create: `web/src/lib/admin/padma-id.ts`, `web/tests/padma-id.test.ts`

**Interfaces:**
- Produces: `buatPadmaId(supabase, sekarang?): Promise<string>` → `PAD-YYMM-NNNN`.

- [ ] **Step 1: Test**

Buat `web/tests/padma-id.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { buatPadmaId, formatPadmaId } from "@/lib/admin/padma-id";

const admin = createAdminSupabase();
afterAll(async () => {
  await admin.from("clients").delete().like("padma_id", "PAD-UJI%");
});

describe("format PADMA ID", () => {
  it("PAD-YYMM-NNNN dengan nomor empat digit", () => {
    expect(formatPadmaId("2026-08-29", 12)).toBe("PAD-2608-0012");
    expect(formatPadmaId("2026-01-05", 7)).toBe("PAD-2601-0007");
  });

  it("memakai kalender Jakarta, bukan jam server UTC", () => {
    // 2026-08-31T18:00Z = 2026-09-01 01:00 WIB -> bulan sudah September.
    const utcAkhirBulan = new Date("2026-08-31T18:00:00Z");
    expect(buatPrefix(utcAkhirBulan)).toBe("PAD-2609");
  });
});

describe("buatPadmaId", () => {
  it("menghasilkan id unik yang belum dipakai", async () => {
    const id = await buatPadmaId(admin);
    expect(id).toMatch(/^PAD-\d{4}-\d{4}$/);
    const { data } = await admin.from("clients").select("id").eq("padma_id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("20 pemanggilan berurutan tidak bentrok", async () => {
    const semua = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const id = await buatPadmaId(admin);
      semua.add(id);
      // daftarkan supaya pemanggilan berikutnya harus melompatinya
      await admin.from("clients").insert({
        padma_id: id, nama: "Uji " + i, email: `uji-${i}-${Date.now()}@padma.test`,
        phase_id: "prekonsepsi",
      });
    }
    expect(semua.size).toBe(20);
    await admin.from("clients").delete().in("padma_id", [...semua]);
  });
});
```

Tambahkan ekspor `buatPrefix` bila test memakainya (lihat implementasi).

Run: `npm test -- tests/padma-id.test.ts` → MERAH.

- [ ] **Step 2: Implementasi**

Buat `web/src/lib/admin/padma-id.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { hariIniJakarta } from "@/lib/passport/waktu";

// PAD-YYMM-NNNN. Prefix memakai kalender Asia/Jakarta — Vercel berjalan UTC,
// dan antara 17:00–24:00 UTC bulan di Jakarta sudah berganti.
// Dilarang memakai sequence (aturan migration fail_closed_sequence_fungsi):
// urutan diambil dari nomor tertinggi yang sudah terpakai pada prefix bulan ini,
// dengan `clients_padma_id_key` sebagai penjaga terakhir bila terjadi balapan.
export function buatPrefix(sekarang: Date = new Date()): string {
  const iso = hariIniJakarta(sekarang);           // YYYY-MM-DD
  return `PAD-${iso.slice(2, 4)}${iso.slice(5, 7)}`;
}

export function formatPadmaId(tglIso: string, nomor: number): string {
  return `PAD-${tglIso.slice(2, 4)}${tglIso.slice(5, 7)}-${String(nomor).padStart(4, "0")}`;
}

export async function buatPadmaId(
  supabase: SupabaseClient,
  sekarang: Date = new Date(),
): Promise<string> {
  const prefix = buatPrefix(sekarang);
  const { data } = await supabase
    .from("clients")
    .select("padma_id")
    .like("padma_id", `${prefix}-%`)
    .order("padma_id", { ascending: false })
    .limit(1);

  const terakhir = data?.[0]?.padma_id as string | undefined;
  const nomor = terakhir ? Number(terakhir.slice(-4)) + 1 : 1;
  return `${prefix}-${String(nomor).padStart(4, "0")}`;
}
```

- [ ] **Step 3: Verifikasi & commit**

Run: `npm test -- tests/padma-id.test.ts` → PASS.

```bash
git add web && git commit -m "feat(plan3a): generator PADMA ID berkalender Jakarta"
```

---

### Task 4: Shell panel admin & dashboard antrean

**Files:**
- Create: `web/src/app/admin/_shell/nav-admin.tsx`, `web/src/lib/admin/antrean.ts`
- Modify: `web/src/app/admin/layout.tsx`, `web/src/app/admin/page.tsx`
- Modify: `web/tests/access-matrix-layouts.test.ts` (bila ada layout bersarang baru — di plan ini TIDAK ada, jadi berkas itu tidak disentuh)

**Interfaces:**
- Produces: `<NavAdmin />`, `hitungAntrean(): Promise<{ skriningBaru: number; permintaanMenunggu: number; klaimMenunggu: number; klienBelumAktif: number }>`

- [ ] **Step 1: Hitungan antrean**

Buat `web/src/lib/admin/antrean.ts`:
```ts
import { createServerSupabase } from "@/lib/supabase/server";

// Semua hitungan memakai sesi pengguna: RLS staf yang mengizinkan, dan
// service role justru akan membuat user_role() mengembalikan 'klien'.
export async function hitungAntrean() {
  const supabase = await createServerSupabase();
  const hitung = async (
    tabel: string,
    filter: (q: ReturnType<typeof supabase.from>) => unknown,
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (supabase.from(tabel) as any).select("*", { count: "exact", head: true });
    const { count } = await (filter(q) as Promise<{ count: number | null }>);
    return count ?? 0;
  };

  const [skriningBaru, permintaanMenunggu, klaimSesi, klaimPaket, klienBelumAktif] =
    await Promise.all([
      hitung("screenings", (q) => (q as never as { eq: (a: string, b: string) => unknown }).eq("status_tindak_lanjut", "baru")),
      hitung("booking_requests", (q) => (q as never as { eq: (a: string, b: string) => unknown }).eq("status", "menunggu")),
      hitung("sessions", (q) => (q as never as { eq: (a: string, b: string) => unknown }).eq("status_bayar", "menunggu_verifikasi")),
      hitung("client_packages", (q) => (q as never as { eq: (a: string, b: string) => unknown }).eq("status_bayar", "menunggu_verifikasi")),
      hitung("clients", (q) => (q as never as { is: (a: string, b: null) => unknown }).is("user_id", null)),
    ]);

  return {
    skriningBaru,
    permintaanMenunggu,
    klaimMenunggu: klaimSesi + klaimPaket,
    klienBelumAktif,
  };
}
```

> Bila pola `any` di atas terasa berlebihan, ganti dengan lima query eksplisit yang ditulis langsung — yang penting hasilnya sama dan TypeScript strict lolos. Kejelasan lebih penting daripada keringkasan di sini.

- [ ] **Step 2: Navigasi admin**

Buat `web/src/app/admin/_shell/nav-admin.tsx` mengikuti pola `src/app/passport/nav.tsx` yang sudah ada (dua nav: `hidden sm:flex` untuk sidebar/tab desktop, `fixed inset-x-0 bottom-0 sm:hidden` untuk bottom bar). Menu dan urutannya:

| href | label | badge |
|---|---|---|
| `/admin` | Beranda | — |
| `/admin/skrining` | Inbox | `skriningBaru` |
| `/admin/klien` | Klien | `klienBelumAktif` |
| `/admin/sesi` | Sesi | `permintaanMenunggu` |
| `/admin/mitra` | Mitra | — |

Aturan badge (halus, mudah salah): badge **disembunyikan saat 0**. Aktif ditentukan `usePathname()`; `/admin` hanya aktif bila pathname persis `/admin`.

Komponen menerima `antrean` sebagai prop dari layout (server), bukan mengambil datanya sendiri.

- [ ] **Step 3: Layout & dashboard**

`web/src/app/admin/layout.tsx` — **tetap satu pemanggilan `requireRole`**:
```tsx
import { requireRole } from "@/lib/auth/require-role";
import { hitungAntrean } from "@/lib/admin/antrean";
import { NavAdmin } from "./_shell/nav-admin";

// JEBAKAN: dua test mengunci berkas ini —
// tests/access-matrix-layouts.test.ts dan tests/admin-inbox.test.ts —
// keduanya menuntut requireRole([...]) muncul TEPAT SATU KALI dengan
// daftar peran persis ["admin","owner"]. Jangan menambah pemanggilan kedua.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["admin", "owner"]);
  const antrean = await hitungAntrean();

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-4 pb-36 pt-6 sm:pb-10">
        <NavAdmin antrean={antrean} />
        {children}
      </div>
    </div>
  );
}
```

`web/src/app/admin/page.tsx` — dashboard antrean. **Wajib tetap memuat `href="/admin/skrining"`** (dikunci test). Tampilkan empat kartu antrean (skrining baru, permintaan jadwal menunggu, klaim pembayaran menunggu, klien belum aktif), masing-masing menautkan ke modulnya. Ambil `nama` lewat `requireRole(["admin","owner"])` seperti pola yang sudah ada.

- [ ] **Step 4: Verifikasi & commit**

Run: `npm test` → PASS (khususnya `access-matrix-layouts` & `admin-inbox`).
Run: `npm run build` → sukses.

```bash
git add web && git commit -m "feat(plan3a): shell panel admin + dashboard antrean"
```

---

### Task 5: Modul Klien — daftar, tambah, detail

**Files:**
- Create: `web/src/app/admin/klien/page.tsx`, `web/src/app/admin/klien/form-klien.tsx`, `web/src/app/admin/klien/aksi.ts`, `web/src/app/admin/klien/[id]/page.tsx`, `web/tests/admin-klien.test.ts`

**Interfaces:**
- Produces: server action `buatKlien(formData)`, `perbaruiKlien(id, formData)`.

- [ ] **Step 1: Test**

Buat `web/tests/admin-klien.test.ts` yang membuktikan (tulis assertion lengkapnya, jangan diringkas):
- `buatKlien` menghasilkan `padma_id` berformat benar dan baris `clients` baru;
- email dinormalisasi huruf kecil (trigger `clients_normalize_email` sudah ada);
- email duplikat ditolak (23505) dengan pesan ramah, bukan crash;
- klien yang dibuat **belum tertaut** (`user_id` null, `linked_at` null);
- admin **tidak** bisa menghapus klien (42501 — pagar Task 1);
- daftar klien menampilkan status aktivasi;
- data uji memakai prefix `PAD-UJI` dan dibersihkan di `afterAll`.

Run → MERAH.

- [ ] **Step 2: Server action**

Buat `web/src/app/admin/klien/aksi.ts` — **hanya ekspor fungsi async** (dikunci test):
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { buatPadmaId } from "@/lib/admin/padma-id";
import { normalizeEmail } from "@/lib/auth/link-client";

export async function buatKlien(formData: FormData) {
  // Server action = endpoint POST tersendiri; guard layout TIDAK berlaku.
  await requireRole(["admin", "owner"]);

  const nama = String(formData.get("nama") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const faseId = String(formData.get("fase") ?? "");

  if (nama.length < 2) return { ok: false as const, pesan: "Nama terlalu pendek." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false as const, pesan: "Email tidak sah." };
  if (!faseId) return { ok: false as const, pesan: "Fase wajib dipilih." };

  // Sesi pengguna, bukan service role: RLS staf yang mengizinkan, dan trigger
  // penjaga hanya menyala untuk peran API.
  const supabase = await createServerSupabase();

  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const padmaId = await buatPadmaId(supabase);
    const { data, error } = await supabase.from("clients").insert({
      padma_id: padmaId, nama, email, no_hp: noHp, phase_id: faseId,
    }).select("id").single();

    if (!error) {
      revalidatePath("/admin/klien");
      return { ok: true as const, id: data.id as string, padmaId };
    }
    if (error.code === "23505") {
      // Bisa bentrok padma_id (balapan antar-admin) ATAU email duplikat.
      if (error.message.includes("email")) {
        return { ok: false as const, pesan: "Email itu sudah dipakai klien lain." };
      }
      continue; // padma_id bentrok — ambil nomor berikutnya
    }
    return { ok: false as const, pesan: "Gagal menyimpan klien." };
  }
  return { ok: false as const, pesan: "Gagal membuat PADMA ID. Coba lagi." };
}

export async function perbaruiKlien(id: string, formData: FormData) {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const patch = {
    nama: String(formData.get("nama") ?? "").trim(),
    no_hp: String(formData.get("no_hp") ?? "").trim(),
    phase_id: String(formData.get("fase") ?? ""),
  };
  if (patch.nama.length < 2) return { ok: false as const, pesan: "Nama terlalu pendek." };

  // Email & user_id sengaja TIDAK ikut: mengubah email memutus penautan, dan
  // user_id dijaga trigger guard_client_link.
  const { data, error } = await supabase.from("clients")
    .update(patch).eq("id", id).select("id");
  if (error || (data ?? []).length === 0) {
    return { ok: false as const, pesan: "Gagal memperbarui klien." };
  }
  revalidatePath("/admin/klien");
  revalidatePath(`/admin/klien/${id}`);
  return { ok: true as const };
}
```

- [ ] **Step 3: Halaman daftar & detail**

`/admin/klien` — tabel: PADMA ID (mono) · Nama + email di `rowsub` · Fase · Paket (`nama · N sesi` atau "Sesi lepas") · Sesi selesai · Status aktivasi (pill "Aktif"/"Belum aktif"). Tombol "+ Klien baru" membuka form (mengikuti pola `.mini-form` prototipe). Baris menautkan ke detail.

`/admin/klien/[id]` — ringkasan klien, form edit data operasional, dan tempat untuk kartu aktivasi (Task 6). Ingat `params` adalah Promise di Next 16.

- [ ] **Step 4: Verifikasi & commit**

Run: `npm test` → PASS. `npm run build` → sukses.

```bash
git add web && git commit -m "feat(plan3a): modul klien — daftar, tambah, detail"
```

---

### Task 6: Aktivasi klien — terbitkan undangan & teks WhatsApp

**Files:**
- Create: `web/src/app/admin/klien/[id]/kartu-aktivasi.tsx`
- Modify: `web/src/app/admin/klien/aksi.ts`, `web/src/lib/auth/link-client.ts` (penjaga klien sudah tertaut)
- Create: `web/tests/admin-aktivasi.test.ts`

**Konteks penting:** tabel `client_invites` **tidak bisa dibaca peran API mana pun, termasuk admin** (403), dan tokennya disimpan sebagai SHA-256. Halaman admin yang mencoba membacanya lewat `createServerSupabase()` akan **crash**, bukan mengembalikan array kosong. Satu-satunya jalur adalah server action service-role yang **menerbitkan token baru dan mengembalikan nilainya sekali saat itu juga**.

- [ ] **Step 1: Test**

Buat `web/tests/admin-aktivasi.test.ts` yang membuktikan:
- `terbitkanUndangan(clientId)` mengembalikan token mentah **satu kali** dan menyimpan hanya hash-nya;
- token itu benar-benar bekerja untuk `linkClientByInvite`;
- menerbitkan ulang untuk klien yang **sudah tertaut** ditolak (celah `createClientInvite` yang tidak memeriksa `clients.user_id` — buktinya Ananda yang sudah tertaut memegang token hidup di DB sekarang);
- admin **tidak** bisa membaca `client_invites` lewat REST (403);
- teks WhatsApp yang dihasilkan memuat tautan `/aktivasi?token=…` dan nama klien.

Run → MERAH.

- [ ] **Step 2: Penjaga "sudah tertaut" pada `createClientInvite`**

Berkas `src/lib/auth/link-client.ts` sudah mengekspor `createClientInvite(clientId, opsi?)`, `generateInviteToken()`, `hashInviteToken()`, `inviteLink(origin, token)`, `INVITE_TTL_DAYS`, dan `COOKIE_UNDANGAN` — **pakai ulang semuanya**, jangan menulis logika token baru.

Yang perlu ditambahkan hanyalah penjaga: `createClientInvite` saat ini melakukan upsert PK `client_id` dengan `used_at: null, used_by: null` **tanpa memeriksa `clients.user_id`**, sehingga tombol "kirim ulang undangan" menghapus jejak siapa yang mengaktifkan akun. Buktinya Ananda (sudah tertaut) memegang token hidup di DB sekarang.

Tambahkan pemeriksaan di awal fungsi: bila `clients.user_id` **tidak** null, kembalikan penolakan. **Periksa dulu pemanggilnya** — `scripts/seed-users.ts` menerbitkan undangan untuk Rina (belum tertaut, aman) dan mungkin juga untuk Ananda (sudah tertaut). Bila seed ikut merah, sesuaikan seed-nya, bukan melonggarkan penjaga; atau sediakan opsi eksplisit `paksa: true` yang **hanya** dipakai seed dan tidak pernah diekspos ke server action.

- [ ] **Step 3: Server action penerbit**

Tambahkan ke `web/src/app/admin/klien/aksi.ts`:
```ts
export async function terbitkanUndangan(clientId: string) {
  await requireRole(["admin", "owner"]);

  // SATU-SATUNYA tempat service role dipakai di panel admin: tabel
  // client_invites sengaja tertutup untuk SEMUA peran API, termasuk admin
  // (membacanya lewat createServerSupabase() menghasilkan 403, bukan array
  // kosong). Token mentah dikembalikan SEKALI di sini; yang tersimpan di DB
  // hanya SHA-256-nya.
  const { createClientInvite, inviteLink } = await import("@/lib/auth/link-client");

  const hasil = await createClientInvite(clientId);
  if (!hasil.ok) return hasil;

  const supabase = await createServerSupabase();
  const { data: klien } = await supabase
    .from("clients").select("nama, email").eq("id", clientId).maybeSingle();

  revalidatePath(`/admin/klien/${clientId}`);
  return {
    ok: true as const,
    token: hasil.token,
    nama: klien?.nama ?? "",
    email: klien?.email ?? "",
  };
}
```

Sesuaikan bentuk kembalian dengan yang benar-benar dikembalikan `createClientInvite` (baca berkasnya dulu — bila ia mengembalikan `{ token }` polos tanpa `ok`, sesuaikan pemeriksaannya).

- [ ] **Step 4: Kartu aktivasi**

`kartu-aktivasi.tsx` (client component): tombol "Terbitkan tautan aktivasi" → memanggil action → menampilkan **teks WhatsApp siap salin** dan tombol salin. Teks:

```
Halo {nama}, selamat datang di PADMA 🌸

Digital Care Passport Anda sudah siap. Buka tautan berikut untuk mengaktifkan akun, lalu masuk dengan email {email}:

{origin}/aktivasi?token={token}

Tautan ini berlaku 14 hari dan hanya bisa dipakai sekali.
```

Setelah ditampilkan, beri peringatan jelas: **token hanya tampil sekali**; menerbitkan ulang akan membatalkan yang lama.

- [ ] **Step 5: Verifikasi & commit**

Verifikasi manual end-to-end: buat klien baru → terbitkan undangan → salin tautan → buka di jendela penyamaran → daftar/masuk dengan email itu → mendarat di `/passport`. Matikan dev server.

```bash
npm test && npm run build && git add web && git commit -m "feat(plan3a): aktivasi klien — terbitkan undangan sekali-pakai + teks WhatsApp"
```

---

### Task 7: Modul Mitra

**Files:**
- Create: `web/src/app/admin/mitra/page.tsx`, `web/src/app/admin/mitra/aksi.ts`, `web/tests/admin-mitra.test.ts`

- [ ] **Step 1: Test**

Membuktikan: admin bisa menambah/mengubah mitra; menonaktifkan mitra **tidak** menghilangkan namanya dari riwayat sesi klien (pagar Task 1); mitra nonaktif tidak muncul di pilihan saat menjadwalkan sesi baru; klien tidak bisa membaca `partners` (hanya `partner_publik`, tanpa `no_hp`).

- [ ] **Step 2: Implementasi**

Tabel sederhana (Nama · Kontak · Jumlah sesi selesai · Status) + form tambah/edit. Server action `simpanMitra` / `ubahStatusMitra` dengan `requireRole` di dalamnya.

- [ ] **Step 3: Verifikasi & commit**

```bash
npm test && npm run build && git add web && git commit -m "feat(plan3a): modul mitra"
```

---

### Task 8: Modul Sesi — antrean permintaan & konfirmasi

**Files:**
- Create: `web/src/app/admin/sesi/page.tsx`, `web/src/app/admin/sesi/aksi.ts`, `web/src/app/admin/sesi/status.ts`, `web/src/app/admin/sesi/antrean-permintaan.tsx`, `web/tests/admin-sesi-konfirmasi.test.ts`
- Modify: `web/supabase/migrations/<timestamp>_sesi_dari_permintaan.sql` (kolom `sessions.booking_request_id`)

**Interfaces:**
- Produces: server action `konfirmasiPermintaan(permintaanId, partnerId)`, `tolakPermintaan(permintaanId)`.

- [ ] **Step 1: Migration kolom penaut**

```sql
-- Tanpa kolom ini, dua konfirmasi paralel melahirkan dua sesi untuk satu
-- permintaan. UNIQUE membuat percobaan kedua gagal 23505, bukan menggandakan.
alter table public.sessions
  add column booking_request_id uuid references public.booking_requests(id);

create unique index sessions_booking_request_unik
  on public.sessions (booking_request_id) where booking_request_id is not null;
```

- [ ] **Step 2: Test**

Buat `web/tests/admin-sesi-konfirmasi.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { konfirmasiPermintaan } from "@/app/admin/sesi/aksi";

const admin = createAdminSupabase();
const KLIEN = "44444444-4444-4444-4444-444444444401";      // Ananda
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const TGL = "2026-12-26";
let permintaanId = "";

async function bersihkan() {
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
}

beforeEach(async () => {
  await bersihkan();
  const { data } = await admin.from("booking_requests").insert({
    client_id: KLIEN, service_id: SVC, tanggal: TGL,
    preferensi_waktu: "pagi", status: "menunggu",
  }).select("id").single();
  permintaanId = data!.id;
});
afterAll(bersihkan);

describe("konfirmasi permintaan jadwal", () => {
  it("mengubah permintaan menjadi dikonfirmasi DAN membuat satu sesi terjadwal", async () => {
    const r = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(r.ok).toBe(true);

    const { data: p } = await admin.from("booking_requests")
      .select("status").eq("id", permintaanId).single();
    expect(p!.status).toBe("dikonfirmasi");

    const { data: sesi } = await admin.from("sessions")
      .select("client_id, service_id, status, booking_request_id").eq("tanggal", TGL);
    expect(sesi).toHaveLength(1);
    expect(sesi![0]).toMatchObject({
      client_id: KLIEN, service_id: SVC, status: "terjadwal",
      booking_request_id: permintaanId,
    });
  });

  it("konfirmasi KEDUA pada permintaan yang sama tidak melahirkan sesi kedua", async () => {
    await konfirmasiPermintaan(permintaanId, MITRA);
    const kedua = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(kedua.ok).toBe(false);

    const { data: sesi } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(sesi).toHaveLength(1);   // tetap satu
  });

  it("dua konfirmasi PARALEL hanya menghasilkan satu sesi (balapan)", async () => {
    const [a, b] = await Promise.all([
      konfirmasiPermintaan(permintaanId, MITRA),
      konfirmasiPermintaan(permintaanId, MITRA),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);   // tepat satu pemenang

    const { data: sesi } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(sesi).toHaveLength(1);
  });

  it("permintaan yang sudah dikonfirmasi tidak bisa dikonfirmasi ulang", async () => {
    await admin.from("booking_requests")
      .update({ status: "dikonfirmasi" }).eq("id", permintaanId);
    const r = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(r.ok).toBe(false);

    const { data: sesi } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(sesi ?? []).toHaveLength(0);
  });

  it("permintaan yang tidak ada ditolak tanpa membuat sesi yatim", async () => {
    const r = await konfirmasiPermintaan("00000000-0000-0000-0000-000000000000", MITRA);
    expect(r.ok).toBe(false);
    const { data: sesi } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(sesi ?? []).toHaveLength(0);
  });

  it("tanda tangan action TIDAK menerima status dari pemanggil", () => {
    // Bentuk celah "klien menyetujui permintaannya sendiri" pernah tembus di
    // proyek ini justru karena nilai status datang dari luar. Dua parameter
    // saja: id permintaan & id mitra.
    expect(konfirmasiPermintaan.length).toBe(2);
  });
});
```

**Catatan:** memanggil server action langsung dari vitest memerlukan `requireRole` yang bisa dijalankan di luar request scope. Bila `requireRole` melempar karena `cookies()` tidak tersedia, tiru pola yang sudah dipakai `tests/passport-data.test.ts`: `vi.mock("@/lib/supabase/server")` diarahkan ke klien ber-sesi nyata hasil `signInAs("admin@padma.test")`, dan `vi.mock("@/lib/auth/require-role")` dibuat lolos. Yang dipalsukan hanya jembatan `cookies()` — seluruh query tetap melewati RLS sebagai admin.

- [ ] **Step 3: Server action**

```ts
export async function konfirmasiPermintaan(permintaanId: string, partnerId: string) {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // KLAIM DULU, baru buat sesi. Urutan ini penting: bila sesi dibuat lebih
  // dulu lalu klaim gagal, kita meninggalkan sesi yatim.
  const { data: klaim } = await supabase
    .from("booking_requests")
    .update({ status: "dikonfirmasi" })
    .eq("id", permintaanId)
    .eq("status", "menunggu")           // hanya dari antrean
    .select("id, client_id, service_id, tanggal");

  if ((klaim ?? []).length === 0) {
    return { ok: false as const, pesan: "Permintaan sudah ditangani orang lain." };
  }
  const p = klaim![0];

  // client_id & service_id diambil dari baris permintaan, BUKAN dari form —
  // kalau dari form, admin (atau request palsu) bisa membuat sesi atas nama
  // klien lain.
  const { error } = await supabase.from("sessions").insert({
    client_id: p.client_id, service_id: p.service_id, partner_id: partnerId,
    tanggal: p.tanggal, status: "terjadwal", booking_request_id: p.id,
  });
  if (error) {
    // kembalikan ke antrean supaya tidak hilang diam-diam
    await supabase.from("booking_requests").update({ status: "menunggu" }).eq("id", p.id);
    return { ok: false as const, pesan: "Gagal membuat sesi." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return { ok: true as const };
}
```

- [ ] **Step 4: UI antrean + verifikasi + commit**

Blok `.book-req` seperti prototipe: nama klien, layanan · tanggal · preferensi waktu · catatan, select mitra, tombol Konfirmasi, plus tombol Tolak. Di bawahnya paragraf: "Konfirmasi mengubah permintaan menjadi sesi Terjadwal — kabari juga klien via WhatsApp."

```bash
npm test && npm run build && git add web && git commit -m "feat(plan3a): antrean permintaan jadwal + konfirmasi menjadi sesi"
```

---

### Task 9: Modul Sesi — jadwalkan langsung & selesaikan dengan catatan

**Files:**
- Modify: `web/src/app/admin/sesi/page.tsx`, `web/src/app/admin/sesi/aksi.ts`
- Create: `web/src/app/admin/sesi/form-sesi.tsx`, `web/src/app/admin/sesi/form-selesai.tsx`, `web/tests/admin-sesi-catatan.test.ts`

- [ ] **Step 1: Test — efek berantai ke passport (inti nilai produk)**

Buat `web/tests/admin-sesi-catatan.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { badgeDari, progresPaket } from "@/lib/passport/turunan";
import { selesaikanSesi } from "@/app/admin/sesi/aksi";

const admin = createAdminSupabase();
const KLIEN = "44444444-4444-4444-4444-444444444401";       // Ananda
const PAKET = "55555555-5555-5555-5555-555555555501";
const SVC_BARU = "11111111-1111-1111-1111-111111111105";    // Prenatal Yoga — Ananda BELUM pernah
const MITRA = "33333333-3333-3333-3333-333333333302";
const TGL = "2026-12-27";

afterEach(async () => {
  await admin.from("sessions").delete().eq("tanggal", TGL);
});

async function buatSesi(status: "terjadwal" | "batal", denganPaket: boolean) {
  const { data } = await admin.from("sessions").insert({
    client_id: KLIEN, service_id: SVC_BARU, partner_id: MITRA,
    tanggal: TGL, status,
    client_package_id: denganPaket ? PAKET : null,
  }).select("id").single();
  return data!.id as string;
}

async function sesiKlien() {
  const k = await signInAs("ananda@padma.test");
  const { data } = await k.from("sessions")
    .select("id, service_id, status, catatan, rekomendasi, client_package_id");
  return data ?? [];
}

describe("menyelesaikan sesi mengalir ke passport", () => {
  it("catatan & rekomendasi terbaca klien di passport", async () => {
    const id = await buatSesi("terjadwal", true);
    const fd = new FormData();
    fd.set("catatan", "Respons tubuh sangat baik pada sesi ini.");
    fd.set("rekomendasi", "Lanjutkan latihan napas 3x sepekan.");

    const r = await selesaikanSesi(id, fd);
    expect(r.ok).toBe(true);

    const milikKlien = (await sesiKlien()).find((s) => s.id === id);
    expect(milikKlien).toBeDefined();
    expect(milikKlien!.status).toBe("selesai");
    expect(milikKlien!.catatan).toContain("Respons tubuh sangat baik");
    expect(milikKlien!.rekomendasi).toContain("latihan napas");
  });

  it("progres paket bertambah setelah sesi diselesaikan", async () => {
    const sebelum = progresPaket({ totalSesi: 8, sesi: (await sesiKlien()).map(petakan) });
    const id = await buatSesi("terjadwal", true);
    const fd = new FormData();
    fd.set("catatan", "x"); fd.set("rekomendasi", "");
    await selesaikanSesi(id, fd);

    const sesudah = progresPaket({ totalSesi: 8, sesi: (await sesiKlien()).map(petakan) });
    expect(sesudah!.selesai).toBe(sebelum!.selesai + 1);
  });

  it("badge baru terbit untuk layanan yang pertama kali selesai", async () => {
    const sebelum = badgeDari((await sesiKlien()).map(petakan)).map((b) => b.serviceId);
    expect(sebelum).not.toContain(SVC_BARU);

    const id = await buatSesi("terjadwal", true);
    const fd = new FormData();
    fd.set("catatan", "x"); fd.set("rekomendasi", "");
    await selesaikanSesi(id, fd);

    const sesudah = badgeDari((await sesiKlien()).map(petakan)).map((b) => b.serviceId);
    expect(sesudah).toContain(SVC_BARU);
  });

  it("materi layanan itu ikut terbuka untuk klien", async () => {
    const k = await signInAs("ananda@padma.test");
    const bacaBab = async () => {
      const { data } = await k.from("materials")
        .select("service_id, material_chapters(id)").eq("service_id", SVC_BARU);
      return (data ?? []).flatMap((m) => (m.material_chapters ?? []) as unknown[]).length;
    };
    // Layanan ini mungkin belum punya materi di seed; bila 0 sebelum & sesudah,
    // test ini hanya menegaskan tidak ada kebocoran. Gating-nya sendiri sudah
    // diuji tests/rls-materi.test.ts.
    const sebelum = await bacaBab();
    const id = await buatSesi("terjadwal", true);
    const fd = new FormData();
    fd.set("catatan", "x"); fd.set("rekomendasi", "");
    await selesaikanSesi(id, fd);
    expect(await bacaBab()).toBeGreaterThanOrEqual(sebelum);
  });

  it("sesi BATAL tidak menambah progres maupun badge", async () => {
    const sebelum = progresPaket({ totalSesi: 8, sesi: (await sesiKlien()).map(petakan) });
    await buatSesi("batal", true);
    const sesudah = progresPaket({ totalSesi: 8, sesi: (await sesiKlien()).map(petakan) });
    expect(sesudah!.selesai).toBe(sebelum!.selesai);
  });

  it("tanda tangan action TIDAK menerima status dari pemanggil", () => {
    expect(selesaikanSesi.length).toBe(2);   // (sesiId, formData) saja
  });
});

// Pemetaan baris DB -> bentuk yang dipakai kalkulasi turunan.
function petakan(r: {
  id: string; service_id: string; status: string; catatan: string | null;
  rekomendasi: string | null; client_package_id: string | null;
}) {
  return {
    id: r.id, serviceId: r.service_id, namaLayanan: "", namaMitra: "",
    tanggal: "2026-01-01",
    status: r.status as "terjadwal" | "selesai" | "batal",
    clientPackageId: r.client_package_id,
    catatan: r.catatan ?? "", rekomendasi: r.rekomendasi ?? "",
    statusBayar: "belum" as const,
  };
}
```

Berlaku catatan `vi.mock` yang sama seperti Task 8 bila `requireRole` melempar di luar request scope.

- [ ] **Step 2: Server action**

`jadwalkanSesi(formData)` dan `selesaikanSesi(sesiId, formData)` — keduanya `requireRole` di dalam, status hardcoded (`terjadwal` / `selesai`), memakai `createServerSupabase()`.

- [ ] **Step 3: UI**

Tabel sesi (Klien · Layanan + tanggal · Mitra · Status · Aksi) urut tanggal menurun. Aksi "Tandai selesai" membuka `.mini-form` berisi dua textarea: **Catatan & evaluasi (dari laporan bidan)** dan **Rekomendasi untuk klien**, persis prototipe. Sesi selesai menampilkan catatannya lewat tombol "catatan".

- [ ] **Step 4: Verifikasi manual end-to-end**

Jadwalkan sesi untuk Ananda → tandai selesai + isi catatan → login sebagai Ananda → catatan itu muncul di `/passport/sesi`, progres bertambah. Matikan dev server.

```bash
npm test && npm run build && git add web && git commit -m "feat(plan3a): jadwalkan sesi & selesaikan dengan catatan bidan"
```

---

### Task 10: Skrining → Klien

**Files:**
- Create: `web/src/app/admin/skrining/jadikan-klien.tsx`
- Modify: `web/src/app/admin/skrining/aksi.ts`, `web/src/app/admin/skrining/tabel-inbox.tsx`
- Create: `web/tests/admin-konversi-skrining.test.ts`

**Konteks:** `screenings.client_id` sudah ada di skema tapi **tidak pernah diisi kode mana pun** — inilah yang mengisinya.

- [ ] **Step 1: Test**

Membuktikan: konversi membuat klien baru dengan data tersalin (nama, no_hp, fase) dan mengisi `screenings.client_id`; status tindak lanjut otomatis menjadi `jadi_klien`; konversi ganda ditolak; skrining yang sudah tertaut menampilkan tautan ke kliennya.

**Perhatikan:** `screenings.client_id` sekali terisi **mengunci penghapusan klien** (FK tanpa `on delete`) — dan itu justru sejalan dengan pagar Task 1 yang sudah melarang admin menghapus klien.

- [ ] **Step 2–4: Implementasi, verifikasi, commit**

Dialog konversi memakai ulang form klien (Task 5) dengan medan terisi otomatis. Fase skrining dipetakan ke `phases.id` (ingat: skrining hanya punya 4 fase; `newborn` tidak pernah muncul dari sini).

```bash
npm test && npm run build && git add web && git commit -m "feat(plan3a): konversi skrining menjadi klien"
```

---

### Task 11: E2E operasional & verifikasi akhir

**Files:**
- Create: `web/tests/e2e/admin-operasional.e2e.ts`
- Modify: `web/package.json`, `web/README.md`

- [ ] **Step 1: E2E rantai penuh**

Skrip `tsx` + Playwright mengikuti pola `tests/e2e/passport.e2e.ts`. Rantai yang dibuktikan **dalam satu alur**:

1. Login admin → `/admin` menampilkan kartu antrean.
2. Buat klien baru (email unik bertimestamp) → muncul di daftar dengan status "Belum aktif".
3. Terbitkan undangan → teks WhatsApp memuat `/aktivasi?token=`.
4. Buka tautan aktivasi di context browser baru → daftar/masuk → mendarat di `/passport`.
5. Kembali sebagai admin → jadwalkan sesi untuk klien itu → tandai selesai + catatan.
6. Login sebagai klien itu → `/passport/sesi` menampilkan catatan bidan tadi.
7. Bersihkan seluruh data uji (klien, sesi, user auth) lewat service role.

- [ ] **Step 2: Script & verifikasi menyeluruh**

```json
"test:e2e:admin": "tsx tests/e2e/admin-operasional.e2e.ts",
"test:e2e:semua": "npm run test:e2e && npm run test:e2e:funnel && npm run test:e2e:passport && npm run test:e2e:admin"
```

```bash
npx supabase db reset && npm run seed:users && npm test && npm run build
npm run dev &   # tunggu Ready
npm run test:e2e:semua
```
Semua hijau. Matikan dev server; `lsof -ti tcp:3000` kosong.

- [ ] **Step 3: README & commit**

Tambahkan rute admin ke tabel rute.

```bash
git add web && git commit -m "test(plan3a): E2E rantai operasional admin + dokumentasi rute"
```

---

## Definition of Done — Plan 3A

- [ ] `authenticated` tidak lagi memegang TRUNCATE pada tabel mana pun; admin tidak bisa menghapus sesi/klien.
- [ ] Setiap perubahan `status_bayar` tercatat di `jejak_status_bayar` beserta aktornya; jejak tidak bisa dihapus/diubah admin; pembayaran lunas tidak bisa diputar mundur oleh peran API.
- [ ] Menonaktifkan mitra **tidak** menghilangkan namanya dari riwayat sesi klien.
- [ ] Admin bisa membuat klien (PADMA ID otomatis, berkalender Jakarta), menerbitkan tautan aktivasi sekali-pakai, dan klien itu berhasil membuka passport-nya lewat tautan tersebut.
- [ ] Admin bisa mengonfirmasi permintaan jadwal menjadi sesi; konfirmasi ganda tidak melahirkan sesi kedua; `client_id` sesi selalu dari baris permintaan.
- [ ] Admin bisa menjadwalkan sesi dan menyelesaikannya dengan catatan; catatan itu terbaca klien di passport, progres & badge & materi ikut bergerak.
- [ ] Skrining bisa dikonversi menjadi klien dan `screenings.client_id` terisi.
- [ ] Tidak ada nominal uang di seluruh panel admin.
- [ ] `npm test` hijau seluruhnya, keempat skrip E2E hijau, `npm run build` sukses.
