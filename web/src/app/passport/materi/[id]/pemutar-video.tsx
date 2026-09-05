"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pemutar video pasien.
 *
 * Elemen <video> dirender TANPA atribut `src`. URL-nya diambil sesudah halaman
 * hidup lalu dipasang lewat PROPERTI `video.src` — ini menjaga URL keluar dari
 * view-source (Ctrl+U) dan dari RSC payload, sebab keduanya hanya memuat apa
 * yang server kirim/render, bukan mutasi sesudah hidrasi, dan URL ini tidak
 * pernah dilewatkan sebagai prop.
 *
 * Klaim ini SENGAJA dibatasi: `src` pada elemen media adalah atribut IDL yang
 * MEREFLEKSI — menugaskan `video.src = url` menulis balik ke atribut DOM-nya,
 * jadi URL-nya TETAP terlihat di panel Elements DevTools (inspect element).
 * Tidak ada perbaikan teknis yang murah untuk menutup jalur itu tanpa
 * mengorbankan streaming (blob URL menuntut mengunduh seluruh video lebih
 * dulu) — lapisan ini menghalangi pasien awam, bukan pasien yang membuka
 * DevTools.
 *
 * Pengerasan di bawah jujur disebut deterrent, bukan proteksi: pasien yang bisa
 * menonton juga bisa merekam layar. Yang dihalangi adalah pasien awam.
 */
export function PemutarVideo({ materiId }: { materiId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    let batal = false;
    void (async () => {
      const r = await fetch(`/api/materi/${materiId}/video`);
      if (!r.ok) {
        if (!batal) setGagal(true);
        return;
      }
      const { url } = (await r.json()) as { url: string };
      if (!batal && ref.current) ref.current.src = url;
    })();
    return () => { batal = true; };
  }, [materiId]);

  if (gagal) {
    return (
      <p className="text-[13px] text-ink-soft">
        Video ini belum bisa diputar. Muat ulang halaman, atau hubungi tim PADMA.
      </p>
    );
  }

  return (
    <video
      ref={ref}
      controls
      playsInline
      controlsList="nodownload"
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
      className="aspect-video w-full rounded-xl bg-black [-webkit-touch-callout:none]"
    />
  );
}
