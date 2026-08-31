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

  it("hak diputuskan RLS lewat sesi pengguna, BUKAN service role", () => {
    const posisiSesi = SUMBER.indexOf("createServerSupabase");
    const posisiAdmin = SUMBER.indexOf("createAdminSupabase");
    expect(posisiSesi).toBeGreaterThan(-1);
    expect(posisiAdmin).toBeGreaterThan(-1);
    // Service role hanya boleh menyentuh storage SESUDAH basis data memutuskan.
    expect(posisiSesi).toBeLessThan(posisiAdmin);
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
