"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ambilProdukGratis } from "./ambil";

// Tombol hanya mengirim slug produk. Sisanya — sesi ada atau tidak, produknya
// tayang, harganya benar-benar nol, client_id-nya siapa — diputuskan server
// action lalu RPC di basis data (lihat komentar `ambil.ts`).
export function TombolAmbil({ slug }: { slug: string }) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [selesai, setSelesai] = useState(false);
  const router = useRouter();

  function klik() {
    mulai(async () => {
      setPesan(null);
      const hasil = await ambilProdukGratis(slug);
      if (!hasil.ok) {
        setPesan(hasil.pesan);
        return;
      }
      setSelesai(true);
      router.refresh();
    });
  }

  if (selesai) {
    return (
      <p className="mt-4 rounded-lg bg-leaf-soft px-4 py-3 text-[13.5px] font-semibold text-leaf">
        Produk ini sudah masuk ke Pembelian Saya.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={klik}
        disabled={pending}
        className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Memproses..." : "Ambil gratis"}
      </button>
      {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
    </div>
  );
}
