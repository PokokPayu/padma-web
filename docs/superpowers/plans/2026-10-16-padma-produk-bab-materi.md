# Produk Berbab, Materi, Pratinjau & Masa Berlaku — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu produk digital berisi bab dan materi (video/PDF) bersampul, sebagian materi bisa dipratinjau tanpa membeli, dan akses pembeli punya masa berlaku yang disetel owner.

**Architecture:** Tiga migrasi SQL menjadi tulang punggungnya. (1) Bentuk data: bab, materi, dan isi yang berganti kunci ke `material_id`. (2) Definisi akses: `punya_produk` tahu kedaluwarsa, `boleh_buka_materi` untuk gerbang isi, dan `pernah_punya_produk` untuk metadata. (3) Alur bayar: durasi dibekukan di `order_items`, entitlement kedaluwarsa diperbarui saat beli ulang, dan gerbang "pembayaran menggantung" ditulis satu kali. Sesudah itu lapisan TypeScript mengikuti: pustaka, aksi admin, UI admin, panel owner, halaman publik, passport, dan gerbang isi per materi.

**Tech Stack:** Next.js 16.3 (baca `web/node_modules/next/dist/docs/` sebelum menulis rute/halaman), React 19, Supabase Postgres + PostgREST + Storage, plpgsql, Cloudflare R2, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-padma-produk-bab-materi-design.md`

## Global Constraints

- Semua perintah dijalankan dari `/Users/arvinfairuz/Documents/padma/web`.
- Kerjakan di branch baru `feat/produk-bab-materi` dari `development`.
- Migrasi bercap waktu MANUAL: `20261016100000_produk_bab_materi.sql`, `20261016110000_produk_akses_masa_berlaku.sql`, `20261016120000_produk_masa_berlaku_pesanan.sql`. Jangan `supabase migration new`.
- Terapkan migrasi lokal dengan `npx supabase migration up`, BUKAN `db reset` (Supabase lokal dipakai bersama). JANGAN PERNAH `db push`: repo ter-link ke PRODUKSI.
- Jangan `npm test` penuh. Jalankan berkas uji yang disebut saja: `npx vitest run <berkas>`.
- **Docker lokal mati per 16 Okt.** Saat Docker mati, port 54321 MENGGANTUNG, bukan menolak, sehingga vitest berbasis DB macet tanpa batas. Cek dulu dengan `docker info >/dev/null 2>&1 && echo HIDUP || echo MATI`. Bila MATI, langkah yang menjalankan uji DB atau `migration up` ditandai **TERTUNDA** di checkbox; jangan mengarang hasilnya, lalu lanjutkan. Uji murni (tanpa DB) tetap dijalankan.
- Tingkat uji **dipangkas**: hanya uji yang ditulis di rencana ini, ditambah memperbaiki uji lama yang pecah (Task 11). Tampilan diuji manual oleh pemilik repo.
- Wajib di akhir setiap task yang menyentuh TS: `npx tsc --noEmit` dan `npm run lint` hijau untuk berkas yang disentuh.
- Setiap fungsi SQL baru menyatakan haknya eksplisit: `revoke all ... from public, anon` lalu `grant execute ... to authenticated` untuk RPC publik, atau `revoke all ... from public, anon, authenticated` untuk pembantu internal & fungsi trigger. Fungsi `security definer` selalu `set search_path = public`.
- Policy baru untuk peran login ditulis `to authenticated`. Policy tanpa target lahir `to public`, mencakup `anon`, dan memanggil fungsi yang EXECUTE-nya sudah dicabut dari anon, sehingga gagal "permission denied" alih-alih memulangkan kosong.
- Tabel baru otomatis TIDAK punya DELETE untuk `authenticated` (default privileges `cabut_hak_hapus_berlebih`). Penghapusan bab/materi lewat RPC berparameter, bukan `grant delete`.
- Label jenis materi: `video` → "Video", `pdf` → "Artikel" (bahasa klien).
- Masa berlaku disimpan sebagai `masa_berlaku_bulan int null` (NULL = selamanya, 1..120). "N tahun" disimpan `N*12`.
- Komentar mengikuti gaya repo: bahasa Indonesia, menjelaskan KENAPA, bukan APA.
- Commit diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Lima hal yang tersirat di spec tapi tidak dijaga uji otomatis mana pun. Reviewer akhir wajib membacanya di kode, dan pemilik repo mengujinya manual:

1. **Admin menghapus materi yang PDF-nya sudah diunduh pembeli** → salinan bercap di `produk-berkas/<pid>/<mid>/pembeli/` ikut terhapus. Kalau tidak, pembeli lama mendapat versi lama walaupun materinya diganti.
2. **Produk nonaktif yang akses pembelinya kedaluwarsa** → tetap tampil di `/passport/produk` dengan "Masa berlaku habis". Kalau kosong diam-diam, berarti embed RLS memulangkan `null`: policy `pernah_punya_produk` tidak terpasang atau tidak dipakai.
3. **Pratinjau dibuka pengguna yang baru login lewat cookie `padma_lanjut`** → mendarat di `/passport/produk/<slug>/<uuid>`. Nilai `/passport/produk/x/../../admin` dan `//evil.com` jatuh ke `/passport`.
4. **Admin mengganti sampul produk berkali-kali** → URL publik berubah setiap kali (nama objek unik), sehingga CDN Supabase tidak menyajikan gambar lama. Objek sampul lama terhapus.
5. **Materi berjenis PDF dengan `boleh_unduh` mati** → PDF utuh tidak pernah diunggah ke `produk-berkas`. Kalau saklarnya dinyalakan belakangan, admin diminta mengunggah ulang; tombol unduh pembeli tidak muncul sebelum berkasnya ada.

Uji untuk risiko yang buta bagi tes manual (RLS per keadaan, cabang penerbitan akses, pembekuan durasi, FK bab-materi, cookie tujuan) ADA di Task 1, 2, 3, 4, dan 8.

---

## Peta berkas

| Berkas | Tanggung jawab |
|---|---|
| Create `web/supabase/migrations/20261016100000_produk_bab_materi.sql` | Bab, materi, isi per materi, kolom masa berlaku + pagar owner, RPC hapus/ganti |
| Create `web/supabase/migrations/20261016110000_produk_akses_masa_berlaku.sql` | `berlaku_sampai`, `akses_aktif`, `punya_produk`, `pernah_punya_produk`, `boleh_buka_materi`, policy |
| Create `web/supabase/migrations/20261016120000_produk_masa_berlaku_pesanan.sql` | Durasi beku, gerbang menggantung tunggal, keranjang, penerbitan & ambil gratis |
| Create `web/tests/produk-materi-skema-db.test.ts` | Uji Task 1 |
| Create `web/tests/produk-materi-akses-db.test.ts` | Uji Task 2 |
| Create `web/tests/produk-masa-berlaku-pesanan-db.test.ts` | Uji Task 3 |
| Modify `web/src/lib/produk/status.ts` | Jenis materi, label masa berlaku, ringkasan jumlah, validasi |
| Modify `web/src/lib/produk/objek.ts` | Nama objek per materi + sampul |
| Modify `web/src/lib/produk/cap-pdf.ts` | Salinan bercap per materi |
| Create `web/tests/produk-materi-status.test.ts` | Uji murni Task 4 |
| Modify `web/src/app/admin/produk/aksi.ts` | Tanpa jenis/boleh_unduh; syarat tayang = isi lengkap |
| Create `web/src/app/admin/produk/[id]/aksi-isi.ts` | CRUD bab & materi, sampul |
| Modify `web/src/app/admin/produk/[id]/unggah.ts` | Unggah isi per materi |
| Modify `web/src/lib/admin/produk-admin.ts` | Bentuk data admin baru + pohon isi |
| Modify `web/src/app/admin/produk/form-produk.tsx`, `page.tsx` | Medan & filter jenis dibuang |
| Modify `web/src/app/admin/produk/[id]/page.tsx` | Penyunting isi bertingkat |
| Create `web/src/app/admin/produk/[id]/editor-isi.tsx` | UI bab & materi |
| Create `web/src/app/admin/produk/[id]/pengunggah-sampul.tsx` | Unggah sampul produk/materi |
| Modify `web/src/app/admin/produk/[id]/pengunggah-produk.tsx` | Pengunggah per materi |
| Modify `web/src/lib/owner/daftar-produk.ts`, `web/src/app/owner/produk/page.tsx`, `aksi.ts` | Masa berlaku |
| Create `web/src/app/owner/produk/form-masa-berlaku.tsx` | Form masa berlaku |
| Modify `web/src/lib/produk/katalog.ts` | Materi publik + masa berlaku |
| Modify `web/src/app/produk/kartu-produk.tsx`, `web/src/app/produk/[slug]/page.tsx` | Tampilan referensi |
| Create `web/src/app/produk/[slug]/daftar-bab.tsx` | Daftar bab/materi dengan gembok/pratinjau |
| Modify `web/src/app/produk/[slug]/tombol-ambil.tsx`, `ambil.ts` | `punya_produk` via RPC, titip tujuan |
| Modify `web/src/lib/auth/tujuan-produk.ts` | Pola tujuan kedua |
| Create `web/tests/tujuan-produk-materi.test.ts` | Uji murni Task 8 |
| Modify `web/src/lib/passport/produk-saya.ts`, `web/src/app/passport/produk/page.tsx` | Status masa berlaku |
| Modify `web/src/app/passport/produk/[slug]/page.tsx` | Daftar isi milik pembeli |
| Create `web/src/app/passport/produk/[slug]/[materiId]/page.tsx` | Penampil materi |
| Move `reader-pdf.tsx`, `pemutar-video.tsx` | Prop `materiId` |
| Create `web/src/app/api/produk/materi/[id]/{video,halaman/[n],unduh}/route.ts` | Gerbang isi per materi |
| Delete `web/src/app/api/produk/[id]/` | Gerbang lama |

---

### Task 1: Migrasi bentuk data — bab, materi, isi per materi

**Files:**
- Create: `web/supabase/migrations/20261016100000_produk_bab_materi.sql`
- Create: `web/tests/produk-materi-skema-db.test.ts`

**Interfaces:**
- Produces (SQL, dipakai Task 2–10):
  - `public.material_kind` enum `('video','pdf')`
  - `public.digital_product_sections(id, product_id, judul, urutan, created_at)`, `unique (id, product_id)`
  - `public.digital_product_materials(id, section_id, product_id, judul, keterangan, jenis material_kind, sampul_objek, pratinjau, boleh_unduh, urutan, created_at)`, FK komposit `(section_id, product_id)` → bab
  - `public.digital_product_files(id, material_id unique, objek, mime, byte, created_at)`
  - `public.digital_product_pages(material_id, halaman, objek)`, PK `(material_id, halaman)`
  - `public.digital_products.masa_berlaku_bulan int null` (1..120); kolom `jenis` dan `boleh_unduh` DIBUANG; enum `product_type` DIBUANG
  - RPC (authenticated, bergerbang `user_role()`):
    - `ganti_halaman_materi_produk(p_material_id uuid, p_halaman jsonb) returns table(objek text)`
    - `lepas_berkas_materi(p_material_id uuid) returns table(objek text)`
    - `hapus_bab_produk(p_section_id uuid) returns void`
    - `hapus_materi_produk(p_material_id uuid) returns table(asal text, objek text)`, dengan `asal ∈ {'video','pdf','halaman','sampul'}`
  - RPC lama `ganti_halaman_produk` dan `lepas_berkas_produk` DIBUANG.

- [ ] **Step 1: Buat branch**

```bash
cd /Users/arvinfairuz/Documents/padma && git checkout development && git checkout -b feat/produk-bab-materi
```

- [ ] **Step 2: Tulis uji yang gagal**

Create `web/tests/produk-materi-skema-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

/**
 * Bentuk data produk berbab (spec 2026-10-16). Yang diuji di sini adalah
 * hal yang TIDAK terlihat saat admin mengeklik panel: konsistensi bab-materi
 * dijaga Postgres (bukan aplikasi), pagar kolom masa berlaku, dan apa yang
 * boleh dibaca anon.
 */
const svc = createAdminSupabase();
let produkAktif: string;
let produkNonaktif: string;
let babAktif: string;
let babNonaktif: string;
let materiAktif: string;

beforeAll(async () => {
  const { data: p1, error: e1 } = await svc.from("digital_products")
    .insert({ judul: "PAD-UJI Skema Bab Aktif", slug: "pad-uji-skema-bab-aktif", aktif: true })
    .select("id").single();
  if (e1) throw e1;
  produkAktif = p1!.id;
  const { data: p2, error: e2 } = await svc.from("digital_products")
    .insert({ judul: "PAD-UJI Skema Bab Nonaktif", slug: "pad-uji-skema-bab-nonaktif" })
    .select("id").single();
  if (e2) throw e2;
  produkNonaktif = p2!.id;

  const { data: b1 } = await svc.from("digital_product_sections")
    .insert({ product_id: produkAktif, judul: "Bab satu" }).select("id").single();
  babAktif = b1!.id;
  const { data: b2 } = await svc.from("digital_product_sections")
    .insert({ product_id: produkNonaktif, judul: "Bab rahasia" }).select("id").single();
  babNonaktif = b2!.id;

  const { data: m1, error: em } = await svc.from("digital_product_materials")
    .insert({ section_id: babAktif, product_id: produkAktif, judul: "Materi satu", jenis: "video" })
    .select("id").single();
  if (em) throw em;
  materiAktif = m1!.id;
  await svc.from("digital_product_materials")
    .insert({ section_id: babNonaktif, product_id: produkNonaktif, judul: "Materi rahasia", jenis: "pdf" });
  await svc.from("digital_product_files")
    .insert({ material_id: materiAktif, objek: `produk/${produkAktif}/${materiAktif}/isi.mp4`, mime: "video/mp4", byte: 10 });
});

afterAll(async () => {
  await svc.from("digital_products").delete().in("id", [produkAktif, produkNonaktif]);
});

describe("konsistensi bab-materi dijaga basis data", () => {
  it("materi yang product_id-nya berbeda dari babnya ditolak", async () => {
    const { error } = await svc.from("digital_product_materials")
      .insert({ section_id: babAktif, product_id: produkNonaktif, judul: "Nyasar", jenis: "pdf" });
    expect(error?.code).toBe("23503");
  });

  it("bab yang masih berisi tidak bisa dihapus lewat RPC", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("hapus_bab_produk", { p_section_id: babAktif });
    expect(error?.message).toMatch(/masih berisi/);
  });

  it("hapus_materi_produk memulangkan objek isi sebelum menghapus", async () => {
    const { data: bab } = await svc.from("digital_product_sections")
      .insert({ product_id: produkAktif, judul: "Bab sementara" }).select("id").single();
    const { data: m } = await svc.from("digital_product_materials")
      .insert({ section_id: bab!.id, product_id: produkAktif, judul: "Sementara", jenis: "video", sampul_objek: "x/sampul.webp" })
      .select("id").single();
    await svc.from("digital_product_files")
      .insert({ material_id: m!.id, objek: "produk/x/y/isi.mp4", mime: "video/mp4", byte: 1 });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.rpc("hapus_materi_produk", { p_material_id: m!.id });
    expect(error).toBeNull();
    expect(data).toEqual(expect.arrayContaining([
      { asal: "video", objek: "produk/x/y/isi.mp4" },
      { asal: "sampul", objek: "x/sampul.webp" },
    ]));
    const { data: sisa } = await svc.from("digital_product_materials").select("id").eq("id", m!.id);
    expect(sisa).toEqual([]);

    const { error: eBab } = await admin.rpc("hapus_bab_produk", { p_section_id: bab!.id });
    expect(eBab).toBeNull();
  });

  it("klien tidak bisa memanggil hapus_materi_produk", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("hapus_materi_produk", { p_material_id: materiAktif });
    expect(error?.message).toMatch(/hanya admin\/owner/);
  });
});

describe("masa berlaku hanya ditulis owner", () => {
  it("admin ditolak", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.from("digital_products")
      .update({ masa_berlaku_bulan: 9 }).eq("id", produkAktif);
    expect(error?.code).toBe("42501");
  });

  it("owner diterima", async () => {
    const owner = await signInAs("owner@padma.test");
    const { data, error } = await owner.from("digital_products")
      .update({ masa_berlaku_bulan: 9 }).eq("id", produkAktif).select("masa_berlaku_bulan");
    expect(error).toBeNull();
    expect(data).toEqual([{ masa_berlaku_bulan: 9 }]);
  });

  it("admin tetap bisa menyunting kolom lain", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("digital_products")
      .update({ deskripsi: "disunting admin" }).eq("id", produkAktif).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("yang boleh dibaca anon", () => {
  it("bab dan materi produk TAYANG terbaca", async () => {
    const anon = anonClient();
    const { data: bab } = await anon.from("digital_product_sections").select("id").eq("product_id", produkAktif);
    const { data: materi } = await anon.from("digital_product_materials").select("id").eq("product_id", produkAktif);
    expect(bab?.length).toBeGreaterThan(0);
    expect(materi?.length).toBeGreaterThan(0);
  });

  it("bab dan materi produk NONAKTIF tidak terbaca", async () => {
    const anon = anonClient();
    const { data: bab } = await anon.from("digital_product_sections").select("id").eq("product_id", produkNonaktif);
    const { data: materi } = await anon.from("digital_product_materials").select("id").eq("product_id", produkNonaktif);
    expect(bab).toEqual([]);
    expect(materi).toEqual([]);
  });

  it("isi (files/pages) tidak pernah terbaca anon", async () => {
    const anon = anonClient();
    const { data: berkas, error } = await anon.from("digital_product_files").select("objek").eq("material_id", materiAktif);
    expect(berkas ?? []).toEqual([]);
    expect(error === null || error.code === "42501").toBe(true);
  });
});
```

- [ ] **Step 3: Jalankan uji, pastikan gagal**

Run: `docker info >/dev/null 2>&1 && npx vitest run tests/produk-materi-skema-db.test.ts`
Expected: FAIL. Tabel `digital_product_sections` belum ada, jadi insert di `beforeAll` gagal. Bila Docker MATI: tandai **TERTUNDA**.

- [ ] **Step 4: Tulis migrasi**

Create `web/supabase/migrations/20261016100000_produk_bab_materi.sql`:

```sql
-- ===========================================================================
-- PRODUK BERBAB — Produk → Bab → Materi (spec 2026-10-16)
-- ===========================================================================
-- Satu produk kini berisi banyak materi (video/PDF campur) yang dikelompokkan
-- per bab. Isi lama (satu berkas per produk) DIBUANG tanpa migrasi data:
-- tabel produk belum pernah sampai ke produksi, dan pemilik repo menyetujui
-- penghapusan data uji lokal (spec, tabel Keputusan).
--
-- Tabel isi DIBUAT ULANG, bukan di-ALTER: kunci, policy, dan RPC-nya berubah
-- seluruhnya, dan tabel kosong yang dibuat ulang lebih mudah dibaca daripada
-- deretan drop constraint/drop column yang urutannya rapuh.

drop function if exists public.ganti_halaman_produk(uuid, jsonb);
drop function if exists public.lepas_berkas_produk(uuid);
drop table if exists public.digital_product_pages;
drop table if exists public.digital_product_files;

alter table public.digital_products
  drop column jenis,
  drop column boleh_unduh;
drop type public.product_type;

-- ===== MASA BERLAKU =====
-- NULL = selamanya. Satuan tunggal BULAN: "N tahun" di form disimpan N*12,
-- supaya tidak ada kolom satuan yang bisa berselisih dengan angkanya.
alter table public.digital_products
  add column masa_berlaku_bulan int
    check (masa_berlaku_bulan is null or masa_berlaku_bulan between 1 and 120);

comment on column public.digital_products.masa_berlaku_bulan is
  'Masa akses sesudah dibeli, dalam bulan. NULL = selamanya. Hanya OWNER yang '
  'boleh mengubahnya (trigger jaga_masa_berlaku_produk). Dibekukan di '
  'order_items.masa_berlaku_bulan_beku saat checkout.';

-- Policy "produk: staf" memberi admin DAN owner hak tulis seluruh baris; syarat
-- jual (harga, masa berlaku) hanya milik owner. Pagar kolom lewat trigger,
-- bukan dengan memecah GRANT per kolom: memecah GRANT UPDATE berarti setiap
-- kolom baru kelak harus diingat untuk di-grant, dan lupa melakukannya gagal
-- diam di panel admin.
create or replace function public.jaga_masa_berlaku_produk()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Service role (auth.uid() NULL) dikecualikan: pola yang sama dengan
  -- ganti_halaman_produk lama — service role tidak punya baris profil dan
  -- akan jatuh ke 'klien'.
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.masa_berlaku_bulan is not null)
     or (tg_op = 'UPDATE' and new.masa_berlaku_bulan is distinct from old.masa_berlaku_bulan) then
    if public.user_role() <> 'owner' then
      raise exception 'Masa berlaku hanya bisa diatur owner.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.jaga_masa_berlaku_produk() from public, anon, authenticated;

create trigger produk_masa_berlaku_owner
  before insert or update of masa_berlaku_bulan on public.digital_products
  for each row execute function public.jaga_masa_berlaku_produk();

-- ===== BAB =====
create table public.digital_product_sections (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.digital_products(id) on delete cascade,
  judul text not null check (char_length(btrim(judul)) between 1 and 120),
  urutan int not null default 0,
  created_at timestamptz not null default now(),
  -- Sasaran FK komposit materi di bawah.
  unique (id, product_id)
);

create index digital_product_sections_produk_idx
  on public.digital_product_sections (product_id, urutan, created_at);

-- ===== MATERI =====
create type public.material_kind as enum ('video', 'pdf');

create table public.digital_product_materials (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null,
  -- Disimpan GANDA (bisa diturunkan dari bab) supaya predikat akses menjawab
  -- "materi ini milik produk apa" tanpa join. Konsistensinya dijaga FK
  -- komposit di bawah, bukan oleh aplikasi.
  product_id uuid not null references public.digital_products(id) on delete cascade,
  judul text not null check (char_length(btrim(judul)) between 2 and 120),
  keterangan text not null default '' check (char_length(keterangan) <= 500),
  jenis public.material_kind not null,
  sampul_objek text,
  -- Default TERTUTUP untuk keduanya: pratinjau membuka isi bagi non-pembeli,
  -- unduhan melepas berkas utuh. Keduanya dibuka sadar, tidak pernah karena
  -- lupa dimatikan.
  pratinjau boolean not null default false,
  boleh_unduh boolean not null default false,
  urutan int not null default 0,
  created_at timestamptz not null default now(),
  -- NO ACTION (bawaan), BUKAN restrict: dicek di akhir pernyataan. Menghapus
  -- produk men-cascade bab DAN materi dalam satu pernyataan; restrict akan
  -- menolak bab sebelum cascade materinya sempat berjalan. Menghapus bab
  -- yang masih berisi tetap ditolak.
  constraint materi_bab_sejalan foreign key (section_id, product_id)
    references public.digital_product_sections (id, product_id)
);

create index digital_product_materials_bab_idx
  on public.digital_product_materials (section_id, urutan, created_at);
create index digital_product_materials_produk_idx
  on public.digital_product_materials (product_id);

-- ===== ISI PER MATERI =====
create table public.digital_product_files (
  id uuid primary key default gen_random_uuid(),
  -- Kunci objek: R2 untuk video, bucket `produk-berkas` untuk PDF utuh.
  -- Ditentukan server, tidak pernah dikirim browser.
  material_id uuid not null unique
    references public.digital_product_materials(id) on delete cascade,
  objek text not null,
  mime text not null,
  byte bigint not null,
  created_at timestamptz not null default now()
);

create table public.digital_product_pages (
  material_id uuid not null references public.digital_product_materials(id) on delete cascade,
  halaman int not null,
  objek text not null,
  primary key (material_id, halaman)
);

-- ===== RLS =====
alter table public.digital_product_sections enable row level security;
alter table public.digital_product_materials enable row level security;
alter table public.digital_product_files enable row level security;
alter table public.digital_product_pages enable row level security;

-- Staf: penuh. `to authenticated` SENGAJA — lihat 20260921100000_produk_digital.sql.
create policy "bab produk: staf" on public.digital_product_sections for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));
create policy "materi produk: staf" on public.digital_product_materials for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));
create policy "berkas materi: staf" on public.digital_product_files for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));
create policy "halaman materi: staf" on public.digital_product_pages for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- Publik: daftar isi produk TAYANG (judul, keterangan, jenis, sampul,
-- pratinjau) adalah bagian etalase, seperti di referensi klien. ISInya tidak:
-- files/pages tidak punya policy publik dan tidak di-grant ke anon.
-- Subkueri ke digital_products ikut tunduk RLS-nya sendiri — anon hanya
-- melihat produk aktif, jadi syarat `p.aktif` di sini tertulis demi yang
-- membaca, bukan karena RLS membutuhkannya.
create policy "bab produk: baca publik produk tayang" on public.digital_product_sections for select
  using (exists (select 1 from public.digital_products p where p.id = product_id and p.aktif));
create policy "materi produk: baca publik produk tayang" on public.digital_product_materials for select
  using (exists (select 1 from public.digital_products p where p.id = product_id and p.aktif));

grant select on public.digital_product_sections to anon;
grant select on public.digital_product_materials to anon;

-- Policy BACA isi untuk pembeli & pratinjau lahir di migrasi berikutnya
-- (`produk_akses_masa_berlaku`), bersama predikatnya. Sampai saat itu isi
-- hanya terbaca staf — fail-closed.

-- Hak tulis: pola 20260921130000_produk_hapus_isi.sql, kini per materi.
-- Halaman selalu diganti sebagai SATU SET → seluruh hak tabel dicabut, SELECT
-- dikembalikan. Berkas disunting lewat upsert → hanya DELETE yang (memang
-- sudah) tidak ada.
revoke all on public.digital_product_pages from authenticated;
grant select on public.digital_product_pages to authenticated;
revoke delete on public.digital_product_files from authenticated;

comment on table public.digital_product_pages is
  'Halaman PDF materi terasterisasi. SELURUH hak tabel dicabut dari '
  'authenticated; satu-satunya jalur tulis: ganti_halaman_materi_produk(p_material_id, '
  'p_halaman). Filter PostgREST adalah pilihan pemanggil, bukan pembatas baris.';
comment on table public.digital_product_files is
  'Berkas isi materi (video ATAU PDF utuh), satu baris per materi. Upsert '
  'terbuka untuk staf; DELETE hanya lewat lepas_berkas_materi / '
  'hapus_materi_produk.';

-- ===== RPC TULIS (radius terkunci parameter) =====
-- Guard `auth.uid() is not null and user_role() not in (...)`: service role
-- tidak punya baris profil dan akan jatuh ke 'klien' tanpa syarat pertama.
create or replace function public.ganti_halaman_materi_produk(
  p_material_id uuid,
  p_halaman     jsonb
) returns table(objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh mengganti halaman materi';
  end if;

  return query
    delete from public.digital_product_pages
     where material_id = p_material_id
    returning digital_product_pages.objek;

  insert into public.digital_product_pages (material_id, halaman, objek)
  select p_material_id, (x->>'halaman')::int, x->>'objek'
    from jsonb_array_elements(p_halaman) as x;
end $$;

create or replace function public.lepas_berkas_materi(p_material_id uuid)
returns table(objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh melepas berkas materi';
  end if;

  return query
    delete from public.digital_product_files
     where material_id = p_material_id
    returning digital_product_files.objek;
end $$;

create or replace function public.hapus_bab_produk(p_section_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_section_id is null then
    raise exception 'p_section_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh menghapus bab';
  end if;
  -- Diperiksa DI SINI dengan kalimat manusia, alih-alih menunggu FK menolak
  -- dengan 23503 telanjang.
  if exists (select 1 from public.digital_product_materials m where m.section_id = p_section_id) then
    raise exception 'Bab masih berisi materi — hapus materinya dulu.' using errcode = 'P0001';
  end if;
  delete from public.digital_product_sections where id = p_section_id;
end $$;

-- Memulangkan SETIAP objek storage milik materi SEBELUM barisnya terhapus —
-- satu pernyataan atomik per sumber, bukan SELECT terpisah yang balapan.
-- `asal` memberi tahu pemanggil bucket mana: 'video' → R2, 'pdf' →
-- produk-berkas, 'halaman' → produk-halaman, 'sampul' → produk-sampul.
create or replace function public.hapus_materi_produk(p_material_id uuid)
returns table(asal text, objek text)
language plpgsql security definer set search_path = public as $$
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh menghapus materi';
  end if;

  return query
    select m.jenis::text, f.objek
      from public.digital_product_files f
      join public.digital_product_materials m on m.id = f.material_id
     where f.material_id = p_material_id;
  return query
    select 'halaman'::text, h.objek
      from public.digital_product_pages h
     where h.material_id = p_material_id;
  return query
    select 'sampul'::text, m.sampul_objek
      from public.digital_product_materials m
     where m.id = p_material_id and m.sampul_objek is not null;

  -- Cascade membawa files & pages.
  delete from public.digital_product_materials where id = p_material_id;
end $$;

revoke all on function public.ganti_halaman_materi_produk(uuid, jsonb) from public, anon;
revoke all on function public.lepas_berkas_materi(uuid) from public, anon;
revoke all on function public.hapus_bab_produk(uuid) from public, anon;
revoke all on function public.hapus_materi_produk(uuid) from public, anon;
grant execute on function public.ganti_halaman_materi_produk(uuid, jsonb) to authenticated;
grant execute on function public.lepas_berkas_materi(uuid) to authenticated;
grant execute on function public.hapus_bab_produk(uuid) to authenticated;
grant execute on function public.hapus_materi_produk(uuid) to authenticated;

-- Sampul (produk & materi) di bucket publik `produk-sampul`. Nama objek unik
-- per unggahan, sehingga mengganti sampul = objek baru + hapus yang lama
-- lewat service role. Policy UPDATE/DELETE staf sengaja TIDAK ditambahkan.
```

