# Syarat & Ketentuan, Kebijakan Privasi, dan Persetujuan Tercatat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dua halaman publik (`/syarat-ketentuan`, `/kebijakan-privasi`) beserta persetujuan wajib yang tercatat di skrining, di `/daftar`, dan di satu gerbang `/persetujuan` untuk semua jalur akun lain.

**Architecture:**
- Satu modul `src/lib/persetujuan/` memegang nomor versi, satu-satunya penulis (`catatPersetujuan`), dan satu-satunya pembaca (`statusPersetujuan`).
- Skrining mencap dua kolom baru di `screenings`. Akun dicatat di tabel append-only `persetujuan_akun`, lewat cookie dari `/daftar` (dicatat `/setelah-masuk`) atau lewat gerbang `/persetujuan` yang dipasang di layout `/passport` dan di rute checkout.
- Teks dokumen ditulis sebagai TSX di repo.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Supabase (Postgres + RLS, PostgREST), zod 4, vitest, Playwright (skrip e2e `tsx`).

**Spec:** `docs/superpowers/specs/2026-10-06-padma-syarat-ketentuan-privasi-design.md`. Baca spec ini lebih dulu; rencana ini berargumen dari sana.

## Global Constraints

- Basis branch: `development`. Kerjakan di worktree `.worktrees/sk`, branch `feat/syarat-ketentuan-privasi`.
- `VERSI_DOKUMEN = "2026-10-06"`, format `YYYY-MM-DD`, satu nomor untuk KEDUA dokumen.
- Versi **selalu dicap server** dari `VERSI_DOKUMEN`. Nilai versi dari peramban tidak pernah dipercaya.
- Penyelenggara di dokumen: **"PADMA Wellness"**. Saluran permintaan data: **WhatsApp admin** dari `bacaPengaturan()`, tidak pernah ditulis keras.
- Migrasi: `supabase/migrations/20261006120000_persetujuan_dokumen.sql`. **Bukan** `…100000`, karena sudah dipakai `feat/p4-rekap-penjualan`.
- **Tidak ada trigger di `screenings`** (spec, revisi 1). Penegakan untuk baris baru lewat skema bersama, fungsi pencap bersama, dan uji struktural.
- Checkout yang belum disetujui menjawab **`403 { kode: "perlu_persetujuan" }`**, bukan `409` (spec, revisi 2).
- `persetujuan_akun` ditulis dengan **sesi klien sendiri**. Service role hanya boleh dipakai di seed dan fixture uji.
- **Pembacaan status gagal-terbuka.** Galat baca dicatat ke log lalu dianggap sudah setuju. Gerbang ini pencatat, bukan batas keamanan, dan migrasi yang belum diterapkan tidak boleh mengunci seluruh Passport.
- `src/app/passport/layout.tsx` tetap memanggil `requireRole` **tepat satu kali** (`tests/access-matrix-layouts.test.ts`, `tests/passport-shell.test.ts`).
- Tautan dokumen dari formulir dibuka di tab baru: `target="_blank" rel="noopener noreferrer"`.
- Tabel pembatalan di S&K **disalin utuh** dari `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md`, tidak diringkas.
- Kebijakan Privasi **tidak menyebut backup** sama sekali (jadwal backup masih mati).
- **Jangan `supabase db push`.** Migrasi ke produksi bukan bagian rencana ini.
- **Uji murni (tanpa Docker):** `npm run test:murni -- <berkas>`.
- **Uji ber-DB** butuh Docker + Supabase lokal, dan stack lokal dipakai bersama. Koordinasikan dengan pemilik repo sebelum `npm test` penuh.
- Setiap uji penjaga **dibuktikan bisa merah lebih dulu** (langkah "verify it fails" tidak boleh dilewati).

## Review Focus

1. **Email dikonfirmasi di perangkat lain.** Cookie `padma_setuju` tidak ada. Login harus tetap berhasil dan berakhir di gerbang, bukan galat. Uji: Tugas 5, kasus "tanpa cookie"; Tugas 6, layout mengarahkan ke `/persetujuan`.
2. **Kode tayang sebelum migrasinya diterapkan.** `persetujuan_akun` tidak ada. Passport harus tetap terbuka (gagal-terbuka), bukan mengunci semua klien di layar yang juga gagal mencatat. Uji: Tugas 1, kasus `galatBaca`.
3. **Klien yang sudah setuju membuka `/persetujuan`** (tombol kembali, markah). Ia diteruskan ke tujuannya, tanpa form dan tanpa catatan ganda. Uji: Tugas 6, kasus `sudahSetuju`.
4. **Klik ganda, atau cookie daftar + gerbang mencatat versi yang sama.** Bentrok primary key (`23505`) harus dianggap sukses, bukan galat yang membuat klien diminta setuju lagi. Uji: Tugas 1, kasus `23505`.
5. **Halaman keranjang terbuka sejak sebelum deploy, lalu checkout.** Jawaban 403 harus membawa klien ke `/persetujuan`, bukan menampilkan "Pembayaran belum bisa dimulai". Uji: Tugas 7, `mintaCheckout` memetakan 403 + `perlu_persetujuan`.

---

### Tugas 1: Modul `src/lib/persetujuan/` dan alat uji murni

**Files:**
- Create: `web/vitest.murni.config.ts`
- Modify: `web/package.json` (blok `scripts`)
- Create: `web/src/lib/persetujuan/versi.ts`
- Create: `web/src/lib/persetujuan/status.ts`
- Create: `web/src/lib/persetujuan/catat.ts`
- Create: `web/src/lib/persetujuan/cookie.ts`
- Create: `web/src/lib/persetujuan/tujuan.ts`
- Create: `web/src/lib/persetujuan/skrining.ts`
- Test: `web/tests/persetujuan-lib.test.ts`

**Interfaces:**
- Consumes: `tujuanProdukAman(nilai: string | null | undefined): string | null` dari `@/lib/auth/tujuan-produk`; `createServerSupabase()` dari `@/lib/supabase/server`.
- Produces:
  - `VERSI_DOKUMEN: string`
  - `type StatusPersetujuan = { sudahSetuju: boolean; pernahSetuju: boolean }`
  - `bacaStatusPersetujuan(supabase: SupabaseClient, userId: string): Promise<StatusPersetujuan>`
  - `statusPersetujuan(userId: string): Promise<StatusPersetujuan>` (dibungkus React `cache`)
  - `type JalurPersetujuan = "daftar" | "gerbang"`
  - `catatPersetujuan(supabase: SupabaseClient, userId: string, jalur: JalurPersetujuan): Promise<boolean>`
  - `catatPersetujuanDariCookie(supabase: SupabaseClient, userId: string, nilaiCookie: string | undefined): Promise<boolean>`
  - `COOKIE_SETUJU = "padma_setuju"`, `UMUR_COOKIE_SETUJU_DETIK = 86_400`, `titipPersetujuanDiPeramban(): void`
  - `tujuanPersetujuanAman(lanjut: unknown): string`
  - `capPersetujuanSkrining(sekarang?: Date): { persetujuan_versi: string; persetujuan_pada: string }`

- [ ] **Langkah 0: Siapkan worktree**

```bash
cd /Users/arvinfairuz/Documents/padma
git worktree add .worktrees/sk -b feat/syarat-ketentuan-privasi development
cp web/.env.local .worktrees/sk/web/.env.local
cd .worktrees/sk/web && npm ci
```

Semua langkah berikutnya dijalankan dari `.worktrees/sk/web`.

- [ ] **Langkah 1: Tambahkan konfigurasi uji murni**

`web/vitest.murni.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import dasar from "./vitest.config";

/**
 * UJI MURNI — sama persis dengan vitest.config.ts, minus `globalSetup`.
 *
 * `globalSetup` menyemai pengguna demo ke Supabase lokal, dan ia MENGGANTUNG
 * bila Docker mati (catatan P2, 2 Okt 2026). Konfigurasi ini hanya untuk
 * berkas yang tidak menyentuh basis data:
 *
 *   npm run test:murni -- tests/<berkas>.test.ts
 *
 * Berkas ber-DB yang dijalankan lewat sini akan gagal atau menggantung — dan
 * kegagalan itu bukan bukti apa pun tentang kodenya.
 */
export default defineConfig({
  ...dasar,
  test: { ...dasar.test, globalSetup: [] },
});
```

Di `web/package.json`, tambahkan baris ini tepat di bawah `"test:watch": "vitest",`:

```json
    "test:murni": "vitest run --config vitest.murni.config.ts",
```

- [ ] **Langkah 2: Tulis uji yang gagal**

`web/tests/persetujuan-lib.test.ts`:

```ts
/**
 * Modul persetujuan S&K + Kebijakan Privasi (spec 2026-10-06) — uji MURNI.
 *
 * Klien Supabase diganti tiruan kecil yang mencatat panggilan. Yang dijaga:
 * versi dicap dari konstanta, pembacaan gagal-TERBUKA, bentrok kunci dianggap
 * sukses, cookie berversi lama tidak dicatat, dan `lanjut` tidak bisa menjadi
 * open redirect.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VERSI_DOKUMEN } from "@/lib/persetujuan/versi";
import { bacaStatusPersetujuan } from "@/lib/persetujuan/status";
import { catatPersetujuan, catatPersetujuanDariCookie } from "@/lib/persetujuan/catat";
import { COOKIE_SETUJU, titipPersetujuanDiPeramban } from "@/lib/persetujuan/cookie";
import { tujuanPersetujuanAman } from "@/lib/persetujuan/tujuan";
import { capPersetujuanSkrining } from "@/lib/persetujuan/skrining";

type Galat = { code?: string; message: string } | null;

function tiruan(
  opsi: { baris?: { versi: string }[]; galatBaca?: Galat; galatTulis?: Galat; lempar?: boolean } = {},
) {
  const log = { tabel: [] as string[], eq: [] as [string, unknown][], insert: [] as unknown[] };
  const kueri = {
    eq(kolom: string, nilai: unknown) {
      log.eq.push([kolom, nilai]);
      return kueri;
    },
    then<T>(selesai: (v: { data: unknown; error: Galat }) => T) {
      return Promise.resolve({
        data: opsi.galatBaca ? null : (opsi.baris ?? []),
        error: opsi.galatBaca ?? null,
      }).then(selesai);
    },
  };
  const klien = {
    from(tabel: string) {
      log.tabel.push(tabel);
      return {
        select: () => kueri,
        insert: async (baris: unknown) => {
          if (opsi.lempar) throw new TypeError("fetch failed (disengaja oleh uji)");
          log.insert.push(baris);
          return { error: opsi.galatTulis ?? null };
        },
      };
    },
  };
  return { klien: klien as unknown as SupabaseClient, log };
}

describe("VERSI_DOKUMEN", () => {
  it("berbentuk YYYY-MM-DD — sama dengan CHECK di persetujuan_akun.versi", () => {
    expect(VERSI_DOKUMEN).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("bacaStatusPersetujuan", () => {
  it("belum pernah setuju apa pun", async () => {
    const { klien, log } = tiruan({ baris: [] });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: false, pernahSetuju: false });
    expect(log.tabel).toEqual(["persetujuan_akun"]);
    expect(log.eq).toContainEqual(["user_id", "u-1"]);
  });

  it("pernah setuju versi LAMA — belum setuju versi berlaku", async () => {
    const { klien } = tiruan({ baris: [{ versi: "2000-01-01" }] });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: false, pernahSetuju: true });
  });

  it("sudah setuju versi berlaku", async () => {
    const { klien } = tiruan({ baris: [{ versi: "2000-01-01" }, { versi: VERSI_DOKUMEN }] });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: true, pernahSetuju: true });
  });

  it("GAGAL-TERBUKA: galat baca (mis. migrasi belum diterapkan) tidak mengunci Passport", async () => {
    const { klien } = tiruan({ galatBaca: { code: "42P01", message: "relation does not exist" } });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: true, pernahSetuju: true });
  });
});

describe("catatPersetujuan", () => {
  it("mencap VERSI_DOKUMEN dan jalurnya", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuan(klien, "u-1", "gerbang")).toBe(true);
    expect(log.tabel).toEqual(["persetujuan_akun"]);
    expect(log.insert).toEqual([{ user_id: "u-1", versi: VERSI_DOKUMEN, jalur: "gerbang" }]);
  });

  it("bentrok kunci (23505) = sudah tercatat = sukses", async () => {
    const { klien } = tiruan({ galatTulis: { code: "23505", message: "duplicate key" } });
    expect(await catatPersetujuan(klien, "u-1", "daftar")).toBe(true);
  });

  it("galat lain = gagal, tanpa melempar", async () => {
    const { klien } = tiruan({ galatTulis: { code: "42501", message: "permission denied" } });
    expect(await catatPersetujuan(klien, "u-1", "daftar")).toBe(false);
  });

  it("jaringan putus = gagal, tanpa melempar (login tidak boleh ikut gagal)", async () => {
    const { klien } = tiruan({ lempar: true });
    expect(await catatPersetujuan(klien, "u-1", "daftar")).toBe(false);
  });
});

describe("catatPersetujuanDariCookie", () => {
  it("tanpa cookie: tidak mencatat apa pun", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuanDariCookie(klien, "u-1", undefined)).toBe(false);
    expect(log.insert).toEqual([]);
  });

  it("cookie berversi LAMA tidak dicatat — klien itu menyetujui teks yang sudah diganti", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuanDariCookie(klien, "u-1", "2000-01-01")).toBe(false);
    expect(log.insert).toEqual([]);
  });

  it("cookie berversi berlaku dicatat sebagai jalur daftar", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuanDariCookie(klien, "u-1", VERSI_DOKUMEN)).toBe(true);
    expect(log.insert).toEqual([{ user_id: "u-1", versi: VERSI_DOKUMEN, jalur: "daftar" }]);
  });
});

describe("titipPersetujuanDiPeramban", () => {
  const asli = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = asli;
  });

  it("menulis cookie berversi, umur 1 hari, untuk seluruh situs", () => {
    const dok = { cookie: "" };
    (globalThis as { document?: unknown }).document = dok;
    titipPersetujuanDiPeramban();
    expect(dok.cookie).toContain(`${COOKIE_SETUJU}=${VERSI_DOKUMEN}`);
    expect(dok.cookie).toContain("Max-Age=86400");
    expect(dok.cookie).toContain("Path=/");
    expect(dok.cookie).toContain("SameSite=Lax");
  });
});

describe("tujuanPersetujuanAman", () => {
  it.each([
    ["/produk/abc", "/produk/abc"],
    ["/produk/kelas-pijat-bayi", "/produk/kelas-pijat-bayi"],
    ["//evil.com", "/passport"],
    ["https://evil.com", "/passport"],
    ["/\\evil", "/passport"],
    ["/admin", "/passport"],
    ["/produk/../admin", "/passport"],
    ["", "/passport"],
    [undefined, "/passport"],
    [null, "/passport"],
    [["/produk/abc"], "/passport"],
  ])("%j → %s", (masuk, keluar) => {
    expect(tujuanPersetujuanAman(masuk)).toBe(keluar);
  });
});

describe("capPersetujuanSkrining", () => {
  it("mencap versi dari konstanta dan waktu dari server", () => {
    expect(capPersetujuanSkrining(new Date("2026-10-06T03:00:00Z"))).toEqual({
      persetujuan_versi: VERSI_DOKUMEN,
      persetujuan_pada: "2026-10-06T03:00:00.000Z",
    });
  });
});
```

- [ ] **Langkah 3: Jalankan, pastikan gagal**

Run: `npm run test:murni -- tests/persetujuan-lib.test.ts`
Expected: FAIL. Pesannya `Failed to resolve import "@/lib/persetujuan/versi"`.

- [ ] **Langkah 4: Tulis implementasinya**

`web/src/lib/persetujuan/versi.ts`:

```ts
/**
 * Versi Syarat & Ketentuan + Kebijakan Privasi — SATU nomor untuk keduanya.
 *
 * Klien menyetujui kedua dokumen sekaligus, jadi revisi salah satunya berarti
 * semua klien setuju ulang. Dua nomor versi bisa saling tertinggal diam-diam;
 * satu tidak bisa.
 *
 * Formatnya tanggal berlaku `YYYY-MM-DD` (dipaksa CHECK di
 * `persetujuan_akun.versi`). Nilainya diisi ulang dengan tanggal final saat
 * rilis — lihat "Prasyarat rilis" di spec 2026-10-06. MENAIKKAN nilai ini
 * membuat setiap klien bertemu gerbang `/persetujuan` sekali lagi.
 *
 * Versi SELALU dicap server dari konstanta ini. Peramban tidak pernah
 * mengirim nomor versi yang dipercaya.
 */
export const VERSI_DOKUMEN = "2026-10-06";
```

`web/src/lib/persetujuan/status.ts`:

```ts
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { VERSI_DOKUMEN } from "./versi";

export type StatusPersetujuan = {
  /** Sudah menyetujui versi yang berlaku sekarang. */
  sudahSetuju: boolean;
  /** Pernah menyetujui versi apa pun — membedakan "baru" dari "diperbarui". */
  pernahSetuju: boolean;
};

/**
 * SATU-SATUNYA pembaca `persetujuan_akun`. Dipakai layout `/passport`,
 * halaman `/persetujuan`, dan rute checkout — lewat `statusPersetujuan`.
 *
 * ===== GAGAL-TERBUKA, DAN ITU DISENGAJA =====
 * Galat baca dicatat lalu dianggap SUDAH setuju. Gerbang ini pencatat
 * persetujuan, bukan batas keamanan (spec 2026-10-06). Kebalikannya —
 * gagal-tertutup — mengubah satu migrasi yang terlambat diterapkan menjadi
 * SELURUH klien terkunci di layar `/persetujuan`, yang penulisannya gagal
 * karena sebab yang sama. Klien yang lolos gerbang hari ini akan ditahan lagi
 * pada kunjungan berikutnya begitu tabelnya terbaca.
 */
export async function bacaStatusPersetujuan(
  supabase: SupabaseClient,
  userId: string,
): Promise<StatusPersetujuan> {
  const { data, error } = await supabase
    .from("persetujuan_akun")
    .select("versi")
    .eq("user_id", userId);
  if (error) {
    console.error("[persetujuan] status tidak terbaca, gerbang dibuka:", error.message);
    return { sudahSetuju: true, pernahSetuju: true };
  }
  const versi = ((data ?? []) as { versi: string }[]).map((b) => b.versi);
  return { sudahSetuju: versi.includes(VERSI_DOKUMEN), pernahSetuju: versi.length > 0 };
}

/** Dibungkus `cache`: layout dan halaman di request yang sama membaca SEKALI. */
export const statusPersetujuan = cache(
  async (userId: string): Promise<StatusPersetujuan> =>
    bacaStatusPersetujuan(await createServerSupabase(), userId),
);
```

