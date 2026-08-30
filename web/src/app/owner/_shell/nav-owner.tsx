"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lotus } from "@/app/_landing/lotus";

type Ikon = "lotus" | "rekap" | "tarif" | "admin";

const MENU: Array<{ href: string; label: string; ikon: Ikon }> = [
  { href: "/owner", label: "Beranda", ikon: "lotus" },
  // Prototipe menamainya "Rekap & Honor" dan "Rate Card"; labelnya dipendekkan
  // dengan alasan yang sama seperti nav admin — bottom bar mobile memotong
  // label panjang justru di tab yang paling perlu dikenali. Judul halamannya
  // tetap panjang.
  { href: "/owner/rekap", label: "Rekap", ikon: "rekap" },
  { href: "/owner/tarif", label: "Tarif", ikon: "tarif" },
];

// JALAN PULANG. Owner adalah SUPERSET admin — ia berhak membuka seluruh panel
// operasional — tetapi sebelum ini tidak ada satu pun tautan klik dari /owner
// ke /admin (terverifikasi: 0 tautan). Satu-satunya jalan adalah mengetik URL
// sendiri, yang berarti fitur itu praktis tidak ada bagi pemilik klinik.
//
// Sengaja BUKAN anggota MENU: ia bukan tab panel owner dan tidak pernah boleh
// ikut menyala sebagai `aria-current`. Ia jalan keluar, dan tampil berbeda
// supaya terbaca demikian.
const PULANG = { href: "/admin", label: "Buka Panel Admin" };

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
  // Batang grafik naik: rekap adalah angka yang dibandingkan antar pekan.
  if (jenis === "rekap")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <path d="M3.6 20.4h16.8" strokeLinecap="round" />
        <rect x="5.4" y="12.4" width="3.6" height="6" rx="1.1" />
        <rect x="10.2" y="8.2" width="3.6" height="10.2" rx="1.1" />
        <rect x="15" y="4.4" width="3.6" height="14" rx="1.1" />
      </svg>
    );
  // Kartu bertanda garis harga — "rate card", bukan lambang mata uang: nominal
  // rupiahnya ada di isi halaman, dan ikon "Rp" akan mengulanginya dua kali.
  if (jenis === "tarif")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.4" />
        <path d="M3.2 10.2h17.6M7 14.4h5.4M15.4 14.4h2.2" strokeLinecap="round" />
      </svg>
    );
  // Panah keluar dari kotak: menegaskan bahwa tautannya MENINGGALKAN panel
  // owner, bukan membuka tab keempat di dalamnya.
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path
        d="M13.4 4.6H5.6a1.6 1.6 0 0 0-1.6 1.6v12a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-7.8"
        strokeLinecap="round"
      />
      <path d="M14.2 4.6h5.2v5.2M19.4 4.6 11 13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Penanda tab aktif. `pathname.startsWith("/owner")` cocok untuk SEMUA
 * sub-rute, jadi Beranda diperiksa dengan kesamaan persis; sub-rute tetap
 * menyalakan tab induknya.
 */
export function aktifkan(pathname: string, href: string): boolean {
  if (href === "/owner") return pathname === "/owner";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavOwner() {
  const pathname = usePathname();
  return (
    <>
      {/* Tab desktop */}
      <nav
        aria-label="Menu panel owner"
        className="mb-5 hidden items-center gap-1.5 rounded-2xl border border-black/10 bg-white p-1.5 sm:flex"
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

        {/* Pemisah: yang di kanan bukan tab, melainkan jalan keluar. */}
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-black/10" />
        <Link
          href={PULANG.href}
          className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold text-leaf underline underline-offset-4 transition hover:text-night"
        >
          <Ikon jenis="admin" className="h-4 w-4" />
          {PULANG.label} →
        </Link>
      </nav>

      {/* Bottom bar mobile */}
      <nav
        aria-label="Navigasi panel owner"
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
        {/* Jalan pulang juga tersedia di mobile: label dipendekkan menjadi
            "Admin" agar tidak terpotong, teks utuhnya masuk ke aria-label. */}
        <Link
          href={PULANG.href}
          aria-label={PULANG.label}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1 text-[10px] font-bold text-gold-pale"
        >
          <Ikon jenis="admin" className="h-[21px] w-[21px]" />
          <span className="truncate">Admin</span>
        </Link>
      </nav>
    </>
  );
}
