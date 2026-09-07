import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => "admin" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

// `ambilDaftarMitra` memakai SESI PENGGUNA (`createServerSupabase`), bukan
// service role — RLS `partners: staf` yang mengizinkan bacaannya. Di vitest
// tidak ada cookie untuk `cookies()` disuntikkan lewat request Next asli,
// jadi klien ber-SESI SUNGGUHAN disuntikkan di sini, pola yang sama dengan
// tests/admin-mitra.test.ts dan tests/owner-rekap-halaman.test.ts.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

beforeAll(async () => {
  ref.sesi = await signInAs("admin@padma.test");
});

const { default: HalamanMitra } = await import("@/app/admin/mitra/page");

const render = async (sp: Record<string, string>) =>
  renderToStaticMarkup(await HalamanMitra({ searchParams: Promise.resolve(sp) }));

/**
 * Nama mitra pada baris yang menaut ke `?ubah=<id>` di markup DAFTAR
 * (dirender TANPA panel terbuka).
 *
 * Diambil dari markup, bukan di-hardcode: `<b>{nama}</b>` dan tautan "Ubah"
 * duduk berurutan di dalam `<tr>` yang sama (lihat page.tsx), jadi `<b>`
 * TERAKHIR sebelum posisi href adalah nama baris itu sendiri.
 */
function namaBarisId(daftar: string, id: string): string {
  const posHref = daftar.search(new RegExp(`href="[^"]*ubah=${id}"`));
  expect(posHref, `href ubah=${id} tidak ditemukan di markup daftar`).toBeGreaterThanOrEqual(0);
  const semuaNama = [...daftar.slice(0, posHref).matchAll(/<b>([^<]*)<\/b>/g)];
  expect(semuaNama.length, "tidak ada <b>nama</b> sebelum tautan ubah").toBeGreaterThan(0);
  return semuaNama[semuaNama.length - 1][1];
}

describe("halaman /admin/mitra", () => {
  it("TIDAK ada formulir di dalam sel tabel lagi", async () => {
    // Inti keluhan klien. Formulir di dalam <td> membuat baris memuai dan
    // kolom melenceng; uji ini yang menjaganya tidak kembali.
    const m = await render({});
    expect(m).not.toMatch(/<td[^>]*>[\s\S]*?<input[^>]*name="nama"/);
  });

  it("menampilkan bilah cari dan tombol mitra baru", async () => {
    const m = await render({});
    expect(m).toContain('name="cari"');
    expect(m).toContain("ubah=baru");
  });

  it("TIDAK merender panel geser tanpa ?ubah", async () => {
    expect(await render({})).not.toContain('role="dialog"');
  });

  it("merender panel geser BERISI DATA baris saat ?ubah=<id>", async () => {
    const daftar = await render({});
    const id = /href="\/admin\/mitra\?ubah=([0-9a-f-]{36})"/.exec(daftar)?.[1];
    expect(id).toBeDefined();
    // Nama SESUNGGUHNYA baris ini, dibaca dari markup daftar — bukan
    // di-hardcode. Memeriksa hanya `value="` ada (tanpa isinya) tidak
    // membuktikan apa pun: `defaultValue={mitra?.nama ?? ""}` merender
    // `value=""` sama saja ketika `mitra` sengaja diganti `null` walau
    // `panelTerbuka` tetap true — persis jebakan yang brief tandai.
    const nama = namaBarisId(daftar, id!);

    const m = await render({ ubah: id! });
    expect(m).toContain('role="dialog"');
    // Nama baris yang sama harus ikut sampai ke ATRIBUT `value` medan
    // "nama" — bukti panelnya dirender di SERVER dengan datanya sudah
    // lengkap, bukan panel kosong yang formulirnya tidak menunjuk apa pun.
    const namaAman = nama.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(m).toMatch(new RegExp(`name="nama"[^>]*value="${namaAman}"`));
  });

  it("?ubah dengan id yang tidak ada TIDAK melempar dan TIDAK membuka panel", async () => {
    // URL ditempel dan diketik ulang. Baris yang sudah dihapus tidak boleh
    // menjatuhkan seluruh halaman.
    const m = await render({ ubah: "00000000-0000-0000-0000-000000000000" });
    expect(m).not.toContain('role="dialog"');
  });

  it("panel geser menutup ke URL yang MEMPERTAHANKAN pencarian", async () => {
    // Dicari lebih dulu, BARU dibuka: sebuah baris hanya bisa dibuka bila ia
    // ada di halaman yang sedang tampil. Membuka id dari halaman lain menutup
    // panel — itu perilaku yang disengaja, dan uji "id tidak ada" di atas yang
    // menjaganya. Aljabar halaman sendiri sudah diuji di tests/panel-daftar.
    const daftar = await render({ cari: "sri" });
    const id = /href="\/admin\/mitra\?cari=sri&amp;ubah=([0-9a-f-]{36})"/.exec(daftar)?.[1];
    expect(id).toBeDefined();

    const m = await render({ cari: "sri", ubah: id! });
    expect(m).toContain('href="/admin/mitra?cari=sri"');
  });

  it("penjelasan halaman ada, tetapi terlipat", async () => {
    const m = await render({});
    expect(m).toContain("Mitra adalah data, bukan pengguna aplikasi");
    expect(m).toContain("<details");
  });
});
