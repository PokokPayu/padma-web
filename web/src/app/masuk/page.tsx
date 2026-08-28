import { FormMasuk } from "./form-masuk";

export const metadata = { title: "Masuk — PADMA" };

export default function MasukPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper-warm px-4">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8">
        <h1 className="font-serif text-2xl text-night mb-1">Masuk ke PADMA</h1>
        <p className="text-sm text-ink-soft mb-6">
          Akun dibuat oleh tim PADMA saat Anda menjadi klien. Masuk dengan
          email yang terdaftar.
        </p>
        <FormMasuk />
      </div>
    </main>
  );
}
