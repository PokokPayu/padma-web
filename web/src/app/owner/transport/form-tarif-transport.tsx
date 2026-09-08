"use client";

import { useState, useTransition } from "react";
import { tetapkanTarifTransport, tetapkanTarifKhusus } from "./aksi";
import { NOMINAL_MAKS } from "./status";
import type { JenjangTransport } from "@/lib/transport/jarak";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60";

/**
 * Formulir "Tetapkan tarif baru" untuk SATU jenjang jarak.
 *
 * Salinan bentuk `FormTarif` (`owner/tarif/form-tarif.tsx`) untuk alasan
 * yang sama: rate card transport, seperti rate card varian, adalah
 * INSERT-ONLY — menaikkan tarif tetap TERASA seperti menyunting (medan
 * terisi nilai berjalan), tetapi yang benar-benar terjadi adalah satu baris
 * BARU bertanggal berlaku. Tidak ada tombol Hapus: DELETE atas
 * `transport_rates` sudah dicabut dari peran aplikasi, termasuk owner.
 */
export function FormTarifTransport({
  jenjang,
  labelJenjang,
  hariIni,
  tarifSekarang,
  honorSekarang,
}: {
  jenjang: JenjangTransport;
  labelJenjang: string;
  /** Hari ini menurut kalender Jakarta — dihitung di server, bukan di browser. */
  hariIni: string;
  tarifSekarang: number | null;
  honorSekarang: number | null;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await tetapkanTarifTransport(fd);
          if (r.ok) {
            setPesan(null);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="grid w-full gap-2.5"
    >
      {/* `jenjang` terikat pada baris yang sedang dibuka — server tetap
          memeriksanya ulang, karena argumen action pun masukan jaringan. */}
      <input type="hidden" name="jenjang" value={jenjang} />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <label>
          <span className={KELAS_LABEL}>Tarif klien (Rp)</span>
          <input
            name="tarif"
            type="number"
            required
            min={0}
            max={NOMINAL_MAKS}
            step={1}
            inputMode="numeric"
            defaultValue={tarifSekarang ?? undefined}
            aria-label={`Tarif klien jenjang ${labelJenjang}`}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Honor mitra (Rp)</span>
          <input
            name="honor"
            type="number"
            required
            min={0}
            max={NOMINAL_MAKS}
            step={1}
            inputMode="numeric"
            defaultValue={honorSekarang ?? undefined}
            aria-label={`Honor mitra jenjang ${labelJenjang}`}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Berlaku sejak</span>
          {/* Tanggal berlaku tidak boleh mundur: `min` menahannya di browser,
              server action menahannya sungguhan. */}
          <input
            name="mulai"
            type="date"
            required
            min={hariIni}
            defaultValue={hariIni}
            aria-label={`Tanggal berlaku tarif jenjang ${labelJenjang}`}
            className={KELAS_MEDAN}
          />
        </label>
      </div>

      <p className="text-[12px] leading-relaxed text-clay">
        Menetapkan tarif baru <b>tidak akan mengubah</b> honor sesi yang tanggalnya
        sudah lewat: honor dihitung dengan tarif yang berlaku pada tanggal
        sesi. Tarif lama tetap tersimpan sebagai riwayat, dan subsidi PADMA
        (bila honor mitra melebihi tarif klien) memang normal di jenjang dekat.
      </p>

      {pesan && <p className="text-[12px] font-semibold text-clay">{pesan}</p>}

      <span className="flex gap-2">
        <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Simpan tarif"}
        </button>
      </span>
    </form>
  );
}

/**
 * Formulir "Tetapkan tarif khusus" untuk SATU sesi >20 km.
 *
 * Berbeda dari `FormTarifTransport`: ini bukan rate card, jadi tidak ada
 * medan tanggal berlaku maupun bentuk "riwayat". `transport_khusus.session_id`
 * adalah primary key — sesi ini hanya bisa ditetapkan SEKALI; sesudah
 * tersimpan formulirnya tidak muncul lagi untuk sesi yang sama karena sesi
 * itu sudah lenyap dari `ambilSesiMenungguTarif()`.
 */
export function FormTarifKhusus({
  sessionId,
  namaKlien,
}: {
  sessionId: string;
  namaKlien: string;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [selesai, setSelesai] = useState(false);

  if (selesai) {
    return (
      <p className="text-[12.5px] font-semibold text-leaf">
        Tarif khusus {namaKlien} tersimpan.
      </p>
    );
  }

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await tetapkanTarifKhusus(fd);
          if (r.ok) {
            setPesan(null);
            setSelesai(true);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="grid w-full gap-2.5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <input type="hidden" name="sesi" value={sessionId} />
      <label>
        <span className={KELAS_LABEL}>Tarif klien (Rp)</span>
        <input
          name="tarif"
          type="number"
          required
          min={0}
          max={NOMINAL_MAKS}
          step={1}
          inputMode="numeric"
          aria-label={`Tarif klien untuk sesi ${namaKlien}`}
          className={KELAS_MEDAN}
        />
      </label>
      <label>
        <span className={KELAS_LABEL}>Honor mitra (Rp)</span>
        <input
          name="honor"
          type="number"
          required
          min={0}
          max={NOMINAL_MAKS}
          step={1}
          inputMode="numeric"
          aria-label={`Honor mitra untuk sesi ${namaKlien}`}
          className={KELAS_MEDAN}
        />
      </label>
      <span className="flex flex-col gap-1.5 sm:col-span-1">
        <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Tetapkan"}
        </button>
        {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
      </span>
    </form>
  );
}
