import { Lotus } from "./lotus";

const HOMECARE_BIASA = [
  "Datang, treatment selesai, lalu selesai begitu saja",
  "Edukasi sering tidak terdokumentasi",
  "Klien sulit melihat perjalanan care secara utuh",
];

const DENGAN_PASSPORT = [
  "Layanan terasa lebih eksklusif dan personal",
  "Ada continuity of care dari sesi ke sesi",
  "Bonus edukasi tersimpan rapi dalam satu tempat",
  "Klien merasa dipandu, lebih tenang, dan lebih dihargai",
];

export function Pembanding() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-11 max-w-[640px]">
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
          <span className="inline-block h-px w-6 bg-gold" />
          Pembeda PADMA
        </p>
        <h2 className="font-serif text-3xl text-night sm:text-4xl">
          Homecare biasa, atau sebuah journey?
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-paper-warm p-7">
          <h3 className="font-serif text-xl text-night">Homecare biasa</h3>
          <ul className="mt-4 grid gap-2.5 text-[13.5px] text-[#4A594F]">
            {HOMECARE_BIASA.map((t) => (
              <li key={t} className="flex gap-3">
                <span className="font-extrabold text-[#B08573]">✕</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7">
          <h3 className="font-serif text-xl text-[#F5EEDC]">
            Dengan Digital Care Passport
          </h3>
          <ul className="mt-4 grid gap-2.5 text-[13.5px] text-[#C2CFC1]">
            {DENGAN_PASSPORT.map((t) => (
              <li key={t} className="flex gap-3">
                <span className="font-extrabold text-gold-bright">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <blockquote className="mt-6 rounded-2xl border border-gold/30 bg-night px-7 py-7 text-center font-serif text-lg text-[#F0E6CC] sm:text-xl">
        <Lotus className="mx-auto mb-3 w-8 text-gold-bright" />
        &ldquo;PADMA tidak hanya memberi layanan, tetapi membangun journey.&rdquo;
      </blockquote>
    </section>
  );
}
