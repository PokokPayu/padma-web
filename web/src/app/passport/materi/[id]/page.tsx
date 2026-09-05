import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilMateriDetail } from "@/lib/passport/data";
import { Watermark } from "../../_komponen/watermark";
import { ReaderPdf } from "./reader-pdf";
import { PemutarVideo } from "./pemutar-video";

export const metadata = { title: "Materi" };

/**
 * Pesan "belum berhak" — dipertahankan APA ADANYA dari sebelum M10, sebab
 * kalimatnya memang benar untuk keadaan ini (beda dengan kartu terkunci di
 * daftar tanpa layanan sama sekali, lihat `saringDaftarMateri`). Diekstrak
 * jadi komponen karena SATU pesan yang sama kini dipakai baik ebook maupun
 * video — `m.berhak` (RPC `berhak_isi_materi`) tidak peduli tipe materinya.
 */
function BelumTerbuka({ judul }: { judul: string }) {
  return (
    <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
      <h1 className="font-serif text-xl text-night">Materi ini belum terbuka</h1>
      <p className="mt-2 text-[13.5px] text-ink-soft">
        <b className="text-ink">{judul}</b> terbuka setelah layanan terkait
        Anda jalani. Hubungi tim PADMA bila Anda merasa ini keliru.
      </p>
      <Link
        href="/passport/materi"
        className="mt-5 inline-block text-sm font-bold text-leaf underline underline-offset-4"
      >
        ← Kembali ke Materi
      </Link>
    </section>
  );
}

