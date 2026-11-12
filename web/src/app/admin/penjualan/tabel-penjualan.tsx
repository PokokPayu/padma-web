import { formatRupiah } from "@/lib/rupiah-publik";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { stempelTanggalJakarta } from "@/lib/penjualan/bulan";
import { golongkan, tanggalUang, type BarisPenjualan } from "@/lib/penjualan/hitung";

/**
 * Daftar nota penjualan, SATU BARIS PER ITEM.
 *
 * Keranjang P2 membuat satu pesanan bisa memuat beberapa produk. Satu baris
 * per pesanan akan menyembunyikan produk kedua dan ketiga dari daftar yang
 * tujuannya justru memperlihatkan apa yang terjual.
 *
 * `formatRupiah` diimpor dari `@/lib/rupiah-publik`, BUKAN dari
 * `@/lib/owner/rupiah` — jalur kedua adalah pintu wilayah owner, dan
 * mengimpornya dari `src/app/admin/**` menyalahi batas yang sengaja dipasang.
 * Preseden yang sama dipakai `src/app/admin/pesanan/tabel-pesanan.tsx`.
 */
const CATATAN: Partial<Record<ReturnType<typeof golongkan>, string>> = {
  dikembalikan: "uangnya dikembalikan",
  ditahan: "ditahan DOKU",
  lewat_tenggat: "dibayar lewat tenggat",
};

export function TabelPenjualan({ baris }: { baris: readonly BarisPenjualan[] }) {
  if (baris.length === 0) {
    return (
      <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
        Belum ada penjualan pada periode ini.
      </p>
    );
  }

  return (
    <Tabel label="Daftar penjualan produk digital">
      <thead>
        <tr>
          <Th>Tanggal</Th>
          <Th>Kode</Th>
          <Th>Klien</Th>
          <Th>Produk</Th>
          <Th className="text-right">Nominal</Th>
          <Th>Catatan</Th>
        </tr>
      </thead>
      <tbody>
        {baris.map((b) => {
          const tanggal = tanggalUang(b);
          const catatan = CATATAN[golongkan(b)] ?? "";
          // "" BERARTI embed-nya tidak terbaca, bukan "klien tanpa nama".
          // Sel kosong terbaca sebagai pernyataan tentang data yang
          // sebenarnya tidak kita miliki.
          const klien =
            b.padmaId === "" && b.namaKlien === "" ? null : `${b.padmaId} · ${b.namaKlien}`;

          // null KETIKA ITEMNYA TIDAK TERBACA — bukan nol rupiah. Pesanan
          // tanpa item terbaca tetap dapat SATU baris, supaya ia tidak lenyap
          // dari daftar tanpa jejak.
          if (b.item === null || b.item.length === 0) {
            return (
              <tr key={b.pesananId} data-pesanan={b.pesananId}>
                <Td>{tanggal === null ? "—" : stempelTanggalJakarta(tanggal)}</Td>
                <Td className="font-mono text-[11.5px]">{b.kode}</Td>
                <Td>{klien ?? <i className="text-clay">tidak terbaca</i>}</Td>
                <Td>
                  <i className="text-clay">Item tidak terbaca</i>
                </Td>
                <Td className="text-right">—</Td>
                <Td>{catatan}</Td>
              </tr>
            );
          }

          return b.item.map((i) => (
            <tr key={`${b.pesananId}-${i.urutan}`} data-pesanan={b.pesananId}>
              <Td>{tanggal === null ? "—" : stempelTanggalJakarta(tanggal)}</Td>
              <Td className="font-mono text-[11.5px]">{b.kode}</Td>
              <Td>{klien ?? <i className="text-clay">tidak terbaca</i>}</Td>
              <Td>{i.judulBeku}</Td>
              <Td className="text-right font-mono">{formatRupiah(i.hargaBeku)}</Td>
              <Td>{catatan}</Td>
            </tr>
          ));
        })}
      </tbody>
    </Tabel>
  );
}
