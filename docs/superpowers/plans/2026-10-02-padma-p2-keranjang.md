# P2 Keranjang — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klien bisa mengumpulkan beberapa produk digital di keranjang (basis data) dan membayarnya sekali lewat satu popup Snap; pengunjung yang belum login kembali ke produknya sesudah masuk.

**Architecture:** `cart_items` hanya penyimpanan, ditulis lewat RPC `security definer`. Checkout memakai SATU RPC pesanan baru `buat_pesanan_keranjang(uuid[])` yang menjalankan gerbang P1 per produk; `buat_pesanan(uuid)` P1 menjadi pembungkusnya. Mesin P1 (webhook, penyaluran, penyapu, layar staf) tidak disentuh — ia sudah multi-item.

**Tech Stack:** Next.js (versi repo — baca `web/node_modules/next/dist/docs/` sebelum menulis rute/halaman), Supabase Postgres + PostgREST, plpgsql, Midtrans Snap, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-padma-p2-keranjang-design.md`

## Global Constraints

- Semua perintah dijalankan dari `/Users/arvinfairuz/Documents/padma/web`.
- Migrasi bercap waktu MANUAL: `20261002100000_keranjang_tabel.sql`, `20261002110000_keranjang_pesanan.sql`. Jangan `supabase migration new`.
- Terapkan migrasi lokal dengan `npx supabase migration up`, BUKAN `db reset` (Supabase lokal dipakai bersama sesi lain). JANGAN `db push`.
- Jangan `npm test` penuh. Jalankan berkas uji yang disebut saja.
- Docker lokal sedang mati per 2 Okt. Langkah yang menjalankan uji DB / `migration up` butuh Docker; bila masih mati, tandai langkahnya **TERTUNDA** di checkbox dan lanjutkan — jangan mengarang hasilnya.
- Tingkat uji **dipangkas**: hanya uji yang ditulis di rencana ini. Tidak ada uji render/rute baru di luar itu.
- Setiap RPC: `security definer set search_path = public`, `client_id` dari `auth.uid()`, `revoke all ... from public, anon`, `grant execute ... to authenticated` (kecuali pembantu & fungsi trigger: revoke juga dari `authenticated`).
- Kalimat galat untuk larik 1 produk SAMA PERSIS dengan P1. Uji P1 bergantung padanya.
- Batas: 20 produk per keranjang dan per pesanan.
- Cookie tujuan: `padma_lanjut`, `Path=/; Max-Age=3600; SameSite=Lax`, nilainya hanya `^/produk/[a-z0-9]+(-[a-z0-9]+)*$`.
- Komentar mengikuti gaya repo: bahasa Indonesia, menjelaskan KENAPA.
- Commit diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Mode uji dipangkas, jadi lima hal ini TIDAK punya uji otomatis — pemilik repo menguji manual, dan reviewer akhir membacanya di kode:

1. Keranjang campuran (satu `siap`, satu `diproses`/`gratis`) → tombol Bayar hanya mengirim id `siap`; total hanya menjumlahkan `siap`.
2. Snap gagal menerbitkan token (502) di `/passport/keranjang` → halaman TIDAK di-refresh, klik berikutnya membawa `ulang: true` (kalau di-refresh, item pindah ke `diproses` dan tombol Bayar hilang).
3. Staf yang juga klien membuka `/passport/keranjang` → kode pesanan terbuka yang tampil adalah MILIKNYA (filter `client_id`), bukan pesanan klien lain lewat policy staf.
4. Pengunjung datang dari funnel skrining (cookie `padma_klaim_skrining`) DAN menekan Beli → klaim skrining menang, `padma_lanjut` diabaikan dan dihapus.
5. Pembeli menutup popup Snap lalu mengubah isi keranjang → checkout ditolak "Selesaikan dulu pesanan PSN-…", tombol "Batalkan pesanan itu" muncul dan bekerja.

---

## Peta berkas

| Berkas | Tanggung jawab |
|---|---|
| Create `web/supabase/migrations/20261002100000_keranjang_tabel.sql` | `cart_items`, RLS, 3 RPC keranjang, trigger pembersihan |
| Create `web/supabase/migrations/20261002110000_keranjang_pesanan.sql` | `buat_pesanan_keranjang`, pembantu himpunan, pembungkus `buat_pesanan` |
| Create `web/tests/keranjang-db.test.ts` | Uji 1 (RLS) + Uji 3 (trigger lewat webhook) |
| Create `web/tests/keranjang-pesanan-db.test.ts` | Uji 2 (gerbang per produk, himpunan) |
| Modify `web/tests/fungsi-mesin-tertutup.test.ts` | 4 RPC baru di `TERBUKA_SADAR` |
| Modify `web/tests/grant-anon.test.ts` | `cart_items` di `TABEL_TERTUTUP_ANON` |
| Create `web/src/lib/auth/tujuan-produk.ts` + `web/tests/tujuan-produk.test.ts` | Validasi & penitipan cookie `padma_lanjut` |
| Modify `web/src/app/setelah-masuk/route.ts` | Membaca `padma_lanjut` |
| Modify `web/src/app/api/pesanan/checkout/route.ts` | Terima `productIds`, panggil RPC baru |
| Modify `web/src/app/produk/[slug]/tombol-beli.tsx` | `mintaCheckout` terima larik; titip cookie; render tombol keranjang |
| Create `web/src/lib/keranjang/peramban.ts` | Acara & hitungan keranjang di peramban |
| Create `web/src/app/produk/[slug]/tombol-keranjang.tsx` | Tombol "Tambah ke keranjang" |
| Create `web/src/app/produk/tautan-keranjang.tsx` | Tautan "Keranjang (n)" di etalase |
| Modify `web/src/app/produk/page.tsx`, `web/src/app/produk/[slug]/page.tsx` | Pasang tautan |
| Create `web/src/lib/keranjang/baca.ts` | Pembacaan server: isi keranjang, pesanan terbuka, hitungan |
| Create `web/src/app/passport/keranjang/page.tsx` + `isi-keranjang.tsx` | Layar keranjang |
| Modify `web/src/app/passport/produk/page.tsx` | Tautan ke keranjang |

---

### Task 1: Tabel keranjang, RPC keranjang, trigger pembersihan

**Files:**
- Create: `web/supabase/migrations/20261002100000_keranjang_tabel.sql`
- Create: `web/tests/keranjang-db.test.ts`
- Modify: `web/tests/fungsi-mesin-tertutup.test.ts:73-84`
- Modify: `web/tests/grant-anon.test.ts` (array `TABEL_TERTUTUP_ANON`, sebelum `"pesanan_item_staf"`)

**Interfaces:**
- Produces (SQL, dipakai Task 4 & 5):
  - `public.cart_items(client_id uuid, product_id uuid, ditambahkan_pada timestamptz)`, PK `(client_id, product_id)`, `select` bagi `authenticated` lewat policy milik sendiri.
  - `public.tambah_ke_keranjang(p_product_id uuid) returns void`
  - `public.hapus_dari_keranjang(p_product_id uuid) returns void`
  - `public.baca_keranjang() returns table (product_id uuid, judul text, slug text, harga integer, keadaan text, ditambahkan_pada timestamptz)`; `keadaan ∈ {'tidak_tersedia','gratis','sudah_dimiliki','diproses','siap'}`

- [ ] **Step 1: Tulis uji yang gagal**

`web/tests/keranjang-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { rakitOrderId } from "@/lib/pesanan/order-id";
import {
  EMAIL_KLIEN_KEDUA,
  KLIEN_KEDUA_ID,
  siapkanKlienKedua,
  bongkarKlienKedua,
} from "./helpers/klien-kedua";

/**
 * Dua titik yang BUTA bagi pengujian manual (spec P2, "Pengujian"):
 *   1. RLS `cart_items` — kegagalannya pulang sebagai `[]`, dan keranjang
 *      kosong tidak terlihat rusak.
 *   3. Trigger pembersihan lewat jalur WEBHOOK — webhook tidak menyala di
 *      sandbox lokal, jadi tidak ada orang yang akan melihatnya bekerja.
 */

const KLIEN_EMAIL = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

const svc = createAdminSupabase();
const produkUji: string[] = [];

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc
    .from("digital_product_prices")
    .insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  if (eHarga) throw eHarga;
  return data!.id;
}

