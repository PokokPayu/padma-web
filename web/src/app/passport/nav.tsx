"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuAkun } from "@/app/_shell/menu-akun";
import { Lotus } from "@/app/_landing/lotus";

type Ikon = "lotus" | "cal" | "book" | "qr" | "user";

const MENU: Array<{ href: string; label: string; ikon: Ikon }> = [
  { href: "/passport", label: "Beranda", ikon: "lotus" },
  { href: "/passport/sesi", label: "Sesi", ikon: "cal" },
  { href: "/passport/materi", label: "Materi", ikon: "book" },
  { href: "/passport/bayar", label: "Bayar", ikon: "qr" },
  { href: "/passport/profil", label: "Profil", ikon: "user" },
];

function Ikon({ jenis, className }: { jenis: Ikon; className?: string }) {
  const p = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    "aria-hidden": true,
  } as const;
  // Lambang teratai dipakai ulang dari komponen bersama — path SVG-nya
  // sengaja tidak disalin ulang di sini.
  if (jenis === "lotus") return <Lotus className={className} />;
  if (jenis === "cal")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17M8 2.8v3.7M16 2.8v3.7" strokeLinecap="round" />
      </svg>
    );
  if (jenis === "book")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <path
          d="M12 6.5C10 4.8 7 4.3 3.5 4.5v14c3.5-.2 6.5.3 8.5 2 2-1.7 5-2.2 8.5-2v-14C17 4.3 14 4.8 12 6.5z"
          strokeLinejoin="round"
        />
        <path d="M12 6.5v13.6" />
      </svg>
    );
  if (jenis === "qr")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" strokeLinejoin="round" />
        <path d="M14 14h3v3h-3zM20 14v6h-6" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Penanda tab aktif. `pathname.startsWith("/passport")` cocok untuk SEMUA
 * sub-rute, jadi Beranda diperiksa dengan kesamaan persis. `/passport/ajukan`
 * sengaja tidak punya tab sendiri — ia lanjutan dari Beranda.
 */
export function aktifkan(pathname: string, href: string): boolean {
  if (href === "/passport") {
    return pathname === "/passport" || pathname === "/passport/ajukan";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavPassport({ nama }: { nama: string }) {
  const pathname = usePathname();
  return (
    <>
      {/* Tab desktop */}
      <nav
        aria-label="Menu passport"
        className="mb-5 hidden gap-1.5 rounded-2xl border border-black/10 bg-white p-1.5 sm:flex"
      >
        {MENU.map((m) => {
          const aktif = aktifkan(pathname, m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={aktif ? "page" : undefined}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-[13px] font-bold transition ${
                aktif ? "bg-night text-gold-pale" : "text-ink-soft hover:text-night"
              }`}
            >
              <Ikon jenis={m.ikon} className="h-4 w-4" />
              {m.label}
            </Link>
          );
        })}

        {/* Pemisah: yang di kanan bukan tab, melainkan identitas & jalan keluar. */}
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-black/10" />
        <MenuAkun nama={nama} peran="Klien" />
      </nav>

      {/* Bottom bar mobile */}
      <nav
        aria-label="Navigasi passport"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-gold/25 bg-night/95 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:hidden"
      >
        {MENU.map((m) => {
          const aktif = aktifkan(pathname, m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={aktif ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1 text-[10px] font-bold ${
                aktif ? "text-gold-bright" : "text-[#9DB09E]"
              }`}
            >
              <Ikon jenis={m.ikon} className="h-[21px] w-[21px]" />
              <span className="truncate">{m.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
