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
vi.mock("@/lib/doku/tautan", () => ({
  terbitkanTautanBayar: async () => {
    throw new Error("DOKU tidak boleh disentuh di uji ini");
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
