import { createPublikSupabase } from "@/lib/supabase/publik";
import { uraiIsi, type IsiArtikel } from "./urai";

// Pembacaan artikel untuk situs publik. RLS (`articles: baca publik`) hanya
// membuka baris `terbit`, jadi filter `.eq("terbit", true)` di sini sekadar
// memperjelas — draf tidak bisa bocor walau filternya terhapus.

type Baris = { slug: string; judul: string; kategori: string; isi: string; diterbitkan_pada: string };

export type RingkasArtikel = {
  slug: string;
  judul: string;
  kategori: string;
  ringkasan: string;
  menitBaca: number;
  diterbitkanPada: string;
};

export type ArtikelPenuh = Omit<RingkasArtikel, "ringkasan" | "menitBaca"> & { isi: IsiArtikel };

export async function daftarArtikelTerbit(): Promise<RingkasArtikel[]> {
  const { data, error } = await createPublikSupabase()
    .from("articles")
    .select("slug, judul, kategori, isi, diterbitkan_pada")
    .eq("terbit", true)
    .order("diterbitkan_pada", { ascending: false })
    .returns<Baris[]>();
  if (error) throw new Error(`Gagal membaca artikel: ${error.message}`);
  return (data ?? []).map((b) => {
    const isi = uraiIsi(b.isi);
    return {
      slug: b.slug,
      judul: b.judul,
      kategori: b.kategori,
      ringkasan: isi.ringkasan,
      menitBaca: isi.menitBaca,
      diterbitkanPada: b.diterbitkan_pada,
    };
  });
}

export async function artikelTerbit(slug: string): Promise<ArtikelPenuh | null> {
  const { data, error } = await createPublikSupabase()
    .from("articles")
    .select("slug, judul, kategori, isi, diterbitkan_pada")
    .eq("terbit", true)
    .eq("slug", slug)
    .maybeSingle<Baris>();
  if (error) throw new Error(`Gagal membaca artikel: ${error.message}`);
  if (!data) return null;
  return {
    slug: data.slug,
    judul: data.judul,
    kategori: data.kategori,
    diterbitkanPada: data.diterbitkan_pada,
    isi: uraiIsi(data.isi),
  };
}
