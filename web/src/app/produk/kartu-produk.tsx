import Link from "next/link";
import type { ProdukPublik } from "@/lib/produk/katalog";
import { LABEL_JENIS } from "@/lib/produk/status";
import { formatRupiah } from "@/lib/rupiah-publik";

// `formatRupiah` DIIMPOR DARI `@/lib/rupiah-publik`, BUKAN `@/lib/owner/rupiah`
// — berkas itu sendiri menandai dirinya "hanya untuk panel owner", dan pagar
// money-firewall memindai identifier `formatRupiah` di sumber admin/panel.
// Komponen ini hidup di etalase PUBLIK, jadi ia memakai modul netral yang
// sama seperti `_landing/lini-layanan.tsx`.
//
// Tanpa layout apa pun yang mengasumsikan storefront: Task 11 mengimpornya
// lagi untuk bagian landing, jadi kartu ini tidak boleh bergantung pada grid
// atau lebar kolom milik `/produk`.

/**
 * Tiga keadaan harga, dan HANYA di sini logikanya hidup — Task 11 memakai
 * ulang komponen ini, bukan menulis ulang cabangnya:
 *   * `null`  → owner belum menetapkan harga sama sekali; tanpa tombol beli.
 *   * `0`     → GRATIS, badge tersendiri.
 *   * `> 0`   → harga normal, dengan harga coret (bila ada) di sebelahnya.
 */
function HargaKartu({ harga, hargaCoret }: { harga: number | null; hargaCoret: number | null }) {
  if (harga === null) {
    return <p className="mt-auto text-[13px] text-ink-soft">Harga segera diumumkan</p>;
  }
  if (harga === 0) {
    return (
      <p className="mt-auto flex items-center gap-2">
        <span className="rounded-full bg-leaf-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-leaf">
          Gratis
        </span>
        {/* Bukan `<button>`: klaim sungguhan belum ada (Task 9), dan seluruh
            kartu sudah berupa `<Link>` menuju halaman produk — teks ini
            sekadar penanda ajakan, bukan aksi yang berjalan sendiri. */}
        <span className="text-[12px] font-bold text-leaf underline underline-offset-2">
          Ambil gratis
        </span>
      </p>
    );
  }
  return (
    <p className="mt-auto flex flex-wrap items-baseline gap-x-1.5">
      <span className="font-bold text-night">{formatRupiah(harga)}</span>
      {hargaCoret !== null && (
        <s className="text-[12px] text-ink-soft/70">{formatRupiah(hargaCoret)}</s>
      )}
    </p>
  );
}

export function KartuProduk({ produk }: { produk: ProdukPublik }) {
  const sampulUrl = produk.sampulObjek
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/produk-sampul/${produk.sampulObjek}`
    : null;

  return (
    <Link
      href={`/produk/${produk.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-black/10 bg-white transition hover:-translate-y-1 hover:border-gold/30 hover:shadow-lg"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-paper">
        {sampulUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- sampul datang dari bucket publik, bukan aset build.
          <img src={sampulUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[13px] text-ink-soft">
            {LABEL_JENIS[produk.jenis]}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
            {LABEL_JENIS[produk.jenis]}
          </span>
          {produk.bolehUnduh && (
            <span className="rounded-full bg-leaf-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-leaf">
              Bisa diunduh
            </span>
          )}
        </div>
        <h3 className="font-serif text-lg text-night">{produk.judul}</h3>
        <HargaKartu harga={produk.harga} hargaCoret={produk.hargaCoret} />
      </div>
    </Link>
  );
}
