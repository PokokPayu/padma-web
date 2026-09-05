"use client";

import { useState } from "react";
import { PALET_GRAFIK } from "./palet";
import { GEOM, PLOT, Kisi, LabelX, batasAtas, pusatX, skalaY } from "./grafik-dasar";
import { Tabel, Th, Td } from "./tabel";

export type TitikBatang = { label: string; nilai: number };

/**
 * Ujung batang dibulatkan 4px HANYA di sisi atas, dan tetap menempel di garis
 * dasar. `rx` pada <rect> membulatkan keempat sudut, sehingga dasarnya ikut
 * melengkung dan batang terlihat mengambang di atas sumbunya.
 */
function jalurBatang(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const dasar = y + h;
  return `M${x} ${dasar} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${dasar} Z`;
}

/**
 * Grafik batang seri tunggal.
 *
 * TIDAK ada legenda: satu seri sudah dinamai judulnya, dan kotak legenda
 * berisi satu baris hanya menambah perabot.
 *
 * `format` datang sebagai prop dan komponennya tidak tahu satuan apa pun —
 * itulah yang membuatnya boleh dipakai di panel admin, tempat nominal uang
 * tidak boleh singgah sama sekali.
 */
export function GrafikBatang({
  judul,
  data,
  format = (n) => String(n),
  warna = PALET_GRAFIK[0],
}: {
  judul: string;
  data: readonly TitikBatang[];
  format?: (n: number) => string;
  warna?: string;
}) {
  const [sorot, setSorot] = useState<number | null>(null);
  const nilai = data.map((d) => d.nilai);
  const maks = batasAtas(nilai);
  const slot = PLOT.lebar / Math.max(1, data.length);
  // Celah 2px antar batang: dua isian yang bersentuhan terbaca sebagai satu
  // bentuk panjang, bukan sebagai dua nilai.
  const lebarBatang = Math.max(2, slot - 2);
  const dasar = GEOM.tinggi - GEOM.pad.bawah;

  // Label langsung SELEKTIF: hanya batang tertinggi dan batang terakhir.
  // Angka di setiap batang mengubah grafik menjadi tabel yang sulit dibaca.
  const iTertinggi = nilai.reduce((a, v, i) => (v > nilai[a] ? i : a), 0);
  const berlabel = new Set([iTertinggi, data.length - 1]);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${GEOM.lebar} ${GEOM.tinggi}`}
        width="100%"
        height={GEOM.tinggi}
        role="img"
        aria-label={`${judul}. ${data
          .map((d) => `${d.label}: ${format(d.nilai)}`)
          .join(", ")}.`}
        onMouseLeave={() => setSorot(null)}
      >
        <Kisi maks={maks} format={(v) => format(Math.round(v))} />
        <LabelX label={data.map((d) => d.label)} />

        {data.map((d, i) => {
          const y = skalaY(d.nilai, maks);
          const x = GEOM.pad.kiri + slot * i + (slot - lebarBatang) / 2;
          return (
            <g key={`${d.label}-${i}`}>
              {/* Sasaran tunjuk setinggi plot: batang pendek tetap mudah
                  disorot, tanpa mengubah bentuk yang terlihat. */}
              <rect
                x={x}
                y={GEOM.pad.atas}
                width={lebarBatang}
                height={dasar - GEOM.pad.atas}
                fill="transparent"
                onMouseEnter={() => setSorot(i)}
              />
              <path
                data-batang={d.nilai}
                d={jalurBatang(x, y, lebarBatang, dasar - y)}
                fill={warna}
                opacity={sorot === null || sorot === i ? 1 : 0.45}
              />
              {berlabel.has(i) && d.nilai > 0 && (
                <text
                  data-label-langsung=""
                  x={x + lebarBatang / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="currentColor"
                  className="text-panel-ink"
                >
                  {format(d.nilai)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {sorot !== null && (
        <div
          role="presentation"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-panel-border bg-panel-surface px-2 py-1 text-[11.5px] font-bold text-panel-ink shadow-sm"
          style={{
            left: `${(pusatX(sorot, data.length) / GEOM.lebar) * 100}%`,
            top: `${(skalaY(data[sorot].nilai, maks) / GEOM.tinggi) * 100}%`,
          }}
        >
          {data[sorot].label}: {format(data[sorot].nilai)}
        </div>
      )}

      {/* Padanan tabel. Grafik yang hanya bisa dibaca dengan mata adalah
          grafik yang sebagian pemakainya tidak bisa baca sama sekali. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">
          Lihat sebagai tabel
        </summary>
        <div className="mt-2">
          <Tabel label={judul}>
            <thead>
              <tr>
                <Th>Pekan</Th>
                <Th className="text-right">Jumlah</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={`${d.label}-${i}`}>
                  <Td>{d.label}</Td>
                  <Td className="text-right tabular-nums">{format(d.nilai)}</Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      </details>
    </div>
  );
}
