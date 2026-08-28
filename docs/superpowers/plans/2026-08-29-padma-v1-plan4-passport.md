# PADMA v1 — Plan 4: Digital Care Passport Klien

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klien membuka `/passport` dan melihat perjalanan perawatannya secara utuh — sampul paspor, progres paket berbentuk stempel, riwayat sesi beserta catatan bidan, materi panduan yang terbuka sesuai layanan yang dijalani, status pembayaran, dan pengajuan jadwal — semuanya aman dari kebocoran lintas klien.

**Architecture:** `/passport` menjadi rute bersarang sungguhan (bukan penukar view di klien), sehingga tiap halaman hanya mengambil data yang ia butuhkan dan isi materi tidak pernah ikut terkirim ke halaman daftar. Seluruh pembacaan data memakai **sesi pengguna** (`createServerSupabase`) supaya RLS yang menjadi penjaga, bukan UI. Perubahan status (klaim bayar, ajukan jadwal) lewat **server action dengan nilai tujuan hardcoded** — klien tidak pernah mengirim status.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase (Postgres+RLS), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-padma-v1-design.md`
**Plan sebelumnya (sudah dieksekusi):** `plan1-fondasi.md`, `plan2-landing-skrining.md`
**Rujukan desain:** `padma-prototype.html` — `<section id="scr-passport">` (baris ±1008–1158), CSS baris ±345–430 & ±513–580, mesin baris ±1457–1636.

## Global Constraints

- Seluruh teks UI berbahasa **Indonesia**.
- **Money firewall**: kolom nominal uang hanya di `service_rates` & `honor_marks`. `tests/money-firewall-struktural.test.ts` memakai regex nama kolom — **dilarang** menamai kolom baru `bukti_bayar_url`, `tanggal_bayar`, `catatan_bayar`, `metode_pembayaran`. Pakai `diklaim_pada`, `diverifikasi_pada`, `diverifikasi_oleh`. Pengecualian yang sudah terdaftar hanya `status_bayar` bertipe `pay_status`.
- **Nominal uang tidak pernah tampil di halaman klien.** Halaman Bayar menampilkan STATUS, bukan angka. Nominal disampaikan admin via WhatsApp (keputusan #10).
- `createAdminSupabase()` (service role) **DILARANG** di seluruh `src/app/passport/**` untuk membaca data passport — ia menembus RLS sehingga penyaringan jatuh ke UI, dan isi materi terkunci akan ikut masuk RSC payload. Pengecualian tunggal: server action yang menulis status (Task 9), dengan filter kepemilikan eksplisit.
- **Pencocokan identitas wajib operator setara (`.eq()`)**, tidak pernah pola.
- **Data kesehatan tidak boleh muncul di URL/log.** Catatan sesi & isi bab tidak boleh jadi query param; dilarang `console.log` isinya.
- Tabel/kolom baru: `gen_random_uuid()`, bukan serial. Fungsi baru wajib `revoke execute ... from public, anon` eksplisit (kalau tidak, `tests/hak-default-sequence-fungsi.test.ts` merah).
- TypeScript `strict: true`. App di `web/`. Node ≥ 20, Docker berjalan.
- Palet: night `#0A2B1F`, pine `#11382A`, leaf `#2F6A48`, leaf-soft `#E9F1E9`, gold `#B58A3C`, gold-bright `#D9B36A`, gold-pale `#F0E3C3`, paper `#FBF8F0`, paper-warm `#F5EFE1`, ink `#1F2E26`, ink-soft `#5D6C61`, clay `#A6472F` — tersedia sebagai utility. `font-serif`→Marcellus, body→Plus Jakarta Sans, `font-mono`→IBM Plex Mono.
- Komponen `Lotus` sudah ada: `src/app/_landing/lotus.tsx` — pakai ulang, jangan menyalin ulang path SVG.
- Akun demo: `owner@` / `admin@` / `ananda@padma.test`, password `padma-dev-123`.

## Pagar Waktu (sumber bug paling mungkin di plan ini)

Vercel berjalan **UTC**, mesin dev **WIB** — bug zona waktu tidak akan pernah terlihat lokal.

1. **Dilarang** memakai `toISOString()`, `setDate()`, `getDay()`, atau `new Date(...)` untuk logika tanggal. Kolom `tanggal` bertipe `date` dan sudah berupa string `YYYY-MM-DD`; **bandingkan sebagai string**.
2. "Hari ini" dihitung dengan `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })` yang menghasilkan `YYYY-MM-DD`.
3. Semua fungsi turunan menerima parameter `sekarang: string` (bukan membaca jam mesin) supaya test tidak mulai gagal sendiri setelah tanggal seed terlewat.
4. Format tampilan tanggal **wajib** menyertakan `timeZone: "Asia/Jakarta"`. Preseden yang **jangan** ditiru: `src/app/admin/skrining/tabel-inbox.tsx` memformat tanpa `timeZone` di Client Component.
5. Tambahkan `env: { TZ: "UTC" }` di `web/vitest.config.ts` supaya suite menangkap kelas bug ini.

## Pagar Keamanan Passport

1. **Klien tidak boleh punya policy `UPDATE`** pada `sessions`, `client_packages`, atau `booking_requests`. RLS tidak mengenal batas per-kolom untuk UPDATE — satu policy UPDATE langsung menyerahkan `status`, `catatan`, `client_id`, dan `status_bayar` sekaligus. Semua perubahan lewat server action.
2. **Server action = endpoint POST tersendiri.** Guard di layout/page TIDAK berlaku untuknya. `await requireRole(["klien"])` wajib ditulis di dalam action, dan parameternya **tidak boleh** memuat status tujuan.
3. **PostgREST menjawab HTTP 200 + `[]` untuk UPDATE yang tertahan RLS**, bukan 403. Test wajib meng-assert 0 baris **dan** membaca ulang nilainya dengan service role.
4. **Query daftar dilarang menyebut `isi` atau `url`.** Untuk menghitung jumlah bab pakai `material_chapters(id)`.
5. **Bentuk embed berbeda**: `material_chapters` = array (`[]` saat terkunci); `material_videos` = objek atau `null`. `video.length === 0` selalu salah.
6. **`materials.aktif` tidak dievaluasi policy chapters/videos** — UI wajib `.eq("aktif", true)` sendiri, di daftar maupun reader.
7. **Cache Next.js**: dilarang `unstable_cache` dan `export const revalidate` di `src/app/passport/**` (keduanya bisa membagikan data satu klien ke klien lain); jangan memaksa `prefetch={true}` ke reader materi; pertahankan logout berbentuk `<form method="post">`.
8. **Jangan menjanjikan proteksi yang tidak ada.** Teks bab tetap terbaca di View Source/DevTools karena ada di RSC payload. Watermark, `user-select:none`, dan blokir klik-kanan adalah *deterrent* — tulis begitu apa adanya, seperti spec sudah jujur soal screenshot.

## Keputusan Desain Plan 4

| # | Topik | Keputusan |
|---|---|---|
| A | Routing | Rute bersarang sungguhan: `/passport`, `/passport/sesi`, `/passport/materi`, `/passport/materi/[id]`, `/passport/bayar`, `/passport/ajukan`, `/passport/profil`. Bukan penukar view di klien — tiap halaman hanya memuat datanya sendiri. |
| B | Nama bidan | **Ditampilkan.** Klien tidak punya hak baca `partners`, jadi ditambahkan policy SELECT khusus yang membuka **hanya kolom `nama`** lewat view `partner_publik` — `no_hp` tetap tertutup (pelajaran `materials.video_url`). |
| C | Klaim bayar | Server action `klaimSudahBayar(jenis, id)` — service role, filter kepemilikan + `.eq("status_bayar","belum")`, nilai tujuan `menunggu_verifikasi` **hardcoded**. Klien tidak pernah bisa menyetel `lunas`. |
| D | Ajukan jadwal | Server action `ajukanJadwal(...)` dengan `status: "menunggu"` hardcoded, plus trigger DB penjaga (celah `status='dikonfirmasi'` sudah terbukti tembus hari ini). |
| E | Video materi | Player mock berlabel jujur + allowlist host di skema. Embed terkunci domain / playback token = fase berikutnya (belum ada akun Vimeo/Cloudflare — jangan mengarang kesiapan). |
| F | Seed demo | Diperkaya menjadi 6/8 sesi + 3 badge + materi terbuka & terkunci, sesuai cerita prototipe, **tanpa** menambah baris `clients` untuk Ananda (`tests/rls-firewall.test.ts` meng-assert tepat 1). |
| G | Klien belum tertaut | `/passport` untuk user `klien` tanpa baris `clients` → redirect `/akun-belum-terhubung`, bukan error PGRST116. |

## Struktur Berkas

```
web/src/
  lib/passport/
    waktu.ts          # hariIniJakarta(), formatTanggalID(), bandingTanggal() — string-based
    turunan.ts        # progresPaket(), gridStempel(), sesiBerikutnya(), badge(), tagihan()
    data.ts           # ambilPassport(), ambilSesi(), ambilMateri(), ambilBab() — sesi pengguna
    aksi.ts           # server action: klaimSudahBayar(), ajukanJadwal()
  app/passport/
    layout.tsx        # requireRole(["klien"]) + resolusi klien + redirect bila belum tertaut
    nav.tsx           # tab desktop + bottom bar mobile (client component)
    page.tsx          # Beranda
    sesi/page.tsx
    materi/page.tsx
    materi/[id]/page.tsx
    bayar/page.tsx
    ajukan/page.tsx
    profil/page.tsx
    _komponen/        # SampulPassport, GridStempel, KartuSesi, KartuMateri, Watermark, Qris
web/supabase/migrations/
  <ts>_passport_penjaga.sql
web/tests/
  passport-waktu.test.ts
  passport-turunan.test.ts
  passport-keamanan.test.ts
  passport-data.test.ts
```

---

### Task 1: Tutup celah pra-passport & penjaga status

**Files:**
- Create: `web/supabase/migrations/<timestamp>_passport_penjaga.sql`, `web/tests/passport-keamanan.test.ts`

**Interfaces:**
- Produces: trigger `guard_booking_status`, view `partner_publik` + policy, unique index `clients_user_id_unik`.

**Konteks:** celah berikut **sudah saya reproduksi hari ini** — klien menyisipkan `booking_requests` dengan `status='dikonfirmasi'` dan berhasil (permintaan lenyap dari antrean admin sambil tampil "dikonfirmasi" di passport).

- [ ] **Step 1: Test dulu (harus MERAH)**

Buat `web/tests/passport-keamanan.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();
const SVC = "11111111-1111-1111-1111-111111111101";
const bersihkan: string[] = [];

afterAll(async () => {
  if (bersihkan.length) await admin.from("booking_requests").delete().in("id", bersihkan);
});

async function klienDanId() {
  const k = await signInAs("ananda@padma.test");
  const { data } = await k.from("clients").select("id").single();
  return { k, clientId: data!.id as string };
}

describe("penjaga booking_requests", () => {
  it("klien TIDAK bisa menyisipkan permintaan berstatus dikonfirmasi", async () => {
    const { k, clientId } = await klienDanId();
    const { data, error } = await k.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-10",
      preferensi_waktu: "pagi", status: "dikonfirmasi",
    }).select();
    if (data?.[0]) bersihkan.push(data[0].id);
    expect(error?.code).toBe("42501");
  });

  it("klien TIDAK bisa mengubah status permintaannya sendiri", async () => {
    const { k, clientId } = await klienDanId();
    const { data: baru } = await admin.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-11",
      preferensi_waktu: "sore", status: "menunggu",
    }).select("id").single();
    bersihkan.push(baru!.id);

    const { data: ubah } = await k.from("booking_requests")
      .update({ status: "dikonfirmasi" }).eq("id", baru!.id).select();
    expect(ubah ?? []).toHaveLength(0);

    // PostgREST menjawab 200 + [] untuk update yang tertahan — baca ulang nilainya.
    const { data: cek } = await admin.from("booking_requests")
      .select("status").eq("id", baru!.id).single();
    expect(cek!.status).toBe("menunggu");
  });

  it("klien BOLEH menyisipkan permintaan berstatus menunggu (alur sah)", async () => {
    const { k, clientId } = await klienDanId();
    const { data, error } = await k.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-12",
      preferensi_waktu: "pagi", status: "menunggu",
    }).select("id");
    expect(error).toBeNull();
    if (data?.[0]) bersihkan.push(data[0].id);
  });

  it("staf tetap bisa mengonfirmasi permintaan", async () => {
    const { clientId } = await klienDanId();
    const { data: baru } = await admin.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-13",
      preferensi_waktu: "siang", status: "menunggu",
    }).select("id").single();
    bersihkan.push(baru!.id);

    const a = await signInAs("admin@padma.test");
    const { data: ubah } = await a.from("booking_requests")
      .update({ status: "dikonfirmasi" }).eq("id", baru!.id).select();
    expect(ubah).toHaveLength(1);
  });
});

describe("nama mitra untuk klien", () => {
  it("klien TIDAK bisa membaca tabel partners langsung (no_hp tertutup)", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("partners").select("nama, no_hp");
    expect(data ?? []).toHaveLength(0);
  });

  it("klien BISA membaca nama mitra lewat partner_publik, tanpa no_hp", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.from("partner_publik").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(data![0])).toEqual(expect.arrayContaining(["id", "nama"]));
    expect(Object.keys(data![0])).not.toContain("no_hp");
  });
});

describe("invarian satu akun ↔ satu klien", () => {
  it("clients.user_id unik (mencegah satu user menempel ke dua klien)", async () => {
    const { data: ananda } = await admin.from("clients")
      .select("user_id").eq("padma_id", "PAD-2607-0012").single();
    const { error } = await admin.from("clients").insert({
      padma_id: "PAD-UJI-DUP1", nama: "Duplikat", email: "dup@padma.test",
      phase_id: "prekonsepsi", user_id: ananda!.user_id,
    });
    expect(error?.code).toBe("23505");
  });
});
```

Run: `npm test -- tests/passport-keamanan.test.ts`
Expected: MERAH pada penjaga booking, `partner_publik`, dan unique index.

- [ ] **Step 2: Migration**

```bash
npx supabase migration new passport_penjaga
```

Isi:
```sql
-- ============================================================================
-- PENJAGA PRA-PASSPORT
-- ============================================================================
-- (1) booking_requests: policy "booking: klien ajukan" hanya memeriksa
--     KEPEMILIKAN, tidak NILAI. Terbukti hari ini: klien menyisipkan barisnya
--     sendiri dengan status='dikonfirmasi' (HTTP 201) — permintaan itu lenyap
--     dari antrean admin sambil tampil "dikonfirmasi" di passport.
--     Bentuk masalah yang sama dengan profiles.role dan clients.user_id, jadi
--     obatnya sama: trigger yang mengikat NILAI, bukan hak tabel.

create or replace function public.guard_booking_status()
returns trigger
language plpgsql
as $$
begin
  -- Bersarang, bukan `and`: plpgsql tidak menjamin short-circuit.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      if tg_op = 'INSERT' and new.status is distinct from 'menunggu'::booking_status then
        raise exception 'permintaan jadwal baru selalu berstatus menunggu'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        raise exception 'status permintaan jadwal hanya boleh diubah staf'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_status() from public, anon;

create trigger trg_guard_booking_status
  before insert or update on public.booking_requests
  for each row execute function public.guard_booking_status();

-- (2) Nama bidan untuk klien, TANPA membuka no_hp.
--     Klien tidak punya hak baca `partners` (dan itu benar — no_hp mitra bukan
--     urusan klien). Riwayat sesi tetap perlu menyebut siapa yang datang, jadi
--     dibuka lewat view berkolom sempit. security_invoker=off disengaja:
--     view inilah batas kolomnya.
create view public.partner_publik
  with (security_invoker = off) as
  select id, nama from public.partners where aktif = true;

revoke all on public.partner_publik from anon;
grant select on public.partner_publik to authenticated;

-- (3) Invarian "satu auth user ↔ satu baris clients".
--     Rumus materi di aplikasi dan policy RLS hanya setara bila invarian ini
--     berlaku; sekarang clients.user_id hanya index biasa.
create unique index clients_user_id_unik
  on public.clients (user_id) where user_id is not null;
```

- [ ] **Step 3: Terapkan & verifikasi**

Run: `npx supabase db reset && npm test -- tests/passport-keamanan.test.ts` → PASS.
Run: `npm test` → seluruh suite PASS (perhatikan `hak-default-sequence-fungsi.test.ts` tetap hijau — fungsi baru sudah di-`revoke`).

- [ ] **Step 4: Commit**

```bash
git add web && git commit -m "fix(plan4): penjaga status permintaan jadwal + nama mitra tanpa no_hp + invarian satu akun satu klien"
```

---

### Task 2: Util waktu & kalkulasi turunan

**Files:**
- Create: `web/src/lib/passport/waktu.ts`, `web/src/lib/passport/turunan.ts`, `web/tests/passport-waktu.test.ts`, `web/tests/passport-turunan.test.ts`
- Modify: `web/vitest.config.ts` (tambah `env: { TZ: "UTC" }`)

**Interfaces:**
- Produces:
  - `hariIniJakarta(): string` → `YYYY-MM-DD`
  - `formatTanggalID(tgl: string): string` → `4 September 2026`
  - `formatTanggalPendek(tgl: string): { hari: string; bulan: string }`
  - `progresPaket(input): { selesai: number; total: number; persen: number }`
  - `gridStempel(input): Array<{ jenis: "terisi"|"berikutnya"|"kosong"; tanggal?: string }>`
  - `sesiBerikutnya(sesi, sekarang): Sesi | null`
  - `badgeDari(sesi): Array<{ serviceId: string; nama: string }>`
  - `susunTagihan(input): Array<{ jenis: "paket"|"sesi"; id: string; label: string; status: PayStatus }>`

- [ ] **Step 1: Kunci zona waktu di test**

Di `web/vitest.config.ts`, tambahkan pada objek `test`:
```ts
    // Vercel berjalan UTC, mesin dev WIB. Tanpa ini, bug zona waktu
    // tidak akan pernah terlihat lokal.
    env: { TZ: "UTC" },
```

- [ ] **Step 2: Test waktu (MERAH dulu)**

Buat `web/tests/passport-waktu.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hariIniJakarta, formatTanggalID, formatTanggalPendek } from "@/lib/passport/waktu";

describe("waktu (proses berjalan TZ=UTC, seperti Vercel)", () => {
  it("hariIniJakarta mengembalikan YYYY-MM-DD", () => {
    expect(hariIniJakarta()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("hariIniJakarta memakai zona Jakarta, bukan UTC", () => {
    // 2026-08-28T22:30Z = 2026-08-29 05:30 WIB -> tanggalnya sudah 29.
    const utcMalam = new Date("2026-08-28T22:30:00Z");
    expect(hariIniJakarta(utcMalam)).toBe("2026-08-29");
  });

  it("formatTanggalID tidak mundur sehari di TZ UTC", () => {
    expect(formatTanggalID("2026-09-04")).toBe("4 September 2026");
    expect(formatTanggalID("2026-01-01")).toBe("1 Januari 2026");
  });

  it("formatTanggalPendek untuk stempel & kartu sesi", () => {
    expect(formatTanggalPendek("2026-09-04")).toEqual({ hari: "4", bulan: "SEP" });
  });
});
```

Run: `npm test -- tests/passport-waktu.test.ts` → MERAH (modul belum ada).

- [ ] **Step 3: Implementasi waktu**

Buat `web/src/lib/passport/waktu.ts`:
```ts
const ZONA = "Asia/Jakarta";

// en-CA menghasilkan YYYY-MM-DD — satu-satunya jalan aman mendapatkan
// "hari ini menurut Jakarta" tanpa aritmatika Date.
const FMT_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
});

export function hariIniJakarta(sekarang: Date = new Date()): string {
  return FMT_ISO.format(sekarang);
}

// Kolom `tanggal` bertipe date dan sudah berupa string YYYY-MM-DD.
// `new Date("2026-09-04")` = tengah malam UTC; di zona barat mundur sehari.
// Karena itu tanggal dirakit sebagai UTC tengah hari lalu diformat di zona
// Jakarta — aman untuk seluruh zona server.
function keDate(tgl: string): Date {
  return new Date(`${tgl}T12:00:00Z`);
}

const FMT_PANJANG = new Intl.DateTimeFormat("id-ID", {
  timeZone: ZONA, day: "numeric", month: "long", year: "numeric",
});

export function formatTanggalID(tgl: string): string {
  return FMT_PANJANG.format(keDate(tgl));
}

const FMT_HARI = new Intl.DateTimeFormat("id-ID", { timeZone: ZONA, day: "numeric" });
const FMT_BULAN = new Intl.DateTimeFormat("id-ID", { timeZone: ZONA, month: "short" });

export function formatTanggalPendek(tgl: string): { hari: string; bulan: string } {
  return {
    hari: FMT_HARI.format(keDate(tgl)),
    bulan: FMT_BULAN.format(keDate(tgl)).replace(".", "").toUpperCase(),
  };
}

// Perbandingan tanggal = perbandingan string. Jangan pernah pakai getTime().
export function sudahLewat(tgl: string, sekarang: string): boolean {
  return tgl < sekarang;
}
```

Run: `npm test -- tests/passport-waktu.test.ts` → HIJAU.

- [ ] **Step 4: Test kalkulasi turunan (MERAH dulu)**

Buat `web/tests/passport-turunan.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  progresPaket, gridStempel, sesiBerikutnya, badgeDari, susunTagihan,
  type SesiRingkas,
} from "@/lib/passport/turunan";

const s = (o: Partial<SesiRingkas>): SesiRingkas => ({
  id: "s1", serviceId: "svc1", namaLayanan: "Layanan", namaMitra: "Bidan A",
  tanggal: "2026-07-08", status: "selesai", clientPackageId: "pkg1",
  catatan: "", rekomendasi: "", statusBayar: "belum", ...o,
});

describe("progresPaket", () => {
  it("menghitung sesi selesai dalam paket", () => {
    const r = progresPaket({ totalSesi: 8, sesi: [
      s({ id: "a" }), s({ id: "b" }), s({ id: "c", status: "terjadwal" }),
    ]});
    expect(r).toEqual({ selesai: 2, total: 8, persen: 25 });
  });

  it("mengabaikan sesi di luar paket", () => {
    const r = progresPaket({ totalSesi: 8, sesi: [
      s({ id: "a" }), s({ id: "b", clientPackageId: null }),
    ]});
    expect(r.selesai).toBe(1);
  });

  it("tahan bila admin mengecilkan jumlah_sesi retroaktif (cap 100%)", () => {
    const r = progresPaket({ totalSesi: 2, sesi: [
      s({ id: "a" }), s({ id: "b" }), s({ id: "c" }),
    ]});
    expect(r.selesai).toBe(3);
    expect(r.total).toBe(2);
    expect(r.persen).toBe(100); // tidak 150%
  });

  it("klien tanpa paket (model hybrid) mengembalikan null", () => {
    expect(progresPaket({ totalSesi: null, sesi: [s({})] })).toBeNull();
  });
});

describe("gridStempel", () => {
  it("terisi = sesi selesai, satu penanda berikutnya, sisanya kosong", () => {
    const g = gridStempel({ totalSesi: 4, sesi: [
      s({ id: "a", tanggal: "2026-07-08" }),
      s({ id: "b", tanggal: "2026-07-15" }),
      s({ id: "c", tanggal: "2026-09-04", status: "terjadwal" }),
    ], sekarang: "2026-08-29" });
    expect(g.map((x) => x.jenis)).toEqual(["terisi", "terisi", "berikutnya", "kosong"]);
    expect(g[0].tanggal).toBe("2026-07-08");
    expect(g[2].tanggal).toBe("2026-09-04");
  });

  it("tidak menambah slot bila sesi selesai melebihi total", () => {
    const g = gridStempel({ totalSesi: 2, sesi: [
      s({ id: "a" }), s({ id: "b" }), s({ id: "c" }),
    ], sekarang: "2026-08-29" });
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.jenis === "terisi")).toBe(true);
  });

  it("sesi terjadwal yang sudah lewat BUKAN penanda berikutnya", () => {
    const g = gridStempel({ totalSesi: 3, sesi: [
      s({ id: "a" }),
      s({ id: "b", tanggal: "2026-08-01", status: "terjadwal" }),
    ], sekarang: "2026-08-29" });
    expect(g.map((x) => x.jenis)).toEqual(["terisi", "kosong", "kosong"]);
  });
});

describe("sesiBerikutnya", () => {
  it("memilih tanggal terdekat, bukan yang pertama ditemukan", () => {
    const r = sesiBerikutnya([
      s({ id: "jauh", tanggal: "2026-10-01", status: "terjadwal" }),
      s({ id: "dekat", tanggal: "2026-09-04", status: "terjadwal" }),
    ], "2026-08-29");
    expect(r!.id).toBe("dekat");
  });

  it("mengabaikan sesi terjadwal yang tanggalnya sudah lewat", () => {
    const r = sesiBerikutnya([s({ id: "x", tanggal: "2026-08-01", status: "terjadwal" })], "2026-08-29");
    expect(r).toBeNull();
  });

  it("sesi hari ini masih terhitung berikutnya", () => {
    const r = sesiBerikutnya([s({ id: "x", tanggal: "2026-08-29", status: "terjadwal" })], "2026-08-29");
    expect(r!.id).toBe("x");
  });

  it("mengembalikan null bila tidak ada", () => {
    expect(sesiBerikutnya([s({ status: "selesai" })], "2026-08-29")).toBeNull();
  });
});

describe("badgeDari", () => {
  it("satu badge per layanan yang punya sesi selesai, tanpa duplikat", () => {
    const b = badgeDari([
      s({ serviceId: "a", namaLayanan: "Massage" }),
      s({ serviceId: "a", namaLayanan: "Massage" }),
      s({ serviceId: "b", namaLayanan: "Yoga" }),
      s({ serviceId: "c", namaLayanan: "Nutrisi", status: "terjadwal" }),
    ]);
    expect(b.map((x) => x.serviceId).sort()).toEqual(["a", "b"]);
  });
});

describe("susunTagihan", () => {
  it("paket menjadi satu item; sesi dalam paket TIDAK jadi item sendiri", () => {
    const t = susunTagihan({
      paket: [{ id: "p1", nama: "Sankalpa Prima", jumlahSesi: 8, statusBayar: "lunas" }],
      sesi: [
        s({ id: "a", clientPackageId: "p1", statusBayar: "belum" }),
        s({ id: "b", clientPackageId: "p1", statusBayar: "belum" }),
      ],
    });
    // Seed nyata memang kontradiktif (paket lunas, sesi anggotanya belum) —
    // menampilkan sesi berpaket akan melahirkan "tagihan hantu".
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ jenis: "paket", status: "lunas" });
  });

  it("sesi lepas menjadi item tersendiri", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, statusBayar: "belum", namaLayanan: "Konsultasi", tanggal: "2026-09-05" })],
    });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ jenis: "sesi", id: "x", status: "belum" });
    expect(t[0].label).toContain("Konsultasi");
  });

  it("sesi batal tidak ditagih", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, status: "batal", statusBayar: "belum" })],
    });
    expect(t).toHaveLength(0);
  });
});
```

Run: `npm test -- tests/passport-turunan.test.ts` → MERAH.

- [ ] **Step 5: Implementasi turunan**

Buat `web/src/lib/passport/turunan.ts`:
```ts
import { formatTanggalID, sudahLewat } from "./waktu";

export type StatusSesi = "terjadwal" | "selesai" | "batal";
export type PayStatus = "belum" | "menunggu_verifikasi" | "lunas";

export type SesiRingkas = {
  id: string;
  serviceId: string;
  namaLayanan: string;
  namaMitra: string;
  tanggal: string;          // YYYY-MM-DD
  status: StatusSesi;
  clientPackageId: string | null;
  catatan: string;
  rekomendasi: string;
  statusBayar: PayStatus;
};

export type PaketRingkas = {
  id: string;
  nama: string;
  jumlahSesi: number;
  statusBayar: PayStatus;
};

const selesaiDalamPaket = (sesi: SesiRingkas[]) =>
  sesi
    .filter((s) => s.status === "selesai" && s.clientPackageId !== null)
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));

export function progresPaket(input: {
  totalSesi: number | null;
  sesi: SesiRingkas[];
}): { selesai: number; total: number; persen: number } | null {
  if (input.totalSesi === null) return null; // klien sesi-lepas (model hybrid)
  const selesai = selesaiDalamPaket(input.sesi).length;
  // `packages.jumlah_sesi` bisa diedit admin sehingga penyebut menyusut
  // retroaktif — persen dibatasi 100 supaya angka tetap jujur.
  const persen = input.totalSesi > 0
    ? Math.min(100, Math.round((selesai / input.totalSesi) * 100))
    : 0;
  return { selesai, total: input.totalSesi, persen };
}

export function sesiBerikutnya(
  sesi: SesiRingkas[],
  sekarang: string,
): SesiRingkas | null {
  const calon = sesi
    .filter((s) => s.status === "terjadwal" && !sudahLewat(s.tanggal, sekarang))
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));
  return calon[0] ?? null;
}

export function gridStempel(input: {
  totalSesi: number;
  sesi: SesiRingkas[];
  sekarang: string;
}): Array<{ jenis: "terisi" | "berikutnya" | "kosong"; tanggal?: string }> {
  const terisi = selesaiDalamPaket(input.sesi);
  const berikut = sesiBerikutnya(
    input.sesi.filter((s) => s.clientPackageId !== null),
    input.sekarang,
  );
  const slot: Array<{ jenis: "terisi" | "berikutnya" | "kosong"; tanggal?: string }> = [];
  for (let i = 0; i < input.totalSesi; i++) {
    if (i < terisi.length) slot.push({ jenis: "terisi", tanggal: terisi[i].tanggal });
    else if (i === terisi.length && berikut) slot.push({ jenis: "berikutnya", tanggal: berikut.tanggal });
    else slot.push({ jenis: "kosong" });
  }
  return slot;
}

export function badgeDari(sesi: SesiRingkas[]): Array<{ serviceId: string; nama: string }> {
  const peta = new Map<string, string>();
  for (const s of sesi) {
    if (s.status === "selesai") peta.set(s.serviceId, s.namaLayanan);
  }
  return [...peta].map(([serviceId, nama]) => ({ serviceId, nama }));
}

export type ItemTagihan = {
  jenis: "paket" | "sesi";
  id: string;
  label: string;
  status: PayStatus;
};

export function susunTagihan(input: {
  paket: PaketRingkas[];
  sesi: SesiRingkas[];
}): ItemTagihan[] {
  // Anotasi tipe eksplisit: tanpa ini TypeScript menyimpulkan tipe array dari
  // .map() sebagai {jenis:"paket"} dan push item "sesi" akan gagal kompilasi.
  const item: ItemTagihan[] = input.paket.map((p) => ({
    jenis: "paket",
    id: p.id,
    label: `${p.nama} · ${p.jumlahSesi} sesi`,
    status: p.statusBayar,
  }));

  // Hanya sesi LEPAS yang menjadi item. `sessions.status_bayar` untuk sesi
  // berpaket tidak relevan dan memang kontradiktif di data nyata — memakainya
  // akan melahirkan "tagihan hantu" saat presentasi.
  for (const s of input.sesi) {
    if (s.clientPackageId !== null) continue;
    if (s.status === "batal") continue;
    item.push({
      jenis: "sesi",
      id: s.id,
      label: `${s.namaLayanan} · ${formatTanggalID(s.tanggal)}`,
      status: s.statusBayar,
    });
  }
  return item;
}
```

- [ ] **Step 6: Verifikasi & commit**

Run: `npm test -- tests/passport-waktu.test.ts tests/passport-turunan.test.ts` → PASS.
Run: `npm test` → seluruh suite PASS (`TZ=UTC` baru mungkin membuat test lama yang rapuh terungkap — bila ada yang merah, itu bug nyata; perbaiki, jangan matikan `TZ`).

```bash
git add web && git commit -m "feat(plan4): util waktu zona Jakarta + kalkulasi turunan passport"
```

---

### Task 3: Lapisan data passport

**Files:**
- Create: `web/src/lib/passport/data.ts`, `web/tests/passport-data.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase`, tipe dari Task 2.
- Produces:
  - `ambilKlien(): Promise<KlienPassport | null>`
  - `ambilSesi(clientId): Promise<SesiRingkas[]>`
  - `ambilPaket(clientId): Promise<PaketRingkas[]>`
  - `ambilDaftarMateri(): Promise<MateriRingkas[]>` — **tanpa** `isi`/`url` (keterbukaan disimpulkan dari RLS, tidak perlu clientId)
  - `ambilMateriDetail(materialId): Promise<MateriDetail | null>` — dengan bab/video
  - `ambilPermintaanJadwal(clientId): Promise<PermintaanRingkas[]>`

- [ ] **Step 1: Test**

Buat `web/tests/passport-data.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signInAs } from "./helpers/as-user";

// Lapisan data memakai createServerSupabase (cookies), yang tidak tersedia di
// vitest. Yang diuji di sini adalah INVARIAN QUERY-nya lewat klien ber-sesi:
// bentuk data, gating, dan tidak bocornya isi materi.
describe("invarian query passport (lewat RLS sesi klien)", () => {
  it("klien hanya melihat sesinya sendiri", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k
      .from("sessions")
      .select("id, tanggal, status, catatan, rekomendasi, status_bayar, client_package_id, partner_id, services(id, nama)")
      .order("tanggal", { ascending: false });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].services).not.toBeNull();
  });

  it("nama mitra terbaca lewat partner_publik sebagai query terpisah", async () => {
    // Sengaja BUKAN embed: embed ke view bergantung inferensi relasi dan
    // kegagalannya senyap. Query terpisah selalu bekerja.
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.from("partner_publik").select("id, nama");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
    expect(data![0].nama).toBeTruthy();
  });

  it("daftar materi TIDAK memuat isi bab maupun URL video", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k
      .from("materials")
      .select("id, judul, tipe, deskripsi, service_id, material_chapters(id), material_videos(material_id)")
      .eq("aktif", true);
    expect(error).toBeNull();
    const json = JSON.stringify(data);
    expect(json).not.toContain("vimeo.com");
    expect(json.toLowerCase()).not.toContain("\"isi\"");
  });

  it("materi terkunci: judul terlihat, isi kosong", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k
      .from("materials")
      .select("judul, service_id, material_chapters(id), material_videos(material_id)")
      .eq("aktif", true);
    const adaTerkunci = data!.some(
      (m) => (m.material_chapters as unknown[]).length === 0 && m.material_videos === null,
    );
    expect(adaTerkunci).toBe(true); // seed menyediakan materi Lactation Hero yang belum dijalani
  });

  it("embed material_videos berbentuk OBJEK/null, bukan array", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("materials").select("material_videos(material_id)").eq("aktif", true);
    const nilai = data!.map((m) => m.material_videos);
    expect(nilai.every((v) => v === null || (typeof v === "object" && !Array.isArray(v)))).toBe(true);
  });
});
```

Run: `npm test -- tests/passport-data.test.ts` → sebagian MERAH sampai `partner_publik` (Task 1) & seed (Task 4) siap. Catat mana yang merah dan lanjutkan; test ini menjadi hijau penuh setelah Task 4.

- [ ] **Step 2: Implementasi lapisan data**

Buat `web/src/lib/passport/data.ts`:
```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { PaketRingkas, SesiRingkas } from "./turunan";

export type KlienPassport = {
  id: string;
  padmaId: string;
  nama: string;
  email: string;
  noHp: string;
  faseId: string;
  faseNama: string;
  faseSanskrit: string;
};

// SELURUH pembacaan passport memakai sesi pengguna: RLS yang menjadi penjaga,
// bukan UI. createAdminSupabase() DILARANG di jalur ini — ia menembus RLS dan
// akan mengirim isi materi terkunci ke RSC payload.
export async function ambilKlien(): Promise<KlienPassport | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("clients")
    .select("id, padma_id, nama, email, no_hp, phase_id, phases(nama, nama_sanskrit)")
    .eq("user_id", user.id)
    .maybeSingle();          // maybeSingle: klien belum tertaut bukan error
  if (!data) return null;

  const fase = data.phases as unknown as { nama: string; nama_sanskrit: string } | null;
  return {
    id: data.id, padmaId: data.padma_id, nama: data.nama, email: data.email,
    noHp: data.no_hp, faseId: data.phase_id,
    faseNama: fase?.nama ?? "", faseSanskrit: fase?.nama_sanskrit ?? "",
  };
}

export async function ambilSesi(clientId: string): Promise<SesiRingkas[]> {
  const supabase = await createServerSupabase();

  // DUA QUERY, digabung di JS — sengaja TIDAK memakai embed PostgREST ke
  // `partner_publik`. Embed ke sebuah VIEW bergantung pada inferensi relasi
  // yang tidak dijamin, dan kegagalannya SENYAP (nama bidan jadi null, atau
  // dengan `!inner` seluruh riwayat kosong tanpa error). Dua query selalu bekerja.
  const [{ data: sesi }, { data: mitra }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, tanggal, status, catatan, rekomendasi, status_bayar, client_package_id, service_id, partner_id, services(nama)")
      .eq("client_id", clientId)   // eksplisit, walau RLS sudah menyaring
      .order("tanggal", { ascending: false }),
    supabase.from("partner_publik").select("id, nama"),
  ]);

  const namaMitraPer = new Map((mitra ?? []).map((m) => [m.id as string, m.nama as string]));

  return (sesi ?? []).map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    namaLayanan: (r.services as unknown as { nama: string } | null)?.nama ?? "Layanan",
    namaMitra: namaMitraPer.get(r.partner_id) ?? "Tim PADMA",
    tanggal: r.tanggal,
    status: r.status,
    clientPackageId: r.client_package_id,
    catatan: r.catatan ?? "",
    rekomendasi: r.rekomendasi ?? "",
    statusBayar: r.status_bayar,
  }));
}

export async function ambilPaket(clientId: string): Promise<PaketRingkas[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("client_packages")
    .select("id, status, status_bayar, packages(nama, jumlah_sesi)")
    .eq("client_id", clientId)
    .eq("status", "aktif");

  return (data ?? []).map((r) => {
    const p = r.packages as unknown as { nama: string; jumlah_sesi: number } | null;
    return {
      id: r.id,
      nama: p?.nama ?? "Paket",
      jumlahSesi: p?.jumlah_sesi ?? 0,
      statusBayar: r.status_bayar,
    };
  });
}

export type MateriRingkas = {
  id: string; judul: string; tipe: "ebook" | "video";
  deskripsi: string; namaLayanan: string; terbuka: boolean; jumlahBab: number;
};

// Daftar materi: DILARANG menyebut `isi` atau `url`. Keterbukaan disimpulkan
// dari ADA/TIDAKNYA baris tergating yang dikembalikan RLS.
export async function ambilDaftarMateri(): Promise<MateriRingkas[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("materials")
    .select("id, judul, tipe, deskripsi, services(nama), material_chapters(id), material_videos(material_id)")
    .eq("aktif", true)          // policy chapters/videos TIDAK melihat materials.aktif
    .order("judul");

  return (data ?? []).map((m) => {
    const bab = (m.material_chapters ?? []) as unknown[];
    const video = m.material_videos as unknown as object | null;  // objek/null, bukan array
    return {
      id: m.id, judul: m.judul, tipe: m.tipe, deskripsi: m.deskripsi,
      namaLayanan: (m.services as unknown as { nama: string } | null)?.nama ?? "",
      terbuka: m.tipe === "ebook" ? bab.length > 0 : video !== null,
      jumlahBab: bab.length,
    };
  });
}

export type MateriDetail = {
  id: string; judul: string; tipe: "ebook" | "video"; deskripsi: string;
  namaLayanan: string;
  bab: Array<{ id: string; urutan: number; judul: string; isi: string }>;
  videoUrl: string | null;
};

export async function ambilMateriDetail(materialId: string): Promise<MateriDetail | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("materials")
    .select("id, judul, tipe, deskripsi, services(nama), material_chapters(id, urutan, judul, isi), material_videos(url)")
    .eq("id", materialId)
    .eq("aktif", true)
    .maybeSingle();
  if (!data) return null;

  const bab = ((data.material_chapters ?? []) as Array<{ id: string; urutan: number; judul: string; isi: string }>)
    .sort((a, b) => a.urutan - b.urutan);
  const video = data.material_videos as unknown as { url: string } | null;

  return {
    id: data.id, judul: data.judul, tipe: data.tipe, deskripsi: data.deskripsi,
    namaLayanan: (data.services as unknown as { nama: string } | null)?.nama ?? "",
    bab,
    videoUrl: video?.url ?? null,
  };
}

export type PermintaanRingkas = {
  id: string; namaLayanan: string; tanggal: string;
  preferensiWaktu: string; status: string;
};

export async function ambilPermintaanJadwal(clientId: string): Promise<PermintaanRingkas[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("booking_requests")
    .select("id, tanggal, preferensi_waktu, status, services(nama)")
    .eq("client_id", clientId)
    .eq("status", "menunggu")
    .order("tanggal");

  return (data ?? []).map((r) => ({
    id: r.id,
    namaLayanan: (r.services as unknown as { nama: string } | null)?.nama ?? "Layanan",
    tanggal: r.tanggal,
    preferensiWaktu: r.preferensi_waktu,
    status: r.status,
  }));
}
```

- [ ] **Step 3: Commit**

```bash
git add web && git commit -m "feat(plan4): lapisan data passport lewat sesi pengguna (RLS sebagai penjaga)"
```

---

### Task 4: Seed demo diperkaya

**Files:**
- Modify: `web/supabase/seed.sql`, `web/scripts/seed-users.ts`

**Konteks:** seed sekarang hanya memberi **1 dari 8 sesi dan 1 badge** — passport akan tampak kosong saat dipresentasikan, jauh dari cerita prototipe (6/8 sesi, 3 badge). Ini menentukan nilai demo.

**PENTING:** `tests/rls-firewall.test.ts` meng-assert klien Ananda **tepat 1 baris**. Jangan menambah baris `clients` untuk user Ananda.

- [ ] **Step 1: Perkaya sesi Ananda di `scripts/seed-users.ts`**

Ganti blok upsert `sessions` sehingga Ananda punya **6 sesi selesai dalam paket + 1 terjadwal + 1 sesi lepas belum dibayar**, memakai tiga layanan berbeda (menghasilkan 3 badge):

```ts
  const { error: sErr } = await admin.from("sessions").upsert(
    [
      // ---- 6 sesi SELESAI dalam paket Sankalpa Prima (progres 6/8) ----
      {
        id: "66666666-6666-6666-6666-666666666601",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101", // Fertility Massage
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-07-08", status: "selesai",
        catatan: "Sesi perkenalan. Pijat relaksasi & pemetaan kondisi awal — ketegangan menumpuk di punggung bawah, kualitas tidur kurang.",
        rekomendasi: "Jaga tidur 7–8 jam, mulai catat siklus haid di lembar yang kami berikan.",
      },
      {
        id: "66666666-6666-6666-6666-666666666602",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-07-15", status: "selesai",
        catatan: "Ketegangan punggung bawah jauh berkurang. Klien mulai rutin jalan pagi.",
        rekomendasi: "Lanjutkan jalan pagi 30 menit; kompres hangat bila pegal kembali.",
      },
      {
        id: "66666666-6666-6666-6666-666666666603",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111102", // Flow Yoga
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333302",
        tanggal: "2026-07-22", status: "selesai",
        catatan: "Latihan pernapasan & gerakan dasar. Klien cepat menangkap teknik napas diafragma.",
        rekomendasi: "Ulangi video Flow Yoga 15 Menit di Passport, 3× sepekan.",
      },
      {
        id: "66666666-6666-6666-6666-666666666604",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-07-29", status: "selesai",
        catatan: "Tubuh merespons baik; keluhan pegal hampir hilang. Suasana hati membaik.",
        rekomendasi: "Pertahankan rutinitas. Sesi berikutnya fokus area pinggul.",
      },
      {
        id: "66666666-6666-6666-6666-666666666605",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111103", // Konsultasi Nutrisi
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333302",
        tanggal: "2026-08-12", status: "selesai",
        catatan: "Evaluasi pola makan sepekan. Asupan protein & asam folat masih kurang dari kebutuhan promil.",
        rekomendasi: "Ikuti menu contoh di e-book Panduan Nutrisi Prekonsepsi; tambah 1 porsi protein tiap makan.",
      },
      {
        id: "66666666-6666-6666-6666-666666666606",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-08-19", status: "selesai",
        catatan: "Siklus tercatat lebih teratur dua bulan terakhir. Respons tubuh sangat baik.",
        rekomendasi: "Lanjutkan seluruh rutinitas — perjalanan Anda on track.",
      },
      // ---- sesi TERJADWAL berikutnya (slot ke-7 = penanda "berikutnya") ----
      {
        id: "66666666-6666-6666-6666-666666666607",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111102",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333302",
        tanggal: "2026-12-04", status: "terjadwal",
        catatan: "", rekomendasi: "",
      },
      // ---- sesi LEPAS yang belum dibayar (bahan halaman Bayar) ----
      {
        id: "66666666-6666-6666-6666-666666666608",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111103",
        client_package_id: null,
        partner_id: "33333333-3333-3333-3333-333333333302",
        tanggal: "2026-12-11", status: "terjadwal",
        catatan: "", rekomendasi: "", status_bayar: "belum",
      },
    ],
    { onConflict: "id" },
  );
  if (sErr) throw sErr;
```

**Catatan tanggal:** sesi terjadwal sengaja jauh (Des 2026) supaya test "sesi berikutnya" tidak mulai gagal sendiri saat tanggal terlewat. Fungsi turunan tetap menerima `sekarang` yang disuntikkan, jadi test unit tidak bergantung jam mesin.

- [ ] **Step 2: Perbaiki & perkaya bab materi di `supabase/seed.sql`**

Struktur materi seed **sudah benar** dan tidak perlu diubah (…701/…702 pada layanan …101 = terbuka untuk Ananda; …703/…704 pada layanan …106 Lactation Hero = terkunci). Dua hal yang perlu dibereskan:

**(a) Ketidakcocokan nyata:** deskripsi materi `…702` berbunyi "E-book 3 bab" padahal seed hanya membuat **2** bab. Tambahkan bab ketiga.

**(b) Isi bab terlalu tipis untuk demo** ("Isi bab satu (dummy)"). Ganti dengan teks yang pantas dibaca saat presentasi.

Ganti blok `insert into material_chapters` menjadi:
```sql
insert into material_chapters (id, material_id, urutan, judul, isi) values
  ('88888888-8888-8888-8888-888888888801','77777777-7777-7777-7777-777777777702',1,
   'Mengenal Fase Siklus',
   E'Siklus haid terbagi menjadi beberapa fase, dan masing-masing punya peran berbeda dalam perjalanan promil Anda.\n\nFase menstruasi menandai awal siklus. Setelahnya tubuh memasuki fase folikular, saat sel telur dipersiapkan. Puncaknya adalah ovulasi — inilah jendela paling subur. Setelah ovulasi, tubuh masuk fase luteal sampai siklus berikutnya dimulai.\n\nMencatat panjang siklus Anda selama tiga bulan akan sangat membantu tim PADMA menyesuaikan layanan. Bawa catatan itu ke sesi berikutnya.'),
  ('88888888-8888-8888-8888-888888888802','77777777-7777-7777-7777-777777777702',2,
   'Menandai Masa Subur',
   E'Tubuh memberi tanda saat memasuki masa subur, dan tanda-tanda ini bisa dikenali tanpa alat khusus.\n\nLendir serviks berubah menjadi lebih bening dan elastis, mirip putih telur mentah. Sebagian perempuan merasakan nyeri ringan di salah satu sisi perut bawah. Suhu tubuh basal juga naik tipis setelah ovulasi.\n\nTidak semua orang merasakan semuanya, dan itu normal. Yang penting adalah mengenali pola tubuh Anda sendiri — bukan membandingkannya dengan orang lain.'),
  ('88888888-8888-8888-8888-888888888804','77777777-7777-7777-7777-777777777702',3,
   'Kapan Perlu Berkonsultasi',
   E'Skrining PADMA adalah alat keselamatan awal, bukan pengganti pemeriksaan dokter.\n\nSegera periksakan diri bila Anda mengalami perdarahan di luar pola biasa, nyeri panggul yang menetap, atau siklus yang tiba-tiba berubah drastis. Bila Anda dan pasangan sudah berusaha selama satu tahun tanpa hasil — atau enam bulan bila usia Anda di atas 35 tahun — konsultasi ke dokter kandungan adalah langkah yang tepat.\n\nSampaikan juga kepada tim PADMA agar layanan Anda bisa disesuaikan.'),
  ('88888888-8888-8888-8888-888888888803','77777777-7777-7777-7777-777777777704',1,
   'Menyimpan ASI Perah',
   E'Isi bab ini sengaja hanya untuk klien yang sudah menjalani layanan Lactation Hero. Bila Anda dapat membacanya tanpa pernah menjalani layanan tersebut, gating materi sedang bocor.')
on conflict (id) do update set judul = excluded.judul, isi = excluded.isi, urutan = excluded.urutan;
```

Perbarui juga deskripsi `…702` agar konsisten (tetap "3 bab" — sekarang benar-benar 3).

- [ ] **Step 3: Verifikasi jumlahnya**

```bash
npx supabase db reset && npm run seed:users
docker exec -i supabase_db_web psql -U postgres -d postgres -c "
select (select count(*) from sessions where client_id='44444444-4444-4444-4444-444444444401' and status='selesai') as selesai,
       (select count(distinct service_id) from sessions where client_id='44444444-4444-4444-4444-444444444401' and status='selesai') as badge,
       (select count(*) from materials where aktif) as materi;"
```
Expected: `selesai = 6`, `badge = 3`, `materi >= 4`.

Run: `npm test` → seluruh suite PASS. **Perhatikan khusus** `tests/rls-firewall.test.ts` (klien Ananda tetap 1 baris `clients`) dan `tests/rls-materi.test.ts` (gating tetap benar).

- [ ] **Step 4: Commit**

```bash
git add web && git commit -m "feat(plan4): seed demo diperkaya — 6/8 sesi, 3 badge, materi terbuka & terkunci"
```

---

### Task 5: Shell passport — layout, resolusi klien, navigasi

**Files:**
- Create: `web/src/app/passport/nav.tsx`
- Modify: `web/src/app/passport/layout.tsx`

**Interfaces:**
- Produces: layout yang menyediakan klien terpakai ke seluruh sub-rute; `<NavPassport aktif={...} />` (tab desktop + bottom bar mobile).

- [ ] **Step 1: Layout dengan resolusi klien**

Ganti isi `web/src/app/passport/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilKlien } from "@/lib/passport/data";
import { NavPassport } from "./nav";

// JEBAKAN: tests/access-matrix-layouts.test.ts menuntut requireRole([...])
// muncul TEPAT SATU KALI di berkas ini, dengan daftar peran persis ["klien"].
// Jangan menambah pemanggilan kedua.
export default async function PassportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["klien"]);

  // User berperan klien yang belum tertaut ke baris clients bukan error —
  // arahkan ke halaman ramah, jangan biarkan query meledak PGRST116.
  const klien = await ambilKlien();
  if (!klien) redirect("/akun-belum-terhubung");

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-3xl px-4 pb-36 pt-8 sm:pb-16">
        <div className="mb-5 flex items-center justify-between">
          <span className="text-[13px] text-ink-soft">
            Masuk sebagai <b className="text-ink">{klien.nama}</b> · Klien
          </span>
          {/* Logout tetap <form method="post">: navigasi dokumen penuh
              menghapus Client Cache. Jangan diganti router.push(). */}
          <form action="/auth/keluar" method="post">
            <button className="text-[13px] font-bold text-leaf underline underline-offset-4">
              Keluar
            </button>
          </form>
        </div>
        <NavPassport />
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Navigasi**

