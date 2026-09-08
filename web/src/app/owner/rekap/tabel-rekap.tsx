"use client";

import { useState, useTransition } from "react";
import { stempelJakarta } from "@/lib/owner/pekan";
import type { BarisMitra } from "@/lib/owner/rekap";
import { formatRupiah } from "@/lib/owner/rupiah";
import { tandaiHonorDibayar } from "./aksi";

const KELAS_TOMBOL =
  "shrink-0 rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60";
const KELAS_LUNAS =
  "shrink-0 rounded-lg border border-leaf/40 bg-leaf-soft px-3 py-1.5 text-[12px] font-bold text-leaf";

/**
 * Satu baris honor mitra di dalam kartu pekan — bagian rekap yang benar-benar
 * dibayarkan setiap Sabtu.
 *
 * Prototipe (`vRekap`) menonaktifkan tombolnya begitu ditandai dan berhenti di
 * situ. Dua hal yang sengaja BERBEDA di sini:
 *
 *  1. TIDAK ADA JALUR PENCABUTAN. Hak DELETE atas `honor_marks` sudah
 *     dicabut dari peran aplikasi — owner pun dijawab 42501 — dan itu keadaan
 *     yang benar: tanda bayar adalah bukti bahwa seorang mitra sudah menerima
 *     uangnya. Tombol untuk mencabutnya hanya akan gagal, dan kegagalannya
 *     menyesatkan. Karena itu tandanya dirender sebagai LENCANA, bukan tombol
 *     yang dinonaktifkan: yang mati bisa dikira sedang memuat.
 *
 *  2. SESI SUSULAN DIBERI PENANDA. Sesi yang baru disentuh SESUDAH pekan ini
 *     ditandai dibayar menaikkan nominal di baris yang sudah berlabel lunas.
 *     Menaikkannya diam-diam berarti layar ini menampilkan angka yang lebih
 *     besar daripada yang benar-benar ditransfer, tanpa satu pun petunjuk
 *     bahwa selisihnya masih terutang.
 */
export function BarisHonorMitra({
  baris,
  senin,
}: {
  baris: BarisMitra;
  /** Senin pekan ini — kunci bucket rekap sekaligus `week_start` tandanya. */
  senin: string;
}) {
  const [baruDitandai, setBaruDitandai] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  const lunas = baris.sudahDibayar || baruDitandai;

  return (
    <div className="border-b border-panel-border py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="min-w-0">
          <b className="block text-[13.5px] text-panel-ink">{baris.nama}</b>
          <span className="block text-[11.5px] text-panel-muted">
            {`${baris.jumlahSesi} sesi selesai`}
            {baris.jumlahTakBertarif > 0 &&
              ` · ${baris.jumlahTakBertarif} di antaranya belum bertarif`}
          </span>
        </span>

        <span className="flex items-center gap-3">
          <span className="font-mono text-[14px] text-panel-ink">
            {formatRupiah(baris.totalHonor)}
          </span>
          {lunas ? (
            <span className={KELAS_LUNAS}>
              {baris.dibayarPada === null
                ? "✓ Dibayar baru saja"
                : `✓ Dibayar ${stempelJakarta(baris.dibayarPada)}`}
            </span>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                mulai(async () => {
                  // `partnerId` dan `senin` dikirim apa adanya; server memeriksa
                  // keduanya ulang, karena argumen server action pun masukan
                  // jaringan yang bisa ditulis ulang di DevTools.
                  const hasil = await tandaiHonorDibayar(baris.partnerId, senin);
                  if (hasil.ok) {
                    setPesan(null);
                    setBaruDitandai(true);
                  } else {
                    setPesan(hasil.pesan);
                  }
                })
              }
              className={KELAS_TOMBOL}
            >
              {pending ? "Menandai…" : "Tandai dibayar"}
            </button>
          )}
        </span>
      </div>

      {lunas && baris.adaSesiSesudahDitandai && (
        <p className="mt-1.5 rounded-lg border border-clay/35 bg-panel-bg px-3 py-2 text-[11.5px] leading-relaxed text-clay">
          <b>Ada sesi yang berubah sesudah pekan ini ditandai dibayar.</b> Nominal
          di atas sudah ikut naik, tetapi selisihnya belum tentu sudah
          ditransfer — cocokkan dengan bukti transfer sebelum menutup pekan ini.
        </p>
      )}

      {pesan && <p className="mt-1.5 text-[11.5px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
