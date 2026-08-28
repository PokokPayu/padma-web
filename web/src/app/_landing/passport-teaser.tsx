import Link from "next/link";

const MANFAAT = [
  "Riwayat semua sesi & layanan Anda, rapi di satu tempat",
  "Catatan dan rekomendasi dari bidan setelah setiap kunjungan",
  "E-book & video panduan yang terbuka sesuai layanan Anda",
  "Progres paket yang terlihat — seperti stempel di paspor",
];

// Kartu di kanan adalah ILUSTRASI tampilan passport (data contoh, bukan klien
// nyata) — sama seperti prototipe yang disetujui klien.
const CONTOH_ISI: Array<[string, string]> = [
  ["Fase perjalanan", "Sankalpa · Promil"],
  ["Paket aktif", "Sankalpa Prima · 8 sesi"],
  ["Progres", "6 dari 8 sesi"],
];

export function PassportTeaser() {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 py-20 md:grid-cols-2">
      <div>
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
          <span className="inline-block h-px w-6 bg-gold" />
          Digital Care Passport
        </p>
        <h2 className="font-serif text-3xl text-night sm:text-4xl">
          Bukan sekadar homecare. Perjalanan yang tercatat.
        </h2>
        <ul className="mt-5 grid gap-3 text-[14.5px] text-[#3C4C42]">
          {MANFAAT.map((t) => (
            <li key={t} className="flex gap-3">
              <span className="font-extrabold text-gold">✦</span>
              {t}
            </li>
          ))}
        </ul>
        <Link
          href="/masuk"
          className="mt-7 inline-block rounded-xl bg-night px-6 py-3.5 font-bold text-gold-pale"
        >
          Masuk ke Passport
        </Link>
      </div>

      <div className="mx-auto w-full max-w-[400px] -rotate-2 rounded-[22px] border border-gold/30 bg-gradient-to-br from-pine to-night p-8 text-[#EFE6CE] shadow-2xl">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.34em] text-gold-bright">
          Digital Care Passport
        </p>
        <p className="mt-2 text-center font-serif text-2xl text-[#F7F0DD]">
          Ananda Putri
        </p>
        <p className="text-center font-mono text-xs text-[#B9C6B4]">
          PAD-2607-0012
        </p>
        <dl className="mt-5 text-[12.5px]">
          {CONTOH_ISI.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between border-t border-gold/15 py-2.5"
            >
              <dt>{k}</dt>
              <dd className="font-semibold text-gold-pale">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-lg bg-black/25 px-3 py-2.5 text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#C9BE9A]">
          PAD-2607-0012 · Sankalpa Prima · Sesi 6/8
        </p>
        <p className="mt-3 text-center text-[10.5px] uppercase tracking-[0.18em] text-[#8FA391]">
          Ilustrasi tampilan — data contoh
        </p>
      </div>
    </section>
  );
}
