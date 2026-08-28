import { bacaPengaturan } from "@/lib/settings";
import { Wizard } from "./wizard";

export const metadata = { title: "Skrining Awal Klien" };

export default async function SkriningPage() {
  const { nomorWaLink } = await bacaPengaturan();
  return (
    <main className="min-h-screen bg-paper px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-7 text-center">
          <h1 className="font-serif text-3xl text-night">Skrining Awal Klien</h1>
          <p className="mt-1 text-sm text-ink-soft">
            ± 2 menit · jawab sesuai kondisi Anda <b>saat ini</b>
          </p>
        </header>
        <Wizard nomorWaLink={nomorWaLink} />
      </div>
    </main>
  );
}
