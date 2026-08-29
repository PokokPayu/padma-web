/**
 * PENAUTAN AKUN KLIEN WAJIB TOKEN UNDANGAN SEKALI-PAKAI.
 *
 * Eksploit yang direproduksi (bukan teori) sebelum perbaikan ini:
 *   1. penyerang self-signup dengan email klien yang belum tertaut
 *      (`rina@padma.test`) → BERHASIL, dan karena
 *      `[auth.email] enable_confirmations = false` GoTrue meng-auto-confirm
 *      email itu TANPA bukti kepemilikan apa pun;
 *   2. `linkClientByEmail()` mencocokkan email → mengisi `clients.user_id`
 *      dengan id penyerang;
 *   3. penyerang membaca PII klien: [{"nama":"Rina Hapsari","no_hp":"0857-..."}];
 *   4. penyerang membaca REKAM MEDIS lewat RLS `clients.user_id = auth.uid()`:
 *      [{"catatan":"RAHASIA MEDIS: riwayat keguguran 2024, TD 130/85", ...}].
 *
 * Akar masalahnya BUKAN cara mencocokkan email (pencocokan persis `.eq()` dari
 * perbaikan sebelumnya sudah benar), melainkan ASUMSI bahwa email yang dipakai
 * login benar-benar milik orang itu. Menebak alamat email bukan otentikasi.
 *
 * Karena itu penautan sekarang digerbangi TOKEN UNDANGAN: rahasia acak
 * kriptografis yang dibuat server saat admin membuat data klien, dikirim lewat
 * kanal terpisah (pesan sambutan WhatsApp — sudah ada di spec bagian 4),
 * berumur terbatas, dan sekali pakai. Pencocokan email tetap dipertahankan
 * sebagai syarat KEDUA (token DAN email harus sepakat), tetapi email saja tidak
 * pernah cukup.
 *
 * Bukti di test ini ditarik sampai LAPISAN DATA (query PostgREST sebagai user
 * penyerang), bukan hanya nilai balik fungsi penautan.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  createClientInvite,
  linkClientByInvite,
  generateInviteToken,
  normalizeEmail,
  type OpsiUndangan,
} from "@/lib/auth/link-client";
import * as modulPenautan from "@/lib/auth/link-client";
import { TOKEN_UNDANGAN_RINA } from "../scripts/seed-users";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

const svc = createAdminSupabase();
const SANDI = "padma-dev-123";

// Korban: klien seed yang sengaja BELUM tertaut (bahan test penautan).
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";
const RINA_EMAIL = "rina@padma.test";
// Klien seed yang SUDAH tertaut (kontrol: tokennya tidak boleh dipakai lagi).
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

// Sesi berisi rekam medis milik Rina — persis data yang bocor di eksploit.
const SESI_RAHASIA_ID = "66666666-6666-6666-6666-6666666669a1";
const CATATAN_RAHASIA = "RAHASIA MEDIS: riwayat keguguran 2024, TD 130/85";
const REKOMENDASI_RAHASIA = "Fe + folat, kontrol 2 minggu";

// Baris klien milik test ini (dibuat & dibuang sendiri → idempoten).
const KLIEN_UJI_ID = "44444444-4444-4444-4444-4444444448b1";
const KLIEN_UJI_EMAIL = "uji.undangan@padma.test";
const KLIEN_KADALUARSA_ID = "44444444-4444-4444-4444-4444444448b2";
const KLIEN_KADALUARSA_EMAIL = "uji.kadaluarsa@padma.test";

const EMAIL_PENYUSUP = "penyusup@padma.test";
const EMAIL_PENYUSUP2 = "penyusup2@padma.test";
const EMAIL_UJI_TOKEN = "uji.token@padma.test";

const EMAIL_UJI = [
  RINA_EMAIL,
  KLIEN_UJI_EMAIL,
  KLIEN_KADALUARSA_EMAIL,
  EMAIL_PENYUSUP,
  EMAIL_PENYUSUP2,
  EMAIL_UJI_TOKEN,
];
const KLIEN_UJI_IDS = [KLIEN_UJI_ID, KLIEN_KADALUARSA_ID];

const ids: Record<string, string> = {};

async function buatUserTerkonfirmasi(email: string): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: SANDI,
    email_confirm: true,
  });
  if (error) throw new Error(`gagal membuat user uji ${email}: ${error.message}`);
  return data.user!.id;
}

async function hapusUser(email: string) {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users) {
    if (u.email && u.email.toLowerCase() === email.toLowerCase()) {
      await svc.auth.admin.deleteUser(u.id);
    }
  }
}

/**
 * Menerbitkan undangan DAN memastikan penerbitannya tidak ditolak.
 *
 * `createClientInvite` kini menolak penerbitan untuk baris klien yang sudah
 * tertaut (upsert-nya mengosongkan `used_at`/`used_by` — catatan siapa
 * mengaktifkan akun itu). Penolakan yang lewat begitu saja akan membuat token
 * bernilai `undefined` mengalir ke assertion negatif dan test lulus tanpa
 * menguji apa pun; di sini ia menjadi kegagalan yang berisik.
 */
