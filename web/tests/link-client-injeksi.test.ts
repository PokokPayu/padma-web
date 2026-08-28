/**
 * Regresi keamanan: penautan akun klien TIDAK BOLEH memakai pencocokan pola,
 * dan pencocokan email — sepersis apa pun — TIDAK PERNAH cukup sendirian.
 *
 * Celah asal (1): linkClientByEmail memakai `.ilike("email", email)` yang oleh
 * PostgREST diterjemahkan ke SQL LIKE, sehingga karakter `%` dan `_` di dalam
 * email penyerang menjadi WILDCARD. Karena pendaftaran mandiri terbuka,
 * penyerang cukup mendaftar dengan email `%@padma.test` untuk menautkan akunnya
 * ke baris klien orang lain — lalu membaca nama, no. HP, dan (lewat RLS
 * `clients.user_id = auth.uid()`) catatan sesi & rekomendasi: data kesehatan
 * pasien, ranah UU PDP.
 *
 * Celah asal (2): pencocokan persis `.eq()` menutup wildcard, tapi tetap
 * bersandar pada asumsi bahwa email yang dipakai login benar-benar milik orang
 * itu. `enable_confirmations = false` membuat asumsi itu bohong — menebak
 * alamat email sudah cukup untuk merebut rekam medis.
 *
 * Karena keamanannya menguat, tuntutan test ini ikut diperkuat: setiap skenario
 * pola kini diberi TOKEN UNDANGAN YANG SAH milik korban (posisi penyerang
 * terkuat yang masih masuk akal) dan tetap harus GAGAL, karena email harus
 * cocok persis juga. Perilaku sah — beda kapitalisasi tetap tertaut — tetap
 * dijaga, sekarang lewat jalur bertoken.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  createClientInvite,
  linkClientByInvite,
  isClientLinked,
} from "@/lib/auth/link-client";
import { TOKEN_UNDANGAN_RINA } from "../scripts/seed-users";

const admin = createAdminSupabase();

// Baris klien milik seed (bahan test penautan, belum tertaut).
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";
// Klien seed yang SUDAH tertaut ke user ananda@padma.test.
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

// Baris klien khusus test ini (dibuat & dibuang sendiri agar idempoten).
const KLIEN_KAPITAL_ID = "44444444-4444-4444-4444-4444444449a1";
const KLIEN_KECIL_ID = "44444444-4444-4444-4444-4444444449a2";
const EMAIL_KAPITAL_TERSIMPAN = "Uji.Kapital@Padma.test"; // huruf besar saat disimpan
const EMAIL_KAPITAL_LOGIN = "uji.kapital@padma.test"; // user login huruf kecil
const EMAIL_KECIL_TERSIMPAN = "uji.kecil@padma.test"; // huruf kecil saat disimpan
const EMAIL_KECIL_LOGIN = "Uji.Kecil@Padma.test"; // user login huruf besar

// Email penyerang: pola LIKE, bukan email siapa pun.
const EMAIL_WILDCARD = "%@padma.test";
const EMAIL_UNDERSCORE = "rin_@padma.test"; // `_` = sembarang karakter → cocok "rina@..."

const userIds: Record<string, string> = {};
const clientIdsUji = [KLIEN_KAPITAL_ID, KLIEN_KECIL_ID];

async function buatUser(email: string): Promise<string> {
  // Sengaja lewat pendaftaran mandiri seperti penyerang sungguhan
  // (config.toml: enable_signup = true).
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "padma-dev-123",
    email_confirm: true,
  });
  if (error) throw new Error(`gagal membuat user uji ${email}: ${error.message}`);
  return data.user!.id;
}

async function userIdKlienSeed(email: string): Promise<string> {
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`user seed ${email} tidak ditemukan`);
  return user.id;
}

/** Token undangan SAH milik korban — penyerang diberi posisi terkuat. */
async function tokenKorban(clientId: string): Promise<string> {
  const { token } = await createClientInvite(clientId);
  return token;
}

