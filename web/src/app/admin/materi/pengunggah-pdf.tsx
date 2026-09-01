"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { rasterisasiPdf } from "@/lib/materi/pdf-klien";
import {
  periksaBerkasPdf, MAKS_HALAMAN, KONKURENSI_UNGGAH,
} from "@/lib/materi/rasterisasi";
import { terbitkanUrlUnggahHalaman, catatHalamanMateri } from "./unggah";

const BUCKET = "materi-halaman";

type Fase = "diam" | "membaca" | "mengunggah" | "selesai" | "galat";

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

      const izin = await terbitkanUrlUnggahHalaman(materiId, halaman.length);
      if (!izin.ok) { setFase("galat"); setPesan(izin.pesan); return; }
      // Disalin ke variabel sendiri: TypeScript tidak menyempitkan tipe `izin`
      // (union ok/gagal) ke dalam `function pekerja()` di bawah karena deklarasi
      // fungsi di-hoist, sehingga `izin.unggahan` di dalamnya tetap dianggap
      // mungkin tidak ada walau baris di atas sudah memastikannya.
      const daftarUnggahan = izin.unggahan;

      setFase("mengunggah");
      setProgres({ selesai: 0, total: halaman.length });
      const supabase = createBrowserSupabase();

      // Konkurensi dibatasi: koneksi rumahan yang lambat akan saling
      // menggagalkan unggahan bila 300 halaman dikirim sekaligus.
      let berikutnya = 0;
      let terunggah = 0;
      async function pekerja() {
        while (berikutnya < halaman.length) {
          const i = berikutnya++;
          const h = halaman[i];
          const u = daftarUnggahan[i];
          // `u.objek` berakhiran `.webp` (namaObjekHalaman) TAPI itu KONVENSI
          // PENAMAAN, bukan jaminan isi byte: bila peramban admin tidak
          // mendukung ekspor WebP, canvas.toBlob() di pdf-klien.ts diam-diam
          // menghasilkan PNG (bukan gagal — lihat komentar di sana), dan PNG
          // itulah yang terunggah di bawah path `.webp`. Ini AMAN: rute
          // penyaji (api/materi/[id]/halaman/[n]/route.ts) selalu mendekode
          // ulang lewat sharp() lalu memaksa .webp({...}) saat membakar
          // watermark — sharp membaca byte sungguhan, bukan ekstensi nama
          // berkas — jadi objek berisi PNG tetap sampai ke pasien sebagai
          // WebP asli.
          const { error } = await supabase.storage
            .from(BUCKET)
            .uploadToSignedUrl(u.objek, u.token, h.blob);
          if (error) throw new Error(`Halaman ${h.halaman} gagal diunggah.`);
          terunggah++;
          setProgres({ selesai: terunggah, total: halaman.length });
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(KONKURENSI_UNGGAH, halaman.length) }, pekerja),
      );

      // Baru SESUDAH seluruh unggahan sukses. Gagal di tengah = tidak ada baris
      // tercatat = materi tampak "belum ada isi", bukan setengah terisi.
      const catat = await catatHalamanMateri(
        materiId,
        halaman.map((h, i) => ({
          halaman: h.halaman, objek: daftarUnggahan[i].objek,
          lebar: h.lebar, tinggi: h.tinggi,
        })),
      );
      if (!catat.ok) { setFase("galat"); setPesan(catat.pesan); return; }

      setFase("selesai");
      setPesan(`${catat.jumlah} halaman tersimpan.`);
      onSelesai?.();
    } catch (e) {
      setFase("galat");
      setPesan(e instanceof Error ? e.message : "Gagal memproses PDF.");
    }
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
