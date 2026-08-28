# PADMA v1 — Plan 2: Landing Publik, Skrining, & Inbox Admin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengunjung bisa membuka landing PADMA, mengisi skrining keselamatan, dan hasilnya tersimpan di server lalu muncul di Inbox Skrining admin untuk diverifikasi — funnel calon klien pertama yang benar-benar berjalan.

**Architecture:** Landing & wizard skrining adalah rute publik di app Next.js yang sama. Katalog layanan dirender **server-side** dari Postgres. Penilaian skrining (hijau/merah, flags) dihitung **di server** dari bank soal server-side — jawaban klien hanya berisi ya/tidak, tidak pernah `hasil`. Penyimpanan lewat route handler dengan service role, karena `anon` sengaja tidak punya hak tabel pada `screenings`.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase (Postgres+RLS), Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-padma-v1-design.md`
**Plan sebelumnya (sudah dieksekusi):** `docs/superpowers/plans/2026-08-28-padma-v1-plan1-fondasi.md`

## Global Constraints

- Seluruh teks UI berbahasa **Indonesia**. Root layout sudah `lang="id"` dengan template judul `%s · PADMA`.
- **Money firewall**: kolom nominal uang hanya di `service_rates` & `honor_marks`. Test struktural `tests/money-firewall-struktural.test.ts` akan MERAH bila dilanggar.
- `SUPABASE_SERVICE_ROLE_KEY` / `createAdminSupabase()` hanya di kode server. Tidak pernah di komponen `"use client"`.
- **Pencocokan identitas wajib operator setara (`.eq()`), tidak pernah pola (`.ilike`/`like`)** — berlaku untuk email, PADMA ID, dan **kode skrining**. Ini aturan mengikat hasil insiden LIKE-injection yang pernah membocorkan data pasien.
- **Data kesehatan tidak boleh muncul di URL, query string, atau log.** Kode skrining & hasil tidak boleh jadi query param. Dilarang `console.log` isi `jawaban`.
- Tabel baru: pakai `gen_random_uuid()`, **bukan** `serial`/`bigserial`. Fungsi/RPC baru wajib `revoke execute ... from public, anon` eksplisit.
- TypeScript `strict: true`. App di `web/`; perintah npm dijalankan dari sana. Node ≥ 20, Docker berjalan.
- Palet: night `#0A2B1F`, pine `#11382A`, leaf `#2F6A48`, gold `#B58A3C`, gold-bright `#D9B36A`, gold-pale `#F0E3C3`, paper `#FBF8F0`, paper-warm `#F5EFE1`, ink `#1F2E26`, ink-soft `#5D6C61`, clay `#A6472F` — tersedia sebagai utility (`bg-night`, `text-gold`, dst). Font: `font-serif`→Marcellus, body→Plus Jakarta Sans, `font-mono`→IBM Plex Mono.
- Akun demo: `owner@` / `admin@` / `ananda@padma.test`, password `padma-dev-123`.

## Pagar Keselamatan Medis (tidak boleh dilanggar tanpa persetujuan eksplisit)

Konten skrining adalah materi keselamatan pasien, bukan copy marketing.

1. **Urutan pertanyaan = urutan triase.** Jangan diurutkan ulang, dikelompokkan ulang, digabung, atau dipecah. Jumlah persis: umum 7 + prekonsepsi 3 / kehamilan 5 / nifas 5 / menopause 4.
2. **Level `fever` bergantung fase** — `review` secara default, tetapi **`urgent` pada fase kehamilan dan nifas**. Ini eskalasi keselamatan (kecurigaan korioamnionitis/sepsis puerperalis). Menyederhanakannya jadi string statis adalah regresi keselamatan senyap. Wajib ada test untuk keempat kombinasi fase.
3. **`pp_mental`** (pikiran menyakiti diri/bayi) tetap `urgent` dan tetap menghentikan skrining. Jangan diturunkan, jangan dipindah ke belakang.
4. **Blok darurat 119** tampil verbatim dan **hanya** pada merah-urgent. Menampilkannya di semua merah menormalkan alarm; menyembunyikannya pada urgent adalah bahaya nyata. Jangan diganti 112/911.
5. **Disclaimer wajib verbatim**: "Bukan diagnosis medis…", "Hasil ini adalah pra-skrining, bukan izin medis…", kotak "Jawaban jujur tidak merugikan Anda…", dan pada merah: "Ini penundaan demi keselamatan — bukan penolakan."
6. **Rujukan kepatuhan hanya ACOG & CDC** (sesuai prototipe). Jangan menambah NHS/WHO/POGI — klaim kepatuhan tanpa sumber adalah risiko hukum.
7. **Pertanyaan yang tidak sempat ditanyakan (karena berhenti-urgent) TIDAK BOLEH dicatat sebagai "tidak".** Simpan hanya yang benar-benar dijawab, plus penanda `dihentikan_pada`.
8. **Fase `newborn` (Shishu) tidak muncul di skrining** — hanya 4 pilihan. Yang diskrining adalah ibunya (masuk fase Nifas). Jangan merender pilihan fase langsung dari `select * from phases` (DB punya 5 baris).

## Keputusan Desain Plan 2

