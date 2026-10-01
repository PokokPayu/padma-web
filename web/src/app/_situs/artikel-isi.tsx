import { Fragment } from "react";
import type { Blok, Inline, IsiArtikel } from "@/lib/artikel/urai";

// Badan artikel: dipakai halaman /artikel/[slug] dan pratinjau di
// /admin/artikel, supaya yang dilihat penulis sama dengan yang tayang.
// Tanpa hook — aman dirender di server maupun di komponen klien.

function Baris({ isi }: { isi: Inline[] }) {
  return (
    <>
      {isi.map((i, n) => {
        switch (i.jenis) {
          case "teks":
            return <Fragment key={n}>{i.isi}</Fragment>;
          case "tebal":
            return (
              <strong key={n} className="font-semibold text-situs-judul">
                {i.isi}
              </strong>
            );
          case "miring":
            return <em key={n}>{i.isi}</em>;
          case "tautan":
            return (
              <a
                key={n}
                href={i.href}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-situs-emas underline underline-offset-2 hover:text-situs-emas-tua"
              >
                {i.href}
              </a>
            );
          case "rujukan":
            return (
              <sup key={n} className="ml-0.5 text-[0.7em]">
                [
                {i.nomor.map((r, k) => (
                  <Fragment key={r}>
                    {k > 0 && ","}
                    <a
                      href={`#referensi-${r}`}
                      aria-label={`Referensi ${r}`}
                      className="text-situs-emas hover:text-situs-emas-tua hover:underline"
                    >
                      {r}
                    </a>
                  </Fragment>
                ))}
                ]
              </sup>
            );
        }
      })}
    </>
  );
}

function BlokArtikel({ blok }: { blok: Blok }) {
  switch (blok.jenis) {
    case "h2":
      return (
        <h2 className="mt-6 font-garamond text-[28px] leading-tight font-bold text-situs-judul md:text-[32px]">
          <Baris isi={blok.isi} />
        </h2>
      );
    case "h3":
      return (
        <h3 className="mt-3 font-garamond text-2xl leading-tight font-bold text-situs-judul">
          <Baris isi={blok.isi} />
        </h3>
      );
    case "paragraf":
      return (
        <p>
          <Baris isi={blok.isi} />
        </p>
      );
    case "daftar": {
      const Tag = blok.berurut ? "ol" : "ul";
      return (
        <Tag className={`flex flex-col gap-2 pl-6 ${blok.berurut ? "list-decimal" : "list-disc"} marker:text-situs-emas`}>
          {blok.butir.map((b, n) => (
            <li key={n} className="pl-1">
              <Baris isi={b} />
            </li>
          ))}
        </Tag>
      );
    }
  }
}

export function ArtikelIsi({ isi }: { isi: IsiArtikel }) {
  return (
    <>
      <div className="flex flex-col gap-5 text-[17px] leading-[1.75] text-situs-teks md:text-lg">
        {isi.blok.map((b, n) => (
          <BlokArtikel key={n} blok={b} />
        ))}
      </div>
      {isi.referensi.length > 0 && (
        <section aria-labelledby="judul-referensi" className="mt-12 border-t border-situs-garis pt-6">
          <h2 id="judul-referensi" className="font-garamond text-2xl font-bold text-situs-judul">
            Referensi
          </h2>
          <ol className="mt-4 flex list-decimal flex-col gap-3 pl-6 text-sm leading-relaxed text-situs-teks-soft marker:text-situs-abu">
            {isi.referensi.map((r, n) => (
              <li key={n} id={`referensi-${n + 1}`} className="scroll-mt-28 pl-1">
                <Baris isi={r} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
