// tests/materi-route-halaman.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/api/materi/[id]/halaman/[n]/route.ts"),
  "utf8",
);

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
