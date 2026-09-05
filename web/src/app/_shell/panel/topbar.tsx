"use client";

import { MenuAkun } from "@/app/_shell/menu-akun";
import { Ikon } from "./ikon";

/**
 * Strip terang di atas area kerja: tombol drawer (hanya layar kecil), nama
 * tujuan yang sedang dibuka, dan identitas pemakai.
 *
 * `judul` disebut di sini karena di layar kecil sidebar tersembunyi — tanpa
 * itu tidak ada penanda "kamu di sini" sama sekali. Ia sengaja BUKAN <h1>:
 * setiap halaman panel sudah merender <main><h1> miliknya sendiri.
 *
 * Identitas & logout dipakai ulang dari `MenuAkun`, tidak ditulis ulang.
 * Logout di sana adalah <form method="post"> — navigasi dokumen penuh yang
 * menghapus Client Cache; menyalinnya sebagai tautan biasa akan meninggalkan
 * sisa data pemakai sebelumnya, dan di panel owner sisa itu berupa nominal.
 */
export function Topbar({
  judul,
  nama,
  peran,
  drawerBuka,
  onToggleDrawer,
}: {
  judul: string;
  nama: string;
  peran: string;
  drawerBuka: boolean;
  onToggleDrawer: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-panel-border bg-panel-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={onToggleDrawer}
        aria-controls="sidebar-panel"
        aria-expanded={drawerBuka}
        aria-label={drawerBuka ? "Tutup menu" : "Buka menu"}
        className="-ml-1.5 rounded-lg p-2 text-panel-muted transition hover:bg-black/5 hover:text-panel-ink lg:hidden"
      >
        <Ikon nama="menu" className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-panel-ink">
        {judul}
      </span>
      <MenuAkun nama={nama} peran={peran} />
    </header>
  );
}
