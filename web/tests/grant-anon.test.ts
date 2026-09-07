import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * PERTAHANAN BERLAPIS — hak tabel peran `anon`.
 *
 * Temuan auditor: tabel uang (kini `variant_rates`, dulu `service_rates`
 * sebelum dijatuhkan Task 5), `honor_marks`, dan `material_videos` sudah
 * dicabut hak `anon`-nya, tetapi tabel data pasien (`clients`, `sessions`,
 * `screenings`, `materials`, `material_pages`, `profiles`, dan kerabatnya)
 * masih memegang GRANT `anon` PENUH — SELECT sampai TRUNCATE. Keamanannya
 * bergantung 100% pada KETIADAAN policy RLS yang mengizinkan anon.
 *
 * Kenapa itu rapuh, konkret:
 *   (a) Plan 2 menambahkan landing + skrining publik yang menyentuh persis
 *       tabel-tabel itu. Satu policy `using (true)` yang keliru — sekali
 *       ketik — langsung membuka rekam data pasien ke internet.
 *   (b) TRUNCATE tidak pernah difilter RLS. Selama `anon` memegang TRUNCATE
 *       pada `clients`, RLS bukan lapisan kedua untuk operasi itu; ia tidak
 *       ada lapisan sama sekali.
 *
 * Invarian yang dijaga di sini:
 *   1. peran `anon` tidak memegang hak APA PUN (tabel maupun kolom) atas tabel
 *      data pasien/operasional/internal;
 *   2. `anon` tetap boleh SELECT katalog publik
 *      (phases/services/packages/service_variants) — bahan landing Plan 2 —
 *      tetapi TIDAK boleh menulisnya;
 *   3. lewat REST, anon menabrak 42501 (permission denied) lebih dulu, bukan
 *      diam-diam "0 baris";
 *   4. yang TIDAK boleh ikut rusak: registrasi & login Supabase Auth, akses
 *      klien/admin/owner, dan jalur skrining publik Plan 2 (ditulis SERVER
 *      dengan service role, bukan browser dengan anon key).
 */

const svc = createAdminSupabase();

/** Tabel yang `anon` tidak punya urusan sama sekali dengannya. */
const TABEL_TERTUTUP_ANON = [
  // data pasien & operasional
  "profiles",
  "clients",
  "client_packages",
  "sessions",
  "screenings",
  "booking_requests",
  // materi (isi berbayar)
  "materials",
  "material_services",
  "material_pages",
  "material_assignments",
  "material_videos",
  // internal
  "partners",
  "app_settings",
  // tabel uang
  "variant_rates",
  "honor_marks",
  "transport_rates",
  "transport_khusus",
  "geocode_cache",
  // View (Ruling 12, Task 8 fix round 1): anti-join sesi menunggu tarif
  // khusus, security_invoker = off. Nol nominal, tapi tetap bukan urusan
  // anon — batas perannya sendiri ada di predikat `user_role()` DI DALAM
  // view, yang membaca identitas pemanggil lewat auth.uid(); anon tidak
  // pernah punya identitas semacam itu, dan tidak pernah butuh membaca ini.
  "sesi_menunggu_tarif_transport",
  // View kembar (Ruling 24, gelombang perbaikan akhir): sesi selesai yang
  // jenjangnya belum ditetapkan. Pola hak persis sama dengan view di atas —
  // nol nominal, batas peran ada DI DALAM view lewat `user_role()`.
  "sesi_menunggu_jenjang_transport",
] as const;

/** Katalog publik: anon boleh BACA (bahan landing Plan 2), tidak boleh tulis. */
const TABEL_KATALOG_PUBLIK = ["phases", "services", "packages", "service_variants"] as const;

const HAK_TABEL = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

async function hakTabelAnon(tabel: string): Promise<string[]> {
  const rows = await querySql<{ priv: string }>(
    `select p.priv
       from unnest($2::text[]) as p(priv)
      where has_table_privilege('anon', format('public.%I', $1::text)::regclass, p.priv)
      order by p.priv`,
    [tabel, [...HAK_TABEL]],
  );
  return rows.map((r) => r.priv);
}

/**
 * Hak KOLOM tersisa untuk anon. Perlu diperiksa terpisah: `revoke ... on table`
 * tidak menghapus GRANT tingkat kolom (mis. `grant update (nama) ... to anon`),
 * sehingga tabel bisa tampak bersih di level tabel tapi masih bocor per-kolom.
 */
async function hakKolomAnon(tabel: string): Promise<string[]> {
  const rows = await querySql<{ kolom: string; priv: string }>(
    `select c.column_name as kolom, p.priv
       from information_schema.columns c
       cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) as p(priv)
      where c.table_schema = 'public'
        and c.table_name = $1
        and has_column_privilege('anon', format('public.%I', c.table_name)::regclass,
                                 c.column_name, p.priv)
      order by c.column_name, p.priv`,
    [tabel],
  );
  return rows.map((r) => `${r.kolom}:${r.priv}`);
}

