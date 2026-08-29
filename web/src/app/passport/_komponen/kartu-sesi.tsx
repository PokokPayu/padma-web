"use client";

import { useId, useState } from "react";
import type { SesiRingkas, StatusSesi } from "@/lib/passport/turunan";
import { formatTanggalPendek } from "@/lib/passport/waktu";

const LABEL: Record<StatusSesi, string> = {
  selesai: "Selesai",
  terjadwal: "Terjadwal",
  batal: "Batal",
};

const PIL: Record<StatusSesi, string> = {
  selesai: "border-leaf/25 bg-leaf-soft text-leaf",
  terjadwal: "border-[#E9D9A8] bg-[#F7EDD3] text-[#8A6A1B]",
  batal: "border-black/10 bg-black/5 text-ink-soft",
};

// Satu kunjungan = satu "visa" di paspor: tanggal di tepi kiri, layanan dan
// bidan di tengah, status di kanan. Catatan bidan disembunyikan sampai diketuk
// supaya delapan rekam perawatan tidak terpampang sekaligus di layar yang
// sering dibuka di ruang bersama.
//
// Blok catatan tetap ada di markup dan hanya ditutup dengan atribut `hidden`
// (bukan dilepas dari pohon): itu membuat penanda `aria-controls` menunjuk
// elemen yang benar-benar ada, dan jujur — teks ini memang sudah ikut terkirim
// ke perangkat klien bersama halaman, persis seperti isi bab materi.
//
// `data-sesi-*` bukan hiasan: TANGGAL, STATUS, dan penanda "berikutnya" adalah
// kontrak yang diuji, sementara kelas Tailwind berubah tiap kali desain disetel.
export function KartuSesi({
  sesi,
  berikutnya,
}: {
  sesi: SesiRingkas;
  berikutnya: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const idCatatan = useId();
  const t = formatTanggalPendek(sesi.tanggal);

  // `catatan` & `rekomendasi` NOT NULL DEFAULT '' — sesi yang belum dijalani
  // membawa string kosong, bukan null. Pemeriksaan `!= null` selalu benar dan
  // akan membuat setiap kartu tampak punya catatan.
  const adaCatatan = sesi.catatan.trim() !== "";
  const adaRekomendasi = sesi.rekomendasi.trim() !== "";
  const adaIsi = adaCatatan || adaRekomendasi;

  return (
    <div
      data-sesi-tanggal={sesi.tanggal}
      data-sesi-status={sesi.status}
      data-sesi-berikutnya={berikutnya ? "ya" : undefined}
      className={`overflow-hidden rounded-xl bg-[#FFFEFA] ${
        berikutnya
          ? "border-[1.6px] border-dashed border-gold bg-[#FDFAF1]"
          : "border border-black/10"
      }`}
    >
      <button
        type="button"
        disabled={!adaIsi}
        onClick={() => setBuka((v) => !v)}
        aria-expanded={adaIsi ? buka : undefined}
        aria-controls={adaIsi ? idCatatan : undefined}
        className="flex w-full items-center gap-3.5 p-4 text-left disabled:cursor-default"
      >
        <span className="w-[52px] flex-none border-r border-black/10 pr-3 text-center font-mono text-[11px] leading-tight text-ink-soft">
          <b className="block text-[19px] font-medium text-night">{t.hari}</b>
          {t.bulan}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm text-ink">{sesi.namaLayanan}</b>
          <span className="text-xs text-ink-soft">{sesi.namaMitra}</span>
        </span>
        <span
          className={`flex-none rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${PIL[sesi.status]}`}
        >
          {LABEL[sesi.status]}
        </span>
        {adaIsi && (
          <svg
            width="14"
            viewBox="0 0 14 8"
            aria-hidden
            className={`flex-none text-ink-soft transition-transform ${buka ? "rotate-180" : ""}`}
          >
            <path
              d="M1 1l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {adaIsi && (
        <div
          hidden={!buka}
          id={idCatatan}
          className="border-t border-dashed border-black/10 bg-paper p-4"
        >
          {adaCatatan && (
            <p className="mb-2.5 text-[13.5px] text-[#3C4C42]">
              <b className="mb-1 block text-[11px] uppercase tracking-wider text-gold">
                {`Catatan ${sesi.namaMitra}`}
              </b>
              {sesi.catatan}
            </p>
          )}
          {adaRekomendasi && (
            <p className="text-[13.5px] text-[#3C4C42]">
              <b className="mb-1 block text-[11px] uppercase tracking-wider text-gold">
                Rekomendasi untuk Anda
              </b>
              {sesi.rekomendasi}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
