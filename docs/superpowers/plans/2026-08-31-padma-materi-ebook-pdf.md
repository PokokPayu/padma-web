# Materi E-Book PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti e-book berbasis bab teks dengan e-book berbasis PDF yang dirasterisasi menjadi gambar halaman ber-watermark per-pasien, plus gating baru (banyak layanan + penugasan manual).

**Architecture:** PDF dirasterisasi di **browser admin** (PDF.js → canvas → WebP), gambarnya diunggah **langsung** ke bucket privat Supabase Storage lewat signed upload URL yang path-nya ditentukan server. Pasien membacanya lewat route handler yang memutuskan hak **dengan RLS memakai sesi pasien**, baru sesudah itu service role mengunduh objeknya dan `sharp` membakar watermark identitas ke dalam gambar.

**Tech Stack:** Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind v4, Supabase (Postgres + Storage + RLS), `pdfjs-dist`, `sharp`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-padma-materi-berkas-design.md`

**Lingkup:** HANYA rantai ebook PDF. Rantai video R2 adalah rencana terpisah dan **tidak boleh disentuh di sini** — `material_videos` beserta policy dan UI-nya dibiarkan apa adanya sepanjang rencana ini.

---

## Global Constraints

Setiap batasan di bawah berlaku untuk **semua** task. Semuanya adalah pelajaran yang sudah dibayar mahal di repo ini; melanggarnya menghidupkan kembali bug yang sudah pernah terjadi.

- **Tabel baru lahir TANPA RLS, dan `authenticated` mendapat SELECT/INSERT/UPDATE default.** Setiap tabel baru wajib `enable row level security` + `revoke all ... from authenticated, anon` lalu `grant` yang persis dibutuhkan.
- **JANGAN mencabut GRANT KOLOM untuk menyembunyikan kolom.** Grant kolom mengikat pada KEHADIRAN kolom di payload; mencabutnya membuat `select *` gagal `42501`, bukan menyembunyikan. Sudah tiga kali mematahkan repo ini. Pakai **trigger** (mengikat pada perubahan NILAI) bila perlu memagari kolom.
- **PostgREST menjawab HTTP 200 + `[]` untuk UPDATE/DELETE yang ditolak RLS**, bukan error. Setiap server action wajib `.select("id")` lalu memeriksa panjangnya.
- **Server action & route handler adalah endpoint mandiri.** Layout tidak menjaganya. `requireRole([...])` ditulis DI DALAM setiap action; route handler memeriksa sesinya sendiri.
- **Materi: `materials.aktif` wajib dievaluasi DI DALAM policy isi**, bukan hanya di query aplikasi.
- **Baris `materials` tetap terbaca setiap pengguna login.** Menutupnya mengulangi bug `partner_publik`. Yang digating adalah ISI-nya.
- **Semua tanggal berbentuk string.** `toISOString`, `setDate`, `getDay` DILARANG — Vercel berjalan UTC, mesin dev WIB. Vitest berjalan `TZ=UTC`.
- **Panel admin & passport WAJIB `createServerSupabase()`.** `createAdminSupabase()` (service role) hanya boleh dipakai di titik yang disebut eksplisit oleh task, dan hanya SESUDAH hak diputuskan RLS.
- **Money firewall:** tidak satu pun kolom baru boleh memuat kata `bayar|harga|honor|tarif|biaya|total|nominal|amount|price|fee|rate|cost|payment`. `tests/money-firewall-struktural.test.ts` memindainya.
- **Cap waktu migration ditulis MANUAL** dan harus lebih besar dari berkas terakhir. `supabase migration new` memakai jam dinding dan pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal. Berkas terakhir saat rencana ini ditulis: `20260830150000_pengerasan_tabel_uang.sql`.
- **Nama policy dipertahankan PERSIS** saat menulis ulang. Policy dengan nama baru akan BERDAMPINGAN dengan yang lama (RLS meng-OR policy permisif) sehingga celahnya tetap terbuka tanpa satu pun error.
- Setelah setiap task: `npx tsc --noEmit`, `npx vitest run`, dan commit.

---

## Struktur Berkas

**Migrasi (dibuat berurutan, cap waktu naik):**

| Berkas | Tanggung jawab |
|---|---|
| `supabase/migrations/20260831100000_materi_banyak_layanan.sql` | `material_services`, migrasi `materials.service_id`, policy gating dialihkan ke tabel penghubung |
| `supabase/migrations/20260831110000_materi_penugasan.sql` | `material_assignments`, trigger `ditugaskan_oleh`, policy gating jadi OR |
| `supabase/migrations/20260831120000_materi_halaman_pdf.sql` | `material_pages`, bucket `materi-halaman`, RPC `ganti_halaman_materi` |
| `supabase/migrations/20260831130000_materi_hapus_bab_teks.sql` | Menghapus `material_chapters`, RPC `hapus_bab_materi`, dan `materials.service_id` |

**Kode:**

| Berkas | Tanggung jawab |
|---|---|
| `src/lib/materi/watermark.ts` | Membakar identitas pasien ke gambar (`sharp`). Murni: Buffer masuk, Buffer keluar |
| `src/lib/materi/rasterisasi.ts` | Fungsi murni penamaan objek & batas. Tanpa DOM, agar bisa diuji Vitest |
| `src/lib/materi/pdf-klien.ts` | Rasterisasi PDF.js di browser. Hanya diimpor client component |
| `src/lib/admin/penugasan.ts` | Lapisan data penugasan pasien (baca) |
| `src/app/admin/materi/unggah.ts` | Server action: terbitkan signed upload URL, catat halaman |
| `src/app/admin/materi/penugasan-aksi.ts` | Server action: assign / cabut assign pasien |
| `src/app/admin/materi/pengunggah-pdf.tsx` | Client component: pilih PDF → rasterisasi → unggah → progres |
| `src/app/api/materi/[id]/halaman/[n]/route.ts` | Menyajikan gambar halaman ber-watermark |
| `src/app/passport/materi/[id]/reader-pdf.tsx` | Reader halaman ebook (client, lazy-load) |
| `tests/bantu/pdf.ts` | `buatPdfUji(n)` — PDF sah tanpa dependensi, dipakai unit test & E2E |

---

### Task 1: `material_services` — satu materi, banyak layanan

**Files:**
- Create: `supabase/migrations/20260831100000_materi_banyak_layanan.sql`
- Create: `tests/materi-banyak-layanan.test.ts`
- Modify: `supabase/seed.sql` (menyisipkan `material_services`)
- Modify: `src/lib/passport/data.ts` (dua embed `services(nama)` diberi petunjuk FK)

**Interfaces:**
- Consumes: tabel `materials`, `services`, `sessions`, `clients` yang sudah ada.
- Produces: tabel `public.material_services(material_id uuid, service_id uuid)`. Policy `"chapters: klien dgn sesi selesai"` dan `"video: klien dgn sesi selesai"` yang membaca layanan lewat tabel ini, bukan lewat `materials.service_id`.

Kolom `materials.service_id` **masih ada** setelah task ini (dihapus di Task 11) supaya aplikasi tetap jalan.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-banyak-layanan.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";

const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

describe("material_services — materi boleh milik banyak layanan", () => {
  it("setiap materi lama termigrasi menjadi tepat satu baris", async () => {
    const db = svc();
    const { data: materi } = await db.from("materials").select("id, service_id");
    const { data: tautan } = await db.from("material_services").select("material_id, service_id");
    expect(materi!.length).toBeGreaterThan(0);
    for (const m of materi!) {
      const cocok = (tautan ?? []).filter(
        (t) => t.material_id === m.id && t.service_id === m.service_id,
      );
      expect(cocok, `materi ${m.id} tidak termigrasi`).toHaveLength(1);
    }
  });

  it("RLS menyala", async () => {
    // Tabel baru lahir TANPA RLS. Ini pemeriksaan yang sudah pernah menyelamatkan
    // repo ini, jadi ia ditulis untuk setiap tabel baru.
    const baris = await querySql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'material_services'`,
    );
    expect(baris[0].relrowsecurity).toBe(true);
  });

  it("authenticated hanya memegang SELECT — hak tulis default dicabut", async () => {
    const baris = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_services'
         and grantee = 'authenticated'
       order by privilege_type`);
    expect(baris.map((b) => b.privilege_type)).toEqual(["SELECT"]);
  });

  it("anon tidak memegang hak apa pun", async () => {
    const baris = await querySql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_services'
         and grantee = 'anon'`);
    expect(baris).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-banyak-layanan.test.ts`
Expected: FAIL — relasi `material_services` belum ada.

- [ ] **Step 3: Tulis migration**

```sql
-- supabase/migrations/20260831100000_materi_banyak_layanan.sql
-- ============================================================================
-- MATERI BOLEH MILIK BANYAK LAYANAN, DAN BOLEH TIDAK PUNYA SATU PUN
-- ============================================================================
-- `materials.service_id` mengunci satu materi ke satu layanan. Selama isi ebook
-- berupa teks, menyalin materi untuk layanan kedua murah. Sejak isinya menjadi
-- PDF yang dirasterisasi, menyalin berarti merasterisasi & menyimpan dua set
-- gambar halaman untuk isi yang sama persis.
--
-- Kolom `materials.service_id` SENGAJA belum dihapus di sini: aplikasi masih
-- membacanya, dan menghapusnya sekarang akan mematahkan panel admin sebelum
-- penggantinya ada. Penghapusannya menjadi migration tersendiri.

create table public.material_services (
  material_id uuid not null references public.materials(id) on delete cascade,
  service_id  uuid not null references public.services(id)  on delete cascade,
  primary key (material_id, service_id)
);

comment on table public.material_services is
  'Materi <-> Layanan, banyak-ke-banyak dan BOLEH NOL BARIS. Materi tanpa baris '
  'di sini tidak pernah terbuka otomatis; ia hanya terbuka lewat '
  'material_assignments. Panel admin wajib menandai keadaan itu — materi yang '
  'terkunci diam-diam tidak memunculkan gejala apa pun.';

-- Migrasi data: setiap materi lama menjadi tepat satu baris.
insert into public.material_services (material_id, service_id)
select id, service_id from public.materials
on conflict do nothing;

-- Tabel baru lahir TANPA RLS dan `authenticated` mendapat hak penuh secara
-- default. Keduanya dicabut eksplisit.
alter table public.material_services enable row level security;
revoke all on public.material_services from anon, authenticated;
grant select on public.material_services to authenticated;

-- Dibaca setiap pengguna login, PERSIS seperti materials.service_id yang
-- digantikannya. Tidak ada perluasan keterbukaan di sini.
-- `to authenticated` WAJIB, bukan gaya penulisan. Policy tanpa klausa itu lahir
-- TO PUBLIC, yang mencakup peran `anon` — dan
-- tests/hak-default-sequence-fungsi.test.ts menjaga agar policy pemanggil
-- user_role() tidak pernah menyasar anon.
create policy "materi-layanan: baca semua pengguna login"
  on public.material_services for select to authenticated
  using (auth.uid() is not null);

create policy "materi-layanan: staf kelola"
  on public.material_services for all to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- ---------------------------------------------------------------------------
-- Gating dialihkan ke tabel penghubung
-- ---------------------------------------------------------------------------
-- Nama policy dipertahankan PERSIS. Policy yang lahir dengan nama baru akan
-- berdampingan dengan yang lama (RLS meng-OR policy permisif), sehingga jalur
-- lama tetap terbuka tanpa satu pun error.
drop policy if exists "chapters: klien dgn sesi selesai" on public.material_chapters;
create policy "chapters: klien dgn sesi selesai" on public.material_chapters
  for select
  using (exists (
    select 1
      from public.materials m
      join public.material_services ms on ms.material_id = m.id
      join public.sessions s
        on s.service_id = ms.service_id and s.status = 'selesai'
      join public.clients c on c.id = s.client_id
     where m.id = material_id
       and m.aktif = true
       and c.user_id = auth.uid()
  ));

drop policy if exists "video: klien dgn sesi selesai" on public.material_videos;
create policy "video: klien dgn sesi selesai" on public.material_videos
  for select
  using (exists (
    select 1
      from public.materials m
      join public.material_services ms on ms.material_id = m.id
      join public.sessions s
        on s.service_id = ms.service_id and s.status = 'selesai'
      join public.clients c on c.id = s.client_id
     where m.id = material_id
       and m.aktif = true
       and c.user_id = auth.uid()
  ));
```

- [ ] **Step 4: Reset DB & jalankan test, pastikan HIJAU**

Run: `npx supabase db reset && npx vitest run tests/materi-banyak-layanan.test.ts`
Expected: PASS

- [ ] **Step 5: Perbaiki embed yang menjadi ambigu**

Tabel penghubung baru menciptakan **jalur relasi KEDUA** antara `materials` dan `services`. PostgREST tidak lagi bisa memilih, dan menolak embed-nya:

```
PGRST201: Could not embed because more than one relationship was found for 'materials' and 'services'
```

Akibatnya `ambilDaftarMateri` & `ambilMateriDetail` mengembalikan **nol baris** — bukan error yang tampak di UI, melainkan daftar materi yang diam-diam kosong. Di `src/lib/passport/data.ts`, dua tempat (`ambilDaftarMateri` ~171 dan `ambilMateriDetail` ~224) diubah:

```ts
// FK disebut EKSPLISIT karena material_services melahirkan jalur relasi kedua
// antara materials dan services. Tanpa petunjuk ini PostgREST menolak embed-nya
// (PGRST201) dan daftar materi kembali NOL BARIS tanpa satu pun error di layar.
"id, judul, tipe, deskripsi, services!materials_service_id_fkey(nama), ..."
```

**Hanya dua tempat itu.** Embed `services(nama)` lain di `src/lib/owner/data.ts`, `src/lib/admin/tagihan.ts`, dan `data.ts` baris ~88/~267 berangkat dari `sessions`/`service_rates`/`booking_requests` — satu jalur saja, tidak terpengaruh.

- [ ] **Step 6: Sisipkan `material_services` di seed**

`supabase db reset` menjalankan migrasi **sebelum** seed, jadi langkah migrasi data di dalam migration berjalan saat `materials` masih kosong. Tanpa sisipan di `supabase/seed.sql`, `material_services` kosong sesudah setiap reset dan seluruh gating materi klien mati:

```sql
-- Sisipan yang sama dengan langkah migrasi data di migration, dan itu memang
-- disengaja: `supabase db reset` menjalankan migrasi SEBELUM seed, sehingga
-- langkah di migration berjalan saat tabel ini masih kosong.
insert into material_services (material_id, service_id)
select id, service_id from materials
on conflict (material_id, service_id) do nothing;
```

- [ ] **Step 7: Seluruh suite tetap hijau**

Run: `npx supabase db reset && npx vitest run`
Expected: **1362 lulus, 0 gagal**. `tests/rls-materi.test.ts` khususnya harus tetap hijau — gating-nya berpindah jalur tapi hasilnya identik.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260831100000_materi_banyak_layanan.sql tests/materi-banyak-layanan.test.ts supabase/seed.sql src/lib/passport/data.ts
git commit -m "feat(db): materi boleh milik banyak layanan lewat material_services"
```

---

### Task 2: `material_assignments` — penugasan eksplisit ke pasien

**Files:**
- Create: `supabase/migrations/20260831110000_materi_penugasan.sql`
- Create: `tests/materi-penugasan.test.ts`

**Interfaces:**
- Consumes: `material_services` (Task 1).
- Produces: tabel `public.material_assignments(material_id, client_id, ditugaskan_oleh, ditugaskan_pada)`. Policy gating isi materi menjadi **OR**: sesi selesai **atau** penugasan.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-penugasan.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = () =>
  createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

/** Sesi klien uji: dipakai menembak REST sebagai klien sungguhan. */
async function sesiKlien(email: string) {
  const c = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: "padma-dev-123" });
  if (error) throw error;
  return c;
}

