/**
 * PAGAR: pengelompokan bulan memakai kalender JAKARTA, bukan potongan string.
 *
 * Kelas kesalahannya sudah dibayar repo ini sekali, untuk TANGGAL, dan
 * dokblok `stempelJakarta` di `src/lib/owner/pekan.ts` mengejanya: stempel
 * yang dipulangkan PostgREST adalah UTC, dan peristiwa pukul 06.30 WIB
 * tercatat 23.30Z HARI SEBELUMNYA. Untuk tanggal itu memindahkan satu tanda
 * bayar; untuk BULAN ia memindahkan seluruh omzet sebuah pembelian ke bulan
 * pembukuan yang salah.
 */
import { describe, it, expect } from "vitest";
import {
  bulanJakarta,
  labelBulan,
  labelBulanPendek,
  deretBulanTerakhir,
  rentangBulanJakarta,
  bulanSekarangJakarta,
  stempelTanggalJakarta,
} from "@/lib/penjualan/bulan";

describe("bulanJakarta", () => {
  it("pembelian 06.30 WIB tanggal 1 masuk bulan BARU, bukan bulan sebelumnya", () => {
    // 2026-10-01 06:30 WIB === 2026-09-30 23:30 UTC
    expect(bulanJakarta("2026-09-30T23:30:00Z")).toBe("2026-10");
  });

  it("KONTROL NEGATIF: memotong string ISO memulangkan bulan yang SALAH", () => {
    // Tinggal di repo dengan sengaja. Sesudah fungsi di atas benar, temuan
    // nyatanya nol selamanya — dan pemindai yang rusak juga memulangkan nol.
    // Tanpa kontrol ini keduanya tidak bisa dibedakan.
    expect("2026-09-30T23:30:00Z".slice(0, 7)).toBe("2026-09");
    expect(bulanJakarta("2026-09-30T23:30:00Z")).not.toBe(
      "2026-09-30T23:30:00Z".slice(0, 7),
    );
  });

  it("pembelian siang hari jatuh di bulan yang sama di kedua zona", () => {
    expect(bulanJakarta("2026-10-15T05:00:00Z")).toBe("2026-10");
  });

  it("peristiwa 31 Des 20.00 WIB masih tahun yang sama", () => {
    // 2026-12-31 20:00 WIB === 2026-12-31 13:00 UTC
    expect(bulanJakarta("2026-12-31T13:00:00Z")).toBe("2026-12");
  });

  it("peristiwa 1 Jan 01.00 WIB sudah tahun BARU walau UTC-nya masih tahun lama", () => {
    // 2027-01-01 01:00 WIB === 2026-12-31 18:00 UTC
    expect(bulanJakarta("2026-12-31T18:00:00Z")).toBe("2027-01");
  });

  it("stempel tak sah memulangkan null, bukan bucket hantu", () => {
    expect(bulanJakarta("bukan tanggal")).toBeNull();
    expect(bulanJakarta("")).toBeNull();
  });
});

describe("deretBulanTerakhir", () => {
  it("memulangkan N bulan berurutan, terlama lebih dulu", () => {
    expect(deretBulanTerakhir("2026-03", 4)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("deretnya UTUH walau sebuah bulan tidak punya penjualan", () => {
    // Inilah sebab fungsi ini ada. Membangun sumbu-X dari bulan yang PUNYA
    // data membuat bulan kosong hilang dari grafik, dan tren yang sebenarnya
    // datar terbaca naik.
    const deret = deretBulanTerakhir("2026-10", 12);
    expect(deret).toHaveLength(12);
    expect(deret[0]).toBe("2025-11");
    expect(deret[11]).toBe("2026-10");
    // Tidak ada lompatan: setiap pasangan berurutan terpaut tepat satu bulan.
    for (let i = 1; i < deret.length; i++) {
      const [ta, ba] = deret[i - 1].split("-").map(Number);
      const [tb, bb] = deret[i].split("-").map(Number);
      expect(tb * 12 + bb - (ta * 12 + ba)).toBe(1);
    }
  });

  it("kunci tak sah melempar, tidak memulangkan deret hantu", () => {
    expect(() => deretBulanTerakhir("2026-13", 3)).toThrow();
    expect(() => deretBulanTerakhir("oktober", 3)).toThrow();
  });
});

describe("rentangBulanJakarta", () => {
  it("batas bawah inklusif dan batas atas EKSKLUSIF, keduanya +07:00", () => {
    expect(rentangBulanJakarta("2026-10")).toEqual({
      mulai: "2026-10-01T00:00:00+07:00",
      sampai: "2026-11-01T00:00:00+07:00",
    });
  });

  it("Desember menyeberang tahun", () => {
    expect(rentangBulanJakarta("2026-12")).toEqual({
      mulai: "2026-12-01T00:00:00+07:00",
      sampai: "2027-01-01T00:00:00+07:00",
    });
  });

  it("rentangnya memulangkan pembelian 06.30 WIB tanggal 1 ke bulan yang benar", () => {
    // Pengikat antara rentang kueri dan pengelompokan: keduanya harus
    // menjawab sama untuk stempel yang sama, kalau tidak ada pembelian yang
    // tertarik kueri bulan X lalu dikelompokkan ke bulan Y.
    const stempel = "2026-09-30T23:30:00Z";
    const { mulai, sampai } = rentangBulanJakarta("2026-10");
    expect(Date.parse(stempel)).toBeGreaterThanOrEqual(Date.parse(mulai));
    expect(Date.parse(stempel)).toBeLessThan(Date.parse(sampai));
    expect(bulanJakarta(stempel)).toBe("2026-10");
  });
});

describe("label", () => {
  it("labelBulan memakai nama bulan Indonesia", () => {
    expect(labelBulan("2026-10")).toBe("Oktober 2026");
    expect(labelBulan("2027-01")).toBe("Januari 2027");
  });

  it("labelBulanPendek cukup pendek untuk sumbu grafik", () => {
    expect(labelBulanPendek("2026-10")).toBe("Okt 26");
  });

  it("kunci tak sah memulangkan tanda pisah, bukan 'Invalid Date'", () => {
    expect(labelBulan("entah")).toBe("—");
    expect(labelBulanPendek("entah")).toBe("—");
  });
});

describe("bulanSekarangJakarta", () => {
  it("memakai jam Jakarta, bukan jam proses", () => {
    expect(bulanSekarangJakarta(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10");
  });
});

describe("stempelTanggalJakarta", () => {
  it("memakai TANGGAL Jakarta, bukan tanggal UTC", () => {
    // Kesalahan yang sama dengan bulan, satu tingkat lebih halus: pembelian
    // 06.30 WIB tanggal 1 Oktober tercatat 30 September di UTC.
    expect(stempelTanggalJakarta("2026-09-30T23:30:00Z")).toBe("1 Okt 2026");
  });

  it("stempel tak sah memulangkan tanda pisah, bukan 'Invalid Date'", () => {
    expect(stempelTanggalJakarta("entah")).toBe("—");
  });
});
