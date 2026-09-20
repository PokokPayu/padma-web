import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const UNGGAH = readFileSync(path.join(AKAR, "src/app/admin/produk/[id]/unggah.ts"), "utf8");

/**
 * Unggahan adalah satu-satunya titik di modul ini yang boleh memegang service
 * role, dan justru karena itu pagarnya diperiksa sebagai TEKS SUMBER: pagar
 * perilaku ("klien tidak bisa mengunggah") tidak bisa melihat requireRole yang
 * terhapus dari satu action di antara empat.
 */
describe("pagar unggahan produk", () => {
  it("setiap server action dibuka requireRole", () => {
    const jumlahAction = (UNGGAH.match(/^export async function /gm) ?? []).length;
    const jumlahGerbang = (UNGGAH.match(/requireRole\(\[/g) ?? []).length;
    expect(jumlahAction).toBeGreaterThan(0);
    expect(jumlahGerbang).toBe(jumlahAction);
  });

  it("path objek diturunkan dari helper, tidak pernah dari parameter berkas", () => {
    expect(UNGGAH).toContain("namaObjekVideoProduk");
    expect(UNGGAH).toContain("namaObjekHalamanProduk");
    // Tidak ada satu pun path yang dirakit dari nama berkas kiriman browser.
    expect(UNGGAH).not.toMatch(/formData\.get\(["']nama/);
  });

  it("keberadaan produk diperiksa lewat SESI pengguna, bukan service role", () => {
    // Urutannya mengikat: `createServerSupabase` (RLS staf) muncul sebelum
    // `createAdminSupabase` (service role) — hak diputuskan basis data lebih
    // dulu, storage disentuh belakangan.
    const posisiSesi = UNGGAH.indexOf("createServerSupabase");
    const posisiService = UNGGAH.indexOf("createAdminSupabase");
    expect(posisiSesi).toBeGreaterThan(-1);
    expect(posisiService).toBeGreaterThan(posisiSesi);
  });

  it("batas ukuran dipakai ulang dari modul materi, bukan ditulis ulang", () => {
    // `periksaBerkasVideo` sudah memagari MIME DAN ukuran sekaligus. Menulis
    // ulang batasnya di sini melahirkan angka kedua yang bisa berbeda dari
    // yang dipakai pengunggah materi tanpa satu pun uji berubah merah.
    expect(UNGGAH).toContain("periksaBerkasVideo");
    expect(UNGGAH).toContain("MAKS_HALAMAN");
  });
});
