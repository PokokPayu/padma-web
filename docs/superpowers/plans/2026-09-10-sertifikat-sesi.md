# Sertifikat Kunjungan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin mengunggah sertifikat pada sesi yang sudah selesai; klien membukanya lewat badge Pencapaian yang kini berangka, dan lewat halaman Materi.

**Architecture:** Tabel `certificates` berdiri sendiri (satu baris per sesi, `session_id` unik), dengan `client_id`/`service_id` disalin oleh trigger dari baris sesinya. Berkasnya tinggal di bucket privat `sertifikat` yang tanpa satu pun policy `storage.objects`, jadi satu-satunya pintu byte adalah route handler kita. Unggahan admin memakai signed upload URL langsung ke Storage — persis pola e-book — karena Vercel membatasi body request 4,5 MB.

**Tech Stack:** Next.js (App Router, server actions), Supabase (Postgres + RLS + Storage), TypeScript, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-sertifikat-sesi-design.md`

## Global Constraints

- Semua nama berkas, tabel, kolom, variabel, dan teks antarmuka berbahasa **Indonesia**, mengikuti repo.
- Rute di bawah `src/app/passport/**` **dilarang** mengekspor pengaturan revalidasi Next.js — dijaga `tests/passport-shell.test.ts` yang memindai sumber apa adanya. Yang boleh (dan dipakai halaman baru): `export const dynamic = "force-dynamic";`
- Prop bernilai **fungsi** tidak boleh menyeberang dari komponen server ke komponen klien — dijaga `tests/pagar-batas-server-klien.test.ts`.
- **Jangan** menjalankan `supabase db push`. Migrasi diuji lewat `npx supabase db reset` di lingkungan lokal.
- Basis data lokal **dipakai bersama sesi lain**. Sebelum `db reset` atau `npm test` penuh, koordinasikan dengan pemilik repo.
- Format berkas sertifikat: `application/pdf`, `image/jpeg`, `image/webp`. Batas 5 MB (`5242880` byte).
- Uji baru **hanya** untuk hak baca (Task 1 dan Task 5). Sisanya diverifikasi manual — mode cepat yang berlaku di sesi ini.
- Setiap commit diakhiri baris `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Struktur berkas

| Berkas | Tanggung jawab |
|---|---|
| `web/supabase/migrations/20260915100000_sertifikat_sesi.sql` | Tabel, trigger penyalin, RLS, bucket |
| `web/src/lib/sertifikat/berkas.ts` | Aturan berkas murni (MIME sah, batas ukuran, nama objek) — bisa diuji tanpa DB |
| `web/src/app/admin/sesi/[id]/unggah-sertifikat.ts` | Dua server action: terbitkan URL unggah, catat baris |
| `web/src/app/admin/sesi/[id]/pengunggah-sertifikat.tsx` | Komponen klien: pilih berkas, unggah, lapor |
| `web/src/app/admin/sesi/[id]/page.tsx` | Menyisipkan blok sertifikat untuk sesi `selesai` |
| `web/src/app/api/sertifikat/[sesi]/route.ts` | Satu-satunya pintu byte bagi klien |
| `web/src/lib/passport/data.ts` | `ambilSertifikatLayanan()` |
| `web/src/lib/passport/turunan.ts` | `badgeDari()` kini memulangkan `jumlah` |
| `web/src/app/passport/page.tsx` | Badge berangka & bisa diketuk |
| `web/src/app/passport/sertifikat/[serviceId]/page.tsx` | Halaman sertifikat klien |
| `web/src/app/passport/materi/page.tsx` | Bagian "Sertifikat" |
| `web/tests/sertifikat-hak.test.ts` | Uji RLS + rute |

---

### Task 1: Migrasi — tabel, trigger, RLS, bucket

**Files:**
- Create: `web/supabase/migrations/20260915100000_sertifikat_sesi.sql`
- Create: `web/tests/sertifikat-hak.test.ts`

**Interfaces:**
- Consumes: tabel `sessions`, `clients`, fungsi `user_role()` (sudah ada).
- Produces: tabel `public.certificates` berkolom `id, session_id, client_id, service_id, objek, mime, diunggah_oleh, created_at`; bucket `sertifikat`.

- [ ] **Step 1: Tulis migrasinya**

Buat `web/supabase/migrations/20260915100000_sertifikat_sesi.sql`:

```sql
-- ===========================================================================
-- SERTIFIKAT KUNJUNGAN
-- ===========================================================================
-- Sertifikat adalah milik SATU orang, dan itulah yang membedakannya dari
-- `materials`. Baris `materials` adalah data KATALOG: satu baris dipakai semua
-- klien, dan haknya diatur penugasan. Menempatkan sertifikat di sana berarti
-- setiap lembar menunggu satu penugasan yang benar, dan satu salah-tugas
-- membuat sertifikat klien A terbaca klien B. Di tabel ini kepemilikan adalah
-- KOLOM, bukan kebiasaan.
create table public.certificates (
  id uuid primary key default gen_random_uuid(),

  -- SATU sesi = paling banyak satu sertifikat. UNIQUE, bukan index biasa:
  -- badge klien membuka "sertifikat terbaru untuk layanan ini", dan baris
  -- kedua untuk sesi yang sama membuat "terbaru" jadi pertanyaan tanpa
  -- jawaban pasti.
  session_id uuid not null unique references public.sessions(id) on delete cascade,

  -- Pemilik & layanan: SALINAN keadaan saat sertifikat terbit, bukan rujukan
  -- hidup. Admin bisa memindahkan sesi ke layanan lain, dan lembar yang sudah
  -- dicetak atas nama satu layanan tidak boleh ikut berganti nama. Policy RLS
  -- di bawah juga membandingkan `client_id` langsung — join di dalam policy
  -- adalah biaya yang dibayar setiap baris setiap kali.
  client_id uuid not null references public.clients(id) on delete cascade,
  service_id uuid not null references public.services(id),

  -- Nama objek di bucket `sertifikat`. Ditentukan server, tidak pernah
  -- browser: browser yang memilih path adalah browser yang bisa menimpa
  -- sertifikat klien lain.
  objek text not null,
  mime text not null,

  diunggah_oleh uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.certificates is
  'Sertifikat kunjungan, satu per sesi. client_id & service_id adalah SALINAN '
  'keadaan saat terbit, bukan rujukan hidup — sesi yang dipindahkan ke layanan '
  'lain tidak boleh menyeret sertifikat yang sudah dicetak. Klien hanya bisa '
  'MEMBACA miliknya: tidak ada policy tulis untuk klien, karena sertifikat '
  'bukan sesuatu yang diterbitkan sendiri oleh penerimanya.';

create index certificates_klien_layanan_idx
  on public.certificates (client_id, service_id, created_at desc);

alter table public.certificates enable row level security;
revoke all on public.certificates from anon;

-- ===== PENJAGA ISI =====
-- Policy menjawab "baris mana"; ia tidak bisa menjawab "apakah salinannya
-- jujur". Trigger ini MENULIS ULANG client_id & service_id dari baris sesi,
-- sehingga salinannya tidak pernah bisa dikarang oleh pengirim.
create or replace function public.guard_sertifikat()
returns trigger
language plpgsql
as $$
declare
  s public.sessions%rowtype;
begin
  select * into s from public.sessions where id = new.session_id;
  if not found then
    raise exception 'sesi tidak ditemukan' using errcode = '42501';
  end if;

  -- Sertifikat kunjungan yang belum terjadi adalah pernyataan yang tidak
  -- benar. Digerbang di sini, bukan hanya di layar admin: layar bisa diubah,
  -- pagar ini tidak.
  if s.status <> 'selesai' then
    raise exception 'sertifikat hanya untuk sesi yang sudah selesai'
      using errcode = '42501';
  end if;

  new.client_id := s.client_id;
  new.service_id := s.service_id;

  return new;
end;
$$;

revoke execute on function public.guard_sertifikat() from public, anon;

create trigger trg_guard_sertifikat
  before insert or update on public.certificates
  for each row execute function public.guard_sertifikat();

-- ===== POLICY =====
-- Klien MEMBACA miliknya. Tidak ada policy insert/update/delete untuk klien:
-- yang menerbitkan sertifikat adalah tim PADMA, bukan penerimanya.
create policy "sertifikat: klien baca miliknya" on public.certificates
  for select to authenticated
  using (client_id in (select c.id from public.clients c where c.user_id = auth.uid()));

create policy "sertifikat: staf kelola" on public.certificates
  for all to authenticated
  using (user_role() in ('admin', 'owner'))
  with check (user_role() in ('admin', 'owner'));

-- ===== BUCKET =====
-- SENGAJA tanpa satu pun policy pada storage.objects — sama seperti
-- `materi-halaman` dan `bukti-bayar`. Tanpa policy, anon & authenticated tidak
-- bisa menyentuh objeknya sama sekali; hanya service role, dari route handler
-- kita, sesudah RLS memutuskan hak. Path yang bocor tetap tidak bisa ditukar
-- jadi byte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sertifikat', 'sertifikat', false, 5242880,
        array['application/pdf','image/jpeg','image/webp'])
on conflict (id) do nothing;
```

- [ ] **Step 2: Terapkan migrasi**

Koordinasikan dulu dengan pemilik repo (basis data lokal dipakai bersama), lalu:

Run: `cd web && npx supabase db reset`
Expected: selesai tanpa error, migrasi terakhir `20260915100000_sertifikat_sesi.sql` ikut jalan.

- [ ] **Step 3: Tulis uji hak baca**

Repo ini hanya punya SATU klien seed (`ananda@padma.test`), dan `signInAs()`
menerima EMAIL. Karena itu klien pembanding ditanam sendiri oleh uji ini lewat
service role — pola yang sama dipakai `tests/admin-agenda.test.ts`.

Buat `web/tests/sertifikat-hak.test.ts`:

```ts
/**
 * HAK BACA SERTIFIKAT — satu-satunya bagian fitur ini yang salahnya tidak
 * terlihat mata. Tampilan badge dan kartu materi diverifikasi manual; yang
 * diuji di sini adalah siapa boleh membaca lembar milik siapa.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Klien PEMBANDING — bukan pemilik akun mana pun. Ia tidak perlu bisa login:
// yang diuji adalah apakah ananda bisa membaca sertifikat MILIK ORANG LAIN.
const KLIEN_LAIN = "00000000-0000-0000-0000-0000000000c1";
const SESI_LAIN = "00000000-0000-0000-0000-0000000000s1".replace(/s/g, "5");

beforeAll(async () => {
  const { data: sesiSeed } = await admin
    .from("sessions")
    .select("service_id, partner_id, variant_id")
    .limit(1)
    .single();

  await admin.from("clients").upsert({
    id: KLIEN_LAIN,
    padma_id: "PAD-9909-9999",
    nama: "Klien Pembanding",
    email: "pembanding@padma.test",
    phase_id: "prekonsepsi",
  });

  await admin.from("sessions").upsert({
    id: SESI_LAIN,
    client_id: KLIEN_LAIN,
    service_id: sesiSeed!.service_id,
    variant_id: sesiSeed!.variant_id,
    partner_id: sesiSeed!.partner_id,
    tanggal: "2026-08-01",
    status: "selesai",
  });

  await admin.from("certificates").upsert(
    {
      session_id: SESI_LAIN,
      // Keduanya sengaja diisi nol-UUID: trigger `guard_sertifikat` yang
      // menulis ulang dari baris sesi. Kalau baris tersimpan tetap nol-UUID,
      // uji pertama di bawah akan gagal — dan itu memang yang kita mau.
      client_id: "00000000-0000-0000-0000-000000000000",
      service_id: "00000000-0000-0000-0000-000000000000",
      objek: `${KLIEN_LAIN}/${SESI_LAIN}.pdf`,
      mime: "application/pdf",
    },
    { onConflict: "session_id" },
  );
});

describe("sertifikat — hak baca", () => {
  it("trigger menyalin pemilik & layanan dari baris sesi, bukan dari kiriman", async () => {
    const { data } = await admin
      .from("certificates")
      .select("client_id")
      .eq("session_id", SESI_LAIN)
      .single();

    expect(data!.client_id).toBe(KLIEN_LAIN);
  });

  it("klien tidak bisa membaca sertifikat klien lain", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { data } = await ananda
      .from("certificates")
      .select("id")
      .eq("session_id", SESI_LAIN);

    expect(data ?? []).toHaveLength(0);
  });

  it("klien tidak bisa menerbitkan sertifikat untuk dirinya sendiri", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { data: milikku } = await admin
      .from("sessions")
      .select("id")
      .neq("client_id", KLIEN_LAIN)
      .eq("status", "selesai")
      .limit(1)
      .single();

    const { error } = await ananda.from("certificates").insert({
      session_id: milikku!.id,
      client_id: KLIEN_LAIN,
      service_id: KLIEN_LAIN,
      objek: "karangan/karangan.pdf",
      mime: "application/pdf",
    });

    // Tidak ada policy INSERT untuk klien — ditolak, bukan diterima diam-diam.
    expect(error).not.toBeNull();
  });
});
```

**Sebelum menulis:** buka `web/tests/admin-agenda.test.ts` dan tiru cara berkas
itu membuat klien service role (termasuk `variantBaku`/`variant_id` bila kolom
itu wajib pada `sessions` di migrasi terbaru). Konstanta `SESI_LAIN` di atas
sengaja dirakit dari string; ganti saja dengan UUID tetap yang sah bila lebih
jelas — yang penting ia tidak bentrok dengan id seed.

- [ ] **Step 4: Jalankan uji, pastikan hijau**

Run: `cd web && npx vitest run tests/sertifikat-hak.test.ts`
Expected: 3 uji PASS.

Bila uji **pertama** merah, trigger tidak menulis ulang salinannya — perbaiki
Task 1 sebelum lanjut, karena Task 3 bergantung pada perilaku itu.
Bila uji **kedua** merah (ada baris terbaca), policy `select` salah.

- [ ] **Step 5: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20260915100000_sertifikat_sesi.sql web/tests/sertifikat-hak.test.ts
git commit -m "feat(sertifikat): tabel certificates, trigger penyalin, bucket privat

Kepemilikan jadi kolom, bukan kebiasaan: client_id & service_id ditulis ulang
trigger dari baris sesi, dan session_id unik supaya 'sertifikat terbaru' selalu
punya jawaban pasti. Bucket tanpa policy — pintu byte satu-satunya adalah route
handler kita.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Aturan berkas (murni, tanpa DB)

**Files:**
- Create: `web/src/lib/sertifikat/berkas.ts`

**Interfaces:**
- Produces:
  - `MIME_SERTIFIKAT: readonly string[]`
  - `MAKS_BYTE_SERTIFIKAT: number`
  - `periksaBerkasSertifikat(nama: string, ukuran: number, mime: string): { ok: true } | { ok: false; pesan: string }`
  - `namaObjekSertifikat(clientId: string, sessionId: string, mime: string): string`

- [ ] **Step 1: Tulis berkasnya**

```ts
/**
 * Aturan berkas sertifikat — MURNI, tanpa jaringan dan tanpa basis data.
 *
 * Berdiri sendiri supaya aturan yang sama dipakai DUA sisi: komponen klien
 * memakainya untuk menolak berkas sebelum satu byte pun terkirim, dan server
 * action memakainya lagi sebelum menerbitkan URL unggah. Pemeriksaan di
 * peramban adalah kenyamanan; yang mengikat adalah pemeriksaan server, dan
 * keduanya hanya bisa sepakat kalau sumbernya satu.
 */
