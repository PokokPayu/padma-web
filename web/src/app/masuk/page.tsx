import { FormMasuk } from "./form-masuk";
import { PanggungAuth } from "@/app/_auth/panggung";

export const metadata = { title: "Masuk" };

export default function MasukPage() {
  return (
    <PanggungAuth
      judul="Passport Anda menunggu."
      kalimat="Riwayat sesi, catatan bidan, materi panduan, dan progres perawatan Anda — semua di satu tempat yang aman."
    >
      {/* h2, bukan h1 — panel kiri panggung memegang h1 karena datang lebih
          dulu di DOM. Lihat komentar hierarki judul di panggung.tsx. */}
      <h2 className="font-serif text-2xl text-night mb-1">Masuk ke PADMA</h2>
      <p className="text-sm text-ink-soft mb-6">
        Akun dibuat oleh tim PADMA saat Anda menjadi klien. Masuk dengan
        email yang terdaftar.
      </p>
      <FormMasuk />
    </PanggungAuth>
  );
}
