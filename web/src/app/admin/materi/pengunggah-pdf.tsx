"use client";

import { useState } from "react";
import { unggahPdfKeMateri, type FaseUnggah } from "./unggah-pdf-klien";

type Fase = "diam" | FaseUnggah | "selesai" | "galat";

/**
 * Pengunggah PDF untuk materi yang SUDAH ada ("Kelola isi").
 *
 * Seluruh kerja unggahnya hidup di `unggahPdfKeMateri` — modul yang sama yang
 * dipakai formulir "Materi baru" sejak butir 6. Komponen ini tinggal fase dan
 * kalimatnya di layar.
 */
export function PengunggahPdf({
  materiId,
  onSelesai,
}: {
  materiId: string;
  onSelesai?: () => void;
}) {
  const [fase, setFase] = useState<Fase>("diam");
  const [progres, setProgres] = useState({ selesai: 0, total: 0 });
  const [pesan, setPesan] = useState("");

  async function tangani(berkas: File) {
    setPesan("");
    const hasil = await unggahPdfKeMateri(materiId, berkas, (f, selesai, total) => {
      setFase(f);
      setProgres({ selesai, total });
    });
    if (!hasil.ok) {
      setFase("galat");
      setPesan(hasil.pesan);
      return;
    }
    setFase("selesai");
    setPesan(`${hasil.jumlah} halaman tersimpan.`);
    onSelesai?.();
  }

  const sibuk = fase === "membaca" || fase === "mengunggah";

  return (
    <div className="mt-3">
      <label className="block">
        <span className="text-[12.5px] font-bold text-ink-soft">Berkas PDF</span>
        <input
          type="file"
          accept="application/pdf"
          disabled={sibuk}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void tangani(f);
          }}
          className="mt-1.5 block w-full text-[13px]"
        />
      </label>

      {sibuk && (
        <p role="status" aria-live="polite" className="mt-2 text-[12.5px] text-ink-soft">
          {fase === "membaca" ? "Menyiapkan halaman" : "Mengunggah"} {progres.selesai}
          {progres.total > 0 ? ` dari ${progres.total}` : ""}…
        </p>
      )}
      {pesan && (
        <p
          role="status"
          className={`mt-2 text-[12.5px] ${fase === "galat" ? "text-clay" : "text-leaf"}`}
        >
          {pesan}
        </p>
      )}
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
        Halaman PDF diubah menjadi gambar di peramban ini, lalu disimpan. PDF
        aslinya tidak ikut tersimpan — simpan berkas Anda sendiri bila kelak
        perlu mengunggah ulang.
      </p>
    </div>
  );
}
