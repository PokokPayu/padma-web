/**
 * Aksi hapus artikel & testimoni di panel admin — lewat RPC, bukan `.delete()`.
 *
 * Sejak migration 20261112100000 verba DELETE atas `articles` dan
 * `testimonials` dicabut dari peran API. Uji ini memastikan tombol hapus di
 * panel TETAP hidup: aksinya dipanggil sungguhan dengan sesi admin nyata, jadi
 * nama RPC atau nama parameter yang salah ketik langsung merah — bukan baru
 * ketahuan saat admin menekan tombol di produksi.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

// vitest tidak ada cookie: klien ber-SESI SUNGGUHAN disuntikkan, sehingga RLS,
// hak tabel, dan requireRole berjalan apa adanya.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejak = vi.hoisted(() => ({ revalidate: [] as string[], r2Dihapus: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejak.revalidate.push(p);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
// R2 sungguhan TIDAK disentuh: yang diuji adalah objek MANA yang diminta
// dihapus, bukan bucket-nya.
vi.mock("@/lib/r2", () => ({
  hapusObjekVideo: async (objek: string) => {
    jejak.r2Dihapus.push(objek);
  },
  urlUnggahVideo: async () => "http://r2.tiruan/unggah",
}));

const { hapusArtikel } = await import("@/app/admin/artikel/aksi");
const { hapusTestimoni } = await import("@/app/admin/testimoni/aksi");

const svc = createAdminSupabase();

const ARTIKEL_UJI = "a1a1a1a1-0000-4000-8000-0000000009c1";
const TESTIMONI_UJI = "a1a1a1a1-0000-4000-8000-0000000009c2";
const OBJEK_UJI = `testimoni/${TESTIMONI_UJI}/pad-uji-aksi.mp4`;
const TIDAK_ADA = "a1a1a1a1-0000-4000-8000-0000000009cf";

beforeEach(async () => {
  jejak.revalidate = [];
  jejak.r2Dihapus = [];
  ref.sesi = await signInAs("admin@padma.test");
  await svc.from("articles").upsert(
    { id: ARTIKEL_UJI, slug: "pad-uji-hapus-aksi", judul: "PAD-UJI aksi hapus" },
    { onConflict: "id" },
  );
  await svc.from("testimonials").upsert(
    { id: TESTIMONI_UJI, nama: "PAD-UJI aksi", video_objek: OBJEK_UJI, video_mime: "video/mp4" },
    { onConflict: "id" },
  );
});

afterAll(async () => {
  await svc.from("articles").delete().eq("id", ARTIKEL_UJI);
  await svc.from("testimonials").delete().eq("id", TESTIMONI_UJI);
});

describe("hapusArtikel", () => {
  it("menghapus tepat artikel itu dan merevalidasi halamannya", async () => {
    const hasil = await hapusArtikel(ARTIKEL_UJI);
    expect(hasil).toEqual({ ok: true });

    const { data } = await svc.from("articles").select("id").eq("id", ARTIKEL_UJI);
    expect(data).toHaveLength(0);
    expect(jejak.revalidate).toContain("/artikel/pad-uji-hapus-aksi");
  });

  it("artikel yang tidak ada → gagal, tidak berpura-pura berhasil", async () => {
    expect(await hapusArtikel(TIDAK_ADA)).toEqual({ ok: false, pesan: "Gagal menghapus artikel." });
  });
});

describe("hapusTestimoni", () => {
  it("menghapus testimoni dan meminta objek videonya dibersihkan dari R2", async () => {
    const hasil = await hapusTestimoni(TESTIMONI_UJI);
    expect(hasil).toEqual({ ok: true, objekTersisa: false });

    const { data } = await svc.from("testimonials").select("id").eq("id", TESTIMONI_UJI);
    expect(data).toHaveLength(0);
    expect(jejak.r2Dihapus).toEqual([OBJEK_UJI]);
  });

  it("testimoni yang tidak ada → gagal, dan R2 tidak disentuh", async () => {
    expect(await hapusTestimoni(TIDAK_ADA)).toEqual({ ok: false, pesan: "Gagal menghapus testimoni." });
    expect(jejak.r2Dihapus).toEqual([]);
  });
});
