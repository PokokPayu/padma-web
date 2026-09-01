// tests/materi-pengunggah.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

describe("pengunggah PDF — pagar struktural", () => {
  it("rasterisasi hidup di modul klien, bukan di modul yang diimpor server", () => {
    // pdfjs-dist menyentuh DOM/canvas: mengimpornya dari modul server akan
    // mematahkan build pada rute yang sama sekali tidak berhubungan.
    expect(baca("src/lib/materi/pdf-klien.ts")).toContain("pdfjs-dist");
    expect(baca("src/lib/materi/rasterisasi.ts")).not.toContain("pdfjs-dist");
  });

  it("komponen pengunggah adalah client component", () => {
    expect(baca("src/app/admin/materi/pengunggah-pdf.tsx").trimStart())
      .toMatch(/^"use client"/);
  });

  it("batas halaman & ukuran diperiksa SEBELUM unggahan dimulai", () => {
    const s = baca("src/app/admin/materi/pengunggah-pdf.tsx");
    expect(s).toContain("periksaBerkasPdf");
    expect(s).toContain("MAKS_HALAMAN");
  });

  it("pencatatan baris hanya terjadi setelah seluruh unggahan sukses", () => {
    const s = baca("src/app/admin/materi/pengunggah-pdf.tsx");
    const posUnggah = s.indexOf("uploadToSignedUrl");
    // Dicari MULAI DARI posUnggah, bukan dari awal berkas: "catatHalamanMateri"
    // juga muncul di baris impor di puncak berkas (sebelum kode unggahan apa
    // pun), jadi indexOf() polos akan selalu menemukan impor itu duluan dan
    // asersi di bawah lolos meski panggilannya dipindah ke sebelum unggahan.
    const posCatat = s.indexOf("catatHalamanMateri", posUnggah);
    expect(posUnggah).toBeGreaterThan(-1);
    expect(posCatat).toBeGreaterThan(posUnggah);
  });

  it("unggahan dibatasi konkurensinya", () => {
    expect(baca("src/app/admin/materi/pengunggah-pdf.tsx")).toContain("KONKURENSI_UNGGAH");
  });
});
