import { FormMasuk } from "./form-masuk";
import { PanggungAuth } from "@/app/_auth/panggung";

export const metadata = { title: "Masuk" };

export default function MasukPage() {
  return (
    <PanggungAuth
      judul="Passport Anda menunggu."
      kalimat="Riwayat sesi, catatan bidan, materi panduan, dan progres paket Anda — semua di satu tempat yang aman."
    >
      <FormMasuk />
    </PanggungAuth>
  );
}
