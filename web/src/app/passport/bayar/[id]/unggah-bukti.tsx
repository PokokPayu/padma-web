"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAKS_BYTE_BUKTI } from "@/lib/bukti/kunci";

/**
 * UNGGAH BUKTI TRANSFER (spec C2 P3, P7).
 *
 * ===== KENAPA BUKAN `<input type="file">` APA ADANYA =====
 * Versi sebelumnya memakai kontrol bawaan peramban dengan `text-[12px]` dan
 * tanpa satu pun kelas, di halaman yang seluruhnya kartu bergaya. Akibatnya ia
 * tidak terbaca sebagai tombol sama sekali — dan corong pembayaran yang
 * tombolnya tidak terlihat adalah corong yang mati tanpa satu pun galat di log.
 *
 * Input aslinya tetap ada dan tetap FOKUSABEL: `sr-only`, bukan `hidden` dan
 * bukan `display:none`. Papan ketik dan pembaca layar tetap sampai kepadanya,
 * dan `aria-label`-nya menyebut pekerjaan yang sama dengan yang terbaca mata.
 *
 * ===== GAMBAR DIKECILKAN DI PERAMBAN =====
 * Bukan sekadar hemat penyimpanan. Tangkapan layar m-banking memuat nama
 * pemilik rekening, nomor rekening, dan sering kali SALDO — mengecilkannya
 * menurunkan ketajaman detail yang PADMA tidak butuhkan sama sekali. Batas
 * ukurannya tetap ditegakkan bucket, karena pengecilan di sisi klien adalah
 * kenyamanan dan kenyamanan bisa dilewati.
 */
export function UnggahBukti({
  permintaanId,
  adaBukti,
}: {
  permintaanId: string;
  adaBukti: boolean;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [mengunggah, setMengunggah] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const medan = useRef<HTMLInputElement>(null);

  async function kirim(berkas: File) {
    setPesan(null);
    setMengunggah(true);
    try {
      const kecil = await kecilkan(berkas);
      if (kecil.size > MAKS_BYTE_BUKTI) {
        setPesan("Gambarnya terlalu besar. Coba potret ulang dengan resolusi lebih kecil.");
        return;
      }
      const fd = new FormData();
      fd.set("permintaan", permintaanId);
      fd.set("bukti", kecil, "bukti.jpg");

      const res = await fetch("/api/bukti", { method: "POST", body: fd });
      if (!res.ok) {
        const isi = (await res.json().catch(() => ({}))) as { pesan?: string };
        setPesan(isi.pesan ?? "Gagal mengunggah.");
        return;
      }
      mulai(() => router.refresh());
    } finally {
      setMengunggah(false);
      // Medan dikosongkan supaya memilih BERKAS YANG SAMA sesudah gagal tetap
      // memicu `onChange`. Tanpa ini, klien yang unggahannya gagal sekali
      // harus memilih berkas lain dulu untuk bisa mencoba lagi.
      if (medan.current) medan.current.value = "";
    }
  }

  const sibuk = mengunggah || pending;

  return (
    <>
      <label className="block">
        <input
          ref={medan}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={sibuk}
          aria-label="Unggah bukti transfer"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void kirim(f);
          }}
          className="peer sr-only"
        />
        <span className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-gold px-4 text-center text-[14px] font-bold text-[#FFF8EA] peer-disabled:opacity-60 peer-focus-visible:ring-2 peer-focus-visible:ring-night">
          {sibuk ? "Mengunggah…" : adaBukti ? "Ganti bukti transfer" : "Unggah bukti transfer"}
        </span>
      </label>

      <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
        Boleh tutup dulu bagian saldo sebelum memotret — yang tim butuhkan hanya nominal, tanggal,
        dan nama penerimanya.
      </p>

      {adaBukti && (
        <p className="mt-2 text-[12px] text-ink-soft">Bukti sebelumnya sudah terkirim.</p>
      )}
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </>
  );
}

/**
 * Mengecilkan gambar di peramban sebelum dikirim.
 *
 * Bila apa pun gagal — kanvas diblokir, berkas bukan gambar yang bisa dimuat —
 * berkas ASLINYA yang dikirim. Corong pembayaran tidak boleh mati karena
 * optimasi: yang penting buktinya sampai, bukan ukurannya ideal.
 */
async function kecilkan(berkas: File): Promise<File | Blob> {
  try {
    const bitmap = await createImageBitmap(berkas);
    const skala = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const kanvas = document.createElement("canvas");
    kanvas.width = Math.round(bitmap.width * skala);
    kanvas.height = Math.round(bitmap.height * skala);
    const ctx = kanvas.getContext("2d");
    if (!ctx) return berkas;
    ctx.drawImage(bitmap, 0, 0, kanvas.width, kanvas.height);
    const blob = await new Promise<Blob | null>((r) => kanvas.toBlob(r, "image/jpeg", 0.7));
    return blob ?? berkas;
  } catch {
    return berkas;
  }
}
