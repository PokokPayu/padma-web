import Link from "next/link";
import { formatRupiah } from "@/lib/owner/rupiah";
import { labelBulan } from "@/lib/penjualan/bulan";
import type { PenjualanBulan, Pengecualian } from "@/lib/penjualan/hitung";

/**
 * Kalimat untuk tiap kelompok pengecualian.
 *
 * Bertipe `Record<Pengecualian["golongan"], string>` — BUKAN objek biasa.
 * Tanpa anotasi itu, nilai golongan baru yang kelak lahir akan memulangkan
 * `undefined` di sini tanpa satu pun galat, dan kotaknya akan mencetak
 * "undefined" di sebelah sebuah nominal.
 */
const KALIMAT: Record<Pengecualian["golongan"], string> = {
  ditahan: "ditahan DOKU — uangnya belum di PADMA",
  lewat_tenggat: "dibayar sesudah pesanannya ditutup",
  dikembalikan: "uangnya sudah dikembalikan",
};

/**
 * Satu kartu bulan — bentuk yang sama dengan `KartuPekan` di `/owner/rekap`.
 *
 * `data-bulan` membawa kunci bulannya. Ia bukan hiasan: seluruh nominal di
 * halaman ini tampak serupa antar bulan, dan tanpa penanda itu sebuah
 * assertion (atau seorang pembaca) bisa membaca angka bulan lain sebagai
 * angka bulan yang sedang dilihatnya.
 */
export function KartuBulan({ bulan }: { bulan: PenjualanBulan }) {
  return (
    <article
      data-bulan={bulan.bulan}
      className="mb-3.5 rounded-lg border border-panel-border bg-panel-surface px-5 py-5"
    >
      <h3 className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="text-[14px] font-bold text-panel-ink">{labelBulan(bulan.bulan)}</span>
        <span className="rounded-full border border-panel-border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider text-panel-muted">
          {`${bulan.jumlahPembelian} pembelian`}
        </span>
      </h3>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[12.5px] font-bold text-panel-muted">Omzet</span>
        <span className="font-mono text-[15px] text-leaf">{formatRupiah(bulan.omzet)}</span>
      </div>

      {bulan.perProduk.length === 0 ? (
        <p className="text-[11.5px] italic text-panel-muted">
          Belum ada produk terjual bulan ini.
        </p>
      ) : (
        <ul className="border-t border-panel-border pt-3">
          {bulan.perProduk.map((p) => (
            <li
              key={p.kunci}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1"
            >
              <span className="text-[12.5px] text-panel-ink">
                {p.judul}{" "}
                <span className="text-[11px] text-panel-muted">{`× ${p.banyak}`}</span>
              </span>
              <span className="font-mono text-[12.5px] text-panel-ink">
                {formatRupiah(p.nilai)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {bulan.pengecualian.length > 0 && (
        <div data-pengecualian="1" className="mt-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3">
          <b className="block text-[12px] text-clay">
            Perlu ditinjau — nilainya TIDAK ikut dihitung di omzet di atas.
          </b>
          <ul className="mt-1.5">
            {bulan.pengecualian.map((p) => (
              <li key={p.golongan} className="text-[11.5px] leading-relaxed text-panel-muted">
                <span className="font-semibold text-panel-ink">
                  {`${p.banyak} pesanan ${formatRupiah(p.nilai)}`}
                </span>
                {` — ${KALIMAT[p.golongan]}`}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11.5px] text-panel-muted">
            Diselesaikan di{" "}
            <Link href="/admin/pesanan" className="font-semibold text-leaf underline">
              /admin/pesanan
            </Link>
            , bukan di halaman ini.
          </p>
        </div>
      )}
    </article>
  );
}
