import { bacaKatalog } from "@/lib/katalog";
import { bacaPengaturan } from "@/lib/settings";
import { bacaProdukPublik } from "@/lib/produk/katalog";
import { Hero } from "./_landing/hero";
import { LiniLayanan } from "./_landing/lini-layanan";
import { CaraKerja } from "./_landing/cara-kerja";
import { ProdukDigital } from "./_landing/produk-digital";
import { PassportTeaser } from "./_landing/passport-teaser";
import { Pembanding } from "./_landing/pembanding";
import { Footer } from "./_landing/footer";

// Katalog datang dari DB dan diganti klien lewat panel admin, jadi halaman ini
// tidak boleh dibekukan selamanya di waktu build (default `next build` untuk
// halaman tanpa cookie/header adalah statis penuh — perubahan katalog baru
// terlihat setelah deploy berikutnya). Dengan revalidate, landing tetap murah
// (dilayani dari cache) tetapi menyusul isi terbaru dalam hitungan menit.
export const revalidate = 300;

// Rute publik: TIDAK memanggil requireRole. Katalog dirender server-side dari
// Postgres lewat policy "baca publik" — bila policy itu hilang, pengunjung
// anonim menerima 0 baris TANPA error dan landing tampil kosong. Penjagaannya
// ada di `tests/landing.test.ts` + `tests/landing-katalog.test.ts`.
export default async function Home() {
  const [katalog, pengaturan, produk] = await Promise.all([
    bacaKatalog(),
    bacaPengaturan(),
    bacaProdukPublik(4),
  ]);

  return (
    <main className="bg-paper">
      <Hero waLink={pengaturan.nomorWaLink} />
      <LiniLayanan katalog={katalog} />
      <CaraKerja />
      <ProdukDigital produk={produk} />
      <PassportTeaser />
      <Pembanding />
      <Footer
        waTampilan={pengaturan.nomorWaTampilan}
        jam={pengaturan.jamTampilan}
        alamat={pengaturan.alamatTampilan}
      />
    </main>
  );
}
