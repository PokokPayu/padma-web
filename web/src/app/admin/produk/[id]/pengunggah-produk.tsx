"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { rasterisasiPdf } from "@/lib/materi/pdf-klien";
import {
  periksaBerkasPdf, MAKS_HALAMAN, KONKURENSI_UNGGAH,
} from "@/lib/materi/rasterisasi";
import { periksaBerkasVideo, MAKS_BYTE_VIDEO } from "@/lib/materi/video";
import { moovDiDepan } from "@/lib/materi/moov";
import {
  terbitkanUrlUnggahVideoProduk,
  catatVideoProduk,
  terbitkanUrlUnggahHalamanProduk,
  catatHalamanProduk,
  terbitkanUrlUnggahPdfProduk,
  catatPdfProduk,
  lepasIsiProduk,
} from "./unggah";

const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";
/** Cukup untuk menampung ftyp + moov pada berkas faststart yang wajar. */
const BYTE_KEPALA = 512 * 1024;

// ===========================================================================
// VIDEO — mirror `admin/materi/pengunggah-video.tsx`, menulis lewat
// `./unggah.ts` (produk), bukan `./unggah-video.ts` (materi).
// ===========================================================================

type KeadaanVideo =
  | { fase: "diam" }
  | { fase: "unggah"; persen: number }
  | { fase: "sukses" }
  | { fase: "gagal"; pesan: string };

