// tests/materi-unggah-aksi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/admin/materi/unggah.ts"), "utf8",
);

describe("aksi unggah halaman — pagar struktural", () => {
  it('berkas server action, dan setiap aksi memanggil requireRole sendiri', () => {
    expect(SUMBER.trimStart().startsWith('"use server"')).toBe(true);
    const aksi = [...SUMBER.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(aksi.length).toBeGreaterThan(0);
    const penjaga = [...SUMBER.matchAll(/requireRole\(\["admin", ?"owner"\]\)/g)];
    // Server action adalah endpoint POST tersendiri; layout tidak menjaganya.
    expect(penjaga.length).toBe(aksi.length);
  });

  it("path objek ditentukan server, tidak pernah diterima dari parameter", () => {
    // Browser yang memilih path adalah browser yang bisa menimpa objek materi lain.
    expect(SUMBER).toContain("namaObjekHalaman(");
    expect(SUMBER).not.toMatch(/objek:\s*(formData|params)/);
  });

  it("jumlah halaman dibatasi sebelum satu URL pun diterbitkan", () => {
    expect(SUMBER).toContain("MAKS_HALAMAN");
  });

  it("pencatatan memakai RPC, bukan delete lalu insert dari klien", () => {
    // DELETE dari klien menuntut filter, dan filter tautologis pernah menghapus
    // SELURUH bab materi di repo ini.
    expect(SUMBER).toContain("ganti_halaman_materi");
    expect(SUMBER).not.toMatch(/from\("material_pages"\)\s*\.delete\(/);
  });
});
