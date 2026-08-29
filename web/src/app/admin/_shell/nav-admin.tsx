"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lotus } from "@/app/_landing/lotus";
import type { Antrean } from "@/lib/admin/antrean";

type Ikon = "lotus" | "inbox" | "user" | "cal" | "bayar" | "mitra";

// `badge` menunjuk medan Antrean yang dipakai, bukan angkanya — supaya satu
// sumber angka (server) tidak pernah tersalin ulang sebagai literal di UI.
const MENU: Array<{
  href: string;
  label: string;
  ikon: Ikon;
  badge?: keyof Antrean;
}> = [
  { href: "/admin", label: "Beranda", ikon: "lotus" },
  { href: "/admin/skrining", label: "Inbox", ikon: "inbox", badge: "skriningBaru" },
  { href: "/admin/klien", label: "Klien", ikon: "user", badge: "klienBelumAktif" },
  { href: "/admin/sesi", label: "Sesi", ikon: "cal", badge: "permintaanMenunggu" },
  // Label sengaja "Bayar", bukan "Pembayaran": bottom bar mobile memuat enam
  // tujuan dan label panjang akan terpotong justru di tab yang paling perlu
  // dikenali. Judul halamannya tetap "Pembayaran".
  { href: "/admin/bayar", label: "Bayar", ikon: "bayar", badge: "klaimMenunggu" },
  { href: "/admin/mitra", label: "Mitra", ikon: "mitra" },
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
  if (jenis === "inbox")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <path
          d="M3.5 13.5h4.2l1.5 2.6h5.6l1.5-2.6h4.2M3.5 13.5 6 5.2h12L20.5 13.5v4.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (jenis === "user")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" strokeLinecap="round" />
      </svg>
    );
  if (jenis === "cal")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17M8 2.8v3.7M16 2.8v3.7" strokeLinecap="round" />
      </svg>
    );
  // Kuitansi, bukan lambang mata uang: panel admin tidak pernah menampilkan
  // nominal, dan ikon "Rp" akan menjanjikan angka yang memang tidak ada.
  if (jenis === "bayar")
    return (
      <svg viewBox="0 0 24 24" {...p}>
        <path
          d="M5.5 3.6h13v16.8l-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5-2.2-1.5-2.1 1.5z"
          strokeLinejoin="round"
        />
        <path d="M9 8.4h6M9 12.2h6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.6 20c1-3.2 3.4-4.8 6.4-4.8s5.4 1.6 6.4 4.8" strokeLinecap="round" />
      <path d="M16.4 5.2a3.2 3.2 0 0 1 0 5.9M18.4 20c-.4-1.7-1.1-3-2.1-3.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Penanda tab aktif. `pathname.startsWith("/admin")` cocok untuk SEMUA
 * sub-rute, jadi Beranda diperiksa dengan kesamaan persis; sub-rute (mis.
 * `/admin/klien/<id>`) tetap menyalakan tab induknya.
 */
export function aktifkan(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Badge antrean. Sengaja HILANG saat nol: badge "0" yang selalu tampil membuat
 * panel terlihat selalu punya pekerjaan, dan alarm yang dinormalkan berhenti
 * berarti.
 */
function Badge({ jumlah, gelap }: { jumlah: number; gelap: boolean }) {
  if (jumlah <= 0) return null;
  return (
    <span
      aria-label={`${jumlah} menunggu`}
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold ${
        gelap ? "bg-night text-gold-pale" : "bg-clay text-white"
      }`}
    >
      {jumlah}
    </span>
  );
}

export function NavAdmin({ antrean }: { antrean: Antrean }) {
  const pathname = usePathname();
  return (
    <>
      {/* Tab desktop */}
      <nav
        aria-label="Menu panel admin"
        className="mb-5 hidden gap-1.5 rounded-2xl border border-black/10 bg-white p-1.5 sm:flex"
      >
        {MENU.map((m) => {
          const aktif = aktifkan(pathname, m.href);
          const jumlah = m.badge ? antrean[m.badge] : 0;
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
              <Badge jumlah={jumlah} gelap={aktif} />
            </Link>
          );
        })}
      </nav>

      {/* Bottom bar mobile */}
      <nav
        aria-label="Navigasi panel admin"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-gold/25 bg-night/95 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:hidden"
      >
        {MENU.map((m) => {
          const aktif = aktifkan(pathname, m.href);
          const jumlah = m.badge ? antrean[m.badge] : 0;
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={aktif ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1 text-[10px] font-bold ${
                aktif ? "text-gold-bright" : "text-[#9DB09E]"
              }`}
            >
              <span className="relative">
                <Ikon jenis={m.ikon} className="h-[21px] w-[21px]" />
                <span className="absolute -right-2.5 -top-1.5">
                  <Badge jumlah={jumlah} gelap={false} />
                </span>
              </span>
              <span className="truncate">{m.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
