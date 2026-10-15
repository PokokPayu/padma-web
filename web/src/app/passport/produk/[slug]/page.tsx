import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilKlien } from "@/lib/passport/data";
import { bacaIsiProduk } from "@/lib/passport/isi-produk";
import { DaftarMateri } from "./daftar-materi";

export const metadata = { title: "Produk" };

export default async function DaftarIsiProduk({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const supabase = await createServerSupabase();
  const { data: produk } = await supabase
    .from("digital_products")
    .select("id, judul, deskripsi, aktif")
    .eq("slug", slug)
    .maybeSingle<{ id: string; judul: string; deskripsi: string; aktif: boolean }>();
  if (!produk) notFound();

  const [bab, { data: punya }] = await Promise.all([
    bacaIsiProduk(produk.id),
    supabase.rpc("punya_produk", { p_product_id: produk.id }),
  ]);
  const pemilik = punya === true;

  return (
    <>
      <Link
        href="/passport/produk"
        className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
      >
        ← Kembali ke Pembelian Saya
      </Link>

      <div className="mb-4 rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7 text-[#EFE6CE]">
        <h1 className="font-serif text-xl text-[#F5EEDC]">{produk.judul}</h1>
      </div>

      {produk.deskripsi && (
        <div className="mb-4 whitespace-pre-line rounded-2xl border border-black/10 bg-white p-6 text-[13.5px] text-[#3C4C42]">
          {produk.deskripsi}
        </div>
      )}

      {!pemilik && (
        <p className="mb-4 rounded-xl border border-clay/30 bg-clay/5 p-4 text-[13px] text-ink">
          Akses Anda ke produk ini tidak aktif — belum dibeli, atau masa berlakunya sudah habis.{" "}
          {/* `/produk/<slug>` hanya ada untuk produk yang masih dijual. */}
          {produk.aktif ? (
            <Link href={`/produk/${slug}`} className="font-bold text-leaf underline">Lihat halaman produk</Link>
          ) : (
            <span className="font-semibold">Produk ini sudah tidak dijual lagi.</span>
          )}
        </p>
      )}

      <DaftarMateri slug={slug} bab={bab} bolehSemua={pemilik} aktif={produk.aktif} />
    </>
  );
}
