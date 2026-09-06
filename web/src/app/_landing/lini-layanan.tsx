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

// `formatRupiah` di `lib/owner/rupiah.ts` SENGAJA tidak diimpor di sini —
// komentar di berkas itu sendiri menandainya "hanya untuk panel owner" justru
// supaya nominal tidak diam-diam menyebar ke layar publik. Landing memang
// kini menampilkan harga (spec V4 §4.4, keputusan sadar Task 8, BUKAN
// kebocoran yang sama dengan yang dijaga di sana), jadi ia memakai
// formatternya SENDIRI alih-alih melanggar batas yang digambar berkas itu.
function formatRupiah(nilai: number): string {
  return `Rp ${Math.round(nilai).toLocaleString("id-ID")}`;
}

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
            <ul className="space-y-2">
              {f.layanan.map((layanan) => (
                <li
                  key={layanan.id}
                  className="rounded-xl border border-black/10 bg-paper px-3 py-2"
                >
                  <p className="text-[11.5px] font-semibold text-[#4E6154]">{layanan.nama}</p>
                  {layanan.varian.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {layanan.varian.map((v, i) => (
                        <li
                          key={i}
                          className="flex flex-wrap items-baseline gap-x-1.5 text-[10.5px] text-ink-soft"
                        >
                          {/* Varian baku (labelVarian kembali string kosong)
                              tidak menyumbang teks apa pun di sini — nama
                              layanan di atas sudah cukup mewakilinya. */}
                          {v.label !== "" && <span>{v.label}</span>}
                          <span className="font-bold text-night">
                            {formatRupiah(v.hargaKlien)}
                          </span>
                          {v.hargaCoret !== null && (
                            <>
                              <s className="text-ink-soft/70">{formatRupiah(v.hargaCoret)}</s>
                              <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold">
                                Soft Launch
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