// Urutan hapus didikte foreign key — lihat dokblok `bersihkan()` di
// tests/pesanan-checkout-db.test.ts. `cart_items` ikut lenyap lewat cascade
// produk, tapi dihapus eksplisit supaya sisa run gagal tidak menumpuk.
async function bersihkan(): Promise<void> {
  await svc.from("cart_items").delete().in("client_id", [ANANDA_CLIENT_ID, KLIEN_KEDUA_ID]);
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

afterEach(bersihkan);
beforeAll(async () => {
  await bersihkan();
  await siapkanKlienKedua();
});
afterAll(bongkarKlienKedua);

describe("cart_items — RLS lewat sesi klien", () => {
  it("klien membaca keranjangnya sendiri dan NOL baris klien lain", async () => {
    const a = await semaiProduk(`krj-rls-a-${Date.now()}`, 100_000);
    const b = await semaiProduk(`krj-rls-b-${Date.now()}`, 50_000);
    const { error: eSemai } = await svc.from("cart_items").insert([
      { client_id: ANANDA_CLIENT_ID, product_id: a },
      { client_id: KLIEN_KEDUA_ID, product_id: b },
    ]);
    expect(eSemai).toBeNull();

    const ananda = await signInAs(KLIEN_EMAIL);
    const { data, error } = await ananda.from("cart_items").select("product_id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.product_id)).toEqual([a]);

    const kedua = await signInAs(EMAIL_KLIEN_KEDUA);
    const { data: dataKedua } = await kedua.from("cart_items").select("product_id");
    expect((dataKedua ?? []).map((r) => r.product_id)).toEqual([b]);
  });

  it("insert langsung lewat PostgREST DITOLAK — penulisan hanya lewat RPC", async () => {
    const a = await semaiProduk(`krj-rls-ins-${Date.now()}`, 100_000);
    const ananda = await signInAs(KLIEN_EMAIL);
    const { error } = await ananda
      .from("cart_items")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: a });
    expect(error?.code).toBe("42501");
  });

  it("tambah_ke_keranjang menolak produk yang sudah dimiliki, dan baca_keranjang melihat isinya", async () => {
    const a = await semaiProduk(`krj-rpc-a-${Date.now()}`, 100_000);
    const b = await semaiProduk(`krj-rpc-b-${Date.now()}`, 50_000);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: b, sumber: "beli",
    });

    const ananda = await signInAs(KLIEN_EMAIL);
    expect((await ananda.rpc("tambah_ke_keranjang", { p_product_id: a })).error).toBeNull();
    // Kedua kali: diam, bukan galat.
    expect((await ananda.rpc("tambah_ke_keranjang", { p_product_id: a })).error).toBeNull();
    const ditolak = await ananda.rpc("tambah_ke_keranjang", { p_product_id: b });
    expect(ditolak.error?.message).toBe("Anda sudah memiliki produk ini.");

    const { data, error } = await ananda.rpc("baca_keranjang");
    expect(error).toBeNull();
    expect((data as { product_id: string; keadaan: string }[]).map((r) => [r.product_id, r.keadaan]))
      .toEqual([[a, "siap"]]);
  });
});