- [ ] **Step 5: Terapkan migrasi & jalankan uji**

Run: `docker info >/dev/null 2>&1 && npx supabase migration up && npx vitest run tests/produk-materi-skema-db.test.ts`
Expected: migrasi berlaku tanpa galat. Uji yang menyentuh RLS publik untuk isi lulus. Uji `hapus_materi_produk` dan pagar masa berlaku lulus. Bila Docker MATI: tandai **TERTUNDA**.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20261016100000_produk_bab_materi.sql web/tests/produk-materi-skema-db.test.ts
git commit -m "feat(produk): skema bab & materi, isi per materi, masa berlaku khusus owner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migrasi akses — kedaluwarsa, pratinjau, pernah punya

**Files:**
- Create: `web/supabase/migrations/20261016110000_produk_akses_masa_berlaku.sql`
- Create: `web/tests/produk-materi-akses-db.test.ts`

**Interfaces:**
- Consumes: tabel Task 1.
- Produces (SQL):
  - `digital_entitlements.berlaku_sampai timestamptz null` (NULL = selamanya)
  - `public.akses_aktif(p_client_id uuid, p_product_id uuid) returns boolean`. Pembantu INTERNAL; EXECUTE dicabut dari authenticated.
  - `public.punya_produk(p_product_id uuid) returns boolean`. Sekarang mensyaratkan belum kedaluwarsa; authenticated.
  - `public.pernah_punya_produk(p_product_id uuid) returns boolean`. Tidak dicabut, berapa pun masa berlakunya; authenticated.
  - `public.boleh_buka_materi(p_material_id uuid) returns boolean`; authenticated.
  - Policy baca isi: `files`/`pages` → `boleh_buka_materi(material_id)`. Baca metadata pemilik: `digital_products`/`sections`/`materials` → `pernah_punya_produk(...)`.

- [ ] **Step 1: Tulis uji yang gagal**

Create `web/tests/produk-materi-akses-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

/**
 * Enam keadaan akses, diuji dengan SESI KLIEN SUNGGUHAN. Kegagalan RLS pulang
 * sebagai `[]`, bukan galat, sehingga uji ber-service-role buta terhadapnya.
 */
const svc = createAdminSupabase();
const KLIEN = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

let produkId: string;
let materiTerkunci: string;
let materiPratinjau: string;

async function bacaHalaman(email: string | null, materiId: string) {
  const sb = email ? await signInAs(email) : anonClient();
  const { data } = await sb.from("digital_product_pages").select("objek").eq("material_id", materiId);
  return data ?? [];
}

async function pasangEntitlement(opsi: { berlakuSampai: string | null; dicabut?: boolean }) {
  await svc.from("digital_entitlements").delete()
    .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", produkId);
  const { error } = await svc.from("digital_entitlements").insert({
    client_id: ANANDA_CLIENT_ID,
    product_id: produkId,
    sumber: "gratis",
    berlaku_sampai: opsi.berlakuSampai,
    dicabut_pada: opsi.dicabut ? new Date().toISOString() : null,
  });
  if (error) throw error;
}

beforeAll(async () => {
  const { data: p, error } = await svc.from("digital_products")
    .insert({ judul: "PAD-UJI Akses Materi", slug: "pad-uji-akses-materi", aktif: true })
    .select("id").single();
  if (error) throw error;
  produkId = p!.id;
  const { data: bab } = await svc.from("digital_product_sections")
    .insert({ product_id: produkId, judul: "Bab" }).select("id").single();
  const { data: m1 } = await svc.from("digital_product_materials")
    .insert({ section_id: bab!.id, product_id: produkId, judul: "Terkunci", jenis: "pdf" })
    .select("id").single();
  const { data: m2 } = await svc.from("digital_product_materials")
    .insert({ section_id: bab!.id, product_id: produkId, judul: "Pratinjau", jenis: "pdf", pratinjau: true })
    .select("id").single();
  materiTerkunci = m1!.id;
  materiPratinjau = m2!.id;
  await svc.rpc("ganti_halaman_materi_produk", { p_material_id: materiTerkunci, p_halaman: [{ halaman: 1, objek: "a/1.webp" }] });
  await svc.rpc("ganti_halaman_materi_produk", { p_material_id: materiPratinjau, p_halaman: [{ halaman: 1, objek: "b/1.webp" }] });
});

afterAll(async () => {
  await svc.from("digital_entitlements").delete().eq("product_id", produkId);
  await svc.from("digital_products").delete().eq("id", produkId);
});

describe("boleh_buka_materi lewat RLS halaman", () => {
  it("1. pemilik aktif (selamanya) membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: null });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toHaveLength(1);
  });

  it("2. pemilik yang masa berlakunya masih jalan membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toHaveLength(1);
  });

  it("3. pemilik KEDALUWARSA tidak membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: new Date(Date.now() - 60_000).toISOString() });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toEqual([]);
  });

  it("4. pemilik DICABUT tidak membuka materi terkunci", async () => {
    await pasangEntitlement({ berlakuSampai: null, dicabut: true });
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toEqual([]);
  });

  it("5. non-pembeli yang login membuka materi PRATINJAU tapi tidak yang terkunci", async () => {
    await svc.from("digital_entitlements").delete().eq("product_id", produkId);
    expect(await bacaHalaman(KLIEN, materiPratinjau)).toHaveLength(1);
    expect(await bacaHalaman(KLIEN, materiTerkunci)).toEqual([]);
  });

  it("6. anon tidak membuka apa pun, termasuk pratinjau", async () => {
    expect(await bacaHalaman(null, materiPratinjau)).toEqual([]);
  });

  it("pratinjau produk NONAKTIF tertutup bagi non-pembeli", async () => {
    await svc.from("digital_products").update({ aktif: false }).eq("id", produkId);
    expect(await bacaHalaman(KLIEN, materiPratinjau)).toEqual([]);
    await svc.from("digital_products").update({ aktif: true }).eq("id", produkId);
  });
});

describe("punya_produk & pernah_punya_produk", () => {
  it("punya_produk false saat kedaluwarsa, pernah_punya_produk tetap true", async () => {
    await pasangEntitlement({ berlakuSampai: new Date(Date.now() - 60_000).toISOString() });
    const klien = await signInAs(KLIEN);
    const { data: punya } = await klien.rpc("punya_produk", { p_product_id: produkId });
    const { data: pernah } = await klien.rpc("pernah_punya_produk", { p_product_id: produkId });
    expect(punya).toBe(false);
    expect(pernah).toBe(true);
  });

  it("pemilik kedaluwarsa tetap membaca baris produk NONAKTIF lewat embed", async () => {
    await svc.from("digital_products").update({ aktif: false }).eq("id", produkId);
    const klien = await signInAs(KLIEN);
    const { data } = await klien.from("digital_entitlements")
      .select("product_id, digital_products(judul)")
      .eq("product_id", produkId)
      .single();
    expect(data?.digital_products).not.toBeNull();
    await svc.from("digital_products").update({ aktif: true }).eq("id", produkId);
  });

  it("akses_aktif tidak bisa dipanggil pemegang sesi", async () => {
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("akses_aktif", { p_client_id: ANANDA_CLIENT_ID, p_product_id: produkId });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `docker info >/dev/null 2>&1 && npx vitest run tests/produk-materi-akses-db.test.ts`
Expected: FAIL. Kolom `berlaku_sampai` belum ada, dan policy baca isi untuk pembeli belum ada, sehingga keadaan 1 memulangkan `[]`. Bila Docker MATI: tandai **TERTUNDA**.

- [ ] **Step 3: Tulis migrasi**

Create `web/supabase/migrations/20261016110000_produk_akses_masa_berlaku.sql`:

```sql
-- ===========================================================================
-- AKSES BERMASA BERLAKU (spec 2026-10-16)
-- ===========================================================================
-- Spec 20 September menetapkan "akses selamanya"; keputusan itu DIBALIK.
-- "Punya produk" kini berarti: ada entitlement milik pemanggil, belum
-- dicabut, DAN belum kedaluwarsa.

alter table public.digital_entitlements
  add column berlaku_sampai timestamptz;

comment on column public.digital_entitlements.berlaku_sampai is
  'Batas akses. NULL = selamanya. DIBEKUKAN saat akses terbit (durasi beku '
  'pesanan, atau durasi produk untuk ambil gratis) — mengubah durasi produk '
  'tidak menyentuh pembeli lama. Kedaluwarsa BUKAN pencabutan: beli ulang '
  'memperbarui kolom ini, sedangkan dicabut_pada tidak pernah hidup lagi '
  'karena pembelian.';

-- ===== PREDIKAT =====
-- SATU kalimat "akses aktif", dipakai setiap fungsi yang menolak pembelian
-- ganda (Task 3) dan oleh punya_produk di bawah. Internal: dipanggil dengan
-- client_id sembarang, jadi tidak boleh terbuka bagi pemegang sesi.
create or replace function public.akses_aktif(p_client_id uuid, p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.digital_entitlements e
     where e.client_id = p_client_id
       and e.product_id = p_product_id
       and e.dicabut_pada is null
       and (e.berlaku_sampai is null or e.berlaku_sampai > now())
  );
$$;

revoke all on function public.akses_aktif(uuid, uuid) from public, anon, authenticated;

create or replace function public.punya_produk(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.akses_aktif(
      (select c.id from public.clients c where c.user_id = auth.uid()),
      p_product_id),
    false);
$$;

comment on function public.punya_produk(uuid) is
  'Satu definisi "boleh akses isi produk ini": entitlement milik pemanggil, '
  'belum dicabut, belum kedaluwarsa. Dipakai gerbang isi (lewat '
  'boleh_buka_materi), rute unduh, dan peramban.';

-- Metadata (judul, slug, daftar materi) tetap terbaca oleh pemilik yang
-- aksesnya kedaluwarsa. Tanpa ini, produk NONAKTIF yang aksesnya habis
-- memulangkan `null` di embed `produkSaya` dan hilang diam-diam dari
-- "Pembelian Saya" — padahal seharusnya tampil "Masa berlaku habis".
create or replace function public.pernah_punya_produk(p_product_id uuid)
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

-- Pratinjau hanya untuk produk TAYANG: produk yang dinonaktifkan berhenti
-- dijual, dan pratinjaunya adalah bagian dari penjualan itu. Pemilik tetap
-- membuka semuanya lewat punya_produk.
create or replace function public.boleh_buka_materi(p_material_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.digital_product_materials m
      join public.digital_products p on p.id = m.product_id
     where m.id = p_material_id
       and (public.punya_produk(m.product_id) or (m.pratinjau and p.aktif))
  );
$$;

revoke all on function public.pernah_punya_produk(uuid) from public, anon;
revoke all on function public.boleh_buka_materi(uuid) from public, anon;
grant execute on function public.pernah_punya_produk(uuid) to authenticated;
grant execute on function public.boleh_buka_materi(uuid) to authenticated;
-- punya_produk: haknya ditetapkan di 20260921120000 dan tidak berubah oleh
-- CREATE OR REPLACE; ditulis ulang di sini supaya niatnya terbaca.
revoke all on function public.punya_produk(uuid) from public, anon;
grant execute on function public.punya_produk(uuid) to authenticated;

-- ===== POLICY =====
drop policy if exists "produk: pemilik entitlement baca" on public.digital_products;
create policy "produk: pemilik entitlement baca" on public.digital_products for select
  to authenticated
  using (public.pernah_punya_produk(id));

create policy "bab produk: pemilik baca" on public.digital_product_sections for select
  to authenticated
  using (public.pernah_punya_produk(product_id));
create policy "materi produk: pemilik baca" on public.digital_product_materials for select
  to authenticated
  using (public.pernah_punya_produk(product_id));

create policy "berkas materi: boleh buka" on public.digital_product_files for select
  to authenticated
  using (public.boleh_buka_materi(material_id));
create policy "halaman materi: boleh buka" on public.digital_product_pages for select
  to authenticated
  using (public.boleh_buka_materi(material_id));
```

- [ ] **Step 4: Terapkan & jalankan uji**

Run: `docker info >/dev/null 2>&1 && npx supabase migration up && npx vitest run tests/produk-materi-akses-db.test.ts tests/produk-materi-skema-db.test.ts`
Expected: PASS semua. Bila Docker MATI: tandai **TERTUNDA**.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/20261016110000_produk_akses_masa_berlaku.sql web/tests/produk-materi-akses-db.test.ts
git commit -m "feat(produk): akses bermasa berlaku, pratinjau materi, pernah_punya untuk metadata

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migrasi alur bayar — durasi beku, beli ulang, gerbang menggantung tunggal

**Files:**
- Create: `web/supabase/migrations/20261016120000_produk_masa_berlaku_pesanan.sql`
- Create: `web/tests/produk-masa-berlaku-pesanan-db.test.ts`

**Interfaces:**
- Consumes: `akses_aktif(uuid, uuid)` (Task 2), `digital_products.masa_berlaku_bulan` (Task 1).
- Produces (SQL):
  - `order_items.masa_berlaku_bulan_beku int null`
  - `public.pembayaran_produk_menggantung(p_client_id uuid, p_product_id uuid) returns boolean`, internal
  - Fungsi ditulis ulang tanpa perubahan tanda tangan: `punya_pesanan_menunggu`, `tambah_ke_keranjang`, `baca_keranjang`, `buat_pesanan_keranjang`, `terbitkan_akses_item`, `ambil_produk_gratis`, `bersihkan_keranjang_saat_akses`; trigger `keranjang_bersih_saat_akses`
  - Nilai balik `terbitkan_akses_item` TETAP tiga: `akses_terbit`, `akses_sudah_ada`, `akses_tertahan`. Pembaruan entitlement kedaluwarsa memulangkan `akses_terbit`.

- [ ] **Step 1: Tulis uji yang gagal**

Create `web/tests/produk-masa-berlaku-pesanan-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

/**
 * Masa berlaku di alur bayar (spec 2026-10-16, "Masa berlaku dalam alur
 * bayar"). Cabang penerbitan & webhook kembar TIDAK terlihat saat menguji
 * manual — butuh menunggu kedaluwarsa atau memalsukan notifikasi Midtrans.
 */
const svc = createAdminSupabase();
const KLIEN = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const produkUji: string[] = [];
let nomor = 0;

async function semaiProduk(harga: number, bulan: number | null): Promise<string> {
  nomor += 1;
  const { data, error } = await svc.from("digital_products")
    .insert({ judul: `PAD-UJI Masa ${nomor}`, slug: `pad-uji-masa-${nomor}-${Date.now()}`, aktif: true, masa_berlaku_bulan: bulan })
    .select("id").single();
  if (error) throw error;
  produkUji.push(data!.id);
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  return data!.id;
}

async function semaiPesananLunas(produkId: string, bulanBeku: number | null) {
  nomor += 1;
  const { data: o, error } = await svc.from("orders").insert({
    kode: `PSN-261016-${nomor.toString().padStart(6, "0")}`,
    client_id: ANANDA_CLIENT_ID,
    jumlah_item: 1,
    status: "lunas",
    lunas_pada: new Date().toISOString(),
    ditutup_pada: new Date().toISOString(),
  }).select("id").single();
  if (error) throw error;
  const { data: i, error: ei } = await svc.from("order_items").insert({
    pesanan_id: o!.id, jenis: "produk_digital", product_id: produkId,
    judul_beku: "Uji", harga_beku: 10_000, urutan: 1, masa_berlaku_bulan_beku: bulanBeku,
  }).select("id").single();
  if (ei) throw ei;
  return { pesananId: o!.id, itemId: i!.id };
}

async function entitlement(produkId: string) {
  const { data } = await svc.from("digital_entitlements")
    .select("berlaku_sampai, dicabut_pada, pesanan_id, sumber")
    .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", produkId).maybeSingle();
  return data;
}

/**
 * Pola pembersihan yang SAMA dengan tests/pesanan-checkout-db.test.ts:
 * `pesanan_terbuka_satu_per_klien` adalah indeks unik GLOBAL, jadi sisa
 * pesanan Ananda dari run lain memerahkan setiap berkas uji pesanan. Jejak &
 * notifikasi dihapus lebih dulu karena FK-nya.
 */
async function bersihkan(): Promise<void> {
  await svc.from("cart_items").delete().eq("client_id", ANANDA_CLIENT_ID);
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);
  const { data: pesanan } = await svc.from("orders").select("id").eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) {
    await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
  }
}

beforeAll(bersihkan);
afterEach(bersihkan);

describe("terbitkan_akses_item", () => {
  it("(1) belum ada → berlaku_sampai = sekarang + durasi BEKU", async () => {
    const p = await semaiProduk(10_000, 3);
    const { itemId } = await semaiPesananLunas(p, 9);
    const { data } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(data).toBe("akses_terbit");
    const e = await entitlement(p);
    const selisihHari = (new Date(e!.berlaku_sampai!).getTime() - Date.now()) / 86_400_000;
    // 9 bulan beku, BUKAN 3 bulan produk.
    expect(selisihHari).toBeGreaterThan(260);
    expect(selisihHari).toBeLessThan(280);
  });

  it("(1) durasi beku NULL → selamanya", async () => {
    const p = await semaiProduk(10_000, null);
    const { itemId } = await semaiPesananLunas(p, null);
    await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect((await entitlement(p))!.berlaku_sampai).toBeNull();
  });

  it("(2b) kedaluwarsa → diperbarui; notifikasi kembar jatuh ke (2a)", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
    });
    const { pesananId, itemId } = await semaiPesananLunas(p, 1);

    const { data: pertama } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(pertama).toBe("akses_terbit");
    const e1 = await entitlement(p);
    expect(new Date(e1!.berlaku_sampai!).getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
    expect(e1!.pesanan_id).toBe(pesananId);

    const { data: kedua } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(kedua).toBe("akses_sudah_ada");
    const e2 = await entitlement(p);
    expect(e2!.berlaku_sampai).toBe(e1!.berlaku_sampai);
  });

  it("(3) dicabut tetap mati walau dibeli ulang", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
      dicabut_pada: new Date().toISOString(),
    });
    const { itemId } = await semaiPesananLunas(p, 1);
    const { data } = await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    expect(data).toBe("akses_tertahan");
    expect((await entitlement(p))!.dicabut_pada).not.toBeNull();
  });
});

describe("gerbang beli", () => {
  it("produk dengan akses AKTIF ditolak keranjang", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli",
      berlaku_sampai: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("tambah_ke_keranjang", { p_product_id: p });
    expect(error?.message).toMatch(/sudah memiliki/);
  });

  it("produk KEDALUWARSA dengan pesanan lunas lama bisa dibeli lagi", async () => {
    const p = await semaiProduk(10_000, 1);
    const { itemId } = await semaiPesananLunas(p, 1);
    await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    // Majukan waktu: akses habis.
    await svc.from("digital_entitlements")
      .update({ berlaku_sampai: new Date(Date.now() - 60_000).toISOString() })
      .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", p);

    const klien = await signInAs(KLIEN);
    const { data: menunggu } = await klien.rpc("punya_pesanan_menunggu", { p_product_id: p });
    expect(menunggu).toBe(false);
    const { error } = await klien.rpc("tambah_ke_keranjang", { p_product_id: p });
    expect(error).toBeNull();
    const { data: isi } = await klien.rpc("baca_keranjang");
    expect((isi ?? []).find((r: { product_id: string }) => r.product_id === p)?.keadaan).toBe("siap");
  });

  it("pesanan lunas yang aksesnya TERTAHAN tetap menggantung", async () => {
    const p = await semaiProduk(10_000, 1);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "beli", dicabut_pada: new Date().toISOString(),
    });
    const { itemId } = await semaiPesananLunas(p, 1);
    await svc.rpc("terbitkan_akses_item", { p_item_id: itemId });
    const klien = await signInAs(KLIEN);
    const { data } = await klien.rpc("punya_pesanan_menunggu", { p_product_id: p });
    expect(data).toBe(true);
  });

  it("buat_pesanan membekukan masa berlaku produk ke order_items", async () => {
    const p = await semaiProduk(10_000, 6);
    const klien = await signInAs(KLIEN);
    const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: p });
    expect(error).toBeNull();
    const pesananId = (data as Array<{ pesanan_id: string }>)[0].pesanan_id;
    const { data: item } = await svc.from("order_items")
      .select("masa_berlaku_bulan_beku").eq("pesanan_id", pesananId).single();
    expect(item!.masa_berlaku_bulan_beku).toBe(6);
  });
});

