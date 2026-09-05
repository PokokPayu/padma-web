"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pemutar video pasien.
 *
 * Elemen <video> dirender TANPA atribut `src`. URL-nya diambil sesudah halaman
 * hidup lalu dipasang lewat PROPERTI `video.src` — dan karena properti tidak
 * menulis balik ke DOM, ia tidak muncul di view-source maupun di panel Elements
 * DevTools. Ia hanya hidup di memori JS dan di tab Network.
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
