"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { titipTujuanDiPeramban } from "@/lib/auth/tujuan-produk";
import { ACARA_KERANJANG } from "@/lib/keranjang/peramban";

/**
 * Hanya dirender `TombolBeli` pada keadaan "belum" — yang sudah memiliki atau
 * sedang membayar produk ini akan ditolak juga oleh RPC-nya.
 *
 * Status "sudah di keranjang" dibaca dari PERAMBAN, alasan yang sama dengan
 * `punyaProdukDiPeramban`: halaman ini anon dan `revalidate = 300`.
 */
async function adaDiKeranjang(productId: string): Promise<boolean> {
  const sb = createBrowserSupabase();
  const { data: sesi } = await sb.auth.getSession();
  if (!sesi.session) return false;
  const { data } = await sb
    .from("cart_items")
    .select("product_id")
    .eq("product_id", productId)
    .maybeSingle();
  return data !== null;
}

export function TombolKeranjang({ slug, productId }: { slug: string; productId: string }) {
  const [diKeranjang, setDiKeranjang] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [pending, mulai] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let hidup = true;
    void adaDiKeranjang(productId).then((ada) => {
      if (hidup) setDiKeranjang(ada);
    });
    return () => {
      hidup = false;
    };
  }, [productId]);

  function tambah() {
    mulai(async () => {
      setPesan(null);
      const sb = createBrowserSupabase();
      const { data: sesi } = await sb.auth.getSession();
      if (!sesi.session) {
        titipTujuanDiPeramban(`/produk/${slug}`);
        router.push("/masuk");
        return;
      }
      const { error } = await sb.rpc("tambah_ke_keranjang", { p_product_id: productId });
      if (error) {
        // P0001/P0002 adalah `raise exception` KITA, kalimatnya untuk pembeli.
        setPesan(
          error.code === "P0001" || error.code === "P0002"
            ? error.message
            : "Belum bisa menambah ke keranjang. Coba lagi sebentar lagi.",
        );
        return;
      }
      setDiKeranjang(true);
      window.dispatchEvent(new Event(ACARA_KERANJANG));
    });
  }

  if (diKeranjang) {
    return (
      <p className="mt-3 text-[13.5px] text-ink-soft">
        Sudah di keranjang ·{" "}
        <Link href="/passport/keranjang" className="font-semibold text-leaf underline">
          Lihat keranjang
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={tambah}
        disabled={pending}
        className="min-h-[44px] rounded-lg border border-night/25 px-5 py-3 font-bold text-night disabled:opacity-60"
      >
        {pending ? "Menambahkan..." : "Tambah ke keranjang"}
      </button>
      {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
    </div>
  );
}
