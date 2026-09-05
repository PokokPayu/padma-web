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

export function PengunggahVideo({
  materiId,
  onSelesai,
}: {
  materiId: string;
  onSelesai?: () => void;
}) {
  const [keadaan, setKeadaan] = useState<Keadaan>({ fase: "diam" });
  const [peringatan, setPeringatan] = useState<string | null>(null);
  // Berkas DIPERTAHANKAN sesudah gagal supaya mengulang cukup satu klik, bukan
  // memilih ulang berkas 200 MB dari awal. Disimpan di REF (bukan state) sebab
  // ia hanya dibaca dari event handler (`onClick` "Coba lagi"), tidak pernah
  // dari render — `adaBerkas` di bawah adalah salinan STATE-nya, sengaja
  // dipisah supaya render tidak pernah membaca `.current` (react-hooks/refs).
  const berkasRef = useRef<File | null>(null);
  const [adaBerkas, setAdaBerkas] = useState(false);

  async function jalankan(berkas: File) {
    berkasRef.current = berkas;
    setAdaBerkas(true);
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
    //
    // `status` disertakan (fix F3, video-r2 fix wave) — sebelumnya dibuang
    // total (`selesai(false)`), sehingga "Unggahan terputus." tampil sama
    // baik untuk koneksi yang benar-benar putus MAUPUN untuk CORS bucket
    // yang belum memuat domain produksi (spec §13b A-5, satu-satunya butir
    // go-live yang belum beres): keduanya memicu `onerror`, tapi hanya yang
    // kedua bisa dikenali dari kode status yang menyertainya bila server
    // sempat menjawab (mis. 403 dari penolakan tanda tangan/Content-Length,
    // yang jatuh di `onload`, bukan `onerror`).
    const hasil = await new Promise<{ ok: boolean; status: number }>((selesai) => {
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
      xhr.onload = () => {
        selesai({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
      };
      xhr.onerror = () => selesai({ ok: false, status: xhr.status });
      xhr.send(berkas);
    });

    if (!hasil.ok) {
      setKeadaan({
        fase: "gagal",
        pesan: `Unggahan terputus (kode ${hasil.status}). Berkasnya masih terpilih — coba lagi.`,
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
    onSelesai?.();
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
          {adaBerkas && (
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
