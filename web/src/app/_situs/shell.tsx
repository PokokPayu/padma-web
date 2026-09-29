import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import type { bacaPengaturan } from "@/lib/settings";
import { kelasFontSitus } from "./font";
import { FooterSitus } from "./footer";
import { HeaderSitus, type HalamanSitus } from "./header";
import { TombolGaris, TombolWa } from "./tombol";
import { tautanWaSitus } from "./wa";

type Pengaturan = Awaited<ReturnType<typeof bacaPengaturan>>;

/**
 * Kerangka empat halaman situs publik. Sinkron dengan sengaja: halaman yang
 * membaca `bacaPengaturan()` lalu meneruskannya ke sini, supaya uji bisa
 * merender `await Page()` dengan `renderToStaticMarkup` (yang tidak mengenal
 * komponen async bersarang). Nomor WA tidak pernah ditulis keras.
 *
 * Rute publik: TIDAK memanggil requireRole.
 */
export function SitusShell({
  aktif,
  pengaturan,
  children,
}: {
  aktif: HalamanSitus;
  pengaturan: Pengaturan;
  children: ReactNode;
}) {
  const waHref = tautanWaSitus(pengaturan.nomorWaLink);
  return (
    <div
      className={`situs ${kelasFontSitus} flex min-h-full flex-1 flex-col overflow-x-clip bg-situs-krem font-jost text-situs-teks`}
    >
      <HeaderSitus aktif={aktif} waHref={waHref} />
      <main className="relative flex-1">{children}</main>
      <FooterSitus
        waTampilan={pengaturan.nomorWaTampilan}
        alamat={pengaturan.alamatTampilan}
        jam={pengaturan.jamTampilan}
      />
    </div>
  );
}

/** Posisi dalam urutan pembuka hero (`.situs-muncul`, lihat globals.css). */
export function urutan(n: number): CSSProperties {
  return { "--urutan": n } as CSSProperties;
}

/** Lebar isi seragam: 1280px, gutter 20px di HP dan 64px di desktop. */
export function Wadah({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-[1280px] px-5 md:px-16 ${className}`}>{children}</div>;
}

export function Label({ children, gelap = false, className = "" }: { children: ReactNode; gelap?: boolean; className?: string }) {
  return (
    <p
      className={`text-[13px] font-semibold tracking-[4px] uppercase ${
        gelap ? "text-situs-emas-pucat" : "text-situs-emas"
      } ${className}`}
    >
      {children}
    </p>
  );
}

export function JudulSeksi({
  children,
  gelap = false,
  className = "",
}: {
  children: ReactNode;
  gelap?: boolean;
  className?: string;
}) {
  return (
    <h2
      className={`font-garamond text-[32px] leading-[1.1] font-semibold md:text-[42px] ${
        gelap ? "text-situs-krem" : "text-situs-judul"
      } ${className}`}
    >
      {children}
    </h2>
  );
}

/** Pita CTA hijau dengan ilustrasi ibu-anak dan tagline script (Beranda & Layanan). */
export function CtaHijau({
  judul,
  waHref,
  denganLayanan = true,
}: {
  judul: string;
  waHref: string;
  denganLayanan?: boolean;
}) {
  return (
    <section className="bg-situs-hutan">
      <div className="mx-auto flex max-w-[1280px] items-center gap-8 overflow-hidden md:h-[260px] md:pr-16">
        <Image
          src="/situs/cta-ibu-anak.png"
          alt=""
          width={330}
          height={260}
          className="hidden h-[260px] w-[330px] shrink-0 object-cover md:block"
        />
        <div className="flex flex-1 flex-col items-center gap-[22px] px-5 py-12 text-center md:px-0 md:py-0">
          <h2 className="font-garamond text-[32px] leading-[1.1] font-semibold text-situs-krem md:text-[44px]">
            {judul}
          </h2>
          <div className="flex flex-wrap justify-center gap-3.5">
            <TombolWa href={waHref} gelap />
            {denganLayanan && (
              <TombolGaris href="/layanan" gelap>
                Lihat Layanan
              </TombolGaris>
            )}
          </div>
        </div>
        <span className="hidden w-[200px] shrink-0 -rotate-[8deg] font-parisienne text-[34px] leading-[1.15] text-situs-emas-pucat lg:block">
          Nurturing in Every Stage of Life
        </span>
      </div>
    </section>
  );
}

/** Penutup krem polos (Tentang & Digital Passport). */
export function CtaKrem({ waHref }: { waHref: string }) {
  return (
    <section className="border-t border-situs-garis bg-situs-krem">
      <Wadah className="flex flex-col items-center gap-6 py-14 text-center">
        <JudulSeksi className="md:text-[46px]">Ilmu Nyata, Keluarga Berdaya.</JudulSeksi>
        <div className="flex flex-wrap justify-center gap-3.5">
          <TombolWa href={waHref} />
          <TombolGaris href="/layanan">Lihat Layanan</TombolGaris>
        </div>
      </Wadah>
    </section>
  );
}
