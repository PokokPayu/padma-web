import Link from "next/link";
import { Merek } from "./header";
import { IkonInstagram, IkonTiktok } from "./ikon";
import { INSTAGRAM, TIKTOK } from "./wa";

const TAUTAN_FOOTER = [
  { label: "Beranda", href: "/" },
  { label: "Layanan", href: "/layanan" },
  { label: "Tentang PADMA", href: "/tentang" },
  { label: "Digital Passport", href: "/digital-passport" },
  { label: "FAQ", href: "/#faq" },
  { label: "Masuk", href: "/masuk" },
];

// Baris kontak di bawah tidak ada di mockup, tetapi ketiga nilainya disunting
// admin di /admin/pengaturan dan panel itu menjanjikan "halaman publik sudah
// memakai nilai baru". Membuangnya membuat kartu setelan jadi kendali mati
// (lihat `src/lib/settings.ts` & tests/admin-pengaturan.test.ts).
export function FooterSitus({
  waTampilan,
  alamat,
  jam,
}: {
  waTampilan: string;
  alamat: string;
  jam: string;
}) {
  return (
    <footer className="border-t border-[#1E5646] bg-situs-hutan-gelap text-situs-linen">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-8 px-5 py-9 md:flex-row md:items-start md:justify-between md:px-16">
        <Merek gelap />
        <nav aria-label="Tautan footer" className="flex max-w-[560px] flex-wrap gap-x-[22px] gap-y-2.5 text-sm">
          {TAUTAN_FOOTER.map((t) => (
            <Link key={t.href} href={t.href} className="text-situs-linen hover:text-situs-emas-pucat">
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2.5 text-[15px]">
          <span className="text-[13px] font-semibold text-situs-emas-pucat">Follow PADMA</span>
          <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2.5 text-situs-linen hover:text-situs-emas-pucat">
            <IkonInstagram className="size-6" />
            Instagram @padmawellness.id
          </a>
          <a href={TIKTOK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2.5 text-situs-linen hover:text-situs-emas-pucat">
            <IkonTiktok className="size-6" />
            TikTok @padmawellness.id
          </a>
        </div>
      </div>
      <div className="border-t border-[#1E5646]">
        <p className="mx-auto flex max-w-[1280px] flex-wrap gap-x-4 gap-y-1 px-5 py-4 text-[13px] text-situs-pudar md:px-16">
          <span>WhatsApp {waTampilan}</span>
          <span aria-hidden="true">·</span>
          <span>{alamat}</span>
          <span aria-hidden="true">·</span>
          <span>{jam}</span>
        </p>
      </div>
    </footer>
  );
}
