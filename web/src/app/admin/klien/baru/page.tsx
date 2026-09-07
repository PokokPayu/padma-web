import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { FormKlienBaru } from "../form-klien";

export const metadata = { title: "Klien baru" };

/**
 * Rute berdiri sendiri, bukan panel geser di atas daftar — pola B: klien
 * punya isi turunan (riwayat sesi, paket, akses materi) yang butuh halaman
 * sendiri, dan segmen statis `baru/` ini menang atas `[id]/` di App Router
 * sehingga tidak pernah tertangkap sebagai id klien.
 */
export default async function KlienBaruPage() {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data: fase } = await supabase
    .from("phases")
    .select("id, nama")
    .order("urutan")
    .returns<{ id: string; nama: string }[]>();

  return (
    <main className="max-w-2xl">
      <Link href="/admin/klien" className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Klien
      </Link>
      <h1 className="mb-4 mt-2 text-[18px] font-bold text-panel-ink">Klien baru</h1>
      <FormKlienBaru fase={fase ?? []} />
    </main>
  );
}
