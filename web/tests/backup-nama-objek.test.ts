import { describe, it, expect } from "vitest";
import {
  PREFIKS_BACKUP, kunciObjekBackup, capWaktuDariKunci, epochDariCapWaktu,
} from "@/lib/backup/nama-objek";

describe("kunci objek backup", () => {
  it("menyusun kunci berjenjang tahun/bulan dari cap waktunya sendiri", () => {
    expect(kunciObjekBackup("20260904-200000Z"))
      .toBe("db/2026/09/padma-20260904-200000Z.dump.age");
    expect(PREFIKS_BACKUP).toBe("db");
  });

  it("menolak cap waktu yang bukan bentuk UTC yang disepakati", () => {
    // Bentuk lain akan membuat retensi gagal membacanya, dan objek yang tidak
    // terbaca TIDAK PERNAH dihapus — jadi salah bentuk = sampah abadi di R2.
    for (const buruk of ["2026-09-04T20:00:00Z", "20260904-200000", "", "padma"]) {
      expect(() => kunciObjekBackup(buruk)).toThrow();
    }
  });

  it("membaca kembali cap waktu dari kunci yang dibuatnya sendiri", () => {
    const cap = "20261231-235959Z";
    expect(capWaktuDariKunci(kunciObjekBackup(cap))).toBe(cap);
  });

  it("mengembalikan null untuk kunci asing, bukan menebak", () => {
    for (const asing of [
      "db/2026/09/catatan.txt",
      "db/2026/09/padma-20260904-200000Z.dump",
      "sesuatu/lain.dump.age",
      "",
    ]) {
      expect(capWaktuDariKunci(asing)).toBeNull();
    }
  });
});

describe("cap waktu ke epoch", () => {
  it("membaca sebagai UTC, bukan zona waktu mesin", () => {
    expect(epochDariCapWaktu("19700101-000000Z")).toBe(0);
    expect(epochDariCapWaktu("19700102-000000Z")).toBe(86_400_000);
  });

  it("menolak tanggal yang tidak pernah ada alih-alih menggulungnya", () => {
    // Date.UTC(2026, 1, 30) diam-diam menjadi 2 Maret. Cap waktu semacam itu
    // menandakan sesuatu yang rusak di hulu, dan menebak artinya lebih
    // berbahaya daripada menolaknya.
    expect(epochDariCapWaktu("20260230-000000Z")).toBeNull();
    expect(epochDariCapWaktu("20261301-000000Z")).toBeNull();
    expect(epochDariCapWaktu("20260904-250000Z")).toBeNull();
    expect(epochDariCapWaktu("20260904-206000Z")).toBeNull();
  });

  it("mengembalikan null untuk bentuk yang salah", () => {
    expect(epochDariCapWaktu("bukan cap waktu")).toBeNull();
  });
});
