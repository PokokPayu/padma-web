/**
 * KOLOM PENAUTAN (`clients.user_id`, `clients.linked_at`) TERKUNCI UNTUK PERAN API.
 *
 * Temuan red team (direproduksi lewat REST, bukan teori) — satu-satunya jalur
 * penautan yang masih tersisa TANPA token undangan:
 *
 *   PATCH /rest/v1/clients?id=eq.<rina>
 *   Authorization: Bearer <JWT admin>      (anon key, BUKAN service role)
 *   {"user_id":"<uid penyerang>","linked_at":"2026-08-28T..."}
 *   -> HTTP 200, baris Rina kembali dengan user_id terisi & linked_at terset.
 *
 * Policy `clients: staf` (`for all`, admin/owner) memang dimaksudkan agar staf
 * bisa mengelola data klien — tetapi karena RLS Postgres tidak mengenal
 * pembatasan per-kolom untuk UPDATE, izin itu ikut menyerahkan dua kolom yang
 * BUKAN data operasional melainkan KEPUTUSAN IDENTITAS: akun auth mana yang
 * berhak membaca rekam medis baris klien ini.
 *
 * Akibatnya SELURUH gerbang token dilewati sekaligus: tanpa token undangan,
 * tanpa cek kedaluwarsa, tanpa cek sekali-pakai, dan — yang paling parah —
 * TANPA cek email cocok. Admin (atau akun admin yang di-phishing) bisa
 * mengikat uid penyerang yang emailnya sama sekali berbeda
 * (`penyusup.admin@evil.test`) ke baris Rina; penyerang lalu login sebagai
 * DIRINYA SENDIRI dan membaca rekam medis Rina lewat RLS
 * `clients.user_id = auth.uid()`. `linked_at` ikut terisi sehingga tampak sah,
 * dan `client_invites.used_at/used_by` tetap kosong — tidak ada jejak.
 *
 * Ini juga inkonsistensi kepercayaan: money firewall sudah memperlakukan admin
 * sebagai peran TERBATAS (admin tidak boleh melihat uang), tetapi admin justru
 * boleh menentukan akun mana yang membaca rekam medis klien mana pun.
 *
 * Invarian yang ditegakkan file ini: `clients.user_id` dan `clients.linked_at`
 * HANYA boleh berubah lewat service role di server (yaitu lewat
 * `linkClientByInvite`, yang menuntut token sah + email cocok). Peran API
 * (`anon`, `authenticated`, `authenticator`) — termasuk admin dan owner yang
 * juga login sebagai `authenticated` — ditolak di lapisan DATABASE, bukan di
 * lapisan aplikasi.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createClientInvite, linkClientByInvite } from "@/lib/auth/link-client";
import { TOKEN_UNDANGAN_RINA } from "../scripts/seed-users";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql, dalamTransaksiRollback } from "./helpers/db";
import { varianBaku } from "./helpers/varian";

const svc = createAdminSupabase();
const SANDI = "padma-dev-123";

// Korban: klien seed yang sengaja BELUM tertaut.
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";
const RINA_EMAIL = "rina@padma.test";
const RINA_PADMA_ID = "PAD-2608-0019";
// Kontrol: klien seed yang SUDAH tertaut (tautannya tidak boleh dilepas staf).
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

// Rekam medis korban — bukti kebocoran ditarik sampai baris ini.
const SESI_RAHASIA_ID = "66666666-6666-6666-6666-6666666669b1";
const CATATAN_RAHASIA = "RAHASIA MEDIS ADMIN: preeklampsia ringan, TD 145/95";
const REKOMENDASI_RAHASIA = "rujuk dokter kandungan, kontrol 1 minggu";

// Penyerang: emailnya SAMA SEKALI BEDA dari email klien mana pun. Justru itu
// intinya — gerbang "email harus cocok" tidak pernah dievaluasi pada vektor ini.
const EMAIL_PENYERANG = "penyusup.admin@evil.test";

// Baris klien milik test ini (dibuat & dibuang sendiri → idempoten).
const KLIEN_BARU_ID = "44444444-4444-4444-4444-4444444448c1";
const KLIEN_BARU_PADMA = "PAD-UJI-8901";
const KLIEN_BARU_EMAIL = "uji.kolom@padma.test";

const ids: Record<string, string> = {};

async function hapusUser(email: string) {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users) {
    if (u.email && u.email.toLowerCase() === email.toLowerCase()) {
      await svc.auth.admin.deleteUser(u.id);
    }
  }
}

async function buatUserTerkonfirmasi(email: string): Promise<string> {
  await hapusUser(email);
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: SANDI,
    email_confirm: true,
  });
  if (error) throw new Error(`gagal membuat user uji ${email}: ${error.message}`);
  return data.user!.id;
}

async function barisKlien(id: string) {
  const { data, error } = await svc
    .from("clients")
    .select("id, nama, no_hp, user_id, linked_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as {
    id: string;
    nama: string;
    no_hp: string | null;
    user_id: string | null;
    linked_at: string | null;
  };
}

async function undanganKlien(clientId: string) {
  const { data } = await svc
    .from("client_invites")
    .select("client_id, used_at, used_by, token_hash")
    .eq("client_id", clientId)
    .maybeSingle();
  return data as {
    client_id: string;
    used_at: string | null;
    used_by: string | null;
    token_hash: string | null;
  } | null;
}

/** Apa yang benar-benar terbaca akun ini dari lapisan data (bukan UI). */
async function panenData(email: string) {
  let klien;
  try {
    klien = await signInAs(email);
  } catch {
    return { sesi: false, clients: [], sessions: [], teks: "" };
  }
  const { data: clients } = await klien.from("clients").select("id, nama, no_hp");
  const { data: sessions } = await klien
    .from("sessions")
    .select("catatan, rekomendasi");
  return {
    sesi: true,
    clients: clients ?? [],
    sessions: sessions ?? [],
    teks: JSON.stringify({ clients: clients ?? [], sessions: sessions ?? [] }),
  };
}

