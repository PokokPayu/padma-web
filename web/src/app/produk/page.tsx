import { bacaProdukPublik } from "@/lib/produk/katalog";
import { KartuProduk } from "./kartu-produk";

// Katalog produk datang dari DB dan diubah staf lewat panel, jadi halaman ini
// tidak boleh dibekukan selamanya di waktu build — alasan yang sama persis
// dengan landing (`src/app/page.tsx`).
export const revalidate = 300;

export const metadata = { title: "Produk Digital" };

export default async function ProdukPage() {
  const produk = await bacaProdukPublik();

  return (
    <main className="bg-paper">
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h1 className="text-[28px] font-bold text-ink">Produk Digital</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
          Panduan video dan e-book PADMA yang bisa dimiliki kapan saja — tanpa
          jadwal, tanpa kunjungan.
        </p>

        {produk.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-black/10 bg-white p-8 text-center text-[15px] text-ink-soft">
            Belum ada produk yang ditayangkan.
          </p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {produk.map((p) => <KartuProduk key={p.id} produk={p} />)}
          </div>
        )}
      </section>
    </main>
  );
}
