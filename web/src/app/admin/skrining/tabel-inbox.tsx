"use client";

import { Fragment, useState } from "react";
import { ubahTindakLanjut } from "./aksi";
import { LABEL_STATUS } from "./status";

export type BarisSkrining = {
  id: string;
  kode: string;
  nama: string;
  no_hp: string;
  fase: string;
  hasil: "hijau" | "merah";
  status_tindak_lanjut: string;
  created_at: string;
  flags: { id: string; level: string; teks: string }[];
};

export function TabelInbox({ baris }: { baris: BarisSkrining[] }) {
  const [terbuka, setTerbuka] = useState<string | null>(null);

  if (baris.length === 0) {
    return (
      <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
        Belum ada hasil skrining masuk. Begitu ada pengunjung mengisi skrining,
        entrinya muncul di sini.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
              <th className="p-4 text-left font-extrabold">Kode</th>
              <th className="p-4 text-left font-extrabold">Calon klien</th>
              <th className="p-4 text-left font-extrabold">Hasil</th>
              <th className="p-4 text-left font-extrabold">Tindak lanjut</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {baris.map((r) => {
              // Penanda urgent dihitung dari LEVEL di flags, bukan dari kolom
              // `hasil`: demam pada ibu hamil dan benjolan menopause sama-sama
              // "merah", tetapi hanya yang pertama perlu ditangani hari ini.
              const urgent = r.flags.some((f) => f.level === "urgent");
              return (
                // key WAJIB di Fragment: ia elemen teratas dalam map,
                // bukan <tr> di dalamnya.
                <Fragment key={r.id}>
                  <tr className="border-b border-black/5">
                    <td className="p-4">
                      <span className="font-mono text-xs">{r.kode}</span>
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        {new Date(r.created_at).toLocaleDateString("id-ID", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </span>
                    </td>
                    <td className="p-4">
                      <b>{r.nama}</b>
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        {r.no_hp} · {r.fase}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                        r.hasil === "hijau"
                          ? "bg-leaf-soft text-leaf"
                          : "bg-clay/10 text-clay"
                      }`}>
                        {r.hasil === "hijau" ? "HIJAU" : urgent ? "MERAH · URGENT" : "MERAH"}
                      </span>
                    </td>
                    <td className="p-4">
                      <select defaultValue={r.status_tindak_lanjut}
                        onChange={(e) => void ubahTindakLanjut(r.id, e.target.value)}
                        aria-label={`Tindak lanjut ${r.kode}`}
                        className="rounded-lg border-[1.5px] border-black/10 bg-white px-2.5 py-1.5 text-[12.5px]">
                        {Object.entries(LABEL_STATUS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      <button type="button"
                        onClick={() => setTerbuka(terbuka === r.id ? null : r.id)}
                        className="text-[13px] font-bold text-leaf underline underline-offset-4">
                        jawaban
                      </button>
                    </td>
                  </tr>
                  {terbuka === r.id && (
                    <tr>
                      <td colSpan={5} className="border-b border-black/5 bg-paper p-5 text-[13px]">
                        {r.flags.length === 0 ? (
                          <p>
                            Semua pertanyaan dijawab <b>Tidak</b> — tidak ada bendera.
                            Aman dijadwalkan setelah konfirmasi kondisi.
                          </p>
                        ) : (
                          <>
                            <p className="font-bold">Jawaban &ldquo;Ya&rdquo; yang perlu diperhatikan:</p>
                            <ul className="mt-2 list-disc pl-5 text-[#54463C]">
                              {r.flags.map((f) => (
                                <li key={f.id}>
                                  {f.teks}
                                  {f.level === "urgent" && (
                                    <span className="ml-2 rounded bg-clay/10 px-1.5 py-0.5 text-[10.5px] font-extrabold text-clay">
                                      URGENT
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
