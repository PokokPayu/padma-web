# Varian Layanan & Harga Bertingkat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat satu layanan bisa punya banyak harga (durasi, Private/Circle), memindahkan tarif dari per-layanan ke per-varian, dan memajang harga klien ke publik tanpa honor mitra ikut terbawa.

**Architecture:** Lapisan baru `service_variants` di antara `services` dan tarif. `service_rates` diganti `variant_rates` beserta seluruh pagar uangnya yang dipindah apa adanya. `sessions` dan `booking_requests` menyimpan `service_id` **dan** `variant_id`, dikunci foreign key gabungan sehingga basis data — bukan kode — yang menjamin varian milik layanan yang benar. Harga publik keluar lewat view berkolom sempit `harga_publik`, mengikuti pola `partner_publik` yang sudah ada.

**Tech Stack:** Next.js (App Router, server actions), Supabase/PostgREST, Postgres 15, vitest, `pg` untuk uji struktural.

**Spec:** `docs/superpowers/specs/2026-09-06-padma-varian-layanan-design.md`

## Global Constraints

Berlaku untuk SETIAP tugas di bawah. Melanggarnya memerahkan suite yang sudah ada.

- **Bahasa Indonesia** untuk nama fungsi, variabel, komentar, dan pesan. Nama tabel/kolom tetap seperti yang tertulis di spec.
- **Cap waktu migrasi ditulis MANUAL** dan harus lebih besar dari berkas migrasi terakhir. `supabase migration new` memakai jam dinding dan pernah menyelipkan migrasi ke tengah riwayat sehingga `db reset` gagal. Berkas terakhir saat plan ini ditulis: `20260905120000_material_videos_bentuk_objek.sql`.
- **Server action memanggil `requireRole` DI DALAM setiap fungsi**, bukan sekali di puncak modul. Server action adalah endpoint POST tersendiri; layout tidak pernah dilewati saat action dipanggil langsung.
- **Berkas `"use server"` hanya mengekspor fungsi async.** Konstanta, kalimat, dan validator murni tinggal di `status.ts` di folder yang sama.
- **Baca lewat sesi pengguna** (`createServerSupabase`), tidak pernah service role. Di bawah service role `user_role()` mengembalikan `'klien'` dan `auth.uid()` NULL, sehingga policy tidak pernah ikut diperiksa.
- **INSERT/UPDATE yang tertahan RLS dijawab PostgREST 200 + `[]`, bukan error.** Setiap tulis wajib `.select("id")` dan memeriksa panjangnya sebelum melaporkan berhasil.
- **Tidak ada penghapusan.** Pensiun = `aktif = false`. Hak DELETE sudah dicabut dari `authenticated`.
- **Gerbang peran pada trigger** selalu `current_user not in ('anon','authenticated','authenticator')` → lewatkan. Seed, migrasi, dan fixture test berjalan sebagai `postgres`/`service_role` dan harus tetap bisa menyemai tanggal lampau.
- **Hak fungsi baru dinyatakan eksplisit**: `revoke all on function ... from public, anon, authenticated;` (aturan [F] migration `fail_closed_sequence_fungsi`).
- **Perbandingan tanggal memakai string `YYYY-MM-DD`**, tidak pernah `new Date()`. Hari ini = `hariIniJakarta()` dari `@/lib/passport/waktu`.
- Perintah uji: `npm test` (seluruh suite), `npx vitest run tests/<berkas>` (satu berkas). Basis data lokal: `npm run db:recover` bila migrasi berubah.

---

### Task 1: Tabel `service_variants` + varian baku untuk setiap layanan

**Files:**
- Create: `web/supabase/migrations/20260906100000_varian_layanan.sql`
- Create: `web/tests/varian-struktur.test.ts`
- Modify: `web/tests/grant-anon.test.ts` (tambah `service_variants` ke katalog publik)
- Modify: `web/tests/hak-hapus-berlebih.test.ts` (tambah `service_variants`)

**Interfaces:**
- Produces: tabel `public.service_variants (id, service_id, label, durasi_menit, format, urutan, aktif, created_at, updated_at)` dengan `unique (service_id, id)`; enum `public.varian_format` bernilai `'private' | 'circle'`. Setiap baris `services` dijamin punya **tepat satu** varian sesudah migrasi ini.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/varian-struktur.test.ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

/**
 * V3 spec: SETIAP layanan wajib punya minimal satu varian.
 *
 * Diuji langsung ke basis data, bukan lewat kode aplikasi: begitu "layanan
 * tanpa varian" boleh ada, setiap perhitungan harga bercabang dua selamanya —
 * dan cabang keduanya hanya muncul di produksi.
 */
