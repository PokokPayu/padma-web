// tests/materi-halaman.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";
import { signInAs } from "./helpers/as-user";

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
    const { data: m } = await db
      .from("materials")
      .insert({ judul: "UJI-HAL", tipe: "ebook", deskripsi: "", aktif: true })
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

  it("authenticated memegang HANYA SELECT — bukan INSERT/UPDATE/DELETE", async () => {
    // Migration 20260831120000 mencabut hak tabel TOTAL dari `authenticated`
    // lalu memberi kembali SATU-SATUNYA hak SELECT — jalur tulis semata-mata
    // RPC `ganti_halaman_materi` (security definer, guard sendiri). Test di
    // atas ("anon tidak punya hak apa pun") dan describe "penutupan radius"
    // di bawah membuktikan DELETE lewat REST langsung ditolak, tapi tidak
    // satu pun keduanya membuktikan hak TABEL-nya sendiri persis SELECT saja
    // — 42501 pada DELETE tetap sama bunyinya baik hak tabel DELETE memang
    // tidak ada MAUPUN hak tabel ADA tapi ditolak RLS/policy. Baris DAFTAR
    // PERSIS ini (bukan sekadar "DELETE ditolak") yang menutup celahnya:
    // policy staf "halaman: staf kelola" SENGAJA masih `for all` (lihat
    // komentar migration-nya) — pagar yang menutup separuh diam-diam itu
    // adalah HAK TABEL, bukan policy, dan hanya assersi PERSIS ini yang
    // menangkap re-grant INSERT/UPDATE seandainya kelak ditambahkan tanpa
    // sadar. Re-grant UPDATE khususnya akan membuka
    // `PATCH material_pages?halaman=gte.0` untuk menimpa `objek` SELURUH
    // halaman SELURUH materi — sama sekali tidak dijaga policy staf yang
    // `for all` itu.
    const hak = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'material_pages'
         and grantee = 'authenticated'
       order by privilege_type`);
    expect(hak.map((h) => h.privilege_type)).toEqual(["SELECT"]);
  });

  it("RPC TIDAK PERNAH menyentuh baris materi lain", async () => {
    const db = svc();
    const buat = async (judul: string) =>
      (await db.from("materials")
        .insert({ judul, tipe: "ebook", deskripsi: "", aktif: true })
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

/**
 * PENUTUPAN RADIUS — pre-review coordinator menemukan lubang di draft
 * pertama migration ini: RPC `security invoker` memaksa tabel memberi
 * `authenticated` hak DELETE langsung, dan policy "halaman: staf kelola"
 * tidak menyempit ke satu materi. Diprobe nyata sebagai admin sungguhan:
 *
 *   DELETE /rest/v1/material_pages?halaman=gte.0   -> 2 baris tersapu
 *   sisa material_pages di SELURUH basis data: 0
 *
 * Kelas bug persis `?urutan=gte.0` yang dulu menyapu seluruh bab
 * `material_chapters`. Ditutup dengan pola yang sama: hak tabel tulis
 * dicabut TOTAL dari `authenticated`, dan `ganti_halaman_materi` menjadi
 * `security definer` yang memeriksa `user_role()` sendiri — SATU-SATUNYA
 * jalur tulis yang tersisa. Describe ini membuktikan penutupannya, bukan
 * hanya mengklaimnya.
 */
describe("penutupan radius: RPC adalah SATU-SATUNYA jalur tulis", () => {
  it("admin TIDAK BISA menyapu halaman lewat REST langsung (bukan RPC)", async () => {
    const db = svc();
    const buat = async (judul: string) =>
      (await db.from("materials")
        .insert({ judul, tipe: "ebook", deskripsi: "", aktif: true })
        .select("id").single()).data!.id;
    const a = await buat("UJI-SAPU-A");
    const b = await buat("UJI-SAPU-B");

    await db.rpc("ganti_halaman_materi", {
      p_material_id: a, p_halaman: [{ halaman: 1, objek: `${a}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
    await db.rpc("ganti_halaman_materi", {
      p_material_id: b, p_halaman: [{ halaman: 1, objek: `${b}/0001.webp`, lebar: 10, tinggi: 10 }],
    });

    // Ini persis probe coordinator: filter tautologis lewat REST langsung,
    // sebagai admin sungguhan (JWT), bukan service role dan bukan RPC.
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.from("material_pages").delete().gte("halaman", 0);
    expect(error?.code).toBe("42501");

    // 42501 saja tidak membuktikan apa pun tanpa membaca ulang baris —
    // pelajaran yang sudah tertulis berulang di hak-hapus-berlebih.test.ts.
    const { data: sisa } = await db
      .from("material_pages")
      .select("material_id")
      .in("material_id", [a, b]);
    expect(sisa).toHaveLength(2);

    await db.from("materials").delete().in("id", [a, b]);
  });

  it("klien tidak bisa memanggil RPC ganti_halaman_materi", async () => {
    const db = svc();
    const { data: m } = await db
      .from("materials")
      .insert({ judul: "UJI-KLIEN-RPC", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id").single();
    await db.rpc("ganti_halaman_materi", {
      p_material_id: m!.id,
      p_halaman: [{ halaman: 1, objek: `${m!.id}/0001.webp`, lebar: 10, tinggi: 10 }],
    });

    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("ganti_halaman_materi", {
      p_material_id: m!.id,
      p_halaman: [{ halaman: 1, objek: `${m!.id}/BAJAK.webp`, lebar: 1, tinggi: 1 }],
    });
    expect(error).not.toBeNull();

    // Guard di dalam fungsi me-raise SEBELUM delete/insert apa pun berjalan —
    // baris lama harus utuh dengan objek SEMULA, bukan sekadar "RPC menolak".
    const { data: sisa } = await db.from("material_pages").select("objek").eq("material_id", m!.id);
    expect(sisa).toHaveLength(1);
    expect(sisa![0].objek).toBe(`${m!.id}/0001.webp`);

    await db.from("materials").delete().eq("id", m!.id);
  });

  it("staf (admin) TETAP bisa memanggil RPC lewat SESI ASLI, bukan cuma service role", async () => {
    // Krusial, bukan sekadar kelengkapan: memanggil lewat service role tidak
    // pernah membuktikan guard `user_role() in ('admin','owner')` di DALAM
    // fungsi benar-benar berjalan — service role menembus semuanya terlepas
    // guard itu ada atau tidak. Task 2 pernah mengirim guard yang mati persis
    // karena satu-satunya test-nya berjalan lewat service role. Hanya sesi
    // JWT asli yang membuktikan cabang IZIN-nya, bukan hanya cabang radius.
    const db = svc();
    const { data: m } = await db
      .from("materials")
      .insert({ judul: "UJI-ADMIN-RPC", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id").single();

    const admin = await signInAs("admin@padma.test");
    const { data: n, error } = await admin.rpc("ganti_halaman_materi", {
      p_material_id: m!.id,
      p_halaman: [
        { halaman: 1, objek: `${m!.id}/0001.webp`, lebar: 1600, tinggi: 2263 },
        { halaman: 2, objek: `${m!.id}/0002.webp`, lebar: 1600, tinggi: 2263 },
      ],
    });
    expect(error).toBeNull();
    expect(n).toBe(2);

    const { data: sisa } = await db.from("material_pages").select("halaman").eq("material_id", m!.id);
    expect(sisa).toHaveLength(2);

    await db.from("materials").delete().eq("id", m!.id);
  });
});

describe("Task 11 — bab teks & materials.service_id sudah dibongkar", () => {
  it("material_chapters dan materials.service_id sudah tidak ada", async () => {
    const db = svc();
    const { error: bab } = await db.from("material_chapters").select("id").limit(1);
    expect(bab).toBeTruthy(); // relasi hilang -> PostgREST menjawab error

    const { data: m } = await db.from("materials").select("*").limit(1).single();
    expect(Object.keys(m!)).not.toContain("service_id");
  });

  it("materi boleh lahir TANPA layanan sama sekali", async () => {
    const db = svc();
    const { data, error } = await db
      .from("materials")
      .insert({ judul: "UJI-TANPA-LAYANAN", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id").single();
    expect(error).toBeNull();
    await db.from("materials").delete().eq("id", data!.id);
  });
});
