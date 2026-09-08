import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { createServerSupabase } from "@/lib/supabase/server";
import { bacaPengaturan } from "@/lib/settings";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import { FormAjukan } from "./form";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Ajukan Jadwal" };

type BarisVarian = {
  id: string;
  service_id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
};

export default async function HalamanAjukan() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // Daftar layanan DAN varian dibaca dengan SESI PENGGUNA (bukan bacaKatalog
  // yang memakai anon key untuk halaman publik) supaya klien melihat katalog
  // yang sama seperti yang boleh ia minta — RLS tetap yang menyaring. Dua
  // query terpisah (bukan embed): FK `service_variants` ke `services` bukan
  // yang dipakai relasi sesi (gabungan service_id+id), dan pola dua-query yang
  // sama sudah dipakai di seluruh proyek untuk katalog varian.
  //
  // Alamat profil dibaca lewat jalur SESI PENGGUNA yang sama (bukan service
  // role, bukan `ambilKlien()` yang di-cache lintas-halaman) — Ruling 9 T6:
  // hanya untuk MENGISI AWAL medan alamat di formulir (spec T7 desain), klien
  // tetap bebas mengubahnya. `ajukanJadwal` sendiri TIDAK PERNAH membaca
  // kolom ini — nilai yang tersimpan selalu apa yang ada di FormData saat
  // submit, prefilled atau tidak.
  const supabase = await createServerSupabase();
  // Daftar jam dibaca dari `app_settings` (spec J2): jam operasional klinik akan
  // berubah, dan perubahan seperti itu tidak boleh menuntut deploy. Dibaca di
  // SERVER — nilai yang sama dipakai ulang sebagai pagar di `ajukanJadwal`,
  // sehingga apa yang ditawarkan layar dan apa yang diterima server tidak
  // pernah bisa berselisih.
  const [{ jamLayanan }, { data: layanan }, { data: varian }, { data: profil }] = await Promise.all([
    bacaPengaturan(),
    supabase.from("services").select("id, nama").eq("aktif", true).order("nama"),
    supabase
      .from("service_variants")
      .select("id, service_id, label, durasi_menit, format")
      .eq("aktif", true)
      .order("urutan")
      .returns<BarisVarian[]>(),
    supabase
      .from("clients")
      .select("alamat")
      .eq("id", klien.id) // operator setara, tidak pernah pola
      .maybeSingle<{ alamat: string }>(),
  ]);

  // Label dirangkai lewat `labelVarian()` — SATU-SATUNYA perangkai label
  // varian di proyek ini — supaya pilihan di wizard klien terbaca sama persis
  // dengan yang admin dan landing tampilkan untuk varian yang sama.
  const varianTampil = (varian ?? []).map((v) => ({
    id: v.id,
    serviceId: v.service_id,
    label: labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format }),
  }));

  // `min` hanyalah kenyamanan pemakai — penolakan tanggal lampau yang sungguh
  // mengikat ada di server action dan di trigger basis data. Atribut HTML bisa
  // dihapus siapa saja lewat devtools.
  return (
    <FormAjukan
      layanan={(layanan ?? []) as Array<{ id: string; nama: string }>}
      varian={varianTampil}
      jamPilihan={jamLayanan}
      tanggalPalingAwal={hariIniJakarta()}
      alamatDefault={profil?.alamat ?? ""}
    />
  );
}
