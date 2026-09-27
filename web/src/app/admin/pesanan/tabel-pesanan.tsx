import { formatRupiah } from "@/lib/rupiah-publik";
import { LABEL_STATUS_PESANAN, type StatusPesanan } from "@/lib/pesanan/status";
import type { BarisPesanan } from "@/lib/admin/pesanan";
import { TombolPesanan } from "./tombol-pesanan";

/**
 * Tabel pesanan staf — satu-satunya permukaan admin PADMA yang menampilkan
 * nominal PESANAN (yang ditagih dan yang diterima), dan satu-satunya tempat di
 * seluruh aplikasi dua angka uang perlu dibaca BERDAMPINGAN.
 *
 * Bukan satu-satunya layar admin bernominal, dan klaim itu sengaja tidak
 * ditulis: `/admin/produk` sudah menampilkan harga hari ini (README.md:134,
 * "harga TAMPIL tapi tidak bisa disunting admin"), dan empat berkas di
 * `src/app/admin/**` sudah mengimpor `formatRupiah`. Yang baru di sini adalah
 * nominal PESANAN — uang yang benar-benar berpindah — bukan nominal apa pun.
 *
 * `formatRupiah` diimpor dari `@/lib/rupiah-publik` dan itu memang ganjil
 * dibaca sekilas di bawah `src/app/admin/**` — lihat dokblok berkas itu.
 * Keganjilannya disengaja dan dicatat di sini: pengecualian ini adalah
 * keputusan pemilik repo (spec 26 Sep 2026, "Catatan: nominal di layar staf"),
 * dan ia dijaga uji yang assertionnya KEBALIKAN konvensi rumah
 * (`tests/admin-pesanan.test.tsx`). Yang TIDAK berubah: honor mitra tidak
 * pernah lewat sini, dan `orders` sendiri lahir nol kolom nominal.
 *
 * Komponen SERVER: ia tidak mengoper satu pun prop berisi fungsi
 * (`tests/pagar-batas-server-klien.test.ts`). Yang interaktif hidup utuh di
 * `TombolPesanan`.
 */
const KELAS_PILL: Record<StatusPesanan, string> = {
  menunggu_bayar: "bg-[#F7EDD3] text-[#8A6A1B]",
  // Merah bata, sama dengan "belum dibayar" di modul bayar: `ditahan` berarti
  // uang masuk tapi barang belum keluar — keadaan paling mendesak di tabel ini.
  ditahan: "bg-clay/10 text-clay",
  lunas: "bg-leaf-soft text-leaf",
  kedaluwarsa: "bg-panel-bg text-panel-muted",
  dibatalkan: "bg-panel-bg text-panel-muted",
};

export function TabelPesanan({ baris }: { baris: BarisPesanan[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-panel-border bg-panel-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-panel-border bg-panel-bg text-[11px] uppercase tracking-wider text-panel-muted">
              <th className="p-4 text-left font-extrabold">Pesanan</th>
              <th className="p-4 text-left font-extrabold">Item</th>
              <th className="p-4 text-left font-extrabold">Status</th>
              <th className="p-4 text-left font-extrabold">Nominal</th>
              <th className="p-4 text-left font-extrabold">Tindakan</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((p) => (
              <tr
                key={p.id}
                data-pesanan={p.kode}
                data-status={p.status}
                className="border-b border-panel-border/70 align-top"
              >
                <td className="p-4">
                  <b className="font-mono text-[12.5px]">{p.kode}</b>
                  {p.padmaId === "" ? (
                    // Embed PostgREST yang ditolak RLS memulangkan null, bukan
                    // galat. Sel kosong akan terbaca sebagai "klien ini memang
                    // tidak punya PADMA ID" — kalimat yang berbeda, dan yang
                    // menuntut tindakan berbeda.
                    <span className="mt-0.5 block text-[11px] font-bold text-clay">
                      PADMA ID tidak terbaca
                    </span>
                  ) : (
                    <span className="mt-0.5 block font-mono text-[11px] text-panel-muted">
                      {p.padmaId}
                    </span>
                  )}
                  {p.percobaan > 1 && (
                    <span className="mt-0.5 block text-[11px] text-panel-muted">
                      Percobaan ke-{p.percobaan}
                    </span>
                  )}
                </td>

                <td className="p-4">
                  {p.items.map((i) => (
                    <span key={`${i.pesananId}-${i.urutan}`} className="block">
                      {i.judulBeku}
                      <span className="ml-1.5 text-[11.5px] text-panel-muted">
                        {formatRupiah(i.hargaBeku)}
                      </span>
                    </span>
                  ))}
                  {p.items.length === 0 && (
                    <span className="text-[11.5px] italic text-clay">Item tidak terbaca</span>
                  )}
                </td>

                <td className="p-4">
                  <span
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ${KELAS_PILL[p.status]}`}
                  >
                    {LABEL_STATUS_PESANAN[p.status]}
                  </span>
                  {p.sebabTinjauan && (
                    <span className="mt-1 block font-mono text-[11px] font-bold text-clay">
                      {p.sebabTinjauan}
                    </span>
                  )}
                  {p.kanal && (
                    <span className="mt-0.5 block text-[11px] text-panel-muted">{p.kanal}</span>
                  )}
                </td>

                <td className="p-4">
                  <span className="block font-bold">{formatRupiah(p.nominalTagih)}</span>
                  <span className="text-[11px] text-panel-muted">Ditagih</span>
                  {p.nominalDiterima !== null && (
                    // BERDAMPINGAN, bukan menggantikan: selisih kedua angka
                    // inilah yang menjadi keputusan manusia pada baris
                    // `ditahan`. Tanpa keduanya, staf tetap harus membuka
                    // dashboard Midtrans untuk tahu berapa yang benar-benar
                    // masuk.
                    <>
                      <span className="mt-1 block font-bold text-clay">
                        {formatRupiah(p.nominalDiterima)}
                      </span>
                      <span className="text-[11px] text-panel-muted">Diterima</span>
                    </>
                  )}
                </td>

                <td className="p-4">
                  <TombolPesanan
                    pesananId={p.id}
                    status={p.status}
                    butuhTinjauan={p.butuhTinjauanPada !== null}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
