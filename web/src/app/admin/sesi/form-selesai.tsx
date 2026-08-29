"use client";

import { useState, useTransition } from "react";
import { selesaikanSesi } from "./aksi";
import { LABEL_STATUS_SESI, type StatusSesi } from "./status";

export type BarisSesiTampil = {
  id: string;
  namaKlien: string;
  padmaId: string;
  namaLayanan: string;
  tanggal: string; // sudah diformat untuk manusia
  namaMitra: string;
  status: StatusSesi;
  dalamPaket: boolean;
  catatan: string;
  rekomendasi: string;
};

const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";

const KELAS_PILL: Record<StatusSesi, string> = {
  terjadwal: "bg-gold/15 text-[#8A6A16]",
  selesai: "bg-leaf-soft text-leaf",
  batal: "bg-clay/10 text-clay",
};

/**
 * Satu baris sesi beserta dua lacinya: formulir "tandai selesai" dan catatan
 * bidan yang sudah tertulis.
 *
 * Baris ini komponen klien karena lacinya membuka-tutup, tetapi TIDAK satu pun
 * keputusan dibuat di sini: yang dikirim ke server hanyalah id sesi dan isi dua
 * medan teks. Status tujuan tidak pernah menyeberang sebagai data — `selesai`
 * tertulis mati di dalam server action.
 *
 * Catatan sesi yang sudah selesai tetap bisa dibuka kembali, tetapi TANPA
 * formulir: menimpanya ditolak server, dan menyediakan medannya hanya
 * menjanjikan sesuatu yang tidak akan terjadi.
 */
export function BarisSesi({ sesi }: { sesi: BarisSesiTampil }) {
  const [formTerbuka, setFormTerbuka] = useState(false);
  const [catatanTerbuka, setCatatanTerbuka] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  const adaCatatan = sesi.catatan.trim().length > 0;

  return (
    <>
      <tr className="border-b border-black/5 align-top">
        <td className="p-4">
          <b>{sesi.namaKlien}</b>
          <span className="mt-0.5 block font-mono text-[11px] text-ink-soft">
            {sesi.padmaId}
          </span>
        </td>
        <td className="p-4">
          {sesi.namaLayanan}
          <span className="mt-0.5 block text-[11.5px] text-ink-soft">
            {sesi.tanggal}
            {sesi.dalamPaket ? " · paket" : ""}
          </span>
        </td>
        <td className="p-4">{sesi.namaMitra}</td>
        <td className="p-4">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
              KELAS_PILL[sesi.status]
            }`}
          >
            {LABEL_STATUS_SESI[sesi.status]}
          </span>
        </td>
        <td className="p-4">
          {sesi.status === "terjadwal" && (
            <button
              type="button"
              onClick={() => {
                setPesan(null);
                setFormTerbuka((t) => !t);
              }}
              className="rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night"
            >
              Tandai selesai
            </button>
          )}
          {sesi.status !== "terjadwal" && adaCatatan && (
            <button
              type="button"
              onClick={() => setCatatanTerbuka((t) => !t)}
              className="text-[12.5px] font-bold text-leaf underline underline-offset-4"
            >
              catatan
            </button>
          )}
        </td>
      </tr>

      {formTerbuka && (
        <tr className="border-b border-black/5">
          <td colSpan={5} className="px-4 pb-4">
            <form
              action={(fd) =>
                mulai(async () => {
                  const r = await selesaikanSesi(sesi.id, fd);
                  if (r.ok) {
                    setPesan(null);
                    setFormTerbuka(false);
                  } else {
                    setPesan(r.pesan);
                  }
                })
              }
              className="rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4"
            >
              <h3 className="mb-3 text-[13.5px] font-extrabold text-ink">
                Selesaikan sesi — catatan ini terbaca {sesi.namaKlien} di
                Passport-nya
              </h3>

              <label className="block">
                <span className={KELAS_LABEL}>
                  Catatan &amp; evaluasi (dari laporan bidan)
                </span>
                <textarea
                  name="catatan"
                  rows={3}
                  required
                  maxLength={2000}
                  placeholder="Apa yang dilakukan, bagaimana respons klien…"
                  className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]"
                />
              </label>

              <label className="mt-3 block">
                <span className={KELAS_LABEL}>Rekomendasi untuk klien</span>
                <textarea
                  name="rekomendasi"
                  rows={2}
                  maxLength={2000}
                  placeholder="Home care / self-care yang disarankan…"
                  className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]"
                />
              </label>

              {pesan && (
                <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>
              )}

              <div className="mt-4 flex gap-2.5">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
                >
                  {pending ? "Menyimpan…" : "Simpan · sesi selesai"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormTerbuka(false);
                    setPesan(null);
                  }}
                  className="rounded-xl border border-black/15 px-4 py-2.5 text-[13px] font-bold text-ink-soft"
                >
                  Batal
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}

      {/* Laci catatan ikut dirender lalu disembunyikan atribut `hidden`, bukan
          dibuat saat diketuk: isinya sudah sah dibaca staf, dan merender ulang
          seluruh baris hanya untuk membuka satu laci membuat tombolnya terasa
          tersendat pada tabel yang panjang. */}
      {adaCatatan && (
        <tr hidden={!catatanTerbuka} className="border-b border-black/5">
          <td colSpan={5} className="px-4 pb-4">
            <div className="rounded-2xl bg-paper p-4 text-[13px] text-ink">
              <b>Catatan:</b> {sesi.catatan}
              <br />
              <b>Rekomendasi:</b> {sesi.rekomendasi || "—"}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
