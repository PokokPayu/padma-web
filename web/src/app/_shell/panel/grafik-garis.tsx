"use client";

import { useState } from "react";
import { PALET_GRAFIK, WARNA_PERMUKAAN, WARNA_TINTA_SUMBU } from "./palet";
import { GEOM, Kisi, LabelX, batasAtas, pusatX, skalaY } from "./grafik-dasar";
import { Tabel, Th, Td } from "./tabel";

export type SeriGaris = { nama: string; nilai: readonly number[] };

/**
 * Grafik garis banyak seri.
 *
 * SATU sumbu, selalu. Ketiga seri di panel owner adalah rupiah, jadi mereka
 * memang sebanding; grafik dua sumbu Y bisa membuat dua seri APA PUN terlihat
 * berkorelasi, dan itu kesalahan grafik yang paling sering merugikan.
 *
 * Identitas seri tidak pernah bergantung warna semata: ada legenda DAN label
 * langsung di ujung kanan tiap garis.
 *
 * `format` datang sebagai prop. Komponen ini tidak pernah tahu bahwa angkanya
 * rupiah — itulah yang menjaga money firewall tetap berlaku pada lapisan
 * primitif bersama.
 */
export function GrafikGaris({
  judul,
  label,
  seri,
  format,
}: {
  judul: string;
  label: readonly string[];
  seri: readonly SeriGaris[];
  format: (n: number) => string;
}) {
  const [sorot, setSorot] = useState<number | null>(null);
  const maks = batasAtas(seri.flatMap((s) => [...s.nilai]));
  const n = label.length;

  const warna = (i: number) => PALET_GRAFIK[i % PALET_GRAFIK.length];

  return (
    <div className="relative">
      <ul
        aria-label={`Legenda ${judul}`}
        className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5"
      >
        {seri.map((s, i) => (
          <li key={s.nama} className="flex items-center gap-1.5 text-[11.5px] font-bold text-panel-muted">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: warna(i) }}
            />
            {s.nama}
          </li>
        ))}
      </ul>

      <svg
        viewBox={`0 0 ${GEOM.lebar} ${GEOM.tinggi}`}
        width="100%"
        height={GEOM.tinggi}
        role="img"
        aria-label={`${judul}. ${seri
          .map((s) => `${s.nama} berakhir di ${format(s.nilai[s.nilai.length - 1] ?? 0)}`)
          .join(". ")}.`}
        onMouseLeave={() => setSorot(null)}
      >
        <Kisi maks={maks} format={format} />
        <LabelX label={label} />

        {/* Pita tunjuk per pekan: sasaran sorot jauh lebih besar daripada
            titiknya sendiri, sehingga tooltip tidak perlu diburu. */}
        {label.map((t, i) => (
          <rect
            key={`sasaran-${t}-${i}`}
            x={pusatX(i, n) - GEOM.lebar / (n * 2)}
            y={GEOM.pad.atas}
            width={GEOM.lebar / n}
            height={GEOM.tinggi - GEOM.pad.atas - GEOM.pad.bawah}
            fill="transparent"
            onMouseEnter={() => setSorot(i)}
          />
        ))}

        {sorot !== null && (
          <line
            aria-hidden="true"
            x1={pusatX(sorot, n)}
            y1={GEOM.pad.atas}
            x2={pusatX(sorot, n)}
            y2={GEOM.tinggi - GEOM.pad.bawah}
            stroke={WARNA_TINTA_SUMBU}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {seri.map((s, iSeri) => {
          const titik = s.nilai.map((v, i) => `${pusatX(i, n)},${skalaY(v, maks)}`);
          const akhir = s.nilai.length - 1;
          return (
            <g key={s.nama}>
              <polyline
                data-seri={s.nama}
                points={titik.join(" ")}
                fill="none"
                stroke={warna(iSeri)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {s.nilai.map((v, i) => (
                <circle
                  key={`${s.nama}-${i}`}
                  cx={pusatX(i, n)}
                  cy={skalaY(v, maks)}
                  r={4}
                  fill={warna(iSeri)}
                  // Cincin 2px berwarna permukaan: dua titik yang bertumpuk
                  // tanpa cincin terbaca sebagai satu titik.
                  stroke={WARNA_PERMUKAAN}
                  strokeWidth={2}
                />
              ))}
              {akhir >= 0 && (
                <text
                  data-label-seri={s.nama}
                  x={pusatX(akhir, n)}
                  y={skalaY(s.nilai[akhir], maks) - 9}
                  textAnchor="end"
                  fontSize={10}
                  fontWeight={700}
                  fill={warna(iSeri)}
                >
                  {s.nama}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {sorot !== null && (
        <div
          role="presentation"
          className="pointer-events-none absolute top-10 -translate-x-1/2 rounded-md border border-panel-border bg-panel-surface px-2.5 py-1.5 text-[11.5px] text-panel-ink shadow-sm"
          style={{ left: `${(pusatX(sorot, n) / GEOM.lebar) * 100}%` }}
        >
          <b className="block">{label[sorot]}</b>
          {seri.map((s, i) => (
            <span key={s.nama} className="mt-0.5 flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: warna(i) }}
              />
              {s.nama}: <b className="tabular-nums">{format(s.nilai[sorot] ?? 0)}</b>
            </span>
          ))}
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">
          Lihat sebagai tabel
        </summary>
        <div className="mt-2">
          <Tabel label={judul}>
            <thead>
              <tr>
                <Th>Pekan</Th>
                {seri.map((s) => (
                  <Th key={s.nama} className="text-right">
                    {s.nama}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {label.map((t, i) => (
                <tr key={`${t}-${i}`}>
                  <Td>{t}</Td>
                  {seri.map((s) => (
                    <Td key={s.nama} className="text-right tabular-nums">
                      {format(s.nilai[i] ?? 0)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      </details>
    </div>
  );
}
