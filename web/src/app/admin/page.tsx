import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "Panel Admin — PADMA" };

export default async function AdminPage() {
  const { nama } = await requireRole(["admin", "owner"]);
  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl text-night">Panel Admin</h1>
      <p className="text-ink-soft mt-2">
        Halo, {nama}. Modul inbox skrining, klien, dan sesi dibangun di Plan 2–3.
      </p>
      <form action="/auth/keluar" method="post" className="mt-6">
        <button className="rounded-lg border border-black/15 px-4 py-2 font-bold">
          Keluar
        </button>
      </form>
    </main>
  );
}
