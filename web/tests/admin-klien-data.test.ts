/**
 * Lapisan data daftar klien (`ambilDaftarKlien`) — dipisah dari
 * `admin-klien.test.ts` yang menguji halaman & server action, supaya
 * saringan dan paginasi bisa diuji tanpa merender markup.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));

const { ambilDaftarKlien } = await import("@/lib/admin/klien");
const admin = createAdminSupabase();

beforeAll(async () => { ref.sesi = await signInAs("admin@padma.test"); });

describe("ambilDaftarKlien", () => {
  it("mencari menurut nama DAN PADMA ID", async () => {
    // PADMA ID adalah yang dibacakan klien lewat telepon; nama adalah yang
    // diingat admin. Keduanya harus menemukan baris yang sama.
    const lewatNama = await ambilDaftarKlien({ cari: "ananda", saring: {}, hal: 1 });
    expect(lewatNama.baris.length).toBeGreaterThan(0);
    const target = lewatNama.baris[0];

    const lewatId = await ambilDaftarKlien({ cari: target.padmaId, saring: {}, hal: 1 });
    expect(lewatId.baris.map((k) => k.id)).toContain(target.id);
  });

  it("menyaring klien yang BELUM aktivasi", async () => {
    const { baris } = await ambilDaftarKlien({ cari: "", saring: { aktivasi: "belum" }, hal: 1 });
    expect(baris.every((k) => !k.aktif)).toBe(true);
  });

  it("total tidak ikut terpotong halaman", async () => {
    const { baris, total } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(total).toBeGreaterThanOrEqual(baris.length);
  });

  it("hanya paket BERSTATUS AKTIF yang menjadi identitas baris", async () => {
    // Paket lama tidak menggantikan gambaran "sedang menjalani apa".
    const { baris } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    for (const k of baris.filter((b) => b.paketAktif !== null)) {
      const { data } = await admin
        .from("client_packages")
        .select("status")
        .eq("client_id", k.id)
        .eq("status", "aktif");
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });

  it("TIDAK memulangkan satu pun nominal rupiah", async () => {
    // Money firewall: /admin tidak melihat angka uang. Paket dipulangkan
    // sebagai NAMA, bukan harganya.
    const { baris } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(JSON.stringify(baris)).not.toMatch(/harga|nominal|honor/i);
  });
});
