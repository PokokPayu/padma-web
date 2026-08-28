export const metadata = { title: "Akun belum terhubung — PADMA" };

export default function AkunBelumTerhubungPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper-warm px-4 text-center">
      <div className="max-w-md">
        <h1 className="font-serif text-2xl text-night mb-3">
          Akun Anda belum terhubung
        </h1>
        <p className="text-sm text-ink-soft mb-6">
          Email ini belum terdaftar sebagai klien PADMA. Hubungi tim PADMA via
          WhatsApp agar akun Anda didaftarkan, lalu masuk kembali dengan email
          yang sama.
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
