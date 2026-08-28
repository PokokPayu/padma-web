import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { TabelInbox, type BarisSkrining } from "./tabel-inbox";

export const metadata = { title: "Inbox Skrining" };

export default async function InboxSkriningPage() {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("screenings")
    .select("id, kode, nama, no_hp, fase, hasil, status_tindak_lanjut, created_at, flags")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="p-8">
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Inbox Skrining</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Saat pesan WhatsApp masuk, cocokkan kodenya di sini untuk melihat
          jawaban asli — bukan sekadar percaya isi pesan.
        </p>
      </header>
      <TabelInbox baris={(data ?? []) as BarisSkrining[]} />
    </main>
  );
}
