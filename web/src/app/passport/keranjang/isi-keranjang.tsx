"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/rupiah-publik";
import { mintaBatal, mintaLaluAlihkan } from "@/app/produk/[slug]/tombol-beli";
import type { ItemKeranjang, KeadaanItem } from "@/lib/keranjang/baca";
import { pasangPemulihBfcache } from "@/lib/doku/pulih-bfcache";

/** `Record` lengkap: nilai keadaan baru memerahkan kompilator, bukan diam. */
const KALIMAT_KEADAAN: Record<KeadaanItem, string | null> = {
  siap: null,
  tidak_tersedia: "Tidak tersedia lagi",
  gratis: "Gratis — ambil di halaman produknya",
  sudah_dimiliki: "Sudah Anda miliki",
  diproses: "Pembayaran sedang diproses",
};

export function IsiKeranjang({
  item,
  terbuka,
}: {
  item: readonly ItemKeranjang[];
  terbuka: { id: string; kode: string } | null;
}) {
  const [pesan, setPesan] = useState<string | null>(null);
  // Lihat dokblok `mintaCheckout`: tautan yang masih berlaku dipakai ulang;
  // `ulang: true` hanya sesudah pembuatan tautan gagal atau ambigu (502/jaringan).
  const [orderIdTerpakai, setOrderIdTerpakai] = useState(false);
  const [pendingTrans, mulai] = useTransition();
  // Tetap true sesudah alihan dimulai: `pendingTrans` kembali false begitu
  // `assign` selesai, padahal peramban masih memuat DOKU.
  const [dialihkan, setDialihkan] = useState(false);
  const pending = pendingTrans || dialihkan;
  const router = useRouter();

  // Back dari halaman DOKU memulihkan halaman ini dari bfcache dengan
  // `dialihkan` masih true — tombolnya macet. Lihat `pasangPemulihBfcache`.
  useEffect(() => pasangPemulihBfcache(window, () => setDialihkan(false)), []);

  const siap = item.filter((i) => i.keadaan === "siap");
  const total = siap.reduce((s, i) => s + (i.harga ?? 0), 0);

  function hapus(productId: string) {
    mulai(async () => {
      setPesan(null);
      const { error } = await createBrowserSupabase().rpc("hapus_dari_keranjang", {
        p_product_id: productId,
      });
      if (error) setPesan("Item belum bisa dihapus. Coba lagi sebentar lagi.");
      router.refresh();
    });
  }

  function bayar() {
    mulai(async () => {
      setPesan(null);
      // Kunci DOKU yang belum terpasang datang dari rute sebagai 503 berkalimat
      // dan tampil lewat cabang `pesan` di bawah.
      const { hasil, orderIdTerbakar } = await mintaLaluAlihkan(
        siap.map((i) => i.productId),
        orderIdTerpakai,
        (url) => window.location.assign(url),
      );
      if (orderIdTerbakar) setOrderIdTerpakai(true);
      if (hasil.jenis === "url") {
        setOrderIdTerpakai(false);
        setDialihkan(true);
        return;
      }

      if (hasil.jenis === "masuk") {
        router.push("/masuk");
        return;
      }
      if (hasil.jenis === "persetujuan") {
        // Halaman keranjang yang terbuka sejak sebelum dokumen diperbarui —
        // layout tidak dirender ulang, jadi rutenya yang menangkap.
        router.push("/persetujuan");
        return;
      }
      if (hasil.jenis === "pesan") {
        setPesan(hasil.pesan);
        // 409 (ditolak gerbang, mis. pesanan terbuka lain) → baca ulang supaya
        // tombol batal muncul. 502/jaringan → JANGAN: membaca ulang memindahkan
        // item ke "diproses" dan menghilangkan tombol Bayar, satu-satunya jalan
        // mencoba lagi dengan nomor percobaan baru.
        if (!orderIdTerbakar) router.refresh();
        return;
      }
      // jenis "url": peramban sedang dialihkan ke halaman bayar DOKU. Keranjang
      // dikosongkan trigger saat akses benar-benar terbit, bukan di sini.
    });
  }

  function batal(id: string) {
    mulai(async () => {
      setPesan(null);
      const hasil = await mintaBatal(id);
      if (hasil.jenis === "masuk") {
        router.push("/masuk");
        return;
      }
      if (hasil.jenis === "pesan") setPesan(hasil.pesan);
      if (hasil.jenis === "dibatalkan") setOrderIdTerpakai(false);
      router.refresh();
    });
  }

  if (item.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-black/10 bg-paper p-4 text-[13px] text-ink-soft">
        Keranjang Anda kosong. Jelajahi{" "}
        <Link href="/produk" className="font-semibold text-leaf underline">
          etalase produk
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-black/10 rounded-xl border border-black/10">
        {item.map((i) => {
          const kalimat = KALIMAT_KEADAAN[i.keadaan];
          return (
            <li key={i.productId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/produk/${i.slug}`} className="block text-[14px] font-bold text-night">
                  {i.judul}
                </Link>
                {kalimat !== null ? (
                  <span className="text-[12.5px] text-clay">{kalimat}</span>
                ) : (
                  <span className="text-[13px] text-ink-soft">{formatRupiah(i.harga ?? 0)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => hapus(i.productId)}
                disabled={pending}
                className="min-h-[44px] rounded-lg px-3 text-[13px] font-semibold text-ink-soft underline disabled:opacity-60"
              >
                Hapus
              </button>
            </li>
          );
        })}
      </ul>

      {terbuka !== null && (
        <div className="rounded-xl border border-black/10 bg-paper px-4 py-3">
          <p className="text-[13.5px] text-night">
            Anda masih punya pesanan <b>{terbuka.kode}</b> yang belum dibayar.
          </p>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            Jangan batalkan bila Anda sudah mendapat nomor VA dan akan mentransfer.
          </p>
          <button
            type="button"
            onClick={() => batal(terbuka.id)}
            disabled={pending}
            className="mt-2 min-h-[44px] rounded-lg border border-night/25 px-4 py-2 text-[13px] font-bold text-night disabled:opacity-60"
          >
            {pending ? "Memproses..." : "Batalkan pesanan itu"}
          </button>
        </div>
      )}

      {siap.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-night">
            Total <b>{formatRupiah(total)}</b>
          </p>
          <button
            type="button"
            onClick={bayar}
            disabled={pending}
            className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
          >
            {pending ? "Menyiapkan pembayaran..." : "Bayar"}
          </button>
        </div>
      )}

      {pesan && <p className="text-sm text-clay">{pesan}</p>}

      <p className="rounded-xl border border-black/10 bg-white p-4 text-[13px] text-ink-soft">
        Produk digital dikirim seketika sesudah pembayaran dan <b>tidak dapat
        dikembalikan</b>.
      </p>
    </div>
  );
}
