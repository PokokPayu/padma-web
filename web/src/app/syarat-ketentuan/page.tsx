import { bacaPengaturan } from "@/lib/settings";
import { SitusShell } from "../_situs/shell";
import { BAGIAN_SK } from "../_dokumen/bagian";
import { KerangkaDokumen } from "../_dokumen/kerangka";
import { IsiSyaratKetentuan } from "../_dokumen/isi-syarat-ketentuan";

export const metadata = { title: "Syarat & Ketentuan" };
// Nomor WA dan area dibaca dari pengaturan admin, seperti halaman situs lain.
export const revalidate = 300;

/** Rute publik, tanpa penjaga peran. Tidak masuk menu header (spec 2026-10-06). */
// Tautan WA POLOS, bukan `tautanWaSitus`: pesan terisi itu berkode sumber
// WEBSITE dan menanyakan pricelist — salah untuk permintaan data pribadi.
export default async function SyaratKetentuanPage() {
  const pengaturan = await bacaPengaturan();
  return (
    <SitusShell pengaturan={pengaturan}>
      <KerangkaDokumen
        judul="Syarat & Ketentuan"
        pengantar="Ketentuan pemakaian layanan PADMA Wellness: skrining, kunjungan, pembayaran, pembatalan, dan produk digital."
        bagian={BAGIAN_SK}
      >
        <IsiSyaratKetentuan
          waHref={`https://wa.me/${pengaturan.nomorWaLink}`}
          waTampilan={pengaturan.nomorWaTampilan}
          area={pengaturan.alamatTampilan}
        />
      </KerangkaDokumen>
    </SitusShell>
  );
}
