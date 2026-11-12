/**
 * Ambil produk gratis tanpa persetujuan S&K — MURNI.
 *
 * Spec 2026-10-06 memasang gerbang di checkout karena tombol beli bisa
 * dicapai TANPA pernah membuka /passport. Tombol "Ambil gratis" di halaman
 * produk yang sama adalah pintu kedua dengan sifat itu: ia menerbitkan
 * entitlement (transaksi bernilai nol) tanpa pernah melewati layout passport.
 * Sebelum perbaikan ini, klien baru dari login Google bisa memiliki produk
 * tanpa satu pun catatan persetujuan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tujuanPersetujuanAman } from "@/lib/persetujuan/tujuan";

const ref = vi.hoisted(() => ({ sudahSetuju: false, rpc: [] as string[] }));

vi.mock("@/lib/auth/sesi", () => ({ penggunaSaatIni: async () => ({ id: "user-uji" }) }));
vi.mock("@/lib/persetujuan/status", () => ({
  statusPersetujuan: async () => ({ sudahSetuju: ref.sudahSetuju, pernahSetuju: true }),
}));
vi.mock("@/lib/produk/katalog", () => ({
  bacaProdukPerSlug: async (slug: string) =>
    slug === "panduan-menyusui"
      ? { id: "11111111-1111-4111-8111-111111111111", slug: "panduan-menyusui" }
      : null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    rpc: async (nama: string) => {
      ref.rpc.push(nama);
      return { data: true, error: null };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {} }) }));
// `redirect` asli juga melempar; tiruan ini membawa tujuannya di pesan galat.
vi.mock("next/navigation", () => ({
  redirect: (ke: string) => {
    throw new Error(`REDIRECT ${ke}`);
  },
}));

const { ambilProdukGratis } = await import("@/app/produk/[slug]/ambil");

beforeEach(() => {
  ref.sudahSetuju = false;
  ref.rpc = [];
});

/** Tujuan redirect dari galat tiruan, atau null bila tidak ada redirect. */
async function tujuanRedirect(slug: string): Promise<string | null> {
  try {
    await ambilProdukGratis(slug);
    return null;
  } catch (e) {
    const m = /^REDIRECT (.+)$/.exec((e as Error).message);
    if (!m) throw e;
    return m[1];
  }
}

describe("ambilProdukGratis — persetujuan S&K", () => {
  it("belum setuju: diarahkan ke /persetujuan, dan RPC apa pun TIDAK disentuh", async () => {
    const ke = await tujuanRedirect("panduan-menyusui");
    expect(ke).not.toBeNull();
    expect(new URL(ke!, "http://x").pathname).toBe("/persetujuan");
    expect(ref.rpc).toEqual([]);
  });

  it("sesudah setuju, /persetujuan memulangkan klien ke halaman produk yang sama", async () => {
    const ke = await tujuanRedirect("panduan-menyusui");
    const lanjut = new URL(ke!, "http://x").searchParams.get("lanjut");
    // Whitelist yang dipakai halaman /persetujuan sungguhan — bukan
    // perbandingan string mentah, supaya tujuan yang ditolak regex-nya
    // (dan jatuh ke /passport) ikut memerahkan uji ini.
    expect(tujuanPersetujuanAman(lanjut)).toBe("/produk/panduan-menyusui");
  });

  it("sudah setuju: lanjut ke RPC ambil_produk_gratis seperti biasa", async () => {
    ref.sudahSetuju = true;
    const hasil = await ambilProdukGratis("panduan-menyusui");
    expect(ref.rpc[0]).toBe("ambil_produk_gratis");
    expect(hasil).toEqual({ ok: true, punya: true });
  });

  it("produk tak dikenal: jawaban 'tidak ditemukan', bukan redirect ke gerbang", async () => {
    expect(await ambilProdukGratis("tidak-ada")).toEqual({
      ok: false,
      pesan: "Produk tidak ditemukan.",
    });
    expect(ref.rpc).toEqual([]);
  });
});
