import { describe, it, expect } from "vitest";
import { hariIniJakarta, formatTanggalID, formatTanggalPendek } from "@/lib/passport/waktu";

describe("waktu (proses berjalan TZ=UTC, seperti Vercel)", () => {
  it("hariIniJakarta mengembalikan YYYY-MM-DD", () => {
    expect(hariIniJakarta()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("hariIniJakarta memakai zona Jakarta, bukan UTC", () => {
    // 2026-08-28T22:30Z = 2026-08-29 05:30 WIB -> tanggalnya sudah 29.
    const utcMalam = new Date("2026-08-28T22:30:00Z");
    expect(hariIniJakarta(utcMalam)).toBe("2026-08-29");
  });

  it("formatTanggalID tidak mundur sehari di TZ UTC", () => {
    expect(formatTanggalID("2026-09-04")).toBe("4 September 2026");
    expect(formatTanggalID("2026-01-01")).toBe("1 Januari 2026");
  });

  it("formatTanggalPendek untuk stempel & kartu sesi", () => {
    expect(formatTanggalPendek("2026-09-04")).toEqual({ hari: "4", bulan: "SEP" });
  });
});
