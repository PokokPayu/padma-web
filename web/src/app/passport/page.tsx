import { createServerSupabase } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "Digital Care Passport — PADMA" };

export default async function PassportPage() {
  await requireRole(["klien"]);
  const supabase = await createServerSupabase();
  const { data: klien } = await supabase
    .from("clients")
    .select("nama, padma_id")
    .limit(1)
    .single();

  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl text-night">Digital Care Passport</h1>
      <p className="text-ink-soft mt-2">
        {klien ? `${klien.nama} · ${klien.padma_id}` : "Memuat..."} — isi
        passport dibangun di Plan 4.
      </p>
      <form action="/auth/keluar" method="post" className="mt-6">
        <button className="rounded-lg border border-black/15 px-4 py-2 font-bold">
          Keluar
        </button>
      </form>
    </main>
  );
}
