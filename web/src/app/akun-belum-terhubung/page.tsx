export const metadata = { title: "Akun belum terhubung — PADMA" };

export default function AkunBelumTerhubungPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper-warm px-4 text-center">
      <div className="max-w-md">
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
    </main>
  );
}
