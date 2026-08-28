import type { FaseKatalog } from "@/lib/katalog";

// Aksara Sanskerta per fase — dekorasi, dipetakan dari id fase.
// Nama fase & daftar layanannya TIDAK ditulis di sini: keduanya datang dari
// DB (`bacaKatalog`) supaya panel admin klien benar-benar mengubah landing.
const AKSARA: Record<string, string> = {
  prekonsepsi: "स",
  kehamilan: "ग",
  nifas: "पू",
  menopause: "ध",
  newborn: "शि",
};

export function LiniLayanan({ katalog }: { katalog: FaseKatalog[] }) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-11 max-w-[640px]">
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
          <span className="inline-block h-px w-6 bg-gold" />
          Lini Layanan
        </p>
        <h2 className="font-serif text-3xl text-night sm:text-4xl">
          Lima fase, satu perjalanan.
        </h2>
        <p className="mt-2 text-ink-soft">
          Setiap lini dinamai dari bahasa Sanskerta — karena setiap fase adalah
          babak yang bermakna.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        {katalog.map((f) => (
          <article
            key={f.id}
            className="rounded-2xl border border-black/10 bg-white p-6 transition hover:-translate-y-1 hover:border-gold/30 hover:shadow-lg"
          >
            <div className="mb-3.5 flex items-center gap-2 font-serif text-[15px] tracking-widest text-gold">
              {AKSARA[f.id] ?? "◆"}
              <span className="h-px flex-1 bg-black/10" />
            </div>
            <h3 className="font-serif text-xl text-night">{f.namaSanskrit}</h3>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-soft">
              {f.nama}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {f.layanan.map((nama) => (
                <li
                  key={nama}
                  className="rounded-full border border-black/10 bg-paper px-2.5 py-1 text-[11px] font-semibold text-[#4E6154]"
                >
                  {nama}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
