import type { FaseKatalog } from "@/lib/katalog";
import { formatRupiah } from "@/lib/rupiah-publik";

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
// `@/lib/rupiah-publik` — modul NETRAL yang tidak hidup di bawah `lib/owner/`
// dan karena itu tidak melanggar batas yang digambar berkas itu, sekaligus
// tidak lagi menumbuhkan salinan `formatRupiah` sendiri tanpa penjagaan
// `Number.isFinite` yang justru menjadi alasan formatter owner ditulis.

// Lebar kolom mengikuti JUMLAH fase yang benar-benar tampil. Kelasnya ditulis
// utuh satu per satu, bukan dirakit (`lg:grid-cols-${n}`): pemindai Tailwind
// membaca berkas sumber sebagai teks, jadi kelas yang hanya lahir saat runtime
// tidak pernah ikut ter-generate dan kolomnya diam-diam kembali ke satu.
const KOLOM_LG: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

export function LiniLayanan({ katalog }: { katalog: FaseKatalog[] }) {
  // Fase tanpa satu pun layanan TIDAK dirender. Kartu kosong membuat lini yang
  // katalognya belum diisi terlihat seperti lini yang tidak punya apa-apa —
  // dan itu pesan yang salah kepada pengunjung. Penyaringan hidup di sini,
  // bukan di `bacaKatalog`: panel admin tetap harus melihat kelima fase untuk
  // bisa mengisinya, jadi ini keputusan TAMPILAN, bukan data.
  const tampil = katalog.filter((f) => f.layanan.length > 0);
  if (tampil.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-11 max-w-[640px]">
        <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
          <span className="inline-block h-px w-6 bg-gold" />
          Lini Layanan
        </p>
        {/* Judul sengaja tidak lagi menyebut jumlah fase. "Lima fase" menjadi
            dusta kecil begitu ada lini yang katalognya belum terisi, dan
            jumlah yang ikut berubah-ubah akan mengecilkan model lima fase
            PADMA menjadi sekadar hitungan stok hari ini. */}
        <h2 className="font-serif text-3xl text-night sm:text-4xl">
          Setiap fase, satu perjalanan.
        </h2>
        <p className="mt-2 text-ink-soft">
          Setiap lini dinamai dari bahasa Sanskerta — karena setiap fase adalah
          babak yang bermakna.
        </p>
      </div>

      <div
        className={`grid grid-cols-1 gap-3.5 sm:grid-cols-2 ${
          KOLOM_LG[Math.min(tampil.length, 5)]
        }`}
      >
        {tampil.map((f) => (
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
                  {/* Badge menempel pada LAYANAN, bukan pada tiap baris
                      harga. Dengan katalog sungguhan, versi lama menaburkan 30
                      badge identik di satu layar dan menenggelamkan justru
                      angka yang seharusnya dibaca. Satu layanan = satu
                      penanda promo. */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <p className="text-[11.5px] font-semibold text-[#4E6154]">{layanan.nama}</p>
                    {layanan.varian.some((v) => v.hargaCoret !== null) && (
                      <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold">
                        Soft Launch
                      </span>
                    )}
                  </div>
                  {layanan.varian.length > 0 && (
                    <ul className="mt-1.5 space-y-1.5">
                      {layanan.varian.map((v, i) => (
                        <li key={i} className="text-[10.5px] text-ink-soft">
                          {/* Label di barisnya sendiri, harga di bawahnya.
                              Versi lama menaruh keduanya dalam satu baris
                              yang membungkus SENDIRI ketika kartunya sempit —
                              hasilnya tata letak yang berubah-ubah menurut
                              lebar layar. Dua baris tetap, bukan satu baris
                              yang kebetulan patah. */}
                          {v.label !== "" && <p>{v.label}</p>}
                          <p className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="font-bold text-night">
                              {formatRupiah(v.hargaKlien)}
                            </span>
                            {v.hargaCoret !== null && (
                              <s className="text-ink-soft/70">{formatRupiah(v.hargaCoret)}</s>
                            )}
                          </p>
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
