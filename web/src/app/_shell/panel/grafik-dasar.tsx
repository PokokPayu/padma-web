import { WARNA_KISI, WARNA_TINTA_SUMBU } from "./palet";

/**
 * Geometri bersama kedua grafik.
 *
 * SVG memakai `viewBox` dengan koordinat tetap dan `width="100%"`: grafiknya
 * ikut melebar mengikuti kartunya tanpa satu baris JavaScript pengukur, dan
 * tetap tajam di layar retina. Tinggi tetap supaya deretan kartu tidak
 * melompat-lompat saat datanya berubah.
 */
export const GEOM = {
  lebar: 640,
  tinggi: 210,
  pad: { atas: 18, kanan: 16, bawah: 30, kiri: 40 },
} as const;

export const PLOT = {
  lebar: GEOM.lebar - GEOM.pad.kiri - GEOM.pad.kanan,
  tinggi: GEOM.tinggi - GEOM.pad.atas - GEOM.pad.bawah,
} as const;

/**
 * Batas atas sumbu Y — SELALU dari nol.
 *
 * Sumbu yang dipotong di bawah membesar-besarkan selisih kecil; pada grafik
 * yang dipakai memutuskan honor, itu bukan gaya melainkan berbohong.
 *
 * Dibulatkan ke angka "bagus" — 1, 2, 2.5, atau 5 dikali pangkat sepuluh —
 * bukan ke kelipatan empat. Kelipatan empat jatuh pas untuk hitungan sesi
 * (batasnya kecil, kelipatannya tetap terbaca), tetapi pada nominal
 * bermagnitudo ratusan ribu ia menghasilkan kisi yang bulat bagi kalkulator,
 * bukan bagi mata (mis. empat ratus enam puluh dua ribu lima ratus). Minimal
 * tetap sebuah lantai kecil-positif, supaya data yang seluruhnya nol tetap
 * punya skala andai suatu saat digambar tanpa lewat jalur status-kosong.
 */
export function batasAtas(nilai: readonly number[]): number {
  const maks = Math.max(0, ...nilai);
  if (maks <= 4) return 4;

  const magnitudo = Math.pow(10, Math.floor(Math.log10(maks)));
  for (const pengali of [1, 2, 2.5, 5, 10]) {
    const kandidat = pengali * magnitudo;
    if (kandidat >= maks) return kandidat;
  }
  // Tidak pernah tercapai (pengali 10 selalu ≥ maks/magnitudo < 10), tetapi
  // TypeScript tidak tahu itu tanpa penjaga eksplisit.
  return 10 * magnitudo;
}

/** Koordinat Y sebuah nilai. Nol = garis dasar, `maks` = tepi atas plot. */
export function skalaY(nilai: number, maks: number): number {
  const dasar = GEOM.tinggi - GEOM.pad.bawah;
  return dasar - (nilai / maks) * PLOT.tinggi;
}

/** Koordinat X titik ke-`i` dari `n` titik, di TENGAH slotnya. */
export function pusatX(i: number, n: number): number {
  const slot = PLOT.lebar / n;
  return GEOM.pad.kiri + slot * i + slot / 2;
}

/**
 * Kisi horizontal + label sumbu Y. Sengaja resesif — yang harus menonjol
 * adalah datanya, bukan rangkanya.
 */
export function Kisi({
  maks,
  format,
  garis = 4,
}: {
  maks: number;
  format: (n: number) => string;
  garis?: number;
}) {
  const nilai = Array.from({ length: garis + 1 }, (_, i) => (maks / garis) * i);
  return (
    <g aria-hidden="true">
      {nilai.map((v) => {
        const y = skalaY(v, maks);
        return (
          <g key={v}>
            <line
              x1={GEOM.pad.kiri}
              y1={y}
              x2={GEOM.lebar - GEOM.pad.kanan}
              y2={y}
              stroke={WARNA_KISI}
              strokeWidth={1}
            />
            <text
              x={GEOM.pad.kiri - 8}
              y={y + 3.5}
              textAnchor="end"
              fontSize={10}
              fill={WARNA_TINTA_SUMBU}
            >
              {format(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Label sumbu X. Pada layar sempit label diselang-seling supaya tidak
 *  bertabrakan — label yang saling menimpa lebih buruk daripada label yang
 *  lebih jarang. */
export function LabelX({ label }: { label: readonly string[] }) {
  const y = GEOM.tinggi - GEOM.pad.bawah + 16;
  const selang = label.length > 6 ? 2 : 1;
  return (
    <g aria-hidden="true">
      {label.map((t, i) =>
        i % selang === 0 || i === label.length - 1 ? (
          <text
            key={`${t}-${i}`}
            x={pusatX(i, label.length)}
            y={y}
            textAnchor="middle"
            fontSize={10}
            fill={WARNA_TINTA_SUMBU}
          >
            {t}
          </text>
        ) : null,
      )}
    </g>
  );
}
