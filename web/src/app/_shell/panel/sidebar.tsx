"use client";

import Link from "next/link";
import { Ikon, type NamaIkon } from "./ikon";
import { aktifkan } from "./aktif";
import { Badge } from "./badge";

/**
 * Satu tujuan di menu panel. `jumlah` sudah berupa ANGKA, bukan kunci ke
 * struktur antrean mana pun: primitif ini tidak boleh tahu bentuk data panel
 * yang memakainya, dan tidak boleh mengambil datanya sendiri.
 */
export type ItemMenu = {
  href: string;
  label: string;
  ikon: NamaIkon;
  jumlah?: number;
};

/** Tautan yang MENINGGALKAN panel ini — bukan tujuan, jadi tidak pernah aktif. */
export type Tautan = { href: string; label: string; ikon: NamaIkon };

/**
 * Sidebar gelap panel staf.
 *
 * Dirender SEKALI lalu digeser (`-translate-x-full` → `translate-x-0`), bukan
 * dirender dua kali untuk desktop dan drawer. Dua salinan berarti setiap
 * tautan hadir dua kali di DOM: fokus keyboard bisa mendarat di salinan yang
 * tidak terlihat, dan pembaca layar mengumumkan seluruh menu dua kali.
 */
export function Sidebar({
  menu,
  akar,
  pathname,
  namaPanel,
  labelNav,
  terbuka,
  jalanKeluar,
}: {
  menu: ItemMenu[];
  akar: string;
  pathname: string;
  namaPanel: string;
  labelNav: string;
  terbuka: boolean;
  jalanKeluar?: Tautan;
}) {
  return (
    <nav
      id="sidebar-panel"
      aria-label={labelNav}
      className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-panel-rail transition-transform duration-200 motion-reduce:transition-none lg:translate-x-0 ${
        terbuka ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        {/* Lambang tetap teratai VEKTOR, bukan logo raster dari klien: berkas
            logo itu berlatar hijau bertekstur tanpa transparansi dan teks
            melingkarnya hilang di bawah ~120px. Lihat §7 spec. */}
        <Ikon nama="lotus" className="h-7 w-7 shrink-0 text-gold-bright" />
        <span className="min-w-0">
          <span className="block text-[15px] font-extrabold tracking-[0.14em] text-gold-pale">
            PADMA
          </span>
          <span className="block truncate text-[11px] font-bold text-panel-rail-ink">
            {namaPanel}
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        {menu.map((m) => {
          const aktif = aktifkan(pathname, m.href, akar);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={aktif ? "page" : undefined}
              className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-bold transition ${
                aktif
                  ? "bg-white/10 text-panel-rail-aktif"
                  : "text-panel-rail-ink hover:bg-white/5 hover:text-panel-rail-aktif"
              }`}
            >
              {aktif && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-gold-bright"
                />
              )}
              <Ikon nama={m.ikon} className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1 truncate">{m.label}</span>
              <Badge jumlah={m.jumlah ?? 0} />
            </Link>
          );
        })}
      </div>

      {jalanKeluar && (
        <div className="border-t border-white/10 px-2.5 py-3">
          <Link
            href={jalanKeluar.href}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-bold text-gold-bright transition hover:bg-white/5"
          >
            <Ikon nama={jalanKeluar.ikon} className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{jalanKeluar.label}</span>
          </Link>
        </div>
      )}
    </nav>
  );
}
