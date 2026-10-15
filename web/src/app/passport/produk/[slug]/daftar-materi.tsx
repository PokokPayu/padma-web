import Link from "next/link";
import type { BabPublik } from "@/lib/produk/katalog";
import { LABEL_JENIS_MATERI } from "@/lib/produk/status";

/**
 * Daftar bab/materi di sisi pembeli. `bolehSemua` = pemilik aktif; selain
 * itu hanya materi pratinjau yang bertaut. Tautan hanyalah kemudahan — yang
 * menolak adalah RLS di penampil dan rute isi.
 */
export function DaftarMateri({
  slug,
  bab,
  bolehSemua,
  aktifId,
}: {
  slug: string;
  bab: BabPublik[];
  bolehSemua: boolean;
  aktifId?: string;
}) {
  return (
    <nav aria-label="Daftar materi" className="grid gap-3">
      {bab.map((b) => (
        <section key={b.id} className="rounded-2xl border border-black/10 bg-white p-3">
          <h2 className="px-2 pb-2 text-[13.5px] font-bold text-night">
            {b.judul} <span className="font-normal text-ink-soft">· {b.materi.length} Materi</span>
          </h2>
          <ul className="grid gap-1">
            {b.materi.map((m) => {
              const buka = bolehSemua || m.pratinjau;
              const isi = (
                <>
                  <span className="w-5 flex-none text-center">{buka ? (m.jenis === "pdf" ? "📖" : "▶") : "🔒"}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{m.judul}</span>
                    <span className="text-[11.5px] text-ink-soft">
                      {LABEL_JENIS_MATERI[m.jenis]}{m.pratinjau && !bolehSemua ? " · Pratinjau" : ""}
                    </span>
                  </span>
                </>
              );
              const kelas = `flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                m.id === aktifId ? "bg-gold/15" : ""
              }`;
              return (
                <li key={m.id}>
                  {buka ? (
                    <Link href={`/passport/produk/${slug}/${m.id}`} className={`${kelas} hover:bg-paper`}
                      aria-current={m.id === aktifId ? "page" : undefined}>
                      {isi}
                    </Link>
                  ) : (
                    <span className={`${kelas} text-ink-soft/70`}>{isi}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