export const MIME_SERTIFIKAT = [
  "application/pdf",
  "image/jpeg",
  "image/webp",
] as const;

/** 5 MB — sama dengan `file_size_limit` bucket `sertifikat`. */
export const MAKS_BYTE_SERTIFIKAT = 5_242_880;

export function periksaBerkasSertifikat(
  nama: string,
  ukuran: number,
  mime: string,
): { ok: true } | { ok: false; pesan: string } {
  if (!(MIME_SERTIFIKAT as readonly string[]).includes(mime)) {
    return { ok: false, pesan: "Sertifikat harus PDF, JPEG, atau WEBP." };
  }
  if (ukuran <= 0) return { ok: false, pesan: `Berkas ${nama} kosong.` };
  if (ukuran > MAKS_BYTE_SERTIFIKAT) {
    return { ok: false, pesan: "Berkas maksimal 5 MB." };
  }
  return { ok: true };
}

/**
 * Path objek. Ditentukan SERVER — lihat komentar kolom `objek` di migrasi.
 *
 * Berakhiran tetap per MIME, bukan ekstensi dari nama berkas kiriman: nama
 * berkas datang dari peramban, dan "sertifikat.pdf.exe" adalah nama yang sah
 * menurut peramban.
 */
export function namaObjekSertifikat(
  clientId: string,
  sessionId: string,
  mime: string,
): string {
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/webp" ? "webp" : "jpg";
  return `${clientId}/${sessionId}.${ext}`;
}
```

- [ ] **Step 2: Periksa tipe**

Run: `cd web && npx tsc --noEmit`
Expected: tanpa keluaran.

- [ ] **Step 3: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/sertifikat/berkas.ts
git commit -m "feat(sertifikat): aturan berkas dipakai bersama peramban & server

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Server action unggah admin

**Files:**
- Create: `web/src/app/admin/sesi/[id]/unggah-sertifikat.ts`

**Interfaces:**
- Consumes: `periksaBerkasSertifikat`, `namaObjekSertifikat` (Task 2); `requireRole` dari `@/lib/auth/require-role`; `createServerSupabase`, `createAdminSupabase`.
- Produces:
  - `terbitkanUrlUnggahSertifikat(sessionId: string, ukuran: number, mime: string): Promise<{ ok: true; objek: string; token: string } | { ok: false; pesan: string }>`
  - `catatSertifikat(sessionId: string, objek: string, mime: string): Promise<{ ok: true } | { ok: false; pesan: string }>`

- [ ] **Step 1: Tulis berkasnya**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { namaObjekSertifikat, periksaBerkasSertifikat } from "@/lib/sertifikat/berkas";

const BUCKET = "sertifikat";

type Gagal = { ok: false; pesan: string };

/**
 * Menerbitkan signed upload URL untuk SATU berkas sertifikat.
 *
 * Berkasnya tidak menumpang server kita — Vercel membatasi body request 4,5 MB
 * — jadi peramban admin mengunggah langsung ke Storage memakai token di bawah.
 * Polanya menyalin `terbitkanUrlUnggahHalaman()` di admin/materi.
 *
 * Sesi diperiksa lewat SESI PENGGUNA supaya RLS staf yang memutuskan, bukan
 * service role. Statusnya diperiksa di sini SEKALIGUS di trigger basis data:
 * yang di sini demi kalimat galat yang enak dibaca, yang di sana demi
 * kebenaran yang tidak bergantung pada layar mana pun.
 */
export async function terbitkanUrlUnggahSertifikat(
  sessionId: string,
  ukuran: number,
  mime: string,
): Promise<{ ok: true; objek: string; token: string } | Gagal> {
  await requireRole(["admin", "owner"]);

  const periksa = periksaBerkasSertifikat("sertifikat", ukuran, mime);
  if (!periksa.ok) return periksa;

  const supabase = await createServerSupabase();
  const { data: sesi } = await supabase
    .from("sessions")
    .select("id, client_id, status")
    .eq("id", sessionId)
    .maybeSingle<{ id: string; client_id: string; status: string }>();

  if (!sesi) return { ok: false, pesan: "Sesi tidak ditemukan." };
  if (sesi.status !== "selesai") {
    return { ok: false, pesan: "Sertifikat hanya untuk sesi yang sudah selesai." };
  }

  const objek = namaObjekSertifikat(sesi.client_id, sesi.id, mime);

  // `{ upsert: true }` WAJIB: mengunggah ulang sertifikat untuk sesi yang sama
  // adalah PENGGANTIAN, dan tanpa upsert penerbitan URL untuk path yang sudah
  // terisi ditolak sejak di sini — bukan saat peramban mem-PUT.
  const admin = createAdminSupabase();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(objek, { upsert: true });

  if (error || !data) return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
  return { ok: true, objek, token: data.token };
}

/**
 * Mencatat barisnya SESUDAH byte-nya mendarat.
 *
 * `upsert` pada `session_id`: satu sesi satu sertifikat (UNIQUE di basis data),
 * dan unggahan kedua mengganti yang lama. Objek lamanya tidak perlu dihapus
 * terpisah — `namaObjekSertifikat()` menghasilkan path yang sama untuk MIME
 * yang sama, dan `upsert: true` di Storage sudah menimpanya. Yang tersisa hanya
 * kasus MIME BERGANTI (pdf → jpg), dan objek lama itu dihapus di bawah.
 */
export async function catatSertifikat(
  sessionId: string,
  objek: string,
  mime: string,
): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data: pengguna } = await supabase.auth.getUser();

  const { data: lama } = await supabase
    .from("certificates")
    .select("objek")
    .eq("session_id", sessionId)
    .maybeSingle<{ objek: string }>();

  // `client_id` & `service_id` diisi apa adanya lalu DITULIS ULANG trigger
  // dari baris sesinya. Nilai di sini hanya memenuhi NOT NULL; yang tersimpan
  // adalah salinan yang dibuat basis data.
  const { error } = await supabase.from("certificates").upsert(
    {
      session_id: sessionId,
      client_id: "00000000-0000-0000-0000-000000000000",
      service_id: "00000000-0000-0000-0000-000000000000",
      objek,
      mime,
      diunggah_oleh: pengguna.user?.id ?? null,
    },
    { onConflict: "session_id" },
  );

  if (error) return { ok: false, pesan: "Gagal menyimpan sertifikat." };

  if (lama && lama.objek !== objek) {
    const admin = createAdminSupabase();
    await admin.storage.from(BUCKET).remove([lama.objek]);
  }

  revalidatePath(`/admin/sesi/${sessionId}`);
  return { ok: true };
}
```

