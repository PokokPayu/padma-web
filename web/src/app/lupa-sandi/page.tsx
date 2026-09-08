import { PanggungAuth } from "@/app/_auth/panggung";
import { FormLupaSandi } from "./form-lupa-sandi";

export const metadata = { title: "Lupa sandi — PADMA" };

export default function LupaSandiPage() {
  return (
    <PanggungAuth
      judul="Tenang, ini bisa dipulihkan."
      kalimat="Masukkan email akun Anda. Bila terdaftar, kami mengirim tautan untuk mengatur kata sandi baru."
    >
      {/* h2, bukan h1 — panel kiri panggung memegang h1 karena datang lebih
          dulu di DOM. Lihat komentar hierarki judul di panggung.tsx. */}
      <h2 className="font-serif text-2xl text-night mb-1">Atur ulang kata sandi</h2>
      <p className="text-sm text-ink-soft mb-6">
        Ingat kata sandi Anda?{" "}
        <a href="/masuk" className="font-semibold text-leaf underline">
          Masuk di sini
        </a>
        .
      </p>
      <FormLupaSandi />
    </PanggungAuth>
  );
}