export function PengunggahVideoProduk({ productId }: { productId: string }) {
  const router = useRouter();
  const [keadaan, setKeadaan] = useState<KeadaanVideo>({ fase: "diam" });
  const [peringatan, setPeringatan] = useState<string | null>(null);
  // Berkas DIPERTAHANKAN sesudah gagal supaya mengulang cukup satu klik —
  // persis alasan yang sama di `admin/materi/pengunggah-video.tsx`.
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

    // Peringatan faststart, BUKAN blokir — videonya tetap sah, hanya lambat
    // mulai. `null` berarti tidak diketahui.
    if (periksa.nilai === "video/mp4") {
      const kepala = new Uint8Array(await berkas.slice(0, BYTE_KEPALA).arrayBuffer());
      if (moovDiDepan(kepala) === false) {
        setPeringatan(
          "Video ini bukan 'faststart': pembeli harus menunggu seluruh berkas " +
            "terunduh sebelum gambar pertama muncul. Videonya tetap bisa " +
            "diunggah — ekspor ulang dengan opsi faststart bila ingin cepat mulai.",
        );
      }
    }

    setKeadaan({ fase: "unggah", persen: 0 });
    const terbit = await terbitkanUrlUnggahVideoProduk(productId, periksa.nilai, berkas.size);
    if (!terbit.ok) {
      setKeadaan({ fase: "gagal", pesan: terbit.pesan });
      return;
    }

    // XMLHttpRequest, bukan fetch: hanya XHR yang memberi progres unggah.
    const hasil = await new Promise<{ ok: boolean; status: number }>((selesai) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", terbit.url);
      xhr.setRequestHeader("Content-Type", periksa.nilai);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setKeadaan({ fase: "unggah", persen: Math.round((e.loaded / e.total) * 100) });
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

    const catat = await catatVideoProduk(productId, terbit.objek, periksa.nilai, berkas.size);
    if (!catat.ok) {
      setKeadaan({ fase: "gagal", pesan: catat.pesan });
      return;
    }
    setKeadaan({ fase: "sukses" });
    // Kartu "Isi" & saklar tayang milik `<FormProduk/>` membaca `produk.adaIsi`
    // yang dipasok server — tanpa refresh, statusnya basi begitu unggahan
    // sukses secara lokal, persis alasan `router.refresh()` di `IsiVideo`
    // (`admin/materi/form-materi.tsx`).
    router.refresh();
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

// ===========================================================================
// PDF — rasterisasi halaman (mirror `admin/materi/pengunggah-pdf.tsx`), lalu
// bila `bolehUnduh` menyala, unggahan tambahan PDF utuh ke `produk-berkas`.
// ===========================================================================

type FasePdf = "diam" | "membaca" | "mengunggah" | "mengunggah-utuh" | "selesai" | "galat";

export function PengunggahPdfProduk({
  productId,
  bolehUnduh,
}: {
  productId: string;
  bolehUnduh: boolean;
}) {
  const router = useRouter();
  const [fase, setFase] = useState<FasePdf>("diam");
  const [progres, setProgres] = useState({ selesai: 0, total: 0 });
  const [pesan, setPesan] = useState("");

  async function tangani(berkas: File) {
    const periksa = periksaBerkasPdf(berkas.name, berkas.size);
    if (!periksa.ok) { setFase("galat"); setPesan(periksa.pesan); return; }

    try {
      setFase("membaca"); setPesan("");
      const halaman = await rasterisasiPdf(berkas, (selesai, total) =>
        setProgres({ selesai, total }),
      );
      if (halaman.length > MAKS_HALAMAN) {
        setFase("galat");
        setPesan(`PDF maksimal ${MAKS_HALAMAN} halaman; berkas ini ${halaman.length}.`);
        return;
      }

      const izin = await terbitkanUrlUnggahHalamanProduk(productId, halaman.length);
      if (!izin.ok) { setFase("galat"); setPesan(izin.pesan); return; }
      // Disalin ke variabel sendiri: TypeScript tidak menyempitkan tipe `izin`
      // ke dalam `pekerja()` di bawah — persis alasan yang sama di
      // `admin/materi/pengunggah-pdf.tsx`.
      const daftarUnggahan = izin.unggahan;

      setFase("mengunggah");
      setProgres({ selesai: 0, total: halaman.length });
      const supabase = createBrowserSupabase();

      let berikutnya = 0;
      let terunggah = 0;
      async function pekerja() {
        while (berikutnya < halaman.length) {
          const i = berikutnya++;
          const h = halaman[i];
          const u = daftarUnggahan[i];
          const { error } = await supabase.storage
            .from(BUCKET_HALAMAN)
            .uploadToSignedUrl(u.objek, u.token, h.blob);
          if (error) throw new Error(`Halaman ${h.halaman} gagal diunggah.`);
          terunggah++;
          setProgres({ selesai: terunggah, total: halaman.length });
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(KONKURENSI_UNGGAH, halaman.length) }, pekerja),
      );

      // Baru SESUDAH seluruh unggahan halaman sukses. Gagal di tengah = tidak
      // ada baris tercatat = produk tampak "belum ada isi", bukan setengah
      // terisi.
      const catat = await catatHalamanProduk(
        productId,
        halaman.map((h, i) => ({ halaman: h.halaman, objek: daftarUnggahan[i].objek })),
      );
      if (!catat.ok) { setFase("galat"); setPesan(catat.pesan); return; }

      // PDF utuh HANYA diunggah bila `boleh_unduh` menyala — produk yang
      // tidak mengizinkan unduhan tidak perlu menyimpan berkas mentahnya
      // sama sekali (spec §1, digital_products.boleh_unduh).
      if (bolehUnduh) {
        setFase("mengunggah-utuh");
        const terbitPdf = await terbitkanUrlUnggahPdfProduk(productId, berkas.size);
        if (!terbitPdf.ok) { setFase("galat"); setPesan(terbitPdf.pesan); return; }

        const { error: errPdf } = await supabase.storage
          .from(BUCKET_BERKAS)
          .uploadToSignedUrl(terbitPdf.objek, terbitPdf.token, berkas);
        if (errPdf) {
          setFase("galat");
          setPesan("Halaman tersimpan, tetapi PDF utuh gagal diunggah. Coba unggah ulang.");
          return;
        }

        const catatPdf = await catatPdfProduk(productId, berkas.size);
        if (!catatPdf.ok) { setFase("galat"); setPesan(catatPdf.pesan); return; }
      }

      setFase("selesai");
      setPesan(`${catat.jumlah} halaman tersimpan.`);
      router.refresh();
    } catch (e) {
      setFase("galat");
      setPesan(e instanceof Error ? e.message : "Gagal memproses PDF.");
    }
  }

  const sibuk = fase === "membaca" || fase === "mengunggah" || fase === "mengunggah-utuh";

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
          {fase === "membaca" && `Menyiapkan halaman ${progres.selesai}${progres.total > 0 ? ` dari ${progres.total}` : ""}…`}
          {fase === "mengunggah" && `Mengunggah halaman ${progres.selesai}${progres.total > 0 ? ` dari ${progres.total}` : ""}…`}
          {fase === "mengunggah-utuh" && "Mengunggah PDF utuh…"}
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
        Halaman PDF diubah menjadi gambar di peramban ini, lalu disimpan.
        {bolehUnduh
          ? " PDF aslinya ikut disimpan supaya pembeli bisa mengunduhnya."
          : " PDF aslinya tidak ikut tersimpan — simpan berkas Anda sendiri bila kelak perlu mengunggah ulang."}
      </p>
    </div>
  );
}

// ===========================================================================
// LEPAS ISI — hanya ditawarkan pada produk yang sudah ditarik (server
// memeriksanya ulang lewat `lepasIsiProduk`), mirror tombol "Lepas video"
// milik `IsiVideo` (`admin/materi/form-materi.tsx`).
// ===========================================================================

export function LepasIsiProduk({ productId }: { productId: string }) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          mulai(async () => {
            const r = await lepasIsiProduk(productId);
            if (r.ok) {
              // Lunak, tetapi tidak boleh senyap: sama seperti peringatan
              // `objekLamaTersisa` milik `PengunggahVideo` materi — objek
              // yatim memakan kuota dan hanya bisa dibersihkan seseorang yang
              // tahu ia ada.
              setPesan(
                r.objekTersisa
                  ? "Isi dilepas, tetapi sebagian berkas gagal dihapus dari penyimpanan. Beri tahu tim teknis agar tidak menumpuk."
                  : null,
              );
              router.refresh();
            } else {
              setPesan(r.pesan);
            }
          })
        }
        className="mt-2 rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-ink disabled:opacity-60"
      >
        Lepas isi
      </button>
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
