"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { muatSkripSnap } from "@/lib/midtrans/snap-peramban";
import { BlokBuka, punyaProdukDiPeramban } from "./tombol-ambil";

/**
 * Keadaan tombol produk BERBAYAR, dari sudut pandang pengunjung. Urutan
 * pemeriksaannya MENGIKAT dan disebut spec supaya tidak ditebak:
 *
 *   "punya"    — entitlement hidup. Diperiksa DULUAN, karena kepemilikan adalah
 *                satu-satunya sumber kebenaran akses; status pesanan bukan.
 *   "menunggu" — punya pesanan yang belum mati dan belum melahirkan akses
 *                (`menunggu_bayar` ATAU `ditahan`). Orang ini SUDAH menyetor.
 *   "belum"    — pengunjung anon, atau klien yang memang belum memulai apa pun.
 *
 * Membalik dua yang pertama berarti orang yang baru mentransfer lewat VA
 * ditawari membeli lagi, dan sebagian dari mereka akan membayar dua kali.
 */
export type KeadaanBeli = "belum" | "punya" | "menunggu";

/**
 * KEPUTUSAN URUTAN LAYAR, sebagai fungsi MURNI.
 *
 * ===== KENAPA DIEKSTRAK DARI `segarkan()` =====
 * Selama ia tinggal di dalam `useCallback`, ia tidak bisa dijalankan satu kali
 * pun oleh suite ini: `renderToStaticMarkup` tidak menjalankan efek dan repo
 * ini nol jsdom. Kelima uji `PanelBeli` MENERIMA `keadaan` sebagai prop —
 * mereka membuktikan tampilan untuk "menunggu" benar, bukan bahwa keadaan
 * "menunggu" pernah DIHITUNG. Seseorang boleh menukar dua blok di bawah, atau
 * menghapus cabang `punyaPesanan` sama sekali, dan tidak ada yang merah.
 *
 * Resep ini sudah dipakai Tugas 10 untuk masalah yang sama (`picu-periksa.ts`,
 * "supaya bisa dijalankan sungguhan"); di sini ia diterapkan ke keputusan yang
 * jauh lebih mahal bila terbalik.
 *
 * ===== URUTANNYA MENGIKAT, DAN SPEC MENYEBUTNYA =====
 *   1. entitlement DULU — kepemilikan adalah satu-satunya sumber kebenaran
 *      akses; status pesanan bukan. Orang yang SUDAH punya produknya harus
 *      melihat "Buka", apa pun keadaan pesanannya.
 *   2. baru `punya_pesanan_menunggu` — "orang yang baru mentransfer lewat VA
 *      melihat 'Pembayaran Anda sedang diproses' alih-alih tombol beli, dan
 *      tidak membayar dua kali".
 *   3. baru tombol beli.
 *
 * `punyaPesanan` diterima sebagai FUNGSI, bukan sebagai boolean: itulah yang
 * membuat "tidak pernah dipanggil ketika sudah punya" bisa di-assert, dan
 * sekaligus yang menghemat satu perjalanan RPC untuk setiap pemilik produk.
 */
export async function keadaanBeli(
  punyaProduk: () => Promise<boolean>,
  punyaPesanan: () => Promise<boolean>,
): Promise<KeadaanBeli> {
  if (await punyaProduk()) return "punya";
  return (await punyaPesanan()) ? "menunggu" : "belum";
}

/**
 * Bagian yang MURNI tampilan — dipisahkan supaya ketiga keadaannya bisa diuji
 * dengan render sungguhan (`tests/produk-tombol-beli.test.tsx`), bukan lewat
 * pembacaan teks sumber. Efek, jaringan, dan popup Snap tinggal di `TombolBeli`.
 */
