// src/lib/materi/pdf-klien.ts
"use client";

import * as pdfjs from "pdfjs-dist";
import { LEBAR_RASTER, KUALITAS_WEBP } from "./rasterisasi";

// Worker disajikan dari paketnya sendiri lewat URL modul, bukan dari CDN:
// materi klinik tidak boleh bergantung pada host pihak ketiga yang bisa mati.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type HalamanRaster = {
  halaman: number;
  // Nyaris selalu WebP, TAPI TIDAK DIJAMIN — lihat komentar di canvas.toBlob()
  // di bawah. Nama objek storage berakhiran `.webp` (namaObjekHalaman) hanyalah
  // KONVENSI PENAMAAN, bukan jaminan isi byte; lihat komentar di
  // pengunggah-pdf.tsx pada panggilan uploadToSignedUrl() untuk alasan itu
  // tetap aman bagi pasien.
  blob: Blob;
  lebar: number;
  tinggi: number;
};

/**
 * Merender setiap halaman PDF menjadi gambar, DI BROWSER ADMIN.
 *
 * Rasterisasi sengaja tidak di server: pdfium/poppler adalah binary native yang
 * merepotkan di Vercel serverless dan akan memaksa worker terpisah. Browser
 * admin sudah punya mesin render PDF yang matang, dan ia hanya dipakai sekali
 * per unggahan.
 */
export async function rasterisasiPdf(
  berkas: File,
  onProgres: (selesai: number, total: number) => void,
): Promise<HalamanRaster[]> {
  const buf = await berkas.arrayBuffer();
  const tugas = pdfjs.getDocument({ data: buf });
  const dok = await tugas.promise;
  const hasil: HalamanRaster[] = [];

  // Seluruh loop di bawah dibungkus try/finally: tugas.destroy() WAJIB
  // tetap jalan walau loop berhenti di tengah karena galat (mis. satu
  // halaman rusak di antara 300) — kegagalan sebagian tidak boleh
  // membocorkan seluruh dokumen yang sudah terlanjur di-parse worker.
  try {
    for (let n = 1; n <= dok.numPages; n++) {
      const hal = await dok.getPage(n);
      const dasar = hal.getViewport({ scale: 1 });
      const skala = LEBAR_RASTER / dasar.width;
      const viewport = hal.getViewport({ scale: skala });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Peramban ini tidak mendukung canvas 2D.");

      // Latar putih: PDF berlatar transparan akan menjadi hitam di WebP.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await hal.render({ canvas, canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", KUALITAS_WEBP),
      );
      // `null` di sini BUKAN "peramban tidak bisa WebP": menurut spec, peramban
      // yang tidak mendukung tipe yang diminta justru mengganti diam-diam ke
      // image/png dan tetap mengembalikan blob. `null` disediakan untuk
      // kegagalan lain — canvas ternoda atau berukuran nol. Karena itu tidak
      // ada fallback format yang masuk akal ditulis di sini; yang ada hanya
      // kegagalan sungguhan.
      if (!blob) throw new Error(`Halaman ${n} gagal diekspor peramban ini.`);

      hasil.push({ halaman: n, blob, lebar: canvas.width, tinggi: canvas.height });
      // Dua sisi memori dilepas di sini, bukan satu. canvas.width = 0 memaksa
      // peramban membuang buffer piksel canvas — besar sendirian, satu canvas
      // 1600px bisa puluhan MB. hal.cleanup() melepas cache pdf.js SENDIRI
      // (font, gambar, operator list per halaman), yang SEBAGIAN hidup di
      // WORKER THREAD dan sama sekali tidak tersentuh oleh reset canvas di
      // atas. PDF 300 halaman tanpa keduanya menumpuk RAM di kedua sisi
      // sampai tab menggantung atau mati.
      canvas.width = 0;
      hal.cleanup();
      onProgres(n, dok.numPages);
    }
  } finally {
    // dok (PDFDocumentProxy) sendiri TIDAK punya destroy() di pdfjs-dist —
    // itu ada pada tugas (PDFDocumentLoadingTask, hasil getDocument() sebelum
    // di-await), yang mengabaikan seluruh request jaringan sisa & mematikan
    // worker-nya.
    await tugas.destroy();
  }
  return hasil;
}
