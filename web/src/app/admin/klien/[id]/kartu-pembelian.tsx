import { bacaPenjualan } from "@/lib/penjualan/baca";
import { urutkanBaris, type BarisPenjualan } from "@/lib/penjualan/hitung";
import { TabelPenjualan } from "@/app/admin/penjualan/tabel-penjualan";
import { notaTampil } from "@/app/admin/penjualan/ringkas";

/**
 * Bagian MURNI — dipisah dari pengambilan datanya supaya bisa dirender di
 * uji tanpa Supabase. `KartuPembelian` di bawah yang melakukan IO-nya.
 */
export function BagianPembelian({ baris }: { baris: readonly BarisPenjualan[] }) {
  return (
    <section
      data-bagian="riwayat-pembelian"
      className="rounded-lg border border-panel-border bg-panel-surface p-5 lg:col-span-2"
    >
      <h2 className="mb-3 font-serif text-lg text-panel-ink">Riwayat pembelian</h2>
      {baris.length === 0 ? (
        <p data-kosong className="text-[13px] italic text-panel-muted">
          Belum ada pembelian produk digital.
        </p>
      ) : (
        <TabelPenjualan baris={baris} />
      )}
    </section>
  );
}

/**
 * Riwayat pembelian satu klien — TANPA batas periode.
 *
 * Batasnya datang dari kliennya sendiri: seorang klien punya puluhan
 * pembelian, bukan puluhan ribu. Inilah layar yang dibuka admin saat sedang
 * menelepon klien, dan menyaringnya per bulan di sana akan membuat
 * pertanyaan "saya sudah pernah beli ini belum" butuh tiga klik.
 */
export async function KartuPembelian({ clientId }: { clientId: string }) {
  const { baris } = await bacaPenjualan({ clientId });
  // `notaTampil` DULU, sebelum pengurutan dan sebelum perenderan. Judul
  // bagian ini adalah "Riwayat pembelian"; checkout yang ditinggalkan klien
  // lalu kedaluwarsa bukan pembelian, dan di bawah judul itu ia terbaca
  // sebagai pembelian yang sudah dibayar. Alasan lengkapnya ada di
  // `notaTampil` (`@/app/admin/penjualan/ringkas`).
  return <BagianPembelian baris={urutkanBaris(notaTampil(baris))} />;
}
