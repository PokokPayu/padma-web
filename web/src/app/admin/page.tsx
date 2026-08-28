import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "Panel Admin — PADMA" };

export default async function AdminPage() {
  const { nama } = await requireRole(["admin", "owner"]);
  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl text-night">Panel Admin</h1>
      <p className="text-ink-soft mt-2">
        Halo, {nama}. Modul klien dan sesi dibangun di Plan 3.
      </p>
      <Link
        href="/admin/skrining"
        className="mt-5 inline-block rounded-xl bg-night px-5 py-3 font-bold text-gold-pale"
      >
        Buka Inbox Skrining
      </Link>
      <form action="/auth/keluar" method="post" className="mt-6">
        <button className="rounded-lg border border-black/15 px-4 py-2 font-bold">
          Keluar
        </button>
      </form>
    </main>
  );
}