**Catatan penting bagi pelaksana:** placeholder UUID di atas hanya lolos bila trigger `guard_sertifikat` menulis ulang kedua kolom SEBELUM constraint FK diperiksa — dan itulah yang terjadi pada trigger `before insert or update`. Setelah Task 3 selesai, buktikan dengan satu unggahan sungguhan (Step 3) dan periksa barisnya:

```bash
cd web && npx supabase db execute --sql "select client_id, service_id from certificates limit 5;"
```

Bila kolomnya berisi nol-UUID, trigger tidak jalan — hentikan dan perbaiki Task 1 sebelum lanjut.

- [ ] **Step 2: Periksa tipe & lint**

Run: `cd web && npx tsc --noEmit && npx eslint src/app/admin/sesi`
Expected: keduanya tanpa error.

- [ ] **Step 3: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add "web/src/app/admin/sesi/[id]/unggah-sertifikat.ts"
git commit -m "feat(sertifikat): server action unggah & catat, jalur staf

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pengunggah di halaman detail sesi admin

**Files:**
- Create: `web/src/app/admin/sesi/[id]/pengunggah-sertifikat.tsx`
- Modify: `web/src/app/admin/sesi/[id]/page.tsx`

**Interfaces:**
- Consumes: `terbitkanUrlUnggahSertifikat`, `catatSertifikat` (Task 3); `periksaBerkasSertifikat` (Task 2); `createBrowserSupabase` dari `@/lib/supabase/client`.
- Produces: `<PengunggahSertifikat sessionId={string} sudahAda={boolean} />`

