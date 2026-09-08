"use client";

import { useState, useTransition } from "react";
import { verifikasiPengajuan, hapusBukti } from "./aksi-pengajuan";

/**
 * SATU BARIS TAGIHAN PENGAJUAN di layar verifikasi admin (spec C2 P3, P4).
 *
 * DIPISAH dari daftar tagihan sesi yang sudah ada, dan itu disengaja: hanya
 * yang ini MENAHAN JADWAL dan punya tenggat. Meleburnya ke satu daftar tanpa
 * penanda berarti admin tidak bisa lagi membedakan mana yang mendesak.
 *
 * Bukti dibuka lewat rute bertanda (`/api/bukti/[permintaan]`), bukan URL
 * publik: bucketnya tidak punya satu pun policy, jadi tidak ada path yang bisa
 * ditukar jadi byte tanpa melewati `requireRole`.
 */
export function BarisTagihanPengajuan({
  permintaanId,
  namaKlien,
  namaLayanan,
  tanggal,
  total,
  labelBayar,
  adaBukti,
  bisaDiverifikasi,
}: {
  permintaanId: string;
  namaKlien: string;
  namaLayanan: string;
  tanggal: string;
  total: string | null;
  labelBayar: string;
  adaBukti: boolean;
  bisaDiverifikasi: boolean;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [konfirmHapus, setKonfirmHapus] = useState(false);

  return (
    <li
      className="mb-2 rounded-lg border border-panel-border bg-panel-surface p-3.5"
      data-tagihan-pengajuan={permintaanId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-[13.5px] text-panel-ink">
          {namaKlien} · {namaLayanan}
        </b>
        <span className="text-[12.5px] text-panel-muted">{tanggal}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[12.5px]">
        <span className="text-panel-ink">{total ?? "total belum lengkap"}</span>
        <span className="text-panel-muted">{labelBayar}</span>
        {/* MENAHAN JADWAL — penanda yang membedakannya dari tagihan sesi. */}
        <span className="rounded-full border border-clay/30 bg-clay/10 px-2 py-0.5 text-[11px] font-semibold text-clay">
          menahan jadwal
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {adaBukti ? (
          <a
            href={`/api/bukti/${permintaanId}`}
            target="_blank"
            rel="noopener"
            className="rounded-lg border border-panel-border px-2.5 py-1 text-[12px] font-semibold text-panel-ink"
          >
            Lihat bukti
          </a>
        ) : (
          <span className="text-[12px] italic text-panel-muted">belum ada bukti</span>
        )}

        <button
          type="button"
          disabled={pending || !bisaDiverifikasi}
          onClick={() =>
            mulai(async () => {
              const r = await verifikasiPengajuan(permintaanId);
              setPesan(r.ok ? null : r.pesan);
            })
          }
          className="rounded-lg bg-gold px-2.5 py-1 text-[12px] font-bold text-night disabled:opacity-50"
        >
          {pending ? "Memproses…" : "Tandai lunas"}
        </button>

        {adaBukti &&
          (konfirmHapus ? (
            <>
              <span className="text-[12px] text-panel-muted">Hapus buktinya?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  mulai(async () => {
                    const r = await hapusBukti(permintaanId);
                    setPesan(r.ok ? null : r.pesan);
                    setKonfirmHapus(false);
                  })
                }
                className="rounded-lg border border-clay/40 px-2.5 py-1 text-[12px] font-bold text-clay"
              >
                Ya, hapus
              </button>
              <button
                type="button"
                onClick={() => setKonfirmHapus(false)}
                className="text-[12px] font-semibold text-panel-muted underline"
              >
                Batal
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setKonfirmHapus(true)}
              className="text-[12px] font-semibold text-panel-muted underline underline-offset-2"
            >
              Hapus bukti
            </button>
          ))}
      </div>

      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </li>
  );
}
