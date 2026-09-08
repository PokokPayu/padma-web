/**
 * AKTIVASI KLIEN — penerbitan tautan undangan dari panel admin.
 *
 * Lima kelas kegagalan yang dijaga berkas ini:
 *
 *  1. Token bocor ke penyimpanan. Yang boleh ada di `client_invites` hanyalah
 *     SHA-256 token; nilai mentahnya hidup SATU KALI, pada nilai balik server
 *     action, lalu hanya ada di pesan WhatsApp yang dikirim admin.
 *
 *  2. Jejak "siapa mengaktifkan akun ini" terhapus. `createClientInvite`
 *     melakukan upsert pada primary key `client_id` dengan `used_at: null,
 *     used_by: null`. Tanpa penjaga, satu klik "terbitkan ulang" pada klien
 *     yang SUDAH tertaut menghapus catatan siapa yang menukarkan undangan dan
 *     kapan — persis bukti yang dibutuhkan saat sebuah akun dipersengketakan.
 *     (Bahwa celah ini nyata terlihat dari keadaan DB sekarang: Ananda yang
 *     sudah tertaut memegang undangan hidup, terbitan test lama.)
 *
 *  3. Penjaga peran hilang dari server action. Action adalah ENDPOINT POST
 *     TERSENDIRI — penjaga `src/app/admin/layout.tsx` tidak pernah dilewati.
 *     Tanpa `requireRole` di dalamnya, seorang klien yang login bisa menerbitkan
 *     undangan untuk baris klien siapa pun dan merebutnya.
 *
 *  4. Token ikut terbaca lewat REST. `client_invites` sengaja tertutup untuk
 *     SEMUA peran API termasuk admin (403, bukan array kosong) — itulah sebabnya
 *     penerbitan undangan adalah satu-satunya tempat service role dipakai di
 *     panel admin.
 *
 *  5. Modul `@/lib/auth/link-client` (node:crypto + service role) tertarik ke
 *     bundel browser lewat komponen kartu aktivasi.
 *
 * Data uji memakai prefix `PAD-UJI` / `pad-uji-` dan dibersihkan di `afterAll`;
 * klien uji sengaja bukan Ananda maupun Rina — beberapa berkas test lain
 * meng-assert jumlah baris milik keduanya secara PERSIS.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import {
  createClientInvite,
  linkClientByInvite,
  hashInviteToken,
  inviteLink,
  INVITE_TTL_DAYS,
} from "@/lib/auth/link-client";
import { tautanAktivasi, teksUndanganWhatsApp } from "@/lib/auth/pesan-undangan";
import { nominalDalam } from "./helpers/nominal";

const svc = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const SANDI = "padma-dev-123";

// Klien yang akan diundang lalu benar-benar mengaktifkan akunnya.
const KLIEN_BARU = "44444444-4444-4444-4444-4444444444a1";
const EMAIL_BARU = "pad-uji-aktivasi@padma.test";
// Klien yang SUDAH tertaut lewat undangan yang sah (bahan uji penjaga).
const KLIEN_TERTAUT = "44444444-4444-4444-4444-4444444444a2";
const EMAIL_TERTAUT = "pad-uji-tertaut@padma.test";
// Klien yang tidak pernah disentuh alur sah — bahan uji penjaga peran.
const KLIEN_PENJAGA = "44444444-4444-4444-4444-4444444444a3";
const EMAIL_PENJAGA = "pad-uji-penjaga@padma.test";

const KLIEN_UJI = [KLIEN_BARU, KLIEN_TERTAUT, KLIEN_PENJAGA];
const EMAIL_UJI = [EMAIL_BARU, EMAIL_TERTAUT, EMAIL_PENJAGA];

// Lapisan action memakai sesi pengguna (`createServerSupabase`). Di vitest tidak
// ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS dan requireRole
// tetap berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejak = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejak.revalidate.push(p);
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/klien",
}));

const { terbitkanUndangan } = await import("@/app/admin/klien/aksi");
const { default: DetailKlienPage } = await import("@/app/admin/klien/[id]/page");
const { KartuAktivasi } = await import("@/app/admin/klien/[id]/kartu-aktivasi");

const sumberAksi = baca("src/app/admin/klien/aksi.ts");
const sumberKartu = baca("src/app/admin/klien/[id]/kartu-aktivasi.tsx");
const sumberDetail = baca("src/app/admin/klien/[id]/page.tsx");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

// Token mentah hasil penerbitan sah — dipakai lintas test dalam berkas ini.
let tokenTerbit = "";
let idUserBaru = "";

async function buatUser(email: string): Promise<string> {
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

async function barisUndangan(clientId: string) {
  const { data } = await svc
    .from("client_invites")
    .select("client_id, token_hash, expires_at, used_at, used_by")
    .eq("client_id", clientId);
  return (data ?? []) as {
    client_id: string;
    token_hash: string | null;
    expires_at: string;
    used_at: string | null;
    used_by: string | null;
  }[];
}

async function barisKlien(id: string) {
  const { data } = await svc
    .from("clients")
    .select("id, nama, email, user_id, linked_at")
    .eq("id", id)
    .maybeSingle();
  return data as {
    id: string;
    nama: string;
    email: string;
    user_id: string | null;
    linked_at: string | null;
  } | null;
}

async function bersihkan() {
  // client_invites ikut terhapus lewat cascade dari clients.
  await svc.from("clients").delete().in("id", KLIEN_UJI);
  for (const email of EMAIL_UJI) await hapusUser(email);
}

beforeAll(async () => {
  await bersihkan();
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;

  const { error } = await svc.from("clients").insert([
    {
      id: KLIEN_BARU,
      padma_id: "PAD-UJI-0011",
      nama: "Uji Aktivasi",
      email: EMAIL_BARU,
      no_hp: "0812-0000-0011",
      phase_id: "prekonsepsi",
    },
    {
      id: KLIEN_TERTAUT,
      padma_id: "PAD-UJI-0012",
      nama: "Uji Sudah Tertaut",
      email: EMAIL_TERTAUT,
      no_hp: "0812-0000-0012",
      phase_id: "kehamilan",
    },
    {
      id: KLIEN_PENJAGA,
      padma_id: "PAD-UJI-0013",
      nama: "Uji Penjaga",
      email: EMAIL_PENJAGA,
      no_hp: "0812-0000-0013",
      phase_id: "kehamilan",
    },
  ]);
  if (error) throw error;

  // KLIEN_TERTAUT diaktifkan lewat alur SAH (undangan → penautan), supaya
  // `used_at`/`used_by`-nya berisi jejak sungguhan yang bisa dibuktikan hilang
  // bila penjaga "sudah tertaut" absen.
  const undangan = await createClientInvite(KLIEN_TERTAUT);
  if (!undangan.ok) throw new Error(`penerbitan fixture ditolak: ${undangan.alasan}`);
  const idUserTertaut = await buatUser(EMAIL_TERTAUT);
  const tertaut = await linkClientByInvite(idUserTertaut, EMAIL_TERTAUT, undangan.token);
  if (!tertaut) throw new Error("fixture klien tertaut gagal ditautkan");
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;
});

// ---------------------------------------------------------------------------
// Penerbitan
// ---------------------------------------------------------------------------

describe("terbitkanUndangan — token mentah sekali, sidik jarinya yang tersimpan", () => {
  it("mengembalikan token beserta nama & email klien untuk pesan WhatsApp", async () => {
    const hasil = await terbitkanUndangan(KLIEN_BARU);
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return; // penyempit tipe; assertion di atas yang menjaga

    expect(hasil.token.length).toBeGreaterThanOrEqual(32);
    expect(hasil.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, aman di URL
    expect(hasil.nama).toBe("Uji Aktivasi");
    expect(hasil.email).toBe(EMAIL_BARU);

    tokenTerbit = hasil.token;
  });

  it("yang tersimpan di basis data HANYA SHA-256-nya, bukan tokennya", async () => {
    const baris = await barisUndangan(KLIEN_BARU);
    expect(baris).toHaveLength(1);
    expect(baris[0].token_hash).toBe(hashInviteToken(tokenTerbit));
    expect(baris[0].token_hash).not.toBe(tokenTerbit);
    expect(baris[0].used_at).toBeNull();
    expect(baris[0].used_by).toBeNull();

    // Dan tidak ada satu baris pun yang menyimpan nilai mentahnya.
    const { data } = await svc
      .from("client_invites")
      .select("client_id")
      .eq("token_hash", tokenTerbit);
    expect(data ?? []).toHaveLength(0);
  });

  it("masa berlaku mengikuti INVITE_TTL_DAYS, tidak abadi", async () => {
    const baris = await barisUndangan(KLIEN_BARU);
    const umurHari =
      (new Date(baris[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(umurHari).toBeGreaterThan(INVITE_TTL_DAYS - 1);
    expect(umurHari).toBeLessThanOrEqual(INVITE_TTL_DAYS);
  });

  it("menyegarkan halaman detail klien", async () => {
    await terbitkanUndangan(KLIEN_PENJAGA);
    expect(jejak.revalidate).toContain(`/admin/klien/${KLIEN_PENJAGA}`);
  });

  it("id klien yang tidak ada ditolak, tanpa undangan yatim", async () => {
    const hasil = await terbitkanUndangan("00000000-0000-0000-0000-0000000000ff");
    expect(hasil.ok).toBe(false);
    expect(await barisUndangan("00000000-0000-0000-0000-0000000000ff")).toHaveLength(0);
  });
});

describe("token terbitan benar-benar mengaktifkan akun", () => {
  it("klien menukarkan tautannya dan barisnya tertaut", async () => {
    idUserBaru = await buatUser(EMAIL_BARU);
    expect(await linkClientByInvite(idUserBaru, EMAIL_BARU, tokenTerbit)).toBe(true);

    const klien = await barisKlien(KLIEN_BARU);
    expect(klien!.user_id).toBe(idUserBaru);
    expect(klien!.linked_at).not.toBeNull();

    // Jejak penukaran tercatat pada barisnya.
    const baris = await barisUndangan(KLIEN_BARU);
    expect(baris[0].used_by).toBe(idUserBaru);
    expect(baris[0].used_at).not.toBeNull();
    expect(baris[0].token_hash).toBeNull(); // token hangus
  });

  it("klien itu kini membaca datanya sendiri (kontrol positif)", async () => {
    const sesi = await signInAs(EMAIL_BARU);
    const { data } = await sesi.from("clients").select("id, nama");
    expect((data ?? []).map((c) => c.id)).toEqual([KLIEN_BARU]);
  });
});

// ---------------------------------------------------------------------------
// Penjaga "sudah tertaut"
// ---------------------------------------------------------------------------

describe("penjaga: undangan tidak diterbitkan ulang untuk klien yang sudah tertaut", () => {
  it("terbitkanUndangan menolak dengan kalimat, bukan crash", async () => {
    const hasil = await terbitkanUndangan(KLIEN_TERTAUT);
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/sudah aktif/i);
  });

  it("JEJAK PENUKARAN TIDAK TERHAPUS oleh percobaan penerbitan ulang", async () => {
    const sebelum = await barisUndangan(KLIEN_TERTAUT);
    expect(sebelum[0].used_by).not.toBeNull();
    expect(sebelum[0].used_at).not.toBeNull();

    await terbitkanUndangan(KLIEN_TERTAUT);

    const sesudah = await barisUndangan(KLIEN_TERTAUT);
    expect(sesudah[0].used_by).toBe(sebelum[0].used_by);
    expect(sesudah[0].used_at).toBe(sebelum[0].used_at);
    // Token hangus tetap hangus: tidak ada undangan hidup baru.
    expect(sesudah[0].token_hash).toBeNull();
  });

  it("createClientInvite sendiri yang menolak (bukan hanya lapisan action)", async () => {
    const hasil = await createClientInvite(KLIEN_TERTAUT);
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.alasan).toBe("sudah-tertaut");
  });

  it("klien yang tidak ada ditolak dengan alasan tersendiri", async () => {
    const hasil = await createClientInvite("00000000-0000-0000-0000-0000000000fe");
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.alasan).toBe("klien-tidak-ditemukan");
  });

  it("opsi paksa TIDAK pernah terhubung ke server action", () => {
    // `paksa` ada semata untuk seed dev & fixture test. Begitu ia bisa dicapai
    // dari panel, penjaga di atas tinggal satu parameter untuk dilewati.
    expect(sumberAksi).not.toContain("paksa");
  });
});

// ---------------------------------------------------------------------------
// Kerahasiaan penyimpanan token
// ---------------------------------------------------------------------------

describe("client_invites tertutup untuk seluruh peran API", () => {
  it("admin & owner mendapat penolakan REST, bukan array kosong", async () => {
    for (const email of ["admin@padma.test", "owner@padma.test"]) {
      const c = await signInAs(email);
      const { data, error } = await c.from("client_invites").select("*");
      expect(data ?? [], `${email} tidak boleh melihat baris undangan`).toEqual([]);
      expect(error, `${email} seharusnya ditolak PostgREST`).not.toBeNull();
    }
  });

  it("halaman admin karena itu tidak pernah men-select client_invites", () => {
    for (const sumber of [sumberDetail, sumberKartu]) {
      expect(sumber).not.toContain("client_invites");
    }
  });
});

// ---------------------------------------------------------------------------
// Pesan WhatsApp
// ---------------------------------------------------------------------------

describe("teks WhatsApp siap salin", () => {
  const ORIGIN = "https://padma.example";

  it("memuat tautan aktivasi bertoken dan nama klien", () => {
    const tautan = tautanAktivasi(ORIGIN, tokenTerbit);
    const teks = teksUndanganWhatsApp({
      nama: "Uji Aktivasi",
      email: EMAIL_BARU,
      tautan,
    });

    expect(teks).toContain("Uji Aktivasi");
    expect(teks).toContain(EMAIL_BARU);
    expect(teks).toContain(`${ORIGIN}/aktivasi?token=${tokenTerbit}`);
    expect(teks).toContain("/aktivasi?token=");
  });

  it("menyebutkan masa berlaku dan sifat sekali pakai", () => {
    const teks = teksUndanganWhatsApp({
      nama: "Uji Aktivasi",
      email: EMAIL_BARU,
      tautan: tautanAktivasi(ORIGIN, tokenTerbit),
    });
    expect(teks).toContain(`${INVITE_TTL_DAYS} hari`);
    expect(teks).toMatch(/sekali/i);
  });

  it("menyebut nomor WhatsApp klinik yang SEDANG berlaku, lewat prop", () => {
    // Sejak /admin/pengaturan lahir, nomor klinik bisa berubah kapan saja.
    // Nomornya MENGALIR SEBAGAI PARAMETER: `pesan-undangan.ts` wajib tetap
    // tanpa impor karena pemanggilnya komponen "use client", dan modul setelan
    // menyeret klien service role ke bundel browser.
    const teks = teksUndanganWhatsApp({
      nama: "Uji Aktivasi",
      email: EMAIL_BARU,
      tautan: tautanAktivasi(ORIGIN, tokenTerbit),
      nomorWa: "0877-7840-0201",
    });
    expect(teks).toContain("0877-7840-0201");

    // Dan berkas penyusunnya tetap murni — pagar yang membuat prop itu perlu.
    expect(baca("src/lib/auth/pesan-undangan.ts")).not.toMatch(/^\s*import\s/m);
    // Halaman detail mengambilnya di server lalu menurunkannya ke kartu.
    expect(sumberDetail).toContain("nomorWaKlinik");
    expect(sumberDetail).toMatch(/nomorWa=\{/);
    // Kartu tidak boleh MENGAMBILNYA sendiri. Ditulis sebagai pola impor
    // (bukan substring) supaya prosa yang MENJELASKAN kenapa modul itu dijauhi
    // tetap boleh ada — persis seperti pagar link-client di bawah.
    expect(sumberKartu).not.toMatch(/from\s+["'][^"']*lib\/settings["']/);
    expect(sumberKartu).not.toMatch(/from\s+["'][^"']*admin\/pengaturan["']/);
  });

  it("bentuk tautan berbagi SATU sumber dengan inviteLink", () => {
    // Dua tempat yang menyusun URL aktivasi sendiri-sendiri adalah cara paling
    // mudah menerbitkan tautan yang tidak pernah bisa ditukarkan.
    const token = "a-b_c123";
    expect(tautanAktivasi(ORIGIN, token)).toBe(inviteLink(ORIGIN, token));
    expect(tautanAktivasi(ORIGIN, "a b&c")).toBe(`${ORIGIN}/aktivasi?token=a%20b%26c`);
  });
});

// ---------------------------------------------------------------------------
// Penjaga peran
// ---------------------------------------------------------------------------

describe("penjaga peran pada endpoint penerbit", () => {
  it("klien yang login tidak bisa menerbitkan undangan untuk siapa pun", async () => {
    // Baris ini belum tertaut: bila penjaga absen, klien mana pun bisa
    // menerbitkan tautan aktivasinya lalu merebut rekam medisnya.
    await svc.from("client_invites").delete().eq("client_id", KLIEN_PENJAGA);
    ref.sesi = sesiKlien;

    await expect(terbitkanUndangan(KLIEN_PENJAGA)).rejects.toThrow(/REDIRECT/);
    expect(await barisUndangan(KLIEN_PENJAGA)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas & UI
// ---------------------------------------------------------------------------

describe("bentuk berkas server action", () => {
  it("hanya mengekspor fungsi async, dan SETIAP action ber-requireRole", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(ekspor)]).toEqual(["async"]);

    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBe(3);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("service role tidak pernah menyentuh data klien di berkas ini", () => {
    // Pengecualian tunggal panel admin adalah penerbitan token, dan itu terjadi
    // DI DALAM createClientInvite — bukan lewat klien service role yang dibuat
    // di sini dan bisa dipakai query lain.
    expect(sumberAksi).not.toContain("createAdminSupabase");
    expect(sumberAksi).not.toContain("SERVICE_ROLE");
    expect(sumberAksi).toContain("createClientInvite");
  });
});

describe("kartu aktivasi di halaman detail klien", () => {
  it("menawarkan penerbitan tautan untuk klien yang belum aktif", async () => {
    ref.sesi = sesiAdmin;
    const m = renderToStaticMarkup(
      await DetailKlienPage({ params: Promise.resolve({ id: KLIEN_PENJAGA }) }),
    );
    expect(m).toContain("Terbitkan tautan aktivasi");
    expect(nominalDalam(m), "nominal bocor").toEqual([]);
  });

  it("tidak menawarkannya untuk klien yang sudah aktif", async () => {
    ref.sesi = sesiAdmin;
    const m = renderToStaticMarkup(
      await DetailKlienPage({ params: Promise.resolve({ id: KLIEN_TERTAUT }) }),
    );
    expect(m).not.toContain("Terbitkan tautan aktivasi");
    expect(m).toContain("Aktif");
  });

  it("memperingatkan bahwa token hanya tampil sekali", () => {
    const m = renderToStaticMarkup(
      createElement(KartuAktivasi, {
        clientId: KLIEN_PENJAGA,
        nama: "Uji Penjaga",
        nomorWa: "0877-7840-0200",
      }),
    );
    expect(m).toContain("Terbitkan tautan aktivasi");
    expect(sumberKartu).toMatch(/sekali/i);
  });

  it("komponen sisi klien TIDAK menarik modul token ke bundel browser", () => {
    // link-client.ts memuat node:crypto dan klien service role. Satu import
    // dari komponen "use client" sudah cukup untuk menyeretnya ke browser.
    expect(sumberKartu.trimStart().startsWith('"use client"')).toBe(true);
    // Ditulis sebagai pola impor (bukan sekadar substring) supaya jalur relatif
    // `../../../lib/auth/link-client` ikut tertangkap, sementara prosa yang
    // MENJELASKAN kenapa modul itu dijauhi tetap boleh ada.
    expect(sumberKartu).not.toMatch(/from\s+["'][^"']*link-client["']/);
    expect(sumberKartu).not.toMatch(/import\(\s*["'][^"']*link-client["']/);
    expect(sumberKartu).not.toContain("createAdminSupabase");
  });

  it("tidak menuliskan PII ke log", () => {
    expect(sumberKartu).not.toContain("console.");
  });
});
