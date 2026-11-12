// tests/materi-pengunggah.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/**
 * Berkas yang dipindai ketiga pagar urutan di bawah adalah
 * `unggah-pdf-klien.ts`, BUKAN `pengunggah-pdf.tsx` seperti sebelumnya.
 *
 * Seluruh kerja unggahnya pindah ke sana saat formulir "Materi baru" ikut
 * menerima PDF (butir 6 umpan balik klien 21 Sep 2026: "1 klik aja gitu mas
 * dari board admin, langsung upload?"). Menyalin logikanya ke formulir baru
 * akan melahirkan DUA jalur unggah — dan yang bisa menyimpang di antara
 * keduanya persis urutan yang dijaga di bawah, yaitu urutan yang menentukan
 * apakah materi bisa berakhir setengah terisi. Satu modul bersama, satu
 * berkas yang dipindai.
 *
 * `pengunggah-pdf.tsx` kini tinggal fase & kalimat di layar; ia tetap diperiksa
 * sebagai client component di bawah.
 */
const MODUL_UNGGAH = "src/app/admin/materi/unggah-pdf-klien.ts";

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

  it("modul unggah bersama juga client component", () => {
    // `createBrowserSupabase` & canvas-nya hidup di peramban. Modul ini
    // diimpor DUA komponen klien; direktifnya tetap wajib ada supaya ia tidak
    // pernah ikut terseret ke bundel server oleh pengimpor ketiga kelak.
    expect(baca(MODUL_UNGGAH).trimStart()).toMatch(/^"use client"/);
  });

  it("batas halaman & ukuran diperiksa SEBELUM unggahan dimulai", () => {
    const s = baca(MODUL_UNGGAH);
    expect(s).toContain("periksaBerkasPdf");
    expect(s).toContain("MAKS_HALAMAN");
    // Kedua "toContain" di atas TIDAK CUKUP (dibuktikan lewat mutasi):
    // keduanya tetap hijau walau panggilan periksaBerkasPdf() dipindah ke
    // SETELAH rasterisasiPdf() dipanggil — nama importnya saja sudah membuat
    // toContain lolos. "SEBELUM" berarti PDF yang jelas kelewat besar/rusak
    // ditolak SEBELUM peramban membuang waktu & memori merender halamannya;
    // urutan itu hanya terbukti lewat posisi panggilan sungguhan, bukan sekadar
    // penyebutan nama.
    // Regex bertoleransi spasi/baris-baru (\s*), bukan indexOf literal: sebuah
    // line-wrap Prettier di antara "(" dan "berkas" akan mematahkan indexOf
    // literal dan membuat test merah karena format, bukan karena properti yang
    // dijaga — persis pola yang sudah dipakai di asersi KONKURENSI_UNGGAH di
    // bawah.
    const posPeriksa = s.search(/periksaBerkasPdf\(\s*berkas/);
    const posRasterisasi = s.search(/rasterisasiPdf\(\s*berkas/);
    expect(posPeriksa).toBeGreaterThan(-1);
    expect(posRasterisasi).toBeGreaterThan(-1);
    expect(posPeriksa).toBeLessThan(posRasterisasi);

    // Urutan di atas murah tapi rendah taruhannya. Urutan yang SUNGGUH
    // berbahaya: pemeriksaan MAKS_HALAMAN atas JUMLAH HALAMAN HASIL
    // RASTERISASI SUNGGUHAN wajib mendahului terbitkanUrlUnggahHalaman(),
    // sebab aksi itu MENGHAPUS baris & objek materi yang sudah ada (lihat
    // unggah.ts) SEBELUM tahu apakah PDF penggantinya layak diterima.
    // Terbalik = e-book lama yang berfungsi lenyap demi PDF yang lantas
    // ditolak — dan baris materinya berakhir "belum ada isi", bukan
    // setengah terisi (state paling sulit disadari).
    const posBatasHalaman = s.search(/halaman\.length\s*>\s*MAKS_HALAMAN/);
    const posTerbitkanUrl = s.search(/terbitkanUrlUnggahHalaman\(\s*materiId/);
    expect(posBatasHalaman).toBeGreaterThan(-1);
    expect(posTerbitkanUrl).toBeGreaterThan(-1);
    expect(posBatasHalaman).toBeLessThan(posTerbitkanUrl);
  });

  it("pencatatan baris hanya terjadi setelah seluruh unggahan sukses", () => {
    const s = baca(MODUL_UNGGAH);
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
    const s = baca(MODUL_UNGGAH);
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

  it("hanya ADA SATU jalur unggah — formulir baru tidak menyalinnya", () => {
    // Pagar yang lahir bersama butir 6. Dua salinan logika unggah bisa
    // menyimpang diam-diam, dan yang menyimpang bukan kosmetik: urutan
    // "unggah semua dulu, catat baris belakangan" adalah satu-satunya hal
    // yang mencegah materi berakhir SETENGAH terisi — terlihat utuh di panel
    // admin, rusak di tangan klien.
    for (const berkas of [
      "src/app/admin/materi/form-materi.tsx",
      "src/app/admin/materi/pengunggah-pdf.tsx",
    ]) {
      const s = baca(berkas);
      expect(s, `${berkas} memanggil unggahan sendiri`).not.toContain("uploadToSignedUrl");
      expect(s, `${berkas} menerbitkan URL unggah sendiri`).not.toContain(
        "terbitkanUrlUnggahHalaman",
      );
    }
  });
});
