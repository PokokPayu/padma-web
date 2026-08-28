import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-paper">
      <h1 className="font-serif text-3xl tracking-[0.3em] text-night">PADMA</h1>
      <p className="text-ink-soft text-sm">Landing publik dibangun di Plan 2.</p>
      <Link
        href="/masuk"
        className="rounded-lg bg-night px-5 py-2.5 font-bold text-gold-pale"
      >
        Masuk
      </Link>
    </main>
  );
}