async function bersihkan() {
  await admin.from("clients").delete().in("id", clientIdsUji);
  await admin
    .from("clients")
    .update({ user_id: null, linked_at: null })
    .eq("id", RINA_CLIENT_ID);
  await createClientInvite(RINA_CLIENT_ID, { token: TOKEN_UNDANGAN_RINA });
  const { data } = await admin.auth.admin.listUsers();
  for (const u of data.users) {
    if (
      u.email &&
      [
        EMAIL_WILDCARD,
        EMAIL_UNDERSCORE,
        EMAIL_KAPITAL_LOGIN,
        EMAIL_KECIL_LOGIN.toLowerCase(),
      ].includes(u.email.toLowerCase())
    ) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

beforeAll(async () => {
  // Sisa run sebelumnya (bila ada) dibersihkan dulu → test idempoten.
  await bersihkan();

  const { error } = await admin.from("clients").insert([
    {
      id: KLIEN_KAPITAL_ID,
      padma_id: "PAD-UJI-9001",
      nama: "Uji Kapital",
      email: EMAIL_KAPITAL_TERSIMPAN,
      no_hp: "0800-0000-0001",
      phase_id: "kehamilan",
      user_id: null,
    },
    {
      id: KLIEN_KECIL_ID,
      padma_id: "PAD-UJI-9002",
      nama: "Uji Kecil",
      email: EMAIL_KECIL_TERSIMPAN,
      no_hp: "0800-0000-0002",
      phase_id: "kehamilan",
      user_id: null,
    },
  ]);
  if (error) throw error;

  userIds.wildcard = await buatUser(EMAIL_WILDCARD);
  userIds.underscore = await buatUser(EMAIL_UNDERSCORE);
  userIds.kapital = await buatUser(EMAIL_KAPITAL_LOGIN);
  userIds.kecil = await buatUser(EMAIL_KECIL_LOGIN);
  userIds.ananda = await userIdKlienSeed("ananda@padma.test");
});

afterAll(bersihkan);

describe("penautan klien kebal pola LIKE", () => {
  it("email `%@padma.test` tidak menautkan klien mana pun (walau tokennya sah)", async () => {
    const token = await tokenKorban(RINA_CLIENT_ID);
    const linked = await linkClientByInvite(userIds.wildcard, EMAIL_WILDCARD, token);
    expect(linked).toBe(false);

    const { data: tertaut } = await admin
      .from("clients")
      .select("id, padma_id")
      .eq("user_id", userIds.wildcard);
    expect(tertaut ?? []).toEqual([]);

    const { data: rina } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", RINA_CLIENT_ID)
      .single();
    expect(rina!.user_id).toBeNull();

    // Token korban yang gagal dipakai penyerang tidak boleh ikut hangus —
    // pemilik sahnya masih harus bisa memakainya (dibuktikan sampai penautan
    // sungguhan di tests/penautan-undangan.test.ts).
    const { data: undangan } = await admin
      .from("client_invites")
      .select("used_at")
      .eq("client_id", RINA_CLIENT_ID)
      .single();
    expect(undangan!.used_at).toBeNull();
    expect(token.length).toBeGreaterThan(0);
  });

  it("email berisi `_` tidak salah menautkan klien lain (walau tokennya sah)", async () => {
    const token = await tokenKorban(RINA_CLIENT_ID);
    const linked = await linkClientByInvite(
      userIds.underscore,
      EMAIL_UNDERSCORE,
      token,
    );
    expect(linked).toBe(false);

    const { data: rina } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", RINA_CLIENT_ID)
      .single();
    expect(rina!.user_id).toBeNull();
  });

  it("pengenalan user yang sudah tertaut tidak lagi bersandar pada email sama sekali", async () => {
    // Dulu ada fallback "sudah tertaut" berbasis email; itu pun harus kebal
    // pola. Sekarang lebih kuat: pengenalan memakai `user_id` (identitas yang
    // sudah dibuktikan token), jadi email apa pun — pola atau bukan — tidak
    // bisa dipakai mengklaim status tertaut.
    expect(
      await linkClientByInvite(userIds.ananda, EMAIL_WILDCARD, await tokenKorban(ANANDA_CLIENT_ID)),
    ).toBe(false);
    expect(
      await linkClientByInvite(userIds.ananda, "anand_@padma.test", await tokenKorban(ANANDA_CLIENT_ID)),
    ).toBe(false);
    // Bahkan dengan email aslinya + token sah: barisnya sudah tertaut, jadi
    // tidak ada penautan ulang (dan karenanya tidak ada jalur perebutan).
    expect(
      await linkClientByInvite(userIds.ananda, "ananda@padma.test", await tokenKorban(ANANDA_CLIENT_ID)),
    ).toBe(false);
    // Yang menyatakan "sudah tertaut" adalah user_id, bukan email.
    expect(await isClientLinked(userIds.ananda)).toBe(true);
    expect(await isClientLinked(userIds.wildcard)).toBe(false);

    const { data: ananda } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", ANANDA_CLIENT_ID)
      .single();
    expect(ananda!.user_id).toBe(userIds.ananda);
  });

  it("perilaku sah tetap jalan: beda kapitalisasi tetap tertaut (klien huruf besar)", async () => {
    const token = await tokenKorban(KLIEN_KAPITAL_ID);
    const linked = await linkClientByInvite(
      userIds.kapital,
      EMAIL_KAPITAL_LOGIN,
      token,
    );
    expect(linked).toBe(true);

    const { data: klien } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", KLIEN_KAPITAL_ID)
      .single();
    expect(klien!.user_id).toBe(userIds.kapital);

    // Login kedua kalinya tidak perlu token lagi — dan token lama sudah mati.
    expect(await isClientLinked(userIds.kapital)).toBe(true);
    expect(
      await linkClientByInvite(userIds.kapital, EMAIL_KAPITAL_LOGIN, token),
    ).toBe(false);
  });

  it("perilaku sah tetap jalan: input huruf besar atas klien huruf kecil", async () => {
    const token = await tokenKorban(KLIEN_KECIL_ID);
    const linked = await linkClientByInvite(userIds.kecil, EMAIL_KECIL_LOGIN, token);
    expect(linked).toBe(true);

    const { data: klien } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", KLIEN_KECIL_ID)
      .single();
    expect(klien!.user_id).toBe(userIds.kecil);
  });

  it("email klien disimpan ternormalisasi (huruf kecil) agar `=` selalu setara lower()", async () => {
    const { data: klien } = await admin
      .from("clients")
      .select("email")
      .eq("id", KLIEN_KAPITAL_ID)
      .single();
    expect(klien!.email).toBe(EMAIL_KAPITAL_LOGIN);
  });

  it("email kosong tidak menautkan apa pun (walau tokennya sah)", async () => {
    const token = await tokenKorban(RINA_CLIENT_ID);
    expect(await linkClientByInvite(userIds.wildcard, "", token)).toBe(false);
    expect(await linkClientByInvite(userIds.wildcard, "   ", token)).toBe(false);

    const { data: rina } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", RINA_CLIENT_ID)
      .single();
    expect(rina!.user_id).toBeNull();
  });
});