- [ ] **Step 1: Tulis komponen pengunggah**

```tsx
"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { periksaBerkasSertifikat } from "@/lib/sertifikat/berkas";
import { terbitkanUrlUnggahSertifikat, catatSertifikat } from "./unggah-sertifikat";

const BUCKET = "sertifikat";

type Fase = "diam" | "mengunggah" | "selesai" | "galat";

export function PengunggahSertifikat({
  sessionId,
  sudahAda,
}: {
  sessionId: string;
  sudahAda: boolean;
}) {
  const [fase, setFase] = useState<Fase>("diam");
  const [pesan, setPesan] = useState("");

  async function tangani(berkas: File) {
    const periksa = periksaBerkasSertifikat(berkas.name, berkas.size, berkas.type);
    if (!periksa.ok) {
      setFase("galat");
      setPesan(periksa.pesan);
      return;
    }

    setFase("mengunggah");
    setPesan("");

    const url = await terbitkanUrlUnggahSertifikat(sessionId, berkas.size, berkas.type);
    if (!url.ok) {
      setFase("galat");
      setPesan(url.pesan);
      return;
    }

    const supabase = createBrowserSupabase();
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(url.objek, url.token, berkas, { contentType: berkas.type });

    if (error) {
      setFase("galat");
      setPesan("Unggahan gagal di tengah jalan. Coba lagi.");
      return;
    }

    const catat = await catatSertifikat(sessionId, url.objek, berkas.type);
    if (!catat.ok) {
      setFase("galat");
      setPesan(catat.pesan);
      return;
    }

    setFase("selesai");
    setPesan("Sertifikat tersimpan dan sudah bisa dibuka klien.");
  }

  return (
    <div>
      <label className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg border border-panel-border bg-panel-surface px-3 text-[12.5px] font-bold text-panel-ink">
        {sudahAda ? "Ganti sertifikat" : "Unggah sertifikat"}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/webp"
          className="sr-only"
          disabled={fase === "mengunggah"}
          onChange={(e) => {
            const b = e.target.files?.[0];
            // Medan dikosongkan supaya memilih BERKAS YANG SAMA dua kali tetap
            // memicu onChange — tanpa ini, unggah ulang setelah gagal diam saja.
            e.target.value = "";
            if (b) void tangani(b);
          }}
        />
      </label>

      {fase === "mengunggah" && (
        <p className="mt-2 text-[12px] text-panel-muted">Mengunggah…</p>
      )}
      {fase === "galat" && <p className="mt-2 text-[12px] font-bold text-clay">{pesan}</p>}
      {fase === "selesai" && <p className="mt-2 text-[12px] font-bold text-leaf">{pesan}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Sisipkan ke halaman detail sesi**

Buka `web/src/app/admin/sesi/[id]/page.tsx`. Tambahkan impor:

```tsx
import { PengunggahSertifikat } from "./pengunggah-sertifikat";
```

Sesudah baris yang mengambil `sesi` (cari `const sesi =`), tambahkan pembacaan sertifikat lewat sesi pengguna:

```tsx
  // Dibaca lewat sesi pengguna: policy "sertifikat: staf kelola" yang
  // memutuskan, bukan service role.
  const { data: sertifikat } = await supabase
    .from("certificates")
    .select("objek, created_at")
    .eq("session_id", sesi.id)
    .maybeSingle<{ objek: string; created_at: string }>();
