const LANGKAH: Array<[string, string, string]> = [
  [
    "01",
    "Skrining awal",
    "Dua menit menjawab pertanyaan keselamatan — demi memastikan layanan aman untuk kondisi Anda saat ini.",
  ],
  [
    "02",
    "Jadwal via WhatsApp",
    "Tim PADMA menghubungi Anda, menyepakati layanan, jadwal, dan bidan yang datang.",
  ],
  [
    "03",
    "Perawatan di rumah",
    "Bidan datang ke rumah Anda. Tanpa antre, tanpa perjalanan, dalam suasana paling nyaman.",
  ],
  [
    "04",
    "Tercatat di Passport",
    "Catatan sesi, evaluasi, dan rekomendasi tersimpan di Digital Care Passport Anda — selamanya.",
  ],
];

export function CaraKerja() {
  return (
    <section className="border-y border-black/10 bg-paper-warm">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-11 max-w-[640px]">
          <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
            <span className="inline-block h-px w-6 bg-gold" />
            Cara Kerja
          </p>
          <h2 className="font-serif text-3xl text-night sm:text-4xl">
            Dari skrining sampai terdokumentasi.
          </h2>
        </div>
        <ol className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {LANGKAH.map(([no, judul, isi]) => (
            <li key={no} className="border-l border-black/10 pl-6">
              <span className="font-mono text-xs text-gold">{no}</span>
              <h3 className="mt-3 font-serif text-lg text-night">{judul}</h3>
              <p className="mt-2 text-[13.5px] text-ink-soft">{isi}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
