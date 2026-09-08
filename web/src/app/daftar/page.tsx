import { FormDaftar } from "./form-daftar";
import { PanggungAuth } from "@/app/_auth/panggung";

export const metadata = { title: "Daftar" };

export default function DaftarPage() {
  return (
    <PanggungAuth
      judul="Mulai perjalanan Anda."
      kalimat="Buat akun untuk melihat riwayat sesi, materi panduan, dan mengatur jadwal Anda sendiri."
    >
      {/* h2, bukan h1 — panel kiri panggung memegang h1 karena datang lebih
          dulu di DOM. Lihat komentar hierarki judul di panggung.tsx. */}
      <h2 className="font-serif text-2xl text-night mb-1">Buat akun PADMA</h2>
      <p className="text-sm text-ink-soft mb-6">
        Sudah punya akun?{" "}
        <a href="/masuk" className="font-semibold text-leaf underline">
          Masuk di sini
        </a>
        .
      </p>
      <FormDaftar />
    </PanggungAuth>
  );
}