```

Bila berkas itu belum punya `supabase` dari `createServerSupabase()`, buat satu (tiru cara halaman itu mengambil `sesi`).

Lalu, tepat sebelum `</section>` penutup blok utama, sisipkan:

```tsx
      {/* Hanya untuk sesi yang SELESAI. Sertifikat kunjungan yang belum
          terjadi adalah pernyataan yang tidak benar — digerbang di sini demi
          layar yang jujur, dan di trigger basis data demi kebenaran yang tidak
          bergantung pada layar. */}
      {sesi.status === "selesai" && (
        <div className="mt-5 border-t border-panel-border pt-4">
          <h2 className="mb-1 text-[13px] font-bold text-panel-ink">Sertifikat</h2>
          <p className="mb-3 text-[12px] text-panel-muted">
            {sertifikat
              ? "Sudah terbit — klien bisa membukanya dari badge Pencapaian dan halaman Materi."
              : "Belum ada. PDF, JPEG, atau WEBP, maksimal 5 MB."}
          </p>
          <PengunggahSertifikat sessionId={sesi.id} sudahAda={Boolean(sertifikat)} />
        </div>
      )}
```

- [ ] **Step 3: Periksa tipe, lint, build**

Run: `cd web && npx tsc --noEmit && npx eslint src/app/admin/sesi && npm run build`
Expected: ketiganya bersih.

- [ ] **Step 4: Verifikasi manual sekali**

Jalankan `cd web && npm run dev`, masuk sebagai admin, buka satu sesi berstatus selesai, unggah satu PDF kecil. Lalu buktikan trigger benar-benar menulis salinannya:

Run: `cd web && npx supabase db execute --sql "select client_id, service_id, objek, mime from certificates;"`
Expected: `client_id` dan `service_id` berisi UUID sungguhan (BUKAN nol-UUID), `objek` berbentuk `<client_id>/<session_id>.pdf`.

- [ ] **Step 5: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add "web/src/app/admin/sesi/[id]/pengunggah-sertifikat.tsx" "web/src/app/admin/sesi/[id]/page.tsx"
git commit -m "feat(sertifikat): unggah dari detail sesi admin, hanya untuk sesi selesai

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rute baca untuk klien

**Files:**
- Create: `web/src/app/api/sertifikat/[sesi]/route.ts`
- Modify: `web/tests/sertifikat-hak.test.ts` (tambah satu uji)

**Interfaces:**
- Consumes: tabel `certificates` (Task 1).
- Produces: `GET /api/sertifikat/<sessionId>` → byte berkas, atau 404.

- [ ] **Step 1: Tulis rutenya**

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * MEMBACA SERTIFIKAT — PEMILIKNYA SAJA.
 *
 * Kembaran `/api/bukti/[permintaan]`, dengan satu perbedaan yang disengaja:
 * penjaganya BUKAN `requireRole`, melainkan kepemilikan. Barisnya dibaca lewat
 * SESI PENGGUNA, jadi policy "sertifikat: klien baca miliknya" yang menjawab —
 * sertifikat orang lain memulangkan nol baris.
 *
 * Nol baris dan berkas-yang-belum-ada menjawab hal yang SAMA (404). Itu bukan
 * kemalasan: dua kalimat berbeda akan mengubah rute ini menjadi alat menghitung
 * sertifikat orang lain.
 *
 * Bucket `sertifikat` tidak punya satu pun policy, jadi hanya service role
 * (baris `createAdminSupabase` di bawah) yang bisa menukar path jadi byte — dan
 * ia baru dipanggil SESUDAH RLS memutuskan hak di atas.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sesi: string }> },
) {
  const { sesi } = await params;

  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("certificates")
    .select("objek, mime")
    .eq("session_id", sesi)
    .maybeSingle<{ objek: string; mime: string }>();

  if (!baris) {
    return NextResponse.json({ pesan: "Sertifikat tidak ada." }, { status: 404 });
  }

  const admin = createAdminSupabase();
  const { data: berkas, error } = await admin.storage
    .from("sertifikat")
    .download(baris.objek);

  if (error || !berkas) {
    return NextResponse.json({ pesan: "Sertifikat tidak terbaca." }, { status: 404 });
  }

  return new NextResponse(berkas, {
    headers: {
      "content-type": baris.mime || "application/pdf",
      // `private`: respons ini milik satu klien, dan tidak boleh disimpan CDN
      // mana pun lalu disajikan ke orang lain.
      "cache-control": "private, no-store",
    },
  });
}
```

