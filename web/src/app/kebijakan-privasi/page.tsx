import { bacaPengaturan } from "@/lib/settings";
import { SitusShell } from "../_situs/shell";
import { BAGIAN_PRIVASI } from "../_dokumen/bagian";
import { KerangkaDokumen } from "../_dokumen/kerangka";
import { IsiKebijakanPrivasi } from "../_dokumen/isi-kebijakan-privasi";

export const metadata = { title: "Kebijakan Privasi" };
export const revalidate = 300;

/** Rute publik, tanpa penjaga peran. Tidak masuk menu header (spec 2026-10-06). */
// Tautan WA POLOS, bukan `tautanWaSitus`: pesan terisi itu berkode sumber
// WEBSITE dan menanyakan pricelist — salah untuk permintaan data pribadi.
export default async function KebijakanPrivasiPage() {
  const pengaturan = await bacaPengaturan();
  return (
    <SitusShell pengaturan={pengaturan}>
      <KerangkaDokumen
        judul="Kebijakan Privasi"
        pengantar="Data apa yang PADMA kumpulkan, untuk apa, siapa yang dapat melihatnya, dan hak Anda atas data tersebut."
        bagian={BAGIAN_PRIVASI}
      >
        <IsiKebijakanPrivasi
          waHref={`https://wa.me/${pengaturan.nomorWaLink}`}
          waTampilan={pengaturan.nomorWaTampilan}
        />
      </KerangkaDokumen>
    </SitusShell>
  );
}
