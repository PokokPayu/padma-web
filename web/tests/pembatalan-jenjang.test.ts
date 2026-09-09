/**
 * JENJANG PEMBATALAN (spec C3 P1, P2).
 *
 * Seluruh berkas ini berjalan tanpa basis data — jenjang adalah fungsi murni
 * atas waktu. Yang dijaga paling keras: zona waktunya. Vercel berjalan UTC,
 * dan menghitung ambang dengan kalender mesin menggeser batasnya tujuh jam.
 * Bentuk kegagalannya adalah uang klien: refund yang seharusnya penuh berubah
 * menjadi kredit, atau kredit yang hangus sehari lebih awal.
 */
import { describe, it, expect } from "vitest";
import {
  jenjangPembatalan,
  akibatPembatalan,
  kedaluwarsaHak,
  HARI_BERLAKU_HAK,
} from "@/lib/pembatalan/jenjang";

describe("ambang jenjang", () => {
  it("persis 24 jam sebelum sesi masih jenjang 1", () => {
    // Batas atas bersifat INKLUSIF: poster menulis "≥ 24 jam". Klien yang
    // membatalkan tepat 24 jam sebelumnya berhak refund penuh, dan pergeseran
    // satu detik di sini adalah selisih antara uang kembali dan kredit.
    const sesi = { tanggal: "2027-03-10", jam: "09:00" };
    const sekarang = new Date("2027-03-09T02:00:00Z"); // 09:00 WIB, H-1
    expect(jenjangPembatalan(sesi.tanggal, sesi.jam, sekarang)).toBe(1);
  });

  it("sedetik di bawah 24 jam jatuh ke jenjang 2", () => {
    const sekarang = new Date("2027-03-09T02:00:01Z");
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(2);
  });

  it("persis 2 jam sebelum sesi masih jenjang 2", () => {
    const sekarang = new Date("2027-03-10T00:00:00Z"); // 07:00 WIB
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(2);
  });

  it("sedetik di bawah 2 jam jatuh ke jenjang 3", () => {
    const sekarang = new Date("2027-03-10T00:00:01Z");
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(3);
  });

  it("sesi yang SUDAH LEWAT tetap jenjang 3, bukan berputar balik", () => {
    // Selisih negatif. Perbandingan yang ditulis terbalik akan menyebutnya
    // jenjang 1 — dan sesi yang sudah lewat lalu dibatalkan akan mengembalikan
    // uang penuh.
    const sekarang = new Date("2027-03-11T00:00:00Z");
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(3);
  });
});

describe("zona waktu — satu-satunya uji yang merah bila WIB hilang", () => {
  it("sesi 08.00 WIB dibatalkan 02.00 UTC hari yang sama = 1 jam lagi, bukan sudah lewat", () => {
    // 02:00 UTC = 09:00 WIB. Sesi 08:00 WIB berarti sudah lewat 1 jam →
    // jenjang 3. Yang menghitung dengan kalender UTC akan melihat "08:00 vs
    // 02:00" dan menyimpulkan masih 6 jam lagi → jenjang 2. Uji ini merah
    // TEPAT ketika offset WIB-nya hilang, dan tidak merah karena hal lain.
    const sekarang = new Date("2027-03-10T02:00:00Z");
    expect(jenjangPembatalan("2027-03-10", "08:00", sekarang)).toBe(3);
  });

  it("sesi 08.00 WIB dibatalkan 22.00 UTC hari SEBELUMNYA = 3 jam lagi", () => {
    // 22:00 UTC tanggal 9 = 05:00 WIB tanggal 10. Sesi 08:00 WIB → 3 jam lagi
    // → jenjang 2. Kalender mesin akan menyebutnya beda hari dan salah jenjang.
    const sekarang = new Date("2027-03-09T22:00:00Z");
    expect(jenjangPembatalan("2027-03-10", "08:00", sekarang)).toBe(2);
  });
});

describe("akibat mengikuti jenjang, dan hanya jenjang", () => {
  it("jenjang 1 mengembalikan uang", () => {
    expect(akibatPembatalan(1)).toBe("refund");
  });

  it("jenjang 2 menerbitkan hak, BUKAN uang", () => {
    // Inilah sebabnya jenjang 2 tidak pernah menyentuh tabel uang sama sekali.
    expect(akibatPembatalan(2)).toBe("hak");
  });

  it("jenjang 3 tidak mengembalikan apa pun", () => {
    expect(akibatPembatalan(3)).toBe("hangus");
  });

  it("jenjang 4 — PADMA yang membatalkan — mengembalikan uang penuh", () => {
    expect(akibatPembatalan(4)).toBe("refund");
  });
});

describe("kedaluwarsa hak", () => {
  it("berlakunya 30 hari", () => {
    expect(HARI_BERLAKU_HAK).toBe(30);
  });

  it("dihitung dari TANGGAL SESI, bukan tanggal pembatalan", () => {
    // Keputusan pemilik. Menghitungnya sejak pembatalan menghukum klien yang
    // membatalkan lebih awal — insentif terbalik, karena justru pembatalan
    // awal yang memungkinkan slotnya dijual lagi.
    expect(kedaluwarsaHak("2027-03-10")).toBe("2027-04-09");
  });

  it("menyeberangi pergantian bulan dan tahun dengan benar", () => {
    expect(kedaluwarsaHak("2027-12-20")).toBe("2028-01-19");
  });
});