describe("trigger pembersihan — lewat webhook NYATA", () => {
  it("settlement yang menerbitkan akses menghapus produk itu dari keranjang", async () => {
    const a = await semaiProduk(`krj-trg-${Date.now()}`, 120_000);
    const ananda = await signInAs(KLIEN_EMAIL);
    expect((await ananda.rpc("tambah_ke_keranjang", { p_product_id: a })).error).toBeNull();

    const { data: pesanan, error: ePesanan } = await ananda.rpc("buat_pesanan", { p_product_id: a });
    expect(ePesanan).toBeNull();
    const baris = (pesanan as { kode: string; percobaan: number }[])[0];

    const settlement = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: rakitOrderId(baris.kode, baris.percobaan),
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-keranjang-bersih",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120_000,
      p_sidik: randomUUID(),
    });
    expect(settlement.error).toBeNull();
    expect(settlement.data).toBe("diterapkan");

    const { data: sisa } = await svc
      .from("cart_items")
      .select("product_id")
      .eq("client_id", ANANDA_CLIENT_ID);
    expect(sisa).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/keranjang-db.test.ts`
Expected: FAIL — `relation "public.cart_items" does not exist` / `Could not find the function public.tambah_ke_keranjang`. (Butuh Docker.)

- [ ] **Step 3: Tulis migrasi**

`web/supabase/migrations/20261002100000_keranjang_tabel.sql`:

```sql
-- ===========================================================================
-- P2 KERANJANG (1/2) — cart_items, tiga pintu klien, trigger pembersihan
-- ===========================================================================
-- Keranjang mengingat APA yang ingin dibeli, bukan BERAPA harganya: nol kolom
-- harga. Harga dibaca dari `harga_produk_publik` saat ditampilkan dan
-- dibekukan `buat_pesanan_keranjang` saat checkout (migrasi berikutnya).
--
-- Hak mengikuti P1: tabelnya hanya bisa DIBACA pemiliknya; setiap penulisan
-- lewat fungsi `security definer` yang memilih client_id-nya sendiri dari
-- auth.uid(). Grant insert/delete langsung berarti klien bisa menaruh produk
-- yang sudah ia miliki ke keranjangnya lewat satu `curl`.

create table public.cart_items (
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.digital_products(id) on delete cascade,
  ditambahkan_pada timestamptz not null default now(),
  primary key (client_id, product_id)
);

comment on table public.cart_items is
  'Keranjang produk digital per klien. Tanpa harga — harga dibekukan saat '
  'checkout. Ditulis HANYA lewat tambah_ke_keranjang/hapus_dari_keranjang dan '
  'dibersihkan trigger saat akses produknya terbit.';

alter table public.cart_items enable row level security;

revoke all on public.cart_items from anon;
revoke all on public.cart_items from authenticated;
grant select on public.cart_items to authenticated;

-- SATU policy, tanpa policy staf: tidak ada layar staf yang membaca keranjang,
-- dan policy staf membuat `select` tanpa filter di peramban staf-yang-juga-
-- klien menarik keranjang seluruh klien.
create policy "keranjang: klien baca miliknya" on public.cart_items for select
  to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = cart_items.client_id and c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- tambah_ke_keranjang
-- ---------------------------------------------------------------------------
-- Gerbangnya sengaja LEBIH SEMPIT dari buat_pesanan_keranjang: tayang,
-- berharga, bukan gratis, belum dimiliki. Pesanan beruang tidak diperiksa di
-- sini — keranjang bukan uang, dan checkout yang menolaknya.
create or replace function public.tambah_ke_keranjang(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga integer;
  v_isi integer;
begin
  select c.id into v_client_id
    from public.clients c
   where c.user_id = auth.uid();
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

  if exists (
    select 1 from public.digital_entitlements e
     where e.client_id = v_client_id
       and e.product_id = p_product_id
       and e.dicabut_pada is null
  ) then
    raise exception 'Anda sudah memiliki produk ini.' using errcode = 'P0001';
  end if;

  -- Sudah di keranjang: diam, bukan galat. Diperiksa SEBELUM batas, supaya
  -- keranjang penuh tidak menolak produk yang memang sudah ada di dalamnya.
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

-- ---------------------------------------------------------------------------
-- hapus_dari_keranjang
-- ---------------------------------------------------------------------------
create or replace function public.hapus_dari_keranjang(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select c.id into v_client_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  delete from public.cart_items k
   where k.client_id = v_client_id and k.product_id = p_product_id;
end;
$$;

revoke all on function public.hapus_dari_keranjang(uuid) from public, anon;
grant execute on function public.hapus_dari_keranjang(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- baca_keranjang
-- ---------------------------------------------------------------------------
-- Satu panggilan untuk seluruh layar keranjang. `security definer` karena
-- `diproses` butuh `order_items`, yang nol grant bagi authenticated.
--
-- `diproses` MEMANGGIL punya_pesanan_menunggu(), TIDAK menyalin himpunan
-- statusnya. Fungsi itu sudah wajib cermin gerbang beruang buat_pesanan;
-- salinan ketiga adalah satu tempat lagi yang bisa berbeda diam-diam
-- (pelajaran Temuan 1 P1-A).
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
           when exists (
             select 1 from public.digital_entitlements e
              where e.client_id = k.client_id
                and e.product_id = k.product_id
                and e.dicabut_pada is null
           ) then 'sudah_dimiliki'
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

-- ---------------------------------------------------------------------------
-- Pembersihan otomatis saat akses terbit
-- ---------------------------------------------------------------------------
-- SATU tempat menutup semua jalur akses — beli (webhook → terbitkan_akses_item),
-- ambil gratis, pemberian staf — tanpa menyentuh satu baris pun mesin P1.
create or replace function public.bersihkan_keranjang_saat_akses()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.dicabut_pada is null then
    delete from public.cart_items k
     where k.client_id = new.client_id and k.product_id = new.product_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bersihkan_keranjang_saat_akses() from public, anon, authenticated;

create trigger keranjang_bersih_saat_akses
  after insert or update of dicabut_pada on public.digital_entitlements
  for each row execute function public.bersihkan_keranjang_saat_akses();
```

- [ ] **Step 4: Daftarkan di uji struktural yang ada**

`web/tests/fungsi-mesin-tertutup.test.ts` — di objek `TERBUKA_SADAR`, sesudah baris `ambil_produk_gratis: "auth.uid",` tambahkan:

```ts
  baca_keranjang: "auth.uid",
```

dan sesudah baris `catat_token_snap: "auth.uid",` tambahkan:

```ts
  hapus_dari_keranjang: "auth.uid",
  tambah_ke_keranjang: "auth.uid",
```

`web/tests/grant-anon.test.ts` — di `TABEL_TERTUTUP_ANON`, tepat sebelum `"pesanan_item_staf",` tambahkan:

```ts
  // Keranjang P2: SELECT bagi `authenticated` saja, lewat policy milik sendiri.
  "cart_items",
```

- [ ] **Step 5: Terapkan dan jalankan**

Run: `npx supabase migration up && npx vitest run tests/keranjang-db.test.ts tests/fungsi-mesin-tertutup.test.ts tests/grant-anon.test.ts tests/struktur-rls.test.ts tests/hak-default-sequence-fungsi.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20261002100000_keranjang_tabel.sql web/tests/keranjang-db.test.ts web/tests/fungsi-mesin-tertutup.test.ts web/tests/grant-anon.test.ts
git commit -m "feat(keranjang): tabel cart_items, tiga RPC klien, trigger pembersihan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: RPC pesanan multi-item

**Files:**
- Create: `web/supabase/migrations/20261002110000_keranjang_pesanan.sql`
- Create: `web/tests/keranjang-pesanan-db.test.ts`
- Modify: `web/tests/fungsi-mesin-tertutup.test.ts` (`TERBUKA_SADAR`)

**Interfaces:**
- Produces: `public.buat_pesanan_keranjang(p_product_ids uuid[], p_ulang boolean default false) returns table (pesanan_id uuid, kode text, percobaan smallint, nominal_tagih integer, judul text, jumlah_item smallint)` — dipakai Task 3.
- `public.buat_pesanan(uuid, boolean)` tanda tangan & pulangan TIDAK berubah.

- [ ] **Step 1: Tulis uji yang gagal**

`web/tests/keranjang-pesanan-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { rakitOrderId } from "@/lib/pesanan/order-id";

/**
 * Titik buta 2 (spec P2, "Pengujian"): gerbang P1 dijalankan PER PRODUK di
 * dalam larik. Keranjang tiga produk dengan satu yang sudah dimiliki adalah
 * jalur tagih-dua-kali, dan ia jarang dicoba dengan tangan.
 */

const KLIEN_EMAIL = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

type BarisPesanan = {
  pesanan_id: string;
  kode: string;
  percobaan: number;
  nominal_tagih: number;
  judul: string;
  jumlah_item: number;
};

const svc = createAdminSupabase();
const produkUji: string[] = [];

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc
    .from("digital_product_prices")
    .insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  if (eHarga) throw eHarga;
  return data!.id;
}

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

afterEach(bersihkan);
beforeAll(bersihkan);

async function keranjang(ids: string[]) {
  const klien = await signInAs(KLIEN_EMAIL);
  return klien.rpc("buat_pesanan_keranjang", { p_product_ids: ids });
}

async function cacahPesanan(): Promise<number> {
  const { count } = await svc
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ANANDA_CLIENT_ID);
  return count ?? 0;
}

describe("buat_pesanan_keranjang — gerbang per produk", () => {
  it("satu produk yang SUDAH dimiliki menolak seluruh larik, menyebut judulnya, nol pesanan lahir", async () => {
    const t = Date.now();
    const a = await semaiProduk(`kp-a-${t}`, 100_000);
    const b = await semaiProduk(`kp-b-${t}`, 50_000);
    const c = await semaiProduk(`kp-c-${t}`, 75_000);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID, product_id: b, sumber: "beli",
    });

    const { error } = await keranjang([a, b, c]);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(`Anda sudah memiliki "Uji kp-b-${t}" — hapus dari keranjang.`);
    expect(await cacahPesanan()).toBe(0);
  });

  it("satu produk BERUANG (lunas tanpa akses hidup) menolak larik dengan kalimat tinjauan", async () => {
    // Bentuk persis uji `akses_tertahan` P1: entitlement lama DICABUT, lalu
    // pesanan baru lunas → status lunas, nol entitlement hidup. Gerbang
    // entitlement diam; gerbang beruang yang wajib menyala.
    const t = Date.now();
    const a = await semaiProduk(`kp-br-a-${t}`, 120_000);
    const c = await semaiProduk(`kp-br-c-${t}`, 75_000);
    await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: a,
      sumber: "beli",
      dicabut_pada: new Date("2026-09-01T00:00:00Z").toISOString(),
    });
    const { data: satu, error: eSatu } = await keranjang([a]);
    expect(eSatu).toBeNull();
    const p = (satu as BarisPesanan[])[0];
    const settlement = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: rakitOrderId(p.kode, p.percobaan),
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-kp-beruang",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120_000,
      p_sidik: randomUUID(),
    });
    expect(settlement.data).toBe("diterapkan");

    const { error } = await keranjang([c, a]);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(
      `Pembayaran Anda untuk "Uji kp-br-a-${t}" sedang ditinjau staf — hapus dari keranjang.`,
    );
  });

  it("pesanan terbuka dicocokkan sebagai HIMPUNAN; kembar dibuang; isi lain ditolak", async () => {
    const t = Date.now();
    const a = await semaiProduk(`kp-h-a-${t}`, 100_000);
    const b = await semaiProduk(`kp-h-b-${t}`, 50_000);
    const c = await semaiProduk(`kp-h-c-${t}`, 75_000);

    const { data: d1, error: e1 } = await keranjang([a, b, a]);
    expect(e1).toBeNull();
    const pertama = (d1 as BarisPesanan[])[0];
    expect(pertama.jumlah_item).toBe(2);
    expect(pertama.nominal_tagih).toBe(150_000);
    expect(pertama.judul).toBe(`Uji kp-h-a-${t}`);

    const { data: d2, error: e2 } = await keranjang([b, a]);
    expect(e2).toBeNull();
    expect((d2 as BarisPesanan[])[0].pesanan_id).toBe(pertama.pesanan_id);

    const { error: e3 } = await keranjang([a, c]);
    expect(e3?.code).toBe("P0001");
    expect(e3?.message).toBe(
      `Selesaikan dulu pesanan ${pertama.kode} yang masih terbuka, atau batalkan lebih dulu.`,
    );
    expect(await cacahPesanan()).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/keranjang-pesanan-db.test.ts`
Expected: FAIL — `Could not find the function public.buat_pesanan_keranjang`.

- [ ] **Step 3: Tulis migrasi**

`web/supabase/migrations/20261002110000_keranjang_pesanan.sql`:

```sql
-- ===========================================================================
-- P2 KERANJANG (2/2) — checkout multi-item
-- ===========================================================================
-- Mesin P1 sudah multi-item sejak lahir: `salurkan_pesanan` mengulang seluruh
-- `order_items`, webhook membandingkan `gross_amount` dengan JUMLAH harga beku
-- dan `jumlah_item` dengan cacah baris. Yang membatasi P1 ke satu produk
-- hanyalah RPC-nya — dan itulah satu-satunya yang diganti di sini.
--
-- `buat_pesanan(uuid, boolean)` dipertahankan sebagai PEMBUNGKUS satu-item,
-- supaya seluruh gerbang hidup di SATU badan fungsi. Dua salinan gerbang yang
-- sama adalah dua tempat yang bisa berbeda diam-diam (Temuan 1 P1-A).
--
-- Gerbangnya disalin dari `20260926130000_pesanan_rpc.sql` TANPA mengubah
-- satu kondisi pun; alasan lengkap tiap gerbang tinggal di dokblok sana.

-- ---------------------------------------------------------------------------
-- himpunan_produk_pesanan_sama — pembantu, TERTUTUP
-- ---------------------------------------------------------------------------
-- Dibandingkan sebagai HIMPUNAN terurut: pembeli yang menyusun ulang
-- keranjangnya tetap memesan barang yang sama. Tertutup bagi authenticated
-- karena ia membaca `order_items` dan tidak menggerbangi pemanggilnya.
create or replace function public.himpunan_produk_pesanan_sama(
  p_pesanan_id uuid,
  p_product_ids uuid[]
) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select array_agg(oi.product_id order by oi.product_id)
       from public.order_items oi
      where oi.pesanan_id = p_pesanan_id)
    =
    (select array_agg(x order by x) from unnest(p_product_ids) as x),
    false);
$$;

revoke all on function public.himpunan_produk_pesanan_sama(uuid, uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- buat_pesanan_keranjang
-- ---------------------------------------------------------------------------
create or replace function public.buat_pesanan_keranjang(
  p_product_ids uuid[],
  p_ulang boolean default false
)
returns table (
  pesanan_id uuid,
  kode text,
  percobaan smallint,
  nominal_tagih integer,
  judul text,
  jumlah_item smallint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_padma_id text;
  v_ids uuid[];
  v_n integer;
  v_id uuid;
  v_judul text;
  v_harga integer;
  v_judul_arr text[] := '{}';
  v_harga_arr integer[] := '{}';
  v_pesanan_id uuid;
  v_kode text;
  v_percobaan smallint;
  v_terbuka_id uuid;
  v_terbuka_kode text;
  v_terbuka_percobaan smallint;
  v_kendala text;
  v_sisa integer := 5;
  v_baru boolean := false;
begin
  select c.id, c.padma_id into v_client_id, v_padma_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  -- Kembar dan null dibuang, urutan pertama dipertahankan: produk digital
  -- tidak punya kuantitas, dan dua baris untuk produk yang sama berarti
  -- menagih dua kali.
  select array_agg(u.id order by u.ord) into v_ids
    from (
      select distinct on (x.id) x.id, x.ord
        from unnest(p_product_ids) with ordinality as x(id, ord)
       where x.id is not null
       order by x.id, x.ord
    ) u;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    raise exception 'Keranjang kosong.' using errcode = 'P0001';
  end if;
  if v_n > 20 then
    raise exception 'Paling banyak 20 produk dalam satu pesanan.' using errcode = 'P0001';
  end if;

  -- Gerbang P1, per produk. Untuk larik SATU produk kalimatnya SAMA PERSIS
  -- dengan P1 — uji P1 dan rute checkout bergantung padanya.
  for idx in 1 .. v_n loop
    v_id := v_ids[idx];
    v_judul := null;
    v_harga := null;

    select p.judul, h.harga into v_judul, v_harga
      from public.digital_products p
      join public.harga_produk_publik h on h.product_id = p.id
     where p.id = v_id and p.aktif;
    if v_harga is null then
      raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
    end if;

    if v_harga = 0 then
      raise exception '%', case when v_n = 1
        then 'Produk ini gratis — ambil lewat tombol ambil, bukan checkout.'
        else format('"%s" gratis — hapus dari keranjang dan ambil lewat halamannya.', v_judul)
      end using errcode = 'P0001';
    end if;

    if exists (
      select 1
        from public.digital_entitlements e
       where e.client_id = v_client_id
         and e.product_id = v_id
         and e.dicabut_pada is null
    ) then
      raise exception '%', case when v_n = 1
        then 'Anda sudah memiliki produk ini — buka di Pembelian Saya.'
        else format('Anda sudah memiliki "%s" — hapus dari keranjang.', v_judul)
      end using errcode = 'P0001';
    end if;

    -- Set WAJIB cermin `punya_pesanan_menunggu` (minus `menunggu_bayar`,
    -- yang ditangani blok pesanan terbuka di bawah).
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
      raise exception '%', case when v_n = 1
        then 'Pembayaran Anda untuk produk ini sedang ditinjau staf.'
        else format('Pembayaran Anda untuk "%s" sedang ditinjau staf — hapus dari keranjang.', v_judul)
      end using errcode = 'P0001';
    end if;

    v_judul_arr := v_judul_arr || v_judul;
    v_harga_arr := v_harga_arr || v_harga;
  end loop;

  -- Pesanan terbuka yang sudah ada. `for update` menyerialkan dua panggilan
  -- `p_ulang` yang datang bersamaan supaya `percobaan` tidak melompat dua.
  select o.id, o.kode, o.percobaan
    into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
    from public.orders o
   where o.client_id = v_client_id and o.status = 'menunggu_bayar'
   for update;

  if v_terbuka_id is not null then
    -- TIDAK dibatalkan otomatis bila isinya berbeda: instruksi VA-nya mungkin
    -- sudah di tangan pembeli, dan menutupnya mengundang lunas_setelah_tutup.
    if not public.himpunan_produk_pesanan_sama(v_terbuka_id, v_ids) then
      raise exception
        'Selesaikan dulu pesanan % yang masih terbuka, atau batalkan lebih dulu.',
        v_terbuka_kode using errcode = 'P0001';
    end if;

    if not p_ulang then
      v_pesanan_id := v_terbuka_id;
      v_kode := v_terbuka_kode;
      v_percobaan := v_terbuka_percobaan;
    elsif v_terbuka_percobaan < 9 then
      update public.orders o
         set percobaan = v_terbuka_percobaan + 1,
             snap_token = null,
             snap_diterbitkan_pada = null
       where o.id = v_terbuka_id
         and o.status = any (array['menunggu_bayar']::public.order_status[])
      returning o.id, o.kode, o.percobaan
        into v_pesanan_id, v_kode, v_percobaan;

      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'dibuat', format('percobaan ke-%s', v_percobaan));
    else
      if not coalesce(
        public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                       'dibatalkan'::public.order_status), false) then
        raise exception 'Mesin status menolak menutup pesanan %.', v_terbuka_kode
          using errcode = 'P0001';
      end if;

      update public.orders o
         set status = 'dibatalkan',
             ditutup_pada = now()
       where o.id = v_terbuka_id
         and o.status = any (array['menunggu_bayar']::public.order_status[]);

      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_terbuka_id, v_padma_id, 'dibatalkan',
              'percobaan kesepuluh: pesanan lama ditutup, pesanan baru diterbitkan');
    end if;
  end if;

  while v_pesanan_id is null and v_sisa > 0 loop
    v_sisa := v_sisa - 1;
    v_kode := 'PSN-'
           || to_char((now() at time zone 'Asia/Jakarta')::date, 'YYMMDD')
           || '-'
           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.orders (kode, client_id, jumlah_item)
      values (v_kode, v_client_id, v_n)
      -- DIKUALIFIKASI: `percobaan` juga nama parameter OUT (alasan di P1).
      returning orders.id, orders.percobaan into v_pesanan_id, v_percobaan;
      v_baru := true;
    exception when unique_violation then
      get stacked diagnostics v_kendala = constraint_name;
      if v_kendala = 'pesanan_terbuka_satu_per_klien' then
        select o.id, o.kode, o.percobaan
          into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
          from public.orders o
         where o.client_id = v_client_id and o.status = 'menunggu_bayar';

        if not public.himpunan_produk_pesanan_sama(v_terbuka_id, v_ids) then
          raise exception
            'Selesaikan dulu pesanan % yang masih terbuka, atau batalkan lebih dulu.',
            v_terbuka_kode using errcode = 'P0001';
        end if;

        v_pesanan_id := v_terbuka_id;
        v_kode := v_terbuka_kode;
        v_percobaan := v_terbuka_percobaan;
      elsif v_kendala <> 'orders_kode_unik' then
        raise;
      end if;
    end;
  end loop;

  if v_pesanan_id is null then
    raise exception 'Gagal menerbitkan kode pesanan sesudah lima percobaan. Coba lagi.'
      using errcode = 'P0001';
  end if;

  if v_baru then
    -- Harga & judul DIBEKUKAN di sini, dalam urutan keranjang.
    insert into public.order_items (
      pesanan_id, jenis, product_id, judul_beku, harga_beku, urutan
    )
    select v_pesanan_id, 'produk_digital', v_ids[k], v_judul_arr[k], v_harga_arr[k], k
      from generate_series(1, v_n) as k;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'dibuat',
            case when v_n = 1 then 'checkout produk digital'
                 else format('checkout keranjang, %s produk', v_n) end);
  end if;

  return query
    select v_pesanan_id,
           v_kode,
           v_percobaan,
           (select coalesce(sum(oi.harga_beku), 0)::integer
              from public.order_items oi
             where oi.pesanan_id = v_pesanan_id),
           (select oi.judul_beku
              from public.order_items oi
             where oi.pesanan_id = v_pesanan_id
             order by oi.urutan
             limit 1),
           (select count(*)::smallint
              from public.order_items oi
             where oi.pesanan_id = v_pesanan_id);
end;
$$;

comment on function public.buat_pesanan_keranjang(uuid[], boolean) is
  'Satu-satunya pintu klien melahirkan pesanan (1..20 produk digital). client_id '
  'dari auth.uid(). Gerbang P1 per produk. Pesanan terbuka dipulangkan bila '
  'himpunan produknya sama, ditolak bila berbeda. buat_pesanan(uuid, boolean) '
  'adalah pembungkus satu-item.';

revoke all on function public.buat_pesanan_keranjang(uuid[], boolean) from public, anon;
grant execute on function public.buat_pesanan_keranjang(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- buat_pesanan — kini pembungkus satu-item
-- ---------------------------------------------------------------------------
-- Tanda tangan dan pulangan TIDAK berubah. Pemeriksaan auth.uid() bukan
-- hiasan: fungsi ini tetap terbuka bagi authenticated, dan pintu terbuka wajib
-- menggerbangi dirinya sendiri (`TERBUKA_SADAR`).
create or replace function public.buat_pesanan(
  p_product_id uuid,
  p_ulang boolean default false
)
returns table (
  pesanan_id uuid,
  kode text,
  percobaan smallint,
  nominal_tagih integer,
  judul text
)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  return query
    select k.pesanan_id, k.kode, k.percobaan, k.nominal_tagih, k.judul
      from public.buat_pesanan_keranjang(array[p_product_id], p_ulang) k;
end;
$$;

comment on function public.buat_pesanan(uuid, boolean) is
  'Pembungkus satu-item atas buat_pesanan_keranjang — seluruh gerbang hidup di '
  'sana, satu badan, supaya tidak ada dua salinan yang bisa berbeda diam-diam.';

revoke all on function public.buat_pesanan(uuid, boolean) from public, anon;
grant execute on function public.buat_pesanan(uuid, boolean) to authenticated;
```

- [ ] **Step 4: Daftarkan di `TERBUKA_SADAR`**

`web/tests/fungsi-mesin-tertutup.test.ts` — sesudah baris `buat_pesanan: "auth.uid",` tambahkan:

```ts
  buat_pesanan_keranjang: "auth.uid",
```

- [ ] **Step 5: Terapkan dan jalankan — termasuk uji P1 sebagai bukti pembungkusnya setia**

Run: `npx supabase migration up && npx vitest run tests/keranjang-pesanan-db.test.ts tests/fungsi-mesin-tertutup.test.ts tests/pesanan-checkout-db.test.ts tests/pesanan-checkout-rute.test.ts tests/pesanan-akses-tiga-keadaan.test.ts`
Expected: PASS semua, uji P1 tanpa diubah satu baris pun.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20261002110000_keranjang_pesanan.sql web/tests/keranjang-pesanan-db.test.ts web/tests/fungsi-mesin-tertutup.test.ts
git commit -m "feat(keranjang): buat_pesanan_keranjang — gerbang P1 per produk, buat_pesanan jadi pembungkus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rute checkout multi-item & kembali ke produk sesudah login

**Files:**
- Create: `web/src/lib/auth/tujuan-produk.ts`
- Create: `web/tests/tujuan-produk.test.ts`
- Modify: `web/src/app/setelah-masuk/route.ts`
- Modify: `web/src/app/api/pesanan/checkout/route.ts`
- Modify: `web/src/app/produk/[slug]/tombol-beli.tsx` (`mintaCheckout`, cabang `masuk` di `klik()`)

**Interfaces:**
- Consumes: `buat_pesanan_keranjang` (Task 2).
- Produces:
  - `COOKIE_LANJUT = "padma_lanjut"`
  - `tujuanProdukAman(nilai: string | null | undefined): string | null`
  - `titipTujuanDiPeramban(path: string): void`
  - `mintaCheckout(produk: string | readonly string[], ulang: boolean, ambil?: typeof fetch)` — pulangan tidak berubah.

- [ ] **Step 1: Tulis uji murni yang gagal**

Satu-satunya uji di luar tiga titik buta spec: ini pagar pengalihan terbuka, dan pengujian manual tidak akan mencoba `//situs-lain`.

`web/tests/tujuan-produk.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tujuanProdukAman } from "@/lib/auth/tujuan-produk";

describe("tujuanProdukAman — hanya path produk di situs ini", () => {
  it("menerima path produk berslug sah", () => {
    expect(tujuanProdukAman("/produk/panduan-nifas")).toBe("/produk/panduan-nifas");
    expect(tujuanProdukAman("/produk/e-book-2")).toBe("/produk/e-book-2");
  });

  it.each([
    null,
    undefined,
    "",
    "//situs-lain.com",
    "https://situs-lain.com/produk/x",
    "/produk/",
    "/produk/../admin",
    "/produk/x/y",
    "/produk/x?y=1",
    "/produk/Huruf-Besar",
    "/produk/-x",
    "/admin",
    `/produk/${"a".repeat(200)}`,
  ])("menolak %s", (nilai) => {
    expect(tujuanProdukAman(nilai)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/tujuan-produk.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/tujuan-produk"`.

- [ ] **Step 3: Tulis pembantunya**

`web/src/lib/auth/tujuan-produk.ts`:

```ts
/**
 * "Kembali ke produk sesudah login" (spec P2) — dititipkan di cookie, bukan di
 * parameter URL, karena pola yang sama sudah selamat melewati ketiga jalur
 * masuk repo ini: email+sandi, Google (`/auth/callback` → `/setelah-masuk`),
 * dan pendaftaran + konfirmasi email (lihat `COOKIE_KLAIM`,
 * `lib/skrining/klaim.ts`).
 *
 * `tujuanAman()` (`./tujuan-aman.ts`) TIDAK dipakai: ia daftar izin path
 * persis, dan path ber-slug tidak bisa didaftar. Yang ini sengaja lebih sempit
 * lagi — hanya `/produk/<slug>`. Cookie ini ditulis peramban, jadi isinya
 * dianggap masukan musuh sampai lolos fungsi di bawah.
 */
export const COOKIE_LANJUT = "padma_lanjut";

const POLA_TUJUAN_PRODUK = /^\/produk\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function tujuanProdukAman(nilai: string | null | undefined): string | null {
  if (typeof nilai !== "string" || nilai.length > 120) return null;
  return POLA_TUJUAN_PRODUK.test(nilai) ? nilai : null;
}

/** Dipanggil di peramban tepat sebelum `router.push("/masuk")`. */
export function titipTujuanDiPeramban(path: string): void {
  if (tujuanProdukAman(path) === null) return;
  document.cookie = `${COOKIE_LANJUT}=${path}; Path=/; Max-Age=3600; SameSite=Lax`;
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `npx vitest run tests/tujuan-produk.test.ts`
Expected: PASS.

- [ ] **Step 5: `/setelah-masuk` membaca cookie**

`web/src/app/setelah-masuk/route.ts` — tambah impor:

```ts
import { COOKIE_LANJUT, tujuanProdukAman } from "@/lib/auth/tujuan-produk";
```

Ganti baris

```ts
  const alamatTujuan = new URL(tujuan, url.origin);
```

dengan

```ts
  // Kembali ke produk (spec P2) HANYA untuk klien biasa yang tujuannya memang
  // `/passport`, dan HANYA bila tidak ada klaim skrining yang tersambung —
  // klaim itu membawa parameter yang dibaca beranda passport, dan ia menang.
  // Owner/admin sudah pulang lebih dulu di atas; alur undangan memulangkan
  // tujuan lain dari `pastikanKlien`.
  const lanjut = tujuanProdukAman(jar.get(COOKIE_LANJUT)?.value);
  const alamatTujuan = new URL(
    tujuan === "/passport" && !skriningTersambung && lanjut !== null ? lanjut : tujuan,
    url.origin,
  );
```

Ganti baris

```ts
  if (tokenKlaim) response.cookies.delete(COOKIE_KLAIM);
```

dengan

```ts
  if (tokenKlaim) response.cookies.delete(COOKIE_KLAIM);
  // Dihapus apa pun hasilnya: tujuan yang tidak dipakai sekarang tidak boleh
  // membajak login berikutnya satu jam kemudian.
  if (jar.get(COOKIE_LANJUT)) response.cookies.delete(COOKIE_LANJUT);
```

- [ ] **Step 6: Rute checkout menerima larik**

`web/src/app/api/pesanan/checkout/route.ts`:

Di tipe `BarisPesanan`, sesudah `judul: string;` tambahkan `jumlah_item: number;`.

Ganti blok

```ts
  const isi = (badan ?? {}) as { productId?: unknown; ulang?: unknown };
  const productId = typeof isi.productId === "string" ? isi.productId : "";
  if (!POLA_UUID.test(productId)) {
    return NextResponse.json({ pesan: "Produk tidak dikenali." }, { status: 400 });
  }
```

dengan

```ts
  const isi = (badan ?? {}) as { productId?: unknown; productIds?: unknown; ulang?: unknown };
  // Dua bentuk badan: `productId` (tombol "Beli sekarang") dan `productIds`
  // (keranjang, P2). Keduanya mendarat di RPC yang sama.
  const productIds: unknown[] = Array.isArray(isi.productIds)
    ? isi.productIds
    : typeof isi.productId === "string"
      ? [isi.productId]
      : [];
  if (
    productIds.length === 0 ||
    productIds.length > 20 ||
    !productIds.every((id) => typeof id === "string" && POLA_UUID.test(id))
  ) {
    return NextResponse.json({ pesan: "Produk tidak dikenali." }, { status: 400 });
  }
```

Ganti

```ts
  const { data, error } = await supabase.rpc("buat_pesanan", {
    p_product_id: productId,
    p_ulang: ulang,
  });
```

dengan

```ts
  const { data, error } = await supabase.rpc("buat_pesanan_keranjang", {
    p_product_ids: productIds,
    p_ulang: ulang,
  });
```

Ganti baris `    judul: baris.judul,` (di dalam `terbitkanTokenSnap({...})`) dengan

```ts
    // Snap menerima SATU baris item seharga total. Merinci per produk adalah
    // satu tempat lagi untuk selisih jumlah, dan Midtrans menolak transaksi
    // yang rinciannya tidak berjumlah `gross_amount`.
    judul:
      baris.jumlah_item > 1
        ? `${baris.judul} + ${baris.jumlah_item - 1} produk lain`
        : baris.judul,
```

Di dokblok atas berkas, ganti `memanggil RPC \`buat_pesanan\` DENGAN SESI` menjadi `memanggil RPC \`buat_pesanan_keranjang\` DENGAN SESI`.

- [ ] **Step 7: `mintaCheckout` menerima larik; "Beli sekarang" menitip tujuan**

`web/src/app/produk/[slug]/tombol-beli.tsx`:

Ganti

```ts
export async function mintaCheckout(
  productId: string,
  ulang: boolean,
  ambil: typeof fetch = (...argumen) => fetch(...argumen),
): Promise<{ hasil: HasilCheckout; orderIdTerbakar: boolean }> {
  let jawab: Response;
  try {
    jawab = await ambil("/api/pesanan/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, ulang }),
    });
```

dengan

```ts
export async function mintaCheckout(
  produk: string | readonly string[],
  ulang: boolean,
  ambil: typeof fetch = (...argumen) => fetch(...argumen),
): Promise<{ hasil: HasilCheckout; orderIdTerbakar: boolean }> {
  // Satu id = "Beli sekarang"; larik = keranjang (P2). Rutenya menerima keduanya.
  const badan =
    typeof produk === "string" ? { productId: produk, ulang } : { productIds: produk, ulang };
  let jawab: Response;
  try {
    jawab = await ambil("/api/pesanan/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(badan),
    });
```

Tambah impor: `import { titipTujuanDiPeramban } from "@/lib/auth/tujuan-produk";`

Di `klik()`, ganti

```ts
        // `/masuk` tidak membaca parameter lanjutan apa pun di repo ini, jadi
        // tidak ada janji "kembali ke sini" yang dibuat lalu dilanggar.
        router.push("/masuk");
```

dengan

```ts
        // Tujuan dititipkan di cookie dan dibaca `/setelah-masuk` (spec P2).
        // Pembeli mendarat lagi di produk ini dan menekan tombolnya sekali
        // lagi — tidak ada pembelian yang dimulai otomatis.
        titipTujuanDiPeramban(`/produk/${slug}`);
        router.push("/masuk");
```

(Cabang `masuk` di `batal()` TIDAK diubah — pembatalan bukan niat membeli.)

- [ ] **Step 8: Periksa tipe, lint, uji P1 yang menyentuh berkas ini**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/produk-tombol-beli.test.tsx tests/tujuan-aman.test.ts tests/tujuan-produk.test.ts`
Expected: bersih & PASS. Bila Docker hidup, juga: `npx vitest run tests/pesanan-checkout-rute.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/auth/tujuan-produk.ts web/tests/tujuan-produk.test.ts web/src/app/setelah-masuk/route.ts web/src/app/api/pesanan/checkout/route.ts "web/src/app/produk/[slug]/tombol-beli.tsx"
git commit -m "feat(keranjang): checkout menerima larik produk; kembali ke produk sesudah login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tombol & tautan keranjang di etalase

**Files:**
- Create: `web/src/lib/keranjang/peramban.ts`
- Create: `web/src/app/produk/[slug]/tombol-keranjang.tsx`
- Create: `web/src/app/produk/tautan-keranjang.tsx`
- Modify: `web/src/app/produk/[slug]/tombol-beli.tsx` (return `TombolBeli`)
- Modify: `web/src/app/produk/page.tsx`, `web/src/app/produk/[slug]/page.tsx`

**Interfaces:**
- Consumes: `tambah_ke_keranjang`, `cart_items` (Task 1); `titipTujuanDiPeramban` (Task 3).
- Produces: `ACARA_KERANJANG`, `hitungKeranjangDiPeramban(): Promise<number>`, `<TombolKeranjang slug productId />`, `<TautanKeranjang className? />`.

- [ ] **Step 1: Pembantu peramban**

`web/src/lib/keranjang/peramban.ts`:

```ts
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Acara di `window` yang menyala sesudah keranjang berubah dari tab ini —
 * supaya tautan "Keranjang (n)" di halaman yang sama ikut bergerak tanpa
 * muat ulang.
 */
export const ACARA_KERANJANG = "padma-keranjang-berubah";

/**
 * Jumlah item keranjang pemanggil, atau 0 tanpa sesi. RLS "keranjang: klien
 * baca miliknya" yang menyaring — tidak ada policy staf, jadi staf-yang-juga-
 * klien pun hanya menghitung miliknya sendiri.
 *
 * Galat dibaca sebagai 0: yang hilang hanyalah sebuah tautan, bukan uang.
 */
export async function hitungKeranjangDiPeramban(): Promise<number> {
  const sb = createBrowserSupabase();
  const { data: sesi } = await sb.auth.getSession();
  if (!sesi.session) return 0;
  const { count, error } = await sb
    .from("cart_items")
    .select("product_id", { count: "exact", head: true });
  if (error) {
    console.error(`[keranjang] hitungan tidak terbaca: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
```

- [ ] **Step 2: Tombol "Tambah ke keranjang"**

`web/src/app/produk/[slug]/tombol-keranjang.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { titipTujuanDiPeramban } from "@/lib/auth/tujuan-produk";
import { ACARA_KERANJANG } from "@/lib/keranjang/peramban";

/**
 * Hanya dirender `TombolBeli` pada keadaan "belum" — yang sudah memiliki atau
 * sedang membayar produk ini akan ditolak juga oleh RPC-nya.
 *
 * Status "sudah di keranjang" dibaca dari PERAMBAN, alasan yang sama dengan
 * `punyaProdukDiPeramban`: halaman ini anon dan `revalidate = 300`.
 */
async function adaDiKeranjang(productId: string): Promise<boolean> {
  const sb = createBrowserSupabase();
  const { data: sesi } = await sb.auth.getSession();
  if (!sesi.session) return false;
  const { data } = await sb
    .from("cart_items")
    .select("product_id")
    .eq("product_id", productId)
    .maybeSingle();
  return data !== null;
}

export function TombolKeranjang({ slug, productId }: { slug: string; productId: string }) {
  const [diKeranjang, setDiKeranjang] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [pending, mulai] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let hidup = true;
    void adaDiKeranjang(productId).then((ada) => {
      if (hidup) setDiKeranjang(ada);
    });
    return () => {
      hidup = false;
    };
  }, [productId]);

  function tambah() {
    mulai(async () => {
      setPesan(null);
      const sb = createBrowserSupabase();
      const { data: sesi } = await sb.auth.getSession();
      if (!sesi.session) {
        titipTujuanDiPeramban(`/produk/${slug}`);
        router.push("/masuk");
        return;
      }
      const { error } = await sb.rpc("tambah_ke_keranjang", { p_product_id: productId });
      if (error) {
        // P0001/P0002 adalah `raise exception` KITA, kalimatnya untuk pembeli.
        setPesan(
          error.code === "P0001" || error.code === "P0002"
            ? error.message
            : "Belum bisa menambah ke keranjang. Coba lagi sebentar lagi.",
        );
        return;
      }
      setDiKeranjang(true);
      window.dispatchEvent(new Event(ACARA_KERANJANG));
    });
  }

  if (diKeranjang) {
    return (
      <p className="mt-3 text-[13.5px] text-ink-soft">
        Sudah di keranjang ·{" "}
        <Link href="/passport/keranjang" className="font-semibold text-leaf underline">
          Lihat keranjang
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={tambah}
        disabled={pending}
        className="min-h-[44px] rounded-lg border border-night/25 px-5 py-3 font-bold text-night disabled:opacity-60"
      >
        {pending ? "Menambahkan..." : "Tambah ke keranjang"}
      </button>
      {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Pasang di bawah `PanelBeli`**

`web/src/app/produk/[slug]/tombol-beli.tsx` — tambah impor `import { TombolKeranjang } from "./tombol-keranjang";`, lalu ganti `return` terakhir `TombolBeli`:

```tsx
  return (
    <PanelBeli
      slug={slug}
      keadaan={keadaan}
      pending={pending}
      pesan={pesan}
      bisaDibatalkan={idBatal !== null}
      onBeli={klik}
      onBatal={batal}
    />
  );
}
```

dengan

```tsx
  return (
    <>
      <PanelBeli
        slug={slug}
        keadaan={keadaan}
        pending={pending}
        pesan={pesan}
        bisaDibatalkan={idBatal !== null}
        onBeli={klik}
        onBatal={batal}
      />
      {/* Di LUAR PanelBeli supaya uji render PanelBeli tidak berubah. */}
      {keadaan === "belum" && <TombolKeranjang slug={slug} productId={productId} />}
    </>
  );
}
```

- [ ] **Step 4: Tautan "Keranjang (n)"**

`web/src/app/produk/tautan-keranjang.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ACARA_KERANJANG, hitungKeranjangDiPeramban } from "@/lib/keranjang/peramban";

/** Nol item = nol tautan: pengunjung anon dan keranjang kosong tidak melihat apa pun. */
export function TautanKeranjang({ className = "" }: { className?: string }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    let hidup = true;
    const segarkan = () => {
      void hitungKeranjangDiPeramban().then((v) => {
        if (hidup) setN(v);
      });
    };
    segarkan();
    window.addEventListener(ACARA_KERANJANG, segarkan);
    return () => {
      hidup = false;
      window.removeEventListener(ACARA_KERANJANG, segarkan);
    };
  }, []);

  if (n === 0) return null;
  return (
    <Link
      href="/passport/keranjang"
      className={`inline-flex min-h-[44px] items-center rounded-lg border border-night/20 px-4 text-[13.5px] font-bold text-night ${className}`}
    >
      Keranjang ({n})
    </Link>
  );
}
```

`web/src/app/produk/page.tsx` — impor `import { TautanKeranjang } from "./tautan-keranjang";`, ganti

```tsx
        <h1 className="text-[28px] font-bold text-ink">Produk Digital</h1>
```

dengan

```tsx
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[28px] font-bold text-ink">Produk Digital</h1>
          <TautanKeranjang />
        </div>
```

`web/src/app/produk/[slug]/page.tsx` — impor `import { TautanKeranjang } from "../tautan-keranjang";`, lalu ganti

```tsx
        <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-gold">
          {LABEL_JENIS[produk.jenis]}
        </span>
```

dengan

```tsx
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-gold">
            {LABEL_JENIS[produk.jenis]}
          </span>
          <TautanKeranjang />
        </div>
```

- [ ] **Step 5: Periksa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/produk-tombol-beli.test.tsx`
Expected: bersih & PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/keranjang/peramban.ts "web/src/app/produk/[slug]/tombol-keranjang.tsx" web/src/app/produk/tautan-keranjang.tsx "web/src/app/produk/[slug]/tombol-beli.tsx" web/src/app/produk/page.tsx "web/src/app/produk/[slug]/page.tsx"
git commit -m "feat(keranjang): tombol Tambah ke keranjang dan tautan Keranjang di etalase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Layar `/passport/keranjang`

**Files:**
- Create: `web/src/lib/keranjang/baca.ts`
- Create: `web/src/app/passport/keranjang/page.tsx`
- Create: `web/src/app/passport/keranjang/isi-keranjang.tsx`
- Modify: `web/src/app/passport/produk/page.tsx`

**Interfaces:**
- Consumes: `baca_keranjang`, `hapus_dari_keranjang` (Task 1); `mintaCheckout`, `mintaBatal` dari `@/app/produk/[slug]/tombol-beli` (Task 3); `ambilKlien` (`@/lib/passport/data`); `periksaPesananMenggantung` (`@/lib/pesanan/periksa-menggantung`); `muatSkripSnap`, `PESAN_PEMBAYARAN_BELUM_AKTIF` (`@/lib/midtrans/snap-peramban`); `midtransProduksi` (`@/lib/midtrans/konfig`).
- Produces: `KeadaanItem`, `ItemKeranjang`, `bacaKeranjang()`, `pesananTerbukaSaya(clientId)`, `hitungKeranjang()`.

- [ ] **Step 1: Pembacaan server**

`web/src/lib/keranjang/baca.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";

/** Harus sama dengan kosakata `baca_keranjang()` (`20261002100000`). */
export type KeadaanItem = "siap" | "tidak_tersedia" | "gratis" | "sudah_dimiliki" | "diproses";

export type ItemKeranjang = {
  productId: string;
  judul: string;
  slug: string;
  harga: number | null;
  keadaan: KeadaanItem;
};

type Baris = {
  product_id: string;
  judul: string;
  slug: string;
  harga: number | null;
  keadaan: KeadaanItem;
};

/**
 * GAGAL TERTUTUP: galat dilempar, bukan dibaca sebagai keranjang kosong.
 * Keranjang kosong yang palsu menyembunyikan barang yang mau dibeli orang.
 */
export async function bacaKeranjang(): Promise<ItemKeranjang[]> {
  const sb = await createServerSupabase();
  const { data, error } = await sb.rpc("baca_keranjang");
  if (error) throw new Error(`Gagal membaca keranjang: ${error.message}`);
  return ((data ?? []) as Baris[]).map((b) => ({
    productId: b.product_id,
    judul: b.judul,
    slug: b.slug,
    harga: b.harga,
    keadaan: b.keadaan,
  }));
}

/**
 * Pesanan terbuka MILIK klien ini. Filter `client_id` WAJIB: `orders` punya
 * policy "pesanan: staf baca", jadi staf-yang-juga-klien tanpa filter ini
 * membaca pesanan terbuka klien lain — dan tombol batal di layar ini akan
 * menunjuk pesanan orang (rute batalnya menolak, tapi layarnya berbohong).
 */
export async function pesananTerbukaSaya(
  clientId: string,
): Promise<{ id: string; kode: string } | null> {
  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("orders")
    .select("id, kode")
    .eq("client_id", clientId)
    .eq("status", "menunggu_bayar")
    .maybeSingle<{ id: string; kode: string }>();
  if (error) throw new Error(`Gagal membaca pesanan terbuka: ${error.message}`);
  return data;
}

export async function hitungKeranjang(): Promise<number> {
  const sb = await createServerSupabase();
  const { count, error } = await sb
    .from("cart_items")
    .select("product_id", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}
```

- [ ] **Step 2: Halaman server**

`web/src/app/passport/keranjang/page.tsx`:

```tsx
import { ambilKlien } from "@/lib/passport/data";
import { periksaPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";
import { bacaKeranjang, pesananTerbukaSaya } from "@/lib/keranjang/baca";
import { midtransProduksi } from "@/lib/midtrans/konfig";
import { IsiKeranjang } from "./isi-keranjang";

export const metadata = { title: "Keranjang" };

export default async function HalamanKeranjang() {
  const klien = await ambilKlien();
  if (!klien) return null; // layout sudah menangani; ini penjaga tipe

  // Lapis 1b, sama persis dengan /passport/produk: halaman ini dynamic, jadi
  // pemeriksaannya hidup di server, bukan dipicu dari peramban.
  await periksaPesananMenggantung();

  const [item, terbuka] = await Promise.all([bacaKeranjang(), pesananTerbukaSaya(klien.id)]);

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">Keranjang</h1>
      <IsiKeranjang
        item={item}
        terbuka={terbuka}
        produksi={midtransProduksi()}
        clientKey={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? ""}
      />
    </section>
  );
}
```

- [ ] **Step 3: Isi keranjang (klien)**

`web/src/app/passport/keranjang/isi-keranjang.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { muatSkripSnap, PESAN_PEMBAYARAN_BELUM_AKTIF } from "@/lib/midtrans/snap-peramban";
import { formatRupiah } from "@/lib/rupiah-publik";
import { mintaBatal, mintaCheckout } from "@/app/produk/[slug]/tombol-beli";
import type { ItemKeranjang, KeadaanItem } from "@/lib/keranjang/baca";

/** `Record` lengkap: nilai keadaan baru memerahkan kompilator, bukan diam. */
const KALIMAT_KEADAAN: Record<KeadaanItem, string | null> = {
  siap: null,
  tidak_tersedia: "Tidak tersedia lagi",
  gratis: "Gratis — ambil di halaman produknya",
  sudah_dimiliki: "Sudah Anda miliki",
  diproses: "Pembayaran sedang diproses",
};

const PESAN_TIDAK_BISA_DIBUKA = "Pembayaran tidak bisa dibuka. Coba lagi sebentar lagi.";

export function IsiKeranjang({
  item,
  terbuka,
  produksi,
  clientKey,
}: {
  item: readonly ItemKeranjang[];
  terbuka: { id: string; kode: string } | null;
  produksi: boolean;
  clientKey: string;
}) {
  const [pesan, setPesan] = useState<string | null>(null);
  // Lihat dokblok `mintaCheckout`: sekali order_id terkirim ke Snap, setiap
  // percobaan berikutnya wajib `ulang: true`.
  const [orderIdTerpakai, setOrderIdTerpakai] = useState(false);
  // Snap sudah menerbitkan instruksi bayar — pembatalan ditutup sejak detik
  // itu (alasan yang sama dengan `pembayaranBerjalan` di tombol-beli.tsx).
  const [pembayaranBerjalan, setPembayaranBerjalan] = useState(false);
  const [pending, mulai] = useTransition();
  const router = useRouter();

  const siap = item.filter((i) => i.keadaan === "siap");
  const total = siap.reduce((s, i) => s + (i.harga ?? 0), 0);

  function hapus(productId: string) {
    mulai(async () => {
      setPesan(null);
      const { error } = await createBrowserSupabase().rpc("hapus_dari_keranjang", {
        p_product_id: productId,
      });
      if (error) setPesan("Item belum bisa dihapus. Coba lagi sebentar lagi.");
      router.refresh();
    });
  }

  function bayar() {
    mulai(async () => {
      setPesan(null);
      if (clientKey.trim() === "") {
        setPesan(PESAN_PEMBAYARAN_BELUM_AKTIF);
        return;
      }
      try {
        await muatSkripSnap(clientKey, produksi);
      } catch {
        setPesan(PESAN_TIDAK_BISA_DIBUKA);
        return;
      }

      const { hasil, orderIdTerbakar } = await mintaCheckout(
        siap.map((i) => i.productId),
        orderIdTerpakai,
      );
      if (orderIdTerbakar) setOrderIdTerpakai(true);

      if (hasil.jenis === "masuk") {
        router.push("/masuk");
        return;
      }
      if (hasil.jenis === "pesan") {
        setPesan(hasil.pesan);
        // 409 (ditolak gerbang, mis. pesanan terbuka lain) → baca ulang supaya
        // tombol batal muncul. 502/jaringan → JANGAN: membaca ulang memindahkan
        // item ke "diproses" dan menghilangkan tombol Bayar, satu-satunya jalan
        // mencoba lagi dengan nomor percobaan baru.
        if (!orderIdTerbakar) router.refresh();
        return;
      }
      if (!window.snap) {
        setPesan(PESAN_TIDAK_BISA_DIBUKA);
        return;
      }

      window.snap.pay(hasil.token, {
        // Bukan sumber kebenaran pembayaran — hanya memicu pembacaan ulang.
        // Keranjang dikosongkan trigger saat akses benar-benar terbit.
        onSuccess: () => {
          setPembayaranBerjalan(true);
          router.refresh();
        },
        onPending: () => {
          setPembayaranBerjalan(true);
          router.refresh();
        },
        onClose: () => router.refresh(),
        onError: () => {
          setPesan("Pembayaran gagal. Silakan coba lagi.");
          router.refresh();
        },
      });
    });
  }

  function batal(id: string) {
    mulai(async () => {
      setPesan(null);
      const hasil = await mintaBatal(id);
      if (hasil.jenis === "masuk") {
        router.push("/masuk");
        return;
      }
      if (hasil.jenis === "pesan") setPesan(hasil.pesan);
      if (hasil.jenis === "dibatalkan") setOrderIdTerpakai(false);
      router.refresh();
    });
  }

  if (item.length === 0 && !pembayaranBerjalan) {
    return (
      <p className="rounded-xl border border-dashed border-black/10 bg-paper p-4 text-[13px] text-ink-soft">
        Keranjang Anda kosong. Jelajahi{" "}
        <Link href="/produk" className="font-semibold text-leaf underline">
          etalase produk
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {pembayaranBerjalan && (
        <div className="rounded-xl bg-gold/10 px-4 py-3 text-[13.5px] text-night">
          <b>Pembayaran sedang diproses.</b> Begitu diterima, produknya muncul di{" "}
          <Link href="/passport/produk" className="font-semibold text-leaf underline">
            Pembelian Saya
          </Link>
          .
        </div>
      )}

      <ul className="divide-y divide-black/10 rounded-xl border border-black/10">
        {item.map((i) => {
          const kalimat = KALIMAT_KEADAAN[i.keadaan];
          return (
            <li key={i.productId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/produk/${i.slug}`} className="block text-[14px] font-bold text-night">
                  {i.judul}
                </Link>
                {kalimat !== null ? (
                  <span className="text-[12.5px] text-clay">{kalimat}</span>
                ) : (
                  <span className="text-[13px] text-ink-soft">{formatRupiah(i.harga ?? 0)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => hapus(i.productId)}
                disabled={pending}
                className="min-h-[44px] rounded-lg px-3 text-[13px] font-semibold text-ink-soft underline disabled:opacity-60"
              >
                Hapus
              </button>
            </li>
          );
        })}
      </ul>

      {terbuka !== null && !pembayaranBerjalan && (
        <div className="rounded-xl border border-black/10 bg-paper px-4 py-3">
          <p className="text-[13.5px] text-night">
            Anda masih punya pesanan <b>{terbuka.kode}</b> yang belum dibayar.
          </p>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            Jangan batalkan bila Anda sudah mendapat nomor VA dan akan mentransfer.
          </p>
          <button
            type="button"
            onClick={() => batal(terbuka.id)}
            disabled={pending}
            className="mt-2 min-h-[44px] rounded-lg border border-night/25 px-4 py-2 text-[13px] font-bold text-night disabled:opacity-60"
          >
            {pending ? "Memproses..." : "Batalkan pesanan itu"}
          </button>
        </div>
      )}

      {siap.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-night">
            Total <b>{formatRupiah(total)}</b>
          </p>
          <button
            type="button"
            onClick={bayar}
            disabled={pending}
            className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
          >
            {pending ? "Menyiapkan pembayaran..." : "Bayar"}
          </button>
        </div>
      )}

      {pesan && <p className="text-sm text-clay">{pesan}</p>}

      <p className="rounded-xl border border-black/10 bg-white p-4 text-[13px] text-ink-soft">
        Produk digital dikirim seketika sesudah pembayaran dan <b>tidak dapat
        dikembalikan</b>.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Tautan dari "Pembelian Saya"**

`web/src/app/passport/produk/page.tsx` — impor `import { hitungKeranjang } from "@/lib/keranjang/baca";`. Ganti

```tsx
  const produk = await produkSaya(klien.id);
```

dengan

```tsx
  const [produk, isiKeranjang] = await Promise.all([produkSaya(klien.id), hitungKeranjang()]);
```

Lalu tepat sesudah penutup `</h1>` tambahkan:

```tsx
      {isiKeranjang > 0 && (
        <Link
          href="/passport/keranjang"
          className="mb-4 inline-flex min-h-[44px] items-center rounded-lg border border-night/20 px-4 text-[13.5px] font-bold text-night"
        >
          Keranjang ({isiKeranjang})
        </Link>
      )}
```

- [ ] **Step 5: Periksa**

Run: `npx tsc --noEmit && npm run lint`
Expected: bersih.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/keranjang/baca.ts web/src/app/passport/keranjang web/src/app/passport/produk/page.tsx
git commit -m "feat(keranjang): layar /passport/keranjang — bayar sekali, batal pesanan terbuka

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verifikasi akhir & catatan

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-padma-p2-keranjang-design.md` (satu baris Lapis 1b)

- [ ] **Step 1: Selaraskan spec**

Di spec, bagian `/passport/keranjang`, ganti butir Lapis 1b
`- Lapis 1b (\`picuPeriksaSekali(periksaPesananSaya, ...)\`) dipicu sekali saat halaman dibuka, seperti halaman produk.`
dengan
`- Lapis 1b: \`await periksaPesananMenggantung()\` di server component, sama persis dengan \`/passport/produk\` — halaman passport dynamic, jadi tidak perlu dipicu dari peramban.`

- [ ] **Step 2: Jalankan semua yang disentuh rencana ini**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/tujuan-produk.test.ts tests/tujuan-aman.test.ts tests/produk-tombol-beli.test.tsx`
Bila Docker hidup, juga: `npx vitest run tests/keranjang-db.test.ts tests/keranjang-pesanan-db.test.ts tests/fungsi-mesin-tertutup.test.ts tests/grant-anon.test.ts tests/struktur-rls.test.ts tests/hak-default-sequence-fungsi.test.ts tests/pesanan-checkout-db.test.ts tests/pesanan-checkout-rute.test.ts tests/pesanan-akses-tiga-keadaan.test.ts tests/pesanan-webhook.test.ts`
Expected: bersih & PASS. Laporkan apa adanya — termasuk yang TERTUNDA karena Docker.

- [ ] **Step 3: Uji asap manual (pemilik repo)** — lima butir Review Focus di atas, plus: anon → Tambah ke keranjang → `/masuk` → login → mendarat di produk yang sama.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-02-padma-p2-keranjang-design.md
git commit -m "docs(spec): P2 — Lapis 1b keranjang mengikuti /passport/produk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Tindak Lanjut (sengaja tidak dibayar di P2)

- Rate limit `/api/pesanan/checkout` — utang P1, tidak memburuk.
- Tidak ada uji render untuk `TombolKeranjang`, `TautanKeranjang`, `IsiKeranjang`, dan tidak ada uji rute untuk badan `productIds` — mode uji dipangkas; lima butir Review Focus diuji manual.
- Batas 20 di `tambah_ke_keranjang` tidak terkunci terhadap dua panggilan paralel (bisa jadi 21). Checkout tetap menolak > 20, jadi tidak ada uang yang terlibat.
- Migrasi P2 (`20261002100000`, `20261002110000`) lahir sesudah tujuh migrasi P1; penerapannya ke produksi ikut checklist go-live P1 (`web/README.md` Fase 3), bukan `db push`.
