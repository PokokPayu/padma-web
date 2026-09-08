import { PanggungAuth } from "@/app/_auth/panggung";
import { FormKirimUlang } from "./form-kirim-ulang";

export const metadata = { title: "Periksa email Anda — PADMA" };

/**
 * Halaman tunggu konfirmasi email.
 *
 * Kalimat panel kirinya SENGAJA berbeda dari `/akun-belum-terhubung`: dua
 * keadaan yang berbeda — di sana akunnya sudah bisa masuk tetapi belum tertaut
 * ke rekam klien dan yang dinanti adalah tautan aktivasi dari WhatsApp; di sini
 * yang dinanti adalah bukti bahwa alamat emailnya memang miliknya.
 *
 * Konfirmasi email bukan formalitas di PADMA: ia SATU-SATUNYA hal yang membuat
 * penautan lewat email menjadi sah (lihat `@/lib/auth/pastikan-klien`). Karena
 * itu halaman ini adalah jalan buntu yang jujur — tidak ada tombol "lewati".
 */
export default function PeriksaEmailPage() {
  return (
    <PanggungAuth
      judul="Satu langkah lagi."
      kalimat="Kami mengirim satu tautan konfirmasi ke email Anda. Membukanya memastikan bahwa alamat itu benar milik Anda — dan itulah yang menjaga rekam kesehatan Anda tetap milik Anda."
    >
      {/* h2, bukan h1 — panel kiri panggung memegang h1 karena datang lebih
          dulu di DOM. Lihat komentar hierarki judul di panggung.tsx. */}
      <h2 className="font-serif text-2xl text-night mb-3">Periksa email Anda</h2>
      <p className="text-sm text-ink-soft mb-3">
        Buka pesan dari PADMA di kotak masuk Anda, lalu ketuk tautan
        konfirmasinya. Sesudah itu Anda bisa langsung masuk dan Passport Anda
        terbuka.
      </p>
      <p className="text-sm text-ink-soft mb-6">
        Belum ada pesannya? Periksa folder spam lebih dulu — bila memang belum
        sampai, kirim ulang tautannya di bawah ini.
      </p>
      <FormKirimUlang />
      <p className="mt-6 text-sm text-ink-soft">
        Sudah mengonfirmasi?{" "}
        <a href="/masuk" className="font-semibold text-leaf underline">
          Masuk di sini
        </a>
        .
      </p>
    </PanggungAuth>
  );
}
