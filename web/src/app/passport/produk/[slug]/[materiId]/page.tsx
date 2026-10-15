import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilKlien } from "@/lib/passport/data";
import { bacaIsiProduk } from "@/lib/passport/isi-produk";
import { LABEL_JENIS_MATERI } from "@/lib/produk/status";
import { ReaderPdf } from "../reader-pdf";
import { PemutarVideo } from "../pemutar-video";
import { DaftarMateri } from "../daftar-materi";

export const metadata = { title: "Materi" };

type BarisMateri = {
  id: string;
  judul: string;
  keterangan: string;
  jenis: "video" | "pdf";
  boleh_unduh: boolean;
};

export default async function PenampilMateri({
  params,
}: {
  params: Promise<{ slug: string; materiId: string }>;
}) {
  const { slug, materiId } = await params;
  const klien = await ambilKlien();
  if (!klien) notFound();

  const supabase = await createServerSupabase();
  const { data: produk } = await supabase
    .from("digital_products").select("id, judul").eq("slug", slug)
    .maybeSingle<{ id: string; judul: string }>();
  if (!produk) notFound();

  // UUID tak sah membuat PostgREST melempar 22P02; `data` null → 404.
  const { data: materi } = await supabase
    .from("digital_product_materials")
    .select("id, judul, keterangan, jenis, boleh_unduh")
    .eq("id", materiId)
    .eq("product_id", produk.id)
    .maybeSingle<BarisMateri>();
  if (!materi) notFound();

  // Baris isi terbaca HANYA bila `boleh_buka_materi` mengizinkan (pemilik
  // aktif, atau materi pratinjau produk tayang). Tidak terbaca = 404 —
  // pola yang sama dengan gerbang isi; tidak membocorkan "ada tapi terkunci".
  const [{ data: berkas }, { data: halaman }, { data: punya }, bab] = await Promise.all([
    supabase.from("digital_product_files").select("material_id").eq("material_id", materi.id).maybeSingle(),
    supabase.from("digital_product_pages").select("halaman").eq("material_id", materi.id).order("halaman"),
    supabase.rpc("punya_produk", { p_product_id: produk.id }),
    bacaIsiProduk(produk.id),
  ]);
  const terbuka = materi.jenis === "video" ? berkas !== null : (halaman ?? []).length > 0;
  if (!terbuka) notFound();

  const pemilik = punya === true;
  // Untuk PDF, baris berkas hanya ada bila `boleh_unduh` menyala saat unggah, padahal
  // bendera itu bisa dinyalakan belakangan; tombol berdasarkan bendera saja berujung 404.
  const bolehUnduh = pemilik && materi.boleh_unduh && berkas !== null;

  return (
    <>
      <Link
        href={`/passport/produk/${slug}`}
        className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
      >
        ← {produk.judul}
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0">
          <h1 className="font-serif text-xl text-night">{materi.judul}</h1>
          <p className="mb-3 text-xs text-ink-soft">
            {LABEL_JENIS_MATERI[materi.jenis]}{!pemilik && " · Pratinjau"}
          </p>
          {materi.keterangan && (
            <p className="mb-4 whitespace-pre-line text-[13.5px] text-[#3C4C42]">{materi.keterangan}</p>
          )}

          {materi.jenis === "video" ? (
            <section className="relative select-none overflow-hidden rounded-2xl border border-black/10 bg-white p-4">
              <PemutarVideo materiId={materi.id} />
            </section>
          ) : (
            <ReaderPdf materiId={materi.id} halaman={(halaman ?? []).map((h) => h.halaman)} />
          )}

          {bolehUnduh && (
            <a
              href={`/api/produk/materi/${materi.id}/unduh`}
              className="mt-4 inline-block rounded-lg bg-night px-5 py-3 text-[13.5px] font-bold text-gold-pale"
            >
              Unduh berkas asli
            </a>
          )}

          <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
            <span className="text-gold">🔒</span>
            {materi.jenis === "pdf" ? "Setiap halaman ditandai identitas Anda." : "Video ini ditonton langsung di dalam aplikasi."}
          </p>
        </div>

        <DaftarMateri slug={slug} bab={bab} bolehSemua={pemilik} aktifId={materi.id} />
      </div>
    </>
  );
}
