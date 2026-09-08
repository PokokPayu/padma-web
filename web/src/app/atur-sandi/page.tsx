import { PanggungAuth } from "@/app/_auth/panggung";
import { FormAturSandi } from "./form-atur-sandi";

export const metadata = { title: "Atur kata sandi" };

export default function AturSandiPage() {
  return (
    <PanggungAuth
      judul="Satu kata sandi baru."
      kalimat="Pilih kata sandi yang belum pernah Anda pakai di tempat lain, lalu simpan."
    >
      {/* h2, bukan h1 — panel kiri panggung memegang h1 karena datang lebih
          dulu di DOM. Lihat komentar hierarki judul di panggung.tsx. */}
      <h2 className="font-serif text-2xl text-night mb-6">Atur kata sandi baru</h2>
      <FormAturSandi />
    </PanggungAuth>
  );
}
