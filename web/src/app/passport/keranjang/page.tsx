import { ambilKlien } from "@/lib/passport/data";
import { periksaPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";
import { bacaKeranjang, pesananTerbukaSaya } from "@/lib/keranjang/baca";
import { midtransProduksi } from "@/lib/midtrans/konfig";
import { IsiKeranjang } from "./isi-keranjang";

export const metadata = { title: "Keranjang" };

export default async function HalamanKeranjang() {
  const klien = await ambilKlien();
  if (!klien) return null; // layout sudah menangani; ini penjaga tipe

  // Lapis 1b, sama persis dengan /passport/produk: halaman ini dynamic, jadi
  // pemeriksaannya hidup di server, bukan dipicu dari peramban.
  await periksaPesananMenggantung();

  const [item, terbuka] = await Promise.all([bacaKeranjang(), pesananTerbukaSaya(klien.id)]);

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">Keranjang</h1>
      <IsiKeranjang
        item={item}
        terbuka={terbuka}
        produksi={midtransProduksi()}
        clientKey={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? ""}
      />
    </section>
  );
}
