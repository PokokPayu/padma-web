import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilMateriDetail } from "@/lib/passport/data";
import { Watermark } from "../../_komponen/watermark";

export const metadata = { title: "Materi" };

export default async function ReaderMateri({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 16: `params` adalah Promise
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // `ambilMateriDetail` menyaring `aktif = true` sendiri: policy
  // material_chapters/material_videos TIDAK mengevaluasi materials.aktif, jadi
  // materi yang ditarik admin tetap punya bab yang terbaca RLS.
  const m = await ambilMateriDetail(id);
  if (!m) notFound();

  // "Terkunci" berbentuk ARRAY KOSONG (bab) dan OBJEK NULL (video) — bukan
  // error dan bukan isi tersensor: RLS memang tidak mengembalikan barisnya.
  // Embed video adalah objek/null, BUKAN array — memeriksa panjangnya selalu
  // menghasilkan salah dan membuat setiap materi video tampak terkunci.
  const berhak = m.tipe === "ebook" ? m.bab.length > 0 : m.videoUrl !== null;
  if (!berhak) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
        <h1 className="font-serif text-xl text-night">Materi ini belum terbuka</h1>
        <p className="mt-2 text-[13.5px] text-ink-soft">
          <b className="text-ink">{m.judul}</b> terbuka setelah layanan terkait
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
          {m.tipe === "ebook" ? "📖" : "▶"}
        </span>
        <span>
          <h1 className="font-serif text-xl text-[#F5EEDC]">{m.judul}</h1>
          <span className="text-xs text-[#A9BBAA]">
            {m.tipe === "ebook"
              ? "E-Book · baca di aplikasi"
              : "Video · tonton di aplikasi"}{" "}
            · {m.namaLayanan}
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
          {m.tipe === "video" ? (
            <>
              <div className="mb-3.5 flex aspect-video items-center justify-center rounded-xl border border-gold/30 bg-gradient-to-br from-pine to-[#081F16]">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/90 text-2xl text-[#132518]">
                  ▶
                </span>
              </div>
              {/* Kesiapan tidak boleh dikarang: belum ada akun penyedia video,
                  jadi tidak ada pemutar sungguhan dan tidak ada URL yang
                  dikirim ke halaman ini. */}
              <p className="text-[13px] text-ink-soft">
                Pemutar video diaktifkan pada fase berikutnya, memakai penyedia
                dengan tautan terproteksi (terkunci domain). Sampai saat itu,
                mintalah tautannya pada tim PADMA lewat WhatsApp.
              </p>
            </>
          ) : (
            <div className="grid gap-6">
              {m.bab.map((b, i) => (
                <article key={b.id}>
                  <h2 className="mb-2 font-serif text-lg text-night">
                    <span className="mr-2 font-mono text-xs text-gold">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {b.judul}
                  </h2>
                  {/* `whitespace-pre-line`: isi bab menyimpan pemisah paragraf
                      sebagai baris baru, bukan markup. */}
                  <p className="whitespace-pre-line text-sm leading-7 text-[#3C4C42]">
                    {b.isi}
                  </p>
                </article>
              ))}
            </div>
          )}
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