Buat `web/src/app/passport/nav.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lotus } from "@/app/_landing/lotus";

const MENU = [
  { href: "/passport", label: "Beranda", ikon: "lotus" as const },
  { href: "/passport/sesi", label: "Sesi", ikon: "cal" as const },
  { href: "/passport/materi", label: "Materi", ikon: "book" as const },
  { href: "/passport/bayar", label: "Bayar", ikon: "qr" as const },
  { href: "/passport/profil", label: "Profil", ikon: "user" as const },
];

function Ikon({ jenis, className }: { jenis: string; className?: string }) {
  const p = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (jenis === "lotus") return <Lotus className={className} />;
  if (jenis === "cal")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17M8 2.8v3.7M16 2.8v3.7" strokeLinecap="round" />
      </svg>
    );
  if (jenis === "book")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <path d="M12 6.5C10 4.8 7 4.3 3.5 4.5v14c3.5-.2 6.5.3 8.5 2 2-1.7 5-2.2 8.5-2v-14C17 4.3 14 4.8 12 6.5z" strokeLinejoin="round" />
        <path d="M12 6.5v13.6" />
      </svg>
    );
  if (jenis === "qr")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" strokeLinejoin="round" />
        <path d="M14 14h3v3h-3zM20 14v6h-6" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" strokeLinecap="round" />
    </svg>
  );
}

function aktifkan(pathname: string, href: string): boolean {
  if (href === "/passport") return pathname === "/passport" || pathname === "/passport/ajukan";
  return pathname.startsWith(href);
}

export function NavPassport() {
  const pathname = usePathname();
  return (
    <>
      {/* Tab desktop */}
      <nav aria-label="Menu passport"
        className="mb-5 hidden gap-1.5 rounded-2xl border border-black/10 bg-white p-1.5 sm:flex">
        {MENU.map((m) => {
          const aktif = aktifkan(pathname, m.href);
          return (
            <Link key={m.href} href={m.href} aria-current={aktif ? "page" : undefined}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-[13px] font-bold transition ${
                aktif ? "bg-night text-gold-pale" : "text-ink-soft hover:text-night"
              }`}>
              <Ikon jenis={m.ikon} className="h-4 w-4" />
              {m.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom bar mobile */}
      <nav aria-label="Navigasi passport"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-gold/25 bg-night/95 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:hidden">
        {MENU.map((m) => {
          const aktif = aktifkan(pathname, m.href);
          return (
            <Link key={m.href} href={m.href} aria-current={aktif ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1 text-[10px] font-bold ${
                aktif ? "text-gold-bright" : "text-[#9DB09E]"
              }`}>
              <Ikon jenis={m.ikon} className="h-[21px] w-[21px]" />
              <span className="truncate">{m.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
```

- [ ] **Step 3: Verifikasi**

Run: `npm test -- tests/access-matrix-layouts.test.ts` → PASS (satu `requireRole(["klien"])`).
Run: `npm run build` → sukses.

- [ ] **Step 4: Commit**

```bash
git add web && git commit -m "feat(plan4): shell passport — layout, resolusi klien, navigasi desktop & mobile"
```

---

### Task 6: Beranda passport

**Files:**
- Create: `web/src/app/passport/_komponen/sampul.tsx`, `web/src/app/passport/_komponen/grid-stempel.tsx`, `web/src/app/passport/_komponen/kartu-info.tsx`
- Modify: `web/src/app/passport/page.tsx`

**Interfaces:**
- Consumes: `ambilKlien`, `ambilSesi`, `ambilPaket`, `ambilPermintaanJadwal`, kalkulasi Task 2.

**Rujukan desain:** prototipe `.pp-cover` (gradien ganda + bingkai emas `::before` `inset:10px`), `.pp-kind`, `.pp-name` (Marcellus 32px), `.pp-meta`, `.mrz` bentuk final (`PAD-2607-0012 · Sankalpa Prima · Sesi 6/8`), `.stamp-grid`/`.stamp-slot`, `.next-card`, `.qa-row`, `.badge-coin`.

- [ ] **Step 1: Sampul**

Buat `web/src/app/passport/_komponen/sampul.tsx`:
```tsx
import { Lotus } from "@/app/_landing/lotus";

export function SampulPassport({
  nama, padmaId, faseSanskrit, faseNama, sejak, ringkasProgres,
}: {
  nama: string; padmaId: string; faseSanskrit: string; faseNama: string;
  sejak: string; ringkasProgres: string | null;
}) {
  return (
    <section className="relative mb-6 overflow-hidden rounded-3xl border border-gold/30 p-8 pb-6 text-[#EFE6CE] shadow-2xl
      [background:radial-gradient(560px_300px_at_80%_-10%,rgba(47,106,72,.5),transparent_60%),linear-gradient(150deg,#12392A,#0A2B1F_70%)]">
      {/* bingkai emas dalam — detail kecil yang paling gampang hilang saat porting */}
      <div aria-hidden className="pointer-events-none absolute inset-2.5 rounded-2xl border border-gold/20" />

      <Lotus className="mx-auto mb-3.5 block w-[52px] text-gold-bright" />
      <p className="text-center text-[10.5px] font-bold uppercase tracking-[0.4em] text-gold-bright">
        Digital Care Passport
      </p>
      <h1 className="mt-2.5 text-center font-serif text-[32px] leading-tight text-[#F8F1DE]">{nama}</h1>

      <div className="mt-2.5 flex flex-wrap justify-center gap-3 text-xs text-[#B9C6B4]">
        <span>PADMA ID <b className="font-mono font-medium text-gold-pale">{padmaId}</b></span>
        <span>Fase <b className="font-mono font-medium uppercase text-gold-pale">{faseSanskrit} · {faseNama}</b></span>
        <span>Sejak <b className="font-mono font-medium uppercase text-gold-pale">{sejak}</b></span>
      </div>

      <p className="mt-4 overflow-hidden rounded-xl bg-black/25 px-3.5 py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-[#C9BE9A] max-sm:whitespace-normal max-sm:tracking-[0.14em] max-sm:text-[9.5px] sm:whitespace-nowrap">
        {padmaId}
        {ringkasProgres && (
          <>
            <span className="mx-1 text-[#6E8271]">·</span>
            {ringkasProgres}
          </>
        )}
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Grid stempel**

Buat `web/src/app/passport/_komponen/grid-stempel.tsx`:
```tsx
import { Lotus } from "@/app/_landing/lotus";
import { formatTanggalPendek } from "@/lib/passport/waktu";

type Slot = { jenis: "terisi" | "berikutnya" | "kosong"; tanggal?: string };

export function GridStempel({ slot }: { slot: Slot[] }) {
  return (
    <div className="mb-3.5 grid grid-cols-4 gap-2.5 sm:grid-cols-8">
      {slot.map((s, i) => {
        const t = s.tanggal ? formatTanggalPendek(s.tanggal) : null;
        if (s.jenis === "terisi") {
          const rot = ((i % 3) - 1) * 4 - 2; // rotasi ringan seperti stempel asli
          return (
            <div key={i} style={{ transform: `rotate(${rot}deg)` }}
              className="flex aspect-square flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full border-[1.8px] border-gold bg-[#FDF9EE] text-gold shadow-[inset_0_0_0_3px_#FDF9EE,inset_0_0_0_4px_rgba(217,179,106,.28)]">
              <Lotus className="w-[44%]" />
              <span className="font-mono text-[8.5px] text-[#8D6E33]">{t!.hari} {t!.bulan}</span>
            </div>
          );
        }
        if (s.jenis === "berikutnya") {
          return (
            <div key={i}
              className="flex aspect-square flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full border-[1.6px] border-dashed border-gold text-gold">
              <span className="font-mono text-[8.5px]">{t!.hari} {t!.bulan}</span>
              <span className="text-[9px]">terjadwal</span>
            </div>
          );
        }
        return (
          <div key={i}
            className="flex aspect-square items-center justify-center rounded-full border-[1.6px] border-dashed border-black/10 text-[10px] text-[#C6C0AC]">
            •
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Halaman Beranda**

Ganti isi `web/src/app/passport/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilPaket, ambilPermintaanJadwal, ambilSesi } from "@/lib/passport/data";
import { badgeDari, gridStempel, progresPaket, sesiBerikutnya } from "@/lib/passport/turunan";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { Lotus } from "@/app/_landing/lotus";
import { SampulPassport } from "./_komponen/sampul";
import { GridStempel } from "./_komponen/grid-stempel";

export const metadata = { title: "Digital Care Passport" };
// Dilarang menambahkan `export const revalidate` di rute passport:
// ia menghapus `private` dari Cache-Control sehingga respons boleh
// disimpan CDN bersama antar klien.

export default async function BerandaPassport() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const [sesi, paket, permintaan] = await Promise.all([
    ambilSesi(klien.id), ambilPaket(klien.id), ambilPermintaanJadwal(klien.id),
  ]);
  const sekarang = hariIniJakarta();
  const paketAktif = paket[0] ?? null;
  const progres = progresPaket({ totalSesi: paketAktif?.jumlahSesi ?? null, sesi });
  const slot = paketAktif
    ? gridStempel({ totalSesi: paketAktif.jumlahSesi, sesi, sekarang })
    : [];
  const berikut = sesiBerikutnya(sesi, sekarang);
  const badge = badgeDari(sesi);

  // "Sejak" dari sesi terawal, bukan clients.created_at (yang berubah tiap reset).
  const terawal = [...sesi].sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1))[0];
  const sejak = terawal
    ? formatTanggalID(terawal.tanggal).split(" ").slice(1).join(" ")
    : "—";

  return (
    <>
      <SampulPassport
        nama={klien.nama} padmaId={klien.padmaId}
        faseSanskrit={klien.faseSanskrit} faseNama={klien.faseNama}
        sejak={sejak}
        ringkasProgres={
          paketAktif && progres ? `${paketAktif.nama} · Sesi ${progres.selesai}/${progres.total}` : null
        }
      />

      {paketAktif && progres ? (
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="mb-4 font-serif text-xl text-night">
            Paket Aktif{" "}
            <span className="font-sans text-xs font-semibold text-ink-soft">
              {paketAktif.nama} · {paketAktif.jumlahSesi} sesi
            </span>
          </h2>
          <GridStempel slot={slot} />
          <div className="flex items-center justify-between text-[13px] text-ink-soft">
            <span>
              {progres.selesai} dari {progres.total} sesi selesai
              {berikut && ` · berikutnya ${formatTanggalID(berikut.tanggal)}`}
            </span>
            <b className="font-serif text-[15px] text-night">{progres.persen}%</b>
          </div>
        </section>
      ) : (
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="font-serif text-xl text-night">Perjalanan Anda</h2>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            Anda mengambil layanan per sesi. Riwayat lengkapnya ada di halaman Sesi.
          </p>
        </section>
      )}

      {/* Sesi berikutnya / permintaan menunggu */}
      {berikut ? (
        <div className="mb-3.5 flex items-center gap-3.5 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] p-4">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-night text-gold-bright">
            <Lotus className="w-5" />
          </span>
          <span className="text-[13px]">
            <b className="block text-sm">Sesi berikutnya: {berikut.namaLayanan}</b>
            <span className="text-ink-soft">
              {formatTanggalID(berikut.tanggal)} · {berikut.namaMitra} · datang ke rumah Anda
            </span>
          </span>
        </div>
      ) : (
        <div className="mb-3.5 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px]">
          <b className="block text-sm">Belum ada jadwal berikutnya</b>
          <span className="text-ink-soft">Ajukan jadwal — tim PADMA mengonfirmasi via WhatsApp.</span>
        </div>
      )}

      {permintaan.map((p) => (
        <div key={p.id} className="mb-3.5 rounded-2xl border border-dotted border-gold bg-[#FDFAF1] p-4 text-[13px]">
          <b className="block text-sm">Permintaan jadwal: {p.namaLayanan}</b>
          <span className="text-ink-soft">
            {formatTanggalID(p.tanggal)} · {p.preferensiWaktu} · menunggu konfirmasi tim PADMA
          </span>
        </div>
      ))}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link href="/passport/ajukan"
          className="rounded-xl bg-gold py-3.5 text-center font-bold text-[#FFF8EA]">
          + Ajukan Jadwal
        </Link>
        <Link href="/passport/materi"
          className="rounded-xl border-[1.5px] border-black/10 bg-white py-3.5 text-center font-bold text-night">
          Materi Saya
        </Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-4 font-serif text-xl text-night">Pencapaian</h2>
        {badge.length === 0 ? (
          <p className="text-[13px] italic text-ink-soft">
            Badge pertama terbit saat sesi pertama Anda selesai.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3.5">
            {badge.map((b) => (
              <div key={b.serviceId} className="w-[104px] text-center text-[11px] font-bold leading-tight text-[#6B5A2E]">
                <span className="mx-auto mb-2 flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-gold bg-[radial-gradient(circle_at_35%_30%,#FDF6E4,#F3E6C4)] text-gold shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_4px_rgba(217,179,106,.28)]">
                  <Lotus className="w-[34px]" />
                </span>
                {b.nama}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 4: Verifikasi manual**

`npm run dev`, login `ananda@padma.test`, buka `/passport`:
1. Sampul menampilkan nama, PADMA ID, fase, dan baris ringkas `… · Sankalpa Prima · Sesi 6/8`.
2. Grid stempel: **6 stempel lotus terisi**, 1 penanda "terjadwal", 1 kosong. Progres **75%**.
3. Kartu "Sesi berikutnya" muncul dengan nama bidan (bukan "Tim PADMA" — kalau tertulis begitu, `partner_publik` gagal).
4. Pencapaian: **3 badge**.
5. Lebar 390px: tidak ada scroll horizontal; bottom bar muncul, tab desktop hilang.
6. Matikan server dev.

Run: `npm run build` → sukses.

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "feat(plan4): beranda passport — sampul, grid stempel, sesi berikutnya, pencapaian"
```

---

### Task 7: Riwayat sesi

**Files:**
- Create: `web/src/app/passport/sesi/page.tsx`, `web/src/app/passport/_komponen/kartu-sesi.tsx`

- [ ] **Step 1: Kartu sesi (buka-tutup catatan)**

Buat `web/src/app/passport/_komponen/kartu-sesi.tsx`:
```tsx
"use client";

import { useState } from "react";
import { formatTanggalPendek } from "@/lib/passport/waktu";
import type { SesiRingkas } from "@/lib/passport/turunan";

export function KartuSesi({ sesi, berikutnya }: { sesi: SesiRingkas; berikutnya: boolean }) {
  const [buka, setBuka] = useState(false);
  const t = formatTanggalPendek(sesi.tanggal);
  // catatan/rekomendasi NOT NULL default '' — cek trim(), bukan != null.
  const adaCatatan = sesi.catatan.trim() !== "" || sesi.rekomendasi.trim() !== "";

  const pill =
    sesi.status === "selesai" ? "bg-leaf-soft text-leaf border-leaf/25"
    : sesi.status === "terjadwal" ? "bg-[#F7EDD3] text-[#8A6A1B] border-[#E9D9A8]"
    : "bg-black/5 text-ink-soft border-black/10";

  return (
    <div className={`overflow-hidden rounded-xl border bg-[#FFFEFA] ${berikutnya ? "border-[1.6px] border-dashed border-gold bg-[#FDFAF1]" : "border-black/10"}`}>
      <button type="button" disabled={!adaCatatan}
        onClick={() => setBuka((v) => !v)}
        aria-expanded={adaCatatan ? buka : undefined}
        className="flex w-full items-center gap-3.5 p-4 text-left disabled:cursor-default">
        <span className="w-[52px] flex-none border-r border-black/10 pr-3 text-center font-mono text-[11px] leading-tight text-ink-soft">
          <b className="block text-[19px] font-medium text-night">{t.hari}</b>
          {t.bulan}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm text-ink">{sesi.namaLayanan}</b>
          <span className="text-xs text-ink-soft">{sesi.namaMitra}</span>
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${pill}`}>
          {sesi.status === "selesai" ? "Selesai" : sesi.status === "terjadwal" ? "Terjadwal" : "Batal"}
        </span>
        {adaCatatan && (
          <svg width="14" viewBox="0 0 14 8" aria-hidden
            className={`flex-none text-ink-soft transition-transform ${buka ? "rotate-180" : ""}`}>
            <path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {buka && adaCatatan && (
        <div className="border-t border-dashed border-black/10 bg-paper p-4">
          {sesi.catatan.trim() !== "" && (
            <p className="mb-2.5 text-[13.5px] text-[#3C4C42]">
              <b className="mb-1 block text-[11px] uppercase tracking-wider text-gold">
                Catatan {sesi.namaMitra}
              </b>
              {sesi.catatan}
            </p>
          )}
          {sesi.rekomendasi.trim() !== "" && (
            <p className="text-[13.5px] text-[#3C4C42]">
              <b className="mb-1 block text-[11px] uppercase tracking-wider text-gold">
                Rekomendasi untuk Anda
              </b>
              {sesi.rekomendasi}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Halaman sesi**

Buat `web/src/app/passport/sesi/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilSesi } from "@/lib/passport/data";
import { sesiBerikutnya } from "@/lib/passport/turunan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { KartuSesi } from "../_komponen/kartu-sesi";

export const metadata = { title: "Riwayat Sesi" };

export default async function HalamanSesi() {
  const klien = await ambilKlien();
  if (!klien) notFound();
  const sesi = await ambilSesi(klien.id);
  const berikut = sesiBerikutnya(sesi, hariIniJakarta());

  return (
    <>
      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="mb-4 font-serif text-xl text-night">
          Riwayat Sesi{" "}
          <span className="font-sans text-xs font-semibold text-ink-soft">
            ketuk untuk membaca catatan bidan
          </span>
        </h1>
        {sesi.length === 0 ? (
          <p className="text-[13px] italic text-ink-soft">
            Riwayat sesi Anda akan muncul di sini setelah kunjungan pertama.
          </p>
        ) : (
          <div className="grid gap-3">
            {sesi.map((s) => (
              <KartuSesi key={s.id} sesi={s} berikutnya={s.id === berikut?.id} />
            ))}
          </div>
        )}
      </section>

      <Link href="/passport/ajukan"
        className="block rounded-xl bg-gold py-3.5 text-center font-bold text-[#FFF8EA]">
        + Ajukan Jadwal Baru
      </Link>
    </>
  );
}
```

- [ ] **Step 3: Verifikasi & commit**

`npm run dev` → `/passport/sesi`: 8 sesi tampil urut terbaru; ketuk sesi selesai → catatan & rekomendasi muncul; sesi terjadwal tidak bisa dibuka (tidak ada catatan). Matikan dev server.

```bash
npm run build && git add web && git commit -m "feat(plan4): riwayat sesi dengan catatan bidan"
```

---

### Task 8: Materi — daftar & reader berwatermark

**Files:**
- Create: `web/src/app/passport/materi/page.tsx`, `web/src/app/passport/materi/[id]/page.tsx`, `web/src/app/passport/_komponen/watermark.tsx`

**Interfaces:**
- Consumes: `ambilDaftarMateri`, `ambilMateriDetail`.

- [ ] **Step 1: Watermark**

Buat `web/src/app/passport/_komponen/watermark.tsx`:
```tsx
// Deterrent, bukan proteksi mutlak: teks tetap terbaca di View Source karena
// ada di RSC payload. Gunanya melacak sumber bila tangkapan layar tersebar —
// spec jujur menyatakan screenshot tidak bisa dicegah platform mana pun.
export function Watermark({ nama, padmaId }: { nama: string; padmaId: string }) {
  return (
    <div aria-hidden
      className="pointer-events-none absolute -inset-10 z-0 flex flex-wrap items-center justify-center gap-x-12 gap-y-16 rotate-[-24deg] font-mono text-[12.5px] uppercase text-night opacity-[0.075]">
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="whitespace-nowrap">{nama} · {padmaId}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Daftar materi**

Buat `web/src/app/passport/materi/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilDaftarMateri, ambilKlien } from "@/lib/passport/data";

export const metadata = { title: "Materi Panduan" };

export default async function HalamanMateri() {
  const klien = await ambilKlien();
  if (!klien) notFound();
  const materi = await ambilDaftarMateri();

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">
        Materi Panduan Anda{" "}
        <span className="font-sans text-xs font-semibold text-ink-soft">
          terbuka sesuai layanan yang Anda jalani
        </span>
      </h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {materi.map((m) => {
          const isi = (
            <>
              <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl text-[17px] ${
                m.terbuka ? "bg-leaf-soft text-leaf" : "bg-black/5 text-[#9A957F]"
              }`}>
                {m.terbuka ? (m.tipe === "ebook" ? "📖" : "▶") : "🔒"}
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] leading-tight">{m.judul}</b>
                <span className="text-[11.5px] text-ink-soft">
                  {m.terbuka
                    ? `${m.tipe === "ebook" ? "E-Book · baca di aplikasi" : "Video · tonton di aplikasi"} · ${m.namaLayanan}`
                    : "Terbuka setelah layanan terkait selesai"}
                </span>
              </span>
            </>
          );

          return m.terbuka ? (
            // prefetch default (rute dinamis) — JANGAN dipaksa true, itu akan
            // menarik isi bab ke Client Cache sebelum diklik.
            <Link key={m.id} href={`/passport/materi/${m.id}`}
              className="flex items-start gap-3.5 rounded-xl border border-black/10 bg-[#FFFEFA] p-4 transition hover:-translate-y-0.5 hover:border-gold">
              {isi}
            </Link>
          ) : (
            <div key={m.id} className="flex items-start gap-3.5 rounded-xl border border-black/10 bg-paper p-4 opacity-60">
              {isi}
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
        <span className="text-gold">🔒</span>
        Semua materi eksklusif untuk klien PADMA — hanya bisa dibaca &amp; ditonton
        di dalam aplikasi, tanpa unduhan. Setiap halaman ditandai identitas akun Anda.
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Reader**

Buat `web/src/app/passport/materi/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilMateriDetail } from "@/lib/passport/data";
import { Watermark } from "../../_komponen/watermark";

export const metadata = { title: "Materi" };

export default async function ReaderMateri({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;             // Next 16: params adalah Promise
  const klien = await ambilKlien();
  if (!klien) notFound();

  const m = await ambilMateriDetail(id);
  if (!m) notFound();

  // RLS mengembalikan bab/video hanya bila klien berhak. Kosong = terkunci.
  const berhak = m.tipe === "ebook" ? m.bab.length > 0 : m.videoUrl !== null;
  if (!berhak) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
        <h1 className="font-serif text-xl text-night">Materi ini belum terbuka</h1>
        <p className="mt-2 text-[13.5px] text-ink-soft">
          Materi terbuka setelah layanan terkait Anda jalani. Hubungi tim PADMA
          bila Anda merasa ini keliru.
        </p>
        <Link href="/passport/materi" className="mt-5 inline-block text-sm font-bold text-leaf underline underline-offset-4">
          ← Kembali ke Materi
        </Link>
      </section>
    );
  }

  return (
    <>
      <Link href="/passport/materi"
        className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold">
        ← Kembali ke Materi
      </Link>

      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7 text-[#EFE6CE]">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-gold/15 text-2xl text-gold-bright">
          {m.tipe === "ebook" ? "📖" : "▶"}
        </span>
        <span>
          <h1 className="font-serif text-xl text-[#F5EEDC]">{m.judul}</h1>
          <span className="text-xs text-[#A9BBAA]">
            {m.tipe === "ebook" ? "E-Book · baca di aplikasi" : "Video · tonton di aplikasi"} · {m.namaLayanan}
          </span>
        </span>
      </div>

      {m.deskripsi && (
        <div className="mb-4 rounded-2xl border border-black/10 bg-white p-6 text-[13.5px] text-[#3C4C42]">
          {m.deskripsi}
        </div>
      )}

      <section className="relative overflow-hidden rounded-2xl border border-black/10 bg-white p-6 select-none">
        <Watermark nama={klien.nama} padmaId={klien.padmaId} />
        <div className="relative z-10">
          {m.tipe === "video" ? (
            <>
              <div className="mb-3.5 flex aspect-video items-center justify-center rounded-xl border border-gold/30 bg-gradient-to-br from-pine to-[#081F16]">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/90 text-2xl text-[#132518]">▶</span>
              </div>
              <p className="text-[13px] text-ink-soft">
                Pemutar video diaktifkan pada fase berikutnya, memakai penyedia
                dengan tautan terproteksi (terkunci domain). Sampai saat itu,
                mintalah tautan pada tim PADMA lewat WhatsApp.
              </p>
            </>
          ) : (
            <div className="grid gap-6">
              {m.bab.map((b, i) => (
                <article key={b.id}>
                  <h2 className="mb-2 font-serif text-lg text-night">
                    <span className="mr-2 font-mono text-xs text-gold">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {b.judul}
                  </h2>
                  <p className="whitespace-pre-line text-sm leading-7 text-[#3C4C42]">{b.isi}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
        <span className="text-gold">🔒</span>
        Materi ini hanya dapat dibaca di dalam aplikasi — tidak ada berkas yang
        bisa diunduh atau diteruskan. Setiap halaman ditandai identitas Anda.
      </p>
    </>
  );
}
```

- [ ] **Step 4: Verifikasi**

`npm run dev`, `/passport/materi`:
1. Materi layanan yang sudah dijalani **terbuka**; materi Lactation Hero **terkunci** (judul terlihat, tidak bisa diklik).
2. Buka materi e-book → bab tampil, watermark diagonal "Ananda Putri · PAD-2607-0012" terlihat samar, teks tidak bisa diseleksi.
3. Coba akses langsung URL materi terkunci (`/passport/materi/<id-terkunci>`) → halaman "belum terbuka", **bukan** isi bab.
4. **View Source** halaman daftar materi: cari `vimeo.com` dan potongan isi bab → **tidak boleh ada**.
5. Matikan dev server.

Run: `npm test` → PASS. Run: `npm run build` → sukses.

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "feat(plan4): materi tergating + reader berwatermark tanpa unduhan"
```

---

### Task 9: Bayar & Ajukan jadwal (server action)

**Files:**
- Create: `web/src/lib/passport/aksi.ts`, `web/src/app/passport/bayar/page.tsx`, `web/src/app/passport/ajukan/page.tsx`, `web/src/app/passport/ajukan/form.tsx`, `web/src/app/passport/_komponen/qris.tsx`
- Modify: `web/tests/passport-keamanan.test.ts` (tambah test klaim bayar)

**Interfaces:**
- Produces: `klaimSudahBayar(jenis: "paket" | "sesi", id: string)`, `ajukanJadwal(formData: FormData)`.

- [ ] **Step 1: Test keamanan klaim bayar (tambahkan ke `passport-keamanan.test.ts`)**

```ts
describe("klaim pembayaran", () => {
  it("klien TIDAK punya jalur UPDATE langsung ke client_packages", async () => {
    const { k, clientId } = await klienDanId();
    const { data: cp } = await admin.from("client_packages")
      .select("id, status_bayar").eq("client_id", clientId).limit(1).single();

    const { data: ubah } = await k.from("client_packages")
      .update({ status_bayar: "lunas" }).eq("id", cp!.id).select();
    expect(ubah ?? []).toHaveLength(0);

    const { data: cek } = await admin.from("client_packages")
      .select("status_bayar").eq("id", cp!.id).single();
    expect(cek!.status_bayar).toBe(cp!.status_bayar); // tidak berubah
  });

  it("klien TIDAK punya jalur UPDATE langsung ke sessions", async () => {
    const { k, clientId } = await klienDanId();
    const { data: s } = await admin.from("sessions")
      .select("id, status").eq("client_id", clientId).eq("status", "terjadwal").limit(1).single();

    const { data: ubah } = await k.from("sessions")
      .update({ status: "selesai" }).eq("id", s!.id).select();
    expect(ubah ?? []).toHaveLength(0);

    const { data: cek } = await admin.from("sessions").select("status").eq("id", s!.id).single();
    expect(cek!.status).toBe("terjadwal");
  });
});
```

Run: `npm test -- tests/passport-keamanan.test.ts` → PASS (klien memang tidak punya policy UPDATE — test ini mengunci keadaan itu agar tidak dilonggarkan orang lain nanti).

- [ ] **Step 2: Server action**

Buat `web/src/lib/passport/aksi.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

// Server action adalah endpoint POST tersendiri: guard di layout/page TIDAK
// berlaku di sini. requireRole WAJIB ditulis di dalam action.
//
// Parameter sengaja TIDAK memuat status tujuan. Begitu status datang dari
// browser, seluruh rancangan runtuh — klien bisa menyetel "lunas".
async function klienSaatIni() {
  await requireRole(["klien"]);
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("clients").select("id").eq("user_id", user.id).maybeSingle();
  return data?.id ?? null;
}

export async function klaimSudahBayar(jenis: "paket" | "sesi", id: string) {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false as const, pesan: "Akun belum terhubung." };

  // Service role dipakai HANYA untuk menulis, dengan filter kepemilikan
  // eksplisit + syarat status asal. Nilai tujuan hardcoded.
  const admin = createAdminSupabase();
  const tabel = jenis === "paket" ? "client_packages" : "sessions";
  const { data, error } = await admin
    .from(tabel)
    .update({ status_bayar: "menunggu_verifikasi" })
    .eq("id", id)
    .eq("client_id", clientId)        // kepemilikan
    .eq("status_bayar", "belum")      // hanya dari 'belum'
    .select("id");

  if (error) return { ok: false as const, pesan: "Gagal memproses." };
  // UPDATE yang tertahan menghasilkan 0 baris TANPA error — jangan
  // melaporkan "berhasil" tanpa memeriksa jumlah barisnya.
  if ((data ?? []).length === 0) {
    return { ok: false as const, pesan: "Item tidak ditemukan atau statusnya sudah berubah." };
  }
  revalidatePath("/passport/bayar");
  return { ok: true as const };
}

export async function ajukanJadwal(formData: FormData) {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false as const, pesan: "Akun belum terhubung." };

  const serviceId = String(formData.get("layanan") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const waktu = String(formData.get("waktu") ?? "");
  const catatan = String(formData.get("catatan") ?? "").slice(0, 300);

  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return { ok: false as const, pesan: "Lengkapi layanan dan tanggal." };
  }
  if (!["pagi", "siang", "sore"].includes(waktu)) {
    return { ok: false as const, pesan: "Preferensi waktu tidak sah." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("booking_requests").insert({
    client_id: clientId,
    service_id: serviceId,
    tanggal,
    preferensi_waktu: waktu,
    catatan,
    status: "menunggu",     // hardcoded; trigger DB juga menolak nilai lain
  });
  if (error) return { ok: false as const, pesan: "Gagal mengirim permintaan." };

  revalidatePath("/passport");
  return { ok: true as const };
}
```

- [ ] **Step 3: Halaman Bayar**

Buat `web/src/app/passport/_komponen/qris.tsx` — QR dekoratif deterministik (bukan QR asli):
```tsx
export function QrisContoh() {
  // Pola deterministik (LCG berbenih tetap) supaya render server & klien sama.
  let seed = 26082026;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const kotak: React.ReactNode[] = [];
  for (let y = 0; y < 25; y++) {
    for (let x = 0; x < 25; x++) {
      const finder = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17);
      if (finder) {
        const lx = x > 17 ? x - 18 : x, ly = y > 17 ? y - 18 : y;
        if (lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4)) {
          kotak.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1F2E26" />);
        }
      } else if (rnd() > 0.52) {
        kotak.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1F2E26" />);
      }
    }
  }
  return (
    <svg viewBox="0 0 25 25" aria-label="Contoh QRIS"
      className="h-[150px] w-[150px] flex-none rounded-xl border border-black/10 bg-white p-2.5">
      {kotak}
    </svg>
  );
}
```

Buat `web/src/app/passport/bayar/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { ambilKlien, ambilPaket, ambilSesi } from "@/lib/passport/data";
import { susunTagihan } from "@/lib/passport/turunan";
import { bacaPengaturan } from "@/lib/settings";
import { QrisContoh } from "../_komponen/qris";
import { TombolKlaim } from "./tombol-klaim";

export const metadata = { title: "Pembayaran" };

export default async function HalamanBayar() {
  const klien = await ambilKlien();
  if (!klien) notFound();

  const [paket, sesi, pengaturan] = await Promise.all([
    ambilPaket(klien.id), ambilSesi(klien.id), bacaPengaturan(),
  ]);
  const tagihan = susunTagihan({ paket, sesi });

  const label: Record<string, { teks: string; kelas: string }> = {
    lunas: { teks: "Lunas", kelas: "bg-leaf-soft text-leaf border-leaf/25" },
    menunggu_verifikasi: { teks: "Menunggu verifikasi", kelas: "bg-[#F7EDD3] text-[#8A6A1B] border-[#E9D9A8]" },
    belum: { teks: "Belum dibayar", kelas: "bg-clay/10 text-clay border-clay/25" },
  };

  return (
    <>
      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="mb-4 font-serif text-xl text-night">
          Tagihan Anda{" "}
          <span className="font-sans text-xs font-semibold text-ink-soft">
            nominal disampaikan tim PADMA via WhatsApp
          </span>
        </h1>
        {tagihan.length === 0 ? (
          <p className="text-[13px] italic text-ink-soft">Belum ada tagihan.</p>
        ) : (
          tagihan.map((t) => (
            <div key={`${t.jenis}-${t.id}`} className="border-b border-dashed border-black/10 py-3 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <b className="text-[13.5px]">{t.label}</b>
                <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${label[t.status].kelas}`}>
                  {label[t.status].teks}
                </span>
              </div>
              {t.status === "belum" && (
                <TombolKlaim jenis={t.jenis} id={t.id} waLink={pengaturan.nomorWaLink} label={t.label} />
              )}
              {t.status === "menunggu_verifikasi" && (
                <p className="mt-2 text-xs text-ink-soft">
                  Tim PADMA sedang memverifikasi bukti Anda.
                </p>
              )}
            </div>
          ))
        )}
      </section>

      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-4 font-serif text-xl text-night">Cara Pembayaran</h2>
        <div className="flex flex-wrap items-center gap-5">
          <QrisContoh />
          <div className="min-w-[220px] flex-1 text-[13.5px] text-[#3C4C42]">
            <b className="mb-1 block text-[15px] text-ink">QRIS a.n. PADMA Wellness</b>
            Scan dengan aplikasi bank atau e-wallet apa pun. Setelah membayar,
            kirim bukti ke WhatsApp admin — tim kami memverifikasi secara manual.
            <span className="mt-2 block rounded-full border border-black/10 bg-paper px-2.5 py-1 text-[11px] text-ink-soft w-fit">
              Contoh QR — bukan untuk dipindai
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-3 font-serif text-xl text-night">Langkah pembayaran</h2>
        {[
          ["01", "Scan QRIS di atas, atau transfer sesuai arahan admin"],
          ["02", "Kirim bukti pembayaran ke WhatsApp PADMA"],
          ["03", "Tim memverifikasi & jadwal Anda terkunci"],
        ].map(([no, teks]) => (
          <p key={no} className="flex items-center gap-3 border-b border-dashed border-black/10 py-3 text-[13.5px] text-[#3C4C42] last:border-0">
            <span className="w-6 flex-none font-mono text-[11px] text-gold">{no}</span>
            {teks}
          </p>
        ))}
      </section>
    </>
  );
}
```

Buat `web/src/app/passport/bayar/tombol-klaim.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { klaimSudahBayar } from "@/lib/passport/aksi";

export function TombolKlaim({
  jenis, id, waLink, label,
}: {
  jenis: "paket" | "sesi"; id: string; waLink: string; label: string;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  function klik() {
    mulai(async () => {
      const r = await klaimSudahBayar(jenis, id);
      if (!r.ok) { setPesan(r.pesan); return; }
      const teks = `Halo PADMA, saya sudah membayar untuk:\n${label}\n\nBerikut bukti pembayarannya.`;
      window.open(`https://wa.me/${waLink}?text=${encodeURIComponent(teks)}`, "_blank", "noopener");
    });
  }

  return (
    <>
      <button type="button" onClick={klik} disabled={pending}
        className="mt-2.5 rounded-lg bg-[#1FAF57] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60">
        {pending ? "Memproses…" : "Saya sudah bayar — kirim bukti via WA"}
      </button>
      {pesan && <p className="mt-2 text-xs text-clay">{pesan}</p>}
    </>
  );
}
```

- [ ] **Step 4: Halaman Ajukan Jadwal**

Buat `web/src/app/passport/ajukan/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilKlien } from "@/lib/passport/data";
import { FormAjukan } from "./form";

export const metadata = { title: "Ajukan Jadwal" };

export default async function HalamanAjukan() {
  const klien = await ambilKlien();
  if (!klien) notFound();

  // Baca layanan dengan sesi pengguna (bukan bacaKatalog yang memfilter aktif
  // dengan anon key) agar daftar tetap utuh bagi klien.
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("services").select("id, nama").eq("aktif", true).order("nama");

  return <FormAjukan layanan={data ?? []} />;
}
```

Buat `web/src/app/passport/ajukan/form.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ajukanJadwal } from "@/lib/passport/aksi";

const WAKTU = ["pagi", "siang", "sore"] as const;

export function FormAjukan({ layanan }: { layanan: Array<{ id: string; nama: string }> }) {
  const [pending, mulai] = useTransition();
  const [waktu, setWaktu] = useState<(typeof WAKTU)[number]>("pagi");
  const [selesai, setSelesai] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  if (selesai) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-leaf/25 bg-leaf-soft text-2xl text-leaf">✓</span>
        <h1 className="font-serif text-xl text-night">Permintaan terkirim</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] text-[#415247]">
          Tim PADMA akan menghubungi Anda via WhatsApp untuk mengonfirmasi jadwal
          dan bidan yang datang.
        </p>
        <Link href="/passport" className="mt-5 inline-block rounded-xl border border-black/10 px-5 py-2.5 text-sm font-bold">
          Kembali ke Beranda
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">
        Ajukan Jadwal{" "}
        <span className="font-sans text-xs font-semibold text-ink-soft">
          tim PADMA mengonfirmasi via WhatsApp
        </span>
      </h1>

      <form
        action={(fd) => {
          fd.set("waktu", waktu);
          mulai(async () => {
            const r = await ajukanJadwal(fd);
            if (r.ok) setSelesai(true);
            else setPesan(r.pesan);
          });
        }}
      >
        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Layanan</span>
          <select name="layanan" required
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5">
            {layanan.map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}
          </select>
        </label>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Tanggal yang diinginkan</span>
          <input type="date" name="tanggal" required
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5" />
        </label>

        <fieldset className="mb-4">
          <legend className="text-sm font-semibold text-ink-soft">Preferensi waktu</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {WAKTU.map((w) => (
              <button key={w} type="button" onClick={() => setWaktu(w)}
                aria-pressed={waktu === w}
                className={`min-h-[44px] rounded-xl border px-2 py-3 text-[13px] font-semibold capitalize ${
                  waktu === w ? "border-night bg-leaf-soft text-night" : "border-black/15 bg-white"
                }`}>
                {w}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Catatan (opsional)</span>
          <textarea name="catatan" rows={2} maxLength={300}
            placeholder="mis. tolong dengan Bidan Sri seperti biasa"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5" />
        </label>

        {pesan && <p className="mb-3 text-sm text-clay">{pesan}</p>}

        <button type="submit" disabled={pending}
          className="w-full rounded-xl bg-gold py-3.5 font-bold text-[#FFF8EA] disabled:opacity-60">
          {pending ? "Mengirim…" : "Kirim Permintaan Jadwal"}
        </button>
        <p className="mt-3 text-center text-xs text-ink-soft">
          Ini permintaan, bukan booking final — jadwal pasti dikonfirmasi tim
          PADMA bersama Anda via WhatsApp.
        </p>
      </form>
    </section>
  );
}
```

- [ ] **Step 5: Verifikasi**

`npm run dev`, `/passport/bayar`: paket berstatus Lunas; sesi lepas berstatus "Belum dibayar" dengan tombol klaim. Klik tombol → status berubah menjadi "Menunggu verifikasi" dan tab WhatsApp terbuka. `/passport/ajukan`: kirim permintaan → panel sukses; kembali ke Beranda → kartu "Permintaan jadwal … menunggu konfirmasi" muncul.

Verifikasi DB:
```bash
docker exec -i supabase_db_web psql -U postgres -d postgres -c "select status from booking_requests order by created_at desc limit 1;"
```
Expected: `menunggu` (bukan `dikonfirmasi`).

Run: `npm test` → PASS. `npm run build` → sukses. Matikan dev server.

- [ ] **Step 6: Commit**

```bash
git add web && git commit -m "feat(plan4): halaman bayar dengan klaim status aman + ajukan jadwal"
```

---

### Task 10: Profil, E2E, dan verifikasi akhir

**Files:**
- Create: `web/src/app/passport/profil/page.tsx`, `web/tests/e2e/passport.e2e.ts`
- Modify: `web/package.json` (script E2E), `web/README.md`

- [ ] **Step 1: Halaman profil**

Buat `web/src/app/passport/profil/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";

export const metadata = { title: "Profil" };

export default async function HalamanProfil() {
  const klien = await ambilKlien();
  if (!klien) notFound();

  const baris: Array<[string, string]> = [
    ["Nama lengkap", klien.nama],
    ["PADMA ID", klien.padmaId],
    ["Email", klien.email],
    ["No. WhatsApp", klien.noHp],
    ["Fase perjalanan", `${klien.faseSanskrit} · ${klien.faseNama}`],
  ];

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">Profil</h1>
      {baris.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b border-dashed border-black/10 py-2.5 text-[13.5px] last:border-0">
          <span className="text-ink-soft">{k}</span>
          <b className={k === "PADMA ID" ? "font-mono font-medium" : ""}>{v}</b>
        </div>
      ))}
      <p className="mt-4 text-xs text-ink-soft">
        Ada data yang berubah? Hubungi tim PADMA via WhatsApp — demi keamanan,
        perubahan data dilakukan oleh admin.
      </p>
      <form action="/auth/keluar" method="post" className="mt-4">
        <button className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-bold">
          Keluar dari akun
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: E2E passport**

Buat `web/tests/e2e/passport.e2e.ts`:
```ts
/**
 * E2E Digital Care Passport (Plan 4).
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:passport`.
 */
import { chromium, type Browser, type BrowserContext } from "playwright";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];
function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 20_000 }),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page.close();
  return context;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await login(browser, "ananda@padma.test");
  const page = await ctx.newPage();

  // ---- 1. Beranda ----
  await page.goto(`${BASE}/passport`, { waitUntil: "networkidle" });
  const teksBeranda = (await page.textContent("body")) ?? "";
  catat("1a. sampul menampilkan nama & PADMA ID",
    teksBeranda.includes("Ananda Putri") && teksBeranda.includes("PAD-2607-0012"),
    "sampul terisi");
  catat("1b. progres paket 6 dari 8 (75%)",
    teksBeranda.includes("6 dari 8 sesi selesai") && teksBeranda.includes("75%"),
    teksBeranda.includes("75%") ? "75% tampil" : "progres TIDAK sesuai seed");
  const stempel = await page.locator("svg").count();
  catat("1c. grid stempel terisi merender lotus", stempel >= 6, `${stempel} svg di halaman`);
  const badge = await page.locator("text=Pencapaian").count();
  catat("1d. bagian pencapaian ada", badge > 0, "Pencapaian tampil");

  // ---- 2. Riwayat sesi & nama bidan ----
  await page.goto(`${BASE}/passport/sesi`, { waitUntil: "networkidle" });
  const teksSesi = (await page.textContent("body")) ?? "";
  catat("2a. nama bidan tampil (partner_publik bekerja)",
    teksSesi.includes("Bidan Sri Wahyuni") || teksSesi.includes("Bidan Dewi Lestari"),
    teksSesi.includes("Tim PADMA") ? "hanya 'Tim PADMA' — nama mitra GAGAL terbaca" : "nama bidan terbaca");
  await page.getByText("Sankalpa Fertility Massage").first().click();
  await page.waitForTimeout(300);
  const teksBuka = (await page.textContent("body")) ?? "";
  catat("2b. catatan bidan bisa dibuka",
    teksBuka.includes("Catatan") && teksBuka.includes("Rekomendasi untuk Anda"),
    "catatan & rekomendasi tampil");

  // ---- 3. Materi: gating & tidak bocor ----
  await page.goto(`${BASE}/passport/materi`, { waitUntil: "networkidle" });
  const htmlMateri = await page.content();
  catat("3a. URL video TIDAK ada di HTML daftar",
    !htmlMateri.includes("vimeo.com"),
    htmlMateri.includes("vimeo.com") ? "BOCOR: vimeo.com ditemukan" : "tidak ada URL video");
  catat("3b. isi bab TIDAK ada di HTML daftar",
    !htmlMateri.includes("Lendir serviks"),
    "isi bab tidak terkirim ke halaman daftar");
  catat("3c. materi terkunci tampil sebagai terkunci",
    htmlMateri.includes("Terbuka setelah layanan terkait selesai"),
    "penanda terkunci ada");

  // akses langsung URL materi terkunci
  const { data: terkunci } = await admin.from("materials")
    .select("id").eq("id", "77777777-7777-7777-7777-777777777704").single();
  await page.goto(`${BASE}/passport/materi/${terkunci!.id}`, { waitUntil: "networkidle" });
  const teksTerkunci = (await page.textContent("body")) ?? "";
  catat("3d. URL langsung materi terkunci ditolak",
    teksTerkunci.includes("belum terbuka") && !teksTerkunci.includes("Isi bab ini sengaja"),
    teksTerkunci.includes("Isi bab ini sengaja") ? "BOCOR: isi bab terbaca" : "ditolak dengan halaman ramah");

  // reader materi yang berhak + watermark
  await page.goto(`${BASE}/passport/materi/77777777-7777-7777-7777-777777777702`, { waitUntil: "networkidle" });
  const teksReader = (await page.textContent("body")) ?? "";
  catat("3e. reader menampilkan bab & watermark identitas",
    teksReader.includes("Mengenal Fase Siklus") && teksReader.includes("PAD-2607-0012"),
    "bab + watermark tampil");
  catat("3f. tidak ada tombol unduh",
    !/unduh|download/i.test(teksReader.replace(/tidak ada berkas yang\s+bisa diunduh/gi, "")),
    "tidak ada aksi unduh");

  // ---- 4. Klaim bayar ----
  await page.goto(`${BASE}/passport/bayar`, { waitUntil: "networkidle" });
  const tombol = page.getByRole("button", { name: /Saya sudah bayar/i });
  const adaTombol = (await tombol.count()) > 0;
  catat("4a. item belum dibayar punya tombol klaim", adaTombol, `${await tombol.count()} tombol`);
  if (adaTombol) {
    const [popup] = await Promise.all([
      page.waitForEvent("popup").catch(() => null),
      tombol.first().click(),
    ]);
    if (popup) await popup.close();
    await page.waitForTimeout(800);
    const { data: sesiBayar } = await admin.from("sessions")
      .select("status_bayar").eq("id", "66666666-6666-6666-6666-666666666608").single();
    catat("4b. status menjadi menunggu_verifikasi, BUKAN lunas",
      sesiBayar!.status_bayar === "menunggu_verifikasi",
      `status di DB: ${sesiBayar!.status_bayar}`);
    // kembalikan agar E2E idempoten
    await admin.from("sessions").update({ status_bayar: "belum" })
      .eq("id", "66666666-6666-6666-6666-666666666608");
  }

  // ---- 5. Ajukan jadwal ----
  await page.goto(`${BASE}/passport/ajukan`, { waitUntil: "networkidle" });
  await page.locator('input[name="tanggal"]').fill("2026-12-20");
  await page.getByRole("button", { name: "sore", exact: true }).click();
  await page.getByRole("button", { name: /Kirim Permintaan Jadwal/i }).click();
  await page.waitForTimeout(1000);
  const teksAjukan = (await page.textContent("body")) ?? "";
  catat("5a. permintaan terkirim", teksAjukan.includes("Permintaan terkirim"), "panel sukses tampil");
  const { data: br } = await admin.from("booking_requests")
    .select("status").eq("tanggal", "2026-12-20").order("created_at", { ascending: false }).limit(1);
  catat("5b. status permintaan = menunggu (bukan dikonfirmasi)",
    br?.[0]?.status === "menunggu", `status di DB: ${br?.[0]?.status ?? "(tidak ada)"}`);
  await admin.from("booking_requests").delete().eq("tanggal", "2026-12-20");

  // ---- 6. Responsif ----
  const mobil = await ctx.newPage();
  await mobil.setViewportSize({ width: 390, height: 844 });
  await mobil.goto(`${BASE}/passport`, { waitUntil: "networkidle" });
  const bottomTampil = await mobil.locator('nav[aria-label="Navigasi passport"]').isVisible();
  const tabTampil = await mobil.locator('nav[aria-label="Menu passport"]').isVisible();
  catat("6a. bottom bar tampil di 390px", bottomTampil, `bottom=${bottomTampil}`);
  catat("6b. tab desktop tersembunyi di 390px", !tabTampil, `tab=${tabTampil}`);
  const lebar = await mobil.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  catat("6c. tidak ada scroll horizontal di 390px", lebar <= 0, `selisih ${lebar}px`);

  await browser.close();
  const gagal = hasil.filter((h) => !h.lolos);
  console.log(
    `\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos` +
      (gagal.length ? `\nGAGAL: ${gagal.map((g) => g.nama).join(", ")}` : "\nPassport terbukti utuh & aman"),
  );
  process.exit(gagal.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Tambahkan script di `package.json`:
```json
"test:e2e:passport": "tsx tests/e2e/passport.e2e.ts",
"test:e2e:semua": "npm run test:e2e && npm run test:e2e:funnel && npm run test:e2e:passport"
```

- [ ] **Step 3: Verifikasi menyeluruh**

```bash
npx supabase db reset && npm run seed:users && npm test && npm run build
npm run dev &   # tunggu Ready
npm run test:e2e:semua
```
Expected: semua hijau. Matikan dev server; `lsof -ti tcp:3000` kosong.

- [ ] **Step 4: Perbarui README**

Tambahkan rute passport ke tabel rute di `web/README.md`.

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "feat(plan4): halaman profil + E2E passport + dokumentasi rute"
```

---

## Definition of Done — Plan 4

- [ ] Klien membuka `/passport` dan melihat sampul, **6 stempel terisi dari 8**, progres **75%**, dan **3 badge**.
- [ ] Riwayat sesi menampilkan **nama bidan** dan catatan/rekomendasi yang bisa dibuka.
- [ ] Materi yang layanannya sudah dijalani terbuka; yang belum tetap terkunci **meski URL-nya diakses langsung**.
- [ ] Isi bab dan URL video **tidak pernah** muncul di HTML halaman daftar materi.
- [ ] Reader menampilkan watermark identitas klien; tidak ada tombol unduh.
- [ ] Klaim bayar hanya bisa `belum → menunggu_verifikasi`; klien **tidak pernah** bisa menyetel `lunas`, dan tidak punya jalur UPDATE langsung ke `sessions`/`client_packages`.
- [ ] Permintaan jadwal dari klien selalu berstatus `menunggu` — `status='dikonfirmasi'` ditolak DB.
- [ ] Klien berperan `klien` yang belum tertaut diarahkan ke `/akun-belum-terhubung`, bukan error.
- [ ] Bottom bar mobile muncul di 390px tanpa scroll horizontal; tab desktop di lebar besar.
- [ ] `npm test` hijau seluruhnya, ketiga skrip E2E hijau, `npm run build` sukses.
