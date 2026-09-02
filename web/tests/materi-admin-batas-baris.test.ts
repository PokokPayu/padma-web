// tests/materi-admin-batas-baris.test.ts
//
// Bukti PERILAKU untuk Fix 2 (final review branch materi-ebook-pdf):
// `daftarMateriAdmin()` (src/lib/admin/materi-admin.ts) dulu menghitung
// jumlah halaman dengan `supabase.from("material_pages").select("material_id")`
// TANPA `.range()` maupun agregat — satu baris PostgREST per HALAMAN, ditarik
// dari SELURUH klinik sekaligus. PostgREST membatasi jawaban pada
// `db-max-rows` (1000, lihat supabase/config.toml & PGRST_DB_MAX_ROWS
// container ini): begitu total baris `material_pages` klinik melewati 1000,
// halaman di luar potongan pertama lenyap dari peta yang dibangun di JS, dan
// materi yang barisnya jatuh sesudahnya melaporkan `jumlahHalaman: 0` ->
// `lengkap: false` — sementara `aktifkanMateri` (count berskop satu materi,
// kebal `max_rows`) tetap menjawab benar. Panel mengundang admin mengunggah
// ulang materi yang sebenarnya sudah lengkap, tepat jalur yang membuka Fix 1.
//
// Perbaikannya memakai embed AGREGAT `material_pages(count)`: PostgREST
// menghitung COUNT(*) di balik RLS SEBELUM mengembalikan baris, jadi jawaban
// yang dikirim adalah satu integer per materi — tidak pernah larik satu baris
// per halaman — dan karena itu KEBAL `max_rows` berapa pun banyaknya halaman
// materi tersebut. Test ini membuktikannya dengan SATU materi yang sendirian
// sudah melewati 1000 halaman: dengan query lama, baris `material_id`
// materi ini SENDIRI sudah tidak mungkin seluruhnya lolos dalam satu jawaban
// 1000-baris (apa pun urutannya) — jadi jumlahHalaman yang benar (1100) hanya
// bisa muncul lewat agregat, tidak pernah lewat penghitungan baris di JS.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { namaObjekHalaman } from "@/lib/materi/rasterisasi";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const { daftarMateriAdmin } = await import("@/lib/admin/materi-admin");

// 1100 dipilih: melewati max_rows (1000) dengan margin yang tidak bisa
// disalahkan sebagai "pas kebetulan" (mis. off-by-one di batasnya), sambil
// tetap satu RPC INSERT...SELECT tunggal (milidetik, bukan detik).
const JUMLAH_HALAMAN = 1100;

describe("daftarMateriAdmin — jumlahHalaman tidak terpotong PostgREST max_rows (Fix 2)", () => {
  let materiId = "";

  beforeAll(async () => {
    const { data: m } = await admin
      .from("materials")
      .insert({ judul: "PAD-UJI-CAP-HALAMAN", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id")
      .single();
    materiId = m!.id as string;

    const { data: n, error } = await admin.rpc("ganti_halaman_materi", {
      p_material_id: materiId,
      p_halaman: Array.from({ length: JUMLAH_HALAMAN }, (_, i) => ({
        halaman: i + 1,
        objek: namaObjekHalaman(materiId, i + 1),
        lebar: 10,
        tinggi: 10,
      })),
    });
    if (error) throw error;
    expect(n).toBe(JUMLAH_HALAMAN);
  });

  afterAll(async () => {
    if (materiId) await admin.from("materials").delete().eq("id", materiId);
  });

  it("melaporkan SELURUH 1100 halaman, bukan terpotong di 1000 ataupun 0", async () => {
    ref.sesi = await signInAs("admin@padma.test");
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    const materi = semua.find((m) => m.id === materiId);
    expect(materi, "materi uji tidak ditemukan di daftarMateriAdmin()").toBeTruthy();
    expect(materi!.jumlahHalaman).toBe(JUMLAH_HALAMAN);
    expect(materi!.lengkap).toBe(true);
  });
});