async function terbitkan(clientId: string, opsi?: OpsiUndangan) {
  const hasil = await createClientInvite(clientId, opsi);
  if (!hasil.ok) throw new Error(`penerbitan undangan ditolak: ${hasil.alasan}`);
  return hasil;
}

async function barisKlien(id: string) {
  const { data, error } = await svc
    .from("clients")
    .select("id, user_id, linked_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as { id: string; user_id: string | null; linked_at: string | null };
}

/**
 * Apa yang benar-benar bisa dibaca user ini dari lapisan data (bukan UI).
 *
 * Login yang ditolak dianggap panen KOSONG, bukan error test: itu justru hasil
 * yang lebih kuat (mis. saat `enable_confirmations = true` menolak akun
 * self-signup yang belum membuktikan kepemilikan email). Dengan begitu test ini
 * berlaku sama untuk kedua setelan konfirmasi email.
 */
async function panenData(email: string) {
  let klien;
  try {
    klien = await signInAs(email);
  } catch {
    return { clients: [], sessions: [], sesi: false };
  }
  const { data: clients } = await klien.from("clients").select("id, nama, no_hp");
  const { data: sessions } = await klien
    .from("sessions")
    .select("catatan, rekomendasi");
  return { clients: clients ?? [], sessions: sessions ?? [], sesi: true };
}

async function bersihkan() {
  await svc.from("sessions").delete().eq("id", SESI_RAHASIA_ID);
  await svc
    .from("clients")
    .update({ user_id: null, linked_at: null })
    .eq("id", RINA_CLIENT_ID);
  await svc.from("clients").delete().in("id", KLIEN_UJI_IDS);
  for (const email of EMAIL_UJI) await hapusUser(email);
  // Undangan yang diterbitkan paksa untuk Ananda (baris yang SUDAH tertaut)
  // dibuang: klien aktif tidak boleh meninggalkan undangan hidup di basis data
  // hanya karena sebuah test pernah membutuhkannya.
  await svc.from("client_invites").delete().eq("client_id", ANANDA_CLIENT_ID);
  // Token undangan seed Rina dipulihkan agar run berikutnya berangkat dari
  // keadaan yang sama (test wajib idempoten).
  await terbitkan(RINA_CLIENT_ID, { token: TOKEN_UNDANGAN_RINA });
}

beforeAll(async () => {
  await bersihkan();

  // Rekam medis korban — bukti kebocoran ditarik sampai baris ini.
  const { error: sErr } = await svc.from("sessions").insert({
    id: SESI_RAHASIA_ID,
    client_id: RINA_CLIENT_ID,
    service_id: "11111111-1111-1111-1111-111111111104",
    partner_id: "33333333-3333-3333-3333-333333333301",
    tanggal: "2026-08-20",
    status: "selesai",
    catatan: CATATAN_RAHASIA,
    rekomendasi: REKOMENDASI_RAHASIA,
  });
  if (sErr) throw sErr;

  const { error: cErr } = await svc.from("clients").insert([
    {
      id: KLIEN_UJI_ID,
      padma_id: "PAD-UJI-8801",
      nama: "Uji Undangan",
      email: KLIEN_UJI_EMAIL,
      no_hp: "0800-0000-8801",
      phase_id: "kehamilan",
      user_id: null,
    },
    {
      id: KLIEN_KADALUARSA_ID,
      padma_id: "PAD-UJI-8802",
      nama: "Uji Kadaluarsa",
      email: KLIEN_KADALUARSA_EMAIL,
      no_hp: "0800-0000-8802",
      phase_id: "kehamilan",
      user_id: null,
    },
  ]);
  if (cErr) throw cErr;
});

afterAll(bersihkan);

describe("EKSPLOIT — self-signup dengan email klien tidak lagi merebut rekam medis", () => {
  it("penyerang self-signup memakai email klien: akun terbuat, rekam klien TIDAK tertaut", async () => {
    // Langkah 1 eksploit, apa adanya: pendaftaran mandiri lewat anon key.
    const anon = anonClient();
    const { data: daftar, error: errDaftar } = await anon.auth.signUp({
      email: RINA_EMAIL,
      password: SANDI,
    });
    expect(errDaftar).toBeNull();
    const penyerangId = daftar.user!.id;
    ids.penyerang = penyerangId;

    // Langkah 2 eksploit HARUS mati: tidak ada satu pun jalur di aplikasi yang
    // menautkan hanya karena emailnya cocok.
    const rina = await barisKlien(RINA_CLIENT_ID);
    expect(rina.user_id).toBeNull();
    expect(rina.linked_at).toBeNull();

    const { data: tertaut } = await svc
      .from("clients")
      .select("id")
      .eq("user_id", penyerangId);
    expect(tertaut ?? []).toEqual([]);
  });

  it("langkah 3 & 4 eksploit mati di lapisan data: PII & rekam medis tidak terbaca", async () => {
    const panen = await panenData(RINA_EMAIL);
    expect(panen.clients).toEqual([]);
    expect(panen.sessions).toEqual([]);
    // Ikat ke isi rekam medisnya, bukan hanya ke jumlah baris.
    const semua = JSON.stringify(panen);
    expect(semua).not.toContain("Rina Hapsari");
    expect(semua).not.toContain("0857-0000-1111");
    expect(semua).not.toContain("RAHASIA MEDIS");
    expect(semua).not.toContain(REKOMENDASI_RAHASIA);
  });

  it("jalur penautan by email semata sudah TIDAK ADA lagi di API", () => {
    // Regresi struktural: selama fungsi lama masih diekspor, ia bisa dipanggil
    // lagi dari rute baru dan celahnya kambuh.
    expect(Object.keys(modulPenautan)).not.toContain("linkClientByEmail");
    expect(Object.keys(modulPenautan)).toContain("linkClientByInvite");
  });

  it("penyerang yang tahu email korban tetap kandas menebak token", async () => {
    const tebakan = [
      "",
      "   ",
      generateInviteToken(), // token acak sah-bentuk, bukan milik siapa pun
      TOKEN_UNDANGAN_RINA.slice(0, -1) + "X", // beda satu karakter
      TOKEN_UNDANGAN_RINA.toUpperCase(),
      "%", // pola LIKE, regresi celah sebelumnya
      "' or '1'='1",
    ];
    for (const token of tebakan) {
      expect(
        await linkClientByInvite(ids.penyerang, RINA_EMAIL, token),
        `token "${token}" seharusnya ditolak`,
      ).toBe(false);
    }

    const rina = await barisKlien(RINA_CLIENT_ID);
    expect(rina.user_id).toBeNull();
    expect(rina.linked_at).toBeNull();

    const panen = await panenData(RINA_EMAIL);
    expect(panen.clients).toEqual([]);
    expect(panen.sessions).toEqual([]);
  });
});

describe("aturan validitas token undangan", () => {
  it("token benar TAPI email tidak cocok: ditolak, dan tidak dapat data apa pun", async () => {
    ids.penyusup = await buatUserTerkonfirmasi(EMAIL_PENYUSUP);

    const { token } = await terbitkan(KLIEN_UJI_ID);
    expect(await linkClientByInvite(ids.penyusup, EMAIL_PENYUSUP, token)).toBe(false);

    const klien = await barisKlien(KLIEN_UJI_ID);
    expect(klien.user_id).toBeNull();

    const panen = await panenData(EMAIL_PENYUSUP);
    expect(panen.clients).toEqual([]);
    expect(panen.sessions).toEqual([]);

    // Token yang gagal dipakai orang lain TIDAK boleh ikut hangus — pemilik
    // sahnya masih harus bisa memakainya.
    ids.klienUji = await buatUserTerkonfirmasi(KLIEN_UJI_EMAIL);
    expect(await linkClientByInvite(ids.klienUji, KLIEN_UJI_EMAIL, token)).toBe(true);
  });

  it("token kedaluwarsa ditolak", async () => {
    const { token } = await terbitkan(KLIEN_KADALUARSA_ID, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    ids.kadaluarsa = await buatUserTerkonfirmasi(KLIEN_KADALUARSA_EMAIL);
    expect(
      await linkClientByInvite(ids.kadaluarsa, KLIEN_KADALUARSA_EMAIL, token),
    ).toBe(false);
    expect((await barisKlien(KLIEN_KADALUARSA_ID)).user_id).toBeNull();

    // Kontrol positif: token yang sama, masa berlaku wajar → tertaut.
    const { token: baru, expiresAt } = await terbitkan(KLIEN_KADALUARSA_ID);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(
      await linkClientByInvite(ids.kadaluarsa, KLIEN_KADALUARSA_EMAIL, baru),
    ).toBe(true);
  });

  it("token sekali pakai: percobaan kedua ditolak walau email cocok", async () => {
    // Rina asli mengaktifkan akunnya dengan token dari pesan sambutan WA.
    await hapusUser(RINA_EMAIL); // penyerang dienyahkan admin
    ids.rina = await buatUserTerkonfirmasi(RINA_EMAIL);

    expect(
      await linkClientByInvite(ids.rina, RINA_EMAIL, TOKEN_UNDANGAN_RINA),
    ).toBe(true);

    const rina = await barisKlien(RINA_CLIENT_ID);
    expect(rina.user_id).toBe(ids.rina);
    expect(rina.linked_at).not.toBeNull();

    // Percobaan kedua dengan token yang sama — oleh pemiliknya sendiri maupun
    // oleh orang lain — harus ditolak.
    expect(
      await linkClientByInvite(ids.rina, RINA_EMAIL, TOKEN_UNDANGAN_RINA),
    ).toBe(false);
    ids.penyerang2 = await buatUserTerkonfirmasi(EMAIL_PENYUSUP2);
    expect(
      await linkClientByInvite(ids.penyerang2, RINA_EMAIL, TOKEN_UNDANGAN_RINA),
    ).toBe(false);

    // Barisnya tetap milik Rina asli, tidak berpindah.
    expect((await barisKlien(RINA_CLIENT_ID)).user_id).toBe(ids.rina);
  });

  it("klien yang sudah tertaut tidak bisa direbut lewat token baru", async () => {
    // PAGAR PERTAMA: penerbitan biasa untuk baris yang sudah tertaut ditolak
    // di sumbernya — sekaligus menjaga `used_at`/`used_by` dari terhapus.
    const ditolak = await createClientInvite(ANANDA_CLIENT_ID);
    expect(ditolak.ok).toBe(false);
    if (!ditolak.ok) expect(ditolak.alasan).toBe("sudah-tertaut");

    // PAGAR KEDUA: bahkan bila token yang hidup TETAP ada untuk baris itu
    // (jalan pintas fixture `paksa`, tidak pernah tersedia dari panel admin),
    // penautan ulangnya tetap ditolak. Dua pagar diuji terpisah supaya
    // matinya salah satu tidak tersembunyi di balik yang lain.
    const { token } = await terbitkan(ANANDA_CLIENT_ID, { paksa: true });
    expect(
      await linkClientByInvite(ids.rina, "ananda@padma.test", token),
    ).toBe(false);
    const { data } = await svc
      .from("clients")
      .select("user_id")
      .eq("id", ANANDA_CLIENT_ID)
      .single();
    expect(data!.user_id).not.toBe(ids.rina);
  });

  it("email dinormalkan: beda kapitalisasi tetap tertaut (perilaku sah dipertahankan)", async () => {
    await svc
      .from("clients")
      .update({ user_id: null, linked_at: null })
      .eq("id", KLIEN_UJI_ID);
    const { token } = await terbitkan(KLIEN_UJI_ID);
    const kapital = KLIEN_UJI_EMAIL.toUpperCase();
    expect(normalizeEmail(kapital)).toBe(KLIEN_UJI_EMAIL);
    expect(await linkClientByInvite(ids.klienUji, kapital, token)).toBe(true);
    expect((await barisKlien(KLIEN_UJI_ID)).user_id).toBe(ids.klienUji);
  });

  it("token acak kriptografis: panjang & tidak pernah berulang", async () => {
    const kumpulan = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = generateInviteToken();
      expect(t.length).toBeGreaterThanOrEqual(32);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, aman untuk URL
      kumpulan.add(t);
    }
    expect(kumpulan.size).toBe(50);
  });

  it("klien tertaut membaca datanya sendiri (kontrol positif, bukan tembok buta)", async () => {
    const panen = await panenData(RINA_EMAIL);
    // Kalau login-nya sendiri gagal, "tidak ada data" bukan bukti keamanan —
    // pastikan kontrol positif ini benar-benar punya sesi.
    expect(panen.sesi).toBe(true);
    expect(panen.clients.map((c) => c.nama)).toEqual(["Rina Hapsari"]);
    expect(panen.sessions.map((s) => s.catatan)).toContain(CATATAN_RAHASIA);
  });
});

describe("kerahasiaan token & keutuhan query yang sudah ada", () => {
  it("anon & authenticated tidak punya hak APA PUN atas penyimpanan token", async () => {
    const rows = await querySql<{ peran: string; hak: string; punya: boolean }>(
      `select r.rolname as peran, p.hak, has_table_privilege(r.rolname, 'public.client_invites', p.hak) as punya
         from (values ('anon'), ('authenticated')) as r(rolname),
              (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references')) as p(hak)`,
    );
    expect(rows.length).toBe(12);
    for (const r of rows) {
      expect(r.punya, `${r.peran} tidak boleh punya ${r.hak} pada client_invites`).toBe(false);
    }
  });

  it("token tidak terbaca lewat REST oleh klien maupun admin", async () => {
    for (const email of [RINA_EMAIL, "admin@padma.test", "owner@padma.test"]) {
      const c = await signInAs(email);
      const { data, error } = await c.from("client_invites").select("*");
      expect(data ?? [], `${email} tidak boleh melihat baris undangan`).toEqual([]);
      expect(error, `${email} seharusnya ditolak PostgREST`).not.toBeNull();
    }
    const { data: anonData, error: anonErr } = await anonClient()
      .from("client_invites")
      .select("*");
    expect(anonData ?? []).toEqual([]);
    expect(anonErr).not.toBeNull();
  });

  it("JEBAKAN: `select *` pada clients tetap jalan (tidak 42501) untuk klien & admin", async () => {
    const klien = await signInAs(RINA_EMAIL);
    const { data: dataKlien, error: errKlien } = await klien
      .from("clients")
      .select("*");
    expect(errKlien).toBeNull();
    expect((dataKlien ?? []).length).toBe(1);

    const admin = await signInAs("admin@padma.test");
    const { data: dataAdmin, error: errAdmin } = await admin
      .from("clients")
      .select("*");
    expect(errAdmin).toBeNull();
    expect((dataAdmin ?? []).length).toBeGreaterThanOrEqual(2);
    // Kalau token ikut menempel di baris clients, ia akan muncul di `select *`
    // milik ADMIN — dan admin bukan pihak yang perlu tahu token siapa pun.
    expect(JSON.stringify(dataAdmin)).not.toContain(TOKEN_UNDANGAN_RINA);

    const { data: dataSvc } = await svc.from("clients").select("*").limit(1);
    expect(Object.keys(dataSvc![0])).toContain("linked_at");
  });

  it("token disimpan tidak dalam bentuk polos (dump DB tidak langsung bisa dipakai)", async () => {
    const rows = await querySql<{ n: number }>(
      `select count(*)::int as n from public.client_invites
        where token_hash = $1`,
      [TOKEN_UNDANGAN_RINA],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("seed dev", () => {
  it("Rina tetap belum tertaut tapi punya token undangan yang diketahui", async () => {
    // Dijalankan ulang seperti globalSetup: seed harus idempoten.
    const { seedUsers } = await import("../scripts/seed-users");
    await seedUsers();

    const rina = await barisKlien(RINA_CLIENT_ID);
    expect(rina.user_id).toBeNull();
    expect(rina.linked_at).toBeNull();

    const pengguna = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: ananda } = await pengguna
      .from("clients")
      .select("user_id, linked_at")
      .eq("id", ANANDA_CLIENT_ID)
      .single();
    expect(ananda!.user_id).not.toBeNull();
    expect(ananda!.linked_at).not.toBeNull();

    // Token seed Rina benar-benar berfungsi — tapi tetap hanya untuk emailnya.
    const idLain = await buatUserTerkonfirmasi(EMAIL_UJI_TOKEN);
    expect(
      await linkClientByInvite(idLain, EMAIL_UJI_TOKEN, TOKEN_UNDANGAN_RINA),
    ).toBe(false); // token benar, email beda → tetap ditolak

    await hapusUser(RINA_EMAIL);
    const idRinaAsli = await buatUserTerkonfirmasi(RINA_EMAIL);
    expect(
      await linkClientByInvite(idRinaAsli, RINA_EMAIL, TOKEN_UNDANGAN_RINA),
    ).toBe(true);
  });
});
