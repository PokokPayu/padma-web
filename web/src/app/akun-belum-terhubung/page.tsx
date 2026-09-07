import { PanggungAuth } from "@/app/_auth/panggung";

export const metadata = { title: "Akun belum terhubung — PADMA" };

// Kalimat panel kiri di sini SENGAJA berbeda dari "Satu langkah lagi." yang
// dipakai /periksa-email (tugas berikutnya). Dua halaman beda keadaan dengan
// kalimat identik membuat pembacanya mengira ia masih di halaman yang sama —
// padahal di sini akunnya sudah bisa masuk, hanya belum tertaut ke rekam
// klien, dan yang dibutuhkan adalah tautan aktivasi dari WhatsApp, bukan
// verifikasi email.
export default function AkunBelumTerhubungPage() {
  return (
    <PanggungAuth
      judul="Akun ini belum tertaut."
      kalimat="Tautan aktivasi dari tim PADMA yang menghubungkan akun Anda ke rekam klien. Buka pesan WhatsApp Anda untuk menemukannya."
    >
      <div className="text-center">
        <h1 className="font-serif text-2xl text-night mb-3">
          Akun Anda belum terhubung
        </h1>
        <p className="text-sm text-ink-soft mb-4">
          Akun klien PADMA diaktifkan lewat <strong>tautan aktivasi</strong> yang
          tim PADMA kirimkan via WhatsApp. Buka tautan itu lebih dulu, lalu masuk
          dengan email yang sama seperti yang terdaftar di PADMA.
        </p>
        <p className="text-sm text-ink-soft mb-6">
          Tautannya sudah kedaluwarsa, sudah pernah dipakai, atau belum Anda
          terima? Hubungi tim PADMA via WhatsApp untuk dikirimkan tautan baru.
        </p>
        <form action="/auth/keluar" method="post">
          <button className="rounded-lg border border-black/15 px-5 py-2.5 font-bold">
            Keluar
          </button>
        </form>
      </div>
    </PanggungAuth>
  );
}