/** Tidak sepotong pun rekam medis / PII Rina boleh muncul di panen ini. */
function takAdaJejakRina(panen: { teks: string }) {
  expect(panen.teks).not.toContain("Rina Hapsari");
  expect(panen.teks).not.toContain("0857-0000-1111");
  expect(panen.teks).not.toContain(CATATAN_RAHASIA);
  expect(panen.teks).not.toContain(REKOMENDASI_RAHASIA);
  expect(panen.teks).not.toContain("RAHASIA MEDIS");
}

async function bersihkan() {
  await svc.from("sessions").delete().eq("id", SESI_RAHASIA_ID);
  await svc
    .from("clients")
    .update({ user_id: null, linked_at: null })
    .eq("id", RINA_CLIENT_ID);
  await svc.from("clients").delete().in("id", [KLIEN_BARU_ID]);
  await svc.from("clients").delete().eq("padma_id", KLIEN_BARU_PADMA);
  await hapusUser(EMAIL_PENYERANG);
  await hapusUser(RINA_EMAIL);
  // Nama & no_hp Rina dipulihkan: kontrol positif di bawah mengubahnya.
  await svc
    .from("clients")
    .update({ nama: "Rina Hapsari", no_hp: "0857-0000-1111" })
    .eq("id", RINA_CLIENT_ID);
  await createClientInvite(RINA_CLIENT_ID, { token: TOKEN_UNDANGAN_RINA });
}

beforeAll(async () => {
  await bersihkan();

  const svcRahasia = "11111111-1111-1111-1111-111111111104";
  const { error } = await svc.from("sessions").insert({
    id: SESI_RAHASIA_ID,
    client_id: RINA_CLIENT_ID,
    service_id: svcRahasia,
    variant_id: await varianBaku(svc, svcRahasia),
    partner_id: "33333333-3333-3333-3333-333333333301",
    tanggal: "2026-08-21",
    status: "selesai",
    catatan: CATATAN_RAHASIA,
    rekomendasi: REKOMENDASI_RAHASIA,
  });
  if (error) throw error;

  ids.penyerang = await buatUserTerkonfirmasi(EMAIL_PENYERANG);
});

