import { describe, it, expect } from "vitest";
import { saranJenjang } from "@/lib/transport/saran";

describe("saranJenjang", () => {
  it("memulangkan jarak dan jenjang bila kedua koordinat ada", () => {
    const hasil = saranJenjang({ lat: -6.9175, lon: 107.6191 }, { lat: -6.9175, lon: 107.6191 });
    expect(hasil).toEqual({ jarakKm: 0, jenjang: "0_5" });
  });

  it("memulangkan null bila koordinat mitra kosong", () => {
    expect(saranJenjang(null, { lat: -6.9, lon: 107.6 })).toBeNull();
  });

  it("memulangkan null bila koordinat sesi kosong", () => {
    expect(saranJenjang({ lat: -6.9, lon: 107.6 }, null)).toBeNull();
  });

  it("menghitung jarak sungguhan lewat haversineKm, bukan nol yang ditulis mati", () => {
    // Bandung (-6.9175, 107.6191) ke Jakarta Pusat (-6.1944, 106.8229) —
    // jarak garis lurus sungguhan sekitar 117 km, jauh di atas 20 km.
    const hasil = saranJenjang({ lat: -6.9175, lon: 107.6191 }, { lat: -6.1944, lon: 106.8229 });
    expect(hasil).not.toBeNull();
    expect(hasil!.jarakKm).toBeGreaterThan(100);
    expect(hasil!.jenjang).toBe("di_atas_20");
  });
});
