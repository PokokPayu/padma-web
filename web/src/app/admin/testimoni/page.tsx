import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { PillTerbit } from "@/app/admin/_shell/pill-terbit";
import { FormTestimoniBaru } from "./form";

export const metadata = { title: "Testimoni" };

type Baris = {
  id: string;
  nama: string;
  keterangan: string;
  video_objek: string | null;
  izin_dikonfirmasi: boolean;
  terbit: boolean;
  urutan: number;
};

export default async function TestimoniAdminPage() {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("testimonials")
    .select("id, nama, keterangan, video_objek, izin_dikonfirmasi, terbit, urutan")
    .order("urutan", { ascending: true })
    .order("created_at", { ascending: false })
    .returns<Baris[]>();
  const baris = data ?? [];

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Testimoni</h1>
        <Bantuan judul="Tentang halaman ini">
          Video testimoni untuk halaman <b>/testimoni</b> di situs publik. Testimoni hanya bisa terbit bila
          videonya sudah terunggah <b>dan</b> izin tertulis keluarga sudah dikonfirmasi — basis data menolak
          selain itu.
        </Bantuan>
      </header>

      <div className="mb-3 rounded-lg border border-panel-border bg-panel-surface p-4">
        <FormTestimoniBaru />
      </div>

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Belum ada testimoni.
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar testimoni">
            <thead>
              <tr>
                <Th>Nama</Th>
                <Th>Video</Th>
                <Th>Izin</Th>
                <Th>Status</Th>
                <Th>Urutan</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/admin/testimoni/${t.id}`} className="font-bold text-panel-ink underline">
                      {t.nama}
                    </Link>
                    <span className="mt-0.5 block text-[11.5px] text-panel-muted">{t.keterangan || "—"}</span>
                  </Td>
                  <Td>{t.video_objek ? "Terpasang" : <span className="text-clay">Belum ada</span>}</Td>
                  <Td>{t.izin_dikonfirmasi ? "Dikonfirmasi" : <span className="text-clay">Belum</span>}</Td>
                  <Td>
                    <PillTerbit terbit={t.terbit} />
                  </Td>
                  <Td>
                    <span className="font-mono text-[12.5px]">{t.urutan}</span>
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
