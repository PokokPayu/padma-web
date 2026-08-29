import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { createServerSupabase } from "@/lib/supabase/server";
import { FormAjukan } from "./form";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Ajukan Jadwal" };

export default async function HalamanAjukan() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // Daftar layanan dibaca dengan SESI PENGGUNA (bukan bacaKatalog yang memakai
  // anon key untuk halaman publik) supaya klien melihat katalog yang sama
  // seperti yang boleh ia minta — RLS tetap yang menyaring.
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("services")
    .select("id, nama")
    .eq("aktif", true)
    .order("nama");

  // `min` hanyalah kenyamanan pemakai — penolakan tanggal lampau yang sungguh
  // mengikat ada di server action dan di trigger basis data. Atribut HTML bisa
  // dihapus siapa saja lewat devtools.
  return (
    <FormAjukan
      layanan={(data ?? []) as Array<{ id: string; nama: string }>}
      tanggalPalingAwal={hariIniJakarta()}
    />
  );
}
