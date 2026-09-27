"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PESANAN_TERBUKA, type StatusPesanan } from "@/lib/pesanan/status";

/**
 * Pemecah `PESANAN_BERUANG`, dan satu-satunya tempat di berkas ini yang
 * menyebut nama status.
 *
 * Kenapa bukan himpunan seperti di `bacaPesananStaf`: "Periksa ulang" memang
 * bisa dinyatakan dengan `PESANAN_TERBUKA` (lihat JSX di bawah), tapi kedua
 * anggota `PESANAN_BERUANG` menuntut tombol yang BERLAWANAN — `lunas`
 * menerbitkan barangnya, `ditahan` justru meminta manusia memutuskan lebih
 * dulu. Himpunan Tugas 1 sengaja tidak memecah keduanya, dan §0.6 melarang
 * melahirkan himpunan kelima yang bernama lain di sini.
 *
 * Yang memaksa kelengkapannya karena itu `Record` BERTIPE PENUH, mekanisme
 * yang sama dengan `LABEL_STATUS_PESANAN` di `status.ts`: nama status hidup
 * sebagai KUNCI yang diperiksa kompilator, bukan sebagai literal yang
 * dibandingkan. Nilai enum keenam memerahkan berkas ini sampai seseorang
 * memutuskan tombol apa yang pantas untuknya — alih-alih menghilangkan
 * tombolnya dari layar staf tanpa suara.
 */
const TOMBOL_BERUANG: Record<StatusPesanan, "akses" | "putusan" | null> = {
  menunggu_bayar: null,
  ditahan: "putusan",
  lunas: "akses",
  kedaluwarsa: null,
  dibatalkan: null,
};

/**
 * Empat tindakan pemulihan Lapis 2, masing-masing dengan alamatnya sendiri.
 *
 * ===== KENAPA fetch KE RUTE, BUKAN SERVER ACTION =====
 * Dua di antaranya (periksa ulang, terbitkan akses) menulis lewat FUNGSI MESIN
 * yang tertutup bagi `authenticated` — `terapkan_notifikasi_midtrans` dan
 * `terbitkan_akses_item` ada di `MESIN_TERTUTUP`
 * (`tests/fungsi-mesin-tertutup.test.ts`), jadi keduanya menuntut service role.
 * Dan `tests/admin-shell.test.ts:643` melarang service role di seluruh
 * `src/app/admin/**`. Rute di `src/app/api/**` adalah satu-satunya tempat
 * keduanya boleh bertemu.
 *
 * ===== TOMBOL DIRENDER BERSYARAT =====
 * Bukan karena tampilan adalah pagar — setiap rute memeriksa syaratnya sendiri
 * — melainkan karena menawarkan tombol yang pasti ditolak adalah janji yang
 * tidak akan ditepati. `Tutup tinjauan` khususnya: pada baris `ditahan` ia
 * ditolak `P0001`, dan seandainya tidak ditolak ia akan mengubur pesanan yang
 * uangnya sudah di tangan Midtrans dan barangnya belum keluar.
 *
 * ===== NOL LITERAL STATUS =====
 * Tidak satu pun cabang di bawah membandingkan `status` dengan string yang
 * diketik di tempat. Pelajaran repo yang sudah dibayar sekali: nilai enum baru
 * membuat konstanta tunggal salah DIAM-DIAM — dan di layar ini bentuk salahnya
 * adalah tombol pemulihan yang berhenti muncul untuk status yang justru paling
 * butuh dipulihkan, tanpa satu pun galat.
 */
export function TombolPesanan({
  pesananId,
  status,
  butuhTinjauan,
}: {
  pesananId: string;
  status: StatusPesanan;
  butuhTinjauan: boolean;
}) {
  const router = useRouter();
  const [menyegarkan, mulai] = useTransition();
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  async function kirim(jalur: string, badan?: unknown) {
    setPesan(null);
    setSibuk(true);
    try {
      const res = await fetch(`/api/pesanan/${pesananId}/${jalur}`, {
        method: "POST",
        headers: badan ? { "content-type": "application/json" } : undefined,
        body: badan ? JSON.stringify(badan) : undefined,
      });
      const isi = (await res.json().catch(() => ({}))) as { pesan?: string };
      if (!res.ok) {
        // Kalimat rute diteruskan apa adanya: rute yang menolak sudah menulis
        // alasannya untuk dibaca manusia, dan menggantinya dengan "Gagal."
        // membuang justru bagian yang berguna.
        setPesan(isi.pesan ?? "Tindakan gagal dijalankan.");
        return;
      }
      mulai(() => router.refresh());
    } catch {
      setPesan("Jaringan tidak menjawab. Coba lagi.");
    } finally {
      setSibuk(false);
    }
  }

  const mati = sibuk || menyegarkan;
  const kelas =
    "min-h-[36px] rounded-lg border border-panel-border bg-panel-bg px-3 text-[12px] font-bold text-panel-ink disabled:opacity-60";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {PESANAN_TERBUKA.includes(status) && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("periksa-ulang")}>
            Periksa ulang
          </button>
        )}
        {TOMBOL_BERUANG[status] === "akses" && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("terbitkan-akses")}>
            Terbitkan akses
          </button>
        )}
        {TOMBOL_BERUANG[status] === "putusan" && (
          <>
            <button
              type="button"
              disabled={mati}
              className={kelas}
              onClick={() => void kirim("putuskan", { putusan: "lunas" })}
            >
              Putuskan lunas
            </button>
            <button
              type="button"
              disabled={mati}
              className={kelas}
              onClick={() => void kirim("putuskan", { putusan: "dibatalkan" })}
            >
              Putuskan batal
            </button>
          </>
        )}
        {butuhTinjauan && TOMBOL_BERUANG[status] !== "putusan" && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("tutup-tinjauan")}>
            Tutup tinjauan
          </button>
        )}
      </div>
      {pesan && <p className="text-[11.5px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
