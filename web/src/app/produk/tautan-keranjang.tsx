"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ACARA_KERANJANG, hitungKeranjangDiPeramban } from "@/lib/keranjang/peramban";

/** Nol item = nol tautan: pengunjung anon dan keranjang kosong tidak melihat apa pun. */
export function TautanKeranjang({ className = "" }: { className?: string }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    let hidup = true;
    const segarkan = () => {
      void hitungKeranjangDiPeramban().then((v) => {
        if (hidup) setN(v);
      });
    };
    segarkan();
    window.addEventListener(ACARA_KERANJANG, segarkan);
    return () => {
      hidup = false;
      window.removeEventListener(ACARA_KERANJANG, segarkan);
    };
  }, []);

  if (n === 0) return null;
  return (
    <Link
      href="/passport/keranjang"
      className={`inline-flex min-h-[44px] items-center rounded-lg border border-night/20 px-4 text-[13.5px] font-bold text-night ${className}`}
    >
      Keranjang ({n})
    </Link>
  );
}
