"use client";

import { Fragment, useState, useTransition } from "react";
import type { ItemTagihanAdmin } from "@/lib/admin/tagihan";
import { tandaiLunas, tolakKlaim } from "./aksi";
import { KELAS_PILL, LABEL_BAYAR } from "./status";

/**
 * Daftar tagihan klinik beserta dua keputusan yang bisa diambil admin.
 *
 * TIDAK ADA `<select>` di sini. Prototipe memakai
 * `<select onchange="ubahStatusBayar(id, this.value)">`, yang berarti keadaan
 * tujuan diketik browser dan dipercaya server. Yang menyeberang dari komponen
 * ini hanyalah JENIS dan ID; "lunas" dan "belum" tertulis mati di dalam server
 * action masing-masing.
 *
 * Tombol dirender BERSYARAT menurut status barisnya — bukan karena tampilan
 * adalah pagar (action memeriksa syaratnya sendiri), melainkan karena menawarkan
 * tombol yang pasti ditolak adalah janji yang tidak akan ditepati.
 */
export function TabelBayar({ item }: { item: ItemTagihanAdmin[] }) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<Record<string, string>>({});

  if (item.length === 0) {
    return (
      <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
        Belum ada tagihan yang perlu diverifikasi. Begitu klien menekan
        &ldquo;Saya sudah bayar&rdquo; di Passport-nya, itemnya muncul di sini.
      </p>
    );
  }

  const jalankan = (
    kunci: string,
    aksi: () => Promise<{ ok: true } | { ok: false; pesan: string }>,
  ) =>
    mulai(async () => {
      const r = await aksi();
      setPesan((p) => ({ ...p, [kunci]: r.ok ? "" : r.pesan }));
    });

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
              <th className="p-4 text-left font-extrabold">Klien</th>
              <th className="p-4 text-left font-extrabold">Item</th>
              <th className="p-4 text-left font-extrabold">Status</th>
              <th className="p-4 text-left font-extrabold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {item.map((t) => {
              const kunci = `${t.jenis}:${t.id}`;
              return (
                // key WAJIB di Fragment: ia elemen teratas dalam map.
                <Fragment key={kunci}>
                  <tr
                    data-item={kunci}
                    data-status={t.status}
                    className="border-b border-black/5 align-top"
                  >
                    <td className="p-4">
                      <b>{t.namaKlien}</b>
                      <span className="mt-0.5 block font-mono text-[11px] text-ink-soft">
                        {t.padmaId}
                      </span>
                    </td>
                    <td className="p-4">
                      {t.label}
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        {t.jenis === "paket" ? "Paket" : "Sesi lepas"}
                      </span>
                    </td>
                    <td className="p-4">
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                          KELAS_PILL[t.status]
                        }`}
                      >
                        {LABEL_BAYAR[t.status]}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {t.status !== "lunas" && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              jalankan(kunci, () => tandaiLunas(t.jenis, t.id))
                            }
                            className="rounded-lg bg-night px-3 py-1.5 text-[12px] font-bold text-gold-pale disabled:opacity-60"
                          >
                            Tandai lunas
                          </button>
                        )}
                        {t.status === "menunggu_verifikasi" && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              jalankan(kunci, () => tolakKlaim(t.jenis, t.id))
                            }
                            className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60"
                          >
                            Tolak klaim
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {pesan[kunci] ? (
                    <tr className="border-b border-black/5">
                      <td colSpan={4} className="px-4 pb-3 text-[12.5px] font-semibold text-clay">
                        {pesan[kunci]}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
