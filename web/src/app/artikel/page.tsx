import Link from "next/link";
import { bacaPengaturan } from "@/lib/settings";
import { daftarArtikelTerbit } from "@/lib/artikel/data";
import { CtaKrem, Label, SitusShell, Wadah, urutan } from "../_situs/shell";
import { tautanWaSitus } from "../_situs/wa";
import { IkonPanah } from "../_situs/ikon";

export const metadata = {
  title: "Artikel",
  description: "Bacaan singkat berbasis bukti tentang kehamilan, bayi baru lahir, dan menyusui dari PADMA.",
};
// Artikel diterbitkan owner dari /admin/artikel; aksi simpan memanggil
// revalidatePath, revalidate ini hanya jaring pengaman untuk nomor WA.
export const revalidate = 300;

export default async function ArtikelPage() {
  const [pengaturan, artikel] = await Promise.all([bacaPengaturan(), daftarArtikelTerbit()]);
  const waHref = tautanWaSitus(pengaturan.nomorWaLink);
  return (
    <SitusShell aktif="artikel" pengaturan={pengaturan}>
      <section>
        <Wadah className="flex flex-col gap-4 pt-8 pb-10 lg:pt-12">
          <Label className="situs-muncul">Artikel PADMA</Label>
          <h1
            style={urutan(1)}
            className="situs-muncul max-w-[820px] font-garamond text-[40px] leading-[1.04] font-bold text-situs-judul sm:text-[52px] lg:text-[56px]"
          >
            Bacaan untuk Keluarga yang Lebih Siap
          </h1>
          <p style={urutan(2)} className="situs-muncul max-w-[640px] text-lg leading-normal text-situs-teks-soft">
            Edukasi umum berbasis bukti seputar kehamilan, bayi baru lahir, dan menyusui. Bukan pengganti saran
            dokter atau bidan yang merawat Anda.
          </p>
        </Wadah>
      </section>

      <section className="border-t border-situs-garis bg-situs-kartu">
        <Wadah className="py-12 md:py-14">
          {artikel.length === 0 ? (
            <p className="text-lg text-situs-teks-soft">Artikel pertama sedang disiapkan.</p>
          ) : (
            <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 xl:gap-6">
              {artikel.map((a) => (
                <li key={a.slug} className="flex">
                  <Link
                    href={`/artikel/${a.slug}`}
                    className="group flex flex-1 flex-col gap-3 rounded-[14px] border border-situs-garis bg-situs-krem p-6 transition-colors hover:border-situs-emas-pucat focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-situs-emas"
                  >
                    <span className="text-[13px] font-semibold tracking-[2px] text-situs-emas uppercase">
                      {a.kategori}
                    </span>
                    <h2 className="font-garamond text-[26px] leading-tight font-bold text-situs-judul">{a.judul}</h2>
                    <p className="line-clamp-3 text-[15px] leading-relaxed text-situs-teks-soft">{a.ringkasan}</p>
                    <span className="mt-auto flex items-center justify-between pt-2 text-sm">
                      <span className="text-situs-abu">± {a.menitBaca} menit baca</span>
                      <span className="inline-flex items-center gap-1.5 font-medium text-situs-emas group-hover:text-situs-emas-tua">
                        Baca
                        <IkonPanah className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Wadah>
      </section>

      <CtaKrem waHref={waHref} />
    </SitusShell>
  );
}
