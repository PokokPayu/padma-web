"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ubahTindakLanjut } from "./aksi";
import { JadikanKlien } from "./jadikan-klien";
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
  // Terisi hanya untuk skrining yang sudah dikonversi. Opsional karena kolomnya
  // baru mulai dipakai di Plan 3A — baris lama membawanya sebagai null.
  client_id?: string | null;
};

export type PilihanFase = { id: string; nama: string };

export function TabelInbox({
  baris,
  fase = [],
}: {
  baris: BarisSkrining[];
  // Nama fase datang dari tabel `phases`, bukan disalin sebagai literal di
  // sini. Kosong berarti id mentahnya yang tampil — jelek, tapi jujur.
  fase?: PilihanFase[];
}) {
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [konversi, setKonversi] = useState<string | null>(null);
  const labelFase = new Map(fase.map((f) => [f.id, f.nama]));

  return (
    <div className="overflow-hidden rounded-lg border border-panel-border bg-panel-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[13.5px]">
          <thead>
            <tr className="border-b-[1.5px] border-panel-border bg-panel-bg text-[11px] uppercase tracking-wider text-panel-muted">
              <th className="p-4 text-left font-extrabold">Kode</th>
              <th className="p-4 text-left font-extrabold">Calon klien</th>
              <th className="p-4 text-left font-extrabold">Hasil</th>
              <th className="p-4 text-left font-extrabold">Tindak lanjut</th>
              <th className="p-4 text-left font-extrabold">Klien</th>
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
                  <tr className="border-b border-panel-border/70">
                    <td className="p-4">
                      <span className="font-mono text-xs">{r.kode}</span>
                      <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                        {new Date(r.created_at).toLocaleDateString("id-ID", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </span>
                    </td>
                    <td className="p-4">
                      <b>{r.nama}</b>
                      <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                        {r.no_hp} · {labelFase.get(r.fase) ?? r.fase}
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
                        className="rounded-lg border-[1.5px] border-panel-border bg-panel-surface px-2.5 py-1.5 text-[12.5px]">
                        {Object.entries(LABEL_STATUS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    {/* Jembatan ke modul Klien. Baris yang sudah dikonversi
                        TIDAK lagi menawarkan tombolnya: satu-satunya kabar
                        bahwa orang ini sudah terdaftar adalah tautan ini. */}
                    <td className="p-4">
                      {r.client_id ? (
                        <Link
                          href={`/admin/klien/${r.client_id}`}
                          className="text-[13px] font-bold text-leaf underline underline-offset-4"
                        >
                          Lihat klien
                        </Link>
                      ) : (
                        <button type="button"
                          onClick={() => setKonversi(konversi === r.id ? null : r.id)}
                          className="rounded-lg border border-panel-border bg-panel-surface px-2.5 py-1.5 text-[12px] font-bold text-panel-ink">
                          Jadikan klien
                        </button>
                      )}
                    </td>
                    <td className="p-4">
                      <button type="button"
                        onClick={() => setTerbuka(terbuka === r.id ? null : r.id)}
                        className="text-[13px] font-bold text-leaf underline underline-offset-4">
                        jawaban
                      </button>
                    </td>
                  </tr>
                  {konversi === r.id && !r.client_id && (
                    <tr>
                      <td colSpan={6} className="border-b border-panel-border/70 bg-panel-bg p-5">
                        <JadikanKlien
                          skriningId={r.id}
                          nama={r.nama}
                          noHp={r.no_hp}
                          namaFase={labelFase.get(r.fase) ?? r.fase}
                        />
                      </td>
                    </tr>
                  )}
                  {terbuka === r.id && (
                    <tr>
                      <td colSpan={6} className="border-b border-panel-border/70 bg-panel-bg p-5 text-[13px]">
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