describe("ambil_produk_gratis", () => {
  it("kedaluwarsa → diperbarui dengan durasi produk; dicabut → tidak", async () => {
    const p = await semaiProduk(0, 2);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: p, sumber: "gratis",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
    });
    const klien = await signInAs(KLIEN);
    await klien.rpc("ambil_produk_gratis", { p_product_id: p });
    const e = await entitlement(p);
    expect(new Date(e!.berlaku_sampai!).getTime()).toBeGreaterThan(Date.now() + 50 * 86_400_000);

    await svc.from("digital_entitlements")
      .update({ berlaku_sampai: new Date(Date.now() - 60_000).toISOString(), dicabut_pada: new Date().toISOString() })
      .eq("client_id", ANANDA_CLIENT_ID).eq("product_id", p);
    await klien.rpc("ambil_produk_gratis", { p_product_id: p });
    expect(new Date((await entitlement(p))!.berlaku_sampai!).getTime()).toBeLessThan(Date.now());
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `docker info >/dev/null 2>&1 && npx vitest run tests/produk-masa-berlaku-pesanan-db.test.ts`
Expected: FAIL. Kolom `masa_berlaku_bulan_beku` belum ada. Bila Docker MATI: tandai **TERTUNDA**.

- [ ] **Step 3: Tulis migrasi, bagian A (kolom, pembantu, fungsi pendek)**

Create `web/supabase/migrations/20261016120000_produk_masa_berlaku_pesanan.sql`:

```sql
-- ===========================================================================
-- MASA BERLAKU DI ALUR BAYAR (spec 2026-10-16)
-- ===========================================================================

-- ===== 1. DURASI BEKU =====
-- Sepasang dengan judul_beku & harga_beku: pembeli yang membayar sesudah
-- melihat "9 Bulan" mendapat 9 bulan, walaupun owner mengubahnya saat
-- pesanannya masih menunggu bayar. order_items append-only (trigger
-- item_pesanan_beku) — kolom ini hanya pernah diisi saat INSERT.
alter table public.order_items
  add column masa_berlaku_bulan_beku int
    check (masa_berlaku_bulan_beku is null or masa_berlaku_bulan_beku between 1 and 120);

-- ===== 2. "PEMBAYARAN MENGGANTUNG" — SATU DEFINISI =====
-- P1 menulis kriteria ini DUA KALI (punya_pesanan_menunggu & gerbang
-- buat_pesanan_keranjang) dengan catatan "WAJIB cermin". Keduanya
-- menganggap SETIAP pesanan `lunas` menggantung — aman selama akses
-- selamanya, karena layar memeriksa entitlement lebih dulu. Dengan masa
-- berlaku, pesanan lunas lama yang aksesnya sudah habis akan memblokir beli
-- ulang SELAMANYA.
--
-- Kini: pesanan beruang menggantung HANYA bila belum ada entitlement tak
-- dicabut yang terbit SESUDAH pesanan itu dibuat. `dibuat_pada`, bukan
-- `lunas_pada`: pesanan `lunas_setelah_tutup` berstatus kedaluwarsa/
-- dibatalkan dan tidak selalu punya lunas_pada. Entitlement yang dicabut
-- tidak pernah menyelesaikan apa pun — `akses_tertahan` tetap menggantung,
-- persis seperti hari ini.
create or replace function public.pembayaran_produk_menggantung(
  p_client_id uuid,
  p_product_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.orders o
      join public.order_items i on i.pesanan_id = o.id
     where o.client_id = p_client_id
       and i.product_id = p_product_id
       and (
         o.status = any (array['ditahan','lunas']::public.order_status[])
         or o.sebab_tinjauan = 'lunas_setelah_tutup'
       )
       and not exists (
         select 1
           from public.digital_entitlements e
          where e.client_id = o.client_id
            and e.product_id = i.product_id
            and e.dicabut_pada is null
            and e.diberikan_pada >= o.dibuat_pada
       )
  );
$$;

revoke all on function public.pembayaran_produk_menggantung(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.punya_pesanan_menunggu(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with klien as (select c.id from public.clients c where c.user_id = auth.uid())
  select exists (
           select 1
             from public.orders o
             join public.order_items i on i.pesanan_id = o.id
            where o.client_id = (select id from klien)
              and i.product_id = p_product_id
              and o.status = 'menunggu_bayar'
         )
      or coalesce(public.pembayaran_produk_menggantung((select id from klien), p_product_id), false);
$$;

comment on function public.punya_pesanan_menunggu(uuid) is
  'Benar bila pemanggil punya pesanan menunggu_bayar untuk produk ini, atau '
  'pembayaran yang belum melahirkan akses (pembayaran_produk_menggantung). '
  'Urutan layar: entitlement aktif dulu, lalu fungsi ini, baru tombol beli.';

revoke all on function public.punya_pesanan_menunggu(uuid) from public, anon;
grant execute on function public.punya_pesanan_menunggu(uuid) to authenticated;

-- ===== 3. KERANJANG =====
create or replace function public.tambah_ke_keranjang(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga integer;
  v_isi integer;
begin
  select c.id into v_client_id from public.clients c where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  select h.harga into v_harga
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;
  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;
  if v_harga = 0 then
    raise exception 'Produk ini gratis — ambil lewat tombolnya.' using errcode = 'P0001';
  end if;

  -- AKTIF, bukan sekadar ada: akses yang kedaluwarsa boleh dibeli lagi.
  if public.akses_aktif(v_client_id, p_product_id) then
    raise exception 'Anda sudah memiliki produk ini.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.cart_items k
     where k.client_id = v_client_id and k.product_id = p_product_id
  ) then
    return;
  end if;

  select count(*) into v_isi from public.cart_items k where k.client_id = v_client_id;
  if v_isi >= 20 then
    raise exception 'Keranjang penuh — paling banyak 20 produk.' using errcode = 'P0001';
  end if;

  insert into public.cart_items (client_id, product_id)
  values (v_client_id, p_product_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.tambah_ke_keranjang(uuid) from public, anon;
grant execute on function public.tambah_ke_keranjang(uuid) to authenticated;

create or replace function public.baca_keranjang()
returns table (
  product_id uuid,
  judul text,
  slug text,
  harga integer,
  keadaan text,
  ditambahkan_pada timestamptz
)
language sql stable security definer set search_path = public
as $$
  select k.product_id,
         p.judul,
         p.slug,
         h.harga,
         case
           when not p.aktif or h.harga is null then 'tidak_tersedia'
           when h.harga = 0 then 'gratis'
           when public.akses_aktif(k.client_id, k.product_id) then 'sudah_dimiliki'
           when public.punya_pesanan_menunggu(k.product_id) then 'diproses'
           else 'siap'
         end,
         k.ditambahkan_pada
    from public.cart_items k
    join public.clients c on c.id = k.client_id
    join public.digital_products p on p.id = k.product_id
    left join public.harga_produk_publik h on h.product_id = k.product_id
   where c.user_id = auth.uid()
   order by k.ditambahkan_pada, k.product_id;
$$;

revoke all on function public.baca_keranjang() from public, anon;
grant execute on function public.baca_keranjang() to authenticated;

-- Pembersihan keranjang kini juga menyala saat entitlement DIPERBARUI
-- (beli ulang sesudah kedaluwarsa), bukan hanya saat lahir/dicabut.
create or replace function public.bersihkan_keranjang_saat_akses()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.dicabut_pada is null
     and (new.berlaku_sampai is null or new.berlaku_sampai > now()) then
    delete from public.cart_items k
     where k.client_id = new.client_id and k.product_id = new.product_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bersihkan_keranjang_saat_akses() from public, anon, authenticated;

drop trigger keranjang_bersih_saat_akses on public.digital_entitlements;
create trigger keranjang_bersih_saat_akses
  after insert or update of dicabut_pada, berlaku_sampai on public.digital_entitlements
  for each row execute function public.bersihkan_keranjang_saat_akses();

-- ===== 4. AMBIL GRATIS =====
create or replace function public.ambil_produk_gratis(p_product_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga int;
  v_bulan int;
  v_sampai timestamptz;
  v_id uuid;
begin
  select c.id into v_client_id from public.clients c where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  select h.harga, p.masa_berlaku_bulan into v_harga, v_bulan
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;

  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;
  if v_harga <> 0 then
    raise exception 'Produk ini berbayar.' using errcode = 'P0001';
  end if;

  -- Produk gratis tidak punya pesanan, jadi tidak ada durasi beku: durasi
  -- produk SAAT INI yang dipakai.
  v_sampai := case when v_bulan is null then null
                   else now() + make_interval(months => v_bulan) end;

  -- `do update` HANYA untuk baris yang kedaluwarsa dan TIDAK dicabut.
  -- Pengambilan ulang tidak pernah menghidupkan entitlement yang dicabut
  -- admin, dan tidak memperpanjang akses yang masih berjalan.
  insert into public.digital_entitlements (client_id, product_id, sumber, berlaku_sampai)
  values (v_client_id, p_product_id, 'gratis', v_sampai)
  on conflict (client_id, product_id) do update
     set berlaku_sampai = excluded.berlaku_sampai,
         diberikan_pada = now(),
         sumber = 'gratis'
   where digital_entitlements.dicabut_pada is null
     and digital_entitlements.berlaku_sampai is not null
     and digital_entitlements.berlaku_sampai <= now()
  returning id into v_id;

  if v_id is null then
    select e.id into v_id from public.digital_entitlements e
     where e.client_id = v_client_id and e.product_id = p_product_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.ambil_produk_gratis(uuid) from public, anon;
grant execute on function public.ambil_produk_gratis(uuid) to authenticated;
```

- [ ] **Step 4: Tulis migrasi, bagian B: `buat_pesanan_keranjang`**

Tambahkan ke berkas yang sama sebuah `create or replace function public.buat_pesanan_keranjang(p_product_ids uuid[], p_ulang boolean default false)`. Isinya **salinan utuh** baris 43–292 dari `web/supabase/migrations/20261002110000_keranjang_pesanan.sql`: fungsi, `comment on function`, dan baris `revoke`/`grant`-nya. Tempelkan ke ujung migrasi dengan:

```bash
sed -n '43,292p' web/supabase/migrations/20261002110000_keranjang_pesanan.sql >> web/supabase/migrations/20261016120000_produk_masa_berlaku_pesanan.sql
```

Periksa bahwa baris terakhir yang tertempel adalah `grant execute on function public.buat_pesanan_keranjang(uuid[], boolean) to authenticated;`. Lalu sunting bagian yang tertempel dengan EMPAT perubahan persis berikut:

(a) Di blok `declare`, sesudah `v_harga_arr integer[] := '{}';`, tambahkan:

```sql
  v_bulan integer;
  v_bulan_arr integer[] := '{}';
```

(b) Di dalam `for idx in 1 .. v_n loop`, ganti

```sql
    v_judul := null;
    v_harga := null;

    select p.judul, h.harga into v_judul, v_harga
```

dengan

```sql
    v_judul := null;
    v_harga := null;
    v_bulan := null;

    select p.judul, h.harga, p.masa_berlaku_bulan into v_judul, v_harga, v_bulan
```

(c) Ganti blok kepemilikan

```sql
    if exists (
      select 1
        from public.digital_entitlements e
       where e.client_id = v_client_id
         and e.product_id = v_id
         and e.dicabut_pada is null
    ) then
```

dengan

```sql
    -- AKTIF, bukan sekadar ada: akses yang kedaluwarsa boleh dibeli lagi.
    if public.akses_aktif(v_client_id, v_id) then
```

lalu ganti blok tinjauan

```sql
    if exists (
      select 1
        from public.orders o
        join public.order_items oi on oi.pesanan_id = o.id
       where o.client_id = v_client_id
         and oi.product_id = v_id
         and (
           o.status = any (array['ditahan','lunas']::public.order_status[])
           or o.sebab_tinjauan = 'lunas_setelah_tutup'
         )
    ) then
```

dengan

```sql
    -- Satu definisi bersama punya_pesanan_menunggu (lihat atas).
    if public.pembayaran_produk_menggantung(v_client_id, v_id) then
```

(d) Sesudah `v_harga_arr := v_harga_arr || v_harga;` tambahkan `v_bulan_arr := v_bulan_arr || v_bulan;`. Lalu ganti INSERT item:

```sql
    insert into public.order_items (
      pesanan_id, jenis, product_id, judul_beku, harga_beku, urutan
    )
    select v_pesanan_id, 'produk_digital', v_ids[k], v_judul_arr[k], v_harga_arr[k], k
      from generate_series(1, v_n) as k;
```

dengan

```sql
    insert into public.order_items (
      pesanan_id, jenis, product_id, judul_beku, harga_beku, masa_berlaku_bulan_beku, urutan
    )
    select v_pesanan_id, 'produk_digital', v_ids[k], v_judul_arr[k], v_harga_arr[k], v_bulan_arr[k], k
      from generate_series(1, v_n) as k;
```

Kalimat galat lain TIDAK berubah, karena uji P1/P2 bergantung pada kalimatnya. `buat_pesanan(uuid, boolean)` tidak ditulis ulang; ia pembungkus.

Periksa: `grep -c "pembayaran_produk_menggantung\|akses_aktif\|v_bulan_arr" web/supabase/migrations/20261016120000_produk_masa_berlaku_pesanan.sql` harus ≥ 7.

- [ ] **Step 5: Tulis migrasi, bagian C: `terbitkan_akses_item`**

Tambahkan `create or replace function public.terbitkan_akses_item(p_item_id uuid) returns text`. Isinya **salinan utuh** baris 61–174 dari `web/supabase/migrations/20260927100000_sebab_tinjauan_lestari.sql`:

```bash
sed -n '61,174p' web/supabase/migrations/20260927100000_sebab_tinjauan_lestari.sql >> web/supabase/migrations/20261016120000_produk_masa_berlaku_pesanan.sql
```

Baris terakhir yang tertempel harus `$$;`. Sunting bagian yang tertempel dengan perubahan berikut:

(a) Di `declare`, sesudah `v_baru uuid;`, tambahkan:

```sql
  v_bulan integer;
  v_sampai timestamptz;
  v_sampai_baru timestamptz;
```

(b) SELECT pertama mengambil durasi beku. Ganti

```sql
  select i.pesanan_id, i.product_id, i.jenis, o.client_id, c.padma_id
    into v_pesanan_id, v_product_id, v_jenis, v_client_id, v_padma_id
```

dengan

```sql
  select i.pesanan_id, i.product_id, i.jenis, o.client_id, c.padma_id, i.masa_berlaku_bulan_beku
    into v_pesanan_id, v_product_id, v_jenis, v_client_id, v_padma_id, v_bulan
```

Sesudah blok `if v_jenis <> 'produk_digital' ... end if;` tambahkan:

```sql
  -- Dihitung SEJAK AKSES TERBIT (now()), bukan sejak lunas_pada: di alur
  -- otomatis selisihnya detik, dan pesanan yang tertahan lalu diterbitkan
  -- admin berhari-hari kemudian tidak memakan masa berlaku pembeli.
  -- Dikonfirmasi pemilik repo 16 Okt 2026.
  v_sampai_baru := case when v_bulan is null then null
                        else now() + make_interval(months => v_bulan) end;
```

(c) KEDUA `select e.id, e.dicabut_pada into v_ent_id, v_dicabut` (yang `for update` dan yang di cabang balapan) menjadi:

```sql
  select e.id, e.dicabut_pada, e.berlaku_sampai into v_ent_id, v_dicabut, v_sampai
```

(d) INSERT cabang (1) menjadi:

```sql
    insert into public.digital_entitlements (client_id, product_id, sumber, pesanan_id, berlaku_sampai)
    values (v_client_id, v_product_id, 'beli', v_pesanan_id, v_sampai_baru)
```

(e) Ganti kepala cabang (2) `-- (2) ADA DAN BELUM DICABUT` / `if v_dicabut is null then` sampai `return 'akses_sudah_ada';` / `end if;` dengan:

```sql
  -- (2b) ADA, BELUM DICABUT, SUDAH KEDALUWARSA → beli ulang memperbarui.
  -- Dicatat sebagai akses_terbit (bukan nilai enum baru): memang penerbitan
  -- akses, dan himpunan kejadian di TypeScript tidak perlu tumbuh.
  -- Notifikasi kembar untuk pesanan yang sama jatuh ke (2a) di bawah, karena
  -- aksesnya baru saja menjadi aktif — tidak ada perpanjangan ganda.
  if v_dicabut is null and v_sampai is not null and v_sampai <= now() then
    update public.digital_entitlements e
       set berlaku_sampai = v_sampai_baru,
           pesanan_id = v_pesanan_id,
           sumber = 'beli',
           diberikan_pada = now()
     where e.id = v_ent_id;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'akses_terbit', format('diperbarui, produk %s', v_product_id));
    return 'akses_terbit';
  end if;

  -- (2a) ADA, BELUM DICABUT, MASIH AKTIF
  if v_dicabut is null then
    -- `sumber` TIDAK dinaikkan menjadi 'beli': entitlement gratis yang
    -- produknya kemudian dibeli tetap gratis. Yang mencatat pendapatan adalah
    -- `orders`, bukan kolom ini.
    update public.digital_entitlements e
       set pesanan_id = v_pesanan_id
     where e.id = v_ent_id and e.pesanan_id is null;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'akses_sudah_ada', format('produk %s', v_product_id));
    return 'akses_sudah_ada';
  end if;
```

Cabang (3) dan seluruh sisa badan tidak berubah. Berkas sumbernya tidak menulis hak untuk fungsi ini. `CREATE OR REPLACE` mempertahankan hak yang ada, tapi tetap tambahkan sesudah `$$;`, karena fungsi ini anggota `MESIN_TERTUTUP`:

```sql
revoke all on function public.terbitkan_akses_item(uuid) from public, anon, authenticated;
```

- [ ] **Step 6: Terapkan & jalankan uji, termasuk uji P1/P2 yang menyentuh fungsi ini**

Run: `docker info >/dev/null 2>&1 && npx supabase migration up && npx vitest run tests/produk-masa-berlaku-pesanan-db.test.ts`
Expected: PASS. Uji P1/P2 lama (`pesanan-*`, `keranjang-*`) masih meng-insert `jenis` di `digital_products` dan baru dijalankan di Task 11. Bila Docker MATI: tandai **TERTUNDA**.

- [ ] **Step 7: Commit**

```bash
git add web/supabase/migrations/20261016120000_produk_masa_berlaku_pesanan.sql web/tests/produk-masa-berlaku-pesanan-db.test.ts
git commit -m "feat(pesanan): durasi beku, beli ulang sesudah kedaluwarsa, gerbang menggantung tunggal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pustaka — jenis materi, masa berlaku, nama objek

**Files:**
- Modify: `web/src/lib/produk/status.ts`
- Modify: `web/src/lib/produk/objek.ts` (seluruh isi diganti)
- Modify: `web/src/lib/produk/cap-pdf.ts:75-92`
- Create: `web/tests/produk-materi-status.test.ts`

**Interfaces:**
- Produces (dipakai Task 5–10):
  - `status.ts`:
    - `type JenisMateri = "video" | "pdf"`, `JENIS_MATERI`, `LABEL_JENIS_MATERI`
    - `periksaJenisMateri(teks: string): Periksa<JenisMateri>`
    - `periksaJudulBab(teks: string): Periksa<string>`
    - `periksaKeteranganMateri(teks: string): Periksa<string>`
    - `materiBerisi(jenis: JenisMateri, jumlahBerkas: number, jumlahHalaman: number): boolean`
    - `ringkasJumlahMateri(jenis: readonly JenisMateri[]): string`
    - `labelMasaBerlaku(bulan: number | null): string`
    - `periksaMasaBerlaku(satuan: string, jumlah: string): Periksa<number | null>`
    - `type StatusAkses`, `statusAkses(berlakuSampai: string | null, sekarang?: Date): StatusAkses`
    - `formatTanggalAkses(iso: string): string`
  - `objek.ts`:
    - `namaObjekVideoMateri(productId, materiId, mime: MimeVideo)`
    - `namaObjekHalamanMateri(productId, materiId, halaman)`
    - `namaObjekPdfMateri(productId, materiId)`
    - `MIME_SAMPUL`, `type MimeSampul`, `MAKS_BYTE_SAMPUL`
    - `periksaBerkasSampul(mime: string, byte: number): Periksa<MimeSampul>`
    - `namaObjekSampul(productId: string, materiId: string | null, mime: MimeSampul, acak: string): string`
    - `objekSampulSah(objek: string, productId: string, materiId: string | null): boolean`
    - `urlSampulPublik(objek: string | null): string | null`
  - `cap-pdf.ts`: `objekPdfPembeli(productId, materiId, clientId)`, `prefiksPdfPembeli(productId, materiId)`
  - DIBUANG dari `status.ts`: `JenisProduk`, `JENIS_SAH`, `LABEL_JENIS`, `punyaIsi`, `periksaJenis`, `PESAN_PRODUK.jenisTidakSah`

- [ ] **Step 1: Tulis uji yang gagal**

Create `web/tests/produk-materi-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ringkasJumlahMateri, labelMasaBerlaku, periksaMasaBerlaku, statusAkses, materiBerisi,
} from "@/lib/produk/status";
import {
  namaObjekVideoMateri, namaObjekHalamanMateri, namaObjekPdfMateri,
  namaObjekSampul, objekSampulSah, periksaBerkasSampul,
} from "@/lib/produk/objek";
import { objekPdfPembeli, prefiksPdfPembeli } from "@/lib/produk/cap-pdf";

const P = "11111111-1111-1111-1111-111111111111";
const M = "22222222-2222-2222-2222-222222222222";
const A = "33333333-3333-3333-3333-333333333333";

describe("ringkasJumlahMateri", () => {
  it("menghitung per jenis dengan label klien", () => {
    expect(ringkasJumlahMateri([...Array(11).fill("video"), "pdf"])).toBe("11 Video · 1 Artikel");
  });
  it("jenis yang nol tidak ditampilkan", () => {
    expect(ringkasJumlahMateri(["pdf", "pdf"])).toBe("2 Artikel");
    expect(ringkasJumlahMateri([])).toBe("");
  });
});

describe("masa berlaku", () => {
  it.each([
    [null, "Selamanya"], [1, "1 Bulan"], [9, "9 Bulan"], [12, "1 Tahun"], [24, "2 Tahun"], [18, "18 Bulan"],
  ])("labelMasaBerlaku(%s) = %s", (bulan, label) => {
    expect(labelMasaBerlaku(bulan)).toBe(label);
  });

  it("periksaMasaBerlaku", () => {
    expect(periksaMasaBerlaku("selamanya", "")).toEqual({ ok: true, nilai: null });
    expect(periksaMasaBerlaku("bulan", "9")).toEqual({ ok: true, nilai: 9 });
    expect(periksaMasaBerlaku("tahun", "2")).toEqual({ ok: true, nilai: 24 });
    expect(periksaMasaBerlaku("bulan", "0").ok).toBe(false);
    expect(periksaMasaBerlaku("tahun", "11").ok).toBe(false);
    expect(periksaMasaBerlaku("bulan", "1.5").ok).toBe(false);
    expect(periksaMasaBerlaku("minggu", "3").ok).toBe(false);
  });

  it("statusAkses", () => {
    const kini = new Date("2026-10-16T05:00:00Z");
    expect(statusAkses(null, kini)).toEqual({ keadaan: "selamanya" });
    expect(statusAkses("2027-07-12T05:00:00Z", kini).keadaan).toBe("aktif");
    expect(statusAkses("2026-10-16T04:59:59Z", kini).keadaan).toBe("habis");
  });
});

describe("materiBerisi", () => {
  it("video butuh berkas, PDF butuh halaman", () => {
    expect(materiBerisi("video", 1, 0)).toBe(true);
    expect(materiBerisi("video", 0, 5)).toBe(false);
    expect(materiBerisi("pdf", 1, 0)).toBe(false);
    expect(materiBerisi("pdf", 0, 3)).toBe(true);
  });
});

describe("nama objek per materi", () => {
  it("isi", () => {
    expect(namaObjekVideoMateri(P, M, "video/mp4")).toBe(`produk/${P}/${M}/isi.mp4`);
    expect(namaObjekHalamanMateri(P, M, 3)).toBe(`${P}/${M}/3.webp`);
    expect(namaObjekPdfMateri(P, M)).toBe(`${P}/${M}/isi.pdf`);
    expect(objekPdfPembeli(P, M, A)).toBe(`${P}/${M}/pembeli/${A}.pdf`);
    expect(prefiksPdfPembeli(P, M)).toBe(`${P}/${M}/pembeli`);
  });

  it("sampul unik per unggahan dan divalidasi ketat", () => {
    const produk = namaObjekSampul(P, null, "image/webp", A);
    const materi = namaObjekSampul(P, M, "image/jpeg", A);
    expect(produk).toBe(`${P}/sampul-${A}.webp`);
    expect(materi).toBe(`${P}/${M}/sampul-${A}.jpg`);
    expect(objekSampulSah(produk, P, null)).toBe(true);
    expect(objekSampulSah(materi, P, M)).toBe(true);
    expect(objekSampulSah(materi, P, null)).toBe(false);
    expect(objekSampulSah(`${P}/../x/sampul-${A}.webp`, P, null)).toBe(false);
  });

  it("periksaBerkasSampul", () => {
    expect(periksaBerkasSampul("image/png", 1000).ok).toBe(true);
    expect(periksaBerkasSampul("image/gif", 1000).ok).toBe(false);
    expect(periksaBerkasSampul("image/png", 3 * 1024 * 1024).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npx vitest run tests/produk-materi-status.test.ts`
Expected: FAIL, karena `ringkasJumlahMateri` dan fungsi lain belum diekspor. Uji ini murni dan tidak butuh Docker. Bila `tests/global-setup.ts` tetap macet karena Docker mati, jalankan `npx vitest run tests/produk-materi-status.test.ts --globalSetup=''`. Kalau opsi itu tidak didukung versi vitest repo, tandai **TERTUNDA** dan lanjutkan dengan `npx tsc --noEmit` sebagai pengganti sementara.

- [ ] **Step 3: Ubah `status.ts`**

Di `web/src/lib/produk/status.ts`:

1. Hapus blok `JenisProduk`, `JENIS_SAH`, `LABEL_JENIS` di kepala berkas, fungsi `punyaIsi`, fungsi `periksaJenis`, dan kunci `jenisTidakSah` di `PESAN_PRODUK`.
2. Di `PESAN_PRODUK`, tambahkan kunci berikut:

```ts
  jenisMateriTidakSah: "Jenis materi harus Video atau Artikel (PDF).",
  judulBabWajib: "Judul bab tidak boleh kosong.",
  judulBabPanjang: `Judul bab maksimal ${PANJANG_JUDUL_MAKS} karakter.`,
  keteranganPanjang: `Keterangan maksimal ${PANJANG_KETERANGAN_MATERI_MAKS} karakter.`,
  masaBerlakuTidakSah: `Masa berlaku harus 1–${MASA_BERLAKU_MAKS_BULAN} bulan atau 1–${MASA_BERLAKU_MAKS_BULAN / 12} tahun.`,
```

3. Di atas `PESAN_PRODUK`, sesudah `HARGA_MAKS`, tambahkan:

```ts
export const PANJANG_KETERANGAN_MATERI_MAKS = 500;
// Cermin CHECK `masa_berlaku_bulan between 1 and 120` di migrasi 20261016100000.
export const MASA_BERLAKU_MAKS_BULAN = 120;
```

4. Tambahkan di ujung berkas:

```ts
// ===== MATERI =====

export type JenisMateri = "video" | "pdf";

export const JENIS_MATERI: readonly JenisMateri[] = ["video", "pdf"];

// "Artikel", bukan "PDF": itu kata yang dipakai klien di etalase
// ("11 Video · 1 Artikel"). Di basis data nilainya tetap 'pdf'.
export const LABEL_JENIS_MATERI: Record<JenisMateri, string> = {
  video: "Video",
  pdf: "Artikel",
};

export function periksaJenisMateri(teks: string): Periksa<JenisMateri> {
  if (!(JENIS_MATERI as readonly string[]).includes(teks)) {
    return { ok: false, pesan: PESAN_PRODUK.jenisMateriTidakSah };
  }
  return { ok: true, nilai: teks as JenisMateri };
}

export function periksaJudulBab(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi === "") return { ok: false, pesan: PESAN_PRODUK.judulBabWajib };
  if (rapi.length > PANJANG_JUDUL_MAKS) return { ok: false, pesan: PESAN_PRODUK.judulBabPanjang };
  return { ok: true, nilai: rapi };
}

export function periksaKeteranganMateri(teks: string): Periksa<string> {
  const rapi = teks.trim();
  if (rapi.length > PANJANG_KETERANGAN_MATERI_MAKS) {
    return { ok: false, pesan: PESAN_PRODUK.keteranganPanjang };
  }
  return { ok: true, nilai: rapi };
}

/** Video berisi bila berkasnya ada; PDF berisi bila halamannya ada (berkas utuh opsional). */
export function materiBerisi(
  jenis: JenisMateri,
  jumlahBerkas: number,
  jumlahHalaman: number,
): boolean {
  return jenis === "video" ? jumlahBerkas > 0 : jumlahHalaman > 0;
}

export function ringkasJumlahMateri(jenis: readonly JenisMateri[]): string {
  return JENIS_MATERI
    .map((j) => ({ j, n: jenis.filter((x) => x === j).length }))
    .filter(({ n }) => n > 0)
    .map(({ j, n }) => `${n} ${LABEL_JENIS_MATERI[j]}`)
    .join(" · ");
}

// ===== MASA BERLAKU =====

export function labelMasaBerlaku(bulan: number | null): string {
  if (bulan === null) return "Selamanya";
  if (bulan % 12 === 0) return `${bulan / 12} Tahun`;
  return `${bulan} Bulan`;
}

/** `satuan` dari form owner: "selamanya" | "bulan" | "tahun". Hasil dalam BULAN. */
export function periksaMasaBerlaku(satuan: string, jumlah: string): Periksa<number | null> {
  if (satuan === "selamanya") return { ok: true, nilai: null };
  if (satuan !== "bulan" && satuan !== "tahun") {
    return { ok: false, pesan: PESAN_PRODUK.masaBerlakuTidakSah };
  }
  const rapi = jumlah.trim();
  if (!/^\d+$/.test(rapi)) return { ok: false, pesan: PESAN_PRODUK.masaBerlakuTidakSah };
  const bulan = Number(rapi) * (satuan === "tahun" ? 12 : 1);
  if (bulan < 1 || bulan > MASA_BERLAKU_MAKS_BULAN) {
    return { ok: false, pesan: PESAN_PRODUK.masaBerlakuTidakSah };
  }
  return { ok: true, nilai: bulan };
}

export type StatusAkses =
  | { keadaan: "selamanya" }
  | { keadaan: "aktif"; sampai: string }
  | { keadaan: "habis"; sampai: string };

/**
 * Cermin syarat `akses_aktif` di SQL (`berlaku_sampai > now()`) — untuk
 * MENAMPILKAN status. Keputusan boleh-buka tetap milik basis data.
 */
export function statusAkses(berlakuSampai: string | null, sekarang: Date = new Date()): StatusAkses {
  if (berlakuSampai === null) return { keadaan: "selamanya" };
  return new Date(berlakuSampai).getTime() > sekarang.getTime()
    ? { keadaan: "aktif", sampai: berlakuSampai }
    : { keadaan: "habis", sampai: berlakuSampai };
}

const FORMAT_TANGGAL_AKSES = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

export function formatTanggalAkses(iso: string): string {
  return FORMAT_TANGGAL_AKSES.format(new Date(iso));
}
```

- [ ] **Step 4: Ganti seluruh isi `objek.ts`**

```ts
import { ekstensiDariMime, type MimeVideo } from "@/lib/materi/video";
import type { Periksa } from "@/lib/produk/status";

/**
 * Nama objek storage isi produk, kini PER MATERI. Semuanya ditentukan server
 * dan dibandingkan ulang saat dicatat — peramban yang memilih path adalah
 * peramban yang bisa menimpa materi lain.
 */

export function namaObjekVideoMateri(productId: string, materiId: string, mime: MimeVideo): string {
  const ext = ekstensiDariMime(mime);
  if (!ext) throw new Error(`MIME video tidak dikenal: ${mime}`);
  return `produk/${productId}/${materiId}/isi.${ext}`;
}

export function namaObjekHalamanMateri(productId: string, materiId: string, halaman: number): string {
  return `${productId}/${materiId}/${halaman}.webp`;
}

export function namaObjekPdfMateri(productId: string, materiId: string): string {
  return `${productId}/${materiId}/isi.pdf`;
}

// ===== SAMPUL =====

export const MIME_SAMPUL = ["image/jpeg", "image/png", "image/webp"] as const;
export type MimeSampul = (typeof MIME_SAMPUL)[number];
export const MAKS_BYTE_SAMPUL = 2 * 1024 * 1024;

const EKSTENSI_SAMPUL: Record<MimeSampul, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function periksaBerkasSampul(mime: string, byte: number): Periksa<MimeSampul> {
  if (!(MIME_SAMPUL as readonly string[]).includes(mime)) {
    return { ok: false, pesan: "Sampul harus JPG, PNG, atau WebP." };
  }
  if (!Number.isFinite(byte) || byte <= 0) return { ok: false, pesan: "Berkas sampul kosong." };
  if (byte > MAKS_BYTE_SAMPUL) return { ok: false, pesan: "Sampul maksimal 2 MB." };
  return { ok: true, nilai: mime as MimeSampul };
}

/**
 * Nama UNIK per unggahan (`acak` = UUID dari server). Bucket `produk-sampul`
 * publik dan di-cache CDN: menimpa nama yang sama membuat pengunjung terus
 * melihat gambar lama.
 */
export function namaObjekSampul(
  productId: string,
  materiId: string | null,
  mime: MimeSampul,
  acak: string,
): string {
  const dasar = materiId ? `${productId}/${materiId}` : productId;
  return `${dasar}/sampul-${acak}.${EKSTENSI_SAMPUL[mime]}`;
}

const POLA_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function objekSampulSah(objek: string, productId: string, materiId: string | null): boolean {
  const dasar = materiId ? `${productId}/${materiId}` : productId;
  const pola = new RegExp(`^${dasar}/sampul-${POLA_UUID}\\.(jpg|png|webp)$`);
  return pola.test(objek);
}

export function urlSampulPublik(objek: string | null): string | null {
  if (!objek) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/produk-sampul/${objek}`;
}
```

- [ ] **Step 5: Ubah `cap-pdf.ts`**

Ganti kedua fungsi di `web/src/lib/produk/cap-pdf.ts:75-92` dan biarkan komentar dokumennya. Komentar "satu produk" ditulis ulang menjadi "satu materi":

```ts
export function objekPdfPembeli(productId: string, materiId: string, clientId: string): string {
  return `${prefiksPdfPembeli(productId, materiId)}/${clientId}.pdf`;
}

export function prefiksPdfPembeli(productId: string, materiId: string): string {
  return `${productId}/${materiId}/pembeli`;
}
```

- [ ] **Step 6: Jalankan uji**

Run: `npx vitest run tests/produk-materi-status.test.ts`
Expected: PASS. `npx tsc --noEmit` akan MERAH di pemanggil lama (`aksi.ts`, `unggah.ts`, rute, halaman). Itu memang diperbaiki Task 5–10; jangan diperbaiki di sini.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/produk/status.ts web/src/lib/produk/objek.ts web/src/lib/produk/cap-pdf.ts web/tests/produk-materi-status.test.ts
git commit -m "feat(produk): pustaka jenis materi, masa berlaku, dan nama objek per materi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Aksi server admin — produk, bab, materi, sampul, unggah

**Files:**
- Modify: `web/src/lib/admin/produk-admin.ts` (seluruh isi diganti)
- Modify: `web/src/app/admin/produk/aksi.ts`
- Create: `web/src/app/admin/produk/[id]/aksi-isi.ts`
- Modify: `web/src/app/admin/produk/[id]/unggah.ts` (seluruh isi diganti)

**Interfaces:**
- Consumes: Task 1 (tabel & RPC), Task 4 (pustaka).
- Produces (dipakai Task 6):
  - `produk-admin.ts`:
    - `type ProdukKelola = { id; judul; slug; deskripsi; aktif; urutan; sampulObjek: string | null; masaBerlakuBulan: number | null; jenisMateri: JenisMateri[]; adaIsi: boolean; harga: number | null; hargaCoret: number | null }`. `adaIsi` berarti isi LENGKAP: ≥1 materi dan semuanya berisi.
    - `type MateriKelola = { id; judul; keterangan; jenis: JenisMateri; sampulObjek: string | null; pratinjau: boolean; bolehUnduh: boolean; adaBerkas: boolean; jumlahHalaman: number; berisi: boolean }`
    - `type BabKelola = { id; judul; materi: MateriKelola[] }`
    - `SARING_PRODUK` (tanpa `jenis`), `ambilDaftarProduk(param)`, `ambilProduk(id)`, `ambilIsiProduk(productId): Promise<BabKelola[]>`, `isiLengkap(bab: BabKelola[]): boolean`
  - `aksi.ts`: `simpanProduk`, `perbaruiProduk`, `aktifkanProduk`, `nonaktifkanProduk` (tanda tangan tetap)
  - `aksi-isi.ts` (semua memulangkan `{ ok: true } | { ok: false; pesan: string }`, kecuali yang disebut):
    - `tambahBab(productId: string, judul: string)`
    - `ubahJudulBab(sectionId: string, judul: string)`
    - `geserBab(sectionId: string, arah: "naik" | "turun")`
    - `hapusBab(sectionId: string)`
    - `tambahMateri(sectionId: string, formData: FormData)`; medan `judul`, `keterangan`, `jenis`
    - `perbaruiMateri(materiId: string, formData: FormData)`; medan `judul`, `keterangan`, `jenis`, `pratinjau` ("on"), `boleh_unduh` ("on")
    - `geserMateri(materiId: string, arah: "naik" | "turun")`
    - `hapusMateri(materiId: string): Promise<{ ok: true; objekTersisa: boolean } | Gagal>`
    - `terbitkanUrlSampul(productId: string, materiId: string | null, mime: string, byte: number): Promise<{ ok: true; objek: string; token: string } | Gagal>`
    - `catatSampul(productId: string, materiId: string | null, objek: string): Promise<{ ok: true } | Gagal>`
  - `unggah.ts`: `terbitkanUrlUnggahVideoMateri(materiId, mime, byte)`, `catatVideoMateri(materiId, objek, mime, byte)`, `terbitkanUrlUnggahHalamanMateri(materiId, jumlahHalaman)`, `catatHalamanMateri(materiId, halaman[])`, `terbitkanUrlUnggahPdfMateri(materiId, byte)`, `catatPdfMateri(materiId, byte)`, `lepasIsiMateri(materiId)`, `type UnggahanHalaman`. Tanda tangan nilai balik sama dengan versi `...Produk` lama.

- [ ] **Step 1: Ganti seluruh isi `produk-admin.ts`**

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { materiBerisi, type JenisMateri } from "@/lib/produk/status";

export type ProdukKelola = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  aktif: boolean;
  urutan: number;
  sampulObjek: string | null;
  masaBerlakuBulan: number | null;
  jenisMateri: JenisMateri[];
  /** Isi LENGKAP: minimal satu materi, dan setiap materi sudah berisi. Syarat tayang. */
  adaIsi: boolean;
  harga: number | null;
  hargaCoret: number | null;
};

export type MateriKelola = {
  id: string;
  judul: string;
  keterangan: string;
  jenis: JenisMateri;
  sampulObjek: string | null;
  pratinjau: boolean;
  bolehUnduh: boolean;
  adaBerkas: boolean;
  jumlahHalaman: number;
  berisi: boolean;
};

export type BabKelola = { id: string; judul: string; materi: MateriKelola[] };

export const SARING_PRODUK = {
  aktif: ["ya", "tidak"],
  isi: ["ada", "belum"],
} as const satisfies SaringSah;

type BarisMateriRingkas = {
  jenis: JenisMateri;
  digital_product_files: Array<{ count: number }>;
  digital_product_pages: Array<{ count: number }>;
};

type BarisProduk = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  aktif: boolean;
  urutan: number;
  sampul_objek: string | null;
  masa_berlaku_bulan: number | null;
  digital_product_materials: BarisMateriRingkas[];
};
type BarisHarga = { product_id: string; harga: number; harga_coret: number | null };

const KOLOM_PRODUK =
  "id, judul, slug, deskripsi, aktif, urutan, sampul_objek, masa_berlaku_bulan, " +
  "digital_product_materials(jenis, digital_product_files(count), digital_product_pages(count))";

function lengkap(materi: BarisMateriRingkas[]): boolean {
  return (
    materi.length > 0 &&
    materi.every((m) =>
      materiBerisi(m.jenis, m.digital_product_files[0]?.count ?? 0, m.digital_product_pages[0]?.count ?? 0),
    )
  );
}

function rakit(p: BarisProduk, h: BarisHarga | undefined | null): ProdukKelola {
  return {
    id: p.id,
    judul: p.judul,
    slug: p.slug,
    deskripsi: p.deskripsi,
    aktif: p.aktif,
    urutan: p.urutan,
    sampulObjek: p.sampul_objek,
    masaBerlakuBulan: p.masa_berlaku_bulan,
    jenisMateri: p.digital_product_materials.map((m) => m.jenis),
    adaIsi: lengkap(p.digital_product_materials),
    harga: h?.harga ?? null,
    hargaCoret: h?.harga_coret ?? null,
  };
}

export async function ambilDaftarProduk(
  param: ParamDaftar,
): Promise<{ baris: ProdukKelola[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("digital_products")
    .select(KOLOM_PRODUK, { count: "exact" })
    .order("urutan")
    .order("judul");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("judul", `%${aman}%`);
  }

  const { data: produk, count, error } = await q.range(dari, sampai).returns<BarisProduk[]>();
  if (error) throw new Error(`Gagal membaca daftar produk: ${error.message}`);

  const { data: harga, error: hargaError } = await supabase
    .from("produk_harga_staf")
    .select("product_id, harga, harga_coret")
    .returns<BarisHarga[]>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  const hargaPer = new Map((harga ?? []).map((h) => [h.product_id, h] as const));
  let baris = (produk ?? []).map((p) => rakit(p, hargaPer.get(p.id)));

  if (param.saring.isi) {
    const ingin = param.saring.isi === "ada";
    baris = baris.filter((p) => p.adaIsi === ingin);
  }

  return { baris, total: param.saring.isi ? baris.length : (count ?? 0) };
}

export async function ambilProduk(id: string): Promise<ProdukKelola | null> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("digital_products")
    .select(KOLOM_PRODUK)
    .eq("id", id)
    .maybeSingle<BarisProduk>();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!data) return null;

  const { data: harga, error: hargaError } = await supabase
    .from("produk_harga_staf")
    .select("product_id, harga, harga_coret")
    .eq("product_id", id)
    .maybeSingle<BarisHarga>();
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit(data, harga);
}

type BarisBab = {
  id: string;
  judul: string;
  digital_product_materials: Array<{
    id: string;
    judul: string;
    keterangan: string;
    jenis: JenisMateri;
    sampul_objek: string | null;
    pratinjau: boolean;
    boleh_unduh: boolean;
    urutan: number;
    created_at: string;
    digital_product_files: Array<{ id: string }>;
    digital_product_pages: Array<{ count: number }>;
  }>;
};

export async function ambilIsiProduk(productId: string): Promise<BabKelola[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_sections")
    .select(
      "id, judul, digital_product_materials(id, judul, keterangan, jenis, sampul_objek, pratinjau, boleh_unduh, urutan, created_at, digital_product_files(id), digital_product_pages(count))",
    )
    .eq("product_id", productId)
    .order("urutan")
    .order("created_at")
    .returns<BarisBab[]>();
  if (error) throw new Error(`Gagal membaca isi produk: ${error.message}`);

  return (data ?? []).map((b) => ({
    id: b.id,
    judul: b.judul,
    materi: [...b.digital_product_materials]
      .sort((x, y) => x.urutan - y.urutan || x.created_at.localeCompare(y.created_at))
      .map((m) => {
        const adaBerkas = m.digital_product_files.length > 0;
        const jumlahHalaman = m.digital_product_pages[0]?.count ?? 0;
        return {
          id: m.id,
          judul: m.judul,
          keterangan: m.keterangan,
          jenis: m.jenis,
          sampulObjek: m.sampul_objek,
          pratinjau: m.pratinjau,
          bolehUnduh: m.boleh_unduh,
          adaBerkas,
          jumlahHalaman,
          berisi: materiBerisi(m.jenis, adaBerkas ? 1 : 0, jumlahHalaman),
        };
      }),
  }));
}

export function isiLengkap(bab: BabKelola[]): boolean {
  const semua = bab.flatMap((b) => b.materi);
  return semua.length > 0 && semua.every((m) => m.berisi);
}
```

- [ ] **Step 2: Ubah `aksi.ts`**

Di `web/src/app/admin/produk/aksi.ts`:

1. Ganti blok import dari `@/lib/produk/status` menjadi:

```ts
import { periksaJudul, periksaSlug, slugDariJudul, PANJANG_DESKRIPSI_MAKS } from "@/lib/produk/status";
import { ambilIsiProduk, isiLengkap } from "@/lib/admin/produk-admin";
```

2. `periksaMedanProduk`: buang medan `jenis` dan `bolehUnduh` dari tipe kembalian dan badan. Hapus `const jenis = periksaJenis(...)`, `if (!jenis.ok) ...`, dan `const bolehUnduh = ...`. Barisnya menjadi `return { ok: true, judul: judul.nilai, slug: slug.nilai, deskripsi };`.
3. `simpanProduk`: objek insert menjadi `{ judul: medan.judul, slug: medan.slug, deskripsi: medan.deskripsi }`.
4. `perbaruiProduk`: hapus seluruh blok `const { data: kini ... }` sampai penutup `if (kini.jenis !== medan.jenis) {...}`, karena jenis kini milik materi. Objek update menjadi `{ judul: medan.judul, slug: medan.slug, deskripsi: medan.deskripsi, urutan }`.
5. Hapus fungsi `hitungIsi` seluruhnya.
6. `aktifkanProduk`: ganti badan dari `const { data: produk, error: produkError }` sampai `if (!punyaIsi(...)) {...}` dengan:

```ts
  // Produk setengah jadi di etalase lebih buruk daripada produk yang belum
  // ada: SETIAP materi wajib berisi, bukan sekadar "ada satu".
  const bab = await ambilIsiProduk(id);
  if (!isiLengkap(bab)) {
    return {
      ok: false,
      pesan: "Isi belum lengkap — produk butuh minimal satu materi, dan setiap materi harus sudah diunggah isinya.",
    };
  }
```

`ambilIsiProduk` membuat klien Supabase sendiri, jadi `const supabase = await createServerSupabase();` di `aktifkanProduk` tetap dipakai untuk update sesudahnya.

- [ ] **Step 3: Buat `aksi-isi.ts`**

Create `web/src/app/admin/produk/[id]/aksi-isi.ts`:

```ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hapusObjekVideo } from "@/lib/r2";
import {
  periksaJudul, periksaJudulBab, periksaKeteranganMateri, periksaJenisMateri,
} from "@/lib/produk/status";
import { periksaBerkasSampul, namaObjekSampul, objekSampulSah } from "@/lib/produk/objek";
import { prefiksPdfPembeli } from "@/lib/produk/cap-pdf";

type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };
type Arah = "naik" | "turun";
type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

