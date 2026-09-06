import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

// Regression test untuk temuan red team: eskalasi hak lewat tabel `profiles`.
// Akar masalah lama: policy "profil: staf kelola" (FOR ALL) membuat admin bisa
// menulis kolom `role` — termasuk barisnya sendiri — menjadi 'owner', lalu
// menembus money firewall (variant_rates & honor_marks; variant_rates
// menggantikan service_rates sejak Task 3, service_rates sendiri dijatuhkan
// Task 5).
//
// Invarian yang dijaga di sini:
//   (a) hanya owner yang bisa menyentuh variant_rates & honor_marks;
//   (b) TIDAK ADA jalur bagi anon/klien/admin/owner (lewat API) untuk mengubah
//       kolom `role` pada profiles — perubahan peran hanya lewat service-role;
//   (c) klien hanya melihat datanya sendiri;
//   (d) anon tidak melihat data klien.

const svc = createAdminSupabase();

type Ids = { owner: string; admin: string; klien: string };
const ids: Ids = { owner: "", admin: "", klien: "" };

async function userIdByEmail(email: string): Promise<string> {
  const { data, error } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`User ${email} belum di-seed (npm run seed:users)`);
  return user.id;
}

async function roleOf(userId: string): Promise<string> {
  const { data, error } = await svc
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data.role as string;
}

beforeAll(async () => {
  ids.owner = await userIdByEmail("owner@padma.test");
  ids.admin = await userIdByEmail("admin@padma.test");
  ids.klien = await userIdByEmail("ananda@padma.test");
});

afterAll(async () => {
  // Jaring pengaman: kembalikan peran seed apa pun hasil percobaan di atas.
  await svc.from("profiles").update({ role: "owner" }).eq("id", ids.owner);
  await svc.from("profiles").update({ role: "admin" }).eq("id", ids.admin);
  await svc.from("profiles").update({ role: "klien" }).eq("id", ids.klien);
});

describe("HARDENING — kolom profiles.role tidak bisa disentuh lewat API", () => {
  it("admin TIDAK bisa menaikkan peran dirinya sendiri menjadi owner", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", ids.admin)
      .select();

    expect(error?.code).toBe("42501");
    expect(data ?? []).toHaveLength(0);
    expect(await roleOf(ids.admin)).toBe("admin");
  });

  it("admin TIDAK bisa menaikkan peran user lain menjadi owner", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", ids.klien)
      .select();

    expect(error?.code).toBe("42501");
    expect(await roleOf(ids.klien)).toBe("klien");
  });

  it("admin TIDAK bisa menurunkan peran owner", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("profiles")
      .update({ role: "klien" })
      .eq("id", ids.owner)
      .select();

    expect(error?.code).toBe("42501");
    expect(await roleOf(ids.owner)).toBe("owner");
  });

  it("admin TIDAK bisa promosi massal lewat filter (role=eq.admin)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("profiles")
      .update({ role: "owner" })
      .eq("role", "admin")
      .select();

    expect(error?.code).toBe("42501");
    expect(await roleOf(ids.admin)).toBe("admin");
  });

  it("klien TIDAK bisa menaikkan peran dirinya sendiri", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", ids.klien)
      .select();

    expect(error?.code).toBe("42501");
    expect(await roleOf(ids.klien)).toBe("klien");
  });

  it("owner pun TIDAK bisa mengubah peran lewat API (hanya service-role)", async () => {
    const owner = await signInAs("owner@padma.test");
    const { error } = await owner
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", ids.admin)
      .select();

    expect(error?.code).toBe("42501");
    expect(await roleOf(ids.admin)).toBe("admin");
  });

  it("anon TIDAK bisa mengubah peran siapa pun", async () => {
    const { error } = await anonClient()
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", ids.admin)
      .select();

    expect(error?.code).toBe("42501");
    expect(await roleOf(ids.admin)).toBe("admin");
  });

  it("admin TIDAK bisa menyisipkan profil baru berperan owner (ditolak RLS/hak, bukan FK)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("profiles")
      .insert({
        id: "99999999-9999-9999-9999-999999999901",
        role: "owner",
        nama: "Penyusup",
      })
      .select();

    // 42501 = ditolak izin/RLS. 23503 (FK) BUKAN pertahanan yang sah:
    // cukup ada baris auth.users yang cocok maka penyisipan akan lolos.
    expect(error?.code).toBe("42501");
  });

  it("admin TIDAK bisa menghapus profil owner", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("profiles")
      .delete()
      .eq("id", ids.owner)
      .select();

    expect(error?.code).toBe("42501");
    const { count } = await svc
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("id", ids.owner);
    expect(count).toBe(1);
  });
});

