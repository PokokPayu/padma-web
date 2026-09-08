import { describe, it, expect } from "vitest";
import { masihBisaDinilai, JENDELA_NILAI_HARI } from "@/lib/passport/penilaian";

describe("jendela 30 hari untuk menilai sesi", () => {
  it("sesi hari ini masih bisa dinilai", () => {
    expect(masihBisaDinilai("2026-09-10", "2026-09-10")).toBe(true);
  });

  it("tepat di hari ke-30 masih bisa; hari ke-31 tidak", () => {
    // Batasnya `<=`, dan diuji PERSIS di batasnya: satu hari geser di sini
    // berarti kartu yang hilang sehari lebih awal bagi setiap klien.
    expect(masihBisaDinilai("2026-08-11", "2026-09-10")).toBe(true);
    expect(masihBisaDinilai("2026-08-10", "2026-09-10")).toBe(false);
  });

  it("melintasi pergantian bulan dan tahun", () => {
    expect(masihBisaDinilai("2026-12-20", "2027-01-05")).toBe(true);
    expect(masihBisaDinilai("2026-11-20", "2027-01-05")).toBe(false);
  });

  it("sesi yang tanggalnya di MASA DEPAN tidak bisa dinilai", () => {
    expect(masihBisaDinilai("2026-09-11", "2026-09-10")).toBe(false);
  });

  it("jendelanya bisa diatur, dan bawaannya 30 hari", () => {
    expect(JENDELA_NILAI_HARI).toBe(30);
    expect(masihBisaDinilai("2026-09-03", "2026-09-10", 7)).toBe(true);
    expect(masihBisaDinilai("2026-09-02", "2026-09-10", 7)).toBe(false);
  });
});
