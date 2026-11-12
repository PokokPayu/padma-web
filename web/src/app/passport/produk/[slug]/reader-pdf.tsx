"use client";

/**
 * Reader satu materi PDF: deretan gambar halaman.
 *
 * Watermark TIDAK dilapiskan di sini — ia sudah dibakar server ke dalam
 * setiap gambar oleh `/api/produk/materi/[id]/halaman/[n]`. Pola yang sama dipakai
 * `passport/materi/[id]/reader-pdf.tsx`; salinan LOKAL karena rute API dan
 * prop yang dipakainya berbeda (materi produk vs materi layanan), bukan gaya baru.
 *
 * `digital_product_pages` tidak menyimpan lebar/tinggi (beda dari
 * `material_pages`), jadi tidak ada `width`/`height` eksplisit di sini —
 * peramban menyisakan ruang begitu gambarnya tiba.
 */
export function ReaderPdf({
  materiId,
  halaman,
}: {
  materiId: string;
  halaman: number[];
}) {
  return (
    <div
      className="grid gap-4 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {halaman.map((h) => (
        <figure key={h} className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          <img
            src={`/api/produk/materi/${materiId}/halaman/${h}`}
            loading={h <= 2 ? "eager" : "lazy"}
            draggable={false}
            alt={`Halaman ${h}`}
            className="block h-auto w-full"
          />
          <figcaption className="border-t border-black/10 px-4 py-2 text-center text-[11.5px] text-ink-soft">
            Halaman {h} dari {halaman.length}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