`web/src/lib/persetujuan/catat.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { VERSI_DOKUMEN } from "./versi";

export type JalurPersetujuan = "daftar" | "gerbang";

/**
 * SATU-SATUNYA penulis `persetujuan_akun` di kode aplikasi.
 *
 * Ditulis dengan SESI KLIEN itu sendiri (policy insert `user_id =
 * auth.uid()`), bukan service role: persetujuan adalah tindakan pemilik akun.
 *
 * Mengembalikan boolean dan TIDAK PERNAH melempar — `/setelah-masuk`
 * memanggilnya di tengah login, dan gagal mencatat tidak boleh menggagalkan
 * login (gerbang menangkap klien itu nanti).
 *
 * Bentrok primary key (`23505`) = versi ini sudah tercatat = sukses. Cookie
 * daftar dan gerbang bisa mencatat versi yang sama dua kali, dan klik ganda
 * juga; tidak satu pun pantas membuat klien diminta setuju lagi.
 */
export async function catatPersetujuan(
  supabase: SupabaseClient,
  userId: string,
  jalur: JalurPersetujuan,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("persetujuan_akun")
      .insert({ user_id: userId, versi: VERSI_DOKUMEN, jalur });
    if (!error || error.code === "23505") return true;
    console.error("[persetujuan] gagal mencatat:", error.message);
    return false;
  } catch (e) {
    console.error("[persetujuan] gagal mencatat:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Dipanggil `/setelah-masuk` dengan nilai cookie `padma_setuju`.
 *
 * Cookie berversi LAMA tidak dicatat: pemiliknya mencentang teks yang sudah
 * diganti sejak itu, dan mencatatnya sebagai persetujuan versi baru adalah
 * memalsukan persetujuan. Gerbang akan memintanya membaca versi yang baru.
 */
export async function catatPersetujuanDariCookie(
  supabase: SupabaseClient,
  userId: string,
  nilaiCookie: string | undefined,
): Promise<boolean> {
  if (nilaiCookie !== VERSI_DOKUMEN) return false;
  return catatPersetujuan(supabase, userId, "daftar");
}
```

`web/src/lib/persetujuan/cookie.ts`:

```ts
import { VERSI_DOKUMEN } from "./versi";

/**
 * Cookie penitip persetujuan dari `/daftar` ke `/setelah-masuk`.
 *
 * Aman dipakai komponen klien: berkas ini tidak mengimpor apa pun dari sisi
 * server. Pembacanya (`catatPersetujuanDariCookie`) tinggal di `catat.ts`.
 *
 * Umur SATU HARI, bukan satu jam seperti `padma_lanjut`: tautan konfirmasi
 * email bisa dibuka berjam-jam kemudian. Bila ia dibuka di perangkat lain,
 * cookie ini tidak ikut — dan gerbang `/persetujuan` yang menangkapnya.
 */
export const COOKIE_SETUJU = "padma_setuju";
export const UMUR_COOKIE_SETUJU_DETIK = 86_400;

/** Dipanggil di peramban tepat sebelum `signUp` / `signInWithOAuth`. */
export function titipPersetujuanDiPeramban(): void {
  document.cookie = `${COOKIE_SETUJU}=${VERSI_DOKUMEN}; Path=/; Max-Age=${UMUR_COOKIE_SETUJU_DETIK}; SameSite=Lax`;
}
```

`web/src/lib/persetujuan/tujuan.ts`:

```ts
import { tujuanProdukAman } from "@/lib/auth/tujuan-produk";

/**
 * Ke mana `/persetujuan` memulangkan klien sesudah ia setuju.
 *
 * SATU-SATUNYA pemberi `lanjut` adalah tombol beli di `/produk/[slug]`, jadi
 * whitelist-nya cukup regex ketat yang sudah ada (`^/produk/<slug>$`) —
 * dipakai ulang, tidak disalin. Layout `/passport` tidak tahu path asalnya,
 * sehingga klien yang tertahan di sana kembali ke `/passport`. Semua yang lain
 * — termasuk `//evil.com`, skema apa pun, dan larik dari query string ganda —
 * jatuh ke `/passport`.
 */
export function tujuanPersetujuanAman(lanjut: unknown): string {
  return tujuanProdukAman(typeof lanjut === "string" ? lanjut : null) ?? "/passport";
}
```

`web/src/lib/persetujuan/skrining.ts`:

```ts
import { VERSI_DOKUMEN } from "./versi";

/**
 * Dua kolom persetujuan untuk SETIAP insert `screenings`.
 *
 * Spec 2026-10-06, revisi 1: tidak ada trigger. Yang menegakkan aturan untuk
 * baris baru adalah (a) `SkemaSkriningPublik` yang mewajibkan
 * `setuju_privasi: true`, (b) fungsi ini — dipakai KEDUA rute skrining — dan
 * (c) `tests/skrining-persetujuan.test.ts` yang menuntut setiap
 * `.from("screenings").insert(` di `src/` memanggilnya.
 */
export function capPersetujuanSkrining(sekarang: Date = new Date()): {
  persetujuan_versi: string;
  persetujuan_pada: string;
} {
  return { persetujuan_versi: VERSI_DOKUMEN, persetujuan_pada: sekarang.toISOString() };
}
```

- [ ] **Langkah 5: Jalankan, pastikan lulus**

Run: `npm run test:murni -- tests/persetujuan-lib.test.ts`
Expected: PASS, semua kasus.

- [ ] **Langkah 6: Buktikan uji gagal-terbuka bisa merah**

Ganti sementara `return { sudahSetuju: true, pernahSetuju: true };` di cabang galat `status.ts` menjadi `return { sudahSetuju: false, pernahSetuju: false };`. Jalankan ujinya: kasus "GAGAL-TERBUKA" harus FAIL. Kembalikan, lalu jalankan lagi: PASS.

- [ ] **Langkah 7: Periksa tipe dan lint**

Run: `npx tsc --noEmit && npx eslint src/lib/persetujuan tests/persetujuan-lib.test.ts vitest.murni.config.ts`
Expected: tanpa galat.

- [ ] **Langkah 8: Commit**

```bash
git add vitest.murni.config.ts package.json src/lib/persetujuan tests/persetujuan-lib.test.ts
git commit -m "feat(persetujuan): modul versi, status, pencatat, cookie, dan tujuan aman"
```

---

### Tugas 2: Migrasi, uji ber-DB, seed, dan fixture

**Files:**
- Create: `web/supabase/migrations/20261006120000_persetujuan_dokumen.sql`
- Create: `web/tests/helpers/persetujuan.ts`
- Modify: `web/scripts/seed-users.ts` (sesudah upsert `clients` Ananda/Rina, sekitar baris 297)
- Modify: `web/tests/helpers/klien-kedua.ts` (`siapkanKlienKedua`, `bongkarKlienKedua`)
- Modify: `web/tests/grant-anon.test.ts` (`TABEL_TERTUTUP_ANON`)
- Test: `web/tests/persetujuan-db.test.ts`

**Interfaces:**
- Consumes: `VERSI_DOKUMEN` (Tugas 1).
- Produces:
  - tabel `public.persetujuan_akun(user_id uuid, versi text, jalur text, disetujui_pada timestamptz)` dengan PK `(user_id, versi)`;
  - kolom `screenings.persetujuan_versi text` dan `screenings.persetujuan_pada timestamptz`;
  - `setujuiDokumenUntukUji(svc: SupabaseClient, userId: string): Promise<void>` di `tests/helpers/persetujuan.ts`;
  - Ananda (`ananda@padma.test`) dan klien kedua sudah menyetujui versi berlaku.

> **Docker wajib untuk langkah 3, 5, dan 7.** Kalau Docker mati, berhenti sebelum langkah 3 dan laporkan ke pemilik repo. **Jangan** menandai uji ber-DB sebagai lulus tanpa menjalankannya.

- [ ] **Langkah 1: Tulis uji ber-DB yang gagal**

`web/tests/persetujuan-db.test.ts`:

```ts
/**
 * persetujuan_akun + kolom persetujuan di screenings (spec 2026-10-06) — BER-DB.
 *
 * Yang dijaga: tabelnya APPEND-ONLY dan MILIK SENDIRI. Klien hanya bisa
 * menyisipkan dan membaca barisnya sendiri, tidak bisa mengubah atau menghapus,
 * tidak bisa memalsukan waktunya, dan anon tidak punya hak apa pun. Plus: TIDAK
 * ada trigger di screenings (spec revisi 1) — baris tanpa persetujuan tetap
 * bisa disisipkan service role, persis seperti fixture lama.
 *
 * Memakai versi lampau khusus uji (`VERSI_UJI`) supaya tidak menyentuh baris
 * versi berlaku milik Ananda yang disemai `seedUsers`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { EMAIL_KLIEN_KEDUA, siapkanKlienKedua, bongkarKlienKedua } from "./helpers/klien-kedua";

const svc = createAdminSupabase();
const VERSI_UJI = "2000-01-01";
let uidAnanda = "";
let uidKedua = "";
const skriningUji: string[] = [];

async function uidDariEmail(email: string): Promise<string> {
  const { data, error } = await svc.from("clients").select("user_id").eq("email", email).single();
  if (error) throw error;
  return data!.user_id as string;
}

beforeAll(async () => {
  await siapkanKlienKedua();
  uidAnanda = await uidDariEmail("ananda@padma.test");
  uidKedua = await uidDariEmail(EMAIL_KLIEN_KEDUA);
  await svc.from("persetujuan_akun").delete().eq("versi", VERSI_UJI);
});

afterAll(async () => {
  await svc.from("persetujuan_akun").delete().eq("versi", VERSI_UJI);
  if (skriningUji.length) await svc.from("screenings").delete().in("kode", skriningUji);
  await bongkarKlienKedua();
});

describe("persetujuan_akun — append-only, milik sendiri", () => {
  it("klien mencatat lalu membaca persetujuannya sendiri", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { error } = await ananda
      .from("persetujuan_akun")
      .insert({ user_id: uidAnanda, versi: VERSI_UJI, jalur: "gerbang" });
    expect(error).toBeNull();

    const { data } = await ananda
      .from("persetujuan_akun")
      .select("versi, jalur, disetujui_pada")
      .eq("versi", VERSI_UJI);
    expect(data).toHaveLength(1);
    expect(data![0].jalur).toBe("gerbang");
    expect(data![0].disetujui_pada).toBeTruthy();
  });

  it("klien TIDAK bisa mencatat atas nama akun lain", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { error } = await ananda
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: VERSI_UJI, jalur: "gerbang" });
    expect(error?.code).toBe("42501");
  });

  it("klien TIDAK bisa membaca persetujuan akun lain", async () => {
    const { error } = await svc
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: VERSI_UJI, jalur: "daftar" });
    expect(error).toBeNull();

    const ananda = await signInAs("ananda@padma.test");
    const { data } = await ananda.from("persetujuan_akun").select("user_id").eq("user_id", uidKedua);
    expect(data).toEqual([]);
  });

  it("klien TIDAK bisa mengubah maupun menghapus catatannya", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const ubah = await ananda
      .from("persetujuan_akun")
      .update({ jalur: "daftar" })
      .eq("user_id", uidAnanda)
      .eq("versi", VERSI_UJI);
    expect(ubah.error?.code).toBe("42501");

    const hapus = await ananda
      .from("persetujuan_akun")
      .delete()
      .eq("user_id", uidAnanda)
      .eq("versi", VERSI_UJI);
    expect(hapus.error?.code).toBe("42501");
  });

  it("klien TIDAK bisa memalsukan waktu persetujuan", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { error } = await ananda.from("persetujuan_akun").insert({
      user_id: uidAnanda,
      versi: "2000-01-02",
      jalur: "gerbang",
      disetujui_pada: "2000-01-02T00:00:00Z",
    });
    expect(error?.code).toBe("42501");
  });

  it("versi dan jalur yang salah bentuk ditolak CHECK", async () => {
    const versiSalah = await svc
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: "v1", jalur: "gerbang" });
    expect(versiSalah.error?.code).toBe("23514");

    const jalurSalah = await svc
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: "2000-01-03", jalur: "admin" });
    expect(jalurSalah.error?.code).toBe("23514");
  });

  it("anon tidak bisa membaca maupun mencatat", async () => {
    const anon = anonClient();
    const baca = await anon.from("persetujuan_akun").select("user_id");
    expect(baca.error?.code).toBe("42501");
    const tulis = await anon
      .from("persetujuan_akun")
      .insert({ user_id: uidAnanda, versi: VERSI_UJI, jalur: "gerbang" });
    expect(tulis.error?.code).toBe("42501");
  });
});

describe("screenings — kolom persetujuan, TANPA trigger", () => {
  function barisUji(tambahan: Record<string, unknown>) {
    const kode = `UJI-SETUJU-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    skriningUji.push(kode);
    return {
      kode,
      nama: "Uji Persetujuan",
      no_hp: "0800-0000-0000",
      fase: "prekonsepsi",
      jawaban: {},
      hasil: "hijau",
      flags: [],
      ...tambahan,
    };
  }

  it("baris tanpa persetujuan tetap bisa disisipkan (fixture lama tidak patah)", async () => {
    const { error } = await svc.from("screenings").insert(barisUji({}));
    expect(error).toBeNull();
  });

  it("baris bercap persetujuan menyimpan versi dan waktunya", async () => {
    const baris = barisUji({ persetujuan_versi: "2026-10-06", persetujuan_pada: "2026-10-06T03:00:00Z" });
    const { error } = await svc.from("screenings").insert(baris);
    expect(error).toBeNull();
    const { data } = await svc
      .from("screenings")
      .select("persetujuan_versi, persetujuan_pada")
      .eq("kode", baris.kode)
      .single();
    expect(data!.persetujuan_versi).toBe("2026-10-06");
    expect(data!.persetujuan_pada).toBeTruthy();
  });

  it("versi skrining yang salah bentuk ditolak CHECK", async () => {
    const { error } = await svc
      .from("screenings")
      .insert(barisUji({ persetujuan_versi: "kemarin", persetujuan_pada: "2026-10-06T03:00:00Z" }));
    expect(error?.code).toBe("23514");
  });
});
```

Tambahkan juga `"persetujuan_akun",` ke `TABEL_TERTUTUP_ANON` di `web/tests/grant-anon.test.ts`, tepat sesudah baris `"pesanan_item_staf",`, dengan komentar di atasnya:

```ts
  // Persetujuan S&K (spec 2026-10-06): bukti hukum milik pemegang akun. Anon
  // tidak punya urusan dengannya — tidak membaca, tidak mencatat.
  "persetujuan_akun",
```

- [ ] **Langkah 2: Buat helper fixture dan pasang di klien kedua**

`web/tests/helpers/persetujuan.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
// Impor RELATIF, bukan alias `@/`: berkas ini dipakai juga oleh skrip e2e
// (`tsx tests/e2e/*.e2e.ts`) yang tidak mengenal alias vitest.
import { VERSI_DOKUMEN } from "../../src/lib/persetujuan/versi";

/**
 * Fixture: akun uji dianggap SUDAH menyetujui S&K + Kebijakan Privasi versi
 * berlaku, supaya layout `/passport` dan rute checkout tidak membelokkannya ke
 * `/persetujuan`. Lewat service role — ini setup, bukan alur pengguna.
 * Idempoten.
 */
export async function setujuiDokumenUntukUji(svc: SupabaseClient, userId: string): Promise<void> {
  const { error } = await svc
    .from("persetujuan_akun")
    .upsert(
      { user_id: userId, versi: VERSI_DOKUMEN, jalur: "gerbang" },
      { onConflict: "user_id,versi", ignoreDuplicates: true },
    );
  if (error) throw error;
}
```

Di `web/tests/helpers/klien-kedua.ts`:
- tambahkan impor `import { setujuiDokumenUntukUji } from "./persetujuan";`;
- di `siapkanKlienKedua`, tepat sebelum `return KLIEN_KEDUA_ID;`, sisipkan:

```ts
  // Tanpa ini checkout klien kedua dijawab 403 `perlu_persetujuan`
  // (spec 2026-10-06) dan uji pesanan menguji gerbang yang salah.
  await setujuiDokumenUntukUji(svc, data.user!.id);
