import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { Kartu } from "@/app/_shell/panel/kartu";
import { PillTerbit } from "@/app/admin/_shell/pill-terbit";
import { DataTestimoni, StatusTestimoni, VideoTestimoni } from "../form";

export const metadata = { title: "Ubah testimoni" };

type Baris = {
  id: string;
  nama: string;
  keterangan: string;
  kutipan: string;
  urutan: number;
  video_objek: string | null;
  izin_dikonfirmasi: boolean;
  terbit: boolean;
};

export default async function UbahTestimoniPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: t } = await supabase
    .from("testimonials")
    .select("id, nama, keterangan, kutipan, urutan, video_objek, izin_dikonfirmasi, terbit")
    .eq("id", id)
    .maybeSingle<Baris>();
  if (!t) notFound();

  return (
    <main>
      <Link href="/admin/testimoni" className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Testimoni
      </Link>
      <header className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[18px] font-bold text-panel-ink">{t.nama}</h1>
        <PillTerbit terbit={t.terbit} />
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <Kartu judul="Data testimoni">
            <DataTestimoni t={t} />
          </Kartu>
          <Kartu judul="Izin & penerbitan">
            <StatusTestimoni
              id={t.id}
              adaVideo={t.video_objek !== null}
              izin={t.izin_dikonfirmasi}
              terbit={t.terbit}
              nama={t.nama}
            />
          </Kartu>
        </div>
        <Kartu judul="Video">
          <VideoTestimoni id={t.id} adaVideo={t.video_objek !== null} versi={t.video_objek ?? ""} />
        </Kartu>
      </div>
    </main>
  );
}
