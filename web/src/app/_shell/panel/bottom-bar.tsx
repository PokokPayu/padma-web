"use client";

import Link from "next/link";
import { Ikon } from "./ikon";
import { aktifkan } from "./aktif";
import { Badge } from "./badge";
import type { ItemMenu, Tautan } from "./sidebar";

/**
 * Bar bawah layar kecil.
 *
 * Ia BUKAN salinan seluruh menu: drawer sudah memuat semuanya. Yang tinggal
 * di sini hanya tujuan tersibuk, supaya staf yang bekerja dari HP tidak
 * kehilangan satu ketukan untuk pekerjaan yang paling sering dilakukan.
 *
 * Badge ikut tampil di sini: antrean yang hanya terlihat di desktop adalah
 * antrean yang tidak terlihat, sebab panel ini memang dipakai dari HP.
 */
export function BottomBar({
  menu,
  akar,
  pathname,
  labelNav,
  jalanKeluar,
}: {
  menu: ItemMenu[];
  akar: string;
  pathname: string;
  labelNav: string;
  jalanKeluar?: Tautan;
}) {
  return (
    <nav
      aria-label={labelNav}
      className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-gold/25 bg-panel-rail/95 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
    >
      {menu.map((m) => {
        const aktif = aktifkan(pathname, m.href, akar);
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={aktif ? "page" : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold ${
              aktif ? "text-gold-bright" : "text-panel-rail-ink"
            }`}
          >
            <span className="relative">
              <Ikon nama={m.ikon} className="h-[21px] w-[21px]" />
              <span className="absolute -right-2.5 -top-1.5">
                <Badge jumlah={m.jumlah ?? 0} />
              </span>
            </span>
            <span className="truncate">{m.label}</span>
          </Link>
        );
      })}

      {jalanKeluar && (
        <Link
          href={jalanKeluar.href}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold text-gold-pale"
        >
          <Ikon nama={jalanKeluar.ikon} className="h-[21px] w-[21px]" />
          <span className="truncate">{jalanKeluar.label}</span>
        </Link>
      )}
    </nav>
  );
}
