# Produk Digital — Tahap 1 (katalog & pengiriman) — Rencana Implementasi

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development (disarankan) atau superpowers:executing-plans untuk mengeksekusi rencana ini tugas demi tugas. Langkah memakai sintaks checkbox (`- [ ]`) untuk penanda kemajuan.

**Tujuan:** Membuat produk digital (video/PDF) bisa dikelola staf, dipajang publik berharga coret, dan **diambil gratis** oleh klien yang login — seluruhnya tanpa satu baris pun kode pembayaran.

**Arsitektur:** Entitas baru (`digital_products` + harga append-only + entitlement) yang terpisah dari `materials` karena sumbu izinnya berbeda ("sudah membeli" vs "punya sesi selesai"), tetapi memakai ulang mesin pengiriman yang sudah ada: presigned R2 untuk video, rasterisasi + watermark untuk PDF. Harga hidup di tabelnya sendiri di balik money firewall dan keluar hanya lewat dua view berkolom sempit.

**Tech stack:** Next.js 16 (App Router, server component + server action), Supabase (Postgres + RLS + Storage), Cloudflare R2 (S3 SDK), sharp, pdfjs-dist, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-20-padma-produk-digital-design.md`

## Batasan Global

Berlaku untuk **setiap** tugas di bawah, tanpa diulang di masing-masing.

- **Bahasa kode:** nama tabel/kolom/berkas/fungsi berbahasa Indonesia, mengikuti repo. Tabel & kolom skema baru berbahasa Inggris hanya bila meneruskan konvensi tabel lama (`digital_products`, `client_id`) — sama seperti `certificates`.
- **`requireRole` wajib di SETIAP server action.** Server action adalah endpoint POST tersendiri yang tidak dijaga guard layout. Sudah pernah dibuktikan di repo ini dengan mem-POST action panel admin dari rute lain.
- **Service role haram di `src/app/admin/**`** kecuali titik yang sudah didaftarkan `tests/admin-shell.test.ts`. Kode yang butuh service role tinggal di `src/lib/`.
- **Rute baru WAJIB didaftarkan di tabel rute `web/README.md`.** `tests/inventaris-rute.test.ts` memeriksa dua arah dan akan merah bila terlewat.
- **Galat PostgREST dibaca, tidak dibuang.** `data ?? []` mengubah kegagalan jadi "tidak ada baris" — kalimat yang tak bisa dibedakan dari keadaan sehat (Ruling 26).
- **Penolakan akses pada route handler = 404, tidak pernah 401/403.** Rute tidak boleh mengonfirmasi keberadaan produk kepada yang tak berhak.
- **Path objek storage ditentukan server, tidak pernah dikirim browser.**
- **Tanggal "hari ini" = `hariIniJakarta()`** dari `@/lib/passport/waktu`, tidak pernah `new Date().toISOString()`. Vercel berjalan UTC.
- **Migration diberi cap waktu MANUAL** yang lebih besar dari berkas terakhir di `web/supabase/migrations/`, bukan hasil `supabase migration new` (jam dinding pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal). Berkas terakhir saat rencana ini ditulis: `20260920100000_usia_kehamilan_skrining.sql`.
- **`npm test` penuh dikoordinasikan lebih dulu** — Supabase lokal dipakai bersama sesi lain. Selama pengerjaan, jalankan berkas uji tertentu saja: `npx vitest run tests/<berkas>.test.ts`.
- **Perintah dijalankan dari `web/`**, bukan dari akar repo.
- Sesudah migration baru: `npx supabase db reset` (ini juga menyemai user demo lewat `tests/global-setup.ts`).
- **Commit di setiap akhir tugas.** Pesan commit berbahasa Indonesia, berformat `feat(produk): …` / `test(produk): …`, diakhiri baris `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Skema inti produk digital + RLS

**Files:**
- Create: `web/supabase/migrations/20260921100000_produk_digital.sql`
- Create: `web/tests/produk-skema-db.test.ts`

**Interfaces:**
- Consumes: —
- Produces: tabel `public.digital_products` (kolom: `id`, `judul`, `slug`, `deskripsi`, `jenis`, `boleh_unduh`, `sampul_objek`, `aktif`, `urutan`, `created_at`), `public.digital_product_files` (`product_id`, `objek`, `mime`, `byte`), `public.digital_product_pages` (`product_id`, `halaman`, `objek`), enum `public.product_type` (`video`|`pdf`). Bucket storage `produk-halaman` (privat), `produk-berkas` (privat), `produk-sampul` (publik baca).

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/produk-skema-db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { anonClient, signInAs } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Skema produk digital, diperiksa STRUKTURAL.
 *
 * Yang dijaga bukan sekadar "tabelnya ada", melainkan tiga keputusan yang
 * mudah hilang tanpa satu pun assertion berubah merah: produk baru lahir
 * TIDAK aktif, unduhan TERTUTUP secara bawaan, dan pengunjung anon hanya
 * boleh melihat produk yang aktif.
 */
