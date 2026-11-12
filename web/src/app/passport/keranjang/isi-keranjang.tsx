"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { muatSkripSnap, PESAN_PEMBAYARAN_BELUM_AKTIF } from "@/lib/midtrans/snap-peramban";
import { formatRupiah } from "@/lib/rupiah-publik";
import { mintaBatal, mintaCheckout } from "@/app/produk/[slug]/tombol-beli";
import type { ItemKeranjang, KeadaanItem } from "@/lib/keranjang/baca";

/** `Record` lengkap: nilai keadaan baru memerahkan kompilator, bukan diam. */
const KALIMAT_KEADAAN: Record<KeadaanItem, string | null> = {
  siap: null,
  tidak_tersedia: "Tidak tersedia lagi",
  gratis: "Gratis — ambil di halaman produknya",
  sudah_dimiliki: "Sudah Anda miliki",
  diproses: "Pembayaran sedang diproses",
};

const PESAN_TIDAK_BISA_DIBUKA = "Pembayaran tidak bisa dibuka. Coba lagi sebentar lagi.";

export function IsiKeranjang({
  item,
  terbuka,
  produksi,
  clientKey,
}: {
  item: readonly ItemKeranjang[];
  terbuka: { id: string; kode: string } | null;
  produksi: boolean;
  clientKey: string;
}) {
  const [pesan, setPesan] = useState<string | null>(null);
  // Lihat dokblok `mintaCheckout`: sekali order_id terkirim ke Snap, setiap
  // percobaan berikutnya wajib `ulang: true`.
  const [orderIdTerpakai, setOrderIdTerpakai] = useState(false);
  // Snap sudah menerbitkan instruksi bayar — pembatalan ditutup sejak detik
  // itu (alasan yang sama dengan `pembayaranBerjalan` di tombol-beli.tsx).
  const [pembayaranBerjalan, setPembayaranBerjalan] = useState(false);
  const [pending, mulai] = useTransition();
  const router = useRouter();

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
      if (clientKey.trim() === "") {
        setPesan(PESAN_PEMBAYARAN_BELUM_AKTIF);
        return;
      }
      try {
        await muatSkripSnap(clientKey, produksi);
      } catch {
        setPesan(PESAN_TIDAK_BISA_DIBUKA);
        return;
      }

      const { hasil, orderIdTerbakar } = await mintaCheckout(
        siap.map((i) => i.productId),
        orderIdTerpakai,
      );
      if (orderIdTerbakar) setOrderIdTerpakai(true);

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
      if (!window.snap) {
        setPesan(PESAN_TIDAK_BISA_DIBUKA);
        return;
      }

      window.snap.pay(hasil.token, {
        // Bukan sumber kebenaran pembayaran — hanya memicu pembacaan ulang.
        // Keranjang dikosongkan trigger saat akses benar-benar terbit.
        onSuccess: () => {
          setPembayaranBerjalan(true);
          router.refresh();
        },
        onPending: () => {
          setPembayaranBerjalan(true);
          router.refresh();
        },
        onClose: () => router.refresh(),
        onError: () => {
          setPesan("Pembayaran gagal. Silakan coba lagi.");
          router.refresh();
        },
      });
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

  if (item.length === 0 && !pembayaranBerjalan) {
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
      {pembayaranBerjalan && (
        <div className="rounded-xl bg-gold/10 px-4 py-3 text-[13.5px] text-night">
          <b>Pembayaran sedang diproses.</b> Begitu diterima, produknya muncul di{" "}
          <Link href="/passport/produk" className="font-semibold text-leaf underline">
            Pembelian Saya
          </Link>
          .
        </div>
      )}

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

      {terbuka !== null && !pembayaranBerjalan && (
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
