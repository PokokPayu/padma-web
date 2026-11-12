"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aktifkanProduk, nonaktifkanProduk, perbaruiProduk, simpanProduk } from "./aksi";
import { labelMasaBerlaku } from "@/lib/produk/status";
import type { ProdukKelola } from "@/lib/admin/produk-admin";
import { formatRupiah } from "@/lib/rupiah-publik";

const KELAS_MEDAN =
  "mt-1 min-h-[38px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px]";
const KELAS_LABEL = "block text-[12px] font-bold text-panel-muted";

export type ProdukForm = ProdukKelola;

/**
 * Satu formulir untuk membuat DAN mengubah — pola yang sama dengan
 * `admin/mitra/form-mitra.tsx`.
 *
 * Harga TIDAK PERNAH punya medan input di sini: `digital_product_prices`
 * adalah wilayah owner (Task 7), RLS-nya sendiri menolak admin menulis, dan
 * memberi medan yang akan selalu gagal hanya membingungkan. Yang tampil
 * hanyalah harga yang SUDAH ditetapkan, dibaca lewat `produk_harga_staf`.
 */
export function FormProduk({
  produk,
  hrefTutup,
}: {
  /** `null` berarti produk baru. */
  produk: ProdukForm | null;
  hrefTutup: string;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = produk ? await perbaruiProduk(produk.id, fd) : await simpanProduk(fd);
          if (r.ok) {
            setPesan(null);
            router.push(hrefTutup);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="grid gap-3"
    >
      <label>
        <span className={KELAS_LABEL}>Judul</span>
        <input
          name="judul"
          type="text"
          required
          minLength={2}
          defaultValue={produk?.judul ?? ""}
          placeholder="mis. Panduan MPASI 6 Bulan"
          className={KELAS_MEDAN}
        />
      </label>
      <label>
        <span className={KELAS_LABEL}>Alamat (slug)</span>
        <input
          name="slug"
          type="text"
          defaultValue={produk?.slug ?? ""}
          placeholder="Kosongkan untuk diturunkan otomatis dari judul"
          className={KELAS_MEDAN}
        />
        <span className="mt-1 block text-[11px] text-panel-muted/70">
          Muncul di alamat publik <code>/produk/&lt;alamat&gt;</code>. Huruf kecil, angka, dan
          tanda hubung saja.
        </span>
      </label>
      <label>
        <span className={KELAS_LABEL}>Deskripsi</span>
        <textarea
          name="deskripsi"
          rows={3}
          defaultValue={produk?.deskripsi ?? ""}
          placeholder="Deskripsi singkat produk"
          className={KELAS_MEDAN}
        />
      </label>
      {produk && (
        <label>
          <span className={KELAS_LABEL}>Urutan tampil</span>
          <input
            name="urutan"
            type="number"
            step={1}
            defaultValue={produk.urutan}
            className={KELAS_MEDAN}
          />
        </label>
      )}

      {produk && (
        <div className="rounded-lg border border-panel-border bg-panel-bg p-3">
          <span className={KELAS_LABEL}>Harga</span>
          {/* Angka ini TAMPIL saja — ditetapkan owner lewat panel Owner
              (Task 7), tidak pernah lewat formulir ini. */}
          <p className="mt-1 text-[13px] text-panel-ink">
            {produk.harga === null ? (
              "Belum ditetapkan owner."
            ) : (
              <>
                <b>{formatRupiah(produk.harga)}</b>
                {produk.hargaCoret !== null && (
                  <span className="ml-2 text-panel-muted line-through">
                    {formatRupiah(produk.hargaCoret)}
                  </span>
                )}
              </>
            )}
          </p>
          <p className="mt-1 text-[11px] text-panel-muted/70">
            Harga hanya bisa ditetapkan owner. Panel ini hanya menampilkannya.
          </p>
          <p className="mt-2 text-[13px] text-panel-ink">
            Masa berlaku: <b>{labelMasaBerlaku(produk.masaBerlakuBulan)}</b>
          </p>
        </div>
      )}

      {pesan && <p className="text-[12.5px] font-semibold text-clay">{pesan}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-panel-ink px-4 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        {/* Dua action terpisah, bukan satu action bernilai `!aktif`: keadaan
            tujuan tidak pernah menyeberang batas server sebagai data. */}
        {produk && (
          <button
            type="button"
            disabled={pending || (!produk.aktif && !produk.adaIsi)}
            title={
              !produk.aktif && !produk.adaIsi
                ? "Lengkapi isinya dulu: minimal satu materi, dan setiap materi sudah diunggah."
                : undefined
            }
            onClick={() =>
              mulai(async () => {
                const r = produk.aktif
                  ? await nonaktifkanProduk(produk.id)
                  : await aktifkanProduk(produk.id);
                if (r.ok) router.push(hrefTutup);
                else setPesan(r.pesan);
              })
            }
            className="rounded-lg border border-panel-border px-4 py-2 text-[12.5px] font-bold text-panel-ink disabled:opacity-60"
          >
            {produk.aktif ? "Nonaktifkan" : "Tayangkan"}
          </button>
        )}
      </div>

      {produk && !produk.adaIsi && (
        <p className="text-[11.5px] italic text-panel-muted">
          Isi belum lengkap — produk ini belum bisa ditayangkan.
        </p>
      )}
    </form>
  );
}