describe("skema digital_products", () => {
  it("produk baru lahir nonaktif dan tidak boleh diunduh", async () => {
    const kolom = await querySql<{ column_name: string; column_default: string | null }>(
      `select column_name, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'digital_products'`,
    );
    const bawaan = new Map(kolom.map((k) => [k.column_name, k.column_default]));
    expect(bawaan.get("aktif")).toBe("false");
    expect(bawaan.get("boleh_unduh")).toBe("false");
  });

  it("tidak ada satu pun kolom nominal di tabel produk", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'digital_products'`,
    );
    const nominal = kolom
      .map((k) => k.column_name)
      .filter((n) => /(^|_)(harga|price|tarif|biaya)(_|$)/.test(n));
    expect(nominal).toEqual([]);
  });

  it("slug unik — dua produk tidak boleh berbagi alamat publik", async () => {
    const svc = createAdminSupabase();
    const a = await svc.from("digital_products")
      .insert({ judul: "Uji A", slug: "uji-slug-kembar", jenis: "pdf" }).select("id").single();
    expect(a.error).toBeNull();
    const b = await svc.from("digital_products")
      .insert({ judul: "Uji B", slug: "uji-slug-kembar", jenis: "pdf" }).select("id");
    expect(b.error?.code).toBe("23505");
    await svc.from("digital_products").delete().eq("id", a.data!.id);
  });

  it("anon hanya melihat produk AKTIF", async () => {
    const svc = createAdminSupabase();
    const { data: dibuat } = await svc.from("digital_products")
      .insert({ judul: "Belum tayang", slug: "belum-tayang-uji", jenis: "pdf", aktif: false })
      .select("id").single();

    const { data, error } = await anonClient()
      .from("digital_products").select("id").eq("id", dibuat!.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await svc.from("digital_products").update({ aktif: true }).eq("id", dibuat!.id);
    const { data: sesudah } = await anonClient()
      .from("digital_products").select("id").eq("id", dibuat!.id);
    expect((sesudah ?? []).length).toBe(1);

    await svc.from("digital_products").delete().eq("id", dibuat!.id);
  });

  it("klien biasa tidak bisa menulis produk", async () => {
    const klien = await signInAs("klien@padma.test");
    const { error } = await klien.from("digital_products")
      .insert({ judul: "Nakal", slug: "nakal-uji", jenis: "pdf" }).select("id");
    expect(error).not.toBeNull();
  });

  it("admin boleh menulis produk", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("digital_products")
      .insert({ judul: "Dari admin", slug: "dari-admin-uji", jenis: "video" }).select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    await createAdminSupabase().from("digital_products").delete().eq("id", data![0].id);
  });
});
```

Catatan: email user demo dibaca dari `tests/global-setup.ts`; bila berbeda dari `klien@padma.test`/`admin@padma.test`, pakai yang tertulis di sana.

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-skema-db.test.ts`
Expected: FAIL — relasi `digital_products` belum ada.

- [ ] **Step 3: Tulis migration**

Buat `web/supabase/migrations/20260921100000_produk_digital.sql`:

```sql
-- ===========================================================================
-- PRODUK DIGITAL — katalog yang DIJUAL, bukan materi yang DITUGASKAN
-- ===========================================================================
-- Tabel ini sengaja BUKAN kolom baru pada `materials`. Akses materi digerbang
-- "punya sesi selesai pada layanan ini"; akses produk digerbang "sudah
-- membeli". Dua sumbu izin dalam satu tabel memaksa setiap policy materi yang
-- sudah ada dipikirkan ulang, dan membuka jalan materi kursus tak sengaja
-- terpajang di etalase publik.
create type public.product_type as enum ('video', 'pdf');

create table public.digital_products (
  id uuid primary key default gen_random_uuid(),
  judul text not null,

  -- Alamat publik `/produk/<slug>`. UNIQUE karena dua produk yang berbagi
  -- slug membuat "produk mana yang dibuka" jadi pertanyaan tanpa jawaban.
  slug text not null unique,
  deskripsi text not null default '',
  jenis public.product_type not null,

  -- Default TERTUTUP, dibuka sadar. Unduhan adalah satu-satunya jalur di
  -- PADMA yang melepas berkas utuh ke tangan pembaca; ia tidak boleh menyala
  -- karena seseorang lupa mematikannya.
  boleh_unduh boolean not null default false,

  sampul_objek text,

  -- Produk baru TIDAK langsung terpajang: judul dan berkasnya diisi bertahap,
  -- dan produk setengah jadi di etalase lebih buruk daripada produk yang
  -- belum ada.
  aktif boolean not null default false,

  urutan int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.digital_products is
  'Katalog produk digital yang dijual. TANPA kolom nominal — harga hidup di '
  'digital_product_prices, di balik money firewall. `aktif` dan `boleh_unduh` '
  'keduanya default false: yang terpajang dan yang bisa diunduh adalah '
  'keputusan sadar, bukan keadaan bawaan.';

create index digital_products_etalase_idx
  on public.digital_products (aktif, urutan, created_at desc);

-- ===== BERKAS =====
create table public.digital_product_files (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.digital_products(id) on delete cascade,

  -- Kunci objek: R2 untuk video, bucket `produk-berkas` untuk PDF utuh.
  -- Ditentukan server, tidak pernah dikirim browser — browser yang memilih
  -- path adalah browser yang bisa menimpa berkas produk lain.
  objek text not null,
  mime text not null,
  byte bigint not null,
  created_at timestamptz not null default now(),
  unique (product_id)
);

-- ===== HALAMAN PDF TERASTERISASI (pola material_pages) =====
create table public.digital_product_pages (
  product_id uuid not null references public.digital_products(id) on delete cascade,
  halaman int not null,
  objek text not null,
  primary key (product_id, halaman)
);

-- ===== RLS =====
alter table public.digital_products enable row level security;
alter table public.digital_product_files enable row level security;
alter table public.digital_product_pages enable row level security;

-- Staf: penuh.
create policy "produk: staf" on public.digital_products for all
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Publik: hanya yang AKTIF, dan hanya BACA. Berlaku untuk anon maupun
-- authenticated — etalase adalah halaman yang sama untuk keduanya.
create policy "produk: baca publik yang aktif" on public.digital_products for select
  using (aktif);

create policy "berkas produk: staf" on public.digital_product_files for all
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

create policy "halaman produk: staf" on public.digital_product_pages for all
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Policy BACA untuk pemilik entitlement ditambahkan di migration Task 3,
-- sesudah tabel `digital_entitlements` lahir. Sampai saat itu, berkas dan
-- halaman hanya terbaca staf — fail-closed, bukan fail-open.

-- ===== BUCKET =====
insert into storage.buckets (id, name, public)
values ('produk-halaman', 'produk-halaman', false),
       ('produk-berkas', 'produk-berkas', false),
       ('produk-sampul', 'produk-sampul', true)
on conflict (id) do nothing;

-- `produk-halaman` & `produk-berkas` sengaja TANPA satu pun policy: tidak ada
-- peran API yang boleh menyentuhnya langsung. Seluruh akses lewat route
-- handler yang memakai service role SESUDAH basis data memulangkan barisnya —
-- pola yang sama dengan bucket `bukti-bayar` dan `materi-halaman`.

create policy "sampul produk: baca publik" on storage.objects for select
  using (bucket_id = 'produk-sampul');

create policy "sampul produk: tulis staf" on storage.objects for insert
  with check (bucket_id = 'produk-sampul' and public.user_role() in ('admin','owner'));
```

- [ ] **Step 4: Terapkan migration dan jalankan uji**

Run: `cd web && npx supabase db reset && npx vitest run tests/produk-skema-db.test.ts`
Expected: PASS, seluruh 6 uji hijau.

- [ ] **Step 5: Commit**

```bash
cd web && git add supabase/migrations/20260921100000_produk_digital.sql tests/produk-skema-db.test.ts
git commit -m "feat(produk): skema inti produk digital + RLS

Entitas terpisah dari materials: sumbu izinnya berbeda. aktif &
boleh_unduh default false — terpajang dan bisa diunduh adalah
keputusan sadar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Harga, dua view sempit, dan pelebaran money firewall

**Files:**
- Create: `web/supabase/migrations/20260921110000_produk_harga.sql`
- Create: `web/tests/produk-harga-publik.test.ts`
- Modify: `web/tests/money-firewall-struktural.test.ts` (konstanta `TABEL_UANG` dan `KOLOM_UANG_VIEW_DIIZINKAN` beserta dokblok alasannya)

**Interfaces:**
- Consumes: `digital_products` (Task 1).
- Produces: tabel `public.digital_product_prices` (`id`, `product_id`, `harga int`, `harga_coret int null`, `berlaku_sejak date`), view `public.harga_produk_publik` (kolom **persis**: `product_id`, `harga`, `harga_coret`, `berlaku_sejak`), view `public.produk_harga_staf` (kolom persis sama).

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/produk-harga-publik.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { anonClient, signInAs } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Batas kerahasiaan harga produk adalah DAFTAR KOLOM kedua view ini — sama
 * persis dengan yang dijaga `tests/harga-publik.test.ts` untuk `harga_publik`.
 * Daftarnya dikunci sebagai assertion karena menambah kolom ke proyeksi view
 * adalah satu baris ketikan yang tidak memerahkan apa pun.
 */
describe("harga produk digital", () => {
  it("harga_produk_publik berkolom PERSIS empat", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'harga_produk_publik'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "product_id", "harga", "harga_coret", "berlaku_sejak",
    ]);
  });

  it("anon boleh membaca view, tapi TIDAK tabel dasarnya", async () => {
    const { error: viewErr } = await anonClient()
      .from("harga_produk_publik").select("product_id").limit(1);
    expect(viewErr).toBeNull();

    const { error: tabelErr } = await anonClient()
      .from("digital_product_prices").select("harga").limit(1);
    expect(tabelErr?.code).toBe("42501");
  });

  it("klien login juga tidak bisa menyentuh tabel harga langsung", async () => {
    const klien = await signInAs("klien@padma.test");
    const { error } = await klien.from("digital_product_prices").select("harga").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("harga yang belum berlaku tidak bocor ke pengunjung", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji harga", slug: "uji-harga-masa-depan", jenis: "pdf", aktif: true })
      .select("id").single();

    // Kalender JAKARTA, bukan UTC — view memakai `(now() at time zone
    // 'Asia/Jakarta')::date`, dan pada 00:00-06:59 WIB "besok" versi UTC
    // sudah sama dengan hari ini versi Jakarta.
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
    const besok = fmt.format(new Date(Date.now() + 86_400_000));

    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 99_000, berlaku_sejak: besok });

    const { data } = await anonClient()
      .from("harga_produk_publik").select("harga").eq("product_id", produk!.id);
    expect(data).toEqual([]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("harga coret yang lebih murah dari harga jual DITOLAK basis data", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji coret", slug: "uji-coret-murah", jenis: "pdf" })
      .select("id").single();

    const { error } = await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 100_000, harga_coret: 50_000 })
      .select("id");
    expect(error?.code).toBe("23514");

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("harga tidak bisa disunting maupun dihapus lewat peran API", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji riwayat", slug: "uji-riwayat-harga", jenis: "pdf" })
      .select("id").single();
    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 50_000 });

    const owner = await signInAs("owner@padma.test");
    const { data: ubah } = await owner.from("digital_product_prices")
      .update({ harga: 1 }).eq("product_id", produk!.id).select("id");
    expect(ubah ?? []).toEqual([]);

    const { data: hapus } = await owner.from("digital_product_prices")
      .delete().eq("product_id", produk!.id).select("id");
    expect(hapus ?? []).toEqual([]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-harga-publik.test.ts`
Expected: FAIL — `harga_produk_publik` belum ada.

- [ ] **Step 3: Tulis migration harga**

Buat `web/supabase/migrations/20260921110000_produk_harga.sql`:

```sql
-- ===========================================================================
-- HARGA PRODUK DIGITAL — riwayat, bukan satu baris yang ditimpa
-- ===========================================================================
-- Polanya disalin UTUH dari `variant_rates`: append-only untuk peran API,
-- UPDATE ditolak seluruhnya, DELETE dicabut. Alasannya sama persis — nota
-- yang sudah terbit tidak boleh berubah karena harga hari ini berubah.
create table public.digital_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.digital_products(id) on delete cascade,

  -- 0 = produk gratis. Bukan NULL: NULL berarti "belum ditetapkan", dan dua
  -- keadaan itu tidak boleh dikira satu.
  harga int not null check (harga >= 0),

  -- Angka PEMASARAN: harga sebelum diskon, dipajang tercoret. Opsional.
  harga_coret int check (harga_coret is null or harga_coret > harga),

  berlaku_sejak date not null default (now() at time zone 'Asia/Jakarta')::date,
  created_at timestamptz not null default now(),
  unique (product_id, berlaku_sejak)
);

comment on table public.digital_product_prices is
  'Riwayat harga produk digital. APPEND-ONLY untuk peran API: UPDATE ditolak '
  'seluruhnya, DELETE dicabut. harga = 0 berarti GRATIS, bukan belum '
  'ditetapkan. Dipajang publik lewat harga_produk_publik; daftar kolomnya '
  'dikunci di tests/produk-harga-publik.test.ts.';

alter table public.digital_product_prices enable row level security;

-- Hanya OWNER yang boleh menetapkan harga — pola yang sama dengan
-- `variant_rates`. Admin melihat lewat view `produk_harga_staf`, tidak pernah
-- menyentuh tabel ini.
create policy "harga produk: owner sisip" on public.digital_product_prices for insert
  with check (public.user_role() = 'owner');

create policy "harga produk: owner baca" on public.digital_product_prices for select
  using (public.user_role() = 'owner');

-- TIDAK ADA policy update maupun delete. Ketiadaan policy ITULAH pagarnya:
-- RLS menolak verba yang tidak punya policy, dan penolakannya senyap (0 baris),
-- bukan galat — karena itu uji memeriksa JUMLAH BARIS terdampak, bukan error.

revoke update, delete on public.digital_product_prices from anon, authenticated;

-- ===== VIEW PUBLIK =====
-- `security_invoker = off` disengaja: view INILAH batas kolomnya, dan anon
-- memang tidak punya hak baca atas tabel dasarnya.
create view public.harga_produk_publik with (security_invoker = off) as
  select distinct on (product_id)
         product_id, harga, harga_coret, berlaku_sejak
    from public.digital_product_prices
   where berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date
   order by product_id, berlaku_sejak desc;

-- DICABUT DULU dari ketiga peran, baru diberi hak yang tepat. Supabase
-- memberi hak PENUH bawaan atas setiap objek baru di skema public — termasuk
-- VIEW — kepada anon maupun authenticated; `grant` di bawah MENAMBAH, bukan
-- MENGGANTIKAN, jadi verba tulis bawaannya tetap menempel bila tidak dicabut
-- lebih dulu. `public` ikut dicabut karena view sederhana meneruskan tulisan
-- ke tabel dasarnya.
revoke all on public.harga_produk_publik from public, anon, authenticated;
grant select on public.harga_produk_publik to anon, authenticated;

comment on view public.harga_produk_publik is
  'Harga berlaku per produk untuk etalase & landing. Empat kolom, dikunci '
  'sebagai assertion di tests/produk-harga-publik.test.ts. Tidak ada honor '
  'mitra di sini — produk digital memang tidak punya.';

-- ===== VIEW STAF =====
-- Predikat peran ADA DI DALAM view, bukan hanya di GRANT: admin, owner, dan
-- klien login sebagai SATU peran SQL yang sama (`authenticated`), jadi grant
-- saja bukan batas peran. `user_role()` tetap membaca identitas PEMANGGIL
-- walau view berjalan dengan hak pemilik — `security_invoker = off`
-- membebaskan AKSES TABEL, bukan identitas sesi.
create view public.produk_harga_staf with (security_invoker = off) as
  select distinct on (product_id)
         product_id, harga, harga_coret, berlaku_sejak
    from public.digital_product_prices
   where public.user_role() in ('admin','owner')
   order by product_id, berlaku_sejak desc;

revoke all on public.produk_harga_staf from public, anon, authenticated;
grant select on public.produk_harga_staf to authenticated;

comment on view public.produk_harga_staf is
  'Harga TERAKHIR per produk untuk panel staf — termasuk yang belum berlaku, '
  'supaya admin melihat harga yang sudah dijadwalkan owner. Predikat '
  'user_role() di dalam view adalah pagar perannya.';
```

- [ ] **Step 4: Lebarkan money firewall SADAR**

Di `web/tests/money-firewall-struktural.test.ts`, tambahkan `"digital_product_prices"` ke `TABEL_UANG` dan dua entri ke `KOLOM_UANG_VIEW_DIIZINKAN`:

```ts
const TABEL_UANG = new Set([
  "variant_rates", "honor_marks", "transport_rates", "transport_khusus",
  // Produk digital (spec "produk-digital" §Money firewall). Ditambahkan
  // SADAR, dengan pagar yang sama persis dengan `variant_rates`: append-only,
  // UPDATE ditolak seluruhnya, DELETE dicabut, dan harga keluar hanya lewat
  // dua view berkolom sempit. Tidak ada honor mitra pada produk digital, jadi
  // yang bisa keluar dari sini hanyalah harga yang memang diputuskan publik.
  "digital_product_prices",
]);

const KOLOM_UANG_VIEW_DIIZINKAN = new Map<string, Set<string>>([
  ["harga_publik", new Set(["harga_klien", "harga_coret"])],
  ["varian_harga_staf", new Set(["harga_klien", "harga_coret"])],
  ["harga_produk_publik", new Set(["harga", "harga_coret"])],
  ["produk_harga_staf", new Set(["harga", "harga_coret"])],
]);
```

Sesuaikan entri `varian_harga_staf` dengan isi yang sudah ada di berkas itu — baca dulu, jangan timpa buta.

- [ ] **Step 5: Jalankan kedua uji**

Run: `cd web && npx supabase db reset && npx vitest run tests/produk-harga-publik.test.ts tests/money-firewall-struktural.test.ts tests/harga-publik.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
cd web && git add supabase/migrations/20260921110000_produk_harga.sql tests/produk-harga-publik.test.ts tests/money-firewall-struktural.test.ts
git commit -m "feat(produk): harga append-only + dua view sempit

Money firewall dilebarkan SADAR, bukan dikecualikan: pagarnya sama
persis dengan variant_rates, dan daftar kolom kedua view dikunci
sebagai assertion.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Entitlement — satu-satunya sumber kebenaran akses

**Files:**
- Create: `web/supabase/migrations/20260921120000_produk_entitlement.sql`
- Create: `web/tests/produk-entitlement-db.test.ts`

**Interfaces:**
- Consumes: `digital_products`, `digital_product_files`, `digital_product_pages` (Task 1); `clients`.
- Produces: tabel `public.digital_entitlements` (`id`, `client_id`, `product_id`, `sumber`, `diberikan_pada`, `dicabut_pada`), enum `public.entitlement_source` (`beli`|`gratis`|`pemberian_admin`), fungsi `public.punya_produk(uuid)` → boolean.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/produk-entitlement-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signInAs } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Gerbang isi produk diuji dengan SESI KLIEN SUNGGUHAN, bukan service role.
 *
 * Alasannya sudah mahal sekali di repo ini: embed yang ditolak RLS memulangkan
 * `null`, BUKAN galat. Uji ber-service-role menembus seluruh RLS dan karena
 * itu buta sepenuhnya terhadap gerbang yang mati — fiturnya hijau di CI dan
 * kosong di produksi.
 */
describe("digital_entitlements sebagai gerbang isi", () => {
  let produkId: string;
  let clientId: string;

  beforeAll(async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Produk gerbang", slug: "produk-gerbang-uji", jenis: "pdf", aktif: true })
      .select("id").single();
    produkId = produk!.id;
    await svc.from("digital_product_pages")
      .insert({ product_id: produkId, halaman: 1, objek: `${produkId}/1.webp` });

    const klien = await signInAs("klien@padma.test");
    const { data: user } = await klien.auth.getUser();
    const { data: baris } = await svc.from("clients")
      .select("id").eq("user_id", user.user!.id).single();
    clientId = baris!.id;
  });

  afterAll(async () => {
    await createAdminSupabase().from("digital_products").delete().eq("id", produkId);
  });

  it("tanpa entitlement, klien tidak melihat satu halaman pun", async () => {
    const klien = await signInAs("klien@padma.test");
    const { data, error } = await klien.from("digital_product_pages")
      .select("objek").eq("product_id", produkId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("dengan entitlement, halaman terbaca", async () => {
    const svc = createAdminSupabase();
    await svc.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "gratis" });

    const klien = await signInAs("klien@padma.test");
    const { data } = await klien.from("digital_product_pages")
      .select("objek").eq("product_id", produkId);
    expect((data ?? []).length).toBe(1);
  });

  it("entitlement yang DICABUT menutup kembali gerbangnya", async () => {
    const svc = createAdminSupabase();
    await svc.from("digital_entitlements")
      .update({ dicabut_pada: new Date().toISOString() })
      .eq("client_id", clientId).eq("product_id", produkId);

    const klien = await signInAs("klien@padma.test");
    const { data } = await klien.from("digital_product_pages")
      .select("objek").eq("product_id", produkId);
    expect(data).toEqual([]);

    await svc.from("digital_entitlements").delete()
      .eq("client_id", clientId).eq("product_id", produkId);
  });

  it("satu klien tidak bisa punya dua entitlement untuk produk yang sama", async () => {
    const svc = createAdminSupabase();
    await svc.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "gratis" });
    const { error } = await svc.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "beli" }).select("id");
    expect(error?.code).toBe("23505");
    await svc.from("digital_entitlements").delete()
      .eq("client_id", clientId).eq("product_id", produkId);
  });

  it("klien tidak bisa menerbitkan entitlement untuk dirinya sendiri", async () => {
    const klien = await signInAs("klien@padma.test");
    const { data, error } = await klien.from("digital_entitlements")
      .insert({ client_id: clientId, product_id: produkId, sumber: "beli" }).select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("klien tidak melihat entitlement milik klien lain", async () => {
    const svc = createAdminSupabase();
    const { data: lain } = await svc.from("clients")
      .select("id").neq("id", clientId).limit(1).single();
    await svc.from("digital_entitlements")
      .insert({ client_id: lain!.id, product_id: produkId, sumber: "gratis" });

    const klien = await signInAs("klien@padma.test");
    const { data } = await klien.from("digital_entitlements")
      .select("id").eq("product_id", produkId);
    expect(data).toEqual([]);

    await svc.from("digital_entitlements").delete()
      .eq("client_id", lain!.id).eq("product_id", produkId);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-entitlement-db.test.ts`
Expected: FAIL — `digital_entitlements` belum ada.

- [ ] **Step 3: Tulis migration**

Buat `web/supabase/migrations/20260921120000_produk_entitlement.sql`:

```sql
-- ===========================================================================
-- ENTITLEMENT — satu-satunya sumber kebenaran "boleh akses"
-- ===========================================================================
-- Setiap gerbang isi (tonton, baca, unduh) membaca TABEL INI, dan tidak
-- pernah membaca pesanan. Pesanan menjawab "apa yang terjadi"; entitlement
-- menjawab "apa yang boleh dibuka" — dan gerbang hanya butuh yang kedua.
-- Tahap 2 (Midtrans) akan MENULIS ke tabel ini; tidak satu pun gerbang perlu
-- berubah saat itu.
create type public.entitlement_source as enum ('beli', 'gratis', 'pemberian_admin');

create table public.digital_entitlements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.digital_products(id) on delete cascade,
  sumber public.entitlement_source not null,
  diberikan_pada timestamptz not null default now(),

  -- PENCABUTAN, bukan penghapusan: barisnya tetap berdiri sebagai jejak bahwa
  -- akses ini pernah ada dan siapa yang pernah memegangnya.
  dicabut_pada timestamptz,

  -- Inilah yang kelak membuat webhook Midtrans idempoten tanpa kode tambahan:
  -- notifikasi kembar tidak bisa menggandakan apa pun.
  unique (client_id, product_id)
);

comment on table public.digital_entitlements is
  'Kepemilikan produk digital. SATU-SATUNYA sumber kebenaran akses — setiap '
  'gerbang isi membaca tabel ini, tidak pernah membaca pesanan. Pencabutan '
  'ditulis sebagai dicabut_pada, bukan penghapusan baris.';

create index digital_entitlements_klien_idx
  on public.digital_entitlements (client_id, diberikan_pada desc);

alter table public.digital_entitlements enable row level security;

create policy "entitlement: staf" on public.digital_entitlements for all
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Klien hanya MEMBACA miliknya. Tidak ada policy tulis untuk klien: akses
-- bukan sesuatu yang diterbitkan sendiri oleh penerimanya. Jalur gratis
-- menulis lewat RPC security definer di bawah, yang memilih client_id-nya
-- SENDIRI dari auth.uid() alih-alih memercayai payload.
create policy "entitlement: klien baca miliknya" on public.digital_entitlements for select
  using (exists (
    select 1 from public.clients c
     where c.id = digital_entitlements.client_id and c.user_id = auth.uid()
  ));

-- ===== PREDIKAT BERSAMA =====
-- Satu definisi "boleh akses", dipakai policy isi di bawah. Ditulis sebagai
-- fungsi supaya kalimatnya hidup di SATU tempat: tiga policy yang menyalin
-- predikat yang sama adalah tiga tempat yang bisa berbeda saat salah satunya
-- disunting.
create or replace function public.punya_produk(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.digital_entitlements e
      join public.clients c on c.id = e.client_id
     where e.product_id = p_product_id
       and c.user_id = auth.uid()
       and e.dicabut_pada is null
  );
$$;

comment on function public.punya_produk(uuid) is
  'Satu definisi "boleh akses produk ini": ada entitlement milik pemanggil '
  'yang belum dicabut. Dipakai policy isi produk.';

-- ===== POLICY ISI, kini bisa ditulis =====
create policy "berkas produk: pemilik baca" on public.digital_product_files for select
  using (public.punya_produk(product_id));

create policy "halaman produk: pemilik baca" on public.digital_product_pages for select
  using (public.punya_produk(product_id));
```

- [ ] **Step 4: Jalankan uji**

Run: `cd web && npx supabase db reset && npx vitest run tests/produk-entitlement-db.test.ts`
Expected: PASS, tujuh uji hijau.

- [ ] **Step 5: Commit**

```bash
cd web && git add supabase/migrations/20260921120000_produk_entitlement.sql tests/produk-entitlement-db.test.ts
git commit -m "feat(produk): entitlement sebagai gerbang isi

Satu predikat (punya_produk) dipakai seluruh policy isi. Diuji dengan
sesi klien sungguhan: embed yang ditolak RLS memulangkan null, dan uji
ber-service-role buta terhadapnya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Validator murni modul produk

**Files:**
- Create: `web/src/lib/produk/status.ts`
- Create: `web/tests/produk-status.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `type JenisProduk = "video" | "pdf"`; `JENIS_SAH: JenisProduk[]`; `LABEL_JENIS: Record<JenisProduk, string>`; `type Periksa<T> = { ok: true; nilai: T } | { ok: false; pesan: string }`; `periksaJudul(teks: string): Periksa<string>`; `slugDariJudul(judul: string): string`; `periksaSlug(teks: string): Periksa<string>`; `periksaJenis(teks: string): Periksa<JenisProduk>`; `periksaHarga(teks: string): Periksa<number>`; `periksaHargaCoretProduk(teks: string, harga: number): Periksa<number | null>`; konstanta `PANJANG_JUDUL_MINIMAL = 2`, `PANJANG_JUDUL_MAKS = 120`, `PANJANG_DESKRIPSI_MAKS = 2000`, `HARGA_MAKS = 50_000_000`; `PESAN_PRODUK: Record<string, string>`.

Berkas ini **bukan** modul server action: ia diimpor client component, dan direktif `"use server"` akan mengubah setiap konstanta menjadi rujukan jaringan. Pola yang sama dengan `src/app/admin/materi/status.ts` dan `src/app/owner/tarif/status.ts` — bedanya ia tinggal di `lib/` karena dipakai oleh panel admin **dan** panel owner **dan** etalase publik.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/produk-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  periksaJudul, slugDariJudul, periksaSlug, periksaJenis,
  periksaHarga, periksaHargaCoretProduk, PESAN_PRODUK,
} from "@/lib/produk/status";

describe("periksaJudul", () => {
  it("menolak judul terlalu pendek", () => {
    expect(periksaJudul("a")).toEqual({ ok: false, pesan: PESAN_PRODUK.judulPendek });
  });
  it("memangkas spasi tepi", () => {
    expect(periksaJudul("  Panduan Menyusui  ")).toEqual({ ok: true, nilai: "Panduan Menyusui" });
  });
  it("menolak judul melebihi 120 karakter", () => {
    expect(periksaJudul("x".repeat(121)).ok).toBe(false);
  });
});

describe("slugDariJudul", () => {
  it("mengubah judul jadi alamat yang aman", () => {
    expect(slugDariJudul("Panduan Menyusui Eksklusif")).toBe("panduan-menyusui-eksklusif");
  });
  it("membuang tanda baca dan merapatkan tanda hubung beruntun", () => {
    expect(slugDariJudul("E-Book: Nifas & Pemulihan!")).toBe("e-book-nifas-pemulihan");
  });
  it("membuang tanda hubung di tepi", () => {
    expect(slugDariJudul("— Yoga Hamil —")).toBe("yoga-hamil");
  });
  it("judul tanpa satu pun huruf/angka memulangkan string kosong, bukan tanda hubung", () => {
    expect(slugDariJudul("!!!")).toBe("");
  });
});

describe("periksaSlug", () => {
  it("menolak slug kosong", () => {
    expect(periksaSlug("").ok).toBe(false);
  });
  it("menolak huruf besar dan spasi", () => {
    expect(periksaSlug("Yoga Hamil").ok).toBe(false);
  });
  it("menerima slug yang sah", () => {
    expect(periksaSlug("yoga-hamil")).toEqual({ ok: true, nilai: "yoga-hamil" });
  });
});

describe("periksaJenis", () => {
  it("menolak jenis di luar daftar putih", () => {
    expect(periksaJenis("audio").ok).toBe(false);
  });
  it("menerima pdf", () => {
    expect(periksaJenis("pdf")).toEqual({ ok: true, nilai: "pdf" });
  });
});

describe("periksaHarga", () => {
  it("menerima nol sebagai GRATIS, bukan sebagai kosong", () => {
    expect(periksaHarga("0")).toEqual({ ok: true, nilai: 0 });
  });
  it("menolak medan kosong — gratis harus diketik 0 secara sadar", () => {
    expect(periksaHarga("")).toEqual({ ok: false, pesan: PESAN_PRODUK.hargaWajib });
  });
  it("menolak angka negatif", () => {
    expect(periksaHarga("-1").ok).toBe(false);
  });
  it("menolak pecahan — rupiah PADMA selalu bulat", () => {
    expect(periksaHarga("1000.5").ok).toBe(false);
  });
  it("menolak teks bukan angka", () => {
    expect(periksaHarga("gratis").ok).toBe(false);
  });
  it("menolak angka di atas batas wajar", () => {
    expect(periksaHarga("50000001").ok).toBe(false);
  });
});

describe("periksaHargaCoretProduk", () => {
  it("medan kosong sah dan berarti tidak ada coret", () => {
    expect(periksaHargaCoretProduk("", 100_000)).toEqual({ ok: true, nilai: null });
  });
  it("menolak coret yang lebih murah dari harga jual", () => {
    expect(periksaHargaCoretProduk("50000", 100_000))
      .toEqual({ ok: false, pesan: PESAN_PRODUK.coretLebihMurah });
  });
  it("menolak coret yang SAMA dengan harga jual — badge diskon nol rupiah", () => {
    expect(periksaHargaCoretProduk("100000", 100_000).ok).toBe(false);
  });
  it("menerima coret yang lebih mahal", () => {
    expect(periksaHargaCoretProduk("150000", 100_000)).toEqual({ ok: true, nilai: 150_000 });
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-status.test.ts`
Expected: FAIL — modul `@/lib/produk/status` belum ada.

- [ ] **Step 3: Tulis implementasi minimal**

Buat `web/src/lib/produk/status.ts`:

```ts
/**
 * Daftar putih, label, dan validator murni modul Produk Digital.
 *
 * TANPA `"use server"` dan tanpa impor server-only: berkas ini diimpor client
 * component (formulir admin & owner) SEKALIGUS server action dan halaman
 * publik. Direktif server action akan mengubah setiap konstanta di bawah
 * menjadi rujukan jaringan — pola yang sama sudah dijelaskan di
 * `src/app/admin/materi/status.ts`.
 */

export type JenisProduk = "video" | "pdf";

export const JENIS_SAH: JenisProduk[] = ["video", "pdf"];

export const LABEL_JENIS: Record<JenisProduk, string> = {
  video: "Video",
  pdf: "PDF",
};

export type Periksa<T> = { ok: true; nilai: T } | { ok: false; pesan: string };

export const PANJANG_JUDUL_MINIMAL = 2;
export const PANJANG_JUDUL_MAKS = 120;
export const PANJANG_DESKRIPSI_MAKS = 2000;

/**
 * Batas atas harga. Bukan kesopanan: satu salah ketik nol membuat produk
 * Rp 990.000 terpajang Rp 990.000.000, dan tidak ada yang menahannya selain
 * angka ini.
 */
export const HARGA_MAKS = 50_000_000;

export const PESAN_PRODUK = {
  judulPendek: `Judul minimal ${PANJANG_JUDUL_MINIMAL} karakter.`,
  judulPanjang: `Judul maksimal ${PANJANG_JUDUL_MAKS} karakter.`,
  slugWajib: "Alamat produk tidak boleh kosong.",
  slugTidakSah: "Alamat produk hanya boleh huruf kecil, angka, dan tanda hubung.",
  jenisTidakSah: "Jenis produk harus Video atau PDF.",
  hargaWajib: "Harga wajib diisi. Produk gratis diisi 0.",
  hargaTidakSah: "Harga harus bilangan bulat rupiah, tanpa titik atau koma.",
  hargaTerlaluBesar: `Harga maksimal Rp ${HARGA_MAKS.toLocaleString("id-ID")}.`,
  coretTidakSah: "Harga coret harus bilangan bulat rupiah.",
  coretLebihMurah:
    "Harga coret tidak boleh lebih murah atau sama dengan harga jual — itu terbaca sebagai kenaikan harga, bukan diskon.",
} as const;

export function periksaJudul(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi.length < PANJANG_JUDUL_MINIMAL) return { ok: false, pesan: PESAN_PRODUK.judulPendek };
  if (rapi.length > PANJANG_JUDUL_MAKS) return { ok: false, pesan: PESAN_PRODUK.judulPanjang };
  return { ok: true, nilai: rapi };
}

/**
 * Judul → alamat publik.
 *
 * Memulangkan string KOSONG bila judulnya tidak menyisakan satu pun huruf
 * atau angka, bukan "-" atau "". Slug "-" lolos regex yang lebih longgar dan
 * melahirkan alamat `/produk/-` yang tidak bisa dibaca siapa pun; string
 * kosong sebaliknya ditolak `periksaSlug` dengan kalimat yang jelas.
 */
export function slugDariJudul(judul: string): string {
  return judul
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function periksaSlug(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: false, pesan: PESAN_PRODUK.slugWajib };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rapi)) {
    return { ok: false, pesan: PESAN_PRODUK.slugTidakSah };
  }
  return { ok: true, nilai: rapi };
}

export function periksaJenis(teks: string): Periksa<JenisProduk> {
  if (!(JENIS_SAH as string[]).includes(teks)) {
    return { ok: false, pesan: PESAN_PRODUK.jenisTidakSah };
  }
  return { ok: true, nilai: teks as JenisProduk };
}

/**
 * Harga. Medan KOSONG ditolak, dan itu disengaja: "gratis" dan "belum
 * ditetapkan" adalah dua keadaan berbeda, dan medan yang lupa diisi tidak
 * boleh diam-diam menjadi produk gratis.
 */
export function periksaHarga(teks: string): Periksa<number> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: false, pesan: PESAN_PRODUK.hargaWajib };
  if (!/^\d+$/.test(rapi)) return { ok: false, pesan: PESAN_PRODUK.hargaTidakSah };
  const nilai = Number(rapi);
  if (!Number.isSafeInteger(nilai)) return { ok: false, pesan: PESAN_PRODUK.hargaTidakSah };
  if (nilai > HARGA_MAKS) return { ok: false, pesan: PESAN_PRODUK.hargaTerlaluBesar };
  return { ok: true, nilai };
}

/**
 * Harga coret adalah angka PEMASARAN: harga sebelum diskon. Kosong = tidak ada
 * coret. Yang tidak sah adalah coret yang lebih murah ATAU SAMA — yang pertama
 * terbaca sebagai kenaikan harga, yang kedua memajang badge diskon nol rupiah.
 */
export function periksaHargaCoretProduk(teks: string, harga: number): Periksa<number | null> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: true, nilai: null };
  if (!/^\d+$/.test(rapi)) return { ok: false, pesan: PESAN_PRODUK.coretTidakSah };
  const nilai = Number(rapi);
  if (!Number.isSafeInteger(nilai)) return { ok: false, pesan: PESAN_PRODUK.coretTidakSah };
  if (nilai > HARGA_MAKS) return { ok: false, pesan: PESAN_PRODUK.hargaTerlaluBesar };
  if (nilai <= harga) return { ok: false, pesan: PESAN_PRODUK.coretLebihMurah };
  return { ok: true, nilai };
}
```

- [ ] **Step 4: Jalankan uji, pastikan LULUS**

Run: `cd web && npx vitest run tests/produk-status.test.ts`
Expected: PASS, seluruh uji hijau.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/lib/produk/status.ts tests/produk-status.test.ts
git commit -m "feat(produk): validator murni modul produk digital

Medan harga kosong DITOLAK: 'gratis' dan 'belum ditetapkan' adalah dua
keadaan berbeda. Coret yang sama dengan harga jual juga ditolak — badge
diskon nol rupiah.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Master produk di panel admin (daftar + buat + ubah)

**Files:**
- Create: `web/src/lib/admin/produk-admin.ts`
- Create: `web/src/app/admin/produk/page.tsx`
- Create: `web/src/app/admin/produk/aksi.ts`
- Create: `web/src/app/admin/produk/form-produk.tsx`
- Create: `web/src/app/admin/produk/baru/page.tsx`
- Modify: `web/README.md` (tabel rute — dua baris baru)
- Modify: `web/src/app/admin/_shell/` navigasi panel (tambah butir "Produk Digital"; baca berkas navigasinya dulu untuk nama komponen yang benar)
- Create: `web/tests/admin-produk.test.ts`

**Interfaces:**
- Consumes: `periksaJudul`, `periksaSlug`, `periksaJenis`, `slugDariJudul`, `LABEL_JENIS`, `JENIS_SAH`, `PESAN_PRODUK` dari `@/lib/produk/status` (Task 4); tabel Task 1.
- Produces: `type ProdukKelola = { id: string; judul: string; slug: string; deskripsi: string; jenis: JenisProduk; bolehUnduh: boolean; aktif: boolean; urutan: number; adaIsi: boolean; harga: number | null; hargaCoret: number | null }`; `ambilDaftarProduk(param): Promise<{ baris: ProdukKelola[]; total: number }>`; `ambilProduk(id: string): Promise<ProdukKelola | null>`; `SARING_PRODUK`; server action `simpanProduk(formData: FormData)`, `perbaruiProduk(id: string, formData: FormData)`, `aktifkanProduk(id: string)`, `nonaktifkanProduk(id: string)`.

- [ ] **Step 1: Baca pola yang ditiru**

Baca ketiga berkas ini sebelum menulis apa pun — halaman, aksi, dan lib daftar modul produk harus **sebentuk** dengannya, termasuk `uraikanParamDaftar`, `BilahDaftar`, `Paginasi`, `Tabel/Th/Td`, dan `Bantuan`:

- `web/src/app/admin/materi/page.tsx`
- `web/src/app/admin/materi/aksi.ts`
- `web/src/lib/admin/materi-admin.ts`

- [ ] **Step 2: Tulis uji yang gagal**

Buat `web/tests/admin-produk.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { slugDariJudul } from "@/lib/produk/status";

const AKAR = path.resolve(__dirname, "..");
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

describe("master produk admin", () => {
  it("rute baru terdaftar di tabel rute README", () => {
    const readme = readFileSync(path.join(AKAR, "README.md"), "utf8");
    expect(readme).toContain("| `/admin/produk` |");
    expect(readme).toContain("| `/admin/produk/baru` |");
  });

  it("aksi produk tidak memakai service role", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/admin/produk/aksi.ts"), "utf8");
    expect(sumber).not.toContain("createAdminSupabase");
  });

  it("setiap server action memanggil requireRole", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/admin/produk/aksi.ts"), "utf8");
    const jumlahAction = (sumber.match(/^export async function /gm) ?? []).length;
    const jumlahGerbang = (sumber.match(/requireRole\(/g) ?? []).length;
    expect(jumlahGerbang).toBeGreaterThanOrEqual(jumlahAction);
  });

  it("admin bisa membuat produk, dan produknya lahir nonaktif", async () => {
    const admin = await signInAs("admin@padma.test");
    const slug = slugDariJudul("Uji Buat Produk");
    const { data, error } = await admin.from("digital_products")
      .insert({ judul: "Uji Buat Produk", slug, jenis: "pdf" })
      .select("id, aktif, boleh_unduh").single();
    expect(error).toBeNull();
    expect(data!.aktif).toBe(false);
    expect(data!.boleh_unduh).toBe(false);
    bersihkan.push(data!.id);
  });

  it("admin TIDAK bisa menetapkan harga", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji harga admin", slug: "uji-harga-admin", jenis: "pdf" })
      .select("id").single();
    bersihkan.push(produk!.id);

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 10_000 }).select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("admin MELIHAT harga lewat view staf", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji lihat harga", slug: "uji-lihat-harga", jenis: "pdf" })
      .select("id").single();
    bersihkan.push(produk!.id);
    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 75_000, harga_coret: 99_000 });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("produk_harga_staf")
      .select("harga, harga_coret").eq("product_id", produk!.id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ harga: 75_000, harga_coret: 99_000 });
  });

  it("klien tidak melihat apa pun di view harga staf", async () => {
    const klien = await signInAs("klien@padma.test");
    const { data } = await klien.from("produk_harga_staf").select("harga").limit(1);
    expect(data ?? []).toEqual([]);
  });
});
```

- [ ] **Step 3: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/admin-produk.test.ts`
Expected: FAIL — README belum memuat rute, `src/app/admin/produk/aksi.ts` belum ada.

- [ ] **Step 4: Tulis `lib/admin/produk-admin.ts`**

Pembacaan daftar & satu produk, memakai **sesi pengguna** (RLS staf yang memutuskan), dengan harga dari view `produk_harga_staf`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { JenisProduk } from "@/lib/produk/status";

export type ProdukKelola = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  jenis: JenisProduk;
  bolehUnduh: boolean;
  aktif: boolean;
  urutan: number;
  /** Ada berkas terunggah. Produk tanpa isi tidak boleh diaktifkan. */
  adaIsi: boolean;
  /** Dari view `produk_harga_staf`. null = owner belum menetapkan harga. */
  harga: number | null;
  hargaCoret: number | null;
};

export const SARING_PRODUK = {
  aktif: ["ya", "tidak"],
  jenis: ["video", "pdf"],
  isi: ["ada", "belum"],
} as const;

export async function ambilProduk(id: string): Promise<ProdukKelola | null> {
  const supabase = await createServerSupabase();

  // GALAT DIBACA, BUKAN DIBUANG: `data ?? null` menyamakan kegagalan PostgREST
  // dengan "produk tidak ada", dan kedua kalimat itu tidak bisa dibedakan di
  // layar admin.
  const { data, error } = await supabase
    .from("digital_products")
    .select("id, judul, slug, deskripsi, jenis, boleh_unduh, aktif, urutan, digital_product_files(id)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!data) return null;

  const { data: harga, error: hargaError } = await supabase
    .from("produk_harga_staf")
    .select("harga, harga_coret")
    .eq("product_id", id)
    .maybeSingle();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return {
    id: data.id,
    judul: data.judul,
    slug: data.slug,
    deskripsi: data.deskripsi,
    jenis: data.jenis as JenisProduk,
    bolehUnduh: data.boleh_unduh,
    aktif: data.aktif,
    urutan: data.urutan,
    adaIsi: (data.digital_product_files ?? []).length > 0,
    harga: harga?.harga ?? null,
    hargaCoret: harga?.harga_coret ?? null,
  };
}
```

`ambilDaftarProduk(param)` ditulis dengan bentuk yang sama seperti `ambilDaftarMateri` di `src/lib/admin/materi-admin.ts`: baca berkas itu dan tiru penanganan `uraikanParamDaftar`, pencarian, saringan, dan paginasinya persis.

- [ ] **Step 5: Tulis `src/app/admin/produk/aksi.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  periksaJudul, periksaSlug, periksaJenis, slugDariJudul,
  PANJANG_DESKRIPSI_MAKS, PESAN_PRODUK,
} from "@/lib/produk/status";

type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };
type Dibuat = { ok: true; id: string };

/**
 * TANPA service role, dan itu bukan kerapian: `tests/admin-shell.test.ts`
 * melarang kunci yang menembus seluruh RLS hidup di dalam `src/app/admin/**`.
 * Seluruh tulisan di sini lewat sesi staf sungguhan supaya jejaknya beraktor
 * nyata dan RLS-lah yang jadi hakim haknya.
 */
export async function simpanProduk(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return { ok: false, pesan: judul.pesan };

  const jenis = periksaJenis(String(formData.get("jenis") ?? ""));
  if (!jenis.ok) return { ok: false, pesan: jenis.pesan };

  // Slug diambil dari medan bila diisi, kalau tidak diturunkan dari judul.
  const mentahSlug = String(formData.get("slug") ?? "").trim();
  const slug = periksaSlug(mentahSlug || slugDariJudul(judul.nilai));
  if (!slug.ok) return { ok: false, pesan: slug.pesan };

  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  if (deskripsi.length > PANJANG_DESKRIPSI_MAKS) {
    return { ok: false, pesan: `Deskripsi maksimal ${PANJANG_DESKRIPSI_MAKS} karakter.` };
  }

  const bolehUnduh = formData.get("boleh_unduh") === "on";

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_products")
    .insert({
      judul: judul.nilai,
      slug: slug.nilai,
      deskripsi,
      jenis: jenis.nilai,
      boleh_unduh: bolehUnduh,
      // `aktif` sengaja TIDAK dikirim: default basis data (false) yang
      // berlaku. Produk tanpa berkas tidak boleh terpajang, dan berkasnya
      // baru bisa diunggah sesudah barisnya ada.
    })
    .select("id");

  if (error?.code === "23505") {
    return { ok: false, pesan: `Alamat "${slug.nilai}" sudah dipakai produk lain.` };
  }
  if (error) return { ok: false, pesan: `Produk gagal disimpan (${error.code}).` };
  // 200 + [] berarti RLS menahan barisnya tanpa melempar galat apa pun.
  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Produk tidak tersimpan — hak akses ditolak." };
  }

  revalidatePath("/admin/produk");
  return { ok: true, id: data![0].id };
}
```

Tulis juga `perbaruiProduk(id, formData)` (judul/slug/deskripsi/boleh_unduh/urutan), `aktifkanProduk(id)` dan `nonaktifkanProduk(id)` dengan bentuk yang sama. `aktifkanProduk` **menolak produk tanpa berkas**:

```ts
export async function aktifkanProduk(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Produk tanpa isi yang terpajang di etalase adalah janji yang tidak bisa
  // ditepati: pengunjung membuka halamannya dan tidak menemukan apa pun.
  const { data: berkas, error: berkasError } = await supabase
    .from("digital_product_files").select("id").eq("product_id", id);
  if (berkasError) return { ok: false, pesan: `Gagal memeriksa isi (${berkasError.code}).` };
  if ((berkas ?? []).length === 0) {
    return { ok: false, pesan: "Produk belum punya berkas — unggah isinya dulu sebelum ditayangkan." };
  }

  const { data, error } = await supabase
    .from("digital_products").update({ aktif: true }).eq("id", id).select("id");
  if (error) return { ok: false, pesan: `Gagal menayangkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Produk tidak ditemukan." };

  revalidatePath("/admin/produk");
  revalidatePath("/produk");
  return { ok: true };
}
```

- [ ] **Step 6: Tulis halaman & formulir**

`src/app/admin/produk/page.tsx` (daftar) dan `src/app/admin/produk/baru/page.tsx` (formulir halaman tersendiri, **bukan** formulir di header daftar — pola `/admin/klien/baru`), plus `form-produk.tsx` sebagai client component. Tiru `src/app/admin/materi/page.tsx` dan `src/app/admin/materi/form-materi.tsx`. Keduanya dibuka `await requireRole(["admin", "owner"])`.

Kolom tabel daftar: Judul, Jenis, Isi (ada/belum), Harga (dari view staf, `formatRupiah` dari `@/lib/rupiah-publik`), Tayang, Urutan.

- [ ] **Step 7: Daftarkan rute di README dan navigasi panel**

Tambahkan dua baris ke tabel rute `web/README.md`, sejajar dengan baris `/admin/materi`:

```
| `/admin/produk` | Admin, Owner | Master produk digital: daftar, cari, saring jenis/tayang/kelengkapan isi; harga TAMPIL tapi tidak bisa disunting admin |
| `/admin/produk/baru` | Admin, Owner | Formulir produk digital baru; lahir nonaktif sampai berkasnya terunggah |
```

Lalu tambahkan butir navigasi "Produk Digital" ke shell panel admin — baca `web/src/app/admin/_shell/` untuk menemukan berkas daftar menunya dan ikuti bentuk butir yang sudah ada.

- [ ] **Step 8: Jalankan uji**

Run: `cd web && npx vitest run tests/admin-produk.test.ts tests/inventaris-rute.test.ts tests/admin-shell.test.ts`
Expected: PASS semua.

- [ ] **Step 9: Commit**

```bash
cd web && git add src/lib/admin/produk-admin.ts src/app/admin/produk README.md tests/admin-produk.test.ts src/app/admin/_shell
git commit -m "feat(produk): master produk digital di panel admin

Admin mengelola isi, bukan angka: harga tampil lewat produk_harga_staf
tapi tabel harganya tidak bisa disentuh. Produk tanpa berkas ditolak
saat hendak ditayangkan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Detail produk + unggah berkas (video R2 & PDF terasterisasi)

**Files:**
- Create: `web/src/lib/produk/objek.ts`
- Create: `web/src/app/admin/produk/[id]/page.tsx`
- Create: `web/src/app/admin/produk/[id]/unggah.ts`
- Create: `web/src/app/admin/produk/[id]/pengunggah-produk.tsx`
- Modify: `web/README.md` (satu baris rute baru)
- Create: `web/tests/produk-objek.test.ts`
- Create: `web/tests/admin-produk-unggah.test.ts`

**Interfaces:**
- Consumes: `namaObjekHalaman`, `MAKS_HALAMAN`, `MAKS_BYTE_PDF`, `periksaBerkasPdf` dari `@/lib/materi/rasterisasi`; `MAKS_BYTE_VIDEO`, `MIME_VIDEO`, `type MimeVideo`, `ekstensiDariMime`, `periksaBerkasVideo` dari `@/lib/materi/video`; `urlUnggahVideo`, `urlTontonVideo`, `hapusObjekVideo` dari `@/lib/r2`; `ambilProduk` (Task 5).
- Produces: `namaObjekVideoProduk(productId: string, mime: MimeVideo): string` → `produk/<id>/isi.<ext>`; `namaObjekHalamanProduk(productId: string, halaman: number): string` → `<id>/<halaman>.webp`; `namaObjekPdfProduk(productId: string): string` → `<id>/isi.pdf`; server action `terbitkanUrlUnggahVideoProduk(productId, mime, byte)`, `catatVideoProduk(productId, objek, mime, byte)`, `terbitkanUrlUnggahHalamanProduk(productId, jumlahHalaman)`, `catatPdfProduk(productId, byte)`, `lepasIsiProduk(productId)`.

- [ ] **Step 1: Tulis uji penamaan objek (murni, tanpa DB)**

Buat `web/tests/produk-objek.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  namaObjekVideoProduk, namaObjekHalamanProduk, namaObjekPdfProduk,
} from "@/lib/produk/objek";

const ID = "11111111-2222-3333-4444-555555555555";

describe("penamaan objek produk", () => {
  it("video bernama dari id produk dan ekstensi turunan MIME", () => {
    expect(namaObjekVideoProduk(ID, "video/mp4")).toBe(`produk/${ID}/isi.mp4`);
    expect(namaObjekVideoProduk(ID, "video/webm")).toBe(`produk/${ID}/isi.webm`);
  });

  it("prefiks `produk/` memisahkan bucket R2 dari objek materi", () => {
    expect(namaObjekVideoProduk(ID, "video/mp4").startsWith("produk/")).toBe(true);
  });

  it("halaman PDF bernomor, di dalam folder id produk", () => {
    expect(namaObjekHalamanProduk(ID, 7)).toBe(`${ID}/7.webp`);
  });

  it("PDF utuh bernama tetap", () => {
    expect(namaObjekPdfProduk(ID)).toBe(`${ID}/isi.pdf`);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-objek.test.ts`
Expected: FAIL — modul `@/lib/produk/objek` belum ada.

- [ ] **Step 3: Tulis `src/lib/produk/objek.ts`**

```ts
import { ekstensiDariMime, type MimeVideo } from "@/lib/materi/video";

/**
 * Nama objek produk. Fungsi MURNI tanpa impor server-only — dipakai server
 * action (service role) maupun rute penyaji, dan diuji tanpa storage.
 *
 * Seluruhnya berbasis ID PRODUK, tidak pernah nama berkas kiriman: nama
 * berkas datang dari peramban dan bisa memuat `../` atau nama produk lain.
 * Id produk sudah unik, sudah dimiliki satu baris, dan tidak bisa dikarang —
 * path traversal karena itu tidak punya pintu masuk sama sekali. Alasan yang
 * sama persis sudah ditulis di `lib/bukti/kunci.ts`.
 *
 * Video menumpang bucket R2 yang SAMA dengan materi, dibedakan prefiks
 * `produk/`. Satu bucket, dua prefiks: kredensial, CORS, dan rotasi kunci
 * tidak perlu digandakan, sementara objeknya tetap tidak bisa tertukar.
 */
export function namaObjekVideoProduk(productId: string, mime: MimeVideo): string {
  const ext = ekstensiDariMime(mime);
  if (!ext) throw new Error(`MIME video tidak dikenal: ${mime}`);
  return `produk/${productId}/isi.${ext}`;
}

/** Bucket `produk-halaman` sudah memisahkan ruangnya, jadi tanpa prefiks lagi. */
export function namaObjekHalamanProduk(productId: string, halaman: number): string {
  return `${productId}/${halaman}.webp`;
}

/** Bucket `produk-berkas`: PDF utuh, sumber unduhan. */
export function namaObjekPdfProduk(productId: string): string {
  return `${productId}/isi.pdf`;
}
```

- [ ] **Step 4: Jalankan uji, pastikan LULUS**

Run: `cd web && npx vitest run tests/produk-objek.test.ts`
Expected: PASS.

- [ ] **Step 5: Tulis uji pagar unggahan**

Buat `web/tests/admin-produk-unggah.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const UNGGAH = readFileSync(path.join(AKAR, "src/app/admin/produk/[id]/unggah.ts"), "utf8");

/**
 * Unggahan adalah satu-satunya titik di modul ini yang boleh memegang service
 * role, dan justru karena itu pagarnya diperiksa sebagai TEKS SUMBER: pagar
 * perilaku ("klien tidak bisa mengunggah") tidak bisa melihat requireRole yang
 * terhapus dari satu action di antara empat.
 */
describe("pagar unggahan produk", () => {
  it("setiap server action dibuka requireRole", () => {
    const jumlahAction = (UNGGAH.match(/^export async function /gm) ?? []).length;
    const jumlahGerbang = (UNGGAH.match(/requireRole\(\[/g) ?? []).length;
    expect(jumlahAction).toBeGreaterThan(0);
    expect(jumlahGerbang).toBe(jumlahAction);
  });

  it("path objek diturunkan dari helper, tidak pernah dari parameter berkas", () => {
    expect(UNGGAH).toContain("namaObjekVideoProduk");
    expect(UNGGAH).toContain("namaObjekHalamanProduk");
    // Tidak ada satu pun path yang dirakit dari nama berkas kiriman browser.
    expect(UNGGAH).not.toMatch(/formData\.get\(["']nama/);
  });

  it("keberadaan produk diperiksa lewat SESI pengguna, bukan service role", () => {
    // Urutannya mengikat: `createServerSupabase` (RLS staf) muncul sebelum
    // `createAdminSupabase` (service role) — hak diputuskan basis data lebih
    // dulu, storage disentuh belakangan.
    const posisiSesi = UNGGAH.indexOf("createServerSupabase");
    const posisiService = UNGGAH.indexOf("createAdminSupabase");
    expect(posisiSesi).toBeGreaterThan(-1);
    expect(posisiService).toBeGreaterThan(posisiSesi);
  });

  it("batas ukuran dipakai ulang dari modul materi, bukan ditulis ulang", () => {
    // `periksaBerkasVideo` sudah memagari MIME DAN ukuran sekaligus. Menulis
    // ulang batasnya di sini melahirkan angka kedua yang bisa berbeda dari
    // yang dipakai pengunggah materi tanpa satu pun uji berubah merah.
    expect(UNGGAH).toContain("periksaBerkasVideo");
    expect(UNGGAH).toContain("MAKS_HALAMAN");
  });
});
```

- [ ] **Step 6: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/admin-produk-unggah.test.ts`
Expected: FAIL — berkas `unggah.ts` belum ada.

- [ ] **Step 7: Tulis `src/app/admin/produk/[id]/unggah.ts`**

Baca `web/src/app/admin/materi/unggah-video.ts` dan `web/src/app/admin/materi/unggah.ts` lebih dulu; struktur di bawah menirunya, termasuk **urutan pengosongan baris sebelum objek** yang dijelaskan panjang di berkas itu.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { urlUnggahVideo } from "@/lib/r2";
import { periksaBerkasVideo } from "@/lib/materi/video";
import { MAKS_HALAMAN, MAKS_BYTE_PDF } from "@/lib/materi/rasterisasi";
import { namaObjekVideoProduk, namaObjekHalamanProduk, namaObjekPdfProduk } from "@/lib/produk/objek";

const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";

type Gagal = { ok: false; pesan: string };
export type UnggahanHalaman = { halaman: number; objek: string; token: string };

/**
 * Berkasnya TIDAK menumpang server kita: Vercel membatasi body request 4,5 MB,
 * sementara satu video produk bisa 200 MB. Peramban admin mengunggah langsung
 * ke R2 memakai presigned PUT yang mengikat path, MIME, DAN ukuran — tanda
 * tangan yang hanya mengikat host menerima unggahan ber-MIME apa pun.
 */
export async function terbitkanUrlUnggahVideoProduk(
  productId: string,
  mime: string,
  byte: number,
): Promise<{ ok: true; url: string; objek: string } | Gagal> {
  await requireRole(["admin", "owner"]);

  // Memagari MIME DAN ukuran dalam satu panggilan, dan memulangkan MIME yang
  // sudah BERTIPE `MimeVideo` — jadi tidak ada `as MimeVideo` di bawah yang
  // menyatakan sesuatu yang belum benar-benar diperiksa.
  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  // Produk harus ada, dan pemeriksaannya lewat SESI PENGGUNA supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: produk, error } = await supabase
    .from("digital_products").select("id, jenis").eq("id", productId).maybeSingle();
  if (error) return { ok: false, pesan: `Gagal membaca produk (${error.code}).` };
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };
  if (produk.jenis !== "video") return { ok: false, pesan: "Produk ini bukan produk video." };

  const objek = namaObjekVideoProduk(productId, periksa.nilai);
  return { ok: true, url: await urlUnggahVideo(objek, periksa.nilai, byte), objek };
}

/** Dicatat SESUDAH unggahan R2 selesai; sebelum itu tidak ada baris apa pun. */
export async function catatVideoProduk(
  productId: string,
  objek: string,
  mime: string,
  byte: number,
): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);

  // MIME divalidasi ULANG di sini, tidak dipercaya begitu saja: action ini
  // adalah endpoint POST tersendiri, dan pemanggilnya tidak harus action
  // penerbit URL di atas.
  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  // Objek yang dicatat WAJIB objek yang kita sendiri namai untuk produk ini —
  // browser mengirimkannya kembali, dan browser yang memilih path adalah
  // browser yang bisa menautkan produk ini ke berkas produk lain.
  if (objek !== namaObjekVideoProduk(productId, periksa.nilai)) {
    return { ok: false, pesan: "Nama objek tidak sah." };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_files")
    .upsert({ product_id: productId, objek, mime, byte }, { onConflict: "product_id" })
    .select("id");
  if (error) return { ok: false, pesan: `Gagal mencatat berkas (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Berkas tidak tersimpan." };

  revalidatePath(`/admin/produk/${productId}`);
  return { ok: true };
}
```

Tulis juga `terbitkanUrlUnggahHalamanProduk(productId, jumlahHalaman)` — menerbitkan signed upload URL ke bucket `produk-halaman` untuk setiap halaman, dengan **baris dikosongkan lebih dulu, objek belakangan** (baca komentar panjang di `src/app/admin/materi/unggah.ts` untuk alasannya; urutan itu membuat kegagalan di tengah menjadi inert) — serta `catatPdfProduk(productId, byte)` yang menerbitkan signed upload URL ke bucket `produk-berkas` untuk PDF utuh, dan `lepasIsiProduk(productId)`.

- [ ] **Step 8: Tulis halaman detail & pengunggah**

`src/app/admin/produk/[id]/page.tsx` — metadata produk, keadaan isi, pengunggah sesuai `jenis`, saklar tayang, dan **daftar pembeli** (nama klien, tanggal, sumber). Tiru `src/app/admin/materi/[id]/page.tsx`.

`pengunggah-produk.tsx` — client component; untuk `pdf` gunakan pipa rasterisasi `pdfjs-dist` yang sudah dipakai `src/app/admin/materi/pengunggah-pdf.tsx` (rasterisasi di peramban, lalu unggah per halaman dengan konkurensi `KONKURENSI_UNGGAH`), ditambah unggahan PDF utuh ke `produk-berkas` bila `boleh_unduh` menyala.

- [ ] **Step 9: Daftarkan rute di README**

```
| `/admin/produk/[id]` | Admin, Owner | Detail produk digital: metadata, unggah isi (video/PDF), saklar tayang, daftar pembeli |
```

- [ ] **Step 10: Jalankan uji**

Run: `cd web && npx vitest run tests/produk-objek.test.ts tests/admin-produk-unggah.test.ts tests/inventaris-rute.test.ts tests/admin-shell.test.ts`
Expected: PASS semua.

- [ ] **Step 11: Commit**

```bash
cd web && git add src/lib/produk/objek.ts "src/app/admin/produk/[id]" README.md tests/produk-objek.test.ts tests/admin-produk-unggah.test.ts
git commit -m "feat(produk): unggah isi produk — video R2 & PDF terasterisasi

Satu bucket R2, dua prefiks: objek produk tidak bisa tertukar dengan
objek materi, tanpa menggandakan kredensial dan CORS. Path selalu
diturunkan dari id produk, tidak pernah dari nama berkas kiriman.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Harga produk di panel owner

**Files:**
- Create: `web/src/app/owner/produk/page.tsx`
- Create: `web/src/app/owner/produk/aksi.ts`
- Create: `web/src/app/owner/produk/form-harga-produk.tsx`
- Create: `web/src/lib/owner/daftar-produk.ts`
- Modify: `web/README.md` (satu baris rute baru)
- Modify: shell navigasi owner (`web/src/app/owner/_shell/`)
- Create: `web/tests/owner-produk-harga.test.ts`

**Interfaces:**
- Consumes: `periksaHarga`, `periksaHargaCoretProduk`, `PESAN_PRODUK` (Task 4); tabel `digital_product_prices` (Task 2); `hariIniJakarta` dari `@/lib/passport/waktu`; `formatRupiah` dari `@/lib/owner/rupiah`.
- Produces: server action `tetapkanHargaProduk(formData: FormData): Promise<{ ok: true } | { ok: false; pesan: string }>`; `ambilDaftarHargaProduk(param, hariIni)`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/owner-produk-harga.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

async function produkUji(slug: string): Promise<string> {
  const { data } = await createAdminSupabase().from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf" }).select("id").single();
  bersihkan.push(data!.id);
  return data!.id;
}

describe("harga produk di panel owner", () => {
  it("rute terdaftar di README", () => {
    expect(readFileSync(path.join(AKAR, "README.md"), "utf8")).toContain("| `/owner/produk` |");
  });

  it("aksi owner dibuka requireRole(['owner'])", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/owner/produk/aksi.ts"), "utf8");
    expect(sumber).toContain(`requireRole(["owner"])`);
    expect(sumber).not.toContain("createAdminSupabase");
  });

  it("owner bisa menetapkan harga, dan harganya jadi BARIS BARU", async () => {
    const id = await produkUji("uji-owner-tetapkan");
    const owner = await signInAs("owner@padma.test");

    const { error: satu } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 100_000, berlaku_sejak: "2026-01-01" });
    expect(satu).toBeNull();

    const { error: dua } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 120_000, berlaku_sejak: "2026-02-01" });
    expect(dua).toBeNull();

    const { data } = await owner.from("digital_product_prices")
      .select("harga").eq("product_id", id);
    expect((data ?? []).length).toBe(2);
  });

  it("dua harga pada tanggal berlaku yang SAMA ditolak", async () => {
    const id = await produkUji("uji-owner-kembar");
    const owner = await signInAs("owner@padma.test");
    await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 10_000, berlaku_sejak: "2026-03-01" });
    const { error } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 20_000, berlaku_sejak: "2026-03-01" }).select("id");
    expect(error?.code).toBe("23505");
  });

  it("harga 0 sah dan berarti produk gratis", async () => {
    const id = await produkUji("uji-owner-gratis");
    const owner = await signInAs("owner@padma.test");
    const { error } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 0 });
    expect(error).toBeNull();

    const { data } = await owner.from("produk_harga_staf")
      .select("harga").eq("product_id", id).single();
    expect(data!.harga).toBe(0);
  });

  it("view publik memulangkan harga TERBARU yang sudah berlaku, bukan yang pertama", async () => {
    const svc = createAdminSupabase();
    const id = await produkUji("uji-owner-terbaru");
    await svc.from("digital_products").update({ aktif: true }).eq("id", id);
    await svc.from("digital_product_prices")
      .insert({ product_id: id, harga: 100_000, berlaku_sejak: "2026-01-01" });
    await svc.from("digital_product_prices")
      .insert({ product_id: id, harga: 80_000, berlaku_sejak: "2026-02-01" });

    const owner = await signInAs("owner@padma.test");
    const { data } = await owner.from("harga_produk_publik")
      .select("harga").eq("product_id", id).single();
    expect(data!.harga).toBe(80_000);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/owner-produk-harga.test.ts`
Expected: FAIL — README dan `src/app/owner/produk/aksi.ts` belum ada.

- [ ] **Step 3: Tulis `src/app/owner/produk/aksi.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { periksaHarga, periksaHargaCoretProduk, PESAN_PRODUK } from "@/lib/produk/status";

type Hasil = { ok: true } | { ok: false; pesan: string };

/**
 * Menetapkan harga produk. BARIS BARU, selalu.
 *
 * Polanya sama dengan `tetapkanTarif` di `owner/tarif/aksi.ts`, dan alasannya
 * juga sama: harga lama tetap berdiri sebagai bukti berapa yang berlaku pada
 * hari-hari yang sudah lewat. Sejak Tahap 2, nota pesanan membekukan harganya
 * sendiri — tetapi riwayat inilah yang menjawab "kenapa nota itu berbunyi
 * begitu".
 */
export async function tetapkanHargaProduk(formData: FormData): Promise<Hasil> {
  await requireRole(["owner"]);

  const productId = String(formData.get("produk") ?? "").trim();
  if (!productId) return { ok: false, pesan: "Produk wajib dipilih." };

  const harga = periksaHarga(String(formData.get("harga") ?? ""));
  if (!harga.ok) return { ok: false, pesan: harga.pesan };

  // Dibaca SESUDAH harga tervalidasi: batasnya relatif terhadap harga jual.
  const coret = periksaHargaCoretProduk(String(formData.get("harga_coret") ?? ""), harga.nilai);
  if (!coret.ok) return { ok: false, pesan: coret.pesan };

  // Medan tanggal kosong = berlaku mulai hari ini, menurut kalender JAKARTA.
  const mentahMulai = String(formData.get("mulai") ?? "").trim();
  const mulai = mentahMulai || hariIniJakarta();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai)) {
    return { ok: false, pesan: "Tanggal berlaku tidak sah." };
  }

  const supabase = await createServerSupabase();

  // Foreign key memang menolak produk yang tidak ada, tetapi pesannya adalah
  // kode Postgres — bukan kalimat yang boleh dibaca pemiliknya. Nilai
  // bukan-UUID pun mendarat di sini (PostgREST menjawab 22P02).
  const { data: produk } = await supabase
    .from("digital_products").select("id").eq("id", productId).maybeSingle();
  if (!produk) return { ok: false, pesan: "Produk tidak dikenal." };

  // Riwayat dibaca lewat RLS owner. Perbandingan tanggal = perbandingan
  // STRING; keduanya YYYY-MM-DD sehingga urutan leksikografisnya sudah
  // kronologis, dan tidak ada objek Date yang bisa menggesernya.
  const { data: riwayat, error: riwayatError } = await supabase
    .from("digital_product_prices").select("berlaku_sejak").eq("product_id", productId);
  if (riwayatError) return { ok: false, pesan: `Gagal membaca riwayat (${riwayatError.code}).` };

  const terpakai = (riwayat ?? []).map((r) => r.berlaku_sejak as string);
  if (terpakai.includes(mulai)) {
    return { ok: false, pesan: "Sudah ada harga yang berlaku mulai tanggal itu." };
  }
  const terakhir = terpakai.reduce<string | null>((maks, t) => (maks === null || t > maks ? t : maks), null);
  if (terakhir !== null && mulai < terakhir) {
    return { ok: false, pesan: `Tanggal berlaku tidak boleh mundur dari penetapan terakhir (${terakhir}).` };
  }

  const { data, error } = await supabase
    .from("digital_product_prices")
    .insert({
      product_id: productId,
      harga: harga.nilai,
      harga_coret: coret.nilai,
      berlaku_sejak: mulai,
    })
    .select("id");

  if (error?.code === "23514") return { ok: false, pesan: PESAN_PRODUK.coretLebihMurah };
  if (error) return { ok: false, pesan: `Harga gagal disimpan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Harga tidak tersimpan — hak akses ditolak." };

  revalidatePath("/owner/produk");
  revalidatePath("/admin/produk");
  revalidatePath("/produk");
  revalidatePath("/");
  return { ok: true };
}
```

- [ ] **Step 4: Tulis halaman & formulir owner**

`src/app/owner/produk/page.tsx` — daftar produk + harga berlaku + coret + riwayat penetapan, dibuka `await requireRole(["owner"])`. `form-harga-produk.tsx` meniru `src/app/owner/tarif/form-tarif.tsx`, **termasuk** tombol bantu "isi coret = harga + Rp 20.000" dan kalimat penjelas bahwa coret opsional dan diisi manual.

Tambahkan `Bantuan` yang menyebut: harga tidak pernah ditimpa, hanya ditambah; harga 0 berarti produk gratis dan diambil tanpa pembayaran.

- [ ] **Step 5: Daftarkan rute di README dan navigasi owner**

```
| `/owner/produk` | Owner | Harga produk digital berriwayat: harga baru = BARIS BARU; harga coret opsional; harga 0 = gratis |
```

- [ ] **Step 6: Jalankan uji**

Run: `cd web && npx vitest run tests/owner-produk-harga.test.ts tests/inventaris-rute.test.ts tests/money-firewall-struktural.test.ts`
Expected: PASS semua.

- [ ] **Step 7: Commit**

```bash
cd web && git add src/app/owner/produk src/lib/owner/daftar-produk.ts README.md tests/owner-produk-harga.test.ts src/app/owner/_shell
git commit -m "feat(produk): penetapan harga produk di panel owner

Harga baru = BARIS BARU, persis seperti rate card layanan. Tanggal
berlaku tidak boleh mundur, dan harga coret yang lebih murah ditolak
di dua lapisan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Etalase publik `/produk` dan halaman produk

**Files:**
- Create: `web/src/lib/produk/katalog.ts`
- Create: `web/src/app/produk/page.tsx`
- Create: `web/src/app/produk/[slug]/page.tsx`
- Create: `web/src/app/produk/kartu-produk.tsx`
- Modify: `web/README.md` (dua baris rute baru)
- Create: `web/tests/produk-katalog.test.ts`

**Interfaces:**
- Consumes: `digital_products` + `harga_produk_publik` (Task 1 & 2); `LABEL_JENIS` (Task 4); `formatRupiah` dari `@/lib/rupiah-publik`.
- Produces: `type ProdukPublik = { id: string; judul: string; slug: string; deskripsi: string; jenis: JenisProduk; bolehUnduh: boolean; sampulObjek: string | null; harga: number | null; hargaCoret: number | null }`; `bacaProdukPublik(batas?: number): Promise<ProdukPublik[]>`; `bacaProdukPerSlug(slug: string): Promise<ProdukPublik | null>`; komponen `KartuProduk`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/produk-katalog.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { bacaProdukPublik, bacaProdukPerSlug } from "@/lib/produk/katalog";

const AKAR = path.resolve(__dirname, "..");
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

async function semaiProduk(slug: string, aktif: boolean, harga?: number, coret?: number) {
  const svc = createAdminSupabase();
  const { data } = await svc.from("digital_products")
    .insert({ judul: `Produk ${slug}`, slug, jenis: "pdf", aktif, urutan: 1 })
    .select("id").single();
  bersihkan.push(data!.id);
  if (harga !== undefined) {
    await svc.from("digital_product_prices")
      .insert({ product_id: data!.id, harga, harga_coret: coret ?? null });
  }
  return data!.id;
}

describe("katalog produk publik", () => {
  it("kedua rute etalase terdaftar di README", () => {
    const readme = readFileSync(path.join(AKAR, "README.md"), "utf8");
    expect(readme).toContain("| `/produk` |");
    expect(readme).toContain("| `/produk/[slug]` |");
  });

  it("dibaca dengan ANON KEY — bukan sesi pengguna, bukan service role", () => {
    const sumber = readFileSync(path.join(AKAR, "src/lib/produk/katalog.ts"), "utf8");
    expect(sumber).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(sumber).not.toContain("createServerSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });

  it("produk nonaktif tidak muncul di etalase", async () => {
    await semaiProduk("etalase-nonaktif", false, 50_000);
    const daftar = await bacaProdukPublik();
    expect(daftar.map((p) => p.slug)).not.toContain("etalase-nonaktif");
  });

  it("produk aktif muncul lengkap dengan harga dan coretnya", async () => {
    await semaiProduk("etalase-aktif", true, 75_000, 99_000);
    const daftar = await bacaProdukPublik();
    const produk = daftar.find((p) => p.slug === "etalase-aktif");
    expect(produk).toBeDefined();
    expect(produk!.harga).toBe(75_000);
    expect(produk!.hargaCoret).toBe(99_000);
  });

  it("produk aktif yang harganya BELUM ditetapkan tetap muncul, dengan harga null", async () => {
    await semaiProduk("etalase-tanpa-harga", true);
    const daftar = await bacaProdukPublik();
    const produk = daftar.find((p) => p.slug === "etalase-tanpa-harga");
    expect(produk).toBeDefined();
    expect(produk!.harga).toBeNull();
  });

  it("harga 0 dibedakan dari harga belum ditetapkan", async () => {
    await semaiProduk("etalase-gratis", true, 0);
    const daftar = await bacaProdukPublik();
    const produk = daftar.find((p) => p.slug === "etalase-gratis");
    expect(produk!.harga).toBe(0);
  });

  it("bacaProdukPerSlug memulangkan null untuk produk nonaktif", async () => {
    await semaiProduk("slug-nonaktif", false, 10_000);
    expect(await bacaProdukPerSlug("slug-nonaktif")).toBeNull();
  });

  it("bacaProdukPerSlug memulangkan null untuk slug yang tidak ada", async () => {
    expect(await bacaProdukPerSlug("slug-yang-tidak-pernah-ada")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-katalog.test.ts`
Expected: FAIL — `@/lib/produk/katalog` belum ada.

- [ ] **Step 3: Tulis `src/lib/produk/katalog.ts`**

```ts
import { createClient } from "@supabase/supabase-js";
import type { JenisProduk } from "@/lib/produk/status";

export type ProdukPublik = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  jenis: JenisProduk;
  bolehUnduh: boolean;
  sampulObjek: string | null;
  /** null = owner belum menetapkan harga. 0 = GRATIS. Dua keadaan berbeda. */
  harga: number | null;
  hargaCoret: number | null;
};

// Etalase dibaca dengan ANON KEY, bukan sesi pengguna — alasannya sama persis
// dengan `lib/katalog.ts`, dan ketiganya masih berlaku:
//   * `cookies()` hanya bermakna di dalam request scope; di luar itu (test,
//     prerender statis) ia melempar "called outside a request scope";
//   * membaca cookie membuat etalase publik ikut dynamic tanpa alasan —
//     isinya sama untuk semua pengunjung;
//   * service role TIDAK dipakai JUSTRU supaya policy "baca publik yang
//     aktif" benar-benar teruji: bila policy itu hilang, etalase kosong
//     tertangkap di test, bukan diam-diam kosong di produksi.
function klienPublik() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type BarisProduk = {
  id: string; judul: string; slug: string; deskripsi: string;
  jenis: JenisProduk; boleh_unduh: boolean; sampul_objek: string | null;
};
type BarisHarga = { product_id: string; harga: number; harga_coret: number | null };

function rakit(produk: BarisProduk[], harga: BarisHarga[]): ProdukPublik[] {
  const peta = new Map(harga.map((h) => [h.product_id, h]));
  return produk.map((p) => {
    const h = peta.get(p.id);
    return {
      id: p.id,
      judul: p.judul,
      slug: p.slug,
      deskripsi: p.deskripsi,
      jenis: p.jenis,
      bolehUnduh: p.boleh_unduh,
      sampulObjek: p.sampul_objek,
      // `?? null` di sini AMAN dan tidak menyembunyikan kegagalan: galat
      // query sudah dilempar di atas, jadi ketiadaan baris di sini benar-benar
      // berarti "owner belum menetapkan harga".
      harga: h?.harga ?? null,
      hargaCoret: h?.harga_coret ?? null,
    };
  });
}

export async function bacaProdukPublik(batas?: number): Promise<ProdukPublik[]> {
  const supabase = klienPublik();

  // RLS "produk: baca publik yang aktif" yang menyaring, bukan `.eq("aktif",
  // true)` di sini — filter di TypeScript akan tetap hijau seandainya
  // policy-nya hilang, dan itu persis kegagalan yang tidak boleh senyap.
  let q = supabase
    .from("digital_products")
    .select("id, judul, slug, deskripsi, jenis, boleh_unduh, sampul_objek")
    .order("urutan", { ascending: true })
    .order("created_at", { ascending: false });
  if (batas !== undefined) q = q.limit(batas);

  const { data: produk, error } = await q.returns<BarisProduk[]>();
  if (error) throw new Error(`Gagal membaca etalase produk: ${error.message}`);
  if ((produk ?? []).length === 0) return [];

  const { data: harga, error: hargaError } = await supabase
    .from("harga_produk_publik")
    .select("product_id, harga, harga_coret")
    .in("product_id", produk!.map((p) => p.id))
    .returns<BarisHarga[]>();
  // Dibaca lewat klien yang SAMA, dan galatnya dilempar: bila
  // `harga_produk_publik` kehilangan grantnya, etalase kehilangan harganya di
  // test yang sama — bukan diam-diam tampil "harga belum ditetapkan" untuk
  // seluruh katalog di produksi.
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit(produk!, harga ?? []);
}

export async function bacaProdukPerSlug(slug: string): Promise<ProdukPublik | null> {
  const supabase = klienPublik();
  const { data: produk, error } = await supabase
    .from("digital_products")
    .select("id, judul, slug, deskripsi, jenis, boleh_unduh, sampul_objek")
    .eq("slug", slug)
    .maybeSingle<BarisProduk>();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!produk) return null;

  const { data: harga, error: hargaError } = await supabase
    .from("harga_produk_publik")
    .select("product_id, harga, harga_coret")
    .eq("product_id", produk.id)
    .returns<BarisHarga[]>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit([produk], harga ?? [])[0];
}
```

- [ ] **Step 4: Tulis halaman etalase dan kartu**

`src/app/produk/page.tsx`:

```tsx
import { bacaProdukPublik } from "@/lib/produk/katalog";
import { KartuProduk } from "./kartu-produk";

// Katalog produk datang dari DB dan diubah staf lewat panel, jadi halaman ini
// tidak boleh dibekukan selamanya di waktu build — alasan yang sama persis
// dengan landing (`src/app/page.tsx`).
export const revalidate = 300;

export const metadata = { title: "Produk Digital" };

export default async function ProdukPage() {
  const produk = await bacaProdukPublik();

  return (
    <main className="bg-paper">
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h1 className="text-[28px] font-bold text-ink">Produk Digital</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
          Panduan video dan e-book PADMA yang bisa dimiliki kapan saja — tanpa
          jadwal, tanpa kunjungan.
        </p>

        {produk.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-black/10 bg-white p-8 text-center text-[15px] text-ink-soft">
            Belum ada produk yang ditayangkan.
          </p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {produk.map((p) => <KartuProduk key={p.id} produk={p} />)}
          </div>
        )}
      </section>
    </main>
  );
}
```

`src/app/produk/kartu-produk.tsx` memakai `formatRupiah` dari `@/lib/rupiah-publik` (**bukan** `@/lib/owner/rupiah` — berkas itu sendiri menandai dirinya "hanya untuk panel owner", dan pagar money-firewall memindai identifier `formatRupiah` di sumber admin/panel). Aturan tampilan harga, ketiganya berbeda:

- `harga === null` → "Harga segera diumumkan", tanpa tombol beli.
- `harga === 0` → badge **Gratis**, tombol "Ambil gratis".
- `harga > 0` → `formatRupiah(harga)`, dan bila `hargaCoret` ada, ia dirender `<s>` di sebelahnya.

`src/app/produk/[slug]/page.tsx` memanggil `bacaProdukPerSlug`, dan `notFound()` bila null. Wajib memuat kalimat kebijakan:

```tsx
<p className="mt-6 rounded-xl border border-black/10 bg-white p-4 text-[13px] text-ink-soft">
  Produk digital dikirim seketika sesudah pembayaran dan <b>tidak dapat
  dikembalikan</b>. Pastikan Anda sudah membaca keterangan di atas sebelum
  membeli.
</p>
```

- [ ] **Step 5: Daftarkan rute di README**

```
| `/produk` | Publik | Etalase produk digital: kartu bersampul, badge jenis & unduhan, harga dengan coret |
| `/produk/[slug]` | Publik | Halaman satu produk digital: deskripsi, pratinjau, harga, tombol ambil/beli, kebijakan tanpa pengembalian |
```

- [ ] **Step 6: Jalankan uji**

Run: `cd web && npx vitest run tests/produk-katalog.test.ts tests/inventaris-rute.test.ts`
Expected: PASS semua.

- [ ] **Step 7: Commit**

```bash
cd web && git add src/lib/produk/katalog.ts src/app/produk README.md tests/produk-katalog.test.ts
git commit -m "feat(produk): etalase publik dan halaman produk

Dibaca anon key supaya policy baca-publik benar-benar teruji. Tiga
keadaan harga dibedakan: belum ditetapkan, gratis, dan berbayar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Ambil gratis + halaman "Pembelian saya"

**Files:**
- Create: `web/supabase/migrations/20260921130000_ambil_produk_gratis.sql`
- Create: `web/src/app/produk/[slug]/ambil.ts`
- Create: `web/src/app/produk/[slug]/tombol-ambil.tsx`
- Create: `web/src/app/passport/produk/page.tsx`
- Create: `web/src/lib/passport/produk-saya.ts`
- Modify: `web/README.md` (satu baris rute baru)
- Create: `web/tests/produk-ambil-gratis.test.ts`

**Interfaces:**
- Consumes: `digital_entitlements`, `punya_produk` (Task 3); `bacaProdukPerSlug` (Task 8); `ambilKlien` dari `@/lib/passport/data`.
- Produces: RPC `public.ambil_produk_gratis(p_product_id uuid) returns uuid`; server action `ambilProdukGratis(slug: string): Promise<{ ok: true } | { ok: false; pesan: string }>`; `produkSaya(clientId: string): Promise<ProdukDimiliki[]>` dengan `type ProdukDimiliki = { id: string; judul: string; slug: string; jenis: JenisProduk; bolehUnduh: boolean; sumber: string; diberikanPada: string }`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/produk-ambil-gratis.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

async function semai(slug: string, harga: number, aktif = true): Promise<string> {
  const svc = createAdminSupabase();
  const { data } = await svc.from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif }).select("id").single();
  bersihkan.push(data!.id);
  await svc.from("digital_product_files")
    .insert({ product_id: data!.id, objek: `${data!.id}/isi.pdf`, mime: "application/pdf", byte: 1024 });
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga });
  return data!.id;
}

describe("ambil_produk_gratis", () => {
  it("menerbitkan entitlement untuk produk GRATIS", async () => {
    const id = await semai("gratis-sah", 0);
    const klien = await signInAs("klien@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).toBeNull();

    const { data } = await klien.from("digital_entitlements")
      .select("sumber").eq("product_id", id);
    expect((data ?? []).length).toBe(1);
    expect(data![0].sumber).toBe("gratis");
  });

  it("MENOLAK produk berbayar — ini bukan pintu belakang checkout", async () => {
    const id = await semai("berbayar-ditolak", 120_000);
    const klien = await signInAs("klien@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).not.toBeNull();

    const { data } = await klien.from("digital_entitlements")
      .select("id").eq("product_id", id);
    expect(data ?? []).toEqual([]);
  });

  it("MENOLAK produk yang belum ditayangkan", async () => {
    const id = await semai("gratis-belum-tayang", 0, false);
    const klien = await signInAs("klien@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).not.toBeNull();
  });

  it("MENOLAK produk yang harganya belum ditetapkan", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Tanpa harga", slug: "gratis-tanpa-harga", jenis: "pdf", aktif: true })
      .select("id").single();
    bersihkan.push(produk!.id);

    const klien = await signInAs("klien@padma.test");
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: produk!.id });
    expect(error).not.toBeNull();
  });

  it("dipanggil dua kali tidak menggandakan apa pun", async () => {
    const id = await semai("gratis-dua-kali", 0);
    const klien = await signInAs("klien@padma.test");
    await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    const { error } = await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).toBeNull();

    const { data } = await klien.from("digital_entitlements").select("id").eq("product_id", id);
    expect((data ?? []).length).toBe(1);
  });

  it("entitlement yang sudah DICABUT tidak dihidupkan lagi oleh pengambilan ulang", async () => {
    const svc = createAdminSupabase();
    const id = await semai("gratis-tercabut", 0);
    const klien = await signInAs("klien@padma.test");
    await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    await svc.from("digital_entitlements")
      .update({ dicabut_pada: new Date().toISOString() }).eq("product_id", id);

    await klien.rpc("ambil_produk_gratis", { p_product_id: id });
    const { data } = await klien.from("digital_entitlements")
      .select("dicabut_pada").eq("product_id", id).single();
    expect(data!.dicabut_pada).not.toBeNull();
  });

  it("pengunjung anon tidak bisa memanggilnya", async () => {
    const id = await semai("gratis-anon", 0);
    const { anonClient } = await import("./helpers/as-user");
    const { error } = await anonClient().rpc("ambil_produk_gratis", { p_product_id: id });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-ambil-gratis.test.ts`
Expected: FAIL — fungsi `ambil_produk_gratis` belum ada.

- [ ] **Step 3: Tulis migration RPC**

Buat `web/supabase/migrations/20260921130000_ambil_produk_gratis.sql`:

```sql
-- ===========================================================================
-- AMBIL PRODUK GRATIS — satu tindakan, satu transaksi
-- ===========================================================================
-- Klien tidak punya policy TULIS pada `digital_entitlements`, dan itu memang
-- disengaja: akses bukan sesuatu yang diterbitkan sendiri oleh penerimanya.
-- Fungsi ini adalah SATU-SATUNYA pintu klien menerbitkan entitlement untuk
-- dirinya, dan ia memilih client_id-nya SENDIRI dari auth.uid() alih-alih
-- memercayai payload: klien yang boleh menyebut client_id adalah klien yang
-- bisa memberi produk kepada orang lain.
--
-- KENAPA GRATISNYA DIPERIKSA DI SQL, bukan hanya di server action: server
-- action bukan satu-satunya jalan menuju RPC ini — PostgREST mengekspos
-- `rpc/ambil_produk_gratis` kepada siapa pun yang login. Pemeriksaan yang
-- hanya hidup di TypeScript adalah pemeriksaan yang bisa dilewati dengan satu
-- `curl`.
create or replace function public.ambil_produk_gratis(p_product_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga int;
  v_id uuid;
begin
  select c.id into v_client_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  -- Produk harus TAYANG. Produk yang belum ditayangkan belum punya halaman
  -- publik, dan tidak boleh bisa diambil lewat id yang bocor dari panel.
  -- Harga dibaca dari view yang SAMA dengan yang dipakai etalase, supaya
  -- "gratis menurut layar" dan "gratis menurut basis data" tidak pernah
  -- berbeda — termasuk soal tanggal berlaku.
  select h.harga into v_harga
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;

  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;
  if v_harga <> 0 then
    raise exception 'Produk ini berbayar.' using errcode = 'P0001';
  end if;

  -- `do nothing`, bukan `do update`: pengambilan ulang tidak boleh
  -- menghidupkan kembali entitlement yang sudah DICABUT admin. Yang kedua
  -- kalinya karena itu tidak melakukan apa pun, dan tidak melempar apa pun —
  -- "sudah punya" bukan kesalahan.
  insert into public.digital_entitlements (client_id, product_id, sumber)
  values (v_client_id, p_product_id, 'gratis')
  on conflict (client_id, product_id) do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id from public.digital_entitlements e
     where e.client_id = v_client_id and e.product_id = p_product_id;
  end if;

  return v_id;
end;
$$;

comment on function public.ambil_produk_gratis(uuid) is
  'Satu-satunya pintu klien menerbitkan entitlement untuk dirinya sendiri. '
  'client_id diambil dari auth.uid(), TIDAK dari payload. Gratisnya diperiksa '
  'di SQL karena PostgREST mengekspos RPC ini ke semua user login. '
  'on conflict do nothing: pengambilan ulang tidak menghidupkan entitlement '
  'yang sudah dicabut.';

-- Anon tidak pernah boleh memanggilnya: "harus login untuk membeli" berlaku
-- juga untuk yang gratis, karena daftar pengambilnya itulah yang diminta.
revoke all on function public.ambil_produk_gratis(uuid) from public, anon;
grant execute on function public.ambil_produk_gratis(uuid) to authenticated;
```

- [ ] **Step 4: Jalankan uji, pastikan LULUS**

Run: `cd web && npx supabase db reset && npx vitest run tests/produk-ambil-gratis.test.ts`
Expected: PASS, tujuh uji hijau.

- [ ] **Step 5: Tulis server action, tombol, dan halaman "Pembelian saya"**

`src/app/produk/[slug]/ambil.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { bacaProdukPerSlug } from "@/lib/produk/katalog";

type Hasil = { ok: true } | { ok: false; pesan: string };

/**
 * TIDAK memakai requireRole: produk gratis diambil oleh KLIEN, dan klien
 * adalah peran bawaan setiap akun. Yang dituntut di sini adalah "ada sesi",
 * dan sisanya — produknya tayang, harganya nol, client_id-nya siapa —
 * diputuskan RPC di basis data, bukan di sini. Pemeriksaan yang hanya hidup
 * di server action bisa dilewati dengan satu panggilan langsung ke PostgREST.
 */
export async function ambilProdukGratis(slug: string): Promise<Hasil> {
  const user = await penggunaSaatIni();
  if (!user) redirect(`/masuk?lanjut=${encodeURIComponent(`/produk/${slug}`)}`);

  const produk = await bacaProdukPerSlug(slug);
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("ambil_produk_gratis", { p_product_id: produk.id });
  if (error) return { ok: false, pesan: "Produk ini tidak bisa diambil gratis." };

  revalidatePath("/passport/produk");
  revalidatePath(`/produk/${slug}`);
  return { ok: true };
}
```

Periksa nama parameter pengalihan pasca-login yang sudah dipakai repo (`lanjut`, `next`, atau lainnya) di `src/app/masuk/` dan `src/app/setelah-masuk/`, lalu samakan. **Jangan** memperkenalkan nama parameter kedua.

`src/app/passport/produk/page.tsx` — dibuka `await requireRole(["klien", "admin", "owner"])`, membaca lewat `produkSaya()` di `src/lib/passport/produk-saya.ts` dengan **sesi pengguna** (RLS "klien baca miliknya" yang menyaring, bukan `.eq("client_id", …)` di TypeScript).

- [ ] **Step 6: Daftarkan rute di README**

```
| `/passport/produk` | Klien | Pembelian saya: produk digital yang dimiliki, pintu ke pemutar/pembaca/unduhan |
```

- [ ] **Step 7: Jalankan uji**

Run: `cd web && npx vitest run tests/produk-ambil-gratis.test.ts tests/produk-entitlement-db.test.ts tests/inventaris-rute.test.ts`
Expected: PASS semua.

- [ ] **Step 8: Commit**

```bash
cd web && git add supabase/migrations/20260921130000_ambil_produk_gratis.sql "src/app/produk/[slug]" src/app/passport/produk src/lib/passport/produk-saya.ts README.md tests/produk-ambil-gratis.test.ts
git commit -m "feat(produk): ambil produk gratis + halaman pembelian saya

Gratisnya diperiksa di SQL, bukan hanya di server action: PostgREST
mengekspos RPC ke semua user login, dan pemeriksaan yang hanya hidup di
TypeScript bisa dilewati dengan satu curl.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Gerbang isi — tonton, baca, dan unduh bertanda tangan

**Files:**
- Create: `web/src/app/api/produk/[id]/video/route.ts`
- Create: `web/src/app/api/produk/[id]/halaman/[n]/route.ts`
- Create: `web/src/app/api/produk/[id]/unduh/route.ts`
- Create: `web/src/lib/produk/cap-pdf.ts`
- Create: `web/src/app/passport/produk/[slug]/page.tsx`
- Modify: `web/package.json` (tambah dependensi `pdf-lib`)
- Modify: `web/src/lib/r2.ts` (dua ekspor baru)
- Modify: `web/README.md` (empat baris rute baru)
- Create: `web/tests/produk-gerbang-isi.test.ts`

**Catatan penyimpangan dari spec, disengaja dan perlu disebut:** spec menulis "pencapan dilakukan saat pembelian dan hasilnya disimpan". Rencana ini mencapnya **saat unduhan PERTAMA** lalu menyimpan hasilnya di `produk-berkas/<productId>/pembeli/<clientId>.pdf`; unduhan berikutnya memakai berkas yang sudah tercap. Hasil akhirnya sama (satu kali kerja CPU per pembeli, bukan per klik) tanpa menuntut antrean pekerjaan latar yang belum ada di repo ini. Bila pemilik repo menghendaki versi spec apa adanya, pencapan dipindahkan ke dalam `ambil_produk_gratis`, dan Tahap 2 memindahkannya ke webhook.

**Interfaces:**
- Consumes: `punya_produk` + policy isi (Task 3); `namaObjekPdfProduk`, `namaObjekHalamanProduk` (Task 6); `urlTontonVideo` dari `@/lib/r2`; `ambilKlien` dari `@/lib/passport/data`.
- Produces: di `@/lib/r2` — `UMUR_UNDUH_DETIK = 15 * 60` dan `urlUnduhBerkas(objek: string, namaBerkas: string): Promise<string>`; di `@/lib/produk/cap-pdf` — `bersihkanNamaCap(teks: string): string`, `objekPdfPembeli(productId: string, clientId: string): string`, `capPdfPembeli(pdf: Uint8Array, nama: string, email: string): Promise<Uint8Array>`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/produk-gerbang-isi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (p: string) => readFileSync(path.join(AKAR, p), "utf8");

const RUTE = [
  "src/app/api/produk/[id]/video/route.ts",
  "src/app/api/produk/[id]/halaman/[n]/route.ts",
  "src/app/api/produk/[id]/unduh/route.ts",
];

/**
 * Rute penyaji adalah endpoint MANDIRI: layout `/passport` tidak menjaganya,
 * dan itu sudah dibuktikan di repo ini dengan mem-POST server action panel
 * admin dari rute lain. Seluruh pemeriksaannya karena itu harus ada di dalam
 * berkas rutenya sendiri — dan itulah yang diperiksa sebagai TEKS SUMBER di
 * sini, karena satu `if` yang terhapus tidak terlihat oleh uji perilaku yang
 * hanya menembak jalur bahagia.
 */
describe("gerbang isi produk", () => {
  it.each(RUTE)("%s menolak dengan 404, tidak pernah 401/403", (rute) => {
    const sumber = baca(rute);
    expect(sumber).toContain("status: 404");
    expect(sumber).not.toContain("status: 401");
    expect(sumber).not.toContain("status: 403");
  });

  it.each(RUTE)("%s memutuskan hak lewat SESI pengguna sebelum service role", (rute) => {
    const sumber = baca(rute);
    const posisiSesi = sumber.indexOf("createServerSupabase");
    expect(posisiSesi).toBeGreaterThan(-1);
    const posisiService = sumber.indexOf("createAdminSupabase");
    if (posisiService > -1) expect(posisiService).toBeGreaterThan(posisiSesi);
  });

  it.each(RUTE)("%s mengambil path objek dari BARIS, bukan dari parameter URL", (rute) => {
    const sumber = baca(rute);
    // Parameter rute hanya dipakai sebagai kunci query (.eq), tidak pernah
    // dirakit menjadi path storage.
    expect(sumber).toContain(".eq(");
    expect(sumber).not.toMatch(/from\((["'`])(produk-halaman|produk-berkas)\1\)[\s\S]{0,80}\$\{id\}/);
  });

  it("rute unduh memakai umur tanda tangan unduh, bukan umur tonton", () => {
    const sumber = baca("src/app/api/produk/[id]/unduh/route.ts");
    expect(sumber).toContain("urlUnduhBerkas");
    expect(sumber).not.toContain("UMUR_TONTON_DETIK");
  });

  it("rute unduh menolak produk yang boleh_unduh-nya mati", () => {
    expect(baca("src/app/api/produk/[id]/unduh/route.ts")).toContain("boleh_unduh");
  });

  it("umur unduh benar-benar 15 menit", async () => {
    const { UMUR_UNDUH_DETIK } = await import("@/lib/r2");
    expect(UMUR_UNDUH_DETIK).toBe(15 * 60);
  });

  it("empat rute baru terdaftar di README", () => {
    const readme = baca("README.md");
    expect(readme).toContain("| `/api/produk/[id]/video` |");
    expect(readme).toContain("| `/api/produk/[id]/halaman/[n]` |");
    expect(readme).toContain("| `/api/produk/[id]/unduh` |");
    expect(readme).toContain("| `/passport/produk/[slug]` |");
  });
});

describe("cap PDF pembeli", () => {
  it("membuang karakter kontrol C0 dari nama sebelum dibakar", async () => {
    const { bersihkanNamaCap } = await import("@/lib/produk/cap-pdf");
    // C0 mentah DIBUANG, bukan di-escape: tidak ada bentuk escaped yang sah
    // baginya. Satu nama yang memuatnya membuat pencapan melempar untuk
    // SETIAP unduhan pembeli itu, permanen, tanpa satu pun jejak di layar
    // yang menunjuk penyebabnya. Alasan lengkapnya di lib/materi/watermark.ts.
    const vertikalTab = String.fromCharCode(11);
    expect(bersihkanNamaCap(`Ibu${vertikalTab}Sari`)).toBe("IbuSari");
    // Tab, LF, dan CR adalah tiga karakter kontrol yang SAH — dibiarkan.
    expect(bersihkanNamaCap("Ibu\tSari")).toBe("Ibu\tSari");
  });

  it("objek PDF tercap dipisahkan per pembeli", async () => {
    const { objekPdfPembeli } = await import("@/lib/produk/cap-pdf");
    expect(objekPdfPembeli("prod-1", "klien-9")).toBe("prod-1/pembeli/klien-9.pdf");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/produk-gerbang-isi.test.ts`
Expected: FAIL — berkas rute dan `@/lib/produk/cap-pdf` belum ada.

- [ ] **Step 3: Tambahkan umur & penerbit URL unduh ke `src/lib/r2.ts`**

Sisipkan di bawah `UMUR_TONTON_DETIK` yang sudah ada:

```ts
/**
 * Umur presigned URL UNDUH: 15 menit — sengaja jauh lebih pendek dari
 * `UMUR_TONTON_DETIK`.
 *
 * Kompromi keduanya berjalan ke arah yang berbeda. URL tonton harus bertahan
 * selama orang mem-pause, jadi ia panjang. URL unduh cukup bertahan selama
 * unduhannya, dan setiap menit tambahan adalah menit di mana tautan yang
 * tersalin ke grup percakapan masih bisa dipakai siapa pun yang membukanya.
 */
export const UMUR_UNDUH_DETIK = 15 * 60;

export async function urlUnduhBerkas(objek: string, namaBerkas: string): Promise<string> {
  return getSignedUrl(
    klien(),
    new GetObjectCommand({
      Bucket: bucketVideo(),
      Key: objek,
      // Memaksa peramban MENGUNDUH alih-alih memutar di tab, dan menamai
      // berkasnya dengan judul produk — bukan dengan UUID yang tak berarti
      // apa pun di folder Unduhan pembeli.
      ResponseContentDisposition: `attachment; filename="${namaBerkas}"`,
    }),
    { expiresIn: UMUR_UNDUH_DETIK },
  );
}
```

- [ ] **Step 4: Pasang `pdf-lib` dan tulis `src/lib/produk/cap-pdf.ts`**

```bash
cd web && npm install pdf-lib
```

`pdf-lib` adalah dependensi BARU, dan ia memang belum punya padanan di repo: `pdfjs-dist` hanya me-render PDF menjadi gambar (dipakai rasterisasi), `sharp` bekerja pada gambar, dan tidak satu pun dari keduanya bisa menulis kembali ke dalam dokumen PDF.

```ts
import "server-only";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * Nama & email pembeli diketik manusia, jadi keduanya data tak tepercaya di
 * konteks dokumen yang akan dibakar.
 *
 * Karakter kontrol C0 mentah, KECUALI tab/LF/CR, DIBUANG — bukan di-escape.
 * Tidak ada bentuk escaped yang sah bagi mereka, dan satu nama yang memuat
 * salah satunya membuat pencapan melempar untuk SETIAP unduhan pembeli itu,
 * permanen, tanpa satu pun jejak di layar yang menunjuk penyebabnya (nama
 * pembeli). Alasan yang sama persis sudah ditulis panjang di
 * `lib/materi/watermark.ts`.
 */
export function bersihkanNamaCap(teks: string): string {
  let hasil = "";
  for (const huruf of teks) {
    const kode = huruf.codePointAt(0)!;
    const kontrolTerlarang = kode < 0x20 && kode !== 0x09 && kode !== 0x0a && kode !== 0x0d;
    if (!kontrolTerlarang && kode !== 0x7f) hasil += huruf;
  }
  return hasil;
}

/**
 * Satu berkas tercap per pembeli, bukan satu per unduhan.
 *
 * Mencap PDF tebal setiap kali tombol diklik adalah kerja CPU yang berulang
 * tanpa guna; menyimpannya membuat unduhan kedua dan seterusnya hanya
 * berbiaya satu tanda tangan.
 */
export function objekPdfPembeli(productId: string, clientId: string): string {
  return `${productId}/pembeli/${clientId}.pdf`;
}

/**
 * Membakar identitas pembeli KE DALAM setiap halaman PDF.
 *
 * Dibakar, bukan dilapiskan: lapisan CSS hilang begitu berkasnya disimpan,
 * dan kebocoran yang tidak menunjuk sumbernya sama saja dengan tidak ada
 * proteksi sama sekali.
 */
export async function capPdfPembeli(
  pdf: Uint8Array,
  nama: string,
  email: string,
): Promise<Uint8Array> {
  const dok = await PDFDocument.load(pdf);
  const font = await dok.embedFont(StandardFonts.Helvetica);
  const teks = `${bersihkanNamaCap(nama)} - ${bersihkanNamaCap(email)} - PADMA`;

  for (const halaman of dok.getPages()) {
    const { width, height } = halaman.getSize();
    halaman.drawText(teks, {
      x: width * 0.1,
      y: height * 0.35,
      size: 16,
      font,
      color: rgb(0.42, 0.47, 0.44),
      opacity: 0.18,
      rotate: degrees(30),
    });
  }
  return dok.save();
}
```

- [ ] **Step 5: Tulis rute penyaji halaman PDF**

`src/app/api/produk/[id]/halaman/[n]/route.ts` — salin **urutannya** dari `src/app/api/materi/[id]/halaman/[n]/route.ts` (baca berkas itu lebih dulu), dengan tiga penggantian: tabel `material_pages` → `digital_product_pages`, kolom `material_id` → `product_id`, bucket `materi-halaman` → `produk-halaman`. Hak tetap diputuskan RLS lewat sesi pembaca — policy "halaman produk: pemilik baca" (Task 3) yang jadi hakimnya, bukan satu `if` di route handler.

- [ ] **Step 6: Tulis rute video**

`src/app/api/produk/[id]/video/route.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { urlTontonVideo } from "@/lib/r2";
import { ambilKlien } from "@/lib/passport/data";

export const runtime = "nodejs";

/**
 * Mengalihkan ke presigned URL R2 untuk video produk.
 *
 * Urutannya mengikat, sama dengan penyaji halaman e-book: identitas dulu,
 * lalu RLS sebagai hakim hak, baru objeknya disentuh — dan path objek diambil
 * dari BARIS, tidak pernah dari parameter URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Tidak ada klien -> 404, bukan 401: rute ini tidak boleh mengonfirmasi
  // bahwa produknya ada kepada yang tidak berhak membukanya.
  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("digital_product_files")
    .select("objek")
    .eq("product_id", id)
    .maybeSingle();
  if (!baris) return new Response(null, { status: 404 });

  return Response.redirect(await urlTontonVideo(baris.objek), 302);
}
```

- [ ] **Step 7: Tulis rute unduh**

`src/app/api/produk/[id]/unduh/route.ts`. Urutannya:

1. `ambilKlien()` — tidak ada → 404.
2. Sesi pengguna membaca `digital_products` (`id, judul, jenis, boleh_unduh`) — tidak ada → 404. **`boleh_unduh` mati → 404 juga**, dan ini pagar yang terpisah dari entitlement: produk yang dimiliki tetap tidak boleh diunduh bila memang tidak diizinkan diunduh.
3. Sesi pengguna membaca `digital_product_files` — inilah yang menegakkan entitlement lewat policy "berkas produk: pemilik baca". Tidak ada baris → 404.
4. `jenis === "video"` → `urlUnduhBerkas(baris.objek, namaBerkas)` lalu redirect 302.
5. `jenis === "pdf"` → service role memeriksa `objekPdfPembeli(id, klien.id)` di bucket `produk-berkas`. Bila belum ada: unduh sumbernya (`namaObjekPdfProduk(id)`), `capPdfPembeli(...)` dengan nama & email klien, unggah hasilnya. Lalu terbitkan signed URL bucket Supabase berumur `UMUR_UNDUH_DETIK` untuk objek tercap, dan redirect 302.

Nama berkas unduhan diturunkan dari judul produk lewat `slugDariJudul(produk.judul)` plus ekstensi — bukan dari UUID.

- [ ] **Step 8: Tulis halaman pembaca `/passport/produk/[slug]`**

Memakai ulang `pemutar-video.tsx` dan `reader-pdf.tsx` dari `src/app/passport/materi/[id]/`, diarahkan ke rute API produk. Halaman dibuka `await requireRole(["klien", "admin", "owner"])` dan `notFound()` bila produknya tidak dimiliki.

Tombol **Unduh** hanya dirender bila `bolehUnduh` menyala — dan ketiadaan tombol itu **bukan** pagarnya; pagarnya ada di rute unduh, langkah 2 di atas.

- [ ] **Step 9: Daftarkan empat rute di README**

```
| `/passport/produk/[slug]` | Klien | Pembaca/pemutar produk digital yang dimiliki, plus tombol unduh bila diizinkan |
| `/api/produk/[id]/video` | Klien pemilik | Alih ke presigned R2 untuk video produk; bukan-pemilik menerima 404 |
| `/api/produk/[id]/halaman/[n]` | Klien pemilik | Satu halaman PDF produk, ber-watermark identitas pembaca |
| `/api/produk/[id]/unduh` | Klien pemilik | Unduhan bertanda tangan 15 menit; PDF dicap nama + email pembeli sekali, lalu disimpan |
```

- [ ] **Step 10: Jalankan uji**

Run: `cd web && npx vitest run tests/produk-gerbang-isi.test.ts tests/produk-entitlement-db.test.ts tests/inventaris-rute.test.ts`
Expected: PASS semua.

- [ ] **Step 11: Commit**

```bash
cd web && git add src/app/api/produk src/lib/produk/cap-pdf.ts src/lib/r2.ts src/app/passport/produk package.json package-lock.json README.md tests/produk-gerbang-isi.test.ts
git commit -m "feat(produk): gerbang isi — tonton, baca, dan unduh bertanda tangan

Umur tanda tangan unduh 15 menit, bukan 2 jam seperti tonton: URL
tonton harus bertahan selama orang mem-pause, URL unduh cukup bertahan
selama unduhannya. PDF dicap sekali per pembeli, lalu disimpan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Seksi produk digital di landing page

**Files:**
- Create: `web/src/app/_landing/produk-digital.tsx`
- Modify: `web/src/app/page.tsx`
- Modify: `web/README.md` (perbarui deskripsi baris rute `/`)
- Create: `web/tests/landing-produk.test.tsx`

**Interfaces:**
- Consumes: `bacaProdukPublik`, `type ProdukPublik` (Task 8); `formatRupiah` dari `@/lib/rupiah-publik`.
- Produces: komponen `ProdukDigital({ produk }: { produk: ProdukPublik[] })` — **sinkron**, datanya dioper masuk.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/landing-produk.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProdukDigital } from "@/app/_landing/produk-digital";
import type { ProdukPublik } from "@/lib/produk/katalog";

function produk(ubah: Partial<ProdukPublik> = {}): ProdukPublik {
  return {
    id: "p1",
    judul: "Panduan Menyusui",
    slug: "panduan-menyusui",
    deskripsi: "Dari pelekatan sampai pumping.",
    jenis: "pdf",
    bolehUnduh: true,
    sampulObjek: null,
    harga: 75_000,
    hargaCoret: 99_000,
    ...ubah,
  };
}

describe("seksi produk digital di landing", () => {
  it("TIDAK dirender sama sekali saat belum ada produk tayang", () => {
    // Seksi kosong membuat PADMA terlihat seperti toko yang tutup, dan itu
    // pesan yang salah kepada pengunjung — persis alasan `lini-layanan.tsx`
    // menyaring fase tanpa layanan.
    expect(renderToStaticMarkup(<ProdukDigital produk={[]} />)).toBe("");
  });

  it("menampilkan harga jual dan harga coretnya", () => {
    const html = renderToStaticMarkup(<ProdukDigital produk={[produk()]} />);
    expect(html).toContain("Rp 75.000");
    expect(html).toContain("Rp 99.000");
    expect(html).toContain("<s");
  });

  it("produk gratis memakai kata Gratis, bukan Rp 0", () => {
    const html = renderToStaticMarkup(
      <ProdukDigital produk={[produk({ harga: 0, hargaCoret: null })]} />,
    );
    expect(html).toContain("Gratis");
    expect(html).not.toContain("Rp 0");
  });

  it("produk yang harganya belum ditetapkan tidak memajang Rp –", () => {
    // `formatRupiah(null as unknown as number)` memulangkan "Rp –", dan itu
    // kalimat yang tidak berarti apa pun bagi pengunjung. Cabang harga null
    // karena itu tidak boleh melewatinya sama sekali.
    const html = renderToStaticMarkup(
      <ProdukDigital produk={[produk({ harga: null, hargaCoret: null })]} />,
    );
    expect(html).not.toContain("Rp –");
  });

  it("menaut ke etalase penuh dan ke halaman produknya", () => {
    const html = renderToStaticMarkup(<ProdukDigital produk={[produk()]} />);
    expect(html).toContain('href="/produk"');
    expect(html).toContain('href="/produk/panduan-menyusui"');
  });

  it("komponennya SINKRON — datanya dioper masuk, bukan diambil sendiri", () => {
    // Komponen server `async` di dalam pohon halaman tidak bisa dirender
    // `renderToStaticMarkup`, dan seluruh suite ini merender halaman persis
    // begitu. Pengambilan data karena itu tetap milik halaman — pola yang
    // dipegang setiap komponen anak di repo ini.
    const sumber = readFileSync(
      path.resolve(__dirname, "../src/app/_landing/produk-digital.tsx"),
      "utf8",
    );
    expect(sumber).not.toMatch(/export\s+async\s+function\s+ProdukDigital/);
    expect(sumber).not.toContain("bacaProdukPublik");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `cd web && npx vitest run tests/landing-produk.test.tsx`
Expected: FAIL — komponen belum ada.

- [ ] **Step 3: Tulis komponen**

Buat `web/src/app/_landing/produk-digital.tsx` — **sinkron**, tanpa `async`, tanpa satu pun pengambilan data. Isinya: judul seksi, kalimat pengantar satu baris, grid kartu (maksimal empat, sudah dibatasi pemanggil), dan tautan "Lihat semua produk" ke `/produk`. `return null` bila `produk.length === 0`.

Harga dirender dengan tiga cabang, sama persis seperti kartu etalase di Task 8:

```tsx
{p.harga === null ? (
  <span className="text-[13px] text-ink-soft">Harga segera diumumkan</span>
) : p.harga === 0 ? (
  <span className="text-[15px] font-bold text-ink">Gratis</span>
) : (
  <span className="flex items-baseline gap-2">
    <b className="text-[15px] text-ink">{formatRupiah(p.harga)}</b>
    {p.hargaCoret !== null && (
      <s className="text-[13px] text-ink-soft">{formatRupiah(p.hargaCoret)}</s>
    )}
  </span>
)}
```

`formatRupiah` diimpor dari `@/lib/rupiah-publik`, **bukan** `@/lib/owner/rupiah` — berkas itu sendiri menandai dirinya "hanya untuk panel owner", dan landing publik tidak boleh mengimpor apa pun dari bawah `lib/owner/`.

- [ ] **Step 4: Sisipkan ke landing**

Di `web/src/app/page.tsx`, tambahkan `bacaProdukPublik(4)` ke `Promise.all` yang sudah ada, lalu render `<ProdukDigital produk={produk} />` **setelah** `<CaraKerja />` dan **sebelum** `<PassportTeaser />`:

```tsx
const [katalog, pengaturan, produk] = await Promise.all([
  bacaKatalog(),
  bacaPengaturan(),
  bacaProdukPublik(4),
]);
```

`export const revalidate = 300` yang sudah ada tetap berlaku dan sudah tepat untuk katalog produk juga.

- [ ] **Step 5: Perbarui deskripsi rute `/` di README**

Baris `| `/` | Publik | Landing: hero, 5 lini layanan (dari DB), cara kerja, teaser passport, pembanding |` diperbarui agar menyebut seksi produk digital.

- [ ] **Step 6: Jalankan uji landing lengkap**

Run: `cd web && npx vitest run tests/landing-produk.test.tsx tests/landing.test.ts tests/landing-katalog.test.ts tests/landing-fase-kosong.test.tsx tests/inventaris-rute.test.ts`
Expected: PASS semua.

- [ ] **Step 7: Jalankan SELURUH suite — koordinasikan dulu**

Supabase lokal dipakai bersama sesi lain; pastikan tidak ada yang sedang memakainya sebelum menjalankan ini.

Run: `cd web && npm run lint && npx tsc --noEmit && npm test`
Expected: PASS. Bila ada uji lama yang merah, perbaiki **penyebabnya** — jangan longgarkan assertion-nya.

- [ ] **Step 8: Commit**

```bash
cd web && git add src/app/_landing/produk-digital.tsx src/app/page.tsx README.md tests/landing-produk.test.tsx
git commit -m "feat(produk): seksi produk digital di landing

Komponen SINKRON, datanya dioper dari halaman: komponen server async
tidak bisa dirender renderToStaticMarkup, dan seluruh suite merender
halaman persis begitu. Seksi kosong tidak dirender sama sekali.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Sesudah Tahap 1

Yang **sudah hidup penuh** di akhir rencana ini: master produk (admin), harga berriwayat dengan coret (owner), unggah video & PDF, etalase publik, halaman produk, seksi landing, pengambilan produk gratis, kepemilikan, penontonan/pembacaan, dan unduhan bertanda tangan bercap pembeli.

Yang **sengaja belum ada**, dan menjadi isi Tahap 2: keranjang (`cart_items`), pesanan (`orders`/`order_items`), Midtrans Snap, webhook bertanda tangan, dan cron jaring pengaman. Tidak satu pun gerbang isi dari Task 10 perlu berubah saat itu — webhook cukup menulis satu baris `digital_entitlements` bersumber `beli`, dan `punya_produk` sudah menjawab sisanya.

Tahap 3: `/admin/pembelian`, rekap pendapatan produk digital di `/owner/rekap`, pencabutan akses dari halaman detail produk.
