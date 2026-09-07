import { describe, it, expect } from "vitest";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";

function fd(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

describe("koordinatDariFormData", () => {
  it("membaca pin yang sah", () => {
    expect(koordinatDariFormData(fd({ lat: "-7.9666", lon: "112.6326" }))).toEqual({
      lat: -7.9666,
      lon: 112.6326,
    });
  });

  it("MEDAN KOSONG memulangkan null, BUKAN {0,0}", () => {
    // Number("") === 0. Tanpa penjagaan eksplisit, formulir yang petanya tidak
    // pernah disentuh akan menyimpan Teluk Guinea sebagai lokasi klien.
    expect(koordinatDariFormData(fd({ lat: "", lon: "" }))).toBeNull();
    expect(koordinatDariFormData(fd({}))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "   ", lon: "   " }))).toBeNull();
  });

  it("nol yang DITULIS EKSPLISIT tetap diterima", () => {
    // Membuktikan bahwa penjagaan di atas memeriksa KEKOSONGAN, bukan sekadar
    // menolak nilai nol — kalau tidak, uji di atasnya bisa lulus karena alasan
    // yang salah.
    expect(koordinatDariFormData(fd({ lat: "0", lon: "0" }))).toEqual({ lat: 0, lon: 0 });
  });

  it("satu medan saja memulangkan null", () => {
    expect(koordinatDariFormData(fd({ lat: "-7.9666" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lon: "112.6326" }))).toBeNull();
  });

  it("bukan angka memulangkan null", () => {
    expect(koordinatDariFormData(fd({ lat: "abc", lon: "112.6" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "NaN", lon: "112.6" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "Infinity", lon: "112.6" }))).toBeNull();
  });

  it("di luar rentang bumi memulangkan null", () => {
    expect(koordinatDariFormData(fd({ lat: "-91", lon: "112.6" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "-7.9", lon: "181" }))).toBeNull();
  });
});
