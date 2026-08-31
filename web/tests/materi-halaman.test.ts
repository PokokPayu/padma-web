// tests/materi-halaman.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = () =>
  createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

describe("material_pages & RPC pengganti halaman", () => {
  it("bucket materi-halaman ada dan PRIVAT", async () => {
    const { data } = await svc().storage.getBucket("materi-halaman");
    expect(data).toBeTruthy();
    expect(data!.public).toBe(false);
  });

  it("RPC mengganti seluruh halaman satu materi dalam satu transaksi", async () => {
    const db = svc();
    const { data: layanan } = await db.from("services").select("id").limit(1).single();
    const { data: m } = await db
      .from("materials")
      .insert({ judul: "UJI-HAL", tipe: "ebook", deskripsi: "", aktif: true, service_id: layanan!.id })
      .select("id").single();

    const { data: n1 } = await db.rpc("ganti_halaman_materi", {
      p_material_id: m!.id,
      p_halaman: [
        { halaman: 1, objek: `${m!.id}/0001.webp`, lebar: 1600, tinggi: 2263 },
        { halaman: 2, objek: `${m!.id}/0002.webp`, lebar: 1600, tinggi: 2263 },
      ],
    });
    expect(n1).toBe(2);

    // Panggilan kedua MENGGANTI, bukan menambah.
    const { data: n2 } = await db.rpc("ganti_halaman_materi", {
      p_material_id: m!.id,
      p_halaman: [{ halaman: 1, objek: `${m!.id}/0001.webp`, lebar: 1600, tinggi: 2263 }],
    });
    expect(n2).toBe(1);
    const { data: sisa } = await db.from("material_pages").select("halaman").eq("material_id", m!.id);
    expect(sisa).toHaveLength(1);

    await db.from("materials").delete().eq("id", m!.id);
  });

  it("RLS menyala & anon tidak punya hak apa pun", async () => {
    const rls = await querySql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'material_pages'`,
    );
    expect(rls[0].relrowsecurity).toBe(true);

    const anon = await querySql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_pages'
         and grantee = 'anon'`);
    expect(anon).toEqual([]);
  });

  it("RPC TIDAK PERNAH menyentuh baris materi lain", async () => {
    const db = svc();
    const { data: layanan } = await db.from("services").select("id").limit(1).single();
    const buat = async (judul: string) =>
      (await db.from("materials")
        .insert({ judul, tipe: "ebook", deskripsi: "", aktif: true, service_id: layanan!.id })
        .select("id").single()).data!.id;
    const a = await buat("UJI-RADIUS-A");
    const b = await buat("UJI-RADIUS-B");

    await db.rpc("ganti_halaman_materi", {
      p_material_id: a, p_halaman: [{ halaman: 1, objek: `${a}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
    await db.rpc("ganti_halaman_materi", {
      p_material_id: b, p_halaman: [{ halaman: 1, objek: `${b}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
    // Mengganti A tidak boleh menghapus halaman B — kelas bug `?urutan=gte.0`
    // yang pernah menghapus SELURUH bab materi di repo ini.
    await db.rpc("ganti_halaman_materi", {
      p_material_id: a, p_halaman: [{ halaman: 1, objek: `${a}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
    const { data: halamanB } = await db.from("material_pages").select("halaman").eq("material_id", b);
    expect(halamanB).toHaveLength(1);

    await db.from("materials").delete().in("id", [a, b]);
  });
});
