import { Lotus } from "./lotus";

// `waTampilan` datang dari `bacaPengaturan()` (app_settings) — satu sumber
// nomor untuk seluruh aplikasi. Jangan menuliskannya keras di sini.
export function Footer({ waTampilan }: { waTampilan: string }) {
  return (
    <footer className="bg-night px-6 py-14 text-[#9DB09E]">
      <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-8">
        <div>
          <p className="flex items-center gap-3">
            <Lotus className="w-7 text-gold-bright" />
            <span className="font-serif text-base tracking-[0.26em] text-[#F3EAD3]">
              PADMA
            </span>
          </p>
          <p className="mt-3.5 max-w-[300px] text-[12.5px]">
            Premium women&rsquo;s wellness homecare.
            <br />
            Personal · Terarah · Bermakna.
          </p>
        </div>
        <div className="text-[13px] leading-loose">
          <b className="text-[#DCE6DC]">Hubungi kami</b>
          <br />
          WhatsApp: {waTampilan}
          <br />
          Melayani area Jabodetabek
        </div>
      </div>
      <p className="mx-auto mt-9 max-w-6xl border-t border-gold/15 pt-4 text-[11.5px] text-[#6E8271]">
        © PADMA 2026.
      </p>
    </footer>
  );
}
