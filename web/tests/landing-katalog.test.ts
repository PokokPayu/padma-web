import { describe, it, expect } from "vitest";
import { anonClient } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { bacaKatalog } from "@/lib/katalog";
import { bacaPengaturan } from "@/lib/settings";

describe("katalog publik", () => {
  it("pengunjung anonim bisa membaca phases (policy baca publik)", async () => {
    const { data, error } = await anonClient().from("phases").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBe(5);
  });

  it("pengunjung anonim bisa membaca services aktif", async () => {
    const { data, error } = await anonClient().from("services").select("id, nama");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });

  it("anon TETAP tidak bisa membaca data pasien", async () => {
    const { error } = await anonClient().from("clients").select("*");
    expect(error?.code).toBe("42501");
  });

  it("bacaKatalog mengembalikan 5 fase berurutan dengan layanannya", async () => {
    const katalog = await bacaKatalog();
    expect(katalog).toHaveLength(5);
    expect(katalog[0].namaSanskrit).toBe("Sankalpa");
    expect(katalog[0].urutan).toBe(1);
    expect(katalog[0].layanan.length).toBeGreaterThan(0);
  });

  it("bacaPengaturan mengembalikan nomor WA dua bentuk", async () => {
    const s = await bacaPengaturan();
    expect(s.nomorWaLink).toMatch(/^\d{10,15}$/); // internasional tanpa +
    expect(s.nomorWaTampilan).toMatch(/^0[\d-]+$/); // format lokal
  });
});

/**
 * Policy baca publik membuka BARIS, bukan operasi. Batas itu diuji terpisah
 * supaya "landing bisa tampil" tidak pelan-pelan berubah menjadi "pengunjung
 * bisa menyunting katalog", dan supaya filter `aktif = true` tidak hilang
 * diam-diam (layanan yang sudah dinonaktifkan admin akan muncul kembali).
 */
describe("batas policy baca publik", () => {
  it("anon TIDAK bisa menulis katalog meski boleh membacanya", async () => {
    const anon = anonClient();

    const tambahFase = await anon
      .from("phases")
      .insert({ id: "palsu", nama_sanskrit: "X", nama: "X", urutan: 9 });
    expect(tambahFase.error?.code).toBe("42501");

    // uuid sentinel yang pasti tidak ada — filternya harus valid supaya yang
    // ditolak benar-benar HAK TABEL (42501), bukan sintaks uuid (22P02).
    const TAK_ADA = "00000000-0000-0000-0000-000000000000";

    const ubahLayanan = await anon
      .from("services")
      .update({ nama: "Disusupi" })
      .neq("id", TAK_ADA);
    expect(ubahLayanan.error?.code).toBe("42501");

    const hapusPaket = await anon.from("packages").delete().neq("id", TAK_ADA);
    expect(hapusPaket.error?.code).toBe("42501");
  });

  it("layanan yang dinonaktifkan hilang dari katalog publik, tetap terlihat server", async () => {
    const admin = createAdminSupabase();
    const { data: sebelum } = await anonClient().from("services").select("id");
    const target = sebelum![0].id as string;

    await admin.from("services").update({ aktif: false }).eq("id", target);
    try {
      const { data: sesudah, error } = await anonClient().from("services").select("id");
      expect(error).toBeNull();
      expect(sesudah!.length).toBe(sebelum!.length - 1);
      expect(sesudah!.map((s) => s.id)).not.toContain(target);

      // Barisnya tidak hilang — hanya tidak lagi dipublikasikan.
      const { data: internal } = await admin.from("services").select("id").eq("id", target);
      expect(internal).toHaveLength(1);

      const katalog = await bacaKatalog();
      expect(katalog.flatMap((f) => f.layanan)).toHaveLength(sebelum!.length - 1);
    } finally {
      await admin.from("services").update({ aktif: true }).eq("id", target);
    }
  });

  it("fase newborn ADA di katalog landing (5 fase) — pembatasan 4 fase hanya di skrining", async () => {
    const katalog = await bacaKatalog();
    expect(katalog.map((f) => f.id)).toEqual([
      "prekonsepsi",
      "kehamilan",
      "nifas",
      "menopause",
      "newborn",
    ]);
  });
});
