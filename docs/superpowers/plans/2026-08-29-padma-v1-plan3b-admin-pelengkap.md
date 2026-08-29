# PADMA v1 — Plan 3B: Panel Admin Pelengkap (Pembayaran, Pengaturan, Layanan & Paket, Materi)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klinik bisa menutup siklus uangnya (memverifikasi klaim pembayaran klien) dan mengelola isinya sendiri (katalog layanan, paket, materi, nomor WhatsApp) — sehingga sistem bisa diserahterimakan ke client tanpa developer.

**Architecture:** Empat modul baru di `/admin/*` mengikuti pola yang sudah mapan setelah Plan 3A: `page.tsx` server component → `Promise.all` query → prop turun ke client component; `aksi.ts` `"use server"` hanya fungsi async; daftar putih & label di `status.ts`. **Seluruh operasi memakai sesi pengguna** — service role akan membuat `user_role()` mengembalikan `'klien'`, `auth.uid()` NULL, dan jejak audit kehilangan aktornya.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase (Postgres+RLS), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-padma-v1-design.md`
**Plan sebelumnya (sudah dieksekusi):** `plan1-fondasi.md`, `plan2-landing-skrining.md`, `plan4-passport.md`, `plan3a-admin-inti.md`
**Rujukan desain:** `padma-prototype.html` — `vBayarAdmin`, `ubahStatusBayar`, `vLayanan`, kartu Pengaturan Aplikasi & `simpanWa`.

**Keadaan repo saat plan ini ditulis (terverifikasi, bukan diasumsikan):** 19 migration, 50 berkas test + 4 skrip E2E, 854 test hijau, 24 rute. Migration baru **wajib** bercap waktu lebih besar dari `20260829200000`, ditulis **manual** — `npx supabase migration new` memakai jam dinding dan sudah pernah membuat `db reset` gagal karena urutannya menyelinap ke tengah.

## Global Constraints

- Seluruh teks UI berbahasa **Indonesia**.
- **Panel admin WAJIB memakai `createServerSupabase()`**, bukan `createAdminSupabase()`. `tests/admin-shell.test.ts` memindai `src/app/admin/**` secara rekursif untuk string `createAdminSupabase` dan `SERVICE_ROLE` — melanggarnya membuat test merah. Alasannya bukan gaya: di bawah service role jejak audit mencatat `aktor_id: null, peran_aktor: "service_role"`, menghancurkan satu-satunya alasan tabel jejak dibuat.
- **Server action = endpoint POST tersendiri**; guard layout tidak berlaku. `await requireRole(["admin","owner"])` wajib di dalam **setiap** action.
- **Keadaan tujuan tidak pernah menjadi parameter.** Prototipe memakai `<select onchange>` yang mengirim status dari browser — jangan ditiru. Pakai action terpisah dengan status hardcoded, tombol dirender bersyarat menurut status baris.
- Berkas `"use server"` **hanya** mengekspor fungsi async; daftar putih & label di `status.ts`.
- **`src/app/admin/layout.tsx` tetap memanggil `requireRole` tepat satu kali** — tiga berkas test menguncinya (`access-matrix-layouts`, `admin-inbox`, `admin-shell`).
- **UPDATE yang tertahan dijawab HTTP 200 + `[]`, bukan error.** Setiap action wajib `.select("id")` lalu memeriksa panjangnya sebelum melaporkan sukses.
- **Nominal uang tidak pernah tampil di panel admin.** `service_rates` mengembalikan `[]` untuk admin dengan HTTP 200 — kosong senyap.
- Penamaan kolom baru menghindari regex money-firewall (`bayar|harga|honor|tarif|biaya|total|nominal|amount|price|fee|rate|cost|payment`); `status_bayar` hanya boleh ada di `client_packages` & `sessions`.
- Fungsi SQL baru wajib `revoke execute ... from public, anon`. Tabel baru wajib `revoke` hak tulis yang tidak dibutuhkan — tabel baru **lahir dengan INSERT+UPDATE untuk `authenticated`** (default privileges hari ini hanya mencabut ALL untuk `anon`, serta TRUNCATE & DELETE untuk `authenticated`).
- **Migration lama tidak boleh disunting.** Buat berkas baru bercap waktu manual.
- Waktu: `hariIniJakarta()` dari `@/lib/passport/waktu`; dilarang `toISOString`/`setDate`/`getDay` untuk logika tanggal. Vitest berjalan `TZ=UTC`.
- Data uji wajib berprefiks + dibersihkan `afterAll`, **termasuk baris `jejak_status_bayar`** — tabel itu sengaja tanpa FK sehingga tidak ikut tersapu cascade.
- Palet & font seperti plan sebelumnya. Akun demo: `owner@`/`admin@`/`ananda@padma.test`, password `padma-dev-123`.

## Keadaan Transisi Pembayaran Hari Ini (diuji, bukan dibaca dari policy)

Policy `"sessions: staf"` adalah `FOR ALL` — dibaca sekilas seolah admin bebas. Yang membatasi sebenarnya hanya **trigger**, dan hanya untuk dua kelas:

| Transisi | Keadaan hari ini |
|---|---|
| `lunas → apa pun` (peran API) | **DITOLAK** 42501 oleh `guard_transisi_status_bayar` |
| INSERT dengan status ≠ `belum` (peran API) | **DITOLAK** 42501 oleh `guard_insert_status_bayar` |
| `belum → lunas` | **LOLOS** — dan memang dibutuhkan (klien transfer & lapor langsung) |
| `belum → menunggu_verifikasi` | LOLOS |
| `menunggu_verifikasi → lunas` | LOLOS |
| `menunggu_verifikasi → belum` | LOLOS (dipakai "tolak klaim") |

Artinya **6 dari 9 kombinasi tidak dijaga database** — penegakannya harus dua lapis di aplikasi: daftar putih di `status.ts` **dan** `WHERE status_bayar IN (...)` di UPDATE.

## Tiga Cacat yang Ditutup Plan Ini (terverifikasi hidup)

1. **Lubang warisan Plan 4** — RPC/klaim tidak menyaring `client_package_id`, sehingga klien bisa mengklaim sesi yang sudah tercakup paket.
2. **Badge tidak sinkron dengan daftar** — `hitungAntrean.klaimMenunggu` menghitung tanpa saringan paket/batal. Klien mengklaim sesi berpaket → badge 0→1 sementara daftar yang benar tetap 0. **Badge yang tidak bisa dibersihkan.**
3. **`app_settings` menembus money firewall secara struktural** — firewall memindai nama kolom, uang bisa hidup sebagai baris. Terbukti: admin menyimpan `{key:"uji", value:"425000"}` berhasil, nol test merah.

## Urutan yang Mengikat

**Task 1 (perbaiki klaim + badge) WAJIB sebelum Task 2 (constraint).** CHECK constraint berlaku juga untuk `SECURITY DEFINER`; bila constraint dipasang lebih dulu, RPC klaim melempar `23514` → PostgREST 400 → pengguna melihat "Gagal memproses" padahal keadaan sebenarnya "item ini tidak bisa diklaim".

---

### Task 1: Tutup lubang klaim & sinkronkan badge antrean

**Files:**
- Create: `web/supabase/migrations/20260830100000_klaim_hanya_sesi_lepas.sql`, `web/tests/klaim-sesi-lepas.test.ts`
- Modify: `web/src/lib/admin/antrean.ts`

- [ ] **Step 1: Test dulu (MERAH)**

Buat `web/tests/klaim-sesi-lepas.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();
const KLIEN = "44444444-4444-4444-4444-444444444401";      // Ananda
const PAKET = "55555555-5555-5555-5555-555555555501";
const SESI_PAKET = "66666666-6666-6666-6666-6666666666b1";
const SESI_LEPAS = "66666666-6666-6666-6666-6666666666b2";

async function bersihkan() {
  await admin.from("jejak_status_bayar").delete().in("sesi_id", [SESI_PAKET, SESI_LEPAS]);
  await admin.from("sessions").delete().in("id", [SESI_PAKET, SESI_LEPAS]);
}

beforeEach(async () => {
  await bersihkan();
  await admin.from("sessions").insert([
    {
      id: SESI_PAKET, client_id: KLIEN, client_package_id: PAKET,
      service_id: "11111111-1111-1111-1111-111111111101",
      partner_id: "33333333-3333-3333-3333-333333333301",
      tanggal: "2026-12-20", status: "terjadwal",
      status_bayar: "belum", catatan: "", rekomendasi: "",
    },
    {
      id: SESI_LEPAS, client_id: KLIEN, client_package_id: null,
      service_id: "11111111-1111-1111-1111-111111111103",
      partner_id: "33333333-3333-3333-3333-333333333302",
      tanggal: "2026-12-21", status: "terjadwal",
      status_bayar: "belum", catatan: "", rekomendasi: "",
    },
  ]);
});
afterAll(bersihkan);

describe("klaim pembayaran hanya untuk sesi lepas", () => {
  it("klien TIDAK bisa mengklaim sesi yang sudah tercakup paket", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.rpc("klaim_sudah_bayar", {
      jenis: "sesi", sasaran_id: SESI_PAKET,
    });
    expect(data ?? []).toHaveLength(0);   // tidak ada baris yang diklaim

    const { data: cek } = await admin.from("sessions")
      .select("status_bayar").eq("id", SESI_PAKET).single();
    expect(cek!.status_bayar).toBe("belum");
  });

  it("klien BISA mengklaim sesi lepas (alur sah tidak rusak)", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.rpc("klaim_sudah_bayar", {
      jenis: "sesi", sasaran_id: SESI_LEPAS,
    });
    expect(data ?? []).toHaveLength(1);

    const { data: cek } = await admin.from("sessions")
      .select("status_bayar").eq("id", SESI_LEPAS).single();
    expect(cek!.status_bayar).toBe("menunggu_verifikasi");
  });

  it("klien BISA mengklaim paket", async () => {
    await admin.from("client_packages").update({ status_bayar: "belum" }).eq("id", PAKET);
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.rpc("klaim_sudah_bayar", { jenis: "paket", sasaran_id: PAKET });
    expect(data ?? []).toHaveLength(1);
    await admin.from("client_packages").update({ status_bayar: "lunas" }).eq("id", PAKET);
    await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET);
  });
});

describe("badge antrean sinkron dengan daftar", () => {
  it("mengklaim sesi berpaket TIDAK menaikkan badge klaimMenunggu", async () => {
    const { hitungKlaimMenunggu } = await import("@/lib/admin/antrean");
    const sebelum = await hitungKlaimMenunggu();

    // Paksa keadaan lewat service role (menembus RPC) untuk meniru data lama
    // yang terlanjur ada sebelum perbaikan.
    await admin.from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" }).eq("id", SESI_PAKET);

    const sesudah = await hitungKlaimMenunggu();
    expect(sesudah).toBe(sebelum);   // sesi berpaket bukan tagihan
  });

  it("mengklaim sesi lepas menaikkan badge tepat satu", async () => {
    const { hitungKlaimMenunggu } = await import("@/lib/admin/antrean");
    const sebelum = await hitungKlaimMenunggu();
    await admin.from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" }).eq("id", SESI_LEPAS);
    expect(await hitungKlaimMenunggu()).toBe(sebelum + 1);
  });

  it("sesi BATAL tidak pernah masuk hitungan", async () => {
    const { hitungKlaimMenunggu } = await import("@/lib/admin/antrean");
    const sebelum = await hitungKlaimMenunggu();
    await admin.from("sessions")
      .update({ status: "batal", status_bayar: "menunggu_verifikasi" }).eq("id", SESI_LEPAS);
    expect(await hitungKlaimMenunggu()).toBe(sebelum);
  });
});
```

**Catatan:** `hitungKlaimMenunggu` mungkin belum ada sebagai fungsi terpisah — bila `hitungAntrean()` sekarang menghitungnya inline, pecah menjadi fungsi terekspor agar bisa diuji sendiri, dan biarkan `hitungAntrean()` memanggilnya.

Run: `npm test -- tests/klaim-sesi-lepas.test.ts` → MERAH.

- [ ] **Step 2: Perbaiki RPC klaim**

Buat `web/supabase/migrations/20260830100000_klaim_hanya_sesi_lepas.sql`:
```sql
-- ============================================================================
-- KLAIM PEMBAYARAN HANYA UNTUK SESI LEPAS
-- ============================================================================
-- Spec bagian 5: "status_bayar hanya relevan untuk sesi lepas; sesi dalam
-- paket mengikuti status paketnya." RPC klaim warisan Plan 4 hanya menyaring
-- client_id dan status_bayar='belum' — TIDAK menyaring client_package_id.
-- Akibatnya klien bisa mengklaim sesi yang sudah tercakup paket lunas, dan
-- antrean verifikasi admin dipenuhi "tagihan hantu".
--
-- Cap waktu ditulis manual: `supabase migration new` memakai jam dinding dan
-- sudah pernah menyelipkan migration ke tengah riwayat sehingga db reset gagal.

create or replace function public.klaim_sudah_bayar(jenis text, sasaran_id uuid)
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare
  klien_id uuid;
begin
  -- Kepemilikan diambil dari JWT, tidak pernah dari parameter.
  select c.id into klien_id from public.clients c where c.user_id = auth.uid();
  if klien_id is null then
    return;
  end if;

  if jenis = 'paket' then
    return query
      update public.client_packages
         set status_bayar = 'menunggu_verifikasi'
       where id = sasaran_id
         and client_id = klien_id
         and status_bayar = 'belum'
      returning id;
  elsif jenis = 'sesi' then
    return query
      update public.sessions
         set status_bayar = 'menunggu_verifikasi'
       where id = sasaran_id
         and client_id = klien_id
         and status_bayar = 'belum'
         and client_package_id is null   -- <-- perbaikan: sesi berpaket bukan tagihan
         and status <> 'batal'
      returning id;
  end if;
  return;
end;
$$;

revoke execute on function public.klaim_sudah_bayar(text, uuid) from public, anon;
grant execute on function public.klaim_sudah_bayar(text, uuid) to authenticated;
```

**Periksa dulu** tanda tangan RPC yang benar-benar ada di migration Plan 3A (`tutup_celah_red_team`) — bila nama parameternya berbeda, ikuti yang ada, karena `src/lib/passport/aksi.ts` sudah memanggilnya dan nama argumen RPC bersifat mengikat (salah nama → 404 PGRST202).

- [ ] **Step 3: Sinkronkan badge**

Di `web/src/lib/admin/antrean.ts`, pecah dan perbaiki hitungan klaim:
```ts
// Filter WAJIB identik dengan susunTagihan() di @/lib/passport/turunan —
// bila berbeda, badge menghitung sesuatu yang tidak pernah muncul di daftar
// dan tidak akan pernah bisa dibersihkan admin.
export async function hitungKlaimMenunggu(): Promise<number> {
  const supabase = await createServerSupabase();
  const [{ count: sesi }, { count: paket }] = await Promise.all([
    supabase.from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("status_bayar", "menunggu_verifikasi")
      .is("client_package_id", null)     // hanya sesi lepas
      .neq("status", "batal"),
    supabase.from("client_packages")
      .select("*", { count: "exact", head: true })
      .eq("status_bayar", "menunggu_verifikasi")
      .eq("status", "aktif"),
  ]);
  return (sesi ?? 0) + (paket ?? 0);
}
```
Lalu `hitungAntrean()` memanggilnya, bukan menghitung sendiri.

- [ ] **Step 4: Verifikasi & commit**

Run: `npx supabase db reset && npm test` → seluruh suite PASS.

```bash
git add web && git commit -m "fix(plan3b): klaim pembayaran hanya untuk sesi lepas + badge antrean sinkron dengan daftar"
```

---

### Task 2: Constraint struktural sesi berpaket

**Files:**
- Create: `web/supabase/migrations/20260830110000_sesi_paket_tanpa_status_bayar.sql`
- Modify: `web/tests/klaim-sesi-lepas.test.ts` (tambah test constraint)

- [ ] **Step 1: Periksa data memenuhi**

```bash
docker exec -i supabase_db_web psql -U postgres -d postgres -c "
select count(*) as pelanggar from sessions
where client_package_id is not null and status_bayar <> 'belum';"
```
Expected: `0`. Bila > 0, **perbaiki datanya di migration** (set ke `belum`) sebelum memasang constraint — jangan melonggarkan constraint.

- [ ] **Step 2: Migration**

```sql
-- Menghapus kontradiksi di akarnya, bukan menyembunyikannya di query.
-- Data seed sudah memenuhi (semua sesi berpaket berstatus 'belum'), jadi
-- migration ini hijau tanpa perbaikan data.
--
-- URUTAN PENTING: constraint ini berlaku juga untuk SECURITY DEFINER, jadi ia
-- HARUS dipasang SESUDAH RPC klaim diperbaiki (migration 20260830100000).
-- Bila dibalik, RPC melempar 23514 -> PostgREST 400 -> pengguna melihat
-- "Gagal memproses" padahal keadaannya "item ini memang tidak bisa diklaim".

update public.sessions
   set status_bayar = 'belum'
 where client_package_id is not null and status_bayar <> 'belum';

alter table public.sessions
  add constraint sessions_bayar_hanya_lepas
  check (client_package_id is null or status_bayar = 'belum');
```

- [ ] **Step 3: Test tambahan**

Tambahkan ke `tests/klaim-sesi-lepas.test.ts`:
```ts
describe("constraint sesi berpaket", () => {
  it("service role sekalipun tidak bisa menyetel status_bayar pada sesi berpaket", async () => {
    const { error } = await admin.from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" }).eq("id", SESI_PAKET);
    expect(error?.code).toBe("23514");   // pelanggaran CHECK
  });

  it("memindahkan sesi lepas berstatus bayar ke dalam paket ditolak", async () => {
    await admin.from("sessions")
      .update({ status_bayar: "lunas" }).eq("id", SESI_LEPAS);
    const { error } = await admin.from("sessions")
      .update({ client_package_id: PAKET }).eq("id", SESI_LEPAS);
    expect(error?.code).toBe("23514");
  });
});
```

**Perhatikan:** test di Task 1 yang memakai service role untuk memaksa `SESI_PAKET` menjadi `menunggu_verifikasi` akan **gagal** setelah constraint ini. Itu benar — ubah test badge tersebut agar memakai jalur lain untuk membuktikan invariannya (mis. menghitung dari data yang sudah ada), atau nyatakan bahwa keadaan itu kini mustahil dan test-nya digantikan test constraint di atas. **Jangan** menghapus constraint demi menyelamatkan test.

- [ ] **Step 4: Verifikasi & commit**

```bash
npx supabase db reset && npm test && npm run build
git add web && git commit -m "feat(plan3b): constraint sesi berpaket tidak memikul status pembayaran"
```

---

### Task 3: Modul verifikasi pembayaran

**Files:**
- Create: `web/src/app/admin/bayar/page.tsx`, `web/src/app/admin/bayar/status.ts`, `web/src/app/admin/bayar/aksi.ts`, `web/src/app/admin/bayar/tabel-bayar.tsx`, `web/src/lib/admin/tagihan.ts`, `web/tests/admin-bayar.test.ts`
- Modify: `web/src/app/admin/_shell/nav-admin.tsx`, `web/src/app/admin/page.tsx`, `web/tests/admin-shell.test.ts`

**Interfaces:**
- Produces: `daftarTagihanAdmin()`, server action `tandaiLunas(jenis, id)`, `tolakKlaim(jenis, id)`.

- [ ] **Step 1: Daftar putih transisi**

Buat `web/src/app/admin/bayar/status.ts`:
```ts
import type { PayStatus } from "@/lib/passport/turunan";

export const LABEL_BAYAR: Record<PayStatus, string> = {
  belum: "Belum dibayar",
  menunggu_verifikasi: "Menunggu verifikasi",
  lunas: "Lunas",
};

// Lapis pertama penegakan. Lapis kedua ada di klausa WHERE tiap action.
// `lunas -> apa pun` sengaja TIDAK ada: membalik status sesudah rekap pekan
// berjalan adalah rekonsiliasi, bukan toggle. DB pun menolaknya (42501).
export const ASAL_SAH_LUNAS: PayStatus[] = ["belum", "menunggu_verifikasi"];
export const ASAL_SAH_TOLAK: PayStatus[] = ["menunggu_verifikasi"];
```

- [ ] **Step 2: Lapisan data**

Buat `web/src/lib/admin/tagihan.ts`. Filternya **wajib identik** dengan `susunTagihan()` di `@/lib/passport/turunan` — baca berkas itu dulu:
```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { PayStatus } from "@/lib/passport/turunan";

export type ItemTagihanAdmin = {
  jenis: "paket" | "sesi";
  id: string;
  namaKlien: string;
  padmaId: string;
  label: string;
  status: PayStatus;
};

// Filter naif (`status_bayar <> 'lunas'`) mengembalikan 8 baris pada data
// seed, 7 di antaranya sesi berpaket milik paket yang SUDAH lunas — dan
// karena `belum -> lunas` diizinkan DB, admin bisa benar-benar "melunasi"
// tujuh hantu dan menulis tujuh baris jejak palsu.
export async function daftarTagihanAdmin(): Promise<ItemTagihanAdmin[]> {
  const supabase = await createServerSupabase();
  const [{ data: paket }, { data: sesi }] = await Promise.all([
    supabase.from("client_packages")
      .select("id, status_bayar, clients(nama, padma_id), packages(nama, jumlah_sesi)")
      .eq("status", "aktif"),
    supabase.from("sessions")
      .select("id, status_bayar, tanggal, clients(nama, padma_id), services(nama)")
      .is("client_package_id", null)
      .neq("status", "batal"),
  ]);

  const item: ItemTagihanAdmin[] = [];
  for (const p of paket ?? []) {
    const k = p.clients as unknown as { nama: string; padma_id: string } | null;
    const pk = p.packages as unknown as { nama: string; jumlah_sesi: number } | null;
    item.push({
      jenis: "paket", id: p.id,
      namaKlien: k?.nama ?? "—", padmaId: k?.padma_id ?? "—",
      label: `${pk?.nama ?? "Paket"} · ${pk?.jumlah_sesi ?? 0} sesi`,
      status: p.status_bayar,
    });
  }
  for (const s of sesi ?? []) {
    const k = s.clients as unknown as { nama: string; padma_id: string } | null;
    const sv = s.services as unknown as { nama: string } | null;
    item.push({
      jenis: "sesi", id: s.id,
      namaKlien: k?.nama ?? "—", padmaId: k?.padma_id ?? "—",
      label: `${sv?.nama ?? "Layanan"} · ${s.tanggal}`,
      status: s.status_bayar,
    });
  }
  // Yang menunggu verifikasi naik ke atas — itulah pekerjaan admin hari ini.
  const urut: Record<PayStatus, number> = { menunggu_verifikasi: 0, belum: 1, lunas: 2 };
  return item.sort((a, b) => urut[a.status] - urut[b.status]);
}
```

- [ ] **Step 3: Server action**

Buat `web/src/app/admin/bayar/aksi.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ASAL_SAH_LUNAS, ASAL_SAH_TOLAK } from "./status";

// Keadaan tujuan TIDAK PERNAH menjadi parameter — dua action terpisah dengan
// nilai hardcoded. Prototipe memakai <select onchange> yang mengirim status
// dari browser; itu bentuk celah yang sudah pernah tembus di proyek ini.
async function ubahStatus(
  jenis: "paket" | "sesi",
  id: string,
  tujuan: "lunas" | "belum",
  asalSah: readonly string[],
) {
  await requireRole(["admin", "owner"]);
  // Sesi pengguna, bukan service role: jejak audit harus merekam SIAPA yang
  // memutuskan. Di bawah service role aktor tercatat NULL/'service_role'.
  const supabase = await createServerSupabase();
  const tabel = jenis === "paket" ? "client_packages" : "sessions";

  const { data, error } = await supabase
    .from(tabel)
    .update({ status_bayar: tujuan })
    .eq("id", id)
    .in("status_bayar", asalSah)      // lapis kedua penegakan
    .select("id");

  if (error) return { ok: false as const, pesan: "Gagal memperbarui status." };
  // UPDATE tertahan dijawab 200 + [] — jangan melaporkan sukses tanpa memeriksa.
  if ((data ?? []).length === 0) {
    return { ok: false as const, pesan: "Status item sudah berubah. Muat ulang halaman." };
  }
  revalidatePath("/admin/bayar");
  revalidatePath("/admin");
  revalidatePath("/passport/bayar");
  return { ok: true as const };
}

export async function tandaiLunas(jenis: "paket" | "sesi", id: string) {
  return ubahStatus(jenis, id, "lunas", ASAL_SAH_LUNAS);
}

export async function tolakKlaim(jenis: "paket" | "sesi", id: string) {
  return ubahStatus(jenis, id, "belum", ASAL_SAH_TOLAK);
}
```

- [ ] **Step 4: Halaman & tabel**

`page.tsx` server component mengikuti pola `/admin/sesi`. Tabel: Klien (+PADMA ID di `rowsub`) · Item · Status (pill) · Aksi. Tombol dirender **bersyarat**: baris `menunggu_verifikasi` mendapat "Tandai lunas" dan "Tolak klaim"; baris `belum` mendapat "Tandai lunas"; baris `lunas` tidak mendapat aksi apa pun. Sertakan `note-lock` menjelaskan alurnya, dan catatan bahwa nominal disampaikan lewat WhatsApp.

- [ ] **Step 5: Nav & dashboard**

Tambahkan entri `/admin/bayar` ke `MENU` di `nav-admin.tsx` dengan `badge: "klaimMenunggu"`, dan beri `href` pada kartu "Klaim pembayaran" di `admin/page.tsx` (sekarang sengaja tanpa href).

**JEBAKAN:** `tests/admin-shell.test.ts` punya assertion eksplisit bahwa `klaimMenunggu` **tidak** muncul sebagai badge — itu fitur test menandai modulnya belum ada, bukan bug. Perbarui ekspektasi **dan komentarnya**.

- [ ] **Step 6: Test**

Buat `web/tests/admin-bayar.test.ts` yang membuktikan: daftar tidak memuat sesi berpaket maupun sesi batal; `tandaiLunas` dari `menunggu_verifikasi` dan dari `belum` berhasil; `tandaiLunas` pada baris `lunas` ditolak tanpa mengubah apa pun; `tolakKlaim` hanya dari `menunggu_verifikasi`; jejak audit mencatat `peran_aktor: "admin"` dengan `aktor_id` benar (bukan `service_role`); badge dan daftar konsisten. Bersihkan `jejak_status_bayar` di `afterAll`.

- [ ] **Step 7: Verifikasi & commit**

```bash
npm test && npm run build
git add web && git commit -m "feat(plan3b): modul verifikasi pembayaran admin"
```

---

### Task 4: Daftar putih kunci pengaturan

**Files:**
- Create: `web/supabase/migrations/20260830120000_registri_kunci_pengaturan.sql`, `web/tests/pengaturan-kunci.test.ts`
- Modify: `web/tests/hak-hapus-berlebih.test.ts`

**Konteks:** `app_settings` menembus money firewall secara struktural — firewall memindai nama **kolom**, uang bisa hidup sebagai **baris**. Terbukti live.

- [ ] **Step 1: Migration**

```sql
-- ============================================================================
-- REGISTRI KUNCI PENGATURAN
-- ============================================================================
-- Money firewall memindai nama KOLOM; app_settings (key text, value text)
-- membuat uang bisa hidup sebagai BARIS. Terbukti: admin menyimpan
-- {key:"uji", value:"425000"} berhasil, nol test merah.
-- Registri menutupnya: hanya kunci terdaftar yang boleh ada.

create table public.app_setting_keys (
  key text primary key,
  keterangan text not null,
  bentuk text not null check (bentuk in ('nomor_wa', 'teks_polos'))
);

-- Baris registri lahir DI SINI, bukan di seed.sql — seed berjalan SESUDAH
-- migration, dan seed sudah menyisipkan nomor_wa. Bila kuncinya belum
-- terdaftar saat migration selesai, `db reset` gagal di baris seed itu.
insert into public.app_setting_keys (key, keterangan, bentuk) values
  ('nomor_wa', 'Nomor WhatsApp resmi PADMA (format internasional tanpa +)', 'nomor_wa'),
  ('alamat_klinik', 'Alamat/area layanan yang ditampilkan di footer', 'teks_polos'),
  ('jam_operasional', 'Jam operasional yang ditampilkan ke pengunjung', 'teks_polos');

-- Bersihkan kunci liar SEBELUM memasang FK. Tanpa baris ini, satu kunci sisa
-- percobaan di DB dev membuat `add constraint` gagal.
delete from public.app_settings
 where key not in (select key from public.app_setting_keys);

alter table public.app_settings
  add constraint app_settings_key_terdaftar
  foreign key (key) references public.app_setting_keys(key);

-- Tabel baru LAHIR dengan INSERT+UPDATE untuk `authenticated` (default
-- privileges hari ini hanya mencabut ALL untuk anon, TRUNCATE & DELETE untuk
-- authenticated). Tanpa pencabutan ini admin bisa mendaftarkan kunci uangnya
-- sendiri dan seluruh daftar putih menjadi hiasan.
alter table public.app_setting_keys enable row level security;
revoke all on public.app_setting_keys from anon;
revoke insert, update, delete on public.app_setting_keys from authenticated;
grant select on public.app_setting_keys to authenticated;

create policy "registri kunci: staf baca" on public.app_setting_keys
  for select to authenticated using (user_role() in ('admin','owner'));
```

- [ ] **Step 2: Perbaiki dua test yang akan merah**

`tests/hak-hapus-berlebih.test.ts` memakai kunci karangan (`PAD-UJI-kunci` lewat service role, `PAD-UJI-tulis` lewat admin). FK dan trigger berlaku untuk **semua** peran — service role tidak dikecualikan. Ubah keduanya memakai kunci terdaftar `nomor_wa`, dan **jangan menghapus barisnya** di `finally` (baris itu berasal dari seed dan dibutuhkan seluruh aplikasi) — kembalikan nilainya saja.

- [ ] **Step 3: Test registri**

Buat `tests/pengaturan-kunci.test.ts`: kunci tidak terdaftar ditolak (23503) baik oleh admin maupun service role; kunci terdaftar diterima; admin tidak bisa menambah baris ke `app_setting_keys` (42501); anon tidak bisa membaca registri maupun `app_settings`.

- [ ] **Step 4: Verifikasi & commit**

```bash
npx supabase db reset && npm test && npm run build
git add web && git commit -m "feat(plan3b): registri kunci pengaturan menutup celah money firewall lewat baris"
```

---

### Task 5: Modul pengaturan

**Files:**
- Create: `web/src/app/admin/pengaturan/page.tsx`, `web/src/app/admin/pengaturan/aksi.ts`, `web/src/app/admin/pengaturan/form-pengaturan.tsx`, `web/tests/admin-pengaturan.test.ts`
- Modify: `web/src/lib/settings.ts`, `web/src/app/admin/_shell/nav-admin.tsx`

- [ ] **Step 1: Validasi per-bentuk & propagasi**

Server action memvalidasi menurut kolom `bentuk` di registri: `nomor_wa` hanya digit (8–15 setelah normalisasi), `teks_polos` menolak `<`, `>`, dan skema URL (`javascript:`, `data:`). Nilai `app_settings` mendarat di `href`/`src`/`window.open`; hari ini yang menyelamatkan hanya `.replace(/\D/g,"")` di `settings.ts`, dan kunci baru tidak lewat sanitasi itu.

**Perbaiki juga `settings.ts`:** fallback `?? "6287778400200"` hanya menyala bila barisnya hilang — sedangkan nilai `""` atau `"abc"` menghasilkan `nomorWaLink === ""` dan href `https://wa.me/` yang rusak **tanpa error**. Tambahkan penjagaan nilai, bukan hanya penjagaan keberadaan baris.

- [ ] **Step 2: Propagasi wajib**

```ts
revalidatePath("/");
revalidatePath("/skrining");   // WAJIB — halaman ini statis penuh
revalidatePath("/passport/bayar");
revalidatePath("/admin/pengaturan");
```

**Bukti mengapa `/skrining` wajib:** nomor WA-nya dipanggang saat build — `nomorWaLink":"6287778400200"` benar-benar ada di `.next/server/app/skrining.rsc`. Tanpa baris itu, wizard skrining (kanal konversi utama) tetap memakai nomor lama sampai deploy berikutnya.

- [ ] **Step 3: Halaman, test, commit**

Kartu per kunci: label dari `keterangan`, medan input, tombol simpan. Test: perubahan nomor WA terbaca `bacaPengaturan()`; nilai tidak sah ditolak dengan pesan ramah; kunci tak terdaftar tidak bisa disimpan; klien & anon tidak bisa menulis.

```bash
npm test && npm run build
git add web && git commit -m "feat(plan3b): modul pengaturan dengan validasi per-bentuk & propagasi ke seluruh kanal"
```

---

### Task 6: Modul layanan & paket

**Files:**
- Create: `web/src/app/admin/layanan/page.tsx`, `web/src/app/admin/layanan/aksi.ts`, `web/src/app/admin/layanan/form-layanan.tsx`, `web/src/lib/admin/katalog-admin.ts`, `web/tests/admin-layanan.test.ts`
- Modify: `web/src/app/admin/_shell/nav-admin.tsx`

**Pagar yang sudah terverifikasi — jangan dilanggar:**
- **DELETE tidak tersedia** pada `services`/`packages`/`phases` (403 42501, bukan "0 baris"). **Jangan membuat tombol Hapus.** Penonaktifan diwakili `aktif = false`.
- Menonaktifkan layanan **tidak** menghilangkan namanya dari riwayat sesi klien, karena policy `"services: baca"` untuk `authenticated` tidak menyebut `aktif` (filter `aktif` hidup di policy terpisah `TO anon`). **JANGAN** menambahkan `aktif` ke policy itu, dan **JANGAN** membuat view `layanan_publik` yang menyaring `aktif` — itu akan mengulangi persis bug `partner_publik` yang sudah dibayar mahal.
- Mengubah `packages.jumlah_sesi` mempengaruhi progres passport klien yang sedang berjalan; kalkulasi turunan sudah punya cap 100%. Uji dan tampilkan peringatan di form.

- [ ] **Step 1–4: Test, lapisan data, halaman, commit**

Daftar layanan dikelompokkan per fase (seperti prototipe `vLayanan`), dengan paket di bawah layanannya. Form tambah/edit layanan & paket, tombol aktif/nonaktif. Test membuktikan pagar di atas, termasuk: riwayat sesi klien **tetap** menampilkan nama layanan setelah layanan dinonaktifkan.

```bash
npm test && npm run build
git add web && git commit -m "feat(plan3b): modul layanan & paket"
```

---

### Task 7: Modul materi

**Files:**
- Create: `web/src/app/admin/materi/page.tsx`, `web/src/app/admin/materi/aksi.ts`, `web/src/app/admin/materi/form-materi.tsx`, `web/tests/admin-materi.test.ts`
- Create: `web/supabase/migrations/20260830130000_gating_materi_hormati_aktif.sql`
- Modify: `web/src/app/admin/_shell/nav-admin.tsx`

**Empat pagar terverifikasi:**

1. **Materi setengah jadi terkunci permanen.** Materi `video` tanpa baris `material_videos` (atau `ebook` tanpa bab) terkunci selamanya untuk semua klien yang berhak, tanpa error, dan kartunya berbohong ("Terbuka setelah layanan terkait selesai" padahal layanannya sudah selesai). Hal yang sama terjadi bila `tipe` diubah `ebook`→`video`. **Form wajib menyimpan metadata + isi dalam satu aksi**, dan mengubah tipe wajib disertai isinya.
2. **Policy chapters/videos tidak mengevaluasi `materials.aktif`** — terbukti: setelah admin menonaktifkan materi, klien tetap membaca 3 bab lengkap dan URL video lewat PostgREST. Plan ini melahirkan tombol "Nonaktifkan materi", jadi policy-nya **harus** diperbaiki di sini, kalau tidak tombol itu berbohong sejak hari pertama.
3. **Penghapusan isi hanya lewat RPC berparameter tunggal** — `hapus_bab_materi({bab_id})` dan `lepas_video_materi({materi_id})`. Nama argumen **mengikat** (salah nama → 404 PGRST202, bukan 400), dan `data === null` adalah **sukses** ("tidak ada yang cocok"), bukan kegagalan.
4. **`material_videos` di embed adalah OBJEK atau `null`, bukan array.** `video.length === 0` selalu salah dan membuat setiap materi video tampak terkunci.

- [ ] **Step 1: Migration gating menghormati `aktif`**

```sql
-- Tombol "Nonaktifkan materi" lahir di plan ini. Tanpa perbaikan ini ia hanya
-- menyembunyikan kartu di UI sementara bab & URL video tetap terbaca klien
-- lewat PostgREST langsung — terbukti dengan pengujian.
drop policy if exists "chapters: klien dgn sesi selesai" on public.material_chapters;
create policy "chapters: klien dgn sesi selesai" on public.material_chapters
  for select using (exists (
    select 1
      from materials m
      join sessions s on s.service_id = m.service_id and s.status = 'selesai'
      join clients c on c.id = s.client_id
     where m.id = material_id
       and m.aktif = true          -- <-- perbaikan
       and c.user_id = auth.uid()
  ));
```
Lakukan hal setara untuk policy `material_videos`. **Baca policy yang benar-benar ada** lewat `pg_policies` sebelum menulis — nama dan isinya harus cocok.

- [ ] **Step 2–5: Test, form satu-aksi, halaman, commit**

Test wajib: materi baru bertipe ebook **tidak bisa** disimpan tanpa minimal satu bab; bertipe video tidak bisa tanpa URL; URL di luar allowlist host ditolak dengan pesan ramah (bukan error Postgres mentah); menonaktifkan materi membuat klien **tidak lagi** bisa membaca babnya lewat REST; RPC penghapusan bab menghapus tepat satu baris.

```bash
npm test && npm run build
git add web && git commit -m "feat(plan3b): modul materi + gating menghormati status aktif"
```

---

### Task 8: E2E & verifikasi akhir

**Files:**
- Create: `web/tests/e2e/admin-pelengkap.e2e.ts`
- Modify: `web/package.json`, `web/README.md`

- [ ] **Step 1: E2E rantai uang & konten**

Skrip `tsx` + Playwright mengikuti pola `tests/e2e/admin-operasional.e2e.ts`. Rantai yang dibuktikan:

1. Login klien → `/passport/bayar` → klaim sesi lepas → status jadi "Menunggu verifikasi".
2. Login admin → `/admin` → badge klaim pembayaran menunjukkan angkanya → klik ke `/admin/bayar`.
3. Item itu ada di daftar; **sesi berpaket tidak ada** (tidak ada tagihan hantu).
4. Klik "Tandai lunas" → status berubah; jejak audit mencatat `peran_aktor: "admin"` (verifikasi lewat service role).
5. Login klien → `/passport/bayar` → status terlihat "Lunas".
6. Admin → `/admin/pengaturan` → ubah nomor WA → buka `/skrining` sebagai tamu → tautan WhatsApp memakai nomor baru.
7. Admin → `/admin/materi` → nonaktifkan satu materi → klien tidak lagi melihatnya, **dan** tidak bisa membaca babnya lewat REST.
8. Bersihkan seluruh data uji (termasuk `jejak_status_bayar`) dan kembalikan nomor WA.

- [ ] **Step 2–4: Script, verifikasi menyeluruh, README, commit**

```json
"test:e2e:pelengkap": "tsx tests/e2e/admin-pelengkap.e2e.ts",
"test:e2e:semua": "npm run test:e2e && npm run test:e2e:funnel && npm run test:e2e:passport && npm run test:e2e:admin && npm run test:e2e:pelengkap"
```

```bash
npx supabase db reset && npm run seed:users && npm test && npm run build
npm run dev &   # tunggu Ready
npm run test:e2e:semua
```

```bash
git add web && git commit -m "test(plan3b): E2E rantai uang & konten + dokumentasi rute"
```

---

## Definition of Done — Plan 3B

- [ ] Klien tidak bisa mengklaim sesi yang sudah tercakup paket; constraint DB menegakkannya.
- [ ] Badge "klaim pembayaran" selalu sama dengan jumlah baris di daftar `/admin/bayar` — tidak ada badge yang tidak bisa dibersihkan.
- [ ] Admin bisa menandai lunas (dari `belum` maupun `menunggu_verifikasi`) dan menolak klaim; `lunas` tidak bisa diputar mundur lewat UI.
- [ ] Setiap keputusan pembayaran tercatat di `jejak_status_bayar` dengan `peran_aktor: "admin"` dan `aktor_id` yang benar — **bukan** `service_role`.
- [ ] Daftar tagihan admin tidak memuat sesi berpaket maupun sesi batal.
- [ ] Kunci `app_settings` hanya bisa yang terdaftar; admin tidak bisa menambah kunci baru; nilai uang tidak bisa diselundupkan sebagai baris.
- [ ] Mengubah nomor WA merambat ke landing, **skrining**, passport, dan teks aktivasi.
- [ ] Admin bisa mengelola layanan, paket, dan materi; menonaktifkan layanan **tidak** menghilangkan namanya dari riwayat klien; menonaktifkan materi **benar-benar** menutup isinya di lapisan database.
- [ ] Tidak ada tombol Hapus pada modul yang hak DELETE-nya sudah dicabut.
- [ ] `npm test` hijau seluruhnya, kelima skrip E2E hijau, `npm run build` sukses.
