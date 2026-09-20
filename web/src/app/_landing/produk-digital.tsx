import Link from "next/link";
import type { ProdukPublik } from "@/lib/produk/katalog";
import { KartuProduk } from "@/app/produk/kartu-produk";

// SINKRON — tanpa `async`, tanpa satu pun pengambilan data. Halaman
// (`src/app/page.tsx`) yang membaca katalog produk dari DB, sama seperti
// `LiniLayanan` menerima `katalog` lewat prop alih-alih memanggil
// `bacaKatalog` sendiri. `renderToStaticMarkup` — dipakai seluruh suite ini
// untuk merender halaman — tidak bisa merender komponen server `async` di
// dalam pohon halaman.
//
// Tiga cabang harga (null / 0 / >0) TIDAK ditulis ulang di sini. `KartuProduk`
// (Task 8) sudah memilikinya, dan mengimpornya ulang berarti satu-satunya
// sumber cabang itu tetap satu — bila dua salinan pernah ada, keduanya bisa
// diam-diam berbeda.
export function ProdukDigital({ produk }: { produk: ProdukPublik[] }) {
  // Seksi kosong TIDAK dirender sama sekali. Kartu kosong (atau seksi
  // dengan judul tapi tanpa isi) membuat PADMA terlihat seperti toko yang
  // sudah tutup — pesan yang salah kepada pengunjung, persis alasan
  // `LiniLayanan` menyaring fase tanpa layanan.
  if (produk.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-11 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[640px]">
          <p className="mb-3 flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.24em] text-gold">
            <span className="inline-block h-px w-6 bg-gold" />
            Produk Digital
          </p>
          <h2 className="font-serif text-3xl text-night sm:text-4xl">
            Panduan dan rekaman untuk dipelajari sendiri.
          </h2>
          <p className="mt-2 text-ink-soft">
            Video dan panduan tertulis dari tim PADMA, bisa ditonton atau
            dibaca kapan saja.
          </p>
        </div>
        <Link
          href="/produk"
          className="text-[13px] font-bold text-gold underline underline-offset-4"
        >
          Lihat semua produk
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {produk.map((p) => (
          <KartuProduk key={p.id} produk={p} />
        ))}
      </div>
    </section>
  );
}
