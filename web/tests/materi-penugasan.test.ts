// tests/materi-penugasan.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { querySql } from "./helpers/db";
import { signInAs } from "./helpers/as-user";

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

/**
 * Materi baru TANPA tautan layanan sama sekali — dipakai berulang di describe
 * bawah supaya jalur otomatis (sesi selesai) pasti tertutup dan satu-satunya
 * cara membuka isinya benar-benar hanya lewat material_assignments.
 *
 * Sejak Task 11, materi memang BOLEH lahir tanpa satu pun layanan
 * (materials.service_id tunggal sudah digantikan material_services, yang
 * boleh nol baris) — tidak perlu lagi menyisipkan lalu menghapus tautan
 * seperti sebelum kolom itu dibongkar.
 */
async function materiTanpaLayanan(judul: string): Promise<string> {
  const db = svc();
  const { data: m } = await db
    .from("materials")
    .insert({ judul, tipe: "ebook", deskripsi: "", aktif: true })
    .select("id")
    .single();
  return m!.id as string;
}

describe("material_assignments — penugasan membuka isi tanpa sesi selesai", () => {
  let materiId = "";
  let klienId = "";

  beforeAll(async () => {
    const db = svc();
    // Materi yang TIDAK punya layanan sama sekali: satu-satunya jalan bukanya
    // adalah penugasan, sehingga test ini tidak bisa lolos lewat jalur
    // otomatis. Sejak Task 11 itu keadaan SAH dari lahir — tidak perlu lagi
    // menyisipkan lalu menghapus tautan material_services.
    const { data: m } = await db
      .from("materials")
      .insert({ judul: "UJI-ASSIGN", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id")
      .single();
    materiId = m!.id;
    const { data: k } = await db
      .from("clients")
      .select("id")
      .eq("email", "ananda@padma.test")
      .single();
    klienId = k!.id;
    // Baris uji disisipkan lewat RPC — satu-satunya jalur tulis
    // `material_pages` sejak Task 3/11 — bukan INSERT langsung.
    await db.rpc("ganti_halaman_materi", {
      p_material_id: materiId,
      p_halaman: [{ halaman: 1, objek: `${materiId}/0001.webp`, lebar: 10, tinggi: 10 }],
    });
  });

  afterAll(async () => {
    await svc().from("materials").delete().eq("id", materiId);
  });

  it("tanpa penugasan, klien tidak membaca satu halaman pun", async () => {
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.from("material_pages").select("halaman").eq("material_id", materiId);
    expect(data ?? []).toHaveLength(0);
  });

  it("sesudah ditugaskan, klien membaca halamannya", async () => {
    const db = svc();
    const { data: staf } = await db.from("profiles").select("id").eq("role", "admin").single();
    await db.from("material_assignments").insert({
      material_id: materiId, client_id: klienId, ditugaskan_oleh: staf!.id,
    });
    const c = await sesiKlien("ananda@padma.test");
    const { data } = await c.from("material_pages").select("halaman, objek").eq("material_id", materiId);
    expect(data).toHaveLength(1);
    expect(data![0].objek).toBe(`${materiId}/0001.webp`);
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
    // SELECT tabel sebenarnya DIPEGANG authenticated (termasuk klien); yang
    // menutup baris adalah RLS — satu-satunya policy hanya lolos untuk
    // admin/owner. Untuk klien itu berarti array kosong tanpa error, bukan
    // 42501. Assersi ini sengaja toleran ke error JUGA supaya tidak rapuh
    // terhadap pengerasan tambahan di masa depan (mis. hak tabel ikut dicabut).
    expect(error ?? (data ?? []).length === 0).toBeTruthy();
  });

  it("materi NONAKTIF menutup ISI-nya, tetapi barisnya TETAP terbaca", async () => {
    const db = svc();
    await db.from("materials").update({ aktif: false }).eq("id", materiId);
    const c = await sesiKlien("ananda@padma.test");

    const { data: isi } = await c.from("material_pages").select("halaman").eq("material_id", materiId);
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

describe("material_assignments — ditugaskan_oleh tidak bisa dipalsukan lewat payload", () => {
  // Regresi spesifik: trigger paksa_aktor_penugasan() sempat lahir
  // `security definer`. Di dalam fungsi SECURITY DEFINER, `current_user`
  // adalah PEMILIK fungsi (postgres) — bukan peran pemanggil — sehingga guard
  // "current_user not in ('anon','authenticated','authenticator')" SELALU
  // true dan cabang pemaksaan `new.ditugaskan_oleh := auth.uid()` TIDAK
  // PERNAH tercapai untuk siapa pun. Test lain di berkas ini tidak bisa
  // menangkap itu karena satu-satunya INSERT yang mereka lakukan lewat
  // service role, tempat "guard dilewatkan (benar)" dan "guard mati total
  // (salah)" menghasilkan baris yang identik. Test ini INSERT sebagai admin
  // BERSESI SUNGGUHAN — bukan service role — dan payloadnya memalsukan
  // ditugaskan_oleh sebagai profil LAIN, supaya hanya trigger yang bekerja
  // benar yang bisa membuatnya lolos.
  let materiId = "";
  let klienId = "";
  let adminProfilId = "";
  let ownerProfilId = "";

  beforeAll(async () => {
    materiId = await materiTanpaLayanan("UJI-SPOOF");
    const db = svc();
    const { data: k } = await db
      .from("clients")
      .select("id")
      .eq("email", "ananda@padma.test")
      .single();
    klienId = k!.id;
    const { data: admin } = await db.from("profiles").select("id").eq("role", "admin").single();
    const { data: owner } = await db.from("profiles").select("id").eq("role", "owner").single();
    adminProfilId = admin!.id;
    ownerProfilId = owner!.id;
  });

  afterAll(async () => {
    await svc().from("materials").delete().eq("id", materiId);
  });

  it("admin login sungguhan memalsukan ditugaskan_oleh sebagai owner: tersimpan tetap id admin sendiri", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.from("material_assignments").insert({
      material_id: materiId,
      client_id: klienId,
      ditugaskan_oleh: ownerProfilId, // payload berbohong: mengaku sebagai owner
    });
    expect(error).toBeNull();

    const { data: tersimpan } = await svc()
      .from("material_assignments")
      .select("ditugaskan_oleh")
      .eq("material_id", materiId)
      .eq("client_id", klienId)
      .single();
    // Trigger wajib menang atas payload: nilai yang tersimpan adalah pemanggil
    // SEBENARNYA (admin), bukan yang admin coba tuliskan (owner).
    expect(tersimpan!.ditugaskan_oleh).toBe(adminProfilId);
    expect(tersimpan!.ditugaskan_oleh).not.toBe(ownerProfilId);
  });
});

describe("material_assignments — hak DELETE per peran (BOLEH_DELETE bukan cek kosong)", () => {
  // tests/hak-hapus-berlebih.test.ts mengizinkan tabel ini memegang DELETE
  // dengan alasan tertulis; alasan tertulis tanpa perilaku yang diuji adalah
  // pagar yang regresinya diam-diam. Dua test ini membuktikan GERBANGnya
  // (RLS per peran), dan yang kedua sekaligus membuktikan DELETE yang benar
  // berfilter tidak menyapu baris SAUDARA (materi lain, klien sama) — bentuk
  // risiko yang justru dikutip di BOLEH_DELETE.
  let materiA = "";
  let materiB = "";
  let klienId = "";

  beforeAll(async () => {
    materiA = await materiTanpaLayanan("UJI-DELETE-A");
    materiB = await materiTanpaLayanan("UJI-DELETE-B");
    const db = svc();
    const { data: k } = await db
      .from("clients")
      .select("id")
      .eq("email", "ananda@padma.test")
      .single();
    klienId = k!.id;
    const { data: staf } = await db.from("profiles").select("id").eq("role", "admin").single();
    const { error } = await db.from("material_assignments").insert([
      { material_id: materiA, client_id: klienId, ditugaskan_oleh: staf!.id },
      { material_id: materiB, client_id: klienId, ditugaskan_oleh: staf!.id },
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    await svc().from("materials").delete().in("id", [materiA, materiB]);
  });

  it("klien menghapus baris penugasan: permintaan lolos hak tabel, RLS menyapu nol baris", async () => {
    const klien = await sesiKlien("ananda@padma.test");
    const { error } = await klien
      .from("material_assignments")
      .delete()
      .eq("material_id", materiA)
      .eq("client_id", klienId);
    // Hak tabel DELETE memang dipegang authenticated (klien termasuk di
    // dalamnya) — yang menutup adalah RLS: policy "penugasan: staf kelola"
    // hanya lolos untuk admin/owner, jadi permintaan klien tidak error, hanya
    // tidak menyentuh baris apa pun.
    expect(error).toBeNull();

    const { data: utuh } = await svc()
      .from("material_assignments")
      .select("material_id")
      .eq("material_id", materiA)
      .eq("client_id", klienId);
    expect(utuh).toHaveLength(1);
  });

  it("staf menghapus baris penugasan: tepat SATU baris hilang, baris saudara utuh", async () => {
    const staf = await signInAs("admin@padma.test");
    const { error } = await staf
      .from("material_assignments")
      .delete()
      .eq("material_id", materiA)
      .eq("client_id", klienId);
    expect(error).toBeNull();

    const db = svc();
    const { data: sisaA } = await db
      .from("material_assignments")
      .select("material_id")
      .eq("material_id", materiA)
      .eq("client_id", klienId);
    expect(sisaA).toHaveLength(0);

    // Baris SAUDARA (materi lain, klien sama) tidak ikut tersapu — DELETE
    // yang benar-benar berfilter pada (material_id, client_id), bukan yang
    // diam-diam menyapu seluruh tabel lewat filter longgar/tautologis.
    const { data: sisaB } = await db
      .from("material_assignments")
      .select("material_id")
      .eq("material_id", materiB)
      .eq("client_id", klienId);
    expect(sisaB).toHaveLength(1);
  });
});
