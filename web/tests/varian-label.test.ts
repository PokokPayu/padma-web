import { describe, it, expect } from "vitest";
import { labelVarian } from "@/lib/varian";

/**
 * SATU perangkai untuk tiga layar (rate card owner, tagihan admin, landing).
 *
 * Dua perangkai akan berpisah, dan perpisahannya berbentuk varian yang bernama
 * berbeda di dua tempat — klien membaca "90 menit · Private" di landing dan
 * "Private" di tagihan, lalu bertanya apakah itu layanan yang sama.
 */
describe("labelVarian", () => {
  it("merangkai label, durasi, dan format yang terisi", () => {
    expect(labelVarian({ label: "Basic", durasiMenit: 60, format: "private" }))
      .toBe("Basic · 60 menit · Private");
  });

  it("melewati bagian yang kosong", () => {
    expect(labelVarian({ label: "", durasiMenit: 90, format: null })).toBe("90 menit");
    expect(labelVarian({ label: "2 modul", durasiMenit: 60, format: null }))
      .toBe("2 modul · 60 menit");
  });

  it("varian baku tanpa apa pun memulangkan string kosong", () => {
    // Pemanggil yang menampilkannya jatuh ke nama layanan — keputusan itu
    // milik layar, bukan milik perangkai.
    expect(labelVarian({ label: "", durasiMenit: null, format: null })).toBe("");
  });
});