- [ ] **Step 2: Tambah uji rute ke berkas uji Task 1**

Tambahkan di dalam `describe("sertifikat — hak baca", ...)` pada `web/tests/sertifikat-hak.test.ts`:

```ts
  it("rute baca menolak sertifikat milik klien lain dengan 404", async () => {
    // Uji ini memanggil handler rutenya LANGSUNG, bukan lewat HTTP: sesi
    // pemakai diambil dari cookie yang sudah dipasang `signInAs`, sama seperti
    // uji rute lain di repo ini. Tiru pola berkas uji rute tetangga
    // (cari `route.ts` di tests/) untuk cara memanggilnya.
    const { GET } = await import("@/app/api/sertifikat/[sesi]/route");

    const admin = createAdminSupabase();
    const { data: sesi } = await admin
      .from("sessions")
      .select("id")
      .eq("status", "selesai")
      .limit(1)
      .single();

    await signInAs("klien2"); // bukan pemilik sesi di atas

    const res = await GET(new Request("http://localhost/api/sertifikat/x"), {
      params: Promise.resolve({ sesi: sesi!.id }),
    });

    expect(res.status).toBe(404);
  });
```

Bila pola pemanggilan rute di repo ternyata berbeda (mis. lewat `next/headers` yang harus di-mock), **ikuti pola berkas uji rute yang sudah ada** — jangan mengarang pola baru.

- [ ] **Step 3: Jalankan uji**

Run: `cd web && npx vitest run tests/sertifikat-hak.test.ts`
Expected: 3 uji PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add "web/src/app/api/sertifikat/[sesi]/route.ts" web/tests/sertifikat-hak.test.ts
git commit -m "feat(sertifikat): rute baca berpagar kepemilikan, 404 seragam

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Badge berangka dan bisa diketuk

**Files:**
- Modify: `web/src/lib/passport/turunan.ts` (fungsi `badgeDari`, sekitar baris 104)
- Modify: `web/src/app/passport/page.tsx` (blok Pencapaian)

**Interfaces:**
- Produces: `badgeDari(sesi: SesiRingkas[]): Array<{ serviceId: string; nama: string; jumlah: number }>`

- [ ] **Step 1: Ubah `badgeDari`**

Ganti isi fungsinya:

```ts
/**
 * Badge per LAYANAN yang pernah dijalani sampai selesai, beserta BERAPA KALI.
 *
 * Angkanya adalah hitungan, bukan gerbang: tidak ada ambang yang menerbitkan
 * apa pun pada kunjungan ke-lima. Kapan sertifikat pantas terbit adalah
 * keputusan klinik, dan yang menerbitkannya adalah admin, bukan angka ini.
 */
export function badgeDari(
  sesi: SesiRingkas[],
): Array<{ serviceId: string; nama: string; jumlah: number }> {
  const peta = new Map<string, { nama: string; jumlah: number }>();
  for (const s of sesi) {
    if (s.status !== "selesai") continue;
    const ada = peta.get(s.serviceId);
    if (ada) ada.jumlah += 1;
    else peta.set(s.serviceId, { nama: s.namaLayanan, jumlah: 1 });
  }
  return [...peta].map(([serviceId, v]) => ({ serviceId, ...v }));
}
```

