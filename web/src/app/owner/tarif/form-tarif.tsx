"use client";

import { useRef, useState, useTransition } from "react";
import { tetapkanTarif } from "./aksi";
import { NOMINAL_MAKS } from "./status";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-night px-3 py-1.5 text-[12px] font-bold text-gold-pale disabled:opacity-60";

/**
 * Formulir "Tetapkan tarif baru" untuk SATU varian.
 *
 * Prototipe (`vRate`/`simpanRate`) menyunting angka di tempat dan menimpanya.
 * Bentuk itu sengaja TIDAK ditiru: rekap honor membaca tarif yang berlaku pada
 * TANGGAL SESI, jadi menimpa baris lama menggeser rekap pekan yang honornya
 * sudah dibayarkan — retroaktif, tanpa satu pun error di layar. Yang tersisa
 * dari prototipe adalah medan yang terisi nilai berjalan, supaya menaikkan
 * tarif tetap terasa seperti menyunting; yang berubah adalah akibatnya: satu
 * baris BARU bertanggal berlaku.
 *
 * Karena itu pula tidak ada tombol Hapus di sini. Hak DELETE atas
 * `variant_rates` sudah dicabut dari peran aplikasi — owner pun dijawab 42501 —
 * dan itu keadaan yang benar: baris lama adalah bukti berapa honor yang
 * seharusnya dibayarkan pekan lalu.
 */
export function FormTarif({
  variantId,
  namaLayanan,
  hariIni,
  hargaSekarang,
  honorSekarang,
  hargaCoretSekarang,
}: {
  variantId: string;
  namaLayanan: string;
  /** Hari ini menurut kalender Jakarta — dihitung di server, bukan di browser. */
  hariIni: string;
  hargaSekarang: number | null;
  honorSekarang: number | null;
  hargaCoretSekarang: number | null;
}) {
  const [terbuka, setTerbuka] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const hargaRef = useRef<HTMLInputElement>(null);
  const coretRef = useRef<HTMLInputElement>(null);

  if (!terbuka) {
    return (
      <button
        type="button"
        onClick={() => {
          setPesan(null);
          setTerbuka(true);
        }}
        className={KELAS_TOMBOL_KECIL}
      >
        {hargaSekarang === null ? "Tetapkan tarif" : "Tarif baru"}
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await tetapkanTarif(fd);
          if (r.ok) {
            setPesan(null);
            setTerbuka(false);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="grid w-full gap-2.5 rounded-xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-3"
    >
      {/* `varian` terikat pada baris yang sedang dibuka — tarif tidak pernah
          bisa mendarat di varian lain lewat satu medan yang ditulis ulang di
          DevTools tanpa pemilik menyadarinya. Server tetap memeriksanya ulang,
          karena argumen action pun masukan jaringan. */}
      <input type="hidden" name="varian" value={variantId} />

      <div className="grid gap-2.5 sm:grid-cols-4">
        <label>
          <span className={KELAS_LABEL}>Harga klien (Rp)</span>
          <input
            ref={hargaRef}
            name="harga"
            type="number"
            required
            min={0}
            max={NOMINAL_MAKS}
            step={1}
            inputMode="numeric"
            defaultValue={hargaSekarang ?? undefined}
            aria-label={`Harga klien ${namaLayanan}`}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Harga coret (Rp)</span>
          <span className="mt-1 flex gap-1.5">
            <input
              ref={coretRef}
              name="harga_coret"
              type="number"
              min={0}
              max={NOMINAL_MAKS}
              step={1}
              inputMode="numeric"
              defaultValue={hargaCoretSekarang ?? undefined}
              aria-label={`Harga coret ${namaLayanan}`}
              className={KELAS_MEDAN}
            />
            {/* Kenyamanan MENGETIK di sisi klien saja — server TIDAK PERNAH
                menghitung harga + 20000. Menanamkan "+20rb" sebagai rumus di
                server berarti kode yang harus diubah saat soft launch
                berakhir; sebagai tombol ia hanya mengisi medan, dan pemilik
                tetap bebas mengetik angka lain atau mengosongkannya. */}
            <button
              type="button"
              onClick={() => {
                const harga = Number(hargaRef.current?.value ?? "");
                if (coretRef.current && Number.isFinite(harga) && harga > 0) {
                  coretRef.current.value = String(harga + 20_000);
                }
              }}
              className={KELAS_TOMBOL_KECIL}
              title="Isi harga coret = harga klien + Rp 20.000"
            >
              +20rb
            </button>
          </span>
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
            aria-label={`Honor mitra ${namaLayanan}`}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Berlaku sejak</span>
          {/* Tanggal berlaku tidak boleh mundur: `min` menahannya di browser,
              server action menahannya sungguhan. Nilai bawaannya hari ini
              menurut Jakarta — dihitung di server, karena jam browser pemiliknya
              bukan sumber kebenaran bagi tanggal berlakunya tarif. */}
          <input
            name="mulai"
            type="date"
            required
            min={hariIni}
            defaultValue={hariIni}
            aria-label={`Tanggal berlaku tarif ${namaLayanan}`}
            className={KELAS_MEDAN}
          />
        </label>
      </div>

      <p className="text-[12px] leading-relaxed text-clay">
        Harga coret bersifat opsional dan diisi MANUAL — harga sebelum diskon
        soft launch, dipajang tercoret. Kosongkan bila varian ini tidak sedang
        promo.
      </p>

      <p className="text-[12px] leading-relaxed text-clay">
        Menetapkan tarif baru <b>tidak akan mengubah</b> rekap pekan yang sudah
        lewat: honor dihitung dengan tarif yang berlaku pada tanggal sesi.
        Tarif lama tetap tersimpan sebagai riwayat, dan tanggal berlaku tidak
        bisa dimundurkan.
      </p>

      {pesan && <p className="text-[12px] font-semibold text-clay">{pesan}</p>}

      <span className="flex gap-2">
        <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Simpan tarif"}
        </button>
        <button
          type="button"
          onClick={() => {
            setTerbuka(false);
            setPesan(null);
          }}
          className={KELAS_TOMBOL_KECIL}
        >
          Batal
        </button>
      </span>
    </form>
  );
}
