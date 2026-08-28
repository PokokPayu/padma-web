import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "Panel Owner — PADMA" };

export default async function OwnerPage() {
  const { nama } = await requireRole(["owner"]);
  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl text-night">Panel Owner</h1>
      <p className="text-ink-soft mt-2">
        Halo, {nama}. Rate card &amp; rekap honor dibangun di Plan 5.
      </p>
      <form action="/auth/keluar" method="post" className="mt-6">
        <button className="rounded-lg border border-black/15 px-4 py-2 font-bold">
          Keluar
        </button>
      </form>
    </main>
  );
}
