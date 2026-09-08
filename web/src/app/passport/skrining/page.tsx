import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { bacaPengaturan } from "@/lib/settings";
import { Wizard } from "@/app/skrining/wizard";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Skrining Keselamatan" };

/**
 * SKRINING DARI DALAM PASSPORT (spec C1 J6).
 *
 * Siapa pun yang mendaftar lewat `/daftar` tanpa pernah melewati corong landing
 * akan terkunci dari pemesanan — `guard_booking_skrining` menuntut skrining
 * hijau miliknya, dan ia belum punya satu pun. Halaman ini pintunya.
 *
 * Komponen wizard-nya DIPAKAI ULANG apa adanya, bukan disalin: pertanyaan dan
 * penilaiannya harus identik dengan corong publik. Dua salinan wizard adalah
 * dua kesempatan jawabannya berbeda — dan yang berbeda di sini adalah keputusan
 * boleh-tidaknya seseorang menerima layanan.
 *
 * Yang berbeda hanya dua hal, keduanya dioper sebagai prop: rute penyimpannya,
 * dan ke mana layar hasil hijau mengarah.
 */
export default async function HalamanSkriningPassport() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const { nomorWaLink } = await bacaPengaturan();

  return (
    <section>
      <h1 className="mb-1 font-serif text-xl text-night">Skrining keselamatan</h1>
      <p className="mb-4 text-[13px] text-ink-soft">
        Diisi setiap kali akan memesan — kondisi bisa berubah di antara dua kunjungan, dan
        jawaban terakhir Anda yang dipakai tim.
      </p>
      <Wizard nomorWaLink={nomorWaLink} rute="/api/skrining/akun" dalamPassport />
    </section>
  );
}
