// tests/materi-banyak-layanan.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";

const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

describe("material_services — materi boleh milik banyak layanan", () => {
  it("setiap materi lama termigrasi menjadi tepat satu baris", async () => {
    const db = svc();
    const { data: materi } = await db.from("materials").select("id, service_id");
    const { data: tautan } = await db.from("material_services").select("material_id, service_id");
    expect(materi!.length).toBeGreaterThan(0);
    for (const m of materi!) {
      const cocok = (tautan ?? []).filter(
        (t) => t.material_id === m.id && t.service_id === m.service_id,
      );
      expect(cocok, `materi ${m.id} tidak termigrasi`).toHaveLength(1);
    }
  });

  it("RLS menyala", async () => {
    // Tabel baru lahir TANPA RLS. Ini pemeriksaan yang sudah pernah menyelamatkan
    // repo ini, jadi ia ditulis untuk setiap tabel baru.
    const baris = await querySql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'material_services'`,
    );
    expect(baris[0].relrowsecurity).toBe(true);
  });

  it("authenticated hanya memegang SELECT — hak tulis default dicabut", async () => {
    const baris = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_services'
         and grantee = 'authenticated'
       order by privilege_type`);
    expect(baris.map((b) => b.privilege_type)).toEqual(["SELECT"]);
  });

  it("anon tidak memegang hak apa pun", async () => {
    const baris = await querySql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_services'
         and grantee = 'anon'`);
    expect(baris).toEqual([]);
  });
});
