import { describe, it, expect } from "vitest";
import { buatPdfUji } from "./bantu/pdf";
import {
  namaObjekHalaman, periksaBerkasPdf, MAKS_HALAMAN, MAKS_BYTE_PDF,
} from "@/lib/materi/rasterisasi";

describe("pembuat PDF uji", () => {
  it("menghasilkan PDF yang sah dan berukuran wajar", () => {
    const pdf = buatPdfUji(3);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("%%EOF");
    expect(pdf.toString("latin1")).toContain("/Count 3");
  });
});

describe("penamaan objek halaman", () => {
  it("berpadding empat digit supaya urutan leksikografis = urutan halaman", () => {
    expect(namaObjekHalaman("abc", 1)).toBe("abc/0001.webp");
    expect(namaObjekHalaman("abc", 42)).toBe("abc/0042.webp");
    // Tanpa padding, "10" akan berada sebelum "2" saat objek dilist.
    const urut = [1, 2, 10].map((n) => namaObjekHalaman("abc", n)).sort();
    expect(urut).toEqual(["abc/0001.webp", "abc/0002.webp", "abc/0010.webp"]);
  });
});

describe("batas berkas PDF", () => {
  it("menolak yang bukan .pdf", () => {
    const r = periksaBerkasPdf("materi.docx", 1000);
    expect(r.ok).toBe(false);
  });
  it("menolak yang melampaui batas dan MENYEBUT angkanya", () => {
    const r = periksaBerkasPdf("materi.pdf", MAKS_BYTE_PDF + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toContain("60");
  });
  it("menerima PDF wajar", () => {
    expect(periksaBerkasPdf("materi.pdf", 5_000_000).ok).toBe(true);
  });
  it("batas halaman terdefinisi dan masuk akal", () => {
    expect(MAKS_HALAMAN).toBe(300);
  });
});
