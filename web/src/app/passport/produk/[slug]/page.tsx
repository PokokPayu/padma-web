import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilKlien } from "@/lib/passport/data";
import { LABEL_JENIS } from "@/lib/produk/status";
import { ReaderPdf } from "./reader-pdf";
import { PemutarVideo } from "./pemutar-video";

// Judul mengandalkan template `%s · PADMA` di root layout — pola yang sama
// dipakai `passport/materi/[id]/page.tsx`.
export const metadata = { title: "Produk" };

type BarisProduk = {
  id: string;
  judul: string;
  deskripsi: string;
  jenis: "video" | "pdf";
  boleh_unduh: boolean;
};

/**
 * Reader produk digital — pasangan `passport/materi/[id]/page.tsx` untuk
 * produk yang DIBELI, bukan materi yang di-assign.
 *
 * Hak dibaca lewat SESI PENGGUNA di setiap query di bawah: policy "berkas
 * produk: pemilik baca" / "halaman produk: pemilik baca" (Task 3, RPC
 * `punya_produk`) yang menjawab, bukan `if` di komponen ini. Nol baris pada
 * query isi berarti dua kemungkinan yang tidak dibedakan di layar — "tidak
 * dimiliki" atau "dimiliki tapi isinya belum diunggah admin" — sebab
 * membedakannya lewat query terpisah membocorkan `boleh_unduh`/isi produk
 * yang belum tayang.
 *
 * Tombol Unduh hanya dirender bila `boleh_unduh` menyala, dan ketiadaannya
 * DI SINI bukan pagarnya — pagarnya ada di `/api/produk/[id]/unduh` sendiri
 * (langkah 2 urutannya), yang menolak apa pun juga bila `boleh_unduh` mati.
 */
export default async function ReaderProduk({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params; // Next 16: `params` adalah Promise
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const supabase = await createServerSupabase();

  // Metadata produk: policy "produk: baca publik yang aktif" mengizinkan
  // siapa pun login membacanya — ini bukan gerbang isi, hanya judul/jenis.
  const { data: produk } = await supabase
    .from("digital_products")
    .select("id, judul, deskripsi, jenis, boleh_unduh")
    .eq("slug", slug)
    .maybeSingle<BarisProduk>();
  if (!produk) notFound();

  const kembali = (
    <Link
      href="/passport/produk"
      className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
    >
      ← Kembali ke Pembelian Saya
    </Link>
  );

  const header = (
    <div className="mb-4 flex items-center gap-4 rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7 text-[#EFE6CE]">
      <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-gold/15 text-2xl text-gold-bright">
        {produk.jenis === "pdf" ? "📖" : "▶"}
      </span>
      <span>
        <h1 className="font-serif text-xl text-[#F5EEDC]">{produk.judul}</h1>
        <span className="text-xs text-[#A9BBAA]">
          {LABEL_JENIS[produk.jenis]} · {produk.jenis === "pdf" ? "baca di aplikasi" : "tonton di aplikasi"}
        </span>
      </span>
    </div>
  );

  const deskripsi = produk.deskripsi && (
    <div className="mb-4 rounded-2xl border border-black/10 bg-white p-6 text-[13.5px] text-[#3C4C42]">
      {produk.deskripsi}
    </div>
  );

  // Baris berkas utuh: isi video, DAN sumber satu-satunya unduhan untuk kedua
  // jenis. Dibaca lewat sesi pengguna — policy "berkas produk: pemilik baca"
  // yang menjawab, jadi nol baris berarti "tidak dimiliki ATAU belum ada".
  const { data: berkas } = await supabase
    .from("digital_product_files")
    .select("product_id")
    .eq("product_id", produk.id)
    .maybeSingle();

  // Tombol dirender atas KEBERADAAN BERKASNYA, bukan atas `boleh_unduh`
  // sendirian. Untuk produk PDF, baris `digital_product_files` hanya lahir
  // bila `boleh_unduh` sudah menyala SAAT PDF utuhnya diunggah (lihat
  // `admin/produk/[id]/unggah.ts`) — sementara `perbaruiProduk` boleh
  // menyalakan bendera itu kapan saja sesudahnya. Bendera yang menyala di atas
  // produk tanpa berkas dulu melahirkan tombol yang selalu berakhir 404: janji
  // yang tidak bisa ditepati, dan pembeli yang menyalahkan dirinya sendiri.
  // Bendera TETAP diperiksa — ia pagar niat admin — hanya tidak sendirian.
  const tombolUnduh = produk.boleh_unduh && berkas !== null && (
    <a
      href={`/api/produk/${produk.id}/unduh`}
      className="mt-4 inline-block rounded-lg bg-night px-5 py-3 text-[13.5px] font-bold text-gold-pale"
    >
      Unduh berkas asli
    </a>
  );

  if (produk.jenis === "video") {
    // Nol baris = tidak dimiliki (RLS) ATAU belum diunggah admin — bukan
    // dibedakan di sini, lihat komentar di atas fungsi.
    if (!berkas) notFound();

    return (
      <>
        {kembali}
        {header}
        {deskripsi}

        <section className="relative select-none overflow-hidden rounded-2xl border border-black/10 bg-white p-6">
          <PemutarVideo productId={produk.id} />
        </section>
        {tombolUnduh}

        <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
          <span className="text-gold">🔒</span>
          Video ini ditonton langsung di dalam aplikasi.
        </p>
      </>
    );
  }

  const { data: halamanBaris } = await supabase
    .from("digital_product_pages")
    .select("halaman")
    .eq("product_id", produk.id)
    .order("halaman", { ascending: true });
  if (!halamanBaris || halamanBaris.length === 0) notFound();

  return (
    <>
      {kembali}
      {header}
      {deskripsi}

      <ReaderPdf productId={produk.id} halaman={halamanBaris.map((h) => h.halaman)} />
      {tombolUnduh}

      <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
        <span className="text-gold">🔒</span>
        Setiap halaman ditandai identitas Anda.
      </p>
    </>
  );
}
