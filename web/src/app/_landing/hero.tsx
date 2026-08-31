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
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between gap-2 px-5 py-5 sm:gap-4 sm:px-6">
        {/* `aria-label` disetel di tautannya, bukan diandalkan dari teks di
            dalamnya: di layar 320px wordmark-nya disembunyikan, dan tanpa label
            ini tautan beranda akan kehilangan namanya sama sekali. */}
        <Link
          href="/"
          aria-label="PADMA — beranda"
          className="flex min-w-0 items-center gap-2.5 sm:gap-3"
        >
          <Lotus className="w-7 shrink-0 text-gold-bright sm:w-8" />
          {/* Di 320px, tracking wordmark membuatnya berhimpit dengan "Masuk"
              sampai terbaca sebagai satu kata ("PADMAMasuk"). Lambang teratai
              sendiri sudah menandai merek dan tetap menjadi tautan beranda. */}
          <span className="font-serif text-lg tracking-[0.2em] text-[#F3EAD3] max-[359px]:hidden sm:text-xl sm:tracking-[0.26em]">
            PADMA
          </span>
        </Link>
        {/* Dua tujuan berbeda, dan urutannya disengaja. "Mulai Skrining" tetap
            aksi utama karena landing ini menyapa pengunjung baru. Tetapi klien
            LAMA yang datang untuk membuka passport-nya sebelumnya tidak punya
            jalan sama sekali dari sini: satu-satunya tautan masuk terkubur di
            tengah halaman, di dalam bagian teaser passport. Karena itu "Masuk"
            hadir di sini juga — sengaja tanpa latar, supaya menambah jalan
            tanpa ikut berebut perhatian dengan aksi utama. */}
        {/* `shrink-0` + `whitespace-nowrap`: menambah "Masuk" membuat dua aksi
            berebut lebar yang sama, dan di 390px label CTA-nya sempat pecah
            menjadi dua baris sehingga seluruh nav ikut meninggi. Padding dan
            ukuran teksnya dirapatkan khusus di mobile, bukan diperkecil di
            semua lebar. */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2.5">
          <Link
            href="/masuk"
            className="whitespace-nowrap rounded-xl px-2 py-2 text-[13px] font-bold text-gold-pale transition hover:text-gold-bright sm:px-3 sm:py-2.5 sm:text-sm"
          >
            Masuk
          </Link>
          <Link
            href="/skrining"
            className="whitespace-nowrap rounded-xl bg-gold px-3 py-2 text-[13px] font-bold text-[#FFF8EA] sm:px-4 sm:py-2.5 sm:text-sm"
          >
            Mulai Skrining
          </Link>
        </div>
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
