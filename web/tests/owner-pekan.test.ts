import { describe, it, expect } from "vitest";
import { awalPekan, rentangPekan, akhirPekan } from "@/lib/owner/pekan";

// Proses berjalan TZ=UTC (vitest.config.ts). mondayOf prototipe memakai
// getDay()/setDate() dan TERBUKTI salah di America/Los_Angeles — 2026-08-30
// menghasilkan 2026-08-25 yang bahkan bukan Senin. Rumus di sini berbasis
// string murni sehingga tidak bergantung zona sama sekali.
describe("awalPekan", () => {
  it("Senin memetakan ke dirinya sendiri", () => {
    expect(awalPekan("2026-08-24")).toBe("2026-08-24"); // Senin
  });
  it("Minggu memetakan ke Senin sebelumnya", () => {
    expect(awalPekan("2026-08-30")).toBe("2026-08-24"); // Minggu -> Senin
  });
  it("Selasa memetakan ke Senin sebelumnya", () => {
    expect(awalPekan("2026-08-25")).toBe("2026-08-24");
  });
  it("melintasi pergantian bulan", () => {
    expect(awalPekan("2026-09-01")).toBe("2026-08-31"); // Selasa -> Senin
  });
  it("melintasi pergantian tahun", () => {
    expect(awalPekan("2027-01-01")).toBe("2026-12-28"); // Jumat -> Senin
  });
  it("hasilnya SELALU hari Senin", () => {
    for (const t of ["2026-01-01", "2026-02-28", "2026-03-01", "2026-06-15", "2026-12-31"]) {
      const senin = awalPekan(t);
      // isoDow dihitung ulang secara independen dari implementasi
      const d = new Date(`${senin}T12:00:00Z`);
      expect(d.getUTCDay()).toBe(1);
    }
  });

  // Pembuktian menyeluruh, bukan hanya lima tanggal contoh: dua tahun penuh
  // ditelusuri hari demi hari. Ini menutup kelas bug tahun kabisat dan
  // pergantian bulan sekaligus — 2024 kabisat, 2100 bukan kabisat meski
  // habis dibagi 4.
  it("SELALU Senin untuk setiap hari pada rentang tahun kabisat & non-kabisat", () => {
    let diperiksa = 0;
    for (const tahun of [2024, 2026, 2100]) {
      const mulai = Date.UTC(tahun, 0, 1, 12, 0, 0);
      const selesai = Date.UTC(tahun + 1, 0, 1, 12, 0, 0);
      for (let ms = mulai; ms < selesai; ms += 86_400_000) {
        const d = new Date(ms);
        const tgl = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        const senin = awalPekan(tgl);
        expect(/^\d{4}-\d{2}-\d{2}$/.test(senin), `format ${tgl} -> ${senin}`).toBe(true);
        // (1) hasilnya hari Senin, dihitung ulang lewat jalur yang sama sekali
        //     berbeda dari implementasi;
        expect(new Date(`${senin}T12:00:00Z`).getUTCDay(), `${tgl} -> ${senin}`).toBe(1);
        // (2) tidak pernah di masa depan;
        expect(senin <= tgl, `${senin} <= ${tgl}`).toBe(true);
        // (3) jaraknya 0..6 hari — bukan Senin pekan yang salah.
        const jarak = (ms - new Date(`${senin}T12:00:00Z`).getTime()) / 86_400_000;
        expect(jarak, `${tgl} -> ${senin}`).toBeGreaterThanOrEqual(0);
        expect(jarak, `${tgl} -> ${senin}`).toBeLessThanOrEqual(6);
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
  it("Minggu enam hari sesudah Senin", () => {
    expect(akhirPekan("2026-08-24")).toBe("2026-08-30");
  });
  it("melintasi pergantian bulan", () => {
    expect(akhirPekan("2026-08-31")).toBe("2026-09-06");
  });
  it("melintasi pergantian tahun", () => {
    expect(akhirPekan("2026-12-28")).toBe("2027-01-03");
  });
  it("melintasi 29 Februari tahun kabisat", () => {
    expect(akhirPekan("2024-02-26")).toBe("2024-03-03");
  });
});

describe("rentangPekan", () => {
  it("menampilkan Senin sampai Minggu dengan bulan Indonesia", () => {
    expect(rentangPekan("2026-08-24")).toBe("24 – 30 Agu 2026");
  });
  it("menampilkan kedua bulan bila pekan melintasi bulan", () => {
    expect(rentangPekan("2026-08-31")).toBe("31 Agu – 6 Sep 2026");
  });
  it("menampilkan kedua tahun bila pekan melintasi tahun", () => {
    expect(rentangPekan("2026-12-28")).toBe("28 Des 2026 – 3 Jan 2027");
  });
  it("menerima tanggal mana pun dalam pekan, bukan hanya Senin", () => {
    expect(rentangPekan("2026-08-30")).toBe("24 – 30 Agu 2026");
  });
});
