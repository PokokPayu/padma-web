import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { signInAs } from "./helpers/as-user";
import { PESAN_PRODUK } from "@/lib/produk/status";

const AKAR = path.resolve(__dirname, "..");
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) await svc.from("digital_products").delete().eq("id", bersihkan.pop()!);
});

async function produkUji(slug: string): Promise<string> {
  const { data } = await createAdminSupabase().from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf" }).select("id").single();
  bersihkan.push(data!.id);
  return data!.id;
}

describe("harga produk di panel owner", () => {
  it("rute terdaftar di README", () => {
    expect(readFileSync(path.join(AKAR, "README.md"), "utf8")).toContain("| `/owner/produk` |");
  });

  it("aksi owner dibuka requireRole(['owner'])", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/owner/produk/aksi.ts"), "utf8");
    expect(sumber).toContain(`requireRole(["owner"])`);
    expect(sumber).not.toContain("createAdminSupabase");
  });

  it("owner bisa menetapkan harga, dan harganya jadi BARIS BARU", async () => {
    const id = await produkUji("uji-owner-tetapkan");
    const owner = await signInAs("owner@padma.test");

    const { error: satu } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 100_000, berlaku_sejak: "2026-01-01" });
    expect(satu).toBeNull();

    const { error: dua } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 120_000, berlaku_sejak: "2026-02-01" });
    expect(dua).toBeNull();

    const { data } = await owner.from("digital_product_prices")
      .select("harga").eq("product_id", id);
    expect((data ?? []).length).toBe(2);
  });

  it("dua harga pada tanggal berlaku yang SAMA ditolak", async () => {
    const id = await produkUji("uji-owner-kembar");
    const owner = await signInAs("owner@padma.test");
    await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 10_000, berlaku_sejak: "2026-03-01" });
    const { error } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 20_000, berlaku_sejak: "2026-03-01" }).select("id");
    expect(error?.code).toBe("23505");
  });

  it("harga 0 sah dan berarti produk gratis", async () => {
    const id = await produkUji("uji-owner-gratis");
    const owner = await signInAs("owner@padma.test");
    const { error } = await owner.from("digital_product_prices")
      .insert({ product_id: id, harga: 0 });
    expect(error).toBeNull();

    const { data } = await owner.from("produk_harga_staf")
      .select("harga").eq("product_id", id).single();
    expect(data!.harga).toBe(0);
  });

  it("view publik memulangkan harga TERBARU yang sudah berlaku, bukan yang pertama", async () => {
    const svc = createAdminSupabase();
    const id = await produkUji("uji-owner-terbaru");
    await svc.from("digital_products").update({ aktif: true }).eq("id", id);
    await svc.from("digital_product_prices")
      .insert({ product_id: id, harga: 100_000, berlaku_sejak: "2026-01-01" });
    await svc.from("digital_product_prices")
      .insert({ product_id: id, harga: 80_000, berlaku_sejak: "2026-02-01" });

    const owner = await signInAs("owner@padma.test");
    const { data } = await owner.from("harga_produk_publik")
      .select("harga").eq("product_id", id).single();
    expect(data!.harga).toBe(80_000);
  });
});

// ============================================================================
// Fix round 1, Temuan 3: pemanggilan LANGSUNG `tetapkanHargaProduk`.
// ============================================================================
// Sebelumnya berkas ini hanya menembak `digital_product_prices` lewat REST
// mentah — seluruh perilaku ACTION-nya sendiri (tanggal mundur, tanggal
// kembar, `periksaHargaCoretProduk`, pemetaan 23514, cabang array-kosong,
// dan penjaga peran) tidak pernah diuji. Mengikuti pola
// `tests/owner-tarif.test.ts` persis: `@/lib/supabase/server` di-mock supaya
// action bisa dipanggil dengan sesi pengguna SUNGGUHAN yang disuntikkan
// (RLS & `requireRole` tetap berjalan apa adanya), bukan lewat HTTP Next.js
// yang tidak tersedia di Vitest.
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

// `redirect` MELEMPAR: kalau penjaga peran memanggilnya, test harus gagal
// keras, bukan diam-diam melanjutkan mutasi harga.
vi.mock("next/navigation", () => ({
  redirect: (ke: string) => {
    throw new Error(`REDIRECT ${ke}`);
  },
}));

const { tetapkanHargaProduk } = await import("@/app/owner/produk/aksi");

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

type BarisHarga = {
  id: string;
  harga: number;
  harga_coret: number | null;
  berlaku_sejak: string;
};

/** Seluruh baris harga satu PRODUK, dibaca lewat SERVICE ROLE (bukan RLS). */
async function hargaProduk(productId: string): Promise<BarisHarga[]> {
  const { data } = await createAdminSupabase()
    .from("digital_product_prices")
    .select("id, harga, harga_coret, berlaku_sejak")
    .eq("product_id", productId)
    .order("berlaku_sejak")
    .returns<BarisHarga[]>();
  return data ?? [];
}