afterAll(bersihkan);

describe("VEKTOR admin/owner: penautan tanpa token lewat PATCH clients.user_id", () => {
  for (const peran of ["admin", "owner"] as const) {
    it(`${peran} PATCH clients.user_id korban DITOLAK database (42501) dan baris tetap NULL`, async () => {
      const staf = await signInAs(`${peran}@padma.test`);
      const { data, error } = await staf
        .from("clients")
        .update({
          user_id: ids.penyerang,
          linked_at: new Date().toISOString(),
        })
        .eq("id", RINA_CLIENT_ID)
        .select("id, user_id, linked_at");

      // Ditolak, bukan "0 baris diam-diam": penolakan eksplisit dari DB.
      expect(error, `${peran} seharusnya ditolak, bukan berhasil`).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(data ?? []).toEqual([]);

      // Baris korban benar-benar tidak berubah.
      const rina = await barisKlien(RINA_CLIENT_ID);
      expect(rina.user_id).toBeNull();
      expect(rina.linked_at).toBeNull();
    });
  }

  it("penyerang (email beda) tetap tidak membaca PII maupun rekam medis Rina", async () => {
    const panen = await panenData(EMAIL_PENYERANG);
    expect(panen.sesi).toBe(true); // akunnya memang hidup — temboknya bukan login gagal
    expect(panen.clients).toEqual([]);
    expect(panen.sessions).toEqual([]);
    takAdaJejakRina(panen);
  });

  it("admin PATCH linked_at SAJA juga ditolak (tidak ada jejak tautan palsu)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("clients")
      .update({ linked_at: new Date().toISOString() })
      .eq("id", RINA_CLIENT_ID)
      .select("id");
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect((await barisKlien(RINA_CLIENT_ID)).linked_at).toBeNull();
  });

  it("admin tidak bisa MELEPAS tautan klien yang sudah sah (user_id -> null)", async () => {
    const sebelum = await barisKlien(ANANDA_CLIENT_ID);
    expect(sebelum.user_id).not.toBeNull(); // kontrol: memang tertaut

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("clients")
      .update({ user_id: null, linked_at: null })
      .eq("id", ANANDA_CLIENT_ID)
      .select("id");
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");

    const sesudah = await barisKlien(ANANDA_CLIENT_ID);
    expect(sesudah.user_id).toBe(sebelum.user_id);
    expect(sesudah.linked_at).toBe(sebelum.linked_at);
  });

  it("admin tidak bisa memindahkan tautan klien tertaut ke uid lain", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("clients")
      .update({ user_id: ids.penyerang })
      .eq("id", ANANDA_CLIENT_ID)
      .select("id");
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect((await barisKlien(ANANDA_CLIENT_ID)).user_id).not.toBe(ids.penyerang);
  });

  it("admin tidak bisa menyelipkan user_id lewat INSERT baris klien baru", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("clients")
      .insert({
        id: KLIEN_BARU_ID,
        padma_id: KLIEN_BARU_PADMA,
        nama: "Uji Kolom Tautan",
        email: KLIEN_BARU_EMAIL,
        no_hp: "0800-0000-8901",
        phase_id: "kehamilan",
        user_id: ids.penyerang,
      })
      .select("id");
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");

    const { data } = await svc
      .from("clients")
      .select("id")
      .eq("padma_id", KLIEN_BARU_PADMA);
    expect(data ?? []).toEqual([]);
  });

  it("admin tidak bisa menembus lewat UPSERT (POST resolution=merge-duplicates)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.from("clients").upsert(
      {
        id: RINA_CLIENT_ID,
        padma_id: RINA_PADMA_ID,
        nama: "Rina Hapsari",
        email: RINA_EMAIL,
        no_hp: "0857-0000-1111",
        phase_id: "kehamilan",
        user_id: ids.penyerang,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "padma_id" },
    );
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");

    const rina = await barisKlien(RINA_CLIENT_ID);
    expect(rina.user_id).toBeNull();
    expect(rina.linked_at).toBeNull();
  });

  it("klien biasa pun tidak bisa mengisi user_id (dua lapis: RLS lalu trigger)", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien
      .from("clients")
      .update({ user_id: ids.penyerang })
      .eq("id", RINA_CLIENT_ID)
      .select("id");
    expect(data ?? []).toEqual([]);
    expect((await barisKlien(RINA_CLIENT_ID)).user_id).toBeNull();

    // Barisnya sendiri juga tidak bisa dialihkan ke uid lain.
    const { data: sendiri } = await klien
      .from("clients")
      .update({ user_id: ids.penyerang })
      .eq("id", ANANDA_CLIENT_ID)
      .select("id");
    expect(sendiri ?? []).toEqual([]);
    expect((await barisKlien(ANANDA_CLIENT_ID)).user_id).not.toBe(ids.penyerang);
  });

  it("anon tidak bisa menyentuh kolom penautan sama sekali", async () => {
    const { error } = await anonClient()
      .from("clients")
      .update({ user_id: ids.penyerang })
      .eq("id", RINA_CLIENT_ID)
      .select("id");
    expect(error).not.toBeNull();
    expect((await barisKlien(RINA_CLIENT_ID)).user_id).toBeNull();
  });

  it("tidak ada jejak palsu: client_invites Rina tetap belum terpakai", async () => {
    const undangan = await undanganKlien(RINA_CLIENT_ID);
    expect(undangan).not.toBeNull();
    expect(undangan!.used_at).toBeNull();
    expect(undangan!.used_by).toBeNull();
    expect(undangan!.token_hash).not.toBeNull();
  });
});