- [ ] **Step 2: Ubah blok Pencapaian di beranda**

Di `web/src/app/passport/page.tsx`, ganti isi `badge.map(...)` menjadi:

```tsx
            {badge.map((b) => (
              <Link
                key={b.serviceId}
                href={`/passport/sertifikat/${b.serviceId}`}
                data-badge={b.serviceId}
                className="w-[104px] text-center text-[11px] font-bold leading-tight text-[#6B5A2E]"
              >
                <span className="relative mx-auto mb-2 flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-gold bg-[radial-gradient(circle_at_35%_30%,#FDF6E4,#F3E6C4)] text-gold shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_4px_rgba(217,179,106,.28)]">
                  <Lotus className="w-[34px]" />
                  {/* Angka muncul mulai kunjungan KEDUA. "×1" pada setiap badge
                      menambah keramaian tanpa memberi kabar baru. */}
                  {b.jumlah > 1 && (
                    <span
                      data-badge-jumlah={b.jumlah}
                      className="absolute -right-1 -top-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-paper bg-night px-1 text-[10.5px] font-bold text-gold-pale"
                    >
                      ×{b.jumlah}
                    </span>
                  )}
                </span>
                {b.nama}
              </Link>
            ))}
```

- [ ] **Step 3: Periksa & jalankan uji beranda**

Run: `cd web && npx tsc --noEmit && npx vitest run tests/passport-beranda.test.ts`
Expected: bersih, seluruh uji beranda PASS. `data-badge` tetap ada — itulah kontrak yang diuji.

- [ ] **Step 4: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/passport/turunan.ts web/src/app/passport/page.tsx
git commit -m "feat(sertifikat): badge membawa jumlah kunjungan dan menuju sertifikat

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Halaman sertifikat klien

**Files:**
- Modify: `web/src/lib/passport/data.ts` (tambah fungsi di akhir berkas)
- Create: `web/src/app/passport/sertifikat/[serviceId]/page.tsx`

**Interfaces:**
- Produces: `ambilSertifikatLayanan(clientId: string, serviceId: string): Promise<{ sessionId: string; tanggal: string; mime: string } | null>` — nama layanan TIDAK ikut; halaman mengambilnya dari `badgeDari()` yang sudah dipanggil di sana.

- [ ] **Step 1: Tambah pembaca data**

Di akhir `web/src/lib/passport/data.ts`:

```ts
/**
 * Sertifikat TERBARU milik satu klien untuk satu layanan.
 *
 * Dibaca lewat sesi pengguna: policy "sertifikat: klien baca miliknya" yang
 * memutuskan, jadi serviceId karangan memulangkan null — bukan galat.
 */
export async function ambilSertifikatLayanan(
  clientId: string,
  serviceId: string,
): Promise<{ sessionId: string; tanggal: string; mime: string } | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("certificates")
    .select("session_id, mime, sessions(tanggal)")
    .eq("client_id", clientId)
    .eq("service_id", serviceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      session_id: string;
      mime: string;
      sessions: { tanggal: string } | null;
    }>();

  if (!data) return null;
  return {
    sessionId: data.session_id,
    // Embed yang tertolak RLS memulangkan NULL, bukan galat — halaman tetap
    // terbit dengan tanggal kosong alih-alih meledak.
    tanggal: data.sessions?.tanggal ?? "",
    mime: data.mime,
  };
}
```

- [ ] **Step 2: Tulis halamannya**

