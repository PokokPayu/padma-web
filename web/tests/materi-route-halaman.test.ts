// tests/materi-route-halaman.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signInAs } from "./helpers/as-user";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/api/materi/[id]/halaman/[n]/route.ts"),
  "utf8",
);

// Sesi Ananda sungguhan — RLS yang menjadi penjaga, sama seperti
// tests/passport-materi.test.ts, bukan diam-diam menembus lewat service role.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

beforeAll(async () => {
  ref.klien = await signInAs("ananda@padma.test");
});

describe("route halaman — pagar yang dibaca dari sumbernya", () => {
  it("berjalan di runtime Node, bukan Edge (sharp butuh Node)", () => {
    expect(SUMBER).toMatch(/export const runtime = ["']nodejs["']/);
  });

  it("hak diputuskan RLS lewat sesi pengguna SEBELUM service role menyentuh storage", () => {
    // Diikat pada BADAN fungsi, bukan seluruh berkas: `indexOf` atas seluruh
    // sumber menemukan baris IMPORT, sehingga asersinya hanya mencerminkan urutan
    // import dan tetap hijau walau kedua pemanggilan di dalam GET ditukar —
    // persis properti yang seharusnya ia jaga.
    const badan = SUMBER.slice(SUMBER.indexOf("export async function GET"));
    const sesi = badan.indexOf("createServerSupabase(");
    const query = badan.indexOf('.from("material_pages")');
    const admin = badan.indexOf("createAdminSupabase(");
    const unduh = badan.indexOf(".download(");

    expect(sesi).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(-1);
    expect(admin).toBeGreaterThan(-1);
    expect(unduh).toBeGreaterThan(-1);

    // Urutannya ADALAH properti keamanannya: sesi pengguna -> RLS memutuskan ->
    // baru service role mengunduh objeknya.
    expect(sesi).toBeLessThan(query);
    expect(query).toBeLessThan(admin);
    expect(admin).toBeLessThan(unduh);
  });

  it("path objek diambil dari baris DB, tidak pernah dari parameter", () => {
    // Parameter yang dipakai sebagai path = path traversal + IDOR sekaligus.
    expect(SUMBER).not.toMatch(/download\(\s*(params|n|id)\b/);
    expect(SUMBER).toMatch(/download\(\s*baris\.objek\s*\)/);
  });

  it("Cache-Control tepat: private untuk CDN, max-age untuk peramban pasien", () => {
    // Diikat pada NILAI headernya, bukan pada seluruh berkas: satu komentar yang
    // menyebut "public" atau "no-store" akan memerahkan asersi yang memindai
    // seluruh sumber, dan test yang merah karena komentar akan dilemahkan
    // orang berikutnya — lalu pagar aslinya ikut hilang.
    const cache = SUMBER.match(/"Cache-Control":\s*"([^"]+)"/)?.[1] ?? "";
    // `private` menutup CDN: watermark per-pasien, sementara CDN menyimpan
    // berdasarkan URL. `max-age` membiarkan peramban pasien memakai ulang apa
    // yang sudah ia unduh — tanpa itu ebook 60 halaman (~18 MB) diunduh ulang
    // setiap kali pasien menggulir balik.
    expect(cache).toBe("private, max-age=900");
  });

  it("menjawab 404 saat tidak berhak, bukan 401/403", () => {
    // 401/403 mengonfirmasi bahwa materinya ADA.
    expect(SUMBER).toMatch(/status:\s*404/);
    expect(SUMBER).not.toMatch(/status:\s*40[13]/);
  });
});

/**
 * Route dipanggil SUNGGUHAN (bukan sekadar dibaca sebagai teks) melawan
 * objek storage yang benar-benar diunggah `scripts/seed-users.ts` (fix
 * ronde 1, Finding 2). Sebelum fix itu, `material_pages` di seed.sql
 * menunjuk path yang tidak pernah ada di bucket `materi-halaman` —
 * lolos dari SETIAP test lain di repo ini karena semuanya berhenti di baris
 * DB (`material_pages.objek`), tidak pernah benar-benar mengunduh objeknya.
 * Describe ini yang menutup celah itu: bila seed-nya kembali berbohong
 * (baris ada, objek tidak), test ini — bukan hanya mata manusia di
 * `npm run dev` — yang merah.
 */
describe("route halaman — objek seed sungguhan ada di storage (fix ronde 1)", () => {
  const MATERI_TERBUKA_EBOOK = "77777777-7777-7777-7777-777777777702";

  it("GET halaman 1 materi seed terbuka -> 200 image/webp sungguhan, bukan 404", async () => {
    const { GET } = await import("@/app/api/materi/[id]/halaman/[n]/route");
    const res = await GET(new Request("http://x/"), {
      params: Promise.resolve({ id: MATERI_TERBUKA_EBOOK, n: "1" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");

    // Bukan stub: byte pertama WebP sungguhan adalah magic number RIFF/WEBP
    // (52 49 46 46 .. 57 45 42 50), bukan payload kosong atau teks galat.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    const magic = Buffer.from(bytes.slice(0, 4)).toString("ascii");
    const webpTag = Buffer.from(bytes.slice(8, 12)).toString("ascii");
    expect(magic).toBe("RIFF");
    expect(webpTag).toBe("WEBP");
  });
});
