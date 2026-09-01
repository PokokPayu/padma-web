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
  const dok = await pdfjs.getDocument({ data: buf }).promise;
  const hasil: HalamanRaster[] = [];

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
    // Peramban yang tidak bisa mengekspor WebP jatuh ke JPEG, bukan gagal.
    const akhir =
      blob ??
      (await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Gagal mengekspor halaman."))),
          "image/jpeg",
          0.85,
        ),
      ));

    hasil.push({ halaman: n, blob: akhir, lebar: canvas.width, tinggi: canvas.height });
    canvas.width = 0; // lepaskan memori: 300 canvas 1600px akan menghabiskan RAM
    onProgres(n, dok.numPages);
  }
  return hasil;
}
