"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tetapkanMasaBerlaku } from "./aksi";
import { labelMasaBerlaku, MASA_BERLAKU_MAKS_BULAN } from "@/lib/produk/status";

const KELAS_MEDAN =
  "mt-1 min-h-[38px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px]";

function awal(bulan: number | null): { satuan: string; jumlah: string } {
  if (bulan === null) return { satuan: "selamanya", jumlah: "" };
  if (bulan % 12 === 0) return { satuan: "tahun", jumlah: String(bulan / 12) };
  return { satuan: "bulan", jumlah: String(bulan) };
}

export function FormMasaBerlaku({
  productId,
  masaBerlakuBulan,
}: {
  productId: string;
  masaBerlakuBulan: number | null;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [satuan, setSatuan] = useState(awal(masaBerlakuBulan).satuan);

  return (
    <form
      className="mt-4 grid gap-2 rounded-lg border border-panel-border bg-panel-bg p-3"
      action={(fd) =>
        mulai(async () => {
          const r = await tetapkanMasaBerlaku(fd);
          if (!r.ok) { setPesan(r.pesan); return; }
          setPesan(null);
          router.refresh();
        })
      }
    >
      <h3 className="text-[12.5px] font-bold text-panel-muted">
        Masa berlaku sesudah dibeli — sekarang {labelMasaBerlaku(masaBerlakuBulan)}
      </h3>
      <input type="hidden" name="produk" value={productId} />
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <select name="satuan" value={satuan} onChange={(e) => setSatuan(e.target.value)}
          aria-label="Satuan masa berlaku" className={KELAS_MEDAN}>
          <option value="selamanya">Selamanya</option>
          <option value="bulan">Bulan</option>
          <option value="tahun">Tahun</option>
        </select>
        <input name="jumlah" type="number" min={1}
          max={satuan === "tahun" ? MASA_BERLAKU_MAKS_BULAN / 12 : MASA_BERLAKU_MAKS_BULAN}
          defaultValue={awal(masaBerlakuBulan).jumlah}
          disabled={satuan === "selamanya"} required={satuan !== "selamanya"}
          aria-label="Jumlah" className={KELAS_MEDAN} />
      </div>
      <p className="text-[11px] text-panel-muted/80">
        Perubahan hanya berlaku untuk pembelian berikutnya. Pembeli lama dan pesanan yang sedang menunggu bayar tetap memakai durasi saat mereka checkout.
      </p>
      {pesan && <p className="text-[12.5px] font-semibold text-clay">{pesan}</p>}
      <button type="submit" disabled={pending}
        className="justify-self-start rounded-lg bg-panel-ink px-4 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60">
        {pending ? "Menyimpan…" : "Simpan masa berlaku"}
      </button>
    </form>
  );
}
