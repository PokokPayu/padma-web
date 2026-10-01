import Link from "next/link";
import { notFound } from "next/navigation";
import { bacaPengaturan } from "@/lib/settings";
import { artikelTerbit, daftarArtikelTerbit } from "@/lib/artikel/data";
import { CtaKrem, Label, SitusShell, Wadah } from "../../_situs/shell";
import { tautanWaSitus } from "../../_situs/wa";
import { ArtikelIsi } from "../../_situs/artikel-isi";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const a = await artikelTerbit(slug);
  if (!a) return { title: "Artikel" };
  return { title: a.judul, description: a.isi.ringkasan };
}

export default async function ArtikelDetailPage({ params }: Props) {
  const { slug } = await params;
  const [pengaturan, artikel, semua] = await Promise.all([
    bacaPengaturan(),
    artikelTerbit(slug),
    daftarArtikelTerbit(),
  ]);
  if (!artikel) notFound();
  const waHref = tautanWaSitus(pengaturan.nomorWaLink);
  const lainnya = semua.filter((a) => a.slug !== artikel.slug).slice(0, 3);

  return (
    <SitusShell aktif="artikel" pengaturan={pengaturan}>
      <article>
        <Wadah className="pt-8 pb-14 lg:pt-12">
          <div className="mx-auto flex max-w-[720px] flex-col">
            <Link href="/artikel" className="-my-2 self-start py-2 text-sm font-medium text-situs-emas hover:text-situs-emas-tua">
              ← Semua artikel
            </Link>
            <Label className="mt-6">{artikel.kategori}</Label>
            <h1 className="mt-3 font-garamond text-[36px] leading-[1.08] font-bold text-situs-judul sm:text-[44px] lg:text-[50px]">
              {artikel.judul}
            </h1>
            <p className="mt-4 text-sm text-situs-abu">± {artikel.isi.menitBaca} menit baca</p>
            <div className="mt-8">
              <ArtikelIsi isi={artikel.isi} />
            </div>
            <p className="mt-10 rounded-xl border border-situs-garis bg-situs-kartu px-5 py-4 text-sm leading-relaxed text-situs-teks-soft">
              Artikel ini adalah edukasi umum, bukan pengganti penilaian dokter atau bidan yang merawat Anda.
            </p>
          </div>
        </Wadah>
      </article>

      {lainnya.length > 0 && (
        <section className="border-t border-situs-garis bg-situs-kartu">
          <Wadah className="flex flex-col gap-6 py-12">
            <h2 className="font-garamond text-[30px] leading-tight font-semibold text-situs-judul md:text-4xl">
              Artikel Lainnya
            </h2>
            <ul className="grid gap-4 md:grid-cols-3">
              {lainnya.map((a) => (
                <li key={a.slug} className="flex">
                  <Link
                    href={`/artikel/${a.slug}`}
                    className="flex flex-1 flex-col gap-2 rounded-[14px] border border-situs-garis bg-situs-krem p-5 transition-colors hover:border-situs-emas-pucat"
                  >
                    <span className="text-xs font-semibold tracking-[2px] text-situs-emas uppercase">{a.kategori}</span>
                    <span className="font-garamond text-[22px] leading-tight font-bold text-situs-judul">{a.judul}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Wadah>
        </section>
      )}

      <CtaKrem waHref={waHref} />
    </SitusShell>
  );
}
