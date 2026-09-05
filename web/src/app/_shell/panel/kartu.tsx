import type { ReactNode } from "react";

/**
 * Permukaan isi panel staf: putih, bergaris 1px, radius 8px.
 *
 * Kepala hanya lahir bila ada `judul` atau `aksi` — kartu tanpa keduanya tidak
 * boleh menyisakan bilah kosong yang memakan tinggi tanpa memberi informasi.
 */
export function Kartu({
  judul,
  aksi,
  children,
  className = "",
}: {
  judul?: string;
  /** Tautan atau tombol di sisi kanan kepala, mis. "Lihat semua". */
  aksi?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-panel-border bg-panel-surface ${className}`}
    >
      {(judul || aksi) && (
        <header className="flex items-center justify-between gap-3 border-b border-panel-border px-4 py-3">
          {judul && (
            <h2 className="text-[13px] font-bold text-panel-ink">{judul}</h2>
          )}
          {aksi}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
