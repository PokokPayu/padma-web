import { describe, it, expect } from "vitest";
import { normalkanAlamat } from "@/lib/transport/alamat";

/**
 * Normalisasi adalah KUNCI CACHE. Dua ketikan yang secara wajar sama harus
 * menghasilkan kunci yang sama, kalau tidak Nominatim ditanya berkali-kali
 * untuk alamat yang itu-itu juga — pelanggaran batas laju yang lahir dari
 * niat baik.
 */
describe("normalkanAlamat", () => {
  it("mengabaikan beda huruf besar-kecil", () => {
    expect(normalkanAlamat("Jl. Merdeka No. 10")).toBe(normalkanAlamat("jl. merdeka no. 10"));
  });

  it("meratakan spasi berlebih", () => {
    expect(normalkanAlamat("Jl.  Merdeka   No. 10")).toBe(normalkanAlamat("Jl. Merdeka No. 10"));
  });

  it("membuang spasi di ujung", () => {
    expect(normalkanAlamat("  Jl. Merdeka No. 10  ")).toBe(normalkanAlamat("Jl. Merdeka No. 10"));
  });

  it("alamat yang benar-benar berbeda tetap berbeda", () => {
    expect(normalkanAlamat("Jl. Merdeka No. 10")).not.toBe(normalkanAlamat("Jl. Merdeka No. 11"));
  });

  it("alamat kosong memulangkan string kosong", () => {
    expect(normalkanAlamat("   ")).toBe("");
  });
});
