import { notFound } from "next/navigation";
import { bacaProdukPerSlug } from "@/lib/produk/katalog";
import { labelMasaBerlaku } from "@/lib/produk/status";
import { urlSampulPublik } from "@/lib/produk/objek";
import { formatRupiah } from "@/lib/rupiah-publik";
import { midtransProduksi } from "@/lib/midtrans/konfig";
import { TombolAmbil } from "./tombol-ambil";
import { TombolBeli } from "./tombol-beli";
import { DaftarBab } from "./daftar-bab";
import { TautanKeranjang } from "../tautan-keranjang";

// Sama seperti etalase: katalog berubah lewat panel staf, jadi halaman satu
// produk tidak boleh dibekukan selamanya di waktu build.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const produk = await bacaProdukPerSlug(slug);
  return { title: produk ? produk.judul : "Produk tidak ditemukan" };
}

function HargaProduk({
  slug,
  productId,
  harga,
  hargaCoret,
  masaBerlakuBulan,
  produksi,
  clientKey,
}: {
  slug: string;
  productId: string;
  harga: number | null;
  hargaCoret: number | null;
  masaBerlakuBulan: number | null;
  produksi: boolean;
  clientKey: string;
}) {
  if (harga === null) {
    return <p className="mt-4 text-[15px] text-ink-soft">Harga segera diumumkan</p>;
  }
  if (harga === 0) {
    return (
      <div className="mt-4 flex flex-col items-start gap-3">
        <span className="rounded-full bg-leaf-soft px-3 py-1 text-[12px] font-bold uppercase tracking-wide text-leaf">
          Gratis
        </span>
        {masaBerlakuBulan !== null && (
          <span className="text-[13px] text-ink-soft">Akses {labelMasaBerlaku(masaBerlakuBulan).toLowerCase()}</span>
        )}
        {/* Pengunjung anon diarahkan ke /masuk oleh server action itu sendiri
            — lihat komentar `ambil.ts`. Klien yang SUDAH memiliki produknya
            melihat tombol "Buka" alih-alih "Ambil gratis"; halaman ini tetap
            dibaca anon dan di-cache, kepemilikannya ditanyakan dari peramban
            (lihat `punyaProdukDiPeramban`). */}
        <TombolAmbil slug={slug} productId={productId} />
      </div>
    );
  }
  return (
    <>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-bold text-night">{formatRupiah(harga)}</span>
        {masaBerlakuBulan !== null && (
          <span className="text-[14px] text-ink-soft">/ {labelMasaBerlaku(masaBerlakuBulan)}</span>
        )}
        {hargaCoret !== null && (
          <s className="text-[15px] text-ink-soft/70">{formatRupiah(hargaCoret)}</s>
        )}
      </div>
      {/* `TombolBeli` MENYERAP `TautanBuka` yang dulu berdiri di sini: yang
          sudah memiliki tetap melihat "Buka", yang punya pembayaran
          menggantung melihat "sedang diproses", dan sisanya melihat tombol
          beli. Satu komponen, karena ketiganya menjawab satu pertanyaan. */}
      <TombolBeli
        slug={slug}
        productId={productId}
        produksi={produksi}
        clientKey={clientKey}
      />
    </>
  );
}

export default async function ProdukDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const produk = await bacaProdukPerSlug(slug);
  if (!produk) notFound();
  const sampulUrl = urlSampulPublik(produk.sampulObjek);

  return (
    <main className="bg-paper">
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <aside className="overflow-hidden rounded-2xl border border-black/10 bg-white lg:sticky lg:top-6">
          {sampulUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- sampul datang dari bucket publik, bukan aset build.
            <img src={sampulUrl} alt="" className="aspect-[4/3] w-full object-cover" />
          )}
          <div className="p-5">
            <div className="flex justify-end">
              <TautanKeranjang />
            </div>
            <h1 className="text-[22px] font-bold leading-snug text-ink">{produk.judul}</h1>

            {/* Keduanya dibaca DI SERVER. `MIDTRANS_PRODUKSI` sengaja tanpa prefiks
                NEXT_PUBLIC_, jadi peramban tidak bisa membacanya sendiri — dan
                komponen klien yang mencoba akan selalu mendapat sandbox, senyap.
                Karena halaman ini `revalidate = 300`, keduanya juga harus sudah
                terpasang saat build/revalidasi, bukan hanya saat request. */}
            <HargaProduk
              slug={produk.slug}
              productId={produk.id}
              harga={produk.harga}
              hargaCoret={produk.hargaCoret}
              masaBerlakuBulan={produk.masaBerlakuBulan}
              produksi={midtransProduksi()}
              clientKey={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? ""}
            />
            {produk.jenisMateri.length > 0 && (
              <p className="mt-4 border-t border-black/10 pt-3 text-[13px] text-ink-soft">
                {produk.jenisMateri.length} Materi
              </p>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          {produk.deskripsi !== "" && (
            <div className="rounded-2xl border border-black/10 bg-white p-6">
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">{produk.deskripsi}</p>
            </div>
          )}
          <DaftarBab slug={produk.slug} productId={produk.id} bab={produk.bab} />
          <p className="mt-6 rounded-xl border border-black/10 bg-white p-4 text-[13px] text-ink-soft">
            Produk digital dikirim seketika sesudah pembayaran dan <b>tidak dapat
            dikembalikan</b>. Pastikan Anda sudah membaca keterangan di atas sebelum
            membeli.
          </p>
        </div>
      </section>
    </main>
  );
}
