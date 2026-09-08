"use client";

import { useState, useTransition } from "react";
import { konfirmasiPermintaan, tolakPermintaan } from "./aksi";

export type PermintaanAntre = {
  id: string;
  namaKlien: string;
  namaLayanan: string;
  tanggal: string; // sudah diformat untuk manusia
  jam: string; // sudah diformat, mis. "09.00 WIB"
  // Label preferensi waktu. Sejak C1 ia berarti ALTERNATIF bila jam yang
  // diminta tidak bisa (spec J2), bukan lagi satu-satunya keterangan waktu —
  // karena itu ia dirender di belakang jam, bukan menggantikannya.
  waktu: string;
  catatan: string;
};

export type MitraPilihan = { id: string; nama: string };

/**
 * Satu blok permintaan jadwal yang menunggu keputusan.
 *
 * Tombolnya dua, bukan satu tombol bernilai status: keadaan tujuan tidak pernah
 * menyeberang batas server sebagai data. Yang dikirim hanyalah "permintaan yang
 * mana" dan — untuk konfirmasi — "mitra yang mana".
 *
 * Mitra dipilih di sini dan bukan setelahnya karena sesi wajib punya
 * `partner_id`: konfirmasi tanpa mitra akan melahirkan sesi tanpa siapa pun
 * yang datang.
 */
export function BlokPermintaan({
  permintaan,
  mitra,
}: {
  permintaan: PermintaanAntre;
  mitra: MitraPilihan[];
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState(mitra[0]?.id ?? "");

  const nonaktif = pending || mitra.length === 0;

  return (
    <article className="mb-3 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <b className="text-[13.5px] text-ink">
            Permintaan jadwal — {permintaan.namaKlien}
          </b>
          <span className="mt-0.5 block text-[11.5px] text-ink-soft">
            {permintaan.namaLayanan} · {permintaan.tanggal} · <b>{permintaan.jam}</b> · alternatif{" "}
            {permintaan.waktu}
            {permintaan.catatan ? ` · “${permintaan.catatan}”` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`mitra-${permintaan.id}`}>
            Mitra untuk permintaan {permintaan.namaKlien}
          </label>
          <select
            id={`mitra-${permintaan.id}`}
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="min-h-[38px] rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-[12.5px]"
          >
            {mitra.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={nonaktif}
            onClick={() =>
              mulai(async () => {
                const r = await konfirmasiPermintaan(permintaan.id, partnerId);
                setPesan(r.ok ? null : r.pesan);
              })
            }
            className="rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night disabled:opacity-60"
          >
            {pending ? "Memproses…" : "Konfirmasi"}
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              mulai(async () => {
                const r = await tolakPermintaan(permintaan.id);
                setPesan(r.ok ? null : r.pesan);
              })
            }
            className="rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60"
          >
            Tolak
          </button>
        </div>
      </div>

      {mitra.length === 0 && (
        <p className="mt-2 text-[12px] font-semibold text-clay">
          Belum ada mitra aktif — daftarkan mitra dulu di menu Mitra.
        </p>
      )}
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </article>
  );
}
