"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { MIME_SAMPUL, urlSampulPublik } from "@/lib/produk/objek";
import { terbitkanUrlSampul, catatSampul } from "./aksi-isi";

/**
 * Sampul produk (`materiId` null) atau materi. Unggah langsung dari peramban
 * ke bucket publik `produk-sampul` lewat URL bertanda tangan; nama objeknya
 * dipilih server dan diperiksa ulang saat dicatat.
 */
export function PengunggahSampul({
  productId,
  materiId,
  sampulObjek,
}: {
  productId: string;
  materiId: string | null;
  sampulObjek: string | null;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const url = urlSampulPublik(sampulObjek);

  function unggah(berkas: File) {
    mulai(async () => {
      setPesan(null);
      const izin = await terbitkanUrlSampul(productId, materiId, berkas.type, berkas.size);
      if (!izin.ok) { setPesan(izin.pesan); return; }

      const { error } = await createBrowserSupabase().storage
        .from("produk-sampul")
        .uploadToSignedUrl(izin.objek, izin.token, berkas, { contentType: berkas.type });
      if (error) { setPesan("Sampul gagal diunggah. Coba lagi."); return; }

      const catat = await catatSampul(productId, materiId, izin.objek);
      if (!catat.ok) { setPesan(catat.pesan); return; }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className={`${materiId ? "h-14 w-14" : "h-24 w-32"} flex-none overflow-hidden rounded-lg border border-panel-border bg-panel-bg`}
      >
        {url ? (
          <>
          {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau admin dari bucket publik, tanpa optimasi */}
          <img src={url} alt="" className="h-full w-full object-cover" />
          </>
        ) : (
          <span className="flex h-full items-center justify-center text-[10.5px] text-panel-muted">Tanpa sampul</span>
        )}
      </div>
      <label className="cursor-pointer text-[12px] font-bold text-panel-ink underline">
        {pending ? "Mengunggah…" : url ? "Ganti sampul" : "Unggah sampul"}
        <input
          type="file"
          accept={MIME_SAMPUL.join(",")}
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const berkas = e.target.files?.[0];
            e.target.value = "";
            if (berkas) unggah(berkas);
          }}
        />
      </label>
      {pesan && <p className="text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
