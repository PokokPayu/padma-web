"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { periksaBerkasSertifikat } from "@/lib/sertifikat/berkas";
import { terbitkanUrlUnggahSertifikat, catatSertifikat } from "./unggah-sertifikat";

const BUCKET = "sertifikat";

type Fase = "diam" | "mengunggah" | "selesai" | "galat";

export function PengunggahSertifikat({
  sessionId,
  sudahAda,
}: {
  sessionId: string;
  sudahAda: boolean;
}) {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>("diam");
  const [pesan, setPesan] = useState("");

  async function tangani(berkas: File) {
    const periksa = periksaBerkasSertifikat(berkas.name, berkas.size, berkas.type);
    if (!periksa.ok) {
      setFase("galat");
      setPesan(periksa.pesan);
      return;
    }

    setFase("mengunggah");
    setPesan("");

    const url = await terbitkanUrlUnggahSertifikat(sessionId, berkas.size, berkas.type);
    if (!url.ok) {
      setFase("galat");
      setPesan(url.pesan);
      return;
    }

    const supabase = createBrowserSupabase();
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(url.objek, url.token, berkas, { contentType: berkas.type });

    if (error) {
      setFase("galat");
      setPesan("Unggahan gagal di tengah jalan. Coba lagi.");
      return;
    }

    const catat = await catatSertifikat(sessionId, berkas.type);
    if (!catat.ok) {
      setFase("galat");
      setPesan(catat.pesan);
      return;
    }

    setFase("selesai");
    setPesan("Sertifikat tersimpan dan sudah bisa dibuka klien.");
    // Layar server ("Belum ada." dan label tombol "Unggah"/"Ganti") ikut
    // membaca `sudahAda` dari props server — pola yang sama dipakai
    // `IsiEbook`/`IsiVideo` di admin/materi/form-materi.tsx.
    router.refresh();
  }

  return (
    <div>
      <label className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg border border-panel-border bg-panel-surface px-3 text-[12.5px] font-bold text-panel-ink">
        {sudahAda ? "Ganti sertifikat" : "Unggah sertifikat"}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/webp"
          className="sr-only"
          disabled={fase === "mengunggah"}
          onChange={(e) => {
            const b = e.target.files?.[0];
            // Medan dikosongkan supaya memilih BERKAS YANG SAMA dua kali tetap
            // memicu onChange — tanpa ini, unggah ulang setelah gagal diam saja.
            e.target.value = "";
            if (b) void tangani(b);
          }}
        />
      </label>

      {fase === "mengunggah" && (
        <p className="mt-2 text-[12px] text-panel-muted">Mengunggah…</p>
      )}
      {fase === "galat" && <p className="mt-2 text-[12px] font-bold text-clay">{pesan}</p>}
      {fase === "selesai" && <p className="mt-2 text-[12px] font-bold text-leaf">{pesan}</p>}
    </div>
  );
}