export default async function ReaderMateri({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 16: `params` adalah Promise
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // `ambilMateriDetail` menyaring `aktif = true` sendiri, lapis kedua di atas
  // RLS: query reader tidak boleh bergantung 100% pada policy basis data
  // untuk menutup materi yang ditarik admin.
  const m = await ambilMateriDetail(id);
  if (!m) notFound();

  // 1. Tidak berhak — pesan lama, dan ia memang benar di sini. `m.berhak`
  //    datang dari RPC `berhak_isi_materi`: SATU sumber kebenaran yang sama
  //    dipakai policy RLS, bukan disimpulkan dari isi yang kebetulan kosong —
  //    isi kosong JUGA terjadi saat berhak tapi belum diunggah admin
  //    (keadaan 2 di bawah), dan tanpa RPC ini dua keadaan itu tidak bisa
  //    dibedakan.
  if (!m.berhak) {
    return <BelumTerbuka judul={m.judul} />;
  }

  // ===== Cabang VIDEO =====
  // TIDAK DISENTUH oleh M10 — perubahan yang menyentuhnya secara TIDAK
  // LANGSUNG saat itu hanyalah gerbang di atas, yang memakai `m.berhak` (RPC)
  // alih-alih `m.videoUrl !== null`. Task 7 (video-r2) kini menggantikan
  // placeholder ▶ palsu di bawah dengan `<PemutarVideo>` sungguhan, yang
  // mengambil presigned URL dari `/api/materi/[id]/video` sesudah halaman
  // hidup — lihat komentar di route dan komponen itu untuk urutan yang
  // mengikat (query ber-RLS dulu, baru presigned URL).
  if (m.tipe === "video") {
    return (
      <>
        <Link
          href="/passport/materi"
          className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
        >
          ← Kembali ke Materi
        </Link>

        <div className="mb-4 flex items-center gap-4 rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7 text-[#EFE6CE]">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-gold/15 text-2xl text-gold-bright">
            ▶
          </span>
          <span>
            <h1 className="font-serif text-xl text-[#F5EEDC]">{m.judul}</h1>
            <span className="text-xs text-[#A9BBAA]">
              Video · tonton di aplikasi · {m.namaLayanan}
            </span>
          </span>
        </div>

        {m.deskripsi && (
          <div className="mb-4 rounded-2xl border border-black/10 bg-white p-6 text-[13.5px] text-[#3C4C42]">
            {m.deskripsi}
          </div>
        )}

        <section className="relative select-none overflow-hidden rounded-2xl border border-black/10 bg-white p-6">
          <Watermark nama={klien.nama} padmaId={klien.padmaId} />
          <div className="relative z-10">
            <PemutarVideo materiId={m.id} />
          </div>
        </section>

        <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
          <span className="text-gold">🔒</span>
          Materi ini hanya dapat dibaca di dalam aplikasi — tidak ada berkas yang
          bisa diunduh atau diteruskan. Setiap halaman ditandai identitas Anda.
        </p>
      </>
    );
  }

  // ===== Cabang EBOOK — tiga keadaan (M10) =====

  // 2. Berhak, tetapi isinya belum diunggah admin. Bukan 404 (materinya
  //    memang ada dan pasien memang berhak), dan bukan reader kosong yang
  //    membuat pasien mengira aplikasinya rusak.
  //
  //    Tautan baliknya (fix ronde 1): draft pertama keadaan ini tidak
  //    punya jalan keluar sama sekali selain tombol back peramban — persis
  //    kelas masalah yang sama dengan keadaan 3 di bawah sebelum diperbaiki.
  //    Markup-nya disalin dari `BelumTerbuka`, kartu yang paling mirip
  //    (sama-sama kartu berdiri sendiri berisi judul & satu kalimat).
  if (m.halaman.length === 0) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
        <h1 className="font-serif text-xl text-night">Isi materi sedang disiapkan</h1>
        <p className="mt-2 text-[13.5px] text-ink-soft">
          <b className="text-ink">{m.judul}</b> sudah terbuka untuk Anda, tetapi
          isinya belum diunggah tim PADMA. Silakan cek kembali nanti.
        </p>
        <Link
          href="/passport/materi"
          className="mt-5 inline-block text-sm font-bold text-leaf underline underline-offset-4"
        >
          ← Kembali ke Materi
        </Link>
      </section>
    );
  }

  // 3. Berhak dan ada isinya. Watermark TIDAK dilapiskan di sini — ia sudah
  //    dibakar ke dalam setiap gambar oleh route
  //    `/api/materi/[id]/halaman/[n]`; melapisinya lagi hanya menggandakan
  //    teks yang sama, dan lapisan CSS itu hilang begitu gambarnya disimpan
  //    sementara yang dibakar server tidak.
  //
  //    Tautan balik & judulnya (fix ronde 1): draft pertama Task 10 memakai
  //    `return <ReaderPdf .../>` telanjang persis seperti pseudokode brief,
  //    dan itu membuat satu-satunya layar yang benar-benar dipakai pasien
  //    lama justru satu-satunya yang tidak punya jalan keluar — sementara
  //    keadaan 1 & 2 di atasnya keduanya punya "← Kembali ke Materi". Markup
  //    di bawah disalin APA ADANYA dari cabang video persis di atasnya
  //    (header gradien yang sama sudah dipakai reader ebook SEBELUM M10),
  //    bukan gaya baru.
  return (
    <>
      <Link
        href="/passport/materi"
        className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
      >
        ← Kembali ke Materi
      </Link>

      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-gold/30 bg-gradient-to-br from-pine to-night p-7 text-[#EFE6CE]">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-gold/15 text-2xl text-gold-bright">
          📖
        </span>
        <span>
          <h1 className="font-serif text-xl text-[#F5EEDC]">{m.judul}</h1>
          <span className="text-xs text-[#A9BBAA]">
            E-Book · baca di aplikasi · {m.namaLayanan}
          </span>
        </span>
      </div>

      {m.deskripsi && (
        <div className="mb-4 rounded-2xl border border-black/10 bg-white p-6 text-[13.5px] text-[#3C4C42]">
          {m.deskripsi}
        </div>
      )}

      <ReaderPdf materiId={m.id} halaman={m.halaman} />

      <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
        <span className="text-gold">🔒</span>
        Materi ini hanya dapat dibaca di dalam aplikasi — tidak ada berkas yang
        bisa diunduh atau diteruskan. Setiap halaman ditandai identitas Anda.
      </p>
    </>
  );
}
