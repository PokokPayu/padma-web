/**
 * Lapisan data daftar klien (`ambilDaftarKlien`) — dipisah dari
 * `admin-klien.test.ts` yang menguji halaman & server action, supaya
 * saringan dan paginasi bisa diuji tanpa merender markup.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));

const { ambilDaftarKlien } = await import("@/lib/admin/klien");
const admin = createAdminSupabase();

// Klien seed lain (`scripts/seed-users.ts`) — dipakai sebagai bukti EKSKLUSI
// pada uji pencarian: nama & PADMA ID-nya tidak mengandung "ananda", jadi ia
// tidak boleh pernah muncul di hasil cari "ananda". Lihat Fix Round 1 Temuan
// 2: tanpa baris negatif ini, uji hanya membuktikan INKLUSI — dan `cari`
// yang diabaikan sama sekali (mengembalikan SEMUA klien) tetap lolos, karena
// baris positifnya kebetulan ikut dalam himpunan "semua klien".
const RINA = "44444444-4444-4444-4444-444444444402";

beforeAll(async () => { ref.sesi = await signInAs("admin@padma.test"); });

describe("ambilDaftarKlien", () => {
  it("mencari menurut nama DAN PADMA ID", async () => {
    // PADMA ID adalah yang dibacakan klien lewat telepon; nama adalah yang
    // diingat admin. Keduanya harus menemukan baris yang sama.
    const lewatNama = await ambilDaftarKlien({ cari: "ananda", saring: {}, hal: 1 });
    expect(lewatNama.baris.length).toBeGreaterThan(0);
    const target = lewatNama.baris[0];
    // EKSKLUSI: Rina tidak cocok "ananda" sama sekali — bila `cari` diam-diam
    // diabaikan (SEMUA klien dikembalikan), baris ini yang merah.
    expect(lewatNama.baris.map((k) => k.id)).not.toContain(RINA);

    const lewatId = await ambilDaftarKlien({ cari: target.padmaId, saring: {}, hal: 1 });
    expect(lewatId.baris.map((k) => k.id)).toContain(target.id);
    // EKSKLUSI yang sama pada jalur PADMA ID: PADMA ID Ananda tidak cocok
    // PADMA ID Rina, jadi Rina tidak boleh ikut terjaring.
    expect(lewatId.baris.map((k) => k.id)).not.toContain(RINA);
  });

  it("menyaring klien yang BELUM aktivasi", async () => {
    const { baris } = await ambilDaftarKlien({ cari: "", saring: { aktivasi: "belum" }, hal: 1 });
    expect(baris.every((k) => !k.aktif)).toBe(true);
  });

  it("total tidak ikut terpotong halaman", async () => {
    const { baris, total } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(total).toBeGreaterThanOrEqual(baris.length);
  });

  it("hanya paket BERSTATUS AKTIF yang menjadi identitas baris", async () => {
    // Paket lama tidak menggantikan gambaran "sedang menjalani apa".
    const { baris } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    for (const k of baris.filter((b) => b.paketAktif !== null)) {
      const { data } = await admin
        .from("client_packages")
        .select("status")
        .eq("client_id", k.id)
        .eq("status", "aktif");
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });

  it("TIDAK memulangkan satu pun nominal rupiah", async () => {
    // Money firewall: /admin tidak melihat angka uang. Paket dipulangkan
    // sebagai NAMA, bukan harganya.
    const { baris } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(JSON.stringify(baris)).not.toMatch(/harga|nominal|honor/i);
  });
});

// ---------------------------------------------------------------------------
// Fix Round 1, Temuan 1: cabang `saring.paket === "ada"` TIDAK teruji sama
// sekali di draf awal. Membalik kondisinya menjadi `!== "ada"` — klien TANPA
// paket yang justru tampil saat saringan "punya paket" dinyalakan — akan
// lolos hijau tanpa fixture di bawah ini. Hooks DILINGKUPI ke describe ini
// (bukan puncak berkas) supaya fixturenya tidak ikut menyentuh uji lain.
// ---------------------------------------------------------------------------

const KLIEN_PAKET_UJI = "44444444-4444-4444-4444-4444444444d1";
const KLIEN_KOSONG_UJI = "44444444-4444-4444-4444-4444444444d2";
// "Sankalpa Prima" — satu-satunya paket seed (`supabase/seed.sql`).
const PAKET_SEED = "22222222-2222-2222-2222-222222222201";

describe("ambilDaftarKlien — saring.paket = 'ada' (dua arah)", () => {
  beforeAll(async () => {
    // Jaga-jaga sisa run yang terhenti di tengah jalan sebelum insert.
    await admin.from("clients").delete().in("id", [KLIEN_PAKET_UJI, KLIEN_KOSONG_UJI]);
    await admin.from("clients").insert([
      {
        id: KLIEN_PAKET_UJI,
        padma_id: "ZZ-UJI-DATA-PAKET",
        nama: "ZZ Uji Data Berpaket",
        email: "zz-uji-data-paket@padma.test",
        phase_id: "prekonsepsi",
      },
      {
        id: KLIEN_KOSONG_UJI,
        padma_id: "ZZ-UJI-DATA-KOSONG",
        nama: "ZZ Uji Data Tanpa Paket",
        email: "zz-uji-data-kosong@padma.test",
        phase_id: "prekonsepsi",
      },
    ]);
    // Hanya KLIEN_PAKET_UJI yang mendapat baris `client_packages`;
    // KLIEN_KOSONG_UJI sengaja dibiarkan tanpa satu pun.
    await admin.from("client_packages").insert({
      client_id: KLIEN_PAKET_UJI,
      package_id: PAKET_SEED,
      status: "aktif",
    });
  });

  afterAll(async () => {
    // Sesi & client_packages ikut tersapu lewat cascade `clients` (service
    // role, tidak terikat pencabutan DELETE milik `authenticated`).
    await admin.from("clients").delete().in("id", [KLIEN_PAKET_UJI, KLIEN_KOSONG_UJI]);
  });

  it("baseline: keduanya muncul TANPA saring.paket (fixture benar-benar ada)", async () => {
    // Tanpa baris ini, fixture yang gagal lahir tidak akan pernah kelihatan —
    // dua `expect` di uji dua-arah di bawah bisa lolos hampa bila keduanya
    // sama-sama tidak ada.
    const { baris } = await ambilDaftarKlien({ cari: "ZZ Uji Data", saring: {}, hal: 1 });
    const id = baris.map((k) => k.id);
    expect(id).toContain(KLIEN_PAKET_UJI);
    expect(id).toContain(KLIEN_KOSONG_UJI);
  });

  it("saring.paket = 'ada': klien BERPAKET AKTIF ikut, klien TANPA paket TIDAK", async () => {
    // Dua arah dalam SATU uji, sengaja: kondisi yang terbalik
    // (`!== "ada"` alih-alih `=== "ada"`) memulangkan HIMPUNAN YANG PERSIS
    // TERBALIK — KLIEN_KOSONG_UJI muncul dan KLIEN_PAKET_UJI hilang. Menguji
    // satu arah saja tidak membedakan saringan yang bekerja dari saringan
    // yang terbalik atau yang mati total.
    const { baris } = await ambilDaftarKlien({
      cari: "ZZ Uji Data",
      saring: { paket: "ada" },
      hal: 1,
    });
    const id = baris.map((k) => k.id);
    expect(id).toContain(KLIEN_PAKET_UJI);
    expect(id).not.toContain(KLIEN_KOSONG_UJI);
  });
});
