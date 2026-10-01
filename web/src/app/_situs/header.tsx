import Link from "next/link";
import { IkonMenu, IkonWa, LogoTeratai } from "./ikon";
import { TombolWa } from "./tombol";

export type HalamanSitus = "beranda" | "layanan" | "digital-passport" | "tentang" | "artikel" | "testimoni";

// Mockup juga menautkan PADMA Learn, PADMA Live, dan PADMA Home, tetapi
// halamannya belum ada (README "Halaman belum ada"). Tautan `#` di situs yang
// sudah live hanya membuat pengunjung mengeklik lalu tidak ke mana-mana, jadi
// ketiganya menunggu halamannya lahir.
export const NAV_SITUS: { id: HalamanSitus; label: string; href: string }[] = [
  { id: "beranda", label: "Beranda", href: "/" },
  { id: "layanan", label: "Layanan", href: "/layanan" },
  { id: "digital-passport", label: "Digital Passport", href: "/digital-passport" },
  { id: "tentang", label: "Tentang PADMA", href: "/tentang" },
  { id: "artikel", label: "Artikel", href: "/artikel" },
  { id: "testimoni", label: "Testimoni", href: "/testimoni" },
];

export function Merek({ gelap = false }: { gelap?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoTeratai
        className={`h-9 w-[42px] shrink-0 ${gelap ? "text-situs-emas-pucat" : "text-situs-emas"}`}
      />
      <span className="flex flex-col gap-0.5">
        <span
          className={`font-garamond text-[26px] leading-none font-bold tracking-[5px] md:text-[28px] ${
            gelap ? "text-situs-krem" : "text-situs-judul"
          }`}
        >
          PADMA
        </span>
        <span
          className={`text-[11px] tracking-[0.5px] max-[359px]:hidden ${gelap ? "text-situs-emas-pucat" : "text-situs-emas"}`}
        >
          Premium Women&apos;s Wellness
        </span>
      </span>
    </span>
  );
}

export function HeaderSitus({ aktif, waHref }: { aktif: HalamanSitus; waHref: string }) {
  return (
    <header className="situs-header sticky top-0 z-40 border-b border-situs-garis bg-situs-kartu">
      <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between gap-3 px-5 md:px-10 lg:h-20 lg:gap-6 lg:px-12">
        <Link href="/" aria-label="PADMA — Beranda">
          <Merek />
        </Link>

        <nav aria-label="Navigasi utama" className="hidden items-center gap-6 text-[15px] xl:flex">
          {NAV_SITUS.map((n) => (
            <Link
              key={n.id}
              href={n.href}
              aria-current={n.id === aktif ? "page" : undefined}
              className={
                n.id === aktif
                  ? "border-b-2 border-situs-emas pb-1 font-semibold text-situs-judul"
                  : "pb-1 text-situs-teks-soft hover:text-situs-judul"
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-5 xl:flex">
          <Link href="/masuk" className="text-[15px] font-semibold text-situs-judul hover:text-situs-emas">
            Masuk
          </Link>
          <TombolWa href={waHref} kecil />
        </div>

        {/* Di HP CTA utama tetap satu ketukan jauhnya: menu menyembunyikan
            navigasi, bukan jalan menuju WhatsApp. */}
        <div className="flex items-center gap-2 xl:hidden">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Tanya Kelas & Pricelist lewat WhatsApp"
            className="flex size-11 items-center justify-center rounded-[10px] bg-situs-emas text-white transition-colors hover:bg-situs-emas-tua active:translate-y-px"
          >
            <IkonWa className="size-[22px]" />
          </a>
          {/* Menu HP tanpa JavaScript klien. `key` membuatnya tertutup lagi
              setiap pindah halaman — <details> menyimpan status `open` di DOM,
              dan navigasi klien Next memakai ulang node yang sama. */}
          <details key={aktif} className="situs-menu group xl:hidden">
            <summary
              className="flex h-11 cursor-pointer gap-1.5 px-3 text-sm font-medium list-none items-center justify-center rounded-[10px] border border-situs-garis text-situs-judul transition-colors hover:bg-situs-pasir group-open:bg-situs-pasir [&::-webkit-details-marker]:hidden"
            >
              <IkonMenu className="size-5" />
              Menu
            </summary>
            <div className="situs-menu-panel absolute inset-x-0 top-full z-30 border-b border-situs-garis bg-situs-kartu px-5 pt-2 pb-6 shadow-[0_12px_24px_-12px_rgba(18,63,53,0.25)]">
              <nav aria-label="Navigasi utama" className="flex flex-col">
                {NAV_SITUS.map((n) => (
                  <Link
                    key={n.id}
                    href={n.href}
                    aria-current={n.id === aktif ? "page" : undefined}
                    className={`border-b border-situs-garis py-3.5 text-base ${
                      n.id === aktif ? "font-semibold text-situs-emas" : "text-situs-judul"
                    }`}
                  >
                    {n.label}
                  </Link>
                ))}
                <Link href="/masuk" className="border-b border-situs-garis py-3.5 text-base font-semibold text-situs-judul">
                  Masuk
                </Link>
              </nav>
              <div className="mt-5 flex flex-col">
                <TombolWa href={waHref} />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
