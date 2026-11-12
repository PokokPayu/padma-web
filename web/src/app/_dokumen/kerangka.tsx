import type { ReactNode } from "react";
import { formatTanggalID } from "@/lib/passport/waktu";
import { VERSI_DOKUMEN } from "@/lib/persetujuan/versi";
import { Label, Wadah } from "../_situs/shell";
import type { DaftarBagian } from "./bagian";

/**
 * Kerangka dua dokumen hukum. Lebar teks 720px dan ukuran huruf mengikuti
 * halaman artikel (`src/app/artikel/[slug]/page.tsx`) — prosa panjang yang
 * sama-sama dibaca dari atas ke bawah.
 */
export function KerangkaDokumen({
  judul,
  pengantar,
  bagian,
  children,
}: {
  judul: string;
  pengantar: string;
  bagian: DaftarBagian;
  children: ReactNode;
}) {
  return (
    <Wadah className="pt-8 pb-16 lg:pt-12">
      <article className="mx-auto flex max-w-[720px] flex-col">
        <Label>Dokumen PADMA</Label>
        <h1 className="mt-3 font-garamond text-[36px] leading-[1.08] font-bold text-situs-judul sm:text-[44px] lg:text-[50px]">
          {judul}
        </h1>
        <p className="mt-4 text-sm text-situs-abu">Berlaku sejak {formatTanggalID(VERSI_DOKUMEN)}</p>
        <p className="mt-6 text-[17px] leading-[1.75] text-situs-teks md:text-lg">{pengantar}</p>
        <nav aria-label="Daftar isi" className="mt-8 rounded-xl border border-situs-garis bg-situs-kartu px-5 py-4">
          <p className="text-sm font-semibold text-situs-judul">Daftar isi</p>
          <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[15px] marker:text-situs-abu">
            {bagian.map((b) => (
              <li key={b.id}>
                <a href={`#${b.id}`} className="text-situs-emas hover:text-situs-emas-tua hover:underline">
                  {b.judul}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex flex-col">{children}</div>
      </article>
    </Wadah>
  );
}

/** Satu bagian bernomor. Nomor dan judul diturunkan dari daftar — tidak diketik ulang. */
export function Bagian<D extends DaftarBagian>({
  daftar,
  id,
  children,
}: {
  daftar: D;
  id: D[number]["id"];
  children: ReactNode;
}) {
  const nomor = daftar.findIndex((b) => b.id === id) + 1;
  const judul = daftar[nomor - 1]?.judul ?? id;
  return (
    <section
      id={id}
      aria-labelledby={`judul-${id}`}
      className="mt-10 scroll-mt-28 border-t border-situs-garis pt-8"
    >
      <h2
        id={`judul-${id}`}
        className="font-garamond text-[28px] leading-tight font-bold text-situs-judul md:text-[32px]"
      >
        {nomor}. {judul}
      </h2>
      <div className="mt-4 flex flex-col gap-4 text-[17px] leading-[1.75] text-situs-teks md:text-lg">
        {children}
      </div>
    </section>
  );
}

export function Butir({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-situs-emas">{children}</ul>;
}

export function TautanWa({ href, tampilan }: { href: string; tampilan: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-situs-emas underline underline-offset-2 hover:text-situs-emas-tua"
    >
      {tampilan}
    </a>
  );
}