describe("tetapkanHargaProduk — pemanggilan langsung action", () => {
  const admin = createAdminSupabase();
  const HARI_INI = hariIniJakarta();
  const BERLAKU_LAMA = "2020-01-06";
  const MUNDUR_SEHARI = geserHari(BERLAKU_LAMA, -1);

  let sesiOwner: SupabaseClient;
  let sesiAdmin: SupabaseClient;
  let sesiKlien: SupabaseClient;

  let produkBaru: string;
  let produkMundur: string;

  beforeAll(async () => {
    sesiOwner = await signInAs("owner@padma.test");
    sesiAdmin = await signInAs("admin@padma.test");
    sesiKlien = await signInAs("ananda@padma.test");
  });

  beforeEach(async () => {
    ref.sesi = sesiOwner;
    jejak.revalidate.length = 0;

    // Produk fixture baru per test — lebih sederhana daripada berbagi satu
    // produk lintas test (riwayat harga di sini APPEND-ONLY, jadi berbagi
    // satu produk membuat test-test soal "tanggal terakhir" saling
    // mengganggu urutan eksekusi).
    const { data: baru } = await admin.from("digital_products")
      .insert({ judul: "PAD-UJI Aksi Produk Baru", slug: `pad-uji-aksi-baru-${Date.now()}-${Math.random()}`, jenis: "pdf" })
      .select("id").single();
    produkBaru = baru!.id;

    const { data: mundur } = await admin.from("digital_products")
      .insert({ judul: "PAD-UJI Aksi Produk Mundur", slug: `pad-uji-aksi-mundur-${Date.now()}-${Math.random()}`, jenis: "pdf" })
      .select("id").single();
    produkMundur = mundur!.id;
    await admin.from("digital_product_prices")
      .insert({ product_id: produkMundur, harga: 50_000, berlaku_sejak: BERLAKU_LAMA });
  });

  afterEach(async () => {
    await admin.from("digital_products").delete().eq("id", produkBaru);
    await admin.from("digital_products").delete().eq("id", produkMundur);
  });

  it("produk yang belum bertarif memperoleh baris pertamanya", async () => {
    expect(await hargaProduk(produkBaru)).toHaveLength(0);

    const hasil = await tetapkanHargaProduk(
      formulir({ produk: produkBaru, harga: "150000", mulai: HARI_INI }),
    );
    expect(hasil.ok).toBe(true);

    const baris = await hargaProduk(produkBaru);
    expect(baris).toHaveLength(1);
    expect(baris[0]).toMatchObject({ harga: 150_000, berlaku_sejak: HARI_INI });
  });

  it("harga 0 diterima dan berarti GRATIS, medan kosong ditolak", async () => {
    const nol = await tetapkanHargaProduk(
      formulir({ produk: produkBaru, harga: "0", mulai: HARI_INI }),
    );
    expect(nol.ok).toBe(true);
    expect((await hargaProduk(produkBaru))[0]).toMatchObject({ harga: 0 });

    const kosong = await tetapkanHargaProduk(
      formulir({ produk: produkMundur, harga: "", mulai: geserHari(HARI_INI, 200) }),
    );
    expect(kosong.ok).toBe(false);
    if (kosong.ok) return;
    expect(kosong.pesan).toBe(PESAN_PRODUK.hargaWajib);
  });

  it("tanggal berlaku kosong berarti HARI INI menurut kalender Jakarta", async () => {
    const hasil = await tetapkanHargaProduk(
      formulir({ produk: produkBaru, harga: "200000", mulai: "" }),
    );
    expect(hasil.ok).toBe(true);
    const baris = await hargaProduk(produkBaru);
    expect(baris.map((b) => b.berlaku_sejak)).toContain(HARI_INI);
  });

  it("menyegarkan /owner/produk, /admin/produk, /produk, dan /", async () => {
    await tetapkanHargaProduk(formulir({ produk: produkBaru, harga: "1000", mulai: HARI_INI }));
    for (const p of ["/owner/produk", "/admin/produk", "/produk", "/"]) {
      expect(jejak.revalidate, `lupa merevalidasi ${p}`).toContain(p);
    }
  });

  describe("penolakan — dengan KALIMAT, bukan kode Postgres", () => {
    function pesanManusiawi(pesan: string) {
      expect(pesan).not.toMatch(/\b(23505|23514|42501|23503|22P02)\b/);
      expect(pesan.length).toBeGreaterThan(5);
    }

    it("tanggal berlaku MUNDUR ditolak tanpa menyentuh basis data", async () => {
      const sebelum = await hargaProduk(produkMundur);

      const hasil = await tetapkanHargaProduk(
        formulir({ produk: produkMundur, harga: "999000", mulai: MUNDUR_SEHARI }),
      );
      expect(hasil.ok).toBe(false);
      if (hasil.ok) return;
      expect(hasil.pesan).toMatch(/tidak boleh mundur/i);
      pesanManusiawi(hasil.pesan);

      expect(await hargaProduk(produkMundur)).toEqual(sebelum);
    });

    it("harga pada tanggal KEMBAR ditolak", async () => {
      const sebelum = await hargaProduk(produkMundur);

      const hasil = await tetapkanHargaProduk(
        formulir({ produk: produkMundur, harga: "999000", mulai: BERLAKU_LAMA }),
      );
      expect(hasil.ok).toBe(false);
      if (hasil.ok) return;
      expect(hasil.pesan).toMatch(/sudah ada harga/i);
      pesanManusiawi(hasil.pesan);

      expect(await hargaProduk(produkMundur)).toEqual(sebelum);
    });

    // Temuan 3 (fix round 1): `periksaHargaCoretProduk` sudah diuji sebagai
    // fungsi murni (Task 4), tetapi tidak lewat action sungguhan. Batasnya
    // ganda — SAMA dengan harga (ditolak) ditolak, dan LEBIH MURAH dari harga
    // ditolak — keduanya berhenti di validator TypeScript ini SEBELUM basis
    // data pernah disentuh, dan keduanya memulangkan kalimat yang PERSIS sama
    // dengan `PESAN_PRODUK.coretLebihMurah` yang dipetakan dari 23514 di
    // `aksi.ts` — pesan yang dilihat pemiliknya tidak pernah berbeda
    // tergantung lapisan mana yang menangkapnya.
    it("harga coret SAMA DENGAN atau LEBIH MURAH dari harga ditolak — pesannya PESAN_PRODUK.coretLebihMurah", async () => {
      for (const [label, coret] of [["sama", "150000"], ["lebih murah", "100000"]] as const) {
        const sebelum = await hargaProduk(produkBaru);

        const hasil = await tetapkanHargaProduk(
          formulir({
            produk: produkBaru,
            harga: "150000",
            harga_coret: coret,
            mulai: geserHari(HARI_INI, 210),
          }),
        );
        expect(hasil.ok, `coret ${label} seharusnya ditolak`).toBe(false);
        if (hasil.ok) continue;
        expect(hasil.pesan).toBe(PESAN_PRODUK.coretLebihMurah);
        pesanManusiawi(hasil.pesan);

        expect(await hargaProduk(produkBaru)).toEqual(sebelum);
      }
    });

    it("produk kosong & produk yang tidak ada ditolak dengan kalimat", async () => {
      const PRODUK_HANTU = "11111111-1111-1111-1111-111111111111";
      for (const id of ["", PRODUK_HANTU, "bukan-uuid"]) {
        const hasil = await tetapkanHargaProduk(
          formulir({ produk: id, harga: "100000", mulai: geserHari(HARI_INI, 220) }),
        );
        expect(hasil.ok, `produk="${id}" seharusnya ditolak`).toBe(false);
        if (hasil.ok) continue;
        expect(hasil.pesan).toMatch(/produk/i);
        pesanManusiawi(hasil.pesan);
      }
    });

    it("nominal kosong, negatif, pecahan, dan bukan angka semuanya ditolak", async () => {
      const sebelum = await hargaProduk(produkBaru);
      for (const nilai of ["", " ", "-1", "12.5", "abc", "1e6", "400_000"]) {
        const hasil = await tetapkanHargaProduk(
          formulir({ produk: produkBaru, harga: nilai, mulai: geserHari(HARI_INI, 230) }),
        );
        expect(hasil.ok, `harga="${nilai}" seharusnya ditolak`).toBe(false);
        if (hasil.ok) continue;
        pesanManusiawi(hasil.pesan);
      }
      expect(await hargaProduk(produkBaru)).toEqual(sebelum);
    });

    it("tanggal tidak sah ditolak", async () => {
      for (const tgl of ["30-08-2026", "2026-8-1", "besok", "2026-02-31"]) {
        const hasil = await tetapkanHargaProduk(
          formulir({ produk: produkBaru, harga: "100000", mulai: tgl }),
        );
        expect(hasil.ok, `mulai="${tgl}" seharusnya ditolak`).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // PENJAGA PERAN: layout TIDAK menjaga server action
  // ---------------------------------------------------------------------------
  describe("penjaga peran di DALAM action — layout tidak menjaga server action", () => {
    it("ADMIN yang login DITOLAK, dan tidak satu baris pun tersisip", async () => {
      const sebelum = await hargaProduk(produkBaru);

      ref.sesi = sesiAdmin;
      await expect(
        tetapkanHargaProduk(
          formulir({ produk: produkBaru, harga: "1", mulai: geserHari(HARI_INI, 240) }),
        ),
      ).rejects.toThrow(/REDIRECT/);

      expect(await hargaProduk(produkBaru)).toEqual(sebelum);
    });

    it("KLIEN yang login DITOLAK", async () => {
      ref.sesi = sesiKlien;
      await expect(
        tetapkanHargaProduk(
          formulir({ produk: produkBaru, harga: "1", mulai: geserHari(HARI_INI, 241) }),
        ),
      ).rejects.toThrow(/REDIRECT/);
    });
  });
});
