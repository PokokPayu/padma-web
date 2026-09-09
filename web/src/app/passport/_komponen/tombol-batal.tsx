"use client";

import { useState, useTransition } from "react";
import { batalkanPengajuan } from "@/lib/passport/aksi";

/**
 * Membatalkan satu pengajuan jadwal yang masih di antrean (spec C1 J8).
 *
 * Ada karena admin tidak lagi menolak pengajuan: tanpa tombol ini, klien yang
 * mengajukan lima tanggal yang tidak bisa dilayani terkunci selamanya — batas
 * antreannya penuh dan tidak seorang pun punya cara membereskannya.
 *
 * Dua ketukan, bukan satu. Bukan basa-basi: kartu ini berdiri di beranda
 * Passport yang dibuka sambil lalu, tombolnya kecil, dan yang hilang bila salah
 * tekan adalah tempat dalam antrean yang mungkin sudah ditunggu berhari-hari.
 * Pengajuan yang sudah DIKONFIRMASI tidak pernah sampai ke sini — komponen ini
 * hanya dirender untuk yang masih di antrean, dan basis data menolaknya lagi
 * bila jalur ini entah bagaimana dipanggil untuk sesi yang sudah terjadwal.
 */
export function TombolBatal({ permintaanId }: { permintaanId: string }) {
  const [pending, mulai] = useTransition();
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  if (pesan) {
    return <span className="mt-1 block text-[12px] font-semibold text-clay">{pesan}</span>;
  }

  if (!konfirmasi) {
    return (
      <button
        type="button"
        onClick={() => setKonfirmasi(true)}
        // `block`, bukan inline: sebagai elemen inline ia menempel langsung di
        // ujung kalimat status ("Menunggu pembayaranBatalkan pengajuan ini"),
        // dan `mt-1` tidak berlaku bagi kotak inline sehingga tidak ada yang
        // memisahkannya.
        className="mt-2 block text-left text-[12px] font-semibold text-ink-soft underline underline-offset-2"
      >
        Batalkan pengajuan ini
      </button>
    );
  }

  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
      <span className="text-ink-soft">Batalkan pengajuan ini?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          mulai(async () => {
            const r = await batalkanPengajuan(permintaanId);
            if (!r.ok) setPesan(r.pesan);
          })
        }
        className="rounded-lg border border-clay/40 px-2.5 py-1 font-bold text-clay disabled:opacity-60"
      >
        {pending ? "Membatalkan…" : "Ya, batalkan"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setKonfirmasi(false)}
        className="font-semibold text-ink-soft underline underline-offset-2"
      >
        Tidak jadi
      </button>
    </span>
  );
}
