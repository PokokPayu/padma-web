// tests/materi-penugasan-aksi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/admin/materi/penugasan-aksi.ts"), "utf8",
);

describe("aksi penugasan — pagar struktural", () => {
  it("setiap aksi memanggil requireRole sendiri", () => {
    const aksi = [...SUMBER.matchAll(/export async function (\w+)/g)].length;
    const penjaga = [...SUMBER.matchAll(/requireRole\(\["admin", ?"owner"\]\)/g)].length;
    expect(aksi).toBeGreaterThan(0);
    expect(penjaga).toBe(aksi);
  });

  it("hasil tulis DIPERIKSA, bukan diasumsikan berhasil", () => {
    // PostgREST menjawab 200 + [] untuk tulis yang ditolak RLS, bukan error.
    expect(SUMBER).toMatch(/\.select\(["']material_id["']\)/);
  });

  it("ditugaskan_oleh tidak pernah dikirim dari kode — trigger yang mengisinya", () => {
    // Diikat pada payload insert, BUKAN pada seluruh berkas: komentar yang
    // menjelaskan kenapa kolom itu tidak dikirim justru memuat namanya, dan
    // asersi yang memindai seluruh sumber akan merah karena komentar. Test yang
    // merah karena komentar akan dilemahkan orang berikutnya — lalu pagar
    // aslinya ikut hilang.
    const payload = SUMBER.match(/\.insert\(\{([^}]*)\}\)/)?.[1] ?? "";
    expect(payload).toContain("material_id");
    expect(payload).not.toContain("ditugaskan_oleh");
  });
});