Buat `web/src/app/passport/sertifikat/[serviceId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilSertifikatLayanan, ambilSesi } from "@/lib/passport/data";
import { badgeDari } from "@/lib/passport/turunan";
import { formatTanggalID } from "@/lib/passport/waktu";

export const metadata = { title: "Sertifikat" };

// Rute passport dilarang mengekspor pengaturan revalidasi Next.js (ditulis
// tanpa mengeja bentuknya, karena tests/passport-shell.test.ts memindai sumber
// berkas ini apa adanya): pengaturan itu menghapus `private` dari Cache-Control
// sehingga respons satu klien boleh disimpan CDN dan disajikan ke klien lain.
export const dynamic = "force-dynamic";

export default async function HalamanSertifikat({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const { serviceId } = await params;
  const [sesi, sertifikat] = await Promise.all([
    ambilSesi(klien.id),
    ambilSertifikatLayanan(klien.id, serviceId),
  ]);

  const badge = badgeDari(sesi).find((b) => b.serviceId === serviceId);
  if (!badge) notFound(); // layanan yang belum pernah ia jalani

  const gambar = sertifikat?.mime.startsWith("image/") ?? false;
  const tautan = sertifikat ? `/api/sertifikat/${sertifikat.sessionId}` : "";

  return (
    <>
      <Link
        href="/passport"
        className="mb-4 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold text-ink"
      >
        ← Kembali ke Beranda
      </Link>

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="font-serif text-xl text-night">{badge.nama}</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          {badge.jumlah > 1
            ? `Anda sudah menjalani layanan ini ${badge.jumlah} kali.`
            : "Anda sudah menjalani layanan ini satu kali."}
        </p>

        {sertifikat ? (
          <div className="mt-5">
            {sertifikat.tanggal !== "" && (
              <p className="mb-3 text-[12.5px] text-ink-soft">
                Kunjungan {formatTanggalID(sertifikat.tanggal)}
              </p>
            )}

            {gambar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tautan}
                alt={`Sertifikat ${badge.nama}`}
                className="w-full rounded-xl border border-black/10"
              />
            ) : (
              <object
                data={tautan}
                type="application/pdf"
                className="h-[70vh] w-full rounded-xl border border-black/10"
              >
                {/* Penampil PDF bawaan peramban tidak ada di sebagian ponsel.
                    Tautan di bawah bukan cadangan basa-basi — di perangkat itu
                    ia satu-satunya cara membuka lembarnya. */}
                <p className="p-4 text-[13px] text-ink-soft">
                  Peramban ini tidak bisa menampilkan PDF di halaman. Buka lewat tautan di
                  bawah.
                </p>
              </object>
            )}

            <a
              href={tautan}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block min-h-[44px] rounded-xl bg-gold px-5 py-3 text-sm font-bold text-[#FFF8EA]"
            >
              Buka & unduh sertifikat
            </a>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-gold/60 bg-[#FDFAF1] p-4">
            <b className="block text-sm text-night">Sertifikat belum terbit</b>
            <span className="text-[13px] text-ink-soft">
              Tim PADMA menerbitkannya setelah kunjungan Anda dirapikan. Badge ini tetap
              menjadi catatan perjalanan Anda sementara itu.
            </span>
          </div>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 3: Periksa tipe, lint, build, uji shell**

Run: `cd web && npx tsc --noEmit && npx eslint src/app/passport && npm run build && npx vitest run tests/passport-shell.test.ts`
Expected: semuanya bersih. `passport-shell` menjaga larangan revalidasi — kalau ia merah, halaman baru mengekspor sesuatu yang terlarang.

- [ ] **Step 4: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/passport/data.ts "web/src/app/passport/sertifikat/[serviceId]/page.tsx"
git commit -m "feat(sertifikat): halaman sertifikat klien, terbuka juga saat belum terbit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Bagian Sertifikat di halaman Materi

**Files:**
- Modify: `web/src/app/passport/materi/page.tsx`

**Interfaces:**
- Consumes: `badgeDari` (Task 6), `ambilSertifikatLayanan` (Task 7), `ambilSesi`.

- [ ] **Step 1: Tambah bagian sertifikat**

Di `web/src/app/passport/materi/page.tsx`, sesudah `const materi = await ambilDaftarMateri();`:

```tsx
  // Sertifikat datang dari KUNJUNGAN klien sendiri, bukan dari katalog seperti
  // e-book dan video. Karena itu ia berdiri di bagiannya sendiri, bukan
  // dicampur ke dalam grid materi: dua sumber yang berbeda tidak boleh terbaca
  // seolah satu daftar yang sama.
  const sesi = await ambilSesi(klien.id);
  const dariBadge = badgeDari(sesi);
  const sertifikat = (
    await Promise.all(
      dariBadge.map(async (b) => ({
        ...b,
        punya: (await ambilSertifikatLayanan(klien.id, b.serviceId)) !== null,
      })),
    )
  ).filter((b) => b.punya);
```

Tambahkan impor di puncak berkas:

```tsx
import Link from "next/link";
import { ambilSesi, ambilSertifikatLayanan } from "@/lib/passport/data";
import { badgeDari } from "@/lib/passport/turunan";
```

(Gabungkan dengan impor `@/lib/passport/data` yang sudah ada — jangan membuat dua pernyataan impor dari modul yang sama.)

Lalu, sesudah `</section>` penutup daftar materi, tambahkan:

```tsx
      {sertifikat.length > 0 && (
        <section className="mt-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="mb-4 font-serif text-xl text-night">
            Sertifikat{" "}
            <span className="font-sans text-xs font-semibold text-ink-soft">
              terbit dari kunjungan yang sudah Anda jalani
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sertifikat.map((s) => (
              <Link
                key={s.serviceId}
                href={`/passport/sertifikat/${s.serviceId}`}
                data-sertifikat={s.serviceId}
                className="flex items-center gap-3 rounded-xl border border-black/10 bg-paper p-3"
              >
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gold-pale text-[17px] text-gold">
                  🏅
                </span>
                <span className="min-w-0">
                  <b className="block text-[13.5px] leading-tight text-night">{s.nama}</b>
                  <span className="text-[11.5px] text-ink-soft">
                    Sertifikat · {s.jumlah > 1 ? `${s.jumlah} kunjungan` : "1 kunjungan"}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 2: Periksa & build**

Run: `cd web && npx tsc --noEmit && npx eslint src/app/passport && npm run build`
Expected: bersih.

- [ ] **Step 3: Verifikasi manual**

Masuk sebagai klien yang sertifikatnya sudah diunggah di Task 4. Periksa tiga hal:
1. Beranda: badge membawa `×N` bila layanan itu dijalani lebih dari sekali.
2. Ketuk badge → halaman sertifikat, berkasnya tampil.
3. Halaman Materi: bagian "Sertifikat" muncul dan kartunya menuju halaman yang sama.

Lalu masuk sebagai klien LAIN dan buka `/api/sertifikat/<sessionId milik klien pertama>` — harus 404.

- [ ] **Step 4: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/app/passport/materi/page.tsx
git commit -m "feat(sertifikat): bagian sertifikat di halaman materi klien

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Catatan bagi pelaksana

- **Jangan** menambahkan uji untuk tampilan (badge, kartu materi, halaman sertifikat). Pemilik repo meminta mode cepat; yang diuji hanya hak baca (Task 1 & 5).
- Bila `npx supabase db reset` diperlukan, **koordinasikan dulu** — basis data lokal dipakai bersama sesi lain, dan reset akan memerahkan uji sesi tetangga di tengah jalan.
- Satu uji di `tests/paket-tersembunyi.test.tsx` (`kontrol positif ... ' · paket'` di `/admin/sesi`) **sudah merah sebelum pekerjaan ini** dan tidak berhubungan. Jangan mencoba memperbaikinya di dalam rencana ini, dan jangan menganggapnya regresi.
