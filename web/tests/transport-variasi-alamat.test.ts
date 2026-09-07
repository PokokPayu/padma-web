import { describe, it, expect } from "vitest";
import { variasiAlamat } from "@/lib/transport/alamat";

describe("variasiAlamat — tangga pengupasan alamat", () => {
  it("alamat lengkap Malang menghasilkan tiga tingkat, makin longgar", () => {
    expect(variasiAlamat("Jl. Besar Ijen No. 77, Oro-oro Dowo, Klojen, Kota Malang")).toEqual([
      "Jl. Besar Ijen No. 77, Oro-oro Dowo, Klojen, Kota Malang",
      "Jl. Besar Ijen, Oro-oro Dowo, Klojen, Kota Malang",
      "Jl. Besar Ijen, Kota Malang",
    ]);
  });

  it("gang, blok, dan RT/RW ikut dibuang di tingkat JALAN+KOTA", () => {
    // Bentuk-bentuk ini yang paling sering ditulis klien PADMA, dan justru
    // merekalah yang mematikan pencarian Nominatim.
    expect(
      variasiAlamat("Jl. Joyosuko Metro Gang IV No. 12, Merjosari, Lowokwaru, Kota Malang").at(-1),
    ).toBe("Jl. Joyosuko Metro, Kota Malang");
    expect(variasiAlamat("Jl. Anggrek Blok C2 No. 45, Perumahan Griya Asri, Bekasi").at(-1)).toBe(
      "Jl. Anggrek, Bekasi",
    );
    expect(variasiAlamat("Jl. Muharto Gg. 5 RT 07 RW 03, Jodipan, Kota Malang").at(-1)).toBe(
      "Jl. Muharto, Kota Malang",
    );
  });

  it("VARIAN KEMBAR DIBUANG — pertanyaan yang sama tidak pernah ditanyakan dua kali", () => {
    // Ini yang menjaga alamat tanpa bagian untuk dikupas tetap berbiaya SATU
    // permintaan, bukan tiga. Tanpa ini, ladder membakar jatah Nominatim untuk
    // menanyakan hal yang sama berulang kali.
    expect(variasiAlamat("Universitas Brawijaya")).toEqual(["Universitas Brawijaya"]);
    expect(variasiAlamat("Jl. Veteran, Kota Malang")).toEqual(["Jl. Veteran, Kota Malang"]);
  });

  it("alamat kosong tidak menghasilkan varian apa pun", () => {
    expect(variasiAlamat("   ")).toEqual([]);
    expect(variasiAlamat("")).toEqual([]);
  });

  it("tingkat pertama SELALU alamat apa adanya", () => {
    // Yang paling spesifik dicoba lebih dulu; pengupasan hanya cadangan.
    const v = variasiAlamat("Jl. Kawi No. 24, Bareng, Klojen, Kota Malang");
    expect(v[0]).toBe("Jl. Kawi No. 24, Bareng, Klojen, Kota Malang");
    expect(v.length).toBeGreaterThan(1);
  });

  it("nomor rumah dikenali dalam beberapa penulisan", () => {
    expect(variasiAlamat("Jl. Kawi No. 24, Malang")[1]).toBe("Jl. Kawi, Malang");
    expect(variasiAlamat("Jl. Kawi no 24, Malang")[1]).toBe("Jl. Kawi, Malang");
    expect(variasiAlamat("Jl. Kawi Nomor 24, Malang")[1]).toBe("Jl. Kawi, Malang");
    expect(variasiAlamat("Jl. Kawi No. 2A, Malang")[1]).toBe("Jl. Kawi, Malang");
  });
});
