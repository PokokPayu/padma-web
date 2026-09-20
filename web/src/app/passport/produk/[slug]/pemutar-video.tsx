"use client";

import { useEffect, useRef } from "react";

/**
 * Pemutar video produk.
 *
 * Berbeda dari `passport/materi/[id]/pemutar-video.tsx`: rute video produk
 * (`/api/produk/[id]/video`) menjawab dengan REDIRECT 302 ke presigned URL
 * R2, bukan JSON `{url}` — lihat komentar urutan di route-nya. `<video>`
 * mengikuti redirect HTTP secara natif seperti elemen media lain, jadi tidak
 * perlu `fetch` + `r.json()` di sini sama sekali.
 *
 * `src` tetap dipasang lewat efek (properti DOM), bukan atribut yang
 * dirender server, dengan alasan yang sama seperti versi materi: URL rute
 * proxy ini tidak boleh muncul di RSC payload sebagai bagian dari markup
 * awal. Ia BOLEH terlihat di view-source sebagai path proxy — itu bukan URL
 * R2 yang sesungguhnya, dan rute itu sendiri menolak siapa pun tanpa sesi
 * pembeli yang sah.
 */
export function PemutarVideo({ productId }: { productId: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.src = `/api/produk/${productId}/video`;
  }, [productId]);

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
