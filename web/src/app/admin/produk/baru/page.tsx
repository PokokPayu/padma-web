import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { FormProduk } from "../form-produk";

export const metadata = { title: "Produk baru" };

/**
 * Rute berdiri sendiri, bukan formulir di header daftar — pola
 * `/admin/klien/baru`. Produk lahir NONAKTIF dan tanpa berkas: memberi
 * formulir yang selalu terbuka di header daftar mendorong admin mengisi
 * judul lalu lupa mengunggah isinya, sementara halaman berdiri sendiri
 * membuat "buat produk baru" jadi langkah sadar yang berujung menuju
 * "unggah isinya" (Task 6).
 */
export default async function ProdukBaruPage() {
  await requireRole(["admin", "owner"]);

  return (
    <main className="max-w-2xl">
      <Link href="/admin/produk" className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Produk Digital
      </Link>
      <h1 className="mb-4 mt-2 text-[18px] font-bold text-panel-ink">Produk baru</h1>
      <FormProduk produk={null} hrefTutup="/admin/produk" />
    </main>
  );
}
