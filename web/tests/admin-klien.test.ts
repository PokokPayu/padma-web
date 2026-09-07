/**
 * Modul Klien panel admin — daftar, tambah, detail.
 *
 * Empat kelas kegagalan yang dijaga berkas ini, semuanya SENYAP (tidak ada
 * error yang muncul di layar siapa pun):
 *
 *  1. Penjaga peran hilang dari dalam server action. Server action adalah
 *     ENDPOINT POST TERSENDIRI: penjaga di `src/app/admin/layout.tsx` tidak
 *     pernah dilewati saat action dipanggil langsung. Tanpa
 *     `requireRole(["admin","owner"])` di dalam setiap action, seorang klien
 *     yang login bisa membuat baris `clients` baru untuk siapa pun.
 *
 *  2. Penautan akun ikut ditulis dari panel. `clients.user_id`/`linked_at`
 *     menentukan akun auth mana yang boleh membaca rekam medis satu baris.
 *     Ia HANYA boleh diisi service role lewat token undangan (trigger
 *     `guard_client_link`). Klien yang baru dibuat karena itu wajib lahir
 *     BELUM tertaut, dan `perbaruiKlien` tidak boleh menyentuh kolom itu.
 *
 *  3. Email duplikat menjadi crash, bukan pesan. `clients.email` unik; admin
 *     yang mendaftarkan ulang klien lama harus mendapat kalimat yang bisa
 *     dibaca, bukan halaman error — dan tidak boleh ada baris kedua.
 *
 *  4. Penghapusan klien. Satu DELETE menyapu `sessions`, `client_packages`,
 *     `booking_requests`, dan `client_invites` lewat cascade. Hak itu sudah
 *     dicabut di Task 1; ditegaskan ulang di sini karena modul inilah yang
 *     pertama kali memberi admin daftar klien yang bisa diklik.
 *
 * Catatan data uji: baris fixture memakai prefix `PAD-UJI` pada `padma_id` dan
 * `pad-uji-` pada email, lalu dibersihkan di `afterAll`. Klien uji SENGAJA
 * bukan Ananda — `rls-firewall.test.ts` dan `passport-beranda.test.ts`
 * meng-assert jumlah baris miliknya secara PERSIS.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { buatPrefix } from "@/lib/admin/padma-id";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ANANDA = "44444444-4444-4444-4444-444444444401";
const KLIEN_FIXTURE = "44444444-4444-4444-4444-4444444444f5";
const KLIEN_EDIT = "44444444-4444-4444-4444-4444444444f6";
const EMAIL_FIXTURE = "pad-uji-fixture@padma.test";
const EMAIL_EDIT = "pad-uji-edit@padma.test";
const EMAIL_BARU = "pad-uji-baru@padma.test";

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`). Di
// vitest tidak ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS dan
// requireRole tetap berjalan apa adanya, persis seperti di server.
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

// `redirect()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/klien",
}));

const { buatKlien, perbaruiKlien } = await import("@/app/admin/klien/aksi");
const { default: DaftarKlienPage } = await import("@/app/admin/klien/page");
const { default: DetailKlienPage } = await import("@/app/admin/klien/[id]/page");

const sumberAksi = baca("src/app/admin/klien/aksi.ts");
const sumberDaftar = baca("src/app/admin/klien/page.tsx");
const sumberForm = baca("src/app/admin/klien/form-klien.tsx");
const sumberDetail = baca("src/app/admin/klien/[id]/page.tsx");
const sumberLib = baca("src/lib/admin/klien.ts");
// Rute berdiri sendiri (Task 9) — TIDAK ada di daftar `sumber*` sebelum Fix
// Round 1. `tests/money-firewall-struktural.test.ts` TIDAK menutupinya: uji
// itu murni memeriksa `information_schema.columns` di basis data, tidak
// pernah membaca kode sumber sama sekali. Tanpa baris ini, berkas ini lolos
// tanpa satu pagar sumber pun.
const sumberBaru = baca("src/app/admin/klien/baru/page.tsx");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

async function barisKlien(kolom: string, nilai: string) {
  const { data } = await admin
    .from("clients")
    .select("id, padma_id, nama, email, no_hp, phase_id, user_id, linked_at, alamat, alamat_lat, alamat_lon")
    .eq(kolom, nilai);
  return data ?? [];
}

// `vi.stubGlobal` MENIMPA `globalThis.fetch` sepenuhnya — men-stub PENUH akan
// ikut menjatuhkan panggilan Supabase lokal yang dipakai `buatKlien`/
// `perbaruiKlien` sendiri, bukan cuma Nominatim. Pola sama dengan
// `tests/transport-geocode.test.ts`: hanya URL yang menyentuh Nominatim yang
// dijawab `palsu`; sisanya diteruskan ke `fetch` asli (pagar
// `tests/setup-fetch-guard.ts`, meloloskan 127.0.0.1 tempat Supabase lokal).
function stubNominatim(jawab: () => Promise<Response> | Response) {
  const asli = globalThis.fetch;
  const palsu = vi.fn(() => jawab());
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu() : asli(...args);
  });
  return palsu;
}

async function bersihkan() {
  // Urutan tidak penting: seluruh anak baris klien ikut terhapus lewat cascade,
  // dan service role tidak terikat pencabutan DELETE milik `authenticated`.
  await admin.from("clients").delete().like("email", "pad-uji-%");
  await admin.from("clients").delete().like("padma_id", "PAD-UJI%");
}

beforeAll(async () => {
  await bersihkan();
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;

  await admin.from("clients").insert([
    {
      id: KLIEN_FIXTURE,
      padma_id: "PAD-UJI-0005",
      nama: "Uji Klien Fixture",
      email: EMAIL_FIXTURE,
      no_hp: "0812-0000-0005",
      phase_id: "prekonsepsi",
    },
    {
      id: KLIEN_EDIT,
      padma_id: "PAD-UJI-0006",
      nama: "Uji Klien Edit",
      email: EMAIL_EDIT,
      no_hp: "0812-0000-0006",
      phase_id: "prekonsepsi",
    },
  ]);
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;
});

afterEach(() => {
  // Bukan di akhir badan tiap `it`: bila sebuah asersi gagal, baris unstub di
  // bawahnya tidak pernah jalan — stub lantas bocor ke test berikutnya.
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Server action: buatKlien
// ---------------------------------------------------------------------------

describe("buatKlien — pendaftaran klien oleh admin", () => {
  it("membuat baris clients baru ber-PADMA ID PAD-YYMM-NNNN", async () => {
    // Email sengaja ditulis berkapital: normalisasi diuji pada test berikutnya,
    // dan bentuk yang dikirim admin memang apa adanya dari papan ketik.
    const hasil = await buatKlien(
      formulir({
        nama: "Uji Klien Baru",
        email: "PAD-UJI-Baru@Padma.Test",
        no_hp: "0812-0000-0007",
        fase: "prekonsepsi",
      }),
    );

    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return; // penyempit tipe; assertion di atas yang menjaga
    expect(hasil.padmaId).toMatch(/^PAD-\d{4}-\d{4}$/);
    // Prefix mengikuti kalender Jakarta, bukan jam server UTC.
    expect(hasil.padmaId.startsWith(`${buatPrefix()}-`)).toBe(true);

    // Nilai kembalian action tidak membuktikan apa pun; barisnya yang membuktikan.
    const baris = await barisKlien("id", hasil.id);
    expect(baris).toHaveLength(1);
    expect(baris[0]).toMatchObject({
      padma_id: hasil.padmaId,
      nama: "Uji Klien Baru",
      no_hp: "0812-0000-0007",
      phase_id: "prekonsepsi",
    });
  });

  it("email disimpan dalam huruf kecil (trigger clients_normalize_email)", async () => {
    const baris = await barisKlien("email", EMAIL_BARU);
    expect(baris).toHaveLength(1);
    expect(baris[0].email).toBe(EMAIL_BARU);
    expect(baris[0].email).toBe(baris[0].email.toLowerCase());
  });

  it("klien baru lahir BELUM tertaut (user_id & linked_at null)", async () => {
    const baris = await barisKlien("email", EMAIL_BARU);
    expect(baris[0].user_id).toBeNull();
    expect(baris[0].linked_at).toBeNull();
    // Penautan hanya sah lewat token undangan (Task 6) — bukan dari panel ini.
    expect(sumberAksi).not.toContain("user_id");
    expect(sumberAksi).not.toContain("linked_at");
  });

  it("email duplikat ditolak dengan pesan ramah, bukan crash", async () => {
    // Kapitalisasi berbeda: normalisasi harus membuatnya tetap terbaca duplikat.
    const hasil = await buatKlien(
      formulir({
        nama: "Uji Klien Kembar",
        email: "  Pad-Uji-Baru@Padma.Test  ",
        no_hp: "0812-0000-0008",
        fase: "kehamilan",
      }),
    );

    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/sudah dipakai/i);

    // Dan yang terpenting: tidak ada baris kedua.
    expect(await barisKlien("email", EMAIL_BARU)).toHaveLength(1);
  });

  it("menolak nama terlalu pendek tanpa menyentuh basis data", async () => {
    const hasil = await buatKlien(
      formulir({ nama: "A", email: "pad-uji-pendek@padma.test", fase: "prekonsepsi" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/nama/i);
    expect(await barisKlien("email", "pad-uji-pendek@padma.test")).toHaveLength(0);
  });

  it("menolak email tidak sah", async () => {
    const hasil = await buatKlien(
      formulir({ nama: "Uji Email Buruk", email: "bukan-email", fase: "prekonsepsi" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/email/i);
  });

  it("menolak fase kosong (foreign key phases tidak pernah dibiarkan menabrak)", async () => {
    const hasil = await buatKlien(
      formulir({ nama: "Uji Tanpa Fase", email: "pad-uji-tanpafase@padma.test", fase: "" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/fase/i);
    expect(await barisKlien("email", "pad-uji-tanpafase@padma.test")).toHaveLength(0);
  });

  it("menyegarkan cache daftar klien setelah berhasil", async () => {
    await buatKlien(
      formulir({
        nama: "Uji Revalidate",
        email: "pad-uji-revalidate@padma.test",
        no_hp: "0812-0000-0009",
        fase: "kehamilan",
      }),
    );
    expect(jejak.revalidate).toContain("/admin/klien");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      buatKlien(
        formulir({
          nama: "Uji Dari Klien",
          email: "pad-uji-dariklien@padma.test",
          fase: "prekonsepsi",
        }),
      ),
    ).rejects.toThrow(/REDIRECT/);

    // Dan tidak ada baris yang sempat lahir sebelum penjaga menyala.
    expect(await barisKlien("email", "pad-uji-dariklien@padma.test")).toHaveLength(0);
  });

  it("alamat default BOLEH kosong — klien tetap lahir tanpa alamat", async () => {
    const hasil = await buatKlien(
      formulir({
        nama: "Uji Klien Tanpa Alamat",
        email: "pad-uji-tanpaalamat@padma.test",
        fase: "prekonsepsi",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    const baris = await barisKlien("id", hasil.id);
    expect(baris[0].alamat).toBe("");
    expect(baris[0].alamat_lat).toBeNull();
    expect(baris[0].alamat_lon).toBeNull();
  });

  it("menyimpan alamat default beserta koordinatnya (spec T6)", async () => {
    await admin
      .from("geocode_cache")
      .delete()
      .eq("alamat_normal", "jl. uji klien geocode no. 1");
    const palsu = stubNominatim(() =>
      new Response(JSON.stringify([{ lat: "-6.9", lon: "107.6" }]), { status: 200 }),
    );

    const hasil = await buatKlien(
      formulir({
        nama: "Uji Klien Geocode",
        email: "pad-uji-geocode@padma.test",
        fase: "prekonsepsi",
        alamat: "Jl. Uji Klien Geocode No. 1",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(palsu).toHaveBeenCalled();
    const baris = await barisKlien("id", hasil.id);
    expect(baris[0].alamat).toBe("Jl. Uji Klien Geocode No. 1");
    expect(baris[0].alamat_lat).toBe(-6.9);
    expect(baris[0].alamat_lon).toBe(107.6);
  });

  it("alamat TETAP tersimpan meski geocoding gagal (katup pengaman T6)", async () => {
    // `stubNominatim`, bukan `vi.stubGlobal("fetch", ...)` penuh: stub penuh
    // akan ikut menjatuhkan panggilan Supabase lokal yang dipakai `buatKlien`
    // sendiri (insert `clients`), membuat `hasil.ok` bernilai `false` untuk
    // alasan yang salah sama sekali — bukan karena geocoding gagal.
    stubNominatim(async () => {
      throw new Error("jaringan mati");
    });

    const hasil = await buatKlien(
      formulir({
        nama: "Uji Klien Geocode Gagal",
        email: "pad-uji-geocodegagal@padma.test",
        fase: "prekonsepsi",
        alamat: "Jl. Gang Sempit Tanpa Nama Klien",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    const baris = await barisKlien("id", hasil.id);
    expect(baris[0].alamat).toBe("Jl. Gang Sempit Tanpa Nama Klien");
    expect(baris[0].alamat_lat).toBeNull();
    expect(baris[0].alamat_lon).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Server action: perbaruiKlien
// ---------------------------------------------------------------------------

describe("perbaruiKlien — hanya data operasional", () => {
  it("mengubah nama, no_hp, dan fase", async () => {
    const hasil = await perbaruiKlien(
      KLIEN_EDIT,
      formulir({ nama: "Uji Klien Edit Baru", no_hp: "0899-0000-0006", fase: "kehamilan" }),
    );
    expect(hasil.ok).toBe(true);

    const baris = await barisKlien("id", KLIEN_EDIT);
    expect(baris[0]).toMatchObject({
      nama: "Uji Klien Edit Baru",
      no_hp: "0899-0000-0006",
      phase_id: "kehamilan",
    });
  });

  it("email TIDAK ikut berubah walau dikirim di FormData", async () => {
    // Mengubah email memutus penautan; kolomnya sengaja tidak pernah masuk
    // payload UPDATE, jadi medan yang diselundupkan penyerang diabaikan.
    await perbaruiKlien(
      KLIEN_EDIT,
      formulir({
        nama: "Uji Klien Edit Baru",
        no_hp: "0899-0000-0006",
        fase: "kehamilan",
        email: "penyerang@padma.test",
        user_id: "00000000-0000-0000-0000-000000000001",
        padma_id: "PAD-UJI-9999",
      }),
    );

    const baris = await barisKlien("id", KLIEN_EDIT);
    expect(baris[0].email).toBe(EMAIL_EDIT);
    expect(baris[0].padma_id).toBe("PAD-UJI-0006");
    expect(baris[0].user_id).toBeNull();
    expect(baris[0].linked_at).toBeNull();
  });

  it("payload UPDATE hanya memuat kolom operasional", () => {
    const update = sumberAksi.match(/\.update\(([\s\S]*?)\)\s*\n?\s*\.eq\(/);
    expect(update, "perbaruiKlien harus memakai .update(...) yang bisa dibaca").not.toBeNull();
    for (const terlarang of ["email", "user_id", "linked_at", "padma_id"]) {
      expect(update![1]).not.toContain(terlarang);
    }
  });

  it("menolak nama terlalu pendek dan tidak menimpa nama lama", async () => {
    const hasil = await perbaruiKlien(
      KLIEN_EDIT,
      formulir({ nama: "X", no_hp: "0899-0000-0006", fase: "kehamilan" }),
    );
    expect(hasil.ok).toBe(false);
    expect((await barisKlien("id", KLIEN_EDIT))[0].nama).toBe("Uji Klien Edit Baru");
  });

  it("id yang tidak ada menghasilkan penolakan, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST dengan
    // 200 + [] — melaporkan "berhasil" di sini adalah kebohongan senyap.
    const hasil = await perbaruiKlien(
      "00000000-0000-0000-0000-0000000000ff",
      formulir({ nama: "Nama Hantu", no_hp: "0", fase: "prekonsepsi" }),
    );
    expect(hasil.ok).toBe(false);
  });

  it("menyegarkan cache daftar DAN halaman detail", async () => {
    await perbaruiKlien(
      KLIEN_EDIT,
      formulir({ nama: "Uji Klien Edit Baru", no_hp: "0899-0000-0006", fase: "kehamilan" }),
    );
    expect(jejak.revalidate).toContain("/admin/klien");
    expect(jejak.revalidate).toContain(`/admin/klien/${KLIEN_EDIT}`);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      perbaruiKlien(
        KLIEN_FIXTURE,
        formulir({ nama: "Direbut Klien", no_hp: "0", fase: "prekonsepsi" }),
      ),
    ).rejects.toThrow(/REDIRECT/);
    expect((await barisKlien("id", KLIEN_FIXTURE))[0].nama).toBe("Uji Klien Fixture");
  });

  it("menyimpan alamat beserta koordinatnya (spec T6)", async () => {
    await admin
      .from("geocode_cache")
      .delete()
      .eq("alamat_normal", "jl. uji klien edit geocode no. 2");
    const palsu = stubNominatim(() =>
      new Response(JSON.stringify([{ lat: "-6.8", lon: "107.5" }]), { status: 200 }),
    );

    const hasil = await perbaruiKlien(
      KLIEN_EDIT,
      formulir({
        nama: "Uji Klien Edit Baru",
        no_hp: "0899-0000-0006",
        fase: "kehamilan",
        alamat: "Jl. Uji Klien Edit Geocode No. 2",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect(palsu).toHaveBeenCalled();

    const baris = await barisKlien("id", KLIEN_EDIT);
    expect(baris[0].alamat).toBe("Jl. Uji Klien Edit Geocode No. 2");
    expect(baris[0].alamat_lat).toBe(-6.8);
    expect(baris[0].alamat_lon).toBe(107.5);
  });

  it("alamat TETAP tersimpan meski geocoding gagal (katup pengaman T6)", async () => {
    // `stubNominatim`, bukan `vi.stubGlobal("fetch", ...)` penuh — lihat
    // komentar di sekitar deklarasinya. Stub penuh akan ikut menjatuhkan
    // panggilan Supabase lokal `perbaruiKlien` sendiri (UPDATE `clients`).
    stubNominatim(async () => {
      throw new Error("jaringan mati");
    });

    const hasil = await perbaruiKlien(
      KLIEN_EDIT,
      formulir({
        nama: "Uji Klien Edit Baru",
        no_hp: "0899-0000-0006",
        fase: "kehamilan",
        alamat: "Jl. Gang Sempit Edit Tanpa Nama",
      }),
    );
    expect(hasil.ok).toBe(true);

    const baris = await barisKlien("id", KLIEN_EDIT);
    expect(baris[0].alamat).toBe("Jl. Gang Sempit Edit Tanpa Nama");
    expect(baris[0].alamat_lat).toBeNull();
    expect(baris[0].alamat_lon).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pagar basis data
// ---------------------------------------------------------------------------

describe("pagar basis data yang menopang modul ini", () => {
  it("admin TIDAK bisa menghapus klien (cascade menyapu rekam medis)", async () => {
    const { error } = await sesiAdmin.from("clients").delete().eq("id", KLIEN_FIXTURE);
    expect(error?.code).toBe("42501");

    // Benar-benar masih ada — bukan sekadar error yang dilaporkan.
    expect(await barisKlien("id", KLIEN_FIXTURE)).toHaveLength(1);
  });

  it("admin TIDAK bisa menautkan akun lewat REST (trigger guard_client_link)", async () => {
    const { error } = await sesiAdmin
      .from("clients")
      .update({ user_id: "00000000-0000-0000-0000-000000000001" })
      .eq("id", KLIEN_FIXTURE);
    expect(error?.code).toBe("42501");
    expect((await barisKlien("id", KLIEN_FIXTURE))[0].user_id).toBeNull();
  });

  it("klien tidak bisa membaca baris klien lain", async () => {
    const { data } = await sesiKlien.from("clients").select("id").eq("id", KLIEN_FIXTURE);
    expect(data ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Halaman daftar
// ---------------------------------------------------------------------------

describe("halaman daftar klien (/admin/klien)", () => {
  let markup = "";

  beforeAll(async () => {
    ref.sesi = sesiAdmin;
    // Halaman kini menerima `searchParams` (Task 9) — `{}` mereproduksi
    // perilaku lama "hal 1 tanpa saringan".
    markup = renderToStaticMarkup(await DaftarKlienPage({ searchParams: Promise.resolve({}) }));
  });

  it("menampilkan PADMA ID dan nama tiap klien", () => {
    // Sejak Task 9 (pola B) email TIDAK lagi duplikat di daftar — ia hanya
    // hidup di halaman detail (`/admin/klien/<id>`) yang kini ditaut
    // langsung dari baris nama, jadi tidak ada lagi alasan menampilkannya
    // dua kali.
    expect(markup).toContain("PAD-UJI-0005");
    expect(markup).toContain("Uji Klien Fixture");
  });

  it("menampilkan label fase yang bisa dibaca manusia, bukan id mentah", () => {
    expect(markup).toContain("Prekonsepsi / Promil");
  });

  it("menampilkan paket aktif sebagai 'nama · N sesi', dan '—' bila tidak ada", () => {
    // Ananda memegang paket Sankalpa Prima 8 sesi di seed.
    expect(markup).toContain("Sankalpa Prima · 8 sesi");
    // Klien fixture tidak punya paket sama sekali — placeholder daftar
    // (Task 9) memakai em dash yang sama dengan kolom Fase, bukan lagi
    // "Sesi lepas".
    expect(markup).toMatch(/>—<\/td>/);
  });

  it("menampilkan jumlah sesi selesai apa adanya dari basis data", async () => {
    const { count } = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA)
      .eq("status", "selesai");
    expect(count).toBeGreaterThan(0);
    // Angkanya dirender sebagai isi sel tersendiri.
    expect(markup).toContain(`>${count}<`);
  });

  it("STATUS AKTIVASI dibedakan: tertaut 'Aktif', belum tertaut 'Belum aktif'", () => {
    // Ananda tertaut, klien fixture belum — kedua pill harus muncul.
    expect(markup).toContain("Belum aktif");
    // "Aktif" sebagai pill tersendiri, bukan sekadar substring "Belum aktif".
    expect(markup).toMatch(/>Aktif</);
  });

  it("setiap baris menautkan ke halaman detailnya", () => {
    expect(markup).toContain(`href="/admin/klien/${KLIEN_FIXTURE}"`);
    expect(markup).toContain(`href="/admin/klien/${ANANDA}"`);
  });

  it("menyediakan jalan membuat klien baru", () => {
    expect(markup).toContain("Klien baru");
    // Pilihan fase datang dari tabel phases, bukan literal di komponen.
    expect(sumberForm).not.toContain("Prekonsepsi / Promil");
  });

  it("dijaga requireRole admin+owner di halamannya sendiri", () => {
    expect(sumberDaftar).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberDaftar).toMatch(/title:\s*"Klien"/);
    expect(sumberDaftar).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("tidak ada nominal uang di daftar klien (money firewall)", () => {
    expect(markup).not.toMatch(/Rp\s?\d/);
    for (const sumber of [sumberDaftar, sumberForm, sumberDetail, sumberAksi, sumberLib, sumberBaru]) {
      expect(sumber).not.toMatch(/Rp\s?\d/);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
    }
  });
});

// ---------------------------------------------------------------------------
// Halaman detail
// ---------------------------------------------------------------------------

describe("halaman detail klien (/admin/klien/[id])", () => {
  it("menampilkan ringkasan klien beserta status aktivasinya", async () => {
    ref.sesi = sesiAdmin;
    const m = renderToStaticMarkup(
      // Next 16: `params` adalah Promise.
      await DetailKlienPage({ params: Promise.resolve({ id: KLIEN_FIXTURE }) }),
    );
    expect(m).toContain("Uji Klien Fixture");
    expect(m).toContain("PAD-UJI-0005");
    expect(m).toContain(EMAIL_FIXTURE);
    expect(m).toContain("Belum aktif");
    expect(m).not.toMatch(/Rp\s?\d/);
  });

  it("menyediakan form ubah data operasional (tanpa medan email)", async () => {
    ref.sesi = sesiAdmin;
    const m = renderToStaticMarkup(
      await DetailKlienPage({ params: Promise.resolve({ id: KLIEN_FIXTURE }) }),
    );
    expect(m).toContain('name="nama"');
    expect(m).toContain('name="no_hp"');
    expect(m).toContain('name="fase"');
    // Email bukan data operasional: ia kunci penautan.
    expect(m).not.toContain('name="email"');
  });

  it("id yang tidak ada berakhir notFound, bukan halaman kosong", async () => {
    ref.sesi = sesiAdmin;
    await expect(
      DetailKlienPage({
        params: Promise.resolve({ id: "00000000-0000-0000-0000-0000000000ff" }),
      }),
    ).rejects.toThrow(/NOTFOUND/);
  });

  it("meng-await params (Next 16) dan menjaga perannya sendiri", () => {
    expect(sumberDetail).toContain("await params");
    expect(sumberDetail).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberDetail, sumberAksi]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
  });
});

// ---------------------------------------------------------------------------
// PAGAR IDENTITAS — lib/admin/klien.ts
// ---------------------------------------------------------------------------
//
// Sama seperti pagar `admin-mitra.test.ts` ("pencocokan identitas memakai
// operator setara, tidak pernah pola"): tiga bentuk penulisan yang bisa
// menyelundupkan pencocokan POLA ke kolom identitas —
//   1. bentuk metode      — `.ilike("id", ...)` / `.like("partner_id", ...)`
//   2. bentuk string `.or(...)` — `"id.ilike.%x%"`
//   3. bentuk `.filter(kolom, operator, nilai)` — `.filter("id","ilike",…)`
// — semuanya berbahaya karena `.eq("id", x)` yang suatu hari diam-diam
// menjadi pola akan meloloskan baris milik orang lain lewat sebuah AWALAN,
// tanpa satu galat pun.
//
// `lib/admin/klien.ts` PERSIS memakai bentuk #2 — `q.or(\`nama.ilike.%x%,
// padma_id.ilike.%x%\`)` — untuk mencari lewat nama DAN PADMA ID sekaligus.
// Pola mitra yang hanya memeriksa kolom TEPAT SETELAH tanda kutip pembuka
// tidak cukup di sini: `padma_id` muncul SETELAH KOMA di tengah string
// `.or()`, bukan di awalnya. Pola di bawah diperluas supaya kolom identitas
// yang muncul setelah koma ikut tertangkap — persis bentuk yang dipakai
// modul ini.
describe("pagar identitas — lib/admin/klien.ts (kolom identitas TIDAK pernah dicocokkan dengan pola, KECUALI padma_id)", () => {
  const polaMetodeIdentitas = /\.(?:ilike|like)\(\s*['"`](id|\w*_id)['"`]/;
  const polaFilterIdentitas =
    /\.filter\(\s*['"`](id|\w*_id)['"`]\s*,\s*['"`](?:ilike|like)['"`]/;
  // `[,'"`]` di depan, bukan hanya `['"`]`: menangkap kolom identitas yang
  // muncul di TENGAH string `.or(...)` (setelah koma), bukan cuma yang
  // pertama tepat setelah tanda kutip pembuka.
  const polaOrIdentitas = /[,'"`](id|\w*_id)\.(?:ilike|like)\./g;

  it("bentuk metode .ilike(\"id\"|\"*_id\", …) tidak dipakai sama sekali", () => {
    expect(sumberLib).not.toMatch(polaMetodeIdentitas);
  });

  it('bentuk .filter("id"|"*_id", "ilike"|"like", …) tidak dipakai sama sekali', () => {
    expect(sumberLib).not.toMatch(polaFilterIdentitas);
  });

  it("bentuk string .or(...) HANYA mengizinkan padma_id — kolom identitas lain ditolak", () => {
    const kolom = [...sumberLib.matchAll(polaOrIdentitas)].map((m) => m[1]);

    // Pagar bergigi: `ambilDaftarKlien` SUNGGUHAN memang mencocokkan
    // `padma_id` dengan pola. Bila daftar ini kosong, dua `expect` di bawah
    // lolos HAMPA — pagar tidak pernah benar-benar menyala.
    expect(kolom.length).toBeGreaterThan(0);

    // Ruling: `padma_id` DIKECUALIKAN, dan pengecualiannya bukan sekadar
    // menyebut namanya. `grep -rn '\.eq("padma_id"' src/` memulangkan NOL
    // hasil — kolom ini ditulis SEKALI saat klien dibuat (`buatKlien`) lalu
    // hanya ditampilkan; ia tidak pernah menjadi kunci pembanding identitas
    // yang menjaga baris siapa yang boleh dibaca. Mencocokkannya dengan pola
    // karena itu tidak bisa meloloskan baris milik orang lain ke dalam
    // sebuah perbandingan identitas — beda dari `id`/`user_id`/`client_id`,
    // yang memang dipakai begitu. Dan PADMA ID justru DIRANCANG untuk
    // dicari: itulah yang dibacakan klien lewat telepon saat admin tidak
    // ingat namanya.
    for (const k of kolom) expect(k).toBe("padma_id");
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas server action
// ---------------------------------------------------------------------------

describe("berkas server action klien", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    // buatKlien, perbaruiKlien, terbitkanUndangan. Angkanya sengaja PERSIS:
    // action yang lahir tanpa penjaga peran adalah endpoint POST terbuka.
    expect(jumlahAction).toBe(3);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberDaftar, sumberDetail, sumberForm, sumberLib, sumberBaru]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
    // `sumberDaftar` (page.tsx) TIDAK lagi menyentuh Supabase secara langsung
    // sejak Task 9 — pembacaannya dipusatkan di `ambilDaftarKlien` (`sumberLib`,
    // diperiksa di bawah), jadi guard "sesi pengguna" untuk halaman ini
    // ditegakkan secara transitif, bukan lewat string literal di berkasnya
    // sendiri.
    expect(sumberDetail).toContain("createServerSupabase");
    expect(sumberLib).toContain("createServerSupabase");
    // `sumberBaru` (rute /baru, Task 9) mengambil `phases` langsung lewat
    // sesi pengguna — beda dari `sumberDaftar`, ia BELUM didelegasikan ke
    // lapisan lib manapun, jadi diperiksa literal di sini.
    expect(sumberBaru).toContain("createServerSupabase");
  });

  it("tidak menuliskan PII klien ke log", () => {
    for (const sumber of [sumberAksi, sumberDaftar, sumberDetail, sumberForm, sumberLib, sumberBaru]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });
});