```

- di `bongkarKlienKedua`, di dalam `if (u.email?.toLowerCase() === EMAIL_KLIEN_KEDUA) {`, tepat sebelum `await svc.auth.admin.deleteUser(u.id);`, sisipkan:

```ts
      // Tanpa FK (sengaja, spec 2026-10-06) — jadi dibersihkan manual.
      await svc.from("persetujuan_akun").delete().eq("user_id", u.id);
```

- [ ] **Langkah 3: Jalankan, pastikan gagal**

Pastikan Supabase lokal hidup (`npx supabase status`), lalu:
Run: `npx vitest run tests/persetujuan-db.test.ts`
Expected: FAIL. `siapkanKlienKedua` melempar `relation "public.persetujuan_akun" does not exist` (kode `42P01`).

- [ ] **Langkah 4: Tulis migrasinya**

`web/supabase/migrations/20261006120000_persetujuan_dokumen.sql`:

```sql
-- ===========================================================================
-- PERSETUJUAN S&K + KEBIJAKAN PRIVASI
-- ===========================================================================
-- Spec: docs/superpowers/specs/2026-10-06-padma-syarat-ketentuan-privasi-design.md
--
-- Dua tempat, satu nomor versi (`VERSI_DOKUMEN`, src/lib/persetujuan/versi.ts):
--   1. persetujuan_akun — log append-only per akun, per versi.
--   2. screenings.persetujuan_* — persetujuan eksplisit atas DATA KESEHATAN
--      yang diisi di skrining; skrining bisa diisi tanpa akun sama sekali.
--
-- Cap waktu 120000, BUKAN 100000: `feat/p4-rekap-penjualan` sudah memakai
-- 20261006100000_pesanan_item_produk_id.sql.

create table public.persetujuan_akun (
  -- Tanpa FK ke auth.users, seperti tabel jejak_*: ini BUKTI persetujuan dan
  -- harus tetap ada apa pun yang terjadi pada akunnya.
  user_id        uuid        not null,
  versi          text        not null check (versi ~ '^\d{4}-\d{2}-\d{2}$'),
  jalur          text        not null check (jalur in ('daftar', 'gerbang')),
  disetujui_pada timestamptz not null default now(),
  primary key (user_id, versi)
);

comment on table public.persetujuan_akun is
  'Persetujuan S&K + Kebijakan Privasi per akun per versi. Append-only: klien '
  'hanya menyisipkan & membaca miliknya sendiri, dan tidak bisa mengisi '
  'disetujui_pada. jalur: daftar = centang di /daftar (dicatat /setelah-masuk); '
  'gerbang = layar /persetujuan.';

alter table public.persetujuan_akun enable row level security;

revoke all on public.persetujuan_akun from anon;
revoke all on public.persetujuan_akun from authenticated;
grant select on public.persetujuan_akun to authenticated;
-- Hak insert TINGKAT KOLOM: `disetujui_pada` selalu dari default now(), jadi
-- klien tidak bisa menanggali mundur persetujuannya sendiri.
grant insert (user_id, versi, jalur) on public.persetujuan_akun to authenticated;

-- Tanpa policy staf: tidak ada layar staf yang membacanya (spec: di luar
-- cakupan), dan owner membaca lewat service role bila perlu.
create policy "persetujuan: klien baca miliknya" on public.persetujuan_akun
  for select to authenticated
  using (user_id = auth.uid());

create policy "persetujuan: klien catat miliknya" on public.persetujuan_akun
  for insert to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- screenings: dua kolom, nullable, TANPA trigger (spec revisi 1).
-- Baris lama tetap null — jujur: datanya terkumpul sebelum kebijakan ada.
-- Baris baru dicap oleh capPersetujuanSkrining() di kedua rute skrining.
-- ---------------------------------------------------------------------------
alter table public.screenings
  add column persetujuan_versi text check (persetujuan_versi ~ '^\d{4}-\d{2}-\d{2}$'),
  add column persetujuan_pada  timestamptz;

comment on column public.screenings.persetujuan_versi is
  'VERSI_DOKUMEN Kebijakan Privasi yang disetujui saat skrining dikirim. Null = '
  'skrining sebelum 2026-10-06.';
comment on column public.screenings.persetujuan_pada is
  'Waktu server saat persetujuan skrining dicap.';
```

- [ ] **Langkah 5: Terapkan ke Supabase lokal, lalu jalankan uji**

Run: `npx supabase migration up` (bukan `db reset`, bukan `db push`), lalu `npx vitest run tests/persetujuan-db.test.ts tests/grant-anon.test.ts tests/struktur-rls.test.ts`
Expected: PASS.

`struktur-rls` tetap hijau tanpa perubahan: tabel baru punya RLS dan punya policy, jadi tidak masuk `SENGAJA_TERKUNCI`.

- [ ] **Langkah 6: Semai persetujuan Ananda**

Di `web/scripts/seed-users.ts`, tambahkan impor di bawah impor `rasterisasi`:

```ts
import { VERSI_DOKUMEN } from "../src/lib/persetujuan/versi";
```

Lalu sisipkan tepat sesudah `if (cErr) throw cErr;` (yang mengikuti upsert `clients` Ananda/Rina):

```ts
  // Ananda dianggap SUDAH menyetujui S&K + Kebijakan Privasi versi berlaku
  // (spec 2026-10-06), supaya demo dev, uji vitest, dan e2e yang memakainya
  // tidak dibelokkan ke /persetujuan. Gerbang itu sendiri diuji e2e passport
  // dengan MENGHAPUS baris ini lebih dulu. Upsert: aman diulang, dan versi
  // baru otomatis tersemai begitu VERSI_DOKUMEN dinaikkan.
  const { error: pErr } = await admin
    .from("persetujuan_akun")
    .upsert(
      { user_id: ananda.id, versi: VERSI_DOKUMEN, jalur: "gerbang" },
      { onConflict: "user_id,versi", ignoreDuplicates: true },
    );
  if (pErr) throw pErr;
```

- [ ] **Langkah 7: Buktikan uji RLS bisa merah, lalu jalankan uji pesanan yang bergantung pada fixture**

Longgarkan grant-nya sementara, langsung di DB lokal. Berkas migrasi tidak disentuh.

```bash
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
psql "$DB" -c "grant insert on public.persetujuan_akun to authenticated;"
npx vitest run tests/persetujuan-db.test.ts   # kasus "memalsukan waktu" HARUS FAIL
psql "$DB" -c "revoke insert on public.persetujuan_akun from authenticated; grant insert (user_id, versi, jalur) on public.persetujuan_akun to authenticated;"
npx vitest run tests/persetujuan-db.test.ts   # kembali PASS
```

Run: `npx vitest run tests/persetujuan-db.test.ts tests/pesanan-checkout-rute.test.ts`
Expected: PASS. Pada tahap ini checkout belum memeriksa persetujuan; uji ini memastikan `klien-kedua` tidak rusak oleh fixture baru.

- [ ] **Langkah 8: Commit**

```bash
git add supabase/migrations/20261006120000_persetujuan_dokumen.sql tests/persetujuan-db.test.ts \
  tests/helpers/persetujuan.ts tests/helpers/klien-kedua.ts tests/grant-anon.test.ts scripts/seed-users.ts
git commit -m "feat(persetujuan): tabel persetujuan_akun append-only + kolom persetujuan skrining"
```

---

### Tugas 3: Halaman `/syarat-ketentuan` dan `/kebijakan-privasi`, plus tautan footer

**Files:**
- Create: `web/src/app/_dokumen/bagian.ts`
- Create: `web/src/app/_dokumen/kerangka.tsx`
- Create: `web/src/app/_dokumen/isi-syarat-ketentuan.tsx`
- Create: `web/src/app/_dokumen/isi-kebijakan-privasi.tsx`
- Create: `web/src/app/syarat-ketentuan/page.tsx`
- Create: `web/src/app/kebijakan-privasi/page.tsx`
- Modify: `web/src/app/_situs/shell.tsx` (`aktif` jadi opsional)
- Modify: `web/src/app/_situs/header.tsx:44` (`aktif` jadi opsional)
- Modify: `web/src/app/_situs/footer.tsx` (baris bawah)
- Test: `web/tests/dokumen-hukum.test.tsx`

**Interfaces:**
- Consumes: `VERSI_DOKUMEN` (Tugas 1); `formatTanggalID(tgl: string): string` dari `@/lib/passport/waktu`; `bacaPengaturan()`. Tautan WA dirakit polos `https://wa.me/${nomorWaLink}`, **bukan** `tautanWaSitus`, yang mengisi pesan "tanya kelas serta pricelist".
- Produces:
  - `BAGIAN_SK` dan `BAGIAN_PRIVASI`: `readonly { id: string; judul: string }[]`;
  - `JANGKAR_PERSETUJUAN = { dataKesehatan, pihakKetiga, hakAnda }`, berisi URL `/kebijakan-privasi#…`, dipakai Tugas 4 dan 6;
  - rute `/syarat-ketentuan` dan `/kebijakan-privasi`.

- [ ] **Langkah 1: Tulis uji yang gagal**

`web/tests/dokumen-hukum.test.tsx`:

```tsx
/**
 * Halaman Syarat & Ketentuan dan Kebijakan Privasi (spec 2026-10-06) — MURNI.
 *
 * `bacaPengaturan` di-mock: nomor WA dan area dibaca dari pengaturan admin,
 * dan uji ini memastikan keduanya benar-benar sampai ke teks.
 *
 * Yang dijaga BUKAN gaya bahasanya, melainkan FAKTA yang wajib tertulis
 * (spec "isi wajib per bagian"): angka-angka kebijakan pembatalan klien, nama
 * setiap pemroses data, pengakuan data kesehatan sebagai data pribadi
 * spesifik — dan janji yang TIDAK boleh ada (backup).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/settings", () => ({
  bacaPengaturan: async () => ({
    nomorWaLink: "6281234567890",
    nomorWaTampilan: "0812-3456-7890",
    alamatTampilan: "Melayani Malang Raya dan Batu",
    jamTampilan: "Senin–Sabtu 08.00–17.00",
  }),
}));

const { default: HalamanSK } = await import("@/app/syarat-ketentuan/page");
const { default: HalamanPrivasi } = await import("@/app/kebijakan-privasi/page");
const { BAGIAN_SK, BAGIAN_PRIVASI, JANGKAR_PERSETUJUAN } = await import("@/app/_dokumen/bagian");
const { FooterSitus } = await import("@/app/_situs/footer");
const { VERSI_DOKUMEN } = await import("@/lib/persetujuan/versi");
const { formatTanggalID } = await import("@/lib/passport/waktu");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Markup → teks polos: tag dibuang, entitas yang di-escape React dikembalikan. */
function polos(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const sk = renderToStaticMarkup(await HalamanSK());
const privasi = renderToStaticMarkup(await HalamanPrivasi());
const teksSK = polos(sk);
const teksPrivasi = polos(privasi);

describe("kedua halaman — kerangka", () => {
  it.each([
    ["S&K", () => teksSK],
    ["Privasi", () => teksPrivasi],
  ])("%s menampilkan tanggal berlaku dari VERSI_DOKUMEN", (_n, teks) => {
    expect(teks()).toContain(`Berlaku sejak ${formatTanggalID(VERSI_DOKUMEN)}`);
  });

  it.each([
    ["S&K", BAGIAN_SK, () => sk, () => teksSK],
    ["Privasi", BAGIAN_PRIVASI, () => privasi, () => teksPrivasi],
  ] as const)("%s: setiap bagian punya jangkar, judul bernomor, dan entri daftar isi", (_n, daftar, m, t) => {
    daftar.forEach((b, i) => {
      expect(m(), `id="${b.id}" hilang`).toContain(`id="${b.id}"`);
      expect(m(), `daftar isi #${b.id} hilang`).toContain(`href="#${b.id}"`);
      expect(t()).toContain(`${i + 1}. ${b.judul}`);
    });
  });

  it("setiap jangkar yang ditautkan layar persetujuan BENAR-BENAR ada", () => {
    for (const url of Object.values(JANGKAR_PERSETUJUAN)) {
      const [halaman, jangkar] = url.split("#");
      expect(halaman).toBe("/kebijakan-privasi");
      expect(privasi, `jangkar #${jangkar} tidak ada`).toContain(`id="${jangkar}"`);
    }
  });

  it("halaman publik: tidak memanggil requireRole dan tidak mengaktifkan item nav mana pun", () => {
    expect(baca("src/app/syarat-ketentuan/page.tsx")).not.toContain("requireRole");
    expect(baca("src/app/kebijakan-privasi/page.tsx")).not.toContain("requireRole");
    expect(sk).not.toContain('aria-current="page"');
    expect(privasi).not.toContain('aria-current="page"');
  });

  it("nomor WhatsApp kontak dibaca dari pengaturan, tidak ditulis keras", () => {
    for (const [m, t] of [[sk, teksSK], [privasi, teksPrivasi]]) {
      expect(t).toContain("0812-3456-7890");
      expect(m).toContain("wa.me/6281234567890");
    }
    expect(baca("src/app/_dokumen/isi-syarat-ketentuan.tsx")).not.toMatch(/\b62\d{8,}\b/);
    expect(baca("src/app/_dokumen/isi-kebijakan-privasi.tsx")).not.toMatch(/\b62\d{8,}\b/);
  });
});

