import type { ReactNode } from "react";

/**
 * Pembungkus tabel panel.
 *
 * `overflow-x-auto` ada di WADAHNYA, bukan di badan halaman: tabel lebar harus
 * menggulung di dalam kartunya sendiri, sebab halaman yang ikut menggulung
 * horizontal memindahkan seluruh tata letak setiap kali satu kolom bertambah.
 *
 * `min-w` memaksa gulungan itu benar-benar terjadi di layar sempit alih-alih
 * memampatkan kolom sampai tak terbaca.
 */
export function Tabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={label}
        className="w-full min-w-[34rem] border-collapse text-left text-[13px]"
      >
        {children}
      </table>
    </div>
  );
}

/** Kepala kolom. `scope="col"` bukan hiasan: tanpa itu pembaca layar tidak
 *  bisa menyebut kolom mana yang sedang dibacakan pada baris ke-20. */
export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`border-b border-panel-border px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.05em] text-panel-muted ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <td className={`border-b border-panel-border/70 px-3 py-2.5 align-top text-panel-ink ${className}`}>
      {children}
    </td>
  );
}