const BUCKET_SAMPUL = "produk-sampul";
const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";

function segarkan(productId: string) {
  revalidatePath(`/admin/produk/${productId}`);
  revalidatePath("/admin/produk");
  revalidatePath("/produk");
}

async function produkDariBab(supabase: Supabase, sectionId: string): Promise<string | null> {
  const { data } = await supabase
    .from("digital_product_sections").select("product_id").eq("id", sectionId).maybeSingle();
  return data?.product_id ?? null;
}

/**
 * Menukar posisi satu baris dengan tetangganya, lalu menulis ulang `urutan`
 * SELURUH saudara menjadi 0..n-1. Menulis ulang semuanya (bukan cuma dua
 * baris) menyembuhkan urutan kembar dari data lama — tanpa itu, dua baris
 * ber-urutan 0 tidak pernah bisa ditukar.
 */
async function geser(
  supabase: Supabase,
  tabel: "digital_product_sections" | "digital_product_materials",
  kolomInduk: "product_id" | "section_id",
  induk: string,
  id: string,
  arah: Arah,
): Promise<Berhasil | Gagal> {
  const { data, error } = await supabase
    .from(tabel).select("id").eq(kolomInduk, induk).order("urutan").order("created_at");
  if (error) return { ok: false, pesan: `Gagal membaca urutan (${error.code}).` };
  const ids = (data ?? []).map((r) => r.id as string);
  const i = ids.indexOf(id);
  const j = arah === "naik" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];

  for (const [urutan, baris] of ids.entries()) {
    const { error: e } = await supabase.from(tabel).update({ urutan }).eq("id", baris);
    if (e) return { ok: false, pesan: `Gagal menyimpan urutan (${e.code}).` };
  }
  return { ok: true };
}

// ===== BAB =====

