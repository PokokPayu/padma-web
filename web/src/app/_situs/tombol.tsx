import Link from "next/link";
import type { ReactNode } from "react";
import { IkonPanah, IkonWa } from "./ikon";

// Tiga bentuk tombol di mockup: emas penuh (CTA utama), garis hijau (aksi
// kedua di latar terang), dan garis linen (aksi kedua di latar hijau).
// `gelap` menukar tombol emas ke varian muda yang terbaca di atas hijau.

const dasar =
  "group inline-flex w-full items-center justify-center gap-2.5 sm:w-auto rounded-[10px] font-medium transition-[background-color,color,transform] duration-200 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-situs-emas";

export function TombolWa({
  href,
  gelap = false,
  kecil = false,
}: {
  href: string;
  gelap?: boolean;
  kecil?: boolean;
}) {
  const warna = gelap
    ? "bg-situs-emas-muda text-[#1D1A14] font-semibold hover:bg-situs-emas-pucat"
    : "bg-situs-emas text-white hover:bg-situs-emas-tua";
  const ukuran = kecil ? "px-5 py-3 text-[15px]" : "px-[26px] py-[15px] text-[17px]";
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${dasar} ${warna} ${ukuran}`}>
      <IkonWa className={kecil ? "size-[18px]" : "size-5"} />
      Tanya Kelas &amp; Pricelist
    </a>
  );
}

export function TombolGaris({
  href,
  children,
  gelap = false,
  ikon = <IkonPanah className="size-[18px] transition-transform duration-200 group-hover:translate-x-1" />,
}: {
  href: string;
  children: ReactNode;
  gelap?: boolean;
  ikon?: ReactNode;
}) {
  const warna = gelap
    ? "border-situs-linen text-situs-krem hover:bg-white/10"
    : "border-situs-judul text-situs-judul hover:bg-situs-judul/5";
  return (
    <Link href={href} className={`${dasar} border-[1.5px] px-6 py-3.5 text-[17px] ${warna}`}>
      {children}
      {ikon}
    </Link>
  );
}
