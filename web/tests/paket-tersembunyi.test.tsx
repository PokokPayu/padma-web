/**
 * PAGAR SAKLAR PAKET (spec K11).
 *
 * Yang dijaga: dengan `PAKET_TAMPIL = false`, tidak ada jalur data yang
 * memasok paket ke layar. Test ini sengaja memakai klien seed yang MEMANG
 * punya paket aktif — kalau ia dites dengan klien tanpa paket, ia akan hijau
 * tanpa membuktikan apa pun.
 *
 * `.tsx` (bukan `.ts`) sejak awal: Tugas 3 menambah test yang merender
 * komponen React ke berkas ini, dan mengganti ekstensi belakangan hanya
 * berarti kerja ulang.
 *
 * `ambilPaket` memakai `createServerSupabase()` yang membaca `cookies()` dari
 * `next/headers` — tidak bermakna di vitest. Modulnya diganti dengan klien
 * Supabase ber-SESI NYATA (`signInAs`), pola yang sama dipakai
 * `tests/passport-data.test.ts`: query tetap melewati RLS sebagai Ananda,
 * persis seperti di server.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

/** Klien seed yang memang punya paket aktif — nilai yang sama dipakai
 *  tests/admin-klien.test.ts:46 dan tests/admin-layanan.test.ts:53. */
const ANANDA = "44444444-4444-4444-4444-444444444401";

// `ref` di tingkat modul, sesinya disetel per-`describe` — berkas ini akan
// dipakai bersama tugas-tugas berikutnya dengan sesi berbeda (admin, owner),
// jadi tidak boleh mengunci satu sesi untuk seluruh berkas.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

describe("saklar paket: gerbang data klien", () => {
  beforeAll(async () => {
    ref.klien = await signInAs("ananda@padma.test");
  });

  it("ambilPaket memulangkan kosong walau kliennya punya paket aktif", async () => {
    const { ambilPaket } = await import("@/lib/passport/data");
    expect(await ambilPaket(ANANDA)).toEqual([]);
  });

  it("dengan saklar HIDUP, paket klien itu tetap terbaca", async () => {
    vi.resetModules();
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    const { ambilPaket } = await import("@/lib/passport/data");
    expect((await ambilPaket(ANANDA)).length).toBeGreaterThan(0);
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();
  });
});
