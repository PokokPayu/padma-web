"use client";

import { useRef, useState } from "react";
import { terbitkanUrlUnggahVideo, catatVideoMateri } from "./unggah-video";
import { periksaBerkasVideo, MAKS_BYTE_VIDEO } from "@/lib/materi/video";
import { moovDiDepan } from "@/lib/materi/moov";

/** Cukup untuk menampung ftyp + moov pada berkas faststart yang wajar. */
const BYTE_KEPALA = 512 * 1024;

type Keadaan =
  | { fase: "diam" }
  | { fase: "unggah"; persen: number }
  | { fase: "sukses" }
  | { fase: "gagal"; pesan: string };

export function PengunggahVideo({ materiId }: { materiId: string }) {
  const [keadaan, setKeadaan] = useState<Keadaan>({ fase: "diam" });
  const [peringatan, setPeringatan] = useState<string | null>(null);
  // Berkas DIPERTAHANKAN sesudah gagal supaya mengulang cukup satu klik, bukan
  // memilih ulang berkas 200 MB dari awal.
  const berkasRef = useRef<File | null>(null);

  async function jalankan(berkas: File) {
    berkasRef.current = berkas;
    setPeringatan(null);

    const periksa = periksaBerkasVideo(berkas.type, berkas.size);
    if (!periksa.ok) {
      setKeadaan({ fase: "gagal", pesan: periksa.pesan });
      return;
    }

    // Peringatan faststart, BUKAN blokir (spec §6): videonya tetap sah, hanya
    // lambat mulai. `null` berarti tidak diketahui — dan memperingatkan atas
    // ketidaktahuan kita sendiri adalah cara cepat membuat peringatan diabaikan.
    if (periksa.nilai === "video/mp4") {
      const kepala = new Uint8Array(
        await berkas.slice(0, BYTE_KEPALA).arrayBuffer(),
      );
      if (moovDiDepan(kepala) === false) {
        setPeringatan(
          "Video ini bukan 'faststart': pasien harus menunggu seluruh berkas " +
            "terunduh sebelum gambar pertama muncul. Videonya tetap bisa " +
            "diunggah — ekspor ulang dengan opsi faststart bila ingin cepat mulai.",
        );
      }
    }

    setKeadaan({ fase: "unggah", persen: 0 });
    const terbit = await terbitkanUrlUnggahVideo(
      materiId, periksa.nilai, berkas.size,
    );
    if (!terbit.ok) {
      setKeadaan({ fase: "gagal", pesan: terbit.pesan });
      return;
    }

    // XMLHttpRequest, bukan fetch: hanya XHR yang memberi progres unggah, dan
    // pada berkas 200 MB bilah progres adalah beda antara "sedang jalan" dan
    // "aplikasinya menggantung".
    const sukses = await new Promise<boolean>((selesai) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", terbit.url);
      xhr.setRequestHeader("Content-Type", terbit.mime);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setKeadaan({
            fase: "unggah",
            persen: Math.round((e.loaded / e.total) * 100),
          });
        }
      };
      xhr.onload = () => selesai(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => selesai(false);
      xhr.send(berkas);
    });

    if (!sukses) {
      setKeadaan({
        fase: "gagal",
        pesan: "Unggahan terputus. Berkasnya masih terpilih — coba lagi.",
      });
      return;
    }

    const catat = await catatVideoMateri(materiId, terbit.objek, terbit.mime);
    if (!catat.ok) {
      setKeadaan({ fase: "gagal", pesan: catat.pesan });
      return;
    }
    setKeadaan({ fase: "sukses" });
    if (catat.objekLamaTersisa) {
      // Lunak, tetapi tidak boleh senyap: objek yatim memakan kuota 10 GB dan
      // hanya bisa dibersihkan seseorang yang tahu ia ada.
      setPeringatan(
        "Video baru tersimpan, tetapi berkas video lama gagal dihapus dari " +
          "penyimpanan. Beri tahu tim teknis agar tidak menumpuk.",
      );
    }
  }

  return (
    <div className="mt-3">
      <input
        type="file"
        accept="video/mp4,video/webm"
        disabled={keadaan.fase === "unggah"}
        onChange={(e) => {
          const b = e.target.files?.[0];
          if (b) void jalankan(b);
        }}
      />
      <p className="mt-1 text-[11.5px] text-ink-soft">
        MP4 atau WebM, maksimal {Math.round(MAKS_BYTE_VIDEO / (1024 * 1024))} MB.
      </p>

      {peringatan !== null && (
        <p className="mt-2 text-[12px] text-amber-700">{peringatan}</p>
      )}
      {keadaan.fase === "unggah" && (
        <p className="mt-2 text-[12px]">Mengunggah… {keadaan.persen}%</p>
      )}
      {keadaan.fase === "sukses" && (
        <p className="mt-2 text-[12px] text-leaf">Video tersimpan.</p>
      )}
      {keadaan.fase === "gagal" && (
        <p className="mt-2 text-[12px] text-red-700">
          {keadaan.pesan}{" "}
          {berkasRef.current !== null && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                const b = berkasRef.current;
                if (b) void jalankan(b);
              }}
            >
              Coba lagi
            </button>
          )}
        </p>
      )}
    </div>
  );
}
