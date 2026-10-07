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
  catat: vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true),
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
