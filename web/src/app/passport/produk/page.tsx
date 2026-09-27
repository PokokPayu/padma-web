import Link from "next/link";
import { produkSaya } from "@/lib/passport/produk-saya";
import { ambilKlien } from "@/lib/passport/data";
import { periksaPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";
import { LABEL_JENIS } from "@/lib/produk/status";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pembelian Saya" };

// Tidak ada `requireRole` di sini — layout.tsx sudah menjaga `/passport/**`
// dengan `requireRole(["klien"])` (satu-satunya sumber matriks peran yang
// diuji `tests/access-matrix-layouts.test.ts`); pola yang sama dipakai
// SELURUH halaman passport lain (mis. `passport/materi/page.tsx`).
export default async function HalamanProdukSaya() {
  const klien = await ambilKlien();
  if (!klien) return null; // layout sudah menangani; ini penjaga tipe

  // LAPIS 1b (spec "Rekonsiliasi"). Urutannya MENGIKAT: pemeriksaan lebih dulu,
  // baru pembacaan. Dibalik, akses yang baru saja terbit dalam permintaan yang
  // sama tidak ikut terbaca — dan yang dilihat pembeli adalah halaman kosong
  // tepat sesudah pembayarannya berhasil, yaitu kebohongan yang paling mahal.
  //
  // Halaman ini memang sudah dynamic (ada sesi, `ambilKlien()` membaca cookie),
  // jadi tidak ada ongkos cache yang hilang — berbeda dengan `/produk/[slug]`
  // yang karena itu dipicu dari peramban.
  await periksaPesananMenggantung();

  const produk = await produkSaya(klien.id);

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">
        Pembelian Saya{" "}
        <span className="font-sans text-xs font-semibold text-ink-soft">
          produk digital yang Anda miliki
        </span>
      </h1>

      {produk.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/10 bg-paper p-4 text-[13px] text-ink-soft">
          Belum ada produk digital yang Anda ambil. Jelajahi{" "}
          <Link href="/produk" className="font-semibold text-leaf underline">
            etalase produk
          </Link>{" "}
          untuk mulai.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {produk.map((p) => (
            <Link
              key={p.id}
              href={`/passport/produk/${p.slug}`}
              data-produk-id={p.id}
              className="flex items-start gap-3.5 rounded-xl border border-black/10 bg-[#FFFEFA] p-4 transition hover:-translate-y-0.5 hover:border-gold"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-leaf-soft text-[17px] text-leaf">
                {p.jenis === "pdf" ? "📖" : "▶"}
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] leading-tight">{p.judul}</b>
                <span className="text-[11.5px] text-ink-soft">
                  {LABEL_JENIS[p.jenis]}
                  {p.bolehUnduh ? " · Bisa diunduh" : ""}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
