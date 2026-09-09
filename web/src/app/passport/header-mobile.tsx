import Link from "next/link";
import { Lotus } from "@/app/_landing/lotus";

/**
 * Kepala halaman KHUSUS LAYAR SEMPIT.
 *
 * Di desktop, kartu tab sudah menjadi kepala halaman: ia memuat lambang lewat
 * tab Beranda, nama pemakai, dan jalan keluar. Di ponsel navigasinya pindah ke
 * bilah bawah, dan yang tertinggal di atas adalah — tidak ada apa-apa. Layar
 * passport lalu dibuka dengan konten mentah yang menempel di tepi atas, tanpa
 * satu pun tanda aplikasi apa yang sedang dipakai; pada tangkapan layar ponsel
 * bahkan tidak ada cara mengetahui bahwa itu PADMA.
 *
 * Isinya sengaja hanya dua: identitas rumah di kiri, dan pintu ke profil di
 * kanan. Ia BUKAN tempat kedua untuk navigasi — bilah bawah sudah memegang itu,
 * dan dua baris navigasi di layar 375 px adalah dua tempat untuk mencari hal
 * yang sama.
 *
 * `sticky`, bukan `fixed`: ia ikut menggulir dalam aliran dokumen dan tidak
 * perlu ruang cadangan di layout — sementara bilah bawah yang `fixed` sudah
 * membayar ruangnya sendiri lewat `pb-36`.
 */
export function HeaderMobile({ nama }: { nama: string }) {
  // Huruf pertama, bukan avatar: PADMA tidak menyimpan foto klien, dan bulatan
  // kosong terbaca sebagai gambar yang gagal dimuat.
  const inisial = nama.trim().charAt(0).toUpperCase() || "?";
  return (
    <header className="sticky top-0 z-40 border-b border-gold/20 bg-paper/95 backdrop-blur sm:hidden">
      <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-2.5">
        <Link href="/passport" className="flex min-w-0 items-center gap-2.5">
          <Lotus className="w-6 flex-none text-gold" />
          <span className="min-w-0">
            <b className="block font-serif text-[16px] font-normal leading-none tracking-[0.16em] text-night">
              PADMA
            </b>
            {/* Baris kedua menyebut RUANG yang sedang dibuka, bukan mengulang
                nama merek. Di ponsel inilah satu-satunya keterangan bahwa layar
                ini milik passport klien, bukan halaman publik. */}
            <span className="mt-1 block text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
              Digital Care Passport
            </span>
          </span>
        </Link>

        <span className="flex-1" />

        <Link
          href="/passport/profil"
          aria-label={`Profil ${nama}`}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-night text-[13px] font-bold text-gold-pale"
        >
          {inisial}
        </Link>
      </div>
    </header>
  );
}
