import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { EditorArtikel } from "../editor";
import { PillTerbit } from "@/app/admin/_shell/pill-terbit";

export const metadata = { title: "Ubah artikel" };

type Baris = { id: string; judul: string; slug: string; kategori: string; isi: string; terbit: boolean };

export default async function UbahArtikelPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: artikel } = await supabase
    .from("articles")
    .select("id, judul, slug, kategori, isi, terbit")
    .eq("id", id)
    .maybeSingle<Baris>();
  if (!artikel) notFound();

  return (
    <main>
      <Link href="/admin/artikel" className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Artikel
      </Link>
      <header className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[18px] font-bold text-panel-ink">{artikel.judul}</h1>
        <span className="flex items-center gap-3">
          {artikel.terbit && (
            <a
              href={`/artikel/${artikel.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-bold text-panel-ink underline"
            >
              Lihat di situs ↗
            </a>
          )}
          <PillTerbit terbit={artikel.terbit} />
        </span>
      </header>
      <EditorArtikel artikel={artikel} />
    </main>
  );
}