export async function tambahBab(productId: string, judul: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaJudulBab(judul);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const { count } = await supabase
    .from("digital_product_sections").select("id", { count: "exact", head: true }).eq("product_id", productId);
  const { data, error } = await supabase
    .from("digital_product_sections")
    .insert({ product_id: productId, judul: periksa.nilai, urutan: count ?? 0 })
    .select("id");
  if (error) return { ok: false, pesan: `Bab gagal ditambahkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Bab tidak tersimpan — hak akses ditolak." };

  segarkan(productId);
  return { ok: true };
}

export async function ubahJudulBab(sectionId: string, judul: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaJudulBab(judul);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_sections").update({ judul: periksa.nilai }).eq("id", sectionId).select("product_id");
  if (error) return { ok: false, pesan: `Bab gagal diubah (${error.code}).` };
  if (!data?.[0]) return { ok: false, pesan: "Bab tidak ditemukan." };

  segarkan(data[0].product_id);
  return { ok: true };
}

export async function geserBab(sectionId: string, arah: Arah): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const productId = await produkDariBab(supabase, sectionId);
  if (!productId) return { ok: false, pesan: "Bab tidak ditemukan." };

  const r = await geser(supabase, "digital_product_sections", "product_id", productId, sectionId, arah);
  if (r.ok) segarkan(productId);
  return r;
}

export async function hapusBab(sectionId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const productId = await produkDariBab(supabase, sectionId);
  if (!productId) return { ok: false, pesan: "Bab tidak ditemukan." };

  const { error } = await supabase.rpc("hapus_bab_produk", { p_section_id: sectionId });
  if (error) return { ok: false, pesan: error.message };

  segarkan(productId);
  return { ok: true };
}

// ===== MATERI =====

export async function tambahMateri(sectionId: string, formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return judul;
  const keterangan = periksaKeteranganMateri(String(formData.get("keterangan") ?? ""));
  if (!keterangan.ok) return keterangan;
  const jenis = periksaJenisMateri(String(formData.get("jenis") ?? ""));
  if (!jenis.ok) return jenis;

  const supabase = await createServerSupabase();
  const productId = await produkDariBab(supabase, sectionId);
  if (!productId) return { ok: false, pesan: "Bab tidak ditemukan." };

  const { count } = await supabase
    .from("digital_product_materials").select("id", { count: "exact", head: true }).eq("section_id", sectionId);
  const { data, error } = await supabase
    .from("digital_product_materials")
    .insert({
      section_id: sectionId,
      product_id: productId,
      judul: judul.nilai,
      keterangan: keterangan.nilai,
      jenis: jenis.nilai,
      urutan: count ?? 0,
    })
    .select("id");
  if (error) return { ok: false, pesan: `Materi gagal ditambahkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Materi tidak tersimpan — hak akses ditolak." };

  segarkan(productId);
  return { ok: true };
}

export async function perbaruiMateri(materiId: string, formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return judul;
  const keterangan = periksaKeteranganMateri(String(formData.get("keterangan") ?? ""));
  if (!keterangan.ok) return keterangan;
  const jenis = periksaJenisMateri(String(formData.get("jenis") ?? ""));
  if (!jenis.ok) return jenis;

  const supabase = await createServerSupabase();
  const { data: kini, error: kiniError } = await supabase
    .from("digital_product_materials")
    .select("product_id, jenis, digital_product_files(id), digital_product_pages(count)")
    .eq("id", materiId)
    .maybeSingle<{
      product_id: string;
      jenis: string;
      digital_product_files: Array<{ id: string }>;
      digital_product_pages: Array<{ count: number }>;
    }>();
  if (kiniError) return { ok: false, pesan: `Gagal membaca materi (${kiniError.code}).` };
  if (!kini) return { ok: false, pesan: "Materi tidak ditemukan." };

  // Isi yang sudah terunggah terikat pada jenisnya (video di R2, PDF sebagai
  // halaman). Mengganti jenis tanpa melepas isi akan meninggalkan objek yatim
  // dan materi yang tak pernah terbuka.
  const adaIsi = kini.digital_product_files.length > 0 || (kini.digital_product_pages[0]?.count ?? 0) > 0;
  if (kini.jenis !== jenis.nilai && adaIsi) {
    return { ok: false, pesan: "Jenis materi tidak bisa diubah setelah isinya diunggah. Lepas isinya lebih dulu." };
  }

  const { data, error } = await supabase
    .from("digital_product_materials")
    .update({
      judul: judul.nilai,
      keterangan: keterangan.nilai,
      jenis: jenis.nilai,
      pratinjau: formData.get("pratinjau") === "on",
      boleh_unduh: formData.get("boleh_unduh") === "on",
    })
    .eq("id", materiId)
    .select("id");
  if (error) return { ok: false, pesan: `Materi gagal diperbarui (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Materi tidak ditemukan atau hak akses ditolak." };

  segarkan(kini.product_id);
  return { ok: true };
}

export async function geserMateri(materiId: string, arah: Arah): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data: m } = await supabase
    .from("digital_product_materials").select("section_id, product_id").eq("id", materiId).maybeSingle();
  if (!m) return { ok: false, pesan: "Materi tidak ditemukan." };

  const r = await geser(supabase, "digital_product_materials", "section_id", m.section_id, materiId, arah);
  if (r.ok) segarkan(m.product_id);
  return r;
}

/** Menghapus salinan PDF bercap milik pembeli untuk satu materi. true = ada yang gagal. */
async function hapusSalinanPembeli(
  admin: ReturnType<typeof createAdminSupabase>,
  productId: string,
  materiId: string,
): Promise<boolean> {
  const prefiks = prefiksPdfPembeli(productId, materiId);
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET_BERKAS).list(prefiks, { limit: 1000 });
    if (error) return true;
    if (!data || data.length === 0) return false;
    const { error: hapus } = await admin.storage
      .from(BUCKET_BERKAS)
      .remove(data.map((o) => `${prefiks}/${o.name}`));
    if (hapus) return true;
    if (data.length < 1000) return false;
  }
}

export async function hapusMateri(
  materiId: string,
): Promise<{ ok: true; objekTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data: m } = await supabase
    .from("digital_product_materials")
    .select("product_id, digital_products(aktif)")
    .eq("id", materiId)
    .maybeSingle<{ product_id: string; digital_products: { aktif: boolean } | null }>();
  if (!m) return { ok: false, pesan: "Materi tidak ditemukan." };

  if (m.digital_products?.aktif) {
    const { count } = await supabase
      .from("digital_product_materials").select("id", { count: "exact", head: true }).eq("product_id", m.product_id);
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        pesan: "Ini materi terakhir produk yang sedang tayang. Nonaktifkan produknya dulu.",
      };
    }
  }

  const { data: objek, error } = await supabase.rpc("hapus_materi_produk", { p_material_id: materiId });
  if (error) return { ok: false, pesan: `Materi gagal dihapus (${error.code}).` };

  const admin = createAdminSupabase();
  let objekTersisa = false;
  const per = (asal: string) =>
    ((objek ?? []) as Array<{ asal: string; objek: string }>).filter((o) => o.asal === asal).map((o) => o.objek);

  for (const o of per("video")) {
    try { await hapusObjekVideo(o); } catch { objekTersisa = true; }
  }
  for (const [bucket, daftar] of [
    [BUCKET_BERKAS, per("pdf")],
    [BUCKET_HALAMAN, per("halaman")],
    [BUCKET_SAMPUL, per("sampul")],
  ] as const) {
    if (daftar.length === 0) continue;
    const { error: e } = await admin.storage.from(bucket).remove(daftar);
    if (e) objekTersisa = true;
  }
  if (await hapusSalinanPembeli(admin, m.product_id, materiId)) objekTersisa = true;

  segarkan(m.product_id);
  return { ok: true, objekTersisa };
}

// ===== SAMPUL (produk bila materiId null, materi bila terisi) =====

async function sampulLama(
  supabase: Supabase,
  productId: string,
  materiId: string | null,
): Promise<{ ada: boolean; objek: string | null }> {
  const { data } = materiId
    ? await supabase.from("digital_product_materials").select("sampul_objek")
        .eq("id", materiId).eq("product_id", productId).maybeSingle()
    : await supabase.from("digital_products").select("sampul_objek").eq("id", productId).maybeSingle();
  return { ada: data !== null, objek: (data?.sampul_objek as string | null) ?? null };
}

export async function terbitkanUrlSampul(
  productId: string,
  materiId: string | null,
  mime: string,
  byte: number,
): Promise<{ ok: true; objek: string; token: string } | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaBerkasSampul(mime, byte);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const lama = await sampulLama(supabase, productId, materiId);
  if (!lama.ada) return { ok: false, pesan: "Produk atau materi tidak ditemukan." };

  const objek = namaObjekSampul(productId, materiId, periksa.nilai, randomUUID());
  const { data, error } = await createAdminSupabase().storage
    .from(BUCKET_SAMPUL)
    .createSignedUploadUrl(objek);
  if (error || !data) return { ok: false, pesan: "Gagal menyiapkan unggahan sampul. Coba lagi." };
  return { ok: true, objek, token: data.token };
}

export async function catatSampul(
  productId: string,
  materiId: string | null,
  objek: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  if (!objekSampulSah(objek, productId, materiId)) return { ok: false, pesan: "Nama objek sampul tidak sah." };

  const supabase = await createServerSupabase();
  const lama = await sampulLama(supabase, productId, materiId);
  if (!lama.ada) return { ok: false, pesan: "Produk atau materi tidak ditemukan." };

  const { data, error } = materiId
    ? await supabase.from("digital_product_materials").update({ sampul_objek: objek })
        .eq("id", materiId).eq("product_id", productId).select("id")
    : await supabase.from("digital_products").update({ sampul_objek: objek }).eq("id", productId).select("id");
  if (error) return { ok: false, pesan: `Sampul gagal dicatat (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Sampul tidak tersimpan — hak akses ditolak." };

  // Objek lama dihapus SESUDAH baris menunjuk yang baru: gagal hapus hanya
  // meninggalkan sampah, bukan sampul yang patah.
  if (lama.objek && lama.objek !== objek) {
    await createAdminSupabase().storage.from(BUCKET_SAMPUL).remove([lama.objek]);
  }

  segarkan(productId);
  return { ok: true };
}
```

- [ ] **Step 4: Ganti seluruh isi `unggah.ts` (per materi)**

Strukturnya mengikuti berkas lama. Komentar panjang yang menjelaskan alasan (urutan mengosongkan-lalu-unggah, `hapusSalinanPembeli` sebelum PDF baru, dst.) dipertahankan; kata "produk" diganti "materi" di tempat yang tepat. Kode lengkapnya:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { urlUnggahVideo, hapusObjekVideo } from "@/lib/r2";
import { periksaBerkasVideo } from "@/lib/materi/video";
import { MAKS_HALAMAN, MAKS_BYTE_PDF } from "@/lib/materi/rasterisasi";
import {
  namaObjekVideoMateri, namaObjekHalamanMateri, namaObjekPdfMateri,
} from "@/lib/produk/objek";
import { prefiksPdfPembeli } from "@/lib/produk/cap-pdf";

const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";
const MIME_PDF = "application/pdf";

type Gagal = { ok: false; pesan: string };
export type UnggahanHalaman = { halaman: number; objek: string; token: string };

type Materi = {
  id: string;
  product_id: string;
  jenis: "video" | "pdf";
  boleh_unduh: boolean;
  digital_products: { aktif: boolean } | null;
};

async function bacaMateri(materiId: string): Promise<Materi | Gagal> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_materials")
    .select("id, product_id, jenis, boleh_unduh, digital_products(aktif)")
    .eq("id", materiId)
    .maybeSingle<Materi>();
  if (error) return { ok: false, pesan: `Gagal membaca materi (${error.code}).` };
  if (!data) return { ok: false, pesan: "Materi tidak ditemukan." };
  return data;
}

function gagal(x: Materi | Gagal): x is Gagal {
  return "ok" in x;
}

function segarkan(productId: string) {
  revalidatePath(`/admin/produk/${productId}`);
}

async function hapusSalinanPembeli(
  admin: ReturnType<typeof createAdminSupabase>,
  productId: string,
  materiId: string,
): Promise<boolean> {
  const prefiks = prefiksPdfPembeli(productId, materiId);
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET_BERKAS).list(prefiks, { limit: 1000 });
    if (error) return true;
    if (!data || data.length === 0) return false;
    const { error: hapus } = await admin.storage
      .from(BUCKET_BERKAS)
      .remove(data.map((o) => `${prefiks}/${o.name}`));
    if (hapus) return true;
    if (data.length < 1000) return false;
  }
}

// ===== VIDEO =====

export async function terbitkanUrlUnggahVideoMateri(
  materiId: string,
  mime: string,
  byte: number,
): Promise<{ ok: true; url: string; objek: string } | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  const m = await bacaMateri(materiId);
  if (gagal(m)) return m;
  if (m.jenis !== "video") return { ok: false, pesan: "Materi ini bukan materi video." };

  const objek = namaObjekVideoMateri(m.product_id, m.id, periksa.nilai);
  return { ok: true, url: await urlUnggahVideo(objek, periksa.nilai, byte), objek };
}

export async function catatVideoMateri(
  materiId: string,
  objek: string,
  mime: string,
  byte: number,
): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  const m = await bacaMateri(materiId);
  if (gagal(m)) return m;
  if (objek !== namaObjekVideoMateri(m.product_id, m.id, periksa.nilai)) {
    return { ok: false, pesan: "Nama objek tidak sah." };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_files")
    .upsert({ material_id: materiId, objek, mime, byte }, { onConflict: "material_id" })
    .select("id");
  if (error) return { ok: false, pesan: `Gagal mencatat berkas (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Berkas tidak tersimpan." };

  segarkan(m.product_id);
  return { ok: true };
}

// ===== PDF: HALAMAN =====

export async function terbitkanUrlUnggahHalamanMateri(
  materiId: string,
  jumlahHalaman: number,
): Promise<{ ok: true; unggahan: UnggahanHalaman[] } | Gagal> {
  await requireRole(["admin", "owner"]);
  if (!Number.isInteger(jumlahHalaman) || jumlahHalaman < 1) {
    return { ok: false, pesan: "Jumlah halaman tidak sah." };
  }
  if (jumlahHalaman > MAKS_HALAMAN) return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };

  const m = await bacaMateri(materiId);
  if (gagal(m)) return m;
  if (m.jenis !== "pdf") return { ok: false, pesan: "Materi ini bukan materi PDF." };

  // Kosongkan halaman lama DULU, lewat RPC berradius satu materi.
  const supabase = await createServerSupabase();
  const { data: lama, error: bersih } = await supabase.rpc("ganti_halaman_materi_produk", {
    p_material_id: materiId,
    p_halaman: [],
  });
  if (bersih) return { ok: false, pesan: "Gagal mengosongkan halaman lama. Materi belum berubah — coba lagi." };

  const admin = createAdminSupabase();
  const objekLama = (lama ?? []).map((r: { objek: string }) => r.objek);
  if (objekLama.length > 0) {
    const { error: hapus } = await admin.storage.from(BUCKET_HALAMAN).remove(objekLama);
    if (hapus) {
      return {
        ok: false,
        pesan: "Halaman lama sudah kosong, tetapi sebagian objek lama gagal dihapus. Aman diunggah ulang.",
      };
    }
  }

  const unggahan: UnggahanHalaman[] = [];
  for (let halaman = 1; halaman <= jumlahHalaman; halaman++) {
    const objek = namaObjekHalamanMateri(m.product_id, m.id, halaman);
    const { data, error: e } = await admin.storage
      .from(BUCKET_HALAMAN)
      .createSignedUploadUrl(objek, { upsert: true });
    if (e || !data) return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
    unggahan.push({ halaman, objek, token: data.token });
  }
  return { ok: true, unggahan };
}

export async function catatHalamanMateri(
  materiId: string,
  halaman: Array<{ halaman: number; objek: string }>,
): Promise<{ ok: true; jumlah: number } | Gagal> {
  await requireRole(["admin", "owner"]);
  if (halaman.length === 0) return { ok: false, pesan: "Tidak ada halaman." };
  if (halaman.length > MAKS_HALAMAN) return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };

  const m = await bacaMateri(materiId);
  if (gagal(m)) return m;
  for (const h of halaman) {
    if (h.objek !== namaObjekHalamanMateri(m.product_id, m.id, h.halaman)) {
      return { ok: false, pesan: "Nama objek halaman tidak sah." };
    }
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("ganti_halaman_materi_produk", {
    p_material_id: materiId,
    p_halaman: halaman.map((h) => ({ halaman: h.halaman, objek: h.objek })),
  });
  if (error) return { ok: false, pesan: `Gagal menyimpan halaman (${error.code}).` };

  segarkan(m.product_id);
  return { ok: true, jumlah: halaman.length };
}

// ===== PDF: BERKAS UTUH (hanya bila boleh_unduh) =====

export async function terbitkanUrlUnggahPdfMateri(
  materiId: string,
  byte: number,
): Promise<{ ok: true; objek: string; token: string } | Gagal> {
  await requireRole(["admin", "owner"]);
  if (!Number.isFinite(byte) || byte <= 0) return { ok: false, pesan: "Berkas PDF kosong." };
  if (byte > MAKS_BYTE_PDF) {
    return { ok: false, pesan: `PDF maksimal ${Math.round(MAKS_BYTE_PDF / (1024 * 1024))} MB.` };
  }

  const m = await bacaMateri(materiId);
  if (gagal(m)) return m;
  if (m.jenis !== "pdf") return { ok: false, pesan: "Materi ini bukan materi PDF." };
  if (!m.boleh_unduh) return { ok: false, pesan: "Materi ini tidak mengizinkan unduhan PDF utuh." };

  const admin = createAdminSupabase();
  // Salinan bercap lama dibuang SEBELUM berkas baru: pembeli tidak boleh
  // terus menerima versi lama dari tembolok per-pembeli.
  if (await hapusSalinanPembeli(admin, m.product_id, m.id)) {
    return {
      ok: false,
      pesan: "Gagal membersihkan salinan unduhan pembeli yang lama. Unggahan dibatalkan — coba lagi.",
    };
  }

  const objek = namaObjekPdfMateri(m.product_id, m.id);
  const { data, error } = await admin.storage
    .from(BUCKET_BERKAS)
    .createSignedUploadUrl(objek, { upsert: true });
  if (error || !data) return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
  return { ok: true, objek, token: data.token };
}

export async function catatPdfMateri(materiId: string, byte: number): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);
  if (!Number.isFinite(byte) || byte <= 0) return { ok: false, pesan: "Berkas PDF kosong." };
  if (byte > MAKS_BYTE_PDF) {
    return { ok: false, pesan: `PDF maksimal ${Math.round(MAKS_BYTE_PDF / (1024 * 1024))} MB.` };
  }

  const m = await bacaMateri(materiId);
  if (gagal(m)) return m;
  if (!m.boleh_unduh) return { ok: false, pesan: "Materi ini tidak mengizinkan unduhan PDF utuh." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_files")
    .upsert(
      { material_id: materiId, objek: namaObjekPdfMateri(m.product_id, m.id), mime: MIME_PDF, byte },
      { onConflict: "material_id" },
    )
    .select("id");
  if (error) return { ok: false, pesan: `Gagal mencatat berkas (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Berkas tidak tersimpan." };

  segarkan(m.product_id);
  return { ok: true };
}

// ===== LEPAS ISI =====

export async function lepasIsiMateri(
  materiId: string,
): Promise<{ ok: true; objekTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);
  const m = await bacaMateri(materiId);
  if (gagal(m)) return m;
  if (m.digital_products?.aktif) {
    return {
      ok: false,
      pesan: "Nonaktifkan produk lebih dulu. Produk tayang dengan materi kosong adalah gembok yang tak pernah terbuka.",
    };
  }

  const supabase = await createServerSupabase();
  const admin = createAdminSupabase();
  let objekTersisa = false;

  const { data: berkasLama, error: delBerkas } = await supabase.rpc("lepas_berkas_materi", {
    p_material_id: materiId,
  });
  if (delBerkas) return { ok: false, pesan: `Gagal melepas berkas (${delBerkas.code}).` };
  const objekBerkas = berkasLama?.[0]?.objek as string | undefined;

  if (m.jenis === "video") {
    if (objekBerkas) {
      try { await hapusObjekVideo(objekBerkas); } catch { objekTersisa = true; }
    }
  } else {
    const { data: halamanLama, error: delHalaman } = await supabase.rpc("ganti_halaman_materi_produk", {
      p_material_id: materiId,
      p_halaman: [],
    });
    if (delHalaman) return { ok: false, pesan: `Gagal mengosongkan halaman (${delHalaman.code}).` };
    const objekHalaman = (halamanLama ?? []).map((r: { objek: string }) => r.objek);
    if (objekHalaman.length > 0) {
      const { error } = await admin.storage.from(BUCKET_HALAMAN).remove(objekHalaman);
      if (error) objekTersisa = true;
    }
    if (objekBerkas) {
      const { error } = await admin.storage.from(BUCKET_BERKAS).remove([objekBerkas]);
      if (error) objekTersisa = true;
    }
    if (await hapusSalinanPembeli(admin, m.product_id, m.id)) objekTersisa = true;
  }

  segarkan(m.product_id);
  return { ok: true, objekTersisa };
}
```

- [ ] **Step 5: Periksa tipe untuk berkas yang disentuh**

Run: `npx tsc --noEmit 2>&1 | grep -E "src/(lib/admin/produk-admin|app/admin/produk/aksi|app/admin/produk/\[id\]/(aksi-isi|unggah))" || echo BERSIH`
Expected: `BERSIH`. Galat di berkas lain (UI admin, halaman publik, rute) masih ada dan diperbaiki Task 6–10.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/admin/produk-admin.ts web/src/app/admin/produk/aksi.ts "web/src/app/admin/produk/[id]/aksi-isi.ts" "web/src/app/admin/produk/[id]/unggah.ts"
git commit -m "feat(admin): aksi bab, materi, sampul, dan unggah isi per materi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI admin — daftar, form, penyunting isi bertingkat, sampul

**Files:**
- Modify: `web/src/app/admin/produk/form-produk.tsx`
- Modify: `web/src/app/admin/produk/page.tsx`
- Modify: `web/src/app/admin/produk/[id]/pengunggah-produk.tsx` (ganti nama, lewat sed)
- Create: `web/src/app/admin/produk/[id]/pengunggah-sampul.tsx`
- Create: `web/src/app/admin/produk/[id]/editor-isi.tsx`
- Modify: `web/src/app/admin/produk/[id]/page.tsx` (seluruh isi diganti)

**Interfaces:**
- Consumes: Task 5 (`ProdukKelola`, `BabKelola`, `MateriKelola`, `ambilIsiProduk`, semua aksi di `aksi-isi.ts` & `unggah.ts`), Task 4 (`ringkasJumlahMateri`, `LABEL_JENIS_MATERI`, `JENIS_MATERI`, `labelMasaBerlaku`, `urlSampulPublik`, `statusAkses`, `formatTanggalAkses`).
- Produces: komponen klien `PengunggahSampul({ productId, materiId, sampulObjek })` dan `EditorIsi({ productId, produkAktif, bab })`. Hanya dipakai di halaman ini.

Tidak ada uji otomatis baru (mode dipangkas). Verifikasi manual ada di Step 7.

- [ ] **Step 1: Ganti nama di pengunggah isi**

```bash
f="web/src/app/admin/produk/[id]/pengunggah-produk.tsx"
sed -i '' \
  -e 's/terbitkanUrlUnggahVideoProduk/terbitkanUrlUnggahVideoMateri/g' \
  -e 's/catatVideoProduk/catatVideoMateri/g' \
  -e 's/terbitkanUrlUnggahHalamanProduk/terbitkanUrlUnggahHalamanMateri/g' \
  -e 's/catatHalamanProduk/catatHalamanMateri/g' \
  -e 's/terbitkanUrlUnggahPdfProduk/terbitkanUrlUnggahPdfMateri/g' \
  -e 's/catatPdfProduk/catatPdfMateri/g' \
  -e 's/LepasIsiProduk/LepasIsiMateri/g' \
  -e 's/lepasIsiProduk/lepasIsiMateri/g' \
  -e 's/PengunggahVideoProduk/PengunggahVideoMateri/g' \
  -e 's/PengunggahPdfProduk/PengunggahPdfMateri/g' \
  -e 's/productId/materiId/g' \
  "$f"
grep -n "Produk\b\|productId" "$f" || echo BERSIH
```

Expected: `BERSIH`, atau hanya kemunculan di dalam komentar/teks bahasa Indonesia yang tidak terkait nama fungsi. Teks untuk pengguna yang menyebut "produk", misalnya "Video tersimpan untuk produk ini", diganti "materi" dengan tangan.

- [ ] **Step 2: `form-produk.tsx`**

1. Hapus import `JENIS_SAH, LABEL_JENIS, type JenisProduk`.
2. `ProdukForm` menjadi alias tipe kelola:

```ts
import type { ProdukKelola } from "@/lib/admin/produk-admin";

export type ProdukForm = ProdukKelola;
```

Hapus deklarasi tipe `ProdukForm` lama.

3. Hapus `<label>` berisi `<select name="jenis">` dan `<label>` berisi checkbox `boleh_unduh`. Keduanya kini milik materi.
4. Di blok "Harga" (sesudah paragraf "Harga hanya bisa ditetapkan owner…"), tambahkan baris masa berlaku read-only:

```tsx
          <p className="mt-2 text-[13px] text-panel-ink">
            Masa berlaku: <b>{labelMasaBerlaku(produk.masaBerlakuBulan)}</b>
          </p>
```

Lalu tambahkan `import { labelMasaBerlaku } from "@/lib/produk/status";`.

5. Teks tombol nonaktif: `title` menjadi `"Lengkapi isinya dulu: minimal satu materi, dan setiap materi sudah diunggah."`, dan paragraf di bawah form menjadi `Isi belum lengkap — produk ini belum bisa ditayangkan.`

- [ ] **Step 3: Halaman daftar `admin/produk/page.tsx`**

1. Hapus objek saringan `{ nama: "jenis", ... }` seluruhnya.
2. Pilihan saringan `isi`: label menjadi `"Isi lengkap"` dan `"Isi belum lengkap"`.
3. Header tabel: `<Th>Jenis</Th>` diganti `<Th>Materi</Th>`.
4. Sel jenis diganti:

```tsx
                  <Td className="text-[12.5px]">
                    {ringkasJumlahMateri(p.jenisMateri) || (
                      <span className="italic text-panel-muted">Belum ada materi</span>
                    )}
                  </Td>
```

5. Sel isi: `berkas terpasang` diganti `lengkap`.
6. Import `LABEL_JENIS` diganti `ringkasJumlahMateri` dari `@/lib/produk/status`.

- [ ] **Step 4: Buat `pengunggah-sampul.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { MIME_SAMPUL, urlSampulPublik } from "@/lib/produk/objek";
import { terbitkanUrlSampul, catatSampul } from "./aksi-isi";

/**
 * Sampul produk (`materiId` null) atau materi. Unggah langsung dari peramban
 * ke bucket publik `produk-sampul` lewat URL bertanda tangan; nama objeknya
 * dipilih server dan diperiksa ulang saat dicatat.
 */
export function PengunggahSampul({
  productId,
  materiId,
  sampulObjek,
}: {
  productId: string;
  materiId: string | null;
  sampulObjek: string | null;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const url = urlSampulPublik(sampulObjek);

  function unggah(berkas: File) {
    mulai(async () => {
      setPesan(null);
      const izin = await terbitkanUrlSampul(productId, materiId, berkas.type, berkas.size);
      if (!izin.ok) { setPesan(izin.pesan); return; }

      const { error } = await createBrowserSupabase().storage
        .from("produk-sampul")
        .uploadToSignedUrl(izin.objek, izin.token, berkas, { contentType: berkas.type });
      if (error) { setPesan("Sampul gagal diunggah. Coba lagi."); return; }

      const catat = await catatSampul(productId, materiId, izin.objek);
      if (!catat.ok) { setPesan(catat.pesan); return; }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className={`${materiId ? "h-14 w-14" : "h-24 w-32"} flex-none overflow-hidden rounded-lg border border-panel-border bg-panel-bg`}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-[10.5px] text-panel-muted">Tanpa sampul</span>
        )}
      </div>
      <label className="cursor-pointer text-[12px] font-bold text-panel-ink underline">
        {pending ? "Mengunggah…" : url ? "Ganti sampul" : "Unggah sampul"}
        <input
          type="file"
          accept={MIME_SAMPUL.join(",")}
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const berkas = e.target.files?.[0];
            e.target.value = "";
            if (berkas) unggah(berkas);
          }}
        />
      </label>
      {pesan && <p className="text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Buat `editor-isi.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BabKelola, MateriKelola } from "@/lib/admin/produk-admin";
import { JENIS_MATERI, LABEL_JENIS_MATERI } from "@/lib/produk/status";
import {
  tambahBab, ubahJudulBab, geserBab, hapusBab,
  tambahMateri, perbaruiMateri, geserMateri, hapusMateri,
} from "./aksi-isi";
import { PengunggahSampul } from "./pengunggah-sampul";
import { PengunggahVideoMateri, PengunggahPdfMateri, LepasIsiMateri } from "./pengunggah-produk";

const KELAS_MEDAN =
  "mt-1 min-h-[36px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-1.5 text-[13px]";
const KELAS_TOMBOL =
  "rounded-lg border border-panel-border px-2.5 py-1 text-[12px] font-bold text-panel-ink disabled:opacity-50";

type Hasil = { ok: true } | { ok: false; pesan: string };

/** Satu pola untuk setiap aksi di layar ini: jalankan, tampilkan galat, segarkan. */
function useAksi() {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  function jalankan(fn: () => Promise<Hasil | { ok: true; objekTersisa: boolean }>) {
    mulai(async () => {
      const r = await fn();
      if (!r.ok) { setPesan(r.pesan); return; }
      setPesan("objekTersisa" in r && r.objekTersisa
        ? "Terhapus, tetapi sebagian berkas lama gagal dibersihkan. Beri tahu tim teknis."
        : null);
      router.refresh();
    });
  }
  return { pending, pesan, jalankan };
}

function Pesan({ teks }: { teks: string | null }) {
  return teks ? <p className="text-[12px] font-semibold text-clay">{teks}</p> : null;
}

function BarisMateri({
  productId, produkAktif, materi, pertama, terakhir,
}: {
  productId: string;
  produkAktif: boolean;
  materi: MateriKelola;
  pertama: boolean;
  terakhir: boolean;
}) {
  const { pending, pesan, jalankan } = useAksi();

  return (
    <li className="rounded-lg border border-panel-border bg-panel-surface p-3">
      <div className="flex flex-wrap items-start gap-3">
        <PengunggahSampul productId={productId} materiId={materi.id} sampulObjek={materi.sampulObjek} />
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] text-panel-ink">{materi.judul}</b>
          <span className="text-[11.5px] text-panel-muted">
            {LABEL_JENIS_MATERI[materi.jenis]}
            {materi.pratinjau && " · Pratinjau"}
            {materi.bolehUnduh && " · Bisa diunduh"}
            {" · "}
            {materi.berisi
              ? materi.jenis === "pdf" ? `${materi.jumlahHalaman} halaman` : "video tersimpan"
              : <span className="font-bold text-clay">belum berisi</span>}
          </span>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className={KELAS_TOMBOL} disabled={pending || pertama}
            onClick={() => jalankan(() => geserMateri(materi.id, "naik"))} aria-label="Naikkan materi">↑</button>
          <button type="button" className={KELAS_TOMBOL} disabled={pending || terakhir}
            onClick={() => jalankan(() => geserMateri(materi.id, "turun"))} aria-label="Turunkan materi">↓</button>
          <button type="button" className={KELAS_TOMBOL} disabled={pending}
            onClick={() => {
              if (confirm(`Hapus materi "${materi.judul}" beserta isinya? Ini tidak bisa dibatalkan.`)) {
                jalankan(() => hapusMateri(materi.id));
              }
            }}>Hapus</button>
        </div>
      </div>
      <Pesan teks={pesan} />

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">Sunting & unggah isi</summary>
        <form
          className="mt-2 grid gap-2"
          action={(fd) => jalankan(() => perbaruiMateri(materi.id, fd))}
        >
          <label className="text-[12px] font-bold text-panel-muted">
            Judul
            <input name="judul" required minLength={2} defaultValue={materi.judul} className={KELAS_MEDAN} />
          </label>
          <label className="text-[12px] font-bold text-panel-muted">
            Keterangan
            <textarea name="keterangan" rows={2} defaultValue={materi.keterangan} className={KELAS_MEDAN} />
          </label>
          <label className="text-[12px] font-bold text-panel-muted">
            Jenis
            <select name="jenis" defaultValue={materi.jenis} className={KELAS_MEDAN}>
              {JENIS_MATERI.map((j) => <option key={j} value={j}>{LABEL_JENIS_MATERI[j]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-panel-ink">
            <input name="pratinjau" type="checkbox" defaultChecked={materi.pratinjau} className="h-4 w-4" />
            Pratinjau — bisa dibuka pengguna yang login tanpa membeli
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-panel-ink">
            <input name="boleh_unduh" type="checkbox" defaultChecked={materi.bolehUnduh} className="h-4 w-4" />
            Boleh diunduh pembeli
          </label>
          <button type="submit" disabled={pending} className={`${KELAS_TOMBOL} justify-self-start`}>
            {pending ? "Menyimpan…" : "Simpan materi"}
          </button>
        </form>

        <div className="mt-3 rounded-lg border border-panel-border bg-panel-bg p-3">
          {materi.jenis === "video" ? (
            <PengunggahVideoMateri materiId={materi.id} />
          ) : (
            <PengunggahPdfMateri materiId={materi.id} bolehUnduh={materi.bolehUnduh} />
          )}
          {!produkAktif && materi.berisi && <LepasIsiMateri materiId={materi.id} />}
        </div>
      </details>
    </li>
  );
}

function KartuBab({
  productId, produkAktif, bab, pertama, terakhir,
}: {
  productId: string;
  produkAktif: boolean;
  bab: BabKelola;
  pertama: boolean;
  terakhir: boolean;
}) {
  const { pending, pesan, jalankan } = useAksi();

  return (
    <section className="rounded-lg border border-panel-border bg-panel-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex flex-1 gap-2" action={(fd) => jalankan(() => ubahJudulBab(bab.id, String(fd.get("judul") ?? "")))}>
          <input name="judul" required defaultValue={bab.judul} aria-label="Judul bab"
            className="min-h-[36px] flex-1 rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px] font-bold" />
          <button type="submit" disabled={pending} className={KELAS_TOMBOL}>Simpan</button>
        </form>
        <span className="text-[11.5px] text-panel-muted">{bab.materi.length} materi</span>
        <button type="button" className={KELAS_TOMBOL} disabled={pending || pertama}
          onClick={() => jalankan(() => geserBab(bab.id, "naik"))} aria-label="Naikkan bab">↑</button>
        <button type="button" className={KELAS_TOMBOL} disabled={pending || terakhir}
          onClick={() => jalankan(() => geserBab(bab.id, "turun"))} aria-label="Turunkan bab">↓</button>
        {bab.materi.length === 0 && (
          <button type="button" className={KELAS_TOMBOL} disabled={pending}
            onClick={() => jalankan(() => hapusBab(bab.id))}>Hapus bab</button>
        )}
      </div>
      <Pesan teks={pesan} />

      <ul className="mt-3 grid gap-2">
        {bab.materi.map((m, i) => (
          <BarisMateri key={m.id} productId={productId} produkAktif={produkAktif} materi={m}
            pertama={i === 0} terakhir={i === bab.materi.length - 1} />
        ))}
      </ul>

      <form
        className="mt-3 grid gap-2 rounded-lg border border-dashed border-panel-border p-3 sm:grid-cols-[1fr_140px_auto]"
        action={(fd) => jalankan(() => tambahMateri(bab.id, fd))}
      >
        <input name="judul" required minLength={2} placeholder="Judul materi baru" aria-label="Judul materi baru"
          className="min-h-[36px] rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px]" />
        <select name="jenis" defaultValue="video" aria-label="Jenis materi"
          className="min-h-[36px] rounded-lg border border-panel-border bg-panel-surface px-2 text-[13px]">
          {JENIS_MATERI.map((j) => <option key={j} value={j}>{LABEL_JENIS_MATERI[j]}</option>)}
        </select>
        <button type="submit" disabled={pending} className={KELAS_TOMBOL}>+ Materi</button>
        <input type="hidden" name="keterangan" value="" />
      </form>
    </section>
  );
}

export function EditorIsi({
  productId, produkAktif, bab,
}: {
  productId: string;
  produkAktif: boolean;
  bab: BabKelola[];
}) {
  const { pending, pesan, jalankan } = useAksi();

  return (
    <div className="grid gap-3">
      {bab.length === 0 && (
        <p className="text-[12.5px] italic text-panel-muted">
          Belum ada bab. Produk kecil cukup punya satu bab, misalnya &ldquo;Materi&rdquo;.
        </p>
      )}
      {bab.map((b, i) => (
        <KartuBab key={b.id} productId={productId} produkAktif={produkAktif} bab={b}
          pertama={i === 0} terakhir={i === bab.length - 1} />
      ))}
      <form className="flex gap-2" action={(fd) => jalankan(() => tambahBab(productId, String(fd.get("judul") ?? "")))}>
        <input name="judul" required placeholder="Judul bab baru" aria-label="Judul bab baru"
          className="min-h-[36px] flex-1 rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px]" />
        <button type="submit" disabled={pending}
          className="rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60">
          + Bab
        </button>
      </form>
      <Pesan teks={pesan} />
    </div>
  );
}
```

- [ ] **Step 6: Ganti seluruh isi `admin/produk/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilProduk, ambilIsiProduk } from "@/lib/admin/produk-admin";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormProduk } from "../form-produk";
import { ringkasJumlahMateri, statusAkses, formatTanggalAkses } from "@/lib/produk/status";
import { PengunggahSampul } from "./pengunggah-sampul";
import { EditorIsi } from "./editor-isi";

export const metadata = { title: "Detail produk" };

const BASIS = "/admin/produk";

function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Tayang" : "Nonaktif"}
    </span>
  );
}

