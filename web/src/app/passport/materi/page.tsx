import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilDaftarMateri, ambilKlien } from "@/lib/passport/data";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Materi Panduan" };

// Halaman DAFTAR sengaja tidak pernah menyentuh pengambil detail materi:
// keterbukaan tiap materi disimpulkan dari ada/tidaknya baris tergating yang
// dikembalikan RLS, bukan dari isinya. Satu pemanggilan detail di sini sudah
// cukup untuk menarik seluruh isi bab dan URL video ke payload halaman yang
// paling sering dibuka — gembok di kartu akan tinggal gambar.
export default async function HalamanMateri() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const materi = await ambilDaftarMateri();

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">
        Materi Panduan Anda{" "}
        <span className="font-sans text-xs font-semibold text-ink-soft">
          terbuka sesuai layanan yang Anda jalani
        </span>
      </h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {materi.map((m) => {
          // `data-materi-*` bukan hiasan: "terbuka atau tidak" adalah kontrak
          // yang diuji, sementara kelas Tailwind berubah tiap desain disetel.
          const penanda = {
            "data-materi-id": m.id,
            "data-materi-terbuka": m.terbuka ? "ya" : "tidak",
          };

          const isi = (
            <>
              <span
                className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl text-[17px] ${
                  m.terbuka ? "bg-leaf-soft text-leaf" : "bg-[#EFEDE4] text-[#9A957F]"
                }`}
              >
                {m.terbuka ? (m.tipe === "ebook" ? "📖" : "▶") : "🔒"}
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] leading-tight">{m.judul}</b>
                <span className="text-[11.5px] text-ink-soft">
                  {m.terbuka
                    ? `${
                        m.tipe === "ebook"
                          ? "E-Book · baca di aplikasi"
                          : "Video · tonton di aplikasi"
                      } · ${m.namaLayanan}`
                    : "Terbuka setelah layanan terkait selesai"}
                </span>
              </span>
            </>
          );

          // Kartu terkunci bukan tautan yang dinonaktifkan lewat kelas — ia
          // memang bukan tautan, supaya tidak ada yang bisa diikuti.
          return m.terbuka ? (
            // prefetch dibiarkan pada nilai bawaannya untuk rute dinamis:
            // memaksanya `true` akan menarik isi bab ke Client Cache sebelum
            // kartu ini benar-benar diklik.
            <Link
              key={m.id}
              {...penanda}
              href={`/passport/materi/${m.id}`}
              className="flex items-start gap-3.5 rounded-xl border border-black/10 bg-[#FFFEFA] p-4 transition hover:-translate-y-0.5 hover:border-gold"
            >
              {isi}
            </Link>
          ) : (
            <div
              key={m.id}
              {...penanda}
              className="flex items-start gap-3.5 rounded-xl border border-black/10 bg-paper p-4 opacity-60"
            >
              {isi}
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex gap-2.5 rounded-xl border border-dashed border-black/10 bg-paper p-3 text-xs text-ink-soft">
        <span className="text-gold">🔒</span>
        Semua materi eksklusif untuk klien PADMA — hanya bisa dibaca &amp; ditonton
        di dalam aplikasi, tanpa unduhan. Setiap halaman ditandai identitas akun
        Anda.
      </p>
    </section>
  );
}
