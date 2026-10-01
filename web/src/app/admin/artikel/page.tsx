import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormArtikelBaru } from "./editor";
import { PillTerbit } from "@/app/admin/_shell/pill-terbit";

export const metadata = { title: "Artikel" };

type Baris = { id: string; judul: string; slug: string; kategori: string; terbit: boolean; updated_at: string };

export default async function ArtikelAdminPage() {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("articles")
    .select("id, judul, slug, kategori, terbit, updated_at")
    .order("terbit", { ascending: true })
    .order("updated_at", { ascending: false })
    .returns<Baris[]>();
  const baris = data ?? [];

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Artikel</h1>
        <Bantuan judul="Tentang halaman ini">
          Artikel edukasi untuk halaman <b>/artikel</b> di situs publik. Tulis dalam format markdown sederhana
          dengan pratinjau langsung; artikel baru lahir sebagai <b>draf</b> dan baru tampil di situs setelah
          diterbitkan.
        </Bantuan>
      </header>

      <div className="mb-3 rounded-lg border border-panel-border bg-panel-surface p-4">
        <FormArtikelBaru />
      </div>

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Belum ada artikel.
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar artikel">
            <thead>
              <tr>
                <Th>Judul</Th>
                <Th>Kategori</Th>
                <Th>Status</Th>
                <Th>Diubah</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link href={`/admin/artikel/${a.id}`} className="font-bold text-panel-ink underline">
                      {a.judul}
                    </Link>
                    <span className="mt-0.5 block font-mono text-[11.5px] text-panel-muted">/artikel/{a.slug}</span>
                  </Td>
                  <Td>{a.kategori || "—"}</Td>
                  <Td>
                    <PillTerbit terbit={a.terbit} />
                  </Td>
                  <Td>
                    <span className="text-[12.5px] text-panel-muted">
                      {new Date(a.updated_at).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Asia/Jakarta",
                      })}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}
    </main>
  );
}