describe("GRANT anon — tabel data pasien tertutup di level HAK TABEL", () => {
  it.each(TABEL_TERTUTUP_ANON)(
    "anon tidak memegang hak tabel apa pun atas %s",
    async (tabel) => {
      expect(await hakTabelAnon(tabel)).toEqual([]);
    },
  );

  it.each(TABEL_TERTUTUP_ANON)(
    "anon tidak menyimpan sisa hak KOLOM atas %s",
    async (tabel) => {
      expect(await hakKolomAnon(tabel)).toEqual([]);
    },
  );
});

describe("GRANT anon — katalog publik sengaja DIPERTAHANKAN (baca saja)", () => {
  it.each(TABEL_KATALOG_PUBLIK)(
    "anon hanya boleh SELECT pada %s — tanpa hak tulis",
    async (tabel) => {
      expect(await hakTabelAnon(tabel)).toEqual(["SELECT"]);
    },
  );
});

describe("GRANT anon — perilaku lewat REST: ditolak 42501, bukan '0 baris'", () => {
  const tabelRest = [
    "profiles",
    "clients",
    "client_packages",
    "sessions",
    "screenings",
    "booking_requests",
    "materials",
    "material_services",
    "material_pages",
    "material_assignments",
    "material_videos",
    "partners",
    "app_settings",
    "variant_rates",
    "honor_marks",
  ] as const;

  it.each(tabelRest)("anon SELECT %s ditolak permission denied", async (tabel) => {
    const { data, error } = await anonClient().from(tabel).select("*");
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe("42501");
  });

  it("anon INSERT screenings ditolak di level hak tabel (bukan sekadar RLS)", async () => {
    const { error } = await anonClient().from("screenings").insert({
      kode: `PDM-GRANT-${Date.now()}`,
      nama: "Penyerang",
      no_hp: "0",
      fase: "prekonsepsi",
      jawaban: {},
      hasil: "hijau",
    });
    expect(error?.code).toBe("42501");
  });

  it("anon TRUNCATE clients mustahil — haknya tidak ada", async () => {
    // RLS tidak pernah menyaring TRUNCATE; satu-satunya penjaga adalah hak tabel.
    const [row] = await querySql<{ bisa: boolean }>(
      `select has_table_privilege('anon', 'public.clients'::regclass, 'TRUNCATE') as bisa`,
    );
    expect(row.bisa).toBe(false);
  });
});

describe("GRANT anon — yang TIDAK boleh ikut rusak", () => {
  it("registrasi mandiri lewat Supabase Auth tetap jalan & profil klien terbentuk", async () => {
    const email = `uji-grant-${Date.now()}@padma.test`;
    const anon = anonClient();
    const { data, error } = await anon.auth.signUp({
      email,
      password: "padma-dev-123",
      options: { data: { full_name: "Uji Grant" } },
    });
    expect(error).toBeNull();
    const uid = data.user!.id;
    try {
      // Trigger handle_new_user (SECURITY DEFINER) tidak butuh hak anon.
      const { data: profil, error: pErr } = await svc
        .from("profiles")
        .select("role, nama")
        .eq("id", uid)
        .single();
      expect(pErr).toBeNull();
      expect(profil!.role).toBe("klien");
      expect(profil!.nama).toBe("Uji Grant");
    } finally {
      await svc.auth.admin.deleteUser(uid);
    }
  });

  it("login klien/admin/owner tetap jalan dan datanya tetap terbaca", async () => {
    const klien = await signInAs("ananda@padma.test");
    const milikKlien = await klien.from("clients").select("padma_id");
    expect(milikKlien.error).toBeNull();
    expect(milikKlien.data).toHaveLength(1);

    const admin = await signInAs("admin@padma.test");
    const semuaKlien = await admin.from("clients").select("id");
    expect(semuaKlien.error).toBeNull();
    expect(semuaKlien.data!.length).toBeGreaterThanOrEqual(2);

    const owner = await signInAs("owner@padma.test");
    // `service_rates` dijatuhkan Task 5 — tarif kini hidup di `variant_rates`.
    const tarif = await owner.from("variant_rates").select("harga_klien");
    expect(tarif.error).toBeNull();
    expect(tarif.data!.length).toBeGreaterThanOrEqual(10);
  });

  it("klien login tetap bisa membaca katalog layanan", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien.from("services").select("id, nama");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });

  it("jalur skrining publik Plan 2 (SERVER / service role) tetap bisa menulis", async () => {
    const kode = `PDM-SRV-${Date.now()}`;
    const { data, error } = await svc
      .from("screenings")
      .insert({
        kode,
        nama: "Pengunjung Publik",
        no_hp: "0812-0000-0000",
        fase: "prekonsepsi",
        jawaban: { q1: "ya" },
        hasil: "hijau",
      })
      .select("id, kode");
    try {
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].kode).toBe(kode);
    } finally {
      await svc.from("screenings").delete().eq("kode", kode);
    }
  });
});
