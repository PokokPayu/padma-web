// tests/materi-penugasan.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = () =>
  createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

/** Sesi klien uji: dipakai menembak REST sebagai klien sungguhan. */
async function sesiKlien(email: string) {
  const c = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: "padma-dev-123" });
  if (error) throw error;
  return c;
}

describe("material_assignments — penugasan membuka isi tanpa sesi selesai", () => {
  let materiId = "";
  let klienId = "";

  beforeAll(async () => {
    const db = svc();
    // Materi yang TIDAK punya layanan sama sekali: satu-satunya jalan bukanya
    // adalah penugasan, sehingga test ini tidak bisa lolos lewat jalur otomatis.
    // `materials.service_id` masih NOT NULL sampai Task 11, jadi ia wajib diisi.
    const { data: layanan } = await db.from("services").select("id").limit(1).single();
    const { data: m } = await db
      .from("materials")
      .insert({
        judul: "UJI-ASSIGN", tipe: "ebook", deskripsi: "", aktif: true,
        service_id: layanan!.id,
      })
      .select("id")
      .single();
    materiId = m!.id;
    // Tautan layanan DIHAPUS supaya jalur otomatis benar-benar tertutup — kalau
    // tidak, test ini bisa lolos lewat sesi selesai dan tidak membuktikan apa pun
    // tentang penugasan.
    await db.from("material_services").delete().eq("material_id", materiId);
    const { data: k } = await db
      .from("clients")
      .select("id")
      .eq("email", "ananda@padma.test")
      .single();
    klienId = k!.id;
    await db.from("material_chapters").insert({
      material_id: materiId, urutan: 1, judul: "Bab uji", isi: "ISI-RAHASIA-ASSIGN",
    });
  });

  afterAll(async () => {
    await svc().from("materials").delete().eq("id", materiId);
  });

  it("tanpa penugasan, klien tidak membaca satu bab pun", async () => {
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.from("material_chapters").select("isi").eq("material_id", materiId);
    expect(data ?? []).toHaveLength(0);
  });

  it("sesudah ditugaskan, klien membaca babnya", async () => {
    const db = svc();
    const { data: staf } = await db.from("profiles").select("id").eq("role", "admin").single();
    await db.from("material_assignments").insert({
      material_id: materiId, client_id: klienId, ditugaskan_oleh: staf!.id,
    });
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.from("material_chapters").select("isi").eq("material_id", materiId);
    expect(data).toHaveLength(1);
    expect(data![0].isi).toContain("ISI-RAHASIA-ASSIGN");
  });

  it("fungsi hak menjawab true walau klien tidak boleh membaca tabel penugasan", async () => {
    // Inilah jebakan yang membuat fungsinya harus `security definer`: RLS
    // berlaku rekursif pada tabel yang dirujuk policy, dan material_assignments
    // sengaja tertutup bagi klien. Tanpa security definer, jawabannya false.
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.rpc("berhak_isi_materi", { p_material_id: materiId });
    expect(data).toBe(true);
  });

  it("klien TIDAK boleh membaca tabel penugasan itu sendiri", async () => {
    const c = await sesiKlien("ananda@padma.test");
    const { data, error } = await c.from("material_assignments").select("material_id");
    // Hak tabel dicabut: PostgREST menjawab error, bukan array kosong.
    expect(error ?? (data ?? []).length === 0).toBeTruthy();
  });

  it("materi NONAKTIF menutup ISI-nya, tetapi barisnya TETAP terbaca", async () => {
    const db = svc();
    await db.from("materials").update({ aktif: false }).eq("id", materiId);
    const c = await sesiKlien("ananda@padma.test");

    const { data: isi } = await c.from("material_chapters").select("isi").eq("material_id", materiId);
    expect(isi ?? []).toHaveLength(0);

    // Baris `materials` sendiri HARUS tetap terbaca. Menutupnya akan mengulangi
    // bug `partner_publik`: metadata hilang dari layar lain tanpa satu pun error.
    const { data: meta } = await c.from("materials").select("judul").eq("id", materiId);
    expect(meta).toHaveLength(1);

    await db.from("materials").update({ aktif: true }).eq("id", materiId);
  });

  it("RLS menyala & grant default authenticated dicabut", async () => {
    // Tabel baru lahir TANPA RLS dan `authenticated` mendapat hak penuh secara
    // default. Sudah pernah terlewat di repo ini, jadi diperiksa per tabel baru.
    const rls = await querySql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'material_assignments'`,
    );
    expect(rls[0].relrowsecurity).toBe(true);

    const hak = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_assignments'
         and grantee = 'authenticated'
       order by privilege_type`);
    expect(hak.map((h) => h.privilege_type)).toEqual(["DELETE", "INSERT", "SELECT"]);

    const anon = await querySql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_assignments'
         and grantee = 'anon'`);
    expect(anon).toEqual([]);
  });
});