describe("Syarat & Ketentuan — fakta wajib", () => {
  it("kebijakan pembatalan klien disalin UTUH (empat jenjang + darurat medis)", () => {
    for (const penggal of [
      "≥ 24 jam",
      "Refund 100%",
      "reschedule gratis",
      "2–24 jam",
      "Reschedule gratis 1×",
      "kredit layanan, berlaku 30 hari",
      "< 2 jam",
      "mitra sudah berangkat",
      "no-show",
      "Dana tidak dapat dikembalikan",
      "pemesanan baru",
      "PADMA yang membatalkan",
      "reschedule prioritas tanpa biaya tambahan",
      "Persalinan dan rawat inap",
      "ditinjau",
    ]) {
      expect(teksSK, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("keputusan C3 ikut tertulis: 1× per pemesanan, layanan yang sama, +30 hari, WIB", () => {
    for (const penggal of [
      "1× per pemesanan",
      "layanan yang sama",
      "30 hari setelah tanggal sesi yang dibatalkan",
      "WIB",
    ]) {
      expect(teksSK, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("bukan layanan medis, nomor darurat, usia, tenggat, produk digital, area", () => {
    for (const penggal of [
      "bukan layanan medis",
      "119",
      "18 tahun",
      "24 jam",
      "tidak dapat dikembalikan",
      "lisensi pribadi",
      "Melayani Malang Raya dan Batu",
      "PADMA Wellness",
    ]) {
      expect(teksSK, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("tidak menjanjikan lama proses refund (belum diputuskan klien)", () => {
    expect(teksSK).not.toMatch(/refund[^.]*\b\d+\s*(hari|jam)\s*kerja/i);
  });
});

describe("Kebijakan Privasi — fakta wajib", () => {
  it("menyebut setiap pemroses pihak ketiga", () => {
    for (const nama of ["Supabase", "Vercel", "Cloudflare R2", "Resend", "Google", "Midtrans", "OpenStreetMap"]) {
      expect(teksPrivasi, `pemroses hilang: ${nama}`).toContain(nama);
    }
  });

  it("data kesehatan disebut terang sebagai data pribadi spesifik, termasuk kesehatan mental", () => {
    for (const penggal of ["data pribadi spesifik", "kesehatan mental", "usia kehamilan", "persetujuan eksplisit"]) {
      expect(teksPrivasi, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("mengungkap transfer ke luar negeri, WhatsApp/Meta, dan isi bukti bayar", () => {
    for (const penggal of ["Singapura", "HIJAU atau MERAH", "Meta", "nomor rekening", "saldo"]) {
      expect(teksPrivasi, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("hak UU PDP, batas tanggap, dan cookie tanpa pelacak", () => {
    for (const penggal of [
      "Undang-Undang Nomor 27 Tahun 2022",
      "menarik persetujuan",
      "3×24 jam",
      "tidak memakai cookie analitik atau pelacak",
      "tidak mengumpulkan data bayi",
      "tidak menjualnya",
    ]) {
      expect(teksPrivasi, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("TIDAK menjanjikan backup — jadwal backup otomatis masih mati", () => {
    expect(teksPrivasi).not.toMatch(/backup|cadangan/i);
  });
});

describe("footer situs", () => {
  it("menautkan kedua dokumen di baris bawah", () => {
    const m = renderToStaticMarkup(
      <FooterSitus waTampilan="0812-3456-7890" alamat="Malang" jam="Senin–Sabtu" />,
    );
    expect(m).toContain('href="/syarat-ketentuan"');
    expect(m).toContain('href="/kebijakan-privasi"');
  });
});
```

- [ ] **Langkah 2: Jalankan, pastikan gagal**

Run: `npm run test:murni -- tests/dokumen-hukum.test.tsx`
Expected: FAIL. Pesannya `Failed to resolve import "@/app/syarat-ketentuan/page"`.

- [ ] **Langkah 3: Jadikan `aktif` opsional di shell dan header situs**

Di `web/src/app/_situs/shell.tsx`, pada tipe props `SitusShell`, ganti `aktif: HalamanSitus;` menjadi:

```ts
  /** Kosong untuk halaman di luar menu (mis. dokumen hukum): tidak ada item nav yang menyala. */
  aktif?: HalamanSitus;
```

Di `web/src/app/_situs/header.tsx:44`, ganti signature:

```tsx
export function HeaderSitus({ aktif, waHref }: { aktif?: HalamanSitus; waHref: string }) {
```

Tidak ada perubahan lain: `n.id === aktif` bernilai `false` untuk `undefined`, dan `key={aktif}` menerima `undefined`.

- [ ] **Langkah 4: Daftar bagian dan kerangka dokumen**

`web/src/app/_dokumen/bagian.ts`:

```ts
/**
 * Daftar bagian kedua dokumen hukum — SATU sumber untuk daftar isi, judul
 * bernomor, jangkar, dan uji (`tests/dokumen-hukum.test.tsx`). Mengubah `id`
 * di sini memutus tautan dari layar `/persetujuan`; ujinya akan merah.
 */
export const BAGIAN_SK = [
  { id: "penerimaan", judul: "Penerimaan Ketentuan" },
  { id: "tentang-layanan", judul: "Tentang Layanan PADMA" },
  { id: "akun", judul: "Akun dan Digital Passport" },
  { id: "skrining", judul: "Skrining Kesehatan" },
  { id: "pemesanan", judul: "Pemesanan dan Kunjungan" },
  { id: "pembayaran", judul: "Pembayaran" },
  { id: "pembatalan", judul: "Pembatalan dan Jadwal Ulang" },
  { id: "produk-digital", judul: "Produk Digital" },
  { id: "testimoni", judul: "Testimoni" },
  { id: "batasan-tanggung-jawab", judul: "Batasan Tanggung Jawab" },
  { id: "perubahan", judul: "Perubahan Ketentuan" },
  { id: "hukum-kontak", judul: "Hukum yang Berlaku dan Kontak" },
] as const;

export const BAGIAN_PRIVASI = [
  { id: "pengendali", judul: "Siapa Kami" },
  { id: "data-dikumpulkan", judul: "Data yang Kami Kumpulkan" },
  { id: "tujuan", judul: "Untuk Apa Data Dipakai" },
  { id: "akses", judul: "Siapa yang Dapat Melihat Data Anda" },
  { id: "pihak-ketiga", judul: "Pemroses Pihak Ketiga dan Transfer ke Luar Negeri" },
  { id: "whatsapp", judul: "WhatsApp" },
  { id: "keamanan", judul: "Keamanan" },
  { id: "penyimpanan", judul: "Penyimpanan dan Penghapusan" },
  { id: "hak-anda", judul: "Hak Anda" },
  { id: "cookie", judul: "Cookie" },
  { id: "kebocoran", judul: "Kebocoran Data" },
  { id: "perubahan-kontak", judul: "Perubahan Kebijakan dan Kontak" },
] as const;

/** Tautan dari layar `/persetujuan` dan centang skrining ke bagian yang relevan. */
export const JANGKAR_PERSETUJUAN = {
  dataKesehatan: "/kebijakan-privasi#data-kesehatan",
  pihakKetiga: "/kebijakan-privasi#pihak-ketiga",
  hakAnda: "/kebijakan-privasi#hak-anda",
} as const;

export type DaftarBagian = readonly { readonly id: string; readonly judul: string }[];
```

`web/src/app/_dokumen/kerangka.tsx`:

```tsx
import type { ReactNode } from "react";
import { formatTanggalID } from "@/lib/passport/waktu";
import { VERSI_DOKUMEN } from "@/lib/persetujuan/versi";
import { Label, Wadah } from "../_situs/shell";
import type { DaftarBagian } from "./bagian";

/**
 * Kerangka dua dokumen hukum. Lebar teks 720px dan ukuran huruf mengikuti
 * halaman artikel (`src/app/artikel/[slug]/page.tsx`) — prosa panjang yang
 * sama-sama dibaca dari atas ke bawah.
 */
export function KerangkaDokumen({
  judul,
  pengantar,
  bagian,
  children,
}: {
  judul: string;
  pengantar: string;
  bagian: DaftarBagian;
  children: ReactNode;
}) {
  return (
    <Wadah className="pt-8 pb-16 lg:pt-12">
      <article className="mx-auto flex max-w-[720px] flex-col">
        <Label>Dokumen PADMA</Label>
        <h1 className="mt-3 font-garamond text-[36px] leading-[1.08] font-bold text-situs-judul sm:text-[44px] lg:text-[50px]">
          {judul}
        </h1>
        <p className="mt-4 text-sm text-situs-abu">Berlaku sejak {formatTanggalID(VERSI_DOKUMEN)}</p>
        <p className="mt-6 text-[17px] leading-[1.75] text-situs-teks md:text-lg">{pengantar}</p>
        <nav aria-label="Daftar isi" className="mt-8 rounded-xl border border-situs-garis bg-situs-kartu px-5 py-4">
          <p className="text-sm font-semibold text-situs-judul">Daftar isi</p>
          <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[15px] marker:text-situs-abu">
            {bagian.map((b) => (
              <li key={b.id}>
                <a href={`#${b.id}`} className="text-situs-emas hover:text-situs-emas-tua hover:underline">
                  {b.judul}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex flex-col">{children}</div>
      </article>
    </Wadah>
  );
}

/** Satu bagian bernomor. Nomor dan judul diturunkan dari daftar — tidak diketik ulang. */
export function Bagian<D extends DaftarBagian>({
  daftar,
  id,
  children,
}: {
  daftar: D;
  id: D[number]["id"];
  children: ReactNode;
}) {
  const nomor = daftar.findIndex((b) => b.id === id) + 1;
  const judul = daftar[nomor - 1]?.judul ?? id;
  return (
    <section
      id={id}
      aria-labelledby={`judul-${id}`}
      className="mt-10 scroll-mt-28 border-t border-situs-garis pt-8"
    >
      <h2
        id={`judul-${id}`}
        className="font-garamond text-[28px] leading-tight font-bold text-situs-judul md:text-[32px]"
      >
        {nomor}. {judul}
      </h2>
      <div className="mt-4 flex flex-col gap-4 text-[17px] leading-[1.75] text-situs-teks md:text-lg">
        {children}
      </div>
    </section>
  );
}

export function Butir({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-situs-emas">{children}</ul>;
}

export function TautanWa({ href, tampilan }: { href: string; tampilan: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-situs-emas underline underline-offset-2 hover:text-situs-emas-tua"
    >
      {tampilan}
    </a>
  );
}
```

- [ ] **Langkah 5: Isi Syarat & Ketentuan**

`web/src/app/_dokumen/isi-syarat-ketentuan.tsx`:

```tsx
import Link from "next/link";
import { Bagian, Butir, TautanWa } from "./kerangka";
import { BAGIAN_SK } from "./bagian";

/**
 * ISI SYARAT & KETENTUAN — DRAF TEKNIS, BUKAN NASIHAT HUKUM.
 *
 * Wajib dibaca konsultan hukum dan disetujui klien PADMA sebelum rilis (spec
 * 2026-10-06, "Prasyarat rilis"). Setiap fakta di sini dirujuk dari spec
 * "isi wajib per bagian"; mengubahnya tanpa menaikkan VERSI_DOKUMEN berarti
 * klien terikat pada teks yang tidak pernah mereka setujui.
 *
 * Tabel pembatalan DISALIN UTUH dari
 * docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md. Jangan meringkas
 * dari ingatan — baca dari sana.
 */
export function IsiSyaratKetentuan({
  waHref,
  waTampilan,
  area,
}: {
  waHref: string;
  waTampilan: string;
  area: string;
}) {
  return (
    <>
      <Bagian daftar={BAGIAN_SK} id="penerimaan">
        <p>
          Syarat & Ketentuan ini mengatur pemakaian situs, Digital Passport, skrining, layanan
          kunjungan, dan produk digital PADMA Wellness (&ldquo;PADMA&rdquo;, &ldquo;kami&rdquo;). Anda
          menyatakan setuju dengan mencentang kotak persetujuan di formulir pendaftaran, skrining, atau
          layar persetujuan. Bila Anda tidak setuju, mohon tidak memakai layanan kami.
        </p>
        <p>
          Ketentuan ini dibaca bersama{" "}
          <Link href="/kebijakan-privasi" className="font-semibold text-situs-emas underline underline-offset-2 hover:text-situs-emas-tua">
            Kebijakan Privasi
          </Link>{" "}
          PADMA.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="tentang-layanan">
        <p>
          PADMA adalah layanan wellness dan edukasi bagi perempuan dan keluarga, dari program kehamilan,
          kehamilan, masa nifas, hingga menopause. PADMA bukan layanan medis: kami tidak memberikan
          diagnosis, terapi medis, maupun resep. Bila diperlukan asesmen individual, diagnosis, atau
          terapi medis, kami mengarahkan Anda ke tenaga medis yang sesuai.
        </p>
        <p>
          Materi edukasi dan artikel PADMA bukan pengganti saran dokter atau bidan yang merawat Anda.
          Dalam keadaan darurat, segera hubungi <strong>119</strong> atau fasilitas kesehatan terdekat.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="akun">
        <Butir>
          <li>Anda harus berusia minimal 18 tahun untuk membuat akun.</li>
          <li>
            Data yang Anda isi harus benar dan terbaru. Nama, nomor WhatsApp, dan alamat dapat Anda
            perbarui sendiri di Profil Passport.
          </li>
          <li>
            Satu akun untuk satu orang. Jaga kerahasiaan kata sandi Anda; aktivitas melalui akun Anda
            dianggap dilakukan oleh Anda.
          </li>
          <li>Segera kabari kami bila Anda menduga akun Anda dipakai orang lain.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="skrining">
        <Butir>
          <li>Skrining wajib diisi sebelum layanan kunjungan dijadwalkan.</li>
          <li>
            Isi skrining dengan jujur sesuai kondisi Anda saat itu. Informasi yang tidak lengkap atau
            tidak benar dapat membahayakan keselamatan Anda.
          </li>
          <li>
            Hasil skrining adalah pra-skrining keselamatan, bukan diagnosis dan bukan izin medis. Tim
            PADMA tetap memverifikasi kondisi Anda sebelum layanan.
          </li>
          <li>
            PADMA berhak menunda, menyesuaikan, atau menolak layanan bila skrining atau pengamatan di
            lokasi menunjukkan tanda bahaya, dan dapat menyarankan Anda menemui dokter lebih dulu.
          </li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="pemesanan">
        <Butir>
          <li>
            Pemesanan diajukan lewat Digital Passport dan baru pasti setelah dikonfirmasi admin PADMA.
          </li>
          <li>Wilayah layanan kunjungan rumah: {area}.</li>
          <li>Biaya transport mengikuti alamat kunjungan dan tercantum di tagihan Anda.</li>
          <li>Bidan atau mitra yang bertugas ditentukan oleh PADMA.</li>
          <li>Pastikan alamat kunjungan benar dan Anda dapat dihubungi pada hari layanan.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="pembayaran">
        <Butir>
          <li>
            Sesi kunjungan dibayar lewat QRIS PADMA, lalu bukti pembayarannya diunggah di Digital
            Passport.
          </li>
          <li>
            Tagihan sesi harus dibayar dalam 24 jam sejak terbit. Lewat dari itu, pengajuan batal dan
            slotnya dilepas untuk klien lain.
          </li>
          <li>
            Produk digital dibayar lewat Midtrans. Pesanan yang tidak dibayar dalam 24 jam kedaluwarsa
            dengan sendirinya.
          </li>
          <li>Harga yang berlaku adalah harga yang tertera saat tagihan atau pesanan dibuat.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="pembatalan">
        <p>Kebijakan pembatalan dan jadwal ulang sesi kunjungan:</p>
        <div className="overflow-x-auto rounded-xl border border-situs-garis">
          <table className="w-full min-w-[520px] border-collapse text-left text-[15px] leading-relaxed">
            <thead className="bg-situs-kartu text-situs-judul">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Keadaan</th>
                <th scope="col" className="px-4 py-3 font-semibold">Yang berlaku</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-situs-garis">
              <tr>
                <td className="px-4 py-3 align-top"><strong>≥ 24 jam</strong> sebelum sesi</td>
                <td className="px-4 py-3 align-top"><strong>Refund 100%</strong> ATAU <strong>reschedule gratis</strong></td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top"><strong>2–24 jam</strong> sebelum sesi</td>
                <td className="px-4 py-3 align-top">
                  <strong>Reschedule gratis 1×.</strong> Bila memilih batal: dana menjadi{" "}
                  <strong>kredit layanan, berlaku 30 hari</strong>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">
                  <strong>{"< 2 jam"}</strong>, ATAU <strong>mitra sudah berangkat</strong>, ATAU{" "}
                  <strong>no-show</strong>
                </td>
                <td className="px-4 py-3 align-top">
                  <strong>Dana tidak dapat dikembalikan.</strong> Jadwal ulang dihitung sebagai{" "}
                  <strong>pemesanan baru</strong>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top"><strong>PADMA yang membatalkan</strong></td>
                <td className="px-4 py-3 align-top">
                  <strong>Refund 100%</strong> ATAU <strong>reschedule prioritas tanpa biaya tambahan</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>Pengecualian, keadaan darurat medis:</strong> Persalinan dan rawat inap ditinjau untuk
          reschedule tanpa penalti.
        </p>
        <Butir>
          <li>
            Reschedule gratis pada jendela 2–24 jam berlaku 1× per pemesanan. Setelah jatah itu terpakai,
            permintaan jadwal ulang berikutnya pada jendela yang sama diperlakukan sebagai pembatalan:
            dana menjadi kredit layanan.
          </li>
          <li>
            Kredit layanan berupa hak satu sesi untuk layanan yang sama, tidak dapat dipindahkan ke
            layanan lain, dan berlaku sampai 30 hari setelah tanggal sesi yang dibatalkan.
          </li>
          <li>
            Seluruh batas waktu dihitung dari tanggal dan jam mulai sesi dalam Waktu Indonesia Barat
            (WIB).
          </li>
          <li>Refund diproses manual oleh admin PADMA melalui transfer bank.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="produk-digital">
        <Butir>
          <li>
            Pembelian produk digital memberi Anda lisensi pribadi yang tidak dapat dialihkan untuk
            memakai materi tersebut bagi diri sendiri.
          </li>
          <li>
            Anda tidak boleh membagikan, mengunggah ulang, menggandakan untuk orang lain, atau menjual
            ulang materi PADMA.
          </li>
          <li>
            Halaman PDF yang dibaca di Passport ditandai nama dan PADMA ID Anda; berkas PDF yang diunduh
            dicap nama dan email Anda di setiap halaman.
          </li>
          <li>Produk digital dikirim seketika sesudah pembayaran dan tidak dapat dikembalikan.</li>
          <li>PADMA dapat mencabut akses bila ketentuan ini dilanggar.</li>
          <li>Bila produk tidak dapat dibuka karena kendala teknis, hubungi admin lewat WhatsApp.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="testimoni">
        <p>
          PADMA hanya menayangkan testimoni, termasuk video, dengan izin pemiliknya. Anda dapat meminta
          testimoni Anda diturunkan lewat WhatsApp admin.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="batasan-tanggung-jawab">
        <p>
          Sepanjang diizinkan hukum, PADMA tidak bertanggung jawab atas kerugian yang timbul dari kondisi
          yang tidak diungkapkan atau diungkapkan tidak benar saat skrining maupun sesi, dari pemakaian
          materi edukasi sebagai pengganti nasihat dokter atau bidan, atau dari gangguan layanan pihak
          ketiga di luar kendali kami. Ketentuan ini tidak mengurangi hak Anda sebagai konsumen menurut
          peraturan perundang-undangan.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="perubahan">
        <p>
          Kami dapat memperbarui Syarat & Ketentuan ini. Versi terbaru selalu tersedia di halaman ini
          beserta tanggal berlakunya. Bila ada perubahan, Anda akan diminta menyetujui versi baru sebelum
          memakai Digital Passport lagi.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="hukum-kontak">
        <p>
          Syarat & Ketentuan ini tunduk pada hukum Republik Indonesia. Perselisihan diupayakan selesai
          lebih dulu secara musyawarah.
        </p>
        <p>
          Pertanyaan tentang ketentuan ini dapat disampaikan ke WhatsApp admin PADMA:{" "}
          <TautanWa href={waHref} tampilan={waTampilan} />.
        </p>
      </Bagian>
    </>
  );
}
```

- [ ] **Langkah 6: Isi Kebijakan Privasi**

`web/src/app/_dokumen/isi-kebijakan-privasi.tsx`:

```tsx
import { Bagian, Butir, TautanWa } from "./kerangka";
import { BAGIAN_PRIVASI } from "./bagian";

/**
 * ISI KEBIJAKAN PRIVASI — DRAF TEKNIS, BUKAN NASIHAT HUKUM.
 *
 * Setiap pernyataan diturunkan dari inventaris data 6 Okt 2026 (spec
 * 2026-10-06). JANGAN menambahkan janji yang tidak dijalankan sistem — dua
 * yang paling menggoda dan SALAH hari ini: "data dicadangkan setiap hari"
 * (jadwal backup masih dimatikan) dan "Anda dapat menghapus akun sendiri"
 * (tidak ada fitur itu; DB melarang hapus rekam klien).
 *
 * Wilayah Supabase ("Singapura") wajib dicek di dasbor sebelum rilis — spec
 * deploy menyebut Singapura, spec backup masih menyebut Seoul.
 */
const PEMROSES = [
  { nama: "Supabase", guna: "Basis data, autentikasi, dan penyimpanan berkas, termasuk bukti pembayaran" },
  { nama: "Vercel", guna: "Hosting situs dan aplikasi" },
  { nama: "Cloudflare R2", guna: "Penyimpanan video materi, produk, dan testimoni" },
  { nama: "Resend", guna: "Pengiriman email sistem dan tagihan" },
  { nama: "Google", guna: "Masuk dengan akun Google, bila Anda memilihnya" },
  { nama: "Midtrans", guna: "Pemrosesan pembayaran produk digital" },
  { nama: "OpenStreetMap (Nominatim)", guna: "Mengubah teks alamat menjadi titik koordinat" },
] as const;

export function IsiKebijakanPrivasi({ waHref, waTampilan }: { waHref: string; waTampilan: string }) {
  return (
    <>
      <Bagian daftar={BAGIAN_PRIVASI} id="pengendali">
        <p>
          Kebijakan Privasi ini menjelaskan bagaimana PADMA Wellness (&ldquo;PADMA&rdquo;,
          &ldquo;kami&rdquo;) mengumpulkan, memakai, menyimpan, dan melindungi data pribadi Anda, sesuai
          Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi. PADMA adalah pengendali
          data pribadi yang Anda berikan lewat situs dan Digital Passport.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="data-dikumpulkan">
        <Butir>
          <li>
            <strong>Data akun:</strong> nama, email, nomor WhatsApp, dan kata sandi (disimpan dalam
            bentuk tersandi yang tidak dapat kami baca). Bila Anda masuk dengan Google, kami menerima
            nama, email, dan foto profil dari Google.
          </li>
          <li>
            <strong>Alamat kunjungan</strong> beserta titik koordinatnya, untuk menghitung biaya
            transport dan menuju lokasi Anda.
          </li>
          <li id="data-kesehatan" className="scroll-mt-28">
            <strong>Data kesehatan (data pribadi spesifik):</strong> jawaban skrining atas pertanyaan
            keselamatan, termasuk tentang perdarahan, nyeri, infeksi, kehamilan, dan kesehatan mental;
            fase Anda (program kehamilan, hamil, nifas, atau menopause); usia kehamilan bila Anda
            mengisinya; serta hasil skrining. Data ini hanya kami proses dengan persetujuan eksplisit
            Anda.
          </li>
          <li>
            <strong>Catatan dan rekomendasi sesi</strong> yang ditulis tim PADMA, yang dapat Anda baca
            di Passport, serta penilaian dan komentar Anda atas sesi.
          </li>
          <li>
            <strong>Bukti pembayaran:</strong> gambar yang Anda unggah dapat memuat nama pemilik
            rekening, nomor rekening, dan saldo. Kami menyarankan Anda menutupi saldo sebelum
            mengunggah.
          </li>
          <li>
            <strong>Riwayat pesanan dan pembayaran</strong>, termasuk metode bayar dan nomor transaksi
            dari Midtrans. Data kartu atau rekening yang Anda masukkan di halaman pembayaran Midtrans
            tidak diterima PADMA.
          </li>
          <li>
            <strong>Pembelian produk digital:</strong> nama dan email Anda dicetak pada berkas yang Anda
            unduh.
          </li>
          <li>
            <strong>Testimoni</strong> (nama, keterangan, kutipan, dan video), hanya bila Anda
            mengizinkannya.
          </li>
          <li>
            <strong>Data teknis:</strong> cookie yang diperlukan untuk sesi masuk. Alamat IP diproses
            sesaat untuk membatasi percobaan berulang dan tidak disimpan oleh aplikasi kami.
          </li>
        </Butir>
        <p>Kami tidak mengumpulkan data bayi, seperti nama atau tanggal lahir bayi.</p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="tujuan">
        <Butir>
          <li>Menilai keselamatan dan kelayakan layanan, berdasarkan persetujuan eksplisit Anda.</li>
          <li>
            Menjadwalkan dan menjalankan kunjungan, serta menyediakan Digital Passport dan produk
            digital, untuk melaksanakan layanan yang Anda pesan.
          </li>
          <li>
            Memproses pembayaran dan mencatat transaksi, untuk melaksanakan layanan dan memenuhi
            kewajiban hukum, termasuk pembukuan.
          </li>
          <li>Menghubungi Anda tentang layanan, tagihan, dan jadwal.</li>
        </Butir>
        <p>Kami tidak memakai data Anda untuk iklan dan tidak menjualnya kepada siapa pun.</p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="akses">
        <Butir>
          <li>Admin dan pemilik PADMA, sesuai tugasnya.</li>
          <li>
            Bidan atau mitra yang ditugaskan untuk sesi Anda, sebatas yang diperlukan untuk menjalankan
            kunjungan, misalnya nama, alamat, jadwal, dan catatan kondisi yang relevan. Mitra tidak
            memiliki akun di aplikasi PADMA.
          </li>
          <li>Pemroses pihak ketiga pada bagian berikut, sebatas fungsinya.</li>
          <li>Pihak berwenang, bila diwajibkan oleh hukum.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="pihak-ketiga">
        <p>Kami memakai penyedia layanan berikut untuk menjalankan PADMA:</p>
        <div className="overflow-x-auto rounded-xl border border-situs-garis">
          <table className="w-full min-w-[480px] border-collapse text-left text-[15px] leading-relaxed">
            <thead className="bg-situs-kartu text-situs-judul">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Penyedia</th>
                <th scope="col" className="px-4 py-3 font-semibold">Gunanya</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-situs-garis">
              {PEMROSES.map((p) => (
                <tr key={p.nama}>
                  <td className="px-4 py-3 align-top font-semibold">{p.nama}</td>
                  <td className="px-4 py-3 align-top">{p.guna}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Sebagian penyedia tersebut menyimpan atau memproses data di luar Indonesia; basis data kami
          berada di Singapura. Kami memilih penyedia yang menerapkan standar keamanan yang memadai.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="whatsapp">
        <p>
          Beberapa tombol di situs dan Passport membuka WhatsApp dengan pesan yang sudah terisi, misalnya
          ringkasan skrining (termasuk hasil HIJAU atau MERAH) atau rincian pemesanan. Pesan itu baru
          terkirim bila Anda menekan kirim, dan Anda dapat menyuntingnya lebih dulu. Pesan WhatsApp
          diproses oleh layanan WhatsApp milik Meta. Admin PADMA juga mengirim undangan aktivasi dan
          tagihan lewat WhatsApp.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="keamanan">
        <Butir>
          <li>Koneksi ke situs dan aplikasi terenkripsi (HTTPS).</li>
          <li>
            Akses dibatasi menurut peran: klien hanya dapat membaca datanya sendiri, dan aturan ini
            ditegakkan langsung di basis data.
          </li>
          <li>
            Berkas seperti bukti pembayaran dan sertifikat disimpan di penyimpanan privat, dan tautan
            unduhnya berlaku untuk waktu terbatas.
          </li>
        </Butir>
        <p>
          Tidak ada sistem yang sepenuhnya kebal. Bila terjadi insiden, kami bertindak sesuai bagian
          Kebocoran Data di bawah.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="penyimpanan">
        <p>
          Riwayat layanan, hasil skrining, catatan sesi, dan transaksi kami simpan selama Anda memakai
          layanan PADMA dan sesudahnya selama diperlukan untuk keselamatan layanan lanjutan serta
          kewajiban pembukuan.
        </p>
        <p>
          Anda dapat meminta penghapusan data lewat WhatsApp admin. Setiap permintaan kami tinjau per
          kasus, dan data yang tidak wajib kami simpan akan dihapus. Nama, nomor WhatsApp, dan alamat
          dapat Anda perbarui sendiri di Profil Passport.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="hak-anda">
        <p>Sesuai UU Pelindungan Data Pribadi, Anda berhak untuk:</p>
        <Butir>
          <li>mendapat informasi tentang pemrosesan data Anda;</li>
          <li>mengakses dan memperoleh salinan data pribadi Anda;</li>
          <li>membetulkan data yang tidak akurat;</li>
          <li>meminta penghapusan data, yang ditinjau sebagaimana di bagian Penyimpanan;</li>
          <li>
            menarik persetujuan. Penarikan tidak berlaku surut, dan layanan yang memerlukan data
            tersebut, termasuk sesi kunjungan, tidak dapat dilanjutkan;
          </li>
          <li>mengajukan keberatan atas pemrosesan data Anda.</li>
        </Butir>
        <p>
          Ajukan permintaan Anda lewat WhatsApp admin <TautanWa href={waHref} tampilan={waTampilan} />.
          Kami menanggapi paling lambat 3×24 jam.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="cookie">
        <p>
          Kami hanya memakai cookie yang diperlukan agar layanan berjalan: sesi masuk; penanda klaim
          skrining (2 jam); penanda undangan aktivasi (1 jam); tujuan setelah masuk (1 jam); dan penanda
          persetujuan dari formulir pendaftaran (1 hari). Kami tidak memakai cookie analitik atau
          pelacak. Halaman pembayaran Midtrans dapat memasang cookie-nya sendiri.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="kebocoran">
        <p>
          Bila terjadi kegagalan pelindungan data pribadi yang berdampak pada Anda, kami memberi tahu
          Anda paling lambat 3×24 jam sejak mengetahuinya, beserta data yang terdampak dan langkah yang
          kami ambil.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="perubahan-kontak">
        <p>
          Kami dapat memperbarui kebijakan ini. Versi terbaru dan tanggal berlakunya selalu tersedia di
          halaman ini. Bila ada perubahan, Anda akan diminta menyetujui versi baru sebelum memakai
          Digital Passport lagi.
        </p>
        <p>
          Pertanyaan dan permintaan terkait data pribadi: WhatsApp admin{" "}
          <TautanWa href={waHref} tampilan={waTampilan} />.
        </p>
      </Bagian>
    </>
  );
}
```

- [ ] **Langkah 7: Kedua halaman**

`web/src/app/syarat-ketentuan/page.tsx`:

```tsx
import { bacaPengaturan } from "@/lib/settings";
import { SitusShell } from "../_situs/shell";
import { BAGIAN_SK } from "../_dokumen/bagian";
import { KerangkaDokumen } from "../_dokumen/kerangka";
import { IsiSyaratKetentuan } from "../_dokumen/isi-syarat-ketentuan";

export const metadata = { title: "Syarat & Ketentuan" };
// Nomor WA dan area dibaca dari pengaturan admin, seperti halaman situs lain.
export const revalidate = 300;

/** Rute publik: TIDAK memanggil requireRole. Tidak masuk menu header (spec 2026-10-06). */
// Tautan WA POLOS, bukan `tautanWaSitus`: pesan terisi itu berkode sumber
// WEBSITE dan menanyakan pricelist — salah untuk permintaan data pribadi.
export default async function SyaratKetentuanPage() {
  const pengaturan = await bacaPengaturan();
  return (
    <SitusShell pengaturan={pengaturan}>
      <KerangkaDokumen
        judul="Syarat & Ketentuan"
        pengantar="Ketentuan pemakaian layanan PADMA Wellness: skrining, kunjungan, pembayaran, pembatalan, dan produk digital."
        bagian={BAGIAN_SK}
      >
        <IsiSyaratKetentuan
          waHref={`https://wa.me/${pengaturan.nomorWaLink}`}
          waTampilan={pengaturan.nomorWaTampilan}
          area={pengaturan.alamatTampilan}
        />
      </KerangkaDokumen>
    </SitusShell>
  );
}
```

`web/src/app/kebijakan-privasi/page.tsx`:

```tsx
import { bacaPengaturan } from "@/lib/settings";
import { SitusShell } from "../_situs/shell";
import { BAGIAN_PRIVASI } from "../_dokumen/bagian";
import { KerangkaDokumen } from "../_dokumen/kerangka";
import { IsiKebijakanPrivasi } from "../_dokumen/isi-kebijakan-privasi";

export const metadata = { title: "Kebijakan Privasi" };
export const revalidate = 300;

/** Rute publik: TIDAK memanggil requireRole. Tidak masuk menu header (spec 2026-10-06). */
// Tautan WA POLOS, bukan `tautanWaSitus`: pesan terisi itu berkode sumber
// WEBSITE dan menanyakan pricelist — salah untuk permintaan data pribadi.
export default async function KebijakanPrivasiPage() {
  const pengaturan = await bacaPengaturan();
  return (
    <SitusShell pengaturan={pengaturan}>
      <KerangkaDokumen
        judul="Kebijakan Privasi"
        pengantar="Data apa yang PADMA kumpulkan, untuk apa, siapa yang dapat melihatnya, dan hak Anda atas data tersebut."
        bagian={BAGIAN_PRIVASI}
      >
        <IsiKebijakanPrivasi
          waHref={`https://wa.me/${pengaturan.nomorWaLink}`}
          waTampilan={pengaturan.nomorWaTampilan}
        />
      </KerangkaDokumen>
    </SitusShell>
  );
}
```

- [ ] **Langkah 8: Tautan footer**

Di `web/src/app/_situs/footer.tsx`, di dalam `<p>` baris bawah, sesudah `<span>{jam}</span>`, sisipkan:

```tsx
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          {/* Tautan hukum di baris bawah, bukan di grid TAUTAN_FOOTER — letak
              lazimnya, dan grid navigasi tidak jadi sesak (spec 2026-10-06). */}
          <Link href="/syarat-ketentuan" className="py-1 hover:text-situs-emas-pucat sm:py-0">
            Syarat & Ketentuan
          </Link>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <Link href="/kebijakan-privasi" className="py-1 hover:text-situs-emas-pucat sm:py-0">
            Kebijakan Privasi
          </Link>
```

- [ ] **Langkah 9: Jalankan, pastikan lulus**

Run: `npm run test:murni -- tests/dokumen-hukum.test.tsx tests/panggung-auth.test.tsx`
Expected: PASS.

- [ ] **Langkah 10: Buktikan penjaga "tanpa backup" dan "jangkar ada" bisa merah**

Tambahkan sementara kalimat "Data dicadangkan setiap hari." ke bagian keamanan, lalu jalankan uji: kasus "TIDAK menjanjikan backup" harus FAIL. Kembalikan. Ganti sementara `id="data-kesehatan"` menjadi `id="data-sehat"`: kasus "setiap jangkar … BENAR-BENAR ada" harus FAIL. Kembalikan. Jalankan sekali lagi: PASS.

- [ ] **Langkah 11: Tipe, lint, dan uji situs ber-DB yang menyentuh shell**

Run: `npx tsc --noEmit && npx eslint src/app/_dokumen src/app/syarat-ketentuan src/app/kebijakan-privasi src/app/_situs tests/dokumen-hukum.test.tsx`
Expected: tanpa galat.

Bila Docker hidup: `npx vitest run tests/landing.test.ts tests/admin-pengaturan.test.ts`. Expected: PASS. Kedua berkas itu merender footer dan shell.

- [ ] **Langkah 12: Commit**

```bash
git add src/app/_dokumen src/app/syarat-ketentuan src/app/kebijakan-privasi src/app/_situs tests/dokumen-hukum.test.tsx
git commit -m "feat(situs): halaman Syarat & Ketentuan dan Kebijakan Privasi + tautan footer"
```

---

### Tugas 4: Persetujuan di skrining

**Files:**
- Modify: `web/src/lib/skrining/skema.ts` (objek `Bentuk`)
- Modify: `web/src/app/api/skrining/route.ts` (insert `screenings`)
- Modify: `web/src/app/api/skrining/akun/route.ts` (insert `screenings`)
- Modify: `web/src/app/skrining/wizard.tsx` (state, `bolehMulai`, body, layar pembuka)
- Modify: `web/tests/skrining-usia-kehamilan.test.ts:77` (objek `dasar`)
- Modify: `web/tests/skrining-api.test.ts`, `web/tests/skrining-hardening.test.ts`, `web/tests/skrining-usia-db.test.ts` (helper `req`)
- Modify: `web/tests/e2e/funnel-skrining.e2e.ts` (baris 148, 232, 296)
- Test: `web/tests/skrining-persetujuan.test.ts`

**Interfaces:**
- Consumes: `capPersetujuanSkrining()` (Tugas 1); `JANGKAR_PERSETUJUAN.dataKesehatan` (Tugas 3); kolom `screenings.persetujuan_*` (Tugas 2).
- Produces: `SkemaSkriningPublik` mewajibkan `setuju_privasi: true`. Setiap skrining baru menyimpan `persetujuan_versi = VERSI_DOKUMEN`.

- [ ] **Langkah 1: Tulis uji murni yang gagal**

`web/tests/skrining-persetujuan.test.ts`:

```ts
/**
 * Persetujuan eksplisit atas data kesehatan di skrining (spec 2026-10-06) — MURNI.
 *
 * Tiga lapis, karena TIDAK ada trigger di `screenings` (spec revisi 1):
 *   1. Skema bersama menolak kiriman tanpa `setuju_privasi: true`.
 *   2. SETIAP insert `screenings` di src/ memakai `capPersetujuanSkrining()` —
 *      jalur ketiga di masa depan tertangkap di sini, bukan di produksi.
 *   3. Wizard tidak bisa dimulai tanpa centang, dan centangnya sampai ke body.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkemaSkriningPublik } from "@/lib/skrining/skema";
import { Wizard } from "@/app/skrining/wizard";
import { JANGKAR_PERSETUJUAN } from "@/app/_dokumen/bagian";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

function semuaBerkas(dir: string): string[] {
  return readdirSync(path.join(AKAR, dir)).flatMap((n) => {
    const rel = path.join(dir, n);
    if (statSync(path.join(AKAR, rel)).isDirectory()) return semuaBerkas(rel);
    return /\.(ts|tsx)$/.test(n) ? [rel] : [];
  });
}

const DASAR = { nama: "Sinta", no_hp: "081234567890", fase: "prekonsepsi", jawaban: { fever: false } };

describe("skema — persetujuan wajib", () => {
  it("menolak kiriman tanpa setuju_privasi", () => {
    expect(SkemaSkriningPublik.safeParse(DASAR).success).toBe(false);
  });

  it("menolak setuju_privasi: false", () => {
    expect(SkemaSkriningPublik.safeParse({ ...DASAR, setuju_privasi: false }).success).toBe(false);
  });

  it("menerima setuju_privasi: true", () => {
    expect(SkemaSkriningPublik.safeParse({ ...DASAR, setuju_privasi: true }).success).toBe(true);
  });
});

describe("STRUKTURAL: setiap insert screenings mencap persetujuan", () => {
  // TANPA flag `g` untuk `.test()`: regex global menyimpan `lastIndex` antar
  // pemanggilan, dan berkas berikutnya bisa terlewat diam-diam. Versi global
  // dibuat terpisah, hanya untuk MENGHITUNG.
  const POLA_INSERT = /\.from\(\s*["']screenings["']\s*\)\s*\.insert\(/;
  const POLA_INSERT_SEMUA = new RegExp(POLA_INSERT.source, "g");
  const berkasInsert = semuaBerkas("src").filter((b) => POLA_INSERT.test(baca(b)));

  it("ada tepat dua penulis skrining hari ini (rute publik & rute akun)", () => {
    expect(berkasInsert.sort()).toEqual([
      path.join("src", "app", "api", "skrining", "akun", "route.ts"),
      path.join("src", "app", "api", "skrining", "route.ts"),
    ]);
  });

  it.each(berkasInsert)("%s: jumlah insert = jumlah capPersetujuanSkrining()", (berkas) => {
    const sumber = baca(berkas);
    const insert = [...sumber.matchAll(POLA_INSERT_SEMUA)].length;
    const cap = [...sumber.matchAll(/\.\.\.capPersetujuanSkrining\(\)/g)].length;
    expect(cap, `${berkas}: ${insert} insert, ${cap} cap`).toBe(insert);
  });
});

describe("wizard — centang persetujuan data kesehatan", () => {
  const sumber = baca("src/app/skrining/wizard.tsx");
  const markup = renderToStaticMarkup(createElement(Wizard, { nomorWaLink: "6287778400200" }));

  it("layar pembuka memuat centang TERPISAH dengan tautan ke bagian data kesehatan", () => {
    expect(markup).toContain("memproses data kesehatan yang saya isi di skrining ini");
    expect(markup).toContain(`href="${JANGKAR_PERSETUJUAN.dataKesehatan}"`);
    expect(markup).toMatch(/href="\/kebijakan-privasi#data-kesehatan"[^>]*target="_blank"/);
    // Dua centang: "jujur" yang lama + persetujuan yang baru.
    expect([...markup.matchAll(/type="checkbox"/g)]).toHaveLength(2);
  });

  it("tombol Mulai mensyaratkan centang persetujuan", () => {
    expect(sumber).toMatch(/const bolehMulai = Boolean\([^)]*\bsetujuPrivasi\b[^)]*\)/);
  });

  it("centangnya sampai ke body kiriman", () => {
    expect(sumber).toContain("setuju_privasi: setujuPrivasi");
  });
});
```

Di `web/tests/skrining-usia-kehamilan.test.ts:77`, ganti

```ts
  const dasar = { nama: "Sinta", no_hp: "081234567890", jawaban: { fever: false } };
```

menjadi

```ts
  // `setuju_privasi` wajib sejak spec 2026-10-06; tanpanya setiap kasus di
  // bawah gagal karena alasan yang bukan usia kehamilan.
  const dasar = { nama: "Sinta", no_hp: "081234567890", jawaban: { fever: false }, setuju_privasi: true as const };
```

- [ ] **Langkah 2: Jalankan, pastikan gagal**

Run: `npm run test:murni -- tests/skrining-persetujuan.test.ts tests/skrining-usia-kehamilan.test.ts`
Expected: FAIL. Kasus yang merah: "menolak kiriman tanpa setuju_privasi" (skema masih menerima), kedua kasus struktural "jumlah insert = jumlah cap" (0 cap), dan ketiga kasus wizard.

- [ ] **Langkah 3: Skema**

Di `web/src/lib/skrining/skema.ts`, di dalam `z.object({ … })` milik `Bentuk`, sesudah baris `trimester: z.union(…).nullish(),`, sisipkan:

```ts

  // ===== PERSETUJUAN (spec 2026-10-06) =====
  // Persetujuan EKSPLISIT atas pemrosesan data kesehatan — data pribadi
  // spesifik menurut UU PDP. `literal(true)`, bukan boolean: `false` dan
  // ketiadaan sama-sama ditolak. Versinya TIDAK dikirim peramban; rute mencap
  // VERSI_DOKUMEN lewat capPersetujuanSkrining().
  setuju_privasi: z.literal(true),
```

- [ ] **Langkah 4: Kedua rute mencap persetujuan**

Di `web/src/app/api/skrining/route.ts`:
- tambahkan impor `import { capPersetujuanSkrining } from "@/lib/persetujuan/skrining";`;
- di objek `.insert({ … })`, sesudah `flags: penilaian.flags,`, sisipkan:

```ts
        // Versi dicap SERVER, bukan dari body (spec 2026-10-06). Skema sudah
        // menolak kiriman tanpa `setuju_privasi: true`.
        ...capPersetujuanSkrining(),
```

Di `web/src/app/api/skrining/akun/route.ts`:
- tambahkan impor yang sama;
- di objek `.insert({ … })`, sesudah `client_id: klien.id,`, sisipkan:

```ts
      // Persetujuan eksplisit atas data kesehatan dicap PER SKRINING — juga
      // untuk klien yang sudah setuju di gerbang akun (spec 2026-10-06).
      ...capPersetujuanSkrining(),
```

- [ ] **Langkah 5: Wizard**

Di `web/src/app/skrining/wizard.tsx`:

(a) Tambahkan impor:

```ts
import { JANGKAR_PERSETUJUAN } from "@/app/_dokumen/bagian";
```

(b) Sesudah `const [jujur, setJujur] = useState(false);`, sisipkan:

```ts
  const [setujuPrivasi, setSetujuPrivasi] = useState(false);
```

(c) Ganti

```ts
  const bolehMulai = Boolean(fase && nama.trim() && hp.trim() && jujur);
```

menjadi

```ts
  const bolehMulai = Boolean(fase && nama.trim() && hp.trim() && jujur && setujuPrivasi);
```

(d) Di body `JSON.stringify({ … })` di `selesai`, sesudah `usia_kehamilan_minggu: usia.minggu, trimester: usia.trimester,`, sisipkan:

```ts
          setuju_privasi: setujuPrivasi,
```

(e) Di layar pembuka, tepat sesudah `</label>` yang menutup centang "jujur" (yang berakhir dengan kalimat "…tetap memverifikasi kondisi sebelum layanan."), dan sebelum tombol "Mulai Skrining", sisipkan:

```tsx
        {/* PERSETUJUAN DATA KESEHATAN (spec 2026-10-06). TERPISAH dari centang
            "jujur": persetujuan atas data pribadi spesifik tidak boleh
            digabung dengan pernyataan lain. Ia ada di layar PEMBUKA karena
            wizard mengirim otomatis begitu pertanyaan terakhir (atau jawaban
            "ya" yang mendesak) dijawab — tidak ada tombol kirim di akhir. */}
        <label className="mt-3 flex gap-3 rounded-xl border border-black/10 bg-paper-warm p-3.5 text-[13px]">
          <input type="checkbox" checked={setujuPrivasi} onChange={(e) => setSetujuPrivasi(e.target.checked)}
            className="mt-0.5 h-[18px] w-[18px]" />
          <span>
            Saya menyetujui PADMA memproses data kesehatan yang saya isi di skrining ini untuk menilai
            kelayakan layanan, sesuai{" "}
            <a href={JANGKAR_PERSETUJUAN.dataKesehatan} target="_blank" rel="noopener noreferrer"
              className="font-semibold text-leaf underline">
              Kebijakan Privasi
            </a>
            .
          </span>
        </label>
```

- [ ] **Langkah 6: Jalankan uji murni**

Run: `npm run test:murni -- tests/skrining-persetujuan.test.ts tests/skrining-usia-kehamilan.test.ts tests/skrining-wizard.test.ts tests/skrining-merah-boleh-diulang.test.ts`
Expected: PASS. `skrining-wizard.test.ts` tidak menghitung checkbox, jadi tidak perlu diubah. Kalau ia merah, baca dulu sebabnya sebelum menyunting apa pun.

- [ ] **Langkah 7: Perbarui helper `req` di tiga uji ber-DB**

Di `web/tests/skrining-api.test.ts`, `web/tests/skrining-hardening.test.ts`, dan `web/tests/skrining-usia-db.test.ts`, ganti di dalam fungsi `req`:

```ts
    body: JSON.stringify(body),
```

menjadi

```ts
    // Persetujuan wajib sejak spec 2026-10-06. Disisipkan di sini supaya setiap
    // kasus lama tetap menguji hal yang memang ia uji; kasus yang menguji
    // ketiadaan persetujuan menulis Request-nya sendiri.
    body: JSON.stringify(
      body && typeof body === "object" && !Array.isArray(body) ? { setuju_privasi: true, ...body } : body,
    ),
```

Lalu tambahkan dua kasus di akhir `describe("POST /api/skrining", …)` dalam `web/tests/skrining-api.test.ts`. Tambahkan impor `import { VERSI_DOKUMEN } from "@/lib/persetujuan/versi";` di kepala berkas.

```ts
  it("menolak kiriman TANPA persetujuan data kesehatan (400), tanpa menyimpan apa pun", async () => {
    const res = await POST(new Request("http://localhost/api/skrining", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${++nomorIp}` },
      body: JSON.stringify({ nama: "Uji Tanpa Setuju", no_hp: "0812-0000-0099", fase: "menopause", jawaban: {} }),
    }));
    expect(res.status).toBe(400);
    const { count } = await admin
      .from("screenings")
      .select("id", { count: "exact", head: true })
      .eq("nama", "Uji Tanpa Setuju");
    expect(count).toBe(0);
  });

  it("versi persetujuan DICAP SERVER — versi kiriman peramban diabaikan", async () => {
    const res = await POST(req({
      nama: "Uji Cap Versi", no_hp: "0812-0000-0098", fase: "menopause", jawaban: {},
      persetujuan_versi: "1999-01-01", // peramban mencoba menentukan versinya sendiri
    }));
    expect(res.status).toBe(201);
    const { kode } = await res.json();
    dibuat.push(kode);
    const { data } = await admin
      .from("screenings")
      .select("persetujuan_versi, persetujuan_pada")
      .eq("kode", kode)
      .single();
    expect(data!.persetujuan_versi).toBe(VERSI_DOKUMEN);
    expect(data!.persetujuan_pada).toBeTruthy();
  });
```

- [ ] **Langkah 8: Jalankan uji ber-DB skrining** (butuh Docker)

Run: `npx vitest run tests/skrining-api.test.ts tests/skrining-hardening.test.ts tests/skrining-usia-db.test.ts tests/skrining-gerbang-db.test.ts tests/skrining-klaim.test.ts`
Expected: PASS.

- [ ] **Langkah 9: E2E funnel, selektor centang**

Di `web/tests/e2e/funnel-skrining.e2e.ts`, ketiga baris `await <halaman>.getByRole("checkbox").check();` (baris 148 `landing`, 232 `gagalPage`, 296 `hijauPage`) sekarang ambigu, karena ada dua centang dan Playwright menolak selektor ambigu. Ganti masing-masing dengan dua baris yang memakai variabel halaman yang sama. Contoh untuk `landing`:

```ts
  await landing.getByRole("checkbox", { name: /sesuai kondisi saya/ }).check();
  await landing.getByRole("checkbox", { name: /data kesehatan/ }).check();
```

Lakukan hal yang sama untuk `gagalPage` dan `hijauPage`.

Bila Docker dan dev server hidup: `npm run test:e2e:funnel`. Expected: semua butir lolos.

- [ ] **Langkah 10: Tipe, lint, commit**

Run: `npx tsc --noEmit && npx eslint src/lib/skrining src/app/api/skrining src/app/skrining tests/skrining-persetujuan.test.ts`
Expected: tanpa galat.

```bash
git add src/lib/skrining/skema.ts src/app/api/skrining src/app/skrining/wizard.tsx \
  tests/skrining-persetujuan.test.ts tests/skrining-usia-kehamilan.test.ts tests/skrining-api.test.ts \
  tests/skrining-hardening.test.ts tests/skrining-usia-db.test.ts tests/e2e/funnel-skrining.e2e.ts
git commit -m "feat(skrining): persetujuan eksplisit data kesehatan, dicap server di kedua rute"
```

---

### Tugas 5: Centang di `/daftar` dan pencatatan di `/setelah-masuk`

**Files:**
- Modify: `web/src/app/daftar/form-daftar.tsx`
- Modify: `web/src/app/setelah-masuk/route.ts`
- Modify: `web/tests/e2e/daftar-mandiri.e2e.ts` (`isiFormulirDaftar`, `hapusJejak`, skenario 1)
- Test: `web/tests/daftar-persetujuan.test.tsx`
- Test: `web/tests/setelah-masuk-persetujuan.test.ts`

**Interfaces:**
- Consumes: `titipPersetujuanDiPeramban()`, `COOKIE_SETUJU` (Tugas 1); `catatPersetujuanDariCookie()` (Tugas 1).
- Produces: akun yang mendaftar lewat `/daftar` lalu mengonfirmasi email di peramban yang sama punya baris `persetujuan_akun` berjalur `daftar`.

- [ ] **Langkah 1: Tulis uji yang gagal**

`web/tests/daftar-persetujuan.test.tsx`:

```tsx
/**
 * Centang persetujuan di /daftar (spec 2026-10-06) — MURNI.
 *
 * Kedua tombol (email & Google) mati sampai dicentang, dan cookie penitip
 * dipasang SEBELUM masing-masing panggilan auth — sesudahnya, halaman sudah
 * pergi dan cookie tidak pernah tertulis.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FormDaftar } from "@/app/daftar/form-daftar";

const sumber = readFileSync(path.resolve(__dirname, "../src/app/daftar/form-daftar.tsx"), "utf8");
const markup = renderToStaticMarkup(<FormDaftar />);

describe("/daftar — centang persetujuan", () => {
  it("menautkan kedua dokumen di tab baru", () => {
    expect(markup).toMatch(/href="\/syarat-ketentuan"[^>]*target="_blank"/);
    expect(markup).toMatch(/href="\/kebijakan-privasi"[^>]*target="_blank"/);
    expect(markup).toContain('type="checkbox"');
  });

  it("tombol Daftar (email) mati sampai dicentang", () => {
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("tombol Daftar dengan Google juga mati sampai dicentang", () => {
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Daftar dengan Google/);
  });

  it("cookie dititipkan SEBELUM signUp dan SEBELUM signInWithOAuth", () => {
    const titip = [...sumber.matchAll(/titipPersetujuanDiPeramban\(\)/g)].map((m) => m.index!);
    expect(titip).toHaveLength(2);
    expect(titip[0]).toBeLessThan(sumber.indexOf("supabase.auth.signUp("));
    expect(titip[1]).toBeLessThan(sumber.indexOf("supabase.auth.signInWithOAuth("));
    expect(titip[1]).toBeGreaterThan(sumber.indexOf("supabase.auth.signUp("));
  });
});
```

`web/tests/setelah-masuk-persetujuan.test.ts`:

```ts
/**
 * /setelah-masuk mencatat persetujuan dari cookie /daftar (spec 2026-10-06) — MURNI.
 *
 * Semua dependensi rute di-mock. Yang dijaga:
 *   - cookie ada + peran klien → dicatat, lalu cookie DIHAPUS;
 *   - tanpa cookie → tidak mencatat apa pun (gerbang yang menangkap nanti);
 *   - gagal mencatat TIDAK PERNAH menggagalkan login;
 *   - staf pulang lebih dulu, tanpa mencatat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ref = vi.hoisted(() => ({
  peran: "klien",
  cookie: new Map<string, string>(),
  catat: vi.fn(async (..._a: unknown[]) => true),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (ref.cookie.has(n) ? { name: n, value: ref.cookie.get(n)! } : undefined),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-uji" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: ref.peran } }),
          maybeSingle: async () => ({ data: { id: "klien-uji" } }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/link-client", () => ({ COOKIE_UNDANGAN: "padma_undangan" }));
vi.mock("@/lib/auth/pastikan-klien", () => ({ pastikanKlien: async () => "/passport" }));
vi.mock("@/lib/skrining/klaim", () => ({
  COOKIE_KLAIM: "padma_klaim_skrining",
  klaimSkrining: async () => ({ ok: false }),
}));
vi.mock("@/lib/persetujuan/catat", () => ({
  catatPersetujuanDariCookie: (...a: unknown[]) => ref.catat(...a),
}));

const { GET } = await import("@/app/setelah-masuk/route");
const { COOKIE_SETUJU } = await import("@/lib/persetujuan/cookie");
const { VERSI_DOKUMEN } = await import("@/lib/persetujuan/versi");

const panggil = () => GET(new Request("http://localhost/setelah-masuk"));

beforeEach(() => {
  ref.peran = "klien";
  ref.cookie.clear();
  ref.catat.mockReset();
  ref.catat.mockResolvedValue(true);
});

describe("/setelah-masuk — persetujuan dari /daftar", () => {
  it("cookie ada: dicatat untuk user sesi, lalu cookie dihapus", async () => {
    ref.cookie.set(COOKIE_SETUJU, VERSI_DOKUMEN);
    const res = await panggil();
    expect(ref.catat).toHaveBeenCalledTimes(1);
    expect(ref.catat.mock.calls[0][1]).toBe("user-uji");
    expect(ref.catat.mock.calls[0][2]).toBe(VERSI_DOKUMEN);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/passport");
    expect(res.headers.get("set-cookie") ?? "").toContain(`${COOKIE_SETUJU}=;`);
  });

  it("tanpa cookie (mis. email dikonfirmasi di perangkat lain): tidak mencatat, login tetap jalan", async () => {
    const res = await panggil();
    expect(ref.catat).not.toHaveBeenCalled();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/passport");
    expect(res.headers.get("set-cookie") ?? "").not.toContain(COOKIE_SETUJU);
  });

  it("gagal mencatat TIDAK menggagalkan login", async () => {
    ref.cookie.set(COOKIE_SETUJU, VERSI_DOKUMEN);
    ref.catat.mockResolvedValue(false);
    const res = await panggil();
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/passport");
  });

  it("admin pulang ke /admin tanpa mencatat apa pun", async () => {
    ref.peran = "admin";
    ref.cookie.set(COOKIE_SETUJU, VERSI_DOKUMEN);
    const res = await panggil();
    expect(ref.catat).not.toHaveBeenCalled();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });
});
```

- [ ] **Langkah 2: Jalankan, pastikan gagal**

Run: `npm run test:murni -- tests/daftar-persetujuan.test.tsx tests/setelah-masuk-persetujuan.test.ts`
Expected: FAIL. Markup belum punya checkbox, `titip` berjumlah 0, dan kasus pertama `setelah-masuk` mendapati `catat` tidak dipanggil.

- [ ] **Langkah 3: Form daftar**

Di `web/src/app/daftar/form-daftar.tsx`:

(a) Impor, di bawah impor `periksaPendaftaran`:

```ts
import { titipPersetujuanDiPeramban } from "@/lib/persetujuan/cookie";
```

(b) State, sesudah `const [sibuk, setSibuk] = useState(false);`:

```ts
  const [setuju, setSetuju] = useState(false);
```

(c) Di `daftarEmail`, tepat sesudah `setPesan(null);`:

```ts
    if (!setuju) {
      setPesan("Centang persetujuan Syarat & Ketentuan dan Kebijakan Privasi lebih dulu.");
      return;
    }
```

(d) Tepat sebelum `const { error } = await supabase.auth.signUp({`:

```ts
    // Dititipkan SEBELUM signUp: `/setelah-masuk` mencatatnya saat tautan
    // konfirmasi dibuka di peramban ini (spec 2026-10-06). Dibuka di perangkat
    // lain → cookie tidak ikut → gerbang /persetujuan yang menangkap.
    titipPersetujuanDiPeramban();
```

(e) Ganti badan `daftarGoogle` menjadi:

```ts
  async function daftarGoogle() {
    if (!setuju) return;
    titipPersetujuanDiPeramban();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
```

(f) Di JSX, tepat sebelum `{pesan && <p className="text-sm text-clay">{pesan}</p>}`, sisipkan:

```tsx
      <label className="flex gap-3 text-sm text-ink-soft">
        <input
          type="checkbox" checked={setuju}
          onChange={(e) => setSetuju(e.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] shrink-0"
        />
        <span>
          Saya menyetujui{" "}
          <a href="/syarat-ketentuan" target="_blank" rel="noopener noreferrer" className="font-semibold text-leaf underline">
            Syarat & Ketentuan
          </a>{" "}
          dan{" "}
          <a href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer" className="font-semibold text-leaf underline">
            Kebijakan Privasi
          </a>
          .
        </span>
      </label>
```

(g) Tombol submit: ganti `type="submit" disabled={sibuk}` menjadi `type="submit" disabled={sibuk || !setuju}`.
Tombol Google: ganti `type="button" onClick={daftarGoogle}` menjadi `type="button" onClick={daftarGoogle} disabled={!setuju}`, lalu tambahkan `disabled:opacity-50` di akhir `className`-nya.

- [ ] **Langkah 4: `/setelah-masuk`**

Di `web/src/app/setelah-masuk/route.ts`:

(a) Impor:

```ts
import { COOKIE_SETUJU } from "@/lib/persetujuan/cookie";
import { catatPersetujuanDariCookie } from "@/lib/persetujuan/catat";
```

(b) Ganti blok ini:

```ts
  if (role === "admin") return NextResponse.redirect(new URL("/admin", url.origin));

  // Klien. Seluruh keputusan penautan — termasuk urutannya, yang justru
```

menjadi:

```ts
  if (role === "admin") return NextResponse.redirect(new URL("/admin", url.origin));

  const jar = await cookies();

  // PERSETUJUAN DARI FORM /daftar (spec 2026-10-06 S&K).
  //
  // Dicatat SEBELUM penautan, dengan sesi klien sendiri: persetujuan milik
  // AKUN, bukan baris klien. `catatPersetujuanDariCookie` tidak pernah melempar
  // dan menolak cookie berversi lama — gagal mencatat TIDAK menggagalkan login;
  // gerbang di layout /passport menangkap klien yang tidak tercatat di sini.
  const nilaiSetuju = jar.get(COOKIE_SETUJU)?.value;
  if (nilaiSetuju) await catatPersetujuanDariCookie(supabase, user.id, nilaiSetuju);

  // Klien. Seluruh keputusan penautan — termasuk urutannya, yang justru
```

(c) Hapus deklarasi lama `const jar = await cookies();` yang tepat di atas `const token = jar.get(COOKIE_UNDANGAN)?.value ?? "";`, karena `jar` kini sudah dideklarasikan di atas.

(d) Di bagian akhir, sesudah `if (jar.get(COOKIE_LANJUT)) response.cookies.delete(COOKIE_LANJUT);`, sisipkan:

```ts
  // Sekali pakai, apa pun hasilnya — seperti token undangan di atas.
  if (nilaiSetuju) response.cookies.delete(COOKIE_SETUJU);
```

- [ ] **Langkah 5: Jalankan, pastikan lulus**

Run: `npm run test:murni -- tests/daftar-persetujuan.test.tsx tests/setelah-masuk-persetujuan.test.ts tests/panggung-auth.test.tsx tests/daftar-validator.test.ts`
Expected: PASS.

- [ ] **Langkah 6: Buktikan uji urutan bisa merah**

Pindahkan sementara `titipPersetujuanDiPeramban();` di `daftarEmail` ke sesudah blok `if (error) { … }`. Kasus "cookie dititipkan SEBELUM signUp" harus FAIL. Kembalikan, lalu jalankan lagi: PASS.

- [ ] **Langkah 7: E2E daftar mandiri**

Di `web/tests/e2e/daftar-mandiri.e2e.ts`:

(a) Impor di kepala berkas:

```ts
import { VERSI_DOKUMEN } from "../../src/lib/persetujuan/versi";
```

(b) Di `isiFormulirDaftar`, tepat sesudah `await page.getByLabel("Kata sandi").fill(SANDI);`:

```ts
  await page.getByRole("checkbox", { name: /Saya menyetujui/ }).check();
```

(c) Di `hapusJejak`, di dalam `for (const u of data.users)`, ganti

```ts
      if (u.email?.toLowerCase() === email) await admin.auth.admin.deleteUser(u.id);
```

menjadi

```ts
      if (u.email?.toLowerCase() === email) {
        // Tanpa FK (sengaja, spec 2026-10-06) — dibersihkan manual.
        await admin.from("persetujuan_akun").delete().eq("user_id", u.id);
        await admin.auth.admin.deleteUser(u.id);
      }
```

(d) Di `ujiOrangBaru`, tepat sesudah `catat("1f. …")` (sesudah tautan konfirmasi dibuka di `daftar.context`, yaitu peramban yang memegang cookie), sisipkan:

```ts
  const { data: akun } = await svc().auth.admin.listUsers({ perPage: 1000 });
  const uidBaru = akun.users.find((u) => u.email?.toLowerCase() === EMAIL_BARU)?.id ?? "";
  const { data: setuju } = await svc()
    .from("persetujuan_akun")
    .select("versi, jalur")
    .eq("user_id", uidBaru);
  catat(
    "1f'. centang di /daftar tercatat saat konfirmasi (jalur daftar, versi berlaku)",
    setuju?.length === 1 && setuju[0].jalur === "daftar" && setuju[0].versi === VERSI_DOKUMEN,
    JSON.stringify(setuju),
  );
```

Butir 1g dan 2b ("masuk → /passport") tetap tanpa perubahan. Keduanya kini juga membuktikan bahwa klien yang tercatat lewat jalur daftar tidak dibelokkan ke gerbang.

Bila Docker, dev server, dan kotak surat lokal hidup: `npm run test:e2e:daftar`. Expected: semua butir lolos.

- [ ] **Langkah 8: Tipe, lint, commit**

Run: `npx tsc --noEmit && npx eslint src/app/daftar src/app/setelah-masuk tests/daftar-persetujuan.test.tsx tests/setelah-masuk-persetujuan.test.ts`
Expected: tanpa galat.

```bash
git add src/app/daftar/form-daftar.tsx src/app/setelah-masuk/route.ts tests/daftar-persetujuan.test.tsx \
  tests/setelah-masuk-persetujuan.test.ts tests/e2e/daftar-mandiri.e2e.ts
git commit -m "feat(daftar): centang persetujuan wajib, dicatat /setelah-masuk lewat cookie"
```

---

### Tugas 6: Gerbang `/persetujuan` dan layout `/passport`

**Files:**
- Create: `web/src/app/persetujuan/page.tsx`
- Create: `web/src/app/persetujuan/aksi.ts`
- Modify: `web/src/app/passport/layout.tsx`
- Modify: `web/src/proxy.ts:7` (`PROTECTED_PREFIXES`)
- Modify: `web/tests/e2e/passport.e2e.ts` (skenario 0 baru)
- Modify: `web/tests/e2e/access-matrix.e2e.ts` (`buatUser`), `web/tests/e2e/admin-operasional.e2e.ts:299`, `web/tests/e2e/admin-pelengkap.e2e.ts:290`, `web/tests/e2e/materi-pdf.e2e.ts` (`pastikanRinaBisaLogin`), `web/tests/e2e/materi-video.e2e.ts` (fungsi yang membuat akun Rina)
- Test: `web/tests/persetujuan-gerbang.test.tsx`

**Interfaces:**
- Consumes:
  - `statusPersetujuan(userId)`, `catatPersetujuan(...)`, `tujuanPersetujuanAman(...)` dari Tugas 1;
  - `JANGKAR_PERSETUJUAN` dari Tugas 3;
  - `requireRole(["klien"]): Promise<{ userId: string; role: AppRole; nama: string }>`;
  - `setujuiDokumenUntukUji` dari Tugas 2.
- Produces:
  - rute `/persetujuan?lanjut=<path>` (Tugas 7 mengarahkan ke sini);
  - server action `setujuiDokumen(formData: FormData): Promise<void>`.

- [ ] **Langkah 1: Tulis uji yang gagal**

`web/tests/persetujuan-gerbang.test.tsx`:

```tsx
/**
 * Gerbang persetujuan (spec 2026-10-06) — MURNI.
 *
 * Layout /passport dan proxy diperiksa lewat sumbernya (pola
 * access-matrix-layouts & passport-shell). Halaman /persetujuan dan server
 * action-nya dirender/dipanggil dengan semua dependensi di-mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const ref = vi.hoisted(() => ({
  status: { sudahSetuju: false, pernahSetuju: false },
  catat: vi.fn(async (..._a: unknown[]) => true),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ userId: "user-uji", role: "klien", nama: "Uji" }),
}));
vi.mock("@/lib/persetujuan/status", () => ({ statusPersetujuan: async () => ref.status }));
vi.mock("@/lib/persetujuan/catat", () => ({ catatPersetujuan: (...a: unknown[]) => ref.catat(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));

const { default: HalamanPersetujuan } = await import("@/app/persetujuan/page");
const { setujuiDokumen } = await import("@/app/persetujuan/aksi");
const { JANGKAR_PERSETUJUAN } = await import("@/app/_dokumen/bagian");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

async function render(sp: Record<string, string>) {
  return renderToStaticMarkup(await HalamanPersetujuan({ searchParams: Promise.resolve(sp) }));
}

function form(isian: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  ref.status = { sudahSetuju: false, pernahSetuju: false };
  ref.catat.mockReset();
  ref.catat.mockResolvedValue(true);
});

describe("layout /passport — gerbang", () => {
  const sumber = baca("src/app/passport/layout.tsx");

  it("membelokkan klien yang belum setuju ke /persetujuan", () => {
    expect(sumber).toContain("statusPersetujuan(userId)");
    expect(sumber).toContain('redirect("/persetujuan")');
  });

  it("gerbang SESUDAH resolusi klien — akun belum tertaut tetap ke /akun-belum-terhubung", () => {
    expect(sumber.indexOf("await ambilKlien()")).toBeLessThan(sumber.indexOf("statusPersetujuan("));
  });

  it("requireRole tetap satu kali dan memasok userId", () => {
    expect([...sumber.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumber).toMatch(/const\s*\{\s*userId\s*\}\s*=\s*await\s+requireRole\(/);
  });
});

describe("proxy", () => {
  it("/persetujuan butuh sesi", () => {
    expect(baca("src/proxy.ts")).toMatch(/PROTECTED_PREFIXES\s*=\s*\[[^\]]*"\/persetujuan"/);
  });
});

describe("halaman /persetujuan", () => {
  it("klien baru: kalimat 'Sebelum memakai', form dengan lanjut tersaring, centang wajib", async () => {
    const m = await render({ lanjut: "/produk/abc" });
    expect(m).toContain("Sebelum memakai Digital Passport");
    expect(m).toMatch(/<input[^>]*type="hidden"[^>]*name="lanjut"[^>]*value="\/produk\/abc"/);
    expect(m).toMatch(/<input[^>]*type="checkbox"[^>]*name="setuju"[^>]*value="ya"[^>]*required=""/);
    expect(m).toContain("Setuju &amp; lanjutkan");
  });

  it("versi lama pernah disetujui: kalimat 'Kami memperbarui'", async () => {
    ref.status = { sudahSetuju: false, pernahSetuju: true };
    expect(await render({})).toContain("Kami memperbarui");
  });

  it("menautkan kedua dokumen dan ketiga jangkar ringkasan, di tab baru", async () => {
    const m = await render({});
    for (const href of ["/syarat-ketentuan", "/kebijakan-privasi", ...Object.values(JANGKAR_PERSETUJUAN)]) {
      expect(m, `tautan ${href}`).toMatch(new RegExp(`href="${href.replace(/[#/]/g, "\\$&")}"[^>]*target="_blank"`));
    }
  });

  it("selalu ada jalan keluar", async () => {
    expect(await render({})).toMatch(/<form[^>]*action="\/auth\/keluar"[^>]*method="post"/);
  });

  it("lanjut yang berbahaya disaring ke /passport", async () => {
    expect(await render({ lanjut: "//evil.com" })).toMatch(/name="lanjut"[^>]*value="\/passport"/);
  });

  it("sudah setuju: diteruskan ke tujuan tanpa form", async () => {
    ref.status = { sudahSetuju: true, pernahSetuju: true };
    await expect(render({ lanjut: "/produk/abc" })).rejects.toThrow("REDIRECT /produk/abc");
  });

  it("gagal=1 menampilkan pesan galat", async () => {
    expect(await render({ gagal: "1" })).toContain("Persetujuan belum tersimpan");
  });
});

describe("server action setujuiDokumen", () => {
  it("tanpa centang: kembali ke gerbang, TIDAK mencatat", async () => {
    await expect(setujuiDokumen(form({ lanjut: "/produk/abc" }))).rejects.toThrow(
      "REDIRECT /persetujuan?lanjut=%2Fproduk%2Fabc",
    );
    expect(ref.catat).not.toHaveBeenCalled();
  });

  it("dicentang: mencatat jalur gerbang untuk user sesi, lalu ke tujuan", async () => {
    await expect(setujuiDokumen(form({ lanjut: "/produk/abc", setuju: "ya" }))).rejects.toThrow(
      "REDIRECT /produk/abc",
    );
    expect(ref.catat).toHaveBeenCalledTimes(1);
    expect(ref.catat.mock.calls[0][1]).toBe("user-uji");
    expect(ref.catat.mock.calls[0][2]).toBe("gerbang");
  });

  it("gagal mencatat: kembali ke gerbang dengan gagal=1", async () => {
    ref.catat.mockResolvedValue(false);
    await expect(setujuiDokumen(form({ lanjut: "/produk/abc", setuju: "ya" }))).rejects.toThrow(
      "REDIRECT /persetujuan?lanjut=%2Fproduk%2Fabc&gagal=1",
    );
  });

  it("lanjut berbahaya dari form palsu tetap disaring", async () => {
    await expect(setujuiDokumen(form({ lanjut: "https://evil.com", setuju: "ya" }))).rejects.toThrow(
      "REDIRECT /passport",
    );
  });
});
```

- [ ] **Langkah 2: Jalankan, pastikan gagal**

Run: `npm run test:murni -- tests/persetujuan-gerbang.test.tsx`
Expected: FAIL. Pesannya `Failed to resolve import "@/app/persetujuan/page"`.

- [ ] **Langkah 3: Server action**

`web/src/app/persetujuan/aksi.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { catatPersetujuan } from "@/lib/persetujuan/catat";
import { tujuanPersetujuanAman } from "@/lib/persetujuan/tujuan";

/**
 * Persetujuan dari layar gerbang (spec 2026-10-06).
 *
 * `lanjut` disaring ULANG di sini, bukan dipercaya dari input tersembunyi —
 * form bisa dikirim siapa saja dengan isian apa saja. Versi dicap
 * `catatPersetujuan` dari konstanta; form tidak membawa nomor versi.
 */
export async function setujuiDokumen(formData: FormData): Promise<void> {
  const { userId } = await requireRole(["klien"]);
  const tujuan = tujuanPersetujuanAman(formData.get("lanjut"));
  const kembali = `/persetujuan?lanjut=${encodeURIComponent(tujuan)}`;

  if (formData.get("setuju") !== "ya") redirect(kembali);

  const supabase = await createServerSupabase();
  if (!(await catatPersetujuan(supabase, userId, "gerbang"))) redirect(`${kembali}&gagal=1`);

  redirect(tujuan);
}
```

- [ ] **Langkah 4: Halaman**

`web/src/app/persetujuan/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { PanggungAuth } from "@/app/_auth/panggung";
import { JANGKAR_PERSETUJUAN } from "@/app/_dokumen/bagian";
import { requireRole } from "@/lib/auth/require-role";
import { statusPersetujuan } from "@/lib/persetujuan/status";
import { tujuanPersetujuanAman } from "@/lib/persetujuan/tujuan";
import { setujuiDokumen } from "./aksi";

export const metadata = { title: "Persetujuan" };

const TAUTAN = "font-semibold text-leaf underline";

/**
 * GERBANG PERSETUJUAN S&K + KEBIJAKAN PRIVASI (spec 2026-10-06).
 *
 * Menangkap setiap akun klien yang belum punya catatan untuk VERSI_DOKUMEN:
 * pendaftar Google dari /masuk, klien undangan admin, klien lama sebelum
 * dokumen ini ada, revisi versi, dan email yang dikonfirmasi di perangkat lain.
 *
 * Di LUAR /passport supaya layout passport tidak berputar ke dirinya sendiri.
 * Selalu ada jalan keluar (form /auth/keluar): klien yang tidak setuju tidak
 * boleh terkunci di layar ini. `TombolKeluar` tidak dipakai — ia `sm:hidden`
 * karena dirancang untuk Profil Passport, dan di sini ia harus tampil di
 * semua lebar layar.
 */
export default async function PersetujuanPage({
  searchParams,
}: {
  searchParams: Promise<{ lanjut?: string | string[]; gagal?: string }>;
}) {
  const { userId } = await requireRole(["klien"]);
  const sp = await searchParams;
  const tujuan = tujuanPersetujuanAman(sp.lanjut);
  const { sudahSetuju, pernahSetuju } = await statusPersetujuan(userId);
  // Tombol kembali, markah, atau tab lama: yang sudah setuju tidak ditanya lagi.
  if (sudahSetuju) redirect(tujuan);

  return (
    <PanggungAuth
      judul="Satu langkah sebelum lanjut."
      kalimat={
        pernahSetuju
          ? "Kami memperbarui Syarat & Ketentuan dan Kebijakan Privasi PADMA. Mohon baca dan setujui versi terbarunya sebelum melanjutkan."
          : "Sebelum memakai Digital Passport, mohon baca dan setujui Syarat & Ketentuan serta Kebijakan Privasi PADMA."
      }
    >
      {/* h2, bukan h1 — lihat komentar hierarki judul di panggung.tsx. */}
      <h2 className="font-serif text-2xl text-night mb-1">Persetujuan Anda</h2>
      <p className="mb-3 text-sm text-ink-soft">Ringkasnya, dengan menyetujui Anda memahami bahwa:</p>
      <ul className="mb-6 list-disc space-y-2 pl-5 text-sm text-ink-soft">
        <li>
          PADMA memproses{" "}
          <a href={JANGKAR_PERSETUJUAN.dataKesehatan} target="_blank" rel="noopener noreferrer" className={TAUTAN}>
            data kesehatan
          </a>{" "}
          dari skrining Anda untuk menilai keselamatan layanan.
        </li>
        <li>
          Data Anda disimpan dan diproses oleh{" "}
          <a href={JANGKAR_PERSETUJUAN.pihakKetiga} target="_blank" rel="noopener noreferrer" className={TAUTAN}>
            penyedia layanan pihak ketiga
          </a>
          , sebagian di luar Indonesia.
        </li>
        <li>
          Anda dapat mengakses, membetulkan, meminta penghapusan, dan menarik persetujuan. Lihat{" "}
          <a href={JANGKAR_PERSETUJUAN.hakAnda} target="_blank" rel="noopener noreferrer" className={TAUTAN}>
            hak Anda
          </a>
          .
        </li>
      </ul>

      {sp.gagal === "1" && (
        <p role="alert" className="mb-4 text-sm text-clay">
          Persetujuan belum tersimpan. Coba lagi sebentar lagi.
        </p>
      )}

      <form action={setujuiDokumen} className="space-y-4">
        <input type="hidden" name="lanjut" value={tujuan} />
        <label className="flex gap-3 rounded-xl border border-black/10 bg-paper-warm p-3.5 text-sm">
          <input type="checkbox" name="setuju" value="ya" required className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          <span>
            Saya telah membaca dan menyetujui{" "}
            <a href="/syarat-ketentuan" target="_blank" rel="noopener noreferrer" className={TAUTAN}>
              Syarat & Ketentuan
            </a>{" "}
            dan{" "}
            <a href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer" className={TAUTAN}>
              Kebijakan Privasi
            </a>{" "}
            PADMA, termasuk pemrosesan data kesehatan saya.
          </span>
        </label>
        <button type="submit" className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale">
          Setuju & lanjutkan
        </button>
      </form>

      {/* Jalan keluar: <form method="post">, sama seperti TombolKeluar —
          navigasi dokumen penuh menghapus Client Cache. */}
      <form action="/auth/keluar" method="post" className="mt-3">
        <button type="submit" className="w-full rounded-lg border border-black/15 bg-white py-3 text-sm font-bold text-leaf">
          Keluar
        </button>
      </form>
    </PanggungAuth>
  );
}
```

- [ ] **Langkah 5: Layout passport dan proxy**

Di `web/src/app/passport/layout.tsx`:

(a) Impor:

```ts
import { statusPersetujuan } from "@/lib/persetujuan/status";
```

(b) Ganti

```ts
  await requireRole(["klien"]);
```

menjadi

```ts
  const { userId } = await requireRole(["klien"]);
```

(c) Tepat sesudah `if (!klien) redirect("/akun-belum-terhubung");`, sisipkan:

```ts

  // GERBANG PERSETUJUAN (spec 2026-10-06). Sesudah resolusi klien: akun yang
  // belum tertaut tetap ke /akun-belum-terhubung lebih dulu. Ini PENCATAT
  // persetujuan, bukan batas keamanan — rute API di bawah /passport sengaja
  // tidak memeriksanya; satu-satunya pengecualian adalah checkout, karena ia
  // bisa dicapai tanpa pernah membuka /passport. Pembacaannya gagal-terbuka
  // (lihat lib/persetujuan/status.ts).
  if (!(await statusPersetujuan(userId)).sudahSetuju) redirect("/persetujuan");
```

Di `web/src/proxy.ts:7`, ganti

```ts
const PROTECTED_PREFIXES = ["/admin", "/owner", "/passport"];
```

menjadi

```ts
const PROTECTED_PREFIXES = ["/admin", "/owner", "/passport", "/persetujuan"];
```

- [ ] **Langkah 6: Jalankan, pastikan lulus**

Run: `npm run test:murni -- tests/persetujuan-gerbang.test.tsx tests/access-matrix-layouts.test.ts tests/passport-shell.test.ts tests/panggung-auth.test.tsx`
Expected: PASS.

- [ ] **Langkah 7: Buktikan uji urutan gerbang bisa merah**

Pindahkan sementara baris gerbang ke ATAS `const klien = await ambilKlien();`. Kasus "gerbang SESUDAH resolusi klien" harus FAIL. Kembalikan, lalu jalankan lagi: PASS.

- [ ] **Langkah 8: Fixture e2e untuk akun klien yang dibuat skrip**

Setiap skrip e2e yang membuat akun klien lalu membuka `/passport` kini akan dibelokkan ke gerbang. Tambahkan impor `import { setujuiDokumenUntukUji } from "../helpers/persetujuan";` ke kelima berkas berikut, lalu pasang pemanggilannya:

- `tests/e2e/access-matrix.e2e.ts`, fungsi `buatUser`. Ganti badannya menjadi:

```ts
async function buatUser(email: string) {
  const { data, error } = await svc().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  // Matriks akses menguji PERAN, bukan gerbang persetujuan (spec 2026-10-06).
  await setujuiDokumenUntukUji(svc(), data.user!.id);
}
```

- `tests/e2e/admin-operasional.e2e.ts`, tepat sesudah `if (userErr) throw userErr;` (sekitar baris 305):

```ts
    await setujuiDokumenUntukUji(admin, userBaru.user!.id);
```

- `tests/e2e/admin-pelengkap.e2e.ts`, tepat sesudah `const UID_KLIEN = userBaru.user!.id;`:

```ts
    await setujuiDokumenUntukUji(admin, UID_KLIEN);
```

- `tests/e2e/materi-pdf.e2e.ts`, `pastikanRinaBisaLogin`. Tepat sesudah `if (error) throw error;` yang terakhir (sesudah update `clients`):

```ts
  await setujuiDokumenUntukUji(admin, user!.id);
```

- `tests/e2e/materi-video.e2e.ts`, fungsi yang sama bentuknya. Tepat sesudah `if (error) throw error;` yang terakhir:

```ts
  await setujuiDokumenUntukUji(svc, user!.id);
```

- [ ] **Langkah 9: Skenario gerbang di e2e passport**

Di `web/tests/e2e/passport.e2e.ts`:

(a) Impor:

```ts
import { VERSI_DOKUMEN } from "../../src/lib/persetujuan/versi";
```

(b) Di `main()`, ganti

```ts
    const ctx = await login(browser, "ananda@padma.test");
    const page = await ctx.newPage();
```

menjadi

```ts
    // ---- 0. Gerbang persetujuan S&K (spec 2026-10-06) ----
    // Baris persetujuan Ananda DIHAPUS dulu supaya gerbangnya benar-benar
    // menyala. `seedUsers` menyemainya lagi pada seed berikutnya, jadi run
    // yang mati di tengah tidak meninggalkan Ananda tanpa persetujuan lama-lama.
    const { data: barisAnanda } = await admin
      .from("clients")
      .select("user_id")
      .eq("padma_id", PADMA_ID)
      .single();
    const uidAnanda = barisAnanda!.user_id as string;
    await admin.from("persetujuan_akun").delete().eq("user_id", uidAnanda).eq("versi", VERSI_DOKUMEN);

    const ctx = await login(browser, "ananda@padma.test");
    const gerbang = await ctx.newPage();
    await gerbang.goto(`${BASE}/passport`, { waitUntil: "networkidle" });
    catat(
      "0a. klien tanpa persetujuan versi berlaku dibelokkan ke /persetujuan",
      new URL(gerbang.url()).pathname === "/persetujuan",
      `URL ${gerbang.url()}`,
    );
    await gerbang.getByRole("checkbox").check();
    await Promise.all([
      gerbang.waitForURL((u) => u.pathname === "/passport", { timeout: 20_000 }),
      gerbang.getByRole("button", { name: "Setuju & lanjutkan" }).click(),
    ]);
    const { data: catatan } = await admin
      .from("persetujuan_akun")
      .select("jalur")
      .eq("user_id", uidAnanda)
      .eq("versi", VERSI_DOKUMEN);
    catat(
      "0b. setuju di gerbang tercatat (jalur gerbang) lalu kembali ke /passport",
      new URL(gerbang.url()).pathname === "/passport" && catatan?.[0]?.jalur === "gerbang",
      `URL ${gerbang.url()} | baris ${JSON.stringify(catatan)}`,
    );
    await gerbang.close();

    const page = await ctx.newPage();
```

Bila Docker dan dev server hidup: `npm run test:e2e:passport && npm run test:e2e && npm run test:e2e:admin && npm run test:e2e:pelengkap && npm run test:e2e:materi && npm run test:e2e:video`. Expected: semua butir lolos.

- [ ] **Langkah 10: Tipe, lint, commit**

Run: `npx tsc --noEmit && npx eslint src/app/persetujuan src/app/passport/layout.tsx src/proxy.ts tests/persetujuan-gerbang.test.tsx tests/e2e`
Expected: tanpa galat.

```bash
git add src/app/persetujuan src/app/passport/layout.tsx src/proxy.ts tests/persetujuan-gerbang.test.tsx tests/e2e
git commit -m "feat(persetujuan): gerbang /persetujuan di layout passport, jalan keluar selalu ada"
```

---

### Tugas 7: Checkout menolak tanpa persetujuan

**Files:**
- Modify: `web/src/app/api/pesanan/checkout/route.ts` (sesudah cek login)
- Modify: `web/src/app/produk/[slug]/tombol-beli.tsx` (`HasilCheckout`, `mintaCheckout`, `klik`)
- Modify: `web/src/app/passport/keranjang/isi-keranjang.tsx` (penanganan hasil checkout)
- Modify: `web/tests/produk-tombol-beli.test.tsx` (kasus baru `mintaCheckout`)
- Test: `web/tests/pesanan-checkout-persetujuan.test.ts`

**Interfaces:**
- Consumes: `statusPersetujuan(userId)` (Tugas 1); rute `/persetujuan?lanjut=` (Tugas 6).
- Produces: `HasilCheckout` mendapat anggota `{ jenis: "persetujuan" }`. `POST /api/pesanan/checkout` menjawab `403 { kode: "perlu_persetujuan", pesan }`.

- [ ] **Langkah 1: Tulis uji yang gagal**

`web/tests/pesanan-checkout-persetujuan.test.ts`:

```ts
/**
 * Checkout tanpa persetujuan S&K (spec 2026-10-06, revisi 2) — MURNI.
 *
 * Tombol beli di /produk/[slug] bisa dicapai TANPA pernah membuka /passport,
 * jadi gerbang layout tidak pernah melihat pembeli itu. Rute ini satu-satunya
 * tempat lain yang memeriksa persetujuan. Kodenya 403, bukan 409 — 409 sudah
 * dipakai rute ini untuk pesanan terbuka dan gagal membuat pesanan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ref = vi.hoisted(() => ({ sudahSetuju: false, rpc: 0 }));

vi.mock("@/lib/auth/sesi", () => ({ penggunaSaatIni: async () => ({ id: "user-uji" }) }));
vi.mock("@/lib/persetujuan/status", () => ({
  statusPersetujuan: async () => ({ sudahSetuju: ref.sudahSetuju, pernahSetuju: true }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    rpc: async () => {
      ref.rpc++;
      return { data: null, error: { code: "P0001", message: "berhenti di sini (uji)" } };
    },
  }),
}));
vi.mock("@/lib/midtrans/adapter", () => ({
  terbitkanTokenSnap: async () => {
    throw new Error("Snap tidak boleh disentuh di uji ini");
  },
}));

const { POST } = await import("@/app/api/pesanan/checkout/route");

const req = () =>
  new Request("http://localhost/api/pesanan/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: "11111111-1111-4111-8111-111111111111", ulang: false }),
  });

beforeEach(() => {
  ref.sudahSetuju = false;
  ref.rpc = 0;
});

describe("POST /api/pesanan/checkout — persetujuan", () => {
  it("belum setuju: 403 perlu_persetujuan, dan RPC pesanan TIDAK disentuh", async () => {
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect((await res.json()).kode).toBe("perlu_persetujuan");
    expect(ref.rpc).toBe(0);
  });

  it("sudah setuju: lanjut ke RPC seperti biasa", async () => {
    ref.sudahSetuju = true;
    const res = await POST(req());
    expect(ref.rpc).toBe(1);
    expect(res.status).toBe(409); // jawaban RPC tiruan, bukan gerbang
  });
});
```

Di `web/tests/produk-tombol-beli.test.tsx`, tambahkan di akhir `describe("mintaCheckout — …")` yang memuat kasus `it.each([[400], [409]])`:

```ts
  it("403 perlu_persetujuan → jenis persetujuan, TIDAK membakar order_id", async () => {
    const ambil = fetchPalsu({ status: 403, isi: { kode: "perlu_persetujuan", pesan: "Setujui dulu." } });
    const hasil = await mintaCheckout("produk-1", false, ambil);
    expect(hasil).toEqual({ hasil: { jenis: "persetujuan" }, orderIdTerbakar: false });
  });

  it("403 TANPA kode persetujuan tetap jadi pesan biasa", async () => {
    const ambil = fetchPalsu({ status: 403, isi: { pesan: "Ditolak." } });
    const hasil = await mintaCheckout("produk-1", false, ambil);
    expect(hasil).toEqual({ hasil: { jenis: "pesan", pesan: "Ditolak." }, orderIdTerbakar: false });
  });

  it("tombol beli dan keranjang sama-sama membawa pembeli ke /persetujuan", () => {
    const tombol = readFileSync(path.resolve(__dirname, "../src/app/produk/[slug]/tombol-beli.tsx"), "utf8");
    const keranjang = readFileSync(path.resolve(__dirname, "../src/app/passport/keranjang/isi-keranjang.tsx"), "utf8");
    expect(tombol).toMatch(/hasil\.jenis === "persetujuan"[\s\S]{0,400}\/persetujuan\?lanjut=/);
    expect(keranjang).toMatch(/hasil\.jenis === "persetujuan"[\s\S]{0,200}"\/persetujuan"/);
  });
```

- [ ] **Langkah 2: Jalankan, pastikan gagal**

Run: `npm run test:murni -- tests/pesanan-checkout-persetujuan.test.ts tests/produk-tombol-beli.test.tsx`
Expected: FAIL. Kasus 403 di rute mendapat status 409 dengan `ref.rpc === 1`, kasus `jenis: "persetujuan"` mendapat `jenis: "pesan"`, dan uji sumber tidak menemukan `/persetujuan`.

- [ ] **Langkah 3: Rute checkout**

Di `web/src/app/api/pesanan/checkout/route.ts`:

(a) Impor:

```ts
import { statusPersetujuan } from "@/lib/persetujuan/status";
```

(b) Tepat sesudah `if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });`, sisipkan:

```ts

  // PERSETUJUAN S&K (spec 2026-10-06). Tombol beli di /produk/[slug] bisa
  // dicapai tanpa pernah membuka /passport, jadi gerbang layout tidak pernah
  // melihat pembeli ini. 403 + `kode`, BUKAN 409: 409 sudah berarti "pesanan
  // terbuka" dan "gagal membuat pesanan" di rute ini, dan `mintaCheckout`
  // harus bisa membedakannya.
  if (!(await statusPersetujuan(user.id)).sudahSetuju) {
    return NextResponse.json(
      { kode: "perlu_persetujuan", pesan: "Setujui Syarat & Ketentuan lebih dulu." },
      { status: 403 },
    );
  }
```

- [ ] **Langkah 4: `mintaCheckout` dan tipenya**

Di `web/src/app/produk/[slug]/tombol-beli.tsx`:

(a) Pada `export type HasilCheckout =`, sesudah `| { jenis: "masuk" }`, sisipkan:

```ts
  /** Belum menyetujui S&K versi berlaku (spec 2026-10-06) → layar /persetujuan. */
  | { jenis: "persetujuan" }
```

(b) Di `mintaCheckout`, ubah tipe `isi` dan sisipkan pemeriksaan 403. Ganti

```ts
  const isi = (await jawab.json().catch(() => null)) as
    | { token?: string; pesan?: string; pesananId?: string }
    | null;
```

menjadi

```ts
  const isi = (await jawab.json().catch(() => null)) as
    | { token?: string; pesan?: string; pesananId?: string; kode?: string }
    | null;

  // 403 berhenti sebelum Snap disentuh (rute memeriksa persetujuan sebelum
  // RPC), jadi TIDAK membakar. Hanya `kode` yang membedakannya dari 403 lain.
  if (jawab.status === 403 && isi?.kode === "perlu_persetujuan") {
    return { hasil: { jenis: "persetujuan" }, orderIdTerbakar: false };
  }
```

(c) Di dokblok `mintaCheckout`, ganti kalimat `` `400`/`401`/`409` TIDAK membakar: ketiganya berhenti sebelum Snap disentuh. `` menjadi `` `400`/`401`/`403`/`409` TIDAK membakar: keempatnya berhenti sebelum Snap disentuh. ``

(d) Di `klik()`, tepat sesudah blok `if (hasil.jenis === "masuk") { … return; }`, sisipkan:

```ts
      if (hasil.jenis === "persetujuan") {
        // Kembali ke produk ini sesudah setuju; pembeli menekan tombolnya
        // sekali lagi — tidak ada pembelian yang dimulai otomatis.
        router.push(`/persetujuan?lanjut=${encodeURIComponent(`/produk/${slug}`)}`);
        return;
      }
```

Hanya ada SATU penangan hasil `mintaCheckout` di berkas ini (di `klik()`). Cabang `hasil.jenis === "masuk"` lain di sekitar baris 662 milik `batal()` / `mintaBatal`, yang tipenya `HasilBatal`. **Jangan disentuh.**

- [ ] **Langkah 5: Keranjang**

Di `web/src/app/passport/keranjang/isi-keranjang.tsx`, sesudah blok `if (hasil.jenis === "masuk") { router.push("/masuk"); return; }` yang mengikuti `mintaCheckout(` (sekitar baris 78), sisipkan blok berikut. Blok `masuk` kedua di sekitar baris 120 milik `batal()` / `mintaBatal`; **jangan disentuh.**

```ts
      if (hasil.jenis === "persetujuan") {
        // Halaman keranjang yang terbuka sejak sebelum dokumen diperbarui —
        // layout tidak dirender ulang, jadi rutenya yang menangkap.
        router.push("/persetujuan");
        return;
      }
```

- [ ] **Langkah 6: Jalankan, pastikan lulus**

Run: `npm run test:murni -- tests/pesanan-checkout-persetujuan.test.ts tests/produk-tombol-beli.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: tanpa galat. Galat "Property 'token' does not exist on type '{ jenis: "persetujuan" }'" berarti ada konsumen `mintaCheckout` yang terlewat di Langkah 4–5. Tangani di sana.

- [ ] **Langkah 7: Uji checkout ber-DB** (butuh Docker)

Run: `npx vitest run tests/pesanan-checkout-rute.test.ts tests/pesanan-checkout-db.test.ts`
Expected: PASS. Ananda dan klien kedua sudah punya persetujuan dari seed dan fixture Tugas 2. Kalau merah dengan 403, fixture-nya yang hilang. Jangan melonggarkan rutenya.

- [ ] **Langkah 8: Lint dan commit**

Run: `npx eslint src/app/api/pesanan/checkout src/app/produk src/app/passport/keranjang tests/pesanan-checkout-persetujuan.test.ts tests/produk-tombol-beli.test.tsx`

```bash
git add src/app/api/pesanan/checkout/route.ts "src/app/produk/[slug]/tombol-beli.tsx" \
  src/app/passport/keranjang/isi-keranjang.tsx tests/pesanan-checkout-persetujuan.test.ts tests/produk-tombol-beli.test.tsx
git commit -m "feat(pesanan): checkout menjawab 403 perlu_persetujuan, tombol beli & keranjang ke gerbang"
```

---

### Tugas 8: Verifikasi menyeluruh dan review seluruh branch

**Files:** tidak ada berkas baru, kecuali perbaikan dari temuan review.

- [ ] **Langkah 1: Seluruh uji murni rencana ini**

Run:

```bash
npm run test:murni -- tests/persetujuan-lib.test.ts tests/dokumen-hukum.test.tsx tests/skrining-persetujuan.test.ts \
  tests/skrining-usia-kehamilan.test.ts tests/skrining-wizard.test.ts tests/daftar-persetujuan.test.tsx \
  tests/setelah-masuk-persetujuan.test.ts tests/persetujuan-gerbang.test.tsx tests/pesanan-checkout-persetujuan.test.ts \
  tests/produk-tombol-beli.test.tsx tests/access-matrix-layouts.test.ts tests/passport-shell.test.ts tests/panggung-auth.test.tsx
```

Expected: PASS semua.

- [ ] **Langkah 2: Tipe, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: tanpa galat. Halaman `/syarat-ketentuan`, `/kebijakan-privasi`, dan `/persetujuan` muncul di daftar rute build.

- [ ] **Langkah 3: Suite ber-DB penuh** (butuh Docker; **koordinasikan dengan pemilik repo lebih dulu**, karena stack lokal dipakai bersama)

Run: `npx supabase migration up && npm test`
Expected: hijau, kecuali baseline merah yang sudah diketahui sebelum branch ini. Bandingkan dengan `npm test` di `development` bila ada yang merah dan ragu.

- [ ] **Langkah 4: E2E yang tersentuh** (butuh Docker + dev server)

Run: `npm run test:e2e:daftar && npm run test:e2e:funnel && npm run test:e2e:passport && npm run test:e2e && npm run test:e2e:admin && npm run test:e2e:pelengkap && npm run test:e2e:materi && npm run test:e2e:video && npm run test:e2e:bayar && npm run test:e2e:owner`
Expected: semua butir lolos.

- [ ] **Langkah 5: Uji asap manual di peramban**

Dengan `npm run dev`:
1. Buka `/syarat-ketentuan` dan `/kebijakan-privasi` di lebar 390px dan 1280px. Tidak boleh ada gulir horizontal halaman; tabel boleh bergulir di dalam kotaknya sendiri. Daftar isi melompat ke bagiannya.
2. Footer di beranda memuat kedua tautan.
3. `/skrining`: tombol "Mulai Skrining" mati sampai kedua centang dicentang.
4. `/daftar`: kedua tombol mati sampai dicentang.
5. Hapus baris persetujuan Ananda di DB lokal, masuk sebagai `ananda@padma.test`, dan pastikan Anda diarahkan ke `/persetujuan`. Coba tombol "Keluar", lalu masuk lagi, setujui, dan pastikan Anda sampai di `/passport`.

- [ ] **Langkah 6: Review seluruh branch**

Pakai superpowers:requesting-code-review atas `development..feat/syarat-ketentuan-privasi`. Brief reviewer wajib menyertakan spec, rencana ini, dan pelajaran P1: *"aturan yang hidup di dua tempat gagal karena kedua tempat tidak MELIHAT data yang sama"*. Minta reviewer memeriksa secara khusus:
- **Layout dan checkout membaca status lewat fungsi yang sama.** Tanpa itu, keduanya bisa berbeda pendapat untuk akun yang sama.
- **Setiap insert `screenings` mencap persetujuan.** Uji struktural Tugas 4 hanya menghitung; pastikan isinya benar.
- **Teks dokumen tidak menjanjikan sesuatu yang tidak dijalankan sistem.** Bandingkan dengan inventaris di spec.

- [ ] **Langkah 7: Laporkan**

Laporan ke pemilik repo memuat:
- uji mana yang benar-benar dijalankan dan mana yang **tidak** (terutama ber-DB dan e2e bila Docker mati);
- hasil review;
- pengingat **Prasyarat rilis** di spec: review hukum, region Supabase, migrasi disengaja, pemberitahuan klien.

Branch **tidak** di-merge tanpa izin pemilik repo.
