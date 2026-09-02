// src/lib/materi/watermark.ts
import sharp from "sharp";

/**
 * Membakar identitas pasien KE DALAM gambar halaman.
 *
 * Kenapa dibakar dan bukan dilapiskan lewat CSS: lapisan CSS hilang begitu
 * gambarnya disimpan, sehingga halaman yang tersebar menjadi tidak bisa
 * dilacak sama sekali. Membakarnya adalah satu-satunya cara kebocoran ebook
 * menunjuk akun sumbernya.
 *
 * Sudut, opasitas, dan bunyi teks sengaja SAMA dengan komponen `Watermark`
 * yang sudah ada di passport, supaya tampilannya tidak berubah bagi pasien —
 * yang berubah hanya letaknya: kini di dalam gambar, bukan di atasnya.
 */

/**
 * Teks masuk ke dokumen SVG. Nama diketik admin (`clients.nama`, diisi lewat
 * panel "Klien" saat mendaftarkan pasien — lihat `src/app/admin/klien/aksi.ts`),
 * jadi ia data tak tepercaya di konteks XML dalam DUA cara berbeda, dan
 * meng-escape lima entity saja hanya menutup satu di antaranya:
 *
 *   1. Karakter yang PUNYA arti sintaksis XML (`< > & " '`) — ditutup
 *      escaping di bawah, seperti semula.
 *   2. Karakter kontrol C0 mentah (0x00-0x1F, KECUALI tab/LF/CR — satu-
 *      satunya tiga yang XML 1.0 anggap legal) — TIDAK PUNYA representasi
 *      escaped yang sah sama sekali di XML 1.0; `&#x0B;` bukan solusi, ia
 *      tetap character reference ke code point yang XML sendiri melarang.
 *      Satu nama berisi salah satunya (mis. tertinggal dari salin-tempel,
 *      atau upaya jahat) membuat `sharp.composite` MENOLAK seluruh SVG-nya:
 *      `bakarWatermark` throw, rute penyaji membalas 500 tak tertangkap —
 *      untuk SETIAP halaman SETIAP e-book milik klien itu, PERMANEN, tanpa
 *      satu pun jejak di layar yang mengarah ke penyebabnya (nama pasien).
 *      Karakter-karakter ini karena itu DIBUANG, bukan di-escape — tidak ada
 *      escape yang bisa menjadikannya sah.
 */
function amanXml(teks: string): string {
  return teks
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

export async function bakarWatermark(
  gambar: Buffer,
  nama: string,
  padmaId: string,
): Promise<Buffer> {
  const meta = await sharp(gambar).metadata();
  const lebar = meta.width;
  const tinggi = meta.height;
  if (!lebar || !tinggi) throw new Error("Gambar halaman tidak terbaca.");

  const ukuranHuruf = Math.max(10, Math.round(lebar * 0.016));
  const teks = amanXml(`${nama} · ${padmaId}`);
  const jarakY = ukuranHuruf * 7;
  const baris: string[] = [];
  for (let y = -tinggi; y < tinggi * 2; y += jarakY) {
    baris.push(
      `<text x="0" y="${y}" font-family="monospace" font-size="${ukuranHuruf}" ` +
        `fill="#0E2A1E" fill-opacity="0.08" letter-spacing="2">` +
        `${teks} &#160;&#160; ${teks} &#160;&#160; ${teks} &#160;&#160; ${teks}</text>`,
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lebar}" height="${tinggi}">` +
    `<g transform="rotate(-24 ${lebar / 2} ${tinggi / 2})">${baris.join("")}</g>` +
    `</svg>`;

  return sharp(gambar)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 82 })
    .toBuffer();
}