type Pembeli = { nama: string; diberikanPada: string; sumber: string; berlaku: string };

const LABEL_SUMBER: Record<string, string> = {
  beli: "Beli",
  gratis: "Gratis",
  pemberian_admin: "Pemberian admin",
};

async function daftarPembeli(productId: string): Promise<Pembeli[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_entitlements")
    .select("diberikan_pada, sumber, berlaku_sampai, clients(nama)")
    .eq("product_id", productId)
    .is("dicabut_pada", null)
    .order("diberikan_pada", { ascending: false })
    .returns<Array<{
      diberikan_pada: string;
      sumber: string;
      berlaku_sampai: string | null;
      clients: { nama: string } | null;
    }>>();
  if (error) throw new Error(`Gagal membaca daftar pembeli: ${error.message}`);

  return (data ?? []).map((b) => {
    const s = statusAkses(b.berlaku_sampai);
    return {
      nama: b.clients?.nama ?? "(klien tidak ditemukan)",
      diberikanPada: b.diberikan_pada,
      sumber: LABEL_SUMBER[b.sumber] ?? b.sumber,
      berlaku:
        s.keadaan === "selamanya" ? "Selamanya"
        : s.keadaan === "aktif" ? `s.d. ${formatTanggalAkses(s.sampai)}`
        : `Habis ${formatTanggalAkses(s.sampai)}`,
    };
  });
}

