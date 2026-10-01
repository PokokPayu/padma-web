import { bacaPengaturan } from "@/lib/settings";
import { daftarTestimoniTerbit } from "@/lib/testimoni/data";
import { CtaHijau, Label, SitusShell, Wadah, urutan } from "../_situs/shell";
import { tautanWaSitus } from "../_situs/wa";

export const metadata = {
  title: "Testimoni",
  description: "Cerita keluarga yang belajar bersama PADMA.",
};
export const revalidate = 300;

// README handoff: testimoni hanya tayang dengan izin asli dari keluarga.
// Penjaganya di basis data — baris tidak bisa berstatus terbit tanpa
// `izin_dikonfirmasi` — jadi halaman ini cukup menampilkan yang terbit.
export default async function TestimoniPage() {
  const [pengaturan, testimoni] = await Promise.all([bacaPengaturan(), daftarTestimoniTerbit()]);
  const waHref = tautanWaSitus(pengaturan.nomorWaLink);
  return (
    <SitusShell aktif="testimoni" pengaturan={pengaturan}>
      <section>
        <Wadah className="flex flex-col gap-4 pt-8 pb-10 lg:pt-12">
          <Label className="situs-muncul">Testimoni</Label>
          <h1
            style={urutan(1)}
            className="situs-muncul max-w-[820px] font-garamond text-[40px] leading-[1.04] font-bold text-situs-judul sm:text-[52px] lg:text-[56px]"
          >
            Cerita Keluarga PADMA
          </h1>
          <p style={urutan(2)} className="situs-muncul max-w-[640px] text-lg leading-normal text-situs-teks-soft">
            Pengalaman keluarga yang belajar bersama PADMA, dibagikan dengan izin mereka.
          </p>
        </Wadah>
      </section>

      <section className="border-t border-situs-garis bg-situs-kartu">
        <Wadah className="py-12 md:py-14">
          {testimoni.length === 0 ? (
            <p className="text-lg text-situs-teks-soft">Cerita keluarga PADMA segera hadir di sini.</p>
          ) : (
            <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {testimoni.map((t) => (
                <li key={t.id} className="flex flex-col overflow-hidden rounded-[14px] border border-situs-garis bg-situs-krem">
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    src={t.videoSrc}
                    aria-label={`Video testimoni ${t.nama}`}
                    className="aspect-[9/16] max-h-[560px] w-full bg-situs-hutan-gelap object-contain"
                  />
                  <div className="flex flex-col gap-2 p-5">
                    {t.kutipan && (
                      <p className="font-garamond text-[22px] leading-snug text-situs-judul">“{t.kutipan}”</p>
                    )}
                    <p className="text-[15px] font-semibold text-situs-judul">{t.nama}</p>
                    {t.keterangan && <p className="text-sm text-situs-teks-soft">{t.keterangan}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Wadah>
      </section>

      <CtaHijau judul="Ilmu Nyata, Keluarga Berdaya." waHref={waHref} />
    </SitusShell>
  );
}
