"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { MAKS_BYTE_BUKTI } from "@/lib/bukti/kunci";

/**
 * KARTU TAGIHAN PENGAJUAN + UNGGAH BUKTI (spec C2 P3, P7).
 *
 * Ini kanal kedua dari dua yang dikerjakan C2 (yang pertama pesan WhatsApp
 * siap-salin). Yang harus terbaca sekali lihat: berapa, sampai kapan, dan apa
 * yang terjadi kalau lewat.
 *
 * ===== GAMBAR DIKECILKAN DI PERAMBAN =====
 * Bukan sekadar hemat penyimpanan. Tangkapan layar m-banking memuat nama
 * pemilik rekening, nomor rekening, dan sering kali SALDO — mengecilkannya
 * menurunkan ketajaman detail yang PADMA tidak butuhkan sama sekali. Batas
 * ukurannya tetap ditegakkan bucket, karena pengecilan di sisi klien adalah
 * kenyamanan dan kenyamanan bisa dilewati.
 */
export function KartuTagihan({
  permintaanId,
  namaLayanan,
  tanggal,
  jam,
  hargaLayanan,
  hargaTransport,
  labelJenjang,
  total,
  kalimatBelumLengkap,
  statusBayar,
  tenggat,
  adaBukti,
}: {
  permintaanId: string;
  namaLayanan: string;
  /** Sudah diformat di server. */
  tanggal: string;
  jam: string;
  /** Rupiah, sudah diformat di server. `null` bila bagian itu belum diketahui. */
  hargaLayanan: string | null;
  hargaTransport: string | null;
  /** Mis. ">10–15 km". */
  labelJenjang: string | null;
  total: string | null;
  /** Kalimat siap tampil bila `total === null`. Dirangkai di server. */
  kalimatBelumLengkap: string | null;
  statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  adaBukti: boolean;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  async function kirim(berkas: File) {
    setPesan(null);
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
  }

  return (
    <article
      className="mb-3.5 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] p-4"
      data-tagihan={permintaanId}
    >
      <b className="block text-sm text-night">{namaLayanan}</b>
      <span className="block text-[12px] text-ink-soft">
        {tanggal} · {jam}
      </span>

      {total === null ? (
        <p className="mt-2 text-[13px] text-[#77321F]">
          {kalimatBelumLengkap ?? "Totalnya sedang dilengkapi tim PADMA."}
        </p>
      ) : (
        <dl className="mt-2 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Layanan</dt>
            <dd className="text-night">{hargaLayanan}</dd>
          </div>
          <div className="mt-0.5 flex justify-between">
            <dt className="text-ink-soft">
              Transport{labelJenjang ? ` · ${labelJenjang}` : ""}
            </dt>
            <dd className="text-night">{hargaTransport}</dd>
          </div>
          {/* `data-total` DIPERTAHANKAN di elemen totalnya. E2E
              tests/e2e/bayar-pengajuan.e2e.ts mencarinya, dan penanda itu
              justru yang dulu menangkap cacat embed RLS yang membuat setiap
              klien melihat "Totalnya sedang dilengkapi tim". */}
          <div className="mt-1.5 flex justify-between border-t border-black/10 pt-1.5">
            <dt className="font-bold text-night">Total</dt>
            <dd className="text-[15px] font-bold text-night" data-total>
              {total}
            </dd>
          </div>
        </dl>
      )}

      {statusBayar === "lunas" ? (
        <p className="mt-2 text-[13px] font-semibold text-leaf">
          Pembayaran terverifikasi — jadwal Anda sedang dikunci tim.
        </p>
      ) : statusBayar === "menunggu_verifikasi" ? (
        <p className="mt-2 text-[13px] text-[#8A6A1B]">
          Bukti diterima. Tim PADMA sedang mencocokkannya dengan mutasi rekening.
        </p>
      ) : (
        <>
          {tenggat && (
            <p className="mt-1 text-[12.5px] text-clay">
              Bayar dalam {labelSisaWaktu(tenggat)} — lewat dari itu, pengajuan ini batal dan
              slotnya dilepas untuk klien lain.
            </p>
          )}
          <label className="mt-3 block text-[12.5px]">
            <span className="font-semibold text-ink-soft">Unggah bukti transfer</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void kirim(f);
              }}
              className="mt-1 block w-full text-[12px]"
            />
            <span className="mt-1 block text-[11.5px] text-ink-soft">
              Boleh tutup dulu bagian saldo sebelum memotret — yang tim butuhkan hanya nominal,
              tanggal, dan nama penerimanya.
            </span>
          </label>
        </>
      )}

      {adaBukti && statusBayar === "belum" && (
        <p className="mt-2 text-[12px] text-ink-soft">Bukti sebelumnya sudah terkirim.</p>
      )}
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </article>
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
    const blob = await new Promise<Blob | null>((r) =>
      kanvas.toBlob(r, "image/jpeg", 0.7),
    );
    return blob ?? berkas;
  } catch {
    return berkas;
  }
}
