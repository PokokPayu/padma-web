import { urutkanBaris, type BarisPenjualan } from "@/lib/penjualan/hitung";
import { TabelPenjualan } from "@/app/admin/penjualan/tabel-penjualan";
import { notaTampil } from "@/app/admin/penjualan/ringkas";

/**
 * Bagian MURNI — IO-nya milik halaman (`../page.tsx`), yang memanggil
 * `bacaPenjualan({ clientId })` lalu `barisRiwayatPembelian`.
 *
 * Sengaja TIDAK ada komponen server async di berkas ini. Halaman detail klien
 * dirender di uji lewat `renderToStaticMarkup`, yang menolak komponen yang
 * suspend ("A component suspended while responding to synchronous input").
 * Next produksi menerimanya, jadi build hijau sementara enam uji halaman
 * merah — pola repo: halaman memuat, komponen murni.
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
 * Baris riwayat pembelian satu klien, siap render. Tanpa batas periode —
 * alasannya di pemanggilan `bacaPenjualan` di `../page.tsx`.
 */
export function barisRiwayatPembelian(baris: readonly BarisPenjualan[]): BarisPenjualan[] {
  // `notaTampil` DULU, sebelum pengurutan dan sebelum perenderan. Judul
  // bagian ini adalah "Riwayat pembelian"; checkout yang ditinggalkan klien
  // lalu kedaluwarsa bukan pembelian, dan di bawah judul itu ia terbaca
  // sebagai pembelian yang sudah dibayar. Alasan lengkapnya ada di
  // `notaTampil` (`@/app/admin/penjualan/ringkas`).
  return urutkanBaris(notaTampil(baris));
}
