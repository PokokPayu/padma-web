import { describe, it, expect } from "vitest";
import { haversineKm, jenjangDariJarak } from "@/lib/transport/jarak";

/**
 * Aritmetika jarak diuji sebagai FUNGSI MURNI, tanpa basis data dan tanpa
 * jaringan — di sinilah kesalahan hitung paling mungkin bersembunyi, dan di
 * sini pula ia paling murah ditemukan.
 */
describe("haversineKm", () => {
  it("titik yang sama berjarak nol", () => {
    const t = { lat: -6.9175, lon: 107.6191 };
    expect(haversineKm(t, t)).toBe(0);
  });

  it("jarak yang diketahui: Bandung — Jakarta ≈ 116 km", () => {
    const bandung = { lat: -6.9175, lon: 107.6191 };
    const jakarta = { lat: -6.2088, lon: 106.8456 };
    expect(haversineKm(bandung, jakarta)).toBeGreaterThan(114);
    expect(haversineKm(bandung, jakarta)).toBeLessThan(118);
  });

  it("simetris — urutan argumen tidak mengubah hasil", () => {
    const a = { lat: -6.9, lon: 107.6 };
    const b = { lat: -6.2, lon: 106.8 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("jarak sangat kecil tetap positif, bukan dibulatkan ke nol", () => {
    const a = { lat: -6.917500, lon: 107.619100 };
    const b = { lat: -6.917600, lon: 107.619100 };
    expect(haversineKm(a, b)).toBeGreaterThan(0);
    expect(haversineKm(a, b)).toBeLessThan(0.05);
  });
});

describe("jenjangDariJarak — batas ditetapkan EKSPLISIT (spec T11)", () => {
  it("tepat 5,0 km masih GRATIS", () => {
    expect(jenjangDariJarak(5)).toBe("0_5");
  });

  it("5,01 km sudah naik jenjang", () => {
    expect(jenjangDariJarak(5.01)).toBe("5_10");
  });

  it("tepat 20,0 km masih jenjang tertinggi bertarif", () => {
    expect(jenjangDariJarak(20)).toBe("15_20");
  });

  it("20,01 km jatuh ke tarif khusus", () => {
    expect(jenjangDariJarak(20.01)).toBe("di_atas_20");
  });

  it("nol km gratis", () => {
    expect(jenjangDariJarak(0)).toBe("0_5");
  });

  it("jarak negatif ditolak — itu bukan jarak", () => {
    expect(() => jenjangDariJarak(-1)).toThrow();
  });
});
