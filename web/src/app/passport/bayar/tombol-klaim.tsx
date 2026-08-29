"use client";

import { useState, useTransition } from "react";
import { klaimSudahBayar } from "@/lib/passport/aksi";

// Tombol hanya mengirim JENIS + ID item. Status tujuannya ditentukan server —
// komponen klien tidak pernah menyebut nilai status apa pun.
export function TombolKlaim({
  jenis,
  id,
  waLink,
  label,
}: {
  jenis: "paket" | "sesi";
  id: string;
  waLink: string;
  label: string;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  function klik() {
    mulai(async () => {
      const r = await klaimSudahBayar(jenis, id);
      if (!r.ok) {
        setPesan(r.pesan);
        return;
      }
      // Bukti pembayaran tetap dikirim ke WhatsApp admin: verifikasi memang
      // manual, dan halaman ini jujur mengatakannya.
      const teks = `Halo PADMA, saya sudah membayar untuk:\n${label}\n\nBerikut bukti pembayarannya.`;
      window.open(`https://wa.me/${waLink}?text=${encodeURIComponent(teks)}`, "_blank", "noopener");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={klik}
        disabled={pending}
        className="mt-2.5 min-h-[44px] rounded-lg bg-[#1FAF57] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
      >
        {pending ? "Memproses…" : "Saya sudah bayar — kirim bukti via WA"}
      </button>
      {pesan && <p className="mt-2 text-xs text-clay">{pesan}</p>}
    </>
  );
}
