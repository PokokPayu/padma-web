import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

// State yang bisa diubah tiap test; dipakai oleh modul-modul yang dimock.
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { role: string; nama: string } | null,
}));

// redirect() asli melempar NEXT_REDIRECT dan menghentikan render.
// Mock ini meniru perilaku itu supaya alur guard bisa diuji.
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.profile, error: null }),
        }),
      }),
    }),
  }),
}));

import { requireRole } from "@/lib/auth/require-role";

function masukSebagai(role: "klien" | "admin" | "owner", nama: string) {
  state.user = { id: `user-${role}` };
  state.profile = { role, nama };
}

beforeEach(() => {
  state.user = null;
  state.profile = null;
});

describe("requireRole — guard peran server-side", () => {
  it("tanpa login dilempar ke /masuk", async () => {
    await expect(requireRole(["klien"])).rejects.toThrow(
      "NEXT_REDIRECT:/masuk",
    );
  });

  it("klien membuka rute admin dilempar ke /setelah-masuk", async () => {
    masukSebagai("klien", "Ananda Putri");
    await expect(requireRole(["admin", "owner"])).rejects.toThrow(
      "NEXT_REDIRECT:/setelah-masuk",
    );
  });

  it("admin membuka rute owner dilempar ke /setelah-masuk", async () => {
    masukSebagai("admin", "Admin PADMA");
    await expect(requireRole(["owner"])).rejects.toThrow(
      "NEXT_REDIRECT:/setelah-masuk",
    );
  });

  it("owner boleh membuka rute admin (owner superset admin)", async () => {
    masukSebagai("owner", "Pemilik PADMA");
    const hasil = await requireRole(["admin", "owner"]);
    expect(hasil).toEqual({
      userId: "user-owner",
      role: "owner",
      nama: "Pemilik PADMA",
    });
  });

  it("klien boleh membuka rute passport", async () => {
    masukSebagai("klien", "Ananda Putri");
    const hasil = await requireRole(["klien"]);
    expect(hasil.role).toBe("klien");
    expect(hasil.nama).toBe("Ananda Putri");
  });

  it("user tanpa baris profiles dianggap klien", async () => {
    state.user = { id: "user-tanpa-profil" };
    state.profile = null;
    const hasil = await requireRole(["klien"]);
    expect(hasil.role).toBe("klien");
    await expect(requireRole(["owner"])).rejects.toThrow(
      "NEXT_REDIRECT:/setelah-masuk",
    );
  });
});
