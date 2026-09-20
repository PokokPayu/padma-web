import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilProduk } from "@/lib/admin/produk-admin";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormProduk } from "../form-produk";
import { LABEL_JENIS } from "@/lib/produk/status";
import {
  PengunggahVideoProduk, PengunggahPdfProduk, LepasIsiProduk,
} from "./pengunggah-produk";

export const metadata = { title: "Detail produk" };

const BASIS = "/admin/produk";

function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Tayang" : "Nonaktif"}
    </span>
  );
}

type Pembeli = { nama: string; diberikanPada: string; sumber: string };

const LABEL_SUMBER: Record<string, string> = {
  beli: "Beli",
  gratis: "Gratis",
  pemberian_admin: "Pemberian admin",
};

/**
 * Daftar pembeli — entitlement AKTIF (belum dicabut) atas produk ini, dengan
 * nama klien lewat join manual (sama alasan dengan `ambilDaftarProduk`:
 * `digital_entitlements` bukan tabel yang embed-nya PostgREST bisa tautkan
 * lewat FK bila kita hanya butuh satu kolom nama, jadi ditulis eksplisit).
 */
async function daftarPembeli(productId: string): Promise<Pembeli[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_entitlements")
    .select("diberikan_pada, sumber, clients(nama)")
    .eq("product_id", productId)
    .is("dicabut_pada", null)
    .order("diberikan_pada", { ascending: false })
    .returns<Array<{ diberikan_pada: string; sumber: string; clients: { nama: string } | null }>>();
  if (error) throw new Error(`Gagal membaca daftar pembeli: ${error.message}`);

  return (data ?? []).map((b) => ({
    nama: b.clients?.nama ?? "(klien tidak ditemukan)",
    diberikanPada: b.diberikan_pada,
    sumber: LABEL_SUMBER[b.sumber] ?? b.sumber,
  }));
}

/**
 * Jumlah halaman PDF terasterisasi — MURNI untuk teks tampilan ("N halaman
 * tersimpan"), bukan untuk memutuskan "punya isi".
 *
 * `produk.adaIsi` (`ambilProduk`, `@/lib/admin/produk-admin.ts`) sudah
 * JENIS-SADAR lewat predikat bersama `punyaIsi` (`@/lib/produk/status`) —
 * dipakai UTUH di bawah, bukan dihitung ulang di sini. Dua salinan "punya
 * isi" adalah dua tempat yang bisa berbeda begitu salah satunya disunting;
 * lihat komentar `punyaIsi` untuk cerita lengkapnya (produk PDF tanpa
 * unduhan yang dulu terkunci permanen di panel admin).
 */
async function jumlahHalamanProduk(productId: string): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("digital_product_pages")
    .select("halaman", { count: "exact", head: true })
    .eq("product_id", productId);
  if (error) throw new Error(`Gagal membaca jumlah halaman: ${error.message}`);
  return count ?? 0;
}

export default async function DetailProdukPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "owner"]);

  const { id } = await params;

  const produk = await ambilProduk(id);
  // `notFound()`, bukan halaman kosong: URL yang salah ketik harus menjawab
  // 404, bukan 200 berisi kerangka tanpa isi.
  if (!produk) notFound();

  const [pembeli, jumlahHalaman] = await Promise.all([
    daftarPembeli(id),
    produk.jenis === "pdf" ? jumlahHalamanProduk(id) : Promise.resolve(0),
  ]);

  return (
    <main>
      <Link href={BASIS} className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Produk Digital
      </Link>

      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-panel-ink">{produk.judul}</h1>
          <p className="mt-0.5 text-[12.5px] text-panel-muted">
            {produk.deskripsi || "Belum ada deskripsi."}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-panel-border px-2.5 py-1 text-[11px] font-extrabold text-panel-ink">
            {LABEL_JENIS[produk.jenis]}
          </span>
          <PillAktif aktif={produk.aktif} />
        </span>
      </header>

      <div className="grid gap-3">
        <Kartu judul="Data produk">
          <FormProduk produk={produk} hrefTutup={`${BASIS}/${id}`} />
        </Kartu>

        <Kartu judul="Isi">
          {produk.jenis === "video" ? (
            <div className="rounded-xl border border-black/10 bg-paper p-3">
              <p className="text-[13px] text-ink">
                {produk.adaIsi ? "Video tersimpan." : "Belum ada video — unggah di bawah."}
              </p>
              <PengunggahVideoProduk productId={id} />
              {!produk.aktif && produk.adaIsi && <LepasIsiProduk productId={id} />}
            </div>
          ) : (
            <div className="rounded-xl border border-black/10 bg-paper p-3">
              <p className="text-[13px] text-ink">
                {produk.adaIsi
                  ? `${jumlahHalaman} halaman tersimpan.`
                  : "Belum ada halaman — unggah PDF-nya di bawah."}
              </p>
              <PengunggahPdfProduk productId={id} bolehUnduh={produk.bolehUnduh} />
              {!produk.aktif && produk.adaIsi && <LepasIsiProduk productId={id} />}
            </div>
          )}
        </Kartu>

        <Kartu judul="Pembeli">
          {pembeli.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">
              Belum ada yang memiliki akses produk ini.
            </p>
          ) : (
            <Tabel label="Daftar pembeli">
              <thead>
                <tr>
                  <Th>Klien</Th>
                  <Th>Tanggal</Th>
                  <Th>Sumber</Th>
                </tr>
              </thead>
              <tbody>
                {pembeli.map((b, i) => (
                  <tr key={i}>
                    <Td>{b.nama}</Td>
                    <Td className="font-mono text-[12.5px]">
                      {new Date(b.diberikanPada).toLocaleDateString("id-ID")}
                    </Td>
                    <Td>{b.sumber}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>
      </div>
    </main>
  );
}