export default async function DetailProdukPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const produk = await ambilProduk(id);
  if (!produk) notFound();

  const [pembeli, bab] = await Promise.all([daftarPembeli(id), ambilIsiProduk(id)]);

  return (
    <main>
      <Link href={BASIS} className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Produk Digital
      </Link>

      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-panel-ink">{produk.judul}</h1>
          <p className="mt-0.5 text-[12.5px] text-panel-muted">
            {ringkasJumlahMateri(produk.jenisMateri) || "Belum ada materi."}
          </p>
        </div>
        <PillAktif aktif={produk.aktif} />
      </header>

      <div className="grid gap-3">
        <Kartu judul="Data produk">
          <div className="grid gap-4">
            <PengunggahSampul productId={id} materiId={null} sampulObjek={produk.sampulObjek} />
            <FormProduk produk={produk} hrefTutup={`${BASIS}/${id}`} />
          </div>
        </Kartu>

        <Kartu judul="Bab & materi">
          <EditorIsi productId={id} produkAktif={produk.aktif} bab={bab} />
        </Kartu>

        <Kartu judul="Pembeli">
          {pembeli.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">
              Belum ada yang memiliki akses produk ini.
            </p>
          ) : (
            <Tabel label="Daftar pembeli">
              <thead>
                <tr>
                  <Th>Klien</Th>
                  <Th>Tanggal</Th>
                  <Th>Sumber</Th>
                  <Th>Masa berlaku</Th>
                </tr>
              </thead>
              <tbody>
                {pembeli.map((b, i) => (
                  <tr key={i}>
                    <Td>{b.nama}</Td>
                    <Td className="font-mono text-[12.5px]">
                      {new Date(b.diberikanPada).toLocaleDateString("id-ID")}
                    </Td>
                    <Td>{b.sumber}</Td>
                    <Td>{b.berlaku}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Periksa tipe, lint, dan uji manual**

Run: `npx tsc --noEmit 2>&1 | grep "src/app/admin/produk" || echo BERSIH` lalu `npx eslint src/app/admin/produk`
Expected: `BERSIH`, dan lint tanpa galat.

Uji manual (bila Docker hidup; `npm run dev`, masuk sebagai `admin@padma.test`):
1. Buat produk → tambah bab "Materi" → tambah materi video & artikel → unggah sampul materi → unggah isi keduanya.
2. Tombol "Tayangkan" baru aktif setelah kedua materi berisi.
3. Ganti sampul produk dua kali → URL gambar berbeda (Review Focus 4).
4. Hapus bab yang masih berisi → tombolnya tidak muncul. Hapus materi terakhir saat produk tayang → ditolak.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/admin/produk
git commit -m "feat(admin): penyunting bab & materi, sampul, daftar produk tanpa jenis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Panel owner — masa berlaku

**Files:**
- Modify: `web/src/lib/owner/daftar-produk.ts`
- Modify: `web/src/app/owner/produk/aksi.ts`
- Create: `web/src/app/owner/produk/form-masa-berlaku.tsx`
- Modify: `web/src/app/owner/produk/page.tsx`

**Interfaces:**
- Consumes: Task 1 (kolom `masa_berlaku_bulan` + trigger owner), Task 4 (`periksaMasaBerlaku`, `labelMasaBerlaku`, `MASA_BERLAKU_MAKS_BULAN`).
- Produces: `tetapkanMasaBerlaku(formData: FormData): Promise<{ ok: true } | { ok: false; pesan: string }>`, dengan medan `produk`, `satuan` ("selamanya" | "bulan" | "tahun"), dan `jumlah`. `BarisProdukHarga` mendapat `masaBerlakuBulan: number | null` dan kehilangan `jenis`.

- [ ] **Step 1: `daftar-produk.ts`**

1. Hapus `import type { JenisProduk } ...`.
2. Di `BarisProdukHarga`, ganti `jenis: JenisProduk;` dengan `masaBerlakuBulan: number | null;`.
3. `type BarisProduk` menjadi `{ id: string; judul: string; slug: string; aktif: boolean; masa_berlaku_bulan: number | null }`.
4. `.select("id, judul, slug, jenis, aktif")` menjadi `.select("id, judul, slug, aktif, masa_berlaku_bulan")`.
5. Di pemetaan, `jenis: p.jenis,` menjadi `masaBerlakuBulan: p.masa_berlaku_bulan,`.

- [ ] **Step 2: Aksi owner**

Tambahkan ke `web/src/app/owner/produk/aksi.ts`:

1. Import menjadi `import { periksaHarga, periksaHargaCoretProduk, periksaMasaBerlaku, PESAN_PRODUK } from "@/lib/produk/status";`
2. Fungsi baru di ujung berkas:

```ts
/**
 * Masa berlaku adalah syarat jual, sepasang dengan harga — owner saja.
 * Gerbang sesungguhnya ada di basis data (trigger jaga_masa_berlaku_produk);
 * requireRole di sini hanya membuat penolakannya sopan.
 *
 * Mengubahnya TIDAK menyentuh pembeli lama (berlaku_sampai dibekukan saat
 * akses terbit) maupun pesanan yang sedang menunggu bayar (durasi dibekukan
 * di order_items saat checkout).
 */
export async function tetapkanMasaBerlaku(formData: FormData): Promise<Hasil> {
  await requireRole(["owner"]);

  const productId = String(formData.get("produk") ?? "").trim();
  if (!productId) return { ok: false, pesan: "Produk wajib dipilih." };

  const masa = periksaMasaBerlaku(String(formData.get("satuan") ?? ""), String(formData.get("jumlah") ?? ""));
  if (!masa.ok) return { ok: false, pesan: masa.pesan };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_products")
    .update({ masa_berlaku_bulan: masa.nilai })
    .eq("id", productId)
    .select("id");
  if (error?.code === "42501") return { ok: false, pesan: "Masa berlaku hanya bisa diatur owner." };
  if (error) return { ok: false, pesan: `Masa berlaku gagal disimpan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Produk tidak dikenal." };

  revalidatePath("/owner/produk");
  revalidatePath("/admin/produk");
  revalidatePath("/produk");
  return { ok: true };
}
```

- [ ] **Step 3: Buat `form-masa-berlaku.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tetapkanMasaBerlaku } from "./aksi";
import { labelMasaBerlaku, MASA_BERLAKU_MAKS_BULAN } from "@/lib/produk/status";

const KELAS_MEDAN =
  "mt-1 min-h-[38px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px]";

function awal(bulan: number | null): { satuan: string; jumlah: string } {
  if (bulan === null) return { satuan: "selamanya", jumlah: "" };
  if (bulan % 12 === 0) return { satuan: "tahun", jumlah: String(bulan / 12) };
  return { satuan: "bulan", jumlah: String(bulan) };
}

export function FormMasaBerlaku({
  productId,
  masaBerlakuBulan,
}: {
  productId: string;
  masaBerlakuBulan: number | null;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [satuan, setSatuan] = useState(awal(masaBerlakuBulan).satuan);

  return (
    <form
      className="mt-4 grid gap-2 rounded-lg border border-panel-border bg-panel-bg p-3"
      action={(fd) =>
        mulai(async () => {
          const r = await tetapkanMasaBerlaku(fd);
          if (!r.ok) { setPesan(r.pesan); return; }
          setPesan(null);
          router.refresh();
        })
      }
    >
      <h3 className="text-[12.5px] font-bold text-panel-muted">
        Masa berlaku sesudah dibeli — sekarang {labelMasaBerlaku(masaBerlakuBulan)}
      </h3>
      <input type="hidden" name="produk" value={productId} />
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <select name="satuan" value={satuan} onChange={(e) => setSatuan(e.target.value)}
          aria-label="Satuan masa berlaku" className={KELAS_MEDAN}>
          <option value="selamanya">Selamanya</option>
          <option value="bulan">Bulan</option>
          <option value="tahun">Tahun</option>
        </select>
        <input name="jumlah" type="number" min={1}
          max={satuan === "tahun" ? MASA_BERLAKU_MAKS_BULAN / 12 : MASA_BERLAKU_MAKS_BULAN}
          defaultValue={awal(masaBerlakuBulan).jumlah}
          disabled={satuan === "selamanya"} required={satuan !== "selamanya"}
          aria-label="Jumlah" className={KELAS_MEDAN} />
      </div>
      <p className="text-[11px] text-panel-muted/80">
        Perubahan hanya berlaku untuk pembelian berikutnya. Pembeli lama dan pesanan yang sedang menunggu bayar tetap memakai durasi saat mereka checkout.
      </p>
      {pesan && <p className="text-[12.5px] font-semibold text-clay">{pesan}</p>}
      <button type="submit" disabled={pending}
        className="justify-self-start rounded-lg bg-panel-ink px-4 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60">
        {pending ? "Menyimpan…" : "Simpan masa berlaku"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: `owner/produk/page.tsx`**

1. Import `LABEL_JENIS` diganti `labelMasaBerlaku` dari `@/lib/produk/status`, ditambah `import { FormMasaBerlaku } from "./form-masa-berlaku";`.
2. Header tabel: `<Th>Jenis</Th>` diganti `<Th>Masa berlaku</Th>`.
3. Sel jenis (`<Td><span ...>{LABEL_JENIS[b.jenis]}</span></Td>`) diganti `<Td className="text-[12.5px]">{labelMasaBerlaku(b.masaBerlakuBulan)}</Td>`.
4. Tautan aksi berteks "Tetapkan harga" diganti "Harga & masa berlaku".
5. Di dalam `<PanelGeser>`, tepat sesudah `<FormHargaProduk ... />`, tambahkan:

```tsx
          <FormMasaBerlaku productId={barisUbah.productId} masaBerlakuBulan={barisUbah.masaBerlakuBulan} />
```

- [ ] **Step 5: Periksa & commit**

Run: `npx tsc --noEmit 2>&1 | grep "src/\(app/owner\|lib/owner\)" || echo BERSIH` lalu `npx eslint src/app/owner/produk src/lib/owner`
Expected: `BERSIH`, tanpa galat lint.

```bash
git add web/src/lib/owner/daftar-produk.ts web/src/app/owner/produk
git commit -m "feat(owner): masa berlaku produk di samping harga

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Kembali sesudah login & kepemilikan di peramban

**Files:**
- Modify: `web/src/lib/auth/tujuan-produk.ts`
- Create: `web/tests/tujuan-produk-materi.test.ts`
- Modify: `web/src/app/produk/[slug]/ambil.ts`
- Modify: `web/src/app/produk/[slug]/tombol-ambil.tsx:108-125`

**Interfaces:**
- Produces:
  - `tujuanProdukAman(nilai)` kini juga menerima `/passport/produk/<slug>/<uuid>`. Nama dan tanda tangan tetap, jadi `setelah-masuk/route.ts` tidak disentuh.
  - `titipTujuanDiPeramban(path)`, tanda tangan tetap.
  - `punyaProdukDiPeramban(sb, productId)` kini lewat RPC `punya_produk`, jadi ikut sadar kedaluwarsa.
- Consumes: `punya_produk` (Task 2).

- [ ] **Step 1: Tulis uji yang gagal**

Create `web/tests/tujuan-produk-materi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tujuanProdukAman } from "@/lib/auth/tujuan-produk";

const U = "0f8b2a4c-1d3e-4f5a-9b6c-7d8e9f0a1b2c";

describe("tujuanProdukAman — penampil materi (spec 2026-10-16)", () => {
  it("menerima penampil materi berslug + uuid", () => {
    expect(tujuanProdukAman(`/passport/produk/kelas-menyusui/${U}`)).toBe(`/passport/produk/kelas-menyusui/${U}`);
  });

  it("tetap menerima halaman produk", () => {
    expect(tujuanProdukAman("/produk/kelas-menyusui")).toBe("/produk/kelas-menyusui");
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil",
    "/passport/produk/x/bukan-uuid",
    `/passport/produk/x/../../admin`,
    `/passport/produk/x/${U}/lagi`,
    `/passport/produk/${U}`,
    `/passport/produk/X/${U}`,
    `/passport/produk/x/${U.toUpperCase()}`,
    `/passport/produk/x/${U}?a=1`,
    `/passport/admin/x/${U}`,
  ])("menolak %s", (nilai) => {
    expect(tujuanProdukAman(nilai)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npx vitest run tests/tujuan-produk-materi.test.ts tests/tujuan-produk.test.ts`
Expected: FAIL pada "menerima penampil materi"; sisanya PASS. Bila `global-setup` macet karena Docker mati, tandai **TERTUNDA**.

- [ ] **Step 3: Perluas `tujuan-produk.ts`**

Ganti konstanta pola dan fungsi `tujuanProdukAman`. Docblock kepala berkas ditambah satu paragraf: "Sejak spec 2026-10-16 ada pola KEDUA yang sama sempitnya: penampil materi `/passport/produk/<slug>/<uuid>`, untuk pengunjung yang menekan "Lihat" pada materi pratinjau sebelum login."

```ts
const POLA_TUJUAN_PRODUK = /^\/produk\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POLA_TUJUAN_MATERI =
  /^\/passport\/produk\/[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function tujuanProdukAman(nilai: string | null | undefined): string | null {
  // 200: slug terpanjang (judul 120 karakter) + awalan + uuid masih muat;
  // apa pun yang lebih panjang bukan path yang pernah kita tulis.
  if (typeof nilai !== "string" || nilai.length > 200) return null;
  return POLA_TUJUAN_PRODUK.test(nilai) || POLA_TUJUAN_MATERI.test(nilai) ? nilai : null;
}
```

- [ ] **Step 4: Jalankan uji**

Run: `npx vitest run tests/tujuan-produk-materi.test.ts tests/tujuan-produk.test.ts`
Expected: PASS semua. Uji lama `` `/produk/${"a".repeat(200)}` `` tetap ditolak karena panjangnya 208.

- [ ] **Step 5: "Ambil gratis" menitipkan tujuan**

Di `web/src/app/produk/[slug]/ambil.ts`:

1. Tambahkan import:

```ts
import { cookies } from "next/headers";
import { COOKIE_LANJUT } from "@/lib/auth/tujuan-produk";
```

2. Ganti `if (!user) redirect("/masuk");` dengan:

```ts
  if (!user) {
    // Dititipkan di cookie yang sama dengan tombol beli (spec P2); dibaca
    // dan dihapus oleh `/setelah-masuk`. Pengunjung mendarat lagi di produk
    // ini dan menekan "Ambil gratis" sekali lagi — tidak ada pengambilan
    // yang berjalan otomatis sesudah login.
    (await cookies()).set(COOKIE_LANJUT, `/produk/${slug}`, {
      path: "/",
      maxAge: 3600,
      sameSite: "lax",
    });
    redirect("/masuk");
  }
```

3. Paragraf docblock yang dimulai "Repo ini TIDAK punya parameter pengalihan pasca-login…" sampai "…bisa mengambil produknya lagi dari sana." diganti dengan: "Pengunjung anon dititipi tujuan `/produk/<slug>` di cookie `padma_lanjut` (lihat `lib/auth/tujuan-produk.ts`), lalu diarahkan ke `/masuk`; `/setelah-masuk` memulangkannya ke sini."

`slug` di sini berasal dari argumen server action, jadi masukan pemanggil. Nilainya tetap aman karena `/setelah-masuk` memvalidasi ulang lewat `tujuanProdukAman` sebelum memakainya.

- [ ] **Step 6: `punyaProdukDiPeramban` lewat RPC**

Di `web/src/app/produk/[slug]/tombol-ambil.tsx`, ganti badan sesudah pemeriksaan sesi:

```ts
  const { data: baris } = await sb
    .from("digital_entitlements")
    .select("id")
    .eq("product_id", productId)
    .is("dicabut_pada", null)
    .maybeSingle();
  return baris !== null;
```

dengan:

```ts
  // Predikat yang SAMA dengan gerbang isi: tidak dicabut DAN belum
  // kedaluwarsa. Membaca tabel langsung akan menganggap akses yang habis
  // masih dimiliki, sehingga tombol "Buka" menuju materi yang terkunci dan
  // tombol beli ulang tidak pernah muncul.
  const { data } = await sb.rpc("punya_produk", { p_product_id: productId });
  return data === true;
```

Perbarui juga docblock fungsinya, kalau menyebut membaca `digital_entitlements`.

- [ ] **Step 7: Periksa & commit**

Run: `npx tsc --noEmit 2>&1 | grep "src/\(lib/auth\|app/produk/\[slug\]/\(ambil\|tombol-ambil\)\)" || echo BERSIH`
Expected: `BERSIH`.

```bash
git add web/src/lib/auth/tujuan-produk.ts web/tests/tujuan-produk-materi.test.ts "web/src/app/produk/[slug]/ambil.ts" "web/src/app/produk/[slug]/tombol-ambil.tsx"
git commit -m "feat(produk): kembali ke penampil materi sesudah login; kepemilikan lewat punya_produk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Halaman publik — kartu, halaman produk, daftar bab

**Files:**
- Modify: `web/src/lib/produk/katalog.ts` (seluruh isi diganti)
- Modify: `web/src/app/produk/kartu-produk.tsx`
- Create: `web/src/app/produk/[slug]/daftar-bab.tsx`
- Modify: `web/src/app/produk/[slug]/page.tsx`

**Interfaces:**
- Consumes: Task 1 (policy baca publik bab/materi), Task 4 (`ringkasJumlahMateri`, `labelMasaBerlaku`, `urlSampulPublik`, `LABEL_JENIS_MATERI`), Task 8 (`titipTujuanDiPeramban`, `punyaProdukDiPeramban`).
- Produces:
  - `type ProdukPublik = { id; judul; slug; deskripsi; sampulObjek: string | null; masaBerlakuBulan: number | null; jenisMateri: JenisMateri[]; harga: number | null; hargaCoret: number | null }`
  - `type MateriPublik = { id; judul; keterangan; jenis: JenisMateri; sampulObjek: string | null; pratinjau: boolean }`
  - `type BabPublik = { id; judul; materi: MateriPublik[] }`
  - `bacaProdukPublik(batas?)`, `bacaProdukPerSlug(slug): Promise<(ProdukPublik & { bab: BabPublik[] }) | null>`
  - `DaftarBab({ slug, productId, bab })`, komponen klien

- [ ] **Step 1: Ganti seluruh isi `katalog.ts`**

```ts
import { createClient } from "@supabase/supabase-js";
import type { JenisMateri } from "@/lib/produk/status";

/**
 * Katalog publik dibaca dengan ANON KEY supaya policy baca publik benar-benar
 * teruji: daftar bab & materi hanya terbaca untuk produk tayang, isinya
 * (files/pages) tidak pernah.
 */
export type ProdukPublik = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  sampulObjek: string | null;
  masaBerlakuBulan: number | null;
  jenisMateri: JenisMateri[];
  harga: number | null;
  hargaCoret: number | null;
};

export type MateriPublik = {
  id: string;
  judul: string;
  keterangan: string;
  jenis: JenisMateri;
  sampulObjek: string | null;
  pratinjau: boolean;
};

export type BabPublik = { id: string; judul: string; materi: MateriPublik[] };

function klienPublik() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type BarisProduk = {
  id: string;
  judul: string;
  slug: string;
  deskripsi: string;
  sampul_objek: string | null;
  masa_berlaku_bulan: number | null;
  digital_product_materials: Array<{ jenis: JenisMateri }>;
};
type BarisHarga = { product_id: string; harga: number; harga_coret: number | null };
type BarisMateri = {
  id: string; judul: string; keterangan: string; jenis: JenisMateri;
  sampul_objek: string | null; pratinjau: boolean; urutan: number; created_at: string;
};
type BarisBab = {
  id: string; judul: string; urutan: number; created_at: string;
  digital_product_materials: BarisMateri[];
};

const KOLOM_PRODUK =
  "id, judul, slug, deskripsi, sampul_objek, masa_berlaku_bulan, digital_product_materials(jenis)";

function urut<T extends { urutan: number; created_at: string }>(a: T, b: T): number {
  return a.urutan - b.urutan || a.created_at.localeCompare(b.created_at);
}

function rakit(produk: BarisProduk[], harga: BarisHarga[]): ProdukPublik[] {
  const peta = new Map(harga.map((h) => [h.product_id, h]));
  return produk.map((p) => {
    const h = peta.get(p.id);
    return {
      id: p.id,
      judul: p.judul,
      slug: p.slug,
      deskripsi: p.deskripsi,
      sampulObjek: p.sampul_objek,
      masaBerlakuBulan: p.masa_berlaku_bulan,
      jenisMateri: p.digital_product_materials.map((m) => m.jenis),
      harga: h?.harga ?? null,
      hargaCoret: h?.harga_coret ?? null,
    };
  });
}

export async function bacaProdukPublik(batas?: number): Promise<ProdukPublik[]> {
  const supabase = klienPublik();

  let q = supabase
    .from("digital_products")
    .select(KOLOM_PRODUK)
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
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);

  return rakit(produk!, harga ?? []);
}

export async function bacaProdukPerSlug(
  slug: string,
): Promise<(ProdukPublik & { bab: BabPublik[] }) | null> {
  const supabase = klienPublik();
  const { data: produk, error } = await supabase
    .from("digital_products")
    .select(KOLOM_PRODUK)
    .eq("slug", slug)
    .maybeSingle<BarisProduk>();
  if (error) throw new Error(`Gagal membaca produk: ${error.message}`);
  if (!produk) return null;

  const [{ data: harga, error: hargaError }, { data: bab, error: babError }] = await Promise.all([
    supabase
      .from("harga_produk_publik")
      .select("product_id, harga, harga_coret")
      .eq("product_id", produk.id)
      .returns<BarisHarga[]>(),
    supabase
      .from("digital_product_sections")
      .select(
        "id, judul, urutan, created_at, digital_product_materials(id, judul, keterangan, jenis, sampul_objek, pratinjau, urutan, created_at)",
      )
      .eq("product_id", produk.id)
      .returns<BarisBab[]>(),
  ]);
  if (hargaError) throw new Error(`Gagal membaca harga produk: ${hargaError.message}`);
  if (babError) throw new Error(`Gagal membaca daftar materi: ${babError.message}`);

  return {
    ...rakit([produk], harga ?? [])[0],
    bab: [...(bab ?? [])].sort(urut).map((b) => ({
      id: b.id,
      judul: b.judul,
      materi: [...b.digital_product_materials].sort(urut).map((m) => ({
        id: m.id,
        judul: m.judul,
        keterangan: m.keterangan,
        jenis: m.jenis,
        sampulObjek: m.sampul_objek,
        pratinjau: m.pratinjau,
      })),
    })),
  };
}
```

- [ ] **Step 2: `kartu-produk.tsx`**

1. Import `LABEL_JENIS` diganti `ringkasJumlahMateri` dari `@/lib/produk/status` dan `urlSampulPublik` dari `@/lib/produk/objek`.
2. `const sampulUrl = produk.sampulObjek ? ... : null;` diganti `const sampulUrl = urlSampulPublik(produk.sampulObjek);`.
3. Placeholder tanpa sampul: `{LABEL_JENIS[produk.jenis]}` diganti `{produk.judul}`.
4. Blok `<div className="flex flex-wrap items-center gap-1.5">…</div>` (badge jenis + "Bisa diunduh") diganti dengan blok berikut, ditaruh SESUDAH `<h3>`:

```tsx
        {produk.deskripsi !== "" && (
          <p className="line-clamp-2 text-[13px] text-ink-soft">{produk.deskripsi}</p>
        )}
        {produk.jenisMateri.length > 0 && (
          <p className="text-[12.5px] font-semibold text-ink-soft">
            {ringkasJumlahMateri(produk.jenisMateri)}
          </p>
        )}
```

- [ ] **Step 3: Buat `daftar-bab.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { BabPublik, MateriPublik } from "@/lib/produk/katalog";
import { LABEL_JENIS_MATERI } from "@/lib/produk/status";
import { urlSampulPublik } from "@/lib/produk/objek";
import { titipTujuanDiPeramban } from "@/lib/auth/tujuan-produk";
import { punyaProdukDiPeramban } from "./tombol-ambil";

/**
 * Daftar bab & materi seperti referensi klien: bab bisa dibuka-tutup,
 * materi pratinjau berlabel "Lihat", sisanya bergembok.
 *
 * Halaman ini anon dan `revalidate = 300`, jadi siapa pemanggilnya hanya
 * diketahui di peramban — pola yang sama dengan `TombolAmbil`. Gembok di sini
 * hanyalah TAMPILAN; yang benar-benar menolak adalah RLS `boleh_buka_materi`
 * di balik penampil dan rute isi.
 */
type Pemanggil = "memuat" | "anon" | "login" | "pemilik";

function Thumbnail({ materi, terkunci }: { materi: MateriPublik; terkunci: boolean }) {
  const url = urlSampulPublik(materi.sampulObjek);
  return (
    <span className="relative h-14 w-14 flex-none overflow-hidden rounded-lg bg-paper">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center text-[18px] text-ink-soft">
          {materi.jenis === "pdf" ? "📖" : "▶"}
        </span>
      )}
      {terkunci && (
        <span className="absolute inset-0 flex items-center justify-center bg-night/45 text-[18px]" aria-hidden>
          🔒
        </span>
      )}
    </span>
  );
}

export function DaftarBab({
  slug,
  productId,
  bab,
}: {
  slug: string;
  productId: string;
  bab: BabPublik[];
}) {
  const router = useRouter();
  const [pemanggil, setPemanggil] = useState<Pemanggil>("memuat");

  useEffect(() => {
    const sb = createBrowserSupabase();
    let hidup = true;
    void (async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) { if (hidup) setPemanggil("anon"); return; }
      const punya = await punyaProdukDiPeramban(sb, productId);
      if (hidup) setPemanggil(punya ? "pemilik" : "login");
    })();
    return () => { hidup = false; };
  }, [productId]);

  const total = bab.reduce((n, b) => n + b.materi.length, 0);
  if (total === 0) return null;

  // Fungsi render, bukan komponen bersarang: komponen yang didefinisikan di
  // dalam render lahir ulang tiap render dan kehilangan state/fokusnya.
  function baris(materi: MateriPublik) {
    const bolehBuka = pemanggil === "pemilik" || materi.pratinjau;
    const href = `/passport/produk/${slug}/${materi.id}`;
    const isi = (
      <>
        <span className={`w-12 flex-none text-center text-[11px] font-bold ${bolehBuka ? "text-clay" : "text-ink-soft/60"}`}>
          {bolehBuka ? (pemanggil === "pemilik" ? "Buka" : "Lihat") : LABEL_JENIS_MATERI[materi.jenis]}
        </span>
        <Thumbnail materi={materi} terkunci={!bolehBuka} />
        <span className="min-w-0">
          <b className="block text-[14px] text-night">{materi.judul}</b>
          {materi.keterangan !== "" && (
            <span className="line-clamp-2 text-[13px] text-ink-soft">{materi.keterangan}</span>
          )}
        </span>
      </>
    );
    const kelas = "flex min-h-[64px] items-center gap-3 rounded-xl p-2";

    if (!bolehBuka || pemanggil === "memuat") return <li key={materi.id} className={kelas}>{isi}</li>;
    if (pemanggil === "anon") {
      return (
        <li key={materi.id}>
          <button
            type="button"
            className={`${kelas} w-full text-left hover:bg-paper`}
            onClick={() => {
              titipTujuanDiPeramban(href);
              router.push("/masuk");
            }}
          >
            {isi}
          </button>
        </li>
      );
    }
    return (
      <li key={materi.id}>
        <Link href={href} className={`${kelas} hover:bg-paper`}>{isi}</Link>
      </li>
    );
  }

  return (
    <section className="mt-6">
      <p className="mb-3 text-[13px] font-semibold text-ink-soft">{total} Materi</p>
      {pemanggil === "anon" && bab.some((b) => b.materi.some((m) => m.pratinjau)) && (
        <p className="mb-3 text-[12.5px] text-ink-soft">Masuk untuk membuka materi pratinjau.</p>
      )}
      <div className="grid gap-3">
        {bab.map((b, i) => (
          <details key={b.id} open={i === 0} className="rounded-2xl border border-black/10 bg-white">
            <summary className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 px-5 py-3">
              <b className="text-[15px] text-night">{b.judul}</b>
              <span className="flex-none text-[12.5px] text-ink-soft">{b.materi.length} Materi</span>
            </summary>
            <ul className="grid gap-1 px-3 pb-3">
              {b.materi.map((m) => baris(m))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Halaman `produk/[slug]/page.tsx`**

1. Import `LABEL_JENIS` diganti:

```ts
import { labelMasaBerlaku } from "@/lib/produk/status";
import { urlSampulPublik } from "@/lib/produk/objek";
import { DaftarBab } from "./daftar-bab";
```

2. `HargaProduk` mendapat prop `masaBerlakuBulan: number | null`. Di cabang berbayar, sesudah `<span className="text-2xl font-bold text-night">{formatRupiah(harga)}</span>`, tambahkan:

```tsx
        {masaBerlakuBulan !== null && (
          <span className="text-[14px] text-ink-soft">/ {labelMasaBerlaku(masaBerlakuBulan)}</span>
        )}
```

Untuk produk gratis bermasa berlaku, tambahkan di cabang `harga === 0`, sesudah badge "Gratis":

```tsx
        {masaBerlakuBulan !== null && (
          <span className="text-[13px] text-ink-soft">Akses {labelMasaBerlaku(masaBerlakuBulan).toLowerCase()}</span>
        )}
```

3. Ganti `<section className="mx-auto max-w-3xl px-5 py-14">…</section>` dengan tata letak dua kolom:

```tsx
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <aside className="overflow-hidden rounded-2xl border border-black/10 bg-white lg:sticky lg:top-6">
          {urlSampulPublik(produk.sampulObjek) && (
            <img src={urlSampulPublik(produk.sampulObjek)!} alt="" className="aspect-[4/3] w-full object-cover" />
          )}
          <div className="p-5">
            <div className="flex justify-end">
              <TautanKeranjang />
            </div>
            <h1 className="text-[22px] font-bold leading-snug text-ink">{produk.judul}</h1>
            <HargaProduk
              slug={produk.slug}
              productId={produk.id}
              harga={produk.harga}
              hargaCoret={produk.hargaCoret}
              masaBerlakuBulan={produk.masaBerlakuBulan}
              produksi={midtransProduksi()}
              clientKey={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? ""}
            />
            {produk.jenisMateri.length > 0 && (
              <p className="mt-4 border-t border-black/10 pt-3 text-[13px] text-ink-soft">
                {produk.jenisMateri.length} Materi
              </p>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          {produk.deskripsi !== "" && (
            <div className="rounded-2xl border border-black/10 bg-white p-6">
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">{produk.deskripsi}</p>
            </div>
          )}
          <DaftarBab slug={produk.slug} productId={produk.id} bab={produk.bab} />
          <p className="mt-6 rounded-xl border border-black/10 bg-white p-4 text-[13px] text-ink-soft">
            Produk digital dikirim seketika sesudah pembayaran dan <b>tidak dapat
            dikembalikan</b>. Pastikan Anda sudah membaca keterangan di atas sebelum
            membeli.
          </p>
        </div>
      </section>
```

Komentar JSX yang ada (tentang `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`, `revalidate`, dan tombol) dipindahkan apa adanya ke dekat `HargaProduk`.

- [ ] **Step 5: Periksa tipe, lint, dan uji manual**

Run: `npx tsc --noEmit 2>&1 | grep "src/\(lib/produk/katalog\|app/produk\|app/_landing\)" || echo BERSIH` lalu `npx eslint src/app/produk src/lib/produk`
Expected: `BERSIH`. `src/app/_landing/produk-digital.tsx` hanya memakai `KartuProduk`/`ProdukPublik`; kalau ia membaca `jenis`, ganti dengan `jenisMateri`.

Uji manual (bila Docker hidup): `/produk` menampilkan "N Video · N Artikel". `/produk/<slug>` di lebar 375px menumpuk kartu beli di atas daftar bab, tanpa gulir horizontal. Pengunjung anon yang menekan baris pratinjau dibawa ke `/masuk`, lalu sesudah login mendarat di penampil materi (Review Focus 3, butuh Task 10).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/produk/katalog.ts web/src/app/produk
git commit -m "feat(produk): halaman publik berbab dengan pratinjau dan masa berlaku

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Passport & gerbang isi per materi

**Files:**
- Modify: `web/src/lib/passport/produk-saya.ts` (seluruh isi diganti)
- Create: `web/src/lib/passport/isi-produk.ts`
- Modify: `web/src/app/passport/produk/page.tsx`
- Create: `web/src/app/passport/produk/[slug]/daftar-materi.tsx`
- Modify: `web/src/app/passport/produk/[slug]/page.tsx` (seluruh isi diganti)
- Create: `web/src/app/passport/produk/[slug]/[materiId]/page.tsx`
- Modify: `web/src/app/passport/produk/[slug]/reader-pdf.tsx`, `pemutar-video.tsx` (lewat sed)
- Create: `web/src/app/api/produk/materi/[id]/video/route.ts`
- Create: `web/src/app/api/produk/materi/[id]/halaman/[n]/route.ts`
- Create: `web/src/app/api/produk/materi/[id]/unduh/route.ts`
- Delete: `web/src/app/api/produk/[id]/` (ketiga rute lama)
- Modify: `web/README.md:124-125,185-187`

**Interfaces:**
- Consumes: Task 2 (`punya_produk`, policy `boleh_buka_materi` & `pernah_punya_produk`), Task 4 (`statusAkses`, `formatTanggalAkses`, `ringkasJumlahMateri`, `urlSampulPublik`, `namaObjekPdfMateri`, `objekPdfPembeli`), Task 9 (`BabPublik`).
- Produces:
  - `type ProdukDimiliki = { id; judul; slug; sampulObjek: string | null; jenisMateri: JenisMateri[]; sumber; diberikanPada; berlakuSampai: string | null }`, `produkSaya(clientId)`
  - `bacaIsiProduk(productId: string): Promise<BabPublik[]>`, dibaca dengan SESI pengguna
  - `DaftarMateri({ slug, bab, bolehSemua, aktifId })`, komponen server
  - Rute `GET /api/produk/materi/[id]/video`, `/halaman/[n]`, `/unduh`. `id` = id MATERI.

- [ ] **Step 1: `produk-saya.ts`**

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { JenisMateri } from "@/lib/produk/status";

export type ProdukDimiliki = {
  id: string;
  judul: string;
  slug: string;
  sampulObjek: string | null;
  jenisMateri: JenisMateri[];
  sumber: string;
  diberikanPada: string;
  /** NULL = selamanya. Termasuk yang SUDAH lewat — layar menampilkan "habis". */
  berlakuSampai: string | null;
};

type BarisEntitlement = {
  id: string;
  sumber: string;
  diberikan_pada: string;
  berlaku_sampai: string | null;
  digital_products: {
    id: string;
    judul: string;
    slug: string;
    sampul_objek: string | null;
    digital_product_materials: Array<{ jenis: JenisMateri }>;
  } | null;
};

/**
 * Entitlement milik pemanggil yang belum dicabut, TERMASUK yang kedaluwarsa.
 *
 * Embed `digital_products` bergantung pada policy "produk: pemilik
 * entitlement baca" yang memakai `pernah_punya_produk` — BUKAN
 * `punya_produk`. Dengan `punya_produk`, produk NONAKTIF yang aksesnya habis
 * memulangkan `null` di sini (embed RLS tidak pernah melempar) dan hilang
 * diam-diam dari daftar.
 *
 * `clientId` tidak dipakai sebagai filter: RLS "klien baca miliknya" sudah
 * menyaring. Parameternya dipertahankan supaya pemanggil tetap eksplisit.
 */
export async function produkSaya(clientId: string): Promise<ProdukDimiliki[]> {
  void clientId;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("digital_entitlements")
    .select(
      "id, sumber, diberikan_pada, berlaku_sampai, digital_products(id, judul, slug, sampul_objek, digital_product_materials(jenis))",
    )
    .is("dicabut_pada", null)
    .order("diberikan_pada", { ascending: false })
    .returns<BarisEntitlement[]>();

  return (data ?? [])
    .filter((r): r is BarisEntitlement & { digital_products: NonNullable<BarisEntitlement["digital_products"]> } =>
      r.digital_products !== null,
    )
    .map((r) => ({
      id: r.digital_products.id,
      judul: r.digital_products.judul,
      slug: r.digital_products.slug,
      sampulObjek: r.digital_products.sampul_objek,
      jenisMateri: r.digital_products.digital_product_materials.map((m) => m.jenis),
      sumber: r.sumber,
      diberikanPada: r.diberikan_pada,
      berlakuSampai: r.berlaku_sampai,
    }));
}
```

- [ ] **Step 2: `isi-produk.ts`**

Create `web/src/lib/passport/isi-produk.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { BabPublik } from "@/lib/produk/katalog";
import type { JenisMateri } from "@/lib/produk/status";

type BarisBab = {
  id: string; judul: string; urutan: number; created_at: string;
  digital_product_materials: Array<{
    id: string; judul: string; keterangan: string; jenis: JenisMateri;
    sampul_objek: string | null; pratinjau: boolean; urutan: number; created_at: string;
  }>;
};

function urut<T extends { urutan: number; created_at: string }>(a: T, b: T): number {
  return a.urutan - b.urutan || a.created_at.localeCompare(b.created_at);
}

/**
 * Daftar isi dengan SESI pengguna: produk tayang terbaca lewat policy publik,
 * produk nonaktif terbaca pemiliknya lewat `pernah_punya_produk`. Hanya
 * daftar — isinya tetap dijaga `boleh_buka_materi` di files/pages.
 */
export async function bacaIsiProduk(productId: string): Promise<BabPublik[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_sections")
    .select(
      "id, judul, urutan, created_at, digital_product_materials(id, judul, keterangan, jenis, sampul_objek, pratinjau, urutan, created_at)",
    )
    .eq("product_id", productId)
    .returns<BarisBab[]>();
  if (error) throw new Error(`Gagal membaca isi produk: ${error.message}`);

  return [...(data ?? [])].sort(urut).map((b) => ({
    id: b.id,
    judul: b.judul,
    materi: [...b.digital_product_materials].sort(urut).map((m) => ({
      id: m.id,
      judul: m.judul,
      keterangan: m.keterangan,
      jenis: m.jenis,
      sampulObjek: m.sampul_objek,
      pratinjau: m.pratinjau,
    })),
  }));
}
```

- [ ] **Step 3: `/passport/produk` (daftar)**

Di `web/src/app/passport/produk/page.tsx`:

1. Import `LABEL_JENIS` diganti:

```ts
import { ringkasJumlahMateri, statusAkses, formatTanggalAkses } from "@/lib/produk/status";
import { urlSampulPublik } from "@/lib/produk/objek";
```

2. Ganti isi `produk.map((p) => (...))` dengan:

```tsx
          {produk.map((p) => {
            const s = statusAkses(p.berlakuSampai);
            const habis = s.keadaan === "habis";
            const sampul = urlSampulPublik(p.sampulObjek);
            return (
              <Link
                key={p.id}
                href={habis ? `/produk/${p.slug}` : `/passport/produk/${p.slug}`}
                data-produk-id={p.id}
                className="flex items-start gap-3.5 rounded-xl border border-black/10 bg-[#FFFEFA] p-4 transition hover:-translate-y-0.5 hover:border-gold"
              >
                <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-xl bg-leaf-soft text-[17px] text-leaf">
                  {sampul ? <img src={sampul} alt="" className="h-full w-full object-cover" /> : "▶"}
                </span>
                <span className="min-w-0">
                  <b className="block text-[13.5px] leading-tight">{p.judul}</b>
                  <span className="block text-[11.5px] text-ink-soft">{ringkasJumlahMateri(p.jenisMateri)}</span>
                  <span className={`mt-0.5 block text-[11.5px] font-semibold ${habis ? "text-clay" : "text-leaf"}`}>
                    {s.keadaan === "selamanya" && "Akses selamanya"}
                    {s.keadaan === "aktif" && `Aktif sampai ${formatTanggalAkses(s.sampai)}`}
                    {habis && "Masa berlaku habis · Beli lagi"}
                  </span>
                </span>
              </Link>
            );
          })}
```

- [ ] **Step 4: Komponen `daftar-materi.tsx` (server)**

Create `web/src/app/passport/produk/[slug]/daftar-materi.tsx`:

```tsx
import Link from "next/link";
import type { BabPublik } from "@/lib/produk/katalog";
import { LABEL_JENIS_MATERI } from "@/lib/produk/status";

/**
 * Daftar bab/materi di sisi pembeli. `bolehSemua` = pemilik aktif; selain
 * itu hanya materi pratinjau yang bertaut. Tautan hanyalah kemudahan — yang
 * menolak adalah RLS di penampil dan rute isi.
 */
export function DaftarMateri({
  slug,
  bab,
  bolehSemua,
  aktifId,
}: {
  slug: string;
  bab: BabPublik[];
  bolehSemua: boolean;
  aktifId?: string;
}) {
  return (
    <nav aria-label="Daftar materi" className="grid gap-3">
      {bab.map((b) => (
        <section key={b.id} className="rounded-2xl border border-black/10 bg-white p-3">
          <h2 className="px-2 pb-2 text-[13.5px] font-bold text-night">
            {b.judul} <span className="font-normal text-ink-soft">· {b.materi.length} Materi</span>
          </h2>
          <ul className="grid gap-1">
            {b.materi.map((m) => {
              const buka = bolehSemua || m.pratinjau;
              const isi = (
                <>
                  <span className="w-5 flex-none text-center">{buka ? (m.jenis === "pdf" ? "📖" : "▶") : "🔒"}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{m.judul}</span>
                    <span className="text-[11.5px] text-ink-soft">
                      {LABEL_JENIS_MATERI[m.jenis]}{m.pratinjau && !bolehSemua ? " · Pratinjau" : ""}
                    </span>
                  </span>
                </>
              );
              const kelas = `flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                m.id === aktifId ? "bg-gold/15" : ""
              }`;
              return (
                <li key={m.id}>
                  {buka ? (
                    <Link href={`/passport/produk/${slug}/${m.id}`} className={`${kelas} hover:bg-paper`}
                      aria-current={m.id === aktifId ? "page" : undefined}>
                      {isi}
                    </Link>
                  ) : (
                    <span className={`${kelas} text-ink-soft/70`}>{isi}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: `/passport/produk/[slug]` (daftar isi)**

Ganti seluruh isi `web/src/app/passport/produk/[slug]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilKlien } from "@/lib/passport/data";
import { bacaIsiProduk } from "@/lib/passport/isi-produk";
import { DaftarMateri } from "./daftar-materi";

export const metadata = { title: "Produk" };

export default async function DaftarIsiProduk({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const supabase = await createServerSupabase();
  const { data: produk } = await supabase
    .from("digital_products")
    .select("id, judul, deskripsi")
    .eq("slug", slug)
    .maybeSingle<{ id: string; judul: string; deskripsi: string }>();
  if (!produk) notFound();

  const [bab, { data: punya }] = await Promise.all([
    bacaIsiProduk(produk.id),
    supabase.rpc("punya_produk", { p_product_id: produk.id }),
  ]);
  const pemilik = punya === true;

  return (
    <>
      <Link
        href="/passport/produk"
        className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
      >
        ← Kembali ke Pembelian Saya
      </Link>

      <div className="mb-4 rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7 text-[#EFE6CE]">
        <h1 className="font-serif text-xl text-[#F5EEDC]">{produk.judul}</h1>
      </div>

      {produk.deskripsi && (
        <div className="mb-4 whitespace-pre-line rounded-2xl border border-black/10 bg-white p-6 text-[13.5px] text-[#3C4C42]">
          {produk.deskripsi}
        </div>
      )}

      {!pemilik && (
        <p className="mb-4 rounded-xl border border-clay/30 bg-clay/5 p-4 text-[13px] text-ink">
          Akses Anda ke produk ini tidak aktif — belum dibeli, atau masa berlakunya sudah habis.{" "}
          <Link href={`/produk/${slug}`} className="font-bold text-leaf underline">Lihat halaman produk</Link>
        </p>
      )}

      <DaftarMateri slug={slug} bab={bab} bolehSemua={pemilik} />
    </>
  );
}
```

- [ ] **Step 6: Pindahkan prop pemutar & pembaca**

```bash
for f in "web/src/app/passport/produk/[slug]/reader-pdf.tsx" "web/src/app/passport/produk/[slug]/pemutar-video.tsx"; do
  sed -i '' -e 's#/api/produk/\${productId}#/api/produk/materi/${productId}#g' -e 's/productId/materiId/g' "$f"
done
grep -n "materiId\|api/produk" "web/src/app/passport/produk/[slug]/reader-pdf.tsx" "web/src/app/passport/produk/[slug]/pemutar-video.tsx"
```

Expected: setiap URL berbentuk `` `/api/produk/materi/${materiId}/...` ``.

- [ ] **Step 7: Penampil `/passport/produk/[slug]/[materiId]`**

Create `web/src/app/passport/produk/[slug]/[materiId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilKlien } from "@/lib/passport/data";
import { bacaIsiProduk } from "@/lib/passport/isi-produk";
import { LABEL_JENIS_MATERI } from "@/lib/produk/status";
import { ReaderPdf } from "../reader-pdf";
import { PemutarVideo } from "../pemutar-video";
import { DaftarMateri } from "../daftar-materi";

export const metadata = { title: "Materi" };

type BarisMateri = {
  id: string;
  judul: string;
  keterangan: string;
  jenis: "video" | "pdf";
  boleh_unduh: boolean;
};

export default async function PenampilMateri({
  params,
}: {
  params: Promise<{ slug: string; materiId: string }>;
}) {
  const { slug, materiId } = await params;
  const klien = await ambilKlien();
  if (!klien) notFound();

  const supabase = await createServerSupabase();
  const { data: produk } = await supabase
    .from("digital_products").select("id, judul").eq("slug", slug)
    .maybeSingle<{ id: string; judul: string }>();
  if (!produk) notFound();

  // UUID tak sah membuat PostgREST melempar 22P02; `data` null → 404.
  const { data: materi } = await supabase
    .from("digital_product_materials")
    .select("id, judul, keterangan, jenis, boleh_unduh")
    .eq("id", materiId)
    .eq("product_id", produk.id)
    .maybeSingle<BarisMateri>();
  if (!materi) notFound();

  // Baris isi terbaca HANYA bila `boleh_buka_materi` mengizinkan (pemilik
  // aktif, atau materi pratinjau produk tayang). Tidak terbaca = 404 —
  // pola yang sama dengan gerbang isi; tidak membocorkan "ada tapi terkunci".
  const [{ data: berkas }, { data: halaman }, { data: punya }, bab] = await Promise.all([
    supabase.from("digital_product_files").select("material_id").eq("material_id", materi.id).maybeSingle(),
    supabase.from("digital_product_pages").select("halaman").eq("material_id", materi.id).order("halaman"),
    supabase.rpc("punya_produk", { p_product_id: produk.id }),
    bacaIsiProduk(produk.id),
  ]);
  const terbuka = materi.jenis === "video" ? berkas !== null : (halaman ?? []).length > 0;
  if (!terbuka) notFound();

  const pemilik = punya === true;
  const bolehUnduh = pemilik && materi.boleh_unduh && berkas !== null;

  return (
    <>
      <Link
        href={`/passport/produk/${slug}`}
        className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
      >
        ← {produk.judul}
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0">
          <h1 className="font-serif text-xl text-night">{materi.judul}</h1>
          <p className="mb-3 text-xs text-ink-soft">
            {LABEL_JENIS_MATERI[materi.jenis]}{!pemilik && " · Pratinjau"}
          </p>
          {materi.keterangan && (
            <p className="mb-4 whitespace-pre-line text-[13.5px] text-[#3C4C42]">{materi.keterangan}</p>
          )}

          {materi.jenis === "video" ? (
            <section className="relative select-none overflow-hidden rounded-2xl border border-black/10 bg-white p-4">
              <PemutarVideo materiId={materi.id} />
            </section>
          ) : (
            <ReaderPdf materiId={materi.id} halaman={(halaman ?? []).map((h) => h.halaman)} />
          )}

          {bolehUnduh && (
            <a
              href={`/api/produk/materi/${materi.id}/unduh`}
              className="mt-4 inline-block rounded-lg bg-night px-5 py-3 text-[13.5px] font-bold text-gold-pale"
            >
              Unduh berkas asli
            </a>
          )}

          <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
            <span className="text-gold">🔒</span>
            {materi.jenis === "pdf" ? "Setiap halaman ditandai identitas Anda." : "Video ini ditonton langsung di dalam aplikasi."}
          </p>
        </div>

        <DaftarMateri slug={slug} bab={bab} bolehSemua={pemilik} aktifId={materi.id} />
      </div>
    </>
  );
}
```

- [ ] **Step 8: Tiga rute gerbang per materi**

Create `web/src/app/api/produk/materi/[id]/video/route.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { urlTontonVideo } from "@/lib/r2";
import { ambilKlien } from "@/lib/passport/data";

export const runtime = "nodejs";

/**
 * Tonton satu materi video. Hak diputuskan RLS `boleh_buka_materi` atas
 * `digital_product_files` lewat SESI pengguna: pemilik aktif, atau materi
 * pratinjau produk tayang. Selain itu 404 — tidak pernah 401/403, supaya
 * keberadaan materi tidak bocor.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();

  // `digital_product_files` memuat isi KEDUA jenis; tanpa pagar ini rute
  // video menandatangani kunci objek PDF terhadap bucket video.
  const { data: materi } = await supabase
    .from("digital_product_materials").select("jenis").eq("id", id).maybeSingle();
  if (!materi) return new Response(null, { status: 404 });
  if (materi.jenis !== "video") return new Response(null, { status: 404 });

  const { data: baris } = await supabase
    .from("digital_product_files").select("objek").eq("material_id", id).maybeSingle();
  if (!baris) return new Response(null, { status: 404 });

  return Response.redirect(await urlTontonVideo(baris.objek), 302);
}
```

Create `web/src/app/api/produk/materi/[id]/halaman/[n]/route.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ambilKlien } from "@/lib/passport/data";
import { bakarWatermark } from "@/lib/materi/watermark";

export const runtime = "nodejs";

const BUCKET = "produk-halaman";

/**
 * Satu halaman PDF materi, ber-watermark nama + PADMA ID pembaca. Pratinjau
 * pun ber-watermark: pratinjau WAJIB login (keputusan pemilik repo), jadi
 * selalu ada identitas untuk dibakar.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await params;
  const halaman = Number(n);
  if (!Number.isInteger(halaman) || halaman < 1) return new Response(null, { status: 404 });

  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  // Hak lewat SESI dulu (RLS `boleh_buka_materi`); service role baru dipakai
  // SESUDAH basis data memulangkan barisnya, dan path objeknya diambil dari
  // baris itu — tidak pernah dirakit dari parameter URL.
  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("digital_product_pages")
    .select("objek")
    .eq("material_id", id)
    .eq("halaman", halaman)
    .maybeSingle();
  if (!baris) return new Response(null, { status: 404 });

  const admin = createAdminSupabase();
  const { data: objek } = await admin.storage.from(BUCKET).download(baris.objek);
  if (!objek) return new Response(null, { status: 404 });

  const asli = Buffer.from(await objek.arrayBuffer());
  const bertanda = await bakarWatermark(asli, klien.nama, klien.padmaId);

  return new Response(new Uint8Array(bertanda), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=900",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
```

Create `web/src/app/api/produk/materi/[id]/unduh/route.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ambilKlien } from "@/lib/passport/data";
import { urlUnduhBerkas, UMUR_UNDUH_DETIK } from "@/lib/r2";
import { namaObjekPdfMateri } from "@/lib/produk/objek";
import { slugDariJudul } from "@/lib/produk/status";
import { ekstensiDariMime } from "@/lib/materi/video";
import { objekPdfPembeli, capPdfPembeli } from "@/lib/produk/cap-pdf";

export const runtime = "nodejs";

const BUCKET_BERKAS = "produk-berkas";

type Materi = { id: string; product_id: string; judul: string; jenis: "video" | "pdf"; boleh_unduh: boolean };

/**
 * Unduh berkas utuh satu materi — KHUSUS PEMILIK AKTIF.
 *
 * Berbeda dari tonton/baca, RLS `boleh_buka_materi` TIDAK cukup di sini:
 * predikat itu juga membuka materi pratinjau bagi non-pembeli, sedangkan
 * pratinjau tidak pernah boleh diunduh (spec 2026-10-16). Karena itu
 * `punya_produk` dipanggil eksplisit.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();

  const { data: materi } = await supabase
    .from("digital_product_materials")
    .select("id, product_id, judul, jenis, boleh_unduh")
    .eq("id", id)
    .maybeSingle<Materi>();
  if (!materi) return new Response(null, { status: 404 });
  if (!materi.boleh_unduh) return new Response(null, { status: 404 });

  const { data: punya } = await supabase.rpc("punya_produk", { p_product_id: materi.product_id });
  if (punya !== true) return new Response(null, { status: 404 });

  const { data: berkas } = await supabase
    .from("digital_product_files").select("objek, mime").eq("material_id", id).maybeSingle();
  if (!berkas) return new Response(null, { status: 404 });

  const namaDasar = slugDariJudul(materi.judul) || id;

  if (materi.jenis === "video") {
    const ekstensi = ekstensiDariMime(berkas.mime) ?? "mp4";
    return Response.redirect(await urlUnduhBerkas(berkas.objek, `${namaDasar}.${ekstensi}`), 302);
  }

  const admin = createAdminSupabase();
  const objekTercap = objekPdfPembeli(materi.product_id, materi.id, klien.id);

  const sudahAda = await admin.storage
    .from(BUCKET_BERKAS)
    .createSignedUrl(objekTercap, UMUR_UNDUH_DETIK, { download: `${namaDasar}.pdf` });
  if (!sudahAda.error && sudahAda.data) return Response.redirect(sudahAda.data.signedUrl, 302);

  const { data: sumber } = await admin.storage
    .from(BUCKET_BERKAS)
    .download(namaObjekPdfMateri(materi.product_id, materi.id));
  if (!sumber) return new Response(null, { status: 404 });

  let tercap: Uint8Array;
  try {
    tercap = await capPdfPembeli(new Uint8Array(await sumber.arrayBuffer()), klien.nama, klien.email, klien.padmaId);
  } catch (e) {
    const nama = e instanceof Error ? e.name : "GalatTidakDikenal";
    const pesan = e instanceof Error ? e.message : String(e);
    console.error(`mencap PDF pembeli gagal: ${nama}: ${pesan}`);
    return new Response(null, { status: 500 });
  }

  const { error: unggahError } = await admin.storage
    .from(BUCKET_BERKAS)
    .upload(objekTercap, Buffer.from(tercap), { contentType: "application/pdf", upsert: true });
  if (unggahError) {
    console.error(`mengunggah PDF tercap gagal: ${unggahError.message}`);
    return new Response(null, { status: 500 });
  }

  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET_BERKAS)
    .createSignedUrl(objekTercap, UMUR_UNDUH_DETIK, { download: `${namaDasar}.pdf` });
  if (signError || !signed) {
    console.error(`menandatangani PDF tercap gagal: ${signError?.message ?? "tidak diketahui"}`);
    return new Response(null, { status: 500 });
  }
  return Response.redirect(signed.signedUrl, 302);
}
```

Lalu hapus rute lama:

```bash
git rm -r "web/src/app/api/produk/[id]"
```

Rute lama punya komentar panjang (pencapan sekali per pembeli, alasan 404, alasan nama berkas). Sebelum menghapus, baca `git show HEAD:"web/src/app/api/produk/[id]/unduh/route.ts"` dan pindahkan komentar yang masih berlaku ke rute baru apa adanya.

- [ ] **Step 9: README**

Di `web/README.md`:
- Baris 125: `| `/passport/produk/[slug]` | Klien | Daftar isi produk (bab & materi) milik pembeli; pratinjau bagi yang belum memiliki |`
- Tambahkan sesudahnya: `| `/passport/produk/[slug]/[materiId]` | Klien | Penampil satu materi (video/PDF) plus tombol unduh bila diizinkan; pemilik aktif atau materi pratinjau |`
- Baris 185–187: ganti `/api/produk/[id]/` menjadi `/api/produk/materi/[id]/`, dan "Klien pemilik" menjadi "Pemilik aktif / pratinjau" untuk `video` dan `halaman`, serta "Pemilik aktif" untuk `unduh`.

- [ ] **Step 10: Periksa tipe, lint, dan uji manual**

Run: `npx tsc --noEmit` lalu `npm run lint`
Expected: keduanya HIJAU untuk seluruh `src/`. Ini task terakhir yang menyentuh kode aplikasi; tidak boleh ada sisa galat dari Task 4–9. Galat yang tersisa hanya boleh di `tests/` (diperbaiki Task 11).

Uji manual (bila Docker hidup): sebagai `ananda@padma.test`, ambil produk gratis bermasa berlaku 1 bulan → buka materi PDF & video. Lalu majukan kedaluwarsanya lewat SQL lokal (`update digital_entitlements set berlaku_sampai = now() - interval '1 minute' where ...`) → `/passport/produk` menampilkan "Masa berlaku habis · Beli lagi", dan penampil materi terkunci 404. Nonaktifkan produknya → kartu tetap tampil (Review Focus 2).

- [ ] **Step 11: Commit**

```bash
git add web/src/lib/passport web/src/app/passport/produk web/src/app/api/produk web/README.md
git commit -m "feat(passport): daftar isi & penampil materi, status masa berlaku, gerbang isi per materi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Uji lama — sesuaikan, porting, atau buang dengan sadar

**Files:** lihat tabel di Step 2.

**Interfaces:** tidak ada yang baru. Task ini membuat suite yang menyentuh produk kembali hijau.

- [ ] **Step 1: Buang `jenis`/`boleh_unduh` tingkat produk dari fixture**

```bash
cd /Users/arvinfairuz/Documents/padma/web
perl -pi -e 's/\bjenis: "(?:pdf|video)",\s*//g; s/,\s*jenis: "(?:pdf|video)"//g; s/\bboleh_unduh: (?:true|false|\w+),\s*//g; s/,\s*boleh_unduh: (?:true|false|\w+)//g' \
  tests/pesanan-*.test.ts tests/pesanan-*.test.tsx tests/keranjang-*.test.ts \
  tests/produk-ambil-gratis.test.ts tests/produk-harga-publik.test.ts tests/produk-katalog.test.ts \
  tests/owner-produk-harga.test.ts tests/admin-pesanan.test.tsx tests/produk-skema-db.test.ts tests/admin-produk.test.ts
grep -nE 'jenis: "(pdf|video)"|boleh_unduh' tests/*.ts tests/*.tsx | grep -v "produk-materi-\|produk-masa-berlaku"
```

Expected: grep hanya menyisakan berkas yang ditangani khusus di Step 2. Periksa `git diff --stat tests/`: tidak ada `jenis: "produk_digital"` (milik `order_items`) yang ikut terhapus. Pola di atas hanya mencocokkan `"pdf"`/`"video"`.

- [ ] **Step 2: Per berkas**

| Berkas | Tindakan |
|---|---|
| `tests/produk-entitlement-db.test.ts` | **Hapus.** Digantikan `produk-materi-akses-db.test.ts` (Task 2), yang menguji keenam keadaan termasuk dicabut. |
| `tests/produk-rpc-hapus-isi.test.ts` | **Hapus.** RPC-nya dibuang. Radius RPC per materi tercatat di Tindak Lanjut. |
| `tests/produk-objek.test.ts` | **Hapus.** Digantikan `produk-materi-status.test.ts` (Task 4). |
| `tests/produk-reader-passport.test.tsx` | **Hapus.** Halaman yang diujinya diganti. Syarat tombol unduh (pemilik + `boleh_unduh` + berkas ada) kini satu baris `bolehUnduh` di penampil; dicatat di Tindak Lanjut. |
| `tests/produk-status.test.ts` | Hapus `describe("punyaIsi")` dan `describe("periksaJenis")`, beserta importnya. Sisanya tetap. |
| `tests/produk-skema-db.test.ts` | Uji pertama dinamai "produk baru lahir nonaktif dan tanpa masa berlaku". Kolom yang dicek: `aktif` default `false` dan `masa_berlaku_bulan` tanpa default (`column_default` null). `boleh_unduh` dibuang dari daftar kolom. |
| `tests/produk-gerbang-isi.test.ts` | Lihat Step 3. |
| `tests/produk-rute-isi.test.ts` | Lihat Step 4 (porting). |
| `tests/admin-produk.test.ts` | Hapus `describe("aktifkanProduk — punya isi jenis-sadar")` dan `describe("perbaruiProduk — jenis terkunci sesudah isi ada")`. Aturan pengganti (isi lengkap, jenis terkunci per materi) tercatat di Tindak Lanjut. Uji sumber "setiap server action memanggil requireRole" dan "tidak memakai service role" diperluas ke `src/app/admin/produk/[id]/aksi-isi.ts`, KECUALI pengecualian `createAdminSupabase` untuk storage. Baca dulu cara uji itu memindai: kalau ia melarang `createAdminSupabase` sama sekali, `aksi-isi.ts` dimasukkan ke uji `admin-produk-unggah.test.ts` saja. |
| `tests/admin-produk-unggah.test.ts` | Ganti nama fungsi `...Produk` → `...Materi` di daftar pindaian sumber. `describe("lepasIsiProduk — …")` di-porting dengan fixture bab+materi (pola Step 4), atau **dihapus** bila porting fixturenya melebihi 30 baris; catat di Tindak Lanjut. |
| `tests/landing-produk.test.tsx` | Fixture `ProdukPublik`: buang `jenis`, `bolehUnduh`; tambah `masaBerlakuBulan: null, jenisMateri: []`. |
| `tests/produk-katalog.test.ts` | Sesudah Step 1 seharusnya hijau. Kalau ada asersi atas `jenis`, ganti dengan `jenisMateri`. |
| `tests/admin-materi.test.ts`, `tests/materi-video-skema.test.ts` | Kecocokan grep-nya di modul MATERI SESI (`boleh_unduh`/`namaObjek...` milik `materials`). Jangan disentuh; pastikan tetap hijau. |

- [ ] **Step 3: `produk-gerbang-isi.test.ts`**

1. `RUTE` menjadi:

```ts
const RUTE = [
  "src/app/api/produk/materi/[id]/video/route.ts",
  "src/app/api/produk/materi/[id]/halaman/[n]/route.ts",
  "src/app/api/produk/materi/[id]/unduh/route.ts",
];
```

2. Setiap literal `"src/app/api/produk/[id]/unduh/route.ts"` dan `"src/app/api/produk/[id]/video/route.ts"` diganti versi `materi/[id]`.
3. Regex boleh_unduh menjadi `/if\s*\(!\s*materi\.boleh_unduh\)[^\n]*404/`, dan regex jenis menjadi `/materi\.jenis !== "video"/`.
4. Tambahkan uji baru di `describe("gerbang isi produk")`:

```ts
  it("rute unduh memanggil punya_produk — pratinjau tidak pernah boleh diunduh", () => {
    const sumber = baca("src/app/api/produk/materi/[id]/unduh/route.ts");
    const badan = sumber.slice(sumber.indexOf("export async function GET"));
    expect(badan).toMatch(/rpc\("punya_produk"/);
    expect(badan).toMatch(/if \(punya !== true\)[^\n]*404/);
  });
```

5. Uji README: literal `/api/produk/[id]/` → `/api/produk/materi/[id]/`, ditambah `expect(readme).toContain("| `/passport/produk/[slug]/[materiId]` |");`.
6. `objekPdfPembeli("prod-1", "klien-9")` → `objekPdfPembeli("prod-1", "materi-3", "klien-9")`, harapan `"prod-1/materi-3/pembeli/klien-9.pdf"`.

- [ ] **Step 4: Porting `produk-rute-isi.test.ts`**

Setiap produk uji kini punya SATU bab dan SATU materi. Variabel `idVideo`, `idPdfTerkunci`, dan `idPdfUnduh` kini menyimpan **id MATERI**; peta `produkDari` memetakan id materi ke id produknya.

1. Import rute dan aksi:

```ts
const { GET: getVideo } = await import("@/app/api/produk/materi/[id]/video/route");
const { GET: getHalaman } = await import("@/app/api/produk/materi/[id]/halaman/[n]/route");
const { GET: getUnduh } = await import("@/app/api/produk/materi/[id]/unduh/route");
const { produkSaya } = await import("@/lib/passport/produk-saya");
const { terbitkanUrlUnggahPdfMateri, lepasIsiMateri } = await import("@/app/admin/produk/[id]/unggah");
```

2. Sesudah deklarasi `let clientId = "";` tambahkan `const produkDari: Record<string, string> = {};` dan `let idPratinjau = "";`. Lalu `beriEntitlement`/`cabutEntitlement` menerima id MATERI:

```ts
async function beriEntitlement(materiId: string) {
  await createAdminSupabase().from("digital_entitlements")
    .insert({ client_id: clientId, product_id: produkDari[materiId], sumber: "gratis" });
}

async function cabutEntitlement(materiId: string) {
  await createAdminSupabase().from("digital_entitlements").delete()
    .eq("client_id", clientId).eq("product_id", produkDari[materiId]);
}

/** Satu produk tayang dengan satu bab dan satu materi; memulangkan id MATERI. */
async function semaiProdukBermateri(opsi: {
  slug: string; jenis: "video" | "pdf"; bolehUnduh?: boolean; pratinjau?: boolean;
}): Promise<string> {
  const svc = createAdminSupabase();
  const { data: p } = await svc.from("digital_products")
    .insert({ judul: `Rute ${opsi.slug}`, slug: opsi.slug, aktif: true }).select("id").single();
  const { data: b } = await svc.from("digital_product_sections")
    .insert({ product_id: p!.id, judul: "Bab" }).select("id").single();
  const { data: m } = await svc.from("digital_product_materials")
    .insert({
      section_id: b!.id, product_id: p!.id, judul: `Materi ${opsi.slug}`, jenis: opsi.jenis,
      boleh_unduh: opsi.bolehUnduh ?? false, pratinjau: opsi.pratinjau ?? false,
    })
    .select("id").single();
  produkDari[m!.id] = p!.id;
  return m!.id;
}
```

3. `beforeAll`: ganti pembuatan produk video dengan:

```ts
  idVideo = await semaiProdukBermateri({ slug: "rute-uji-video", jenis: "video" });
  await svc.from("digital_product_files").insert({
    material_id: idVideo,
    objek: `produk/${produkDari[idVideo]}/${idVideo}/isi.mp4`,
    mime: "video/mp4",
    byte: 1024,
  });
```

Ganti loop dua produk PDF dengan versi berikut. Selain dua produk lama, loop ini menambah satu produk PDF **pratinjau** yang `boleh_unduh`-nya menyala:

```ts
  for (const [slug, bolehUnduh, pratinjau] of [
    ["rute-uji-pdf-terkunci", false, false],
    ["rute-uji-pdf-unduh", true, false],
    ["rute-uji-pdf-pratinjau", true, true],
  ] as Array<[string, boolean, boolean]>) {
    const id = await semaiProdukBermateri({ slug, jenis: "pdf", bolehUnduh, pratinjau });
    if (pratinjau) idPratinjau = id;
    else if (bolehUnduh) idPdfUnduh = id;
    else idPdfTerkunci = id;
    const p = produkDari[id];

    await svc.storage.from(BUCKET_HALAMAN)
      .upload(`${p}/${id}/1.webp`, halamanWebp, { contentType: "image/webp", upsert: true });
    await svc.rpc("ganti_halaman_materi_produk", { p_material_id: id, p_halaman: [{ halaman: 1, objek: `${p}/${id}/1.webp` }] });

    await svc.storage.from(BUCKET_BERKAS)
      .upload(`${p}/${id}/isi.pdf`, pdfAsli, { contentType: "application/pdf", upsert: true });
    await svc.from("digital_product_files").insert({
      material_id: id, objek: `${p}/${id}/isi.pdf`, mime: "application/pdf", byte: pdfAsli.length,
    });
  }
```

4. `afterAll`: loop atas `[idVideo, idPdfTerkunci, idPdfUnduh, idPratinjau]`. Prefiks storage menjadi `` [`${produkDari[id]}/${id}`, `${produkDari[id]}/${id}/pembeli`] ``, dan baris terakhir menjadi `await svc.from("digital_products").delete().eq("id", produkDari[id]);`.

5. Di badan uji:
   - `` `produk/${idVideo}/isi.mp4` `` → `` `produk/${produkDari[idVideo]}/${idVideo}/isi.mp4` ``
   - setiap `` `${idPdfUnduh}/pembeli` `` / `` `${idPdfTerkunci}/pembeli` `` / `` `${productId}/pembeli` `` → `` `${produkDari[X]}/${X}/pembeli` ``
   - `.update({ dicabut_pada: ... }).eq("client_id", clientId).eq("product_id", idPdfUnduh)` → `produkDari[idPdfUnduh]`
   - `.in("id", [idVideo, idPdfUnduh, idPdfTerkunci])` pada `digital_products` → `.in("id", [idVideo, idPdfUnduh, idPdfTerkunci].map((x) => produkDari[x]))`
   - `.eq("id", idPdfTerkunci)` pada `digital_products` (uji KONTROL) → `produkDari[idPdfTerkunci]`
   - `.eq("id", idPdfUnduh)` pada `digital_products` (uji lepas isi) → `produkDari[idPdfUnduh]`
   - `produkSaya`: `toContain(idVideo)` → `toContain(produkDari[idVideo])`, dan sama untuk `idPdfUnduh`
   - `terbitkanUrlUnggahPdfProduk(idPdfUnduh, 2048)` → `terbitkanUrlUnggahPdfMateri(idPdfUnduh, 2048)`; `lepasIsiProduk(idPdfUnduh)` → `lepasIsiMateri(idPdfUnduh)`

6. Tambahkan dua `describe` baru di ujung berkas:

```ts
describe("pratinjau & kedaluwarsa (spec 2026-10-16)", () => {
  it("non-pembeli MEMBACA halaman materi pratinjau, tapi TIDAK bisa mengunduhnya", async () => {
    ref.sesi = await signInAs(KLIEN);
    const halaman = await getHalaman(permintaan(), { params: Promise.resolve({ id: idPratinjau, n: "1" }) });
    expect(halaman.status).toBe(200);
    const unduh = await getUnduh(permintaan(), { params: Promise.resolve({ id: idPratinjau }) });
    expect(unduh.status).toBe(404);
  });

  it("pemilik KEDALUWARSA ditolak ketiga rute", async () => {
    ref.sesi = await signInAs(KLIEN);
    await createAdminSupabase().from("digital_entitlements").insert({
      client_id: clientId, product_id: produkDari[idPdfUnduh], sumber: "gratis",
      berlaku_sampai: new Date(Date.now() - 60_000).toISOString(),
    });
    const halaman = await getHalaman(permintaan(), { params: Promise.resolve({ id: idPdfUnduh, n: "1" }) });
    const unduh = await getUnduh(permintaan(), { params: Promise.resolve({ id: idPdfUnduh }) });
    expect(halaman.status).toBe(404);
    expect(unduh.status).toBe(404);
    await cabutEntitlement(idPdfUnduh);
  });
});
```

- [ ] **Step 5: Jalankan seluruh uji yang menyentuh produk & pesanan**

Run (Docker HIDUP, dan koordinasikan dulu sesuai `padma-supabase-lokal-bersama`):

```bash
npx vitest run tests/produk-*.test.ts tests/produk-*.test.tsx tests/admin-produk*.test.ts tests/owner-produk-harga.test.ts \
  tests/landing-produk.test.tsx tests/pesanan-*.test.ts tests/pesanan-*.test.tsx tests/keranjang-*.test.ts \
  tests/admin-pesanan.test.tsx tests/tujuan-*.test.ts tests/fungsi-mesin-tertutup.test.ts tests/grant-anon.test.ts \
  tests/money-firewall-struktural.test.ts tests/admin-materi.test.ts tests/materi-video-skema.test.ts
```

Expected: PASS semua. Bila ada yang merah, laporkan nama uji + keluarannya; jangan melemahkan asersinya demi hijau. Bila Docker MATI: jalankan hanya uji murni (`produk-materi-status`, `tujuan-*`, `produk-gerbang-isi`, `produk-status`, `landing-produk`), dan tandai sisanya **TERTUNDA** dengan daftar namanya.

- [ ] **Step 6: Periksa menyeluruh**

Run: `npx tsc --noEmit && npm run lint`
Expected: keduanya HIJAU, termasuk `tests/`.

- [ ] **Step 7: Commit**

```bash
git add web/tests
git commit -m "test(produk): sesuaikan uji lama ke bentuk bab & materi; porting uji rute isi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tindak Lanjut (lubang yang sengaja ditinggalkan mode uji dipangkas)

Disalin juga ke spec. Semuanya **tidak** dijaga uji otomatis:

1. Radius RPC `ganti_halaman_materi_produk` / `lepas_berkas_materi`: mengosongkan materi A tidak menyentuh materi B. Polanya identik dengan RPC lama yang dulu teruji; ujinya ikut terhapus bersama RPC lama.
2. Aturan aktifkan produk "isi lengkap" (`isiLengkap`) dan "jenis materi terkunci sesudah isi diunggah" (`perbaruiMateri`) hanya diuji manual.
3. Tombol unduh di penampil (pemilik aktif + `boleh_unduh` + berkas ada) tidak punya uji render; gerbang sesungguhnya (rute unduh) teruji di Task 11 Step 4.
4. `hapusMateri` membersihkan objek R2/storage + salinan bercap: diuji manual (Review Focus 1).
5. Seksi landing `_landing/produk-digital.tsx` tetap tidak dipasang; hanya disesuaikan tipenya.
6. Merge `feat/p4-rekap-penjualan` sesudah fitur ini: `tests/penjualan-db.test.ts` meng-insert `digital_products {jenis: "pdf"}`. Buang `jenis` itu saat merge.

## Sebelum deploy (bukan bagian rencana ini, dicatat supaya tidak hilang)

- Ketiga migrasi bergabung dengan antrean migrasi produksi yang sudah panjang (lihat memori `padma-migrasi-produk-belum-di-produksi`). `20261016100000` memakai `drop table`/`drop column` atas tabel produk; aman HANYA karena tabel produk belum pernah ada di produksi. **Periksa ulang fakta itu tepat sebelum deploy**; kalau produksi sudah punya baris produk, migrasi ini harus ditulis ulang menjadi migrasi data.
