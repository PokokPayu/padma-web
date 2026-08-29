import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { TabelInbox, type BarisSkrining } from "./tabel-inbox";

export const metadata = { title: "Inbox Skrining" };

export default async function InboxSkriningPage() {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // `client_id` ikut dibaca supaya inbox bisa membedakan calon klien yang sudah
  // didaftarkan dari yang belum — tanpa kolom itu, satu-satunya kabar bahwa
  // seseorang sudah punya PADMA ID adalah ingatan admin.
  const [{ data }, { data: fase }] = await Promise.all([
    supabase
      .from("screenings")
      .select(
        "id, kode, nama, no_hp, fase, hasil, status_tindak_lanjut, created_at, flags, client_id",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    // Nama fase datang dari tabel `phases`, tidak pernah disalin sebagai
    // literal ke komponen.
    supabase
      .from("phases")
      .select("id, nama, urutan")
      .order("urutan")
      .returns<{ id: string; nama: string; urutan: number }[]>(),
  ]);

  return (
    <main className="p-8">
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Inbox Skrining</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Saat pesan WhatsApp masuk, cocokkan kodenya di sini untuk melihat
          jawaban asli — bukan sekadar percaya isi pesan.
        </p>
      </header>
      <TabelInbox baris={(data ?? []) as BarisSkrining[]} fase={fase ?? []} />
    </main>
  );
}
