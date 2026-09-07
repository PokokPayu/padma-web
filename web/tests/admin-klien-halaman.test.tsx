import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => "admin" }));

// `ambilDaftarKlien` (dan pembacaan `phases` di rute /baru) memakai SESI
// PENGGUNA (`createServerSupabase`), bukan service role — RLS `clients: staf`
// yang mengizinkan bacaannya. Di vitest tidak ada cookie untuk `cookies()`
// disuntikkan lewat request Next asli, jadi klien ber-SESI SUNGGUHAN
// disuntikkan di sini, pola yang sama dengan tests/admin-mitra-halaman.test.tsx.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

beforeAll(async () => {
  ref.sesi = await signInAs("admin@padma.test");
});

const { default: HalamanKlien } = await import("@/app/admin/klien/page");

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await HalamanKlien({ searchParams: Promise.resolve(sp) }));

describe("halaman /admin/klien", () => {
  it("setiap baris menaut ke halaman detailnya", async () => {
    // Pola B: klien punya isi turunan (riwayat sesi, paket, akses materi),
    // jadi barisnya membuka halaman, bukan panel geser.
    const m = await render();
    expect(m).toMatch(/href="\/admin\/klien\/[0-9a-f-]{36}"/);
  });

  it("TIDAK ada panel geser di modul ini", async () => {
    expect(await render()).not.toContain('role="dialog"');
  });

  it("punya bilah cari dan chip aktivasi", async () => {
    const m = await render();
    expect(m).toContain('name="cari"');
    expect(m).toContain("aktivasi=belum");
  });

  it("pencarian menyempitkan tabel yang dirender", async () => {
    const semua = await render();
    const disaring = await render({ cari: "ananda" });
    const hitung = (s: string) => (s.match(/href="\/admin\/klien\/[0-9a-f-]{36}"/g) ?? []).length;
    expect(hitung(disaring)).toBeLessThan(hitung(semua));
    expect(hitung(disaring)).toBeGreaterThan(0);
  });

  it("penjelasan halaman terlipat, bukan hilang", async () => {
    expect(await render()).toContain("<details");
  });

  it("TIDAK menampilkan satu nominal rupiah pun", async () => {
    expect(await render()).not.toMatch(/Rp\s?\d/);
  });

  it("rute /admin/klien/baru merender formulir, bukan halaman detail id 'baru'", async () => {
    const { default: Baru } = await import("@/app/admin/klien/baru/page");
    const m = renderToStaticMarkup(await Baru());
    expect(m).toContain('name="nama"');
    expect(m).toContain("Kembali ke Klien");
  });
});
