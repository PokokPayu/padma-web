"use client";

import {
  MINGGU_MAKS,
  RENTANG_TRIMESTER,
  USIA_KOSONG,
  bacaMinggu,
  type IsianUsiaKehamilan,
  type Trimester,
} from "@/lib/skrining/usia-kehamilan";

/**
 * Medan usia kehamilan — muncul HANYA saat fase "kehamilan" dipilih.
 *
 * Komponen sendiri, bukan potongan di dalam wizard.tsx, karena ia lahir dari
 * keadaan yang tidak pernah ada pada render pertama layar intro: tanpa berkas
 * ini ia hanya bisa diuji dengan membaca teks sumber, bukan merender yang
 * benar-benar dilihat klien.
 *
 * DUA CARA MENGISI, SATU FAKTA. Mengetik minggu menurunkan trimesternya;
 * menekan tombol trimester mengosongkan minggu. Karena itu "Trimester 1 tapi
 * 30 minggu" tidak bisa lahir dari layar ini — dan skema menolaknya juga bila
 * datang dari tempat lain.
 */
export function MedanUsiaKehamilan({
  minggu,
  trimester,
  onUbah,
}: IsianUsiaKehamilan & { onUbah: (isian: IsianUsiaKehamilan) => void }) {
  const terbaca = RENTANG_TRIMESTER.find((r) => r.nomor === trimester);

  function pilih(nomor: Trimester) {
    // Menekan tombol berarti "saya tidak hafal minggunya" — minggu dikosongkan
    // supaya tidak tersisa angka lama yang bertentangan dengan tombol baru.
    onUbah(trimester === nomor ? USIA_KOSONG : { minggu: null, trimester: nomor });
  }

  return (
    <fieldset className="mt-4 rounded-xl border border-black/10 bg-paper p-3.5">
      <legend className="px-1 text-sm font-semibold text-ink-soft">
        Usia kehamilan <span className="font-normal">(opsional)</span>
      </legend>

      <label className="mt-1 flex items-center gap-2.5 text-sm">
        <input
          type="number"
          inputMode="numeric"
          min="0"
          max={MINGGU_MAKS}
          step="1"
          value={minggu ?? ""}
          onChange={(e) => onUbah(bacaMinggu(e.target.value))}
          aria-label="Usia kehamilan dalam minggu"
          className="w-24 rounded-lg border border-black/15 px-3 py-2.5"
        />
        <span className="text-ink-soft">minggu</span>
        {terbaca && (
          <span className="rounded-full border border-leaf/25 bg-leaf-soft px-2.5 py-1 text-[12px] font-semibold text-[#28513C]">
            {terbaca.label}
          </span>
        )}
      </label>

      <p className="mt-3 text-[12.5px] text-ink-soft">
        Tidak hafal minggunya? Pilih trimester saja — atau lewati bagian ini.
      </p>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {RENTANG_TRIMESTER.map((r) => (
          <button
            key={r.nomor}
            type="button"
            onClick={() => pilih(r.nomor)}
            aria-pressed={trimester === r.nomor}
            className={`min-h-[52px] rounded-xl border px-3 py-2 text-[13px] font-semibold ${
              trimester === r.nomor
                ? "border-night bg-leaf-soft text-night"
                : "border-black/15 bg-white"
            }`}
          >
            {r.label}
            <span className="block text-[11.5px] font-normal text-ink-soft">
              {r.mulai}–{r.selesai} minggu
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