describe("service_variants — struktur", () => {
  it("enum varian_format berisi tepat private & circle", async () => {
    const baris = await querySql<{ label: string }>(
      `select e.enumlabel as label
         from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'varian_format'
        order by e.enumsortorder`,
    );
    expect(baris.map((b) => b.label)).toEqual(["private", "circle"]);
  });

  it("setiap layanan punya minimal satu varian", async () => {
    const yatim = await querySql<{ id: string }>(
      `select s.id from public.services s
        where not exists (select 1 from public.service_variants v
                           where v.service_id = s.id)`,
    );
    expect(yatim).toEqual([]);
  });

  it("unique (service_id, id) ada — penopang FK gabungan Task 2", async () => {
    const baris = await querySql<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'public.service_variants'::regclass
          and contype = 'u'
          and conkey = array[
                (select attnum from pg_attribute
                  where attrelid = 'public.service_variants'::regclass
                    and attname = 'service_id'),
                (select attnum from pg_attribute
                  where attrelid = 'public.service_variants'::regclass
                    and attname = 'id')]::smallint[]`,
    );
    expect(baris).toHaveLength(1);
  });

  it("anon hanya boleh SELECT service_variants — tanpa hak tulis", async () => {
    const hak = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.service_variants'::regclass, p.priv)
        order by p.priv`,
    );
    expect(hak.map((h) => h.priv)).toEqual(["SELECT"]);
  });

  it("authenticated tidak memegang DELETE atas service_variants", async () => {
    const [row] = await querySql<{ boleh: boolean }>(
      `select has_table_privilege('authenticated', 'public.service_variants'::regclass, 'DELETE') as boleh`,
    );
    expect(row.boleh).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/varian-struktur.test.ts`
Expected: FAIL — `relation "public.service_variants" does not exist`

- [ ] **Step 3: Tulis migrasi**

```sql
-- web/supabase/migrations/20260906100000_varian_layanan.sql
-- ============================================================================
-- VARIAN LAYANAN — satu layanan, banyak harga
-- ============================================================================
-- Pricelist PADMA tidak muat di skema lama: Garbha Relief punya tiga harga
-- (60/90/120 menit), Garbha Partner Lab punya dua (Private/Circle), dan
-- `services` tidak punya satu pun kolom untuk membedakannya. Lapisan ini yang
-- menampungnya.
--
-- `label` sengaja teks bebas: pola di pricelist TIDAK seragam. Ia menampung
-- "Basic", "Couple", maupun "2 modul" tanpa memaksa dimensi yang tidak ada.
-- Tampilan dirangkai dari label + durasi + format, bukan disimpan jadi.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260905120000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

create type varian_format as enum ('private','circle');

create table public.service_variants (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid not null references public.services(id),
  label        text not null default '',
  durasi_menit int null check (durasi_menit is null or durasi_menit > 0),
  format       varian_format null,
  urutan       int not null default 0,
  aktif        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Penopang foreign key gabungan di Task 2. Urutan kolomnya sengaja SAMA
  -- dengan klausa REFERENCES di sana, supaya pasangannya terbaca sekali lihat.
  constraint service_variants_pasangan_layanan unique (service_id, id)
);
create index service_variants_service_idx on public.service_variants(service_id, urutan);

-- V3: setiap layanan wajib punya minimal satu varian. Layanan yang sudah ada
-- memperoleh varian BAKU — label kosong, durasi & format NULL — sehingga
-- Task 2 punya sasaran backfill dan Task 3 punya sasaran pemindahan tarif.
insert into public.service_variants (service_id, label)
  select id, '' from public.services;

-- Stempel waktu. `sentuh_updated_at()` sudah ada sejak pengerasan_admin.
create trigger trg_service_variants_updated_at
  before update on public.service_variants
  for each row execute function public.sentuh_updated_at();

-- ===== PENGERASAN =====
alter table public.service_variants enable row level security;

-- Katalog: baca publik hanya untuk varian AKTIF, menyusul policy `services`.
-- Sengaja `to anon` (bukan `to public`) — policy yang menyasar `public` ikut
-- dievaluasi peran authenticated dan menabrak invarian hak-default-sequence.
create policy "service_variants: baca publik" on public.service_variants
  for select to anon using (aktif = true);

create policy "service_variants: baca terautentikasi" on public.service_variants
  for select to authenticated using (true);

create policy "service_variants: staf kelola" on public.service_variants
  for all to authenticated
  using (user_role() in ('admin','owner'))
  with check (user_role() in ('admin','owner'));

grant select on public.service_variants to anon;
grant select, insert, update on public.service_variants to authenticated;
revoke delete on public.service_variants from authenticated;

comment on table public.service_variants is
  'Varian satu layanan: durasi, format (Private/Circle), atau program bernama '
  '(Basic/Couple/2 modul). Harga menempel di sini, bukan di services. '
  'Setiap layanan wajib punya minimal satu varian — layanan tanpa varian '
  'membuat setiap perhitungan harga bercabang dua selamanya. '
  'DELETE dicabut: varian yang pernah dipakai sesi adalah riwayat.';
```

- [ ] **Step 4: Reset basis data & jalankan uji, pastikan HIJAU**

Run: `npm run db:recover && npx vitest run tests/varian-struktur.test.ts`
Expected: PASS, 5 uji

- [ ] **Step 5: Daftarkan tabel baru di uji hak yang sudah ada**

Di `tests/grant-anon.test.ts`, tambahkan `"service_variants"` ke `TABEL_KATALOG_PUBLIK` (bukan ke `TABEL_TERTUTUP_ANON` — ia memang katalog yang dibaca pengunjung):

```ts
const TABEL_KATALOG_PUBLIK = ["phases", "services", "packages", "service_variants"] as const;
```

Di `tests/hak-hapus-berlebih.test.ts`, tambahkan `service_variants` ke daftar tabel yang haknya dikunci, mengikuti bentuk yang sudah dipakai berkas itu untuk `services`.

- [ ] **Step 6: Jalankan suite penuh**

Run: `npm test`
Expected: PASS seluruhnya. Bila `hak-hapus-berlebih` merah karena peta hak berubah, perbarui petanya — itu memang sinyal yang diinginkan berkas tersebut.

- [ ] **Step 7: Commit**

```bash
git add web/supabase/migrations/20260906100000_varian_layanan.sql web/tests/varian-struktur.test.ts web/tests/grant-anon.test.ts web/tests/hak-hapus-berlebih.test.ts
git commit -m "feat(katalog): tabel service_variants + varian baku tiap layanan"
```

---

### Task 2: `variant_id` pada `sessions` & `booking_requests`, dikunci FK gabungan

**Files:**
- Create: `web/supabase/migrations/20260906110000_sesi_menunjuk_varian.sql`
- Create: `web/tests/varian-pasangan-layanan.test.ts`

**Interfaces:**
- Consumes: `service_variants` beserta `unique (service_id, id)` dari Task 1.
- Produces: kolom `sessions.variant_id` dan `booking_requests.variant_id` (masih NULLABLE — lihat catatan urutan), FK gabungan `(service_id, variant_id) → service_variants (service_id, id)`. Seluruh baris LAMA sudah terisi.

**Catatan urutan — jangan dilewati.** Kolomnya dibiarkan NULLABLE di tugas ini. `NOT NULL` baru dipasang di Task 9, setelah jalur tulis (`ajukanJadwal`, `buatSesi`) benar-benar mengirim varian. Memasang `NOT NULL` sekarang mematikan pengajuan jadwal klien seketika, dan tidak ada satu pun uji di antara dua tugas ini yang akan menangkapnya sebagai penyebab.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/varian-pasangan-layanan.test.ts
import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * V2 spec: BASIS DATA yang menjamin varian milik layanan yang benar.
 *
 * Kode aplikasi bisa memeriksanya, tetapi REST selalu jalur lain: satu POST
 * langsung ke /rest/v1/sessions dengan variant_id milik layanan lain akan
 * melewati setiap validator TypeScript. Yang diuji di sini karena itu bukan
 * server action melainkan constraint-nya sendiri.
 */
describe("FK gabungan (service_id, variant_id)", () => {
  it("menolak sesi dengan varian milik layanan lain", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [a] = (await jalankan(
        `select s.id as service_id, v.id as variant_id
           from public.services s
           join public.service_variants v on v.service_id = s.id
          order by s.nama limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;
      const [b] = (await jalankan(
        `select v.id as variant_id from public.service_variants v
          where v.service_id <> $1 limit 1`,
        [a.service_id],
      )) as Array<{ variant_id: string }>;

      const [klien] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [mitra] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;

      await expect(
        jalankan(
          `insert into public.sessions (client_id, service_id, variant_id, partner_id, tanggal)
           values ($1, $2, $3, $4, current_date)`,
          [klien.id, a.service_id, b.variant_id, mitra.id],
        ),
      ).rejects.toThrow();
    });
  });

  it("menerima sesi dengan varian milik layanannya sendiri", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [a] = (await jalankan(
        `select s.id as service_id, v.id as variant_id
           from public.services s
           join public.service_variants v on v.service_id = s.id
          order by s.nama limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;
      const [klien] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [mitra] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;

      const hasil = await jalankan(
        `insert into public.sessions (client_id, service_id, variant_id, partner_id, tanggal)
         values ($1, $2, $3, $4, current_date) returning id`,
        [klien.id, a.service_id, a.variant_id, mitra.id],
      );
      expect(hasil).toHaveLength(1);
    });
  });
});

describe("backfill varian", () => {
  it("tidak ada sesi lama yang variannya kosong atau salah layanan", async () => {
    const salah = await querySql<{ id: string }>(
      `select s.id from public.sessions s
        where s.variant_id is null
           or not exists (select 1 from public.service_variants v
                           where v.id = s.variant_id and v.service_id = s.service_id)`,
    );
    expect(salah).toEqual([]);
  });

  it("tidak ada permintaan jadwal lama yang variannya kosong atau salah layanan", async () => {
    const salah = await querySql<{ id: string }>(
      `select b.id from public.booking_requests b
        where b.variant_id is null
           or not exists (select 1 from public.service_variants v
                           where v.id = b.variant_id and v.service_id = b.service_id)`,
    );
    expect(salah).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/varian-pasangan-layanan.test.ts`
Expected: FAIL — `column "variant_id" of relation "sessions" does not exist`

- [ ] **Step 3: Tulis migrasi**

```sql
-- web/supabase/migrations/20260906110000_sesi_menunjuk_varian.sql
-- ============================================================================
-- SESI & PERMINTAAN JADWAL MENUNJUK VARIAN
-- ============================================================================
-- Harga menempel di varian, jadi sesi yang hanya tahu layanannya tidak bisa
-- ditagihkan. Yang ditambahkan bukan pengganti `service_id` melainkan
-- PASANGANNYA: setiap query yang menyaring per layanan — agenda, tren sesi,
-- gating materi, rekap owner — tetap jalan tanpa satu baris pun diubah.
--
-- Bahaya menyimpan dua kolom adalah keduanya berpisah: sesi Garbha Relief
-- dengan varian Purnama Rest. Itu dijaga foreign key GABUNGAN, bukan validator
-- aplikasi — REST /rest/v1/sessions selalu jalur yang melewati validator.
--
-- NULLABLE dulu, sengaja. `not null` dipasang di migrasi Task 9, sesudah
-- ajukanJadwal() dan buatSesi() benar-benar mengirim varian. Memasangnya
-- sekarang mematikan pengajuan jadwal klien seketika.

alter table public.sessions         add column variant_id uuid;
alter table public.booking_requests add column variant_id uuid;

-- Backfill: varian BAKU layanan masing-masing (satu-satunya varian yang ada
-- sesudah migrasi Task 1, dipilih deterministik agar migrasi bisa diulang).
update public.sessions s
   set variant_id = (select v.id from public.service_variants v
                      where v.service_id = s.service_id
                      order by v.urutan, v.created_at, v.id limit 1)
 where s.variant_id is null;

update public.booking_requests b
   set variant_id = (select v.id from public.service_variants v
                      where v.service_id = b.service_id
                      order by v.urutan, v.created_at, v.id limit 1)
 where b.variant_id is null;

alter table public.sessions
  add constraint sessions_varian_milik_layanan
  foreign key (service_id, variant_id)
  references public.service_variants (service_id, id);

alter table public.booking_requests
  add constraint booking_requests_varian_milik_layanan
  foreign key (service_id, variant_id)
  references public.service_variants (service_id, id);

create index sessions_variant_idx         on public.sessions(variant_id);
create index booking_requests_variant_idx on public.booking_requests(variant_id);

comment on column public.sessions.variant_id is
  'Varian layanan yang dipesan — sumber harga sesi ini. Berpasangan dengan '
  'service_id lewat FK gabungan sessions_varian_milik_layanan, sehingga varian '
  'milik layanan LAIN ditolak basis data, bukan sekadar oleh validator.';
```

- [ ] **Step 4: Reset & jalankan uji, pastikan HIJAU**

Run: `npm run db:recover && npx vitest run tests/varian-pasangan-layanan.test.ts`
Expected: PASS, 4 uji

- [ ] **Step 5: Jalankan suite penuh**

Run: `npm test`
Expected: PASS. Fixture test yang menyisipkan `sessions` tanpa `variant_id` tetap jalan karena kolomnya masih nullable — itulah gunanya urutan ini.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20260906110000_sesi_menunjuk_varian.sql web/tests/varian-pasangan-layanan.test.ts
git commit -m "feat(sesi): variant_id berpasangan dengan service_id lewat FK gabungan"
```

---

### Task 3: `variant_rates` — tarif per varian beserta seluruh pagar uang

**Files:**
- Create: `web/supabase/migrations/20260906120000_tarif_per_varian.sql`
- Create: `web/tests/varian-tarif-pengerasan.test.ts`

**Interfaces:**
- Consumes: `service_variants` (Task 1).
- Produces: tabel `public.variant_rates (id, variant_id, harga_klien, harga_coret, honor_mitra, berlaku_sejak)` berisi salinan lengkap `service_rates`; fungsi `public.guard_tarif_varian_maju()` dan `public.kunci_riwayat_tarif_varian()`.

`service_rates` **masih hidup** sesudah tugas ini. Ia baru dijatuhkan di Task 5, sesudah kode pindah di Task 4 — supaya pohon selalu dalam keadaan bisa dijalankan.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/varian-tarif-pengerasan.test.ts
import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * Pagar uang `service_rates` lahir dari temuan red team (30 Agu 2026) dengan
 * bukti tertulis di pengerasan_tabel_uang.sql. Memindahkan tarif ke tabel baru
 * tanpa memindahkan pagarnya berarti membayar ulang temuan yang sama.
 *
 * Ketiganya diuji sebagai peran API — bukan sebagai postgres — karena justru
 * gerbang peran itu yang membedakan jalur sah dari jalur terlarang.
 */
async function sebagaiAuthenticated<T>(
  jalankan: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  fn: () => Promise<T>,
): Promise<T> {
  await jalankan("set local role authenticated");
  try {
    return await fn();
  } finally {
    await jalankan("reset role");
  }
}

describe("variant_rates — pagar uang dipindah apa adanya", () => {
  it("seluruh baris service_rates tersalin, tanggalnya utuh", async () => {
    const [row] = await querySql<{ lama: string; baru: string; beda: string }>(
      `select (select count(*) from public.service_rates)  as lama,
              (select count(*) from public.variant_rates)  as baru,
              (select count(*) from public.service_rates r
                where not exists (
                  select 1 from public.variant_rates vr
                    join public.service_variants v on v.id = vr.variant_id
                   where v.service_id   = r.service_id
                     and vr.harga_klien = r.harga_klien
                     and vr.honor_mitra = r.honor_mitra
                     and vr.berlaku_sejak = r.berlaku_sejak)) as beda`,
    );
    expect(row.baru).toBe(row.lama);
    expect(row.beda).toBe("0");
  });

  it("CHECK menolak honor melebihi harga", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(`select id from public.service_variants limit 1`)) as Array<{ id: string }>;
      await expect(
        jalankan(
          `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
           values ($1, 100000, 900000, '2099-01-01')`,
          [v.id],
        ),
      ).rejects.toThrow(/variant_rates_nilai_wajar/);
    });
  });

  it("CHECK menolak harga coret lebih murah dari harga klien", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(`select id from public.service_variants limit 1`)) as Array<{ id: string }>;
      await expect(
        jalankan(
          `insert into public.variant_rates (variant_id, harga_klien, harga_coret, honor_mitra, berlaku_sejak)
           values ($1, 200000, 150000, 100000, '2099-01-01')`,
          [v.id],
        ),
      ).rejects.toThrow(/variant_rates_nilai_wajar/);
    });
  });

  it("unique per (variant_id, berlaku_sejak) menolak tarif kembar", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(`select id from public.service_variants limit 1`)) as Array<{ id: string }>;
      await jalankan(
        `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
         values ($1, 200000, 100000, '2099-01-01')`,
        [v.id],
      );
      await expect(
        jalankan(
          `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
           values ($1, 300000, 100000, '2099-01-01')`,
          [v.id],
        ),
      ).rejects.toThrow(/variant_rates_unik_per_tanggal/);
    });
  });

  it("tarif retroaktif ditolak untuk peran API, dilewatkan untuk postgres", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(
        `select vr.variant_id as id from public.variant_rates vr limit 1`,
      )) as Array<{ id: string }>;

      // postgres: dilewatkan — seed & fixture memang menyemai tanggal lampau.
      const lolos = await jalankan(
        `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
         values ($1, 200000, 100000, '1999-01-01') returning id`,
        [v.id],
      );
      expect(lolos).toHaveLength(1);

      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(
            `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
             values ($1, 200000, 100000, '1998-01-01')`,
            [v.id],
          ),
        ).rejects.toThrow(/harus berlaku sesudah/);
      });
    });
  });

  it("UPDATE ditolak seluruhnya untuk peran API", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(`update public.variant_rates set harga_klien = 1`),
        ).rejects.toThrow(/append-only/);
      });
    });
  });

  it("anon tidak memegang hak tabel maupun hak kolom atas variant_rates", async () => {
    const tabel = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.variant_rates'::regclass, p.priv)`,
    );
    expect(tabel).toEqual([]);

    const kolom = await querySql<{ kolom: string }>(
      `select c.column_name as kolom
         from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'variant_rates'
          and has_column_privilege('anon', 'public.variant_rates'::regclass, c.column_name, 'SELECT')`,
    );
    expect(kolom).toEqual([]);
  });

  it("authenticated tidak memegang DELETE atas variant_rates", async () => {
    const [row] = await querySql<{ boleh: boolean }>(
      `select has_table_privilege('authenticated', 'public.variant_rates'::regclass, 'DELETE') as boleh`,
    );
    expect(row.boleh).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/varian-tarif-pengerasan.test.ts`
Expected: FAIL — `relation "public.variant_rates" does not exist`

- [ ] **Step 3: Tulis migrasi**

```sql
-- web/supabase/migrations/20260906120000_tarif_per_varian.sql
-- ============================================================================
-- TARIF PER VARIAN — pemindahan service_rates, PAGARNYA IKUT
-- ============================================================================
-- Yang dipindah bukan sekadar baris. Empat pagar di pengerasan_tabel_uang.sql
-- lahir dari sembilan operasi yang semuanya HTTP 200 sebelum pagar itu ada —
-- termasuk satu PATCH berfilter yang menimpa 13 baris rate card sekaligus.
-- Tabel baru tanpa pagar itu adalah kemunduran ke keadaan yang sudah dibayar.
--
-- `service_rates` SENGAJA masih hidup sesudah berkas ini. Ia baru dijatuhkan
-- setelah kode owner pindah, supaya pohon tidak pernah berada dalam keadaan
-- "tabel sudah hilang tapi kodenya masih membacanya".

create table public.variant_rates (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references public.service_variants(id),
  harga_klien   int not null,
  harga_coret   int null,
  honor_mitra   int not null,
  berlaku_sejak date not null default current_date,

  -- Tanpa ini `tarifPadaTanggal()` memilih salah satu baris kembar
  -- sewenang-wenang: honor yang dibayarkan bergantung pada urutan baris yang
  -- dikembalikan Postgres hari itu.
  constraint variant_rates_unik_per_tanggal unique (variant_id, berlaku_sejak),

  -- `<=`, bukan `<`: layanan bermargin NOL adalah keputusan bisnis yang sah.
  -- Honor yang MELEBIHI harga berarti PADMA membayar mitra lebih banyak
  -- daripada yang diterimanya, dan rekap menampilkannya sebagai margin negatif
  -- tanpa satu pun peringatan.
  --
  -- `harga_coret >= harga_klien`: harga coret yang lebih murah dari harga jual
  -- bukan promo — ia salah ketik yang tampil ke pengunjung sebagai KENAIKAN.
  constraint variant_rates_nilai_wajar check (
    harga_klien >= 0
    and honor_mitra >= 0
    and honor_mitra <= harga_klien
    and (harga_coret is null or harga_coret >= harga_klien)
  )
);
create index variant_rates_lookup_idx on public.variant_rates(variant_id, berlaku_sejak desc);

-- ===== SALIN RIWAYAT TARIF =====
-- `berlaku_sejak` dipertahankan APA ADANYA: riwayat tarif adalah bukti berapa
-- honor yang seharusnya dibayarkan pekan lalu, dan rekap membacanya menurut
-- tanggal sesi. Membulatkannya ke hari migrasi menggeser rekap yang sudah
-- dibayarkan. `harga_coret` NULL — harga coret adalah angka pemasaran baru,
-- bukan sesuatu yang pernah berlaku di masa lalu.
--
-- Berjalan sebagai `postgres`, jadi guard_tarif_varian_maju melewatkannya —
-- gerbang peran yang sudah ada, bukan pengecualian baru.
insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
  select v.id, r.harga_klien, r.honor_mitra, r.berlaku_sejak
    from public.service_rates r
    join public.service_variants v on v.service_id = r.service_id;

-- ===== PAGAR (4) TARIF RETROAKTIF =====
-- BUKAN `security definer`: `current_user` harus tetap peran PEMANGGIL, karena
-- justru itu yang membedakan jalur sah dari jalur terlarang.
create or replace function public.guard_tarif_varian_maju()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  terakhir date;
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  select max(berlaku_sejak) into terakhir
    from public.variant_rates
   where variant_id = new.variant_id
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception
      'tarif baru harus berlaku sesudah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_tarif_varian_maju() is
  'Menolak variant_rates ber-berlaku_sejak <= tarif terakhir varian yang sama, '
  'dari peran API (anon, authenticated, authenticator) — owner sekalipun. '
  'Tarif retroaktif berefek SAMA PERSIS dengan menimpa baris lama. '
  'Service role sengaja dilewatkan: seed & fixture test menyemai tanggal lampau.';

revoke all on function public.guard_tarif_varian_maju() from public, anon, authenticated;

create trigger trg_guard_tarif_varian_maju
  before insert or update on public.variant_rates
  for each row execute function public.guard_tarif_varian_maju();

-- ===== PAGAR (5) BARIS LAMA TIDAK BISA DITULIS ULANG =====
-- Yang di atas menjaga TANGGAL; yang ini menjaga NOMINAL. Filter pada URL
-- adalah PILIHAN PEMANGGIL, bukan pembatas baris: satu PATCH berfilter
-- terbukti menimpa seluruh rate card klinik.
create or replace function public.kunci_riwayat_tarif_varian()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'rate card bersifat append-only: tetapkan tarif baru sebagai BARIS BARU, jangan menimpa yang lama'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.kunci_riwayat_tarif_varian() is
  'Menolak SETIAP UPDATE variant_rates dari peran API — owner sekalipun. '
  'Verba UPDATE sengaja TIDAK dicabut dari authenticated (owner login sebagai '
  'peran itu); yang dimatikan kemampuannya, bukan haknya. Service role tetap '
  'bebas sebagai jalur pemulihan data.';

revoke all on function public.kunci_riwayat_tarif_varian() from public, anon, authenticated;

create trigger trg_kunci_riwayat_tarif_varian
  before update on public.variant_rates
  for each row execute function public.kunci_riwayat_tarif_varian();

-- ===== HAK & RLS =====
alter table public.variant_rates enable row level security;

create policy "variant_rates: hanya owner" on public.variant_rates
  for all to authenticated
  using (user_role() = 'owner') with check (user_role() = 'owner');

revoke all on public.variant_rates from anon;
grant select, insert, update on public.variant_rates to authenticated;
revoke delete on public.variant_rates from authenticated;

comment on table public.variant_rates is
  'RIWAYAT tarif per VARIAN — bukan satu baris harga yang ditimpa. '
  'APPEND-ONLY untuk peran API: INSERT hanya dengan berlaku_sejak yang MAJU, '
  'UPDATE ditolak seluruhnya, DELETE sudah dicabut. Harga klien dipajang '
  'publik lewat view harga_publik; honor_mitra tidak pernah keluar dari sini.';
```

- [ ] **Step 4: Reset & jalankan uji, pastikan HIJAU**

Run: `npm run db:recover && npx vitest run tests/varian-tarif-pengerasan.test.ts`
Expected: PASS, 8 uji

- [ ] **Step 5: Jalankan suite penuh**

Run: `npm test`
Expected: PASS — kode belum menyentuh tabel baru, jadi tidak ada yang berubah artinya.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20260906120000_tarif_per_varian.sql web/tests/varian-tarif-pengerasan.test.ts
git commit -m "feat(tarif): variant_rates beserta seluruh pagar uang service_rates"
```

---

### Task 4: Kode owner pindah ke `variant_rates`, medan harga coret

**Files:**
- Modify: `web/src/lib/owner/data.ts` (`ambilTarif`, `ambilRateCard`, tipe `BarisTarif`/`TarifRingkas`)
- Modify: `web/src/lib/owner/rekap.ts` (pencocokan tarif ke sesi lewat `variantId`)
- Modify: `web/src/app/owner/tarif/aksi.ts` (`tetapkanTarif`)
- Modify: `web/src/app/owner/tarif/status.ts` (validator + kalimat harga coret)
- Modify: `web/src/app/owner/tarif/form-tarif.tsx` (medan + tombol `+20rb`)
- Modify: `web/src/app/owner/tarif/page.tsx` (daftar per varian)
- Create: `web/src/lib/varian.ts` (perangkai label varian — dipakai bersama Task 7 & 8)
- Create: `web/tests/varian-label.test.ts`
- Modify: `web/tests/owner-tarif.test.ts`, `web/tests/owner-rekap.test.ts`

**Interfaces:**
- Consumes: `variant_rates` (Task 3), `sessions.variant_id` (Task 2).
- Produces:
  - `TarifRingkas` (`lib/owner/rekap.ts`): `serviceId` **diganti** `variantId: string`, ditambah `hargaCoret: number | null`.
  - `BarisRateCard` (`lib/owner/data.ts`): ditambah `variantId: string` dan `labelVarian: string`; tetap membawa `serviceId` & `namaLayanan` untuk pengelompokan tampilan.
  - `SesiRekap` (`lib/owner/rekap.ts`): ditambah `variantId: string` — inilah kunci pencocokan tarif yang baru.
  - `tetapkanTarif(formData)` menerima medan `varian` (bukan `layanan`) dan `harga_coret`.
  - `labelVarian({ label, durasiMenit, format }): string` di `lib/varian.ts` — SATU perangkai untuk rate card, tagihan admin, dan landing.

- [ ] **Step 1: Tulis uji yang gagal — validator harga coret**

```ts
// tambahkan di web/tests/owner-tarif.test.ts
import { periksaHargaCoret } from "@/app/owner/tarif/status";

describe("harga coret", () => {
  it("kosong berarti tanpa badge — bukan galat", () => {
    expect(periksaHargaCoret("", 179000)).toEqual({ ok: true, nilai: null });
  });

  it("menolak harga coret lebih murah dari harga klien", () => {
    const hasil = periksaHargaCoret("150000", 179000);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/tidak boleh lebih murah/i);
  });

  it("menerima harga coret di atas harga klien", () => {
    expect(periksaHargaCoret("199000", 179000)).toEqual({ ok: true, nilai: 199000 });
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/owner-tarif.test.ts -t "harga coret"`
Expected: FAIL — `periksaHargaCoret is not a function`

- [ ] **Step 3: Tambahkan validator di `status.ts`**

```ts
// web/src/app/owner/tarif/status.ts — tambahan
export type PeriksaHargaCoret =
  | { ok: true; nilai: number | null }
  | { ok: false; pesan: string };

/**
 * Harga coret adalah angka PEMASARAN: harga sebelum diskon soft launch.
 *
 * Kosong berarti "tidak sedang promo" dan itu keadaan yang sah — bukan galat.
 * Yang tidak sah adalah harga coret yang lebih MURAH dari harga jual: badge
 * promonya tetap tampil, dan pengunjung membacanya sebagai kenaikan harga.
 * CHECK `variant_rates_nilai_wajar` menjaga hal yang sama di basis data; yang
 * di sini ada supaya jawabannya berupa KALIMAT.
 */
export function periksaHargaCoret(mentah: string, hargaKlien: number): PeriksaHargaCoret {
  const teks = mentah.trim();
  if (teks === "") return { ok: true, nilai: null };

  const nominal = periksaNominal(teks, "Harga coret");
  if (!nominal.ok) return { ok: false, pesan: nominal.pesan };
  if (nominal.nilai < hargaKlien) {
    return { ok: false, pesan: PESAN.coretLebihMurah };
  }
  return { ok: true, nilai: nominal.nilai };
}
```

Tambahkan ke `PESAN`:

```ts
  coretLebihMurah: "Harga coret tidak boleh lebih murah dari harga klien — itu terbaca sebagai kenaikan harga.",
  varianWajib: "Varian wajib dipilih.",
  varianTakDikenal: "Varian tidak dikenal. Pilih salah satu varian yang ada.",
```

Ganti `pesanKodePostgres` agar mengenali constraint baru:

```ts
export function pesanKodePostgres(kode: string | undefined): string {
  if (kode === "23505") return PESAN.kembar;
  if (kode === "42501") return `${PESAN.mundur}.`;
  if (kode === "23514") return PESAN.takWajar;
  if (kode === "23503") return PESAN.varianTakDikenal;
  return PESAN.gagal;
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/owner-tarif.test.ts -t "harga coret"`
Expected: PASS, 3 uji

- [ ] **Step 5: Perangkai label varian — satu-satunya**

```ts
// web/tests/varian-label.test.ts
import { describe, it, expect } from "vitest";
import { labelVarian } from "@/lib/varian";

/**
 * SATU perangkai untuk tiga layar (rate card owner, tagihan admin, landing).
 *
 * Dua perangkai akan berpisah, dan perpisahannya berbentuk varian yang bernama
 * berbeda di dua tempat — klien membaca "90 menit · Private" di landing dan
 * "Private" di tagihan, lalu bertanya apakah itu layanan yang sama.
 */
describe("labelVarian", () => {
  it("merangkai label, durasi, dan format yang terisi", () => {
    expect(labelVarian({ label: "Basic", durasiMenit: 60, format: "private" }))
      .toBe("Basic · 60 menit · Private");
  });

  it("melewati bagian yang kosong", () => {
    expect(labelVarian({ label: "", durasiMenit: 90, format: null })).toBe("90 menit");
    expect(labelVarian({ label: "2 modul", durasiMenit: 60, format: null }))
      .toBe("2 modul · 60 menit");
  });

  it("varian baku tanpa apa pun memulangkan string kosong", () => {
    // Pemanggil yang menampilkannya jatuh ke nama layanan — keputusan itu
    // milik layar, bukan milik perangkai.
    expect(labelVarian({ label: "", durasiMenit: null, format: null })).toBe("");
  });
});
```

```ts
// web/src/lib/varian.ts
export type FormatVarian = "private" | "circle";

/**
 * Nama tampilan sebuah varian, dirangkai dari bagian yang terisi saja.
 *
 * Urutannya tetap: label dulu (program bernama seperti "Basic"/"2 modul"),
 * lalu durasi, lalu format. Varian baku memulangkan string kosong; layar yang
 * memanggilnya menampilkan nama layanan sebagai gantinya.
 */
export function labelVarian(v: {
  label: string;
  durasiMenit: number | null;
  format: FormatVarian | null;
}): string {
  const bagian = [
    v.label.trim(),
    v.durasiMenit === null ? "" : `${v.durasiMenit} menit`,
    v.format === null ? "" : v.format === "private" ? "Private" : "Circle",
  ].filter((b) => b !== "");
  return bagian.join(" · ");
}
```

Run: `npx vitest run tests/varian-label.test.ts` — MERAH lebih dulu, lalu HIJAU.

- [ ] **Step 6: Pindahkan `tetapkanTarif` ke varian**

Di `web/src/app/owner/tarif/aksi.ts`: ganti `serviceId` menjadi `variantId` dibaca dari medan `varian`; ganti pemeriksaan keberadaan dari tabel `services` ke `service_variants`; ganti kedua query `service_rates` menjadi `variant_rates` dengan `.eq("variant_id", variantId)`; sisipkan `harga_coret` pada payload insert. Lima aturan di komentar puncak berkas tetap berlaku apa adanya — perbarui rujukan tabel di dalamnya, jangan hapus alasannya.

```ts
  const variantId = String(formData.get("varian") ?? "").trim();
  const harga = periksaNominal(String(formData.get("harga") ?? ""), "Harga klien");
  const honor = periksaNominal(String(formData.get("honor") ?? ""), "Honor mitra");
  const mentahMulai = String(formData.get("mulai") ?? "").trim();
  const mulai = periksaTanggal(mentahMulai || hariIniJakarta());

  if (!variantId) return { ok: false, pesan: PESAN.varianWajib };
  if (!harga.ok) return { ok: false, pesan: harga.pesan };
  if (!honor.ok) return { ok: false, pesan: honor.pesan };
  if (!mulai.ok) return { ok: false, pesan: mulai.pesan };
  if (honor.nilai > harga.nilai) return { ok: false, pesan: PESAN.honorMelebihiHarga };

  // Dibaca SESUDAH harga tervalidasi: batasnya relatif terhadap harga klien.
  const coret = periksaHargaCoret(String(formData.get("harga_coret") ?? ""), harga.nilai);
  if (!coret.ok) return { ok: false, pesan: coret.pesan };
```

dan payload insert-nya:

```ts
    .from("variant_rates")
    .insert({
      variant_id: variantId,
      harga_klien: harga.nilai,
      harga_coret: coret.nilai,
      honor_mitra: honor.nilai,
      berlaku_sejak: mulai.nilai,
    })
    .select("id");
```

- [ ] **Step 7: Pindahkan pembacaan di `lib/owner/data.ts` dan `lib/owner/rekap.ts`**

`ambilTarif()` membaca `variant_rates` dan ikut membawa varian beserta layanannya:

```ts
    .from("variant_rates")
    .select(
      "id, variant_id, harga_klien, harga_coret, honor_mitra, berlaku_sejak, " +
      "service_variants(id, label, durasi_menit, format, service_id, services(nama))",
    )
    .order("berlaku_sejak", { ascending: false })
```

`TarifRingkas` di `rekap.ts` menukar `serviceId` menjadi `variantId`, dan `hitungRekap()` mencocokkan tarif ke sesi lewat `sesi.variantId`. `tarifPadaTanggal()` **tidak disalin ulang** — ia tetap satu definisi yang dipakai bersama rate card; menuliskannya ulang melahirkan dua aturan yang berpisah diam-diam, dan perpisahan itu berbentuk rate card yang menampilkan satu angka sementara honor dibayarkan dengan angka lain.

- [ ] **Step 8: Uji pemilihan harga berlaku per varian (B2)**

```ts
// tambahkan di web/tests/owner-tarif.test.ts
it("rate card memilih tarif berlaku per VARIAN, bukan per layanan", async () => {
  // Dua varian satu layanan, tarif berbeda: tarif varian A tidak boleh bocor
  // menjadi "berlaku" bagi varian B. Ini yang dulu mustahil salah — dulu hanya
  // ada satu tarif per layanan.
  const baris = await ambilRateCard(hariIni);
  const a = baris.find((b) => b.variantId === varianA)!;
  const b = baris.find((b) => b.variantId === varianB)!;
  expect(a.berlaku!.hargaKlien).toBe(350000);
  expect(b.berlaku!.hargaKlien).toBe(400000);
});

it("tarif bertanggal masa depan tidak dianggap berlaku", async () => {
  const baris = await ambilRateCard(hariIni);
  const a = baris.find((b) => b.variantId === varianA)!;
  expect(a.riwayat.some((r) => r.belumBerlaku)).toBe(true);
  expect(a.berlaku!.berlakuSejak <= hariIni).toBe(true);
});
```

Run: `npx vitest run tests/owner-tarif.test.ts -t "berlaku"` — MERAH lebih dulu, lalu HIJAU sesudah
`ambilRateCard()` mendaftar per varian.

- [ ] **Step 9: Formulir & halaman**

`form-tarif.tsx`: tambah medan `harga_coret` (opsional, boleh kosong) dan tombol kecil bertulisan `+20rb` yang mengisi medan itu dari nilai medan harga — **di sisi klien saja**. Tombol itu kenyamanan mengetik, bukan aturan; server tidak pernah menghitung `harga + 20000`.

`page.tsx`: baris daftar berpindah dari per-layanan ke per-varian, memakai `labelVarian()`; varian yang memulangkan string kosong tampil sebagai nama layanannya saja.

- [ ] **Step 10: Jalankan suite penuh**

Run: `npm test`
Expected: PASS. `owner-tarif` dan `owner-rekap` akan merah lebih dulu karena fixture-nya menyemai `service_rates` — perbarui fixture-nya ke `variant_rates`, dan pertahankan MAKSUD tiap asersi (mis. "tarif mundur ditolak") apa adanya.

- [ ] **Step 11: Commit**

```bash
git add web/src/lib/owner web/src/lib/varian.ts web/src/app/owner/tarif web/tests/varian-label.test.ts web/tests/owner-tarif.test.ts web/tests/owner-rekap.test.ts
git commit -m "feat(owner): rate card per varian + medan harga coret"
```

---

### Task 5: Jatuhkan `service_rates`

**Files:**
- Create: `web/supabase/migrations/20260906130000_bubarkan_service_rates.sql`
- Modify: `web/tests/money-firewall-struktural.test.ts`
- Modify: `web/tests/grant-anon.test.ts` (ganti `service_rates` → `variant_rates` di `TABEL_TERTUTUP_ANON`)
- Modify: `web/supabase/seed.sql`

**Interfaces:**
- Consumes: Task 4 (tidak ada lagi kode yang membaca `service_rates`).
- Produces: `service_rates` tidak ada lagi. Tarif hidup hanya di `variant_rates`.

- [ ] **Step 1: Buktikan tidak ada lagi pembaca**

Run: `grep -rn "service_rates" web/src | grep -v "^web/src.*--"`
Expected: hanya kemunculan di dalam komentar. Bila ada pemanggilan sungguhan, kembali ke Task 4 — jangan menjatuhkan tabel yang masih dibaca.

- [ ] **Step 2: Tulis uji yang gagal**

```ts
// tambahkan di web/tests/money-firewall-struktural.test.ts
it("service_rates sudah tidak ada — tarif hidup di variant_rates", async () => {
  const [row] = await querySql<{ ada: boolean }>(
    `select to_regclass('public.service_rates') is not null as ada`,
  );
  expect(row.ada).toBe(false);
});
```

Ganti pula konstanta di berkas yang sama, beserta alasannya:

```ts
/**
 * Satu-satunya tempat sah bagi nominal uang.
 *
 * `service_rates` dibubarkan (migration bubarkan_service_rates); tarif kini
 * per VARIAN. Daftarnya tidak diperlebar — ia dipindahkan.
 */
const TABEL_UANG = new Set(["variant_rates", "honor_marks"]);
```

- [ ] **Step 3: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/money-firewall-struktural.test.ts`
Expected: FAIL — `service_rates` masih ada

- [ ] **Step 4: Tulis migrasi**

```sql
-- web/supabase/migrations/20260906130000_bubarkan_service_rates.sql
-- ============================================================================
-- BUBARKAN service_rates — dua sumber harga adalah satu sumber yang basi
-- ============================================================================
-- Barisnya sudah tersalin ke variant_rates (migration tarif_per_varian) dan
-- kode owner sudah pindah membacanya. Membiarkan keduanya hidup berdampingan
-- berarti dua sumber harga, dan yang satu pasti basi tanpa ada yang tahu
-- kapan.

-- TIDAK ADA jejak audit yang perlu dipindah. Diverifikasi dengan
--   grep -rn "on public.service_rates" supabase/migrations/*.sql
-- yang hanya memulangkan dua pemicu pengerasan_tabel_uang, keduanya sudah
-- punya pasangan di variant_rates. `catat_status_bayar` menempel pada
-- sessions/client_packages — bukan pada tabel tarif.
drop trigger if exists trg_guard_tarif_maju     on public.service_rates;
drop trigger if exists trg_kunci_riwayat_tarif  on public.service_rates;
drop table public.service_rates;

-- Kedua fungsi ini khusus service_rates dan tidak dirujuk objek lain sesudah
-- tabelnya jatuh, jadi ia dibersihkan bersama tabelnya.
drop function if exists public.guard_tarif_maju();
drop function if exists public.kunci_riwayat_tarif();
```

- [ ] **Step 5: Sapu rujukan tabel di komentar**

Tiga berkas menyebut `service_rates` di dalam komentar dan akan menyesatkan pembaca berikutnya:
`web/src/lib/owner/rupiah.ts` (aturan rupiah bulat), `web/src/app/passport/bayar/page.tsx` (alasan
nominal tidak sampai ke layar klien), dan `web/src/app/owner/tarif/form-tarif.tsx` (alasan tidak ada
tombol hapus). Ganti nama tabelnya; **jangan hapus alasannya** — alasan itulah isi komentarnya.

- [ ] **Step 6: Perbarui seed**

Di `web/supabase/seed.sql`, ganti blok `insert into service_rates ...` menjadi insert ke `variant_rates` yang menunjuk varian baku tiap layanan:

```sql
insert into variant_rates (variant_id, harga_klien, honor_mitra)
  select v.id, r.harga, r.honor
    from (values
      ('11111111-1111-1111-1111-111111111101'::uuid, 425000, 190000),
      ('11111111-1111-1111-1111-111111111102'::uuid, 250000, 100000),
      ('11111111-1111-1111-1111-111111111103'::uuid, 300000, 130000),
      ('11111111-1111-1111-1111-111111111104'::uuid, 350000, 150000),
      ('11111111-1111-1111-1111-111111111105'::uuid, 275000, 110000),
      ('11111111-1111-1111-1111-111111111106'::uuid, 450000, 200000),
      ('11111111-1111-1111-1111-111111111107'::uuid, 400000, 175000),
      ('11111111-1111-1111-1111-111111111108'::uuid, 375000, 160000),
      ('11111111-1111-1111-1111-111111111109'::uuid, 400000, 180000),
      ('11111111-1111-1111-1111-111111111110'::uuid, 300000, 125000)
    ) as r(service_id, harga, honor)
    join service_variants v on v.service_id = r.service_id;
```

Nominalnya sengaja sama persis dengan seed lama: mengubahnya sekaligus akan mencampur dua sebab bila ada uji rekap yang merah.

- [ ] **Step 7: Reset & jalankan suite penuh**

Run: `npm run db:recover && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/owner/rupiah.ts web/src/app/passport/bayar/page.tsx web/supabase/migrations/20260906130000_bubarkan_service_rates.sql web/supabase/seed.sql web/tests/money-firewall-struktural.test.ts web/tests/grant-anon.test.ts
git commit -m "refactor(tarif): bubarkan service_rates — tarif hanya di variant_rates"
```

---

### Task 6: View `harga_publik` — harga tampil, honor tidak ikut

**Files:**
- Create: `web/supabase/migrations/20260906140000_harga_publik.sql`
- Create: `web/tests/harga-publik.test.ts`
- Modify: `web/tests/money-firewall-struktural.test.ts` (pengecualian yang dijelaskan)

**Interfaces:**
- Consumes: `variant_rates` (Task 3).
- Produces: view `public.harga_publik (variant_id, harga_klien, harga_coret, berlaku_sejak)` yang dibaca `anon` dan `authenticated`.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/harga-publik.test.ts
import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * Batas kerahasiaan harga publik adalah DAFTAR KOLOM view ini.
 *
 * Karena itu daftarnya dikunci sebagai assertion, bukan sekadar dipercayakan
 * pada niat: menambahkan `honor_mitra` ke proyeksi adalah satu baris ketikan,
 * dan tanpa uji ini ia lolos tanpa satu pun assertion berubah merah.
 */
describe("view harga_publik", () => {
  it("kolomnya PERSIS empat — honor_mitra tidak ada", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'harga_publik'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "variant_id",
      "harga_klien",
      "harga_coret",
      "berlaku_sejak",
    ]);
  });

  it("anon boleh membacanya, dan mendapat baris", async () => {
    const { data, error } = await anonClient().from("harga_publik").select("variant_id").limit(1);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("anon tetap tidak bisa menyentuh variant_rates langsung", async () => {
    const { error } = await anonClient().from("variant_rates").select("harga_klien").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("tarif yang belum berlaku tidak bocor ke pengunjung", async () => {
    const svc = createAdminSupabase();
    const { data: varian } = await svc.from("service_variants").select("id").limit(1);
    const variantId = varian![0].id as string;

    const besok = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await svc.from("variant_rates").insert({
      variant_id: variantId,
      harga_klien: 12_345_678,
      honor_mitra: 0,
      berlaku_sejak: besok,
    });

    const { data } = await anonClient()
      .from("harga_publik")
      .select("harga_klien")
      .eq("variant_id", variantId);
    expect((data ?? []).map((b) => b.harga_klien)).not.toContain(12_345_678);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/harga-publik.test.ts`
Expected: FAIL — daftar kolom kosong; view belum ada

- [ ] **Step 3: Tulis migrasi**

```sql
-- web/supabase/migrations/20260906140000_harga_publik.sql
-- ============================================================================
-- HARGA PUBLIK — view berkolom sempit sebagai batas kerahasiaan
-- ============================================================================
-- Pengunjung harus bisa melihat pricelist; honor mitra tidak boleh bocor
-- sedikit pun. Keduanya duduk di satu tabel, dan itu memang disengaja: CHECK
-- `honor_mitra <= harga_klien` hanya mungkin selama keduanya satu baris.
--
-- Batasnya karena itu bukan batas TABEL melainkan batas KOLOM, dan proyek ini
-- sudah punya polanya: `partner_publik` (pengerasan_admin) — view berkolom
-- sempit dengan security_invoker = off, dipakai justru karena klien tidak
-- punya, dan tidak boleh punya, hak baca atas tabel dasarnya.
--
-- Penolakan view di lib/owner/rekap.ts menyasar sesuatu yang lain: view
-- AGREGAT yang diam-diam melewati RLS dan membocorkan rate card lengkap ke
-- admin. Yang di sini sempit, disengaja, dan daftar kolomnya dikunci uji
-- (tests/harga-publik.test.ts).
--
-- `where berlaku_sejak <= hari ini`: tarif yang BELUM berlaku adalah rencana
-- harga, bukan harga. Kalendernya Asia/Jakarta, bukan `current_date` yang UTC —
-- setiap dini hari WIB `current_date` masih kemarin.

create view public.harga_publik with (security_invoker = off) as
  select variant_id, harga_klien, harga_coret, berlaku_sejak
    from public.variant_rates
   where berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date;

revoke all on public.harga_publik from public, anon, authenticated;
grant select on public.harga_publik to anon, authenticated;

comment on view public.harga_publik is
  'Harga klien untuk landing & katalog publik. security_invoker = off '
  'disengaja: view inilah batas kolomnya, dan anon memang tidak punya hak baca '
  'atas variant_rates. honor_mitra TIDAK ADA di proyeksi dan daftar kolomnya '
  'dikunci sebagai assertion di tests/harga-publik.test.ts.';
```

- [ ] **Step 4: Reset & jalankan uji, pastikan HIJAU**

Run: `npm run db:recover && npx vitest run tests/harga-publik.test.ts`
Expected: PASS, 4 uji

- [ ] **Step 5: Daftarkan pengecualian di money firewall**

`money-firewall-struktural.test.ts` memindai view juga. `harga_publik` memuat `harga_klien` dan akan menabraknya. Daftarkan sebagai pengecualian **beserta alasannya** — jangan longgarkan polanya:

```ts
/**
 * Satu-satunya view yang boleh memuat kolom nominal.
 *
 * Harga klien memang DIPUTUSKAN tampil publik (spec V4): pengunjung harus bisa
 * melihat pricelist sebelum mendaftar. Yang tidak berubah: honor mitra tidak
 * pernah keluar dari variant_rates, dan daftar kolom view ini dikunci terpisah
 * di tests/harga-publik.test.ts — pengecualian ini tidak memberi izin untuk
 * menambah kolom, hanya untuk empat kolom yang sudah diuji di sana.
 */
const VIEW_HARGA_PUBLIK = "harga_publik";
```

lalu kecualikan view itu di pemindaian, bukan melebarkan `TABEL_UANG`.

- [ ] **Step 6: Jalankan suite penuh**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/supabase/migrations/20260906140000_harga_publik.sql web/tests/harga-publik.test.ts web/tests/money-firewall-struktural.test.ts
git commit -m "feat(katalog): view harga_publik — harga tampil, honor tidak ikut"
```

---

### Task 7: Admin › Layanan mengelola varian

**Files:**
- Modify: `web/src/app/admin/layanan/aksi.ts`
- Modify: `web/src/app/admin/layanan/status.ts`
- Modify: `web/src/app/admin/layanan/form-layanan.tsx` (atau berkas form varian baru bila berkasnya sudah panjang)
- Modify: `web/src/app/admin/layanan/page.tsx`
- Modify: `web/src/lib/admin/katalog-admin.ts`
- Modify: `web/tests/admin-layanan.test.ts`

**Interfaces:**
- Consumes: `service_variants` (Task 1).
- Produces: `buatVarian(formData)`, `perbaruiVarian(formData)`, `aktifkanVarian(formData)`, `nonaktifkanVarian(formData)` — semuanya `Promise<{ok:true}|{ok:true;id:string}|{ok:false;pesan:string}>` mengikuti bentuk action katalog yang sudah ada.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// tambahkan di web/tests/admin-layanan.test.ts
describe("varian layanan", () => {
  it("menolak menonaktifkan varian aktif TERAKHIR sebuah layanan", async () => {
    // V3: layanan tanpa varian aktif membuat setiap perhitungan harga
    // bercabang dua selamanya, dan cabang keduanya hanya muncul di produksi.
    const hasil = await nonaktifkanVarian(formOf({ varian: varianTunggalId }));
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/varian terakhir/i);
  });

  it("membolehkan menonaktifkan varian bila masih ada varian aktif lain", async () => {
    const hasil = await nonaktifkanVarian(formOf({ varian: varianKeduaId }));
    expect(hasil.ok).toBe(true);
  });

  it("tidak pernah memindahkan varian ke layanan lain", async () => {
    // Setiap sesi yang menunjuk varian ini akan ikut berganti arti tanpa satu
    // pun error — pelajaran yang sama dengan perbaruiPaket.
    await perbaruiVarian(formOf({ varian: varianId, service_id: layananLainId, label: "X" }));
    const { data } = await svc.from("service_variants").select("service_id").eq("id", varianId).single();
    expect(data!.service_id).toBe(layananAsalId);
  });
});
```

Lengkapi `formOf`, `varianTunggalId`, `varianKeduaId` mengikuti fixture yang sudah dipakai berkas itu untuk layanan & paket.

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/admin-layanan.test.ts -t "varian layanan"`
Expected: FAIL — `nonaktifkanVarian is not a function`

- [ ] **Step 3: Tulis action & validator**

Ikuti enam aturan di komentar puncak `aksi.ts` apa adanya:

- `requireRole(["admin","owner"])` di dalam SETIAP action.
- Keadaan tujuan tidak pernah jadi parameter → `aktifkanVarian` dan `nonaktifkanVarian` terpisah, nilai `aktif` tertulis mati.
- Tidak ada penghapusan.
- `perbaruiVarian` tidak pernah membaca `service_id` dari FormData.
- Periksa panjang `.select("id")` sesudah setiap tulis.
- Sesi pengguna, bukan service role.

Pagar V3 di `nonaktifkanVarian`: hitung varian aktif lain milik layanan yang sama; bila nol, tolak dengan kalimat. Ini pemeriksaan aplikasi — catat di komentar bahwa ia BUKAN pagar basis data, dan sebutkan konsekuensinya (REST bisa melewatinya) supaya keputusan itu sadar, bukan lupa.

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/admin-layanan.test.ts`
Expected: PASS

- [ ] **Step 5: Halaman & formulir**

`page.tsx` menampilkan varian di bawah tiap layanan; `katalog-admin.ts` membacanya bersama layanan. Panel admin **tidak memuat satu nominal pun** — varian di sini adalah katalog, bukan uang. Uji money firewall yang sudah ada akan menangkapnya bila nominal ikut terbawa.

`segarkanKatalog()` ditambah tidak ada rute baru; varian ikut kanal yang sama karena landing dan wizard membaca tabel yang sama.

- [ ] **Step 6: Label tagihan menyertakan varian**

`web/src/lib/admin/tagihan.ts` menyusun label item sebagai `"<nama layanan>"` untuk sesi lepas.
Dengan varian, dua sesi berlabel sama bisa berharga beda — label yang tidak menyebut variannya
membuat klien menagih hal yang salah. Tambahkan varian ke label lewat `labelVarian()` dari `web/src/lib/varian.ts` (Task 4, Step 5);
jangan menulis perangkai kedua.

Panel admin tetap tidak memuat nominal — yang ditambahkan label, bukan angka.

- [ ] **Step 7: Jalankan suite penuh & commit**

```bash
npm test
git add web/src/app/admin/layanan web/src/lib/admin/katalog-admin.ts web/src/lib/admin/tagihan.ts web/tests/admin-layanan.test.ts
git commit -m "feat(admin): kelola varian layanan"
```

---

### Task 8: Landing menampilkan harga bertingkat

**Files:**
- Modify: `web/src/lib/katalog.ts`
- Modify: komponen landing yang merender `FaseKatalog.layanan`
- Modify: `web/tests/landing-katalog.test.ts`

**Interfaces:**
- Consumes: view `harga_publik` (Task 6), `service_variants` (Task 1).
- Produces: `FaseKatalog.layanan` berubah dari `string[]` menjadi
  `Array<{ id: string; nama: string; varian: Array<{ label: string; hargaKlien: number; hargaCoret: number | null }> }>`.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// tambahkan di web/tests/landing-katalog.test.ts
it("varian nonaktif tidak muncul di katalog publik", async () => {
  const katalog = await bacaKatalog();
  const semua = katalog.flatMap((f) => f.layanan).flatMap((l) => l.varian);
  expect(semua.some((v) => v.label === LABEL_VARIAN_NONAKTIF)).toBe(false);
});

it("harga coret terbawa apa adanya; NULL berarti tanpa badge", async () => {
  const katalog = await bacaKatalog();
  const varian = katalog.flatMap((f) => f.layanan).flatMap((l) => l.varian);
  expect(varian.some((v) => v.hargaCoret !== null)).toBe(true);
  expect(varian.some((v) => v.hargaCoret === null)).toBe(true);
});

it("varian terurut menurut kolom urutan", async () => {
  const layanan = (await bacaKatalog()).flatMap((f) => f.layanan)
    .find((l) => l.id === LAYANAN_BERVARIAN)!;
  expect(layanan.varian.map((v) => v.label)).toEqual(["60 menit", "90 menit", "120 menit"]);
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/landing-katalog.test.ts`
Expected: FAIL — `l.varian is undefined`

- [ ] **Step 3: Ubah `bacaKatalog()`**

Tetap memakai **anon key**, bukan sesi pengguna dan bukan service role — alasannya sudah tertulis di puncak `katalog.ts` dan tidak berubah: bila policy baca publik hilang, landing kosong harus tertangkap uji. Tambahkan dua pembacaan: `service_variants` (aktif saja, urut `urutan`) dan `harga_publik`. Harga berlaku = baris ber-`berlaku_sejak` terbesar per varian; view sudah membuang tarif masa depan, jadi pemilihannya tinggal "ambil yang terbesar".

Label varian memakai `labelVarian()` dari `web/src/lib/varian.ts` (Task 4, Step 5) — fungsi yang sama dengan rate card owner dan tagihan admin. Varian yang memulangkan string kosong ditampilkan sebagai nama layanannya saja.

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/landing-katalog.test.ts`
Expected: PASS

- [ ] **Step 5: Render**

Harga coret memakai `<s>` beserta label "Soft Launch"; `hargaCoret === null` merender harga polos tanpa badge. Teks "Soft Launch" ditulis di komponen, bukan `app_settings` (V7) — sakelarnya adalah terisi/kosongnya `harga_coret`.

- [ ] **Step 6: Jalankan suite penuh & commit**

```bash
npm test
git add web/src/lib/katalog.ts web/src/app/_landing web/tests/landing-katalog.test.ts
git commit -m "feat(landing): katalog menampilkan varian & harga soft launch"
```

---

### Task 9: Jalur tulis memilih varian, lalu `variant_id` dikunci NOT NULL

**Files:**
- Modify: `web/src/lib/passport/aksi.ts` (`ajukanJadwal`)
- Modify: `web/src/app/passport/ajukan/page.tsx`, `form.tsx`
- Modify: `web/src/app/admin/sesi/aksi.ts` (pembuatan sesi & penerbitan sesi dari permintaan)
- Create: `web/supabase/migrations/20260906150000_varian_wajib.sql`
- Modify: `web/tests/passport-pembatas-jadwal.test.ts`, `web/tests/admin-sesi-konfirmasi.test.ts`

**Interfaces:**
- Consumes: kolom nullable dari Task 2.
- Produces: `sessions.variant_id` dan `booking_requests.variant_id` **NOT NULL**. Sesudah tugas ini, sesi tanpa varian tidak bisa ada.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// tambahkan di web/tests/passport-pembatas-jadwal.test.ts
it("menolak pengajuan tanpa varian", async () => {
  const hasil = await ajukanJadwal(formOf({ layanan: layananId, tanggal: besok, waktu: "pagi" }));
  expect(hasil.ok).toBe(false);
});

it("menolak varian milik layanan lain", async () => {
  const hasil = await ajukanJadwal(
    formOf({ layanan: layananId, varian: varianLayananLain, tanggal: besok, waktu: "pagi" }),
  );
  expect(hasil.ok).toBe(false);
});

it("menyimpan variant_id yang dipilih", async () => {
  const hasil = await ajukanJadwal(
    formOf({ layanan: layananId, varian: varianId, tanggal: besok, waktu: "pagi" }),
  );
  expect(hasil.ok).toBe(true);
  const { data } = await svc.from("booking_requests").select("variant_id")
    .eq("client_id", klienId).order("created_at", { ascending: false }).limit(1).single();
  expect(data!.variant_id).toBe(varianId);
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/passport-pembatas-jadwal.test.ts`
Expected: FAIL — pengajuan tanpa varian masih `ok: true`

- [ ] **Step 3: Ubah jalur tulis**

`ajukanJadwal` memeriksa varian dengan cara yang sama seperti ia sudah memeriksa layanan aktif hari ini: satu query ke `service_variants` yang menyaring `id = varianId AND service_id = serviceId AND aktif = true`. Menyaring keduanya sekaligus, bukan hanya `id`, supaya penolakan "varian milik layanan lain" berupa **kalimat** — FK gabungan tetap menjadi lapisan terakhir, dan pesannya kode Postgres.

Wizard (`page.tsx` + `form.tsx`) menarik varian bersama layanan dan menampilkannya sebagai pilihan kedua. Halaman ini membaca dengan **sesi pengguna**, bukan `bacaKatalog()` — alasannya sudah tertulis di `page.tsx` dan tidak berubah.

`admin/sesi/aksi.ts` meneruskan `variant_id` saat menerbitkan sesi dari permintaan jadwal, dan menerima pilihan varian saat admin menjadwalkan sesi langsung.

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/passport-pembatas-jadwal.test.ts tests/admin-sesi-konfirmasi.test.ts`
Expected: PASS

- [ ] **Step 5: Kunci NOT NULL**

```sql
-- web/supabase/migrations/20260906150000_varian_wajib.sql
-- ============================================================================
-- VARIAN WAJIB — menutup jendela yang sengaja dibuka
-- ============================================================================
-- Kolomnya dibiarkan NULLABLE sejak migration sesi_menunjuk_varian supaya
-- jalur tulis punya waktu pindah tanpa mematikan pengajuan jadwal klien.
-- Jalur itu sudah pindah, jadi jendelanya ditutup di sini.
--
-- Sesudah ini, sesi tanpa varian tidak bisa ada — termasuk lewat REST, dan
-- termasuk lewat service role. Harga sesi karena itu selalu punya satuan.

-- Jaring pengaman: baris yang lolos di antara dua migrasi diisi varian baku.
update public.sessions s
   set variant_id = (select v.id from public.service_variants v
                      where v.service_id = s.service_id
                      order by v.urutan, v.created_at, v.id limit 1)
 where s.variant_id is null;

update public.booking_requests b
   set variant_id = (select v.id from public.service_variants v
                      where v.service_id = b.service_id
                      order by v.urutan, v.created_at, v.id limit 1)
 where b.variant_id is null;

alter table public.sessions         alter column variant_id set not null;
alter table public.booking_requests alter column variant_id set not null;
```

- [ ] **Step 6: Reset & jalankan suite penuh**

Run: `npm run db:recover && npm test`
Expected: PASS. Fixture uji yang menyisipkan `sessions`/`booking_requests` langsung akan merah — tambahkan `variant_id` pada fixture-nya. Itu memang sinyal yang diinginkan: ia menunjukkan persis di mana sesi tanpa varian dulu bisa lahir.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/passport/aksi.ts web/src/app/passport/ajukan web/src/app/admin/sesi/aksi.ts web/supabase/migrations/20260906150000_varian_wajib.sql web/tests
git commit -m "feat(jadwal): pemilihan varian di wizard klien & admin, variant_id wajib"
```

---

### Task 10: Seed — contoh varian bertingkat

**Files:**
- Modify: `web/supabase/seed.sql`
- Create: `web/tests/seed-varian.test.ts`

**Interfaces:**
- Consumes: seluruh tugas sebelumnya.
- Produces: data pengembangan yang memuat contoh kedua dimensi varian.

**Kenapa hanya tiga layanan.** 25 berkas uji menyebut UUID layanan seed — terbanyak `…111101` dengan 14 kemunculan. Tiga layanan di bawah dipilih justru karena `grep -rl` atas UUID-nya di `tests/` mengembalikan **nol berkas**, sehingga contoh bertingkat masuk dengan radius nol. Verifikasi ulang sebelum menulis; bila salah satunya sudah dirujuk, ganti dengan layanan lain yang tidak dirujuk dan catat penggantiannya di pesan commit.

- [ ] **Step 1: Verifikasi ketiga layanan masih tak dirujuk**

Run: `for n in 107 108 109; do echo "$n: $(grep -rl "11111111-1111-1111-1111-111111111$n" web/tests | wc -l)"; done`
Expected: ketiganya `0`

- [ ] **Step 2: Tulis uji yang gagal**

```ts
// web/tests/seed-varian.test.ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

/**
 * Data pengembangan harus memuat KEDUA dimensi varian.
 *
 * Tanpa contoh bertingkat di seed, bug tampilan varian tidak punya satu pun
 * baris untuk memunculkan dirinya di lokal — dan baru ketahuan di produksi.
 */
describe("seed — contoh varian bertingkat", () => {
  it("ada layanan dengan tiga varian durasi tanpa format", async () => {
    const baris = await querySql<{ durasi_menit: number }>(
      `select durasi_menit from public.service_variants
        where service_id = '11111111-1111-1111-1111-111111111107'
          and format is null
        order by urutan`,
    );
    expect(baris.map((b) => b.durasi_menit)).toEqual([60, 90, 120]);
  });

  it("ada layanan dengan varian Private & Circle", async () => {
    const baris = await querySql<{ format: string }>(
      `select format from public.service_variants
        where service_id = '11111111-1111-1111-1111-111111111109'
        order by urutan`,
    );
    expect(baris.map((b) => b.format)).toEqual(["private", "circle"]);
  });

  it("kedua cabang harga coret ada di data pengembangan", async () => {
    const [row] = await querySql<{ dengan: string; tanpa: string }>(
      `select count(*) filter (where harga_coret is not null) as dengan,
              count(*) filter (where harga_coret is null)     as tanpa
         from public.variant_rates`,
    );
    expect(Number(row.dengan)).toBeGreaterThan(0);
    expect(Number(row.tanpa)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/seed-varian.test.ts`
Expected: FAIL — `…107` baru punya varian baku

- [ ] **Step 4: Tambahkan varian & tarifnya ke seed**

```sql
-- web/supabase/seed.sql — sesudah blok variant_rates
-- Contoh varian BERTINGKAT untuk data pengembangan.
-- Tiga layanan ini dipilih karena TIDAK dirujuk satu berkas uji pun
-- (diverifikasi dengan grep atas UUID-nya di tests/), sehingga contohnya masuk
-- tanpa memerahkan asersi yang tidak berhubungan dengan varian.
--
-- Varian baku bawaan migrasi diberi urutan 0 dan dinonaktifkan untuk kedua
-- layanan bervarian: layanan tidak boleh punya dua "harga utama" yang keduanya
-- aktif, karena landing akan menampilkan keduanya sebagai pilihan yang sah.
update service_variants set aktif = false
 where service_id in ('11111111-1111-1111-1111-111111111107',
                      '11111111-1111-1111-1111-111111111109')
   and label = '' and durasi_menit is null and format is null;

insert into service_variants (service_id, label, durasi_menit, format, urutan) values
  ('11111111-1111-1111-1111-111111111107','',60, null,1),
  ('11111111-1111-1111-1111-111111111107','',90, null,2),
  ('11111111-1111-1111-1111-111111111107','',120,null,3),
  ('11111111-1111-1111-1111-111111111109','',90,'private',1),
  ('11111111-1111-1111-1111-111111111109','',90,'circle', 2);

-- Harga coret sengaja terisi pada sebagian baris saja: kedua cabang tampilan
-- (dicoret / polos) harus ada di data pengembangan.
insert into variant_rates (variant_id, harga_klien, harga_coret, honor_mitra)
  select v.id,
         h.harga,
         h.coret,
         h.honor
    from (values
      (60,  null::varian_format, '11111111-1111-1111-1111-111111111107'::uuid, 350000, 370000, 150000),
      (90,  null,                '11111111-1111-1111-1111-111111111107'::uuid, 400000, 420000, 175000),
      (120, null,                '11111111-1111-1111-1111-111111111107'::uuid, 450000, null,   200000),
      (90,  'private',           '11111111-1111-1111-1111-111111111109'::uuid, 400000, 420000, 180000),
      (90,  'circle',            '11111111-1111-1111-1111-111111111109'::uuid, 250000, null,   110000)
    ) as h(durasi, format, service_id, harga, coret, honor)
    join service_variants v
      on v.service_id = h.service_id
     and v.durasi_menit = h.durasi
     and v.format is not distinct from h.format;
```

- [ ] **Step 5: Reset & jalankan uji, pastikan HIJAU**

Run: `npm run db:recover && npx vitest run tests/seed-varian.test.ts`
Expected: PASS, 3 uji

- [ ] **Step 6: Jalankan SELURUH suite, termasuk e2e**

Run: `npm test && npm run test:e2e:semua`
Expected: PASS seluruhnya

- [ ] **Step 7: Commit**

```bash
git add web/supabase/seed.sql web/tests/seed-varian.test.ts
git commit -m "chore(seed): contoh varian bertingkat pada layanan yang tak dirujuk uji"
```

---

## Verifikasi penutup

- [ ] `npm test` hijau seluruhnya
- [ ] `npm run test:e2e:semua` hijau seluruhnya
- [ ] `npm run lint` bersih
- [ ] `npm run build` berhasil
- [ ] `grep -rn "service_rates" web/src web/supabase/seed.sql` — nol hasil di luar komentar sejarah
- [ ] Panel admin dibuka sebagai admin: tidak ada satu nominal pun di layar mana pun
- [ ] Landing dibuka tanpa login: harga tampil, badge Soft Launch muncul hanya pada varian ber-`harga_coret`