describe("penjagaan ada di DATABASE, bukan di aplikasi", () => {
  it("koneksi SQL langsung sebagai peran `authenticated` juga ditolak", async () => {
    // Bila kredensial pooler `authenticated` bocor, penyerang tidak lewat
    // PostgREST sama sekali. Penjagaan harus tetap menyala di sana.
    const hasil = await dalamTransaksiRollback(async (jalankan) => {
      const [{ id: adminId }] = (await jalankan(
        `select id from public.profiles where role = 'admin' limit 1`,
      )) as { id: string }[];
      await jalankan(`set local role authenticated`);
      await jalankan(
        `select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [adminId],
      );
      // Kontrol positif: sebagai admin, RLS memang meloloskan baris ini —
      // jadi 0-baris di bawah bukan karena barisnya tak terlihat.
      const terlihat = await jalankan(
        `select id from public.clients where id = $1`,
        [RINA_CLIENT_ID],
      );
      try {
        await jalankan(
          `update public.clients set user_id = $1 where id = $2`,
          [adminId, RINA_CLIENT_ID],
        );
        return { terlihat: terlihat.length, kode: null as string | null };
      } catch (e) {
        return {
          terlihat: terlihat.length,
          kode: (e as { code?: string }).code ?? "tanpa-kode",
        };
      }
    });
    expect(hasil.terlihat).toBe(1);
    expect(hasil.kode).toBe("42501");
  });

  it("trigger penjaga terpasang pada clients: BEFORE INSERT+UPDATE, per baris, bukan SECURITY DEFINER", async () => {
    const rows = await querySql<{
      tgname: string;
      tgenabled: string;
      before: boolean;
      per_baris: boolean;
      insert_update: boolean;
      prosecdef: boolean;
    }>(
      `select t.tgname,
              t.tgenabled,
              (t.tgtype & 2) <> 0            as before,
              (t.tgtype & 1) <> 0            as per_baris,
              (t.tgtype & 4) <> 0 and (t.tgtype & 16) <> 0 as insert_update,
              p.prosecdef
         from pg_trigger t
         join pg_proc p on p.oid = t.tgfoid
         join pg_class c on c.oid = t.tgrelid
        where c.relname = 'clients'
          and not t.tgisinternal
          and p.proname = 'guard_client_link'`,
    );
    expect(rows.length).toBe(1);
    const t = rows[0];
    expect(t.tgenabled).toBe("O"); // menyala pada mode replikasi normal
    expect(t.before).toBe(true); // menolak SEBELUM baris tersentuh
    expect(t.per_baris).toBe(true);
    expect(t.insert_update).toBe(true);
    // SECURITY DEFINER akan membuat current_user menjadi pemilik fungsi,
    // sehingga penjagaan "hanya service role" tidak bisa dibedakan lagi.
    expect(t.prosecdef).toBe(false);
  });

  it("komentar kolom menyatakan invariannya (agar tidak dilonggarkan tanpa sadar)", async () => {
    const rows = await querySql<{ kolom: string; komentar: string | null }>(
      `select a.attname as kolom, col_description(a.attrelid, a.attnum) as komentar
         from pg_attribute a
        where a.attrelid = 'public.clients'::regclass
          and a.attname in ('user_id', 'linked_at')`,
    );
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.komentar, `kolom ${r.kolom} wajib punya komentar invarian`).toBeTruthy();
      expect(r.komentar!.toLowerCase()).toContain("service");
    }
  });
});

describe("yang SAH tetap hidup (bukan tembok buta)", () => {
  it("admin tetap bisa mengelola kolom operasional klien", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("clients")
      .update({ nama: "Rina Hapsari (koreksi admin)", no_hp: "0857-0000-2222" })
      .eq("id", RINA_CLIENT_ID)
      .select("id, nama, no_hp");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(data![0].nama).toBe("Rina Hapsari (koreksi admin)");

    // Menyertakan user_id/linked_at dengan nilai YANG SAMA tidak dianggap
    // perubahan — penjagaan mengikat perubahan nilai, bukan sekadar kehadiran
    // kolom di payload (panel admin boleh mengirim baris utuh).
    const { error: errUtuh } = await admin
      .from("clients")
      .update({ nama: "Rina Hapsari", user_id: null, linked_at: null })
      .eq("id", RINA_CLIENT_ID)
      .select("id");
    expect(errUtuh).toBeNull();

    await svc
      .from("clients")
      .update({ nama: "Rina Hapsari", no_hp: "0857-0000-1111" })
      .eq("id", RINA_CLIENT_ID);
  });

  it("admin tetap bisa membuat baris klien baru (tanpa kolom penautan)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("clients")
      .insert({
        id: KLIEN_BARU_ID,
        padma_id: KLIEN_BARU_PADMA,
        nama: "Uji Kolom Tautan",
        email: KLIEN_BARU_EMAIL,
        no_hp: "0800-0000-8901",
        phase_id: "kehamilan",
      })
      .select("id, user_id, linked_at");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(data![0].user_id).toBeNull();
    expect(data![0].linked_at).toBeNull();
    await svc.from("clients").delete().eq("id", KLIEN_BARU_ID);
  });

  it("jalur resmi tetap menautkan: service role + token undangan sah", async () => {
    const rinaId = await buatUserTerkonfirmasi(RINA_EMAIL);
    expect(await linkClientByInvite(rinaId, RINA_EMAIL, TOKEN_UNDANGAN_RINA)).toBe(
      true,
    );
    const rina = await barisKlien(RINA_CLIENT_ID);
    expect(rina.user_id).toBe(rinaId);
    expect(rina.linked_at).not.toBeNull();

    // Kontrol positif akhir: pemilik sahnya benar-benar membaca datanya.
    const panen = await panenData(RINA_EMAIL);
    expect(panen.sesi).toBe(true);
    expect(panen.clients.map((c) => c.nama)).toEqual(["Rina Hapsari"]);
    expect(panen.teks).toContain(CATATAN_RAHASIA);

    // ...dan penyerang tetap tidak, walau barisnya kini tertaut.
    takAdaJejakRina(await panenData(EMAIL_PENYERANG));
  });
});
