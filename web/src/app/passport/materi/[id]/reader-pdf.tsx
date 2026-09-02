"use client";

/**
 * Reader e-book: deretan gambar halaman.
 *
 * Watermark TIDAK dilapiskan di sini — ia sudah ada di dalam setiap gambar,
 * dibakar server. Lapisan CSS akan hilang begitu gambarnya disimpan; yang
 * dibakar tidak.
 *
 * `width`/`height` diisi dari dimensi asli supaya peramban menyediakan ruang
 * sebelum gambarnya tiba. Tanpa itu, membaca sambil menggulir akan membuat
 * halaman melompat setiap satu gambar selesai dimuat.
 */
export function ReaderPdf({
  materiId,
  halaman,
}: {
  materiId: string;
  halaman: Array<{ halaman: number; lebar: number; tinggi: number }>;
}) {
  return (
    <div
      className="grid gap-4 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {halaman.map((h) => (
        <figure key={h.halaman} className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          <img
            src={`/api/materi/${materiId}/halaman/${h.halaman}`}
            width={h.lebar}
            height={h.tinggi}
            loading={h.halaman <= 2 ? "eager" : "lazy"}
            draggable={false}
            alt={`Halaman ${h.halaman}`}
            className="block h-auto w-full"
          />
          <figcaption className="border-t border-black/10 px-4 py-2 text-center text-[11.5px] text-ink-soft">
            Halaman {h.halaman} dari {halaman.length}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
