"use client";

import { useRef, useState, useTransition } from "react";
import { tetapkanHargaProduk } from "./aksi";
import { HARGA_MAKS } from "@/lib/produk/status";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px] text-panel-ink";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-muted disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60";

/**
 * Formulir "Tetapkan harga baru" untuk SATU produk digital.
 *
 * Meniru `src/app/owner/tarif/form-tarif.tsx` persis: medan terisi nilai
 * berjalan supaya menaikkan harga tetap terasa seperti menyunting, padahal
 * yang tersimpan selalu satu baris BARU bertanggal berlaku — harga lama
 * tidak pernah ditimpa maupun dihapus (basis data menolak UPDATE dan DELETE
 * atas `digital_product_prices` untuk siapa pun, termasuk owner).
 *
 * Tidak ada honor mitra di sini: produk digital tidak punya mitra yang
 * dibayar per unit terjual.
 */
export function FormHargaProduk({
  productId,
  judul,
  hariIni,
  hargaSekarang,
  hargaCoretSekarang,
}: {
  productId: string;
  judul: string;
  /** Hari ini menurut kalender Jakarta — dihitung di server, bukan di browser. */
  hariIni: string;
  hargaSekarang: number | null;
  hargaCoretSekarang: number | null;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [sukses, setSukses] = useState(false);
  const hargaRef = useRef<HTMLInputElement>(null);
  const coretRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await tetapkanHargaProduk(fd);
          if (r.ok) {
            setPesan(null);
            setSukses(true);
          } else {
            setSukses(false);
            setPesan(r.pesan);
          }
        })
      }
      className="grid w-full gap-2.5"
    >
      {/* `produk` terikat pada baris yang sedang dibuka — harga tidak pernah
          bisa mendarat di produk lain lewat satu medan yang ditulis ulang di
          DevTools tanpa pemilik menyadarinya. Server tetap memeriksanya ulang,
          karena argumen action pun masukan jaringan. */}
      <input type="hidden" name="produk" value={productId} />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <label>
          <span className={KELAS_LABEL}>Harga (Rp)</span>
          <input
            ref={hargaRef}
            name="harga"
            type="number"
            required
            min={0}
            max={HARGA_MAKS}
            step={1}
            inputMode="numeric"
            defaultValue={hargaSekarang ?? undefined}
            aria-label={`Harga ${judul}`}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Harga coret (Rp)</span>
          <span className="mt-1 flex gap-1.5">
            <input
              ref={coretRef}
              name="harga_coret"
              type="number"
              min={0}
              max={HARGA_MAKS}
              step={1}
              inputMode="numeric"
              defaultValue={hargaCoretSekarang ?? undefined}
              aria-label={`Harga coret ${judul}`}
              className={KELAS_MEDAN}
            />
            {/* Kenyamanan MENGETIK di sisi klien saja — server TIDAK PERNAH
                menghitung harga + 20000. Menanamkan "+20rb" sebagai rumus di
                server berarti kode yang harus diubah saat soft launch
                berakhir; sebagai tombol ia hanya mengisi medan, dan pemilik
                tetap bebas mengetik angka lain atau mengosongkannya. */}
            <button
              type="button"
              onClick={() => {
                const harga = Number(hargaRef.current?.value ?? "");
                if (coretRef.current && Number.isFinite(harga) && harga > 0) {
                  coretRef.current.value = String(harga + 20_000);
                }
              }}
              className={KELAS_TOMBOL_KECIL}
              title="Isi harga coret = harga + Rp 20.000"
            >
              +20rb
            </button>
          </span>
        </label>
        <label>
          <span className={KELAS_LABEL}>Berlaku sejak</span>
          {/* Tanggal berlaku tidak boleh mundur: `min` menahannya di browser,
              server action menahannya sungguhan. Nilai bawaannya hari ini
              menurut Jakarta — dihitung di server, karena jam browser
              pemiliknya bukan sumber kebenaran bagi tanggal berlakunya harga. */}
          <input
            name="mulai"
            type="date"
            required
            min={hariIni}
            defaultValue={hariIni}
            aria-label={`Tanggal berlaku harga ${judul}`}
            className={KELAS_MEDAN}
          />
        </label>
      </div>

      <p className="text-[12px] leading-relaxed text-clay">
        Harga coret bersifat opsional dan diisi MANUAL — harga sebelum diskon
        soft launch, dipajang tercoret. Kosongkan bila produk ini tidak sedang
        promo.
      </p>

      <p className="text-[12px] leading-relaxed text-clay">
        Menetapkan harga baru <b>tidak akan menimpa</b> harga lama: harga
        lama tetap tersimpan sebagai riwayat, dan tanggal berlaku tidak bisa
        dimundurkan. Harga <b>0</b> berarti produk ini GRATIS dan diambil
        tanpa pembayaran.
      </p>

      {pesan && <p className="text-[12px] font-semibold text-clay">{pesan}</p>}

      {sukses && (
        <p className="text-[12px] font-semibold text-leaf">
          Harga baru tersimpan sebagai baris baru. Riwayat di bawah ikut bertambah.
        </p>
      )}

      <span className="flex gap-2">
        <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Simpan harga"}
        </button>
      </span>
    </form>
  );
}
