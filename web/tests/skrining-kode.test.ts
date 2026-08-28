import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buatKodeSkrining } from "@/lib/skrining/kode";

describe("kode skrining", () => {
  it("format persis PDM-YYMMDD-HHMM-XXXX", () => {
    const kode = buatKodeSkrining(new Date("2026-08-28T09:05:00"));
    expect(kode).toMatch(/^PDM-260828-0905-[A-Z0-9]{4}$/);
  });

  it("panjang selalu konsisten (zero-padded)", () => {
    const a = buatKodeSkrining(new Date("2026-01-02T03:04:00"));
    const b = buatKodeSkrining(new Date("2026-12-31T23:59:00"));
    expect(a).toHaveLength(b.length);
    expect(a).toMatch(/^PDM-260102-0304-/);
  });

  it("1000 kode berturut-turut tidak bentrok", () => {
    const set = new Set(Array.from({ length: 1000 }, () => buatKodeSkrining()));
    expect(set.size).toBe(1000);
  });

  /**
   * Test di atas berjalan dalam satu-dua menit dinding jam, jadi ia HAMPIR
   * selalu menguji satu menit yang sama — tapi tidak dijamin. Test ini
   * mengunci menitnya supaya jaminan "tidak bentrok" diuji pada kasus
   * terburuk: 1000 kode dengan prefiks waktu IDENTIK. Dengan sufiks 4 karakter
   * dari 32 huruf (32^4 = 1.048.576 kemungkinan), acak murni akan bentrok pada
   * ~38% dari eksekusi (paradoks ulang tahun) — jadi generator wajib menjamin
   * keunikan, bukan mengandalkan keberuntungan.
   */
  it("1000 kode pada menit yang SAMA tetap tidak bentrok (bukan sekadar untung)", () => {
    const menit = new Date("2026-08-28T09:05:00");
    const kode = Array.from({ length: 1000 }, () => buatKodeSkrining(menit));
    expect(new Set(kode).size).toBe(1000);
    for (const k of kode) expect(k).toMatch(/^PDM-260828-0905-[A-Z0-9]{4}$/);
  });

  it("sufiks tidak memakai karakter ambigu (I, O, 0, 1) agar aman dibacakan", () => {
    const sufiks = Array.from({ length: 300 }, () =>
      buatKodeSkrining().slice(-4),
    ).join("");
    expect(sufiks).not.toMatch(/[IO01]/);
  });

  /**
   * Kode ini dipakai untuk mengambil hasil skrining (data kesehatan), jadi
   * sufiksnya wajib dari CSPRNG. `Math.random()` dapat diprediksi dari
   * beberapa keluaran sebelumnya — prototipe memakainya; kode produksi tidak
   * boleh. Dijaga secara struktural agar tidak diam-diam kembali.
   */
  it("tidak memakai Math.random() — sufiks wajib kriptografis", () => {
    const sumber = readFileSync(
      path.resolve(__dirname, "../src/lib/skrining/kode.ts"),
      "utf8",
    );
    // Komentar dibuang: penjelasan "jangan pakai Math.random()" tidak boleh
    // menuduh dirinya sendiri. Yang dinilai hanya kode yang benar-benar jalan.
    const kode = sumber
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(kode).not.toMatch(/Math\.random/);
    expect(kode).toMatch(/node:crypto/);
  });
});