| # | Topik | Keputusan |
|---|---|---|
| A | Penilaian skrining | **Server-authoritative.** Klien mengirim `{nama, no_hp, fase, jawaban}`; server menghitung `hasil` & `flags` dari bank soal server-side. `hasil` dari klien tidak pernah dipercaya. |
| B | Penyimpanan | Route handler `POST /api/skrining` + `createAdminSupabase()`. Dilarang menambah policy/GRANT insert untuk `anon` pada `screenings`. |
| C | Kegagalan simpan | Klien **tetap** melihat hasil + tombol WhatsApp (spec §8: funnel tidak boleh mati). Chip "tersimpan" hanya muncul bila benar-benar tersimpan. |
| D | Katalog landing | Dirender server-side dari `phases` + `services` (data dummy keputusan #12, diganti client saat live) + policy baca publik. |
| E | Nomor WhatsApp | Dibaca server dari `app_settings.nomor_wa` (keputusan #11). Satu sumber, dua bentuk: tautan `wa.me` (internasional) & tampilan (lokal). |
| F | Flags | Simpan `[{id, level, teks}]` — level ikut disimpan agar admin bisa membedakan merah-urgent dari merah-review. Klien hanya melihat teksnya. |
| G | Progress bar | Diubah ke `(i+1)/n` supaya mencapai 100% di pertanyaan terakhir (prototipe memakai `i/n` sehingga mentok di bawah 100%). Perubahan disengaja. |

## Struktur Berkas

```
web/src/
  lib/
    skrining/
      bank-soal.ts        # bank soal + tipe (SATU sumber kebenaran, dipakai server & klien)
      evaluasi.ts         # nilaiSkrining(): hitung hasil & flags — murni, tanpa I/O
      kode.ts             # buatKodeSkrining(): PDM-YYMMDD-HHMM-XXXX kriptografis
      skema.ts            # skema Zod payload publik
    settings.ts           # bacaPengaturan(): app_settings -> {nomorWaLink, nomorWaTampilan}
    katalog.ts            # bacaKatalog(): phases + services untuk landing
  app/
    page.tsx              # landing (server component)
    _landing/             # komponen landing (Hero, LiniLayanan, CaraKerja, Passport, Pembanding, Footer)
    skrining/
      page.tsx            # shell server: ambil nomor WA, render wizard
      wizard.tsx          # "use client" — mesin wizard
    api/skrining/route.ts # POST: validasi, nilai, simpan
    admin/
      skrining/page.tsx   # inbox skrining
      _komponen/          # tabel inbox, baris detail, kontrol tindak lanjut
      nav.tsx             # shell nav admin (TIDAK memanggil requireRole — lihat jebakan)
web/tests/
  skrining-evaluasi.test.ts
  skrining-kode.test.ts
  skrining-api.test.ts
  landing-katalog.test.ts
  admin-inbox.test.ts
web/supabase/migrations/
  <ts>_baca_publik_katalog.sql
```

## Jebakan yang Sudah Terbukti Mahal (baca sebelum mulai)

- **Landing akan tampil KOSONG tanpa error** bila katalog diambil dengan anon key: `phases`/`services` punya `GRANT SELECT to anon` tetapi policy RLS-nya `using (auth.uid() is not null)` → pengunjung dapat `[]`, bukan `42501`. Task 1 menambah policy baca publik.
- **`tests/access-matrix-layouts.test.ts` mem-parse berkas layout** dan menuntut `requireRole([...])` muncul **tepat satu kali** per layout dengan daftar peran persis. Menambah sub-rute `/admin/skrining` AMAN. Menambahkan pemanggilan `requireRole` kedua di `admin/layout.tsx` (mis. untuk nav) membuat test MERAH — ambil `nama` di page, bukan di layout.
- **Spec §5 menulis kolom `fase_skrining`; DB nyatanya bernama `fase`.** Kode nyata menang.
- **`jawaban jsonb NOT NULL` tanpa default** — insert wajib mengisinya.
- **`kode` UNIQUE** — tangani bentrok dengan retry, jangan crash.
- **`zod` belum terpasang** (hanya transitif). Wajib `npm i zod`.
- **Kunci fase**: prototipe memakai `hamil`, DB memakai `kehamilan`. Plan ini memakai **`kehamilan`** di seluruh kode. Bila kunci override `fever` tidak ikut diganti, demam pada ibu hamil turun jadi `review` — kegagalan senyap paling mungkin di plan ini.

---

### Task 1: Fondasi bersama — Zod, policy baca publik, pembaca pengaturan & katalog

**Files:**
- Create: `web/supabase/migrations/<timestamp>_baca_publik_katalog.sql`, `web/src/lib/settings.ts`, `web/src/lib/katalog.ts`, `web/tests/landing-katalog.test.ts`
- Modify: `web/package.json` (dependency `zod`)

**Interfaces:**
- Produces:
  - `bacaPengaturan(): Promise<{ nomorWaLink: string; nomorWaTampilan: string }>`
  - `bacaKatalog(): Promise<Array<{ id: string; namaSanskrit: string; nama: string; urutan: number; layanan: string[] }>>`
  - Policy baca publik pada `phases`, `services`, `packages` (hanya baris aktif untuk services/packages).

- [ ] **Step 1: Pasang Zod**

```bash
cd web && npm i zod
```

- [ ] **Step 2: Test gagal dulu**

Buat `web/tests/landing-katalog.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { anonClient } from "./helpers/as-user";
import { bacaKatalog } from "@/lib/katalog";
import { bacaPengaturan } from "@/lib/settings";

describe("katalog publik", () => {
  it("pengunjung anonim bisa membaca phases (policy baca publik)", async () => {
    const { data, error } = await anonClient().from("phases").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBe(5);
  });

  it("pengunjung anonim bisa membaca services aktif", async () => {
    const { data, error } = await anonClient().from("services").select("id, nama");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });

  it("anon TETAP tidak bisa membaca data pasien", async () => {
    const { error } = await anonClient().from("clients").select("*");
    expect(error?.code).toBe("42501");
  });

  it("bacaKatalog mengembalikan 5 fase berurutan dengan layanannya", async () => {
    const katalog = await bacaKatalog();
    expect(katalog).toHaveLength(5);
    expect(katalog[0].namaSanskrit).toBe("Sankalpa");
    expect(katalog[0].urutan).toBe(1);
    expect(katalog[0].layanan.length).toBeGreaterThan(0);
  });

  it("bacaPengaturan mengembalikan nomor WA dua bentuk", async () => {
    const s = await bacaPengaturan();
    expect(s.nomorWaLink).toMatch(/^\d{10,15}$/);      // internasional tanpa +
    expect(s.nomorWaTampilan).toMatch(/^0[\d-]+$/);     // format lokal
  });
});
```

Run: `npm test -- tests/landing-katalog.test.ts`
Expected: FAIL — `phases` 0 baris untuk anon, dan modul `@/lib/katalog` belum ada.

- [ ] **Step 3: Migration policy baca publik**

```bash
npx supabase migration new baca_publik_katalog
```

Isi:
```sql
-- Landing publik harus bisa menampilkan katalog layanan tanpa login.
-- Policy lama `using (auth.uid() is not null)` membuat pengunjung anonim
-- menerima 0 baris TANPA error — kegagalan senyap yang membuat landing
-- tampil kosong. Di sini kita tambahkan policy baca publik yang EKSPLISIT.
--
-- Batas tegas: hanya katalog pemasaran. Tidak ada data pasien, tidak ada
-- angka uang. `service_rates` TIDAK disentuh — tetap owner-only.

create policy "phases: baca publik" on phases
  for select to anon using (true);

create policy "services: baca publik" on services
  for select to anon using (aktif = true);

create policy "packages: baca publik" on packages
  for select to anon using (aktif = true);
```

- [ ] **Step 4: Pembaca pengaturan & katalog**

Buat `web/src/lib/settings.ts`:
```ts
import { createAdminSupabase } from "@/lib/supabase/admin";

// `app_settings` sengaja tertutup untuk anon (migration cabut_grant_anon_berlebih),
// jadi nomor WA hanya bisa dibaca dari server dengan service role.
export async function bacaPengaturan() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .eq("key", "nomor_wa")
    .maybeSingle();

  const link = (data?.value ?? "6287778400200").replace(/\D/g, "");
  return { nomorWaLink: link, nomorWaTampilan: keFormatLokal(link) };
}

// 6287778400200 -> 0877-7840-0200
function keFormatLokal(internasional: string): string {
  const lokal = internasional.startsWith("62")
    ? "0" + internasional.slice(2)
    : internasional;
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}
```

Buat `web/src/lib/katalog.ts`:
```ts
import { createServerSupabase } from "@/lib/supabase/server";

export type FaseKatalog = {
  id: string;
  namaSanskrit: string;
  nama: string;
  urutan: number;
  layanan: string[];
};

// Dibaca dengan sesi biasa (anon) — policy baca publik yang mengizinkan.
// Katalog ini data dummy (keputusan #12); client menggantinya lewat panel admin.
export async function bacaKatalog(): Promise<FaseKatalog[]> {
  const supabase = await createServerSupabase();
  const [{ data: fases }, { data: layanan }] = await Promise.all([
    supabase.from("phases").select("id, nama_sanskrit, nama, urutan").order("urutan"),
    supabase.from("services").select("id, nama, phase_id").eq("aktif", true),
  ]);

  return (fases ?? []).map((f) => ({
    id: f.id,
    namaSanskrit: f.nama_sanskrit,
    nama: f.nama,
    urutan: f.urutan,
    layanan: (layanan ?? []).filter((s) => s.phase_id === f.id).map((s) => s.nama),
  }));
}
```

- [ ] **Step 5: Terapkan & verifikasi**

Run: `npx supabase db reset && npm test -- tests/landing-katalog.test.ts`
Expected: PASS (5 test).

Run: `npm test`
Expected: seluruh suite PASS (tidak ada regresi; test anon di `rls-firewall.test.ts` yang menuntut 42501 untuk `clients` harus tetap hijau).

- [ ] **Step 6: Commit**

```bash
git add web && git commit -m "feat(plan2): policy baca publik katalog + pembaca pengaturan & katalog + zod"
```

---

### Task 2: Bank soal & mesin penilaian skrining (murni, server-authoritative)

**Files:**
- Create: `web/src/lib/skrining/bank-soal.ts`, `web/src/lib/skrining/evaluasi.ts`, `web/tests/skrining-evaluasi.test.ts`

**Interfaces:**
- Produces:
  - `type FaseSkrining = "prekonsepsi" | "kehamilan" | "nifas" | "menopause"`
  - `type Level = "urgent" | "review"`
  - `type Soal = { id: string; teks: string; hint: string; level: Level | { default: Level; perFase: Partial<Record<FaseSkrining, Level>> } }`
  - `SOAL_UMUM: Soal[]`, `SOAL_FASE: Record<FaseSkrining, Soal[]>`
  - `daftarSoal(fase: FaseSkrining): Soal[]`
  - `levelSoal(soal: Soal, fase: FaseSkrining): Level`
  - `nilaiSkrining(fase, jawaban: Record<string, boolean>): { hasil: "hijau"|"merah"; urgent: boolean; flags: Array<{id:string; level:Level; teks:string}>; dihentikanPada: string | null }`
  - `LABEL_FASE: Record<FaseSkrining, string>`

- [ ] **Step 1: Test dulu — termasuk keempat kombinasi demam**

Buat `web/tests/skrining-evaluasi.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  SOAL_UMUM, SOAL_FASE, daftarSoal, levelSoal, LABEL_FASE,
  type FaseSkrining,
} from "@/lib/skrining/bank-soal";
import { nilaiSkrining } from "@/lib/skrining/evaluasi";

const SEMUA_FASE: FaseSkrining[] = ["prekonsepsi", "kehamilan", "nifas", "menopause"];

describe("bank soal — integritas triase", () => {
  it("jumlah soal persis seperti sumber medis", () => {
    expect(SOAL_UMUM).toHaveLength(7);
    expect(SOAL_FASE.prekonsepsi).toHaveLength(3);
    expect(SOAL_FASE.kehamilan).toHaveLength(5);
    expect(SOAL_FASE.nifas).toHaveLength(5);
    expect(SOAL_FASE.menopause).toHaveLength(4);
  });

  it("urutan triase: dua soal pertama adalah urgent kardiorespirasi & nyeri hebat", () => {
    expect(SOAL_UMUM[0].id).toBe("cardioresp");
    expect(SOAL_UMUM[1].id).toBe("severe_pain");
    expect(levelSoal(SOAL_UMUM[0], "prekonsepsi")).toBe("urgent");
    expect(levelSoal(SOAL_UMUM[1], "prekonsepsi")).toBe("urgent");
  });

  it("fase newborn TIDAK ada di skrining (yang diskrining ibunya)", () => {
    expect(Object.keys(SOAL_FASE).sort()).toEqual(
      ["kehamilan", "menopause", "nifas", "prekonsepsi"],
    );
    expect(Object.keys(LABEL_FASE)).not.toContain("newborn");
  });

  it("setiap soal punya id unik", () => {
    const semua = SEMUA_FASE.flatMap((f) => daftarSoal(f).map((s) => s.id));
    const perFase = SEMUA_FASE.map((f) => daftarSoal(f).map((s) => s.id));
    perFase.forEach((ids) => expect(new Set(ids).size).toBe(ids.length));
    expect(semua.length).toBeGreaterThan(0);
  });

  it("pp_mental tetap urgent dan tidak dipindah ke akhir", () => {
    const idx = SOAL_FASE.nifas.findIndex((s) => s.id === "pp_mental");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(levelSoal(SOAL_FASE.nifas[idx], "nifas")).toBe("urgent");
  });
});

describe("PAGAR KESELAMATAN: level demam bergantung fase", () => {
  const fever = SOAL_UMUM.find((s) => s.id === "fever")!;

  it("demam pada KEHAMILAN = urgent", () => {
    expect(levelSoal(fever, "kehamilan")).toBe("urgent");
  });
  it("demam pada NIFAS = urgent", () => {
    expect(levelSoal(fever, "nifas")).toBe("urgent");
  });
  it("demam pada PREKONSEPSI = review", () => {
    expect(levelSoal(fever, "prekonsepsi")).toBe("review");
  });
  it("demam pada MENOPAUSE = review", () => {
    expect(levelSoal(fever, "menopause")).toBe("review");
  });

  it("demam saat hamil menghentikan skrining (urgent), saat prekonsepsi tidak", () => {
    const hamil = nilaiSkrining("kehamilan", { cardioresp: false, severe_pain: false, fever: true });
    expect(hamil.hasil).toBe("merah");
    expect(hamil.urgent).toBe(true);
    expect(hamil.dihentikanPada).toBe("fever");

    const pre = nilaiSkrining("prekonsepsi", {
      cardioresp: false, severe_pain: false, fever: true, acute_infection: false,
      skin_wound: false, recent_procedure: false, restriction: false,
      pre_heavy_bleeding: false, pre_abnormal_bleeding: false, possible_pregnancy: false,
    });
    expect(pre.hasil).toBe("merah");
    expect(pre.urgent).toBe(false);
    expect(pre.dihentikanPada).toBeNull();
  });
});

describe("nilaiSkrining", () => {
  const semuaTidak = (fase: FaseSkrining) =>
    Object.fromEntries(daftarSoal(fase).map((s) => [s.id, false]));

  it("semua tidak -> hijau tanpa flag", () => {
    for (const fase of SEMUA_FASE) {
      const r = nilaiSkrining(fase, semuaTidak(fase));
      expect(r.hasil).toBe("hijau");
      expect(r.flags).toHaveLength(0);
      expect(r.urgent).toBe(false);
    }
  });

  it("satu review 'ya' -> merah non-urgent", () => {
    const j = { ...semuaTidak("menopause"), meno_lump: true };
    const r = nilaiSkrining("menopause", j);
    expect(r.hasil).toBe("merah");
    expect(r.urgent).toBe(false);
    expect(r.flags.map((f) => f.id)).toContain("meno_lump");
  });

  it("urgent 'ya' menghentikan: soal sesudahnya TIDAK dicatat sebagai tidak", () => {
    const r = nilaiSkrining("nifas", {
      cardioresp: false, severe_pain: false, fever: false, acute_infection: false,
      skin_wound: false, recent_procedure: false, restriction: false,
      pp_heavy_bleeding: true,
      // sisanya sengaja tidak dikirim — memang tidak pernah ditanyakan
    });
    expect(r.urgent).toBe(true);
    expect(r.dihentikanPada).toBe("pp_heavy_bleeding");
    expect(r.flags.map((f) => f.id)).toEqual(["pp_heavy_bleeding"]);
  });

  it("flags menyimpan level agar admin bisa bedakan urgent vs review", () => {
    const r = nilaiSkrining("kehamilan", {
      cardioresp: false, severe_pain: false, fever: false, acute_infection: true,
      skin_wound: false, recent_procedure: false, restriction: false,
      preg_bleeding_fluid: false, preg_headache_vision: false, preg_contractions: false,
      preg_fetal_movement: false, preg_highrisk: true,
    });
    expect(r.flags.every((f) => f.level === "review")).toBe(true);
    expect(r.flags.every((f) => typeof f.teks === "string" && f.teks.length > 10)).toBe(true);
  });

  it("jawaban untuk id yang tidak dikenal diabaikan (tidak bisa menyuntik flag)", () => {
    const r = nilaiSkrining("prekonsepsi", { ...semuaTidak("prekonsepsi"), id_palsu: true });
    expect(r.hasil).toBe("hijau");
    expect(r.flags).toHaveLength(0);
  });
});
```

Run: `npm test -- tests/skrining-evaluasi.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 2: Bank soal (verbatim dari prototipe, kunci fase disesuaikan DB)**

Buat `web/src/lib/skrining/bank-soal.ts`:
```ts
// SUMBER KEBENARAN TUNGGAL bank soal skrining keselamatan PADMA.
// Dipakai server (penilaian otoritatif) dan klien (menampilkan pertanyaan).
//
// PAGAR KESELAMATAN — jangan diubah tanpa persetujuan eksplisit:
//  * urutan = urutan triase; jangan diurutkan/dikelompokkan ulang
//  * jumlah: umum 7, prekonsepsi 3, kehamilan 5, nifas 5, menopause 4
//  * `fever` WAJIB urgent pada kehamilan & nifas (korioamnionitis/sepsis puerperalis)
//  * `pp_mental` WAJIB urgent dan tetap di posisinya
//  * fase `newborn` (Shishu) TIDAK diskrining — yang diskrining ibunya (fase nifas)

export type FaseSkrining = "prekonsepsi" | "kehamilan" | "nifas" | "menopause";
export type Level = "urgent" | "review";

export type LevelDinamis = {
  default: Level;
  perFase: Partial<Record<FaseSkrining, Level>>;
};

export type Soal = {
  id: string;
  teks: string;
  hint: string;
  level: Level | LevelDinamis;
};

export const LABEL_FASE: Record<FaseSkrining, string> = {
  prekonsepsi: "Prekonsepsi / Promil",
  kehamilan: "Kehamilan",
  nifas: "Nifas / Menyusui",
  menopause: "Menopause",
};

export const SOAL_UMUM: Soal[] = [
  {
    id: "cardioresp",
    level: "urgent",
    teks: "Apakah saat ini Anda mengalami nyeri dada, sesak napas yang tidak biasa, pingsan, atau kejang?",
    hint: "Jika Ya, jangan lanjutkan layanan wellness.",
  },
  {
    id: "severe_pain",
    level: "urgent",
    teks: "Apakah Anda mengalami nyeri sangat hebat, mendadak, menetap, atau kondisi yang terasa seperti keadaan darurat?",
    hint: "Termasuk nyeri perut/panggul berat yang baru muncul.",
  },
  {
    id: "fever",
    // Satu-satunya level bergantung fase. Kunci HARUS memakai id fase DB
    // ("kehamilan", bukan "hamil" seperti prototipe) — bila tidak sinkron,
    // demam pada ibu hamil diam-diam turun jadi "review".
    level: { default: "review", perFase: { kehamilan: "urgent", nifas: "urgent" } },
    teks: "Apakah suhu tubuh Anda 38°C atau lebih, atau Anda sedang demam/menggigil dan merasa sakit akut?",
    hint: "Demam saat hamil atau setelah melahirkan perlu perhatian lebih cepat.",
  },
  {
    id: "acute_infection",
    level: "review",
    teks: "Apakah Anda sedang mengalami penyakit menular akut, muntah/diare aktif, atau infeksi yang belum tertangani?",
    hint: "Layanan sebaiknya ditunda sampai kondisi akut membaik.",
  },
  {
    id: "skin_wound",
    level: "review",
    teks: "Apakah ada luka terbuka, infeksi kulit, atau area yang sedang meradang pada bagian tubuh yang akan ditangani?",
    hint: "Tim perlu menilai apakah layanan harus ditunda atau dimodifikasi.",
  },
  {
    id: "recent_procedure",
    level: "review",
    teks: "Apakah Anda baru menjalani operasi/prosedur invasif, atau sedang dalam masa pembatasan aktivitas?",
    hint: "Bila Ya, tim membutuhkan informasi tambahan sebelum menjadwalkan.",
  },
  {
    id: "restriction",
    level: "review",
    teks: "Apakah dokter/bidan pernah meminta Anda membatasi pijat, olahraga, atau aktivitas fisik karena kondisi medis saat ini?",
    hint: "PADMA akan mengikuti arahan klinis tersebut.",
  },
];

export const SOAL_FASE: Record<FaseSkrining, Soal[]> = {
  prekonsepsi: [
    {
      id: "pre_heavy_bleeding",
      level: "urgent",
      teks: "Apakah Anda mengalami perdarahan vagina sangat banyak disertai pusing/lemas, atau perdarahan dengan nyeri perut/panggul hebat?",
      hint: "Kondisi ini perlu evaluasi medis terlebih dahulu.",
    },
    {
      id: "pre_abnormal_bleeding",
      level: "review",
      teks: "Apakah Anda mengalami perdarahan di luar pola haid biasa dan belum pernah diperiksa?",
      hint: "Sebaiknya dinilai sebelum layanan wellness.",
    },
    {
      id: "possible_pregnancy",
      level: "review",
      teks: "Apakah haid Anda terlambat atau ada kemungkinan sedang hamil tetapi belum terkonfirmasi?",
      hint: "Tim menyesuaikan jenis layanan bila ada kemungkinan kehamilan.",
    },
  ],
  kehamilan: [
    {
      id: "preg_bleeding_fluid",
      level: "urgent",
      teks: "Apakah saat ini ada perdarahan dari vagina lebih dari bercak ringan, atau cairan ketuban merembes/pecah?",
      hint: "Ini termasuk warning sign kehamilan.",
    },
    {
      id: "preg_headache_vision",
      level: "urgent",
      teks: "Apakah Anda mengalami sakit kepala berat/menetap, pandangan kabur, pusing berat, atau bengkak mendadak pada wajah/tangan?",
      hint: "Perlu evaluasi medis segera.",
    },
    {
      id: "preg_contractions",
      level: "urgent",
      teks: "Apakah ada nyeri perut hebat yang tidak hilang, atau kontraksi teratur yang terasa tidak sesuai waktunya?",
      hint: "Jangan lanjutkan pijat/yoga sebelum dievaluasi.",
    },
    {
      id: "preg_fetal_movement",
      level: "urgent",
      teks: "Jika Anda sudah biasa merasakan gerakan janin: apakah gerakannya berhenti atau jelas lebih sedikit dari biasanya? (Bila belum biasa merasakannya, pilih Tidak.)",
      hint: "",
    },
    {
      id: "preg_highrisk",
      level: "review",
      teks: "Apakah kehamilan Anda memiliki komplikasi/risiko khusus, atau dokter memberi pembatasan aktivitas?",
      hint: "Contoh: diminta bed rest atau kehati-hatian khusus.",
    },
  ],
  nifas: [
    {
      id: "pp_heavy_bleeding",
      level: "urgent",
      teks: "Apakah perdarahan setelah melahirkan sangat banyak — membasahi ≥1 pembalut per jam, keluar bekuan besar, atau disertai pusing/lemas?",
      hint: "Perdarahan berat pasca melahirkan adalah warning sign.",
    },
    {
      id: "pp_headache_vision",
      level: "urgent",
      teks: "Apakah Anda mengalami sakit kepala berat/menetap, perubahan penglihatan, atau bengkak mendadak pada wajah/tangan?",
      hint: "Masalah tekanan darah bisa muncul setelah persalinan.",
    },
    {
      id: "pp_leg",
      level: "urgent",
      teks: "Apakah satu kaki/betis terasa lebih bengkak, merah, hangat, atau nyeri dibanding sisi lainnya?",
      hint: "Perlu menyingkirkan kemungkinan masalah pembuluh darah.",
    },
    {
      id: "pp_mental",
      level: "urgent",
      teks: "Apakah muncul pikiran ingin menyakiti diri sendiri atau bayi, atau Anda merasa tidak mampu menjaga keselamatan diri/bayi?",
      hint: "Ini membutuhkan bantuan segera dan tidak boleh ditunda.",
    },
    {
      id: "pp_breast",
      level: "review",
      teks: "Apakah payudara sangat nyeri, merah, bengkak, atau ada keluhan menyusui akut yang belum dinilai tenaga kesehatan?",
      hint: "Tim akan mengarahkan ke layanan yang tepat.",
    },
  ],
  menopause: [
    {
      id: "meno_bleeding",
      level: "review",
      teks: "Apakah ada perdarahan/bercak dari vagina setelah Anda tidak haid selama 12 bulan atau lebih?",
      hint: "Perdarahan pascamenopause perlu diperiksa lebih dulu.",
    },
    {
      id: "meno_pelvic",
      level: "review",
      teks: "Apakah ada nyeri panggul baru yang menetap atau semakin berat dan belum diperiksa?",
      hint: "Perlu klarifikasi penyebab sebelum treatment.",
    },
    {
      id: "meno_lump",
      level: "review",
      teks: "Apakah Anda menemukan benjolan baru pada payudara/perut/panggul yang belum pernah diperiksa?",
      hint: "Sebaiknya dinilai tenaga kesehatan terlebih dahulu.",
    },
    {
      id: "meno_weight",
      level: "review",
      teks: "Apakah berat badan turun nyata tanpa disengaja, atau ada gejala baru menetap yang belum diketahui penyebabnya?",
      hint: "Perlu evaluasi klinis bila signifikan.",
    },
  ],
};

export function daftarSoal(fase: FaseSkrining): Soal[] {
  return [...SOAL_UMUM, ...SOAL_FASE[fase]];
}

export function levelSoal(soal: Soal, fase: FaseSkrining): Level {
  if (typeof soal.level === "string") return soal.level;
  return soal.level.perFase[fase] ?? soal.level.default;
}
```

- [ ] **Step 3: Mesin penilaian**

Buat `web/src/lib/skrining/evaluasi.ts`:
```ts
import { daftarSoal, levelSoal, type FaseSkrining, type Level } from "./bank-soal";

export type Flag = { id: string; level: Level; teks: string };

export type HasilSkrining = {
  hasil: "hijau" | "merah";
  urgent: boolean;
  flags: Flag[];
  dihentikanPada: string | null;
};

// Otoritatif: hasil SELALU dihitung di server dari bank soal server-side.
// Klien hanya mengirim jawaban ya/tidak; `hasil` kiriman klien tidak dipercaya.
export function nilaiSkrining(
  fase: FaseSkrining,
  jawaban: Record<string, boolean>,
): HasilSkrining {
  const flags: Flag[] = [];
  let dihentikanPada: string | null = null;

  for (const soal of daftarSoal(fase)) {
    const dijawab = jawaban[soal.id];
    if (dijawab === undefined) continue; // tidak sempat ditanyakan
    if (!dijawab) continue;

    const level = levelSoal(soal, fase);
    flags.push({ id: soal.id, level, teks: soal.teks });

    if (level === "urgent") {
      // Berhenti seketika: pertanyaan sesudahnya memang tidak pernah ditanyakan
      // dan TIDAK boleh dicatat sebagai "tidak".
      dihentikanPada = soal.id;
      break;
    }
  }

  const urgent = flags.some((f) => f.level === "urgent");
  return {
    hasil: flags.length > 0 ? "merah" : "hijau",
    urgent,
    flags,
    dihentikanPada,
  };
}
```

- [ ] **Step 4: Verifikasi**

Run: `npm test -- tests/skrining-evaluasi.test.ts`
Expected: PASS (semua, termasuk 4 kombinasi demam).

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "feat(plan2): bank soal skrining + mesin penilaian server-authoritative"
```

---

### Task 3: Generator kode skrining

**Files:**
- Create: `web/src/lib/skrining/kode.ts`, `web/tests/skrining-kode.test.ts`

**Interfaces:**
- Produces: `buatKodeSkrining(sekarang?: Date): string` → format `PDM-YYMMDD-HHMM-XXXX` (XXXX alfanumerik kapital, kriptografis).

- [ ] **Step 1: Test dulu**

Buat `web/tests/skrining-kode.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buatKodeSkrining } from "@/lib/skrining/kode";

describe("kode skrining", () => {
  it("format persis PDM-YYMMDD-HHMM-XXXX", () => {
    const kode = buatKodeSkrining(new Date("2026-08-28T09:05:00"));
    expect(kode).toMatch(/^PDM-260828-0905-[A-Z0-9]{4}$/);
  });

  it("panjang selalu konsisten (zero-padded)", () => {
    const a = buatKodeSkrining(new Date("2026-01-02T03:04:00"));
    const b = buatKodeSkrining(new Date("2026-12-31T23:59:00"));
    expect(a).toHaveLength(b.length);
    expect(a).toMatch(/^PDM-260102-0304-/);
  });

  it("1000 kode berturut-turut tidak bentrok", () => {
    const set = new Set(Array.from({ length: 1000 }, () => buatKodeSkrining()));
    expect(set.size).toBe(1000);
  });
});
```

Run: `npm test -- tests/skrining-kode.test.ts` → Expected: FAIL (modul belum ada).

- [ ] **Step 2: Implementasi**

Buat `web/src/lib/skrining/kode.ts`:
```ts
import { randomInt } from "node:crypto";

const ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa I/O/0/1 agar mudah dibacakan

// Prototipe memakai Math.random() dan menghasilkan panjang tidak konsisten.
// Di sini: kriptografis, zero-padded, panjang tetap.
export function buatKodeSkrining(sekarang: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const tanggal =
    p(sekarang.getFullYear() % 100) + p(sekarang.getMonth() + 1) + p(sekarang.getDate());
  const jam = p(sekarang.getHours()) + p(sekarang.getMinutes());
  let acak = "";
  for (let i = 0; i < 4; i++) acak += ALFABET[randomInt(ALFABET.length)];
  return `PDM-${tanggal}-${jam}-${acak}`;
}
```

- [ ] **Step 3: Verifikasi & commit**

Run: `npm test -- tests/skrining-kode.test.ts` → PASS.

```bash
git add web && git commit -m "feat(plan2): generator kode skrining kriptografis"
```

---

### Task 4: Endpoint simpan skrining

**Files:**
- Create: `web/src/lib/skrining/skema.ts`, `web/src/app/api/skrining/route.ts`, `web/tests/skrining-api.test.ts`

**Interfaces:**
- Consumes: `nilaiSkrining` (Task 2), `buatKodeSkrining` (Task 3), `createAdminSupabase` (Plan 1).
- Produces: `POST /api/skrining` menerima `{nama, no_hp, fase, jawaban}` → `201 {kode}`. Tidak pernah menerima `hasil`.

- [ ] **Step 1: Test dulu**

Buat `web/tests/skrining-api.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { POST } from "@/app/api/skrining/route";

const admin = createAdminSupabase();
const dibuat: string[] = [];

function req(body: unknown) {
  return new Request("http://localhost/api/skrining", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  if (dibuat.length) await admin.from("screenings").delete().in("kode", dibuat);
});

describe("POST /api/skrining", () => {
  it("menyimpan skrining hijau dan mengembalikan kode", async () => {
    const res = await POST(req({
      nama: "Uji Hijau", no_hp: "0812-0000-0001", fase: "prekonsepsi",
      jawaban: {
        cardioresp: false, severe_pain: false, fever: false, acute_infection: false,
        skin_wound: false, recent_procedure: false, restriction: false,
        pre_heavy_bleeding: false, pre_abnormal_bleeding: false, possible_pregnancy: false,
      },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kode).toMatch(/^PDM-\d{6}-\d{4}-[A-Z0-9]{4}$/);
    dibuat.push(body.kode);

    const { data } = await admin.from("screenings").select("*").eq("kode", body.kode).single();
    expect(data!.hasil).toBe("hijau");
    expect(data!.status_tindak_lanjut).toBe("baru");
    expect(data!.fase).toBe("prekonsepsi");
  });

  it("SERVER yang menentukan hasil — `hasil` kiriman klien diabaikan", async () => {
    const res = await POST(req({
      nama: "Uji Palsu", no_hp: "0812-0000-0002", fase: "kehamilan",
      hasil: "hijau", // penyerang mencoba memaksa hijau
      jawaban: { cardioresp: true },
    }));
    expect(res.status).toBe(201);
    const { kode } = await res.json();
    dibuat.push(kode);

    const { data } = await admin.from("screenings").select("hasil, flags").eq("kode", kode).single();
    expect(data!.hasil).toBe("merah");
    expect((data!.flags as { id: string }[])[0].id).toBe("cardioresp");
  });

  it("flags menyimpan level untuk admin", async () => {
    const res = await POST(req({
      nama: "Uji Flag", no_hp: "0812-0000-0003", fase: "nifas",
      jawaban: {
        cardioresp: false, severe_pain: false, fever: true,
      },
    }));
    const { kode } = await res.json();
    dibuat.push(kode);
    const { data } = await admin.from("screenings").select("flags").eq("kode", kode).single();
    const flags = data!.flags as { id: string; level: string }[];
    // demam pada nifas = urgent (pagar keselamatan)
    expect(flags[0]).toMatchObject({ id: "fever", level: "urgent" });
  });

  it("menolak payload tidak valid", async () => {
    for (const bad of [
      { nama: "", no_hp: "08", fase: "prekonsepsi", jawaban: {} },
      { nama: "X", no_hp: "0812", fase: "newborn", jawaban: {} },   // fase tidak diskrining
      { nama: "X", no_hp: "0812", fase: "prekonsepsi" },             // jawaban hilang
    ]) {
      const res = await POST(req(bad));
      expect(res.status).toBe(400);
    }
  });

  it("anon TIDAK bisa insert langsung ke tabel (harus lewat endpoint)", async () => {
    const { anonClient } = await import("./helpers/as-user");
    const { error } = await anonClient().from("screenings").insert({
      kode: "PDM-000000-0000-XXXX", nama: "X", no_hp: "0",
      fase: "prekonsepsi", jawaban: {}, hasil: "hijau",
    });
    expect(error?.code).toBe("42501");
  });
});
```

Run: `npm test -- tests/skrining-api.test.ts` → Expected: FAIL (modul belum ada).

- [ ] **Step 2: Skema Zod**

Buat `web/src/lib/skrining/skema.ts`:
```ts
import { z } from "zod";

// Perhatikan: TIDAK ada field `hasil`. Hasil dihitung server (keputusan A).
export const SkemaSkriningPublik = z.object({
  nama: z.string().trim().min(2).max(80),
  no_hp: z.string().trim().min(8).max(25).regex(/^[0-9+\-\s()]+$/),
  fase: z.enum(["prekonsepsi", "kehamilan", "nifas", "menopause"]),
  jawaban: z.record(z.string().max(40), z.boolean()),
});

export type PayloadSkrining = z.infer<typeof SkemaSkriningPublik>;
```

- [ ] **Step 3: Route handler**

Buat `web/src/app/api/skrining/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { nilaiSkrining } from "@/lib/skrining/evaluasi";
import { buatKodeSkrining } from "@/lib/skrining/kode";
import { SkemaSkriningPublik } from "@/lib/skrining/skema";

// Rate limit sederhana per proses. Bukan pertahanan sempurna (Vercel serverless
// punya banyak instance), tapi cukup menahan penyalahgunaan kasual dan tidak
// memerlukan infrastruktur tambahan di v1.
const JEJAK = new Map<string, number[]>();
const JENDELA_MS = 60_000;
const MAKS_PER_JENDELA = 5;

function terlaluSering(ip: string): boolean {
  const sekarang = Date.now();
  const riwayat = (JEJAK.get(ip) ?? []).filter((t) => sekarang - t < JENDELA_MS);
  riwayat.push(sekarang);
  JEJAK.set(ip, riwayat);
  return riwayat.length > MAKS_PER_JENDELA;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "tak-dikenal";
  if (terlaluSering(ip)) {
    return NextResponse.json(
      { pesan: "Terlalu banyak percobaan. Coba lagi sebentar lagi." },
      { status: 429 },
    );
  }

  let mentah: unknown;
  try {
    mentah = await request.json();
  } catch {
    return NextResponse.json({ pesan: "Format tidak valid." }, { status: 400 });
  }

  const parsed = SkemaSkriningPublik.safeParse(mentah);
  if (!parsed.success) {
    // Jangan pernah mencatat isi `jawaban` (data kesehatan) ke log.
    return NextResponse.json({ pesan: "Data skrining tidak valid." }, { status: 400 });
  }

  const { nama, no_hp, fase, jawaban } = parsed.data;
  const penilaian = nilaiSkrining(fase, jawaban);
  const admin = createAdminSupabase();

  // `kode` UNIQUE — coba ulang bila bentrok, jangan crash.
  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const kode = buatKodeSkrining();
    const { error } = await admin.from("screenings").insert({
      kode,
      nama,
      no_hp,
      fase,
      jawaban: { ...jawaban, dihentikan_pada: penilaian.dihentikanPada },
      hasil: penilaian.hasil,
      flags: penilaian.flags,
    });
    if (!error) return NextResponse.json({ kode }, { status: 201 });
    if (error.code !== "23505") {
      return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
    }
  }
  return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
}
```

- [ ] **Step 4: Verifikasi & commit**

Run: `npm test -- tests/skrining-api.test.ts` → PASS.
Run: `npm test` → seluruh suite PASS.

```bash
git add web && git commit -m "feat(plan2): endpoint simpan skrining (server-authoritative, zod, rate limit)"
```

---

### Task 5: Halaman wizard skrining

**Files:**
- Create: `web/src/app/skrining/page.tsx`, `web/src/app/skrining/wizard.tsx`

**Interfaces:**
- Consumes: `bacaPengaturan` (Task 1), `bank-soal` (Task 2), `POST /api/skrining` (Task 4).
- Produces: rute publik `/skrining`.

- [ ] **Step 1: Shell server**

Buat `web/src/app/skrining/page.tsx`:
```tsx
import { bacaPengaturan } from "@/lib/settings";
import { Wizard } from "./wizard";

export const metadata = { title: "Skrining Awal Klien" };

export default async function SkriningPage() {
  const { nomorWaLink } = await bacaPengaturan();
  return (
    <main className="min-h-screen bg-paper px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-7 text-center">
          <h1 className="font-serif text-3xl text-night">Skrining Awal Klien</h1>
          <p className="mt-1 text-sm text-ink-soft">
            ± 2 menit · jawab sesuai kondisi Anda <b>saat ini</b>
          </p>
        </header>
        <Wizard nomorWaLink={nomorWaLink} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Mesin wizard**

Buat `web/src/app/skrining/wizard.tsx`:
```tsx
"use client";

import { useMemo, useState } from "react";
import {
  daftarSoal, levelSoal, LABEL_FASE, SOAL_UMUM,
  type FaseSkrining,
} from "@/lib/skrining/bank-soal";
// Modul murni tanpa dependensi server — aman diimpor di komponen klien.
// Dipakai HANYA untuk menampilkan hasil bila server gagal dihubungi;
// nilai yang tersimpan di DB tetap yang dihitung server (keputusan A).
import { nilaiSkrining } from "@/lib/skrining/evaluasi";

type Layar = "intro" | "soal" | "hasil";

type Hasil = {
  hasil: "hijau" | "merah";
  urgent: boolean;
  flags: string[];
  kode: string | null; // null = gagal simpan, funnel tetap jalan (keputusan C)
};

const FASE_PILIHAN: FaseSkrining[] = ["prekonsepsi", "kehamilan", "nifas", "menopause"];

export function Wizard({ nomorWaLink }: { nomorWaLink: string }) {
  const [layar, setLayar] = useState<Layar>("intro");
  const [nama, setNama] = useState("");
  const [hp, setHp] = useState("");
  const [jujur, setJujur] = useState(false);
  const [fase, setFase] = useState<FaseSkrining | null>(null);
  const [indeks, setIndeks] = useState(0);
  const [jawaban, setJawaban] = useState<Record<string, boolean>>({});
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const soal = useMemo(() => (fase ? daftarSoal(fase) : []), [fase]);
  const bolehMulai = Boolean(fase && nama.trim() && hp.trim() && jujur);

  async function selesai(jawabanFinal: Record<string, boolean>) {
    if (!fase) return;
    setSibuk(true);
    // Hitung tampilan lokal agar hasil tetap bisa ditampilkan walau server gagal.
    const lokal = nilaiSkrining(fase, jawabanFinal);
    let kode: string | null = null;
    try {
      const res = await fetch("/api/skrining", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nama, no_hp: hp, fase, jawaban: jawabanFinal }),
      });
      if (res.ok) kode = (await res.json()).kode;
    } catch {
      // Funnel tidak boleh mati (spec §8) — hasil tetap ditampilkan.
    }
    setHasil({
      hasil: lokal.hasil,
      urgent: lokal.urgent,
      flags: lokal.flags.map((f) => f.teks),
      kode,
    });
    setLayar("hasil");
    setSibuk(false);
  }

  function jawab(ya: boolean) {
    if (!fase) return;
    const s = soal[indeks];
    const baru = { ...jawaban, [s.id]: ya };
    setJawaban(baru);
    if (ya && levelSoal(s, fase) === "urgent") return void selesai(baru);
    if (indeks < soal.length - 1) setIndeks(indeks + 1);
    else void selesai(baru);
  }

  function kembali() {
    if (indeks === 0) return;
    const sebelumnya = soal[indeks - 1];
    const salinan = { ...jawaban };
    delete salinan[sebelumnya.id]; // hapus berdasarkan id, bukan teks
    setJawaban(salinan);
    setIndeks(indeks - 1);
  }

  if (layar === "intro") {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-7">
        <h2 className="font-serif text-xl text-night">Sebelum layanan dijadwalkan</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Skrining singkat ini membantu menentukan apakah layanan PADMA dapat
          dijadwalkan sekarang, atau sebaiknya diperiksa dokter lebih dulu demi
          keselamatan Anda.
        </p>

        <p className="mt-4 rounded-xl border border-black/10 bg-paper p-3.5 text-[13px]">
          <b>Bukan diagnosis medis.</b> Skrining ini hanya alat keselamatan awal
          untuk layanan wellness/homecare.
        </p>
        <p className="mt-3 rounded-xl border border-leaf/25 bg-leaf-soft p-3.5 text-[13px] text-[#28513C]">
          <b>Jawaban jujur tidak merugikan Anda.</b> Bila ada kondisi yang perlu
          perhatian, kami justru membantu mengarahkan agar layanan tetap aman —
          bukan menghukum atau mempersulit.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Nama panggilan</span>
            <input value={nama} onChange={(e) => setNama(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">No. WhatsApp</span>
            <input value={hp} onChange={(e) => setHp(e.target.value)} inputMode="tel"
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5" />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink-soft">Tahap kehidupan Anda</legend>
          <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {FASE_PILIHAN.map((f) => (
              <button key={f} type="button" onClick={() => setFase(f)}
                aria-pressed={fase === f}
                className={`min-h-[52px] rounded-xl border px-3 py-3 text-sm font-semibold ${
                  fase === f ? "border-night bg-leaf-soft text-night" : "border-black/15 bg-white"
                }`}>
                {LABEL_FASE[f]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 flex gap-3 rounded-xl border border-black/10 bg-paper-warm p-3.5 text-[13px]">
          <input type="checkbox" checked={jujur} onChange={(e) => setJujur(e.target.checked)}
            className="mt-0.5 h-[18px] w-[18px]" />
          <span>
            Saya menyatakan jawaban akan diisi sesuai kondisi saya <b>saat ini</b>,
            dan memahami bahwa tim PADMA tetap memverifikasi kondisi sebelum layanan.
          </span>
        </label>

        <button type="button" disabled={!bolehMulai} onClick={() => setLayar("soal")}
          className="mt-5 w-full rounded-xl bg-gold py-3.5 font-bold text-[#FFF8EA] disabled:opacity-45">
          Mulai Skrining
        </button>
      </section>
    );
  }

  if (layar === "soal" && fase) {
    const s = soal[indeks];
    const persen = Math.round(((indeks + 1) / soal.length) * 100);
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-7">
        <div className="mb-2 flex justify-between text-xs text-ink-soft">
          <span>Pertanyaan {indeks + 1} dari {soal.length}</span>
          <span>{persen}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
          <div className="h-full bg-gold transition-all" style={{ width: `${persen}%` }} />
        </div>

        <p className="mt-5 inline-block rounded-full border border-black/10 bg-paper px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-soft">
          {indeks < SOAL_UMUM.length ? "Skrining umum" : LABEL_FASE[fase]}
        </p>
        <p className="mt-3 font-serif text-xl leading-snug text-ink">{s.teks}</p>
        <p className="mt-2 min-h-[1.4em] text-[13px] text-ink-soft">{s.hint}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => jawab(true)} disabled={sibuk}
            className="min-h-[56px] rounded-xl border border-black/15 bg-white font-extrabold hover:border-clay hover:bg-clay/10 hover:text-clay">
            Ya
          </button>
          <button type="button" onClick={() => jawab(false)} disabled={sibuk}
            className="min-h-[56px] rounded-xl border border-black/15 bg-white font-extrabold hover:border-leaf hover:bg-leaf-soft hover:text-leaf">
            Tidak
          </button>
        </div>

        <button type="button" onClick={kembali} disabled={indeks === 0}
          className="mt-4 text-sm font-bold text-leaf underline underline-offset-4 disabled:opacity-40">
          ← Kembali
        </button>
      </section>
    );
  }

  if (layar === "hasil" && hasil && fase) {
    const hijau = hasil.hasil === "hijau";
    const pesanWa = [
      "Halo PADMA, saya sudah mengisi Skrining Awal Klien.",
      "",
      hasil.kode ? `Kode: ${hasil.kode}` : "(kode tidak tersimpan)",
      `Nama: ${nama}`,
      `Tahap: ${LABEL_FASE[fase]}`,
      `Hasil: ${hijau ? "HIJAU — dapat dijadwalkan" : "MERAH — belum dapat dijadwalkan"}`,
      "",
      hijau
        ? "Saya ingin melanjutkan booking. Mohon dibantu jadwalnya ya 🙏"
        : "Saya akan memeriksakan diri ke dokter lebih dulu sesuai arahan skrining.",
    ].join("\n");

    return (
      <section className="rounded-2xl border border-black/10 bg-white p-7 text-center">
        <div className={`inline-block -rotate-3 rounded-lg border-[2.5px] px-5 py-3 font-serif text-base uppercase tracking-widest ${
          hijau ? "border-leaf text-leaf" : "border-clay text-clay"
        }`}>
          {hijau ? "Hijau · Dapat Dijadwalkan" : "Merah · Perlu Evaluasi Dokter"}
        </div>

        <h2 className="mt-4 font-serif text-2xl text-night">
          {hijau ? "Layanan dapat dijadwalkan" : "Layanan belum dapat dijadwalkan"}
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-[#415247]">
          {hijau
            ? "Dari jawaban Anda tidak ditemukan alasan untuk menunda layanan. Tim PADMA tetap akan mengonfirmasi kondisi Anda sebelum layanan dimulai."
            : hasil.urgent
              ? "Jawaban Anda memuat tanda yang perlu penanganan medis. Untuk keselamatan Anda, hentikan dulu rencana treatment dan segera hubungi dokter. Ini penundaan demi keselamatan — bukan penolakan."
              : "Ada jawaban yang sebaiknya diperiksa tenaga kesehatan lebih dulu. Setelah dinyatakan aman, layanan PADMA dapat dijadwalkan kembali."}
        </p>

        {hasil.kode && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-dashed border-gold px-4 py-1.5 text-xs font-semibold text-[#6B5A2E]">
            ✓ Tersimpan di sistem PADMA · Kode <span className="font-mono">{hasil.kode}</span>
          </p>
        )}

        {hasil.flags.length > 0 && (
          <div className="mt-4 rounded-xl border border-black/10 bg-paper p-4 text-left">
            <h3 className="text-[13px] font-extrabold">Hal yang perlu diperhatikan</h3>
            <ul className="mt-2 list-disc pl-5 text-[13px] text-[#54463C]">
              {hasil.flags.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
        )}

        {hasil.urgent && (
          <p className="mt-4 rounded-lg border-l-4 border-clay bg-[#FDF3EF] p-3.5 text-left text-[13px] text-[#77321F]">
            Bila gejala berat atau memburuk cepat — sesak napas, perdarahan banyak,
            pingsan, kejang, atau nyeri hebat — cari pertolongan gawat darurat atau
            hubungi <b>119</b> sekarang, jangan menunggu.
          </p>
        )}

        <a href={`https://wa.me/${nomorWaLink}?text=${encodeURIComponent(pesanWa)}`}
          target="_blank" rel="noopener"
          className="mt-5 block w-full rounded-xl bg-[#1FAF57] py-3.5 font-bold text-white">
          {hijau ? "Lanjut booking via WhatsApp" : "Beri tahu tim PADMA (opsional)"}
        </a>

        <p className="mt-4 text-[11.5px] text-ink-soft">
          Hasil ini adalah pra-skrining, bukan izin medis. Tim PADMA memverifikasi
          kondisi sebelum layanan.
        </p>
      </section>
    );
  }

  return null;
}
```

- [ ] **Step 3: Verifikasi manual**

Jalankan `npm run dev`, buka `http://localhost:3000/skrining`:
1. Tombol "Mulai Skrining" nonaktif sampai nama, no HP, fase, dan checkbox terisi. ✓
2. Fase yang ditawarkan **4**, tanpa Newborn/Shishu. ✓
3. Pilih **Kehamilan**, jawab "Tidak" dua kali, lalu "Ya" pada demam → langsung ke hasil merah **dengan blok 119** (karena demam = urgent pada kehamilan). ✓
4. Ulangi dengan fase **Prekonsepsi**, "Ya" pada demam → skrining LANJUT (bukan berhenti), dan hasil akhirnya merah **tanpa** blok 119. ✓
5. Selesaikan satu skrining hijau → chip "Tersimpan" muncul dengan kode.
6. Cek DB: `select kode, hasil, fase from screenings order by created_at desc limit 3;`
7. Matikan server dev.

- [ ] **Step 4: Commit**

```bash
git add web && git commit -m "feat(plan2): halaman wizard skrining publik"
```

---

### Task 6: Landing publik

**Files:**
- Create: `web/src/app/_landing/hero.tsx`, `web/src/app/_landing/lini-layanan.tsx`, `web/src/app/_landing/cara-kerja.tsx`, `web/src/app/_landing/passport-teaser.tsx`, `web/src/app/_landing/pembanding.tsx`, `web/src/app/_landing/footer.tsx`, `web/src/app/_landing/lotus.tsx`
- Modify: `web/src/app/page.tsx`

**Interfaces:**
- Consumes: `bacaKatalog`, `bacaPengaturan` (Task 1).
- Produces: landing publik di `/`.

- [ ] **Step 1: Komponen lotus (dipakai ulang)**

Buat `web/src/app/_landing/lotus.tsx`:
```tsx
export function Lotus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 46" className={className} aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M32 6 C37.5 13 37.5 23 32 32 C26.5 23 26.5 13 32 6Z" />
      <path d="M19 12 C27 15.5 30.5 23.5 32 32 C24 30.5 17.5 22.5 19 12Z" />
      <path d="M45 12 C37 15.5 33.5 23.5 32 32 C40 30.5 46.5 22.5 45 12Z" />
      <path d="M7 21 C16.5 21.5 26.5 26.5 32 32 C22.5 34.5 11.5 30 7 21Z" />
      <path d="M57 21 C47.5 21.5 37.5 26.5 32 32 C41.5 34.5 52.5 30 57 21Z" />
      <path d="M14 36 C20 39.5 26 40.5 32 40.5 C38 40.5 44 39.5 50 36" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Hero**

Buat `web/src/app/_landing/hero.tsx`:
```tsx
import Link from "next/link";
import { Lotus } from "./lotus";

export function Hero({ waLink }: { waLink: string }) {
  return (
    <div className="relative overflow-hidden bg-night text-[#E9EFE7]">
      <Lotus className="pointer-events-none absolute -bottom-10 -right-14 w-[420px] text-gold-bright opacity-10" />
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Link href="/" className="flex items-center gap-3">
          <Lotus className="w-8 text-gold-bright" />
          <span className="font-serif text-xl tracking-[0.26em] text-[#F3EAD3]">PADMA</span>
        </Link>
        <Link href="/skrining"
          className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-[#FFF8EA]">
          Mulai Skrining
        </Link>
      </nav>

      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-10">
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold-bright">
          <span className="inline-block h-px w-6 bg-gold-bright" />
          Homecare promil &amp; perawatan perempuan
        </p>
        <h1 className="max-w-[14em] font-serif text-4xl leading-[1.14] text-[#F7F1E2] sm:text-5xl">
          Setiap fase hidup perempuan layak didampingi dengan care yang{" "}
          <em className="not-italic text-gold-bright">tercatat</em>.
        </h1>
        <p className="mt-5 max-w-[34em] text-[17px] text-[#BFCDBE]">
          Bidan berpengalaman datang ke rumah Anda — dan setiap sesi, catatan,
          serta rekomendasinya terdokumentasi rapi di Digital Care Passport
          pribadi Anda.
        </p>
        <div className="mt-8 flex flex-wrap gap-3.5">
          <Link href="/skrining"
            className="rounded-xl bg-gold px-6 py-3.5 font-bold text-[#FFF8EA]">
            Mulai Skrining Gratis · 2 menit
          </Link>
          <a href={`https://wa.me/${waLink}`} target="_blank" rel="noopener"
            className="rounded-xl border-[1.5px] border-gold/30 px-6 py-3.5 font-bold text-gold-pale">
            Chat WhatsApp
          </a>
        </div>

        <div className="mt-11 flex flex-wrap gap-7 border-t border-gold/20 pt-5 text-[13px] text-[#A9BBAA]">
          {[
            ["Skrining keselamatan", "mengikuti prinsip panduan ACOG & CDC"],
            ["Perawatan di rumah", "oleh mitra bidan berpengalaman"],
            ["Digital Care Passport", "satu klien, satu perjalanan terdokumentasi"],
          ].map(([judul, isi]) => (
            <p key={judul} className="flex max-w-[230px] gap-2.5">
              <span className="text-gold-bright">✦</span>
              <span><b className="text-[#E5DFC8]">{judul}</b><br />{isi}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Lini layanan (dinamis dari DB)**

Buat `web/src/app/_landing/lini-layanan.tsx`:
```tsx
import type { FaseKatalog } from "@/lib/katalog";

// Aksara Sanskerta per fase — dekorasi, dipetakan dari id fase.
const AKSARA: Record<string, string> = {
  prekonsepsi: "स", kehamilan: "ग", nifas: "पू", menopause: "ध", newborn: "शि",
};

export function LiniLayanan({ katalog }: { katalog: FaseKatalog[] }) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-11 max-w-[640px]">
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
          <span className="inline-block h-px w-6 bg-gold" />Lini Layanan
        </p>
        <h2 className="font-serif text-3xl text-night sm:text-4xl">Lima fase, satu perjalanan.</h2>
        <p className="mt-2 text-ink-soft">
          Setiap lini dinamai dari bahasa Sanskerta — karena setiap fase adalah
          babak yang bermakna.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        {katalog.map((f) => (
          <article key={f.id}
            className="rounded-2xl border border-black/10 bg-white p-6 transition hover:-translate-y-1 hover:border-gold/30 hover:shadow-lg">
            <div className="mb-3.5 flex items-center gap-2 font-serif text-[15px] tracking-widest text-gold">
              {AKSARA[f.id] ?? "◆"}
              <span className="h-px flex-1 bg-black/10" />
            </div>
            <h3 className="font-serif text-xl text-night">{f.namaSanskrit}</h3>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-soft">{f.nama}</p>
            <ul className="flex flex-wrap gap-1.5">
              {f.layanan.map((nama) => (
                <li key={nama}
                  className="rounded-full border border-black/10 bg-paper px-2.5 py-1 text-[11px] font-semibold text-[#4E6154]">
                  {nama}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Cara kerja, teaser passport, pembanding, footer**

Buat `web/src/app/_landing/cara-kerja.tsx`:
```tsx
const LANGKAH = [
  ["01", "Skrining awal", "Dua menit menjawab pertanyaan keselamatan — demi memastikan layanan aman untuk kondisi Anda saat ini."],
  ["02", "Jadwal via WhatsApp", "Tim PADMA menghubungi Anda, menyepakati layanan, jadwal, dan bidan yang datang."],
  ["03", "Perawatan di rumah", "Bidan datang ke rumah Anda. Tanpa antre, tanpa perjalanan, dalam suasana paling nyaman."],
  ["04", "Tercatat di Passport", "Catatan sesi, evaluasi, dan rekomendasi tersimpan di Digital Care Passport Anda — selamanya."],
];

export function CaraKerja() {
  return (
    <section className="border-y border-black/10 bg-paper-warm">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-11 max-w-[640px]">
          <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
            <span className="inline-block h-px w-6 bg-gold" />Cara Kerja
          </p>
          <h2 className="font-serif text-3xl text-night sm:text-4xl">
            Dari skrining sampai terdokumentasi.
          </h2>
        </div>
        <ol className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {LANGKAH.map(([no, judul, isi]) => (
            <li key={no} className="border-l border-black/10 pl-6">
              <span className="font-mono text-xs text-gold">{no}</span>
              <h3 className="mt-3 font-serif text-lg text-night">{judul}</h3>
              <p className="mt-2 text-[13.5px] text-ink-soft">{isi}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

Buat `web/src/app/_landing/pembanding.tsx`:
```tsx
import { Lotus } from "./lotus";

export function Pembanding() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-11 max-w-[640px]">
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
          <span className="inline-block h-px w-6 bg-gold" />Pembeda PADMA
        </p>
        <h2 className="font-serif text-3xl text-night sm:text-4xl">
          Homecare biasa, atau sebuah journey?
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-paper-warm p-7">
          <h3 className="font-serif text-xl text-night">Homecare biasa</h3>
          <ul className="mt-4 grid gap-2.5 text-[13.5px] text-[#4A594F]">
            {["Datang, treatment selesai, lalu selesai begitu saja",
              "Edukasi sering tidak terdokumentasi",
              "Klien sulit melihat perjalanan care secara utuh"].map((t) => (
              <li key={t} className="flex gap-3"><span className="font-extrabold text-[#B08573]">✕</span>{t}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7">
          <h3 className="font-serif text-xl text-[#F5EEDC]">Dengan Digital Care Passport</h3>
          <ul className="mt-4 grid gap-2.5 text-[13.5px] text-[#C2CFC1]">
            {["Layanan terasa lebih eksklusif dan personal",
              "Ada continuity of care dari sesi ke sesi",
              "Bonus edukasi tersimpan rapi dalam satu tempat",
              "Klien merasa dipandu, lebih tenang, dan lebih dihargai"].map((t) => (
              <li key={t} className="flex gap-3"><span className="font-extrabold text-gold-bright">✓</span>{t}</li>
            ))}
          </ul>
        </div>
      </div>

      <blockquote className="mt-6 rounded-2xl border border-gold/30 bg-night px-7 py-7 text-center font-serif text-lg text-[#F0E6CC] sm:text-xl">
        <Lotus className="mx-auto mb-3 w-8 text-gold-bright" />
        &ldquo;PADMA tidak hanya memberi layanan, tetapi membangun journey.&rdquo;
      </blockquote>
    </section>
  );
}
```

Buat `web/src/app/_landing/passport-teaser.tsx`:
```tsx
import Link from "next/link";

export function PassportTeaser() {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 py-20 md:grid-cols-2">
      <div>
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
          <span className="inline-block h-px w-6 bg-gold" />Digital Care Passport
        </p>
        <h2 className="font-serif text-3xl text-night sm:text-4xl">
          Bukan sekadar homecare. Perjalanan yang tercatat.
        </h2>
        <ul className="mt-5 grid gap-3 text-[14.5px] text-[#3C4C42]">
          {["Riwayat semua sesi & layanan Anda, rapi di satu tempat",
            "Catatan dan rekomendasi dari bidan setelah setiap kunjungan",
            "E-book & video panduan yang terbuka sesuai layanan Anda",
            "Progres paket yang terlihat — seperti stempel di paspor"].map((t) => (
            <li key={t} className="flex gap-3"><span className="font-extrabold text-gold">✦</span>{t}</li>
          ))}
        </ul>
        <Link href="/masuk"
          className="mt-7 inline-block rounded-xl bg-night px-6 py-3.5 font-bold text-gold-pale">
          Masuk ke Passport
        </Link>
      </div>

      <div className="mx-auto w-full max-w-[400px] -rotate-2 rounded-[22px] border border-gold/30 bg-gradient-to-br from-pine to-night p-8 text-[#EFE6CE] shadow-2xl">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.34em] text-gold-bright">
          Digital Care Passport
        </p>
        <p className="mt-2 text-center font-serif text-2xl text-[#F7F0DD]">Ananda Putri</p>
        <p className="text-center font-mono text-xs text-[#B9C6B4]">PAD-2607-0012</p>
        <dl className="mt-5 text-[12.5px]">
          {[["Fase perjalanan", "Sankalpa · Promil"],
            ["Paket aktif", "Sankalpa Prima · 8 sesi"],
            ["Progres", "6 dari 8 sesi"]].map(([k, v]) => (
            <div key={k} className="flex justify-between border-t border-gold/15 py-2.5">
              <dt>{k}</dt><dd className="font-semibold text-gold-pale">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-lg bg-black/25 px-3 py-2.5 text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#C9BE9A]">
          PAD-2607-0012 · Sankalpa Prima · Sesi 6/8
        </p>
      </div>
    </section>
  );
}
```

Buat `web/src/app/_landing/footer.tsx`:
```tsx
import { Lotus } from "./lotus";

export function Footer({ waTampilan }: { waTampilan: string }) {
  return (
    <footer className="bg-night px-6 py-14 text-[#9DB09E]">
      <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-8">
        <div>
          <p className="flex items-center gap-3">
            <Lotus className="w-7 text-gold-bright" />
            <span className="font-serif text-base tracking-[0.26em] text-[#F3EAD3]">PADMA</span>
          </p>
          <p className="mt-3.5 max-w-[300px] text-[12.5px]">
            Premium women&rsquo;s wellness homecare.<br />
            Personal · Terarah · Bermakna.
          </p>
        </div>
        <div className="text-[13px] leading-loose">
          <b className="text-[#DCE6DC]">Hubungi kami</b><br />
          WhatsApp: {waTampilan}<br />
          Melayani area Jabodetabek
        </div>
      </div>
      <p className="mx-auto mt-9 max-w-6xl border-t border-gold/15 pt-4 text-[11.5px] text-[#6E8271]">
        © PADMA 2026.
      </p>
    </footer>
  );
}
```

- [ ] **Step 5: Rakit landing**

Ganti isi `web/src/app/page.tsx`:
```tsx
import { bacaKatalog } from "@/lib/katalog";
import { bacaPengaturan } from "@/lib/settings";
import { Hero } from "./_landing/hero";
import { LiniLayanan } from "./_landing/lini-layanan";
import { CaraKerja } from "./_landing/cara-kerja";
import { PassportTeaser } from "./_landing/passport-teaser";
import { Pembanding } from "./_landing/pembanding";
import { Footer } from "./_landing/footer";

export default async function Home() {
  const [katalog, pengaturan] = await Promise.all([bacaKatalog(), bacaPengaturan()]);
  return (
    <main className="bg-paper">
      <Hero waLink={pengaturan.nomorWaLink} />
      <LiniLayanan katalog={katalog} />
      <CaraKerja />
      <PassportTeaser />
      <Pembanding />
      <Footer waTampilan={pengaturan.nomorWaTampilan} />
    </main>
  );
}
```

- [ ] **Step 6: Verifikasi**

Run: `npm run build` → sukses.
Jalankan `npm run dev`, buka `http://localhost:3000` **tanpa login** (mode incognito):
1. Kelima kartu fase tampil dengan daftar layanannya — **tidak kosong**. Ini bukti policy baca publik bekerja.
2. Nomor WA di footer tampil format lokal; tombol WhatsApp mengarah ke `wa.me/62…`.
3. Tombol "Mulai Skrining" membawa ke `/skrining`.
4. Periksa lebar 390px: tidak ada scroll horizontal.
5. Matikan server dev.

- [ ] **Step 7: Commit**

```bash
git add web && git commit -m "feat(plan2): landing publik dengan katalog dinamis dari DB"
```

---

### Task 7: Inbox skrining admin

**Files:**
- Create: `web/src/app/admin/skrining/page.tsx`, `web/src/app/admin/skrining/tabel-inbox.tsx`, `web/src/app/admin/skrining/aksi.ts`, `web/tests/admin-inbox.test.ts`
- Modify: `web/src/app/admin/page.tsx` (tautan ke inbox)

**Interfaces:**
- Consumes: `requireRole` (Plan 1), skema `screenings`.
- Produces: rute `/admin/skrining`; server action `ubahTindakLanjut(id, status)`.

- [ ] **Step 1: Test dulu**

Buat `web/tests/admin-inbox.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

const admin = createAdminSupabase();
const KODE = "PDM-260828-0000-TEST";

beforeAll(async () => {
  await admin.from("screenings").delete().eq("kode", KODE);
  await admin.from("screenings").insert({
    kode: KODE, nama: "Uji Inbox", no_hp: "0812-0000-9999", fase: "kehamilan",
    jawaban: { cardioresp: false, fever: true },
    hasil: "merah",
    flags: [{ id: "fever", level: "urgent", teks: "Apakah suhu tubuh Anda 38°C atau lebih…" }],
  });
});
afterAll(async () => {
  await admin.from("screenings").delete().eq("kode", KODE);
});

describe("inbox skrining", () => {
  it("admin bisa membaca daftar skrining", async () => {
    const a = await signInAs("admin@padma.test");
    const { data, error } = await a.from("screenings").select("kode, hasil, flags");
    expect(error).toBeNull();
    expect(data!.some((r) => r.kode === KODE)).toBe(true);
  });

  it("flags menyimpan level sehingga admin bisa bedakan urgent", async () => {
    const a = await signInAs("admin@padma.test");
    const { data } = await a.from("screenings").select("flags").eq("kode", KODE).single();
    expect((data!.flags as { level: string }[])[0].level).toBe("urgent");
  });

  it("admin bisa mengubah status tindak lanjut", async () => {
    const a = await signInAs("admin@padma.test");
    const { data } = await a.from("screenings")
      .update({ status_tindak_lanjut: "dihubungi" }).eq("kode", KODE).select();
    expect(data).toHaveLength(1);
  });

  it("KLIEN tidak bisa membaca skrining siapa pun", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("screenings").select("kode");
    expect(data).toHaveLength(0);
  });

  it("anon tetap ditolak di lapis hak tabel", async () => {
    const { error } = await anonClient().from("screenings").select("kode");
    expect(error?.code).toBe("42501");
  });

  // Pencarian kode belum ada fiturnya di Plan 2, tetapi aturannya dikunci
  // sekarang: `.eq` mengembalikan 0 baris untuk input "%", sedangkan `.ilike`
  // akan mengembalikan SELURUH inbox. Test ini adalah pagar untuk saat
  // fitur pencarian ditambahkan nanti.
  it("operator setara: '%' sebagai kode tidak cocok dengan baris mana pun", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: eq } = await a.from("screenings").select("kode").eq("kode", "%");
    expect(eq).toHaveLength(0);

    // Kontrol pembanding: membuktikan test ini benar-benar membedakan
    // (bila kelak seseorang memakai .ilike, kebocorannya akan seperti ini).
    const { data: pola } = await a.from("screenings").select("kode").ilike("kode", "%");
    expect(pola!.length).toBeGreaterThan(0);
  });
});
```

Run: `npm test -- tests/admin-inbox.test.ts` → Expected: FAIL sebagian (tabel kosong / rute belum ada). Perbaiki sampai hijau setelah implementasi.

- [ ] **Step 2: Server action ubah status**

Buat `web/src/app/admin/skrining/aksi.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

const STATUS_SAH = ["baru", "dihubungi", "jadi_klien", "ditolak"] as const;
export type StatusTindakLanjut = (typeof STATUS_SAH)[number];

export async function ubahTindakLanjut(id: string, status: string) {
  await requireRole(["admin", "owner"]);
  if (!STATUS_SAH.includes(status as StatusTindakLanjut)) return;

  // RLS "screenings: staf" yang menjadi penjaga sesungguhnya — kita memakai
  // sesi pengguna (bukan service role) supaya haknya ikut diperiksa Postgres.
  const supabase = await createServerSupabase();
  await supabase.from("screenings").update({ status_tindak_lanjut: status }).eq("id", id);
  revalidatePath("/admin/skrining");
}
```

- [ ] **Step 3: Tabel inbox**

Buat `web/src/app/admin/skrining/tabel-inbox.tsx`:
```tsx
"use client";

import { Fragment, useState } from "react";
import { ubahTindakLanjut } from "./aksi";

export type BarisSkrining = {
  id: string;
  kode: string;
  nama: string;
  no_hp: string;
  fase: string;
  hasil: "hijau" | "merah";
  status_tindak_lanjut: string;
  created_at: string;
  flags: { id: string; level: string; teks: string }[];
};

const LABEL_STATUS: Record<string, string> = {
  baru: "Baru", dihubungi: "Dihubungi", jadi_klien: "Jadi klien", ditolak: "Ditolak",
};

export function TabelInbox({ baris }: { baris: BarisSkrining[] }) {
  const [terbuka, setTerbuka] = useState<string | null>(null);

  if (baris.length === 0) {
    return (
      <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
        Belum ada hasil skrining masuk. Begitu ada pengunjung mengisi skrining,
        entrinya muncul di sini.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
              <th className="p-4 text-left font-extrabold">Kode</th>
              <th className="p-4 text-left font-extrabold">Calon klien</th>
              <th className="p-4 text-left font-extrabold">Hasil</th>
              <th className="p-4 text-left font-extrabold">Tindak lanjut</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {baris.map((r) => {
              const urgent = r.flags.some((f) => f.level === "urgent");
              return (
                // key WAJIB di Fragment: ia elemen teratas dalam map,
                // bukan <tr> di dalamnya.
                <Fragment key={r.id}>
                  <tr className="border-b border-black/5">
                    <td className="p-4">
                      <span className="font-mono text-xs">{r.kode}</span>
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        {new Date(r.created_at).toLocaleDateString("id-ID", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </span>
                    </td>
                    <td className="p-4">
                      <b>{r.nama}</b>
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        {r.no_hp} · {r.fase}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                        r.hasil === "hijau"
                          ? "bg-leaf-soft text-leaf"
                          : "bg-clay/10 text-clay"
                      }`}>
                        {r.hasil === "hijau" ? "HIJAU" : urgent ? "MERAH · URGENT" : "MERAH"}
                      </span>
                    </td>
                    <td className="p-4">
                      <select defaultValue={r.status_tindak_lanjut}
                        onChange={(e) => void ubahTindakLanjut(r.id, e.target.value)}
                        className="rounded-lg border-[1.5px] border-black/10 bg-white px-2.5 py-1.5 text-[12.5px]">
                        {Object.entries(LABEL_STATUS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      <button type="button"
                        onClick={() => setTerbuka(terbuka === r.id ? null : r.id)}
                        className="text-[13px] font-bold text-leaf underline underline-offset-4">
                        jawaban
                      </button>
                    </td>
                  </tr>
                  {terbuka === r.id && (
                    <tr>
                      <td colSpan={5} className="border-b border-black/5 bg-paper p-5 text-[13px]">
                        {r.flags.length === 0 ? (
                          <p>
                            Semua pertanyaan dijawab <b>Tidak</b> — tidak ada bendera.
                            Aman dijadwalkan setelah konfirmasi kondisi.
                          </p>
                        ) : (
                          <>
                            <p className="font-bold">Jawaban &ldquo;Ya&rdquo; yang perlu diperhatikan:</p>
                            <ul className="mt-2 list-disc pl-5 text-[#54463C]">
                              {r.flags.map((f) => (
                                <li key={f.id}>
                                  {f.teks}
                                  {f.level === "urgent" && (
                                    <span className="ml-2 rounded bg-clay/10 px-1.5 py-0.5 text-[10.5px] font-extrabold text-clay">
                                      URGENT
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Halaman inbox**

Buat `web/src/app/admin/skrining/page.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { TabelInbox, type BarisSkrining } from "./tabel-inbox";

export const metadata = { title: "Inbox Skrining" };

export default async function InboxSkriningPage() {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("screenings")
    .select("id, kode, nama, no_hp, fase, hasil, status_tindak_lanjut, created_at, flags")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="p-8">
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Inbox Skrining</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Saat pesan WhatsApp masuk, cocokkan kodenya di sini untuk melihat
          jawaban asli — bukan sekadar percaya isi pesan.
        </p>
      </header>
      <TabelInbox baris={(data ?? []) as BarisSkrining[]} />
    </main>
  );
}
```

- [ ] **Step 5: Tautan dari dashboard admin**

Di `web/src/app/admin/page.tsx`, tambahkan tautan (jangan mengubah `admin/layout.tsx`):
```tsx
import Link from "next/link";
// ... di dalam JSX, setelah paragraf sambutan:
<Link href="/admin/skrining"
  className="mt-5 inline-block rounded-xl bg-night px-5 py-3 font-bold text-gold-pale">
  Buka Inbox Skrining
</Link>
```

- [ ] **Step 6: Verifikasi**

Run: `npm test -- tests/admin-inbox.test.ts` → PASS.
Run: `npm test` → seluruh suite PASS (**pastikan `tests/access-matrix-layouts.test.ts` tetap hijau** — `admin/layout.tsx` tidak boleh disentuh).
Run: `npm run build` → sukses.

Manual: `npm run dev`, login `admin@padma.test`, buka `/admin/skrining`. Isi satu skrining dari `/skrining` di tab lain → refresh inbox → entri baru muncul dengan kodenya. Matikan server dev.

- [ ] **Step 7: Commit**

```bash
git add web && git commit -m "feat(plan2): inbox skrining admin + tindak lanjut"
```

---

### Task 8: E2E funnel & verifikasi akhir Plan 2

**Files:**
- Create: `web/tests/e2e/funnel-skrining.e2e.ts`
- Modify: `web/README.md` (dokumentasikan rute baru)

**Interfaces:**
- Consumes: seluruh task sebelumnya.

- [ ] **Step 1: E2E funnel penuh**

Buat `web/tests/e2e/funnel-skrining.e2e.ts` (meniru pola `tests/e2e/access-matrix.e2e.ts`: skrip `tsx` mandiri + Playwright, mencatat PASS/FAIL lalu `process.exit`):

```ts
/**
 * E2E funnel calon klien (Plan 2).
 *
 * Membuktikan lewat browser sungguhan:
 *   1. Landing publik menampilkan katalog DARI DATABASE (bukan kosong)
 *   2. Wizard skrining berjalan; demam saat KEHAMILAN memicu urgent + blok 119
 *   3. Kode skrining tampil, dan TIDAK muncul di URL (data kesehatan)
 *   4. Entri itu muncul di inbox admin dengan penanda URGENT
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:funnel`.
 */
import { chromium, type Browser, type BrowserContext } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

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

  // ---- 1. Landing publik: katalog dari DB ----
  const tamu = await browser.newContext();
  const landing = await tamu.newPage();
  await landing.goto(BASE, { waitUntil: "networkidle" });
  const teksLanding = (await landing.textContent("body")) ?? "";
  const fase = ["Sankalpa", "Garbha", "Purnama", "Sandhya", "Shishu"];
  const faseAda = fase.filter((f) => teksLanding.includes(f));
  catat(
    "1a. landing menampilkan 5 lini layanan dari DB",
    faseAda.length === 5,
    `ditemukan: ${faseAda.join(", ") || "(tidak ada)"}`,
  );
  catat(
    "1b. landing menampilkan nama layanan dummy dari DB",
    teksLanding.includes("Sankalpa Fertility Massage"),
    teksLanding.includes("Sankalpa Fertility Massage")
      ? "nama layanan ditemukan"
      : "TIDAK ditemukan — policy baca publik mungkin belum berlaku",
  );

  // ---- 2. Wizard skrining: demam saat kehamilan = urgent ----
  await landing.getByRole("link", { name: /Mulai Skrining/i }).first().click();
  await landing.waitForURL(/\/skrining$/, { timeout: 20_000 });
  await landing.waitForLoadState("networkidle");
  catat("2a. CTA landing membawa ke /skrining", true, landing.url());

  await landing.getByLabel("Nama panggilan").fill("Uji E2E");
  await landing.getByLabel("No. WhatsApp").fill("0812-0000-1234");
  await landing.getByRole("button", { name: "Kehamilan", exact: true }).click();
  await landing.getByRole("checkbox").check();
  const tombolMulai = landing.getByRole("button", { name: "Mulai Skrining" });
  catat("2b. tombol mulai aktif setelah syarat lengkap", await tombolMulai.isEnabled(), "enabled");
  await tombolMulai.click();

  // cardioresp -> Tidak, severe_pain -> Tidak, fever -> Ya (urgent pada kehamilan)
  await landing.getByRole("button", { name: "Tidak", exact: true }).click();
  await landing.getByRole("button", { name: "Tidak", exact: true }).click();
  await landing.getByRole("button", { name: "Ya", exact: true }).click();
  await landing.waitForLoadState("networkidle");

  const teksHasil = (await landing.textContent("body")) ?? "";
  catat(
    "2c. demam saat KEHAMILAN -> merah",
    teksHasil.includes("Layanan belum dapat dijadwalkan"),
    teksHasil.includes("Layanan belum dapat dijadwalkan") ? "hasil merah" : "BUKAN merah",
  );
  catat(
    "2d. PAGAR KESELAMATAN: blok darurat 119 tampil",
    teksHasil.includes("119"),
    teksHasil.includes("119") ? "blok 119 terlihat" : "blok 119 TIDAK ADA — regresi keselamatan",
  );

  const kode = (teksHasil.match(/PDM-\d{6}-\d{4}-[A-Z0-9]{4}/) ?? [])[0] ?? "";
  catat("3a. kode skrining tampil di layar hasil", Boolean(kode), kode || "(tidak ada kode)");
  catat(
    "3b. kode TIDAK muncul di URL (data kesehatan)",
    !landing.url().includes("PDM-") && !landing.url().includes("hasil="),
    landing.url(),
  );

  // ---- 4. Inbox admin ----
  const ctxAdmin = await login(browser, "admin@padma.test");
  const inbox = await ctxAdmin.newPage();
  await inbox.goto(`${BASE}/admin/skrining`, { waitUntil: "networkidle" });
  const teksInbox = (await inbox.textContent("body")) ?? "";
  catat(
    "4a. entri skrining muncul di inbox admin",
    Boolean(kode) && teksInbox.includes(kode),
    kode ? `mencari ${kode}` : "tidak ada kode untuk dicari",
  );
  catat(
    "4b. inbox menandai MERAH · URGENT",
    teksInbox.includes("MERAH · URGENT"),
    teksInbox.includes("MERAH · URGENT") ? "penanda urgent ada" : "penanda urgent TIDAK ada",
  );

  await browser.close();

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(
    `\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos` +
      (gagal.length ? `\nGAGAL: ${gagal.map((g) => g.nama).join(", ")}` : "\nFunnel calon klien terbukti utuh"),
  );
  process.exit(gagal.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Tambahkan script di `web/package.json` (jangan menghapus `test:e2e` yang sudah ada — ia dipakai Plan 1):
```json
"test:e2e:funnel": "tsx tests/e2e/funnel-skrining.e2e.ts",
"test:e2e:semua": "npm run test:e2e && npm run test:e2e:funnel"
```

- [ ] **Step 2: Jalankan E2E**

```bash
npm run dev &          # tunggu sampai "Ready"
npm run test:e2e:semua
```
Expected: kedua skrip melaporkan seluruh pemeriksaan lolos.
Setelahnya matikan server dev dan pastikan `lsof -ti tcp:3000` kosong.

- [ ] **Step 3: Verifikasi menyeluruh dari nol**

```bash
npx supabase db reset && npm test && npm run build
```
Expected: semua sukses. Catat jumlah test.

- [ ] **Step 4: Perbarui README**

Tambahkan bagian rute di `web/README.md`:
```markdown
## Rute

| Rute | Akses | Isi |
|---|---|---|
| `/` | Publik | Landing: hero, 5 lini layanan (dari DB), cara kerja, teaser passport, pembanding |
| `/skrining` | Publik | Wizard skrining keselamatan; hasil dinilai server, disimpan via `POST /api/skrining` |
| `/masuk` | Publik | Login email+password & Google |
| `/passport` | Klien | Digital Care Passport (Plan 4) |
| `/admin` | Admin, Owner | Dashboard admin |
| `/admin/skrining` | Admin, Owner | Inbox skrining: verifikasi jawaban, ubah tindak lanjut |
| `/owner` | Owner | Rate card & rekap honor (Plan 5) |

Catatan keamanan: `anon` tidak punya hak tabel pada `screenings` — penyimpanan
skrining publik WAJIB lewat route handler dengan service role.
```

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "test(plan2): E2E funnel skrining + dokumentasi rute"
```

---

## Definition of Done — Plan 2

- [x] Pengunjung anonim melihat landing dengan katalog layanan **dari database** (tidak kosong).
- [x] Wizard skrining berjalan untuk keempat fase; demam pada kehamilan/nifas memicu `urgent` + blok 119, pada prekonsepsi/menopause tidak.
- [x] Hasil skrining tersimpan di `screenings` lewat endpoint server; `hasil` yang dikirim klien diabaikan.
- [x] Gagal simpan tidak mematikan funnel: hasil & tombol WhatsApp tetap tampil, chip "tersimpan" tidak berbohong.
- [x] Tidak ada kode/hasil skrining di URL.
- [x] Admin melihat entri di `/admin/skrining` lengkap dengan penanda URGENT, dan bisa mengubah tindak lanjut.
- [x] `npm test` hijau seluruhnya (termasuk `access-matrix-layouts`, `rls-firewall`, `money-firewall-struktural`), `npm run test:e2e` hijau, `npm run build` sukses.
- [x] Tidak ada policy/GRANT insert baru untuk `anon` pada `screenings`.
