"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, type ItemMenu, type Tautan } from "./sidebar";
import { BottomBar } from "./bottom-bar";
import { Topbar } from "./topbar";
import { aktifkan } from "./aktif";
import { pasangPenutup } from "./tutup-drawer";

/**
 * Kerangka satu panel staf: sidebar + topbar + bottom bar + area kerja.
 *
 * BUTA PERAN — komponen ini tidak tahu bedanya admin dan owner. Daftar menu,
 * nama panel, dan catatan kaki semuanya datang sebagai prop dari shell
 * masing-masing panel, yang memegang penjaga perannya sendiri. Itu bukan
 * kerapian yang dikorbankan: money firewall PADMA bersifat FISIK, dan satu
 * daftar menu bersama akan menguranginya menjadi satu kondisional peran.
 *
 * Area kerja sengaja bukan <main>: setiap halaman panel sudah merender
 * <main> miliknya sendiri, dan <main> bersarang bukan HTML yang sah.
 */
export function KerangkaPanel({
  menu,
  menuRingkas,
  akar,
  namaPanel,
  labelSidebar,
  labelBottomBar,
  nama,
  peran,
  catatan,
  jalanKeluar,
  children,
}: {
  menu: ItemMenu[];
  /** Tujuan tersibuk untuk bar bawah layar kecil; selebihnya lewat drawer. */
  menuRingkas: ItemMenu[];
  akar: string;
  namaPanel: string;
  labelSidebar: string;
  labelBottomBar: string;
  nama: string;
  peran: string;
  catatan: ReactNode;
  jalanKeluar?: Tautan;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [buka, setBuka] = useState(false);

  // Drawer tertutup setiap kali rute berganti. Tanpa ini, mengetuk satu tujuan
  // meninggalkan panel gelap menutupi halaman yang baru saja dibuka.
  //
  // Disesuaikan langsung di badan render (bukan di dalam useEffect): pola ini
  // adalah "menyesuaikan state ketika prop berubah" yang didokumentasikan React
  // sendiri — memanggil setState secara sinkron di dalam efek memicu render
  // berantai yang tak perlu, sedangkan pola ini menyatu ke render yang sama.
  const [pathnameSebelumnya, setPathnameSebelumnya] = useState(pathname);
  if (pathname !== pathnameSebelumnya) {
    setPathnameSebelumnya(pathname);
    setBuka(false);
  }

  useEffect(() => {
    if (!buka) return;
    return pasangPenutup(document, () => setBuka(false));
  }, [buka]);

  // Di layar kecil sidebar tersembunyi, jadi topbar yang menyebut tujuan aktif.
  // Di luar seluruh tujuan, nama panel dipakai — bukan judul kosong.
  const judul = menu.find((m) => aktifkan(pathname, m.href, akar))?.label ?? namaPanel;

  return (
    <div className="min-h-screen bg-panel-bg lg:pl-60">
      <Sidebar
        menu={menu}
        akar={akar}
        pathname={pathname}
        namaPanel={namaPanel}
        labelNav={labelSidebar}
        terbuka={buka}
        jalanKeluar={jalanKeluar}
      />

      {buka && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setBuka(false)}
          className="fixed inset-0 z-30 bg-night/45 lg:hidden"
        />
      )}

      <Topbar
        judul={judul}
        nama={nama}
        peran={peran}
        drawerBuka={buka}
        onToggleDrawer={() => setBuka((v) => !v)}
      />

      <div className="px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {children}
        <div className="mt-10 border-t border-panel-border pt-4 text-[11.5px] leading-relaxed text-panel-muted">
          {catatan}
        </div>
      </div>

      <BottomBar
        menu={menuRingkas}
        akar={akar}
        pathname={pathname}
        labelNav={labelBottomBar}
        jalanKeluar={jalanKeluar}
      />
    </div>
  );
}
