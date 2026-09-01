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
    // Kedua "toContain" di atas TIDAK CUKUP (dibuktikan lewat mutasi):
    // keduanya tetap hijau walau panggilan periksaBerkasPdf() dipindah ke
    // SETELAH rasterisasiPdf() dipanggil — nama importnya saja sudah membuat
    // toContain lolos. "SEBELUM" berarti PDF yang jelas kelewat besar/rusak
    // ditolak SEBELUM peramban membuang waktu & memori merender halamannya;
    // urutan itu hanya terbukti lewat posisi panggilan sungguhan, bukan sekadar
    // penyebutan nama.
    const posPeriksa = s.indexOf("periksaBerkasPdf(berkas");
    const posRasterisasi = s.indexOf("rasterisasiPdf(berkas");
    expect(posPeriksa).toBeGreaterThan(-1);
    expect(posRasterisasi).toBeGreaterThan(-1);
    expect(posPeriksa).toBeLessThan(posRasterisasi);
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
    const s = baca("src/app/admin/materi/pengunggah-pdf.tsx");
    expect(s).toContain("KONKURENSI_UNGGAH");
    // "toContain" saja TIDAK CUKUP (dibuktikan lewat mutasi): tetap hijau
    // walau batasnya dilepas total dan seluruh halaman diunggah SEKALIGUS —
    // nama itu tetap muncul lewat baris impor yang jadi tak terpakai, dan baik
    // vitest maupun tsc tidak menandai impor tak terpakai di proyek ini.
    // KONKURENSI_UNGGAH wajib muncul bersanding Math.min(...) yang membatasi
    // panjang array pekerja — bukti ia benar dipakai membatasi, bukan sekadar
    // diimpor.
    expect(s).toMatch(/Math\.min\(\s*KONKURENSI_UNGGAH\s*,/);
  });
});