describe("material_assignments — penugasan membuka isi tanpa sesi selesai", () => {
  let materiId = "";
  let klienId = "";

  beforeAll(async () => {
    const db = svc();
    // Materi yang TIDAK punya layanan sama sekali: satu-satunya jalan bukanya
    // adalah penugasan, sehingga test ini tidak bisa lolos lewat jalur otomatis.
    // `materials.service_id` masih NOT NULL sampai Task 11, jadi ia wajib diisi.
    const { data: layanan } = await db.from("services").select("id").limit(1).single();
    const { data: m } = await db
      .from("materials")
      .insert({
        judul: "UJI-ASSIGN", tipe: "ebook", deskripsi: "", aktif: true,
        service_id: layanan!.id,
      })
      .select("id")
      .single();
    materiId = m!.id;
    // Tautan layanan DIHAPUS supaya jalur otomatis benar-benar tertutup — kalau
    // tidak, test ini bisa lolos lewat sesi selesai dan tidak membuktikan apa pun
    // tentang penugasan.
    await db.from("material_services").delete().eq("material_id", materiId);
    const { data: k } = await db
      .from("clients")
      .select("id")
      .eq("email", "ananda@padma.test")
      .single();
    klienId = k!.id;
    await db.from("material_chapters").insert({
      material_id: materiId, urutan: 1, judul: "Bab uji", isi: "ISI-RAHASIA-ASSIGN",
    });
  });

  afterAll(async () => {
    await svc().from("materials").delete().eq("id", materiId);
  });

  it("tanpa penugasan, klien tidak membaca satu bab pun", async () => {
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.from("material_chapters").select("isi").eq("material_id", materiId);
    expect(data ?? []).toHaveLength(0);
  });

  it("sesudah ditugaskan, klien membaca babnya", async () => {
    const db = svc();
    const { data: staf } = await db.from("profiles").select("id").eq("role", "admin").single();
    await db.from("material_assignments").insert({
      material_id: materiId, client_id: klienId, ditugaskan_oleh: staf!.id,
    });
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.from("material_chapters").select("isi").eq("material_id", materiId);
    expect(data).toHaveLength(1);
    expect(data![0].isi).toContain("ISI-RAHASIA-ASSIGN");
  });

  it("fungsi hak menjawab true walau klien tidak boleh membaca tabel penugasan", async () => {
    // Inilah jebakan yang membuat fungsinya harus `security definer`: RLS
    // berlaku rekursif pada tabel yang dirujuk policy, dan material_assignments
    // sengaja tertutup bagi klien. Tanpa security definer, jawabannya false.
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.rpc("berhak_isi_materi", { p_material_id: materiId });
    expect(data).toBe(true);
  });

  it("klien TIDAK boleh membaca tabel penugasan itu sendiri", async () => {
    const c = await sesiKlien("ananda@padma.test");
    const { data, error } = await c.from("material_assignments").select("material_id");
    // Hak tabel dicabut: PostgREST menjawab error, bukan array kosong.
    expect(error ?? (data ?? []).length === 0).toBeTruthy();
  });

  it("materi NONAKTIF menutup ISI-nya, tetapi barisnya TETAP terbaca", async () => {
    const db = svc();
    await db.from("materials").update({ aktif: false }).eq("id", materiId);
    const c = await sesiKlien("ananda@padma.test");

    const { data: isi } = await c.from("material_chapters").select("isi").eq("material_id", materiId);
    expect(isi ?? []).toHaveLength(0);

    // Baris `materials` sendiri HARUS tetap terbaca. Menutupnya akan mengulangi
    // bug `partner_publik`: metadata hilang dari layar lain tanpa satu pun error.
    const { data: meta } = await c.from("materials").select("judul").eq("id", materiId);
    expect(meta).toHaveLength(1);

    await db.from("materials").update({ aktif: true }).eq("id", materiId);
  });

  it("RLS menyala & grant default authenticated dicabut", async () => {
    // Tabel baru lahir TANPA RLS dan `authenticated` mendapat hak penuh secara
    // default. Sudah pernah terlewat di repo ini, jadi diperiksa per tabel baru.
    const rls = await querySql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'material_assignments'`,
    );
    expect(rls[0].relrowsecurity).toBe(true);

    const hak = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_assignments'
         and grantee = 'authenticated'
       order by privilege_type`);
    expect(hak.map((h) => h.privilege_type)).toEqual(["DELETE", "INSERT", "SELECT"]);

    const anon = await querySql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_assignments'
         and grantee = 'anon'`);
    expect(anon).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-penugasan.test.ts`
Expected: FAIL — relasi `material_assignments` belum ada.

- [ ] **Step 3: Tulis migration**

```sql
-- supabase/migrations/20260831110000_materi_penugasan.sql
-- ============================================================================
-- PENUGASAN MATERI KE PASIEN TERTENTU
-- ============================================================================
-- Jalur otomatis (sesi `selesai` pada layanan materi) DIPERTAHANKAN dan tidak
-- diganti. Alasannya mode kegagalan: admin yang lupa meng-assign tidak
-- menghasilkan error, peringatan, maupun gejala apa pun — hanya pasien yang
-- diam-diam tidak pernah melihat materinya. Penugasan manual hidup DI ATAS
-- jalur otomatis itu, bukan menggantikannya.

create table public.material_assignments (
  material_id     uuid not null references public.materials(id) on delete cascade,
  client_id       uuid not null references public.clients(id)   on delete cascade,
  ditugaskan_oleh uuid not null references public.profiles(id),
  ditugaskan_pada timestamptz not null default now(),
  primary key (material_id, client_id)
);

comment on table public.material_assignments is
  'Penugasan materi ke pasien tertentu. SENGAJA tidak terbaca klien sama '
  'sekali: ia hanya perlu dievaluasi di dalam policy isi materi, dan klien '
  'tidak butuh tahu alasan materinya terbuka. `ditugaskan_oleh` mengikuti pola '
  'honor_marks.ditandai_oleh — keputusan yang membuka konten selalu menyebut '
  'siapa pelakunya.';

-- `ditugaskan_oleh` dipagari TRIGGER, bukan pencabutan grant kolom. Grant kolom
-- mengikat pada KEHADIRAN kolom di payload sehingga `select *` ikut mati 42501;
-- trigger mengikat pada NILAI. Pelajaran ini sudah tiga kali dibayar di repo ini.
create or replace function public.paksa_aktor_penugasan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.ditugaskan_oleh := auth.uid();
  return new;
end $$;

create trigger trg_paksa_aktor_penugasan
  before insert or update on public.material_assignments
  for each row execute function public.paksa_aktor_penugasan();

alter table public.material_assignments enable row level security;
revoke all on public.material_assignments from anon, authenticated;
grant select, insert, delete on public.material_assignments to authenticated;

-- Hanya staf. Tidak ada policy untuk klien: hak tabelnya memang ada, tetapi
-- tanpa policy tidak satu baris pun lolos RLS.
create policy "penugasan: staf kelola"
  on public.material_assignments for all
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- ---------------------------------------------------------------------------
-- Gating isi materi: SATU fungsi, dipakai policy MAUPUN UI
-- ---------------------------------------------------------------------------
-- `security definer` di sini WAJIB, dan alasannya adalah jebakan yang mudah
-- menelan: RLS berlaku REKURSIF pada tabel yang dirujuk sebuah policy. Bila
-- syarat penugasan ditulis inline sebagai `exists (select 1 from
-- material_assignments ...)` di dalam policy, subquery itu ikut dikenai RLS
-- material_assignments — yang SENGAJA tidak punya policy untuk klien. Hasilnya
-- cabang penugasan selalu bernilai false bagi klien, tanpa satu pun error:
-- tombol "assign" di panel admin akan tampak bekerja dan tidak membuka apa pun.
--
-- Fungsi ini aman meski menembus RLS: ia hanya menjawab ya/tidak tentang
-- `auth.uid()` yang sedang memanggil, dan satu-satunya parameternya adalah id
-- materi. Tidak ada baris siapa pun yang bisa keluar dari sini.
--
-- Dipakai ulang oleh reader passport untuk membedakan "tidak berhak" dari
-- "berhak tapi isinya belum diunggah" — dua keadaan yang tanpa fungsi ini
-- terlihat identik (nol baris), sehingga pasien yang berhak akan dibohongi
-- kalimat "terbuka setelah layanan terkait selesai".
create or replace function public.berhak_isi_materi(p_material_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.materials m
     where m.id = p_material_id
       and m.aktif = true
       and (
         exists (
           select 1
             from public.material_services ms
             join public.sessions s
               on s.service_id = ms.service_id and s.status = 'selesai'
             join public.clients c on c.id = s.client_id
            where ms.material_id = m.id and c.user_id = auth.uid()
         )
         or exists (
           select 1
             from public.material_assignments ma
             join public.clients c on c.id = ma.client_id
            where ma.material_id = m.id and c.user_id = auth.uid()
         )
       )
  )
$$;

revoke all on function public.berhak_isi_materi(uuid) from public, anon;
grant execute on function public.berhak_isi_materi(uuid) to authenticated;

-- Nama policy dipertahankan PERSIS. Policy bernama baru akan berdampingan
-- dengan yang lama (RLS meng-OR policy permisif) sehingga jalur lama tetap
-- terbuka tanpa satu pun error.
drop policy if exists "chapters: klien dgn sesi selesai" on public.material_chapters;
create policy "chapters: klien dgn sesi selesai" on public.material_chapters
  for select using (public.berhak_isi_materi(material_id));

drop policy if exists "video: klien dgn sesi selesai" on public.material_videos;
create policy "video: klien dgn sesi selesai" on public.material_videos
  for select using (public.berhak_isi_materi(material_id));
```

- [ ] **Step 4: Reset DB & jalankan test, pastikan HIJAU**

Run: `npx supabase db reset && npx vitest run tests/materi-penugasan.test.ts`
Expected: PASS (4 test)

- [ ] **Step 5: Seluruh suite tetap hijau**

Run: `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260831110000_materi_penugasan.sql tests/materi-penugasan.test.ts
git commit -m "feat(db): penugasan materi ke pasien, gating jadi OR"
```

---

### Task 3: `material_pages` + bucket privat + RPC pengganti halaman

**Files:**
- Create: `supabase/migrations/20260831120000_materi_halaman_pdf.sql`
- Create: `tests/materi-halaman.test.ts`

**Interfaces:**
- Consumes: `material_services`, `material_assignments` (Task 1–2).
- Produces:
  - tabel `public.material_pages(material_id uuid, halaman int, objek text, lebar int, tinggi int)`
  - bucket privat `materi-halaman`
  - RPC `public.ganti_halaman_materi(p_material_id uuid, p_halaman jsonb) returns int` — mengembalikan jumlah baris yang disisipkan.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-halaman.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = () =>
  createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

describe("material_pages & RPC pengganti halaman", () => {
  it("bucket materi-halaman ada dan PRIVAT", async () => {
    const { data } = await svc().storage.getBucket("materi-halaman");
    expect(data).toBeTruthy();
    expect(data!.public).toBe(false);
  });

  it("RPC mengganti seluruh halaman satu materi dalam satu transaksi", async () => {
    const db = svc();
    const { data: layanan } = await db.from("services").select("id").limit(1).single();
    const { data: m } = await db
      .from("materials")
      .insert({ judul: "UJI-HAL", tipe: "ebook", deskripsi: "", aktif: true, service_id: layanan!.id })
      .select("id").single();

    const { data: n1 } = await db.rpc("ganti_halaman_materi", {
      p_material_id: m!.id,
      p_halaman: [
        { halaman: 1, objek: `${m!.id}/0001.webp`, lebar: 1600, tinggi: 2263 },
        { halaman: 2, objek: `${m!.id}/0002.webp`, lebar: 1600, tinggi: 2263 },
      ],
    });
    expect(n1).toBe(2);

    // Panggilan kedua MENGGANTI, bukan menambah.
    const { data: n2 } = await db.rpc("ganti_halaman_materi", {
      p_material_id: m!.id,
      p_halaman: [{ halaman: 1, objek: `${m!.id}/0001.webp`, lebar: 1600, tinggi: 2263 }],
    });
    expect(n2).toBe(1);
    const { data: sisa } = await db.from("material_pages").select("halaman").eq("material_id", m!.id);
    expect(sisa).toHaveLength(1);

    await db.from("materials").delete().eq("id", m!.id);
  });

  it("RLS menyala & anon tidak punya hak apa pun", async () => {
    const rls = await querySql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'material_pages'`,
    );
    expect(rls[0].relrowsecurity).toBe(true);

    const anon = await querySql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_pages'
         and grantee = 'anon'`);
    expect(anon).toEqual([]);
  });

  it("RPC TIDAK PERNAH menyentuh baris materi lain", async () => {
    const db = svc();
    const { data: layanan } = await db.from("services").select("id").limit(1).single();
    const buat = async (judul: string) =>
      (await db.from("materials")
        .insert({ judul, tipe: "ebook", deskripsi: "", aktif: true, service_id: layanan!.id })
        .select("id").single()).data!.id;
    const a = await buat("UJI-RADIUS-A");
    const b = await buat("UJI-RADIUS-B");

    await db.rpc("ganti_halaman_materi", {
      p_material_id: a, p_halaman: [{ halaman: 1, objek: `${a}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
    await db.rpc("ganti_halaman_materi", {
      p_material_id: b, p_halaman: [{ halaman: 1, objek: `${b}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
    // Mengganti A tidak boleh menghapus halaman B — kelas bug `?urutan=gte.0`
    // yang pernah menghapus SELURUH bab materi di repo ini.
    await db.rpc("ganti_halaman_materi", {
      p_material_id: a, p_halaman: [{ halaman: 1, objek: `${a}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
    const { data: halamanB } = await db.from("material_pages").select("halaman").eq("material_id", b);
    expect(halamanB).toHaveLength(1);

    await db.from("materials").delete().in("id", [a, b]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-halaman.test.ts`
Expected: FAIL — bucket & RPC belum ada.

- [ ] **Step 3: Tulis migration**

```sql
-- supabase/migrations/20260831120000_materi_halaman_pdf.sql
-- ============================================================================
-- HALAMAN E-BOOK SEBAGAI GAMBAR
-- ============================================================================

create table public.material_pages (
  material_id uuid not null references public.materials(id) on delete cascade,
  halaman     int  not null check (halaman >= 1),
  objek       text not null,
  lebar       int  not null check (lebar  > 0),
  tinggi      int  not null check (tinggi > 0),
  primary key (material_id, halaman)
);

-- Menyimpan KUNCI OBJEK, bukan URL. Baris ini terbaca klien lewat RLS (ia perlu
-- tahu jumlah halaman & dimensinya untuk menata layar tanpa melompat). Bila
-- yang tersimpan URL bertanda tangan, satu baris yang terbaca langsung menjadi
-- tautan siap sebar — kelas bug yang persis pernah terjadi lewat
-- materials.video_url.
comment on column public.material_pages.objek is
  'Kunci objek di bucket privat `materi-halaman`. BUKAN URL, dan tidak boleh '
  'pernah menjadi URL: baris ini terbaca klien, sementara bucket-nya tidak '
  'memberi hak apa pun kepada `authenticated`.';

alter table public.material_pages enable row level security;
revoke all on public.material_pages from anon, authenticated;
-- Hak tulis diberikan karena RPC di bawah `security invoker`: yang memutuskan
-- boleh-tidaknya adalah policy staf, bukan hak tabel ini.
grant select, insert, update, delete on public.material_pages to authenticated;

-- Gating IDENTIK dengan material_chapters, dan memakai FUNGSI YANG SAMA
-- (`berhak_isi_materi`, lahir di migration penugasan). Menyalin ekspresinya ke
-- sini berarti dua tempat yang harus ditemukan dan disepakatkan setiap kali
-- aturan hak berubah — dan yang satu akan tertinggal.
create policy "halaman: klien berhak" on public.material_pages
  for select using (public.berhak_isi_materi(material_id));

-- `for all` sudah mencakup select; policy select staf tersendiri hanya menambah
-- satu tempat lagi yang harus ditemukan saat mengaudit.
create policy "halaman: staf kelola" on public.material_pages
  for all
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- ---------------------------------------------------------------------------
-- Bucket privat
-- ---------------------------------------------------------------------------
-- SENGAJA tanpa satu pun policy pada storage.objects. Tanpa policy, `anon` dan
-- `authenticated` tidak bisa menyentuh objeknya sama sekali — hanya service
-- role, dari route handler kita, sesudah RLS memutuskan hak. Ini pagar pertama
-- dan yang paling murah: path yang bocor tetap tidak bisa ditukar jadi byte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materi-halaman', 'materi-halaman', false, 5242880,
        array['image/webp','image/jpeg'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Pengganti halaman: satu transaksi, radius terikat parameter
-- ---------------------------------------------------------------------------
-- Repo ini pernah kehilangan SELURUH bab materi karena satu filter tautologis
-- (`?urutan=gte.0`), dan pelajarannya adalah RPC. Fungsi ini menghapus banyak
-- baris sekaligus, tetapi radiusnya terikat parameter WAJIB `p_material_id` —
-- tidak ada filter yang bisa dibuat tautologis dari luar.
create or replace function public.ganti_halaman_materi(
  p_material_id uuid,
  p_halaman     jsonb
) returns int
language plpgsql security invoker set search_path = public as $$
declare
  n int;
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;

  delete from public.material_pages where material_id = p_material_id;

  insert into public.material_pages (material_id, halaman, objek, lebar, tinggi)
  select p_material_id,
         (x->>'halaman')::int,
         x->>'objek',
         (x->>'lebar')::int,
         (x->>'tinggi')::int
    from jsonb_array_elements(p_halaman) as x;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ganti_halaman_materi(uuid, jsonb) from public, anon;
grant execute on function public.ganti_halaman_materi(uuid, jsonb) to authenticated;

-- `security invoker` disengaja: hak tulis tetap diputuskan policy staf, bukan
-- diberikan oleh fungsinya. `security definer` di sini akan membuat setiap klien
-- login bisa mengganti halaman materi mana pun.
```

- [ ] **Step 4: Reset DB & jalankan test, pastikan HIJAU**

Run: `npx supabase db reset && npx vitest run tests/materi-halaman.test.ts`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260831120000_materi_halaman_pdf.sql tests/materi-halaman.test.ts
git commit -m "feat(db): tabel halaman ebook, bucket privat, RPC pengganti halaman"
```

---

### Task 4: Pembuat PDF untuk test + fungsi murni rasterisasi

**Files:**
- Create: `tests/bantu/pdf.ts`
- Create: `src/lib/materi/rasterisasi.ts`
- Create: `tests/materi-rasterisasi.test.ts`

**Interfaces:**
- Produces:
  - `buatPdfUji(jumlahHalaman: number): Buffer` — PDF sah tanpa dependensi apa pun.
  - `namaObjekHalaman(materialId: string, halaman: number): string` → `"<id>/0001.webp"`
  - `MAKS_HALAMAN = 300`, `MAKS_BYTE_PDF = 60 * 1024 * 1024`, `LEBAR_RASTER = 1600`
  - `periksaBerkasPdf(namaBerkas: string, byte: number): Periksa<true>`

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-rasterisasi.test.ts
import { describe, it, expect } from "vitest";
import { buatPdfUji } from "./bantu/pdf";
import {
  namaObjekHalaman, periksaBerkasPdf, MAKS_HALAMAN, MAKS_BYTE_PDF,
} from "@/lib/materi/rasterisasi";

describe("pembuat PDF uji", () => {
  it("menghasilkan PDF yang sah dan berukuran wajar", () => {
    const pdf = buatPdfUji(3);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("%%EOF");
    expect(pdf.toString("latin1")).toContain("/Count 3");
  });
});

describe("penamaan objek halaman", () => {
  it("berpadding empat digit supaya urutan leksikografis = urutan halaman", () => {
    expect(namaObjekHalaman("abc", 1)).toBe("abc/0001.webp");
    expect(namaObjekHalaman("abc", 42)).toBe("abc/0042.webp");
    // Tanpa padding, "10" akan berada sebelum "2" saat objek dilist.
    const urut = [1, 2, 10].map((n) => namaObjekHalaman("abc", n)).sort();
    expect(urut).toEqual(["abc/0001.webp", "abc/0002.webp", "abc/0010.webp"]);
  });
});

describe("batas berkas PDF", () => {
  it("menolak yang bukan .pdf", () => {
    const r = periksaBerkasPdf("materi.docx", 1000);
    expect(r.ok).toBe(false);
  });
  it("menolak yang melampaui batas dan MENYEBUT angkanya", () => {
    const r = periksaBerkasPdf("materi.pdf", MAKS_BYTE_PDF + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toContain("60");
  });
  it("menerima PDF wajar", () => {
    expect(periksaBerkasPdf("materi.pdf", 5_000_000).ok).toBe(true);
  });
  it("batas halaman terdefinisi dan masuk akal", () => {
    expect(MAKS_HALAMAN).toBe(300);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-rasterisasi.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tulis pembuat PDF**

```ts
// tests/bantu/pdf.ts
/**
 * PDF minimal yang sah, dibuat TANPA dependensi.
 *
 * Dipakai unit test maupun E2E supaya tidak ada berkas biner yang perlu
 * di-commit sebagai fixture — dan supaya jumlah halamannya bisa diatur per
 * test. Offset xref dihitung dari panjang string yang sudah tersusun; PDF
 * dengan xref salah akan ditolak PDF.js, jadi ini bukan detail yang bisa
 * dikira-kira.
 */
export function buatPdfUji(jumlahHalaman: number): Buffer {
  const objek: string[] = [];
  const kids: string[] = [];
  const idFont = 3 + jumlahHalaman * 2;

  for (let i = 0; i < jumlahHalaman; i++) {
    const idPage = 3 + i * 2;
    const idIsi = idPage + 1;
    kids.push(`${idPage} 0 R`);
    const isi = `BT /F1 24 Tf 20 100 Td (HALAMAN ${i + 1}) Tj ET`;
    objek[idPage] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]` +
      `/Contents ${idIsi} 0 R/Resources<</Font<</F1 ${idFont} 0 R>>>>>>`;
    objek[idIsi] = `<</Length ${isi.length}>>stream\n${isi}\nendstream`;
  }
  objek[1] = `<</Type/Catalog/Pages 2 0 R>>`;
  objek[2] = `<</Type/Pages/Kids[${kids.join(" ")}]/Count ${jumlahHalaman}>>`;
  objek[idFont] = `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`;

  let pdf = "%PDF-1.4\n";
  const offset: number[] = [];
  for (let id = 1; id <= idFont; id++) {
    offset[id] = pdf.length;
    pdf += `${id} 0 obj\n${objek[id]}\nendobj\n`;
  }
  const awalXref = pdf.length;
  pdf += `xref\n0 ${idFont + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= idFont; id++) {
    pdf += `${String(offset[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${idFont + 1}/Root 1 0 R>>\nstartxref\n${awalXref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
```

- [ ] **Step 4: Tulis fungsi murni rasterisasi**

```ts
// src/lib/materi/rasterisasi.ts
/**
 * Konstanta & fungsi MURNI rantai rasterisasi.
 *
 * Sengaja tanpa DOM dan tanpa PDF.js: berkas ini diimpor server action,
 * client component, DAN Vitest. Kode yang menyentuh canvas tinggal di
 * `./pdf-klien.ts` yang hanya diimpor client component.
 */

/** Lebar sasaran gambar halaman. Lebar baca passport `max-w-3xl` (768px) pada
 *  perangkat DPR 2 menuntut ~1536px; 1600 memberi sedikit ruang. */
export const LEBAR_RASTER = 1600;

/** Kualitas WebP. 0,82 adalah titik di mana teks masih tajam sementara satu
 *  halaman tetap ~200-400 KB. */
export const KUALITAS_WEBP = 0.82;

export const MAKS_HALAMAN = 300;
export const MAKS_BYTE_PDF = 60 * 1024 * 1024;

/** Unggahan bersamaan. Empat menjaga koneksi rumahan tidak kehabisan bandwidth
 *  sampai unggahan saling menggagalkan, sementara 300 halaman tetap selesai
 *  dalam waktu wajar. */
export const KONKURENSI_UNGGAH = 4;

export type Periksa<T> = { ok: true; nilai: T } | { ok: false; pesan: string };

/**
 * Padding empat digit BUKAN kosmetik: tanpa itu, `storage.list()` mengurutkan
 * "10" sebelum "2" dan penghapusan objek lama akan melewatkan halaman.
 */
export function namaObjekHalaman(materialId: string, halaman: number): string {
  return `${materialId}/${String(halaman).padStart(4, "0")}.webp`;
}

export function periksaBerkasPdf(namaBerkas: string, byte: number): Periksa<true> {
  if (!namaBerkas.toLowerCase().endsWith(".pdf")) {
    return { ok: false, pesan: "Berkas harus PDF." };
  }
  if (byte > MAKS_BYTE_PDF) {
    const mb = Math.round(MAKS_BYTE_PDF / (1024 * 1024));
    return { ok: false, pesan: `PDF maksimal ${mb} MB.` };
  }
  if (byte === 0) return { ok: false, pesan: "Berkas PDF kosong." };
  return { ok: true, nilai: true };
}
```

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

Run: `npx vitest run tests/materi-rasterisasi.test.ts`
Expected: PASS (6 test)

- [ ] **Step 6: Commit**

```bash
git add tests/bantu/pdf.ts src/lib/materi/rasterisasi.ts tests/materi-rasterisasi.test.ts
git commit -m "feat(materi): fungsi murni rasterisasi + pembuat PDF untuk test"
```

---

### Task 5: Membakar watermark dengan `sharp`

**Files:**
- Create: `src/lib/materi/watermark.ts`
- Create: `tests/materi-watermark.test.ts`
- Modify: `package.json` (tambah `sharp`)

**Interfaces:**
- Consumes: —
- Produces: `bakarWatermark(gambar: Buffer, nama: string, padmaId: string): Promise<Buffer>`

- [ ] **Step 1: Pasang sharp**

```bash
npm install sharp
```

- [ ] **Step 2: Tulis test yang gagal**

```ts
// tests/materi-watermark.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { bakarWatermark } from "@/lib/materi/watermark";

async function gambarPolos(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 560, channels: 3, background: "#ffffff" },
  }).webp().toBuffer();
}

describe("watermark dibakar ke dalam gambar", () => {
  it("dua pasien berbeda menghasilkan byte yang BERBEDA", async () => {
    const polos = await gambarPolos();
    const a = await bakarWatermark(polos, "Ananda Putri", "PAD-2607-0012");
    const b = await bakarWatermark(polos, "Rina Hapsari", "PAD-2608-0019");
    // Inilah bukti bahwa watermark benar-benar DI DALAM gambar. Lapisan CSS
    // akan menghasilkan byte yang identik.
    expect(a.equals(b)).toBe(false);
  });

  it("hasilnya masih gambar WebP yang sah dan berukuran sama", async () => {
    const polos = await gambarPolos();
    const hasil = await bakarWatermark(polos, "Ananda Putri", "PAD-2607-0012");
    const meta = await sharp(hasil).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(560);
  });

  it("nama berisi karakter XML tidak merusak SVG watermark", async () => {
    const polos = await gambarPolos();
    // Nama diketik admin. Tanpa escaping, `<` menutup elemen SVG dan seluruh
    // penyajian halaman gagal — atau lebih buruk, menyisipkan elemen asing.
    const hasil = await bakarWatermark(polos, 'A <b>& "x" </text>', "PAD-1");
    const meta = await sharp(hasil).metadata();
    expect(meta.format).toBe("webp");
  });

  it("gambar yang bukan gambar ditolak, bukan menghasilkan keluaran rusak", async () => {
    await expect(bakarWatermark(Buffer.from("bukan gambar"), "A", "P")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-watermark.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 4: Implementasi**

```ts
// src/lib/materi/watermark.ts
import sharp from "sharp";

/**
 * Membakar identitas pasien KE DALAM gambar halaman.
 *
 * Kenapa dibakar dan bukan dilapiskan lewat CSS: lapisan CSS hilang begitu
 * gambarnya disimpan, sehingga halaman yang tersebar menjadi tidak bisa
 * dilacak sama sekali. Membakarnya adalah satu-satunya cara kebocoran ebook
 * menunjuk akun sumbernya.
 *
 * Sudut, opasitas, dan bunyi teks sengaja SAMA dengan komponen `Watermark`
 * yang sudah ada di passport, supaya tampilannya tidak berubah bagi pasien —
 * yang berubah hanya letaknya: kini di dalam gambar, bukan di atasnya.
 */

/** Teks masuk ke dokumen SVG. Nama diketik admin, jadi ia data tak tepercaya
 *  di konteks XML: satu `<` saja merusak seluruh dokumen. */
function amanXml(teks: string): string {
  return teks
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function bakarWatermark(
  gambar: Buffer,
  nama: string,
  padmaId: string,
): Promise<Buffer> {
  const meta = await sharp(gambar).metadata();
  const lebar = meta.width;
  const tinggi = meta.height;
  if (!lebar || !tinggi) throw new Error("Gambar halaman tidak terbaca.");

  const ukuranHuruf = Math.max(10, Math.round(lebar * 0.016));
  const teks = amanXml(`${nama} · ${padmaId}`);
  const jarakY = ukuranHuruf * 7;
  const baris: string[] = [];
  for (let y = -tinggi; y < tinggi * 2; y += jarakY) {
    baris.push(
      `<text x="0" y="${y}" font-family="monospace" font-size="${ukuranHuruf}" ` +
        `fill="#0E2A1E" fill-opacity="0.08" letter-spacing="2">` +
        `${teks} &#160;&#160; ${teks} &#160;&#160; ${teks} &#160;&#160; ${teks}</text>`,
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lebar}" height="${tinggi}">` +
    `<g transform="rotate(-24 ${lebar / 2} ${tinggi / 2})">${baris.join("")}</g>` +
    `</svg>`;

  return sharp(gambar)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 82 })
    .toBuffer();
}
```

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

Run: `npx vitest run tests/materi-watermark.test.ts`
Expected: PASS (4 test)

- [ ] **Step 6: Commit**

```bash
git add src/lib/materi/watermark.ts tests/materi-watermark.test.ts package.json package-lock.json
git commit -m "feat(materi): bakar watermark identitas pasien ke gambar halaman"
```

---

### Task 6: Route handler penyaji halaman

**Files:**
- Create: `src/app/api/materi/[id]/halaman/[n]/route.ts`
- Create: `tests/materi-route-halaman.test.ts`

**Interfaces:**
- Consumes: `bakarWatermark` (Task 5), `material_pages` + bucket (Task 3), `ambilKlien` dari `@/lib/passport/data`.
- Produces: `GET /api/materi/{id}/halaman/{n}` → `image/webp` atau 404.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-route-halaman.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/api/materi/[id]/halaman/[n]/route.ts"),
  "utf8",
);

describe("route halaman — pagar yang dibaca dari sumbernya", () => {
  it("berjalan di runtime Node, bukan Edge (sharp butuh Node)", () => {
    expect(SUMBER).toMatch(/export const runtime = ["']nodejs["']/);
  });

  it("hak diputuskan RLS lewat sesi pengguna, BUKAN service role", () => {
    const posisiSesi = SUMBER.indexOf("createServerSupabase");
    const posisiAdmin = SUMBER.indexOf("createAdminSupabase");
    expect(posisiSesi).toBeGreaterThan(-1);
    expect(posisiAdmin).toBeGreaterThan(-1);
    // Service role hanya boleh menyentuh storage SESUDAH basis data memutuskan.
    expect(posisiSesi).toBeLessThan(posisiAdmin);
  });

  it("path objek diambil dari baris DB, tidak pernah dari parameter", () => {
    // Parameter yang dipakai sebagai path = path traversal + IDOR sekaligus.
    expect(SUMBER).not.toMatch(/download\(\s*(params|n|id)\b/);
    expect(SUMBER).toMatch(/download\(\s*baris\.objek\s*\)/);
  });

  it("Cache-Control tepat: private untuk CDN, max-age untuk peramban pasien", () => {
    // Diikat pada NILAI headernya, bukan pada seluruh berkas: satu komentar yang
    // menyebut "public" atau "no-store" akan memerahkan asersi yang memindai
    // seluruh sumber, dan test yang merah karena komentar akan dilemahkan
    // orang berikutnya — lalu pagar aslinya ikut hilang.
    const cache = SUMBER.match(/"Cache-Control":\s*"([^"]+)"/)?.[1] ?? "";
    // `private` menutup CDN: watermark per-pasien, sementara CDN menyimpan
    // berdasarkan URL. `max-age` membiarkan peramban pasien memakai ulang apa
    // yang sudah ia unduh — tanpa itu ebook 60 halaman (~18 MB) diunduh ulang
    // setiap kali pasien menggulir balik.
    expect(cache).toBe("private, max-age=900");
  });

  it("menjawab 404 saat tidak berhak, bukan 401/403", () => {
    // 401/403 mengonfirmasi bahwa materinya ADA.
    expect(SUMBER).toMatch(/status:\s*404/);
    expect(SUMBER).not.toMatch(/status:\s*40[13]/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-route-halaman.test.ts`
Expected: FAIL — berkas route belum ada.

- [ ] **Step 3: Implementasi**

```ts
// src/app/api/materi/[id]/halaman/[n]/route.ts
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ambilKlien } from "@/lib/passport/data";
import { bakarWatermark } from "@/lib/materi/watermark";

/** `sharp` adalah modul native: Edge runtime tidak bisa memuatnya. */
export const runtime = "nodejs";

const BUCKET = "materi-halaman";

/**
 * Menyajikan satu halaman e-book, ber-watermark identitas pembacanya.
 *
 * Route handler adalah endpoint MANDIRI: layout `/passport` tidak menjaganya,
 * dan itu sudah dibuktikan di repo ini dengan mem-POST server action panel
 * admin dari rute lain. Karena itu seluruh pemeriksaan ada di sini.
 *
 * Urutannya mengikat: hak diputuskan RLS memakai SESI PEMBACA, dan service role
 * baru menyentuh storage sesudah basis data mengembalikan barisnya.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await params;
  const halaman = Number(n);
  if (!Number.isInteger(halaman) || halaman < 1) {
    return new Response(null, { status: 404 });
  }

  // 1. Identitas pembaca. Tidak ada -> 404, bukan 401: route ini tidak boleh
  //    mengonfirmasi bahwa materinya ada.
  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  // 2. RLS-lah hakim haknya, bukan `if` di sini.
  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("material_pages")
    .select("objek")
    .eq("material_id", id)
    .eq("halaman", halaman)
    .maybeSingle();
  if (!baris) return new Response(null, { status: 404 });

  // 3. Hak sudah terbukti. Path diambil dari BARIS, tidak pernah dari parameter.
  const admin = createAdminSupabase();
  const { data: objek } = await admin.storage.from(BUCKET).download(baris.objek);
  if (!objek) return new Response(null, { status: 404 });

  const asli = Buffer.from(await objek.arrayBuffer());
  const bertanda = await bakarWatermark(asli, klien.nama, klien.padmaId);

  return new Response(new Uint8Array(bertanda), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      // `private` MENGIKAT: watermark-nya per-pasien, sementara CDN menyimpan
      // berdasarkan URL. `s-maxage` atau `public` di sini akan membuat CDN
      // Vercel menyajikan halaman ber-watermark pasien A kepada pasien B — itu
      // kebocoran identitas, bukan bug tampilan.
      //
      // `max-age` disengaja ADA, bukan `no-store`: peramban pasien sendiri
      // boleh memakai ulang halaman yang sudah ia unduh. Tanpa itu, ebook 60
      // halaman (~18 MB) diunduh ulang setiap kali pasien menggulir balik dan
      // watermark yang sama dibakar berulang — tanpa menambah keamanan apa pun,
      // sebab pasien memang berhak melihatnya dan gambarnya ber-watermark
      // namanya sendiri.
      "Cache-Control": "private, max-age=900",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `npx vitest run tests/materi-route-halaman.test.ts && npx tsc --noEmit`
Expected: PASS (5 test), typecheck bersih

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/materi/[id]/halaman/[n]/route.ts" tests/materi-route-halaman.test.ts
git commit -m "feat(materi): route penyaji halaman ebook ber-watermark"
```

---

### Task 7: Server action unggah — signed URL & pencatatan halaman

**Files:**
- Create: `src/app/admin/materi/unggah.ts`
- Create: `tests/materi-unggah-aksi.test.ts`

**Interfaces:**
- Consumes: `namaObjekHalaman`, `MAKS_HALAMAN` (Task 4); RPC `ganti_halaman_materi` (Task 3).
- Produces:
  - `terbitkanUrlUnggahHalaman(materiId: string, jumlahHalaman: number): Promise<{ok:true; unggahan: Array<{halaman:number; objek:string; token:string}>} | {ok:false; pesan:string}>`
  - `catatHalamanMateri(materiId: string, halaman: Array<{halaman:number; objek:string; lebar:number; tinggi:number}>): Promise<{ok:true; jumlah:number} | {ok:false; pesan:string}>`

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-unggah-aksi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/admin/materi/unggah.ts"), "utf8",
);

describe("aksi unggah halaman — pagar struktural", () => {
  it('berkas server action, dan setiap aksi memanggil requireRole sendiri', () => {
    expect(SUMBER.trimStart().startsWith('"use server"')).toBe(true);
    const aksi = [...SUMBER.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(aksi.length).toBeGreaterThan(0);
    const penjaga = [...SUMBER.matchAll(/requireRole\(\["admin", ?"owner"\]\)/g)];
    // Server action adalah endpoint POST tersendiri; layout tidak menjaganya.
    expect(penjaga.length).toBe(aksi.length);
  });

  it("path objek ditentukan server, tidak pernah diterima dari parameter", () => {
    // Browser yang memilih path adalah browser yang bisa menimpa objek materi lain.
    expect(SUMBER).toContain("namaObjekHalaman(");
    expect(SUMBER).not.toMatch(/objek:\s*(formData|params)/);
  });

  it("jumlah halaman dibatasi sebelum satu URL pun diterbitkan", () => {
    expect(SUMBER).toContain("MAKS_HALAMAN");
  });

  it("pencatatan memakai RPC, bukan delete lalu insert dari klien", () => {
    // DELETE dari klien menuntut filter, dan filter tautologis pernah menghapus
    // SELURUH bab materi di repo ini.
    expect(SUMBER).toContain("ganti_halaman_materi");
    expect(SUMBER).not.toMatch(/from\("material_pages"\)\s*\.delete\(/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-unggah-aksi.test.ts`
Expected: FAIL — berkas belum ada.

- [ ] **Step 3: Implementasi**

```ts
// src/app/admin/materi/unggah.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { namaObjekHalaman, MAKS_HALAMAN } from "@/lib/materi/rasterisasi";

const BUCKET = "materi-halaman";

type Gagal = { ok: false; pesan: string };

export type Unggahan = { halaman: number; objek: string; token: string };

/**
 * Menerbitkan signed upload URL untuk seluruh halaman sekaligus.
 *
 * Berkasnya TIDAK menumpang server kita: Vercel membatasi body request 4,5 MB,
 * dan satu ebook bisa ratusan halaman. Browser admin mengunggah langsung ke
 * Storage memakai token di bawah.
 *
 * Path setiap objek ditentukan DI SINI, bukan dikirim browser. Browser yang
 * memilih path adalah browser yang bisa menimpa objek materi lain.
 */
export async function terbitkanUrlUnggahHalaman(
  materiId: string,
  jumlahHalaman: number,
): Promise<{ ok: true; unggahan: Unggahan[] } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (!Number.isInteger(jumlahHalaman) || jumlahHalaman < 1) {
    return { ok: false, pesan: "Jumlah halaman tidak sah." };
  }
  if (jumlahHalaman > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }

  // Materi harus ada, dan pemeriksaannya lewat sesi pengguna supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: materi } = await supabase
    .from("materials").select("id").eq("id", materiId).maybeSingle();
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };

  const admin = createAdminSupabase();

  // Objek lama dibersihkan lebih dulu: unggahan sebelumnya yang gagal di tengah
  // meninggalkan sampah, dan halaman lama yang tersisa akan bercampur dengan
  // yang baru bila PDF penggantinya lebih pendek.
  const { data: lama } = await admin.storage.from(BUCKET).list(materiId);
  if (lama && lama.length > 0) {
    await admin.storage
      .from(BUCKET)
      .remove(lama.map((o) => `${materiId}/${o.name}`));
  }

  const unggahan: Unggahan[] = [];
  for (let halaman = 1; halaman <= jumlahHalaman; halaman++) {
    const objek = namaObjekHalaman(materiId, halaman);
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(objek);
    if (error || !data) {
      return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
    }
    unggahan.push({ halaman, objek, token: data.token });
  }
  return { ok: true, unggahan };
}

/**
 * Mencatat seluruh halaman SEKALIGUS, sesudah semua unggahan sukses.
 *
 * Dipanggil sekali di akhir, bukan per halaman: bila unggahan gagal di tengah,
 * fungsi ini tidak pernah jalan dan materinya tampak "belum ada isi" di panel —
 * bukan setengah terisi, yang jauh lebih sulit disadari.
 */
export async function catatHalamanMateri(
  materiId: string,
  halaman: Array<{ halaman: number; objek: string; lebar: number; tinggi: number }>,
): Promise<{ ok: true; jumlah: number } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (halaman.length === 0) return { ok: false, pesan: "Tidak ada halaman." };
  if (halaman.length > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }
  // Objek yang dicatat harus objek yang KITA namai. Nama lain berarti browser
  // menunjuk objek yang bukan miliknya.
  for (const h of halaman) {
    if (h.objek !== namaObjekHalaman(materiId, h.halaman)) {
      return { ok: false, pesan: "Nama objek halaman tidak sah." };
    }
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("ganti_halaman_materi", {
    p_material_id: materiId,
    p_halaman: halaman,
  });
  if (error) return { ok: false, pesan: "Gagal menyimpan halaman materi." };

  revalidatePath("/admin/materi");
  return { ok: true, jumlah: (data as number) ?? 0 };
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `npx vitest run tests/materi-unggah-aksi.test.ts && npx tsc --noEmit`
Expected: PASS (4 test)

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/materi/unggah.ts tests/materi-unggah-aksi.test.ts
git commit -m "feat(materi): server action signed upload URL & pencatatan halaman"
```

---

### Task 8: Rasterisasi PDF di browser admin

**Files:**
- Create: `src/lib/materi/pdf-klien.ts`
- Create: `src/app/admin/materi/pengunggah-pdf.tsx`
- Modify: `package.json` (tambah `pdfjs-dist`)
- Create: `tests/materi-pengunggah.test.ts`

**Interfaces:**
- Consumes: `terbitkanUrlUnggahHalaman`, `catatHalamanMateri` (Task 7); konstanta Task 4.
- Produces:
  - `rasterisasiPdf(berkas: File, onProgres: (selesai: number, total: number) => void): Promise<Array<{halaman:number; blob:Blob; lebar:number; tinggi:number}>>`
  - Komponen `<PengunggahPdf materiId={string} onSelesai={() => void} />`

- [ ] **Step 1: Pasang pdfjs-dist**

```bash
npm install pdfjs-dist
```

- [ ] **Step 2: Tulis test yang gagal**

```ts
// tests/materi-pengunggah.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

describe("pengunggah PDF — pagar struktural", () => {
  it("rasterisasi hidup di modul klien, bukan di modul yang diimpor server", () => {
    // pdfjs-dist menyentuh DOM/canvas: mengimpornya dari modul server akan
    // mematahkan build pada rute yang sama sekali tidak berhubungan.
    expect(baca("src/lib/materi/pdf-klien.ts")).toContain("pdfjs-dist");
    expect(baca("src/lib/materi/rasterisasi.ts")).not.toContain("pdfjs-dist");
  });

  it("komponen pengunggah adalah client component", () => {
    expect(baca("src/app/admin/materi/pengunggah-pdf.tsx").trimStart())
      .toMatch(/^"use client"/);
  });

  it("batas halaman & ukuran diperiksa SEBELUM unggahan dimulai", () => {
    const s = baca("src/app/admin/materi/pengunggah-pdf.tsx");
    expect(s).toContain("periksaBerkasPdf");
    expect(s).toContain("MAKS_HALAMAN");
  });

  it("pencatatan baris hanya terjadi setelah seluruh unggahan sukses", () => {
    const s = baca("src/app/admin/materi/pengunggah-pdf.tsx");
    const posUnggah = s.indexOf("uploadToSignedUrl");
    const posCatat = s.indexOf("catatHalamanMateri");
    expect(posUnggah).toBeGreaterThan(-1);
    expect(posCatat).toBeGreaterThan(posUnggah);
  });

  it("unggahan dibatasi konkurensinya", () => {
    expect(baca("src/app/admin/materi/pengunggah-pdf.tsx")).toContain("KONKURENSI_UNGGAH");
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-pengunggah.test.ts`
Expected: FAIL — berkas belum ada.

- [ ] **Step 4: Tulis modul rasterisasi klien**

```ts
// src/lib/materi/pdf-klien.ts
"use client";

import * as pdfjs from "pdfjs-dist";
import { LEBAR_RASTER, KUALITAS_WEBP } from "./rasterisasi";

// Worker disajikan dari paketnya sendiri lewat URL modul, bukan dari CDN:
// materi klinik tidak boleh bergantung pada host pihak ketiga yang bisa mati.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type HalamanRaster = {
  halaman: number;
  blob: Blob;
  lebar: number;
  tinggi: number;
};

/**
 * Merender setiap halaman PDF menjadi gambar, DI BROWSER ADMIN.
 *
 * Rasterisasi sengaja tidak di server: pdfium/poppler adalah binary native yang
 * merepotkan di Vercel serverless dan akan memaksa worker terpisah. Browser
 * admin sudah punya mesin render PDF yang matang, dan ia hanya dipakai sekali
 * per unggahan.
 */
export async function rasterisasiPdf(
  berkas: File,
  onProgres: (selesai: number, total: number) => void,
): Promise<HalamanRaster[]> {
  const buf = await berkas.arrayBuffer();
  const dok = await pdfjs.getDocument({ data: buf }).promise;
  const hasil: HalamanRaster[] = [];

  for (let n = 1; n <= dok.numPages; n++) {
    const hal = await dok.getPage(n);
    const dasar = hal.getViewport({ scale: 1 });
    const skala = LEBAR_RASTER / dasar.width;
    const viewport = hal.getViewport({ scale: skala });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Peramban ini tidak mendukung canvas 2D.");

    // Latar putih: PDF berlatar transparan akan menjadi hitam di WebP.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await hal.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", KUALITAS_WEBP),
    );
    // Peramban yang tidak bisa mengekspor WebP jatuh ke JPEG, bukan gagal.
    const akhir =
      blob ??
      (await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Gagal mengekspor halaman."))),
          "image/jpeg",
          0.85,
        ),
      ));

    hasil.push({ halaman: n, blob: akhir, lebar: canvas.width, tinggi: canvas.height });
    canvas.width = 0; // lepaskan memori: 300 canvas 1600px akan menghabiskan RAM
    onProgres(n, dok.numPages);
  }
  return hasil;
}
```

- [ ] **Step 5: Tulis komponen pengunggah**

```tsx
// src/app/admin/materi/pengunggah-pdf.tsx
"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { rasterisasiPdf } from "@/lib/materi/pdf-klien";
import {
  periksaBerkasPdf, MAKS_HALAMAN, KONKURENSI_UNGGAH,
} from "@/lib/materi/rasterisasi";
import { terbitkanUrlUnggahHalaman, catatHalamanMateri } from "./unggah";

const BUCKET = "materi-halaman";

type Fase = "diam" | "membaca" | "mengunggah" | "selesai" | "galat";

export function PengunggahPdf({
  materiId,
  onSelesai,
}: {
  materiId: string;
  onSelesai?: () => void;
}) {
  const [fase, setFase] = useState<Fase>("diam");
  const [progres, setProgres] = useState({ selesai: 0, total: 0 });
  const [pesan, setPesan] = useState("");

  async function tangani(berkas: File) {
    const periksa = periksaBerkasPdf(berkas.name, berkas.size);
    if (!periksa.ok) { setFase("galat"); setPesan(periksa.pesan); return; }

    try {
      setFase("membaca"); setPesan("");
      const halaman = await rasterisasiPdf(berkas, (selesai, total) =>
        setProgres({ selesai, total }),
      );
      if (halaman.length > MAKS_HALAMAN) {
        setFase("galat");
        setPesan(`PDF maksimal ${MAKS_HALAMAN} halaman; berkas ini ${halaman.length}.`);
        return;
      }

      const izin = await terbitkanUrlUnggahHalaman(materiId, halaman.length);
      if (!izin.ok) { setFase("galat"); setPesan(izin.pesan); return; }

      setFase("mengunggah");
      setProgres({ selesai: 0, total: halaman.length });
      const supabase = createBrowserSupabase();

      // Konkurensi dibatasi: koneksi rumahan yang lambat akan saling
      // menggagalkan unggahan bila 300 halaman dikirim sekaligus.
      let berikutnya = 0;
      let terunggah = 0;
      async function pekerja() {
        while (berikutnya < halaman.length) {
          const i = berikutnya++;
          const h = halaman[i];
          const u = izin.unggahan[i];
          const { error } = await supabase.storage
            .from(BUCKET)
            .uploadToSignedUrl(u.objek, u.token, h.blob);
          if (error) throw new Error(`Halaman ${h.halaman} gagal diunggah.`);
          terunggah++;
          setProgres({ selesai: terunggah, total: halaman.length });
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(KONKURENSI_UNGGAH, halaman.length) }, pekerja),
      );

      // Baru SESUDAH seluruh unggahan sukses. Gagal di tengah = tidak ada baris
      // tercatat = materi tampak "belum ada isi", bukan setengah terisi.
      const catat = await catatHalamanMateri(
        materiId,
        halaman.map((h, i) => ({
          halaman: h.halaman, objek: izin.unggahan[i].objek,
          lebar: h.lebar, tinggi: h.tinggi,
        })),
      );
      if (!catat.ok) { setFase("galat"); setPesan(catat.pesan); return; }

      setFase("selesai");
      setPesan(`${catat.jumlah} halaman tersimpan.`);
      onSelesai?.();
    } catch (e) {
      setFase("galat");
      setPesan(e instanceof Error ? e.message : "Gagal memproses PDF.");
    }
  }

  const sibuk = fase === "membaca" || fase === "mengunggah";

  return (
    <div className="mt-3">
      <label className="block">
        <span className="text-[12.5px] font-bold text-ink-soft">Berkas PDF</span>
        <input
          type="file"
          accept="application/pdf"
          disabled={sibuk}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void tangani(f);
          }}
          className="mt-1.5 block w-full text-[13px]"
        />
      </label>

      {sibuk && (
        <p role="status" aria-live="polite" className="mt-2 text-[12.5px] text-ink-soft">
          {fase === "membaca" ? "Menyiapkan halaman" : "Mengunggah"} {progres.selesai}
          {progres.total > 0 ? ` dari ${progres.total}` : ""}…
        </p>
      )}
      {pesan && (
        <p
          role="status"
          className={`mt-2 text-[12.5px] ${fase === "galat" ? "text-clay" : "text-leaf"}`}
        >
          {pesan}
        </p>
      )}
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
        Halaman PDF diubah menjadi gambar di peramban ini, lalu disimpan. PDF
        aslinya tidak ikut tersimpan — simpan berkas Anda sendiri bila kelak
        perlu mengunggah ulang.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Jalankan test, pastikan HIJAU**

Run: `npx vitest run tests/materi-pengunggah.test.ts && npx tsc --noEmit`
Expected: PASS (5 test)

- [ ] **Step 7: Commit**

```bash
git add src/lib/materi/pdf-klien.ts src/app/admin/materi/pengunggah-pdf.tsx tests/materi-pengunggah.test.ts package.json package-lock.json
git commit -m "feat(materi): rasterisasi PDF di browser admin + pengunggah berprogres"
```

---

### Task 9: Penugasan pasien di panel admin

**Files:**
- Create: `src/lib/admin/penugasan.ts`
- Create: `src/app/admin/materi/penugasan-aksi.ts`
- Create: `tests/materi-penugasan-aksi.test.ts`

**Interfaces:**
- Consumes: `material_assignments` (Task 2).
- Produces:
  - `daftarPenugasan(materiId: string): Promise<{ ditugaskan: Array<{clientId:string; nama:string; padmaId:string}>; otomatis: Array<{clientId:string; nama:string; padmaId:string}> }>`
  - `tugaskanMateri(materiId: string, clientId: string): Promise<{ok:true}|{ok:false;pesan:string}>`
  - `cabutTugasMateri(materiId: string, clientId: string): Promise<{ok:true}|{ok:false;pesan:string}>`

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-penugasan-aksi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/admin/materi/penugasan-aksi.ts"), "utf8",
);

describe("aksi penugasan — pagar struktural", () => {
  it("setiap aksi memanggil requireRole sendiri", () => {
    const aksi = [...SUMBER.matchAll(/export async function (\w+)/g)].length;
    const penjaga = [...SUMBER.matchAll(/requireRole\(\["admin", ?"owner"\]\)/g)].length;
    expect(aksi).toBeGreaterThan(0);
    expect(penjaga).toBe(aksi);
  });

  it("hasil tulis DIPERIKSA, bukan diasumsikan berhasil", () => {
    // PostgREST menjawab 200 + [] untuk tulis yang ditolak RLS, bukan error.
    expect(SUMBER).toMatch(/\.select\(["']material_id["']\)/);
  });

  it("ditugaskan_oleh tidak pernah dikirim dari kode — trigger yang mengisinya", () => {
    // Diikat pada payload insert, BUKAN pada seluruh berkas: komentar yang
    // menjelaskan kenapa kolom itu tidak dikirim justru memuat namanya, dan
    // asersi yang memindai seluruh sumber akan merah karena komentar. Test yang
    // merah karena komentar akan dilemahkan orang berikutnya — lalu pagar
    // aslinya ikut hilang.
    const payload = SUMBER.match(/\.insert\(\{([^}]*)\}\)/)?.[1] ?? "";
    expect(payload).toContain("material_id");
    expect(payload).not.toContain("ditugaskan_oleh");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-penugasan-aksi.test.ts`
Expected: FAIL

- [ ] **Step 3: Tulis lapisan data**

```ts
// src/lib/admin/penugasan.ts
import { createServerSupabase } from "@/lib/supabase/server";

export type PasienRingkas = { clientId: string; nama: string; padmaId: string };

type BarisAssign = { client_id: string; clients: { nama: string; padma_id: string } | null };
type BarisOtomatis = { client_id: string; clients: { nama: string; padma_id: string } | null };

/**
 * Siapa yang bisa membuka materi ini, dipisah menurut SEBABNYA.
 *
 * `otomatis` ditampilkan bacaan saja: tanpanya, admin akan meng-assign ulang
 * pasien yang materinya memang sudah terbuka, lalu bingung kenapa tidak ada
 * yang berubah.
 */
export async function daftarPenugasan(materiId: string): Promise<{
  ditugaskan: PasienRingkas[];
  otomatis: PasienRingkas[];
}> {
  const supabase = await createServerSupabase();

  const [{ data: assign }, { data: layanan }] = await Promise.all([
    supabase
      .from("material_assignments")
      .select("client_id, clients(nama, padma_id)")
      .eq("material_id", materiId)
      .returns<BarisAssign[]>(),
    supabase
      .from("material_services")
      .select("service_id")
      .eq("material_id", materiId)
      .returns<{ service_id: string }[]>(),
  ]);

  const idLayanan = (layanan ?? []).map((l) => l.service_id);
  let otomatis: PasienRingkas[] = [];
  if (idLayanan.length > 0) {
    const { data } = await supabase
      .from("sessions")
      .select("client_id, clients(nama, padma_id)")
      .eq("status", "selesai")
      .in("service_id", idLayanan)
      .returns<BarisOtomatis[]>();
    const unik = new Map<string, PasienRingkas>();
    for (const r of data ?? []) {
      if (!r.clients) continue;
      unik.set(r.client_id, {
        clientId: r.client_id, nama: r.clients.nama, padmaId: r.clients.padma_id,
      });
    }
    otomatis = [...unik.values()].sort((a, b) => a.nama.localeCompare(b.nama));
  }

  const ditugaskan = (assign ?? [])
    .filter((a) => a.clients)
    .map((a) => ({
      clientId: a.client_id, nama: a.clients!.nama, padmaId: a.clients!.padma_id,
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama));

  return { ditugaskan, otomatis };
}
```

- [ ] **Step 4: Tulis server action**

```ts
// src/app/admin/materi/penugasan-aksi.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

type Hasil = { ok: true } | { ok: false; pesan: string };

/**
 * Membuka satu materi untuk satu pasien, terlepas dari layanan yang ia jalani.
 *
 * `ditugaskan_oleh` SENGAJA tidak dikirim dari sini: trigger
 * `trg_paksa_aktor_penugasan` mengisinya dari `auth.uid()`. Mengirimnya dari
 * kode berarti membuat aktornya bisa dipalsukan oleh siapa pun yang bisa
 * memanggil action ini.
 */
export async function tugaskanMateri(materiId: string, clientId: string): Promise<Hasil> {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("material_assignments")
    .insert({ material_id: materiId, client_id: clientId })
    .select("material_id");

  if (error) {
    if (error.code === "23505") return { ok: false, pesan: "Pasien ini sudah ditugaskan." };
    return { ok: false, pesan: "Gagal menugaskan materi." };
  }
  // PostgREST menjawab 200 + [] untuk tulis yang ditolak RLS, bukan error.
  if (!data || data.length === 0) return { ok: false, pesan: "Penugasan ditolak." };

  revalidatePath("/admin/materi");
  return { ok: true };
}

export async function cabutTugasMateri(materiId: string, clientId: string): Promise<Hasil> {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("material_assignments")
    .delete()
    .eq("material_id", materiId)
    .eq("client_id", clientId)
    .select("material_id");

  if (error) return { ok: false, pesan: "Gagal mencabut penugasan." };
  if (!data || data.length === 0) return { ok: false, pesan: "Penugasan tidak ditemukan." };

  revalidatePath("/admin/materi");
  return { ok: true };
}
```

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

Run: `npx vitest run tests/materi-penugasan-aksi.test.ts && npx tsc --noEmit`
Expected: PASS (3 test)

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin/penugasan.ts src/app/admin/materi/penugasan-aksi.ts tests/materi-penugasan-aksi.test.ts
git commit -m "feat(materi): penugasan materi ke pasien di panel admin"
```

---

### Task 10: Reader passport + aturan tampilan daftar (M10)

**Files:**
- Modify: `src/lib/passport/data.ts` (`ambilDaftarMateri`, `ambilMateriDetail`)
- Create: `src/lib/passport/materi-tampil.ts`
- Create: `src/app/passport/materi/[id]/reader-pdf.tsx`
- Modify: `src/app/passport/materi/[id]/page.tsx`
- Create: `tests/materi-daftar-klien.test.ts`

**Interfaces:**
- Consumes: `material_pages`, `material_services` (Task 1, 3); route halaman (Task 6).
- Produces:
  - `MateriRingkas` bertambah `punyaLayanan: boolean`, dan `jumlahBab` diganti `jumlahHalaman: number`.
  - `MateriDetail.bab` diganti `halaman: Array<{halaman:number; lebar:number; tinggi:number}>`, dan bertambah `berhak: boolean` (dari RPC `berhak_isi_materi`).
  - `saringDaftarMateri(daftar: MateriRingkas[]): MateriRingkas[]` di `@/lib/passport/materi-tampil`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tests/materi-daftar-klien.test.ts
import { describe, it, expect } from "vitest";
import { saringDaftarMateri } from "@/lib/passport/materi-tampil";

describe("aturan tampilan daftar materi klien (M10)", () => {
  const dasar = { id: "m", judul: "J", tipe: "ebook" as const, deskripsi: "", namaLayanan: "", jumlahHalaman: 0 };

  it("materi berlayanan tetap tampil walau terkunci — penggodanya masih benar", () => {
    const hasil = saringDaftarMateri([{ ...dasar, punyaLayanan: true, terbuka: false }]);
    expect(hasil).toHaveLength(1);
  });

  it("materi TANPA layanan dan tidak terbuka DISEMBUNYIKAN", () => {
    // "Terbuka setelah layanan terkait selesai" adalah kalimat bohong untuk
    // materi yang tidak punya layanan terkait sama sekali.
    const hasil = saringDaftarMateri([{ ...dasar, punyaLayanan: false, terbuka: false }]);
    expect(hasil).toHaveLength(0);
  });

  it("materi tanpa layanan TAPI sudah di-assign tetap tampil", () => {
    const hasil = saringDaftarMateri([{ ...dasar, punyaLayanan: false, terbuka: true }]);
    expect(hasil).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-daftar-klien.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tulis fungsi penyaring murni**

```ts
// src/lib/passport/materi-tampil.ts
import type { MateriRingkas } from "./data";

/**
 * Aturan M10 — materi mana yang boleh muncul di daftar klien.
 *
 * Kartu terkunci ada untuk menggoda: "jalani layanan ini dan materinya
 * terbuka". Untuk materi TANPA layanan, janji itu bohong — tidak ada layanan
 * yang bisa dijalani untuk membukanya. Materi semacam itu hanya muncul bila
 * memang sudah di-assign kepada klien tersebut.
 *
 * Efek sampingnya sehat: judul materi yang belum diperuntukkan bagi siapa pun
 * tidak ikut terpampang ke seluruh klien.
 */
export function saringDaftarMateri(daftar: MateriRingkas[]): MateriRingkas[] {
  return daftar.filter((m) => m.punyaLayanan || m.terbuka);
}
```

- [ ] **Step 4: Perbarui lapisan data passport**

Di `src/lib/passport/data.ts`:
- `MateriRingkas`: ganti `jumlahBab: number` → `jumlahHalaman: number`, tambah `punyaLayanan: boolean`.
- `ambilDaftarMateri`: ganti embed `material_chapters(id)` → `material_pages(halaman)`, tambah `material_services(service_id)`. `terbuka` untuk ebook = `halaman.length > 0`. `punyaLayanan` = `material_services.length > 0`. Terapkan `saringDaftarMateri` pada hasil akhir.

  **WAJIB di task ini:** nama layanan berhenti dibaca lewat `services!materials_service_id_fkey(nama)` dan mulai dibaca lewat tabel penghubung. Petunjuk FK itu ditambahkan di Task 1 hanya sebagai penopang sementara — Task 11 menghapus `materials.service_id`, dan petunjuk yang menyebut FK yang sudah tidak ada akan mematahkan query. Karena satu materi kini bisa punya beberapa layanan, `namaLayanan` menjadi gabungan (`", "`) atau string kosong bila tidak ada layanan.
- `MateriDetail`: ganti `bab: BabMateri[]` → `halaman: Array<{ halaman: number; lebar: number; tinggi: number }>`.
- `ambilMateriDetail`: ganti embed `material_chapters(...)` → `material_pages(halaman, lebar, tinggi)`, urutkan menaik menurut `halaman`.

`namaLayanan` kini bisa jamak; gabungkan dengan `", "` atau kosong bila tidak ada layanan.

- [ ] **Step 5: Tulis reader**

```tsx
// src/app/passport/materi/[id]/reader-pdf.tsx
"use client";

/**
 * Reader e-book: deretan gambar halaman.
 *
 * Watermark TIDAK dilapiskan di sini — ia sudah ada di dalam setiap gambar,
 * dibakar server. Lapisan CSS akan hilang begitu gambarnya disimpan; yang
 * dibakar tidak.
 *
 * `width`/`height` diisi dari dimensi asli supaya peramban menyediakan ruang
 * sebelum gambarnya tiba. Tanpa itu, membaca sambil menggulir akan membuat
 * halaman melompat setiap satu gambar selesai dimuat.
 */
export function ReaderPdf({
  materiId,
  halaman,
}: {
  materiId: string;
  halaman: Array<{ halaman: number; lebar: number; tinggi: number }>;
}) {
  return (
    <div
      className="grid gap-4 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {halaman.map((h) => (
        <figure key={h.halaman} className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          <img
            src={`/api/materi/${materiId}/halaman/${h.halaman}`}
            width={h.lebar}
            height={h.tinggi}
            loading={h.halaman <= 2 ? "eager" : "lazy"}
            draggable={false}
            alt={`Halaman ${h.halaman}`}
            className="block h-auto w-full"
          />
          <figcaption className="border-t border-black/10 px-4 py-2 text-center text-[11.5px] text-ink-soft">
            Halaman {h.halaman} dari {halaman.length}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Sambungkan ke halaman reader, dengan TIGA keadaan**

`ambilMateriDetail` kini juga memanggil RPC `berhak_isi_materi`, sebab tanpa itu
"tidak berhak" dan "berhak tapi isinya belum diunggah" terlihat identik — nol
baris — dan pasien yang berhak akan dibohongi kalimat "terbuka setelah layanan
terkait Anda jalani".

```ts
// di src/lib/passport/data.ts, dalam ambilMateriDetail
const { data: berhak } = await supabase.rpc("berhak_isi_materi", {
  p_material_id: materialId,
});
```

Lalu di `src/app/passport/materi/[id]/page.tsx`, cabang ebook menjadi tiga keadaan:

```tsx
// 1. Tidak berhak — pesan lama, dan ia memang benar di sini.
if (!m.berhak) {
  return <BelumTerbuka judul={m.judul} />;   // komponen yang sudah ada
}

// 2. Berhak, tetapi isinya belum diunggah admin. Bukan 404, dan bukan reader
//    kosong yang membuat pasien mengira aplikasinya rusak.
if (m.tipe === "ebook" && m.halaman.length === 0) {
  return (
    <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
      <h1 className="font-serif text-xl text-night">Isi materi sedang disiapkan</h1>
      <p className="mt-2 text-[13.5px] text-ink-soft">
        <b className="text-ink">{m.judul}</b> sudah terbuka untuk Anda, tetapi
        isinya belum diunggah tim PADMA. Silakan cek kembali nanti.
      </p>
    </section>
  );
}

// 3. Berhak dan ada isinya.
return <ReaderPdf materiId={m.id} halaman={m.halaman} />;
```

Hapus impor `Watermark` untuk cabang ebook — watermark-nya sudah di dalam
gambar, dan melapisinya lagi hanya menggandakan teks yang sama. Cabang video
**tidak disentuh sama sekali**.

- [ ] **Step 7: Jalankan test, pastikan HIJAU**

Run: `npx vitest run && npx tsc --noEmit`
Expected: semua hijau

- [ ] **Step 8: Commit**

```bash
git add src/lib/passport/ "src/app/passport/materi/[id]" tests/materi-daftar-klien.test.ts
git commit -m "feat(materi): reader halaman PDF di passport + aturan tampilan M10"
```

---

### Task 11: Bongkar bab teks & `materials.service_id`

**Files:**
- Create: `supabase/migrations/20260831130000_materi_hapus_bab_teks.sql`
- Modify: `src/lib/admin/materi-admin.ts`, `src/app/admin/materi/aksi.ts`, `src/app/admin/materi/form-materi.tsx`, `src/app/admin/materi/page.tsx`, `src/app/admin/materi/status.ts`
- Modify: `supabase/seed.sql`
- Modify/Delete: test yang menyebut `material_chapters`

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: `material_chapters`, RPC `hapus_bab_materi`, dan `materials.service_id` tidak ada lagi. Panel admin memakai pilihan layanan berganda + `PengunggahPdf`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tambahkan ke tests/materi-halaman.test.ts
it("material_chapters dan materials.service_id sudah tidak ada", async () => {
  const db = svc();
  const { error: bab } = await db.from("material_chapters").select("id").limit(1);
  expect(bab).toBeTruthy(); // relasi hilang -> PostgREST menjawab error

  const { data: m } = await db.from("materials").select("*").limit(1).single();
  expect(Object.keys(m!)).not.toContain("service_id");
});

it("materi boleh lahir TANPA layanan sama sekali", async () => {
  const db = svc();
  const { data, error } = await db
    .from("materials")
    .insert({ judul: "UJI-TANPA-LAYANAN", tipe: "ebook", deskripsi: "", aktif: true })
    .select("id").single();
  expect(error).toBeNull();
  await db.from("materials").delete().eq("id", data!.id);
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `npx vitest run tests/materi-halaman.test.ts`
Expected: FAIL

- [ ] **Step 3: Tulis migration**

```sql
-- supabase/migrations/20260831130000_materi_hapus_bab_teks.sql
-- ============================================================================
-- BAB TEKS DIBONGKAR; ISI E-BOOK KINI GAMBAR HALAMAN
-- ============================================================================
-- Bab teks di database lahir KARENA belum ada penyimpanan berkas. Sejak
-- material_pages ada, ia tidak punya alasan hidup lagi, dan mempertahankannya
-- berarti dua jalur gating serta dua reader yang setiap pagarnya harus
-- ditegakkan dua kali.
--
-- ISI bab yang ada HILANG. Itu konsekuensi keputusan M1 yang disepakati; konten
-- demo diganti PDF dummy di seed.

drop function if exists public.hapus_bab_materi(uuid);
drop table if exists public.material_chapters;

-- `materials.service_id` digantikan material_services. Dihapus paling akhir
-- supaya seluruh task sebelumnya berjalan dengan aplikasi yang masih hidup.
alter table public.materials drop column service_id;

comment on table public.materials is
  'Metadata materi. Isi e-book hidup di material_pages (gambar halaman), isi '
  'video di material_videos. Keterkaitan dengan layanan ada di '
  'material_services dan BOLEH KOSONG — materi tanpa layanan hanya terbuka '
  'lewat material_assignments, dan panel admin wajib menandainya.';
```

- [ ] **Step 4: Perbarui panel admin**

- `status.ts`: hapus `PANJANG_ISI_BAB_MAKS`, `URUTAN_BAB_MAKS`, `periksaIsiBab`, `periksaUrutan`. Ubah `LABEL_ISI.ebook` menjadi `"satu berkas PDF"`.
- `materi-admin.ts`: ganti `BabKelola`/`bab` dengan `jumlahHalaman: number` (dari `material_pages`), ganti `layananId: string` dengan `layananId: string[]` (dari `material_services`), dan `lengkap` untuk ebook = `jumlahHalaman > 0`. Struktur pengelompokan berubah: materi kini bisa muncul di bawah lebih dari satu layanan, plus satu kelompok **"Tanpa layanan"** di akhir.
- `aksi.ts`: hapus `tambahBab`, `perbaruiBab`, `hapusBab`. Pada `simpanMateri`/`perbaruiMateri`, ganti pembacaan `service_id` tunggal dengan pembacaan berganda yang **boleh kosong**:

```ts
/**
 * Layanan materi: nol atau lebih. Kosong adalah pilihan SAH — admin wajar ingin
 * menumpuk bahan dulu, dan materi tanpa layanan tetap bisa dibuka lewat
 * penugasan. Daftar materi menandainya "Tanpa layanan · hanya lewat assign"
 * supaya keadaan itu terlihat, bukan tersembunyi.
 */
const idLayanan = formData
  .getAll("service_id")
  .map((v) => String(v).trim())
  .filter((v) => v.length > 0);

// Setiap id diperiksa keberadaannya. FK memang menolak yang tidak ada, tetapi
// yang sampai ke layar admin dari FK hanyalah kode 23503.
for (const id of idLayanan) {
  if (!(await layananAda(id))) {
    return { ok: false, pesan: "Layanan yang dipilih tidak ditemukan." };
  }
}
```

Lalu tulis tautannya dengan hapus-lalu-sisip yang **dilingkup `material_id`** —
radiusnya terikat variabel wajib, bukan filter yang bisa dibuat tautologis:

```ts
async function gantiLayananMateri(materiId: string, idLayanan: string[]) {
  const supabase = await createServerSupabase();
  const { error: hapus } = await supabase
    .from("material_services")
    .delete()
    .eq("material_id", materiId);   // radius terikat SATU materi
  if (hapus) return { ok: false as const, pesan: "Gagal memperbarui layanan materi." };

  if (idLayanan.length === 0) return { ok: true as const };

  const { data, error } = await supabase
    .from("material_services")
    .insert(idLayanan.map((service_id) => ({ material_id: materiId, service_id })))
    .select("material_id");
  // PostgREST menjawab 200 + [] untuk tulis yang ditolak RLS, bukan error.
  if (error || !data || data.length !== idLayanan.length) {
    return { ok: false as const, pesan: "Gagal menyimpan layanan materi." };
  }
  return { ok: true as const };
}
```
- `form-materi.tsx`: ganti `<select name="service_id">` dengan daftar checkbox `name="service_id"` (opsional, tanpa `required`), dan ganti medan isi ebook dengan `<PengunggahPdf materiId={...} />`.
- `page.tsx`: tambahkan label **"Tanpa layanan · hanya lewat assign"** pada materi berlayanan kosong, dan **"Belum ada isi"** pada materi tanpa halaman/video. Tambahkan panel penugasan memakai `daftarPenugasan` + `tugaskanMateri`/`cabutTugasMateri`.
- `src/app/admin/layanan/page.tsx`: tambahkan daftar **bacaan** "Materi yang termasuk layanan ini" di bawah tiap layanan (spec §9). Konfigurasinya dikelola dari sisi materi, tetapi admin yang membuka layanan wajib bisa MELIHAT-nya dari sini — tanpa itu, model mental "layanan ini include materi apa saja" tidak punya satu pun layar yang menjawabnya. Datanya dari `material_services` + `materials.judul`; sengaja tanpa kontrol sunting, supaya tidak ada dua tempat menulis satu relasi.

- [ ] **Step 5: Ganti seed**

Di `supabase/seed.sql`: hapus seluruh `insert into material_chapters`, dan ganti dengan `insert into material_services` untuk tiap materi. Halaman ebook demo **tidak diisi lewat SQL** — ia lahir dari unggahan admin, dan seed yang mengarangnya akan menunjuk objek yang tidak ada di bucket. Materi ebook demo karena itu berstatus "Belum ada isi" sampai diunggah, dan itu keadaan yang jujur.

- [ ] **Step 6: Bereskan test yang menyebut bab atau `service_id`**

Jalankan `grep -rln "material_chapters" tests/` dan perbaiki setiap berkas: yang menguji gating bab dialihkan ke `material_pages`, yang menguji CRUD bab dihapus bersama fiturnya.

**Dua berkas WAJIB disebut karena ia lahir dari rencana ini sendiri dan pasti merah:**

1. **`tests/materi-penugasan.test.ts`** (dari Task 2) — dua hal patah sekaligus:
   - `beforeAll` menyisipkan `materials` dengan `service_id`, kolom yang baru saja dihapus. Hapus medan itu; sesudah migrasi ini, materi memang boleh lahir tanpa layanan, sehingga `delete().eq("material_id", ...)` pada `material_services` juga tidak lagi diperlukan.
   - Seluruh asersinya menguji gating lewat `material_chapters`. Alihkan ke `material_pages`, dengan baris uji disisipkan lewat RPC:

   ```ts
   await db.rpc("ganti_halaman_materi", {
     p_material_id: materiId,
     p_halaman: [{ halaman: 1, objek: `${materiId}/0001.webp`, lebar: 10, tinggi: 10 }],
   });
   ```

   Lalu asersinya membaca `material_pages` alih-alih `material_chapters`. Perilaku yang diuji **identik** — kedua tabel memakai policy `berhak_isi_materi` yang sama — jadi cakupannya tidak berkurang. **Buktikan itu**: jalankan tesnya SEBELUM dan SESUDAH menghapus baris `material_assignments`, dan pastikan ia merah tanpa penugasan lalu hijau dengannya. Tes gating yang hijau di kedua keadaan tidak menguji apa pun.

2. **`tests/materi-halaman.test.ts`** (dari Task 3) — helper `buat()` dan dua insert `materials` lainnya menyertakan `service_id`. Hapus medan itu beserta query `services` yang hanya melayaninya.

- [ ] **Step 7: Verifikasi menyeluruh**

Run: `npx supabase db reset && npx vitest run && npx tsc --noEmit && npx eslint src tests && npm run build`
Expected: semua hijau

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(materi): bongkar bab teks & materials.service_id, panel admin pindah ke PDF"
```

---

### Task 12: E2E rantai penuh

**Files:**
- Create: `tests/e2e/materi-pdf.e2e.ts`
- Modify: `package.json` (skrip `test:e2e:materi`, masukkan ke `test:e2e:semua`)

**Interfaces:**
- Consumes: seluruh task sebelumnya, `buatPdfUji` (Task 4), `tungguIsi` (`tests/e2e/_tunggu.ts`).

- [ ] **Step 1: Tulis skrip E2E**

Ikuti bentuk `tests/e2e/admin-pelengkap.e2e.ts` (fungsi `catat`, penanda data uji, pembersihan di `finally`). Yang dibuktikan, berurutan:

1. Admin membuat materi ebook **tanpa layanan**, lalu mengunggah PDF 3 halaman hasil `buatPdfUji(3)` yang ditulis ke berkas sementara dan diisikan lewat `setInputFiles`. Panel menampilkan "3 halaman tersimpan".
2. Klien uji **belum berhak**: `GET /api/materi/{id}/halaman/1` menjawab **404**, dan query REST `material_pages` mengembalikan **0 baris**.
3. Materi itu **tidak muncul** di `/passport/materi` (aturan M10 — tanpa layanan dan belum di-assign).
4. Admin meng-assign klien itu. Sekarang `GET .../halaman/1` menjawab **200** dengan `content-type: image/webp`, dan headernya memuat `private` beserta `max-age=900`, serta **tidak** memuat `s-maxage` maupun `public`.
5. Materi muncul di `/passport/materi` dan reader menampilkan tiga halaman.
6. **Dua klien berbeda menerima byte yang berbeda** untuk halaman yang sama — bukti watermark dibakar, bukan dilapiskan.
7. **Objek storage tidak bisa diambil langsung**: `GET {SUPABASE_URL}/storage/v1/object/materi-halaman/{objek}` dengan anon key maupun JWT klien harus gagal.
8. Admin mencabut penugasan → `GET .../halaman/1` kembali **404**.
9. Seluruh data uji terhapus, dan objek di bucket ikut bersih.

Dua bagian yang paling mudah salah, jadi kodenya ditulis di sini:

```ts
// (1) Mengisikan PDF hasil buatPdfUji ke input berkas panel admin.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { buatPdfUji } from "../bantu/pdf";

const berkasPdf = path.join(tmpdir(), `padma-e2e-${stempel}.pdf`);
writeFileSync(berkasPdf, buatPdfUji(3));
await kerja.locator('input[type="file"][accept="application/pdf"]').setInputFiles(berkasPdf);
// Rasterisasi + unggah berjalan di peramban: tunggu pesan hasilnya, JANGAN
// tunggu jaringan sepi — unggahan paralel membuat "networkidle" datang dan
// pergi beberapa kali sebelum pencatatan barisnya selesai.
await kerja.getByText(/3 halaman tersimpan/).waitFor({ timeout: 60_000 });
```

```ts
// (2) Membuktikan watermark DIBAKAR: dua pasien, byte berbeda.
async function ambilHalaman(ctx: BrowserContext, materiId: string) {
  const res = await ctx.request.get(`${BASE}/api/materi/${materiId}/halaman/1`);
  return {
    status: res.status(),
    tipe: res.headers()["content-type"] ?? "",
    cache: res.headers()["cache-control"] ?? "",
    byte: Buffer.from(await res.body()),
  };
}

const a = await ambilHalaman(ctxAnanda, materiId);
const b = await ambilHalaman(ctxRina, materiId);
catat(
  "6. dua pasien menerima gambar ber-byte BERBEDA (watermark dibakar)",
  a.status === 200 && b.status === 200 && !a.byte.equals(b.byte),
  `panjang ${a.byte.length} vs ${b.byte.length}; identik: ${a.byte.equals(b.byte)}`,
);
catat(
  "4b. cache private (CDN tertutup) dan peramban pasien boleh memakai ulang",
  a.cache.includes("private") &&
    a.cache.includes("max-age=900") &&
    !a.cache.includes("s-maxage") &&
    !a.cache.includes("public"),
  `cache-control: ${a.cache}`,
);
```

- [ ] **Step 2: Daftarkan skripnya**

```json
"test:e2e:materi": "tsx tests/e2e/materi-pdf.e2e.ts",
"test:e2e:semua": "npm run test:e2e && npm run test:e2e:funnel && npm run test:e2e:passport && npm run test:e2e:admin && npm run test:e2e:pelengkap && npm run test:e2e:owner && npm run test:e2e:materi"
```

- [ ] **Step 3: Jalankan seluruh E2E**

Run: `npm run dev` (terminal lain), lalu `npm run test:e2e:semua`
Expected: seluruh suite lolos, termasuk yang baru

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/materi-pdf.e2e.ts package.json
git commit -m "test(e2e): rantai penuh materi PDF — gating, watermark, dan objek storage tertutup"
```

---

## Catatan Penutup untuk Pelaksana

**Yang paling mudah salah di rencana ini**, diurutkan menurut biaya bila terlewat:

1. **`Cache-Control` pada route halaman:** `private, max-age=900`. `private` tidak boleh hilang dan `s-maxage`/`public` tidak boleh muncul — watermark-nya per-pasien, dan satu di antara dua kata itu membuat CDN menyajikan halaman pasien A kepada pasien B. `max-age` sebaliknya memang harus ADA: ia yang mencegah ebook 60 halaman diunduh ulang setiap kali pasien menggulir balik.
2. **Urutan RLS lalu service role** di route halaman. Membalik urutannya berarti service role mengambil objek sebelum ada yang memeriksa hak — dan service role menembus semua pagar.
3. **Nama policy saat menulis ulang.** Nama baru = policy lama tetap hidup berdampingan = celah tetap terbuka tanpa error.
4. **`revoke` grant default pada tiga tabel baru.** Mudah terlewat karena tidak ada gejalanya sampai seseorang mencobanya.
5. **Escaping XML pada nama pasien** di watermark. Nama diketik admin; satu `<` merusak seluruh penyajian halaman.