describe("HARDENING — money firewall tetap utuh setelah percobaan eskalasi", () => {
  it("admin (sesi baru) tetap 0 baris di variant_rates & honor_marks", async () => {
    const admin = await signInAs("admin@padma.test");
    const rates = await admin.from("variant_rates").select("harga_klien,honor_mitra");
    const honor = await admin.from("honor_marks").select("*");
    expect(rates.error).toBeNull();
    expect(rates.data).toHaveLength(0);
    expect(honor.data).toHaveLength(0);
  });

  it("admin tidak bisa menembus lewat embedding services(service_variants(variant_rates))", async () => {
    // Rantai FK berubah sejak Task 3: harga menempel di VARIAN, bukan lagi
    // langsung di layanan (`services -> service_variants -> variant_rates`,
    // dulu `services -> service_rates`). PostgREST mendukung embed BERSARANG
    // sejauh dua lompatan FK — tembusan lewat rantai baru ini karena itu
    // perlu dibuktikan sendiri, bukan diasumsikan tertutup oleh test lama.
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("services")
      .select("nama, service_variants(variant_rates(harga_klien,honor_mitra))")
      .limit(5);
    expect(error).toBeNull();
    const baris = (data ?? []) as { service_variants: { variant_rates: unknown[] }[] }[];
    // Kontrol yang WAJIB dulu: tanpa ini, `service_variants` kosong (bukan
    // tertutup RLS, melainkan memang tidak pernah embed) membuat badan loop di
    // bawah tidak pernah berjalan dan ujinya hijau tanpa menembak jalur
    // berisiko sama sekali — kelemahan yang tidak ada pada versi lama, karena
    // di sana `toHaveLength` atas embed yang gagal melempar, bukan hijau diam.
    expect(baris.length, "services kosong — embed tidak sempat diuji").toBeGreaterThan(0);
    const seluruhVarian = baris.flatMap((row) => row.service_variants);
    expect(
      seluruhVarian.length,
      "service_variants kosong — embed variant_rates tidak sempat diuji",
    ).toBeGreaterThan(0);
    for (const v of seluruhVarian) {
      expect(v.variant_rates).toHaveLength(0);
    }
  });

  it("owner TETAP bisa membaca variant_rates (fungsi tidak ikut rusak)", async () => {
    const owner = await signInAs("owner@padma.test");
    const { data, error } = await owner.from("variant_rates").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });
});

describe("HARDENING — jalur sah & fungsi yang harus tetap jalan", () => {
  it("service-role TETAP bisa mengubah peran (jalur resmi)", async () => {
    const { error: upErr } = await svc
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", ids.klien);
    expect(upErr).toBeNull();
    expect(await roleOf(ids.klien)).toBe("admin");

    const { error: backErr } = await svc
      .from("profiles")
      .update({ role: "klien" })
      .eq("id", ids.klien);
    expect(backErr).toBeNull();
    expect(await roleOf(ids.klien)).toBe("klien");
  });

  it("admin TETAP bisa memperbarui nama profil (kolom non-peran)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("profiles")
      .update({ nama: "Ananda Putri (uji)" })
      .eq("id", ids.klien)
      .select("id, nama");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    await svc.from("profiles").update({ nama: "Ananda Putri" }).eq("id", ids.klien);
    expect(await roleOf(ids.klien)).toBe("klien");
  });

  it("user baru lewat Auth tetap otomatis dapat profil berperan klien", async () => {
    const email = `uji-hardening-${Date.now()}@padma.test`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: "padma-dev-123",
      email_confirm: true,
      user_metadata: { full_name: "Uji Hardening" },
    });
    expect(error).toBeNull();
    const uid = data.user!.id;
    try {
      expect(await roleOf(uid)).toBe("klien");
    } finally {
      await svc.auth.admin.deleteUser(uid);
    }
  });
});

describe("HARDENING — isolasi klien & anon tetap berlaku", () => {
  it("klien hanya melihat profilnya sendiri", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("profiles").select("id");
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(ids.klien);
  });

  it("anon tidak melihat profiles maupun clients", async () => {
    const anon = anonClient();
    const p = await anon.from("profiles").select("*");
    const c = await anon.from("clients").select("*");
    expect(p.data ?? []).toHaveLength(0);
    expect(c.data ?? []).toHaveLength(0);
  });
});