export function PanelBeli({
  slug,
  keadaan,
  pending,
  pesan,
  onBeli,
}: {
  slug: string;
  keadaan: KeadaanBeli;
  pending: boolean;
  pesan: string | null;
  onBeli: () => void;
}) {
  if (keadaan === "punya") return <BlokBuka slug={slug} />;

  if (keadaan === "menunggu") {
    return (
      <div className="mt-4 rounded-xl bg-gold/10 px-4 py-3">
        <p className="text-[13.5px] font-bold text-night">
          Pembayaran Anda sedang diproses.
        </p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Transfer bank dan VA kadang butuh beberapa menit. Begitu pembayarannya
          diterima, produk ini muncul di{" "}
          <Link href="/passport/produk" className="font-semibold text-leaf underline">
            Pembelian Saya
          </Link>
          . Halaman ini tidak perlu dimuat ulang terus-menerus.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onBeli}
        disabled={pending}
        className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Menyiapkan pembayaran..." : "Beli sekarang"}
      </button>
      {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
    </div>
  );
}

/**
 * `produksi` dan `clientKey` DIOPER dari server (`page.tsx`), tidak dibaca di
 * sini. `MIDTRANS_PRODUKSI` tidak berprefix `NEXT_PUBLIC_`; membacanya dari
 * komponen klien memberi `undefined`, yang berarti sandbox — selamanya, di
 * produksi, tanpa satu pun galat.
 */
export function TombolBeli({
  slug,
  productId,
  produksi,
  clientKey,
}: {
  slug: string;
  productId: string;
  produksi: boolean;
  clientKey: string;
}) {
  const [keadaan, setKeadaan] = useState<KeadaanBeli>("belum");
  const [pesan, setPesan] = useState<string | null>(null);
  const [pending, mulai] = useTransition();
  const router = useRouter();

  /**
   * Keadaan dibaca DARI PERAMBAN, bukan dari server: `/produk/[slug]` sengaja
   * anon dan ter-cache (`revalidate = 300`), dan membaca cookie di sana akan
   * membuat SELURUH etalase dynamic demi satu tombol.
   *
   * MEMULANGKAN keadaannya, tidak memasangnya. Pemisahan itu bukan selera:
   * `react-hooks/set-state-in-effect` menolak `setState` di BADAN efek sebagai
   * galat, jadi yang dipanggil efek di bawah adalah pembaca murni ini dan
   * pemasangannya hidup di `.then()` — pola yang sudah dipakai `TombolAmbil`
   * di `tombol-ambil.tsx`.
   */
  const bacaKeadaan = useCallback(async (): Promise<KeadaanBeli> => {
    const sb = createBrowserSupabase();
    // Tanpa sesi tidak ada yang perlu ditanyakan, dan bertanya hanya melahirkan
    // 42501 di konsol pengunjung: `anon` tidak memegang hak atas
    // `digital_entitlements` maupun RPC pesanan.
    const { data: sesi } = await sb.auth.getSession();
    if (!sesi.session) return "belum";

    // Urutannya hidup di `keadaanBeli`, bukan di sini — lihat dokbloknya.
    return keadaanBeli(
      () => punyaProdukDiPeramban(sb, productId),
      async () => {
        const { data } = await sb.rpc("punya_pesanan_menunggu", { p_product_id: productId });
        return data === true;
      },
    );
  }, [productId]);

  /** Pembacaan ulang yang dipicu callback Snap, bukan oleh pemasangan komponen. */
  const segarkan = useCallback(async () => {
    setKeadaan(await bacaKeadaan());
  }, [bacaKeadaan]);

  // Bendera `hidup` disalin dari `TombolAmbil`: jawaban yang mendarat sesudah
  // pengunjung meninggalkan halaman dibuang, bukan dipasang ke komponen yang
  // sudah tidak ada.
  useEffect(() => {
    let hidup = true;
    void bacaKeadaan().then((keadaanBaru) => {
      if (hidup) setKeadaan(keadaanBaru);
    });
    return () => {
      hidup = false;
    };
  }, [bacaKeadaan]);

  function klik() {
    mulai(async () => {
      setPesan(null);

      try {
        await muatSkripSnap(clientKey, produksi);
      } catch {
        setPesan("Pembayaran tidak bisa dibuka. Coba lagi sebentar lagi.");
        return;
      }

      const jawab = await fetch("/api/pesanan/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId }),
      });

      if (jawab.status === 401) {
        // `/masuk` tidak membaca parameter lanjutan apa pun di repo ini, jadi
        // tidak ada janji "kembali ke sini" yang dibuat lalu dilanggar.
        router.push("/masuk");
        return;
      }

      const isi = (await jawab.json().catch(() => null)) as
        | { token?: string; pesan?: string }
        | null;
      if (!jawab.ok || !isi?.token) {
        setPesan(isi?.pesan ?? "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.");
        return;
      }

      window.snap?.pay(isi.token, {
        // `onSuccess` BUKAN sumber kebenaran pembayaran — yang memutuskan lunas
        // hanyalah notifikasi bertanda tangan. Ia hanya memicu pembacaan ulang.
        // Pada metode yang membawa pengguna keluar aplikasi (deeplink e-wallet)
        // ia bisa tidak pernah menyala sama sekali, dan itu diterima sadar:
        // pembeli menemukan produknya di Pembelian Saya saat ia kembali.
        onSuccess: () => {
          void segarkan();
          router.refresh();
        },
        onPending: () => setKeadaan("menunggu"),
        onClose: () => void segarkan(),
        onError: () => setPesan("Pembayaran gagal. Silakan coba lagi."),
      });
    });
  }

  return (
    <PanelBeli
      slug={slug}
      keadaan={keadaan}
      pending={pending}
      pesan={pesan}
      onBeli={klik}
    />
  );
}
