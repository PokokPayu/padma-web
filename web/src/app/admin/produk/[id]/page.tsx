import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilProduk, ambilIsiProduk } from "@/lib/admin/produk-admin";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormProduk } from "../form-produk";
import { ringkasJumlahMateri, statusAkses, formatTanggalAkses } from "@/lib/produk/status";
import { PengunggahSampul } from "./pengunggah-sampul";
import { EditorIsi } from "./editor-isi";

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

type Pembeli = { nama: string; diberikanPada: string; sumber: string; berlaku: string };

const LABEL_SUMBER: Record<string, string> = {
  beli: "Beli",
  gratis: "Gratis",
  pemberian_admin: "Pemberian admin",
};

async function daftarPembeli(productId: string): Promise<Pembeli[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_entitlements")
    .select("diberikan_pada, sumber, berlaku_sampai, clients(nama)")
    .eq("product_id", productId)
    .is("dicabut_pada", null)
    .order("diberikan_pada", { ascending: false })
    .returns<Array<{
      diberikan_pada: string;
      sumber: string;
      berlaku_sampai: string | null;
      clients: { nama: string } | null;
    }>>();
  if (error) throw new Error(`Gagal membaca daftar pembeli: ${error.message}`);

  return (data ?? []).map((b) => {
    const s = statusAkses(b.berlaku_sampai);
    return {
      nama: b.clients?.nama ?? "(klien tidak ditemukan)",
      diberikanPada: b.diberikan_pada,
      sumber: LABEL_SUMBER[b.sumber] ?? b.sumber,
      berlaku:
        s.keadaan === "selamanya" ? "Selamanya"
        : s.keadaan === "aktif" ? `s.d. ${formatTanggalAkses(s.sampai)}`
        : `Habis ${formatTanggalAkses(s.sampai)}`,
    };
  });
}

export default async function DetailProdukPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const produk = await ambilProduk(id);
  if (!produk) notFound();

  const [pembeli, bab] = await Promise.all([daftarPembeli(id), ambilIsiProduk(id)]);

  return (
    <main>
      <Link href={BASIS} className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Produk Digital
      </Link>

      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-panel-ink">{produk.judul}</h1>
          <p className="mt-0.5 text-[12.5px] text-panel-muted">
            {ringkasJumlahMateri(produk.jenisMateri) || "Belum ada materi."}
          </p>
        </div>
        <PillAktif aktif={produk.aktif} />
      </header>

      <div className="grid gap-3">
        <Kartu judul="Data produk">
          <div className="grid gap-4">
            <PengunggahSampul productId={id} materiId={null} sampulObjek={produk.sampulObjek} />
            <FormProduk produk={produk} hrefTutup={`${BASIS}/${id}`} />
          </div>
        </Kartu>

        <Kartu judul="Bab & materi">
          <EditorIsi productId={id} produkAktif={produk.aktif} bab={bab} />
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
                  <Th>Masa berlaku</Th>
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
                    <Td>{b.berlaku}</Td>
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
