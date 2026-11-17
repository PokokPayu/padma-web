"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pasangPemulihBfcache } from "@/lib/doku/pulih-bfcache";

/**
 * TOMBOL BAYAR TAGIHAN SESI (P3/B6, spec §6.3).
 *
 * Meniru pola tombol beli produk (A8, Ruling 2 rencana B): peramban meminta
 * tautan ke rute server, lalu DIALIHKAN ke halaman bayar DOKU. Dua keputusan
 * yang diwarisi:
 *
 *   - Rute MEMAKAI ULANG tautan yang masih berlaku (`terbitkanTautanBayar`):
 *     tekan dua kali atau di dua tab memberi URL yang sama, tanpa invoice
 *     baru. Sandbox DOKU juga menerima pembuatan ulang invoice yang sama
 *     (K6, A12), jadi mencoba lagi sesudah gagal tidak butuh nomor percobaan
 *     baru — berbeda dengan checkout produk, di sini tidak ada `ulang`.
 *   - Tombol tetap TERKUNCI sesudah alihan berhasil, bukan hanya selama
 *     permintaan: `useTransition` kembali tidak sibuk begitu `assign`
 *     dipanggil, padahal peramban masih memuat DOKU. Kuncinya dilepas lagi
 *     bila pembeli kembali lewat Back (`pageshow` dari bfcache).
 *
 * Keputusan "kapan beralih" hidup di fungsi murni yang menerima `fetch` dan
 * `arahkan`, supaya bisa dijalankan suite tanpa jsdom.
 */

export type HasilBayarSesi =
  | { jenis: "url"; url: string }
  | { jenis: "masuk" }
  /** Belum menyetujui S&K versi berlaku → layar /persetujuan. */
  | { jenis: "persetujuan" }
  | { jenis: "pesan"; pesan: string };

const PESAN_COBA_LAGI = "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.";

/** Satu permintaan tautan ke rute bayar sesi. Tidak pernah melempar. */
export async function mintaTautanSesi(
  permintaanId: string,
  ambil: typeof fetch = (...argumen) => fetch(...argumen),
): Promise<HasilBayarSesi> {
  let jawab: Response;
  try {
    jawab = await ambil(`/api/pesanan/sesi/${permintaanId}/bayar`, { method: "POST" });
  } catch {
    return { jenis: "pesan", pesan: PESAN_COBA_LAGI };
  }

  if (jawab.status === 401) return { jenis: "masuk" };

  const isi = (await jawab.json().catch(() => null)) as
    | { url?: unknown; pesan?: unknown; kode?: unknown }
    | null;

  if (jawab.status === 403 && isi?.kode === "perlu_persetujuan") return { jenis: "persetujuan" };

  if (!jawab.ok || typeof isi?.url !== "string" || isi.url === "") {
    return { jenis: "pesan", pesan: typeof isi?.pesan === "string" ? isi.pesan : PESAN_COBA_LAGI };
  }
  return { jenis: "url", url: isi.url };
}

/** Minta tautan lalu alihkan — HANYA untuk `jenis: "url"`. */
export async function bayarLaluAlihkan(
  permintaanId: string,
  arahkan: (url: string) => void,
  ambil: typeof fetch = (...argumen) => fetch(...argumen),
): Promise<HasilBayarSesi> {
  const hasil = await mintaTautanSesi(permintaanId, ambil);
  if (hasil.jenis === "url") arahkan(hasil.url);
  return hasil;
}

export function TombolBayar({ permintaanId, label }: { permintaanId: string; label: string }) {
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, mulai] = useTransition();
  const [dialihkan, setDialihkan] = useState(false);
  const terkunci = sibuk || dialihkan;
  const router = useRouter();

  // Back dari halaman DOKU memulihkan halaman ini dari bfcache dengan
  // `dialihkan` masih true — tombolnya macet. Lihat `pasangPemulihBfcache`.
  useEffect(() => pasangPemulihBfcache(window, () => setDialihkan(false)), []);
  const halamanIni = `/passport/bayar/${permintaanId}`;

  function klik() {
    mulai(async () => {
      setPesan(null);
      const hasil = await bayarLaluAlihkan(permintaanId, (url) => window.location.assign(url));
      if (hasil.jenis === "url") {
        setDialihkan(true);
        return;
      }
      if (hasil.jenis === "masuk") {
        router.push("/masuk");
        return;
      }
      if (hasil.jenis === "persetujuan") {
        // Kembali ke tagihan ini sesudah setuju; klien menekan Bayar sekali
        // lagi — tidak ada pembayaran yang dimulai otomatis.
        router.push(`/persetujuan?lanjut=${encodeURIComponent(halamanIni)}`);
        return;
      }
      setPesan(hasil.pesan);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={klik}
        disabled={terkunci}
        data-bayar={permintaanId}
        className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
      >
        {terkunci ? "Menyiapkan pembayaran..." : label}
      </button>
      {pesan && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {pesan}
        </p>
      )}
    </>
  );
}
