/**
 * Regresi keamanan: penautan akun klien TIDAK BOLEH memakai pencocokan pola.
 *
 * Celah asal: linkClientByEmail memakai `.ilike("email", email)` yang oleh
 * PostgREST diterjemahkan ke SQL LIKE, sehingga karakter `%` dan `_` di dalam
 * email penyerang menjadi WILDCARD. Karena pendaftaran mandiri terbuka,
 * penyerang cukup mendaftar dengan email `%@padma.test` untuk menautkan akunnya
 * ke baris klien orang lain — lalu membaca nama, no. HP, dan (lewat RLS
 * `clients.user_id = auth.uid()`) catatan sesi & rekomendasi: data kesehatan
 * pasien, ranah UU PDP.
 *
 * Test ini mengunci: pencocokan email harus PERSIS, tapi tetap tidak peduli
 * kapitalisasi.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { linkClientByEmail } from "@/lib/auth/link-client";

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
  // (config.toml: enable_signup = true, enable_confirmations = false).
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

async function bersihkan() {
  await admin.from("clients").delete().in("id", clientIdsUji);
  await admin.from("clients").update({ user_id: null }).eq("id", RINA_CLIENT_ID);
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
  it("email `%@padma.test` tidak menautkan klien mana pun", async () => {
    const linked = await linkClientByEmail(userIds.wildcard, EMAIL_WILDCARD);
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
  });

  it("email berisi `_` tidak salah menautkan klien lain", async () => {
    const linked = await linkClientByEmail(userIds.underscore, EMAIL_UNDERSCORE);
    expect(linked).toBe(false);

    const { data: rina } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", RINA_CLIENT_ID)
      .single();
    expect(rina!.user_id).toBeNull();
  });

  it("fallback 'sudah tertaut' juga kebal pola (user tertaut tidak lolos lewat wildcard)", async () => {
    // Ananda sudah tertaut ke kliennya sendiri. Memanggil dengan email pola
    // yang BUKAN emailnya tidak boleh dianggap sukses.
    expect(await linkClientByEmail(userIds.ananda, EMAIL_WILDCARD)).toBe(false);
    expect(await linkClientByEmail(userIds.ananda, "anand_@padma.test")).toBe(false);
    // Kontrol positif: email aslinya tetap sukses lewat fallback.
    expect(await linkClientByEmail(userIds.ananda, "ananda@padma.test")).toBe(true);

    const { data: ananda } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", ANANDA_CLIENT_ID)
      .single();
    expect(ananda!.user_id).toBe(userIds.ananda);
  });

  it("perilaku sah tetap jalan: beda kapitalisasi tetap tertaut (klien huruf besar)", async () => {
    const linked = await linkClientByEmail(userIds.kapital, EMAIL_KAPITAL_LOGIN);
    expect(linked).toBe(true);

    const { data: klien } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", KLIEN_KAPITAL_ID)
      .single();
    expect(klien!.user_id).toBe(userIds.kapital);

    // Login kedua kalinya (fallback) tetap sukses.
    expect(await linkClientByEmail(userIds.kapital, EMAIL_KAPITAL_LOGIN)).toBe(true);
  });

  it("perilaku sah tetap jalan: input huruf besar atas klien huruf kecil", async () => {
    const linked = await linkClientByEmail(userIds.kecil, EMAIL_KECIL_LOGIN);
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

  it("email kosong tidak menautkan apa pun", async () => {
    expect(await linkClientByEmail(userIds.wildcard, "")).toBe(false);
  });
});
