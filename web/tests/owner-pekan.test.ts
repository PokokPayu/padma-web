import { describe, it, expect } from "vitest";
import { awalPekan, rentangPekan, akhirPekan } from "@/lib/owner/pekan";

// ===========================================================================
// PEKAN HONOR = SABTU s.d. JUMAT (umpan balik klien 21 Sep 2026, butir 4)
// ===========================================================================
// Klien merumuskannya lewat hari bayar: "diganti sabtu-jumat ... karena
// paymentnya di hari sabtu". Dengan pekan Sabtu–Jumat, Sabtu membayar pekan
// yang baru saja TUTUP hari Jumat kemarin. Di bawah skema Senin–Minggu yang
// lama, Sabtu jatuh di TENGAH pekannya sendiri — honor dibayarkan sebelum
// pekannya selesai, dan sesi hari Minggu masuk pekan yang sudah dibayar.
//
// Proses berjalan TZ=UTC (vitest.config.ts). Rumus di pekan.ts berbasis string
// murni, jadi tidak bergantung zona sama sekali — tes ini menghitung ulang
// hari-dalam-pekan lewat `Date` justru supaya jalurnya BERBEDA dari
// implementasi yang diuji.
describe("awalPekan", () => {
  it("Sabtu memetakan ke dirinya sendiri", () => {
    expect(awalPekan("2026-08-22")).toBe("2026-08-22"); // Sabtu
  });
  it("Jumat memetakan ke Sabtu enam hari sebelumnya — hari terakhir pekannya", () => {
    expect(awalPekan("2026-08-28")).toBe("2026-08-22");
  });
  it("Senin memetakan MUNDUR ke Sabtu, bukan ke dirinya sendiri", () => {
    expect(awalPekan("2026-08-24")).toBe("2026-08-22");
  });
  it("Minggu memetakan ke Sabtu kemarin lusa", () => {
    expect(awalPekan("2026-08-30")).toBe("2026-08-29");
  });
  it("melintasi pergantian bulan", () => {
    expect(awalPekan("2026-09-01")).toBe("2026-08-29"); // Selasa -> Sabtu
  });
  it("melintasi pergantian tahun", () => {
    expect(awalPekan("2027-01-01")).toBe("2026-12-26"); // Jumat -> Sabtu
  });

  // Kasus NYATA dari board produksi klien (butir 3). Tiga sesi diselesaikan
  // 19, 20, dan 21 Sep 2026; klien membuka board owner pada Senin 21 Sep dan
  // hanya melihat satu. Di bawah Senin–Minggu, 19 (Sabtu) dan 20 (Minggu)
  // jatuh ke ember pekan SEBELUMNYA tepat ketika Senin tiba. Inilah tes yang
  // mengunci sembuhnya.
  it("menyatukan sesi Sabtu, Minggu, dan Senin ke satu ember", () => {
    const ember = ["2026-09-19", "2026-09-20", "2026-09-21"].map(awalPekan);
    expect(new Set(ember).size).toBe(1);
    expect(ember[0]).toBe("2026-09-19");
  });

  it("hasilnya SELALU hari Sabtu", () => {
    for (const t of ["2026-01-01", "2026-02-28", "2026-03-01", "2026-06-15", "2026-12-31"]) {
      const sabtu = awalPekan(t);
      const d = new Date(`${sabtu}T12:00:00Z`);
      expect(d.getUTCDay()).toBe(6);
    }
  });

  // Pembuktian menyeluruh, bukan hanya beberapa tanggal contoh: tiga tahun
  // penuh ditelusuri hari demi hari. Ini menutup kelas bug tahun kabisat dan
  // pergantian bulan sekaligus — 2024 kabisat, 2100 bukan kabisat meski habis
  // dibagi 4.
  it("SELALU Sabtu untuk setiap hari pada rentang tahun kabisat & non-kabisat", () => {
    let diperiksa = 0;
    for (const tahun of [2024, 2026, 2100]) {
      const mulai = Date.UTC(tahun, 0, 1, 12, 0, 0);
      const selesai = Date.UTC(tahun + 1, 0, 1, 12, 0, 0);
      for (let ms = mulai; ms < selesai; ms += 86_400_000) {
        const d = new Date(ms);
        const tgl = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        const sabtu = awalPekan(tgl);
        expect(/^\d{4}-\d{2}-\d{2}$/.test(sabtu), `format ${tgl} -> ${sabtu}`).toBe(true);
        // (1) hasilnya hari Sabtu, dihitung ulang lewat jalur yang sama sekali
        //     berbeda dari implementasi;
        expect(new Date(`${sabtu}T12:00:00Z`).getUTCDay(), `${tgl} -> ${sabtu}`).toBe(6);
        // (2) tidak pernah di masa depan;
        expect(sabtu <= tgl, `${sabtu} <= ${tgl}`).toBe(true);
        // (3) jaraknya 0..6 hari — bukan Sabtu pekan yang salah.
        const jarak = (ms - new Date(`${sabtu}T12:00:00Z`).getTime()) / 86_400_000;
        expect(jarak, `${tgl} -> ${sabtu}`).toBeGreaterThanOrEqual(0);
        expect(jarak, `${tgl} -> ${sabtu}`).toBeLessThanOrEqual(6);
        diperiksa++;
      }
    }
    expect(diperiksa).toBe(365 + 365 + 366); // 2100 bukan kabisat
  });

  it("idempoten — memetakan hasilnya lagi tidak menggeser apa pun", () => {
    for (const t of ["2026-08-30", "2027-01-01", "2024-02-29"]) {
      expect(awalPekan(awalPekan(t))).toBe(awalPekan(t));
    }
  });

  it("tanggal tak sah ditolak, bukan menghasilkan pekan diam-diam salah", () => {
    for (const buruk of ["", "2026-8-3", "30-08-2026", "2026-08-30T00:00:00Z", "abcd-ef-gh"]) {
      expect(() => awalPekan(buruk), `harus melempar: ${buruk}`).toThrow();
    }
  });
});

describe("akhirPekan", () => {
  it("Jumat enam hari sesudah Sabtu", () => {
    expect(akhirPekan("2026-08-22")).toBe("2026-08-28");
  });
  it("melintasi pergantian bulan", () => {
    expect(akhirPekan("2026-08-29")).toBe("2026-09-04");
  });
  it("melintasi pergantian tahun", () => {
    expect(akhirPekan("2026-12-26")).toBe("2027-01-01");
  });
  it("melintasi 29 Februari tahun kabisat", () => {
    expect(akhirPekan("2024-02-24")).toBe("2024-03-01");
  });
  it("selalu Jumat, dari tanggal mana pun dalam pekannya", () => {
    for (const t of ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-25"]) {
      expect(akhirPekan(t), t).toBe("2026-09-25");
    }
  });
});

describe("rentangPekan", () => {
  it("menampilkan Sabtu sampai Jumat dengan bulan Indonesia", () => {
    expect(rentangPekan("2026-08-22")).toBe("22 – 28 Agu 2026");
  });
  it("menampilkan kedua bulan bila pekan melintasi bulan", () => {
    expect(rentangPekan("2026-08-29")).toBe("29 Agu – 4 Sep 2026");
  });
  it("menampilkan kedua tahun bila pekan melintasi tahun", () => {
    expect(rentangPekan("2026-12-26")).toBe("26 Des 2026 – 1 Jan 2027");
  });
  it("menerima tanggal mana pun dalam pekan, bukan hanya Sabtu", () => {
    expect(rentangPekan("2026-08-28")).toBe("22 – 28 Agu 2026");
  });
});
