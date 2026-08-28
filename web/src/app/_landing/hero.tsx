import Link from "next/link";
import { Lotus } from "./lotus";

// Baris kepercayaan: klaim kepatuhan sengaja HANYA ACOG & CDC (pagar
// keselamatan #6). Menambah sumber lain = klaim tanpa dasar.
const KEPERCAYAAN: Array<[string, string]> = [
  ["Skrining keselamatan", "mengikuti prinsip panduan ACOG & CDC"],
  ["Perawatan di rumah", "oleh mitra bidan berpengalaman"],
  ["Digital Care Passport", "satu klien, satu perjalanan terdokumentasi"],
];

export function Hero({ waLink }: { waLink: string }) {
  return (
    // `overflow-hidden` WAJIB mendahului lotus dekoratif di bawah: lotusnya
    // diposisikan absolut melewati tepi kanan, dan tanpa pengurung ini layar
    // 390px mendapat scroll horizontal.
    <div className="relative overflow-hidden bg-night text-[#E9EFE7]">
      <Lotus className="pointer-events-none absolute -bottom-10 -right-14 w-[420px] text-gold-bright opacity-10" />
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Link href="/" className="flex items-center gap-3">
          <Lotus className="w-8 text-gold-bright" />
          <span className="font-serif text-xl tracking-[0.26em] text-[#F3EAD3]">
            PADMA
          </span>
        </Link>
        <Link
          href="/skrining"
          className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-[#FFF8EA]"
        >
          Mulai Skrining
        </Link>
      </nav>

      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-10">
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold-bright">
          <span className="inline-block h-px w-6 bg-gold-bright" />
          Homecare promil &amp; perawatan perempuan
        </p>
        <h1 className="max-w-[14em] font-serif text-4xl leading-[1.14] text-[#F7F1E2] sm:text-5xl">
          Setiap fase hidup perempuan layak didampingi dengan care yang{" "}
          <em className="not-italic text-gold-bright">tercatat</em>.
        </h1>
        <p className="mt-5 max-w-[34em] text-[17px] text-[#BFCDBE]">
          Bidan berpengalaman datang ke rumah Anda — dan setiap sesi, catatan,
          serta rekomendasinya terdokumentasi rapi di Digital Care Passport
          pribadi Anda.
        </p>
        <div className="mt-8 flex flex-wrap gap-3.5">
          <Link
            href="/skrining"
            className="rounded-xl bg-gold px-6 py-3.5 font-bold text-[#FFF8EA]"
          >
            Mulai Skrining Gratis · 2 menit
          </Link>
          <a
            href={`https://wa.me/${waLink}`}
            target="_blank"
            rel="noopener"
            className="rounded-xl border-[1.5px] border-gold/30 px-6 py-3.5 font-bold text-gold-pale"
          >
            Chat WhatsApp
          </a>
        </div>

        <div className="mt-11 flex flex-wrap gap-7 border-t border-gold/20 pt-5 text-[13px] text-[#A9BBAA]">
          {KEPERCAYAAN.map(([judul, isi]) => (
            <p key={judul} className="flex max-w-[230px] gap-2.5">
              <span className="text-gold-bright">✦</span>
              <span>
                <b className="text-[#E5DFC8]">{judul}</b>
                <br />
                {isi}
              </span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
